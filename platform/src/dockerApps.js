'use strict';

/**
 * Docker 应用商店（移植自宝塔 aaPanel/appstore 的数据与处理方案）
 *
 * 数据来源：宝塔官方开源的 https://github.com/aaPanel/appstore —— 每个应用是
 *   apps/<appname>/app.json + 图标 + <版本目录>/docker-compose.yml + .env。
 *   官方版本目录名通常等于 appname（如 apps/mysql/mysql/），appversion 描述的是
 *   镜像版本 tag 而非目录名；真实可用版本以「含 docker-compose.yml 的子目录」为准。
 * 本模块把这套目录格式解析成平台 API 可消费的结构。
 *
 * 加速器双模式（v0.4.29）：
 *   - baota（默认，对齐宝塔）：面板配置一个「加速 URL」，写出 /etc/docker/daemon.json
 *     的 registry-mirrors 片段供目标机应用；compose 保持官方镜像名不变。宝塔面板
 *     Docker 设置的「修改加速 URL」正是这个机制。
 *   - compose（可选，旧行为）：在生成的 compose 里把 docker.io 官方镜像替换为镜像源前缀。
 *
 * 与分享原型（独立 Express 服务）的差异：
 *   1) 融入平台 core/config：apps 目录放 platform/appstore/apps，随源码部署；
 *   2) 路径安全：只扫描内置 apps 根目录下的直接子目录，拒绝符号链接与越界；
 *   3) 补齐原型空壳的 doDeploy：把表单参数合并进 .env 变量，生成最终
 *      compose + .env 交付（平台不直接执行 compose，沿用既有产品约束）。
 */

const fs = require('fs');
const path = require('path');
const { state, update, appRoot, badRequest, notFound } = require('./core');

const APPS_DIR = path.join(appRoot, 'appstore', 'apps');
const DEFAULT_MIRROR = 'registry.cn-hangzhou.aliyuncs.com'; // 仅 compose 模式的历史默认值
const DEFAULT_ACCELERATE_URL = 'https://docker.1ms.run';    // 宝塔推荐加速站

/* ------------------------------ 加速器配置 ------------------------------ */

/** 加速器设置（state().appStore 下）。默认宝塔方式。 */
function accelerator() {
  const saved = (state().appStore && state().appStore.accelerator) || {};
  const mode = saved.mode === 'compose' ? 'compose' : 'baota';
  let url = saved.accelerateUrl;
  if (url === undefined || url === null) {
    url = process.env.DP_DOCKER_ACCELERATE_URL !== undefined
      ? String(process.env.DP_DOCKER_ACCELERATE_URL) : DEFAULT_ACCELERATE_URL;
  }
  let mirror = saved.mirror;
  if (mirror === undefined || mirror === null) {
    mirror = process.env.REGISTRY_MIRROR !== undefined
      ? String(process.env.REGISTRY_MIRROR) : DEFAULT_MIRROR;
  }
  return { mode, accelerateUrl: String(url), mirror: String(mirror) };
}

function setAccelerator(body = {}) {
  const cur = accelerator();
  const mode = body.mode === undefined ? cur.mode : String(body.mode);
  if (mode !== 'baota' && mode !== 'compose') throw badRequest('加速器模式只能是 baota 或 compose');
  const accelerateUrl = body.accelerateUrl === undefined ? cur.accelerateUrl : String(body.accelerateUrl).trim().replace(/\/+$/, '');
  if (accelerateUrl && !/^https?:\/\/[a-z0-9][a-z0-9.\-:]*\/?$/i.test(accelerateUrl)) {
    throw badRequest('加速 URL 格式应为 http(s)://域名，例如 https://docker.1ms.run');
  }
  const mirror = body.mirror === undefined ? cur.mirror : String(body.mirror).trim().replace(/\/+$/, '');
  if (mirror && !/^[a-z0-9][a-z0-9.\-:]*$/i.test(mirror)) {
    throw badRequest('镜像源只能是域名或 host:port，例如 registry.cn-hangzhou.aliyuncs.com');
  }
  update((s) => {
    if (!s.appStore || typeof s.appStore !== 'object') s.appStore = {};
    if (!s.appStore.accelerator || typeof s.appStore.accelerator !== 'object') s.appStore.accelerator = {};
    s.appStore.accelerator.mode = mode;
    s.appStore.accelerator.accelerateUrl = accelerateUrl;
    s.appStore.accelerator.mirror = mirror;
    // 兼容旧字段：mirror 顶层同步，避免老前端/API 读不到。
    s.appStore.mirror = mirror;
  });
  return accelerator();
}

/** 生成目标机 /etc/docker/daemon.json 的 registry-mirrors 配置片段（宝塔方式）。 */
function daemonJson(extra = {}) {
  const acc = accelerator();
  const mirrors = [];
  if (acc.accelerateUrl) mirrors.push(acc.accelerateUrl);
  if (Array.isArray(extra.mirrors)) for (const m of extra.mirrors) {
    const s = String(m).trim().replace(/\/+$/, '');
    if (s && /^https?:\/\//i.test(s) && !mirrors.includes(s)) mirrors.push(s);
  }
  const cfg = { 'registry-mirrors': mirrors };
  // 可选 DNS（宝塔教程里加速不生效时建议加 8.8.8.8 / 114.114.114.114）
  if (Array.isArray(extra.dns) && extra.dns.length) cfg.dns = extra.dns.map(String);
  return {
    path: '/etc/docker/daemon.json',
    config: cfg,
    json: JSON.stringify(cfg, null, 2),
    commands: [
      'sudo mkdir -p /etc/docker',
      `echo '${JSON.stringify(cfg, null, 2)}' | sudo tee /etc/docker/daemon.json > /dev/null`,
      'sudo systemctl restart docker',
    ],
    mode: 'baota',
  };
}

/* -------------------- 镜像源替换（仅 compose 模式） -------------------- */

/** 兼容旧调用：mirror() 返回当前 compose 模式的镜像源；宝塔模式返回 ''（不替换）。 */
function mirror() {
  const acc = accelerator();
  return acc.mode === 'compose' ? acc.mirror : '';
}

/** 兼容旧调用：设置镜像源（同时切到 compose 模式）。 */
function setMirror(value) {
  return setAccelerator({ mode: 'compose', mirror: value });
}

const OFFICIAL_PREFIXES = ['docker.io/', 'index.docker.io/', 'registry-1.docker.io/'];

function replaceRegistry(image, reg) {
  if (!reg || image.startsWith(reg + '/')) return image;
  for (const o of OFFICIAL_PREFIXES) {
    if (image.startsWith(o)) return image.replace(o, reg + '/');
  }
  if (!image.includes('/') || image.split('/')[0].indexOf('.') === -1) {
    return `${reg}/${image.includes('/') ? image : 'library/' + image}`;
  }
  return `${reg}/${image}`;
}

function patchComposeImages(content, reg) {
  if (!reg) return content;
  return content.replace(/^(\s*image:\s*)(.+)$/gm, (line, prefix, img) => {
    const trimmed = String(img).trim().replace(/^["']|["']$/g, '');
    return prefix + replaceRegistry(trimmed, reg);
  });
}

/* ------------------------------ 目录解析 ------------------------------ */

/** 保留：把 appversion 展开成可读版本标签（用于展示，不用于定位目录）。 */
function expandVersions(appversion) {
  const versions = [];
  for (const v of (Array.isArray(appversion) ? appversion : [])) {
    const m = String(v.m_version || '');
    const subs = Array.isArray(v.s_version) ? v.s_version : [];
    if (m === 'latest' || !subs.length) versions.push(m || 'latest');
    else for (const s of subs) versions.push(`${m}.${s}`);
  }
  return versions.length ? [...new Set(versions)] : ['latest'];
}

function readFileOrEmpty(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** 安全读取：拒绝符号链接与越界（应用目录来自本地内置数据，仍做基本防护）。 */
function safeDir(parent, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return null;
  const target = path.join(parent, name);
  try {
    const st = fs.lstatSync(target);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
  } catch { return null; }
  return target;
}

/**
 * 找出应用下所有「含 docker-compose.yml 的版本目录」。
 * 官方真实目录名 = appname / lite / latest 等，与 appversion 的 tag 不是一回事。
 */
function discoverVersionDirs(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const sub = safeDir(dir, name);
    if (!sub) continue;
    if (!fs.existsSync(path.join(sub, 'docker-compose.yml'))) continue;
    out.push({ name, dir: sub });
  }
  // 稳定排序：latest / lite 优先，其余按名称
  out.sort((a, b) => {
    const rank = (n) => (n === 'latest' ? 0 : n === 'lite' ? 1 : 2);
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });
  return out;
}

function findIcon(dir, appname) {
  // 官方约定 ico-dkapp_<appname>.png；也兼容 icon.png 与根目录其它图片。
  const candidates = [`ico-dkapp_${appname}.png`, 'icon.png'];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.(png|jpe?g|svg)$/i.test(f) && !candidates.includes(f)) candidates.push(f);
    }
  } catch { /* noop */ }
  for (const c of candidates) {
    try { if (fs.statSync(path.join(dir, c)).isFile()) return c; } catch { /* noop */ }
  }
  return '';
}

function parseAppDir(dir, reg) {
  const metaPath = path.join(dir, 'app.json');
  let meta;
  try {
    if (!fs.statSync(metaPath).isFile()) return null;
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch { return null; }

  const appname = String(meta.appname || path.basename(dir));
  const versionDirs = discoverVersionDirs(dir);
  if (!versionDirs.length) return null; // 无 compose 的目录（如 btpanel）跳过

  // 展示用版本标签：优先 appversion 展开，退化为真实版本目录名
  const tags = expandVersions(meta.appversion);
  const versions = tags.length ? tags : versionDirs.map((v) => v.name);

  const versionData = {};
  // 每个展示 tag 映射到「第一个真实版本目录」（官方一个目录承载多个 tag）
  const primary = versionDirs[0];
  for (const ver of versions) {
    const hit = versionDirs.find((v) => v.name === ver) || primary;
    const raw = readFileOrEmpty(path.join(hit.dir, 'docker-compose.yml'));
    versionData[ver] = {
      compose: patchComposeImages(raw, reg),
      env: readFileOrEmpty(path.join(hit.dir, '.env')),
      dir: hit.name,
    };
  }
  // 也按真实目录名建一份，便于按目录名直接取
  for (const v of versionDirs) {
    if (versionData[v.name]) continue;
    versionData[v.name] = {
      compose: patchComposeImages(readFileOrEmpty(path.join(v.dir, 'docker-compose.yml')), reg),
      env: readFileOrEmpty(path.join(v.dir, '.env')),
      dir: v.name,
    };
  }

  return {
    appid: meta.appid || 0,
    appname,
    apptitle: meta.apptitle || appname,
    apptype: meta.apptype || 'Other',
    appTypeCN: meta.appTypeCN || '其他',
    appdesc: meta.appdesc || '',
    appstatus: meta.appstatus ?? 1,
    home: meta.home || '',
    help: meta.help || '',
    sort: Number(meta.sort) || 0,
    updateat: meta.updateat || 0,
    versions,
    versionDirs: versionDirs.map((v) => v.name),
    depend: meta.depend == null ? [] : (Array.isArray(meta.depend) ? meta.depend : [meta.depend]),
    env: Array.isArray(meta.env) ? meta.env : [],
    field: Array.isArray(meta.field) ? meta.field : [],
    volumes: meta.volumes && typeof meta.volumes === 'object' ? meta.volumes : {},
    icon: findIcon(dir, appname),
    version_data: versionData,
  };
}

let cache = [];
let cacheMirror = null;
let cacheAcc = '';
let cacheAt = 0;
const CACHE_TTL = 30 * 1000;

function loadApps(force = false) {
  const reg = mirror();
  const acc = accelerator();
  const accKey = `${acc.mode}|${acc.accelerateUrl}`;
  const now = Date.now();
  if (!force && cache.length && cacheMirror === reg && cacheAcc === accKey && now - cacheAt < CACHE_TTL) return cache;
  const list = [];
  try {
    for (const name of fs.readdirSync(APPS_DIR).sort()) {
      const dir = safeDir(APPS_DIR, name);
      if (!dir) continue;
      const app = parseAppDir(dir, reg);
      if (app) list.push(app);
    }
  } catch { /* apps 目录不存在时返回空列表，不阻塞平台启动 */ }
  cache = list;
  cacheMirror = reg;
  cacheAcc = accKey;
  cacheAt = now;
  return list;
}

/* ------------------------------ 对外接口 ------------------------------ */

function publicApp(a) {
  const { version_data, ...rest } = a;
  return rest;
}

/** 列表：type 分类、search 关键词、分页。列表不返回 version_data（体积大）。 */
function list({ type = '', search = '', page = 1, pageSize = 20 } = {}) {
  let items = loadApps();
  if (type) items = items.filter((a) => a.apptype === type || a.appTypeCN === type);
  if (search) {
    const kw = String(search).toLowerCase();
    items = items.filter((a) => [a.appname, a.apptitle, a.appdesc].some((v) => String(v).toLowerCase().includes(kw)));
  }
  // 官方 sort 升序优先，其次 appid
  items = items.slice().sort((a, b) => (a.sort - b.sort) || (a.appid - b.appid) || a.appname.localeCompare(b.appname));
  const total = items.length;
  const pg = Math.max(1, parseInt(String(page), 10) || 1);
  const ps = Math.min(200, Math.max(1, parseInt(String(pageSize), 10) || 20));
  return { total, page: pg, pageSize: ps, list: items.slice((pg - 1) * ps, pg * ps).map(publicApp), accelerator: accelerator() };
}

/** 分类汇总，按官方 apptags.json 的 sort 排序。 */
const TAG_SORT = {
  BuildWebsite: 1, Database: 2, Storage: 5, AI: 6, Tools: 7, nas: 8,
  Middleware: 9, DevOps: 10, Media: 11, Email: 12, System: 13, MCP: 14, AppHub: 15,
};
function types() {
  const map = {};
  for (const a of loadApps()) {
    if (!map[a.apptype]) map[a.apptype] = { type: a.apptype, typeCN: a.appTypeCN, count: 0 };
    map[a.apptype].count++;
  }
  return Object.values(map).sort((a, b) => (TAG_SORT[a.type] || 99) - (TAG_SORT[b.type] || 99) || b.count - a.count);
}

function requireApp(name) {
  const app = loadApps().find((a) => a.appname === name);
  if (!app) throw notFound('应用不存在');
  return app;
}

function detail(name) {
  return publicApp(requireApp(name));
}

/** 指定版本的 compose + env。 */
function compose(name, version) {
  const app = requireApp(name);
  const ver = String(version || app.versions[0] || app.versionDirs[0] || 'latest');
  const data = app.version_data[ver] || app.version_data[app.versionDirs[0]] || {};
  return { name, version: ver, dir: data.dir || '', compose: data.compose || '', env: data.env || '' };
}

function reload() {
  const count = loadApps(true).length;
  return { count, accelerator: accelerator() };
}

/**
 * 生成部署文件：把表单参数合并进基础 .env，返回最终 compose + .env。
 * @param {string} name 应用名
 * @param {string} version 版本
 * @param {Record<string,string>} params 表单参数（field[].attr → 值）
 */
function prepare(name, version, params = {}) {
  const app = requireApp(name);
  const base = compose(name, version);
  const values = {};
  // .env 键 → 大写索引（官方 field.attr 多为小写，如 mysql_port ↔ MYSQL_PORT）
  const upperToKey = {};
  for (const line of String(base.env).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      values[m[1]] = m[2];
      upperToKey[m[1].toUpperCase()] = m[1];
    }
  }
  // 官方 field 的 attr 是小写、default 是合理默认值。仅当 .env 现有值为空或
  // 「占位符」（值等于键名，如 MYSQL_ROOT_PASSWORD=MYSQL_ROOT_PASSWORD）时填默认值，
  // 保留 .env 自带的有意义值（如 MYSQL_PORT=10306）。
  for (const f of app.field) {
    const attr = String(f.attr || f.key || '');
    const key = upperToKey[attr.toUpperCase()];
    if (!key) continue;
    const cur = values[key];
    const isPlaceholder = cur === '' || cur === key || cur === attr || cur.toUpperCase() === attr.toUpperCase();
    if (isPlaceholder && f.default !== undefined && f.default !== null && f.default !== '') {
      values[key] = String(f.default);
    }
    // 表单可按原始 attr 或大写键传入
    const inVal = Object.prototype.hasOwnProperty.call(params, attr) ? params[attr]
      : Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined;
    if (inVal !== undefined) values[key] = String(inVal ?? '');
  }
  // 宝塔约定：allow_access 复选框不在 .env 中，面板据此设置 HOST_IP
  // （允许外部访问 → 0.0.0.0，仅本机 → 127.0.0.1）；官方 compose 用
  // ${HOST_IP}:${PORT}:... 做端口绑定。不映射则勾选框改了不生效。
  if (Object.prototype.hasOwnProperty.call(params, 'allow_access') && upperToKey.HOST_IP) {
    const allow = /^(1|true|yes|on)$/i.test(String(params.allow_access ?? ''));
    values[upperToKey.HOST_IP] = allow ? '0.0.0.0' : '127.0.0.1';
  }
  const mergedEnv = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  return {
    name: app.appname,
    title: app.apptitle,
    version: base.version,
    dir: base.dir,
    compose: base.compose,
    env: mergedEnv,
    accelerator: accelerator(),
    daemon: daemonJson(), // 随部署文件一起给出，便于目标机配置镜像加速
  };
}

function status() {
  const acc = accelerator();
  return {
    appsDir: path.relative(appRoot, APPS_DIR).split(path.sep).join('/'),
    appsDirExists: (() => { try { return fs.statSync(APPS_DIR).isDirectory(); } catch { return false; } })(),
    count: loadApps().length,
    accelerator: acc,
    // 兼容旧字段
    mirror: mirror(),
    defaultMirror: DEFAULT_MIRROR,
  };
}

module.exports = {
  APPS_DIR, status, setMirror, mirror, accelerator, setAccelerator, daemonJson,
  list, types, detail, compose, reload, prepare,
  loadApps, replaceRegistry, patchComposeImages,
};
