'use strict';

/**
 * 分层代理配置与解析（v0.3.1）
 *
 * 优先级链（从高到低，命中即停止）：
 *   单项代理（仓库 / 容器 / 服务器 / AI 服务自身字段或代理页覆盖）
 *     > Git Host 匹配规则（仅 git 作用域）
 *     > 分组代理（git / docker / server / ai）
 *     > 全局代理
 *
 * 特殊值：
 *   空字符串   继承下一级
 *   direct     明确直连：终止链，且清除子进程继承到的 *_PROXY 环境变量
 *   http(s):// 使用该代理；socks5:// 仅用于 SSH 隧道 / 本地 CLI 环境变量
 *
 * 凭据（user:pass@）只存 state.json（600 权限），所有对外输出一律脱敏。
 */
const http = require('http');
const https = require('https');
const net = require('net');
const { state, update, uid } = require('./core');

const SCOPES = ['git', 'docker', 'server', 'ai'];
const SCOPE_LABELS = {
  git: 'Git 仓库', docker: 'Docker / 容器', server: '服务器 / SSH', ai: 'AI 服务',
};
const OVERRIDE_KEYS = {
  git: 'repos', docker: 'containers', server: 'servers', ai: 'aiProviders',
};
const DIRECT_WORDS = new Set(['direct', 'none', 'no', 'off', 'disable', '直连', '禁用']);
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';

let ProxyAgent = null;
try { ({ ProxyAgent } = require('undici')); } catch { ProxyAgent = null; }
const requireProxyAgent = () => {
  if (!ProxyAgent) throw new Error('HTTP 代理需要 undici 依赖：请执行 npm install 或使用 docker compose 启动完整环境');
};

/* ------------------------------ 配置存取 ------------------------------ */

const env = (key) => String(process.env[key] || '').trim();

function defaultConfig() {
  const groups = {};
  for (const scope of SCOPES) {
    groups[scope] = {
      url: env(`DP_PROXY_${scope.toUpperCase()}`),
      enabled: true,
    };
  }
  const rules = [];
  // DP_PROXY_GIT_RULES=github.com=http://127.0.0.1:7890;gitlab.internal=direct
  const rawRules = env('DP_PROXY_GIT_RULES');
  if (rawRules) {
    rawRules.split(';').forEach((pair, i) => {
      const at = pair.indexOf('=');
      if (at < 1) return;
      rules.push({
        id: `env_rule_${i}`, pattern: pair.slice(0, at).trim(),
        url: pair.slice(at + 1).trim(), note: '来自环境变量', enabled: true,
      });
    });
  }
  return {
    global: {
      url: env('DP_PROXY_GLOBAL'),
      noProxy: env('DP_PROXY_NO') || DEFAULT_NO_PROXY,
      enabled: env('DP_PROXY_ENABLED') !== '0',
    },
    groups,
    rules,
    overrides: { git: {}, docker: {}, server: {}, ai: {} },
  };
}

function readConfig() {
  const base = defaultConfig();
  const saved = (state() && state().proxy) || {};
  const cfg = {
    global: { ...base.global, ...(saved.global || {}) },
    groups: { ...base.groups },
    rules: Array.isArray(saved.rules) ? saved.rules : base.rules,
    overrides: { ...base.overrides },
  };
  for (const scope of SCOPES) {
    cfg.groups[scope] = { ...base.groups[scope], ...((saved.groups || {})[scope] || {}) };
    cfg.overrides[scope] = { ...((saved.overrides || {})[scope] || {}) };
  }
  return cfg;
}

function writeConfig(mutator) {
  return update((s) => {
    if (!s.proxy || typeof s.proxy !== 'object') s.proxy = { global: {}, groups: {}, rules: [], overrides: {} };
    const cfg = {
      global: { ...readConfig().global },
      groups: { ...readConfig().groups },
      rules: [...readConfig().rules],
      overrides: { ...readConfig().overrides },
    };
    mutator(cfg);
    s.proxy = cfg;
    return cfg;
  });
}

/* ------------------------------ 工具函数 ------------------------------ */

function normalize(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return { mode: 'inherit', url: '' };
  if (DIRECT_WORDS.has(raw.toLowerCase())) return { mode: 'direct', url: '' };
  return { mode: 'custom', url: raw };
}

/** 表单回显的是脱敏值；原样提交时沿用已保存的真实地址，避免把 ****** 写回配置。 */
function unmask(value, current) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (raw.includes('******')) return String(current || '');
  return raw;
}

function validateUrl(raw, { allowDirect = true } = {}) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (allowDirect && DIRECT_WORDS.has(value.toLowerCase())) return 'direct';
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`代理地址不是合法 URL：${maskUrl(value)}`); }
  if (!['http:', 'https:', 'socks5:', 'socks5h:', 'socks4:'].includes(parsed.protocol)) {
    throw new Error(`不支持的代理协议 ${parsed.protocol}（仅 http/https/socks5/socks4）`);
  }
  if (!parsed.hostname) throw new Error('代理地址缺少主机名');
  return value;
}

/** 隐藏代理 URL 里的 user:pass@，对外一律只给脱敏形式。 */
function maskUrl(value) {
  const raw = String(value || '');
  if (DIRECT_WORDS.has(raw.toLowerCase())) return '直接连接';
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      const auth = `${u.username ? '******' : ''}${u.password ? ':******' : ''}@`;
      return raw.replace(`${u.username}:${u.password}@`, auth).replace(`${u.username}@`, auth);
    }
    return raw;
  } catch { return raw.replace(/\/\/[^/@]*@/, '//******@'); }
}

function hostOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw) || /^ssh:\/\//i.test(raw) || /^git:\/\//i.test(raw)) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch { /* 继续按裸 host 处理 */ }
  // git@github.com:org/repo.git
  const scp = raw.match(/^[^@]+@([^:]+):/);
  if (scp) return scp[1].toLowerCase();
  return raw.split('/')[0].split(':')[0].toLowerCase();
}

function globRegex(pattern) {
  // 注意不要转义星号：它是 Host 规则的通配符，要还原成 .*
  const escaped = String(pattern).toLowerCase().trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Git Host 规则匹配：同时支持 host、完整 URL、仓库 id；更长/更精确的规则优先。 */
function matchRule(rules, ctx) {
  const candidates = [ctx.host, ctx.url, ctx.itemId, ctx.repoId]
    .map((x) => String(x || '').toLowerCase()).filter(Boolean);
  const hits = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    let re;
    try { re = globRegex(rule.pattern); } catch { continue; }
    let score = 0;
    for (const candidate of candidates) {
      if (re.test(candidate)) { score = Math.max(score, rule.pattern.length + (candidate === ctx.host ? 50 : 0)); }
      // 未带通配符时也允许「子域/路径前缀」匹配，方便写 github.com 命中 github.com:443
      if (!String(rule.pattern).includes('*') && (candidate === rule.pattern.toLowerCase()
        || candidate.endsWith(`.${rule.pattern.toLowerCase()}`)
        || candidate.startsWith(`${rule.pattern.toLowerCase()}/`))) {
        score = Math.max(score, rule.pattern.length + 20);
      }
    }
    if (score) hits.push({ rule, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.length ? hits[0].rule : null;
}

/** NO_PROXY 判定：支持精确、.后缀、* 通配以及 IPv4 CIDR。 */
function shouldBypass(target, noProxy) {
  const host = hostOf(target);
  if (!host) return false;
  const list = String(noProxy || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const entry of list) {
    if (entry === '*') return true;
    const bare = entry.replace(/^\./, '');
    if (entry.startsWith('.')) {
      if (host === bare || host.endsWith(`.${bare}`)) return true;
    } else if (entry.includes('/')) {
      const [cidr, bitsRaw] = entry.split('/');
      const bits = Number(bitsRaw);
      if (!Number.isFinite(bits) || bits < 0 || bits > 32) continue;
      const toInt = (ip) => {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
      };
      const ip = toInt(host);
      const net = toInt(cidr);
      if (ip === null || net === null) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((ip & mask) === (net & mask)) return true;
    } else if (host === bare || host.endsWith(`.${bare}`) || host.startsWith(`${bare}.`)) {
      return true;
    }
  }
  return false;
}

/* ------------------------------ 核心解析 ------------------------------ */

/**
 * @param {'git'|'docker'|'server'|'ai'} scope
 * @param {object} ctx  { itemId, host, url, entity, inlineProxy, repoId, ... }
 * @returns {{url, source, sourceLabel, direct, noProxy, masked, chain, ruleId}}
 */
function resolve(scope, ctx = {}) {
  const key = SCOPES.includes(scope) ? scope : 'git';
  const cfg = readConfig();
  const itemId = String(ctx.itemId || ctx.repoId || ctx.containerId || ctx.serverId || ctx.providerId || '');
  const host = String(ctx.host || hostOf(ctx.url) || '');
  const override = (cfg.overrides[key] || {})[itemId];
  const group = cfg.groups[key] || {};
  const rule = key === 'git' ? matchRule(cfg.rules, { ...ctx, host, itemId }) : null;
  const noProxy = String(ctx.noProxy || cfg.global.noProxy || DEFAULT_NO_PROXY);

  const entityProxy = ctx.entity
    ? (ctx.entity.proxy ?? ctx.entity.proxyUrl ?? ctx.entity.repoProxy ?? '')
    : '';

  const chain = [
    { key: 'item', label: '单项代理', value: normalize(entityProxy) },
    { key: 'override', label: '代理页单项覆盖', value: normalize(override && override.url) },
    ...(key === 'git' ? [{ key: 'rule', label: `Git Host 规则「${rule ? rule.pattern : '-'}」`, value: normalize(rule && rule.url), ruleId: rule ? rule.id : '' }] : []),
    { key: 'group', label: `${SCOPE_LABELS[key]}代理`, value: normalize(group.enabled === false ? '' : group.url) },
    { key: 'global', label: '全局代理', value: normalize(cfg.global.enabled === false ? '' : cfg.global.url) },
  ];
  if (ctx.inlineProxy !== undefined && String(ctx.inlineProxy).trim()) {
    chain.unshift({ key: 'inline', label: '本次请求指定代理', value: normalize(validateUrl(ctx.inlineProxy)) });
  }

  const trace = chain.map((l) => ({ level: l.key, label: l.label, mode: l.value.mode, url: maskUrl(l.value.url) }));
  for (const level of chain) {
    if (level.value.mode === 'direct') {
      return { url: '', source: level.key, sourceLabel: level.label, direct: true, noProxy, masked: '直接连接', chain: trace, ruleId: level.ruleId || '' };
    }
    if (level.value.mode === 'custom') {
      return { url: level.value.url, source: level.key, sourceLabel: level.label, direct: false, noProxy, masked: maskUrl(level.value.url), chain: trace, ruleId: level.ruleId || '' };
    }
  }
  return { url: '', source: 'none', sourceLabel: '未配置代理（直连）', direct: false, noProxy, masked: '无', chain: trace, ruleId: '' };
}

/** 给 HTTP 请求用：命中的代理若被 NO_PROXY 排除则不生效。 */
function forHttp(targetUrl, scope, ctx = {}) {
  const resolved = resolve(scope, { ...ctx, url: ctx.url || targetUrl });
  if (resolved.url && shouldBypass(targetUrl, resolved.noProxy)) {
    return { ...resolved, proxy: '', bypassed: true };
  }
  return { ...resolved, proxy: resolved.url, bypassed: false };
}

/** 仅全局代理（OpenList / 系统自检这类不属于四个作用域的请求）。 */
function forGlobal(targetUrl) {
  const cfg = readConfig();
  const value = normalize(cfg.global.enabled === false ? '' : cfg.global.url);
  if (value.mode !== 'custom' || DIRECT_WORDS.has(value.url.toLowerCase())
    || shouldBypass(targetUrl, cfg.global.noProxy)) {
    return { url: '', proxy: '', masked: '无', source: 'none', noProxy: cfg.global.noProxy };
  }
  return { url: value.url, proxy: value.url, masked: maskUrl(value.url), source: 'global', noProxy: cfg.global.noProxy };
}

/** 注入子进程的环境变量：direct 时显式清空，避免继承平台进程的环境。 */
function envFor(resolved, base = process.env) {
  const noProxy = (resolved && resolved.noProxy) || readConfig().global.noProxy || DEFAULT_NO_PROXY;
  const url = resolved ? resolved.url : '';
  const direct = Boolean(resolved && resolved.direct);
  if (!url && !direct) return {};
  const value = direct ? '' : url;
  return {
    HTTP_PROXY: value, HTTPS_PROXY: value, ALL_PROXY: value,
    http_proxy: value, https_proxy: value, all_proxy: value,
    NO_PROXY: noProxy, no_proxy: noProxy,
  };
}

/** 给 httpJSON / fetch 用的 undici dispatcher（只支持 http/https 代理）。 */
function dispatcher(proxyUrl) {
  if (!proxyUrl) return null;
  const protocol = (() => { try { return new URL(proxyUrl).protocol; } catch { return ''; } })();
  if (protocol === 'socks5:' || protocol === 'socks5h:' || protocol === 'socks4:') {
    throw new Error('HTTP 请求不支持 SOCKS 代理，请改用 http(s):// 代理；SOCKS 可用于 SSH / 本地 CLI');
  }
  requireProxyAgent();
  return new ProxyAgent(proxyUrl);
}

/* ------------------------- 隧道（SSH / Docker TCP） ------------------------- */
// ssh2 的 sock 选项与 http.request 的 createConnection 都只认裸 socket，
// 这里用 CONNECT / SOCKS5 握手把 socket 交出去，不引入第三方代理库。

function connectOptions(proxyUrl) {
  const u = new URL(proxyUrl);
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : (u.protocol.startsWith('socks') ? 1080 : 80)));
  return {
    protocol: u.protocol, host: u.hostname, port,
    username: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
  };
}

function httpTunnel(p, targetHost, targetPort, timeout) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${targetHost}:${targetPort}` };
    if (p.username || p.password) {
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}`;
    }
    const mod = p.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: p.host, port: p.port, method: 'CONNECT',
      path: `${targetHost}:${targetPort}`, headers, agent: false,
    });
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; fn(value); };
    const timer = setTimeout(() => {
      req.destroy();
      finish(reject, new Error(`代理 CONNECT 超时（${p.host}:${p.port}）`));
    }, timeout);
    const clear = () => clearTimeout(timer);
    req.on('connect', (res, socket) => {
      clear();
      if (res.statusCode !== 200) {
        socket.destroy();
        return finish(reject, new Error(`代理 CONNECT 返回 HTTP ${res.statusCode}`));
      }
      finish(resolve, socket);
    });
    req.on('error', (err) => { clear(); finish(reject, err); });
    req.end();
  });
}

function socksTunnel(p, targetHost, targetPort, timeout) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: p.host, port: p.port });
    let done = false;
    let buf = Buffer.alloc(0);
    let stage = 0;
    const finish = (fn, value) => { if (done) return; done = true; socket.removeAllListeners('data'); fn(value); };
    const timer = setTimeout(() => { socket.destroy(); finish(reject, new Error('SOCKS 握手超时')); }, timeout);
    const clear = () => clearTimeout(timer);

    const fail = (message) => { clear(); socket.destroy(); finish(reject, new Error(message)); };
    const send = (data) => socket.write(Buffer.from(data));
    socket.on('error', (err) => { clear(); finish(reject, err); });
    socket.on('connect', () => {
      const methods = [0x00];
      if (p.username) methods.push(0x02);
      send([0x05, methods.length, ...methods]);
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return fail('SOCKS 服务端版本不支持');
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === 0xff) return fail('SOCKS 服务端拒绝了所有认证方式');
        if (method === 0x02) {
          const user = Buffer.from(p.username || '', 'utf8');
          const pass = Buffer.from(p.password || '', 'utf8');
          send([0x01, user.length, ...user, pass.length, ...pass]);
          stage = 1;
        } else {
          stage = 2;
          sendConnect();
        }
        return;
      }
      if (stage === 1) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return fail('SOCKS 用户名或密码错误');
        buf = buf.subarray(2);
        stage = 2;
        sendConnect();
        return;
      }
      if (stage === 2) {
        if (buf.length < 4) return;
        if (buf[1] !== 0x00) return fail(`SOCKS 连接失败，REP=${buf[1]}`);
        // 剩余是 BND.ADDR/BND.PORT，直接丢弃；socket 此后即为透明隧道。
        const rest = buf.subarray(4);
        buf = Buffer.alloc(0);
        if (rest.length) socket.unshift(rest);
        clear();
        finish(resolve, socket);
      }
    });

    function sendConnect() {
      const hostBuf = Buffer.from(targetHost, 'utf8');
      const portBytes = [(targetPort >> 8) & 0xff, targetPort & 0xff];
      let packet;
      if (net.isIP(targetHost) === 4) {
        const parts = targetHost.split('.').map(Number);
        packet = [0x05, 0x01, 0x00, 0x01, ...parts, ...portBytes];
      } else if (net.isIP(targetHost) === 6) {
        // 平台 SSH 目标一般是域名或 IPv4；IPv6 交给远端按域名解析
        packet = [0x05, 0x01, 0x00, 0x03, hostBuf.length, ...hostBuf, ...portBytes];
      } else {
        packet = [0x05, 0x01, 0x00, 0x03, hostBuf.length, ...hostBuf, ...portBytes];
      }
      send(packet);
    }
  });
}

async function openTunnel(proxyUrl, targetHost, targetPort, timeout = 12000) {
  if (!proxyUrl) throw new Error('未指定代理地址');
  const p = connectOptions(proxyUrl);
  if (p.protocol.startsWith('socks')) return socksTunnel(p, targetHost, Number(targetPort), timeout);
  if (p.protocol === 'http:' || p.protocol === 'https:') return httpTunnel(p, targetHost, Number(targetPort), timeout);
  throw new Error(`不支持建立隧道的代理协议：${p.protocol}`);
}

/** 给 http.request 用的 Agent（Docker Engine TCP 目标经代理转发）。 */
function tunnelAgent(proxyUrl, targetHost, targetPort) {
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    openTunnel(proxyUrl, options.host || targetHost, options.port || targetPort)
      .then((socket) => callback(null, socket))
      .catch((error) => callback(error));
  };
  return agent;
}

/** 连通性测试：优先用真实 HTTP 请求（能验证转发），无 undici 时退化为 TCP 隧道。 */
async function testProxy(proxyUrl, targetUrl) {
  const started = Date.now();
  if (DIRECT_WORDS.has(String(proxyUrl || '').toLowerCase())) proxyUrl = '';
  const target = String(targetUrl || 'https://github.com').trim();
  let u;
  try { u = new URL(target); } catch { throw new Error('测试地址不是合法 URL'); }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!proxyUrl) {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: u.hostname, port }, () => { socket.destroy(); resolve(); });
      socket.setTimeout(6000, () => { socket.destroy(); reject(new Error('直连超时')); });
      socket.on('error', reject);
    });
    return { ok: true, ms: Date.now() - started, mode: 'direct', target };
  }
  const p = connectOptions(proxyUrl);
  if (p.protocol.startsWith('socks') || !ProxyAgent) {
    const socket = await openTunnel(proxyUrl, u.hostname, port, 8000);
    socket.destroy();
    return { ok: true, ms: Date.now() - started, mode: 'tunnel', target, proxy: maskUrl(proxyUrl) };
  }
  let agent;
  try { agent = new ProxyAgent(proxyUrl); } catch (e) { throw new Error(`代理地址无效：${e.message}`); }
  try {
    const response = await fetch(target, { dispatcher: agent, signal: AbortSignal.timeout(8000) });
    await response.arrayBuffer().catch(() => {});
    return { ok: true, ms: Date.now() - started, mode: 'http', status: response.status, target, proxy: maskUrl(proxyUrl) };
  } finally {
    try { await agent.close(); } catch { /* noop */ }
  }
}

/* ------------------------------ 对外配置 API ------------------------------ */

function publicConfig() {
  const cfg = readConfig();
  const overrides = {};
  for (const scope of SCOPES) {
    overrides[scope] = Object.entries(cfg.overrides[scope] || {}).map(([id, v]) => ({
      id, url: maskUrl(v.url || ''), direct: DIRECT_WORDS.has(String(v.url || '').toLowerCase()),
      note: v.note || '', updatedAt: v.updatedAt || '',
    }));
  }
  return {
    enabled: cfg.global.enabled,
    global: {
      url: maskUrl(cfg.global.url), direct: DIRECT_WORDS.has(String(cfg.global.url).toLowerCase()),
      noProxy: cfg.global.noProxy, enabled: cfg.global.enabled,
    },
    groups: Object.fromEntries(SCOPES.map((scope) => [scope, {
      label: SCOPE_LABELS[scope], url: maskUrl(cfg.groups[scope].url),
      direct: DIRECT_WORDS.has(String(cfg.groups[scope].url).toLowerCase()),
      enabled: cfg.groups[scope].enabled !== false,
    }])),
    rules: cfg.rules.map((r) => ({ ...r, url: maskUrl(r.url) })),
    overrides,
    priority: [
      { scope: 'git', chain: ['单个仓库代理', 'Git Host 匹配代理', 'Git 分组代理', '全局代理'] },
      { scope: 'docker', chain: ['单个容器代理', 'Docker 代理', '全局代理'] },
      { scope: 'server', chain: ['单个服务器代理', '服务器代理', '全局代理'] },
      { scope: 'ai', chain: ['单个 AI 服务代理', 'AI 服务代理', '全局代理'] },
    ],
    capabilities: {
      httpProxy: Boolean(ProxyAgent), sshTunnel: true, socksTunnel: true,
      globalFromEnv: Boolean(env('DP_PROXY_GLOBAL')),
    },
  };
}

function setGlobal(patch = {}) {
  const current = readConfig();
  const next = {};
  if (patch.url !== undefined) next.url = validateUrl(unmask(patch.url, current.global.url));
  if (patch.noProxy !== undefined) next.noProxy = String(patch.noProxy || '').slice(0, 2000);
  if (patch.enabled !== undefined) next.enabled = patch.enabled !== false && patch.enabled !== 'false';
  writeConfig((cfg) => { cfg.global = { ...cfg.global, ...next }; });
  return publicConfig();
}

function setGroup(scope, patch = {}) {
  if (!SCOPES.includes(scope)) throw new Error(`未知代理分组：${scope}`);
  const next = {};
  if (patch.url !== undefined) next.url = validateUrl(unmask(patch.url, readConfig().groups[scope].url));
  if (patch.enabled !== undefined) next.enabled = patch.enabled !== false && patch.enabled !== 'false';
  writeConfig((cfg) => { cfg.groups[scope] = { ...cfg.groups[scope], ...next }; });
  return publicConfig();
}

function addRule(body = {}) {
  const pattern = String(body.pattern || '').trim().slice(0, 200);
  if (!pattern) throw new Error('请填写匹配规则（如 github.com 或 *.gitea.internal）');
  const url = validateUrl(unmask(body.url, ''));
  const rule = {
    id: uid('prule'), pattern, url,
    note: String(body.note || '').slice(0, 200),
    enabled: body.enabled !== false, createdAt: new Date().toISOString(),
  };
  writeConfig((cfg) => { cfg.rules.push(rule); });
  return rule;
}

function updateRule(id, patch = {}) {
  writeConfig((cfg) => {
    const rule = cfg.rules.find((r) => r.id === id);
    if (!rule) throw new Error(`规则不存在：${id}`);
    if (patch.pattern !== undefined) rule.pattern = String(patch.pattern).trim().slice(0, 200);
    if (patch.url !== undefined) rule.url = validateUrl(unmask(patch.url, rule.url));
    if (patch.note !== undefined) rule.note = String(patch.note).slice(0, 200);
    if (patch.enabled !== undefined) rule.enabled = patch.enabled !== false && patch.enabled !== 'false';
  });
  return publicConfig().rules.find((r) => r.id === id);
}

function removeRule(id) {
  writeConfig((cfg) => { cfg.rules = cfg.rules.filter((r) => r.id !== id); });
  return { removed: id };
}

function setOverride(scope, id, body = {}) {
  if (!SCOPES.includes(scope)) throw new Error(`未知代理分组：${scope}`);
  const key = String(id || '').trim();
  if (!key) throw new Error('请选择或填写对象标识');
  const existing = (readConfig().overrides[scope] || {})[key];
  const url = validateUrl(unmask(body.url, existing && existing.url));
  writeConfig((cfg) => {
    if (!url) delete cfg.overrides[scope][key];
    else cfg.overrides[scope][key] = {
      url, note: String(body.note || '').slice(0, 200), updatedAt: new Date().toISOString(),
    };
  });
  return { scope, id: key, url: maskUrl(url), saved: Boolean(url) };
}

function removeOverride(scope, id) {
  if (!SCOPES.includes(scope)) throw new Error(`未知代理分组：${scope}`);
  writeConfig((cfg) => { delete cfg.overrides[scope][String(id)]; });
  return { removed: String(id) };
}

/** 代理页下拉候选：网络探测全部 best-effort，单个失败不影响其它分组。 */
async function listEntities() {
  const items = { git: [], docker: [], server: [], ai: [] };
  try {
    const { allSources } = require('./gitSources');
    for (const s of allSources()) items.git.push({ id: s.id, label: `Git 源 · ${s.label}`, host: hostOf(s.baseUrl) });
  } catch { /* noop */ }
  try {
    const { listAllRepos } = require('./gitSources');
    const result = await listAllRepos();
    for (const r of result.items || []) {
      items.git.push({ id: r.id, label: `仓库 · ${r.fullName}`, host: hostOf(r.cloneUrl) });
    }
  } catch { /* noop */ }
  try {
    const docker = require('./dockerApi');
    const containers = await docker.listContainers('all');
    for (const c of containers || []) {
      const name = (c.Names || []).map((n) => String(n).replace(/^\//, ''))[0] || String(c.Id || '').slice(0, 12);
      items.docker.push({ id: name, label: `容器 · ${name}` });
    }
  } catch { /* 无 Docker 时跳过 */ }
  for (const inst of (state().extensions || [])) {
    items.docker.push({ id: inst.id, label: `扩展 · ${inst.label || inst.name}`, host: inst.host || '' });
  }
  for (const s of state().servers || []) {
    items.server.push({ id: s.id, label: `服务器 · ${s.name} (${s.host})`, host: s.host });
  }
  for (const p of state().aiProviders || []) {
    items.ai.push({ id: p.id, label: `AI · ${p.name}`, host: hostOf(p.baseURL) });
  }
  return { items, overrideKeys: OVERRIDE_KEYS };
}

module.exports = {
  SCOPES, SCOPE_LABELS, DEFAULT_NO_PROXY,
  readConfig, publicConfig, setGlobal, setGroup,
  addRule, updateRule, removeRule, setOverride, removeOverride, listEntities,
  resolve, forHttp, forGlobal, envFor, dispatcher, shouldBypass, hostOf,
  normalize, validateUrl, maskUrl, openTunnel, tunnelAgent, testProxy,
  hasHttpProxy: () => Boolean(ProxyAgent),
  // 供 integrations 复用：避免两套 NO_PROXY 逻辑
  proxyEnvironment: (resolved, base) => envFor(resolved, base),
};
