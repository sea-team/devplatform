'use strict';

/**
 * v0.3.10 · 平台运行主机信息。
 *
 * 背景：平台经常跑在精简容器里（Alpine），但用户真正关心的是宿主机
 * （例如 10.0.0.246 的 Debian GNU/Linux 9.13 stretch）。旧版「运行平台」只显示
 * `linux/x64`，总览也只统计业务数量，看不出机器是谁、系统是什么、资源如何。
 *
 * 本模块把两边信息合并成一份只读报告：
 *  - local：平台进程自身（Node / 版本 / 容器镜像 / OS / CPU / 内存 / 运行时长）；
 *  - host：SSH 宿主机（发行版 / 内核 / Git / CPU / 内存 / 磁盘 / 负载 / 容器数）。
 * 宿主机发行版与 Git 复用 gitRuntime.probeHostGit() 的同一次 SSH 实测（带缓存），
 * 资源数据复用 integrations.collectStatus()；整份报告再缓存 60 秒，避免总览轮询压垮 SSH。
 */
const fs = require('fs');
const os = require('os');
const { config, state } = require('./core');
const gitRuntime = require('./gitRuntime');
const { collectStatus } = require('./integrations');

const TTL_MS = 60 * 1000;
let cache = null;

function localInfo() {
  let version = '';
  try { version = require('../package.json').version; } catch { /* SEA 单文件里退回 release.json */ }
  if (!version) {
    try {
      const release = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'release.json'), 'utf8'));
      version = release.version || '';
    } catch { /* 忽略 */ }
  }
  const inContainer = config.runtimeKind === 'container' || fs.existsSync('/.dockerenv');
  return {
    version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    os: gitRuntime.localOsName(),
    kernel: os.release(),
    cpuCores: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
    freeMemMB: Math.round(os.freemem() / 1048576),
    uptimeSec: Math.round(process.uptime()),
    container: inContainer,
    runtimeKind: config.runtimeKind || (inContainer ? 'container' : 'host'),
    runtimeImage: config.runtimeImage || '',
    workspaceDir: config.workspaceDir,
    hostWorkspaceDir: config.hostWorkspaceDir,
    envFile: config.envFile || '',
  };
}

function humanUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d ? `${d} 天` : '', h ? `${h} 小时` : '', `${m} 分钟`].filter(Boolean).join(' ');
}

/**
 * 平台直接跑在宿主机（非容器）且没登记 SSH 服务器时，报告右半边不该是
 * 一整片「无」：此时「真正执行 Git / Docker 的机器」就是本机，直接用 os
 * 模块采集一份与 collectStatus 同结构的数据填进去。
 */
function localStatus() {
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = Math.round(os.freemem() / 1048576);
  let disk = null;
  try {
    const st = fs.statfsSync(process.cwd());
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const gb = (n) => `${(n / 1073741824).toFixed(1)}G`;
    disk = {
      used: gb(total - free), total: gb(total),
      usagePct: total ? `${Math.round(((total - free) / total) * 100)}%` : '',
    };
  } catch { /* 某些系统拿不到 statfs */ }
  return {
    cpuCores: os.cpus().length,
    memory: {
      usedMB: totalMB - freeMB, totalMB,
      usagePct: totalMB ? Math.round(((totalMB - freeMB) / totalMB) * 100) : 0,
    },
    disk,
    load1: null, load5: null, load15: null,   // Windows 的 os.loadavg() 全 0，不展示更诚实
    containers: [],
    host: os.hostname(),
    checkedAt: new Date().toISOString(),
  };
}

async function report({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return { ...cache.value, cached: true };

  const local = localInfo();
  const fb = gitRuntime.fallback();
  const hostGit = await gitRuntime.probeHostGit({ force });
  let status = null;
  let statusError = '';
  const server = (state().servers || []).find((s) => s.id === fb.serverId);
  // 本机直跑 + 未登记 SSH 节点：不需要 SSH 采集，本机即宿主机。
  const localFallback = !server && !local.container;
  const localGit = localFallback ? gitRuntime.describe() : null;
  if (!server) {
    if (localFallback) status = localStatus();
    else statusError = '未登记可用于采集的 SSH 宿主机：平台运行在容器内时，需在「服务器」登记一台 SSH 宿主机才能采集其资源信息';
  } else {
    try { status = await collectStatus(server); }
    catch (e) { statusError = `采集失败：${String(e.message || e).slice(0, 160)}`; }
  }

  const value = {
    local: { ...local, uptime: humanUptime(local.uptimeSec) },
    host: {
      name: localFallback ? '本机（平台所在主机）' : (fb.serverName || hostGit.serverName || ''),
      host: localFallback ? os.hostname() : (fb.serverHost || hostGit.host || ''),
      ip: localFallback ? '' : (hostGit.ip || ''),
      os: localFallback ? gitRuntime.localOsName() : (hostGit.os || ''),
      kernel: localFallback ? os.release() : (hostGit.kernel || ''),
      hostname: localFallback ? os.hostname() : (hostGit.hostname || ''),
      lsb: localFallback ? '' : (hostGit.lsb || ''),
      git: localFallback
        ? { available: Boolean(localGit.available), version: localGit.version || '', bin: localGit.bin || '' }
        : { available: Boolean(hostGit.available), version: hostGit.version || '', bin: hostGit.bin || '' },
      workspace: localFallback ? local.workspaceDir : (fb.hostWorkspaceDir || ''),
      workspaceWritable: localFallback ? true : hostGit.workspaceWritable,
      cpuCores: status ? status.cpuCores : 0,
      memory: status ? status.memory : null,
      disk: status ? status.disk : null,
      load1: status ? status.load1 : null,
      load5: status ? status.load5 : null,
      load15: status ? status.load15 : null,
      containers: localFallback ? null : (status ? (status.containers || []).length : 0),
      systemHost: status ? status.host : '',
      checkedAt: status ? status.checkedAt : '',
      source: localFallback ? 'local' : 'ssh',
      note: localFallback
        ? '本机直跑（非容器部署）：Git 与 Docker 都在平台所在主机执行，无需登记 SSH 宿主机；下方为本机实时信息。'
        : '',
      error: statusError,
    },
    gitChannel: gitRuntime.describe().channel,
    checkedAt: new Date().toISOString(),
    cached: false,
  };
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { report, localInfo, humanUptime };
