'use strict';

/**
 * 全接口巡检（v0.3.5）
 * ---------------------------------------------------------------------------
 * 背景：外部集成服务（OpenList / Gitea / Docker）一挂，一批接口会同时抛 500，
 * 前端看起来就是「大多功能都报错」。以前只能靠人工逐个点页面排查。
 *
 * 本脚本直接从 platform/src/server.js 提取全部路由，自动生成安全请求并校验：
 *   - HTTP 500 必须为 0（500 只应代表未预期的代码异常）；
 *   - 业务错误应归到 400 / 404；外部服务不可用应归到 502 并带 hint；
 *   - 只读列表接口在上游不可用时返回 200 + degraded 空数据，不阻断页面。
 *
 * 用法：
 *   node scripts/api-sweep.js --base http://10.0.0.246:9000
 *   node scripts/api-sweep.js --base http://127.0.0.1:9000 --full
 *   node scripts/api-sweep.js --base http://10.0.0.246:9000 --token "$DP_TOKEN" --full
 *   node scripts/api-sweep.js --json            # 机器可读报告
 *
 * v0.4.0 起平台默认强制登录：远端巡检需带 ADMIN_TOKEN（--token 或 DP_TOKEN 环境变量），
 * 令牌等价管理员，不影响未登录 401 的验证（那部分由 scripts/smoke-auth.js 覆盖）。
 *
 * --full 会额外跑「创建临时实体 → 查询 → 修改 → 删除」的 CRUD 循环，
 * 所有临时实体都带 __sweep_ 前缀并在结束时清理。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// --base 给站点根地址；server.js 里的路由本身已带 /api 前缀，这里不能再补一次。
const BASE = String(arg('--base', 'http://127.0.0.1:9000')).replace(/\/+$/, '');
// v0.4.0：账号体系默认强制登录，巡检走 ADMIN_TOKEN 机器通道（--token 或 DP_TOKEN 环境变量）。
const TOKEN = String(arg('--token', process.env.DP_TOKEN || '')).trim();
const FULL = argv.includes('--full');
const AS_JSON = argv.includes('--json');
// Windows 本机上「构建后端 / 本地 AI 程序」探测会尝试启动 wsl.exe；远端 Linux 不会。
const SKIP_PROBE = argv.includes('--skip-probe');
const PROBE_PATHS = new Set(['GET /api/builds/backends', 'GET /api/ai/local/programs']);
const TIMEOUT = Number(arg('--timeout', '12000'));

/* ------------------------------ 路由提取 ------------------------------ */
const serverSrc = fs.readFileSync(path.join(ROOT, 'platform/src/server.js'), 'utf8');
const routes = [];
const routeRe = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
let m;
while ((m = routeRe.exec(serverSrc))) routes.push({ method: m[1].toUpperCase(), path: m[2] });

// 这些接口即使空参数也会产生副作用（重启 / 升级 / 清凭据 / 长连接），巡检不直接打。
const SKIP = new Set([
  'POST /api/system/reload',
  'POST /api/system/update/apply',
  'POST /api/system/rollback',
  'POST /api/openlist/connection/reset',
  'GET /api/servers/:id/terminal/stream',
  'POST /api/servers/:id/terminal/open',
  'POST /api/servers/:id/terminal/close',
  'POST /api/servers/:id/exec',
  'POST /api/system/update/check',
  'POST /api/builds',
  'POST /api/deploy',
  'POST /api/extensions/dbgate/sync',
  'POST /api/ai/local/test',
  'POST /api/extensions/backups/:id/restore',
  'POST /api/extensions/instances/:id/upgrade',
  // v0.3.8：写 .env 属于真实副作用（备份 + 改文件），巡检绝不触发。
  'PUT /api/env-config',
  // v0.3.10：Git 命令可能 fetch/pull，密码接口会返回明文，巡检绝不触发。
  'POST /api/repos/git',
  'POST /api/ide/password',
  // v0.3.7：重建会删除并重新创建容器，巡检绝不触发。
  'POST /api/extensions/instances/:id/rebuild',
  'POST /api/extensions/instances/:id/inject',
  'POST /api/extensions/instances/:id/action',
  'POST /api/docker/images/load',
  'POST /api/docker/images/load-path',
  'POST /api/docker/containers/:id/action',
  'POST /api/docker/containers/:id/exec',
  'PUT /api/storage/upload',
  // v0.3.11：覆盖写 OpenList 文件会改动真实内容，巡检绝不触发。
  'PUT /api/openlist/files/content',
  'PUT /api/openlist/files/upload',
  'PUT /api/servers/:id/files/upload',
]);

/* ------------------------------ 请求工具 ------------------------------ */
async function call(method, p, body, timeout = TIMEOUT) {
  const init = { method, headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  try {
    const r = await fetch(BASE + p, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 二进制 / SSE */ }
    return { status: r.status, json, raw: text.slice(0, 160) };
  } catch (e) {
    return { status: 'TIMEOUT', json: null, raw: String(e.message || e) };
  }
}

const safeId = '__sweep_missing__';
function fillParams(p, ids = {}) {
  let out = p;
  if (/:id/.test(out)) {
    const group = out.startsWith('/api/servers/') ? 'server'
      : out.startsWith('/api/extensions/instances/') ? 'instance'
        : out.startsWith('/api/extensions/backups/') ? 'backup'
          : out.startsWith('/api/builds/') ? 'build'
            : out.startsWith('/api/git-sources/') ? 'source'
              : out.startsWith('/api/docker/containers/') ? 'container'
                : out.startsWith('/api/environment/profiles/') ? 'profile'
                  : out.startsWith('/api/proxy/rules/') ? 'rule'
                    : out.startsWith('/api/ai/providers/') ? 'provider'
                      : out.startsWith('/api/docker/templates/') ? 'template'
                        : out.startsWith('/api/openlist/connections/') ? 'connection'
                          : '';
    out = out.replace(':id', ids[group] || safeId);
  }
  out = out.replace(':ref', safeId).replace(':scope', 'git').replace(':name', safeId);
  // 需要 query 才能走到的接口给一个合法的空查询，避免全是「缺少参数」。
  const QUERY = {
    '/api/openlist/drivers/info': '?driver=Local',
    '/api/openlist/files/link': '?path=/',
    '/api/openlist/files/download': '?path=/__sweep_missing__',
    '/api/servers/:id/files/content': '?path=/etc/hostname',
    '/api/servers/:id/files/download': '?path=/etc/hostname',
    '/api/servers/:id/files': '?path=/',
    '/api/docker/images/export': '?ref=__sweep_missing__',
    '/api/git-sources/:id/branches': '?repo=none',
  };
  for (const [k, v] of Object.entries(QUERY)) if (p === k) out += v;
  return out;
}

/* ------------------------------ 主流程 ------------------------------ */
const results = [];
const log = (...a) => { if (!AS_JSON) console.log(...a); };

async function collectIds() {
  const ids = {};
  const picks = [
    ['server', '/api/servers', 'items'], ['instance', '/api/extensions/instances', 'items'],
    ['build', '/api/builds', 'items'], ['source', '/api/git-sources', 'items'],
    ['rule', '/api/proxy/rules', 'items'], ['template', '/api/docker/templates', 'items'],
    ['provider', '/api/ai/providers', 'items'], ['backup', '/api/extensions/backups', 'items'],
    ['connection', '/api/openlist/connections', 'items'],
  ];
  for (const [key, p, field] of picks) {
    const r = await call('GET', p);
    const arr = r.json && r.json.data && Array.isArray(r.json.data[field]) ? r.json.data[field] : [];
    if (arr.length && arr[0].id) ids[key] = arr[0].id;
  }
  return ids;
}

/** 用真实 id 替换后，再单独探一次「不存在的 id」以验证 404 归类。 */
async function sweepRoutes(ids) {
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (SKIP.has(key) || (SKIP_PROBE && PROBE_PATHS.has(key))) {
      results.push({ ...route, status: 'SKIP' }); continue;
    }
    // 写接口永远用不存在的 id：巡检必须保证不会误删 / 误改真实数据。
    // 真实写路径由 --full 用临时实体单独覆盖。
    const p = fillParams(route.path, route.method === 'GET' ? ids : {});
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method) ? {} : undefined;
    const r = await call(route.method, p, body);
    results.push({ ...route, requested: p, status: r.status, json: r.json, raw: r.raw });
  }
}

/** 只读列表在上游不可用时必须降级成 200 + degraded，不能是 500/502。 */
const DEGRADE_PATHS = [
  '/api/storage', '/api/storage/mounts', '/api/openlist/settings',
  '/api/openlist/storages', '/api/openlist/drivers', '/api/openlist/drivers/info?driver=Local',
  '/api/openlist/files?path=/', '/api/git-sources/builtin-gitea/repos',
];

async function checkDegrade() {
  const extra = [];
  for (const p of DEGRADE_PATHS) {
    const r = await call('GET', p);
    const degraded = Boolean(r.json && r.json.data && r.json.data.degraded);
    // 降级成 200 空数据，或明确的配置 / 参数类 4xx，都算「没有把上游故障变成 500」。
    const acceptable = (r.status === 200 && Boolean(r.json && r.json.ok))
      || (Number(r.status) >= 400 && Number(r.status) < 500 && Boolean(r.json && r.json.ok === false));
    extra.push({ method: 'GET', path: p, requested: p, status: r.status,
      degraded, acceptable, json: r.json, raw: r.raw });
  }
  return extra;
}

/** --full：在真实写路径上做一轮 CRUD，全部临时实体最后删除。 */
async function crud() {
  const out = [];
  const t = (label, r) => out.push({ method: 'CRUD', path: label, requested: label, status: r.status, json: r.json });
  const cleanup = [];
  let r = await call('POST', '/api/git-sources', { label: '__sweep_src', type: 'gitea', url: 'http://127.0.0.1:1', token: 'x' });
  // 地址必须合法才能创建成功；这里故意用不可达地址，仍应返回 4xx 而不是 500。
  t('CRUD git-source create', r);
  if (r.json && r.json.ok && r.json.data && r.json.data.id) cleanup.push(['/api/git-sources/' + r.json.data.id, 'DELETE']);

  r = await call('POST', '/api/proxy/rules', { host: 'sweep.invalid', url: 'direct', label: '__sweep_rule' });
  t('CRUD proxy rule create', r);
  if (r.json && r.json.ok && r.json.data && r.json.data.id) {
    const id = r.json.data.id;
    t('CRUD proxy rule update', await call('PUT', '/api/proxy/rules/' + id, { url: 'direct', host: 'sweep.invalid' }));
    cleanup.push(['/api/proxy/rules/' + id, 'DELETE']);
  }

  r = await call('POST', '/api/environment/profiles', { id: '__sweep_profile', name: '巡检临时', strategies: { gitClone: 'auto' } });
  t('CRUD environment profile save', r);
  cleanup.push(['/api/environment/profiles/__sweep_profile', 'DELETE']);

  r = await call('POST', '/api/docker/templates', { name: '__sweep_tpl', image: 'alpine:3' });
  t('CRUD docker template create', r);
  if (r.json && r.json.ok && r.json.data && r.json.data.id) cleanup.push(['/api/docker/templates/' + r.json.data.id, 'DELETE']);

  r = await call('POST', '/api/openlist/connections', { label: '__sweep_conn', url: 'http://127.0.0.1:1', user: 'admin', password: 'x' });
  t('CRUD openlist connection create', r);
  if (r.json && r.json.ok && r.json.data && r.json.data.id) cleanup.push(['/api/openlist/connections/' + r.json.data.id, 'DELETE']);

  for (const [p, method] of cleanup.reverse()) t('CRUD cleanup ' + method + ' ' + p, await call(method, p, method === 'DELETE' ? undefined : {}));
  return out;
}

(async () => {
  const health = await call('GET', '/api/health', undefined, 8000);
  if (health.status !== 200 || !health.json || !health.json.ok) {
    console.error(`无法连接平台：${BASE}/api/health → ${health.status} ${health.raw}`);
    process.exit(2);
  }
  log(`平台版本 ${health.json.data.version} · 共发现 ${routes.length} 条路由 · 目标 ${BASE}`);
  const ids = await collectIds();
  await sweepRoutes(ids);
  const degrade = await checkDegrade();
  results.push(...degrade.map((d) => ({ ...d, degrade: true })));
  if (FULL) results.push(...await crud());

  const counted = results.filter((r) => r.status !== 'SKIP');
  const server500 = counted.filter((r) => r.status === 500);
  const timeouts = counted.filter((r) => r.status === 'TIMEOUT');
  const upstream502 = counted.filter((r) => r.status === 502);
  const client4xx = counted.filter((r) => Number(r.status) >= 400 && Number(r.status) < 500);
  const ok200 = counted.filter((r) => r.status === 200 && r.json && r.json.ok);
  const badDegrade = degrade.filter((d) => !d.acceptable);
  const badPayload = counted.filter((r) => r.status !== 'TIMEOUT' && Number(r.status) >= 400
    && (!r.json || r.json.ok !== false || typeof r.json.status !== 'number'));

  if (AS_JSON) {
    console.log(JSON.stringify({
      base: BASE, version: health.json.data.version, total: routes.length,
      checked: counted.length, ok200: ok200.length, client4xx: client4xx.length,
      upstream502: upstream502.length, server500: server500.length, timeouts: timeouts.length,
      badDegrade: badDegrade.length, badPayload: badPayload.length,
      failures: [...server500, ...timeouts, ...badDegrade, ...badPayload]
        .map((r) => ({ method: r.method, path: r.path || r.requested, status: r.status,
          error: r.json && r.json.error, raw: r.raw })),
    }, null, 2));
  } else {
    log('\n──────── 汇总 ────────');
    log(`已测 ${counted.length} 项（跳过 ${results.length - counted.length} 个有副作用/长连接路由）`);
    log(`  200 正常        : ${ok200.length}`);
    log(`  4xx 业务错误    : ${client4xx.length}  （参数 / 对象不存在，符合预期）`);
    log(`  502 上游不可用  : ${upstream502.length}  （明确分类，非程序错误）`);
    log(`  500 服务端异常  : ${server500.length}  ← 必须为 0`);
    log(`  超时            : ${timeouts.length}`);
    log(`  降级接口异常    : ${badDegrade.length}`);
    log(`  错误体缺 status : ${badPayload.length}`);
    if (server500.length) {
      log('\n✖ 仍存在 500：');
      server500.forEach((r) => log(`  ${r.method} ${r.requested || r.path} → ${(r.json && r.json.error) || r.raw}`));
    }
    if (badDegrade.length) {
      log('\n✖ 只读列表未正确降级：');
      badDegrade.forEach((r) => log(`  GET ${r.path} → ${r.status} ${(r.json && r.json.error) || r.raw}`));
    }
    if (badPayload.length) {
      log('\n✖ 错误响应缺少结构化 status：');
      badPayload.forEach((r) => log(`  ${r.method} ${r.requested || r.path} → ${r.status}`));
    }
    if (upstream502.length) {
      log('\nℹ 502 明细（外部服务不可用，已带修复提示）：');
      upstream502.slice(0, 25).forEach((r) => log(`  ${r.method} ${r.requested || r.path} → ${String((r.json && r.json.error) || '').slice(0, 90)}`));
    }
  }

  const failed = server500.length || timeouts.length || badDegrade.length || badPayload.length;
  if (!AS_JSON) log(failed ? '\n✖ 巡检未通过' : '\n✔ 巡检通过：无 500、无超时、错误分类与降级均正常');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('巡检脚本异常：', e); process.exit(2); });
