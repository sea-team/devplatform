'use strict';

/**
 * v0.3.8 · .env 配置的平台化管理 + 诊断联动配置指引。
 *
 * 背景：以前遇到证书过期 / 扩展端口不通 / 镜像加速被拒，界面只给一句「请改 .env」，
 * 用户既看不到当前值，也不知道该改哪个键、写在哪、改完要不要重启。本模块把这件事闭环：
 *   1) 按白名单读出 .env 的键 / 值 / 说明 / 是否敏感 / 是否需要重启，敏感值一律脱敏；
 *   2) 同时给出「运行时实际生效值」，文件改了但没重启会标成「待重启」；
 *   3) 针对已知故障生成可直接复制的 .env 片段（TLS / 扩展地址 / 镜像源 / Git 运行时）；
 *   4) 允许在控制台按白名单写回 .env：自动备份、600 权限、保留注释与顺序、原子程度可控。
 *
 * 安全边界：只认白名单键；不执行 shell、不重启容器、不改 state.json；
 * 写文件前强制备份；DP_TLS_INSECURE 这类开关写入后同步热更新到运行时 config。
 *
 * 注意：容器部署把宿主机 .env 以「单文件 bind mount」挂进 /app/.env。
 * 对单文件挂载点不能用 tmp + rename（会顶掉挂载 inode，导致容器内外文件脱钩），
 * 因此这里用原地 writeFileSync 覆盖，备份仍用 copyFileSync 保留原内容。
 */
const fs = require('fs');
const path = require('path');
const { config, HttpError, resolveEnvFile, envFileCandidates } = require('./core');

/* ------------------------------ 键白名单与元数据 ------------------------------ */

const GROUPS = [
  { id: 'tls', label: 'TLS / 证书', desc: '外部服务证书过期、自签名或证书链不完整时的应急开关' },
  { id: 'ext', label: '扩展 / 数据库', desc: '平台跑在容器里时，扩展容器的对外绑定地址与连接主机名' },
  { id: 'service', label: '集成服务地址与凭据', desc: 'Gitea / OpenList / 在线 IDE 的地址与访问令牌' },
  { id: 'git', label: 'Git 运行时与工作区', desc: 'git 可执行文件、工作区宿主机路径映射' },
  { id: 'image', label: '镜像源与构建', desc: '镜像加速前缀、构建后端与超时' },
  { id: 'platform', label: '平台自身', desc: '端口、鉴权、代理与环境档案' },
];

// restart: 改完是否需要重启平台进程；hot: 能否在本模块里同步更新运行时 config。
const SPECS = [
  { key: 'DP_TLS_INSECURE', group: 'tls', label: '跳过 TLS 证书校验（全局）', sensitive: false,
    restart: false, hot: true, example: '1', kind: 'bool',
    desc: '设为 1 后，所有出站 HTTPS 请求默认跳过证书校验。仅限内网应急，会失去防中间人攻击能力；推荐仍是为服务端续期 / 换受信任证书。',
    problems: ['TLS_CERT_INVALID'] },
  { key: 'DP_TLS_INSECURE_HOSTS', group: 'tls', label: '跳过校验的主机白名单', sensitive: false,
    restart: false, hot: true, example: 'gitea.internal,10.0.0.246', kind: 'text',
    desc: '配合 DP_TLS_INSECURE=1 使用，逗号分隔域名 / IP，只对这些主机跳过校验，缩小影响面；留空表示全部主机。',
    problems: ['TLS_CERT_INVALID'] },
  { key: 'DP_EXT_BIND_IP', group: 'ext', label: '扩展容器绑定地址', sensitive: false,
    restart: true, hot: false, example: '0.0.0.0', kind: 'text',
    desc: '数据库 / DbGate 等扩展容器端口绑定到宿主机哪个地址。默认 127.0.0.1 只绑本机；平台在容器内且需要浏览器访问时，改为 0.0.0.0 或宿主机内网 IP。',
    problems: ['PORT_UNREACHABLE'] },
  { key: 'DP_EXT_HOST', group: 'ext', label: '扩展对外主机名', sensitive: false,
    restart: true, hot: false, example: '10.0.0.246', kind: 'text',
    desc: '生成连接串与 TCP 探测时使用的主机名。平台跑在容器里时，容器内的 127.0.0.1 不是宿主机，必须填宿主机内网 IP；改完还要重建对应实例。',
    problems: ['PORT_UNREACHABLE'] },
  { key: 'GITEA_URL', group: 'service', label: 'Gitea 地址', sensitive: false, restart: true, example: 'http://10.0.0.246:3002', kind: 'url', desc: '平台内置 Gitea 源的 API 基址；容器部署必须写宿主机 IP，不能写 compose 服务名。' },
  { key: 'GITEA_TOKEN', group: 'service', label: 'Gitea 访问令牌', sensitive: true, restart: true, example: '', kind: 'text', desc: '内置 Gitea 的管理员 Token；只保存在本机 .env，列表接口一律脱敏。' },
  { key: 'OPENLIST_URL', group: 'service', label: 'OpenList 地址', sensitive: false, restart: true, example: 'http://10.0.0.246:5244', kind: 'url', desc: 'OpenList API 基址；若该服务启用了 HTTPS 且证书不受信任，同样适用 TLS 开关。' },
  { key: 'OPENLIST_TOKEN', group: 'service', label: 'OpenList 令牌', sensitive: true, restart: true, example: '', kind: 'text', desc: '留空时平台用下面的管理员账号密码自动登录换取 token。' },
  { key: 'OPENLIST_USER', group: 'service', label: 'OpenList 管理员账号', sensitive: false, restart: true, example: 'admin', kind: 'text', desc: '自动登录换取 token 时使用。' },
  { key: 'OPENLIST_PASSWORD', group: 'service', label: 'OpenList 管理员密码', sensitive: true, restart: true, example: '', kind: 'text', desc: '自动登录换取 token 时使用；也可在「存储 / 文件 → 连接管理」里改，无需改 .env。' },
  { key: 'CODE_SERVER_URL', group: 'service', label: '在线 IDE 地址', sensitive: false, restart: true, example: 'http://10.0.0.246:8080', kind: 'url', desc: 'code-server 对外地址。' },
  { key: 'ADMIN_TOKEN', group: 'platform', label: '控制台鉴权令牌', sensitive: true, restart: true, example: '', kind: 'text', desc: '留空不做鉴权（仅限本机）。设置后浏览器需执行 localStorage.setItem("dp_token", "<同一 token>")。' },
  { key: 'HOST_WORKSPACE_DIR', group: 'git', label: '工作区宿主机路径', sensitive: false, restart: true, example: '/data/platform/workspace', kind: 'text', desc: '平台容器内 /workspace 在宿主机上的真实路径；必须与 docker run 的 -v 一致，否则挂载为空目录、SSH 宿主机克隆写不回。', problems: ['GIT_BIN_MISSING'] },
  { key: 'GIT_BIN', group: 'git', label: 'git 可执行文件路径', sensitive: false, restart: true, example: '/usr/bin/git', kind: 'text', desc: '容器镜像或单文件 exe 找不到 git 时可写死路径；控制台「Git 运行时」的设置优先级更高且无需重启。', problems: ['GIT_BIN_MISSING'] },
  { key: 'DP_GIT_FALLBACK_SERVER_ID', group: 'git', label: '克隆兜底服务器 ID', sensitive: false, restart: true, example: '', kind: 'text', desc: '容器内无 Git 时借哪台已登记 SSH 宿主机执行 clone；留空自动挑选。' },
  { key: 'DOCKER_IMAGE_PREFIX', group: 'image', label: '镜像加速器前缀', sensitive: false, restart: true, example: 'docker.m.daocloud.io/', kind: 'text', desc: 'Docker Hub 不可达时填 registry 根即可；平台会自动判断官方镜像是否补 library/，不要手工写 library/dbgate 这类拼接。', problems: ['IMAGE_DENIED'] },
  { key: 'BUILD_EXECUTOR', group: 'image', label: '构建后端', sensitive: false, restart: true, example: 'auto', kind: 'text', desc: 'auto | ssh | docker | wsl | local；auto 按可用性自动降级。' },
  { key: 'BUILD_TIMEOUT_MS', group: 'image', label: '构建超时（毫秒）', sensitive: false, restart: true, example: '900000', kind: 'text', desc: '单次构建的最长执行时间。' },
  { key: 'DP_PROXY_GLOBAL', group: 'platform', label: '全局代理', sensitive: false, restart: true, example: 'http://127.0.0.1:7890', kind: 'text', desc: '首次启动默认值；控制台「代理配置」页修改后写入 state.json 并优先生效。', problems: ['PROXY_TARGET_UNREACHABLE'] },
  { key: 'DP_PROXY_NO', group: 'platform', label: 'NO_PROXY 直连名单', sensitive: false, restart: true, example: 'localhost,127.0.0.1,10.0.0.0/8', kind: 'text', desc: '逗号分隔的域名 / IP / CIDR；命中即不走代理。' },
  { key: 'DP_ENV_PROFILE', group: 'platform', label: '环境档案', sensitive: false, restart: true, example: 'container-lite', kind: 'text', desc: 'auto | native | container | container-lite | remote；换机器时用来覆盖旧 state.json 的策略。' },
  { key: 'DP_ENV_FILE', group: 'platform', label: '.env 文件路径', sensitive: false, restart: true, example: '/app/.env', kind: 'text', desc: '显式告诉平台去哪读写 .env；容器部署由 remote.js 自动注入，一般无需手工填写。' },
];

const SPEC_BY_KEY = new Map(SPECS.map((s) => [s.key, s]));

/* ------------------------------ 运行时生效值 ------------------------------ */

const RUNTIME_MAP = {
  GITEA_URL: () => config.giteaUrl,
  GITEA_TOKEN: () => config.giteaToken,
  OPENLIST_URL: () => config.openlistUrl,
  OPENLIST_TOKEN: () => config.openlistToken,
  OPENLIST_USER: () => config.openlistUser,
  OPENLIST_PASSWORD: () => config.openlistPassword,
  CODE_SERVER_URL: () => config.codeServerUrl,
  ADMIN_TOKEN: () => config.adminToken,
  HOST_WORKSPACE_DIR: () => config.hostWorkspaceDir,
  GIT_BIN: () => config.gitBin,
  DP_GIT_FALLBACK_SERVER_ID: () => config.gitFallbackServerId,
  DOCKER_IMAGE_PREFIX: () => config.dockerImagePrefix,
  BUILD_EXECUTOR: () => config.buildExecutor,
  BUILD_TIMEOUT_MS: () => String(config.buildTimeoutMs),
  DP_EXT_BIND_IP: () => config.extBindIp,
  DP_EXT_HOST: () => config.extHost,
  DP_TLS_INSECURE: () => (config.tlsInsecure ? '1' : ''),
  DP_TLS_INSECURE_HOSTS: () => config.tlsInsecureHosts,
  DP_ENV_PROFILE: () => config.envProfile,
  DP_ENV_FILE: () => config.envFile,
  WORKSPACE_DIR: () => config.workspaceDir,
};

const isMaskedValue = (v) => String(v || '').includes('******');

function maskValue(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return `${s.slice(0, 1)}******`;
  return `${s.slice(0, 3)}******${s.slice(-3)}`;
}

/** 解析 .env，保留原始行以便写回时不丢注释。 */
function parseEnv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const values = new Map();
  const lineIndex = new Map();
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) return;                       // 注释 / 空行 / export 前缀都不动
    let v = m[2];
    // 去掉行尾注释（只处理未加引号的值），以及成对引号。
    const trimmed = v.trim();
    if (/^(["']).*\1$/.test(trimmed)) v = trimmed.slice(1, -1);
    else v = trimmed.replace(/\s+#.*$/, '').trim();
    values.set(m[1], v);
    lineIndex.set(m[1], i);
  });
  return { lines, values, lineIndex };
}

/**
 * 全局 TLS 开关是否对某个 URL 生效。
 * DP_TLS_INSECURE_HOSTS 为空 = 全部主机；非空 = 精确域名或子域名后缀匹配。
 */
function effectiveInsecure(url) {
  if (!config.tlsInsecure) return false;
  const raw = String(config.tlsInsecureHosts || '').trim();
  if (!raw) return true;
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return false; }
  const list = raw.split(/[,;\s]+/).filter(Boolean)
    .map((h) => h.toLowerCase().replace(/^\*\./, '').replace(/:\d+$/, ''));
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * 单个 Git 源的实际 TLS 决策：源级显式开关 > 全局 .env。
 * 三态设计很重要：显式 false 可以关掉全局开关，避免「开了全局就再也关不掉某个公网源」。
 */
function tlsDecision(source, url) {
  if (source && source.insecure === true) return true;
  if (source && source.insecure === false) return false;
  return effectiveInsecure(url || (source && source.baseUrl) || '');
}

/* ------------------------------ 配置建议片段 ------------------------------ */

/**
 * 把「诊断结论」翻译成可以直接粘进 .env 的片段。
 * ctx.host 用宿主机 IP 占位，避免把某台机器的地址写死在代码里。
 */
function adviceFor(problem, ctx = {}) {
  const host = String(ctx.host || '<宿主机内网 IP>');
  const domain = String(ctx.domain || '<证书异常的域名>');
  const table = {
    TLS_CERT_INVALID: {
      id: 'tls', title: '外部服务证书过期 / 自签名',
      reason: '平台默认严格校验证书，服务端证书不受信任时 REST API 与 git clone 都会失败。',
      keys: ['DP_TLS_INSECURE', 'DP_TLS_INSECURE_HOSTS'],
      snippet: `# 临时应急（推荐仍是为服务端续期 / 换受信任证书）\nDP_TLS_INSECURE=1\nDP_TLS_INSECURE_HOSTS=${domain}`,
      note: '也可以只给单个 Git 源勾选「忽略 TLS 证书校验」，影响面更小。修改后本页「立即应用」即可生效，无需重启。',
    },
    PORT_UNREACHABLE: {
      id: 'ext', title: '扩展 / DbGate 端口不可达',
      reason: '平台跑在容器里时，容器内的 127.0.0.1 既不是宿主机，浏览器也无法访问；扩展容器默认只绑本机。',
      keys: ['DP_EXT_BIND_IP', 'DP_EXT_HOST'],
      snippet: `# 平台容器部署时必填\nDP_EXT_BIND_IP=0.0.0.0\nDP_EXT_HOST=${host}`,
      note: '改完需要重启平台容器，再到「扩展 / 数据库 → 一键体检 → 重建容器」让端口映射与连接串更新。',
    },
    IMAGE_DENIED: {
      id: 'image', title: '镜像加速器返回 denied',
      reason: '前缀写成 library/ 后拼到命名空间镜像会变成 library/dbgate/dbgate，加速源直接拒绝。',
      keys: ['DOCKER_IMAGE_PREFIX'],
      snippet: 'DOCKER_IMAGE_PREFIX=docker.m.daocloud.io/',
      note: '只写 registry 根，不要带 library/；平台会自动判断单段官方镜像是否补 library。',
    },
    GIT_BIN_MISSING: {
      id: 'git', title: '容器内找不到 git',
      reason: '精简镜像没有 git 可执行文件，且 SSH 宿主机兜底依赖正确的工作区路径映射。',
      keys: ['HOST_WORKSPACE_DIR', 'GIT_BIN'],
      snippet: `HOST_WORKSPACE_DIR=/data/platform/workspace\n# GIT_BIN=/usr/bin/git`,
      note: '优先在控制台「Git 仓库 → Git 运行时」里保存路径（无需重启）；也可重新部署带 Git 的镜像。',
    },
    PROXY_TARGET_UNREACHABLE: {
      id: 'proxy', title: '代理 / 目标主机不可达',
      reason: '出站请求被代理拦截或目标服务没启动，平台返回 502 而不是 500。',
      keys: ['DP_PROXY_GLOBAL', 'DP_PROXY_NO'],
      snippet: `# DP_PROXY_GLOBAL=http://127.0.0.1:7890\nDP_PROXY_NO=localhost,127.0.0.1,10.0.0.0/8`,
      note: '更推荐在「代理配置」页按作用域设置，保存后立即生效且无需重启。',
    },
  };
  return table[problem] || null;
}

function allAdvice(ctx) {
  return ['TLS_CERT_INVALID', 'PORT_UNREACHABLE', 'IMAGE_DENIED', 'GIT_BIN_MISSING', 'PROXY_TARGET_UNREACHABLE']
    .map((p) => {
      const a = adviceFor(p, ctx);
      return a ? { ...a, problem: p } : null;
    }).filter(Boolean);
}

/* ---------------------------------- 读取 ---------------------------------- */

function read() {
  const file = resolveEnvFile();
  let exists = false;
  let writable = false;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
    exists = true;
  } catch { /* 文件不存在：仍返回白名单清单，允许平台创建 */ }
  try { fs.accessSync(exists ? file : path.dirname(file), fs.constants.W_OK); writable = true; }
  catch { writable = false; }
  const parsed = parseEnv(text);
  const items = SPECS.map((spec) => {
    const defined = parsed.values.has(spec.key);
    const raw = defined ? parsed.values.get(spec.key) : '';
    const runtime = RUNTIME_MAP[spec.key] ? String(RUNTIME_MAP[spec.key]() || '') : '';
    const masked = spec.sensitive && Boolean(raw);
    return {
      ...spec,
      defined,
      value: masked ? maskValue(raw) : raw,
      masked,
      display: defined ? (masked ? maskValue(raw) : (raw || '(空值)')) : '未设置',
      runtimeValue: spec.sensitive && runtime ? maskValue(runtime) : runtime,
      pendingRestart: defined && !spec.hot && raw !== runtime,
      example: spec.example,
    };
  });
  return {
    path: file,
    candidates: envFileCandidates(),
    exists, writable,
    groups: GROUPS,
    items,
    advice: allAdvice(),
    runtime: {
      tlsInsecure: config.tlsInsecure,
      tlsInsecureHosts: config.tlsInsecureHosts,
      extBindIp: config.extBindIp,
      extHost: config.extHost,
      dockerImagePrefix: config.dockerImagePrefix,
      envFile: config.envFile,
      runtimeKind: config.runtimeKind,
    },
    warning: '跳过 TLS 证书校验会失去防中间人攻击能力，仅限可信任的内网临时应急；长期方案是为服务端续期或换用受信任证书，并把内网 CA 加入平台容器信任链。',
  };
}

/* ---------------------------------- 写入 ---------------------------------- */

function validateValue(key, value) {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) throw new HttpError(400, `不支持修改的环境变量：${key}`);
  let v = String(value === undefined || value === null ? '' : value);
  if (isMaskedValue(v)) return null;       // 前端回传脱敏占位符 = 不改
  if (/[\r\n\0]/.test(v)) throw new HttpError(400, `${key} 的值不能包含换行或控制字符`);
  if (v.length > 2048) throw new HttpError(400, `${key} 的值过长（上限 2048 字符）`);
  v = v.trim();
  if (spec.kind === 'bool' && v && !/^(0|1|true|false|yes|no|on|off)$/i.test(v)) {
    throw new HttpError(400, `${key} 只能填 0 / 1（或 true / false）`);
  }
  if (spec.kind === 'url' && v && !/^https?:\/\//i.test(v)) {
    throw new HttpError(400, `${key} 必须是 http(s):// 开头的地址`);
  }
  return v;
}

/** 同步更新运行时 config，让 TLS 开关这类配置无需重启即可生效。 */
function applyHot(key, value) {
  if (key === 'DP_TLS_INSECURE') {
    config.tlsInsecure = /^(1|true|yes|on)$/i.test(value);
    process.env.DP_TLS_INSECURE = value;
    return true;
  }
  if (key === 'DP_TLS_INSECURE_HOSTS') {
    config.tlsInsecureHosts = value;
    process.env.DP_TLS_INSECURE_HOSTS = value;
    return true;
  }
  return false;
}

/**
 * 按白名单写回 .env。values 是 { KEY: value }；confirm 必须为 true（前端二次确认）。
 * 返回变更清单、备份路径、是否需要重启、哪些键已热生效。
 */
function write(values = {}, options = {}) {
  if (!options.confirm) throw new HttpError(400, '需要二次确认：修改 .env 会影响平台运行，请确认后再提交');
  const file = resolveEnvFile();
  let original = '';
  try { original = fs.readFileSync(file, 'utf8'); } catch { /* 允许创建 */ }
  const { lines, values: current, lineIndex } = parseEnv(original);
  const changes = [];
  const prepared = [];
  for (const [key, value] of Object.entries(values || {})) {
    const v = validateValue(key, value);
    if (v === null) continue;                      // 脱敏占位符，跳过
    const before = current.has(key) ? current.get(key) : '';
    if (current.has(key) && before === v) continue;
    prepared.push({ key, value: v, before, defined: current.has(key) });
  }
  if (!prepared.length) return { path: file, changed: [], backup: '', requiresRestart: false, hotApplied: [], message: '没有需要修改的配置项' };

  // 先备份，再原地覆盖（兼容容器里的单文件 bind mount）。
  let backup = '';
  if (original) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    // 容器里 /app/.env 是「单文件 bind mount」，同目录 /app 实际映射到宿主机的代码目录，
    // 备份放那儿会混进代码目录、还可能被下次部署打包。统一放到 DP_ENV_BACKUP_DIR
    // （容器部署由 remote.js 注入 /app/data，宿主机上就是 <部署目录>/data，已被打包排除）。
    const backupDir = process.env.DP_ENV_BACKUP_DIR || path.dirname(file);
    try { fs.mkdirSync(backupDir, { recursive: true }); } catch { /* 目录已存在 */ }
    backup = path.join(backupDir, `${path.basename(file)}.bak.${stamp}`);
    fs.copyFileSync(file, backup);
    try { fs.chmodSync(backup, 0o600); } catch { /* Windows 忽略 */ }
  }

  const next = [...lines];
  for (const item of prepared) {
    // 不加引号：Docker 的 --env-file 不做 shell / dotenv 式解析，加引号会被当成值的一部分。
    const line = `${item.key}=${item.value}`;
    if (item.defined && lineIndex.has(item.key)) next[lineIndex.get(item.key)] = line;
    else next.push(line);
    changes.push({ key: item.key, before: item.before, after: item.value, created: !item.defined });
  }
  // 去掉末尾多余的空行，保证文件以单个换行结束。
  while (next.length > 1 && !String(next[next.length - 1]).trim()) next.pop();
  const content = `${next.join('\n').replace(/\n+$/, '')}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 忽略 */ }

  const hotApplied = [];
  const requiresRestart = [];
  for (const item of prepared) {
    if (applyHot(item.key, item.value)) hotApplied.push(item.key);
    else {
      requiresRestart.push(item.key);
      process.env[item.key] = item.value;
    }
  }
  return {
    path: file, changed: changes, backup,
    requiresRestart: requiresRestart.length > 0,
    restartKeys: requiresRestart,
    hotApplied,
    message: hotApplied.length && !requiresRestart.length
      ? '已写入 .env 并立即生效，无需重启'
      : '已写入 .env；标注「需重启」的项要重启平台后才生效',
  };
}

module.exports = {
  GROUPS, SPECS, SPEC_BY_KEY, read, write, adviceFor, allAdvice,
  effectiveInsecure, tlsDecision, maskValue, parseEnv,
};
