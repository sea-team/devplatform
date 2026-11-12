'use strict';

/**
 * 账号体系冒烟（v0.4.0）：未登录拦截、初始管理员、改密、账号管理、
 * owner 隔离、协作者 read/write、管理员全权、全局配置只读、令牌通道与 off 回退。
 *
 * 用法：node scripts/smoke-auth.js
 * 只用一个临时 DATA_DIR 起本地服务，结束自动清理，不碰任何真实部署。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CWD = path.join(ROOT, 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-auth-smoke-'));
const PORT = 19000 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'tok_smoke_123';

let pass = 0;
const failures = [];
function check(ok, label, extra = '') {
  if (ok) { pass += 1; console.log(`✔ ${label}${extra ? ` · ${extra}` : ''}`); }
  else { failures.push(label); console.log(`✖ ${label}${extra ? ` · ${extra}` : ''}`); }
}

let child = null;
let logs = '';
function boot(env) {
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: CWD,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { logs += String(d); });
  child.stderr.on('data', (d) => { logs += String(d); });
}

async function waitReady() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* 启动中 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`服务未就绪：${logs.slice(-800)}`);
}

async function call(pathname, opt = {}) {
  const headers = {};
  if (opt.body !== undefined) headers['content-type'] = 'application/json';
  if (opt.cookie) headers.cookie = opt.cookie;
  if (opt.token) headers.authorization = `Bearer ${opt.token}`;
  if (opt.cli) headers['x-dp-cli'] = '1';
  const r = await fetch(`${BASE}${pathname}`, {
    method: opt.method || 'GET', headers,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
  });
  let json = {};
  try { json = await r.json(); } catch { /* 非 JSON 响应 */ }
  return { status: r.status, json, setCookie: r.headers.get('set-cookie') || '' };
}

const cookieOf = (setCookie) => String(setCookie).split(';')[0];

function initialPassword() {
  const file = path.join(TMP, 'initial-admin.txt');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : logs;
  const m = text.match(/初始密码：(\S+)/);
  if (m) return m[1];
  const m2 = text.match(/初始密码见 .*? ：(\S+)/);
  return m2 ? m2[1] : '';
}

async function main() {
  boot({ ADMIN_TOKEN: TOKEN, DP_AUTH_MODE: 'required' });
  await waitReady();

  check((await call('/api/health')).status === 200, '健康检查无需登录');
  const status = await call('/api/auth/status');
  check(status.status === 200 && status.json.data.authenticated === false
    && status.json.data.mode === 'required', '未登录状态可查询且标记为未登录');

  const denied = await call('/api/servers');
  check(denied.status === 401, '未登录访问业务接口返回 401');
  const deniedWrite = await call('/api/servers', { method: 'POST', body: { name: 'x', host: 'x', username: 'x', password: 'x' } });
  check(deniedWrite.status === 401, '未登录写操作同样被拦截');

  const pwd = initialPassword();
  check(Boolean(pwd), '启动时自动生成初始管理员密码');
  const loginBad = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  check(loginBad.status === 401, '错误密码登录失败');

  const login = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: pwd } });
  check(login.status === 200 && Boolean(login.setCookie), '管理员登录成功并下发会话 Cookie');
  const adminCookie = cookieOf(login.setCookie);
  check(login.json.data && login.json.data.mustChangePassword === true, '首次登录标记需要改密');

  const change = await call('/api/auth/password', { method: 'POST', cookie: adminCookie,
    body: { oldPassword: pwd, newPassword: 'AdminNewPass_2026' } });
  check(change.status === 200, '管理员修改初始密码成功');

  const login2 = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'AdminNewPass_2026' } });
  check(login2.status === 200 && login2.json.data.mustChangePassword === false, '新密码可登录且不再强制改密');
  const admin = cookieOf(login2.setCookie);

  const u1 = await call('/api/users', { method: 'POST', cookie: admin, body: { username: 'alice', password: 'AlicePass_2026' } });
  const u2 = await call('/api/users', { method: 'POST', cookie: admin, body: { username: 'bob', password: 'BobPass_2026' } });
  check(u1.status === 200 && u2.status === 200, '管理员可创建普通账号');
  check((await call('/api/users', { method: 'POST', cookie: cookieOf((await call('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'AlicePass_2026' } })).setCookie),
    body: { username: 'hacker', password: 'x123456789' } })).status === 403, '普通用户不能创建账号');

  const aliceLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'AlicePass_2026' } });
  const alice = cookieOf(aliceLogin.setCookie);
  const bobLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'BobPass_2026' } });
  const bob = cookieOf(bobLogin.setCookie);

  const mk = (name) => ({ name, host: `${name}.internal`, username: 'root', password: 'x' });
  const a = await call('/api/servers', { method: 'POST', cookie: admin, body: mk('admin-server') });
  const b = await call('/api/servers', { method: 'POST', cookie: alice, body: mk('alice-server') });
  check(a.status === 200 && b.status === 200, '管理员与普通用户都能登记自己的服务器');

  const adminList = await call('/api/servers', { cookie: admin });
  const aliceList = await call('/api/servers', { cookie: alice });
  const bobList = await call('/api/servers', { cookie: bob });
  check((adminList.json.data.items || []).length === 2, '管理员可见所有账号的数据');
  check((aliceList.json.data.items || []).length === 1
    && aliceList.json.data.items[0].name === 'alice-server', '普通用户只见自己添加的数据');
  check((bobList.json.data.items || []).length === 0, '无关账号看不到他人数据');

  const aId = adminList.json.data.items.find((x) => x.name === 'admin-server').id;
  const bId = aliceList.json.data.items[0].id;
  check((await call(`/api/servers/${aId}/test`, { method: 'POST', cookie: alice })).status === 403,
    '派生资源接口同样受隔离约束');

  const collabRead = await call('/api/collaborators', { method: 'PUT', cookie: admin,
    body: { type: 'servers', id: aId, collaborators: [{ userId: u1.json.data.id, permission: 'read' }] } });
  check(collabRead.status === 200, '管理员可为资源添加协作者');
  const aliceAfterRead = await call('/api/servers', { cookie: alice });
  check((aliceAfterRead.json.data.items || []).length === 2, 'read 协作者能查看对应资源');

  const editAsRead = await call('/api/servers', { method: 'POST', cookie: alice,
    body: { ...mk('hacked'), id: aId } });
  check(editAsRead.status === 403, 'read 协作者不能修改资源');
  const delAsRead = await call(`/api/servers/${aId}`, { method: 'DELETE', cookie: alice });
  check(delAsRead.status === 403, 'read 协作者不能删除资源');

  const collabWrite = await call('/api/collaborators', { method: 'PUT', cookie: admin,
    body: { type: 'servers', id: aId, collaborators: [{ userId: u1.json.data.id, permission: 'write' }] } });
  check(collabWrite.status === 200, '协作者权限可升级为 write');
  const editAsWrite = await call('/api/servers', { method: 'POST', cookie: alice,
    body: { ...mk('alice-edit'), id: aId } });
  check(editAsWrite.status === 200, 'write 协作者能修改对应资源');
  check((await call(`/api/servers/${aId}`, { method: 'DELETE', cookie: alice })).status === 403,
    'write 协作者仍不能删除资源');

  const globalWrite = await call('/api/env-config', { method: 'PUT', cookie: alice,
    body: { confirm: true, values: { PORT: '9001' } } });
  check(globalWrite.status === 403, '普通用户不能修改全局配置');
  const globalRead = await call('/api/env-config', { cookie: alice });
  check(globalRead.status === 200, '普通用户可只读查看全局配置');

  const byToken = await call('/api/servers', { token: TOKEN });
  check(byToken.status === 200 && (byToken.json.data.items || []).length >= 2,
    'ADMIN_TOKEN 仍作为管理员/脚本应急通道');
  const byQueryToken = await call(`/api/servers?token=${TOKEN}`);
  check(byQueryToken.status === 200, '?token= 通道同样可用');

  const reset = await call('/api/auth/reset-password', { method: 'POST', cli: true, body: { username: 'bob' } });
  check(reset.status === 200 && Boolean(reset.json.data.password), '本机 CLI 命令可重置管理员/账号密码');
  check((await call('/api/auth/login', { method: 'POST', body: { username: 'bob', password: reset.json.data.password } })).status === 200,
    '重置后的密码可直接登录');
  const resetNoCli = await call('/api/auth/reset-password', { method: 'POST', cookie: alice, body: { username: 'bob' } });
  check(resetNoCli.status === 403, '非管理员、非本机 CLI 不能重置密码');

  // 重置密码会吊销该账号旧会话，重新登录后再验证登出。
  const bobAgain = await call('/api/auth/login', { method: 'POST', body: { username: 'bob', password: reset.json.data.password } });
  const logout = await call('/api/auth/logout', { method: 'POST', cookie: cookieOf(bobAgain.setCookie) });
  check(logout.status === 200, '登出接口可用');

  child.kill();
  await new Promise((r) => setTimeout(r, 250));

  // 回退开关：DP_AUTH_MODE=off 时完全不校验，用于应急排障。
  boot({ ADMIN_TOKEN: '', DP_AUTH_MODE: 'off' });
  await waitReady();
  check((await call('/api/servers')).status === 200, 'DP_AUTH_MODE=off 应急回退可免登录');
  child.kill();

  console.log(`\n账号体系冒烟：${pass} 项通过，${failures.length} 项失败`);
  if (failures.length) {
    console.error(failures.map((x) => `  - ${x}`).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('冒烟异常：', e.stack || e.message);
  console.error(logs.slice(-1200));
  process.exitCode = 1;
}).finally(() => {
  if (child && !child.killed) child.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
});
