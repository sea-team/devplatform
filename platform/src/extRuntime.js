'use strict';

/**
 * 扩展运行时适配器：把「清单数据」翻译成 Docker Engine API 调用。
 * 只处理平台自己创建、带 devplatform.ext 标签的容器，绝不触碰宿主机上其它容器。
 * 无 Docker 时由上层降级为 external（只登记外部连接），本模块不隐式安装任何东西。
 */
const net = require('net');
const docker = require('./dockerApi');
const remoteDocker = require('./remoteDocker');
const dbgateSync = require('./dbgateSync');
const proxyModule = require('./proxy');
const { config, imageCandidates } = require('./core');

const LABEL = 'devplatform.ext';
let _statusCache = { at: 0, value: null };

/** 实例的 target：'local' | 'server:<id>'。旧数据没有该字段时一律视为本机。 */
function targetOf(inst) {
  return inst && inst.target ? String(inst.target) : 'local';
}
function isRemote(inst) {
  return targetOf(inst).startsWith('server:');
}
function serverIdOf(inst) {
  return targetOf(inst).replace(/^server:/, '');
}
function containerRef(inst) {
  return inst.containerName || inst.containerId || `dp-ext-${inst.name}`;
}

function tcpProbe(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: String(host), port: Number(port) });
    let done = false;
    const finish = (up) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

function waitTcp(host, port, budgetMs = 60000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = async () => {
      if (await tcpProbe(host, port, 1200)) return resolve(true);
      if (Date.now() - started > budgetMs) return resolve(false);
      setTimeout(tick, 1500);
    };
    tick();
  });
}

async function dockerStatus() {
  if (Date.now() - _statusCache.at < 5000 && _statusCache.value) return _statusCache.value;
  const ep = docker.endpoint();
  const where = ep.socketPath || `${ep.host}:${ep.port}`;
  let value;
  try {
    await docker.ping();
    let version = '';
    try { version = String((await docker.version()).Version || ''); } catch { /* 老版本可忽略 */ }
    value = { available: true, mode: ep.kind, endpoint: where, version, hint: '' };
  } catch (e) {
    let hint = '未检测到 Docker：扩展服务将默认使用「外部连接」模式（只登记连接信息）';
    if (ep.kind === 'socket') hint += '；若平台跑在容器内，请为平台容器挂载 /var/run/docker.sock';
    if (ep.kind === 'npipe') hint += '；可启动 Docker Desktop，或设置 DOCKER_HOST=tcp://localhost:2375';
    value = {
      available: false, mode: ep.kind, endpoint: where, version: '',
      error: String(e.message || e), hint,
    };
  }
  _statusCache = { at: Date.now(), value };
  return value;
}

async function findContainer(inst) {
  let items = [];
  try { items = await docker.listContainers(); } catch { return null; }
  if (!Array.isArray(items)) return null;
  const wanted = `dp-ext-${inst.name}`;
  return items.find((c) => {
    const labels = c.Labels || {};
    if (labels[LABEL] === '1' && labels['devplatform.ext.id'] === inst.id) return true;
    return (c.Names || []).some((n) => n.replace(/^\//, '') === wanted);
  }) || null;
}

async function resolveId(inst) {
  if (inst.containerId) {
    try {
      await docker.inspectContainer(inst.containerId);
      return inst.containerId;
    } catch { /* 容器被外部删掉了，继续按标签找 */ }
  }
  const found = await findContainer(inst);
  if (found && found.Id) return found.Id;
  throw new Error(`找不到扩展容器（${inst.name}）：可能已被外部删除，可在面板中卸载后重装`);
}

async function install(inst, manifest, rendered) {
  const containerName = `dp-ext-${inst.name}`;
  const volumeName = `dp-ext-${inst.name}-data`;
  // v0.3.6：镜像可能被加速源拒绝，回退成功后要同步更新实际使用的镜像引用。
  let imageRef = inst.image;
  let image = `${imageRef}:${inst.tag}`;
  const dynamic = manifest.dynamicEnv === 'dbgate-connections' ? dbgateSync.connectionsEnv().env : [];
  // 单个容器代理 > Docker 代理 > 全局代理：把结果注入容器环境，
  // 远程安装时同一份 env 走 600 权限的 --env-file，不出现在命令行里。
  const resolvedProxy = proxyModule.resolve('docker', {
    itemId: inst.id, host: inst.host, entity: inst,
  });
  const proxyPairs = Object.entries(proxyModule.envFor(resolvedProxy));
  const envMap = new Map();
  for (const line of [
    ...Object.entries(rendered.env || {}).map(([k, v]) => `${k}=${String(v)}`),
    ...dynamic,
  ]) {
    const at = line.indexOf('=');
    if (at > 0) envMap.set(line.slice(0, at), line.slice(at + 1));
  }
  for (const [k, v] of proxyPairs) envMap.set(k, v);
  const env = [...envMap.entries()].map(([k, v]) => `${k}=${v}`);

  // 远程安装：SSH 下发 docker run，凭据走远程 600 权限的 --env-file，不进命令行。
  if (isRemote(inst)) {
    const serverId = serverIdOf(inst);
    const server = remoteDocker.findServer(serverId);
    const result = await remoteDocker.install(serverId, {
      id: inst.id, name: containerName, image,
      bindIp: server.host, port: inst.port, internalPort: inst.internalPort,
      volumeName, volumePath: manifest.volume, env,
      command: rendered.command,
    });
    const healthy = await waitTcp(inst.host, inst.port, 60000);
    return {
      ...result, healthy,
      detail: healthy ? `已在 ${server.name} 远程安装，端口可连通` : '远程容器已启动，但 60 秒内端口未就绪',
    };
  }

  const existing = await findContainer(inst);
  if (existing) throw new Error(`同名容器已存在：${containerName}，请先卸载该实例或在 Docker 中手工清理`);

  if (!(await docker.imageExists(imageRef, inst.tag))) {
    // 镜像未在本地时才拉取；内网离线可先 docker load 导入，再在平台里安装。
    // 加速源拒绝命名空间镜像（denied / manifest unknown）时自动回退官方镜像。
    const candidates = imageCandidates(manifest.image, config.dockerImagePrefix);
    let pulled = false;
    let lastError = null;
    for (const ref of candidates) {
      try {
        await docker.pullImage(ref, inst.tag);
        imageRef = ref;
        image = `${ref}:${inst.tag}`;
        pulled = true;
        break;
      } catch (e) {
        lastError = e;
        if (!/denied|manifest unknown|not found|unauthorized|no such image|拉取镜像失败|Docker API/i.test(String(e.message))) break;
      }
    }
    if (!pulled) throw (lastError || new Error('镜像拉取失败'));
  }

  const spec = {
    Image: image,
    Env: env,
    Tty: true,
    OpenStdin: false,
    ExposedPorts: { [`${inst.internalPort}/tcp`]: {} },
    Labels: { [LABEL]: '1', 'devplatform.ext.id': inst.id, 'devplatform.ext.name': inst.name },
    HostConfig: {
      PortBindings: {
        [`${inst.internalPort}/tcp`]: [{ HostIp: config.extBindIp, HostPort: String(inst.port) }],
      },
      Binds: manifest.volume ? [`${volumeName}:${manifest.volume}`] : [],
      RestartPolicy: { Name: 'unless-stopped' },
    },
  };
  if (Array.isArray(rendered.command) && rendered.command.length) spec.Cmd = rendered.command;

  const created = await docker.createContainer(spec, containerName);
  if (!created || !created.Id) throw new Error('Docker 未返回容器 ID');
  const id = created.Id;
  try {
    await docker.startContainer(id);
  } catch (e) {
    await docker.removeContainer(id, true).catch(() => {});
    throw new Error(`容器启动失败：${e.message}`);
  }
  const healthy = await waitTcp(inst.host, inst.port, 60000);
  return {
    containerId: id, containerName, volumeName, healthy, image: imageRef,
    detail: healthy ? '容器运行中，端口可连通' : '容器已启动，但 60 秒内端口未就绪（可看日志）',
  };
}

async function action(inst, actionName) {
  if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(actionName)) {
    throw new Error(`不支持的操作：${actionName}`);
  }
  if (isRemote(inst)) {
    return remoteDocker.action(serverIdOf(inst), containerRef(inst), actionName);
  }
  const id = await resolveId(inst);
  if (actionName === 'start') await docker.startContainer(id);
  else if (actionName === 'stop') await docker.stopContainer(id);
  else if (actionName === 'restart') await docker.restartContainer(id);
  else if (actionName === 'pause') await docker.pauseContainer(id);
  else await docker.unpauseContainer(id);
  let running = false;
  try {
    const info = await docker.inspectContainer(id);
    running = Boolean(info && info.State && info.State.Running);
  } catch { /* noop */ }
  return { running, detail: running ? '容器运行中' : '容器已停止' };
}

async function remove(inst, purge) {
  if (isRemote(inst)) {
    const result = await remoteDocker.remove(serverIdOf(inst), containerRef(inst), Boolean(purge));
    return { removedContainer: result.removed, removedVolume: Boolean(purge && inst.volumeName) };
  }
  let id = inst.containerId;
  try { id = await resolveId(inst); }
  catch { return { removedContainer: false }; }
  try {
    await docker.removeContainer(id, true);
  } catch (e) {
    if (!/404|No such container/i.test(String(e.message))) throw e;
  }
  if (purge && inst.volumeName) {
    await docker.removeVolume(inst.volumeName).catch(() => {});
  }
  return { removedContainer: true, removedVolume: Boolean(purge && inst.volumeName) };
}

async function logs(inst, tail) {
  const n = Math.min(Math.max(Number(tail) || 200, 10), 2000);
  if (isRemote(inst)) return remoteDocker.logs(serverIdOf(inst), containerRef(inst), n);
  const id = await resolveId(inst);
  return docker.containerLogs(id, n);
}

async function health(inst, manifest) {
  let running = false;
  let execOk = null;
  let execOutput = '';
  try {
    if (isRemote(inst)) {
      const serverId = serverIdOf(inst);
      const ref = containerRef(inst);
      const info = await remoteDocker.inspect(serverId, ref);
      running = Boolean(info && info.State && info.State.Running);
      if (running && manifest.health && manifest.health.cmd && manifest.health.cmd.length) {
        const result = await remoteDocker.exec(serverId, ref, manifest.health.cmd, 30000);
        execOk = result.exitCode === 0;
        execOutput = String(result.output || '').trim().slice(0, 200);
      }
    } else {
      const id = await resolveId(inst);
      const info = await docker.inspectContainer(id);
      running = Boolean(info && info.State && info.State.Running);
      if (running && manifest.health && manifest.health.cmd && manifest.health.cmd.length) {
        const result = await docker.execContainer(id, manifest.health.cmd);
        execOk = result.exitCode === 0;
        execOutput = String(result.output || '').trim().slice(0, 200);
      }
    }
  } catch (e) {
    return { healthy: false, running: false, tcp: false, detail: `容器不可查询：${e.message}` };
  }
  const tcp = running ? await tcpProbe(inst.host, inst.port, 1500) : false;
  const healthy = running && tcp && execOk !== false;
  let detail = healthy ? '容器运行中，端口与内部健康检查均通过' : '未通过健康检查';
  if (!running) detail = '容器未运行';
  else if (!tcp) detail = `容器在运行，但 ${inst.host}:${inst.port} 连不上（平台在容器内时请设置 DP_EXT_HOST 为宿主机 IP）`;
  else if (execOk === false) detail = `端口可连通，但内部检查失败${execOutput ? `：${execOutput}` : ''}`;
  return { healthy, running, tcp, execOk, detail };
}

async function externalHealth(inst) {
  const up = await tcpProbe(inst.host, inst.port, 1500);
  return {
    healthy: up, running: null, tcp: up,
    detail: up ? '外部地址可连通（平台仅登记连接信息）' : '外部地址不可达，请检查地址、端口与防火墙',
  };
}

/** 远程服务器的 Docker 是否可用（安装表单选择远程目标时显示）。 */
async function remoteDockerStatus(serverId) {
  try { return await remoteDocker.dockerVersion(serverId); }
  catch (e) { return { available: false, version: '', error: String(e.message || e) }; }
}

module.exports = {
  dockerStatus, remoteDockerStatus, install, action, remove, logs, health, externalHealth,
  tcpProbe, targetOf, isRemote, serverIdOf,
};
