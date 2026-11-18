'use strict';

/**
 * 用户家目录（C 批 v0.4.17）。
 *
 * 建账号时为每个用户在 OpenList 建一个独立家目录 /workspace/users/<username>，并写一条
 * directories[] 归属记录（owner = 该用户，可被授予 read / write 协作者）。文件访问
 * 隔离不再只看「挂载首段」，而是按家目录完整路径前缀判定：
 *   - /workspace/users/alice 只有 alice（owner）、alice 的协作者、管理员可访问；
 *   - /workspace/users/bob 对 alice 不可见；
 *   - 平台原有的自建挂载（openlistMountOwners）继续按首段隔离，互不干扰。
 *
 * 家目录必须落在 OpenList 已有挂载下（246 上唯一挂载是 /workspace），否则上游 mkdir
 * 报「storage not found」。因此 HOME_ROOT 取 /workspace/users，而不是 OpenList 根 /users。
 *
 * OpenList 服务仍是全站单例，隔离在平台侧（permissions.guard + openlist 列表裁剪）实现。
 * 上游目录创建失败不回滚账号创建：账号可用，仅家目录标 error，可稍后重试重建。
 */
const { state, update, uid } = require('./core');
const openlist = require('./openlist');

const HOME_ROOT = '/workspace/users';
const dirIdFor = (userId) => `dir_${String(userId || '')}`;
const homePathFor = (username) => `${HOME_ROOT}/${String(username || '').trim().toLowerCase()}`;

const norm = (p) => String(p || '').replace(/\/+$/, '') || '/';

/** 该用户在 directories[] 里的家目录记录（owner 或 write/read 协作）。 */
function recordFor(user) {
  if (!user) return null;
  const uidValue = user && user.id;
  if (!uidValue) return null;
  const admin = Boolean(user.role === 'admin') || ['cli', 'off', 'token'].includes(user && user.via);
  const list = Array.isArray(state().directories) ? state().directories : [];
  if (admin) return list.find((d) => d && d.id === dirIdFor(uidValue)) || null;
  return list.find((d) => d && (
    d.ownerId === uidValue
    || (Array.isArray(d.collaborators) && d.collaborators.some((c) => c && c.userId === uidValue))
  )) || null;
}

/**
 * 用户可访问的家目录路径前缀集合。
 * owner / 任意 read|write 协作者都可访问（读由 guard 放行，写再看 permission）。
 */
function allowedPrefixes(user) {
  if (!user) return [];
  const uidValue = user.id;
  if (!uidValue) return [];
  const list = Array.isArray(state().directories) ? state().directories : [];
  const out = [];
  for (const d of list) {
    if (!d || !d.dirPath) continue;
    if (d.ownerId === uidValue
      || (Array.isArray(d.collaborators) && d.collaborators.some((c) => c && c.userId === uidValue))) {
      out.push(norm(d.dirPath));
    }
  }
  return out;
}

/** 路径是否落在用户允许的家目录前缀内。根 '/' 交给上层放行（列表会被裁剪）。 */
function allowsPath(user, dir) {
  const p = norm(dir);
  if (p === '/') return true;
  if (p === HOME_ROOT) return true; // /users 是家目录容器，列出后再按子目录裁剪
  return allowedPrefixes(user).some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** read 协作者只读；写权限另判（供未来文件写路径细分使用）。 */
function canWritePath(user, dir) {
  const uidValue = user && user.id;
  if (!uidValue) return false;
  const list = Array.isArray(state().directories) ? state().directories : [];
  const p = norm(dir);
  for (const d of list) {
    if (!d || !d.dirPath || (p !== norm(d.dirPath) && !p.startsWith(`${norm(d.dirPath)}/`))) continue;
    if (d.ownerId === uidValue) return true;
    const c = (d.collaborators || []).find((x) => x && x.userId === uidValue);
    if (c && c.permission === 'write') return true;
  }
  return false;
}

/** 列出所有家目录记录（供管理端展示；调用方按权限可见性过滤）。 */
function listRecords() {
  return (Array.isArray(state().directories) ? state().directories : [])
    .filter((d) => d && d.dirPath && d.dirPath.startsWith(`${HOME_ROOT}/`));
}

/**
 * 为一个账号建家目录（幂等）：上游 mkdir + directories 归属记录 + openlistMountOwners 登记。
 * 返回 { id, path, created, error }；error 非空表示上游失败，账号仍创建成功。
 */
async function provision(user) {
  const username = String((user && user.username) || '').trim().toLowerCase();
  if (!username) return { id: '', path: '', created: false, error: '缺少账号名' };
  const path = homePathFor(username);
  const id = dirIdFor(user.id);
  let error = '';
  try {
    const exists = Array.isArray(state().directories) && state().directories.some((d) => d && d.id === id);
    // 上游 mkdir 幂等：目录已存在时 OpenList 返回错误，忽略即可；只在首次且记录不存在时尝试建。
    if (!exists) {
      // HOME_ROOT=/workspace/users：先确保 /workspace/users 存在，再建 <username>。
      // mkdir 幂等：已存在会报错，忽略即可。
      try { await openlist.mkdir('/workspace', 'users'); } catch { /* 容器可能已存在 */ }
      try {
        await openlist.mkdir(HOME_ROOT, username);
      } catch (e2) { error = String((e2 && e2.message) || e2 || '建目录失败'); }
    }
  } catch (e) { error = String((e && e.message) || e || '建目录失败'); }

  update((s) => {
    if (!Array.isArray(s.directories)) s.directories = [];
    let rec = s.directories.find((d) => d && d.id === id);
    if (!rec) {
      rec = {
        id, name: username, aclKind: 'directory', dirPath: path,
        ownerId: user.id, collaborators: [], createdAt: new Date().toISOString(),
      };
      s.directories.push(rec);
    } else {
      rec.dirPath = path;
      if (!rec.ownerId) rec.ownerId = user.id;
    }
    // 兼容既有挂载归属过滤（首段 = users）；家目录自己用完整路径前缀隔离。
    if (!s.openlistMountOwners || typeof s.openlistMountOwners !== 'object') s.openlistMountOwners = {};
    if (!s.openlistMountOwners[`user:${user.id}`]) {
      s.openlistMountOwners[`user:${user.id}`] = {
        ownerId: user.id, mountPath: path, createdAt: new Date().toISOString(),
      };
    }
  });
  return { id, path, created: !error, error };
}

/** 账号禁用时移除其家目录归属记录（文件保留，避免误删数据）。 */
function release(userId) {
  const id = dirIdFor(userId);
  update((s) => {
    if (Array.isArray(s.directories)) s.directories = s.directories.filter((d) => !d || d.id !== id);
    if (s.openlistMountOwners && s.openlistMountOwners[`user:${userId}`]) {
      delete s.openlistMountOwners[`user:${userId}`];
    }
  });
}

module.exports = {
  HOME_ROOT, dirIdFor, homePathFor, recordFor, allowedPrefixes, allowsPath,
  canWritePath, listRecords, provision, release,
};
