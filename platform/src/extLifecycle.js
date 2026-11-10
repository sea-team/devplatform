'use strict';

/**
 * 扩展实例生命周期：版本升级 / DbGate 连接同步 / 绑定仓库。
 * 只依赖 core / catalog / extRuntime / backup / dbgateSync，不反向依赖 extensions，避免循环引用。
 */
const { state, update, config } = require('./core');
const catalog = require('./catalog');
const runtime = require('./extRuntime');
const backup = require('./backup');
const dbgateSync = require('./dbgateSync');

function allManifests() {
  return require('./extensions').allManifests().items;
}

function findLocal(id) {
  const inst = (state().extensions || []).find((x) => x.id === id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  return inst;
}

function manifestOf(catalogId) {
  const m = allManifests().find((x) => x.id === catalogId);
  if (!m) throw new Error(`未知扩展清单：${catalogId}`);
  return m;
}

function setLocal(id, patch) {
  return update((s) => {
    const inst = (s.extensions || []).find((x) => x.id === id);
    if (!inst) throw new Error(`扩展实例不存在：${id}`);
    Object.assign(inst, patch, { updatedAt: new Date().toISOString() });
    return inst;
  });
}

/** 与 extensions.renderEnv 等价；这里独立实现以免与 extensions 形成循环依赖。 */
function renderEnvLocal(manifest, inst) {
  const enc = (v) => encodeURIComponent(String(v === undefined || v === null ? '' : v));
  const raw = String((inst.secrets && inst.secrets.PASSWORD) || '');
  const vars = {
    HOST: inst.host, PORT: inst.port, INTERNAL_PORT: inst.internalPort,
    PASSWORD: enc(raw), USER: enc(inst.user), DB_NAME: enc(inst.dbName),
    TAG: inst.tag, IMAGE: inst.image, NAME: inst.name,
  };
  const plain = { ...vars, PASSWORD: raw };
  const env = {};
  for (const [k, v] of Object.entries(manifest.env || {})) env[k] = catalog.renderTemplate(v, plain);
  const command = (manifest.command || []).map((p) => catalog.renderTemplate(p, plain));
  return { env, command, vars };
}

/* --------------------------- DbGate 连接同步 --------------------------- */

/**
 * 重建 DbGate 容器以刷新 CONNECTIONS 环境变量（Docker 不允许改运行中容器的 Env）。
 * 命名卷保留，用户登录与查询历史不丢；失败只记录错误，不影响主操作结果。
 */
async function syncDbGate() {
  const dbg = dbgateSync.dbGateInstance();
  if (!dbg) return { synced: false, reason: '未安装 DbGate 实例' };
  try {
    const manifest = manifestOf('dbgate');
    const result = await runtime.install(dbg, manifest, renderEnvLocal(manifest, dbg))
      .catch(async (e) => {
        // 同名容器还在：先移除再装（保留数据卷）。
        if (!/同名容器已存在/.test(String(e.message))) throw e;
        await runtime.remove(dbg, false);
        return runtime.install(dbg, manifest, renderEnvLocal(manifest, dbg));
      });
    setLocal(dbg.id, {
      ...result,
      status: result.healthy ? 'online' : 'partial',
      statusDetail: result.healthy ? '已同步平台内全部数据库连接' : '已重建，端口尚未就绪',
    });
    return { synced: true, connections: dbgateSync.connectionsEnv().count, status: result.healthy ? 'online' : 'partial' };
  } catch (e) {
    setLocal(dbg.id, { status: 'partial', statusDetail: `连接同步失败：${e.message}` });
    return { synced: false, error: String(e.message || e) };
  }
}

/* ------------------------------ 版本升级 ------------------------------ */

async function upgradeInstance(id, newTag) {
  const inst = findLocal(id);
  if (inst.mode !== 'docker') throw new Error('外部连接模式只登记连接信息，不能升级');
  const manifest = manifestOf(inst.catalogId);
  const tag = String(newTag || '').trim();
  if (!manifest.tags.includes(tag)) throw new Error(`不支持的镜像 tag：${tag}`);
  if (tag === inst.tag) throw new Error(`当前已经是 ${tag}，请选择其它版本`);

  // 升级前强制备份；清单没定义备份模板（如 DbGate 工具）时跳过并明确标注。
  let backupId = null;
  if (manifest.backup) {
    const b = await backup.createBackup(id, 'pre-upgrade');
    backupId = b.id;
  }

  const oldTag = inst.tag;
  const before = { ...inst };
  setLocal(id, { tag, status: 'installing', statusDetail: `正在从 ${oldTag} 升级到 ${tag}` });
  const upgraded = { ...inst, tag };

  try {
    await runtime.remove(upgraded, false); // 只删容器，命名卷保留，数据不丢
    const result = await runtime.install(upgraded, manifest, renderEnvLocal(manifest, upgraded));
    if (!result.healthy) throw new Error('新版本容器启动后 60 秒内端口未就绪（可查看日志）');
    setLocal(id, {
      ...result, status: 'online',
      statusDetail: `已从 ${oldTag} 升级到 ${tag}${backupId ? '（升级前已自动备份）' : ''}`,
      lastUpgrade: { from: oldTag, to: tag, at: new Date().toISOString(), backupId },
    });
    const sync = await syncDbGate();
    return {
      instanceId: id, from: oldTag, to: tag, backupId,
      status: 'online', volumeKept: result.volumeName, dbgate: sync,
      rolledBack: false,
    };
  } catch (e) {
    // 回滚：换回旧 tag → 清掉新容器 → 用同一个命名卷重建旧版本 → 必要时恢复备份。
    const notes = [];
    try { await runtime.remove(upgraded, false); } catch (err) { notes.push(`清理新容器：${err.message}`); }
    try {
      const back = await runtime.install(before, manifest, renderEnvLocal(manifest, before));
      setLocal(id, {
        ...back, tag: oldTag,
        status: back.healthy ? 'online' : 'partial',
        statusDetail: `升级到 ${tag} 失败，已回滚到 ${oldTag}`,
      });
    } catch (err) { notes.push(`重建旧版本：${err.message}`); }
    if (backupId) {
      try { await backup.restoreBackup(backupId, { confirm: true, instanceId: id }); }
      catch (err) { notes.push(`恢复备份：${err.message}`); }
    }
    setLocal(id, { tag: oldTag });
    throw new Error(`升级失败，已回滚到 ${oldTag}${notes.length ? `；${notes.join('；')}` : ''}。原因：${e.message}`);
  }
}

/* --------------------------- 多实例 / 绑定仓库 --------------------------- */

function setRepos(id, repoIds) {
  findLocal(id);
  const list = Array.isArray(repoIds) ? repoIds.slice(0, 50).map((x) => String(x).trim().slice(0, 200)).filter(Boolean) : [];
  setLocal(id, { repoIds: list });
  return { instanceId: id, repoIds: list };
}

/** 把绑定的仓库 id 转成工作区内的 .env 目标路径（仓库名作为目录名）。 */
function repoTargets(id) {
  const inst = findLocal(id);
  return (inst.repoIds || []).map((rid) => {
    const fullName = String(rid).split(':').slice(1).join(':') || String(rid);
    const name = fullName.split('/').pop().replace(/\.git$/, '').replace(/[^A-Za-z0-9_.-]/g, '-');
    return name ? `${name}/.env` : null;
  }).filter(Boolean);
}

function publicRepos(id) {
  const inst = findLocal(id);
  return { instanceId: id, repoIds: inst.repoIds || [], targets: repoTargets(id) };
}

module.exports = {
  syncDbGate, upgradeInstance, setRepos, repoTargets, publicRepos,
  setLocal, findLocal, manifestOf, renderEnvLocal,
};
