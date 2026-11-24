'use strict';

/**
 * rclone 存储层（v0.4.29 · 阶段 1：控制面）。
 *
 * 设计要点：
 *  - 文件操作全部走 rclone CLI（lsjson / cat / copyto / moveto / delete ...），
 *    **不需要 FUSE**，因此平台容器（无 privileged、无 /dev/fuse）也能完整浏览/读写远端；
 *  - 远端配置由平台 state 推导并生成 rclone.conf（600 权限），凭据不回显给前端；
 *  - 子进程一律 spawn(shell:false) + 参数数组 + 子命令白名单；代理 env 复用平台的全局代理配置；
 *  - 与 OpenList 接口并存，响应形状对齐 /api/openlist/files，前端可复用同一套渲染。
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { state, update, uid, appRoot, badRequest } = require('./core');
const proxy = require('./proxy');

const DATA_DIR = process.env.DATA_DIR || path.join(appRoot, 'data');
// 容器内 DATA_DIR 是 /app/data，但 docker.sock 属于宿主机，bind mount 必须用宿主机路径。
const HOST_DATA_DIR = process.env.HOST_DATA_DIR || DATA_DIR;
const DEFAULT_CONF_DIR = path.join(DATA_DIR, 'rclone');
const BIN_DIR = path.join(DATA_DIR, 'bin');
const TMP_DIR = path.join(DEFAULT_CONF_DIR, 'tmp');

const TYPES = ['webdav', 's3', 'sftp', 'local', 'ftp', 'dropbox', 'gdrive', 'onedrive'];
const SECRET_KEYS = new Set(['pass', 'password', 'secret_access_key', 'token', 'client_secret']);
const ALLOWED = new Set([
  'version', 'obscure', 'listremotes', 'lsjson', 'lsd', 'cat', 'copyto', 'copy', 'moveto', 'move',
  'mkdir', 'rmdir', 'delete', 'link', 'size', 'check', 'about', 'config',
]);
const REMOTE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[a-z][a-z0-9_-]{0,40}$/;

function configDir() {
  return String((state().rclone || {}).configDir || DEFAULT_CONF_DIR);
}
function confPath() {
  return path.join(configDir(), 'rclone.conf');
}

function binaryCandidates() {
  const configured = String((state().rclone || {}).bin || '').trim();
  const exe = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
  return [configured, path.join(BIN_DIR, exe), ...(configured ? [] : [exe])].filter(Boolean);
}

function binPath() {
  for (const candidate of binaryCandidates()) {
    if (!candidate) continue;
    if (candidate.includes(path.sep) || candidate.includes('/') || candidate.includes('\\')) {
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* noop */ }
    } else {
      const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate],
        { encoding: 'utf8', timeout: 5000 });
      if (probe && probe.status === 0) return candidate;
    }
  }
  return '';
}

function proxyEnv() {
  try {
    const resolved = proxy.forGlobal('');
    return proxy.envFor(resolved);
  } catch { return {}; }
}

/** 执行 rclone 子命令，返回 Buffer（文本调用用 execText）。 */
function exec(args, options = {}) {
  const bin = binPath();
  if (!bin) throw new Error('未找到 rclone 可执行文件：请在「rclone 挂载」页指定路径，或把二进制放到 data/bin/');
  const sub = String(args[0] || '');
  if (!ALLOWED.has(sub)) throw badRequest(`rclone 子命令未在白名单内：${sub}`);
  const { timeout = 30000, maxBytes = 64 * 1024 * 1024, envExtra = {} } = options;
  const fullArgs = ['--config', confPath(), ...args.map((x) => String(x))];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, fullArgs, {
      shell: false, windowsHide: true,
      env: { ...process.env, ...proxyEnv(), ...envExtra },
    });
    const out = [];
    const err = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } }, timeout);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    child.stdout && child.stdout.on('data', (b) => {
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
      bytes += buf.length;
      if (bytes > maxBytes) { try { child.kill(); } catch { /* noop */ } return; }
      out.push(buf);
    });
    child.stderr && child.stderr.on('data', (b) => {
      err.push(Buffer.isBuffer(b) ? b : Buffer.from(b));
    });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => finish(resolve, {
      code: Number(code || 0),
      stdout: Buffer.concat(out),
      stderr: Buffer.concat(err).toString('utf8').trim(),
    }));
  });
}

async function execText(args, options) {
  const r = await exec(args, options);
  const text = r.stdout.toString('utf8').trim();
  if (r.code !== 0) throw new Error(text || r.stderr || `rclone ${args[0]} 退出码 ${r.code}`);
  return text;
}

/**
 * 在 Docker 环境里把静态 rclone 二进制装到 data/bin（该目录被部署脚本排除，重启不丢）。
 * 借助已有 docker.sock 跑一次性 alpine 容器，不往平台容器/宿主机装包。
 */
async function installBinary() {
  if (process.platform === 'win32') {
    return { ok: false, hint: 'Windows 请自行安装 rclone.exe（winget install Rclone.Rclone），或放到 data/bin/ 后在界面指定路径' };
  }
  fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  const docker = require('./dockerApi');
  const logs = [];
  const code = await docker.runContainer({
    image: 'node:20-alpine',
    hostPath: path.join(HOST_DATA_DIR, 'bin'),
    name: `dp-rclone-install-${Date.now()}`,
    script: 'apk add --no-cache rclone >/dev/null 2>&1 && cp /usr/bin/rclone /src/rclone && chmod 755 /src/rclone && /src/rclone version | head -1',
    onData: (chunk) => logs.push(String(chunk || '')),
    timeoutMs: 300000,
  });
  if (code !== 0) throw new Error(`安装失败（退出码 ${code}）：${logs.join('').slice(-400)}`);
  return { ok: true, bin: path.join(BIN_DIR, 'rclone'), version: version() };
}

function version() {
  try {
    const bin = binPath();
    if (!bin) return { installed: false, bin: '', version: '' };
    const first = String(spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 8000 }).stdout || '')
      .split('\n').map((x) => x.trim()).find(Boolean) || '';
    return { installed: true, bin, version: first };
  } catch (e) {
    return { installed: false, bin: '', version: '', error: e.message };
  }
}

/* ------------------------------ 远端配置 ------------------------------ */

function validateFields(type, fields) {
  if (!TYPES.includes(type)) throw badRequest(`不支持的 rclone 后端类型：${type}`);
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(fields || {})) {
    if (!KEY_RE.test(rawKey)) throw badRequest(`配置键不合法：${rawKey}`);
    const value = String(rawValue == null ? '' : rawValue);
    if (/[\r\n\0]/.test(value)) throw badRequest(`配置项 ${rawKey} 不能包含换行`);
    out[rawKey] = value;
  }
  if ((type === 'webdav' || type === 'ftp') && !out.url && !out.host) throw badRequest('请填写服务地址（url）');
  if (type === 's3' && !out.endpoint) throw badRequest('S3 后端请填写 endpoint');
  if (type === 'sftp' && !out.host) throw badRequest('SFTP 后端请填写 host');
  return out;
}

function publicRemote(r) {
  if (!r) return null;
  const fields = {};
  for (const [k, v] of Object.entries(r.fields || {})) {
    fields[k] = SECRET_KEYS.has(k) ? (v ? '******' : '') : v;
  }
  return { ...r, fields };
}

function remotes() {
  return (state().rcloneRemotes || []).map(publicRemote);
}

function findRemote(ref) {
  const list = state().rcloneRemotes || [];
  const key = String(ref || '').trim();
  if (!key) {
    const active = list.find((x) => x.id === (state().rclone || {}).active);
    return active || list[0] || null;
  }
  return list.find((x) => x.id === key || x.name === key) || null;
}

async function writeConfig() {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 });
  const sections = [];
  for (const r of state().rcloneRemotes || []) {
    if (!REMOTE_NAME_RE.test(String(r.name || ''))) continue;
    const lines = [`[${r.name}]`, `type = ${r.type}`];
    if (r.type === 'webdav' && !(r.fields || {}).vendor) lines.push('vendor = other');
    for (const [k, v] of Object.entries(r.fields || {})) {
      if (!KEY_RE.test(k)) continue;
      const value = String(v).replace(/[\r\n]/g, '');
      // rclone.conf 里的密码必须 obscure，否则 rclone 会尝试 reveal 明文并报 "input too short"。
      if (SECRET_KEYS.has(k) && value) lines.push(`${k} = ${await execText(['obscure', value])}`);
      else lines.push(`${k} = ${value}`);
    }
    sections.push(lines.join('\n'));
  }
  fs.writeFileSync(confPath(), `${sections.join('\n\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(confPath(), 0o600); } catch { /* Windows 忽略 */ }
  return { file: confPath(), count: sections.length };
}

async function addRemote(body = {}) {
  const name = String(body.name || '').trim();
  if (!REMOTE_NAME_RE.test(name)) throw badRequest('远端名称只允许字母、数字、下划线与连字符（1-64 位）');
  const type = String(body.type || '').trim();
  const fields = validateFields(type, body.fields);
  if ((state().rcloneRemotes || []).some((x) => x.name === name)) throw badRequest(`远端 ${name} 已存在`);
  const remote = {
    id: uid('rcr'), name, type, fields,
    label: String(body.label || name).slice(0, 80),
    createdAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.rcloneRemotes)) s.rcloneRemotes = [];
    s.rcloneRemotes.push(remote);
    if (!s.rclone || !s.rclone.active) s.rclone = { ...(s.rclone || {}), active: remote.id };
  });
  await writeConfig();
  return publicRemote(remote);
}

async function updateRemote(id, body = {}) {
  const found = (state().rcloneRemotes || []).find((x) => x.id === id);
  if (!found) throw new Error(`rclone 远端不存在：${id}`);
  const name = String(body.name || found.name).trim();
  if (!REMOTE_NAME_RE.test(name)) throw badRequest('远端名称不合法');
  const type = String(body.type || found.type).trim();
  const rawFields = body.fields === undefined ? found.fields : body.fields;
  const fields = validateFields(type, rawFields);
  if ((state().rcloneRemotes || []).some((x) => x.id !== id && x.name === name)) throw badRequest(`远端 ${name} 已存在`);
  update((s) => {
    const r = s.rcloneRemotes.find((x) => x.id === id);
    r.name = name; r.type = type; r.fields = fields;
    if (body.label !== undefined) r.label = String(body.label || name).slice(0, 80);
  });
  await writeConfig();
  return publicRemote(findRemote(id));
}

async function removeRemote(id) {
  update((s) => {
    s.rcloneRemotes = (s.rcloneRemotes || []).filter((x) => x.id !== id);
    if (s.rclone && s.rclone.active === id) s.rclone.active = (s.rcloneRemotes[0] || {}).id || '';
  });
  await writeConfig();
  return { removed: id };
}

function activateRemote(id) {
  const found = (state().rcloneRemotes || []).find((x) => x.id === id);
  if (!found) throw new Error(`rclone 远端不存在：${id}`);
  update((s) => { s.rclone = { ...(s.rclone || {}), active: id }; });
  return publicRemote(found);
}

async function listRemoteNames() {
  await writeConfig();
  const text = await execText(['listremotes']);
  return text.split('\n').map((x) => x.trim().replace(/:$/, '')).filter(Boolean);
}

async function probeRemote(ref) {
  const r = findRemote(ref);
  if (!r) throw new Error('没有可用的 rclone 远端');
  await writeConfig();
  const text = await execText(['lsjson', `${r.name}:`, '--max-depth', '1'], { timeout: 20000 });
  let items = [];
  try { items = JSON.parse(text || '[]'); } catch { /* 非 JSON 视为空 */ }
  return { id: r.id, name: r.name, label: r.label, type: r.type, count: items.length };
}

/* ------------------------------ 文件操作 ------------------------------ */

function safePath(p) {
  const value = String(p || '').trim().replace(/\\/g, '/');
  if (/[\0\r\n]/.test(value)) throw badRequest('路径不合法');
  const segs = value.split('/').filter(Boolean);
  if (segs.some((s) => s === '.' || s === '..')) throw badRequest('路径不能包含 . 或 ..');
  return segs.join('/');
}

function target(ref, p) {
  const r = findRemote(ref);
  if (!r) throw new Error('没有可用的 rclone 远端，请先添加');
  if (!REMOTE_NAME_RE.test(r.name)) throw badRequest('远端名称不合法');
  const suffix = safePath(p);
  return `${r.name}:${suffix}`;
}

function safeName(name) {
  const clean = String(name || '').trim();
  if (!clean || clean === '.' || clean === '..' || /[/\\\0\r\n]/.test(clean)) throw badRequest('文件名不合法');
  return clean;
}

function parentOf(p) {
  const segs = safePath(p).split('/').filter(Boolean);
  segs.pop();
  return `/${segs.join('/')}`.replace(/\/$/, '') || '/';
}

async function list(ref, p) {
  await writeConfig();
  const text = await execText(['lsjson', target(ref, p)], { timeout: 30000 });
  let rows = [];
  try { rows = JSON.parse(text || '[]'); } catch { throw new Error('rclone lsjson 返回了非 JSON 内容'); }
  const content = rows.map((x) => ({
    name: String(x.Name || ''),
    size: Number(x.Size || 0),
    isDir: Boolean(x.IsDir),
    modified: x.ModTime || null,
  }));
  return {
    path: `/${safePath(p)}`.replace(/\/$/, '') || '/',
    parent: parentOf(p),
    content, total: content.length,
    provider: 'rclone', write: true,
  };
}

async function mkdir(ref, p, name) {
  await writeConfig();
  const dir = safePath(p);
  const full = `${dir ? `${dir}/` : ''}${safeName(name)}`;
  await execText(['mkdir', target(ref, full)]);
  return { path: `/${full}` };
}

async function rename(ref, p, name, newName) {
  await writeConfig();
  const dir = safePath(p);
  const src = `${dir ? `${dir}/` : ''}${safeName(name)}`;
  const dst = `${dir ? `${dir}/` : ''}${safeName(newName)}`;
  await execText(['moveto', target(ref, src), target(ref, dst)]);
  return { path: `/${dst}` };
}

async function remove(ref, p, names) {
  await writeConfig();
  const listNames = Array.isArray(names) ? names : [names];
  const targets = listNames.map((n) => {
    const dir = safePath(p);
    return target(ref, `${dir ? `${dir}/` : ''}${safeName(n)}`);
  });
  if (!targets.length) throw badRequest('请指定要删除的文件');
  await execText(['delete', ...targets]);
  return { removed: listNames.map(safeName) };
}

async function moveOrCopy(op, ref, srcDir, dstDir, names) {
  await writeConfig();
  const listNames = Array.isArray(names) ? names : [names];
  const src = safePath(srcDir);
  const dst = safePath(dstDir);
  for (const n of listNames) {
    const clean = safeName(n);
    await execText([op, target(ref, `${src ? `${src}/` : ''}${clean}`), target(ref, `${dst ? `${dst}/` : ''}${clean}`)]);
  }
  return { moved: listNames.map(safeName) };
}

async function cat(ref, p, maxBytes = 100 * 1024 * 1024) {
  await writeConfig();
  const r = await exec(['cat', target(ref, p)], { maxBytes, timeout: 60000 });
  if (r.code !== 0) throw new Error(r.stderr || `rclone cat 退出码 ${r.code}`);
  return r.stdout;
}

async function content(ref, p, encoding) {
  const buffer = await cat(ref, p, 2 * 1024 * 1024);
  return require('./fileTypes').analyzeBuffer(path.basename(safePath(p)), buffer, encoding);
}

async function upload(ref, p, name, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest('上传内容为空');
  await writeConfig();
  const tmp = path.join(TMP_DIR, `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`);
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  try {
    const dir = safePath(p);
    const full = `${dir ? `${dir}/` : ''}${safeName(name)}`;
    await execText(['copyto', tmp, target(ref, full)], { timeout: 120000 });
    return { path: `/${full}`, size: buffer.length };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}

async function writeText(ref, p, text, options = {}) {
  const encoded = require('./fileTypes').encodeContent(String(text || ''), options);
  const buffer = encoded.buffer;
  const clean = safePath(p);
  const segs = clean.split('/').filter(Boolean);
  const name = segs.pop() || '';
  return upload(ref, `/${segs.join('/')}`, name, buffer);
}

async function link(ref, p) {
  await writeConfig();
  const text = await execText(['link', target(ref, p)], { timeout: 20000 });
  return { url: text.split('\n').map((x) => x.trim()).find(Boolean) || '' };
}

function status() {
  const v = version();
  return {
    ...v,
    config: confPath(),
    remotes: (state().rcloneRemotes || []).length,
    active: publicRemote(findRemote('')) || null,
  };
}

module.exports = {
  DATA_DIR, HOST_DATA_DIR, defaultConfDir: DEFAULT_CONF_DIR, confPath, binPath, version, status, installBinary,
  exec, execText, proxyEnv,
  remotes, findRemote, addRemote, updateRemote, removeRemote, activateRemote,
  writeConfig, listRemoteNames, probeRemote,
  safePath, safeName, target,
  list, mkdir, rename, remove, move: (...a) => moveOrCopy('moveto', ...a),
  copy: (...a) => moveOrCopy('copyto', ...a), cat, content, upload, writeText, link,
};
