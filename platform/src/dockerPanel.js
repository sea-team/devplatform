'use strict';

/**
 * Docker 管理面板（参照宝塔 Docker 模块的镜像 / 容器 / 存储卷 / 网络 / 模板 / 设置六分区）。
 *
 * 安全边界（用户确认的「只读 + 二次确认」）：
 *  - 非平台创建的容器（没有 devplatform.ext=1 标签）默认只能查看状态、日志、详情；
 *  - 对它们做启停 / 暂停 / 重启 / 删除，必须带 confirm=true，且逐条记录到审计日志；
 *  - 平台自建容器正常管理，但删除镜像 / 卷 / 网络一律要求 confirm；
 *  - 不提供任意命令执行入口，容器终端只走固定 shell 的一次性 exec。
 *
 * target：'local'（本机 dockerApi）或 'server:<id>'（remoteDocker 经 SSH）。
 */
const { config, state, update, uid } = require('./core');
const docker = require('./dockerApi');
const remoteDocker = require('./remoteDocker');
const runtime = require('./extRuntime');

const LABEL = 'devplatform.ext';

function splitTarget(target) {
  const t = String(target || 'local');
  return t.startsWith('server:')
    ? { remote: true, serverId: t.replace(/^server:/, ''), label: t }
    : { remote: false, serverId: '', label: 'local' };
}

function isOwned(c) {
  const labels = c.Labels || {};
  return labels[LABEL] === '1' || (c.Names || []).some((n) => /^\/?dp-(ext|build)-/.test(n));
}

function normalizeContainer(c) {
  const names = (c.Names || []).map((n) => String(n).replace(/^\//, ''));
  const ports = [];
  if (Array.isArray(c.Ports)) {
    for (const p of c.Ports) {
      if (p.PublicPort) ports.push(`${p.IP || '0.0.0.0'}:${p.PublicPort}→${p.PrivatePort}/${p.Type || 'tcp'}`);
    }
  } else if (typeof c.Ports === 'string' && c.Ports) {
    ports.push(c.Ports);
  }
  return {
    id: String(c.Id || c.ID || ''), name: names[0] || '',
    image: String(c.Image || ''), state: String(c.State || (c.Status || '').split(' ')[0] || ''),
    status: String(c.Status || c.State || ''), created: c.Created || c.CreatedAt || '',
    ports, owned: isOwned(c), labels: c.Labels || {},
  };
}

function audit(action, target, object, confirmed) {
  const entry = { id: uid('audit'), action, target, object, confirmed: Boolean(confirmed), at: new Date().toISOString() };
  try {
    update((s) => {
      if (!Array.isArray(s.dockerAudit)) s.dockerAudit = [];
      s.dockerAudit.unshift(entry);
      s.dockerAudit = s.dockerAudit.slice(0, 100);
    });
  } catch { /* 审计失败不阻断操作，但不能因此跳过确认 */ }
  return entry;
}

/** 非平台容器的写操作必须二次确认。 */
async function assertWritable(t, containerId, confirm) {
  const list = t.remote
    ? await remoteDocker.ps(t.serverId)
    : await docker.listContainers('all');
  const c = list.find((x) => String(x.Id || x.ID) === String(containerId)
    || (x.Names || []).some((n) => n.replace(/^\//, '') === String(containerId)));
  const owned = c ? isOwned(c) : false;
  if (!owned && !confirm) {
    throw new Error('该容器不是平台创建的（宿主机上的其它服务）。请二次确认后再操作，避免误伤生产服务');
  }
  return { container: c, owned, name: c ? (c.Names || [])[0]?.replace(/^\//, '') || c.Id : containerId };
}

/* ------------------------------ 概览 ------------------------------ */

async function overview(target = 'local') {
  const t = splitTarget(target);
  let status = { available: true, mode: t.remote ? 'ssh' : 'local', version: '', endpoint: '' };
  let containers = [];
  let images = [];
  let volumes = [];
  let networks = [];

  if (t.remote) {
    const v = await remoteDocker.dockerVersion(t.serverId);
    if (!v.available) throw new Error(`目标服务器 Docker 不可用：${v.error || '未检测到 docker 命令'}`);
    status = { ...status, version: v.version, endpoint: (remoteDocker.findServer(t.serverId) || {}).host || '' };
    [containers, images, volumes, networks] = await Promise.all([
      remoteDocker.ps(t.serverId), remoteDocker.images(t.serverId),
      remoteDocker.volumes(t.serverId), remoteDocker.networks(t.serverId),
    ]);
  } else {
    try {
      status = { ...status, ...(await runtime.dockerStatus()), mode: 'local' };
      if (!status.available) throw new Error(status.hint || '本机未检测到 Docker');
      [containers, images, volumes, networks] = await Promise.all([
        docker.listContainers('all'), docker.listImages(), docker.listVolumes(), docker.listNetworks(),
      ]);
    } catch (e) {
      // 本机 Docker 不可用时不抛 500，交给前端展示「可切换到远程目标」。
      return {
        target: t.label, available: false, error: String(e.message || e),
        hint: '本机没有 Docker：可在「目标」里选择已登记的 Linux 服务器远程管理，或使用 START.bat 只跑控制台',
        containers: [], images: [], volumes: [], networks: [], counts: { containers: 0, running: 0, images: 0, volumes: 0, networks: 0 },
        servers: (state().servers || []).map((s) => ({ id: s.id, name: s.name, host: s.host })),
      };
    }
  }

  const cs = containers.map(normalizeContainer);
  return {
    target: t.label, available: true, status,
    containers: cs,
    images: images.map((i) => ({
      id: String(i.Id || ''), tags: i.RepoTags || [i.Repository ? `${i.Repository}:${i.Tag}` : ''],
      repository: i.Repository || '', tag: i.Tag || '', size: i.Size || Number(i.Size || 0),
      created: i.Created || i.CreatedAt || '',
    })),
    volumes: volumes.map((v) => ({ name: v.Name || '', driver: v.Driver || '', mountpoint: v.Mountpoint || '', owned: String(v.Name || '').startsWith('dp-ext-') })),
    networks: networks.map((n) => ({ id: n.Id || '', name: n.Name || '', driver: n.Driver || '', scope: n.Scope || '' })),
    counts: {
      containers: cs.length,
      running: cs.filter((c) => /running|up/i.test(c.state)).length,
      owned: cs.filter((c) => c.owned).length,
      images: images.length, volumes: volumes.length, networks: networks.length,
    },
    servers: (state().servers || []).map((s) => ({ id: s.id, name: s.name, host: s.host })),
    policy: '非平台容器只读；启停/删除需二次确认',
  };
}

/* ------------------------------ 容器 ------------------------------ */

async function containerAction(target, id, action, confirm = false) {
  if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(action)) throw new Error(`不支持的操作：${action}`);
  const t = splitTarget(target);
  const { owned, name } = await assertWritable(t, id, confirm);
  audit(`container:${action}`, t.label, name || id, confirm || owned);
  if (t.remote) return remoteDocker.action(t.serverId, name || id, action);
  if (action === 'start') await docker.startContainer(id);
  else if (action === 'stop') await docker.stopContainer(id);
  else if (action === 'restart') await docker.restartContainer(id);
  else if (action === 'pause') await docker.pauseContainer(id);
  else await docker.unpauseContainer(id);
  return { ok: true, action, id };
}

async function containerRemove(target, id, confirm = false) {
  const t = splitTarget(target);
  const { owned, name } = await assertWritable(t, id, confirm);
  if (!confirm && !owned) throw new Error('删除非平台容器需要二次确认');
  audit('container:remove', t.label, name || id, confirm);
  if (t.remote) return remoteDocker.remove(t.serverId, name || id, false);
  await docker.removeContainer(id, true);
  return { ok: true, removed: id };
}

async function containerLogs(target, id, tail = 200) {
  const t = splitTarget(target);
  if (t.remote) {
    const list = await remoteDocker.ps(t.serverId);
    const c = list.find((x) => String(x.Id) === String(id));
    const name = c ? (c.Names || [])[0] : id;
    return { text: await remoteDocker.logs(t.serverId, name || id, tail) };
  }
  return { text: await docker.containerLogs(id, tail) };
}

async function containerInspect(target, id) {
  const t = splitTarget(target);
  if (t.remote) {
    const list = await remoteDocker.ps(t.serverId);
    const c = list.find((x) => String(x.Id) === String(id));
    return remoteDocker.inspect(t.serverId, c ? (c.Names || [])[0] : id);
  }
  return docker.inspectContainer(id);
}

async function containerStats(target, id) {
  const t = splitTarget(target);
  if (t.remote) return { available: false, hint: '远程目标暂不提供实时资源曲线，可用「服务器」页查看整机状态' };
  try { return { available: true, stats: await docker.containerStats(id) }; }
  catch (e) { return { available: false, hint: String(e.message || e) }; }
}

async function containerExec(target, id, command, confirm = false) {
  const t = splitTarget(target);
  const { owned, name } = await assertWritable(t, id, confirm);
  // 只提供固定白名单命令，不接受任意 shell 字符串，避免把面板变成远程命令执行入口。
  const PRESETS = {
    'ps': ['ps', 'aux'], 'env': ['env'], 'top': ['top', '-b', '-n', '1'],
    'df': ['df', '-h'], 'ip': ['ip', 'addr'], 'shell-version': ['sh', '-c', 'echo $0; uname -a'],
  };
  if (!PRESETS[command]) throw new Error('只允许执行内置只读诊断命令');
  audit(`container:exec:${command}`, t.label, name || id, confirm || owned);
  if (t.remote) return remoteDocker.exec(t.serverId, name || id, PRESETS[command], 30000);
  return docker.execContainerTimed(id, PRESETS[command], 30000);
}

/* ------------------------------ 镜像 ------------------------------ */

async function pullImage(target, image, tag = 'latest') {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(String(image)) || !/^[A-Za-z0-9._-]{1,40}$/.test(String(tag))) {
    throw new Error('镜像名或 tag 不合法');
  }
  const ref = `${config.dockerImagePrefix || ''}${image}`;
  const t = splitTarget(target);
  if (t.remote) {
    await remoteDocker.pull(t.serverId, `${ref}:${tag}`);
    return { pulled: `${ref}:${tag}` };
  }
  await docker.pullImage(ref, tag);
  return { pulled: `${ref}:${tag}` };
}

async function removeImage(target, ref, confirm = false) {
  if (!confirm) throw new Error('删除镜像需要二次确认（可能有其它容器依赖它）');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,159}$/.test(String(ref))) throw new Error('镜像标识不合法');
  audit('image:remove', splitTarget(target).label, ref, confirm);
  const t = splitTarget(target);
  if (t.remote) return remoteDocker.removeImage(t.serverId, ref);
  await docker.removeImage(ref, false);
  return { removed: ref };
}

/** 离线镜像导入：本机接收 tar Buffer（HTTP 上限 100MB），远程用服务器上已有的绝对路径。 */
async function loadImage(target, { buffer = null, remotePath = '' } = {}) {
  const t = splitTarget(target);
  if (t.remote) {
    if (!remotePath) throw new Error('远程导入请填写服务器上已有的镜像 tar 绝对路径（避免大文件上传）');
    return remoteDocker.loadFromPath(t.serverId, remotePath);
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('请选择镜像 tar 文件');
  const output = await docker.loadImage(buffer);
  if (/error/i.test(output)) throw new Error(`docker load 失败：${output.slice(0, 300)}`);
  return { loaded: true, output, size: buffer.length };
}

async function exportImage(target, ref) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,159}$/.test(String(ref))) throw new Error('镜像标识不合法');
  const t = splitTarget(target);
  if (t.remote) return { available: false, hint: '远程镜像导出请在服务器上执行 docker save -o <file> <image>' };
  const buf = await docker.saveImage(ref);
  return { available: true, buffer: Buffer.from(buf) };
}

/* ------------------------------ 卷 / 网络 ------------------------------ */

async function removeVolume(target, name, confirm = false) {
  if (!confirm) throw new Error('删除存储卷会永久丢失数据，需要二次确认');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(name))) throw new Error('卷名不合法');
  audit('volume:remove', splitTarget(target).label, name, confirm);
  const t = splitTarget(target);
  if (t.remote) {
    await remoteDocker.run(t.serverId, `docker volume rm ${remoteDocker.shq(name)}`);
    return { removed: name };
  }
  await docker.removeVolume(name);
  return { removed: name };
}

async function createVolume(target, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(name))) throw new Error('卷名不合法');
  const t = splitTarget(target);
  if (t.remote) {
    await remoteDocker.run(t.serverId, `docker volume create ${remoteDocker.shq(name)}`);
    return { created: name };
  }
  await docker.createVolume(name, { 'devplatform.managed': '1' });
  return { created: name };
}

async function removeNetwork(target, id, confirm = false) {
  if (!confirm) throw new Error('删除网络需要二次确认');
  const t = splitTarget(target);
  audit('network:remove', t.label, id, confirm);
  if (t.remote) {
    await remoteDocker.run(t.serverId, `docker network rm ${remoteDocker.shq(String(id))}`);
    return { removed: id };
  }
  await docker.removeNetwork(id);
  return { removed: id };
}

async function createNetwork(target, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(name))) throw new Error('网络名不合法');
  const t = splitTarget(target);
  if (t.remote) {
    await remoteDocker.run(t.serverId, `docker network create ${remoteDocker.shq(name)}`);
    return { created: name };
  }
  await docker.createNetwork(name);
  return { created: name };
}

/* --------------------------- Compose 模板 --------------------------- */
// 模板只做登记与编辑（纯文本，≤64KB）；不会在平台上直接执行 compose，
// 避免把面板变成任意编排执行入口。用户可复制到目标机器自行 up -d。

function listTemplates() {
  return { items: (state().composeTemplates || []).map((t) => ({ ...t, lines: String(t.content || '').split('\n').length })) };
}

function saveTemplate(body = {}) {
  const name = String(body.name || '').trim().slice(0, 80);
  const content = String(body.content || '').slice(0, 65536);
  if (!name || !content) throw new Error('请填写模板名称与内容');
  const item = {
    id: body.id || uid('tpl'), name, description: String(body.description || '').slice(0, 200),
    content, updatedAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.composeTemplates)) s.composeTemplates = [];
    const i = s.composeTemplates.findIndex((x) => x.id === item.id);
    if (i >= 0) s.composeTemplates[i] = item; else s.composeTemplates.push(item);
  });
  return item;
}

function deleteTemplate(id) {
  update((s) => { s.composeTemplates = (s.composeTemplates || []).filter((x) => x.id !== id); });
  return { removed: id };
}

function auditList() {
  return { items: state().dockerAudit || [] };
}

module.exports = {
  overview, normalizeContainer, isOwned, splitTarget,
  containerAction, containerRemove, containerLogs, containerInspect, containerStats, containerExec,
  pullImage, removeImage, loadImage, exportImage,
  removeVolume, createVolume, removeNetwork, createNetwork,
  listTemplates, saveTemplate, deleteTemplate, auditList,
};
