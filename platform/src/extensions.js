'use strict';

/**
 * 扩展实例管理：清单加载、凭据生成、连接串渲染、实例 CRUD、注入项目 .env。
 * 容器生命周期与探测交给 extRuntime.js；本模块不直接碰 Docker API。
 *
 * 凭据边界：密码只存 state.json（core.save 已强制 600 权限），
 * 列表/详情接口一律脱敏，明文连接串只能通过单独接口按实例获取。
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const {
  config, state, update, uid, safeWorkspacePath, relativeWorkspacePath,
} = require('./core');
const catalog = require('./catalog');
const runtime = require('./extRuntime');

const customDir = () => path.join(config.dataDir, 'extensions');

function readCustom() {
  const dir = customDir();
  const items = [];
  const errors = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')); }
  catch { return { items, errors }; }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const m = catalog.validateManifest(raw);
      if (items.some((x) => x.id === m.id)) throw new Error(`id 与已有清单重复：${m.id}`);
      items.push(m);
    } catch (e) { errors.push(`${file}: ${e.message}`); }
  }
  return { items, errors };
}

function allManifests() {
  const builtin = catalog.builtinCatalog().map((m) => ({ ...m, builtin: true }));
  const custom = readCustom();
  const seen = new Set(builtin.map((m) => m.id));
  const extra = custom.items.filter((m) => !seen.has(m.id)).map((m) => ({ ...m, builtin: false }));
  return { items: [...builtin, ...extra], errors: custom.errors };
}

async function listCatalog() {
  const { items, errors } = allManifests();
  const docker = await runtime.dockerStatus();
  return {
    items: items.map((m) => ({
      id: m.id, label: m.label, kind: m.kind, icon: m.icon,
      description: m.description, image: m.image, tags: m.tags,
      defaultTag: m.defaultTag, port: m.port, envKey: m.envKey,
      builtin: m.builtin,
      forms: { docker: catalog.formFields(m, 'docker'), external: catalog.formFields(m, 'external') },
    })),
    errors, customDir: customDir(), docker,
    defaultMode: docker.available ? 'docker' : 'external',
    extHost: config.extHost,
  };
}

function getManifest(id) {
  const m = allManifests().items.find((x) => x.id === id);
  if (!m) throw new Error(`未知扩展清单：${id}`);
  return m;
}

const instances = () => state().extensions || [];
const findInstance = (id) => instances().find((x) => x.id === id);

function setInstance(id, patch) {
  return update((s) => {
    if (!Array.isArray(s.extensions)) s.extensions = [];
    const inst = s.extensions.find((x) => x.id === id);
    if (!inst) throw new Error(`扩展实例不存在：${id}`);
    Object.assign(inst, patch, { updatedAt: new Date().toISOString() });
    return inst;
  });
}

function randomPassword() {
  return crypto.randomBytes(18).toString('base64url'); // 24 位，纯 URL 安全字符
}

function tcpProbe(host, port, timeout = 900) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (used) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

async function assertPortFree(port) {
  if (instances().some((x) => x.mode === 'docker' && Number(x.port) === port)) {
    throw new Error(`端口 ${port} 已被平台内另一个扩展实例占用`);
  }
  const probeHost = config.extBindIp === '0.0.0.0' ? '127.0.0.1' : config.extBindIp;
  if (await tcpProbe(probeHost, port)) {
    throw new Error(`端口 ${port} 已被本机其它程序占用，请换一个端口`);
  }
}

/** 只接受清单声明过或通用字段里的键，杜绝前端夹带任意字段。 */
function pickValues(manifest, mode, input) {
  const allowed = new Set(catalog.formFields(manifest, mode).map((f) => f.key));
  const values = {};
  const raw = input && typeof input === 'object' ? input : {};
  for (const key of allowed) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    values[key] = String(value).trim().slice(0, 128);
  }
  return values;
}

function templateVars(inst) {
  const enc = (v) => encodeURIComponent(String(v === undefined || v === null ? '' : v));
  return {
    HOST: inst.host,
    PORT: inst.port,
    INTERNAL_PORT: inst.internalPort,
    PASSWORD: enc(inst.secrets.PASSWORD),
    USER: enc(inst.user),
    DB_NAME: enc(inst.dbName),
    TAG: inst.tag,
    IMAGE: inst.image,
    NAME: inst.name,
  };
}

function renderEnv(manifest, inst) {
  const vars = templateVars(inst);
  const plain = { ...vars, PASSWORD: String(inst.secrets.PASSWORD || '') };
  const env = {};
  for (const [key, value] of Object.entries(manifest.env || {})) {
    env[key] = catalog.renderTemplate(value, plain);
  }
  const command = (manifest.command || []).map((part) => catalog.renderTemplate(part, plain));
  return { env, command, vars };
}

function connectionOf(inst) {
  const manifest = getManifest(inst.catalogId);
  const url = catalog.renderTemplate(manifest.connection, templateVars(inst));
  return { url, envKey: manifest.envKey, line: `${manifest.envKey}=${url}` };
}

function maskUrl(url) {
  return String(url).replace(/\/\/([^:/@]*):([^@]*)@/, (_, user) => `//${user}:******@`);
}

function publicInstance(inst) {
  const manifest = (() => { try { return getManifest(inst.catalogId); } catch { return null; } })();
  let masked = '';
  try { masked = maskUrl(connectionOf(inst).url); } catch { /* noop */ }
  return {
    id: inst.id, catalogId: inst.catalogId,
    label: (manifest && manifest.label) || inst.catalogId,
    name: inst.name, mode: inst.mode, image: inst.image, tag: inst.tag,
    port: inst.port, host: inst.host, user: inst.user || '', dbName: inst.dbName || '',
    envKey: (manifest && manifest.envKey) || 'DATABASE_URL',
    status: inst.status, statusDetail: inst.statusDetail || '',
    containerName: inst.containerName || '', volumeName: inst.volumeName || '',
    connectionMasked: masked, hasPassword: Boolean(inst.secrets && inst.secrets.PASSWORD),
    canManage: inst.mode === 'docker', createdAt: inst.createdAt,
  };
}

function listInstances() {
  return { items: instances().map(publicInstance) };
}

async function createInstance(body = {}) {
  const manifest = getManifest(String(body.catalogId || ''));
  const mode = body.mode === 'external' ? 'external' : 'docker';
  const docker = await runtime.dockerStatus();
  if (mode === 'docker' && !docker.available) {
    throw new Error('本机未检测到 Docker：请改用「外部连接」模式，或为平台挂载 docker.sock');
  }

  const values = pickValues(manifest, mode, body.values || body);
  const name = String(values.NAME || '').trim();
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) {
    throw new Error('实例名称必须是小写字母开头、2~32 位，仅含字母 / 数字 / 短横线');
  }
  if (instances().some((x) => x.name === name)) throw new Error(`实例名称已存在：${name}`);

  const port = Number(values.PORT || manifest.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1~65535 的整数');
  const tag = String(values.TAG || manifest.defaultTag);
  if (!manifest.tags.includes(tag)) throw new Error(`不支持的镜像 tag：${tag}`);
  const password = values.PASSWORD || (mode === 'docker' ? randomPassword() : '');
  const host = mode === 'external'
    ? String(values.HOST || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
    : config.extHost;
  if (mode === 'external' && !/^[A-Za-z0-9._:-]{1,120}$/.test(host)) {
    throw new Error('数据库地址不合法（只填主机名或 IP，不要带协议与路径）');
  }
  const user = values.USER || manifest.defaults.USER || '';
  const dbName = values.DB_NAME || '';
  if (mode === 'docker') await assertPortFree(port);

  const inst = {
    id: uid('ext'), catalogId: manifest.id, name, mode,
    image: `${config.dockerImagePrefix || ''}${manifest.image}`, tag,
    port, internalPort: manifest.internalPort, host, user, dbName,
    secrets: { PASSWORD: password },
    envKey: manifest.envKey, status: 'installing',
    statusDetail: mode === 'docker' ? '正在创建容器' : '正在校验外部地址',
    containerId: '', containerName: '', volumeName: '',
    createdAt: new Date().toISOString(),
  };
  update((s) => {
    if (!Array.isArray(s.extensions)) s.extensions = [];
    s.extensions.push(inst);
  });

  try {
    if (mode === 'docker') {
      const result = await runtime.install(inst, manifest, renderEnv(manifest, inst));
      setInstance(inst.id, {
        ...result,
        status: result.healthy ? 'online' : 'partial',
        statusDetail: result.healthy ? '容器运行中，健康检查通过' : '容器已启动，健康检查未通过',
      });
    } else {
      const up = await tcpProbe(host, port, 1200);
      setInstance(inst.id, {
        status: up ? 'online' : 'offline',
        statusDetail: up ? '外部地址可连通（仅登记连接信息）' : '外部地址不可达，请检查地址、端口与防火墙',
      });
    }
  } catch (e) {
    // 安装失败不留半成品记录，避免用户反复点安装时撞名 / 撞端口。
    update((s) => { s.extensions = (s.extensions || []).filter((x) => x.id !== inst.id); });
    throw e;
  }
  return publicInstance(findInstance(inst.id));
}

async function actionInstance(id, action) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  if (inst.mode !== 'docker') throw new Error('外部连接模式只登记连接信息，平台不能启停该服务');
  const result = await runtime.action(inst, action);
  setInstance(id, {
    status: result.running ? 'online' : 'offline',
    statusDetail: result.running ? '容器运行中' : '容器已停止',
  });
  return publicInstance(findInstance(id));
}

async function removeInstance(id, purge = false) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  if (inst.mode === 'docker') await runtime.remove(inst, purge);
  update((s) => { s.extensions = (s.extensions || []).filter((x) => x.id !== id); });
  return { removed: id, purged: Boolean(purge && inst.mode === 'docker'), volumeKept: inst.mode === 'docker' && !purge };
}

async function healthOf(id) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  const result = inst.mode === 'docker'
    ? await runtime.health(inst, getManifest(inst.catalogId))
    : await runtime.externalHealth(inst);
  setInstance(id, {
    status: result.healthy ? 'online' : 'offline',
    statusDetail: result.detail,
  });
  return { ...result, instance: publicInstance(findInstance(id)) };
}

async function logsOf(id, tail = 200) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  if (inst.mode !== 'docker') return { text: '外部连接模式没有容器日志', external: true };
  return { text: await runtime.logs(inst, tail), external: false };
}

function connectionOfInstance(id) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  return connectionOf(inst);
}

/** 把 ENV_KEY=连接串 写进工作区内的 .env（保留其它行，同名键覆盖）。 */
function injectEnv(id, targetPath) {
  const inst = findInstance(id);
  if (!inst) throw new Error(`扩展实例不存在：${id}`);
  const rel = String(targetPath || '.env').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.includes('..')) throw new Error('目标必须是工作区内的相对路径');
  const target = safeWorkspacePath(rel);
  const { line, envKey } = connectionOf(inst);
  let text = '';
  try { text = fs.readFileSync(target, 'utf8'); } catch { /* 文件不存在则新建 */ }
  const escaped = envKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${line}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* Windows 忽略 */ }
  return { path: relativeWorkspacePath(target), envKey, written: true };
}

module.exports = {
  listCatalog, listInstances, publicInstance, findInstance,
  createInstance, actionInstance, removeInstance, healthOf, logsOf,
  connectionOfInstance, injectEnv, customDir,
};
