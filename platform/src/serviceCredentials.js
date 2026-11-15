'use strict';

/**
 * 集成服务凭据（v0.4.5）
 * ------------------------------------------------------------------
 * 之前三项服务的账号 / 口令散落在安装脚本里：Gitea 与 OpenList 共用同一个
 * 随机密码、只写进 .env 却从不告诉用户，IDE 用的其实是 VS Code serve-web
 * 免连接令牌、界面却提示去环境配置填一个根本不生效的 CODE_SERVER_PASSWORD。
 *
 * 本模块把「安装时自动生成 → 平台可查看 → 平台可修改 → 同步到上游服务」
 * 闭环：
 *   - 查：GET  /api/services/credentials        脱敏视图（明文仅管理员）
 *   - 显：POST /api/services/credentials/reveal  管理员显式取明文
 *   - 改：PUT  /api/services/credentials         写 .env + 热同步运行时 + 改上游
 *
 * 修改顺序刻意是「先改上游服务，成功后再写 .env」：上游 CLI 失败时
 * .env 保留旧值，不会出现「平台显示新密码、服务其实还是旧密码」。
 * 明文绝不进日志；CLI 用参数数组调用，不经 shell 拼接。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { config, state, update, resolveEnvFile, HttpError } = require('./core');
const envConfig = require('./envConfig');
const serviceSetup = require('./serviceSetup');
const { openlistApi } = require('./integrations');

const execFileAsync = promisify(execFile);
const ENV_CONN_ID = 'env-default';
const isAdmin = (user) => Boolean(user && user.role === 'admin');

const mask = (v) => {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 8 ? `${s.slice(0, 1)}******` : `${s.slice(0, 3)}******${s.slice(-3)}`;
};

/** 安装脚本所在仓库根；单文件包与源码直跑两种布局都兼容。 */
function deploymentRoot() {
  const script = serviceSetup.scriptPath();
  return script ? path.resolve(path.dirname(script), '..') : '';
}

function servicesFile() {
  const root = deploymentRoot();
  return root ? path.join(root, 'windows', 'runtime', 'services.json') : '';
}

function readServices() {
  const file = servicesFile();
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeServices(plan) {
  const file = servicesFile();
  if (!file) throw new HttpError(404, '未找到 windows\\runtime\\services.json：请先执行「一键安装并启动」');
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), 'utf8');
}

/** 从 services.json 里取各服务的 exe / 工作目录 / 配置路径，避免把路径写死。 */
function planOf(plan, key) {
  const spec = plan && plan[key];
  if (!spec || !spec.enabled || !spec.exe || !fs.existsSync(spec.exe)) return null;
  const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
  return { exe: String(spec.exe), workdir: String(spec.workdir || path.dirname(spec.exe)), args, port: Number(spec.port || 0) };
}

function idePaths(plan) {
  const spec = planOf(plan, 'ide');
  if (!spec) return null;
  const idx = spec.args.indexOf('--server-data-dir');
  const home = idx >= 0 ? String(spec.args[idx + 1] || '') : '';
  return { ...spec, home, tokenFile: home ? path.join(home, 'connection-token') : '' };
}

/** 三项服务的凭据定义。密码 / 令牌一律从运行时 config 读（安装与修改后都会热同步）。 */
function definitions() {
  const plan = readServices();
  const nativeIde = Boolean(planOf(plan, 'ide'));
  const ideMode = config.ideAccessMode === 'token' ? 'token' : 'open';
  return [
    {
      key: 'gitea', name: 'Gitea',
      url: config.giteaUrl,
      loginUrl: `${config.giteaUrl}/user/login`,
      manageUrl: `${config.giteaUrl}/admin`,
      user: config.giteaAdminUser || 'admin',
      passwordKey: 'GITEA_ADMIN_PASSWORD', password: config.giteaAdminPassword || '',
      tokenKey: 'GITEA_TOKEN', token: config.giteaToken || '',
      native: Boolean(planOf(plan, 'gitea')),
      note: '后台管理员账号，可用它登录 Gitea 网页管理仓库 / 用户。平台调用 API 用的是访问令牌，改密码不会让令牌失效。',
    },
    {
      key: 'openlist', name: 'OpenList',
      url: config.openlistUrl,
      loginUrl: `${config.openlistUrl}/@login`,
      manageUrl: `${config.openlistUrl}/@manage`,
      user: config.openlistUser || 'admin',
      passwordKey: 'OPENLIST_PASSWORD', password: config.openlistPassword || '',
      tokenKey: 'OPENLIST_TOKEN', token: config.openlistToken || '',
      native: Boolean(planOf(plan, 'openlist')),
      note: '后台管理员账号，可用它登录 /@manage 管理挂载与用户。平台优先用访问令牌，密码改完会自动刷新令牌。',
    },
    {
      key: 'ide', name: '在线 IDE',
      url: config.codeServerUrl,
      loginUrl: config.codeServerUrl,
      manageUrl: '',
      user: '',
      passwordKey: 'CODE_SERVER_PASSWORD', password: config.codeServerPassword || '',
      tokenKey: '', token: '',
      native: nativeIde,
      mode: ideMode,
      modeLabel: ideMode === 'token' ? '访问口令保护' : '免密（VS Code serve-web）',
      note: nativeIde
        ? '本机原生 IDE 是 VS Code serve-web，没有用户名，只有可选「连接令牌」。默认免密可直接打开；切到口令保护后，打开 IDE 需输入这里的访问口令。'
        : '外部 code-server：登录页密码由该服务自身的 PASSWORD 环境变量决定；本页只能管理本平台记录的值，如为外部部署请在其服务端同步修改。',
    },
  ];
}

function findDef(key) {
  const def = definitions().find((d) => d.key === String(key || '').trim());
  if (!def) throw new HttpError(400, `不支持的集成服务：${key}`);
  return def;
}

/** 脱敏视图。普通用户只看得到「是否配置」，看不到账号、口令与令牌。 */
function overview(user) {
  const privileged = isAdmin(user);
  return {
    envPath: resolveEnvFile(),
    managed: Boolean(servicesFile()),
    services: definitions().map((d) => {
      const base = {
        key: d.key, name: d.name, url: d.url, loginUrl: d.loginUrl, manageUrl: d.manageUrl,
        passwordKey: d.passwordKey, tokenKey: d.tokenKey,
        configured: Boolean(d.password), hasToken: Boolean(d.token),
        native: d.native, mode: d.mode || '', modeLabel: d.modeLabel || '',
        note: d.note, editable: privileged, revealAllowed: privileged,
      };
      if (!privileged) return base;
      return {
        ...base,
        user: d.user, masked: mask(d.password), tokenMasked: mask(d.token),
      };
    }),
  };
}

function reveal(key, user) {
  if (!isAdmin(user)) throw new HttpError(403, '集成服务明文凭据仅管理员可查看');
  const d = findDef(key);
  return {
    key: d.key, name: d.name, user: d.user,
    password: d.password, token: d.token,
    passwordKey: d.passwordKey, loginUrl: d.loginUrl, manageUrl: d.manageUrl,
  };
}

function validatePassword(value, key) {
  const v = String(value === undefined || value === null ? '' : value);
  if (v.length < 8 || v.length > 128) throw new HttpError(400, '密码长度需为 8–128 个字符');
  // .env 不加引号写回，且 CLI 用参数数组调用；仍要排除会破坏解析 / 命令行的字符。
  if (/[\s"'#\\`$;|&<>\r\n\0]/.test(v)) {
    throw new HttpError(400, '密码不能包含空格、引号、#、反斜杠或 shell 特殊字符');
  }
  if (v.includes('******')) throw new HttpError(400, '请填写真实密码，不要提交脱敏占位符');
  if (key === 'CODE_SERVER_PASSWORD' && !/^[\x21-\x7e]+$/.test(v)) {
    throw new HttpError(400, 'IDE 访问口令只能使用 ASCII 可见字符');
  }
  return v;
}

/** 调用上游 CLI 改密码。返回是否真的改动了服务（外部服务只改平台记录）。 */
async function applyUpstream(d, password) {
  const plan = readServices();
  if (d.key === 'gitea') {
    const spec = planOf(plan, 'gitea');
    if (!spec) return { applied: false, detail: '未检测到本机原生 Gitea，已只更新平台记录；外部 Gitea 请在其服务端同步改密' };
    const cfgIdx = spec.args.indexOf('--config');
    const ini = cfgIdx >= 0 ? String(spec.args[cfgIdx + 1] || '') : '';
    const args = [];
    if (ini) args.push('--config', ini);
    args.push('admin', 'user', 'change-password', '--username', d.user, '--password', password, '--must-change-password=false');
    await execFileAsync(spec.exe, args, { cwd: spec.workdir, timeout: 30000, windowsHide: true });
    return { applied: true, detail: '已通过 gitea admin user change-password 更新服务密码' };
  }
  if (d.key === 'openlist') {
    const spec = planOf(plan, 'openlist');
    if (!spec) return { applied: false, detail: '未检测到本机原生 OpenList，已只更新平台记录；外部 OpenList 请在其服务端同步改密' };
    await execFileAsync(spec.exe, ['admin', 'set', password], { cwd: spec.workdir, timeout: 30000, windowsHide: true });
    return { applied: true, detail: '已通过 openlist admin set 更新服务密码' };
  }
  return { applied: false, detail: '' };
}

/** OpenList 改密后刷新管理员令牌（取不到就保留原 token，绝不写空）。 */
async function refreshOpenlistToken() {
  const plan = readServices();
  const spec = planOf(plan, 'openlist');
  if (!spec) return '';
  try {
    const { stdout } = await execFileAsync(spec.exe, ['admin', 'token'], {
      cwd: spec.workdir, timeout: 30000, windowsHide: true,
    });
    const m = /Admin token:\s*(\S+)/.exec(String(stdout || ''));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/** 同步 state.json 里 env-default 连接，避免「连接管理」页还显示旧密码。 */
function syncEnvConnection(d, password, token) {
  if (d.key !== 'openlist') return;
  update((s) => {
    const list = Array.isArray(s.openlistConnections) ? s.openlistConnections : [];
    const conn = list.find((c) => c && c.id === ENV_CONN_ID);
    if (conn) {
      conn.password = password;
      conn.user = d.user;
      if (token) conn.token = token;
    }
  });
}

/**
 * 按 IDE 访问模式重写 services.json 的启动参数，并把口令写入 token 文件。
 * open → --without-connection-token；token → --connection-token-file <file>。
 */
function applyIdePlan(mode, password) {
  const plan = readServices();
  const ide = idePaths(plan);
  if (!ide) return { applied: false, detail: '未检测到本机原生 IDE，已只更新平台记录' };
  // 显式重建参数数组：跳过旧的访问控制参数（连同它的值），再按新模式追加。
  const rebuilt = [];
  for (let i = 0; i < ide.args.length; i += 1) {
    const a = ide.args[i];
    if (a === '--without-connection-token') continue;
    if (a === '--connection-token' || a === '--connection-token-file') { i += 1; continue; }
    rebuilt.push(a);
  }
  if (mode === 'token') {
    if (!ide.tokenFile) throw new HttpError(500, 'IDE 启动参数缺少 --server-data-dir，无法确定连接令牌文件位置');
    fs.mkdirSync(ide.home, { recursive: true });
    fs.writeFileSync(ide.tokenFile, password, 'utf8');
    rebuilt.push('--connection-token-file', ide.tokenFile);
  } else {
    rebuilt.push('--without-connection-token');
  }
  plan.ide.args = rebuilt;
  plan.ide.accessMode = mode;
  writeServices(plan);
  return { applied: true, detail: mode === 'token' ? '已写入连接令牌文件并更新 IDE 启动参数' : '已更新 IDE 启动参数为免密' };
}

async function restartIde() {
  const script = serviceSetup.scriptPath();
  if (!script) return { restarted: false, detail: '未找到安装脚本，IDE 参数已保存，下次「启动服务」时生效' };
  let note = '';
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '${script.replace(/'/g, "''")}' -Action restart-ide`,
    ], { timeout: 90000, windowsHide: true, maxBuffer: 1024 * 1024 });
    note = String(stdout || '').split(/\r?\n/)
      .filter((l) => /在线 IDE|已启动 \(PID|WARN|FAIL|已结束/.test(l)).slice(-3).join('；');
  } catch (e) {
    note = `IDE 重启脚本异常：${String((e && e.message) || e).slice(0, 160)}`;
  }
  // 脚本 exit=0 不代表服务真的活着：旧 socket 未释放时新进程会立刻因端口占用退出。
  // 只有拿到真实 HTTP 响应（token 模式的登录页 401 也算）才算重启成功。
  let restarted = false;
  try {
    const port = (readServices() && readServices().ide && readServices().ide.port) || 8080;
    const r = await fetch(`http://127.0.0.1:${Number(port)}/`, {
      signal: AbortSignal.timeout(5000), redirect: 'manual',
    });
    restarted = r.status < 500;
  } catch { restarted = false; }
  if (!restarted) note = `${note}；端口探测未返回有效响应（IDE 可能仍被旧进程占用端口，请查看 windows\\runtime\\logs\\ide.out.log 或点「启动服务」重试）`.replace(/^；/, '');
  return { restarted, detail: note };
}

/**
 * 修改凭据。body: { service, password?, mode? }。
 * mode 仅对 ide 有效：open | token；未提供时沿用当前模式。
 */
async function setCredential(body = {}, user) {
  if (!isAdmin(user)) throw new HttpError(403, '仅管理员可以修改集成服务凭据');
  const key = String(body.service || body.key || '').trim();
  const d = findDef(key);
  const rawPassword = body.password;
  const hasPassword = rawPassword !== undefined && rawPassword !== null && String(rawPassword) !== '';
  let password = hasPassword ? validatePassword(rawPassword, d.passwordKey) : d.password;
  let mode = d.mode || '';
  if (body.mode !== undefined && String(body.mode) !== '') {
    if (d.key !== 'ide') throw new HttpError(400, '访问模式只适用于在线 IDE');
    mode = String(body.mode);
    if (!['open', 'token'].includes(mode)) throw new HttpError(400, 'IDE 访问模式只能是 open 或 token');
  }
  const changes = [];
  const envPatch = {};
  // 切到口令保护但 .env 里还没有口令：自动生成一个，保证「需要密码时一定已配置」。
  let generatedIdePassword = false;
  if (d.key === 'ide' && mode === 'token' && !password) {
    password = crypto.randomBytes(18).toString('base64url');
    generatedIdePassword = true;
  }
  if (hasPassword || generatedIdePassword) envPatch[d.passwordKey] = password;
  if (d.key === 'ide' && body.mode !== undefined && String(body.mode) !== '') envPatch.IDE_ACCESS_MODE = mode;

  // 1) 先改上游服务，失败就不动 .env。
  let upstream = { applied: false, detail: '' };
  let newToken = '';
  if (hasPassword && (d.key === 'gitea' || d.key === 'openlist')) {
    upstream = await applyUpstream(d, password);
    if (upstream.applied && d.key === 'openlist') {
      newToken = await refreshOpenlistToken();
      if (newToken && newToken !== d.token) envPatch.OPENLIST_TOKEN = newToken;
    }
  }

  // 2) 写 .env（白名单 + 自动备份）+ 热同步运行时 config。
  if (Object.keys(envPatch).length) {
    const result = envConfig.write(envPatch, { confirm: true });
    for (const c of result.changed) changes.push({ key: c.key, created: c.created });
  }
  serviceSetup.applyServiceEnv();

  // 3) IDE：只在口令 / 模式真的变了时更新启动参数并单独重启，不打断另外两个服务。
  let ideResult = null;
  if (d.key === 'ide' && (hasPassword || generatedIdePassword || Object.prototype.hasOwnProperty.call(envPatch, 'IDE_ACCESS_MODE'))) {
    ideResult = applyIdePlan(mode || 'open', password);
    if (ideResult.applied) ideResult.restart = await restartIde();
  }

  // 4) 同步平台侧连接对象与 OpenList API 的 token 缓存。
  if (d.key === 'openlist') {
    syncEnvConnection(d, password, newToken);
    if (newToken) openlistApi.resetToken();
  }

  const notes = [];
  if (upstream.detail) notes.push(upstream.detail);
  if (ideResult && ideResult.detail) notes.push(ideResult.detail);
  if (ideResult && ideResult.restart) {
    const r = ideResult.restart;
    notes.push(r.restarted
      ? `IDE 已重启并确认可访问${r.detail ? `（${r.detail}）` : ''}`
      : r.detail);
  }
  if (newToken) notes.push('OpenList 管理员令牌已刷新');
  return {
    service: d.key,
    changed: changes.map((c) => c.key),
    upstreamApplied: upstream.applied,
    ideRestarted: Boolean(ideResult && ideResult.restart && ideResult.restart.restarted),
    message: notes.length ? notes.join('；') : '凭据已更新',
  };
}

/** 安装脚本未跑过 / .env 缺项时，按现有运行时值补齐（不改上游服务密码）。 */
function ensureGenerated() {
  // 必须按「.env 里有没有这一行」判断，不能按 config 值：core.js 给账号 / 模式
  // 都有默认值，config 永远非空，会让这些键一直不落盘、环境配置页一直显示未设置。
  let defined = new Map();
  try { defined = envConfig.parseEnv(fs.readFileSync(resolveEnvFile(), 'utf8')).values; } catch { /* 文件不存在 */ }
  const has = (k) => defined.has(k) && String(defined.get(k) || '') !== '';
  const patch = {};
  if (!has('GITEA_ADMIN_USER')) patch.GITEA_ADMIN_USER = config.giteaAdminUser || 'admin';
  if (!has('GITEA_ADMIN_PASSWORD') && (config.giteaAdminPassword || config.openlistPassword)) {
    // 老版本把同一个随机密码用作 Gitea / OpenList 的 admin 密码，沿用才与上游一致。
    patch.GITEA_ADMIN_PASSWORD = config.giteaAdminPassword || config.openlistPassword;
  }
  if (!has('OPENLIST_USER')) patch.OPENLIST_USER = config.openlistUser || 'admin';
  if (!has('CODE_SERVER_PASSWORD')) patch.CODE_SERVER_PASSWORD = crypto.randomBytes(18).toString('base64url');
  if (!has('IDE_ACCESS_MODE')) patch.IDE_ACCESS_MODE = config.ideAccessMode === 'token' ? 'token' : 'open';
  if (!Object.keys(patch).length) return [];
  envConfig.write(patch, { confirm: true });
  serviceSetup.applyServiceEnv();
  return Object.keys(patch);
}

/** 本机原生 VS Code serve-web？决定 IDE 打开项目时用本机路径还是容器映射路径。 */
function ideNative() {
  return Boolean(idePaths(readServices()));
}

module.exports = {
  overview, reveal, setCredential, ensureGenerated, ideNative,
  definitions, mask,
};
