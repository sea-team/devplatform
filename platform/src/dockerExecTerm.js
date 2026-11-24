'use strict';

/**
 * v0.4.30 · Docker 容器交互式终端（PTY 流式接口）。
 *
 * 与 SSH Web 终端同构：SSE 单向推送输出（base64），POST 送入键盘输入 / 窗口尺寸；
 * 不引入 WebSocket 依赖，复用前端已有的 xterm.js + FitAddon。
 *
 * 两种后端：
 *  - 本机（target=local）：Docker Engine API 建 Tty=true 的 exec，再以 connection
 *    hijack（Connection: Upgrade）拿到双向裸 socket，字节直接喂给前端；
 *  - 远端（target=server:<id>）：ssh2 带 pty 执行 `docker exec -it [-u root] <id> <shell>`，
 *    复用 stream 作为双向通道。容器标识走白名单 + 单引号转义，杜绝命令注入。
 *
 * 安全边界：
 *  - 会话按 ownerId 归属，订阅 / 注入 / resize / close 都校验登录用户与 owner 一致
 *    （管理员 / cli / off 例外），避免凭 sid  hijack 别人的容器会话；
 *  - shell 仅允许 bash | sh；root 仅作为 docker exec -u 的参数；
 *  - 15 分钟空闲且无订阅者自动回收，关闭时销毁 socket / stream / SSH 连接。
 */
const crypto = require('crypto');
const { currentUser, HttpError } = require('./core');
const docker = require('./dockerApi');
let ssh2 = null;
try { ssh2 = require('ssh2'); } catch { ssh2 = null; }
const { sshConnect } = require('./integrations');
const remoteDocker = require('./remoteDocker');

const SESSION_IDLE_MS = 15 * 60 * 1000;
const MAX_PENDING = 400;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const sessions = new Map();

function splitTarget(target) {
  const t = String(target || 'local');
  return t.startsWith('server:')
    ? { remote: true, serverId: t.replace(/^server:/, ''), label: t }
    : { remote: false, serverId: '', label: 'local' };
}

function normalizeShell(shell) {
  return shell === 'bash' ? 'bash' : 'sh';
}

/* ------------------------------ 会话生命周期 ------------------------------ */

function closeSession(session, reason = '') {
  if (!session || session.closed) return { closed: false };
  session.closed = true;
  clearInterval(session.timer);
  // 双向通道：本地是 socket，远端是 ssh2 stream（都实现 end/write）。
  try { if (session.channel && session.channel.end) session.channel.end(); } catch { /* noop */ }
  try { if (session.conn && session.conn.end) session.conn.end(); } catch { /* noop */ }
  if (reason) {
    const frame = `event: closed\ndata: ${JSON.stringify({ reason })}\n\n`;
    for (const res of session.subscribers) {
      try { res.write(frame); } catch { /* noop */ }
    }
  }
  for (const res of session.subscribers) {
    try { res.end(); } catch { /* noop */ }
  }
  session.subscribers.clear();
  sessions.delete(session.sid);
  return { closed: true };
}

function broadcast(session, chunk) {
  const frame = `data: ${Buffer.from(chunk).toString('base64')}\n\n`;
  if (!session.subscribers.size) {
    session.pending.push(frame);
    if (session.pending.length > MAX_PENDING) session.pending.splice(0, session.pending.length - MAX_PENDING);
    return;
  }
  for (const res of session.subscribers) {
    try { res.write(frame); } catch { session.subscribers.delete(res); }
  }
}

function canUse(session, user) {
  if (!session || session.closed || !user) return false;
  if (user.role === 'admin' || user.via === 'cli' || user.via === 'off') return true;
  return Boolean(session.ownerId) && session.ownerId === user.id;
}

function ownedSession(sid, user) {
  const session = sessions.get(String(sid || ''));
  if (!canUse(session, user)) throw new HttpError(403, '无权使用该容器终端会话');
  return session;
}

/* ------------------------------ 本机后端 ------------------------------ */

async function openLocal(session, containerId, shell, root, cols, rows) {
  const execId = await docker.execCreateInteractive(containerId, { shell, root });
  const { socket, source, upgradeHead } = await docker.execAttach(execId);
  session.execId = execId;
  session.channel = socket;
  session.cols = cols;
  session.rows = rows;
  // 输出统一来自 source：标准路径是升级后的裸 socket，降级路径是 HTTP 响应流。
  source.on('data', (chunk) => broadcast(session, chunk));
  // 升级握手后可能残留首块输出，必须回推到流里，否则会丢第一个提示符。
  if (upgradeHead && upgradeHead.length) broadcast(session, upgradeHead);
  socket.on('close', () => closeSession(session, '容器终端已退出'));
  socket.on('error', () => closeSession(session, '容器终端连接中断'));
  // 建立后立刻同步一次窗口，让 shell 按前端实际列宽排版。
  await docker.execResize(execId, cols, rows).catch(() => {});
}

/* ------------------------------ 远端后端 ------------------------------ */

async function openRemote(session, serverId, containerId, shell, root, cols, rows) {
  if (!ssh2) throw new Error('缺少 ssh2 依赖：请在平台目录执行 npm install');
  if (!SAFE_ID.test(containerId)) throw new Error('容器标识不合法');
  const server = remoteDocker.findServer(serverId);
  const args = ['docker', 'exec', '-it'];
  if (root) args.push('-u', 'root');
  args.push(remoteDocker.shq(containerId), normalizeShell(shell));
  const command = args.join(' ');
  const conn = new ssh2.Client();
  session.conn = conn;
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
      conn.exec(command, { pty: { term: 'xterm-256color', cols, rows } }, (err, stream) => {
        if (err) return fail(err);
        session.channel = stream;
        stream.on('data', (chunk) => broadcast(session, chunk));
        if (stream.stderr) stream.stderr.on('data', (chunk) => broadcast(session, chunk));
        stream.on('close', () => closeSession(session, '容器终端已退出'));
        if (!settled) { settled = true; resolve(); }
      });
    });
    sshConnect(server, conn).catch(fail);
  });
}

/**
 * 打开一个容器终端会话。返回 { sid, target, container, shell, root, cols, rows }。
 * 容器存在性 / 归属校验由 dockerPanel.assertWritable 在 server.js 侧完成，
 * 这里只负责建立通道，避免与面板层的审计逻辑重复。
 * @param {{ target?: string, containerId?: string, shell?: string, root?: boolean,
 *   cols?: number, rows?: number, user?: any }} [options]
 */
async function openSession({ target, containerId, shell = 'sh', root = false, cols = 100, rows = 28, user } = {}) {
  const t = splitTarget(target);
  const sid = crypto.randomBytes(10).toString('hex');
  const owner = user || currentUser();
  const session = {
    sid, target: t.label, containerId, shell: normalizeShell(shell), root: Boolean(root),
    ownerId: (owner && owner.id) || '',
    subscribers: new Set(), pending: [], closed: false, channel: null, conn: null,
    execId: '', cols, rows, lastActive: Date.now(), timer: null,
  };
  const c = Math.min(240, Math.max(40, Number(cols) || 100));
  const r = Math.min(80, Math.max(10, Number(rows) || 28));
  session.cols = c;
  session.rows = r;
  if (t.remote) await openRemote(session, t.serverId, containerId, session.shell, session.root, c, r);
  else await openLocal(session, containerId, session.shell, session.root, c, r);
  sessions.set(sid, session);
  session.timer = setInterval(() => {
    if (Date.now() - session.lastActive > SESSION_IDLE_MS && !session.subscribers.size) {
      closeSession(session, '会话空闲超时');
    }
  }, 30000);
  return {
    sid, target: t.label, container: containerId, shell: session.shell,
    root: session.root, cols: session.cols, rows: session.rows,
  };
}

/* ------------------------------ SSE / 输入 / 尺寸 ------------------------------ */

function attachStream(sid, req, res) {
  const session = sessions.get(String(sid || ''));
  const writeClosed = () => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('event: closed\ndata: {"reason":"会话不存在或已关闭"}\n\n');
    res.end();
  };
  if (!session || session.closed) return writeClosed();
  // SSE 是长连接，不能用 wrap() 的错误兜底：直接以 403 结束，
  // 让 EventSource 明确报错，而不是挂着一条永远不输出的连接。
  if (!canUse(session, req && req.user)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: '无权订阅该容器终端会话', status: 403 }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
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

function input(sid, text, user) {
  const session = ownedSession(sid, user);
  if (!session.channel || session.closed) throw new Error('容器终端会话不存在或已关闭');
  if (typeof text !== 'string' || !text.length) return { sent: 0 };
  session.channel.write(text);
  session.lastActive = Date.now();
  return { sent: text.length };
}

async function resize(sid, cols, rows, user) {
  const session = ownedSession(sid, user);
  if (!session.channel || session.closed) throw new Error('容器终端会话不存在或已关闭');
  session.cols = Math.min(240, Math.max(40, Number(cols) || 100));
  session.rows = Math.min(80, Math.max(10, Number(rows) || 28));
  // 本机走 Docker exec resize API；远端用 ssh2 的 setWindow。
  if (!splitTarget(session.target).remote && session.execId) {
    await docker.execResize(session.execId, session.cols, session.rows).catch(() => {});
  } else if (typeof session.channel.setWindow === 'function') {
    session.channel.setWindow(session.rows, session.cols, 0, 0);
  }
  session.lastActive = Date.now();
  return { cols: session.cols, rows: session.rows };
}

function close(sid, user) {
  const session = sessions.get(String(sid || ''));
  if (!canUse(session, user)) return { closed: false };
  return closeSession(session, '用户已断开');
}

const active = (user) => Array.from(sessions.values())
  .filter((s) => canUse(s, user))
  .map((s) => ({
    sid: s.sid, target: s.target, container: s.containerId, shell: s.shell,
    root: s.root, cols: s.cols, rows: s.rows,
    lastActive: new Date(s.lastActive).toISOString(),
  }));

module.exports = { openSession, attachStream, input, resize, close, active };
