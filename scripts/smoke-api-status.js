'use strict';

/**
 * v0.3.5 专项冒烟：API 错误分类与只读列表降级。
 *
 * 分两段，均不依赖外部网络 / Docker / 真实的 OpenList：
 *  A) core.js 纯函数：HttpError / inferStatus / fail() 结构化输出；
 *  B) 拉起真实 server.js（把 OpenList / Gitea 指向不可达地址），验证
 *     只读列表 200 + degraded、写操作 502、参数错误 400、对象不存在 404，
 *     且所有错误响应都带 status 字段。
 *
 *   node scripts/smoke-api-status.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const PLATFORM = path.resolve(__dirname, '..', 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-api-status-smoke-'));
const errors = [];
let passed = 0;
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (ok) passed += 1; else errors.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

/* ---------------- A. 错误模型纯函数 ---------------- */
function testCore() {
  const core = require(path.join(PLATFORM, 'src', 'core.js'));
  const cases = [
    ['缺少参数：name', 400], ['请填写源名称', 400], ['请填写模板名称与内容', 400],
    ['未配置凭据', 400], ['删除镜像需要二次确认', 400], ['内置 Gitea 源不可删除', 400],
    ['构建记录不存在', 404], ['服务器不存在', 404], ['未知环境档案：x', 404],
    ['No such container: abc', 404],
    ['OpenList /api/fs/list 返回 code=500：record not found', 502],
    ['无法连接 Docker：connect ENOENT', 502], ['上游服务 HTTP 503: down', 502],
    ['fetch failed', 502],
    // v0.3.6：代理/隧道探测的网络层失败不是程序异常，必须是 502。
    ['直连超时：https://github.com', 502],
    ['直连失败（ECONNREFUSED）：https://example.com', 502],
    ['代理隧道建立失败（connect ETIMEDOUT）', 502],
    ['The operation was aborted due to timeout', 502],
    ['connect ENOTFOUND github.com', 502],
    // v0.3.12：请求体解析 / 业务校验 / 上游失败不再是 500
    ['请求体不是合法 JSON', 400], ['请求体过大', 413],
    ['当前未设置 ADMIN_TOKEN，仅允许只读诊断命令', 403],
    ['命令不在只读白名单内', 403], ['未授权写操作', 403],
    ['端口 3000 已被同一目标上的另一个扩展实例占用', 409],
    ['docker load 失败：unexpected EOF', 502],
    ['AI 服务返回内容不是合法 JSON', 502],
    ['AI 服务自定义 Headers 不是合法 JSON', 400],
    ['路径含非法字符', 400], ['请选择镜像 tar 文件', 400],
    ['找不到对应的恢复模板', 404],
    ['Unexpected token in JSON', 500], // 真·代码异常必须仍是 500
  ];
  for (const [msg, want] of cases) {
    const got = core.inferStatus(new Error(msg));
    note(got === want, `错误归类 ${want}：${msg.slice(0, 34)}`, String(got));
  }

  const bad = core.badRequest('参数不对');
  const missing = core.notFound('对象不存在');
  const up = core.upstream('上游挂了', { hint: '去检查服务' });
  note(bad.status === 400 && bad instanceof Error, 'badRequest() 生成 400 HttpError');
  note(missing.status === 404, 'notFound() 生成 404 HttpError');
  note(up.status === 502 && up.upstream === true && up.errorCode === 'UPSTREAM_UNAVAILABLE'
    && up.hint === '去检查服务', 'upstream() 带 502 / upstream 标记 / 修复提示');

  const mockRes = () => {
    const r = { statusCode: 200, payload: null };
    r.status = (code) => { r.statusCode = code; return r; };
    r.json = (payload) => { r.payload = payload; return r; };
    return r;
  };
  let res = mockRes();
  core.fail(res, up);
  note(res.statusCode === 502 && res.payload.ok === false && res.payload.status === 502
    && res.payload.code === 'UPSTREAM_UNAVAILABLE' && res.payload.hint === '去检查服务',
  'fail() 输出结构化 status / code / hint');
  res = mockRes();
  core.fail(res, '构建记录不存在', 404);
  note(res.statusCode === 404 && res.payload.status === 404, 'fail() 显式 code 优先于消息推断');
  res = mockRes();
  core.fail(res, new Error('请填写名称'));
  note(res.statusCode === 400, 'wrap 链上的普通 Error 也能推断成 400');
}

/* ---------------- B. 真实服务的降级与分类 ---------------- */
async function startServer(port) {
  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: TMP, ADMIN_TOKEN: '', DP_AUTH_MODE: 'off',
      GITEA_URL: 'http://127.0.0.1:1', GITEA_TOKEN: '',
      OPENLIST_URL: 'http://127.0.0.1:1', OPENLIST_TOKEN: '', OPENLIST_PASSWORD: '',
      CODE_SERVER_URL: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c.toString(); });
  child.stderr.on('data', (c) => { log += c.toString(); });
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.status === 200) return { child, log };
    } catch { /* 等待监听 */ }
    if (child.exitCode !== null) break;
    await sleep(150);
  }
  child.kill();
  throw new Error(`服务未启动：${log.slice(-500)}`);
}

async function testServer() {
  const port = await freePort();
  const { child } = await startServer(port);
  const base = `http://127.0.0.1:${port}/api`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, json };
  };

  try {
    const health = await call('GET', '/health');
    note(health.status === 200 && health.json.ok, '服务正常启动，/api/health 可用');
    // 版本号统一以 package.json 为准，避免每次发版都要改测试里的硬编码。
    const pkgVersion = require(path.join(PLATFORM, 'package.json')).version;
    note(health.json.data.version === pkgVersion,
      `源码模式版本号与 package.json 一致（${pkgVersion}）`, health.json.data.version);

    const degraded = [
      ['/openlist/storages', 'items'], ['/openlist/drivers', 'items'],
      ['/openlist/settings', 'items'], ['/openlist/files?path=/', 'content'],
      ['/storage', 'content'], ['/storage/mounts', 'items'],
    ];
    for (const [p, field] of degraded) {
      const r = await call('GET', p);
      const d = r.json && r.json.data;
      note(r.status === 200 && r.json.ok && d && d.degraded === true
        && Array.isArray(d[field]) && Boolean(d.error) && Boolean(d.hint),
      `上游不可用时 GET ${p} 降级为 200 + 空数据 + 诊断`, String(r.status));
    }

    const write = await call('POST', '/openlist/storages/reload', {});
    note(write.status === 502 && write.json.status === 502 && Boolean(write.json.hint),
      '写操作不静默降级，明确返回 502 + 修复提示', String(write.status));

    const badBody = await call('POST', '/repos/clone', {});
    note(badBody.status === 400 && badBody.json.status === 400,
      '参数缺失归类为 400', String(badBody.status));
    const noBuild = await call('GET', '/builds/__nope__');
    note(noBuild.status === 404 && noBuild.json.status === 404,
      '对象不存在归类为 404', String(noBuild.status));

    const samples = [write, badBody, noBuild];
    note(samples.every((r) => r.json && r.json.ok === false && typeof r.json.error === 'string'
      && typeof r.json.status === 'number'),
    '所有错误响应都带 ok / error / status 结构化字段');
  } finally {
    child.kill();
    await sleep(200);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** v0.3.6：连通性探测失败也要带结构化提示，且不能回退成 500。 */
async function testProxyProbe() {
  const core = require(path.join(PLATFORM, 'src', 'core.js'));
  const proxy = require(path.join(PLATFORM, 'src', 'proxy.js'));
  try {
    // 127.0.0.1:1 必定拒绝连接，不依赖外网，也不需要等待超时。
    await proxy.testProxy('', 'http://127.0.0.1:1');
    note(false, '探测不可达目标应抛出错误');
  } catch (e) {
    note(core.inferStatus(e) === 502, '探测失败归类 502 而非 500', String(core.inferStatus(e)));
    note(e.errorCode === 'PROXY_TARGET_UNREACHABLE' && Boolean(e.hint),
      '探测失败带 errorCode 与修复提示', e.errorCode || '');
  }
}

(async () => {
  testCore();
  await testProxyProbe();
  await testServer();
  console.log(`\n${errors.length ? `✖ ${errors.length} 项检查未通过` : `✔ ${passed} 项检查全部通过`}`);
  if (errors.length) { errors.forEach((e) => console.log(`   - ${e}`)); process.exitCode = 1; }
})().catch((e) => { console.error('冒烟异常：', e); process.exitCode = 1; });
