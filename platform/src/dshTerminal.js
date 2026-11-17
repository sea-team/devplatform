'use strict';

/**
 * DeepSeek Harness (dsh) 交互式终端网关（v0.4.8）。
 *
 * 平台本体运行在 node:20 容器，而 dsh 要求 Node >= 24.9，且平台容器内没有 docker CLI、
 * 只有 /var/run/docker.sock。因此本模块通过 Docker Engine API（复用 dockerApi.js）启动
 * 一次性容器：镜像用 node:20-alpine，容器内以挂载的 node24 二进制跑 dsh headless。
 *
 * 平台「AI 服务」配置被渲染成 dsh 的 cordis.patch.yml（自定义 OpenAI-compatible provider），
 * 以 headless --json + --session-id 续接实现「输入一行 -> 流式回显 -> 保持上下文」的 REPL。
 * 与 remoteOps.js 的 SSH 终端一致：SSE 单向推输出，POST 送输入/中断。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dockerApi = require('./dockerApi');
const { HttpError, config } = require('./core');

// dsh 运行时配置（可用环境变量覆盖，便于非 246 环境/测试调整）
const DSH_RUNTIME = process.env.DSH_RUNTIME_DIR || '/data/dsh-runtime';
const DSH_IMAGE = process.env.DSH_IMAGE || 'node:20-alpine';
const SESSION_IDLE_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 30;
const TASK_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * 容器内路径 -> 宿主机路径。
 * 平台本体跑在容器里，通过 docker.sock 让宿主机 Docker daemon 创建 dsh 容器，
 * 因此 Binds 里的路径必须是宿主机视角，否则挂的是宿主机 /tmp 下的空目录，
 * cordis.patch.yml 对 dsh 不可见，agent 会回退到默认 deepseek-official 路由。
 * 本机模式未配置 HOST_DATA_DIR 时，容器路径 == 宿主机路径，原样返回。
 */
function toHostPath(containerPath) {
  const dataDir = String(config.dataDir || '').replace(/\/+$/, '');
  const hostDataDir = String(config.hostDataDir || '').replace(/\/+$/, '');
  const p = String(containerPath || '');
  if (hostDataDir && dataDir && (p === dataDir || p.startsWith(dataDir + '/'))) {
    return hostDataDir + p.slice(dataDir.length);
  }
  return p;
}

const sessions = new Map();
function now() { return Date.now(); }

function canUse(session, user) {
  if (!session || session.closed || !user) return false;
  if (user.role === 'admin' || user.via === 'cli' || user.via === 'off') return true;
  return Boolean(session.ownerId) && session.ownerId === user.id;
}
function owned(sid, user) {
  const session = sessions.get(String(sid || ''));
  if (!canUse(session, user)) throw new HttpError(403, '无权使用该 AI 终端会话');
  return session;
}

function frame(session, payload) {
  const data = `data: ${Buffer.from(payload, 'utf8').toString('base64')}\n\n`;
  if (!session.subscribers.size) {
    session.pending.push(data);
    if (session.pending.length > 500) session.pending.splice(0, session.pending.length - 500);
    return;
  }
  for (const res of session.subscribers) {
    try { res.write(data); } catch { session.subscribers.delete(res); }
  }
}
function sysLine(session, text) { frame(session, `${text}\r\n`); }

function closeSession(session, reason = '') {
  if (session.closed) return;
  session.closed = true;
  clearInterval(session.timer);
  abortCurrent(session);
  if (reason) {
    for (const res of session.subscribers) {
      try { res.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`); } catch { /* noop */ }
    }
  }
  for (const res of session.subscribers) { try { res.end(); } catch { /* noop */ } }
  session.subscribers.clear();
  sessions.delete(session.sid);
  // 会话目录含 patch 与 dsh 会话数据，关闭后清理，避免长期堆积在 data 下。
  // 延迟一点给容器删除让出时间，失败则忽略（下次部署/重启也能重生）。
  const dir = session.dir;
  if (dir && /[\\/]dsh-sessions[\\/]dp-dsh-/.test(dir)) {
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }, 1500).unref?.();
  }
}

async function abortCurrent(session) {
  const cur = session.current;
  if (!cur || cur.done) return;
  cur.done = true;
  try { if (cur.res) cur.res.destroy(); } catch { /* noop */ }
  if (cur.containerId) {
    try { await dockerApi.removeContainer(cur.containerId, true); } catch { /* noop */ }
  }
}

function pickProvider(state, providerId) {
  const list = (state.aiProviders || []).filter((p) => p && p.enabled !== false);
  if (providerId) {
    const p = list.find((x) => x.id === providerId);
    if (!p) throw new HttpError(404, '指定的 AI 服务不存在或未启用');
    return p;
  }
  const p = list.find((x) => x.kind !== 'cli') || list[0];
  if (!p) throw new HttpError(400, '尚未配置 AI 服务：请先在「AI 服务」页添加并启用一个服务');
  if (p.kind === 'cli') throw new HttpError(400, 'AI 终端需要 API 类型的 AI 服务（当前为本地程序类型）');
  return p;
}

function yamlStr(value) {
  return `"${String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/**
 * 把平台 AI 服务渲染成 dsh 的 cordis.patch.yml，写入会话私有目录（挂载到容器 /session）。
 */
function renderPatch(sessionDir, provider) {
  const keyEnv = 'PLATFORM_AI_KEY';
  const providerId = 'platform-ai';
  const model = String(provider.model || '').trim();
  const baseURL = String(provider.baseURL || '').trim();
  if (!model) throw new HttpError(400, 'AI 服务缺少模型名称');
  if (!baseURL) throw new HttpError(400, 'AI 服务缺少 Base URL');

  const lines = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${providerId}:`,
    `        apiKeyEnv: ${keyEnv}`,
    '        api: openai-completions',
    `        baseURL: ${yamlStr(baseURL)}`,
    '        models:',
    `          - id: ${yamlStr(model)}`,
    '- id: agent-default-model',
    '  config:',
    `    provider: ${providerId}`,
    `    model: ${yamlStr(model)}`,
    '',
  ];
  const patchPath = path.join(sessionDir, 'home', '.dsh', 'profiles', 'headless', 'cordis.patch.yml');
  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  return { keyEnv, apiKey: String(provider.apiKey || '') };
}

/**
 * Docker 多路复用流解析器：跨 chunk 累积，按 8 字节头拆分 stdout / stderr 帧。
 * 回调 (streamNo, text)。
 */
function makeDemux(onChunk) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const size = buf.readUInt32BE(4);
      if (size > buf.length - 8) break; // 帧未收全，等下一个 chunk
      const streamNo = buf[0];
      const payload = buf.subarray(8, 8 + size);
      onChunk(streamNo, payload.toString('utf8'));
      buf = buf.subarray(8 + size);
    }
  };
}

/**
 * 执行一个 headless 任务： Engine API create+start+attach 一次性容器，实时回显 NDJSON 事件。
 * task 经 base64 管线喂给 dsh（避免 attach stdin 的复杂性）。
 * 返回 Promise<'done'|'error'|'killed'>。
 */
async function runTask(session, task, patch) {
  const cur = { done: false, res: null, containerId: null };
  session.current = cur;
  const sid = crypto.randomBytes(6).toString('hex');
  const containerName = `dp-dsh-${sid}`;
  const taskB64 = Buffer.from(task.endsWith('\n') ? task : task + '\n', 'utf8').toString('base64');
  // dsh 入口是 ESM；用 node 直接执行。task 通过 base64|base64 -d 管道送入 stdin。
  const sessionArg = session.dshSessionId ? ` --session-id '${String(session.dshSessionId).replace(/'/g, '')}'` : '';
  const shellCmd = `echo '${taskB64}' | base64 -d | /opt/dsh/node/bin/node /opt/dsh/bin/dsh headless --json${sessionArg} -`;

  let finalText = '';
  let errored = false;
  let lastErr = '';

  try {
    const spec = {
      Image: DSH_IMAGE,
      Cmd: ['/bin/sh', '-c', shellCmd],
      Env: [
        'HOME=/session/home',
        'DSH_HOME=/session/home/.dsh',
        `${patch.keyEnv}=${patch.apiKey}`,
      ],
      HostConfig: {
        Binds: [
          `${toHostPath(DSH_RUNTIME)}:/opt/dsh:ro`,
          `${toHostPath(session.dir)}:/session`,
        ],
        AutoRemove: false,
      },
      WorkingDir: '/session',
      OpenStdin: false,
      Tty: false,
      Labels: { 'devplatform.dsh': '1' },
    };
    const created = await dockerApi.createContainer(spec, containerName);
    cur.containerId = created.Id;
    await dockerApi.startContainer(created.Id);
    // attach 输出流（stdout+stderr），Tty=false 故为多路复用帧。
    const res = await dockerApi.request('POST',
      `/containers/${encodeURIComponent(created.Id)}/attach?stdout=1&stderr=1&stdin=0&stream=1`,
      undefined, { stream: true, timeout: 0 });
    cur.res = res;
    let stderrBuf = '';
    const demux = makeDemux((streamNo, text) => {
      if (cur.done) return;
      if (streamNo === 2) { stderrBuf += text; return; }
      handleStdout(text);
    });

    const handleStdout = (text) => {
      for (const line of text.split('\n')) {
        const raw = line.trim();
        if (!raw) continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { frame(session, raw + '\r\n'); continue; }
        if (ev.type === 'session' && ev.sessionId) {
          session.dshSessionId = ev.sessionId;
        } else if (ev.type === 'status' && ev.phase === 'turn_start') {
          sysLine(session, `\r\n\x1b[36m▸ 第 ${ev.turn} 轮\x1b[0m`);
        } else if (ev.type === 'final') {
          finalText = String(ev.text || '');
          if (ev.reason && ev.reason.kind === 'error') {
            errored = true;
            const msg = (ev.reason.error && ev.reason.error.message) || '未知错误';
            lastErr = msg;
            sysLine(session, `\r\n\x1b[31m✖ ${msg}\x1b[0m`);
          } else if (finalText) {
            frame(session, `\r\n${finalText}\r\n`);
          }
        }
      }
    };

    await new Promise((resolve) => {
      res.on('data', demux);
      res.on('end', resolve);
      res.on('close', resolve);
      res.on('error', resolve);
      // 超时中断
      cur.timer = setTimeout(() => {
        sysLine(session, `\r\n\x1b[33m[任务超时 ${Math.round(TASK_TIMEOUT_MS / 1000)}s，已中断]\x1b[0m`);
        abortCurrent(session);
        resolve();
      }, TASK_TIMEOUT_MS);
    });
    clearTimeout(cur.timer);

    // 清理容器
    try { await dockerApi.removeContainer(created.Id, true); } catch { /* noop */ }
    cur.containerId = null;

    if (!cur.done && !errored && stderrBuf) {
      const tail = stderrBuf.trim().split('\n').slice(-1)[0] || '';
      if (/error|fail|invalid/i.test(tail) && !finalText) {
        sysLine(session, `\x1b[31m${tail.slice(0, 300)}\x1b[0m`);
      }
    }
  } catch (e) {
    if (!cur.done) sysLine(session, `\x1b[31m✖ ${String(e.message || e).slice(0, 400)}\x1b[0m`);
    errored = true;
    if (cur.containerId) { try { await dockerApi.removeContainer(cur.containerId, true); } catch { /* noop */ } }
  } finally {
    cur.done = true;
    session.current = null;
  }
  return cur.killed ? 'killed' : (!errored ? 'done' : 'error');
}

/* ------------------------------ 会话 API -------------------------------- */

async function openSession(state, providerId, user) {
  if (sessions.size >= MAX_SESSIONS) {
    for (const s of Array.from(sessions.values())) {
      if (!s.subscribers.size && now() - s.lastActive > SESSION_IDLE_MS) closeSession(s, '会话回收');
    }
  }
  const provider = pickProvider(state, providerId);
  const sid = crypto.randomBytes(10).toString('hex');
  // 会话目录必须放在「容器内已挂载到宿主机」的 data 目录下，
  // 这样它既能被平台进程写入，也能以宿主机路径 bind mount 给 dsh 容器。
  const dir = path.join(String(config.dataDir || ''), 'dsh-sessions', `dp-dsh-${sid}`);
  fs.mkdirSync(path.join(dir, 'home', '.dsh'), { recursive: true });
  const session = {
    sid, dir,
    dshSessionId: null, // 首次由 dsh 生成，见 runTask 对 session 事件的处理
    providerId: provider.id,
    providerName: provider.name,
    model: provider.model,
    ownerId: (user && user.id) || '',
    subscribers: new Set(), pending: [], closed: false,
    lastActive: now(), timer: null, current: null, busy: false,
    turns: 0,
  };
  sessions.set(sid, session);
  session.timer = setInterval(() => {
    if (now() - session.lastActive > SESSION_IDLE_MS && !session.subscribers.size) {
      closeSession(session, '会话空闲超时');
    }
  }, 30000);

  return {
    sid,
    provider: { id: provider.id, name: provider.name, model: provider.model },
    greeting: `已连接 DeepSeek Harness · ${provider.name} (${provider.model})\r\n输入问题回车发送；思考与工具调用实时显示。\r\n`,
  };
}

function attachStream(sid, req, res) {
  const session = sessions.get(String(sid || ''));
  const writeClosed = (reason) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
    res.end();
  };
  if (!session || session.closed) return writeClosed('会话不存在或已关闭');
  if (!canUse(session, req && req.user)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: '无权订阅该 AI 终端会话', status: 403 }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive', 'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  for (const f of session.pending) res.write(f);
  session.pending = [];
  session.subscribers.add(res);
  session.lastActive = now();
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 20000);
  const cleanup = () => { clearInterval(hb); session.subscribers.delete(res); };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function submit(state, sid, input, user) {
  const session = owned(sid, user);
  const task = String(input || '').trim();
  if (!task) return { accepted: false, reason: 'empty' };
  if (session.busy) return { accepted: false, reason: 'busy' };
  let patch;
  try {
    patch = renderPatch(session.dir, pickProvider(state, session.providerId));
  } catch (e) {
    sysLine(session, `\x1b[31m${e.message || e}\x1b[0m`);
    return { accepted: false, reason: 'config' };
  }
  session.busy = true;
  session.turns += 1;
  session.lastActive = now();
  frame(session, `\r\n\x1b[1m\x1b[32m❯\x1b[0m ${task}\r\n`);
  runTask(session, task, patch).then(() => {
    session.busy = false;
    session.lastActive = now();
    sysLine(session, `\r\n\x1b[90m── 完成 · 第 ${session.turns} 轮 ──\x1b[0m`);
  });
  return { accepted: true };
}

async function interrupt(sid, user) {
  const session = owned(sid, user);
  if (session.current && !session.current.done) {
    session.current.killed = true;
    await abortCurrent(session);
    return { interrupted: true };
  }
  return { interrupted: false };
}

function close(sid, user) {
  const session = sessions.get(String(sid || ''));
  if (!canUse(session, user)) return { closed: false };
  closeSession(session, '用户已关闭');
  return { closed: true };
}

function active(user) {
  return Array.from(sessions.values())
    .filter((s) => canUse(s, user))
    .map((s) => ({ sid: s.sid, provider: s.providerName, model: s.model, busy: s.busy,
      turns: s.turns, lastActive: new Date(s.lastActive).toISOString() }));
}

module.exports = { openSession, attachStream, submit, interrupt, close, active };
