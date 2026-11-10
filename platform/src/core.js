'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 源码直跑时 __dirname 指向 platform/src，根目录即 platform/；
// 编译成单文件程序后由引导器注入 DP_ROOT（exe 所在目录），bundle.cjs / public / data 都放那里。
// 不设置 DP_ROOT 时行为与原来完全一致，线上容器不受影响。
const ROOT = process.env.DP_ROOT ? path.resolve(process.env.DP_ROOT) : path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(ROOT, 'public');

const env = (key, fallback = '') =>
  process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key];

const config = {
  port: Number(env('PORT', '9000')),
  publicDir: PUBLIC_DIR,
  dataDir: DATA_DIR,
  adminToken: env('ADMIN_TOKEN'),
  // 默认值必须是「本机 / 源码直跑 / 单文件 exe」可解析的地址。
  // Docker compose 会显式注入 gitea:3000 / openlist:5244 等容器服务名覆盖这里；
  // 远程部署的容器则由 .env 显式注入宿主机地址，两种场景都不受影响。
  giteaUrl: env('GITEA_URL', 'http://localhost:3002').replace(/\/+$/, ''),
  giteaToken: env('GITEA_TOKEN'),
  codeServerUrl: env('CODE_SERVER_URL', 'http://localhost:8080').replace(/\/+$/, ''),
  openlistUrl: env('OPENLIST_URL', 'http://localhost:5244').replace(/\/+$/, ''),
  openlistToken: env('OPENLIST_TOKEN'),
  openlistUser: env('OPENLIST_USER', 'admin'),
  openlistPassword: env('OPENLIST_PASSWORD'),
  workspaceDir: env('WORKSPACE_DIR', path.join(ROOT, 'workspace')),
  // 容器化构建：平台自身跑在容器里时，docker.sock 属于宿主机，
  // 必须把容器内 /workspace/... 映射成宿主机上的真实路径，否则挂载的是空目录。
  hostWorkspaceDir: env('HOST_WORKSPACE_DIR'),
  // 语言镜像的加速器前缀，例如 docker.m.daocloud.io/library/（注意结尾斜杠）。
  dockerImagePrefix: env('DOCKER_IMAGE_PREFIX'),
  buildTimeoutMs: Number(env('BUILD_TIMEOUT_MS', '900000')),
  // 扩展（MySQL / PgSQL / Redis 等）容器对外绑定地址与连接串里使用的主机名。
  // 平台本体跑在容器里时，容器内的 127.0.0.1 不是宿主机，需由 compose 注入宿主机 IP。
  extBindIp: env('DP_EXT_BIND_IP', '127.0.0.1'),
  extHost: env('DP_EXT_HOST', '127.0.0.1'),
  // 构建后端：local / docker / wsl / ssh / auto（按可用性自动降级，见 buildBackends.js）。
  buildExecutor: env('BUILD_EXECUTOR', 'local'),
  // WSL 发行版名（仅 win32 + wsl 后端使用）；留空则由 wsl.exe 使用默认发行版。
  wslDistro: env('DP_WSL_DISTRO'),
  // 远程构建时优先使用的服务器 id；留空则取第一台可用的 Linux 服务器。
  buildServerId: env('DP_BUILD_SERVER_ID'),
  // 远程 docker 数据的暂存目录（镜像 tar、备份文件）。
  remoteTmpDir: env('DP_REMOTE_TMP_DIR', '/tmp/devplatform'),
};

function defaultState() {
  return {
    servers: [],
    aiProviders: [],
    builds: [],
    deploys: [],
    extensions: [],
    gitSources: [],
    backups: [],
    composeTemplates: [],
  };
}

let _state = null;

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function state() {
  if (!_state) _state = loadState();
  return _state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  // state.json 内含服务器口令 / 私钥 / API Key，强制仅所有者可读写。
  fs.writeFileSync(tmp, JSON.stringify(state(), null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
  try { fs.chmodSync(STATE_FILE, 0o600); } catch { /* Windows 权限模型不支持，忽略 */ }
  // 注意：不把 DATA_DIR 改成 700。Gitea(uid 1000) / code-server 的数据目录挂在它下面，
  // 700 会让这些容器无法穿透；凭据由 state.json 的 600 权限单独保护。
}

function update(mutator) {
  const result = mutator(state());
  save();
  return result;
}

const uid = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// 简易 Bearer 鉴权。未设置 ADMIN_TOKEN 时仅建议本机使用。
function auth(req, res, next) {
  if (!config.adminToken) return next();
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${config.adminToken}`) {
    return res.status(401).json({ ok: false, error: '未授权：需要 Bearer ADMIN_TOKEN' });
  }
  next();
}

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, error, code = 500) =>
  res.status(code).json({ ok: false, error: String((error && error.message) || error) });

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => fail(res, e));

// 所有涉及构建/文件的路径都必须落在工作区内，防止目录穿越。
function safeWorkspacePath(relative = '') {
  const base = path.resolve(config.workspaceDir);
  const target = path.resolve(base, relative || '');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径越界：只能操作工作区内的目录');
  }
  return target;
}

function relativeWorkspacePath(abs) {
  return path.relative(path.resolve(config.workspaceDir), path.resolve(abs)).split(path.sep).join('/');
}

// 正常模式：外部服务未配置 / 不可达时直接返回真实错误，不注入任何演示数据。
module.exports = {
  config, state, save, update, uid, auth, ok, fail, wrap, appRoot: ROOT,
  safeWorkspacePath, relativeWorkspacePath, defaultState,
};
