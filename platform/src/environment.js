'use strict';

/**
 * 环境适配中心（v0.3.4）。
 *
 * 背景：同一份代码会跑在「本机 Windows 单文件 exe」「完整的 compose 容器」
 * 「精简 node:*-alpine 容器」「远程 SSH 部署」等不同环境里，能力差异很大：
 * 有的没有 Git、有的 Docker socket 不可达、有的软件源不通、有的必须借宿主机执行。
 * v0.3.3 只解决了 Git 单点，且每次换环境仍要人工排查、改参数、重新部署。
 *
 * 本模块把这件事变成「可配置 + 自动检查 + 自动处置」：
 *  1. 识别环境并生成指纹（平台 / 容器 / Node / 工作区映射 / 运行镜像）；
 *  2. 内置档案 + 自定义档案 + 环境变量三层配置，切换环境时自动覆盖旧配置；
 *  3. 启动时、部署后、控制台手动触发都能跑体检，逐项给出结论与建议；
 *  4. 自动处置只做安全动作（刷新探测、切换克隆通道、开关 SSH 兜底、
 *     降级构建后端、按显式授权安装 Git），不改凭据、不重启容器、不删数据；
 *  5. 指纹变化 = 环境已切换，自动重检并留下处置日志。
 *
 * 配置优先级（高 → 低）：
 *   .env / compose 的 DP_ENV_* 部署声明  >  控制台保存的策略微调  >  环境档案预设  >  auto 推导
 * 默认全部留空 = 完全自动，换机器不会被上一台机器遗留的 state.json 锁死。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { config, state, update } = require('./core');
const gitRuntime = require('./gitRuntime');
// v0.3.9：宿主机 Git 的 SSH 实测统一收敛到 gitRuntime.probeHostGit()。

/* ------------------------------- 常量与预设 ------------------------------- */

const STRATEGY_KEYS = ['gitClone', 'buildExecutor', 'gitInstall', 'sshFallback'];
const STRATEGY_DEFAULTS = { gitClone: 'auto', buildExecutor: '', gitInstall: 'never', sshFallback: 'auto' };
const ALLOWED = {
  // 空串 = 跟随档案，方便在控制台把某一项「还原为自动」，不让旧配置锁死新环境。
  gitClone: ['', 'auto', 'local', 'ssh-host', 'disabled'],
  buildExecutor: ['', 'auto', 'local', 'docker', 'ssh', 'wsl'],
  gitInstall: ['', 'never', 'auto'],
  sshFallback: ['', 'auto', 'on', 'off'],
};
const STRATEGY_LABELS = {
  gitClone: '克隆通道', buildExecutor: '构建后端', gitInstall: '缺失 Git 时联网安装', sshFallback: 'SSH 宿主机兜底',
};

/** 内置档案：只声明差异，未声明的字段沿用 STRATEGY_DEFAULTS。 */
const BUILTIN_PROFILES = {
  auto: {
    name: '自动适配（推荐）', builtin: true,
    description: '按体检结果推导档案与通道；换环境时自动重算，不需要手工改配置',
    strategies: {},
  },
  native: {
    name: '本机 / 单文件 exe', builtin: true,
    description: '平台直接跑在宿主机上，Git 与构建都在本机执行',
    strategies: { gitClone: 'local', gitInstall: 'never', sshFallback: 'auto' },
  },
  container: {
    name: '完整容器（自带 Git）', builtin: true,
    description: 'Dockerfile / compose 构建的镜像，已安装 Git 与 openssh-client',
    strategies: { gitClone: 'local', gitInstall: 'never' },
  },
  'container-lite': {
    name: '精简容器（Alpine / 无 Git）', builtin: true,
    description: 'node:*-alpine、slim 等不含 Git 的镜像，克隆强制走 SSH 宿主机',
    strategies: { gitClone: 'ssh-host', gitInstall: 'never', sshFallback: 'on' },
  },
  remote: {
    name: '远程 SSH 部署', builtin: true,
    description: '平台在远端、能力依赖已登记 SSH 节点；克隆与构建尽量走远程',
    strategies: { gitClone: 'ssh-host', buildExecutor: 'auto', gitInstall: 'never', sshFallback: 'on' },
  },
};

const ENV_KEYS = {
  gitClone: 'DP_GIT_CLONE_STRATEGY',
  buildExecutor: 'DP_ENV_BUILD_EXECUTOR',
  gitInstall: 'DP_GIT_INSTALL',
  sshFallback: 'DP_ENV_SSH_FALLBACK',
};

/* ------------------------------- 小工具 ---------------------------------- */

function envCfg() {
  const s = state();
  if (!s.environment) s.environment = {};
  return s.environment;
}

function flag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !/^(0|false|off|no|disabled)$/i.test(String(value).trim());
}

function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname === '/' ? '' : u.pathname}`;
  } catch { return String(raw || '(未配置)').slice(0, 120); }
}

function inContainer() {
  if (config.runtimeKind) return String(config.runtimeKind) === 'container';
  try { if (fs.existsSync('/.dockerenv')) return true; } catch { /* Windows 无此路径 */ }
  try {
    return /docker|kubepods|containerd|lxc/i.test(fs.readFileSync('/proc/1/cgroup', 'utf8'));
  } catch { return false; }
}

/** 环境指纹只包含「换环境才会变」的事实，避免自动装 Git 之类动作造成反复漂移。 */
function fingerprint() {
  const info = detect();
  const raw = [
    info.platform, info.arch, info.kind, info.nodeMajor,
    config.workspaceDir, config.hostWorkspaceDir, config.dataDir,
    info.runtimeImage,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function detect() {
  const container = inContainer();
  const nodeMajor = Number((process.versions.node || '0.0.0').split('.')[0]) || 0;
  return {
    platform: process.platform,
    arch: process.arch,
    kind: container ? 'container' : 'host',
    container,
    node: process.version,
    nodeMajor,
    runtimeImage: config.runtimeImage || '',
    workspaceDir: config.workspaceDir,
    hostWorkspaceDir: config.hostWorkspaceDir || '',
    dataDir: config.dataDir,
    pid: process.pid,
  };
}

function probeHttp(rawUrl, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(String(rawUrl)); } catch { resolve({ reachable: false, error: '地址无效' }); return; }
    const mod = u.protocol === 'https:' ? https : http;
    const started = Date.now();
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = mod.request({
      hostname: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname || '/', method: 'GET', timeout: timeoutMs,
    }, (res) => {
      res.resume();
      finish({ reachable: true, code: res.statusCode, ms: Date.now() - started });
    });
    req.on('timeout', () => { req.destroy(); finish({ reachable: false, error: '连接超时' }); });
    req.on('error', (e) => finish({ reachable: false, error: e.code || e.message }));
    req.end();
  });
}

function dockerSocket() {
  return process.env.DOCKER_SOCKET || '/var/run/docker.sock';
}

/* --------------------------- 档案与策略解析 ------------------------------ */

function customProfiles() {
  const raw = envCfg().profiles;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function listProfiles() {
  const builtin = Object.entries(BUILTIN_PROFILES).map(([id, p]) => ({
    id, name: p.name, description: p.description, builtin: true, strategies: { ...p.strategies },
  }));
  const custom = Object.entries(customProfiles()).map(([id, p]) => ({
    id, name: p.name || id, description: p.description || '自定义档案',
    builtin: false, strategies: { ...(p.strategies || {}) },
  }));
  return [...builtin, ...custom];
}

function deriveProfileId() {
  const info = detect();
  const git = gitRuntime.resolve();
  const fb = gitRuntime.fallback();
  if (info.container) return git.available ? 'container' : (fb.ready ? 'container-lite' : 'container');
  return git.available ? 'native' : (fb.ready ? 'remote' : 'native');
}

/**
 * 解析当前生效档案。auto 档案按环境能力推导，并把推导结果作为策略基线，
 * 同时保留 derived 字段让前端显示「自动适配 → 精简容器」。
 */
function profile() {
  const c = envCfg();
  const requested = String(config.envProfile || c.activeProfile || 'auto').trim() || 'auto';
  const found = listProfiles().find((p) => p.id === requested);
  const id = found ? requested : 'auto';
  const base = found || BUILTIN_PROFILES.auto;
  const derived = id === 'auto' ? deriveProfileId() : '';
  const derivedStrategies = derived ? (BUILTIN_PROFILES[derived] || {}).strategies || {} : {};
  return {
    id, name: base.name, description: base.description,
    builtin: Boolean(base.builtin), derived,
    strategies: { ...derivedStrategies, ...(base.strategies || {}) },
  };
}

/** 逐字段叠加：档案预设 < 控制台微调 < .env 部署声明，并校验枚举值。 */
function strategies() {
  const p = profile();
  const out = { ...STRATEGY_DEFAULTS, ...(p.strategies || {}) };
  const sources = {};
  for (const k of STRATEGY_KEYS) sources[k] = `档案「${p.name}」`;

  const saved = envCfg().strategies || {};
  for (const k of STRATEGY_KEYS) {
    const v = String(saved[k] === undefined ? '' : saved[k]).trim();
    if (v && ALLOWED[k].includes(v)) { out[k] = v; sources[k] = '控制台策略微调'; }
  }
  for (const k of STRATEGY_KEYS) {
    const v = String(process.env[ENV_KEYS[k]] || '').trim();
    if (v && ALLOWED[k].includes(v)) { out[k] = v; sources[k] = `.env / compose：${ENV_KEYS[k]}`; }
  }
  return { values: out, sources };
}

function autoHealEnabled() {
  return flag(config.envAutoHeal, envCfg().autoHeal !== false);
}

function envOverrides() {
  const out = {};
  for (const [key, name] of Object.entries(ENV_KEYS)) {
    if (process.env[name]) out[name] = { key, value: String(process.env[name]).trim() };
  }
  if (config.envProfile) out.DP_ENV_PROFILE = { key: 'activeProfile', value: config.envProfile };
  if (config.envAutoHeal) out.DP_AUTO_HEAL = { key: 'autoHeal', value: config.envAutoHeal };
  if (config.runtimeImage) out.DP_RUNTIME_IMAGE = { key: 'runtimeImage', value: config.runtimeImage };
  return out;
}

/** 克隆实际使用的通道。cloneRepo 每次调用都会读它，改档案无需重启。 */
function gitStrategy() {
  const applied = envCfg().applied || {};
  let s = String(applied.gitClone || '').trim();
  if (!s || s === 'auto') {
    const git = gitRuntime.resolve();
    s = git.available ? 'local' : (gitRuntime.fallback().ready ? 'ssh-host' : 'none');
  }
  if (gitRuntime.fallback().enabled === false && s === 'ssh-host') s = 'none';
  return s;
}

/* ------------------------------- 自动体检 -------------------------------- */

/**
 * @param {{deep?: boolean}} opts deep=true 会实测 SSH 宿主机（默认关闭，避免启动阶段卡顿）
 */
async function runChecks({ deep = false } = {}) {
  const info = detect();
  const fp = fingerprint();
  const c = envCfg();
  const st = strategies();
  const s = st.values;
  gitRuntime.refresh();
  // v0.3.9：容器内没有 Git 时，实测 SSH 宿主机上的 Git（带缓存；deep 强制重连）。
  // 宿主机检测到 Git 就等于「Git 可用」，不再用一句「未找到可用的 Git」让使用者误以为漏检。
  const hostGit = await gitRuntime.probeHostGit({ force: deep });
  const git = gitRuntime.describe();
  const fb = git.fallback;
  const checks = [];
  const push = (item) => checks.push({ autoAction: '', ...item });

  // 1) 运行时
  push({
    id: 'runtime', label: '运行时',
    level: info.nodeMajor >= 20 ? 'ok' : 'error',
    detail: `Node ${info.node} · ${info.platform}/${info.arch} · ${info.container ? '容器内' : '宿主机'}${info.runtimeImage ? ` · 镜像 ${info.runtimeImage}` : ''}`,
    advice: info.nodeMajor >= 20 ? '无需处理' : '请升级到 Node >= 20，或使用 remote.js 容器方式部署',
  });

  // 2) Git 可执行文件（容器内 Git 或宿主机 Git，二者有其一即视为就绪）
  const gitReady = git.available || Boolean(fb.ready && hostGit.available);
  const gitDetail = git.available
    ? `${git.version} · ${git.bin}（${git.source}）`
    : (fb.ready && hostGit.available
      ? `容器内无 Git · 宿主机 ${hostGit.host || hostGit.serverName} 实测 Git ${hostGit.version}（${hostGit.bin}）· 克隆由 SSH 宿主机执行`
      : (fb.ready
        ? `当前容器未找到 Git · 宿主机 ${fb.serverHost} 的 Git 未实测${hostGit.error ? `（${hostGit.error}）` : ''}`
        : '当前运行环境未找到可用的 Git'));
  push({
    id: 'git', label: 'Git 可执行文件',
    level: gitReady ? 'ok' : (fb.ready ? 'warn' : 'error'),
    detail: gitDetail,
    advice: git.available ? '克隆可在当前环境直接执行'
      : (fb.ready && hostGit.available
        ? `宿主机已有 Git ${hostGit.version}，无需安装；平台自动走 SSH 宿主机通道。若要求容器内直接执行，可设 DP_INSTALL_GIT=1 重新部署`
        : (fb.ready ? '点「重新体检」实测宿主机 Git；或安装 Git / 指定 GIT_BIN' : '安装 Git / 指定 GIT_BIN / 登记 SSH 宿主机并配置 HOST_WORKSPACE_DIR')),
    autoAction: git.available ? '' : (fb.ready ? '自动切换克隆通道为 ssh-host' : '尝试按授权安装 Git'),
  });

  // 3) SSH 宿主机兜底（deep 时由 probeHostGit 真连一次，验证宿主机 Git 与目录可写）
  const hostWritable = {
    checked: Boolean(deep && fb.ready && hostGit.checked && !hostGit.skipped),
    ok: Boolean(hostGit.available && hostGit.workspaceWritable),
    detail: hostGit.error || hostGit.detail || '',
  };
  push({
    id: 'fallback', label: 'SSH 宿主机兜底',
    level: !fb.ready ? (git.available ? 'info' : 'error')
      : (hostWritable.checked && !hostWritable.ok ? 'warn' : 'ok'),
    detail: fb.ready
      ? `${fb.serverName}（${fb.serverHost}）→ ${fb.hostWorkspaceDir}${hostGit.available ? ` · 宿主机 Git ${hostGit.version}（${hostGit.bin}）` : ''}${hostWritable.checked ? ` · 实测：${hostWritable.ok ? 'Git 可用 / 目录可写' : hostWritable.detail}` : ' · 点「重新体检」可实测目录可写'}`
      : (fb.reason || '未就绪'),
    advice: fb.ready ? (hostWritable.checked && !hostWritable.ok ? '检查宿主机 Git 与 HOST_WORKSPACE_DIR 挂载权限' : '无需处理')
      : '在「服务器」页登记宿主机 SSH，并在 .env 配置 HOST_WORKSPACE_DIR（与 docker run -v 一致）',
  });

  // 4) 工作区可写 + 宿主机映射
  const probeFile = path.join(info.workspaceDir, `.dp-env-probe-${process.pid}`);
  let workspaceOk = false;
  let workspaceDetail = '';
  try {
    fs.mkdirSync(info.workspaceDir, { recursive: true });
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    workspaceOk = true;
  } catch (e) { workspaceDetail = e.message; }
  push({
    id: 'workspace', label: '工作区与挂载映射',
    level: workspaceOk ? (info.container && !info.hostWorkspaceDir ? 'warn' : 'ok') : 'error',
    detail: `${info.workspaceDir}${workspaceOk ? ' 可写' : ` 不可写：${workspaceDetail}`}${info.hostWorkspaceDir ? ` · 宿主机 ${info.hostWorkspaceDir}` : ' · 未声明宿主机映射'}`,
    advice: !workspaceOk ? '检查目录权限与 docker run -v 挂载'
      : (info.container && !info.hostWorkspaceDir ? '容器内建议配置 HOST_WORKSPACE_DIR，否则构建挂载与 SSH 兜底都不可用' : '无需处理'),
  });

  // 5) Docker 能力
  const hasSocket = fs.existsSync(dockerSocket());
  const hasSshServer = (state().servers || []).length > 0;
  push({
    id: 'docker', label: 'Docker / 构建能力',
    level: hasSocket ? 'ok' : (hasSshServer ? 'warn' : 'info'),
    detail: hasSocket ? `Docker Engine socket 可用（${dockerSocket()}）`
      : `本机无 Docker socket${hasSshServer ? '，可经已登记 SSH 服务器远程构建' : ''}；当前构建后端 ${config.buildExecutor}`,
    advice: hasSocket ? '无需处理' : '如需容器隔离构建，请挂载 /var/run/docker.sock 或登记 SSH 服务器；否则使用 local / auto 后端',
    autoAction: !hasSocket && /^(docker)$/.test(String(s.buildExecutor)) ? '把构建后端自动降级为 auto' : '',
  });

  // 6) 集成服务可达性（只做轻量 TCP+HTTP 探测，1.5s 超时，不读取业务数据）
  const targets = [
    ['Gitea', config.giteaUrl], ['OpenList', config.openlistUrl], ['code-server', config.codeServerUrl],
  ];
  const probed = await Promise.all(targets.map(async ([name, url]) => ({ name, url: safeUrl(url), ...(await probeHttp(url)) })));
  const offline = probed.filter((p) => !p.reachable);
  push({
    id: 'integrations', label: '集成服务连通性',
    level: offline.length === 0 ? 'ok' : (offline.length === targets.length ? 'warn' : 'info'),
    detail: probed.map((p) => `${p.name} ${p.reachable ? `${p.code} (${p.ms}ms)` : `离线 (${p.error})`} · ${p.url}`).join('；'),
    advice: offline.length ? '离线服务请检查地址 / Token / 容器网络；平台不会注入演示数据' : '无需处理',
  });

  // 7) 策略与能力是否冲突
  const conflict = [];
  if (s.gitClone === 'local' && !git.available) conflict.push('策略要求 local，但当前环境没有 Git');
  if (s.gitClone === 'ssh-host' && !fb.ready) conflict.push('策略要求 ssh-host，但 SSH 兜底未就绪');
  if (s.gitClone === 'disabled') conflict.push('克隆功能已被策略禁用');
  push({
    id: 'strategy', label: '策略与环境匹配',
    level: conflict.length ? 'warn' : 'ok',
    detail: conflict.length ? conflict.join('；') : `档案「${profile().name}」→ 克隆 ${s.gitClone} · 构建 ${s.buildExecutor || '保持现有'} · 装 Git ${s.gitInstall}`,
    advice: conflict.length ? '点「应用自动处置」让平台自动降级，或改用 auto 档案' : '无需处理',
    autoAction: conflict.length ? '按能力自动降级通道' : '',
  });

  // 8) 环境漂移：指纹与上次记录不同 = 换了机器 / 换了部署方式
  const changed = Boolean(c.lastFingerprint && c.lastFingerprint !== fp);
  push({
    id: 'drift', label: '环境切换检测',
    level: changed ? 'warn' : (c.lastFingerprint ? 'ok' : 'info'),
    detail: changed ? `指纹 ${c.lastFingerprint} → ${fp}，判定为环境已切换，启动时已自动重检` : `当前指纹 ${fp}${c.lastFingerprint ? '（与上次一致）' : '（首次记录）'}`,
    advice: changed ? '确认上方策略符合新环境；如需固定策略，可在 .env 声明 DP_ENV_PROFILE' : '无需处理',
    autoAction: changed ? '自动重跑体检并重新应用处置' : '',
  });

  const summary = {
    total: checks.length,
    ok: checks.filter((x) => x.level === 'ok').length,
    warn: checks.filter((x) => x.level === 'warn').length,
    error: checks.filter((x) => x.level === 'error').length,
  };
  return { info, fingerprint: fp, profile: profile(), strategies: s, strategySources: st.sources, checks, summary };
}

/* ------------------------------- 自动处置 -------------------------------- */

function logAction(actions, level, action, detail) {
  actions.push({ at: new Date().toISOString(), level, action, detail });
  console.log(`[env] ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '✔'} ${action}${detail ? ` · ${detail}` : ''}`);
}

function commandExists(name) {
  try {
    const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { timeout: 3000, encoding: 'utf8' });
    return r.status === 0 && Boolean((r.stdout || '').trim());
  } catch { return false; }
}

/** 仅在策略显式允许时尝试安装；带硬超时，避免内网软件源不通时把进程挂死。 */
function tryInstallGit() {
  if (process.platform === 'win32') return { ok: false, detail: 'Windows 需手工安装 Git for Windows 或指定 GIT_BIN' };
  const pm = commandExists('apk') ? 'apk' : (commandExists('apt-get') ? 'apt-get' : '');
  if (!pm) return { ok: false, detail: '未发现 apk / apt-get，无法自动安装' };
  const cmd = pm === 'apk'
    ? 'apk add --no-cache git openssh-client'
    : 'apt-get update -qq && apt-get install -y -qq --no-install-recommends git openssh-client';
  try {
    const r = spawnSync('/bin/sh', ['-c', cmd], { timeout: 45000, encoding: 'utf8', maxBuffer: 1024 * 512 });
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-200);
    return r.status === 0
      ? { ok: true, detail: `${pm} 安装完成` }
      : { ok: false, detail: `${pm} 安装失败：${r.error ? r.error.message : text || `exit=${r.status}`}` };
  } catch (e) { return { ok: false, detail: e.message }; }
}

/**
 * 按策略执行安全动作，并把结果写入 state.environment.applied / history。
 * 不会修改凭据、不会重启容器、不会删除任何数据。
 */
async function heal({ deep = true, trigger = '手动' } = {}) {
  const c = envCfg();
  const actions = [];
  // 处置会把指纹写回 state，所以要在动手之前先判断是否刚换了环境。
  const environmentChanged = Boolean(c.lastFingerprint && c.lastFingerprint !== fingerprint());
  gitRuntime.refresh();
  let report = await runChecks({ deep });
  const s = report.strategies;
  let git = gitRuntime.resolve();
  let fb = gitRuntime.fallback();

  // ① 档案显式要求开 / 关 SSH 兜底时，同步到 gitRuntime（auto 档案不干预用户设置）
  if (s.sshFallback === 'on' && !fb.enabled) {
    gitRuntime.setFallback(true);
    logAction(actions, 'ok', '按档案开启 SSH 宿主机兜底', profile().name);
  } else if (s.sshFallback === 'off' && fb.enabled) {
    gitRuntime.setFallback(false);
    logAction(actions, 'warn', '按档案关闭 SSH 宿主机兜底', profile().name);
  }
  fb = gitRuntime.fallback();

  // ② 缺 Git 且策略显式授权联网安装（默认 never；内网机器不要开启）
  if (!git.available && s.gitInstall === 'auto') {
    const installed = tryInstallGit();
    gitRuntime.refresh();
    git = gitRuntime.resolve();
    logAction(actions, installed.ok ? 'ok' : 'warn',
      installed.ok ? '已自动安装 Git' : '自动安装 Git 未成功（改用 SSH 兜底）', installed.detail);
  } else if (!git.available) {
    logAction(actions, 'info', '跳过自动安装 Git', '策略 gitInstall=never；可在控制台显式开启');
  }

  // ③ 推导实际克隆通道：策略不可用时自动降级，绝不留下「一点克隆就报错」的组合
  let channel = s.gitClone;
  const downgrades = [];
  if (channel === 'auto') channel = git.available ? 'local' : (fb.ready ? 'ssh-host' : 'none');
  if (channel === 'local' && !git.available) {
    channel = fb.ready ? 'ssh-host' : 'none';
    downgrades.push('local → ' + channel + '（当前环境无 Git）');
  }
  if (channel === 'ssh-host' && !fb.ready) {
    channel = git.available ? 'local' : 'none';
    downgrades.push('ssh-host → ' + channel + '（SSH 兜底未就绪）');
  }
  if (channel === 'none' && git.available) channel = 'local';
  if (downgrades.length) logAction(actions, 'warn', '克隆通道自动降级', downgrades.join('；'));
  else logAction(actions, 'ok', '克隆通道已确定', `${channel}（档案 ${profile().name}）`);

  // ④ 构建后端：策略指定的后端不可用时降级为 auto，不做破坏性改动
  let executor = String(s.buildExecutor || '').trim();
  if (executor === 'docker' && !fs.existsSync(dockerSocket())) {
    logAction(actions, 'warn', '构建后端自动降级', 'docker → auto（本机无 Docker socket）');
    executor = 'auto';
  }
  if (executor === 'ssh' && !(state().servers || []).length) {
    logAction(actions, 'warn', '构建后端自动降级', 'ssh → auto（未登记 SSH 服务器）');
    executor = 'auto';
  }
  if (executor && executor !== config.buildExecutor) {
    const before = config.buildExecutor;
    config.buildExecutor = executor;
    logAction(actions, 'ok', '构建后端已按档案调整', `${before} → ${executor}`);
  }

  // ⑤ 重新取一次体检结果（前面的动作可能改变了 Git / 兜底状态）
  report = await runChecks({ deep });
  const applied = { gitClone: channel, buildExecutor: executor, gitAvailable: git.available, at: new Date().toISOString() };
  update((st) => {
    if (!st.environment) st.environment = {};
    const e = st.environment;
    e.applied = applied;
    e.lastFingerprint = report.fingerprint;
    e.lastCheckAt = applied.at;
    e.lastProfile = profile().id;
    e.history = [...(Array.isArray(e.history) ? e.history : []),
      { at: applied.at, level: 'info', action: `触发${trigger}体检`, detail: `档案 ${profile().name} · 通道 ${channel}` },
      ...actions.map((a) => ({ ...a }))].slice(-40);
  });
  return { ...report, applied, actions, trigger, healed: true, environmentChanged };
}

/* ------------------------------ 对外报告 / 配置 --------------------------- */

let cache = null;
let cacheAt = 0;

async function report({ deep = false, force = false, maxAgeMs = 30000 } = {}) {
  if (!force && !deep && cache && Date.now() - cacheAt < maxAgeMs) return { ...cache, cached: true };
  const base = await runChecks({ deep });
  const c = envCfg();
  const out = {
    ...base,
    checkedAt: new Date().toISOString(),
    cached: false,
    environmentChanged: Boolean(c.lastFingerprint && c.lastFingerprint !== base.fingerprint),
    config: {
      activeProfile: c.activeProfile || 'auto',
      autoHeal: flag(config.envAutoHeal, c.autoHeal !== false),
      checkOnStartup: flag(config.envCheckOnStartup, c.checkOnStartup !== false),
      strategies: { ...(c.strategies || {}) },
      envOverrides: envOverrides(),
      lastFingerprint: c.lastFingerprint || '',
      lastCheckAt: c.lastCheckAt || '',
    },
    applied: { ...(c.applied || {}) },
    profiles: listProfiles(),
    history: [...(Array.isArray(c.history) ? c.history : [])].slice(-20).reverse(),
    options: { gitClone: ALLOWED.gitClone, buildExecutor: ALLOWED.buildExecutor, gitInstall: ALLOWED.gitInstall, sshFallback: ALLOWED.sshFallback },
    labels: STRATEGY_LABELS,
  };
  if (!force && !deep) { cache = out; cacheAt = Date.now(); }
  return out;
}

function setConfig(body = {}) {
  const raw = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
  const profilesList = listProfiles().map((p) => p.id);
  update((st) => {
    if (!st.environment) st.environment = {};
    const e = st.environment;
    if (has('activeProfile')) {
      const v = String(raw.activeProfile || 'auto').trim();
      if (!profilesList.includes(v)) throw new Error(`未知环境档案：${v}`);
      e.activeProfile = v;
    }
    if (has('autoHeal')) e.autoHeal = raw.autoHeal !== false && raw.autoHeal !== 'off';
    if (has('checkOnStartup')) e.checkOnStartup = raw.checkOnStartup !== false && raw.checkOnStartup !== 'off';
    if (has('strategies') && raw.strategies && typeof raw.strategies === 'object') {
      const next = { ...(e.strategies || {}) };
      for (const k of STRATEGY_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw.strategies, k)) continue;
        const v = String(raw.strategies[k] || '').trim();
        if (!ALLOWED[k].includes(v)) throw new Error(`${STRATEGY_LABELS[k]} 取值不合法：${v}`);
        next[k] = v; // 空串 = 跟随档案
      }
      e.strategies = next;
    }
  });
  cache = null;
  return envCfg();
}

async function switchProfile(id, { trigger = '切换档案' } = {}) {
  setConfig({ activeProfile: id });
  return heal({ deep: true, trigger });
}

function saveProfile(body = {}) {
  const id = String(body.id || '').trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
  if (!id) throw new Error('档案 id 不能为空');
  if (BUILTIN_PROFILES[id]) throw new Error('内置档案不可覆盖');
  const name = String(body.name || id).trim().slice(0, 60);
  const chosen = {};
  for (const k of STRATEGY_KEYS) {
    const v = String((body.strategies || {})[k] || '').trim();
    if (!ALLOWED[k].includes(v)) throw new Error(`${STRATEGY_LABELS[k]} 取值不合法：${v}`);
    chosen[k] = v;
  }
  update((st) => {
    if (!st.environment) st.environment = {};
    if (!st.environment.profiles) st.environment.profiles = {};
    st.environment.profiles[id] = {
      name, description: String(body.description || '自定义档案').slice(0, 160), strategies: chosen,
    };
  });
  cache = null;
  return listProfiles();
}

function deleteProfile(id) {
  if (BUILTIN_PROFILES[id]) throw new Error('内置档案不可删除');
  update((st) => {
    if (!st.environment) st.environment = {};
    const profiles = st.environment.profiles || {};
    delete profiles[id];
    st.environment.profiles = profiles;
    if (st.environment.activeProfile === id) st.environment.activeProfile = 'auto';
  });
  cache = null;
  return listProfiles();
}

/** 启动时调用：指纹变化或首次启动即自动体检 + 自动处置，不阻塞监听。 */
async function boot() {
  const c = envCfg();
  const enabled = flag(config.envCheckOnStartup, c.checkOnStartup !== false);
  const autoHeal = autoHealEnabled();
  const changed = Boolean(c.lastFingerprint && c.lastFingerprint !== fingerprint());
  if (!enabled) {
    console.log('[env] 启动体检已关闭（DP_ENV_CHECK_ON_STARTUP=0）');
    return { skipped: true, environmentChanged: changed };
  }
  try {
    if (autoHeal || changed) {
      const r = await heal({ deep: false, trigger: changed ? '环境切换' : '启动' });
      console.log(`[env] 环境 ${r.info.kind}${r.info.runtimeImage ? ` (${r.info.runtimeImage})` : ''} · 档案 ${r.profile.name}${r.profile.derived ? ` → ${r.profile.derived}` : ''} · 通道 ${r.applied.gitClone} · 体检 ${r.summary.ok} ok / ${r.summary.warn} warn / ${r.summary.error} error${changed ? ' · 已检测到环境切换' : ''}`);
      return r;
    }
    const r = await report({ force: true });
    console.log(`[env] 启动体检完成 · 通道 ${gitStrategy()} · 自动处置已关闭`);
    return r;
  } catch (e) {
    console.log(`[env] 启动体检失败（不影响平台启动）：${e.message}`);
    return { error: e.message };
  }
}

module.exports = {
  BUILTIN_PROFILES, ALLOWED, STRATEGY_LABELS,
  detect, fingerprint, profile, listProfiles, strategies, gitStrategy, autoHealEnabled,
  runChecks, report, heal, boot, setConfig, switchProfile, saveProfile, deleteProfile,
};
