'use strict';

/**
 * 通过 /var/run/docker.sock 直接调用 Docker Engine API 运行一次性构建容器。
 * 不使用宿主机 docker CLI（它通常是 glibc 动态链接，Alpine 平台容器里跑不起来，
 * 且老内核的默认 seccomp 会拦截 Go 程序创建线程）。Node 内置 http 即可，零依赖。
 */
const http = require('http');
const fs = require('fs');
const proxyModule = require('./proxy');
const { config } = require('./core');

const SOCKET_PATH = '/var/run/docker.sock';
const WIN_PIPE = '\\\\.\\pipe\\docker_engine';

/**
 * 归一化 Windows 命名管道写法，三种输入都接受：
 *   npipe:////./pipe/kiri / \\.\pipe\kiri / 裸名 kiri  →  \\.\pipe\kiri
 */
function pipePath(value) {
  let s = String(value || '').trim().replace(/^npipe:\/\//i, '').replace(/\//g, '\\');
  if (/^\.\\/.test(s)) s = '\\\\.' + s;
  if (!/\\pipe\\/i.test(s)) s = '\\\\.\\pipe\\' + s.replace(/^\\+/, '');
  return s;
}

/**
 * 四种可达方式（端点来源统一走 config，支持「环境配置」页管理，重启后生效）：
 *   1) DOCKER_HOST=npipe:////./pipe/NAME —— 显式命名管道（如 Kiri 的 \\.\pipe\kiri）
 *   2) DOCKER_HOST=tcp://host:port —— 远程 / TCP 端点
 *   3) Windows：DOCKER_PIPE 覆盖管道名（裸名或全格式均可），留空用 Docker Desktop 默认管道
 *   4) Linux socket：DOCKER_SOCKET（默认 /var/run/docker.sock）
 * 平台本体在容器里时由 compose 挂载 docker.sock。
 */
function endpoint() {
  const dockerHost = String(config.dockerHost || '').trim();
  const dockerPipe = String(config.dockerPipe || '').trim();
  const dockerSocket = String(config.dockerSocket || SOCKET_PATH).trim();
  if (/^npipe:/i.test(dockerHost)) return { socketPath: pipePath(dockerHost), kind: 'npipe' };
  if (dockerHost) {
    try {
      const u = new URL(dockerHost.replace(/^tcp:\/\//i, 'http://'));
      return { host: u.hostname, port: Number(u.port || 2375), kind: 'tcp' };
    } catch { /* 落到 socket 分支 */ }
  }
  if (process.platform === 'win32') {
    if (dockerPipe) return { socketPath: pipePath(dockerPipe), kind: 'npipe' };
    if (!fs.existsSync(dockerSocket)) return { socketPath: WIN_PIPE, kind: 'npipe' };
  }
  return { socketPath: dockerSocket || SOCKET_PATH, kind: 'socket' };
}

function request(method, path, body, { stream = false, binary = false, timeout = 0, rawBody = false, contentType = '' } = {}) {
  return new Promise((resolve, reject) => {
    // rawBody=true 时 body 已是 Buffer（镜像 tar / 容器归档），不再做 JSON 序列化。
    const payload = body === undefined ? null
      : (rawBody ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.from(JSON.stringify(body)));
    const headers = {};
    if (payload) {
      headers['content-type'] = contentType || (rawBody ? 'application/x-tar' : 'application/json');
      headers['content-length'] = String(payload.length);
    } else if (method === 'POST' || method === 'PUT') {
      headers['content-length'] = '0';
    }
    const options = { path, method, headers };
    const ep = endpoint();
    if (ep.socketPath) {
      options.socketPath = ep.socketPath;
    } else {
      options.host = ep.host;
      options.port = ep.port;
      // DOCKER_HOST=tcp://... 时按「Docker 代理 → 全局代理」链决定是否走 CONNECT 隧道。
      const resolved = proxyModule.resolve('docker', { itemId: 'docker-engine', host: ep.host });
      if (resolved.url && !proxyModule.shouldBypass(ep.host, resolved.noProxy)
        && /^https?:\/\//i.test(resolved.url)) {
        options.agent = proxyModule.tunnelAgent(resolved.url, ep.host, ep.port);
      }
    }
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

/** scope='platform' 只列自建扩展容器（安装器用）；scope='all' 列宿主机全部容器（Docker 管理面板用）。 */
async function listContainers(scope = 'platform') {
  const params = { all: 1 };
  if (scope !== 'all') params.filters = JSON.stringify({ label: ['devplatform.ext=1'] });
  return request('GET', `/containers/json?${qs(params)}`, undefined, { timeout: 8000 });
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

/** 把一次性容器固化为镜像（用于构造带 rclone+samba+fuse 的网关镜像）。 */
async function commitContainer(id, repo, tag = 'latest') {
  return request('POST', `/commit?${qs({ container: id, repo, tag })}`,
    { Author: 'devplatform', Comment: 'rclone+samba+fuse storage gateway' }, { timeout: 300000 });
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
  // 扩展容器以 Tty=true 创建，日志是纯文本；宿主机上其它容器可能是 Tty=false 的复用帧。
  if (buf.length >= 8 && buf[0] <= 2) {
    const size = buf.readUInt32BE(4);
    if (size > 0 && size <= buf.length - 8) return demux(buf);
  }
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

/* ------------------- Docker 管理面板（全量资源） ------------------- */
// 与扩展安装共用同一套 request/endpoint，不引入 docker CLI 依赖。

async function listImages() {
  return request('GET', '/images/json', undefined, { timeout: 10000 });
}

async function inspectImage(id) {
  return request('GET', `/images/${encodeURIComponent(id)}/json`, undefined, { timeout: 8000 });
}

async function removeImage(id, force = false) {
  return request('DELETE', `/images/${encodeURIComponent(id)}?${qs({ force: force ? 1 : 0 })}`,
    undefined, { timeout: 30000 });
}

/** 离线镜像导入：body 是 `docker save` 产出的 tar；返回逐行进度文本。 */
async function loadImage(tarBuffer) {
  if (!Buffer.isBuffer(tarBuffer) || !tarBuffer.length) throw new Error('镜像 tar 为空');
  const buf = await request('POST', '/images/load', tarBuffer,
    { binary: true, rawBody: true, contentType: 'application/x-tar', timeout: 600000 });
  return String(buf.toString('utf8')).trim().slice(0, 4000);
}

/** 导出镜像为 tar（宝塔「导出镜像」）。 */
async function saveImage(id) {
  return request('GET', `/images/${encodeURIComponent(id)}/get`, undefined,
    { binary: true, timeout: 600000 });
}

async function listVolumes() {
  const data = await request('GET', '/volumes', undefined, { timeout: 10000 });
  return (data && data.Volumes) || [];
}

async function createVolume(name, labels = {}) {
  return request('POST', '/volumes/create', { Name: name, Labels: labels }, { timeout: 15000 });
}

async function inspectVolume(name) {
  return request('GET', `/volumes/${encodeURIComponent(name)}`, undefined, { timeout: 8000 });
}

async function listNetworks() {
  return request('GET', '/networks', undefined, { timeout: 10000 });
}

async function createNetwork(name, driver = 'bridge') {
  return request('POST', '/networks/create', { Name: name, Driver: driver }, { timeout: 15000 });
}

async function removeNetwork(id) {
  return request('DELETE', `/networks/${encodeURIComponent(id)}`, undefined, { timeout: 15000 });
}

async function pauseContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/pause`, undefined, { timeout: 15000 });
}

async function unpauseContainer(id) {
  return request('POST', `/containers/${encodeURIComponent(id)}/unpause`, undefined, { timeout: 15000 });
}

/** 单次资源快照（stream=false），用于容器列表上的 CPU / 内存列。 */
async function containerStats(id) {
  return request('GET', `/containers/${encodeURIComponent(id)}/stats?stream=0`,
    undefined, { timeout: 10000 });
}

/** 容器内文件读（tar 流），用于备份与「容器目录」查看。 */
async function getArchive(id, containerPath) {
  return request('GET', `/containers/${encodeURIComponent(id)}/archive?${qs({ path: containerPath })}`,
    undefined, { binary: true, timeout: 120000 });
}

/** 容器内文件写（tar 流），用于恢复。 */
async function putArchive(id, containerPath, tarBuffer) {
  return request('PUT', `/containers/${encodeURIComponent(id)}/archive?${qs({ path: containerPath })}`,
    tarBuffer, { binary: true, rawBody: true, contentType: 'application/x-tar', timeout: 120000 });
}

/** 一次性容器 exec，返回退出码与输出；备份 / 恢复命令都走这里。 */
async function execContainerTimed(id, cmd, timeout = 120000) {
  const created = await request('POST', `/containers/${encodeURIComponent(id)}/exec`, {
    AttachStdout: true, AttachStderr: true, AttachStdin: false, Tty: false, Cmd: cmd,
  }, { timeout: 15000 });
  if (!created || !created.Id) throw new Error('Docker 未返回 exec ID');
  const buf = await request('POST', `/exec/${encodeURIComponent(created.Id)}/start`, {
    Detach: false, Tty: false,
  }, { binary: true, timeout });
  const info = await request('GET', `/exec/${encodeURIComponent(created.Id)}/json`, undefined, { timeout: 8000 });
  return { exitCode: Number((info && info.ExitCode) || 0), output: demux(buf) };
}

/**
 * v0.4.30 交互式容器终端：创建 Tty=true + AttachStdin 的 exec。
 * Cmd 用 shell 名（daemon 会按容器 PATH 解析）；root=true 时以 root 身份进入。
 */
async function execCreateInteractive(id, { shell = 'sh', root = false } = {}) {
  const bin = shell === 'bash' ? 'bash' : 'sh';
  const created = await request('POST', `/containers/${encodeURIComponent(id)}/exec`, {
    AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true,
    Cmd: [bin],
    ...(root ? { User: 'root' } : {}),
  }, { timeout: 15000 });
  if (!created || !created.Id) throw new Error('Docker 未返回 exec ID');
  return created.Id;
}

/**
 * v0.4.30：以 Docker 的 connection hijack 拿到 exec 的双向裸流 socket。
 * 关键：请求头带 `Connection: Upgrade` + `Upgrade: tcp` 时，Docker daemon 返回
 * 101 UPGRADED，Node 的 http 客户端触发 'upgrade' 事件而不是普通 'response'。
 * Tty=true 时 socket 上是原始字节（无 8 字节复用帧头），可直接喂给 xterm。
 * 返回 { socket, source, upgradeHead }：socket 用于写入键盘输入，source 是输出字节来源
 * （升级成功时就是 socket；降级时是 HTTP 响应流），调用方统一监听 source 的 'data'。
 */
function execAttach(execId) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: true }));
    const ep = endpoint();
    const options = {
      path: `/exec/${encodeURIComponent(execId)}/start`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.length),
        connection: 'Upgrade',
        upgrade: 'tcp',
      },
    };
    if (ep.socketPath) {
      options.socketPath = ep.socketPath;
    } else {
      options.host = ep.host;
      options.port = ep.port;
      const resolved = proxyModule.resolve('docker', { itemId: 'docker-engine', host: ep.host });
      if (resolved.url && !proxyModule.shouldBypass(ep.host, resolved.noProxy)
        && /^https?:\/\//i.test(resolved.url)) {
        options.agent = proxyModule.tunnelAgent(resolved.url, ep.host, ep.port);
      }
    }
    const req = http.request(options);
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    // 标准路径：daemon 返回 101 UPGRADED，socket 是双向裸流，输出直接来自 socket。
    req.on('upgrade', (res, socket, upgradeHead) => finish(resolve, {
      socket, source: socket, upgradeHead,
    }));
    req.on('response', (res) => {
      if (res.statusCode >= 400) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => finish(reject, new Error(
          `Docker exec attach 失败（HTTP ${res.statusCode}）：${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`,
        )));
        return;
      }
      // 降级路径：某些代理 / 老版本 daemon 不升级协议，返回 200 且保持连接。
      // 此时 res 是输出流、res.socket 仍可写，不能干等 'end'（它永不结束）。
      const socket = res.socket;
      if (!socket) {
        finish(reject, new Error('Docker exec attach 未返回可写 socket'));
        return;
      }
      finish(resolve, { socket, source: res, upgradeHead: Buffer.alloc(0) });
    });
    req.on('error', (err) => finish(reject, new Error(`Docker exec attach 连接失败：${err.message}`)));
    req.write(payload);
    req.end();
  });
}

/** 调整交互式 exec 的终端窗口大小（xterm FitAddon 变化时调用）。 */
async function execResize(execId, cols, rows) {
  await request('POST', `/exec/${encodeURIComponent(execId)}/resize?${qs({ w: cols, h: rows })}`,
    undefined, { timeout: 5000 });
}

module.exports = {
  runContainer, SOCKET_PATH, endpoint, request,
  ping, version, listContainers, inspectContainer, imageExists, pullImage,
  createContainer, startContainer, stopContainer, restartContainer, commitContainer,
  removeContainer, removeVolume, containerLogs, execContainer,
  listImages, inspectImage, removeImage, loadImage, saveImage,
  listVolumes, createVolume, inspectVolume,
  listNetworks, createNetwork, removeNetwork,
  pauseContainer, unpauseContainer, containerStats,
  getArchive, putArchive, execContainerTimed,
  execCreateInteractive, execAttach, execResize,
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

