'use strict';

/**
 * 资源归属与协作者权限（账号体系 v0.4.0）。
 *
 * 语义参照 Gitea 仓库协作：
 *   - 站点管理员：查看 / 操作所有资源；
 *   - owner（创建者）：对自己的资源全权，可管理协作者、可删除；
 *   - collaborator：由 owner / 管理员指定，read = 只读，write = 可查看与操作，
 *     但不能删除资源、不能改协作者（这两类动作需要 owner / 管理员）。
 *
 * 所有「用户添加的数据」在创建时写入 ownerId；历史数据在初始化账号时统一归到初始管理员。
 * 派生资源（SSH 文件 / 终端、Docker 容器、OpenList 文件、Git 仓库文件）通过 URL / body 里的
 * serverId、connectionId、sourceId 等父资源 id 继承权限，见 guardById()。
 *
 * 边界：权限只能管到「平台登记的资源对象」。一旦账号被授权操作某台服务器，就能看到该主机上
 * 的全部容器与文件；外部系统（SSH / Docker / OpenList / Git）内部的多租户隔离不在此层实现。
 */
const { state, update, HttpError, badRequest, notFound, OWNED_COLLECTIONS } = require('./core');

/** 可归属的顶层集合：与 core.js 的自动归属列表保持同源。 */
const COLLECTIONS = OWNED_COLLECTIONS;

/**
 * 可在「资源协作」页授权协作者的集合。
 * 构建记录 / 部署记录属于一次性流水产物，不适合按仓库语义协作，故从协作列表剔除；
 * 但它们仍保留在 COLLECTIONS 中，owner 归属、可见性与删除权限照常生效。
 */
const COLLAB_COLLECTIONS = COLLECTIONS.filter((t) => t !== 'builds' && t !== 'deploys');

const TYPE_LABELS = {
  servers: '服务器', gitSources: 'Git 源', aiProviders: 'AI 服务',
  builds: '构建记录', deploys: '部署记录', extensions: '扩展 / 数据库实例',
  composeTemplates: 'Compose 模板', backups: '备份任务', openlistConnections: '存储连接',
};

/** 站点级配置：普通用户只读（仅写操作受限），管理员可改。 */
const GLOBAL_WRITE_PATTERNS = [
  /^\/api\/env-config$/,
  /^\/api\/system\//,
  /^\/api\/environment\//,
  /^\/api\/environment$/,
  /^\/api\/proxy\//,
  /^\/api\/proxy$/,
  /^\/api\/git\/runtime/,
  /^\/api\/ide\/config/,
  /^\/api\/extensions\/settings/,
  /^\/api\/extensions\/dbgate/,
  // 深度审计修复 · 越权收口：只收「没有归属对象、改的是全站状态」的接口。
  // OpenList 连接 / 存储挂载属于可归属资源或上游对象，权限必须落到具体对象上
  // （见 guard() 里的对象级分支），不能用路径级白名单一刀切，否则普通用户
  // 无法登记并启用自己的 OpenList、write 协作者也无法编辑被授权的连接。
  /^\/api\/services\/setup(?:\/|$)/,                 // 一键安装（后端已 requireAdmin，双保险）
  /^\/api\/services\/credentials(?:\/|$)/,           // 集成服务账号 / 口令（明文与写操作仅管理员）
];

const isAdmin = (user) => Boolean(user && user.role === 'admin');
const collaboratorsOf = (item) => (Array.isArray(item && item.collaborators) ? item.collaborators : []);

function isGlobalConfigPath(pathname) {
  return GLOBAL_WRITE_PATTERNS.some((re) => re.test(pathname));
}

/**
 * action: read | write | delete | manage。
 * 管理员与 owner 全权；协作者 write 只能 read/write，delete/manage 一律拒绝。
 */
function can(user, item, action = 'read') {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!item) return false;
  if (item.ownerId && item.ownerId === user.id) return true;
  const entry = collaboratorsOf(item).find((c) => c && c.userId === user.id);
  if (!entry) return false;
  if (action === 'read') return true;
  if (action === 'delete' || action === 'manage') return false;
  return entry.permission === 'write' || entry.permission === 'admin';
}

function assertCan(user, item, action = 'read') {
  if (!can(user, item, action)) {
    throw new HttpError(403, '无权访问该资源：仅所有者、被授权的协作者或管理员可操作');
  }
  return item;
}

/** 列表过滤：管理员看到全部，普通用户看到自己的 + 被协作的。 */
function visible(user, items) {
  const list = Array.isArray(items) ? items : [];
  return isAdmin(user) ? list : list.filter((item) => can(user, item, 'read'));
}

/** 新建资源时补 ownerId / collaborators，编辑时保留原归属。 */
function assignOwner(payload, user, previous) {
  return {
    ...payload,
    ownerId: previous && previous.ownerId ? previous.ownerId : ((user && user.id) || ''),
    collaborators: previous ? collaboratorsOf(previous) : [],
  };
}

function findResourceById(id) {
  if (!id || typeof id !== 'string' || !id.includes('_')) return null;
  for (const collection of COLLECTIONS) {
    const item = (state()[collection] || []).find((x) => x && x.id === id);
    if (item) return { collection, item };
  }
  return null;
}

/** 从 params / query / body / 路径里收集可能的资源 id。 */
function collectIds(req, pathname) {
  const ids = new Set();
  const add = (v) => { if (typeof v === 'string' && v.includes('_')) ids.add(v); };
  Object.values(req.params || {}).forEach(add);
  const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
  const query = req.query || {};
  for (const key of ['id', 'serverId', 'connectionId', 'repoId', 'sourceId', 'instanceId',
    'buildId', 'deployId', 'templateId', 'providerId', 'backupId']) {
    add(query[key]); add(body[key]);
  }
  // 构建接口把「构建成功后自动部署」的目标服务器藏在 body.deploy.serverId 里，
  // 顶层扫描不到。不收集它，普通用户就能借自动部署在他人的 SSH 主机上执行任意命令。
  if (body.deploy && typeof body.deploy === 'object') add(body.deploy.serverId);
  for (const segment of String(pathname || '').split('/')) add(segment);
  return ids;
}

/**
 * 挂载按账号隔离后的文件范围校验：挂载列表被裁剪了，但文件接口若仍能直接输入
 * 别人的挂载路径，隔离就等于没做。根路径 '/' 放行（列表内容由 listFiles 按归属
 * 过滤），其余路径要求第一段是该用户自己挂载的目录段；管理员不受限。
 */
function mountFileScopeAllows(p, user) {
  if (isAdmin(user) || ['cli', 'off', 'token'].includes(user && user.via)) return true;
  const dir = String(p || '').trim();
  if (dir === '/') return true;
  if (!dir.startsWith('/')) return false;
  const seg = dir.replace(/^\/+/, '').split('/')[0];
  if (!seg) return false;
  const owners = state().openlistMountOwners;
  const table = owners && typeof owners === 'object' && !Array.isArray(owners) ? owners : {};
  const uidValue = user && user.id;
  return Object.values(table).some((rec) => rec && rec.ownerId && uidValue
    && rec.ownerId === uidValue
    && String(rec.mountPath || '').replace(/^\/+/, '').split('/')[0] === seg);
}

/**
 * 写操作的目标名称校验：目录写成 '/' 对「读根目录列表」是合法的，但 mkdir / remove /
 * upload 若也只传 '/'，普通账号就能用 names 指向别人的挂载目录名，绕过挂载隔离。
 * 因此凡目录落在根，必须同时给出具体的 name / names / query.name，且拼出来的
 * 第一段必须属于该用户自己的挂载段。
 */
function fileWriteScopeAllows(req, user) {
  const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
  const query = req.query || {};
  const dirs = [query.path, body.path, body.srcDir, body.dstDir]
    .filter((v) => typeof v === 'string' && v.length);
  if (!dirs.length) return true; // 如 /api/storage/mounts：不带路径参数
  if (dirs.every((d) => String(d).trim() !== '/' && mountFileScopeAllows(d, user))) return true;
  const names = [];
  const add = (v) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === 'string' && v.trim()) names.push(v.trim());
  };
  add(body.name); add(body.names); add(query.name);
  if (!names.length) return false;
  return names.every((n) => {
    const seg = String(n).replace(/^\/+/, '').split('/')[0];
    return seg && seg !== '.' && seg !== '..' && mountFileScopeAllows(`/${seg}`, user);
  });
}

/**
 * 请求级守卫：mini.js 在调用 handler 前执行。
 * 列表数据由各 handler 用 visible() 过滤；这里负责带 id 的单条 / 派生资源操作。
 */
function guard(req, pathname) {
  const user = req.user;
  if (!user) return false;
  if (user.via === 'cli') return true;             // CLI 白名单路径在 auth.authorize 里二次限制
  if (isAdmin(user)) return true;
  // AI 对话会话的归属由 aiSessions 模块逐入口校验（不在归属集合内）。
  // body 里的 providerId 只是「选用哪个服务」，不能按 write 该服务商资源来判定，
  // 否则只被授予 read 协作的账号将无法使用共享 AI 服务。
  if (/^\/api\/ai\/sessions(?:\/|$)/.test(String(pathname || ''))) return true;
  const method = String(req.method || 'GET').toUpperCase();
  const action = method === 'GET' || method === 'HEAD' ? 'read'
    : method === 'DELETE' ? 'delete' : 'write';
  // 单项代理覆盖（v0.4.4）：入口已下沉到对象新增 / 编辑表单，不再当站点级配置处理。
  // 命中归属集合的对象按「可写」判定（owner / write 协作者 / 管理员）；仓库、容器等
  // 外部对象不在归属集合里，覆盖只影响该对象本身，已登录用户即可配置。
  if (action !== 'read' && /^\/api\/proxy\/overrides(?:\/|$)/.test(String(pathname || ''))) {
    const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
    const rawPath = String(pathname || '').split('/').slice(5).join('/');
    let fromPath = rawPath;
    try { fromPath = decodeURIComponent(rawPath); } catch { /* 非法编码时按原文 */ }
    const targetId = String((req.query && req.query.id) || body.id || fromPath || '');
    if (!targetId) return false;
    const found = findResourceById(targetId);
    return found ? can(user, found.item, 'write') : true;
  }
  // OpenList 连接是平台可归属资源（可在「资源协作」里授予 read / write）。
  // 新建连接、按 id 编辑 / 删除 / 设为当前，都交给下面的 collectIds +
  // findResourceById 按 owner / 协作者判定：普通用户能登记并启用自己的 OpenList，
  // write 协作者能编辑 / 启用被授权的连接，read 协作者只读，无关用户被拒。
  // 只有旧接口 PUT /connection 与 /connection/reset 直接改全局活动连接，
  // 这里按目标连接对象的 write 权限兜底；.env 默认连接无归属，仅管理员可动。
  if (action !== 'read' && /^\/api\/openlist\/connection(?:\/reset)?$/.test(String(pathname || ''))) {
    const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
    const targetId = String(body.id || state().openlistActiveId || '');
    const found = findResourceById(targetId);
    return found ? can(user, found.item, 'write') : false;
  }
  // IDE 明文密码：查询「是否已配置」所有登录用户可用，只有 reveal 明文限管理员，
  // 避免把 CODE_SERVER_PASSWORD 泄露给任意账号。
  if (action !== 'read' && /^\/api\/ide\/password$/.test(String(pathname || ''))) {
    const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
    return body.reveal !== true;
  }
  if (action !== 'read' && isGlobalConfigPath(pathname)) return false;
  // OpenList 文件 / 兼容存储接口：路径必须落在该用户自己添加的挂载内。
  // GET 也要校验，否则「读文件内容」能绕过挂载列表隔离；写操作额外校验目标名称，
  // 否则从根目录 '/' 提交别人的挂载目录名就能越权删改。
  if (/^\/api\/(?:openlist\/files|storage)(?:\/|$)/.test(String(pathname || ''))) {
    if (action === 'read') {
      const query = req.query || {};
      const body = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
      const paths = [query.path, body.path, body.srcDir, body.dstDir]
        .filter((v) => typeof v === 'string' && v.length);
      if (paths.length && !paths.every((p) => mountFileScopeAllows(p, user))) return false;
    } else if (!fileWriteScopeAllows(req, user)) return false;
  }
  for (const id of collectIds(req, pathname)) {
    const found = findResourceById(id);
    if (found && !can(user, found.item, action)) return false;
  }
  return true;
}

function resourceByType(user, type, id, action = 'read') {
  if (!COLLAB_COLLECTIONS.includes(type)) throw badRequest(`不支持的协作资源类型：${type}`);
  const item = (state()[type] || []).find((x) => x && x.id === id);
  if (!item) throw notFound('资源不存在');
  assertCan(user, item, action);
  return { type, item };
}

function collaboratorsView(user, type, id) {
  const { item } = resourceByType(user, type, id);
  // 已禁用账号不再出现在可选协作者里：账号禁用时 core.update() 会清掉旧引用。
  const users = (state().users || []).filter((u) => u && u.status !== 'disabled').map((u) => ({
    id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role,
  }));
  return {
    type, id, label: TYPE_LABELS[type] || type,
    name: item.name || item.host || item.title || id,
    ownerId: item.ownerId || '',
    canManage: can(user, item, 'manage'),
    collaborators: collaboratorsOf(item).map((c) => {
      const u = (state().users || []).find((x) => x.id === c.userId);
      return { userId: c.userId, permission: c.permission || 'read',
        username: u ? u.username : '(账号已删除)', displayName: u ? (u.displayName || u.username) : '' };
    }),
    users: users.filter((u) => u.id !== item.ownerId),
  };
}

function setCollaborators(user, type, id, list) {
  const { item } = resourceByType(user, type, id, 'manage');
  if (!Array.isArray(list)) throw badRequest('协作者列表格式不正确');
  const known = new Set((state().users || []).filter((u) => u && u.status !== 'disabled').map((u) => u.id));
  const normalized = [];
  for (const entry of list) {
    const userId = String((entry && entry.userId) || '');
    const permission = String((entry && entry.permission) || 'read');
    if (!known.has(userId)) throw badRequest(`协作者账号不存在：${userId}`);
    if (!['read', 'write'].includes(permission)) throw badRequest('协作者权限只能是 read 或 write');
    if (userId === item.ownerId) continue;         // owner 无需重复添加
    if (!normalized.some((x) => x.userId === userId)) normalized.push({ userId, permission });
  }
  update((s) => {
    const target = (s[type] || []).find((x) => x && x.id === id);
    if (target) target.collaborators = normalized;
  });
  return collaboratorsView(user, type, id);
}

/** 供资源协作页使用：列出某用户可见的全部可协作资源（含它作为协作者的）。 */
function resourcesFor(user) {
  const rows = [];
  for (const type of COLLAB_COLLECTIONS) {
    for (const item of visible(user, state()[type] || [])) {
      rows.push({
        type, id: item.id, label: TYPE_LABELS[type] || type,
        name: item.name || item.host || item.title || item.id,
        ownerId: item.ownerId || '', isOwner: item.ownerId === user.id,
        permission: item.ownerId === user.id ? 'owner'
          : (collaboratorsOf(item).find((c) => c.userId === user.id) || {}).permission || '',
        collaboratorCount: collaboratorsOf(item).length,
      });
    }
  }
  return rows;
}

module.exports = {
  COLLECTIONS, COLLAB_COLLECTIONS, TYPE_LABELS, isAdmin, can, assertCan, visible, assignOwner,
  findResourceById, guard, isGlobalConfigPath, collaboratorsView,
  setCollaborators, resourcesFor, collaboratorsOf,
};
