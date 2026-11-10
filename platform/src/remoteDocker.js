'use strict';

/**
 * SSH 远程 Docker 适配器。
 *
 * 为什么用 docker CLI 而不是把 docker.sock 转发出来：
 *  - 远程机器通常没有开启 TCP 2375（开启等于把 root 暴露出去）；
 *  - sshExec 已在平台里存在并受 ADMIN_TOKEN / 只读白名单约束；
 *  - CLI 的 --format '{{json .}}' 输出可直接归一化成本机 dockerApi 相同的结构。
 *
 * 安全边界：
 *  - 所有用户可控值（容器名、镜像名、tag、路径、id）都经过白名单正则 + 单引号转义；
 *  - 密码等凭据不出现在命令行里，改走远程 600 权限的 --env-file，用完立即删除；
 *  - 平台只操作带 devplatform.ext=1 标签或 dp-ext- 前缀的容器。
 */
const { state } = require('./core');
const { sshExec } = require('./integrations');

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_PATH = /^\/[A-Za-z0-9_./-]{1,200}$/;

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function assertName(v, what) {
  if (!SAFE_NAME.test(String(v || ''))) throw new Error(`${what} 不合法：${String(v).slice(0, 60)}`);
  return String(v);
}

function findServer(serverId) {
  const id = String(serverId || '').replace(/^server:/, '');
  const s = (state().servers || []).find((x) => x.id === id);
  if (!s) throw new Error(`服务器不存在：${id}（请先在「服务器」页登记）`);
  return s;
}

async function run(serverId, command, timeout = 60000) {
  const s = findServer(serverId);
  const r = await sshExec(s, command, timeout);
  if (r.code !== 0) {
    throw new Error(`远程 docker 命令失败（exit ${r.code}）：${String(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  }
  return r;
}

function parseJsonLines(stdout) {
  return String(stdout || '').split('\n').map((x) => x.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

/* ------------------------------ 只读查询 ------------------------------ */

async function dockerVersion(serverId) {
  const r = await sshExec(findServer(serverId), 'docker version --format "{{.Server.Version}}" 2>/dev/null || docker --version', 20000);
  return { available: r.code === 0, version: String(r.stdout || '').trim().slice(0, 60), error: r.stderr.trim().slice(0, 200) };
}

async function ps(serverId) {
  const r = await run(serverId, "docker ps -a --format '{{json .}}'", 30000);
  return parseJsonLines(r.stdout).map((c) => ({
    Id: c.ID || '', Names: [c.Names || ''], Image: c.Image || '',
    ImageID: c.ImageID || '', State: (c.State || '').toLowerCase(),
    Status: c.Status || '', Ports: c.Ports || '', Created: c.CreatedAt || '',
    Labels: (() => {
      const out = {};
      String(c.Labels || '').split(',').forEach((kv) => {
        const i = kv.indexOf('=');
        if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
      });
      return out;
    })(),
  }));
}

async function images(serverId) {
  const r = await run(serverId, "docker images --format '{{json .}}'", 30000);
  return parseJsonLines(r.stdout).map((i) => ({
    Id: i.ID || '', RepoTags: i.Tag === '<none>' ? [] : [`${i.Repository}:${i.Tag}`],
    Size: i.Size || '', Created: i.CreatedAt || '', Repository: i.Repository || '', Tag: i.Tag || '',
  }));
}

async function volumes(serverId) {
  const r = await run(serverId, "docker volume ls --format '{{json .}}'", 30000);
  return parseJsonLines(r.stdout).map((v) => ({ Name: v.Name || '', Driver: v.Driver || '', Mountpoint: v.Mountpoint || '' }));
}

async function networks(serverId) {
  const r = await run(serverId, "docker network ls --format '{{json .}}'", 30000);
  return parseJsonLines(r.stdout).map((n) => ({ Id: n.ID || '', Name: n.Name || '', Driver: n.Driver || '', Scope: n.Scope || '' }));
}

async function logs(serverId, container, tail = 200) {
  const name = assertName(container, '容器名');
  const r = await run(serverId, `docker logs --tail ${Math.min(Math.max(Number(tail) || 200, 10), 2000)} ${shq(name)} 2>&1`, 60000);
  return String(r.stdout || '').slice(-200000);
}

async function inspect(serverId, container) {
  const name = assertName(container, '容器名');
  const r = await run(serverId, `docker inspect ${shq(name)}`, 30000);
  try {
    const arr = JSON.parse(r.stdout);
    const c = arr[0] || {};
    return { State: { Running: Boolean(c.State && c.State.Running) }, Config: c.Config || {}, Mounts: c.Mounts || [] };
  } catch { return { State: { Running: false } }; }
}

async function exec(serverId, container, cmd, timeout = 120000) {
  const name = assertName(container, '容器名');
  if (!Array.isArray(cmd) || !cmd.length || cmd.length > 16) throw new Error('exec 命令必须是 1~16 段数组');
  const quoted = cmd.map((p) => shq(String(p).slice(0, 400))).join(' ');
  const r = await sshExec(findServer(serverId), `docker exec ${shq(name)} ${quoted}`, timeout);
  return { exitCode: r.code, output: `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}` };
}

/* ------------------------------ 容器操作 ------------------------------ */

async function action(serverId, container, actionName) {
  if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(actionName)) throw new Error(`不支持的操作：${actionName}`);
  const name = assertName(container, '容器名');
  const cmd = actionName === 'stop' ? `docker stop -t 10 ${shq(name)}`
    : actionName === 'restart' ? `docker restart -t 10 ${shq(name)}`
      : `docker ${actionName} ${shq(name)}`;
  await run(serverId, cmd, 60000);
  const info = await inspect(serverId, name);
  return { running: Boolean(info.State && info.State.Running) };
}

async function remove(serverId, container, purgeVolume = false) {
  const name = assertName(container, '容器名');
  await run(serverId, `docker rm -f ${shq(name)}`, 60000);
  if (purgeVolume) {
    const vol = assertName(`dp-ext-${name.replace(/^dp-ext-/, '')}-data`, '数据卷名');
    await sshExec(findServer(serverId), `docker volume rm ${shq(vol)} 2>/dev/null || true`, 30000);
  }
  return { removed: true };
}

/**
 * 远程安装：把平台渲染好的 env 写成远程临时 env-file（600），
 * 用 `docker run --env-file` 启动，凭据不进命令行，随后清理临时文件。
 */
async function install(serverId, spec) {
  const name = assertName(spec.name, '容器名');
  const image = assertName(spec.image, '镜像名');
  const volumeName = spec.volumeName ? assertName(spec.volumeName, '数据卷名') : '';
  const envFile = `/tmp/dp-env-${name}-${Date.now()}`;
  const envText = (spec.env || []).map((line) => String(line).replace(/\n/g, '')).join('\n') + '\n';

  const parts = ['docker run -d', `--name ${shq(name)}`, '--restart unless-stopped',
    `--label devplatform.ext=1`, `--label ${shq(`devplatform.ext.id=${spec.id || name}`)}`,
    `--label ${shq(`devplatform.ext.name=${name.replace(/^dp-ext-/, '')}`)}`];
  if (spec.bindIp) parts.push(`-p ${shq(`${spec.bindIp}:${Number(spec.port)}:${Number(spec.internalPort)}`)}`);
  else parts.push(`-p ${Number(spec.port)}:${Number(spec.internalPort)}`);
  if (volumeName && spec.volumePath) {
    assertName(spec.volumePath.replace(/^\//, ''), '容器内卷路径');
    parts.push(`-v ${shq(`${volumeName}:${spec.volumePath}`)}`);
  }
  parts.push(`--env-file ${shq(envFile)}`);
  if (Array.isArray(spec.command) && spec.command.length) {
    parts.push(spec.command.map((c) => shq(String(c).slice(0, 400))).join(' '));
  }
  parts.push(shq(image));

  const s = findServer(serverId);
  const writeEnv = `umask 077 && printf '%s' ${shq(envText)} > ${shq(envFile)} && chmod 600 ${shq(envFile)}`;
  const w = await sshExec(s, writeEnv, 20000);
  if (w.code !== 0) throw new Error(`写入远程环境文件失败：${w.stderr}`);
  try {
    if (!(await imageExists(serverId, image))) await pull(serverId, image);
    const r = await sshExec(s, parts.join(' '), 120000);
    if (r.code !== 0) throw new Error(`远程创建容器失败：${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
    return { containerId: String(r.stdout || '').trim().slice(0, 80), containerName: name, volumeName };
  } finally {
    // 无论成功失败都清掉含凭据的临时文件。
    await sshExec(s, `rm -f ${shq(envFile)}`, 10000).catch(() => {});
  }
}

async function imageExists(serverId, image) {
  const img = assertName(image, '镜像名');
  const r = await sshExec(findServer(serverId), `docker image inspect ${shq(img)} >/dev/null 2>&1 && echo yes || echo no`, 30000);
  return r.stdout.trim() === 'yes';
}

async function pull(serverId, image) {
  const img = assertName(image, '镜像名');
  const r = await sshExec(findServer(serverId), `docker pull ${shq(img)}`, 600000);
  if (r.code !== 0) throw new Error(`远程拉取镜像失败：${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return { image: img };
}

/** 离线镜像导入：远程已有 tar 路径（推荐，避免 100MB HTTP 上限）。 */
async function loadFromPath(serverId, remotePath) {
  if (!SAFE_PATH.test(String(remotePath || ''))) throw new Error('远程镜像路径必须是绝对路径且不含空格或特殊字符');
  const r = await run(serverId, `docker load -i ${shq(remotePath)}`, 600000);
  return { loaded: true, output: String(r.stdout || '').slice(0, 2000) };
}

async function removeImage(serverId, image) {
  const img = assertName(image, '镜像名');
  await run(serverId, `docker rmi ${shq(img)}`, 120000);
  return { removed: true };
}

/* ------------------------------ 备份恢复 ------------------------------ */

/**
 * 远程逻辑备份：docker exec 的标准输出直接重定向到「宿主机」文件（二进制安全），
 * 平台再用 SFTP 把这个文件拉回本机存档。不在容器内留临时文件，也不会把凭据写进命令行。
 */
async function backupToFile(serverId, container, dumpShell, remoteDumpPath) {
  const name = assertName(container, '容器名');
  if (!SAFE_PATH.test(remoteDumpPath)) throw new Error('远程备份路径必须是绝对路径且不含空格或特殊字符');
  const dir = remoteDumpPath.replace(/\/[^/]+$/, '');
  const r = await sshExec(findServer(serverId),
    `mkdir -p ${shq(dir)} && docker exec ${shq(name)} sh -c ${shq(dumpShell)} > ${shq(remoteDumpPath)}`,
    600000);
  if (r.code !== 0) throw new Error(`远程备份失败：${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return { remotePath: remoteDumpPath };
}

/** 远程恢复：通过 `docker exec -i` 把存档从 stdin 灌进容器，命令模板固定、不含用户值。 */
async function restoreFromFile(serverId, container, remoteDumpPath, restoreShell) {
  const name = assertName(container, '容器名');
  if (!SAFE_PATH.test(remoteDumpPath)) throw new Error('远程备份路径不合法');
  const r = await sshExec(findServer(serverId),
    `docker exec -i ${shq(name)} sh -c ${shq(restoreShell)} < ${shq(remoteDumpPath)}`, 600000);
  if (r.code !== 0) throw new Error(`远程恢复失败：${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return { restored: true };
}

module.exports = {
  shq, assertName, findServer, run, dockerVersion, ps, images, volumes, networks,
  logs, inspect, exec, action, remove, install, imageExists, pull,
  loadFromPath, removeImage, backupToFile, restoreFromFile,
};
