'use strict';

/**
 * 通过 /var/run/docker.sock 直接调用 Docker Engine API 运行一次性构建容器。
 * 不使用宿主机 docker CLI（它通常是 glibc 动态链接，Alpine 平台容器里跑不起来，
 * 且老内核的默认 seccomp 会拦截 Go 程序创建线程）。Node 内置 http 即可，零依赖。
 */
const http = require('http');

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function request(method, path, body, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    } else if (method === 'POST' || method === 'PUT') {
      headers['content-length'] = '0';
    }
    const req = http.request({ socketPath: SOCKET_PATH, path, method, headers }, (res) => {
      const collect = () => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) {
            reject(new Error(`Docker API ${method} ${path} → ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try { resolve(text ? JSON.parse(text) : {}); } catch { resolve(text); }
        });
      };
      if (stream && res.statusCode < 400) return resolve(res);
      collect();
    });
    req.on('error', (err) => reject(new Error(`无法连接 Docker Socket（${SOCKET_PATH}）：${err.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

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

module.exports = { runContainer, SOCKET_PATH };
