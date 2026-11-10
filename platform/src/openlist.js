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
const { config, state, update, uid } = require('./core');
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
  config.openlistUrl = String(active.url || ENV.url).replace(/\/+$/, '');
  config.openlistUser = String(active.user || 'admin');
  config.openlistToken = String(active.token || '');
  config.openlistPassword = String(active.password || '');
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

async function listStorages() {
  return asList(await openlistApi.mounts()).map(normalizeStorage);
}

async function listDrivers() {
  const items = asList(await openlistApi.drivers());
  return items.map((d) => ({
    driver: String(d.driver || d.name || ''),
    name: String(d.name || d.driver || ''),
    description: String(d.description || d.help || '').slice(0, 240),
    config: d.config || d.addition || null,
  }));
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

async function createStorage(body = {}) {
  await openlistApi.saveStorage(storageBody(body), false);
  return { created: true, mountPath: body.mountPath || body.mount_path };
}

async function updateStorage(body = {}) {
  if (!body.id && body.id !== 0) throw new Error('缺少存储 id');
  const payload = { ...storageBody(body), id: Number(body.id) };
  await openlistApi.saveStorage(payload, true);
  return { updated: true, id: payload.id };
}

async function deleteStorage(id) {
  await openlistApi.storageAction('delete', Number(id));
  return { removed: Number(id) };
}

async function setStorageEnabled(id, enabled) {
  await openlistApi.storageAction(enabled ? 'enable' : 'disable', Number(id));
  return { id: Number(id), disabled: !enabled };
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
  const content = Array.isArray(d.content) ? d.content : (Array.isArray(d) ? d : []);
  return {
    path: dir,
    parent: dir === '/' ? '/' : `/${dir.split('/').filter(Boolean).slice(0, -1).join('/')}`,
    content: content.map(normalizeFile),
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
  listFiles, mkdir, rename, remove, move, copy, upload, link, download,
  joinPath, safeDir, safeName, hintFor,
};
