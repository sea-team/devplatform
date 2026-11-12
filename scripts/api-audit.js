'use strict';

/**
 * 深度接口审计（v0.3.11）
 * ---------------------------------------------------------------------------
 * api-sweep.js 回答「所有接口有没有 500」，本脚本回答「边界 / 安全 / 契约有没有问题」：
 *
 *   A. 全路由扫描：从 server.js 自动提取路由，GET 用真实 id、写用不存在的 id，
 *      校验 200 响应 ok:true、非 2xx 响应统一 {ok:false,status,error}。
 *   B. 副作用接口：对 api-sweep 主动 SKIP 的接口，用「不存在的 id / 缺参」安全触发
 *      校验分支；真正无参数就会改状态的接口登记为 NO_CALL，绝不发请求。
 *   C. 边界：路径穿越、命令注入、超长 / 空值 / 类型错误、畸形 JSON、超大 body。
 *   D. 脱敏：主动 reveal 拿到明文后，扫描所有只读接口响应是否夹带明文。
 *   E. 并发：常用只读接口 20 并发，检查无 500 / 超时 / 串响应。
 *
 * 用法：
 *   node scripts/api-audit.js --base http://10.0.0.246:9000
 *   node scripts/api-audit.js --base http://127.0.0.1:9000 --json
 *
 * 只读 / 不存在的 id / 缺参，绝不触发真实写操作；发现问题退出码为 1。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = String(arg('--base', 'http://127.0.0.1:9000')).replace(/\/+$/, '');
// v0.4.0：强制登录模式下用 ADMIN_TOKEN 机器通道跑全路由审计。
const TOKEN = String(arg('--token', process.env.DP_TOKEN || '')).trim();
const AS_JSON = argv.includes('--json');
const TIMEOUT = Number(arg('--timeout', '15000'));
const MISSING = '__audit_missing__';

/* ------------------------------ 路由提取 ------------------------------ */
const serverSrc = fs.readFileSync(path.join(ROOT, 'platform/src/server.js'), 'utf8');
const routes = [];
const routeRe = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
let m;
while ((m = routeRe.exec(serverSrc))) routes.push({ method: m[1].toUpperCase(), path: m[2] });

// 这些接口「调用即产生副作用」且没有可安全触发的校验分支，只能登记、不能打。
const NO_CALL = new Set([
  'POST /api/system/reload',
  'POST /api/system/update/apply',
  'POST /api/system/rollback',
  'POST /api/system/update/check',
  'POST /api/openlist/connection/reset',
  'POST /api/extensions/dbgate/sync',
  'POST /api/builds',
  'POST /api/ai/local/test',
  'PUT /api/env-config',
  'GET /api/servers/:id/terminal/stream',
]);

const QUERY = {
  '/api/openlist/drivers/info': '?driver=Local',
  '/api/openlist/files/link': '?path=/',
  '/api/openlist/files/download': '?path=/__audit_missing__',
  '/api/servers/:id/files/content': '?path=/etc/hostname',
  '/api/servers/:id/files/download': '?path=/etc/hostname',
  '/api/servers/:id/files': '?path=/',
  '/api/docker/images/export': '?ref=__audit_missing__',
  '/api/git-sources/:id/branches': '?repo=none',
};

const groupOf = (p) => (p.startsWith('/api/servers/') ? 'server'
  : p.startsWith('/api/extensions/instances/') ? 'instance'
    : p.startsWith('/api/extensions/backups/') ? 'backup'
      : p.startsWith('/api/builds/') ? 'build'
        : p.startsWith('/api/git-sources/') ? 'source'
          : p.startsWith('/api/docker/containers/') ? 'container'
            : p.startsWith('/api/environment/profiles/') ? 'profile'
              : p.startsWith('/api/proxy/rules/') ? 'rule'
                : p.startsWith('/api/ai/providers/') ? 'provider'
                  : p.startsWith('/api/docker/templates/') ? 'template'
                    : p.startsWith('/api/openlist/connections/') ? 'connection'
                      : '');

function fillParams(p, ids = {}) {
  let out = p;
  if (/:id/.test(out)) out = out.replace(':id', ids[groupOf(out)] || MISSING);
  out = out.replace(':ref', MISSING).replace(':scope', 'git').replace(':name', MISSING);
  if (QUERY[p]) out += QUERY[p];
  return out;
}

/* ------------------------------ 请求工具 ------------------------------ */
async function call(method, p, opts = {}) {
  const headers = { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...(opts.headers || {}) };
  let body;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (!headers['content-type']) headers['content-type'] = 'application/octet-stream';
  } else if (opts.body !== undefined) {
    body = typeof opts.body === 'string' && opts.noStringify ? opts.body : JSON.stringify(opts.body);
    headers['content-type'] = opts.contentType || 'application/json';
  }
  const init = { method, headers, signal: AbortSignal.timeout(opts.timeout || TIMEOUT) };
  if (body !== undefined) init.body = body;
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + p, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 二进制 / 非 JSON */ }
    return { status: r.status, json, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 'NETWORK', json: null, text: String((e && e.message) || e), ms: Date.now() - t0 };
  }
}

const problems = [];
const stats = { requests: 0, ok200: 0, client4xx: 0, upstream502: 0, server500: 0, network: 0, noCall: 0 };
const responses = [];

function record(label, method, p, r, expect = {}) {
  stats.requests += 1;
  if (r.status === 200) stats.ok200 += 1;
  else if (Number(r.status) >= 400 && Number(r.status) < 500) stats.client4xx += 1;
  else if (r.status === 502) stats.upstream502 += 1;
  else if (r.status === 500) stats.server500 += 1;
  else if (r.status === 'NETWORK' || r.status === 'TIMEOUT') stats.network += 1;
  responses.push({ label, method, p, text: r.text });

  const add = (kind, detail) => problems.push({ label, method, path: p, status: r.status, kind,
    detail, sample: String(r.text || '').slice(0, 220) });

  if (r.status === 500) add('SERVER_500', '业务异常被归类成 500');
  if (r.status === 'NETWORK') add('NETWORK', '连接中断 / 超时，未收到 HTTP 响应');
  if (typeof r.status === 'number' && r.status >= 400) {
    const j = r.json;
    if (!j || j.ok !== false || typeof j.status !== 'number' || typeof j.error !== 'string') {
      add('BAD_ERROR_SHAPE', '非 2xx 响应不符合 {ok:false,status,error} 契约');
    }
    if (expect.maxStatus && r.status > expect.maxStatus) {
      add('UNEXPECTED_STATUS', `期望 HTTP ${expect.maxStatus} 以内，实际 ${r.status}`);
    }
  }
  if (expect.exactStatus && r.status !== expect.exactStatus) {
    add('UNEXPECTED_STATUS', `期望 HTTP ${expect.exactStatus}，实际 ${r.status}`);
  }
  if (expect.minStatus && Number(r.status) < expect.minStatus) {
    add('UNEXPECTED_OK', `期望被拒绝（>= ${expect.minStatus}），实际 ${r.status} ${r.json && r.json.ok === true ? 'ok:true' : ''}`);
  }
  if (expect.noOk && r.json && r.json.ok === true) {
    add('UNEXPECTED_OK', '危险 / 越界请求被当成成功执行');
  }
  if (r.status === 200 && r.json && r.json.ok !== true) {
    add('BAD_OK', 'HTTP 200 但响应 ok 不是 true');
  }
  return r;
}

async function collectIds() {
  const ids = {};
  const picks = [
    ['server', '/api/servers'], ['instance', '/api/extensions/instances'],
    ['build', '/api/builds'], ['source', '/api/git-sources'],
    ['rule', '/api/proxy/rules'], ['template', '/api/docker/templates'],
    ['provider', '/api/ai/providers'], ['backup', '/api/extensions/backups'],
    ['connection', '/api/openlist/connections'],
  ];
  for (const [key, p] of picks) {
    const r = await call('GET', p);
    const d = r.json && r.json.data;
    const arr = d && (Array.isArray(d.items) ? d.items : Array.isArray(d) ? d : []);
    if (arr.length && arr[0].id) ids[key] = arr[0].id;
    record('collectIds ' + key, 'GET', p, r);
  }
  return ids;
}

/* -------------------- 1. 全部路由的安全请求 -------------------- */
async function sweepAll(ids) {
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (NO_CALL.has(key)) { stats.noCall += 1; continue; }
    const p = fillParams(route.path, route.method === 'GET' ? ids : {});
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method) ? {} : undefined;
    // raw 上传接口绝不能带 JSON body：否则会被当成真实文件内容写进去。
    const isRawUpload = /files\/upload$|storage\/upload$|images\/load$/.test(route.path);
    const r = await call(route.method, p, body === undefined || isRawUpload ? {} : { body });
    record('route ' + key, route.method, p, r);
  }
}

/* ------------- 2. 巡检跳过的副作用接口（安全参数触发校验） ------------- */
async function skippedProbes() {
  const probes = [
    ['POST', '/api/deploy', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/ide/password', { body: {} }, {}],
    ['POST', '/api/repos/git', { body: { repo: MISSING, command: 'status' } }, { minStatus: 400 }],
    ['POST', '/api/extensions/backups/' + MISSING + '/restore', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/extensions/instances/' + MISSING + '/rebuild', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/extensions/instances/' + MISSING + '/inject', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/extensions/instances/' + MISSING + '/action', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/extensions/instances/' + MISSING + '/upgrade', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/docker/containers/' + MISSING + '/action', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/docker/containers/' + MISSING + '/exec', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/docker/images/load', {}, { minStatus: 400, maxStatus: 499, exactStatus: 400 }],
    ['POST', '/api/docker/images/load-path', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/servers/' + MISSING + '/exec', { body: { command: 'echo __audit__' } }, { minStatus: 400, maxStatus: 499 }],
    ['POST', '/api/servers/' + MISSING + '/terminal/open', { body: {} }, { minStatus: 400 }],
    ['POST', '/api/servers/' + MISSING + '/terminal/close', { body: {} }, { minStatus: 400 }],
    ['PUT', '/api/openlist/files/content', { body: {} }, { minStatus: 400 }],
    ['PUT', '/api/servers/' + MISSING + '/files/content', { body: {} }, { minStatus: 400 }],
    ['PUT', '/api/openlist/files/upload', {}, { minStatus: 400 }],
    ['PUT', '/api/servers/' + MISSING + '/files/upload', {}, { minStatus: 400 }],
    ['PUT', '/api/storage/upload', {}, { minStatus: 400 }],
  ];
  for (const [method, p, opts, expect] of probes) {
    const r = await call(method, p, opts);
    record('probe ' + method + ' ' + p, method, p, r, expect);
    if (p === '/api/ide/password' && r.json && r.json.data && r.json.data.password) {
      problems.push({ label: 'ide/password 默认泄露明文', method, path: p, status: r.status,
        kind: 'SECRET_LEAK', detail: 'reveal 未开启仍返回非空 password', sample: '' });
    }
  }
}

/* ---------------------- 3. 边界 / 注入 / 畸形输入 ---------------------- */
async function boundary() {
  const cases = [
    ['GET', '/api/ide/dirs?path=/../', {}, { minStatus: 400, noOk: true }, '目录浏览越界'],
    ['GET', '/api/ide/dirs?path=/%2e%2e%2f', {}, { minStatus: 400, noOk: true }, '编码穿越'],
    ['GET', '/api/ide/dirs?path=/' + 'a'.repeat(6000), {}, { maxStatus: 499 }, '超长路径'],
    ['GET', '/api/openlist/files?path=/../../etc', {}, { maxStatus: 502 }, 'OpenList 路径穿越'],
    ['GET', '/api/openlist/files/content?path=/../../etc/passwd', {}, { maxStatus: 502 }, 'OpenList 内容穿越'],
    ['POST', '/api/openlist/files/mkdir', { body: { path: '/', name: '../__audit_escape__' } }, { minStatus: 400, noOk: true }, '文件名穿越'],
    ['POST', '/api/repos/git', { body: { repo: 'secure', command: 'status; rm -rf /' } }, { minStatus: 400, noOk: true }, 'Git 命令注入'],
    ['POST', '/api/repos/git', { body: { repo: 'secure', command: 'log', args: ['--git-dir=/etc'] } }, { minStatus: 400, noOk: true }, 'Git 参数注入'],
    ['POST', '/api/repos/git', { body: { repo: '../etc', command: 'status' } }, { minStatus: 400, noOk: true }, 'Git 仓库越界'],
    // 写操作只打不存在的 server，避免真的在远端创建文件。
    ['POST', '/api/servers/' + MISSING + '/files/create', { body: { path: '/tmp', name: 'x; rm -rf /' } }, { minStatus: 400 }, 'SFTP 文件名注入(不落盘)'],
    ['POST', '/api/proxy/test', { rawBody: '{bad json', headers: { 'content-type': 'application/json' } }, { exactStatus: 400, noOk: true }, '畸形 JSON body'],
    ['POST', '/api/git-sources', { rawBody: '{bad json', headers: { 'content-type': 'application/json' } }, { exactStatus: 400, noOk: true }, '畸形 JSON body(2)'],
    ['POST', '/api/openlist/files/mkdir', { rawBody: 'hello', headers: { 'content-type': 'text/plain' } }, { minStatus: 400, maxStatus: 499, noOk: true }, '非 JSON body'],
    ['POST', '/api/openlist/files/mkdir', { body: [1, 2, 3] }, { minStatus: 400, maxStatus: 499, noOk: true }, '数组 body'],
    ['POST', '/api/openlist/files/mkdir', { body: 12345 }, { minStatus: 400, maxStatus: 499, noOk: true }, '数字 body'],
    ['POST', '/api/proxy/test', { body: { url: 'x'.repeat(2200000) } }, { exactStatus: 413, noOk: true }, '超大 JSON body'],
  ];
  for (const [method, p, opts, expect, label] of cases) {
    const r = await call(method, p, opts);
    record('boundary ' + label, method, p, r, expect);
  }
  // 确认越界 mkdir 没有真的在工作区落盘
  const after = await call('GET', '/api/openlist/files?path=/');
  record('boundary 越界未落盘确认', 'GET', '/api/openlist/files?path=/', after);
  if (String(after.text).includes('__audit_escape__')) {
    problems.push({ label: 'boundary 文件名穿越', kind: 'PATH_ESCAPE', status: 200,
      detail: '越界名称出现在目录中，疑似真实落盘', sample: '' });
  }
}

/* --------------------------- 4. 凭据脱敏扫描 --------------------------- */
async function secrets(ids) {
  const secretsFound = [];
  const ide = await call('POST', '/api/ide/password', { body: { reveal: true } });
  const idePwd = ide.json && ide.json.data && ide.json.data.password;
  if (idePwd && idePwd.length >= 6) secretsFound.push({ from: 'CODE_SERVER_PASSWORD', value: idePwd });
  if (ids.instance) {
    const cr = await call('GET', '/api/extensions/instances/' + ids.instance + '/credentials');
    const d = cr.json && cr.json.data;
    if (d && d.password && String(d.password).length >= 6) {
      secretsFound.push({ from: '扩展登录密码', value: String(d.password) });
    }
  }
  const allow = /\/credentials$|\/connection$|\/ide\/password$/;
  for (const r of responses) {
    if (!/^(GET|HEAD)$/.test(r.method) || allow.test(r.p)) continue;
    for (const s of secretsFound) {
      if (r.text.includes(s.value)) {
        problems.push({ label: 'secret-scan', method: r.method, path: r.p, status: 200,
          kind: 'SECRET_LEAK', detail: `${s.from} 的明文出现在只读接口 ${r.p} 的响应中`, sample: '' });
      }
    }
  }
  return secretsFound.length;
}

/* ------------------------------ 5. 并发 ------------------------------ */
async function concurrency() {
  const targets = ['/api/overview', '/api/host-info', '/api/health', '/api/docker/overview'];
  const jobs = [];
  for (let i = 0; i < 20; i += 1) {
    for (const p of targets) jobs.push(call('GET', p).then((r) => ({ p, r })));
  }
  const all = await Promise.all(jobs);
  for (const { p, r } of all) record('concurrency ' + p, 'GET', p, r);
}

(async () => {
  const health = await call('GET', '/api/health', { timeout: 8000 });
  if (health.status !== 200 || !health.json || !health.json.ok) {
    console.error(`无法连接平台：${BASE}/api/health → ${health.status} ${health.text}`);
    process.exit(2);
  }
  const version = health.json.data.version;
  const ids = await collectIds();
  await sweepAll(ids);
  await skippedProbes();
  await boundary();
  const secretCount = await secrets(ids);
  await concurrency();

  const report = {
    base: BASE, version, totalRoutes: routes.length, secretSamples: secretCount,
    stats, problems,
  };
  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`平台 ${version} · 路由 ${routes.length} 条 · 实际请求 ${stats.requests} 次 · 免调用 ${stats.noCall} 条`);
    console.log(`响应：200=${stats.ok200} 4xx=${stats.client4xx} 502=${stats.upstream502} 500=${stats.server500} 网络异常=${stats.network}`);
    console.log(`凭据样本 ${secretCount} 个（明文不输出）· 问题 ${problems.length} 项`);
    for (const p of problems) {
      console.log(`  [${p.kind}] ${p.method} ${p.path} → ${p.status} :: ${p.detail}`);
      if (p.sample) console.log(`     ${p.sample.replace(/\s+/g, ' ').slice(0, 180)}`);
    }
  }
  process.exit(problems.length ? 1 : 0);
})();
