'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { config } = require('./core');
const proxyModule = require('./proxy');

// 可选依赖：本地零依赖也能跑控制台；安装依赖后自动启用 SSH 与 HTTP 代理转发。
// undici 的 ProxyAgent 由 src/proxy.js 统一加载并做能力探测，此处不再重复 require。
let Client = null;
try { ({ Client } = require('ssh2')); } catch { Client = null; }

const requireSSH = () => {
  if (!Client) throw new Error('缺少 ssh2 依赖：请执行 npm install 或使用 docker compose 启动完整环境');
};

const REQUEST_TIMEOUT_MS = 10000;

async function httpJSON(url, options = {}) {
  const { method = 'GET', headers = {}, body, timeout = REQUEST_TIMEOUT_MS } = options;
  const init = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(timeout),
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    if (!init.headers['content-type'] && !init.headers['Content-Type']) {
      init.headers['content-type'] = 'application/json';
    }
  }
  // 未显式指定时走「全局代理」；localhost / 内网由 NO_PROXY 自动绕过。
  // scope 相关链路（Git / AI）会显式传入该作用域解析出的代理，优先级更高。
  const chosen = options.proxy !== undefined
    ? String(options.proxy || '')
    : proxyModule.forGlobal(url).proxy;
  if (chosen) init.dispatcher = proxyModule.dispatcher(chosen);

  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return payload;
}

/* ------------------------------ Git / Gitea ------------------------------ */

/** 内置 Gitea 走 git 作用域链：单项 > Host 规则 > Git 分组 > 全局。 */
function gitHttpProxy(url) {
  return proxyModule.forHttp(url, 'git', {
    host: proxyModule.hostOf(config.giteaUrl), itemId: 'builtin-gitea', url,
  }).proxy;
}

async function gitea(pathname, options = {}) {
  if (!config.giteaToken) throw new Error('未配置 GITEA_TOKEN');
  const url = `${config.giteaUrl}/api/v1${pathname}`;
  return httpJSON(url, {
    ...options,
    proxy: gitHttpProxy(url),
    headers: { Authorization: `token ${config.giteaToken}`, ...(options.headers || {}) },
  });
}

const giteaApi = {
  version: () => {
    const url = `${config.giteaUrl}/api/v1/version`;
    return httpJSON(url, { proxy: gitHttpProxy(url) });
  },
  listRepos: () => gitea('/user/repos?limit=100'),
  createRepo: (payload) => gitea('/user/repos', { method: 'POST', body: payload }),
  listBranches: (owner, repo) => gitea(`/repos/${owner}/${repo}/branches`),
};

/* --------------------------- 存储 / OpenList ---------------------------- */
// OpenList 兼容 AList V3 API：POST /api/fs/list，Header: Authorization: <token>
// 官方文档：https://doc.oplist.org ; WebDAV 路径：/dav/

let _openlistToken = '';

async function openlistToken() {
  if (config.openlistToken) return config.openlistToken;
  if (_openlistToken) return _openlistToken;
  if (!config.openlistPassword) throw new Error('未配置 OPENLIST_TOKEN 或 OPENLIST_PASSWORD');
  const result = await httpJSON(`${config.openlistUrl}/api/auth/login`, {
    method: 'POST',
    body: { username: config.openlistUser, password: config.openlistPassword },
  });
  if (!result || !result.data || !result.data.token) {
    throw new Error('OpenList 登录失败：请检查管理员账号密码');
  }
  _openlistToken = result.data.token;
  return _openlistToken;
}

async function openlist(pathname, options = {}) {
  const token = await openlistToken();
  const url = `${config.openlistUrl}${pathname}`;
  const raw = await httpJSON(url, {
    ...options,
    proxy: proxyModule.forGlobal(url).proxy,
    headers: { Authorization: token, ...(options.headers || {}) },
  });
  // OpenList 用「HTTP 200 + body.code != 200」表达业务错误（token 失效时返回
  // code:500 record not found）。不检查会被 asList() 当成空列表，前端误报成功。
  if (raw && typeof raw === 'object' && 'code' in raw && Number(raw.code) !== 200) {
    const err = new Error(`OpenList ${pathname} 返回 code=${raw.code}：${raw.message || '未知错误'}`);
    err.code = Number(raw.code);
    err.openlistMessage = String(raw.message || '');
    throw err;
  }
  return raw;
}

/** 界面更新 OpenList 连接配置后必须清掉缓存 token，否则仍拿旧服务的令牌去请求。 */
function resetOpenlistToken() { _openlistToken = ''; }

async function openlistUpload(remotePath, buffer) {
  const token = await openlistToken();
  const url = `${config.openlistUrl}/api/fs/put`;
  return httpJSON(url, {
    method: 'PUT',
    proxy: proxyModule.forGlobal(url).proxy,
    headers: {
      Authorization: token,
      'File-Path': encodeURIComponent(remotePath),
      'Content-Length': String(buffer.length),
      'content-type': 'application/octet-stream',
    },
    body: buffer,
    timeout: 120000,
  });
}

const openlistApi = {
  // 通用入口：openlist.js 的存储管理 / 文件 ops 都从这里走，避免多套 token 逻辑。
  request: (pathname, options = {}) => openlist(pathname, options),
  resetToken: resetOpenlistToken,
  token: openlistToken,
  health: () => openlist('/api/public/settings'),
  list: (p = '/', options = {}) => openlist('/api/fs/list', {
    method: 'POST',
    body: {
      path: p, password: options.password || '', page: Number(options.page || 1),
      per_page: Number(options.perPage || 200), refresh: Boolean(options.refresh),
    },
    timeout: 20000,
  }),
  get: (p, password = '') => openlist('/api/fs/get', {
    method: 'POST', body: { path: p, password }, timeout: 20000,
  }),
  mkdir: (p) => openlist('/api/fs/mkdir', { method: 'POST', body: { path: p } }),
  remove: (dir, names) => openlist('/api/fs/remove', { method: 'POST', body: { dir, names } }),
  rename: (pathName, name) => openlist('/api/fs/rename', { method: 'POST', body: { path: pathName, name } }),
  move: (srcDir, dstDir, names) => openlist('/api/fs/move', {
    method: 'POST', body: { src_dir: srcDir, dst_dir: dstDir, names }, timeout: 60000,
  }),
  copy: (srcDir, dstDir, names) => openlist('/api/fs/copy', {
    method: 'POST', body: { src_dir: srcDir, dst_dir: dstDir, names }, timeout: 60000,
  }),
  mounts: () => openlist('/api/admin/storage/list'),
  drivers: () => openlist('/api/admin/driver/list'),
  driverInfo: (driver) => openlist(`/api/admin/driver/info?driver=${encodeURIComponent(driver)}`),
  adminSettings: () => openlist('/api/admin/setting/list'),
  saveStorage: (body, isUpdate) => openlist(isUpdate ? '/api/admin/storage/update' : '/api/admin/storage/create', {
    method: 'POST', body, timeout: 30000,
  }),
  storageAction: (action, id) => openlist(`/api/admin/storage/${action}`, {
    method: 'POST', body: action === 'delete' ? { id } : { id }, timeout: 30000,
  }),
  upload: openlistUpload,
  webdavUrl: () => `${config.openlistUrl.replace(/^http:\/\/openlist/, 'http://localhost')}/dav/`,
};

/* ------------------------------ 服务器 / SSH ----------------------------- */

function sshOptions(server) {
  const options = {
    host: server.host,
    port: Number(server.port || 22),
    username: server.username || 'root',
    readyTimeout: 12000,
    keepaliveInterval: 15000,
  };
  // 私钥来源：优先读取宿主机/容器内的私钥文件，其次使用表单粘贴的 PEM 内容。
  if (server.privateKeyPath) {
    if (!fs.existsSync(server.privateKeyPath)) {
      throw new Error(`私钥文件不存在：${server.privateKeyPath}`);
    }
    options.privateKey = fs.readFileSync(server.privateKeyPath);
  } else if (server.privateKey) {
    options.privateKey = server.privateKey;
  }
  // 加密私钥的口令（passphrase），与登录密码互不影响。
  if (server.passphrase) options.passphrase = server.passphrase;
  if (server.password) options.password = server.password;
  return options;
}

/**
 * 建立 SSH 连接。代理链：单个服务器代理 > 服务器代理 > 全局代理。
 * 命中代理时用 HTTP CONNECT / SOCKS5 隧道作为 ssh2 的 sock，凭据不写入任何文件。
 */
async function sshConnect(server, conn) {
  const host = String(server.host);
  const resolved = proxyModule.resolve('server', {
    itemId: server.id, host, entity: server,
  });
  const options = sshOptions(server);
  if (resolved.url && !proxyModule.shouldBypass(host, resolved.noProxy)) {
    options.sock = await proxyModule.openTunnel(resolved.url, host, Number(server.port || 22));
  }
  conn.connect(options);
  return resolved.masked;
}

function sshExec(server, command, timeout = 20000) {
  requireSSH();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new Error('SSH 执行超时'));
    }, timeout);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      fn(value);
    };

    conn.on('error', (err) => finish(reject, err));
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) return finish(reject, err);
        stream.on('data', (chunk) => { stdout += chunk.toString(); });
        stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        stream.on('close', (code) => finish(resolve, { code, stdout: stdout.trim(), stderr: stderr.trim() }));
      });
    });
    sshConnect(server, conn).catch((err) => finish(reject, err));
  });
}

function sftpPut(server, localPath, remotePath) {
  requireSSH();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; conn.end(); reject(err); };
    conn.on('error', fail);
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) return fail(err);
        const writer = sftp.createWriteStream(remotePath);
        const reader = fs.createReadStream(localPath);
        writer.on('error', fail);
        writer.on('close', () => { if (settled) return; settled = true; conn.end(); resolve(); });
        reader.on('error', fail);
        reader.pipe(writer);
      });
    });
    sshConnect(server, conn).catch(fail);
  });
}

const STATUS_COMMAND = [
  'echo "===HOST==="; hostname',
  'echo "===LOAD==="; cat /proc/loadavg',
  'echo "===MEM==="; free -m | sed -n "2p"',
  'echo "===DISK==="; df -h / | tail -1',
  'echo "===CPU==="; nproc',
  'echo "===DOCKER==="; docker ps --format "{{.Names}}|{{.Status}}" 2>/dev/null | head -20',
  'echo "===TIME==="; date -Is',
].join('; ');

function section(output, name) {
  const marker = `===${name}===`;
  const start = output.indexOf(marker);
  if (start === -1) return '';
  const from = start + marker.length;
  const next = output.indexOf('\n===', from);
  return output.slice(from, next === -1 ? undefined : next).trim();
}

async function collectStatus(server) {
  const { stdout } = await sshExec(server, STATUS_COMMAND, 20000);
  const load = section(stdout, 'LOAD').split(/\s+/);
  const mem = section(stdout, 'MEM').split(/\s+/);
  const disk = section(stdout, 'DISK').split(/\s+/);
  const dockerRaw = section(stdout, 'DOCKER');
  const containers = dockerRaw
    ? dockerRaw.split('\n').filter(Boolean).map((line) => {
        const [name, ...rest] = line.split('|');
        return { name, status: rest.join('|') };
      })
    : [];
  return {
    host: section(stdout, 'HOST'),
    load1: Number(load[0]) || 0,
    load5: Number(load[1]) || 0,
    load15: Number(load[2]) || 0,
    cpuCores: Number(section(stdout, 'CPU')) || 0,
    memory: {
      totalMB: Number(mem[1]) || 0,
      usedMB: Number(mem[2]) || 0,
      usagePct: Number(mem[1]) ? Math.round((Number(mem[2]) / Number(mem[1])) * 100) : 0,
    },
    disk: {
      total: disk[1] || '-',
      used: disk[2] || '-',
      usagePct: disk[4] || '-',
      mount: disk[5] || '/',
    },
    containers,
    checkedAt: section(stdout, 'TIME') || new Date().toISOString(),
    raw: stdout,
  };
}

const publicServer = (s) => ({
  id: s.id, name: s.name, host: s.host, port: s.port, username: s.username,
  hasPassword: Boolean(s.password),
  hasPrivateKey: Boolean(s.privateKey || s.privateKeyPath),
  privateKeyPath: s.privateKeyPath || '',
  hasPassphrase: Boolean(s.passphrase),
  deployDir: s.deployDir || '/data/platform',
  proxy: s.proxy ? proxyModule.maskUrl(s.proxy) : '',
  // 实际生效的代理（含分组 / 全局继承），仅用于展示，不含凭据。
  effectiveProxy: proxyModule.resolve('server', { itemId: s.id, host: s.host, entity: s }).masked,
});

/* ------------------- 本地 AI 程序（宿主机 / WSL） ------------------------ */
// 支持直接调用宿主机已安装的 codex / claude / gemini 等 CLI；
// Windows 下还可选择 WSL 发行版里的程序，并为子进程注入代理环境变量。

const CLI_CANDIDATES = ['codex', 'claude', 'gemini', 'qwen'];
const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
let _programCache = null;
let _programCacheAt = 0;

function runSync(command, args, timeout = 8000) {
  try {
    const result = spawnSync(command, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return {
      status: result.status,
      stdout: result.stdout || Buffer.alloc(0),
      stderr: result.stderr || Buffer.alloc(0),
      error: result.error,
    };
  } catch (error) {
    return { status: -1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error };
  }
}

function decodeOutput(buffer) {
  if (!buffer || !buffer.length) return '';
  const sample = buffer.subarray(0, Math.min(buffer.length, 200));
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  const text = zeros > sample.length * 0.25
    ? buffer.toString('utf16le')
    : buffer.toString('utf8');
  return text.replace(/^\uFEFF/, '').replace(/\r/g, '');
}

function whichCommand(command) {
  const result = process.platform === 'win32'
    ? runSync('where.exe', [command], 6000)
    : runSync('which', [command], 6000);
  if (result.status !== 0) return '';
  return decodeOutput(result.stdout).split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
}

function detectLocalPrograms(force = false) {
  if (!force && _programCache && Date.now() - _programCacheAt < 5 * 60 * 1000) return _programCache;

  const host = [];
  for (const command of CLI_CANDIDATES) {
    const path = whichCommand(command);
    if (path) host.push({ command, path, runner: 'host' });
  }

  const wsl = { available: false, distros: [], error: '' };
  if (process.platform === 'win32') {
    const list = runSync('wsl.exe', ['-l', '-q'], 12000);
    if (list.status !== 0) {
      wsl.error = decodeOutput(list.stderr).trim() || '未检测到 WSL，或 wsl.exe 不可用';
    } else {
      const names = decodeOutput(list.stdout).split('\n')
        .map((s) => s.trim().replace(/\s*\(默认\)\s*$/, '').replace(/\s*\(Default\)\s*$/i, ''))
        .filter(Boolean);
      const probeScript = CLI_CANDIDATES
        .map((c) => `p=$(command -v ${c} 2>/dev/null) && echo "${c}=$p"`)
        .join('; ');
      for (const name of names) {
        const probe = runSync('wsl.exe', ['-d', name, '--', 'bash', '-lc', probeScript], 20000);
        const programs = [];
        if (probe.status === 0) {
          for (const line of decodeOutput(probe.stdout).split('\n')) {
            const match = line.trim().match(/^([A-Za-z0-9_-]+)=(.+)$/);
            if (match && CLI_CANDIDATES.includes(match[1])) {
              programs.push({ command: match[1], path: match[2].trim(), runner: 'wsl' });
            }
          }
        }
        wsl.distros.push({ name, programs, error: probe.status === 0 ? '' : (decodeOutput(probe.stderr).trim() || '探测失败') });
      }
      wsl.available = wsl.distros.length > 0;
    }
  }

  _programCache = { platform: process.platform, host, wsl, detectedAt: new Date().toISOString() };
  _programCacheAt = Date.now();
  return _programCache;
}

/** 单个 AI 服务代理 > AI 服务代理 > 全局代理。 */
function aiProxy(provider) {
  return proxyModule.resolve('ai', {
    itemId: provider.id || '',
    host: proxyModule.hostOf(provider.baseURL),
    url: provider.baseURL || '',
    entity: provider,
  });
}

// 兼容旧调用：既可传解析结果，也可传单个 URL 字符串。
function proxyEnvironment(value) {
  const resolved = value && typeof value === 'object'
    ? value
    : proxyModule.resolve('ai', { entity: { proxy: String(value || '') } });
  return proxyModule.envFor(resolved);
}

function buildCliInvocation(provider, prompt) {
  const raw = provider.command === 'custom'
    ? String(provider.customCommand || '').trim()
    : String(provider.command || '').trim();
  if (!raw) throw new Error('未指定本地 AI 程序命令');
  if (!/^[A-Za-z0-9_./\\:-]+$/.test(raw)) throw new Error('本地 AI 程序命令包含非法字符');
  const extraArgs = String(provider.extraArgs || '').trim().split(/\s+/).filter(Boolean);
  let args;
  if (provider.command === 'custom') {
    args = [...extraArgs, prompt];
  } else if (raw.includes('codex')) {
    // codex exec 是非交互模式；--skip-git-repo-check 允许在非 git 目录运行。
    args = ['exec', '--skip-git-repo-check', ...extraArgs, prompt];
  } else {
    // Claude Code / Gemini CLI 的 print 模式：一次性输出后退出。
    args = ['-p', ...extraArgs, prompt];
  }
  return { command: raw, args };
}

// Windows 上 cmd.exe 会把含换行的参数拆开，且 .cmd/.bat 启动器不能由 Node 直接 spawn。
// 这里先解析出真实可执行文件，尽量走无 shell 的 spawn，并把多行文本压平成单行。
function resolveHostCommand(command) {
  const found = whichCommand(command);
  if (!found) return { file: command, prefix: [], shell: true };
  if (/\.(cmd|bat)$/i.test(found)) {
    return { file: process.env.ComSpec || 'cmd.exe', prefix: ['/d', '/s', '/c', found], shell: false };
  }
  return { file: found, prefix: [], shell: false };
}

function winSafeArgs(args) {
  return args.map((arg) => String(arg).replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f]/g, ' ').trim());
}

function runCli(provider, prompt) {
  return new Promise((resolve, reject) => {
    let invocation;
    try { invocation = buildCliInvocation(provider, prompt); }
    catch (error) { return reject(error); }

    const timeoutMs = Math.max(5000, Number(provider.timeoutMs || 180000));
    const resolved = aiProxy(provider);
    const env = { ...process.env, ...proxyEnvironment(resolved) };
    let child;

    if (provider.runner === 'wsl') {
      if (process.platform !== 'win32') return reject(new Error('WSL 运行位置仅适用于 Windows 宿主机'));
      const distroArgs = provider.distro ? ['-d', provider.distro] : [];
      // direct 时显式清空代理变量，避免 WSL 继承宿主机环境后仍然走代理。
      const proxyPrefix = resolved.url
        ? `export HTTP_PROXY=${shq(resolved.url)} HTTPS_PROXY=${shq(resolved.url)} ALL_PROXY=${shq(resolved.url)} NO_PROXY=${shq(resolved.noProxy)}; `
        : (resolved.direct ? 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; ' : '');
      const commandLine = [invocation.command, ...invocation.args].map(shq).join(' ');
      child = spawn('wsl.exe', [...distroArgs, '--', 'bash', '-lc', `${proxyPrefix}${commandLine}`], {
        env, windowsHide: true,
      });
    } else {
      if (process.platform === 'win32') {
        const target = resolveHostCommand(invocation.command);
        child = spawn(target.file, [...target.prefix, ...winSafeArgs(invocation.args)], {
          env, shell: target.shell, windowsHide: true,
        });
      } else {
        child = spawn(invocation.command, invocation.args, { env, shell: false, windowsHide: true });
      }
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`本地 AI 程序执行超时（${timeoutMs} ms）`));
    }, timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    child.stdout.on('data', (c) => { stdout = (stdout + c.toString()).slice(-200000); });
    child.stderr.on('data', (c) => { stderr = (stderr + c.toString()).slice(-50000); });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) {
        return finish(reject, new Error(`本地 AI 程序退出码 ${code}：${(stderr || stdout).slice(-1200)}`));
      }
      const output = (stdout.trim() || stderr.trim());
      if (!output) return finish(reject, new Error('本地 AI 程序没有返回任何输出'));
      finish(resolve, output);
    });
  });
}

function messagesToPrompt(messages) {
  const labels = { system: '系统说明', user: '用户', assistant: '助手', tool: '工具结果' };
  return messages.map((m) => `[${labels[m.role] || m.role}]\n${m.content || ''}`).join('\n\n');
}

async function cliChat(provider, messages) {
  const output = await runCli(provider, messagesToPrompt(messages));
  return { choices: [{ message: { role: 'assistant', content: output } }], usage: null };
}

/* ------------------------- AI 服务网关 / 代理 ---------------------------- */
// 任何 OpenAI-compatible 服务都可以接入：OpenAI / Claude 中转 / DeepSeek / Ollama / 自建 vLLM 等
// provider.proxy 支持 http:// 或 https:// 代理；也支持 socks5://（需底层支持）。

async function aiChat(provider, messages, tools = []) {
  if (provider.kind === 'cli') return cliChat(provider, messages);
  if (!provider.apiKey && !provider.noKey) throw new Error(`AI 服务「${provider.name}」未配置 API Key`);
  const url = `${String(provider.baseURL || '').replace(/\/+$/, '')}/chat/completions`;
  const body = { model: provider.model, messages, stream: false };
  if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }

  let extraHeaders = {};
  if (provider.headers) {
    try { extraHeaders = typeof provider.headers === 'string' ? JSON.parse(provider.headers) : provider.headers; }
    catch { throw new Error('AI 服务自定义 Headers 不是合法 JSON'); }
  }

  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  };
  const resolved = aiProxy(provider);
  if (resolved.url && !proxyModule.shouldBypass(url, resolved.noProxy)) {
    init.dispatcher = proxyModule.dispatcher(resolved.url);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}: ${text.slice(0, 300)}`);
  if (!payload) throw new Error('AI 服务返回内容不是合法 JSON');
  return payload;
}

const publicProvider = (p) => ({
  ...p,
  apiKey: p.apiKey ? `${String(p.apiKey).slice(0, 4)}****${String(p.apiKey).slice(-4)}` : '',
  proxy: p.proxy ? proxyModule.maskUrl(p.proxy) : '',
  effectiveProxy: aiProxy(p).masked,
});

module.exports = {
  httpJSON, giteaApi, openlistApi,
  sshExec, sshConnect, sftpPut, collectStatus, sshOptions, publicServer,
  aiChat, aiProxy, publicProvider, detectLocalPrograms, runCli, proxyEnvironment, CLI_CANDIDATES,
};
