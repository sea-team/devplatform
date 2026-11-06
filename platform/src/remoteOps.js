'use strict';

/**
 * 服务器远程操作：SFTP 文件管理 + 交互式 SSH 终端。
 * 只依赖 ssh2（容器里已安装）；所有连接用完即关，终端会话按 sid 常驻并带空闲回收。
 */
const crypto = require('crypto');
const path = require('path');
const { sshOptions } = require('./integrations');
const fileTypes = require('./fileTypes');

let Client = null;
try { ({ Client } = require('ssh2')); } catch { Client = null; }
const requireSSH = () => {
  if (!Client) throw new Error('缺少 ssh2 依赖：请在平台目录执行 npm install');
};

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SESSION_IDLE_MS = 15 * 60 * 1000;

// 禁止直接删除的系统路径，避免误操作把服务器搞坏。
const PROTECTED = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/media', '/mnt',
  '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var', '/data',
]);

function safeRemotePath(input, fallback = '/data/platform') {
  const value = String(input || fallback).trim();
  if (!value.startsWith('/')) throw new Error('远程路径必须是绝对路径');
  if (/[\0\r\n]/.test(value)) throw new Error('路径含非法字符');
  const parts = value.split('/');
  if (parts.includes('..')) throw new Error('路径中不允许 ..');
  return `/${parts.filter(Boolean).join('/')}` || '/';
}

function joinRemote(dir, name) {
  const clean = String(name || '').trim();
  if (!clean || clean === '.' || clean === '..' || /[/\\\0\r\n]/.test(clean)) {
    throw new Error('文件名不合法');
  }
  return safeRemotePath(`${dir.replace(/\/+$/, '')}/${clean}`);
}

function assertMutable(target) {
  const p = safeRemotePath(target);
  if (PROTECTED.has(p)) throw new Error(`禁止删除系统路径：${p}`);
  return p;
}

/* ------------------------------ SFTP 基础封装 ----------------------------- */

function withSftp(server, fn) {
  requireSSH();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      conn.end();
      if (err) reject(err); else resolve(value);
    };
    conn.on('error', (err) => finish(err));
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) return finish(err);
        Promise.resolve(fn(sftp)).then((v) => finish(null, v), (e) => finish(e));
      });
    });
    conn.connect(sshOptions(server));
  });
}

const call = (sftp, method, ...args) => new Promise((resolve, reject) => {
  sftp[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
});

const listDir = (sftp, p) => call(sftp, 'readdir', p);
const statPath = (sftp, p) => call(sftp, 'stat', p);

/* -------------------------------- 文件浏览 ------------------------------- */

function describe(entry, parent) {
  const attrs = entry.attrs || {};
  const isDir = typeof attrs.isDirectory === 'function' ? attrs.isDirectory() : Boolean(attrs.mode & 0o40000);
  const meta = isDir ? { kind: 'dir', label: '目录', icon: 'DIR', color: 'blue', editable: false }
    : fileTypes.fileMeta(entry.filename);
  return {
    name: entry.filename,
    path: joinRemote(parent, entry.filename),
    isDir,
    size: Number(attrs.size || 0),
    mode: attrs.mode || 0,
    mtime: attrs.mtime ? new Date(Number(attrs.mtime) * 1000).toISOString() : null,
    kind: meta.kind,
    language: meta.label,
    icon: meta.icon,
    color: meta.color,
    editable: meta.editable,
  };
}

async function listFiles(server, remotePath) {
  const p = safeRemotePath(remotePath);
  return withSftp(server, async (sftp) => {
    const entries = await listDir(sftp, p);
    const items = entries
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => describe(e, p))
      .sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name));
    return {
      path: p,
      parent: path.posix.dirname(p) === p ? '/' : path.posix.dirname(p),
      items,
      total: items.length,
    };
  });
}

async function readFile(server, remotePath, maxBytes = MAX_TEXT_BYTES) {
  const p = safeRemotePath(remotePath);
  return withSftp(server, (sftp) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    const stream = sftp.createReadStream(p, { highWaterMark: 64 * 1024 });
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        done(new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB，请用「下载」保存到本地`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (err) => done(err));
    stream.on('close', () => done(null, Buffer.concat(chunks)));
  }));
}

async function writeFile(server, remotePath, buffer) {
  const p = safeRemotePath(remotePath);
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('上传内容为空或超过 100 MB');
  }
  return withSftp(server, (sftp) => new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(p);
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve({ path: p, size: buffer.length });
    };
    stream.on('error', done);
    stream.on('close', () => done(null));
    stream.end(buffer);
  }));
}

/**
 * 读取文件并按后缀识别语言、按 BOM/内容识别编码、按换行符归一化。
 * 返回的 content 始终使用 \n 换行，供 CodeMirror 直接显示。
 */
async function readTextFile(server, remotePath, encoding = 'auto') {
  const p = safeRemotePath(remotePath);
  const buffer = await readFile(server, p);
  const info = fileTypes.analyzeBuffer(path.posix.basename(p), buffer, encoding);
  return {
    path: p,
    ...info,
    encodings: fileTypes.ENCODINGS,
    newlines: fileTypes.NEWLINES,
    languages: fileTypes.LANGUAGE_OPTIONS,
  };
}

/** 按用户选择的编码 / 换行符 / BOM 写回文本文件。 */
async function writeTextFile(server, remotePath, text, options = {}) {
  const p = safeRemotePath(remotePath);
  const { buffer, encoding, newline } = fileTypes.encodeContent(text, options);
  const result = await writeFile(server, p, buffer);
  return { ...result, encoding, newline, bom: Boolean(options.bom) };
}

/** 新建空文件（已存在则报错，避免误覆盖）。 */
async function createFile(server, dir, name, content = '') {
  const target = joinRemote(safeRemotePath(dir), name);
  return withSftp(server, async (sftp) => {
    try {
      await statPath(sftp, target);
      throw new Error(`文件已存在：${target}`);
    } catch (e) {
      if (e.message.startsWith('文件已存在')) throw e;
    }
    const { buffer } = fileTypes.encodeContent(content, { encoding: 'utf-8', newline: 'LF' });
    await new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(target);
      let settled = false;
      const done = (err) => { if (!settled) { settled = true; (err ? reject(err) : resolve()); } };
      stream.on('error', done);
      stream.on('close', () => done(null));
      stream.end(buffer);
    });
    return { path: target, size: buffer.length };
  });
}

async function makeDir(server, dir, name) {
  const target = joinRemote(safeRemotePath(dir), name);
  return withSftp(server, async (sftp) => {
    await call(sftp, 'mkdir', target);
    return { path: target };
  });
}

async function rename(server, targetPath, newName) {
  const from = safeRemotePath(targetPath);
  const to = joinRemote(path.posix.dirname(from), newName);
  return withSftp(server, async (sftp) => {
    await call(sftp, 'rename', from, to);
    return { from, to };
  });
}

async function removeTree(sftp, p, depth = 0) {
  if (depth > 12) throw new Error('目录层级过深，已中止删除');
  const st = await statPath(sftp, p);
  if (typeof st.isDirectory === 'function' && st.isDirectory()) {
    const entries = await listDir(sftp, p);
    for (const entry of entries.filter((e) => e.filename !== '.' && e.filename !== '..')) {
      await removeTree(sftp, `${p}/${entry.filename}`, depth + 1);
    }
    await call(sftp, 'rmdir', p);
  } else {
    await call(sftp, 'unlink', p);
  }
}

async function remove(server, dir, names) {
  const base = safeRemotePath(dir);
  const targets = (Array.isArray(names) ? names : [names])
    .map((n) => joinRemote(base, n))
    .map(assertMutable);
  if (!targets.length) throw new Error('没有要删除的文件');
  return withSftp(server, async (sftp) => {
    for (const target of targets) await removeTree(sftp, target);
    return { removed: targets };
  });
}

/* ---------------------------- 交互式 SSH 终端 ----------------------------- */

const sessions = new Map();

function closeSession(session, reason = '') {
  if (session.closed) return;
  session.closed = true;
  clearInterval(session.timer);
  try { if (session.stream) session.stream.end(); } catch { /* noop */ }
  try { session.conn.end(); } catch { /* noop */ }
  if (reason) {
    for (const res of session.subscribers) {
      try { res.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`); } catch { /* noop */ }
    }
  }
  for (const res of session.subscribers) {
    try { res.end(); } catch { /* noop */ }
  }
  session.subscribers.clear();
  sessions.delete(session.sid);
}

function broadcast(session, chunk) {
  const frame = `data: ${chunk.toString('base64')}\n\n`;
  if (!session.subscribers.size) {
    session.pending.push(frame);
    if (session.pending.length > 400) session.pending.splice(0, session.pending.length - 400);
    return;
  }
  for (const res of session.subscribers) {
    try { res.write(frame); } catch { session.subscribers.delete(res); }
  }
}

async function openTerminal(server, options = {}) {
  requireSSH();
  const cols = Math.min(240, Math.max(40, Number(options.cols) || 100));
  const rows = Math.min(80, Math.max(10, Number(options.rows) || 30));
  const sid = crypto.randomBytes(10).toString('hex');
  const conn = new Client();
  const session = {
    sid, conn, stream: null, serverId: server.id, serverName: server.name,
    subscribers: new Set(), pending: [], closed: false,
    lastActive: Date.now(), timer: null, cols, rows,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      closeSession(session);
      reject(err);
    };
    conn.on('error', fail);
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return fail(err);
        session.stream = stream;
        stream.on('data', (chunk) => broadcast(session, chunk));
        if (stream.stderr) stream.stderr.on('data', (chunk) => broadcast(session, chunk));
        stream.on('close', () => closeSession(session, '远程连接已关闭'));
        if (!settled) {
          settled = true;
          sessions.set(sid, session);
          session.timer = setInterval(() => {
            if (Date.now() - session.lastActive > SESSION_IDLE_MS && !session.subscribers.size) {
              closeSession(session, '会话空闲超时');
            }
          }, 30000);
          resolve({ sid, cols, rows, server: server.name });
        }
      });
    });
    conn.connect(sshOptions(server));
  });
}

function attachStream(sid, req, res) {
  const session = sessions.get(sid);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  if (!session || session.closed) {
    res.write('event: closed\ndata: {"reason":"会话不存在或已关闭"}\n\n');
    res.end();
    return;
  }
  res.write(': connected\n\n');
  for (const frame of session.pending) res.write(frame);
  session.pending = [];
  session.subscribers.add(res);
  session.lastActive = Date.now();

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* noop */ }
  }, 20000);
  const cleanup = () => {
    clearInterval(heartbeat);
    session.subscribers.delete(res);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function terminalInput(sid, input) {
  const session = sessions.get(sid);
  if (!session || session.closed || !session.stream) throw new Error('终端会话不存在或已关闭');
  if (typeof input !== 'string' || !input.length) return { sent: 0 };
  session.stream.write(input);
  session.lastActive = Date.now();
  return { sent: input.length };
}

function terminalResize(sid, cols, rows) {
  const session = sessions.get(sid);
  if (!session || session.closed || !session.stream) throw new Error('终端会话不存在或已关闭');
  session.cols = Math.min(240, Math.max(40, Number(cols) || 100));
  session.rows = Math.min(80, Math.max(10, Number(rows) || 30));
  if (typeof session.stream.setWindow === 'function') {
    session.stream.setWindow(session.rows, session.cols, 0, 0);
  }
  session.lastActive = Date.now();
  return { cols: session.cols, rows: session.rows };
}

function closeTerminal(sid) {
  const session = sessions.get(sid);
  if (!session) return { closed: false };
  closeSession(session, '用户已断开');
  return { closed: true };
}

const activeTerminals = () => Array.from(sessions.values()).map((s) => ({
  sid: s.sid, serverId: s.serverId, serverName: s.serverName,
  cols: s.cols, rows: s.rows, lastActive: new Date(s.lastActive).toISOString(),
}));

module.exports = {
  safeRemotePath, joinRemote,
  listFiles, readFile, writeFile, readTextFile, writeTextFile, createFile,
  makeDir, rename, remove,
  openTerminal, attachStream, terminalInput, terminalResize, closeTerminal, activeTerminals,
};
