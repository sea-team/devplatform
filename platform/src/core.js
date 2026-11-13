'use strict';

const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
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
  // 账号体系：.env 里的机器令牌仍作为管理员应急通道。
  adminToken: env('ADMIN_TOKEN'),
  // 默认值必须是「本机 / 源码直跑 / 单文件 exe」可解析的地址。
  // Docker compose 会显式注入 gitea:3000 / openlist:5244 等容器服务名覆盖这里；
  // 远程部署的容器则由 .env 显式注入宿主机地址，两种场景都不受影响。
  giteaUrl: env('GITEA_URL', 'http://localhost:3002').replace(/\/+$/, ''),
  giteaToken: env('GITEA_TOKEN'),
  codeServerUrl: env('CODE_SERVER_URL', 'http://localhost:8080').replace(/\/+$/, ''),
  // v0.3.10：code-server 登录页提示的 $PASSWORD 就来自这个值（容器部署由 .env 注入）。
  // 平台自身不启动 code-server，但要在控制台把「密码是什么、去哪改」讲清楚。
  codeServerPassword: env('CODE_SERVER_PASSWORD'),
  openlistUrl: env('OPENLIST_URL', 'http://localhost:5244').replace(/\/+$/, ''),
  openlistToken: env('OPENLIST_TOKEN'),
  openlistUser: env('OPENLIST_USER', 'admin'),
  openlistPassword: env('OPENLIST_PASSWORD'),
  workspaceDir: env('WORKSPACE_DIR', path.join(ROOT, 'workspace')),
  // Git 可执行文件：容器镜像 / Windows 单文件 exe 未把 git 放进 PATH 时，可显式指定。
  // 优先级低于控制台「Git 运行时」里保存的路径（见 src/gitRuntime.js）。
  gitBin: env('GIT_BIN'),
  // 容器内无 Git 时，借哪台已登记的 SSH 宿主机执行 clone；留空则自动挑选。
  gitFallbackServerId: env('DP_GIT_FALLBACK_SERVER_ID'),
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
  // v0.3.4 环境适配：这些是「部署时声明的环境事实」，优先级高于控制台保存的策略，
  // 换一台机器 / 换一种部署方式时只要改 .env 就能覆盖旧环境遗留的配置。
  envProfile: env('DP_ENV_PROFILE'),
  envAutoHeal: env('DP_AUTO_HEAL'),
  envGitCloneStrategy: env('DP_GIT_CLONE_STRATEGY'),
  envGitInstall: env('DP_GIT_INSTALL'),
  envCheckOnStartup: env('DP_ENV_CHECK_ON_STARTUP'),
  runtimeImage: env('DP_RUNTIME_IMAGE'),
  runtimeKind: env('DP_RUNTIME_KIND'),
  // v0.3.8 · TLS 校验开关：外部 Git 源证书过期 / 自签时允许按源或按域名显式忽略。
  // 默认严格校验，只有显式开启才跳过；DP_TLS_INSECURE_HOSTS 可把影响面限定到指定主机。
  tlsInsecure: /^(1|true|yes|on)$/i.test(env('DP_TLS_INSECURE')),
  tlsInsecureHosts: env('DP_TLS_INSECURE_HOSTS'),
  // .env 文件位置：容器部署时由 remote.js 把宿主机 .env 挂到 /app/.env 并注入该变量。
  envFile: env('DP_ENV_FILE'),
};

/**
 * 定位 .env（v0.3.8）。三种运行形态的「根」不一样，按候选顺序找第一个真实存在的文件：
 *   1) DP_ENV_FILE 显式指定（容器部署由 remote.js 注入，最可靠）；
 *   2) ROOT/.env —— Windows 单文件 exe（DP_ROOT=exe 所在目录）、容器（ROOT=/app）；
 *   3) ROOT/../.env —— 源码直跑（ROOT=platform/，.env 在仓库根）；
 *   4) cwd/.env —— 兜底。
 * 都不存在时返回首选路径，供「环境配置」页创建新文件。
 */
function envFileCandidates() {
  const list = [];
  if (process.env.DP_ENV_FILE) list.push(path.resolve(process.env.DP_ENV_FILE));
  list.push(path.join(ROOT, '.env'));
  list.push(path.resolve(ROOT, '..', '.env'));
  list.push(path.resolve(process.cwd(), '.env'));
  return [...new Set(list)];
}

function resolveEnvFile() {
  const list = envFileCandidates();
  for (const p of list) {
    try { if (fs.statSync(p).isFile()) return p; } catch { /* 继续找下一个 */ }
  }
  return list[0];
}

function defaultState() {
  return {
    // 账号体系（v0.4.0）：首次启动由 auth.initialize() 创建初始管理员并迁移历史资源归属。
    users: [],
    sessions: [],
    // AI 运维对话会话（v0.4.3）：按 ownerId 隔离，独立于登录会话 sessions。
    aiSessions: [],
    servers: [],
    aiProviders: [],
    builds: [],
    deploys: [],
    extensions: [],
    gitSources: [],
    // v0.4.4 仓库「平台侧管理」：聚合列表来自外部 Git 源，平台只保存展示信息与移除标记，
    // 不改动远端仓库。key 为仓库 id（可能含 / 与 :，故用对象字典而非数组）。
    repoMeta: {},
    hiddenRepos: [],
    // Git 运行时：手工指定 git 路径 + 是否允许「容器内无 Git 时借 SSH 宿主机执行」。
    git: { bin: '', sshFallback: 'auto' },
    backups: [],
    composeTemplates: [],
    // 分层代理：全局 / 分组 / Git Host 规则 / 单项覆盖（见 src/proxy.js）
    proxy: { global: {}, groups: {}, rules: [], overrides: {} },
    // 运行时 OpenList 连接配置（旧版单连接，界面可覆盖 .env；凭据只存 state.json）
    openlist: null,
    // v0.3.2：多 OpenList 连接。每个连接独立 url/user/token/password，
    // openlistActiveId 指向当前生效项；切换时由 openlist.applyConfig() 写回运行时 config。
    openlistConnections: [],
    openlistActiveId: '',
    // v0.3.4 环境适配中心：档案、策略微调、自动处置结果与历史。
    // 默认全部留空 = 完全自动推导，换环境时不会被旧配置锁死。
    environment: {
      activeProfile: 'auto', autoHeal: true, checkOnStartup: true,
      strategies: {}, profiles: {}, applied: {},
      lastFingerprint: '', lastCheckAt: '', lastProfile: '', history: [],
    },
  };
}

/** 需要按账号归属的集合；新建数据时由 update() 自动补 ownerId。 */
const OWNED_COLLECTIONS = [
  'servers', 'gitSources', 'aiProviders', 'builds', 'deploys',
  'extensions', 'composeTemplates', 'backups', 'openlistConnections',
];
const requestContext = new AsyncLocalStorage();
const withUser = (user, fn) => requestContext.run({ user: user || null }, fn);
const currentUser = () => {
  const store = requestContext.getStore();
  return store ? store.user : null;
};

let _state = null;

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const base = defaultState();
    return {
      ...base, ...parsed,
      // 账号数组不能被旧文件里的非数组值污染；旧 state.json 缺字段时按空数组处理。
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      aiSessions: Array.isArray(parsed.aiSessions) ? parsed.aiSessions : [],
      repoMeta: (parsed.repoMeta && typeof parsed.repoMeta === 'object' && !Array.isArray(parsed.repoMeta)) ? parsed.repoMeta : {},
      hiddenRepos: Array.isArray(parsed.hiddenRepos) ? parsed.hiddenRepos : [],
      // 嵌套对象要逐层补齐，避免旧 state.json 缺字段导致策略读取为 undefined。
      environment: { ...base.environment, ...(parsed.environment || {}) },
    };
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
  // 记录更新前的归属快照：编辑型 handler 常用「构造新对象整体替换」，
  // 如果新对象漏带 ownerId / collaborators，这里能恢复，避免资源变成无人所有、
  // 普通用户编辑后反而看不到自己的数据（v0.4.1）。
  const before = new Map();
  const beforeIds = new Set();
  for (const key of OWNED_COLLECTIONS) {
    for (const item of (state()[key] || [])) {
      if (!item || !item.id) continue;
      before.set(`${key}:${item.id}`, {
        ownerId: item.ownerId || '',
        collaborators: Array.isArray(item.collaborators) ? item.collaborators : null,
      });
      beforeIds.add(item.id);
    }
  }
  const result = mutator(state());
  // 新增资源归当前账号；已有资源只恢复被误删的归属，绝不改成当前用户。
  const user = currentUser();
  const canOwn = Boolean(user && user.id && user.id !== '__legacy__' && user.id !== '__cli__');
  for (const key of OWNED_COLLECTIONS) {
    for (const item of (_state[key] || [])) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      const prev = before.get(`${key}:${item.id}`);
      if (prev) {
        if (!item.ownerId && prev.ownerId) item.ownerId = prev.ownerId;
        if (!Array.isArray(item.collaborators) && prev.collaborators) item.collaborators = prev.collaborators;
      } else if (canOwn && !item.ownerId) {
        item.ownerId = user.id;
      }
      if (!Array.isArray(item.collaborators)) item.collaborators = [];
    }
  }
  // v0.4.4 级联清理：对象删除时同步移除以该对象 id 为键的单项代理覆盖；
  // 账号被禁用 / 删除时移除它在所有资源上的协作者条目，避免下次保存报「协作者账号不存在」。
  // 放在 update() 里可覆盖所有删除入口，无需逐个 handler 记得调用。
  const liveIds = new Set();
  for (const key of OWNED_COLLECTIONS) {
    for (const item of (_state[key] || [])) if (item && item.id) liveIds.add(item.id);
  }
  const removedIds = [...beforeIds].filter((id) => !liveIds.has(id));
  if (removedIds.length && _state.proxy && _state.proxy.overrides) {
    for (const dict of Object.values(_state.proxy.overrides)) {
      if (!dict || typeof dict !== 'object') continue;
      for (const id of removedIds) delete dict[id];
    }
  }
  const activeUserIds = new Set((_state.users || [])
    .filter((u) => u && u.status !== 'disabled').map((u) => u.id));
  if (activeUserIds.size) {
    for (const key of OWNED_COLLECTIONS) {
      for (const item of (_state[key] || [])) {
        if (Array.isArray(item.collaborators)) {
          item.collaborators = item.collaborators.filter((c) => c && activeUserIds.has(c.userId));
        }
      }
    }
  }
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

/**
 * 带 HTTP 状态码的错误（v0.3.5）。
 * 以前所有异常都被 wrap() 包成 500：参数写错、对象不存在、上游服务挂了
 * 都长一个样，前端满屏「500」，也分不清是配置问题还是程序 bug。
 * 现在：客户端错误 4xx、外部服务不可用 502、只有未预期的代码异常才是 500。
 */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = Number(status) || 500;
    Object.assign(this, extra);
  }
}
const badRequest = (message) => new HttpError(400, message);
const notFound = (message) => new HttpError(404, message);
const conflict = (message, extra = {}) => new HttpError(409, message, {
  errorCode: 'CONFLICT', ...extra,
});
const upstream = (message, extra = {}) => new HttpError(502, message, {
  errorCode: 'UPSTREAM_UNAVAILABLE', upstream: true, ...extra,
});

/**
 * 镜像加速器前缀拼接（v0.3.6）。
 * DOCKER_IMAGE_PREFIX 允许写成 registry 根或带 namespace 的形式，常见误配是
 * `docker.m.daocloud.io/library/`：这个 library/ 只适用于 Docker Hub 官方镜像，
 * 拼到 `dbgate/dbgate` 这类命名空间镜像上会变成 `library/dbgate/dbgate`，
 * 镜像源直接返回 denied。这里按镜像名自动决定是否带 library。
 *   resolveImage('mysql',        'docker.m.daocloud.io/library/') → docker.m.daocloud.io/library/mysql
 *   resolveImage('dbgate/dbgate','docker.m.daocloud.io/library/') → docker.m.daocloud.io/dbgate/dbgate
 *   resolveImage('ghcr.io/a/b',  'docker.m.daocloud.io/')          → ghcr.io/a/b（第三方仓库不加速）
 */
function resolveImage(image, prefix) {
  const raw = String(image || '').trim().replace(/^\/+/, '');
  const p = String(prefix || '').trim().replace(/\/+$/, '');
  if (!p) return raw;
  // 只有「第一段 / 之后还有路径」时才可能是自带 registry 域名；
  // node:22-bookworm 这类「官方镜像 + tag」的冒号是标签分隔符，不能误判成 registry 端口。
  const slash = raw.indexOf('/');
  const first = slash >= 0 ? raw.slice(0, slash) : '';
  if (first && (first.includes('.') || first.includes(':') || first === 'localhost')) return raw;
  const base = p.replace(/\/library$/, '');
  return `${base}${raw.includes('/') ? '' : '/library'}/${raw}`;
}

/** 拉取候选：加速镜像优先，失败后再回退到原始 Docker Hub 镜像。 */
function imageCandidates(image, prefix) {
  const raw = String(image || '').trim();
  const fast = resolveImage(raw, prefix);
  return fast === raw ? [raw] : [fast, raw];
}

/**
 * 兜底推断：只认明确的短语，其余一律保持 500，避免把真实的代码异常
 * 误判成「用户输入错误」而掩盖问题。显式 status / HttpError 始终优先。
 *
 * v0.3.12：源码里有 130+ 处业务校验与上游失败用普通 Error 抛出，过去这些消息
 * 没被任何规则命中，用户在页面上填错一个字段就会看到 HTTP 500。这里补一层
 * 「业务语义」短语表，按 403 / 409 / 502 / 400 归类；完全陌生的异常仍是 500。
 */
function inferStatus(error) {
  const msg = String((error && error.message) || error || '');
  // 请求体层面的客户端错误：mini.js 也会带显式 status，这里做二次兜底。
  if (/请求体过大/.test(msg)) return 413;
  if (/目录已存在|同名容器已存在|实例名称已存在|同名 Git 源已存在/i.test(msg)) return 409;
  if (/不存在|未找到|找不到|未知环境档案|未知档案|No such (container|image|volume|network|object)/i.test(msg)) return 404;
  if (/缺少|请填写|未配置|不能为空|不可为空|需要二次确认|请二次确认|避免误伤|不是平台创建的|请选择或填写|不可删除|由 \.env 配置|至少需要保留|不支持的代理协议|不支持的操作|名称不合法|文件名不合法|路径中不允许|路径越界|路径必须以|取值不合法|上传内容为空|无法识别项目类型|未知扩展清单|镜像标识不合法|服务地址必须|必须是 http\(s\):\/\/|参数不合法/.test(msg)) return 400;
  // 「不是合法 JSON」曾把 mini.js 的「请求体不是合法 JSON」误判成 502；改为只匹配上游返回内容。
  if (/OpenList \/api\/|OpenList 登录|OpenList .*返回 code=|Docker API |无法连接 Docker|connect ENOENT|本地 AI 程序|HTTP 4\d\d:|HTTP 5\d\d:|fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|登录失败|record not found|返回了非预期数据|AI 服务返回内容不是合法 JSON/i.test(msg)) return 502;
  // 网络层不可达（代理/隧道探测、DNS、连接超时）同属上游故障，不是程序异常。
  if (/直连超时|直连失败|代理隧道|代理连通失败|隧道超时|连接超时|连接失败|请求超时|目标不可达|网络不可达|timeout|timed out|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ESOCKETTIMEDOUT|ECONNABORTED|socket hang up|connect (?:ETIMEDOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)/i.test(msg)) return 502;

  /* ---------------- 业务语义兜底（v0.3.12） ---------------- */
  if (/未授权写操作|命令不在只读白名单内|当前未设置 ADMIN_TOKEN|只允许执行内置只读诊断命令|内置档案不可覆盖|禁止删除系统路径/i.test(msg)) return 403;
  if (/文件已存在|端口 \d+ .*已占用|已被.*占用|id 与已有清单重复|当前已经是|表单字段重复/i.test(msg)) return 409;
  if (/docker load 失败|备份命令失败|恢复命令失败|远程.*失败|写入远程环境文件失败|宿主机 git clone 失败|git clone 失败|AI 服务返回 HTTP|AI 服务响应格式异常|下载失败：HTTP|拉取镜像失败|容器启动失败|升级失败|Docker 未返回|新版本容器启动后|OpenList 未返回|构建后端.*不可用|服务器.*Docker 不可用|本机未检测到 Docker|SSH 宿主机.*也没有 Git|目标服务器 Docker 不可用/i.test(msg)) return 502;
  if (/不合法|不是合法|非法|无效|不支持|必须|需要|请执行|请选择|请先|请改用|请确认|请使用|请换|不允许|只允许|只有|禁止|不能|不可|未设置|未指定|未知|已被|已禁用|已中止|已丢失|重复|过长|为空|格式不对|未定义|不在|没有要|没有 Git|没有容器|没有可用|无法表示|无法备份|无法恢复|保存已中止|层级过深/i.test(msg)) return 400;
  return 500;
}

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, error, code = undefined) => {
  const status = Number(code) || Number(error && error.status) || inferStatus(error);
  const message = String((error && error.message) || error);
  const payload = { ok: false, error: message, status };
  if (error && error.errorCode) payload.code = error.errorCode;
  if (error && error.hint) payload.hint = error.hint;
  res.status(status).json(payload);
};

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
  OWNED_COLLECTIONS, withUser, currentUser,
  safeWorkspacePath, relativeWorkspacePath, defaultState,
  envFileCandidates, resolveEnvFile,
  HttpError, badRequest, notFound, conflict, upstream, inferStatus,
  resolveImage, imageCandidates,
};
