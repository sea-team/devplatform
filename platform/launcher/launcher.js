'use strict';
// DevPlatform 引导器：编译进 devplatform.exe，只用 Node 内置模块。
//   devplatform.exe                 启动（监督进程 + 业务 worker）
//   devplatform.exe --dev           开发模式：源码变更自动重建 + 热重载
//   devplatform.exe --worker        内部使用：加载外置 bundle.cjs
//   devplatform.exe version         查看版本
//   devplatform.exe reload          平滑重启正在运行的业务
//   devplatform.exe update <source> 从目录或 URL 应用更新
//   devplatform.exe rollback        回滚到上一版本
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { fork, spawn } = require('child_process');
const { createRequire } = require('module');

let isSea = false;
let sea = null;
try { sea = require('node:sea'); isSea = sea.isSea(); } catch { isSea = false; }

const REPO_ROOT = path.resolve(__dirname, '..');
// SEA 模式：exe 所在目录就是运行时根；源码模式：platform/dist。
const DIST = isSea ? path.dirname(process.execPath) : path.join(REPO_ROOT, 'dist');
const BUNDLE = path.join(DIST, 'bundle.cjs');
const RELEASE = path.join(DIST, 'release.json');
const PUBLIC_DIR = path.join(DIST, 'public');
const DATA_DIR = path.join(DIST, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'build.mjs');
const SEA_PUBLIC_ASSET = 'public.tar.gz';
// 单独从 GitHub Release 下载 exe 时目录里没有任何外置文件，首启从 SEA asset 释放。
// 仅当目标文件不存在时写入，绝不覆盖热更新过的 bundle / release.json。
const SEA_FILE_ASSETS = { 'bundle.cjs': BUNDLE, 'release.json': RELEASE };
const DEFAULT_ENV = [
  '# DevPlatform 单文件程序配置（首启自动生成；更新/回滚不会覆盖）',
  '# 默认指向本机端口，集成服务需自行启动；改完必须完全重启 devplatform.exe。',
  '# 复用已部署服务器：在控制台登记服务器，或手工改成 http://<IP>:3002 等。',
  'PORT=9000',
  'GITEA_URL=http://localhost:3002',
  'GITEA_TOKEN=',
  'OPENLIST_URL=http://localhost:5244',
  'OPENLIST_TOKEN=',
  'OPENLIST_USER=admin',
  'OPENLIST_PASSWORD=',
  'CODE_SERVER_URL=http://localhost:8080',
  '# 分层代理也可以在控制台「代理配置」页设置；这里仅是首次启动默认值（§27）。',
  '# DP_PROXY_GLOBAL=http://127.0.0.1:7890',
  '# DP_PROXY_GIT=http://127.0.0.1:7890',
  '# DP_PROXY_DOCKER=http://127.0.0.1:7890',
  '# DP_PROXY_SERVER=http://127.0.0.1:7890',
  '# DP_PROXY_AI=http://127.0.0.1:7890',
  '# DP_PROXY_NO=localhost,127.0.0.1,::1,10.0.0.0/8',
  '# DP_PROXY_GIT_RULES=github.com=http://127.0.0.1:7890;gitlab.internal=direct',
  '# ADMIN_TOKEN=',
].join('\n') + '\n';

const log = (...a) => console.log('[launcher]', ...a);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ------------------------------ 基础工具 ------------------------------ */

function loadDotEnv() {
  const file = path.join(DIST, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || raw.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function readRelease() {
  try { return JSON.parse(fs.readFileSync(RELEASE, 'utf8')); }
  catch { return { version: '0.0.0', buildTime: null, bundle: null, public: [] }; }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

function untar(buf, dest) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (!h.some((b) => b !== 0)) break;
    const name = h.subarray(0, 100).toString('utf8').split('\0')[0];
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim() || '0', 8) || 0;
    const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    off += 512;
    const safe = name && !name.includes('..') && !path.isAbsolute(name);
    if (safe) {
      const target = path.join(dest, name);
      if (type === '5') fs.mkdirSync(target, { recursive: true });
      else if (type === '0') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf.subarray(off, off + size));
      }
    }
    off += Math.ceil(size / 512) * 512;
  }
}

// 首次启动时从 exe 内嵌资源释放前端目录；已存在则保留，避免覆盖热更新过的文件。
function ensurePublic() {
  if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) return;
  let buf = null;
  if (isSea) {
    try { buf = Buffer.from(sea.getAsset(SEA_PUBLIC_ASSET)); } catch { /* noop */ }
  }
  if (!buf) {
    console.warn('[launcher] 未找到 public/，也没有内嵌资源；请执行 npm run build');
    return;
  }
  untar(zlib.gunzipSync(buf), PUBLIC_DIR);
  log('首次启动：已释放前端资源到', PUBLIC_DIR);
}

// 把内嵌的业务包 / 版本清单 / 默认配置补到 exe 所在目录。
// 只在 SEA 模式生效；任一文件已存在就跳过，保证热更新与用户配置优先。
function ensureAssets() {
  if (!isSea) return;
  for (const [asset, target] of Object.entries(SEA_FILE_ASSETS)) {
    if (fs.existsSync(target)) continue;
    try {
      fs.writeFileSync(target, Buffer.from(sea.getAsset(asset)));
      log('首次启动：已释放内嵌资源', asset);
    } catch (error) {
      console.warn(`[launcher] 无法释放 ${asset}：${error.message}`);
    }
  }
  const envFile = path.join(DIST, '.env');
  if (!fs.existsSync(envFile)) {
    try {
      fs.writeFileSync(envFile, DEFAULT_ENV, { encoding: 'utf8', mode: 0o600 });
      log('首次启动：已生成 .env 配置模板', envFile);
    } catch (error) {
      console.warn(`[launcher] 无法生成 .env：${error.message}`);
    }
  }
  ensurePublic();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function resolveSource(input) {
  const source = input || process.env.DP_UPDATE_URL || '';
  if (!source) throw new Error('未指定更新源：使用 update <目录|release.json URL> 或设置 DP_UPDATE_URL');
  if (/^https?:\/\//i.test(source)) {
    return { kind: 'url', base: new URL('.', source), manifestUrl: source };
  }
  const abs = path.resolve(source);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return { kind: 'dir', base: abs, manifestUrl: path.join(abs, 'release.json') };
  }
  if (fs.existsSync(abs) && abs.endsWith('.json')) {
    return { kind: 'dir', base: path.dirname(abs), manifestUrl: abs };
  }
  throw new Error(`更新源不存在或格式不支持：${source}`);
}

async function loadManifest(source) {
  const { kind, base, manifestUrl } = resolveSource(source);
  let manifest;
  try {
    manifest = kind === 'dir'
      ? JSON.parse(fs.readFileSync(manifestUrl, 'utf8'))
      : JSON.parse((await fetchBuffer(manifestUrl)).toString('utf8'));
  } catch (error) {
    throw new Error(`读取 release.json 失败：${error.message}`);
  }
  if (!manifest || !manifest.version || !manifest.bundle) throw new Error('release.json 格式不正确');
  return { kind, base, manifest };
}

async function fetchPart(kind, base, rel, expect) {
  const buf = kind === 'dir'
    ? fs.readFileSync(path.join(base, rel))
    : await fetchBuffer(new URL(rel, base).toString());
  if (expect && expect.sha256 && sha256(buf) !== expect.sha256) {
    throw new Error(`校验失败：${rel} 的 sha256 与 release.json 不一致`);
  }
  return buf;
}

/* ------------------------------ 更新与回滚 ------------------------------ */

async function checkUpdate(source) {
  const { manifest } = await loadManifest(source);
  const current = readRelease();
  return {
    current: current.version,
    latest: manifest.version,
    available: manifest.version !== current.version,
    buildTime: manifest.buildTime || null,
    files: (manifest.public || []).length + 1,
  };
}

async function applyUpdate(source, { force = false } = {}) {
  const { kind, base, manifest } = await loadManifest(source);
  const current = readRelease();
  if (!force && manifest.version === current.version) {
    return { updated: false, version: current.version, reason: '已是最新版本' };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const stamp = `${Date.now()}-${String(manifest.version).replace(/[^\w.-]/g, '_')}`;
  const staging = path.join(DATA_DIR, '.staging', stamp);
  const stagePublic = path.join(staging, 'public');
  fs.mkdirSync(stagePublic, { recursive: true });

  try {
    const bundleBuf = await fetchPart(kind, base, 'bundle.cjs', manifest.bundle);
    fs.writeFileSync(path.join(staging, 'bundle.cjs'), bundleBuf);
    for (const item of manifest.public || []) {
      const buf = await fetchPart(kind, base, `public/${item.path}`, item);
      const target = path.join(stagePublic, item.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf);
    }

    // 先备份当前版本，data/ 下的 state.json 与 .env 永不参与替换。
    const backup = path.join(BACKUP_DIR, `${stamp}-from-${String(current.version).replace(/[^\w.-]/g, '_')}`);
    fs.mkdirSync(backup, { recursive: true });
    if (fs.existsSync(BUNDLE)) fs.copyFileSync(BUNDLE, path.join(backup, 'bundle.cjs'));
    if (fs.existsSync(PUBLIC_DIR)) copyDir(PUBLIC_DIR, path.join(backup, 'public'));
    if (fs.existsSync(RELEASE)) fs.copyFileSync(RELEASE, path.join(backup, 'release.json'));

    const newBundle = `${BUNDLE}.new`;
    fs.writeFileSync(newBundle, bundleBuf);
    fs.renameSync(newBundle, BUNDLE);
    if (fs.existsSync(PUBLIC_DIR)) fs.renameSync(PUBLIC_DIR, path.join(backup, 'public.old'));
    fs.renameSync(stagePublic, PUBLIC_DIR);
    fs.writeFileSync(RELEASE, JSON.stringify(manifest, null, 2));
    removeDir(staging);
    removeDir(path.join(backup, 'public.old'));

    log(`已更新 ${current.version} → ${manifest.version}，备份：${backup}`);
    return {
      updated: true, from: current.version, version: manifest.version,
      files: (manifest.public || []).length + 1, backup: path.basename(backup),
    };
  } catch (error) {
    removeDir(staging);
    throw error;
  }
}

function rollback() {
  if (!fs.existsSync(BACKUP_DIR)) throw new Error('没有可回滚的备份');
  const list = fs.readdirSync(BACKUP_DIR).filter((n) => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory()).sort();
  if (!list.length) throw new Error('没有可回滚的备份');
  const backup = path.join(BACKUP_DIR, list[list.length - 1]);
  const bundle = path.join(backup, 'bundle.cjs');
  const pub = path.join(backup, 'public');
  if (fs.existsSync(bundle)) fs.copyFileSync(bundle, BUNDLE);
  if (fs.existsSync(pub)) {
    removeDir(PUBLIC_DIR);
    copyDir(pub, PUBLIC_DIR);
  }
  if (fs.existsSync(path.join(backup, 'release.json'))) {
    fs.copyFileSync(path.join(backup, 'release.json'), RELEASE);
  }
  const version = readRelease().version;
  log('已回滚到备份', list[list.length - 1], `v${version}`);
  return { restored: list[list.length - 1], version };
}

/* ------------------------------ 监督进程 ------------------------------ */

function systemInfo() {
  const release = readRelease();
  return {
    version: release.version,
    buildTime: release.buildTime || null,
    runtime: isSea ? 'binary' : 'source',
    node: process.version,
    appRoot: DIST,
    bundle: fs.existsSync(BUNDLE) ? { size: fs.statSync(BUNDLE).size } : null,
    updateUrl: process.env.DP_UPDATE_URL || '',
    backups: fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((n) => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory()).length
      : 0,
  };
}

function startSupervisor({ dev = false } = {}) {
  loadDotEnv();
  ensurePublic();
  if (!fs.existsSync(BUNDLE)) {
    console.error('[launcher] 缺少 bundle.cjs，请先执行 npm run build');
    process.exit(1);
  }

  let child = null;
  let stopping = false;
  let reloading = false;
  // SEA 可执行文件的 process.argv 布局与普通 Node 脚本不同，
  // 用环境变量而不是命令行参数区分 worker，避免子进程误判后递归启动自己。
  const env = { ...process.env, DP_ROOT: DIST, DP_LAUNCHER: '1', DP_WORKER: '1' };
  const modulePath = isSea ? process.execPath : path.join(__dirname, 'launcher.js');
  const argv = isSea ? [] : ['--worker'];

  function spawnWorker() {
    const c = fork(modulePath, argv, {
      cwd: DIST, env, execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child = c;
    c.on('message', (msg) => onMessage(msg, c));
    c.on('exit', (code) => {
      if (stopping || reloading) return;
      console.warn(`[launcher] worker 意外退出 (${code})，2s 后自动重启`);
      setTimeout(spawnWorker, 2000);
    });
  }

  function doReload() {
    if (reloading) return;
    if (!child) return spawnWorker();
    reloading = true;
    const old = child;
    child = null;
    old.removeAllListeners('exit');
    log('正在平滑重启业务进程…');
    old.once('exit', () => { reloading = false; if (!stopping) spawnWorker(); });
    old.kill('SIGTERM');
    const timer = setTimeout(() => { try { old.kill('SIGKILL'); } catch { /* noop */ } }, 4000);
    timer.unref?.();
  }

  async function onMessage(msg, sender) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'reload') { doReload(); return; }
    if (!msg.id) return;
    try {
      let data;
      switch (msg.type) {
        case 'version': data = systemInfo(); break;
        case 'update-check': data = await checkUpdate(msg.source); break;
        case 'update-apply':
          data = await applyUpdate(msg.source, { force: Boolean(msg.force) });
          if (data.updated) setTimeout(doReload, 800);
          break;
        case 'rollback': data = rollback(); setTimeout(doReload, 800); break;
        default: throw new Error(`未知命令：${msg.type}`);
      }
      if (!sender.killed) sender.send({ id: msg.id, ok: true, data });
    } catch (error) {
      if (!sender.killed) sender.send({ id: msg.id, ok: false, error: String(error.message || error) });
    }
  }

  log(`DevPlatform v${readRelease().version} · ${isSea ? '单文件程序' : '源码引导器'} · 根目录 ${DIST}`);
  log(`业务入口 ${BUNDLE}`);
  if (dev) log('开发模式：监听 src/ 与 public/，变更自动重建并热重载');
  spawnWorker();

  if (dev) {
    if (!fs.existsSync(BUILD_SCRIPT)) {
      console.warn('[launcher] 开发模式需要在源码仓库运行（缺少 build.mjs），已降级为普通模式');
    } else {
      let timer = null;
      let busy = false;
      const watchDirs = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'public')];
      const trigger = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (busy) return trigger();
          busy = true;
          log('检测到源码变更，重建 bundle.cjs …');
          const p = spawn(process.execPath, [BUILD_SCRIPT, '--bundle-only'], { cwd: REPO_ROOT, stdio: 'inherit' });
          p.on('exit', (code) => {
            busy = false;
            if (code === 0) doReload();
            else console.error('[launcher] 重建失败，保留当前版本');
          });
        }, 400);
      };
      for (const dir of watchDirs) {
        if (!fs.existsSync(dir)) continue;
        try { fs.watch(dir, { recursive: true }, trigger); } catch { /* 某些平台不支持递归监听 */ }
      }
    }
  }

  const shutdown = () => {
    stopping = true;
    if (child) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1200).unref?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function runWorker() {
  loadDotEnv();
  process.env.DP_ROOT = DIST;
  ensurePublic();
  if (!fs.existsSync(BUNDLE)) {
    console.error('[launcher] 缺少 bundle.cjs，请先执行 npm run build');
    process.exit(1);
  }
  // SEA 中 require 只能加载快照内模块，外置业务包需要 createRequire。
  const externalRequire = createRequire(path.join(DIST, 'runtime.cjs'));
  externalRequire(BUNDLE);
}

async function httpCommand(action, body = {}) {
  const port = process.env.PORT || '9000';
  const token = process.env.ADMIN_TOKEN || '';
  const res = await fetch(`http://127.0.0.1:${port}${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload.data || payload;
}

async function main() {
  // SEA 模式且目录为空（从 Release 单独下载 exe）时，一次性补齐运行所需文件。
  ensureAssets();
  // 优先用环境变量判定：SEA 模式下 argv 会被运行时改写，命令行标记不可靠。
  if (process.env.DP_WORKER === '1') { runWorker(); return; }
  // 熔断：被引导器启动却没拿到 worker 标记，直接退出，防止无限递归 fork。
  if (process.env.DP_LAUNCHER === '1') {
    console.error('[launcher] 子进程缺少 worker 标记，已拒绝递归启动');
    process.exit(1);
  }
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case '--worker': runWorker(); break;
    case '--dev': startSupervisor({ dev: true }); break;
    case 'version': {
      loadDotEnv();
      console.log(JSON.stringify(systemInfo(), null, 2));
      break;
    }
    case 'reload': {
      loadDotEnv();
      const data = await httpCommand('/api/system/reload');
      console.log('已触发重载：', JSON.stringify(data));
      break;
    }
    case 'update': {
      loadDotEnv();
      const result = await applyUpdate(rest[0], { force: rest.includes('--force') });
      console.log(JSON.stringify(result, null, 2));
      try { console.log('重载结果：', JSON.stringify(await httpCommand('/api/system/reload'))); }
      catch { console.log('服务未运行，下次启动即使用新版本'); }
      break;
    }
    case 'rollback': {
      loadDotEnv();
      const result = rollback();
      console.log(JSON.stringify(result, null, 2));
      try { await httpCommand('/api/system/reload'); } catch { /* 服务未运行 */ }
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log([
        'DevPlatform 单文件程序',
        '  devplatform.exe                 启动控制台（默认 http://localhost:9000）',
        '                                  单文件自包含：首启自动释放业务包/前端/.env，可直接从 Release 下载使用',
        '  devplatform.exe --dev           开发模式：源码变更自动重建 + 热重载',
        '  devplatform.exe version         查看版本与运行信息',
        '  devplatform.exe reload          平滑重启业务进程（不中断配置）',
        '  devplatform.exe update <source> 应用更新（目录 / release.json URL）',
        '  devplatform.exe rollback        回滚到最近一次备份',
        '',
        '  环境变量：DP_UPDATE_URL 默认更新源、PORT、ADMIN_TOKEN；也可放 dist/.env',
      ].join('\n'));
      break;
    default: startSupervisor(); break;
  }
}

main().catch((error) => {
  console.error('[launcher] 失败：', error.message || error);
  process.exit(1);
});
