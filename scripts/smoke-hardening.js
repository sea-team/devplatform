'use strict';

/**
 * 硬化回归（v0.4.23）：把三项产品决策落地的修复钉成断言。
 *   A) AI baseURL 属地分级（SSRF）：私网仅管理员、公网都可用；
 *   B) 2FA 账号级限速：连续错误动态码触发 429；
 *   C) CLI 共享密钥：配置 DP_CLI_SECRET 后必须带 x-dp-cli-key。
 *
 * 用法：node scripts/smoke-hardening.js
 * 全部在临时 DATA_DIR / 独立端口跑，不触碰仓库 data/ 与 .env。
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM = path.join(ROOT, 'platform');
const PASSWORD = 'Passw0rd!harden';
let failed = 0;
let passed = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (ok) passed += 1; else failed += 1;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-harden-'));
const hash = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
async function waitHealthy(base, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`服务进程提前退出（exit ${child.exitCode}）`);
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* 未就绪 */ }
    await sleep(150);
  }
  return false;
}

async function req(base, method, apiPath, { cookie, headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(`${base}/api${apiPath}`, init);
  let json = null; try { json = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, json };
}
function stateFixture(with2fa) {
  const users = [
    { id: 'usr_admin', username: 'admin', displayName: 'admin', role: 'admin', status: 'active', passwordHash: hash(PASSWORD), mustChangePassword: false, createdAt: new Date().toISOString() },
    { id: 'usr_user', username: 'user', displayName: 'user', role: 'user', status: 'active', passwordHash: hash(PASSWORD), mustChangePassword: false, createdAt: new Date().toISOString() },
  ];
  if (with2fa) {
    // 复用真实 TOTP 密钥：随便一个 base32，测试只关心「错误码连续失败触发限速」。
    users[1].totpSecret = 'JBSWY3DPEHPK3PXP';
    users[1].totpEnabled = true;
    users[1].totpRecovery = [];
  }
  return JSON.stringify({ users }, null, 2);
}

async function startServer({ with2fa = false, cliSecret = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'inst-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'state.json'), stateFixture(with2fa));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, `DP_AUTH_MODE=required\n${cliSecret ? `DP_CLI_SECRET=${cliSecret}\n` : ''}`);
  const port = await freePort();
  const env = {
    ...process.env, DATA_DIR: data, PORT: String(port), DP_AUTH_MODE: 'required',
    ...(cliSecret ? { DP_CLI_SECRET: cliSecret } : {}),
  };
  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    cwd: PLATFORM, env, stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  await waitHealthy(base, child);
  return { base, child, dir, data };
}

async function stopServer(inst) {
  if (inst && inst.child && inst.child.exitCode === null) { try { inst.child.kill(); } catch { /* noop */ } }
}

(async () => {
  const children = [];
  try {
    /* ---------- A. SSRF 属地分级（单元） ---------- */
    const policy = require(path.join(PLATFORM, 'src', 'aiNetworkPolicy'));
    const deny = (url, role) => { try { policy.assertAllowed(url, { role }); return 'allow'; } catch (e) { return e.status; } };
    check(policy.classify('https://api.openai.com') === 'public', 'A: 公网地址分类为 public');
    check(policy.classify('http://127.0.0.1:11434') === 'private', 'A: 本机 Ollama 分类为 private');
    check(policy.classify('http://169.254.169.254') === 'private', 'A: 云元数据地址分类为 private');
    check(deny('http://127.0.0.1:11434', 'user') === 403, 'A: 普通账号配私网地址被拒 403');
    check(deny('http://127.0.0.1:11434', 'admin') === 'allow', 'A: 管理员可配本机 Ollama');
    check(deny('https://api.openai.com', 'user') === 'allow', 'A: 普通账号可配公网地址');

    /* ---------- C. CLI 共享密钥（两个服务实例） ---------- */
    // C1: 未配置密钥 —— 旧行为（回环 + x-dp-cli:1）可用
    const noSecret = await startServer({});
    children.push(noSecret);
    const c1 = await req(noSecret.base, 'POST', '/auth/reset-password',
      { headers: { 'x-dp-cli': '1' }, body: { username: 'admin' } });
    check(c1.status === 200, 'C: 未配置密钥时 CLI 通道保持兼容');

    // C2: 配置密钥 —— 缺 key 被拒 403，带对 key 成功
    const SECRET = 's3cr3t-cli-key-xyz';
    const withSecret = await startServer({ cliSecret: SECRET });
    children.push(withSecret);
    const c2missing = await req(withSecret.base, 'POST', '/auth/reset-password',
      { headers: { 'x-dp-cli': '1' }, body: { username: 'admin' } });
    check(c2missing.status === 401 || c2missing.status === 403, `C: 配置密钥后缺 x-dp-cli-key 被拒（HTTP ${c2missing.status}）`);
    const c2wrong = await req(withSecret.base, 'POST', '/auth/reset-password',
      { headers: { 'x-dp-cli': '1', 'x-dp-cli-key': 'wrong' }, body: { username: 'admin' } });
    check(c2wrong.status === 401 || c2wrong.status === 403, `C: 密钥错误被拒（HTTP ${c2wrong.status}）`);
    const c2ok = await req(withSecret.base, 'POST', '/auth/reset-password',
      { headers: { 'x-dp-cli': '1', 'x-dp-cli-key': SECRET }, body: { username: 'admin' } });
    check(c2ok.status === 200, 'C: 携带正确密钥 CLI 通道可用');

    /* ---------- B. 2FA 账号级限速（HTTP 端到端） ---------- */
    // 用带 2FA 的 user 登录拿到 totpToken，连续错误码应触发 429（账号级）。
    const twofa = await startServer({ with2fa: true });
    children.push(twofa);
    const step1 = await req(twofa.base, 'POST', '/auth/login', { body: { username: 'user', password: PASSWORD } });
    check(step1.status === 200 && step1.json.data.requiresTwoFactor, 'B: 带 2FA 账号登录返回挑战令牌');
    const totpToken = step1.json.data.totpToken;
    let hit429 = false;
    for (let i = 0; i < 7; i += 1) {
      const r = await req(twofa.base, 'POST', '/auth/2fa', { body: { totpToken, method: 'totp', code: '000000' } });
      if (r.status === 429) { hit429 = true; break; }
    }
    check(hit429, 'B: 连续错误动态码触发 429（账号级限速生效）');
  } catch (e) {
    check(false, '硬化回归执行异常', String((e && e.stack) || e));
  } finally {
    for (const c of children) await stopServer(c);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
  }
  console.log(`\n${failed === 0 ? '✔ 硬化回归全部通过' : '✘ 有失败项'} · ${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
