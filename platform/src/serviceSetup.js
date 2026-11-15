'use strict';

/**
 * 集成服务一键安装 / 启动 / 停止（v0.4.5）
 * ------------------------------------------------------------------
 * 把 windows\native-services.ps1 的能力（下载 Gitea / OpenList / IDE
 * 二进制 → 生成凭据并写入 .env → 拉起服务）暴露给平台页面：
 * 用户在「集成服务」卡片点按钮即可，不再需要手工执行脚本。
 *
 * 设计要点：
 *  - 单任务模型：同一时刻只允许一个安装/启动/停止任务，防并发抢锁；
 *  - 日志环形缓冲：最多保留 500 行，前端轮询 /api/services/setup/job；
 *  - setup 成功后自动把 .env 里新写入的 GITEA_TOKEN 等同步进运行时
 *    config（免重启），概览页下一次探测即为真实结果。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { config, appRoot, resolveEnvFile, HttpError } = require('./core');
const { openlistApi } = require('./integrations');

const LOG_LIMIT = 500;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;   // 30 分钟兜底：下载极慢也不至于永久挂起

let job = null;      // { id, action, status, startedAt, finishedAt, exitCode, logs, timedOut }（可整体 JSON 序列化）
let child = null;    // 当前子进程
let jobTimer = null; // 超时兜底定时器（独立存放，避免进入序列化对象造成循环引用）

/** native-services.ps1 位置：源码直跑在仓库根 windows\，单文件包在 DP_ROOT\windows\。 */
function scriptPath() {
  const candidates = [
    path.join(appRoot || '', 'windows', 'native-services.ps1'),
    path.resolve(appRoot || '.', '..', 'windows', 'native-services.ps1'),
  ];
  for (const p of candidates) {
    try { if (p && fs.statSync(p).isFile()) return p; } catch { /* 试下一个 */ }
  }
  return '';
}

function pushLog(text) {
  if (!job) return;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    job.logs.push(line);
    if (job.logs.length > LOG_LIMIT) job.logs.splice(0, job.logs.length - LOG_LIMIT);
  }
}

/** 用 TCP 探测判断端口是否有服务监听（300ms 超时，够本机判定）。 */
function portUp(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 300 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

/**
 * HTTP 层可达性。只靠端口会漏掉「端口在监听但服务不可用」的情况
 * （例如 VS Code serve-web 没有 /healthz，或 Gitea 还未初始化完），
 * 那会让概览提示「服务未启动」而一键安装按钮却因端口通了被隐藏。
 * 与 /api/overview 同口径：拿到 <500 的响应就算就绪。
 */
async function httpUp(url) {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(1500) });
    try { await response.arrayBuffer(); } catch { /* 不关心响应体 */ }
    return response.status < 500;
  } catch { return false; }
}

function urlPort(url, fallback) {
  try { return Number(new URL(url).port) || fallback; } catch { return fallback; }
}

function binaryState(runtimeBin, bundledBin, name) {
  for (const dir of [runtimeBin, bundledBin]) {
    const p = path.join(dir, name);
    try { if (fs.statSync(p).isFile() && fs.statSync(p).size > 1024) return p; } catch { /* 下一个 */ }
  }
  return '';
}

/**
 * 汇总三个集成服务的安装/运行状态。不产生任何副作用，供页面渲染按钮用。
 */
async function status() {
  const script = scriptPath();
  const root = script ? path.resolve(path.dirname(script), '..') : '';
  const runtimeBin = root ? path.join(root, 'windows', 'runtime', 'bin') : '';
  const bundledBin = root ? path.join(root, 'windows', 'bin') : '';
  const services = [
    { key: 'gitea', name: 'Gitea', exe: 'gitea.exe', port: urlPort(config.giteaUrl, 3002), health: `${config.giteaUrl}/api/v1/version` },
    { key: 'openlist', name: 'OpenList', exe: 'openlist.exe', port: urlPort(config.openlistUrl, 5244), health: `${config.openlistUrl}/api/public/settings` },
    { key: 'ide', name: '在线 IDE (code-web)', exe: 'code-tunnel.exe', port: urlPort(config.codeServerUrl, 8080), health: `${config.codeServerUrl}/` },
  ];
  const out = [];
  for (const s of services) {
    const binary = root ? binaryState(runtimeBin, bundledBin, s.exe) : '';
    const portOpen = await portUp(s.port);
    const running = portOpen && await httpUp(s.health);
    out.push({ key: s.key, name: s.name, installed: Boolean(binary), binaryPath: binary, portOpen, running, port: s.port });
  }
  return {
    scriptAvailable: Boolean(script),
    scriptPath: script,
    runningJob: job && job.status === 'running'
      ? { id: job.id, action: job.action, startedAt: job.startedAt }
      : null,
    services: out,
  };
}

/** setup 成功后把 .env 新写入的服务凭据同步进运行时 config，免重启立即生效。 */
function applyServiceEnv() {
  const file = resolveEnvFile();
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const map = {
    GITEA_URL: 'giteaUrl', GITEA_TOKEN: 'giteaToken',
    OPENLIST_URL: 'openlistUrl', OPENLIST_TOKEN: 'openlistToken',
    OPENLIST_PASSWORD: 'openlistPassword', OPENLIST_USER: 'openlistUser',
    CODE_SERVER_URL: 'codeServerUrl',
  };
  const applied = [];
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m || !map[m[1]]) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!value) continue;
    process.env[key] = value;
    const field = map[key];
    config[field] = field.endsWith('Url') ? value.replace(/\/+$/, '') : value;
    applied.push(key);
  }
  return applied;
}

function finish(status, extra = {}) {
  if (!job) return;
  job.status = status;
  job.finishedAt = new Date().toISOString();
  Object.assign(job, extra);
  child = null;
  if (status === 'success' && job.action === 'setup') {
    job.envApplied = applyServiceEnv();
    // 安装脚本会重写 OPENLIST_TOKEN，但 API 客户端缓存了旧 token 换出的会话；
    // 不清缓存会让「已安装成功」后所有存储接口继续用旧凭据报 401。
    if (job.envApplied.length) openlistApi.resetToken();
    pushLog(`[平台] 已同步 .env 凭据到运行时${job.envApplied.length ? '：' + job.envApplied.join(', ') : '（未发现新增项）'}`);
    pushLog('[平台] 一键安装完成，概览页连通性将在下次刷新时更新。');
  }
  if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
}

/**
 * 启动 native-services.ps1。action ∈ setup | start | stop。
 * setup = 下载缺失的二进制 + 生成凭据写入 .env + 启动全部服务（一键按钮）。
 */
function run(action) {
  if (job && job.status === 'running') {
    throw new HttpError(409, `已有任务在执行中（${job.action}），请等它结束或查看日志`);
  }
  const script = scriptPath();
  if (!script) throw new HttpError(404, '未找到 windows\\native-services.ps1：当前部署形态不含安装脚本，请手动部署集成服务');
  if (!['setup', 'start', 'stop'].includes(action)) throw new HttpError(400, 'action 只支持 setup / start / stop');

  job = {
    id: `svc_${Date.now().toString(36)}`,
    action, status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: '', exitCode: null, timedOut: false,
    logs: [`[平台] 开始执行：native-services.ps1 -Action ${action}`],
    envApplied: [],
  };
  try {
    // 用 -Command 包一层把输出编码切到 UTF-8：PowerShell 5.1 管道输出默认 GBK，
    // 不处理的话中文日志在页面上是乱码；只影响本子进程，不影响手工运行脚本。
    const cmd = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; `
      + `& '${script.replace(/'/g, "''")}' -Action ${action}`;
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    finish('failed', { exitCode: -1 });
    job.logs.push(`[平台] 启动 PowerShell 失败：${e.message}`);
    throw new HttpError(500, `无法启动安装脚本：${e.message}`);
  }
  child.stdout.on('data', (d) => pushLog(d));
  child.stderr.on('data', (d) => pushLog(d));
  child.on('error', (e) => { pushLog(`[平台] 进程异常：${e.message}`); finish('failed', { exitCode: -1 }); });
  child.on('exit', (code) => {
    if (!job || job.status !== 'running') return;
    pushLog(`[平台] 脚本退出，exit=${code}`);
    finish(code === 0 ? 'success' : 'failed', { exitCode: code });
  });
  jobTimer = setTimeout(() => {
    if (!job || job.status !== 'running') return;
    pushLog('[平台] 任务超过 30 分钟，已强制终止（可重试或改用离线包安装）');
    try { child && child.kill(); } catch { /* 已退出 */ }
    finish('failed', { timedOut: true, exitCode: null });
  }, JOB_TIMEOUT_MS);
  return { id: job.id, action: job.action, status: job.status };
}

function currentJob() {
  return job || { id: '', action: '', status: 'idle', logs: [] };
}

/** 停止平台时不留孤儿脚本进程（尽力而为）。 */
function dispose() {
  if (child) { try { child.kill(); } catch { /* 已退出 */ } }
  if (jobTimer) clearTimeout(jobTimer);
}

module.exports = { status, run, currentJob, dispose, applyServiceEnv };
