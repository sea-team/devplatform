'use strict';

/**
 * 扩展实例的逻辑备份 / 恢复。
 *
 * 命令全部来自下面 RECIPES 内置白名单（按清单的 backup / restore 枚举选取），
 * 凭据通过容器内环境变量引用，不拼进命令行；清单里不允许写 shell。
 *
 * 本机：exec 生成容器内文件 → docker getArchive 取 tar → 解出原始内容存档；
 *      恢复：把原始内容包成 tar → putArchive 写回 → exec 导入。
 * 远程：docker exec 的 stdout 重定向到远端文件 → SFTP 拉回存档；
 *      恢复：SFTP 上传 → docker exec -i 从 stdin 灌入。
 * 两条路径存档格式一致（原始 dump 字节），便于下载、查看与人工修复。
 */
const fs = require('fs');
const path = require('path');
const { config, state, update, uid } = require('./core');
const docker = require('./dockerApi');
const remoteDocker = require('./remoteDocker');
const remoteOps = require('./remoteOps');
const { sshExec } = require('./integrations');
const { findInstance } = require('./extensions');

const RECIPES = {
  mysqldump: {
    ext: 'sql', label: 'mysqldump 全库',
    dump: 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction --routines --triggers',
    restore: 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"',
  },
  pgdump: {
    ext: 'sql', label: 'pg_dumpall 全库',
    dump: 'pg_dumpall -U "$POSTGRES_USER"',
    restore: 'psql -U "$POSTGRES_USER" -d postgres',
  },
  'redis-rdb': {
    ext: 'rdb', label: 'Redis RDB 快照',
    dump: 'redis-cli -a "$DP_PASSWORD" SAVE >/dev/null && cat /data/dump.rdb',
    restore: 'cat > /data/dump.rdb && rm -rf /data/appendonlydir /data/appendonly.aof',
    restartAfter: true,
  },
};

const RESTORE_RECIPE = { mysql: 'mysqldump', psql: 'pgdump', 'redis-rdb': 'redis-rdb' };
const backupDir = () => path.join(config.dataDir, 'backups');
const fileOf = (id) => path.join(backupDir(), `${id}.dump`);

/* ---------------------- 极简 tar 读写（零依赖） ---------------------- */
// Docker 的 /archive 端点固定用 tar 流；这里只需要单文件的打包与解包。

function tarWrap(name, buf) {
  const header = Buffer.alloc(512);
  const short = String(name).slice(0, 100);
  header.write(short, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(buf.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.fill(0x20, 148, 156); // chksum 先填空格
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  const padded = Buffer.alloc(Math.ceil(buf.length / 512) * 512);
  buf.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

function untarFirst(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 512) throw new Error('容器归档内容为空或格式不对');
  const header = buf.subarray(0, 512);
  const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
  if (!Number.isFinite(size) || size < 0 || 512 + size > buf.length) throw new Error('容器归档头不合法');
  const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
  return { name, data: buf.subarray(512, 512 + size) };
}

/* ------------------------------ 实例解析 ------------------------------ */

function resolve(inst) {
  if (!inst) throw new Error('扩展实例不存在');
  if (inst.mode !== 'docker') throw new Error('外部连接模式只登记连接信息，平台不持有其数据，无法备份或恢复');
  const target = inst.target || 'local';
  return { local: target === 'local', serverId: target.replace(/^server:/, '') };
}

function containerIdOf(inst) {
  if (inst.containerId) return inst.containerId;
  if (inst.containerName) return inst.containerName;
  throw new Error('实例没有容器信息，请先检测状态或重新安装');
}

/* ------------------------------ 备份 ------------------------------ */

async function createBackup(instanceId, reason = 'manual') {
  const inst = findInstance(instanceId);
  const { local, serverId } = resolve(inst);
  const manifest = require('./catalog').builtinCatalog().find((m) => m.id === inst.catalogId)
    || readManifest(inst.catalogId);
  const recipeKey = manifest && manifest.backup;
  const recipe = RECIPES[recipeKey];
  if (!recipe) throw new Error(`清单 ${inst.catalogId} 未定义备份模板，请改用卷快照或外部工具`);
  if (inst.catalogId === 'dbgate') throw new Error('DbGate 是管理工具，不需要备份（连接由平台自动重建）');

  const id = uid('bak');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${inst.name}-${stamp}.${recipe.ext}`;
  let bytes = 0;

  fs.mkdirSync(backupDir(), { recursive: true });
  if (local) {
    const cid = containerIdOf(inst);
    const containerFile = manifest.backupFile || `/tmp/dp-${id}.dump`;
    const dump = await docker.execContainerTimed(cid, ['sh', '-c', `${recipe.dump} > ${containerFile}`], 600000);
    if (dump.exitCode !== 0) {
      throw new Error(`备份命令失败（exit ${dump.exitCode}）：${String(dump.output).slice(0, 300)}`);
    }
    try {
      const tar = await docker.getArchive(cid, containerFile);
      const { data } = untarFirst(Buffer.from(tar));
      fs.writeFileSync(fileOf(id), data, { mode: 0o600 });
      bytes = data.length;
    } finally {
      await docker.execContainerTimed(cid, ['sh', '-c', `rm -f ${containerFile}`], 30000).catch(() => {});
    }
  } else {
    const server = remoteDocker.findServer(serverId);
    const remoteTmp = `${config.remoteTmpDir}/backups/${id}.dump`;
    await remoteDocker.backupToFile(serverId, inst.containerName, recipe.dump, remoteTmp);
    try {
      const data = await remoteOps.readFile(server, remoteTmp, 512 * 1024 * 1024);
      fs.writeFileSync(fileOf(id), data, { mode: 0o600 });
      bytes = data.length;
    } finally {
      await sshExec(server, `rm -f ${remoteDocker.shq(remoteTmp)}`, 20000).catch(() => {});
    }
  }

  if (!bytes) throw new Error('备份内容为空，请确认实例已就绪且数据库可连接');
  const record = {
    id, instanceId, instanceName: inst.name, catalogId: inst.catalogId,
    filename, size: bytes, recipe: recipeKey, recipeLabel: recipe.label,
    target: inst.target || 'local', reason,
    createdAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.backups)) s.backups = [];
    s.backups.unshift(record);
    s.backups = s.backups.slice(0, 200);
  });
  return publicBackup(record);
}

function readManifest(catalogId) {
  // 自定义清单也允许声明 backup/restore 枚举；这里复用 extensions 的加载结果。
  const { allManifests } = require('./extensions');
  return allManifests().items.find((m) => m.id === catalogId);
}

/* ------------------------------ 恢复 ------------------------------ */

async function restoreBackup(backupId, { confirm = false, instanceId = '' } = {}) {
  // 恢复会用存档内容覆盖现有数据，强制二次确认。
  const record = (state().backups || []).find((b) => b.id === backupId);
  if (!record) throw new Error('备份不存在');
  if (!confirm) throw new Error('恢复会覆盖当前数据，请确认后再执行（confirm=true）');
  if (!fs.existsSync(fileOf(record.id))) throw new Error('备份文件已丢失，无法恢复');
  const inst = findInstance(instanceId || record.instanceId);
  if (!inst) throw new Error('目标实例不存在，请选择一个同类型的实例');
  if (inst.catalogId !== record.catalogId) throw new Error(`备份属于 ${record.catalogId}，不能恢复到 ${inst.catalogId} 实例`);
  const { local, serverId } = resolve(inst);
  const manifest = require('./catalog').builtinCatalog().find((m) => m.id === inst.catalogId) || readManifest(inst.catalogId);
  const recipeKey = RECIPES[record.recipe] ? record.recipe : RESTORE_RECIPE[manifest && manifest.restore];
  const recipe = RECIPES[recipeKey];
  if (!recipe) throw new Error('找不到对应的恢复模板');
  const data = fs.readFileSync(fileOf(record.id));

  if (local) {
    const cid = containerIdOf(inst);
    const containerFile = manifest.backupFile || `/tmp/dp-restore-${record.id}.dump`;
    const dir = containerFile.replace(/\/[^/]+$/, '') || '/tmp';
    await docker.putArchive(cid, dir, tarWrap(path.basename(containerFile), data));
    const restored = await docker.execContainerTimed(cid,
      ['sh', '-c', `${recipe.restore} < ${containerFile}`], 600000);
    await docker.execContainerTimed(cid, ['sh', '-c', `rm -f ${containerFile}`], 30000).catch(() => {});
    if (restored.exitCode !== 0) {
      throw new Error(`恢复命令失败（exit ${restored.exitCode}）：${String(restored.output).slice(0, 300)}`);
    }
    if (recipe.restartAfter) await docker.restartContainer(cid);
  } else {
    const server = remoteDocker.findServer(serverId);
    const remoteTmp = `${config.remoteTmpDir}/backups/restore-${record.id}.dump`;
    await remoteOps.writeFile(server, remoteTmp, data);
    try {
      await remoteDocker.restoreFromFile(serverId, inst.containerName, remoteTmp, recipe.restore);
      if (recipe.restartAfter) await remoteDocker.action(serverId, inst.containerName, 'restart');
    } finally {
      await sshExec(server, `rm -f ${remoteDocker.shq(remoteTmp)}`, 20000).catch(() => {});
    }
  }
  return { restored: true, backupId: record.id, instanceId: inst.id, size: data.length, restartAfter: Boolean(recipe.restartAfter) };
}

/* ------------------------------ 查询与删除 ------------------------------ */

function publicBackup(b) {
  return { ...b, file: `${b.id}.dump` };
}

function listBackups(instanceId = '') {
  const items = (state().backups || []).filter((b) => !instanceId || b.instanceId === instanceId);
  return { items: items.map(publicBackup), dir: backupDir() };
}

function deleteBackup(id, alsoFile = true) {
  const record = (state().backups || []).find((b) => b.id === id);
  if (!record) throw new Error('备份不存在');
  update((s) => { s.backups = (s.backups || []).filter((b) => b.id !== id); });
  if (alsoFile) fs.rmSync(fileOf(id), { force: true });
  return { removed: id };
}

function backupBuffer(id) {
  const record = (state().backups || []).find((b) => b.id === id);
  if (!record) throw new Error('备份不存在');
  if (!fs.existsSync(fileOf(id))) throw new Error('备份文件已丢失');
  return { record, buffer: fs.readFileSync(fileOf(id)) };
}

module.exports = {
  RECIPES, RESTORE_RECIPE, tarWrap, untarFirst,
  createBackup, restoreBackup, listBackups, deleteBackup, backupBuffer, backupDir,
};
