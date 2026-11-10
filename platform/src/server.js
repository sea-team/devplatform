'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createApp } = require('./mini');
const {
  config, state, update, uid, ok, fail, wrap, appRoot,
  safeWorkspacePath, relativeWorkspacePath,
} = require('./core');
const {
  giteaApi, openlistApi, sshExec, collectStatus, publicServer, aiChat, publicProvider, httpJSON,
  detectLocalPrograms, runCli,
} = require('./integrations');
const { PROFILES, startBuild, deployBuild, opsAgent, READ_COMMANDS } = require('./engine');
const remoteOps = require('./remoteOps');
const extensions = require('./extensions');

// 内置 HTTP 路由：本地零依赖即可启动；容器里装了 ssh2/undici 后自动启用 SSH 与代理。
const app = createApp({ adminToken: config.adminToken, staticDir: config.publicDir });
app.disable('x-powered-by');
app.get('/api/health', (req, res) => ok(res, {
  name: 'devplatform', version: '0.2.0', time: new Date().toISOString(),
  mode: 'normal', executor: config.buildExecutor, workspace: config.workspaceDir,
}));
// 鉴权由 mini.js 在分发层统一处理（/api/health 除外）。
// 正常模式：外部服务未就绪时直接返回真实错误，不注入任何演示数据。

/* --------------------- 运行时 / 热更新（引导器 IPC） --------------------- */
// 源码直跑时没有引导器；编译成 exe 后由 launcher 监督进程处理更新、回滚与重载。
const hasLauncher = () => typeof process.send === 'function' && Boolean(process.env.DP_LAUNCHER);
const ipcPending = new Map();
let ipcSeq = 0;

if (hasLauncher()) {
  process.on('message', (msg) => {
    if (!msg || !msg.id) return;
    const entry = ipcPending.get(msg.id);
    if (!entry) return;
    ipcPending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.data);
    else entry.reject(new Error(msg.error || '引导器命令失败'));
  });
}

function launcherCmd(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!hasLauncher()) {
      reject(new Error('当前为源码模式，请用 CLI：node launcher/launcher.js update|rollback|reload'));
      return;
    }
    const id = `c${Date.now()}_${++ipcSeq}`;
    const timer = setTimeout(() => {
      ipcPending.delete(id);
      reject(new Error('引导器响应超时'));
    }, 120000);
    ipcPending.set(id, { resolve, reject, timer });
    process.send({ id, type, ...payload });
  });
}

function localVersion() {
  let release = null;
  try { release = JSON.parse(fs.readFileSync(path.join(appRoot, 'release.json'), 'utf8')); } catch { /* noop */ }
  return {
    version: (release && release.version) || '0.2.0',
    buildTime: (release && release.buildTime) || null,
    runtime: hasLauncher() ? 'binary' : 'source',
    node: process.version,
    appRoot,
    updateUrl: process.env.DP_UPDATE_URL || '',
    launcher: hasLauncher(),
  };
}

app.get('/api/system/version', wrap(async (req, res) => {
  let info = localVersion();
  if (hasLauncher()) {
    try { info = { ...info, ...(await launcherCmd('version')) }; } catch { /* 保留本地信息 */ }
  }
  ok(res, info);
}));

app.post('/api/system/reload', wrap(async (req, res) => {
  if (!hasLauncher()) {
    return ok(res, { reloaded: false, mode: 'source', hint: '源码模式请使用 npm run dev（文件变更自动重启）' });
  }
  ok(res, { reloaded: true, mode: 'binary' });
  // 先把响应发出去，再通知监督进程重启 worker。
  setImmediate(() => process.send({ type: 'reload' }));
}));

app.post('/api/system/update/check', wrap(async (req, res) => {
  const source = String((req.body && req.body.source) || '');
  try {
    ok(res, await launcherCmd('update-check', { source }));
  } catch (error) {
    ok(res, { available: false, sourceMode: true, error: String(error.message || error) });
  }
}));

app.post('/api/system/update/apply', wrap(async (req, res) => {
  ok(res, await launcherCmd('update-apply', {
    source: String((req.body && req.body.source) || ''),
    force: Boolean(req.body && req.body.force),
  }));
}));

app.post('/api/system/rollback', wrap(async (req, res) => {
  ok(res, await launcherCmd('rollback'));
}));

const requireBody = (body, keys) => {
  for (const key of keys) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      throw new Error(`缺少参数：${key}`);
    }
  }
};

/* ------------------------------- 总览面板 -------------------------------- */

app.get('/api/overview', wrap(async (req, res) => {
  const probes = await Promise.allSettled([
    giteaApi.version(),
    openlistApi.health(),
    httpJSON(`${config.codeServerUrl}/healthz`, { timeout: 4000 }),
  ]);
  const names = ['Git 仓库 (Gitea)', '存储挂载 (OpenList)', '在线 IDE (code-server)'];
  const urls = [config.giteaUrl, config.openlistUrl, config.codeServerUrl];
  const configured = [
    Boolean(config.giteaToken),
    Boolean(config.openlistToken || config.openlistPassword),
    true,
  ];
  const hints = [
    'GITEA_TOKEN 未配置，仓库列表与创建不可用；在 dist/.env 中填写后完全重启程序',
    'OPENLIST_TOKEN 或 OPENLIST_PASSWORD 未配置；在 dist/.env 中填写后完全重启程序',
    '确认 code-server 已启动，或在 dist/.env 中把 CODE_SERVER_URL 指向已部署的地址',
  ];
  // 把 Node 的 "fetch failed" 翻译成可操作的提示，避免出现容器服务名时用户无从下手。
  const friendly = (reason) => {
    const err = reason && reason.message ? reason : { message: String(reason), cause: null };
    const code = (err.cause && err.cause.code) || '';
    const msg = String(err.message || reason);
    if (/未配置/.test(msg)) return msg;
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
      return `域名无法解析（${code}）：地址可能是容器内服务名，请改成本机可访问的地址`;
    }
    if (/ECONNREFUSED/.test(code)) return '连接被拒绝：服务未启动或端口不对';
    if (/ETIMEDOUT|timeout|abort/i.test(`${msg} ${code}`)) return '连接超时：检查地址、端口与防火墙';
    if (/fetch failed/i.test(msg)) return '连接失败：服务未启动，或地址是容器内服务名（本机无法解析）';
    return msg.slice(0, 120);
  };
  const builtinServices = probes.map((p, i) => {
    const up = p.status === 'fulfilled';
    const detail = up
      ? (i === 0 ? `v${(p.value && p.value.version) || 'unknown'}` : '可连接')
      : friendly(p.reason);
    let status;
    if (up) status = configured[i] ? 'online' : 'partial';
    else status = /未配置/.test(detail) ? 'unconfigured' : 'offline';
    return {
      name: names[i], url: urls[i], status, configured: configured[i],
      detail, hint: up && configured[i] ? '' : hints[i],
    };
  });
  // 扩展（MySQL / PgSQL / Redis 等）沿用同一套四态展示；这里只取已持久化的状态，
  // 不在总览里做实时探测，避免拖慢页面。需要精确结论时到扩展页点「检测」。
  const extInstances = extensions.listInstances().items;
  const extServices = extInstances.map((i) => {
    const status = ['online', 'offline', 'partial', 'unconfigured'].includes(i.status)
      ? i.status : (i.status === 'installing' ? 'partial' : 'offline');
    return {
      name: `${i.label} · ${i.name}`,
      url: `${i.mode === 'docker' ? '容器' : '外部'} ${i.host}:${i.port}`,
      status, configured: true,
      detail: i.statusDetail || i.status,
      hint: status === 'online' ? '' : '到「扩展 / 数据库」页检测状态或启动实例',
    };
  });
  const services = [...builtinServices, ...extServices];
  const builds = state().builds;
  ok(res, {
    services,
    counts: {
      repos: 0,
      servers: state().servers.length,
      aiProviders: state().aiProviders.length,
      builds: builds.length,
      buildSuccess: builds.filter((b) => b.status === 'success').length,
      buildFailed: builds.filter((b) => b.status === 'failed').length,
      deploys: state().deploys.length,
      extensions: extInstances.length,
    },
    workspace: config.workspaceDir,
    executor: config.buildExecutor,
    mode: 'normal',
  });
}));

/* ------------------------------ Git 仓库管理 ----------------------------- */

app.get('/api/repos', wrap(async (req, res) => {
  ok(res, { items: await giteaApi.listRepos() });
}));

app.post('/api/repos', wrap(async (req, res) => {
  requireBody(req.body, ['name']);
  const payload = {
    name: String(req.body.name).replace(/[^A-Za-z0-9_.-]/g, '-'),
    description: req.body.description || '',
    private: Boolean(req.body.private),
    auto_init: true,
  };
  ok(res, { repo: await giteaApi.createRepo(payload) });
}));

app.post('/api/repos/clone', wrap(async (req, res) => {
  requireBody(req.body, ['cloneUrl']);
  const cloneUrl = String(req.body.cloneUrl).trim();
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(cloneUrl)) throw new Error('cloneUrl 必须是 http(s)/ssh/git 地址');
  const name = String(req.body.name || path.basename(cloneUrl, '.git')).replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!name || name === '.' || name === '..') throw new Error('仓库名不合法');
  const target = safeWorkspacePath(name);
  if (fs.existsSync(target)) throw new Error(`目录已存在：${name}`);

  await new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', cloneUrl, target], { shell: false });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git clone 失败：${stderr.slice(-500)}`))));
  });
  ok(res, { name, path: relativeWorkspacePath(target), cloneUrl });
}));

/* -------------------------------- 在线 IDE ------------------------------- */

app.get('/api/ide', wrap(async (req, res) => {
  ok(res, { url: config.codeServerUrl, workspace: config.workspaceDir });
}));

app.post('/api/ide/open', wrap(async (req, res) => {
  const repoPath = String(req.body.repoPath || '').trim();
  const abs = safeWorkspacePath(repoPath);
  if (!fs.existsSync(abs)) throw new Error(`工作区内不存在目录：${repoPath || '/'}`);
  // code-server 容器内路径来自 compose 的 ./workspace:/home/coder/project 映射
  const folder = `/home/coder/project/${relativeWorkspacePath(abs)}`.replace(/\/+$/, '');
  ok(res, { url: `${config.codeServerUrl}/?folder=${encodeURIComponent(folder)}`, folder });
}));

/* ------------------------------ 存储文件管理 ----------------------------- */

const joinPath = (parent, name) => `${String(parent || '/').replace(/\/+$/, '')}/${String(name).replace(/^\/+/, '')}`;

app.get('/api/storage', wrap(async (req, res) => {
  const p = String(req.query.path || '/');
  const raw = await openlistApi.list(p);
  const d = raw.data || raw;
  ok(res, { path: p, content: d.content || [], total: d.total || 0, provider: d.provider, write: d.write });
}));

app.post('/api/storage/mkdir', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'name']);
  const full = joinPath(req.body.path, req.body.name);
  await openlistApi.mkdir(full);
  ok(res, { path: full });
}));

app.post('/api/storage/remove', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'names']);
  const names = Array.isArray(req.body.names) ? req.body.names : [req.body.names];
  await openlistApi.remove(req.body.path, names);
  ok(res, { removed: names });
}));

app.put('/api/storage/upload', wrap(async (req, res) => {
  const p = String(req.query.path || '/');
  const name = String(req.query.name || 'upload.bin');
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buffer.length) throw new Error('上传内容为空');
  const full = joinPath(p, name);
  await openlistApi.upload(full, buffer);
  ok(res, { path: full, size: buffer.length });
}), { raw: true });

app.get('/api/storage/mounts', wrap(async (req, res) => {
  const raw = await openlistApi.mounts();
  const data = raw.data || raw;
  ok(res, { items: Array.isArray(data) ? data : [], webdav: openlistApi.webdavUrl() });
}));

/* --------------------------- 构建 / 测试 / 部署 --------------------------- */

app.get('/api/profiles', (req, res) => ok(res, { items: PROFILES, executor: config.buildExecutor }));

app.get('/api/builds', (req, res) => ok(res, {
  items: state().builds.map((b) => ({ ...b, logs: undefined })),
}));

app.post('/api/builds', wrap(async (req, res) => {
  const record = await startBuild(req.body || {});
  ok(res, { id: record.id, status: record.status, profile: record.profile });
}));

app.get('/api/builds/:id', wrap(async (req, res) => {
  const build = state().builds.find((b) => b.id === req.params.id);
  if (!build) return fail(res, '构建记录不存在', 404);
  ok(res, build);
}));

app.get('/api/builds/:id/log', wrap(async (req, res) => {
  const build = state().builds.find((b) => b.id === req.params.id);
  if (!build) return fail(res, '构建记录不存在', 404);
  ok(res, { id: build.id, status: build.status, logs: build.logs });
}));

app.post('/api/deploy', wrap(async (req, res) => {
  requireBody(req.body, ['buildId', 'serverId']);
  ok(res, await deployBuild(req.body));
}));

app.get('/api/deploys', (req, res) => ok(res, { items: state().deploys }));

/* ------------------------------ 服务器管理 ------------------------------- */

app.get('/api/servers', (req, res) => ok(res, {
  items: state().servers.map(publicServer),
}));

app.post('/api/servers', wrap(async (req, res) => {
  requireBody(req.body, ['name', 'host', 'username']);
  if (!req.body.password && !req.body.privateKey && !req.body.privateKeyPath) {
    throw new Error('需要登录密码、私钥 PEM 或私钥文件路径其一');
  }
  const server = {
    id: req.body.id || uid('srv'),
    name: String(req.body.name), host: String(req.body.host),
    port: Number(req.body.port || 22), username: String(req.body.username),
    password: req.body.password || '',
    privateKey: req.body.privateKey || '',
    privateKeyPath: req.body.privateKeyPath || '',
    passphrase: req.body.passphrase || '',
    deployDir: String(req.body.deployDir || '/data/platform'),
    createdAt: new Date().toISOString(),
  };
  update((s) => {
    const index = s.servers.findIndex((x) => x.id === server.id);
    if (index >= 0) s.servers[index] = server; else s.servers.push(server);
  });
  ok(res, publicServer(server));
}));

app.delete('/api/servers/:id', wrap(async (req, res) => {
  update((s) => { s.servers = s.servers.filter((x) => x.id !== req.params.id); });
  ok(res, { deleted: req.params.id });
}));

const findServer = (id) => {
  const server = state().servers.find((s) => s.id === id);
  if (!server) throw new Error('服务器不存在');
  return server;
};

app.post('/api/servers/:id/test', wrap(async (req, res) => {
  const result = await sshExec(findServer(req.params.id), 'echo ok && uname -a', 15000);
  ok(res, { online: result.code === 0, output: result.stdout, error: result.stderr });
}));

app.get('/api/servers/:id/status', wrap(async (req, res) => {
  ok(res, await collectStatus(findServer(req.params.id)));
}));

app.post('/api/servers/:id/exec', wrap(async (req, res) => {
  requireBody(req.body, ['command']);
  const command = String(req.body.command);
  // 未设置 ADMIN_TOKEN 时只允许只读白名单，避免平台变成任意命令执行入口。
  if (!config.adminToken && !READ_COMMANDS.includes(command)) {
    throw new Error('当前未设置 ADMIN_TOKEN，仅允许只读诊断命令');
  }
  ok(res, await sshExec(findServer(req.params.id), command, 30000));
}));

/* --------------------------- 远程文件管理 (SFTP) -------------------------- */
// 与「存储 / 文件」页的 OpenList 不同：这里直接操作服务器文件系统。
// 所有路径都经过 safeRemotePath 校验，删除操作额外保护系统目录。

app.get('/api/servers/:id/files', wrap(async (req, res) => {
  ok(res, await remoteOps.listFiles(findServer(req.params.id), req.query.path));
}));

// 读取文件内容 + 类型识别（后缀 → 语言 / CodeMirror mode、图片或二进制）、编码与换行符识别。
app.get('/api/servers/:id/files/content', wrap(async (req, res) => {
  const p = remoteOps.safeRemotePath(req.query.path);
  ok(res, await remoteOps.readTextFile(findServer(req.params.id), p, req.query.encoding || 'auto'));
}));

app.get('/api/servers/:id/files/download', wrap(async (req, res) => {
  const p = remoteOps.safeRemotePath(req.query.path);
  const buffer = await remoteOps.readFile(findServer(req.params.id), p, 100 * 1024 * 1024);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(p))}`,
    'content-length': String(buffer.length),
    'cache-control': 'no-store',
  });
  res.end(buffer);
}));

// 按用户选择的编码 / 换行符 / BOM 写回；不传这些字段时等价于 UTF-8 + LF（兼容旧调用）。
app.put('/api/servers/:id/files/content', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.path || b.content === undefined || b.content === null) throw new Error('缺少 path 或 content');
  const p = remoteOps.safeRemotePath(b.path);
  ok(res, await remoteOps.writeTextFile(findServer(req.params.id), p, String(b.content), {
    encoding: b.encoding || 'utf-8',
    newline: b.newline || 'LF',
    bom: b.bom === true || b.bom === 'true',
  }));
}));

app.post('/api/servers/:id/files/create', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'name']);
  ok(res, await remoteOps.createFile(findServer(req.params.id), req.body.path, req.body.name, req.body.content || ''));
}));

app.put('/api/servers/:id/files/upload', wrap(async (req, res) => {
  const dir = remoteOps.safeRemotePath(req.query.path);
  const target = remoteOps.joinRemote(dir, req.query.name);
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  ok(res, await remoteOps.writeFile(findServer(req.params.id), target, buffer));
}), { raw: true });

app.post('/api/servers/:id/files/mkdir', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'name']);
  ok(res, await remoteOps.makeDir(findServer(req.params.id), req.body.path, req.body.name));
}));

app.post('/api/servers/:id/files/rename', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'name']);
  ok(res, await remoteOps.rename(findServer(req.params.id), req.body.path, req.body.name));
}));

app.post('/api/servers/:id/files/delete', wrap(async (req, res) => {
  requireBody(req.body, ['path', 'names']);
  ok(res, await remoteOps.remove(findServer(req.params.id), req.body.path, req.body.names));
}));

/* -------------------------- 交互式 SSH Web 终端 --------------------------- */
// SSE 单向推送终端输出，POST 送入键盘输入；不引入 WebSocket 依赖。

app.post('/api/servers/:id/terminal/open', wrap(async (req, res) => {
  ok(res, await remoteOps.openTerminal(findServer(req.params.id), req.body || {}));
}));

app.get('/api/servers/:id/terminal/stream', (req, res) => {
  remoteOps.attachStream(String(req.query.sid || ''), req, res);
});

app.post('/api/servers/:id/terminal/input', wrap(async (req, res) => {
  requireBody(req.body, ['sid', 'input']);
  ok(res, remoteOps.terminalInput(String(req.body.sid), String(req.body.input)));
}));

app.post('/api/servers/:id/terminal/resize', wrap(async (req, res) => {
  requireBody(req.body, ['sid']);
  ok(res, remoteOps.terminalResize(String(req.body.sid), req.body.cols, req.body.rows));
}));

app.post('/api/servers/:id/terminal/close', wrap(async (req, res) => {
  requireBody(req.body, ['sid']);
  ok(res, remoteOps.closeTerminal(String(req.body.sid)));
}));

app.get('/api/servers/:id/terminals', (req, res) => ok(res, {
  items: remoteOps.activeTerminals().filter((t) => t.serverId === req.params.id),
}));

/* ------------------------------- AI 服务配置 ----------------------------- */

app.get('/api/ai/providers', (req, res) => ok(res, {
  items: state().aiProviders.map(publicProvider),
}));

app.post('/api/ai/providers', wrap(async (req, res) => {
  const b = req.body || {};
  requireBody(b, ['name', 'kind']);
  const kind = b.kind === 'cli' ? 'cli' : 'api';
  const existing = b.id ? state().aiProviders.find((p) => p.id === b.id) : null;
  const common = {
    id: b.id || uid('ai'),
    kind,
    name: String(b.name),
    proxy: String(b.proxy || ''),
    enabled: b.enabled !== false,
  };
  let provider;

  if (kind === 'cli') {
    const command = b.command === 'custom'
      ? String(b.customCommand || '').trim()
      : String(b.command || '').trim();
    if (!command) throw new Error('请选择或填写本地 AI 程序命令');
    provider = {
      ...common,
      runner: b.runner === 'wsl' ? 'wsl' : 'host',
      distro: String(b.distro || ''),
      command: String(b.command || 'custom'),
      customCommand: String(b.customCommand || ''),
      extraArgs: String(b.extraArgs || ''),
      timeoutMs: Number(b.timeoutMs || 180000),
      baseURL: '', model: '', apiKey: '', headers: '', noKey: true,
    };
  } else {
    if (!b.baseURL || !b.model) throw new Error('API 服务需要 Base URL 与模型名称');
    provider = {
      ...common,
      baseURL: String(b.baseURL).replace(/\/+$/, ''),
      model: String(b.model),
      apiKey: (!b.apiKey || String(b.apiKey).includes('****')) && existing
        ? existing.apiKey : String(b.apiKey || ''),
      headers: b.headers || '',
      noKey: Boolean(b.noKey),
    };
  }

  update((s) => {
    const index = s.aiProviders.findIndex((p) => p.id === provider.id);
    if (index >= 0) s.aiProviders[index] = provider; else s.aiProviders.push(provider);
  });
  ok(res, publicProvider(provider));
}));

app.delete('/api/ai/providers/:id', wrap(async (req, res) => {
  update((s) => { s.aiProviders = s.aiProviders.filter((p) => p.id !== req.params.id); });
  ok(res, { deleted: req.params.id });
}));

// 检测宿主机与 WSL 中已安装的 AI 程序（结果缓存 5 分钟，refresh=1 强制重扫）。
app.get('/api/ai/local/programs', wrap(async (req, res) => {
  ok(res, detectLocalPrograms(req.query.refresh === '1'));
}));

// 保存前先用当前表单配置试跑一次本地 CLI。
app.post('/api/ai/local/test', wrap(async (req, res) => {
  const b = req.body || {};
  const provider = {
    kind: 'cli', name: '临时测试',
    command: String(b.command || 'codex'),
    customCommand: String(b.customCommand || ''),
    runner: b.runner === 'wsl' ? 'wsl' : 'host',
    distro: String(b.distro || ''),
    extraArgs: String(b.extraArgs || ''),
    timeoutMs: Number(b.timeoutMs || 60000),
    proxy: String(b.proxy || ''),
  };
  const output = await runCli(provider, String(b.prompt || '用一句话说明你是什么程序，不要执行任何操作。'));
  ok(res, {
    output, command: provider.command, runner: provider.runner,
    distro: provider.distro, proxy: provider.proxy || '未设置',
  });
}));

// 用当前表单配置试跑一次（API 与本地 CLI 通用），保存前即可验证。
app.post('/api/ai/test', wrap(async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'cli' ? 'cli' : 'api';
  let provider;
  if (kind === 'cli') {
    provider = {
      kind, name: '临时测试', command: String(b.command || 'codex'),
      customCommand: String(b.customCommand || ''),
      runner: b.runner === 'wsl' ? 'wsl' : 'host', distro: String(b.distro || ''),
      extraArgs: String(b.extraArgs || ''), timeoutMs: Number(b.timeoutMs || 60000),
      proxy: String(b.proxy || ''),
    };
  } else {
    provider = {
      kind, name: '临时测试', baseURL: String(b.baseURL || '').replace(/\/+$/, ''),
      model: String(b.model || ''), apiKey: String(b.apiKey || ''),
      headers: b.headers || '', noKey: Boolean(b.noKey), proxy: String(b.proxy || ''),
    };
    // 编辑已有服务时表单里的 Key 会留空，回退到已保存的 Key。
    if (!provider.apiKey && b.id) {
      const saved = state().aiProviders.find((p) => p.id === b.id);
      if (saved && saved.apiKey) provider.apiKey = saved.apiKey;
    }
  }
  const response = await aiChat(provider, [
    { role: 'user', content: String(b.prompt || '用一句话说明你是什么，不要执行任何操作。') },
  ]);
  ok(res, {
    kind,
    answer: response.choices?.[0]?.message?.content || '',
    command: provider.command || '', runner: provider.runner || '',
    proxy: provider.proxy || '未设置',
  });
}));

const findProvider = (id) => {
  const provider = state().aiProviders.find((p) => p.id === id)
    || state().aiProviders.find((p) => p.enabled !== false);
  if (!provider) throw new Error('请先配置 AI 服务');
  return provider;
};

app.post('/api/ai/chat', wrap(async (req, res) => {
  requireBody(req.body, ['prompt']);
  const provider = findProvider(req.body.providerId);
  const response = await aiChat(provider, [
    { role: 'system', content: '你是开发平台助手，回答简洁、用简体中文。' },
    { role: 'user', content: String(req.body.prompt) },
  ]);
  ok(res, {
    provider: provider.name,
    model: provider.kind === 'cli'
      ? `${provider.command === 'custom' ? provider.customCommand : provider.command} (${provider.runner === 'wsl' ? 'WSL' : '宿主机'})`
      : provider.model,
    answer: response.choices?.[0]?.message?.content || '',
    usage: response.usage || null,
  });
}));

app.post('/api/ai/ops', wrap(async (req, res) => {
  requireBody(req.body, ['prompt']);
  ok(res, await opsAgent({
    providerId: req.body.providerId,
    prompt: String(req.body.prompt),
    allowWrite: Boolean(req.body.allowWrite),
  }));
}));

app.get('/api/ai/tools', (req, res) => ok(res, { readCommands: READ_COMMANDS }));

/* ----------------------- 扩展 / 数据库（manifest v1） ----------------------- */
// 三类运行形态统一由这一组接口管理：
//   docker    平台创建带标签的长期容器（Docker Engine API / SSH 之外的本机路径）
//   external  只登记外部数据库的地址与凭据，不安装、不改动远端服务
// 无 Docker 时前端默认切到 external，安装页不会隐式拉取任何东西。
// 明文连接串单独走 /connection，列表接口一律脱敏。

app.get('/api/extensions/catalog', wrap(async (req, res) => {
  ok(res, await extensions.listCatalog());
}));

app.get('/api/extensions/instances', wrap(async (req, res) => {
  ok(res, extensions.listInstances());
}));

app.post('/api/extensions/instances', wrap(async (req, res) => {
  ok(res, await extensions.createInstance(req.body || {}));
}));

app.get('/api/extensions/instances/:id', wrap(async (req, res) => {
  const inst = extensions.findInstance(req.params.id);
  if (!inst) return fail(res, '扩展实例不存在', 404);
  ok(res, extensions.publicInstance(inst));
}));

app.post('/api/extensions/instances/:id/action', wrap(async (req, res) => {
  const action = String((req.body && req.body.action) || '');
  if (!['start', 'stop', 'restart'].includes(action)) return fail(res, '不支持的操作', 400);
  ok(res, await extensions.actionInstance(req.params.id, action));
}));

app.post('/api/extensions/instances/:id/health', wrap(async (req, res) => {
  ok(res, await extensions.healthOf(req.params.id));
}));

app.post('/api/extensions/instances/:id/inject', wrap(async (req, res) => {
  const target = String((req.body && req.body.target) || '.env');
  ok(res, extensions.injectEnv(req.params.id, target));
}));

app.get('/api/extensions/instances/:id/connection', wrap(async (req, res) => {
  ok(res, extensions.connectionOfInstance(req.params.id));
}));

app.get('/api/extensions/instances/:id/logs', wrap(async (req, res) => {
  ok(res, await extensions.logsOf(req.params.id, Number(req.query.tail) || 200));
}));

app.delete('/api/extensions/instances/:id', wrap(async (req, res) => {
  const purge = req.query.purge === '1' || req.query.purge === 'true';
  ok(res, await extensions.removeInstance(req.params.id, purge));
}));

/* -------------------------------- 静态界面 ------------------------------- */

app.useStatic(config.publicDir);

const server = app.listen(config.port, () => {
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  console.log(`[devplatform] 控制台已启动: http://localhost:${config.port}`);
  console.log(`[devplatform] 工作区: ${config.workspaceDir} | 运行模式: 正常（无演示数据）`);
});

// 引导器 reload / 更新时发 SIGTERM：先停止接新请求，SSE 长连接最多等 2s 后退出，
// 监督进程会立刻拉起加载新 bundle.cjs 的 worker，实现 1~2s 的平滑热替换。
process.on('SIGTERM', () => {
  console.log('[devplatform] 收到重载信号，正在关闭连接…');
  server.close(() => process.exit(0));
  const timer = setTimeout(() => process.exit(0), 2000);
  if (timer.unref) timer.unref();
});
