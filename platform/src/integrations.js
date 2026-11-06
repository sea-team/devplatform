'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { config } = require('./core');

// 可选依赖：本地零依赖也能跑控制台；安装依赖后自动启用 SSH 与代理能力。
let Client = null;
let ProxyAgent = null;
try { ({ Client } = require('ssh2')); } catch { Client = null; }
try { ({ ProxyAgent } = require('undici')); } catch { ProxyAgent = null; }

const requireSSH = () => {
  if (!Client) throw new Error('缺少 ssh2 依赖：请执行 npm install 或使用 docker compose 启动完整环境');
};
const requireProxy = () => {
  if (!ProxyAgent) throw new Error('代理功能需要 undici 依赖：请执行 npm install 或使用 docker compose 启动完整环境');
};

const REQUEST_TIMEOUT_MS = 10000;

async function httpJSON(url, options = {}) {
  const { method = 'GET', headers = {}, body, proxy, timeout = REQUEST_TIMEOUT_MS } = options;
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
  if (proxy) { requireProxy(); init.dispatcher = new ProxyAgent(proxy); }

  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return payload;
}

/* ------------------------------ Git / Gitea ------------------------------ */

async function gitea(pathname, options = {}) {
  if (!config.giteaToken) throw new Error('未配置 GITEA_TOKEN');
  return httpJSON(`${config.giteaUrl}/api/v1${pathname}`, {
    ...options,
    headers: { Authorization: `token ${config.giteaToken}`, ...(options.headers || {}) },
  });
}

const giteaApi = {
  version: () => httpJSON(`${config.giteaUrl}/api/v1/version`),
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
  return httpJSON(`${config.openlistUrl}${pathname}`, {
    ...options,
    headers: { Authorization: token, ...(options.headers || {}) },
  });
}

async function openlistUpload(remotePath, buffer) {
  const token = await openlistToken();
  return httpJSON(`${config.openlistUrl}/api/fs/put`, {
    method: 'PUT',
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
  health: () => openlist('/api/public/settings'),
  list: (p = '/') => openlist('/api/fs/list', {
    method: 'POST',
    body: { path: p, password: '', page: 1, per_page: 200, refresh: false },
  }),
  mkdir: (p) => openlist('/api/fs/mkdir', { method: 'POST', body: { path: p } }),
  remove: (dir, names) => openlist('/api/fs/remove', { method: 'POST', body: { dir, names } }),
  rename: (pathName, name) => openlist('/api/fs/rename', { method: 'POST', body: { path: pathName, name } }),
  mounts: () => openlist('/api/admin/storage/list'),
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
    conn.connect(sshOptions(server));
  });
}

function sftpPut(server, localPath, remotePath) {
  requireSSH();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('error', reject);
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        const writer = sftp.createWriteStream(remotePath);
        const reader = fs.createReadStream(localPath);
        writer.on('error', (e) => { conn.end(); reject(e); });
        writer.on('close', () => { conn.end(); resolve(); });
        reader.on('error', (e) => { conn.end(); reject(e); });
        reader.pipe(writer);
      });
    });
    conn.connect(sshOptions(server));
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

function proxyEnvironment(proxy) {
  if (!proxy) return {};
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1';
  return {
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy,
    http_proxy: proxy, https_proxy: proxy, all_proxy: proxy,
    NO_PROXY: noProxy, no_proxy: noProxy,
  };
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
    const env = { ...process.env, ...proxyEnvironment(provider.proxy) };
    let child;

    if (provider.runner === 'wsl') {
      if (process.platform !== 'win32') return reject(new Error('WSL 运行位置仅适用于 Windows 宿主机'));
      const distroArgs = provider.distro ? ['-d', provider.distro] : [];
      const proxyPrefix = provider.proxy
        ? `export HTTP_PROXY=${shq(provider.proxy)} HTTPS_PROXY=${shq(provider.proxy)} ALL_PROXY=${shq(provider.proxy)} NO_PROXY=${shq(env.NO_PROXY)}; `
        : '';
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
  if (provider.proxy) { requireProxy(); init.dispatcher = new ProxyAgent(provider.proxy); }

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
});

module.exports = {
  httpJSON, giteaApi, openlistApi,
  sshExec, sftpPut, collectStatus, sshOptions, publicServer,
  aiChat, publicProvider, detectLocalPrograms, runCli, proxyEnvironment, CLI_CANDIDATES,
};
