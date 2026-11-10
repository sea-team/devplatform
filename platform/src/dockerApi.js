'use strict';

/**
 * 通过 /var/run/docker.sock 直接调用 Docker Engine API 运行一次性构建容器。
 * 不使用宿主机 docker CLI（它通常是 glibc 动态链接，Alpine 平台容器里跑不起来，
 * 且老内核的默认 seccomp 会拦截 Go 程序创建线程）。Node 内置 http 即可，零依赖。
 */
const http = require('http');
const fs = require('fs');

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const DOCKER_HOST = process.env.DOCKER_HOST || '';
const WIN_PIPE = '\\\\.\\pipe\\docker_engine';

/**
 * 三种可达方式：显式 DOCKER_HOST（tcp://host:port）、Linux socket、
 * Windows Docker Desktop 命名管道。平台本体在容器里时由 compose 挂载 docker.sock。
 */
function endpoint() {
  if (DOCKER_HOST) {
    try {
      const u = new URL(DOCKER_HOST.replace(/^tcp:\/\//i, 'http://'));
      return { host: u.hostname, port: Number(u.port || 2375), kind: 'tcp' };
    } catch { /* 落到 socket 分支 */ }
  }
  if (process.platform === 'win32' && !fs.existsSync(SOCKET_PATH)) {
    return { socketPath: WIN_PIPE, kind: 'npipe' };
  }
  return { socketPath: SOCKET_PATH, kind: 'socket' };
}

function request(method, path, body, { stream = false, binary = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    } else if (method === 'POST' || method === 'PUT') {
      headers['content-length'] = '0';
    }
    const options = { path, method, headers };
    const ep = endpoint();
    if (ep.socketPath) options.socketPath = ep.socketPath;
    else { options.host = ep.host; options.port = ep.port; }
    const req = http.request(options, (res) => {
      const collect = () => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`Docker API ${method} ${path} → ${res.statusCode}: ${buf.toString('utf8').slice(0, 300)}`));
            return;
          }
          if (binary) return resolve(buf);
          const text = buf.toString('utf8');
          try { resolve(text ? JSON.parse(text) : {}); } catch { resolve(text); }
        });
      };
      if (stream && res.statusCode < 400) return resolve(res);
      collect();
    });
    req.on('error', (err) => reject(new Error(`无法连接 Docker（${ep.socketPath || `${ep.host}:${ep.port}`}）：${err.message}`)));
    if (timeout) {
      req.setTimeout(timeout, () => req.destroy(new Error(`Docker API 超时：${method} ${path}`)));
    }
    if (payload) req.write(payload);
    req.end();
  });
}

/** 解析 Docker 多路复用帧头（Tty=false 的 exec 输出）；非帧数据原样按文本返回。 */
function demux(buf) {
  let offset = 0;
  const parts = [];
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (size > buf.length - offset - 8) break;
    parts.push(buf.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return parts.length ? Buffer.concat(parts).toString('utf8') : buf.toString('utf8');
}

/* ------------------- 长期容器管理（扩展服务用） ------------------- */

const qs = (params) => new URLSearchParams(params).toString();

async function ping() {
  return request('GET', '/_ping', undefined, { timeout: 2000 });
}

async function version() {
  return request('GET', '/version', undefined, { timeout: 3000 });
}

async function listContainers() {
  const filters = JSON.stringify({ label: ['devplatform.ext=1'] });
  return request('GET', `/containers/json?${qs({ all: 1, filters })}`, undefined, { timeout: 8000 });
}

async function inspectContainer(id) {
  return request('GET', `/containers/${encodeURIComponent(id)}/json`, undefined, { timeout: 8000 });
}

async function imageExists(image, tag) {
  // 用 /images/json 比对 RepoTags：镜像名常含 / 与加速器前缀，
  // 直接塞进 /images/{name}/json 的路径会被 URL 编码破坏。
  const ref = `${image}:${tag}`;
  try {
    const items = await request('GET', '/images/json', undefined, { timeout: 8000 });
    return Array.isArray(items) && items.some((i) => (i.RepoTags || []).includes(ref));
  } catch { return false; }
}

async function pullImage(image, tag) {
  // 返回的是逐行 JSON 进度流；结束时检查是否含 error 字段。
  const text = String(await request('POST', `/images/create?${qs({ fromImage: image, tag })}`,
    undefined, { binary: true, timeout: 600000 }));
  const lines = text.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.error) throw new Error(`拉取镜像失败：${String(item.error).slice(0, 200)}`);
    } catch (e) {
      if (String(e.message).startsWith('拉取镜像失败')) throw e;
    }
  }
  return { image: `${image}:${tag}`, lines: lines.length };
}

async function createContainer(spec, name) {
  return request('POST', `/containers/create?${qs({ name })}`, spec, { timeout: 60000 });
}

async function startContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/start`, undefined, { timeout: 30000 });
}

async function stopContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/stop?${qs({ t: 10 })}`, undefined, { timeout: 40000 });
}

async function restartContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/restart?${qs({ t: 10 })}`, undefined, { timeout: 40000 });
}

async function removeContainer(id, force = true) {
  return request('DELETE', `/containers/${encodeURIComponent(id)}?${qs({ force: force ? 1 : 0, v: 0 })}`,
    undefined, { timeout: 30000 });
}

async function removeVolume(name) {
  return request('DELETE', `/volumes/${encodeURIComponent(name)}?${qs({ force: 1 })}`,
    undefined, { timeout: 30000 });
}

async function containerLogs(id, tail = 200) {
  const buf = await request('GET', `/containers/${encodeURIComponent(id)}/logs?${qs({
    stdout: 1, stderr: 1, tail, timestamps: 0,
  })}`, undefined, { binary: true, timeout: 15000 });
  // 扩展容器以 Tty=true 创建，日志是纯文本，没有 8 字节帧头。
  return buf.toString('utf8');
}

async function execContainer(id, cmd) {
  const created = await request('POST', `/containers/${encodeURIComponent(id)}/exec`, {
    AttachStdout: true, AttachStderr: true, Tty: false, Cmd: cmd,
  }, { timeout: 15000 });
  if (!created || !created.Id) throw new Error('Docker 未返回 exec ID');
  const buf = await request('POST', `/exec/${encodeURIComponent(created.Id)}/start`, {
    Detach: false, Tty: false,
  }, { binary: true, timeout: 30000 });
  const info = await request('GET', `/exec/${encodeURIComponent(created.Id)}/json`, undefined, { timeout: 8000 });
  return { exitCode: Number((info && info.ExitCode) || 0), output: demux(buf) };
}

module.exports = {
  runContainer, SOCKET_PATH, endpoint, request,
  ping, version, listContainers, inspectContainer, imageExists, pullImage,
  createContainer, startContainer, stopContainer, restartContainer,
  removeContainer, removeVolume, containerLogs, execContainer,
};

/**
 * 创建并运行一个隔离构建容器，实时回传日志，返回退出码。
 * Tty=true 让 logs 流是纯文本（不需要解析 Docker 的 8 字节复用帧头）。
 */
async function runContainer({ image, hostPath, script, name, onData, timeoutMs = 900000 }) {
  const createPath = name ? `/containers/create?name=${encodeURIComponent(name)}` : '/containers/create';
  const created = await request('POST', createPath, {
    Image: image,
    Cmd: ['sh', '-c', script],
    WorkingDir: '/src',
    Tty: true,
    OpenStdin: false,
    HostConfig: {
      Binds: [`${hostPath}:/src`],
      AutoRemove: false,
    },
  });
  const id = created.Id;
  if (!id) throw new Error('Docker 未返回容器 ID');

  let logStream = null;
  let timer = null;
  try {
    await request('POST', `/containers/${id}/start`);

    // 跟进日志（容器已退出时也能拿到完整历史输出）
    try {
      logStream = await request('GET', `/containers/${id}/logs?follow=1&stdout=1&stderr=1`, undefined, { stream: true });
      logStream.on('data', (chunk) => onData && onData(chunk.toString('utf8')));
      logStream.on('error', () => {});
    } catch (e) {
      onData && onData(`\n[docker] 日志读取失败：${e.message}\n`);
    }

    // 超时后强制删除容器，wait 会随之返回
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        request('DELETE', `/containers/${id}?force=1`).catch(() => {});
        resolve({ StatusCode: 124, timedOut: true });
      }, timeoutMs);
    });
    const result = await Promise.race([
      request('POST', `/containers/${id}/wait`),
      timeout,
    ]);
    if (result.timedOut) onData && onData('\n[docker] 构建超时，容器已强制终止\n');
    return Number(result.StatusCode || 0);
  } finally {
    if (timer) clearTimeout(timer);
    if (logStream && typeof logStream.destroy === 'function') {
      try { logStream.destroy(); } catch { /* noop */ }
    }
    await request('DELETE', `/containers/${id}?force=1`, undefined).catch(() => {});
  }
}

