'use strict';

/**
 * OpenList（兼容 AList V3 API）管理集成。
 *
 * 「存储 / 文件」页不再只是一个只读的文件列表：这里把 OpenList 后台的
 * 连接配置、挂载存储、驱动清单、站点设置，以及文件浏览 / 重命名 / 复制 /
 * 移动 / 批量删除 / 上传 / 下载 / 直链全部接到平台 API 上，
 * 同时保留「打开 / 内嵌 OpenList 后台」入口处理更复杂的操作。
 *
 * 凭据：界面填写的连接信息只写 state.json（600）；列表输出一律脱敏。
 * 代理：OpenList 不属于 git/docker/server/ai 四个作用域，走全局代理 + NO_PROXY。
 */
const path = require('path');
const { config, state, update, uid, currentUser, HttpError } = require('./core');
const { openlistApi } = require('./integrations');
const proxyModule = require('./proxy');

// 保留启动时的 .env 值，界面「恢复环境配置」时可还原。
const ENV = {
  url: config.openlistUrl,
  token: config.openlistToken,
  user: config.openlistUser,
  password: config.openlistPassword,
};

const unwrap = (raw) => (raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw);
const asList = (raw) => {
  const d = unwrap(raw);
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.content)) return d.content;
  if (d && Array.isArray(d.items)) return d.items;
  return [];
};

const joinPath = (parent, name) => {
  const base = String(parent || '/').replace(/\/+$/, '');
  const clean = String(name || '').trim().replace(/^\/+/, '');
  if (!clean || clean === '.' || clean === '..' || /[\0\r\n]/.test(clean)) throw new Error('文件名不合法');
  return `${base}/${clean}`.replace(/\/{2,}/g, '/') || '/';
};

const safeName = (name) => {
  const clean = String(name || '').trim();
  if (!clean || clean === '.' || clean === '..' || /[/\\\0\r\n]/.test(clean)) throw new Error('名称不合法');
  return clean;
};

const safeDir = (p) => {
  const value = String(p || '/').trim();
  if (!value.startsWith('/')) throw new Error('OpenList 路径必须以 / 开头');
  if (value.includes('..')) throw new Error('路径中不允许 ..');
  if (/[\0\r\n]/.test(value)) throw new Error('路径含非法字符');
  return `/${value.split('/').filter(Boolean).join('/')}` || '/';
};

/* ------------------------------ 连接配置 ------------------------------ */
/**
 * v0.3.2：支持同时登记多个 OpenList（本机 + 任意外部服务）。
 * 只有 activeId 指向的连接会被写进运行时 config，所有既有 API 保持不变；
 * 切换连接时清掉 openlistApi 的 token 缓存，避免拿旧服务的令牌请求新服务。
 * 兼容：旧版 state.openlist 单连接会自动迁移成一条「面板配置连接」。
 */
const ENV_CONN_ID = 'env-default';
const MASK = '******';
const keep = (value, saved) => (String(value || '').includes(MASK) ? (saved || '') : String(value || ''));

function envConnection() {
  return {
    id: ENV_CONN_ID, label: '本机 OpenList（.env）',
    url: ENV.url, user: ENV.user || 'admin',
    token: ENV.token || '', password: ENV.password || '',
    source: 'env', createdAt: null,
  };
}

function normalizeConnections() {
  const s = state();
  if (Array.isArray(s.openlistConnections) && s.openlistConnections.length) return s.openlistConnections;
  const list = [envConnection()];
  if (s.openlist) {
    list.push({
      id: uid('olconn'), label: '面板配置连接',
      url: s.openlist.url || ENV.url, user: s.openlist.user || ENV.user || 'admin',
      token: s.openlist.token || '', password: s.openlist.password || '',
      source: 'panel', createdAt: new Date().toISOString(),
    });
  }
  update((st) => {
    st.openlistConnections = list;
    st.openlistActiveId = s.openlist ? list[1].id : list[0].id;
  });
  return state().openlistConnections;
}

function activeConnection() {
  const list = normalizeConnections();
  const activeId = state().openlistActiveId;
  return list.find((c) => c.id === activeId) || list[0];
}

function publicConnection(c) {
  const activeId = state().openlistActiveId;
  const url = String(c.url || '').replace(/\/+$/, '');
  return {
    id: c.id, label: c.label || url, url, user: c.user || 'admin',
    source: c.source || 'panel', createdAt: c.createdAt || null,
    hasToken: Boolean(c.token), hasPassword: Boolean(c.password),
    tokenMasked: c.token ? `${String(c.token).slice(0, 3)}******${String(c.token).slice(-3)}` : '',
    passwordMasked: c.password ? `******${String(c.password).slice(-2)}` : '',
    active: c.id === activeId,
    manageUrl: `${url}/@manage`, storagesUrl: `${url}/@manage/storages`,
    webdav: `${url}/dav/`,
    effectiveProxy: proxyModule.forGlobal(url).masked,
  };
}

/** 程序启动时调用：把当前 active 连接覆盖到运行时 config。 */
function applyConfig() {
  const active = activeConnection();
  if (!active) return;
  // 「面板连接优先」只覆盖真的填了值的字段：历史上无条件覆盖，导致保存过
  // 不带密码的连接后，.env 里的有效凭据在重启时被静默清空（OpenList 变未配置）。
  if (active.url) config.openlistUrl = String(active.url || ENV.url).replace(/\/+$/, '');
  if (active.user) config.openlistUser = String(active.user);
  if (active.token) config.openlistToken = String(active.token);
  if (active.password) config.openlistPassword = String(active.password);
}

/** 旧接口：返回当前连接（含多连接清单），前端与文档可继续沿用。 */
function connection() {
  const active = activeConnection();
  const pub = publicConnection(active);
  return {
    ...pub,
    // 兼容旧字段名
    source: pub.source === 'env' ? '.env / 环境变量' : '面板配置',
    effectiveProxy: pub.effectiveProxy,
    activeId: state().openlistActiveId,
    connections: normalizeConnections().map(publicConnection),
  };
}

function validatedUrl(url) {
  const value = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) throw new Error('OpenList 地址必须是 http(s):// 开头');
  new URL(value);
  return value;
}

function connectionPatch(body = {}, current = {}) {
  const patch = {};
  if (body.label !== undefined) patch.label = String(body.label).trim().slice(0, 60) || '未命名连接';
  if (body.url !== undefined) patch.url = validatedUrl(body.url);
  if (body.user !== undefined) patch.user = String(body.user).trim().slice(0, 80) || 'admin';
  // 表单里带 ****** 说明是脱敏回显，沿用已保存的真实值。
  if (body.token !== undefined) patch.token = keep(body.token, current.token).slice(0, 512);
  if (body.password !== undefined) patch.password = keep(body.password, current.password).slice(0, 256);
  return patch;
}

/** 旧接口：更新当前 active 连接（也可通过 body.id 指定某条）。 */
function setConnection(body = {}) {
  const list = normalizeConnections();
  const id = String(body.id || state().openlistActiveId || '');
  const target = list.find((c) => c.id === id) || activeConnection();
  const patch = connectionPatch(body, target);
  update((s) => {
    const item = (s.openlistConnections || []).find((c) => c.id === target.id);
    if (item) Object.assign(item, patch, { source: 'panel' });
    s.openlist = { ...(s.openlist || {}), ...patch };
  });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

/** 恢复 .env 默认连接并切换到它（旧接口 /connection/reset 的语义）。 */
function clearConnection() {
  normalizeConnections();
  update((s) => {
    const env = (s.openlistConnections || []).find((c) => c.id === ENV_CONN_ID);
    if (env) Object.assign(env, envConnection());
    else s.openlistConnections.unshift(envConnection());
    s.openlistActiveId = ENV_CONN_ID;
    s.openlist = null;
  });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

function listConnections() {
  const list = normalizeConnections();
  return { items: list.map(publicConnection), activeId: state().openlistActiveId };
}

function addConnection(body = {}) {
  const patch = connectionPatch({ ...body, url: body.url, label: body.label }, {});
  if (!patch.url) throw new Error('请填写 OpenList 服务地址');
  if (!patch.label || patch.label === '未命名连接') patch.label = patch.url.replace(/^https?:\/\//, '').slice(0, 60);
  const item = {
    id: uid('olconn'), label: patch.label, url: patch.url,
    user: patch.user || 'admin', token: patch.token || '', password: patch.password || '',
    source: 'panel', createdAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.openlistConnections)) s.openlistConnections = [];
    s.openlistConnections.push(item);
    // 产品语义就是「登记即设为当前」（前端提交后的提示也是这么写的），普通用户
    // 添加自己的 OpenList 后要能立刻用它浏览/挂载，不能只登记不生效。
    // 谁能把某条连接设为当前，由 /activate 与 guard() 的对象归属判定兜底：
    // 无关用户既看不到别人的连接，也无法切换；write 协作者可切换被授权的连接。
    s.openlistActiveId = item.id;
  });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

function editConnection(id, body = {}) {
  const list = normalizeConnections();
  const target = list.find((c) => c.id === String(id));
  if (!target) throw new Error(`OpenList 连接不存在：${id}`);
  const patch = connectionPatch(body, target);
  update((s) => {
    const item = (s.openlistConnections || []).find((c) => c.id === target.id);
    if (item) Object.assign(item, patch);
  });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

function removeConnection(id) {
  const list = normalizeConnections();
  if (list.length <= 1) throw new Error('至少需要保留一个 OpenList 连接');
  const target = list.find((c) => c.id === String(id));
  if (!target) throw new Error(`OpenList 连接不存在：${id}`);
  update((s) => {
    s.openlistConnections = (s.openlistConnections || []).filter((c) => c.id !== target.id);
    if (s.openlistActiveId === target.id) s.openlistActiveId = s.openlistConnections[0].id;
  });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

function activateConnection(id) {
  const list = normalizeConnections();
  const target = list.find((c) => c.id === String(id));
  if (!target) throw new Error(`OpenList 连接不存在：${id}`);
  update((s) => { s.openlistActiveId = target.id; });
  applyConfig();
  openlistApi.resetToken();
  return connection();
}

/* -------------------------- 状态 / 后台设置 -------------------------- */

async function status() {
  const conn = connection();
  let settings = {};
  try { settings = unwrap(await openlistApi.health()) || {}; } catch (e) {
    return { online: false, ...conn, error: String(e.message || e), hint: hintFor(e) };
  }
  // 公开接口可达 ≠ 管理权限可用：必须真正调一次管理接口才能确认 token 有效。
  let storages = [];
  let admin = false;
  let adminError = '';
  try { storages = await listStorages(); admin = true; }
  catch (e) { adminError = String(e.message || e); }
  return {
    online: true,
    ...conn,
    connectionId: conn.id,
    connectionLabel: conn.label,
    version: settings.version || '',
    siteTitle: settings.site_title || settings.title || '',
    storageCount: storages.length,
    admin,
    adminError,
    adminHint: adminError ? hintFor(adminError) : '',
    write: admin && settings.write !== false,
  };
}

function hintFor(error) {
  const msg = String((error && error.message) || error);
  if (/未配置/.test(msg)) return '在「连接管理」里填写 Token 或管理员密码；也可改 dist/.env 后完全重启';
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return '服务未启动或地址是容器内服务名；外部 OpenList 请填平台能访问到的 http(s) 地址';
  if (/登录失败|401|403/i.test(msg)) return 'Token 或管理员密码不正确；存储管理需要管理员权限的 Token';
  if (/record not found|code=500|token 失效/i.test(msg)) return '当前连接的 Token 已失效或无管理员权限：在「连接管理」里清空 Token 改用管理员密码登录，或到该 OpenList 后台重新生成管理员 Token';
  return msg.slice(0, 180);
}

async function settings() {
  const raw = await openlistApi.adminSettings();
  const list = asList(raw);
  const allow = /^(site_title|site_name|announcement|pagination_type|default_page_size|allow_indexed|allow_mount|robots_txt|favicon|logo|webdav|s3|home_container|hide_files|customize_head|customize_body)$/i;
  return {
    items: list.filter((s) => allow.test(String(s.key || ''))).map((s) => ({
      key: s.key, value: String(s.value === undefined ? '' : s.value).slice(0, 500),
      type: s.type || '', group: s.group || 0, help: String(s.help || '').slice(0, 200),
    })),
    // 原始清单里含敏感项（令牌 / WebDAV 密码），不向前端透出。
    note: '仅展示站点展示类设置；敏感项请到 OpenList 后台修改',
  };
}

/* ---------------------------- 挂载存储管理 ---------------------------- */

/* ---------------- 挂载归属：账号隔离（OpenList 服务仍是全站单例） ---------------- */
/**
 * 上游 OpenList 只有一份挂载表。平台侧另记「哪个挂载由哪个账号添加」，
 * 列表 / 写操作 / 文件访问都按这份归属过滤：
 *  - 管理员（含 token / CLI 通道）看全部、可管理全部；
 *  - 普通用户只能看到并操作自己创建的挂载；
 *  - 升级前已存在、没有归属记录的挂载视为历史数据，仅管理员可见可管。
 */
const isPrivileged = (user) => Boolean(user && (
  user.role === 'admin' || ['cli', 'off', 'token'].includes(user.via)
));

function mountOwners() {
  const raw = state().openlistMountOwners;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function ownerNameOf(ownerId) {
  if (!ownerId) return '';
  const u = (state().users || []).find((x) => x && x.id === ownerId);
  return u ? (u.displayName || u.username || '') : '';
}

/** 该用户可见挂载的根目录段（mountPath 的第一段），用于过滤根目录文件列表。 */
function mountSegmentsFor(user) {
  const out = new Set();
  const uidValue = user && user.id;
  for (const [key, rec] of Object.entries(mountOwners())) {
    if (!rec || !rec.ownerId || !uidValue || rec.ownerId !== uidValue) continue;
    // user: 前缀是 C 批用户家目录，统一用 users 段放行、进入后由 filterRootContent 按家目录裁剪。
    if (String(key).startsWith('user:')) { out.add('users'); continue; }
    const seg = String(rec.mountPath || '').replace(/^\/+/, '').split('/')[0];
    if (seg) out.add(seg);
  }
  return out;
}

function recordMountOwner(id, mountPath, user = currentUser()) {
  const ownerId = user && user.id && !String(user.id).startsWith('__') ? user.id : '';
  update((s) => {
    if (!s.openlistMountOwners || typeof s.openlistMountOwners !== 'object') s.openlistMountOwners = {};
    s.openlistMountOwners[String(id)] = {
      ownerId, mountPath: String(mountPath || ''), createdAt: new Date().toISOString(),
    };
  });
}

function assertMountOwner(id, user = currentUser()) {
  if (isPrivileged(user)) return;
  const rec = mountOwners()[String(id)];
  const uidValue = user && user.id;
  if (!rec || !rec.ownerId || !uidValue || rec.ownerId !== uidValue) {
    throw new HttpError(403, '无权管理该挂载：仅创建者或管理员可操作');
  }
}

/** 挂载列表按归属裁剪，并补 ownerId / ownerName 供管理员区分是谁添加的。 */
function visibleStorages(items, user = currentUser()) {
  const owners = mountOwners();
  const uidValue = user && user.id;
  const privileged = isPrivileged(user);
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (privileged) return true;
    const rec = owners[String(item && item.id)];
    return Boolean(rec && rec.ownerId && uidValue && rec.ownerId === uidValue);
  }).map((item) => {
    const ownerId = (owners[String(item && item.id)] || {}).ownerId || '';
    return { ...item, ownerId, ownerName: ownerNameOf(ownerId) };
  });
}

/** 根目录只列出自己挂载对应的目录，避免「挂载列表看不到、文件页却能看到」。 */
function filterRootContent(content, dir, user = currentUser()) {
  const list = Array.isArray(content) ? content : [];
  if (isPrivileged(user)) return list;
  // C 批：进入 /users 后，只列出该用户自己的家目录（或协作者被授权的目录）。
  if (dir === '/users') {
    // 延迟 require，避免 userDirs -> openlist 的循环依赖。
    const userDirs = require('./userDirs');
    const prefixes = userDirs.allowedPrefixes(user).map((p) => String(p).replace(/^\/users\//, '').split('/')[0]).filter(Boolean);
    return list.filter((f) => prefixes.includes(String((f && f.name) || '').replace(/^\/+/, '')));
  }
  if (dir !== '/') return list;
  const allowed = mountSegmentsFor(user);
  return list.filter(
    (f) => allowed.has(String((f && f.name) || '').replace(/^\/+/, '')),
  );
}

function normalizeStorage(s) {
  return {
    id: s.id,
    mountPath: s.mount_path || s.mountPath || '/',
    driver: s.driver || s.driver_name || '',
    status: s.status || '',
    disabled: Boolean(s.disabled),
    order: Number(s.order || 0),
    cacheExpiration: Number(s.cache_expiration || 0),
    remark: String(s.remark || '').slice(0, 200),
    addition: s.addition || '{}',
    modified: s.modified || '',
  };
}

async function listStorages(user = currentUser()) {
  return visibleStorages(asList(await openlistApi.mounts()).map(normalizeStorage), user);
}

async function listDrivers() {
  const raw = await openlistApi.drivers();
  const d = unwrap(raw);
  // OpenList 的 /api/admin/driver/list 返回的是「以驱动名为 key 的字典」（本机 93 项）：
  // { "Local": { common: [...], additional: [...], config: {...} }, ... }
  // 旧实现只走 asList()（仅认数组 / content / items），items 恒为空 → 前端
  // 「新增 / 编辑挂载」的驱动下拉没有选项，任何账号都选不了驱动、也就加不了挂载。
  const dict = (d && !Array.isArray(d) && typeof d === 'object') ? Object.entries(d) : [];
  const items = (dict.length
    ? dict.map(([name, spec]) => ({
      driver: name,
      name,
      description: String((spec && spec.config && spec.config.alert) || '').slice(0, 240),
    }))
    : asList(raw).map((x) => ({
      driver: String(x.driver || x.name || ''),
      name: String(x.name || x.driver || ''),
      description: String(x.description || x.help || '').slice(0, 240),
      config: x.config || x.addition || null,
    }))).filter((x) => x.driver);
  // v0.4.4：区分「上游真的没给数据」与「凭据 / 权限不足」。后者根本不会走到这里
  // （openlist() 把 code!=200 / 401 / 403 抛成上游错误，由 tolerant 降级并带 hint），
  // 所以这里把原始响应形态回传，前端不再笼统提示「需要管理员权限 Token」。
  let diagnostic = '';
  if (!items.length) {
    const d = unwrap(raw);
    if (Array.isArray(d)) diagnostic = 'OpenList 连接与鉴权均正常，但上游返回了空的驱动数组';
    else if (d && typeof d === 'object') {
      diagnostic = `OpenList 响应结构未识别（字段：${Object.keys(d).slice(0, 8).join('、') || '空对象'}），已按空列表处理`;
    } else diagnostic = `OpenList 响应类型异常（${typeof d}）`;
  }
  return { items, diagnostic };
}

async function driverInfo(driver) {
  const raw = await openlistApi.driverInfo(safeName(driver));
  return unwrap(raw) || {};
}

function storageBody(body = {}) {
  const mountPath = safeDir(body.mountPath || body.mount_path || '/');
  const driver = safeName(body.driver);
  let addition = body.addition === undefined ? '{}' : body.addition;
  if (typeof addition !== 'string') addition = JSON.stringify(addition || {});
  try { JSON.parse(addition); } catch { throw new Error('驱动配置（addition）必须是合法 JSON'); }
  return {
    mount_path: mountPath,
    driver,
    addition,
    disabled: body.disabled === true || body.disabled === 'true',
    order: Number(body.order || 0),
    cache_expiration: Number(body.cacheExpiration || body.cache_expiration || 30),
    remark: String(body.remark || '').slice(0, 200),
  };
}

/** 按 id 回查上游当前挂载（用于编辑保留状态、启停幂等判定）。 */
async function currentStorageState(id) {
  const list = asList(await openlistApi.mounts()).map(normalizeStorage);
  return list.find((x) => String(x.id) === String(id)) || null;
}

async function createStorage(body = {}, user = currentUser()) {
  const mountPath = safeDir(body.mountPath || body.mount_path || '/');
  await openlistApi.saveStorage(storageBody(body), false);
  // 上游 create 不返回挂载 id：按路径回查一次，把归属落到平台侧 state.json。
  // 回查失败不阻断创建（该挂载会成为「无归属的历史挂载」，仅管理员可见可管）。
  try {
    const created = asList(await openlistApi.mounts()).map(normalizeStorage)
      .find((x) => x.mountPath === mountPath);
    if (created && created.id !== undefined && created.id !== null) recordMountOwner(created.id, mountPath, user);
  } catch { /* 归属记录失败不回滚上游（避免产生幽灵挂载） */ }
  return { created: true, mountPath: body.mountPath || body.mount_path };
}

async function updateStorage(body = {}, user = currentUser()) {
  if (!body.id && body.id !== 0) throw new Error('缺少存储 id');
  assertMountOwner(body.id, user);
  const payload = { ...storageBody(body), id: Number(body.id) };
  // 「新增 / 编辑挂载」表单没有停用字段：body 未带 disabled 时沿用上游现状，
  // 否则只是改个备注 / 驱动配置，也会把已停用的挂载悄悄启用。
  if (body.disabled === undefined) {
    const current = await currentStorageState(body.id);
    if (current) payload.disabled = Boolean(current.disabled);
  }
  await openlistApi.saveStorage(payload, true);
  // 挂载路径可能被改名，归属表里的路径要跟着更新，否则根目录过滤会按旧段计算。
  update((s) => {
    const rec = s.openlistMountOwners && s.openlistMountOwners[String(body.id)];
    if (rec) rec.mountPath = payload.mount_path;
  });
  return { updated: true, id: payload.id };
}

async function deleteStorage(id, user = currentUser()) {
  assertMountOwner(id, user);
  await openlistApi.storageAction('delete', Number(id));
  update((s) => { if (s.openlistMountOwners) delete s.openlistMountOwners[String(id)]; });
  return { removed: Number(id) };
}

async function setStorageEnabled(id, enabled, user = currentUser()) {
  assertMountOwner(id, user);
  const target = Boolean(enabled);
  // OpenList 对重复 enable / disable 会返回 code=500「this storage have enabled」。
  // 先比对当前状态做成幂等操作，别把用户一次正常的重复点击报成 502 上游故障。
  const current = await currentStorageState(id);
  if (current && Boolean(current.disabled) === !target) {
    return { id: Number(id), disabled: !target, unchanged: true };
  }
  try {
    await openlistApi.storageAction(target ? 'enable' : 'disable', Number(id));
  } catch (err) {
    // 查询与写入之间状态被别处改动时，上游仍可能回「已经是该状态」，同样按幂等成功处理。
    if (/have (enabled|disabled)|already (enabled|disabled)/i.test(String((err && err.message) || err))) {
      return { id: Number(id), disabled: !target, unchanged: true };
    }
    throw err;
  }
  return { id: Number(id), disabled: !target };
}

async function reloadStorages() {
  await openlistApi.request('/api/admin/storage/load_all', { method: 'POST', body: {} });
  return { reloaded: true };
}

/* ------------------------------ 文件管理 ------------------------------ */

function normalizeFile(f) {
  return {
    name: String(f.name || ''),
    size: Number(f.size || 0),
    isDir: Boolean(f.is_dir),
    modified: f.modified || f.updated_at || '',
    created: f.created || '',
    sign: String(f.sign || ''),
    thumb: String(f.thumb || ''),
    type: String(f.type || ''),
    hash: String(f.hash || ''),
  };
}

async function listFiles(p = '/', options = {}) {
  const dir = safeDir(p);
  const raw = await openlistApi.list(dir, options);
  const d = unwrap(raw) || {};
  const rawContent = Array.isArray(d.content) ? d.content : (Array.isArray(d) ? d : []);
  const content = filterRootContent(rawContent.map(normalizeFile), dir, currentUser());
  return {
    path: dir,
    parent: dir === '/' ? '/' : `/${dir.split('/').filter(Boolean).slice(0, -1).join('/')}`,
    content,
    total: Number(d.total || content.length),
    provider: d.provider || 'OpenList',
    write: d.write !== false,
    readme: String(d.readme || '').slice(0, 2000),
  };
}

async function mkdir(p, name) { return openlistApi.mkdir(joinPath(safeDir(p), safeName(name))); }
async function rename(p, name) { return openlistApi.rename(safeDir(p), safeName(name)); }
async function remove(p, names) {
  const list = (Array.isArray(names) ? names : [names]).map(safeName);
  if (!list.length) throw new Error('请选择要删除的文件');
  return openlistApi.remove(safeDir(p), list);
}
async function move(srcDir, dstDir, names) {
  const list = (Array.isArray(names) ? names : [names]).map(safeName);
  return openlistApi.move(safeDir(srcDir), safeDir(dstDir), list);
}
async function copy(srcDir, dstDir, names) {
  const list = (Array.isArray(names) ? names : [names]).map(safeName);
  return openlistApi.copy(safeDir(srcDir), safeDir(dstDir), list);
}
async function upload(p, name, buffer) {
  if (!buffer || !buffer.length) throw new Error('上传内容为空');
  return openlistApi.upload(joinPath(safeDir(p), safeName(name)), buffer);
}

async function link(p) {
  const raw = await openlistApi.get(safeDir(p));
  const d = unwrap(raw) || {};
  let url = String(d.raw_url || '');
  if (url && d.sign && !/[?&]sign=/.test(url)) {
    url += `${url.includes('?') ? '&' : '?'}sign=${encodeURIComponent(d.sign)}`;
  }
  return {
    path: safeDir(p), name: String(d.name || path.posix.basename(safeDir(p)) || ''),
    size: Number(d.size || 0), rawUrl: url, sign: String(d.sign || ''),
    proxy: proxyModule.forGlobal(url).masked,
  };
}

/** 后端代理下载：浏览器不必能直连 OpenList / 对象存储，也不会暴露 Token。 */
async function download(p, maxBytes = 100 * 1024 * 1024) {
  const info = await link(p);
  if (!info.rawUrl) throw new Error('OpenList 未返回下载地址（可能是虚拟目录）');
  const chosen = proxyModule.forGlobal(info.rawUrl);
  const init = {
    headers: { Authorization: await openlistApi.token() },
    signal: AbortSignal.timeout(120000),
  };
  if (chosen.proxy) init.dispatcher = proxyModule.dispatcher(chosen.proxy);
  const response = await fetch(info.rawUrl, init);
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制，请使用直链下载`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('文件过大，已中止下载');
  return {
    buffer,
    filename: info.name || path.posix.basename(info.path) || 'download.bin',
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

module.exports = {
  ENV, applyConfig, connection, setConnection, clearConnection,
  listConnections, addConnection, editConnection, removeConnection, activateConnection,
  activeConnection, publicConnection,
  status, settings,
  listStorages, listDrivers, driverInfo, createStorage, updateStorage,
  deleteStorage, setStorageEnabled, reloadStorages,
  visibleStorages, filterRootContent, assertMountOwner, mountSegmentsFor,
  listFiles, mkdir, rename, remove, move, copy, upload, link, download,
  joinPath, safeDir, safeName, hintFor,
  // v0.4.7：内嵌后台同源代理需要把当前连接的 token 注入到 OpenList SPA 的 localStorage。
  getToken: () => openlistApi.token(),
};
