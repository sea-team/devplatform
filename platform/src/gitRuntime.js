'use strict';

/**
 * Git 运行时探测与执行（v0.3.3）。
 *
 * 背景：cloneRepo() 原先直接 `spawn('git', ...)`，一旦平台跑在不含 Git 的镜像里
 * （例如 remote.js 复用的 node:20-alpine），或 Windows 单文件 exe 所在机器没把
 * Git 加进 PATH，就会抛出难以理解的 `spawn git ENOENT`。
 *
 * 本模块统一解决：
 *  1. 按「控制台配置 > GIT_BIN > PATH > 平台常见安装路径」解析可执行文件；
 *  2. 用绝对路径 spawn，并把 ENOENT 转成带修复指引的中文错误；
 *  3. 向 /api/git/runtime 暴露诊断信息，让克隆页在点击前就能看到 Git 是否就绪；
 *  4. 描述「SSH 宿主机兜底」是否可用（容器内无 Git 时由 gitSources 在宿主机执行 clone）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { config, state, update } = require('./core');

/** 当前进程所在系统的发行版名称：容器里是 Alpine，Windows exe 里是 Windows 版本号。 */
function localOsName() {
  try {
    if (process.platform === 'linux') {
      const text = fs.readFileSync('/etc/os-release', 'utf8');
      const m = text.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (m) return m[1];
    }
  } catch { /* 非 Linux / 无该文件时退回 Node 的报告 */ }
  return `${os.type()} ${os.release()}`;
}

const WINDOWS_CANDIDATES = () => {
  const local = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(programFiles, 'Git', 'cmd', 'git.exe'),
    path.join(programFiles, 'Git', 'bin', 'git.exe'),
    path.join(pfX86, 'Git', 'cmd', 'git.exe'),
    path.join(pfX86, 'Git', 'bin', 'git.exe'),
    path.join(local || 'C:\\Users\\Default\\AppData\\Local', 'Programs', 'Git', 'cmd', 'git.exe'),
    path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\git.exe',
    'C:\\tools\\git\\cmd\\git.exe',
  ];
};

const UNIX_CANDIDATES = [
  '/usr/bin/git', '/usr/local/bin/git', '/bin/git',
  '/opt/homebrew/bin/git', '/usr/local/opt/git/bin/git',
  '/snap/bin/git', '/usr/lib/git-core/git',
];

/** 控制台里手工指定的路径优先于 .env，方便不重启就修正 PATH 问题。 */
function configuredBin() {
  const saved = state().git && state().git.bin ? String(state().git.bin).trim() : '';
  if (saved) return { bin: saved, source: '控制台配置' };
  if (config.gitBin) return { bin: String(config.gitBin).trim(), source: 'GIT_BIN' };
  return null;
}

function probe(bin) {
  try {
    const r = spawnSync(bin, ['--version'], {
      timeout: 8000, encoding: 'utf8', windowsHide: true, shell: false,
      env: process.env, maxBuffer: 1024 * 256,
    });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    const m = text.match(/git version\s+([\w.]+)/i);
    if (r.status === 0 && m) return { ok: true, version: m[1] };
    return { ok: false, reason: text.trim().slice(0, 160) || `exit=${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

let cache = null;
/** 宿主机 Git 的实测结果（SSH 探测有成本，做短缓存，避免每次 API / 体检都重连）。 */
let hostCache = null;
const HOST_CACHE_OK_MS = 90 * 1000;
const HOST_CACHE_FAIL_MS = 20 * 1000;

function emptyHostProbe(reason = '尚未探测') {
  return {
    checked: false, skipped: false, available: false, bin: '', version: '',
    host: '', serverName: '', workspaceWritable: null, detail: '', error: reason, checkedAt: '',
    os: '', kernel: '', hostname: '', ip: '', lsb: '',
  };
}

/**
 * 实测「SSH 宿主机兜底」那台机器上的 Git。
 *
 * v0.3.9：246 这类部署的宿主机明明装了 git，但平台跑在精简 node:alpine 容器里，
 * 旧版只报「当前运行环境未找到可用的 Git」，看起来像没识别到宿主机。
 * 这里把宿主机 Git 当成一种真正检测过的 Git 来源：查 command -v git、
 * git --version、以及宿主机工作区是否可写，结果同时供 /api/git/runtime 与体检使用。
 *
 * 本机已有 Git 时直接跳过（不产生 SSH 开销）；探测失败也返回结构化结果，绝不让接口 500。
 */
async function probeHostGit({ force = false, timeoutMs = 8000 } = {}) {
  const local = resolve();
  if (local.available) {
    hostCache = { at: Date.now(), value: { ...emptyHostProbe('当前环境已有 Git，无需探测宿主机'), skipped: true, checked: true } };
    return hostCache.value;
  }
  const ttl = hostCache && hostCache.value && hostCache.value.available ? HOST_CACHE_OK_MS : HOST_CACHE_FAIL_MS;
  if (!force && hostCache && Date.now() - hostCache.at < ttl) return hostCache.value;

  const fb = fallback();
  const out = emptyHostProbe('');
  out.checked = true;
  out.checkedAt = new Date().toISOString();
  out.serverName = fb.serverName || '';
  out.host = fb.serverHost || '';
  if (!fb.ready || !fb.serverId) {
    out.error = fb.reason || 'SSH 宿主机兜底未就绪，无法探测宿主机 Git';
  } else {
    try {
      // 延迟加载，避免无 Git 环境的单元测试替身被迫加载 ssh2 / 配置模块。
      const { sshExec } = require('./integrations');
      const server = (state().servers || []).find((s) => s.id === fb.serverId);
      if (!server) throw new Error(`SSH 服务器 ${fb.serverId} 不存在`);
      const dir = JSON.stringify(fb.hostWorkspaceDir || '/workspace');
      // v0.3.10：同一次 SSH 顺带采集宿主机发行版 / 内核 / 主机名，
      // 让「运行平台」能明确区分容器（Alpine）与真正跑 Git 的宿主机（Debian 9.13）。
      const command = [
        `printf 'GIT_BIN='; command -v git 2>/dev/null || printf 'MISSING\\n'`,
        'git --version 2>/dev/null || true',
        `test -d ${dir} && test -w ${dir} && echo WS_WRITABLE || echo WS_DENIED`,
        'echo "===HOSTOS==="; (lsb_release -ds 2>/dev/null || ( . /etc/os-release 2>/dev/null && printf "%s\\n" "$PRETTY_NAME" ) || head -1 /etc/issue 2>/dev/null)',
        'echo "===HOSTKERNEL==="; uname -sr',
        'echo "===HOSTNAME==="; hostname',
        "echo \"===HOSTIP===\"; hostname -I 2>/dev/null | awk '{print $1}'",
        'echo "===LSB==="; lsb_release -a 2>/dev/null || true',
      ].join('; ');
      const r = await sshExec(server, command, timeoutMs);
      const text = `${r.stdout || ''}${r.stderr || ''}`;
      const sec = (name) => {
        const m = text.match(new RegExp(`===${name}===([\\s\\S]*?)(?=\\n===|$)`));
        return m ? m[1].trim() : '';
      };
      const binMatch = text.match(/GIT_BIN=([^\r\n]+)/);
      const verMatch = text.match(/git version\s+([\w.]+)/i);
      out.bin = binMatch && !/MISSING/.test(binMatch[1]) ? binMatch[1].trim() : '';
      out.version = verMatch ? verMatch[1] : '';
      out.available = Boolean(out.bin && out.version) && r.code === 0;
      out.workspaceWritable = /WS_WRITABLE/.test(text);
      out.os = sec('HOSTOS');
      out.kernel = sec('HOSTKERNEL');
      out.hostname = sec('HOSTNAME');
      out.ip = sec('HOSTIP');
      out.lsb = sec('LSB');
      out.detail = text.trim().replace(/\s+/g, ' ').slice(0, 240);
      out.error = out.available ? '' : `宿主机 ${out.host || out.serverName} 未检测到可用的 Git${out.detail ? `：${out.detail}` : ''}`;
    } catch (e) {
      out.error = `SSH 实测失败：${String(e.message || e).slice(0, 180)}`;
      out.detail = out.error;
    }
  }
  hostCache = { at: Date.now(), value: out };
  return out;
}

function hostGitSummary() {
  if (hostCache && hostCache.value) return hostCache.value;
  return emptyHostProbe();
}

function resolve(force = false) {
  if (cache && !force) return cache;
  const configured = configuredBin();
  const candidates = [];
  if (configured) candidates.push({ ...configured, explicit: true });
  candidates.push({ bin: 'git', source: 'PATH', explicit: false });
  for (const bin of (process.platform === 'win32' ? WINDOWS_CANDIDATES() : UNIX_CANDIDATES)) {
    candidates.push({ bin, source: '常见安装路径', explicit: true });
  }

  const tried = [];
  for (const c of candidates) {
    if (c.explicit && !fs.existsSync(c.bin)) {
      tried.push(`${c.bin}: 文件不存在`);
      continue;
    }
    const r = probe(c.bin);
    if (r.ok) {
      cache = { available: true, bin: c.bin, version: r.version, source: c.source, tried };
      return cache;
    }
    tried.push(`${c.bin}: ${r.reason || '不可用'}`);
  }
  cache = { available: false, bin: '', version: '', source: '', tried };
  return cache;
}

function refresh() { cache = null; return resolve(true); }

function setBin(value) {
  const bin = String(value || '').trim().slice(0, 300);
  update((s) => {
    if (!s.git) s.git = { bin: '' };
    s.git.bin = bin;
  });
  return refresh();
}

/**
 * SSH 宿主机兜底：平台容器没有 Git 时，借已登记的 SSH 服务器在宿主机上执行 clone。
 * 工作区是 bind mount，宿主机写进去的文件容器内立即可见。
 * 只有明确知道「容器内 WORKSPACE_DIR 对应宿主机哪个目录」时才允许启用，
 * 否则会把仓库克隆到一台与平台无关机器上，造成看似成功实则不可见。
 */
function fallback() {
  const servers = state().servers || [];
  const preferred = config.gitFallbackServerId || config.buildServerId || '';
  const dir = String(config.hostWorkspaceDir || '').replace(/\/+$/, '');
  const guessed = (s) => {
    const base = String((s && s.deployDir) || '').replace(/\/+$/, '');
    return base ? `${base}/workspace` : '';
  };
  const server = servers.find((s) => s.id === preferred)
    || servers.find((s) => guessed(s) && guessed(s) === dir)
    || servers.find((s) => Boolean(guessed(s)))
    || servers[0]
    || null;
  const hostWorkspaceDir = dir || guessed(server);
  const enabled = state().git ? state().git.sshFallback !== 'off' : true;
  const ready = Boolean(enabled && server && hostWorkspaceDir);
  return {
    enabled, ready,
    serverId: server ? server.id : '',
    serverName: server ? server.name : '',
    serverHost: server ? server.host : '',
    hostWorkspaceDir,
    source: dir ? 'HOST_WORKSPACE_DIR' : (server && server.deployDir ? '服务器部署目录 + /workspace 推导' : ''),
    reason: !enabled ? '已在控制台关闭 SSH 宿主机兜底'
      : !server ? '未登记可用的 SSH 服务器'
        : !hostWorkspaceDir ? '未配置 HOST_WORKSPACE_DIR，且服务器没有部署目录，无法确定宿主机工作区路径'
          : '',
  };
}

function setFallback(enabled) {
  update((s) => {
    if (!s.git) s.git = { bin: '' };
    s.git.sshFallback = enabled ? 'auto' : 'off';
  });
  return fallback();
}

function missingMessage() {
  const fb = fallback();
  return [
    '未找到可执行的 Git（原始错误：spawn git ENOENT）：当前运行环境（容器 / 本机）没有安装 Git，或 Git 不在 PATH 中。',
    '修复方式：',
    '1) 在本页「Git 运行时」填写可执行文件绝对路径（Linux 如 /usr/bin/git；Windows 如 C:\\Program Files\\Git\\cmd\\git.exe）并保存；',
    '2) 或在 .env 设置 GIT_BIN=<git 路径> 后重启平台；',
    '3) 或重新执行 node scripts/remote.js deploy <host>，新版部署脚本会自动准备自带 Git 的运行时镜像；',
    '4) 或在容器内执行 apk add git / apt-get install -y git 后重启平台；',
    fb.ready
      ? `5) 已检测到 SSH 宿主机兜底（${fb.serverName} · ${fb.hostWorkspaceDir}），本次克隆会自动在宿主机执行。`
      : '5) 或登记一台已装 Git 的 SSH 宿主机并配置 HOST_WORKSPACE_DIR，平台会自动在宿主机执行克隆。',
    '6) 或在「环境适配」页切换档案 / 点「应用自动处置」，由平台按当前环境自动重检并选择通道。',
  ].join('\n');
}

/** 统一包装 spawn 错误，避免把 ENOENT 原样抛给前端。 */
function friendlyError(err, context = '执行 Git') {
  const message = String((err && err.message) || err);
  if (err && (err.code === 'ENOENT' || /ENOENT/.test(message))) {
    return new Error(`${context}失败：${missingMessage()}`);
  }
  return new Error(`${context}失败：${message}`);
}

/** 用解析出的绝对路径执行 git；返回 { code, output }，不因非零码直接抛错。 */
function exec(args, { env = process.env, timeoutMs = 300000, onData = null } = {}) {
  const r = resolve();
  if (!r.available) return Promise.reject(new Error(missingMessage()));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(r.bin, args, {
      shell: false, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Git 执行超时'));
    }, timeoutMs) : null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onData) onData(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (e) => finish(reject, friendlyError(e)));
    child.on('close', (code) => finish(resolvePromise, { code, output }));
  });
}

function describe() {
  const r = resolve();
  const fb = fallback();
  const hostGit = hostGitSummary();
  // v0.3.9：容器内没 Git 时，宿主机实测到 Git 就属于「已就绪」，不再当成缺失。
  const effective = r.available ? 'container' : (fb.ready && hostGit.available ? 'ssh-host' : (fb.ready ? 'ssh-host-unverified' : 'none'));
  const hostVersion = hostGit.available ? `Git ${hostGit.version}` : '';
  return {
    available: r.available,
    bin: r.bin,
    version: r.version,
    source: r.source,
    tried: r.tried,
    configuredBin: configuredBin() ? configuredBin().bin : '',
    platform: process.platform,
    workspaceDir: config.workspaceDir,
    hostWorkspaceDir: config.hostWorkspaceDir,
    channel: r.available ? 'local' : (fb.ready ? 'ssh-host' : 'none'),
    effective,
    effectiveGit: {
      location: effective,
      version: r.available ? r.version : hostGit.version,
      bin: r.available ? r.bin : hostGit.bin,
      host: r.available ? '' : hostGit.host,
      serverName: r.available ? '' : hostGit.serverName,
      verified: r.available || hostGit.available,
    },
    hostGit,
    fallback: fb,
    // v0.3.10：明确区分「平台进程所在的容器」与「真正执行 Git 的宿主机」。
    platformDetail: {
      current: `${process.platform}/${process.arch} · ${localOsName()} · 内核 ${os.release()}`,
      container: config.runtimeKind === 'container' || fs.existsSync('/.dockerenv'),
      runtimeImage: config.runtimeImage || '',
      host: hostGit.available
        ? `${hostGit.os || hostGit.host || '未知发行版'}${hostGit.kernel ? ` · 内核 ${hostGit.kernel}` : ''}${hostGit.hostname ? ` · ${hostGit.hostname}` : ''}`
        : '',
      hostIp: hostGit.ip || '',
      lsb: hostGit.lsb || '',
    },
    hint: r.available
      ? `Git ${r.version} 可用（${r.source}），克隆将在本机 / 当前容器执行。`
      : (hostGit.available && fb.ready
        ? `当前容器内没有 Git，但已实测宿主机 ${hostGit.host || hostGit.serverName} 上的 ${hostVersion}（${hostGit.bin}）；克隆会自动通过 SSH 在这台宿主机执行，无需安装，功能正常。`
        : (fb.ready
          ? `当前环境没有 Git，克隆将自动改用 SSH 宿主机 ${fb.serverName}（${fb.serverHost}）执行，工作区映射 ${fb.hostWorkspaceDir}。宿主机 Git 暂未实测：点「重新检测」验证。`
          : missingMessage())),
    installHint: process.platform === 'win32'
      ? '安装 Git for Windows 后重启平台，或填写 git.exe 绝对路径。'
      : '容器内：apk add --no-cache git / apt-get install -y git；宿主机：安装发行版 git 包。',
  };
}

module.exports = {
  resolve, refresh, describe, exec, probe, fallback, localOsName,
  probeHostGit, hostGitSummary,
  setBin, setFallback, missingMessage, friendlyError,
};
