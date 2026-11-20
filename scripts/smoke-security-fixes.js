'use strict';

/**
 * 安全回归用例（v0.4.21）：把「审查发现并已修复」的高危缺陷钉成断言。
 *
 *   node scripts/smoke-security-fixes.js
 *
 * 覆盖：
 *  1) 畸形 Cookie 不得终止进程（P0-1：未捕获 URIError → unhandledRejection）
 *  2) AI 会话 / AI 运维会话的归属校验（P0-2：非 owner 读、改、删、发一律 403）
 *  3) 本地 AI 程序（CLI）执行能力仅管理员（P0-3：普通账号 403）
 *  4) 导入仓库的 .git 配置净化（P0-4：filter/external/hooks/include 全部被丢弃）
 *  5) OpenList 连接切换不得把上一连接的凭据带到新地址（P0-5）
 *  6) 代理脱敏与 NO_PROXY 匹配方向（P1：密码含 @ 不再明文下发；xxx.evil.com 不直连）
 *
 * 全部在临时 DATA_DIR / 独立端口里跑，不触碰仓库的 data/ 与 .env。
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM = path.join(ROOT, 'platform');
const PASSWORD = 'Passw0rd!smoke';
let failed = 0;
let passed = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (ok) passed += 1; else failed += 1;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-secfix-'));
const DATA = path.join(TMP, 'data');
const WORKSPACE = path.join(TMP, 'workspace');
const ENVFILE = path.join(TMP, '.env');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(WORKSPACE, { recursive: true });
fs.writeFileSync(ENVFILE, 'DP_AUTH_MODE=required\n', 'utf8');

const hash = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};

fs.writeFileSync(path.join(DATA, 'state.json'), JSON.stringify({
  users: [
    { id: 'usr_admin', username: 'admin', displayName: 'admin', role: 'admin', status: 'active', passwordHash: hash(PASSWORD), mustChangePassword: false, createdAt: new Date().toISOString() },
    { id: 'usr_alice', username: 'alice', displayName: 'alice', role: 'user', status: 'active', passwordHash: hash(PASSWORD), mustChangePassword: false, createdAt: new Date().toISOString() },
    { id: 'usr_bob', username: 'bob', displayName: 'bob', role: 'user', status: 'active', passwordHash: hash(PASSWORD), mustChangePassword: false, createdAt: new Date().toISOString() },
  ],
  aiChats: [{
    id: 'ach_victim', ownerId: 'usr_alice', title: 'alice 的私有会话', providerId: '', model: '',
    messages: [{ role: 'user', content: 'ALICE_SECRET_12345', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }],
  aiSessions: [{
    id: 'ais_victim', ownerId: 'usr_alice', title: 'alice 的运维会话', serverScope: [],
    messages: [{ role: 'user', content: 'ALICE_OPS_SECRET', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }],
  // 有归属记录的仓库：id 里没有下划线，正是旧实现「id 必须含 _」筛掉的形态。
  repoAcl: [{
    id: 'workspace:shared-repo', name: 'shared-repo', aclKind: 'repo',
    ownerId: 'usr_alice', collaborators: [], createdAt: new Date().toISOString(),
  }],
  servers: [{
    id: 'srv_secret', name: 'alice-host', host: '127.0.0.1', port: 1,
    username: 'root', ownerId: 'usr_alice', createdAt: new Date().toISOString(),
  }],
}, null, 2));

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, child) {
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`服务进程提前退出（exit ${child.exitCode}）`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(150);
  }
  return false;
}

async function login(base, username) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`登录失败 ${username}: HTTP ${r.status} ${await r.text()}`);
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const session = cookies.map((c) => String(c).split(';')[0]).find((c) => c.startsWith('dp_session='));
  if (!session) throw new Error(`登录响应没有 dp_session：${cookies.join(' | ')}`);
  return session;
}

async function call(base, cookie, method, apiPath, body) {
  const init = { method, headers: {} };
  if (cookie) init.headers.cookie = cookie;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${base}/api${apiPath}`, init);
  let json = null;
  try { json = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, json };
}

/* --------------------------- 单元级断言（子进程） --------------------------- */
function runUnitChecks() {
  const unitData = path.join(TMP, 'data-unit');
  fs.mkdirSync(unitData, { recursive: true });
  fs.writeFileSync(path.join(unitData, 'state.json'), JSON.stringify({
    users: [{ id: 'usr_admin', username: 'admin', role: 'admin', status: 'active' }],
    openlistConnections: [
      { id: 'env-default', label: '本机', url: 'http://good.local:5244', user: 'admin', token: 'ADMIN_TOKEN_XYZ', password: 'ADMIN_PW', source: 'env' },
      { id: 'olconn_evil', label: 'evil', url: 'http://evil.example:5244', user: 'admin', token: '', password: '', source: 'panel' },
    ],
    openlistActiveId: 'olconn_evil',
  }, null, 2));

  const unit = `
    const fs = require('fs');
    const path = require('path');
    const P = ${JSON.stringify(PLATFORM)};
    (async () => {
    const out = {};
    const core = require(path.join(P, 'src', 'core'));
    // --- P0-5：切换到「没有凭据的攻击者连接」时，不得沿用上一连接的 token / 密码
    const openlist = require(path.join(P, 'src', 'openlist'));
    openlist.applyConfig();
    out.evil = { url: core.config.openlistUrl, token: core.config.openlistToken, password: core.config.openlistPassword };
    core.update((s) => { s.openlistActiveId = 'env-default'; });
    openlist.applyConfig();
    out.good = { url: core.config.openlistUrl, token: core.config.openlistToken, password: core.config.openlistPassword };
    // --- P1：代理脱敏与 NO_PROXY 匹配方向
    const proxy = require(path.join(P, 'src', 'proxy'));
    out.masked = proxy.maskUrl('http://user:P@ssw0rd@proxy.local:7890');
    out.maskedPlain = proxy.maskUrl('http://user:secret@proxy.local:7890');
    out.bypassEvil = proxy.shouldBypass('http://localhost.evil.com/x', 'localhost,127.0.0.1');
    out.bypassGitEvil = proxy.shouldBypass('http://github.com.evil.com/x', 'github.com');
    out.bypassSelf = proxy.shouldBypass('http://127.0.0.1:9000/api', 'localhost,127.0.0.1');
    out.bypassV6 = proxy.shouldBypass('http://[::1]:9000/api', '::1');
    // --- P0-4：导入仓库的 .git 配置净化
    const target = path.join(${JSON.stringify(TMP)}, 'sani-repo');
    fs.mkdirSync(path.join(target, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(target, '.git', 'config'), [
      '[core]',
      '\\trepositoryformatversion = 0',
      '\\tbare = false',
      '\\tfsmonitor = evil-fsmonitor',
      '\\thooksPath = /tmp/evil-hooks',
      '[filter "evil"]',
      '\\tsmudge = sh -c "touch pwned"',
      '[diff]',
      '\\texternal = sh -c "touch pwned"',
      '[include]',
      '\\tpath = /etc/passwd',
      '[remote "origin"]',
      '\\turl = ext::sh -c "touch pwned"',
      '\\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[branch "main"]',
      '\\tremote = origin',
      '\\tmerge = refs/heads/main',
      '[safe]',
      '\\tdirectory = *',
      ''
    ].join('\\n'));
    fs.writeFileSync(path.join(target, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\\ntouch pwned\\n');
    const importer = require(path.join(P, 'src', 'repoImporter'));
    out.sanitize = importer.sanitizeImportedGit(target);
    out.sanitizedConfig = fs.readFileSync(path.join(target, '.git', 'config'), 'utf8');
    out.hooksLeft = fs.readdirSync(path.join(target, '.git', 'hooks'));

    // --- P1：workspaceGit 必须拒绝 --no-index / --file 这类「读工作区外文件」的选项
    const wsRepo = path.join(${JSON.stringify(WORKSPACE)}, 'repo-x');
    fs.mkdirSync(path.join(wsRepo, '.git', 'objects'), { recursive: true });
    fs.mkdirSync(path.join(wsRepo, '.git', 'refs'), { recursive: true });
    fs.writeFileSync(path.join(wsRepo, '.git', 'HEAD'), 'ref: refs/heads/main\\n');
    const wgit = require(path.join(P, 'src', 'workspaceGit'));
    try {
      await wgit.run({ repo: 'repo-x', command: 'diff', args: ['--no-index', '/etc/passwd', '/tmp/empty'] });
      out.noIndexBlocked = false;
    } catch (e) { out.noIndexBlocked = e.status === 400; out.noIndexMsg = String(e.message || e).slice(0, 120); }

    // --- P1：dsh 终端的跨帧行切分（一帧可能是半行；多字节字符可能被拆开）
    const dsh = require(path.join(P, 'src', 'dshTerminal'));
    const lines = [];
    const splitter = dsh.createLineSplitter((l) => lines.push(l));
    const payload = Buffer.from(JSON.stringify({ type: 'text', text: '你好，世界' }) + '\\n', 'utf8');
    splitter.push(payload.subarray(0, 9));
    splitter.push(payload.subarray(9, 17));
    splitter.push(payload.subarray(17));
    splitter.push(Buffer.from('{"type":"final","text":"tail"}', 'utf8')); // 无换行结尾
    splitter.flush();
    out.dshLines = lines;

    process.stdout.write(JSON.stringify(out));
    })().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
  `;

  const r = spawnSync(process.execPath, ['-e', unit], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      DATA_DIR: unitData,
      WORKSPACE_DIR: WORKSPACE,
      DP_ENV_FILE: ENVFILE,
      OPENLIST_URL: 'http://good.local:5244',
      OPENLIST_TOKEN: 'ADMIN_TOKEN_XYZ',
      OPENLIST_PASSWORD: 'ADMIN_PW',
    },
  });
  if (r.status !== 0) {
    check(false, '单元断言脚本执行', String(r.stderr || r.stdout || '').slice(0, 400));
    return;
  }
  let out;
  try { out = JSON.parse(r.stdout); } catch {
    check(false, '单元断言脚本输出可解析', String(r.stdout).slice(0, 300));
    return;
  }

  // P0-5
  check(out.evil.url === 'http://evil.example:5244', 'OpenList：切换到攻击者地址后 URL 生效', out.evil.url);
  check(out.evil.token === '', 'OpenList：攻击者连接没有 token → 不沿用管理员 token', JSON.stringify(out.evil.token));
  check(out.evil.password === '', 'OpenList：攻击者连接没有密码 → 不沿用管理员密码', JSON.stringify(out.evil.password));
  check(out.good.token === 'ADMIN_TOKEN_XYZ' && out.good.password === 'ADMIN_PW',
    'OpenList：同地址连接仍可回退到 .env 凭据（原行为保留）', `${out.good.token}/${out.good.password}`);

  // P1 脱敏 & NO_PROXY
  check(!out.masked.includes('P@ssw0rd') && !out.masked.includes('P%40ssw0rd') && out.masked.includes('******'),
    '代理脱敏：密码含 @ 不再明文下发', out.masked);
  check(!out.maskedPlain.includes('secret') && out.maskedPlain.includes('******'),
    '代理脱敏：普通密码仍然脱敏', out.maskedPlain);
  check(out.bypassEvil === false, 'NO_PROXY：localhost.evil.com 不再被 localhost 放行', String(out.bypassEvil));
  check(out.bypassGitEvil === false, 'NO_PROXY：github.com.evil.com 不再被 github.com 放行', String(out.bypassGitEvil));
  check(out.bypassSelf === true, 'NO_PROXY：本机地址仍然直连', String(out.bypassSelf));
  check(out.bypassV6 === true, 'NO_PROXY：IPv6 [::1] 能命中 ::1', String(out.bypassV6));

  // P0-4
  const cfg = String(out.sanitizedConfig || '');
  const droppedKeys = ['smudge', 'external', 'fsmonitor', 'hooksPath', 'include', 'ext::'];
  const stillThere = droppedKeys.filter((k) => cfg.toLowerCase().includes(k.toLowerCase()));
  check(stillThere.length === 0, '.git 配置净化：危险键全部丢弃', stillThere.join(',') || '无残留');
  check(cfg.includes('repositoryformatversion') && cfg.includes('[branch "main"]') && cfg.includes('refs/heads/main'),
    '.git 配置净化：保留 core / branch 等数据描述键');
  check(Array.isArray(out.hooksLeft) && out.hooksLeft.length === 0, '.git 配置净化：自带 hooks 已清除', JSON.stringify(out.hooksLeft));

  // P1：workspaceGit 选项黑名单
  check(out.noIndexBlocked === true, 'Git 参数校验：--no-index 读工作区外文件被拒', String(out.noIndexMsg || ''));

  // P1：dsh 跨帧行切分
  const dshLines = Array.isArray(out.dshLines) ? out.dshLines : [];
  check(dshLines.length === 2, 'AI 终端：跨帧的半行被拼成完整事件（不丢事件）', `lines=${dshLines.length}`);
  let parsedOk = false;
  try { parsedOk = JSON.parse(dshLines[0] || '{}').text === '你好，世界'; } catch { parsedOk = false; }
  check(parsedOk, 'AI 终端：跨帧多字节字符正确还原', String(dshLines[0] || '').slice(0, 60));
  check(String(dshLines[1] || '').includes('tail'), 'AI 终端：结尾无换行的最后一行被 flush', String(dshLines[1] || '').slice(0, 60));
}

/* --------------------------------- 主流程 --------------------------------- */
(async () => {
  let child = null;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
      cwd: PLATFORM,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: DATA,
        WORKSPACE_DIR: WORKSPACE,
        PUBLIC_DIR: path.join(PLATFORM, 'public'),
        DP_AUTH_MODE: 'required',
        DP_ENV_FILE: ENVFILE,
        GITEA_URL: 'http://127.0.0.1:1',
        OPENLIST_URL: 'http://127.0.0.1:1',
        CODE_SERVER_URL: 'http://127.0.0.1:1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    child.stdout.on('data', (c) => { serverLog += c.toString(); });
    child.stderr.on('data', (c) => { serverLog += c.toString(); });

    if (!(await waitHealthy(base, child))) {
      check(false, '平台进程启动并健康检查通过', serverLog.slice(-500));
      return;
    }
    check(true, '平台进程启动并健康检查通过', `port=${port}`);

    const admin = await login(base, 'admin');
    const alice = await login(base, 'alice');
    const bob = await login(base, 'bob');
    check(Boolean(admin && alice && bob), '三个测试账号登录成功');

    /* ---- P0-1：畸形 Cookie 不得打挂进程 ---- */
    for (const bad of ['dp_session=%', 'dp_session=%E0%A4', 'dp_session=%ZZ']) {
      let status = 0;
      try {
        const r = await fetch(`${base}/api/health`, { headers: { cookie: bad } });
        status = r.status;
      } catch (e) {
        status = -1;
      }
      const alive = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      check(status === 200 && alive, `畸形 Cookie 不影响进程：${bad}`, `status=${status} alive=${alive}`);
      if (!alive) break;
    }
    const afterBad = await call(base, 'dp_session=%', 'GET', '/auth/status');
    check(afterBad.status === 200 && afterBad.json && afterBad.json.data && afterBad.json.data.authenticated === false,
      '畸形 Cookie 被当作未登录（状态接口 200 / authenticated=false）', `status=${afterBad.status}`);
    check(child.exitCode === null, '畸形 Cookie 之后服务进程仍然存活', `exitCode=${child.exitCode}`);

    /* ---- P2：公开路径白名单里的 GET /api/auth/2fa 不能再 500 ---- */
    const anon2fa = await fetch(`${base}/api/auth/2fa`);
    check(anon2fa.status === 401, '二次验证状态：匿名访问返回 401（不再 500）', `status=${anon2fa.status}`);
    const bob2fa = await call(base, bob, 'GET', '/auth/2fa');
    check(bob2fa.status === 200 && bob2fa.json && bob2fa.json.ok === true, '二次验证状态：已登录可读（未误伤）', `status=${bob2fa.status}`);

    /* ---- P0-2：AI 会话归属 ---- */
    const bobChat = await call(base, bob, 'GET', '/ai/chats/ach_victim');
    check(bobChat.status === 403, 'AI 会话：非 owner 读详情被拒', `status=${bobChat.status}`);
    const bobChatSend = await call(base, bob, 'POST', '/ai/chats/ach_victim/send', { content: 'hi' });
    check(bobChatSend.status === 403, 'AI 会话：非 owner 发消息被拒', `status=${bobChatSend.status}`);
    const bobChatDel = await call(base, bob, 'DELETE', '/ai/chats/ach_victim');
    check(bobChatDel.status === 403, 'AI 会话：非 owner 删除被拒', `status=${bobChatDel.status}`);
    const aliceChat = await call(base, alice, 'GET', '/ai/chats/ach_victim');
    check(aliceChat.status === 200 && JSON.stringify(aliceChat.json).includes('ALICE_SECRET_12345'),
      'AI 会话：owner 正常读取（未被误伤）', `status=${aliceChat.status}`);

    const bobOps = await call(base, bob, 'GET', '/ai/sessions/ais_victim');
    check(bobOps.status === 403, 'AI 运维会话：非 owner 读详情被拒', `status=${bobOps.status}`);
    const bobOpsDel = await call(base, bob, 'DELETE', '/ai/sessions/ais_victim');
    check(bobOpsDel.status === 403, 'AI 运维会话：非 owner 删除被拒', `status=${bobOpsDel.status}`);
    const aliceOps = await call(base, alice, 'GET', '/ai/sessions/ais_victim');
    check(aliceOps.status === 200, 'AI 运维会话：owner 正常读取（未被误伤）', `status=${aliceOps.status}`);

    /* ---- P0-3：本地 CLI 执行仅管理员 ---- */
    const cliPayload = { command: 'custom', customCommand: 'cmd.exe', extraArgs: '/c', prompt: 'echo pwned' };
    const bobLocal = await call(base, bob, 'POST', '/ai/local/test', cliPayload);
    check(bobLocal.status === 403, '本地 AI 程序：普通账号调用 /ai/local/test 被拒', `status=${bobLocal.status}`);
    const bobTest = await call(base, bob, 'POST', '/ai/test', { kind: 'cli', ...cliPayload });
    check(bobTest.status === 403, '本地 AI 程序：普通账号调用 /ai/test 被拒', `status=${bobTest.status}`);
    const bobProvider = await call(base, bob, 'POST', '/ai/providers', {
      name: 'evil', kind: 'cli', command: 'custom', customCommand: 'cmd.exe', extraArgs: '/c',
    });
    check(bobProvider.status === 403, '本地 AI 程序：普通账号不能登记 cli 类型服务', `status=${bobProvider.status}`);
    const bobPrograms = await call(base, bob, 'GET', '/ai/local/programs');
    check(bobPrograms.status === 403, '本地 AI 程序：普通账号不能探测宿主机程序', `status=${bobPrograms.status}`);
    const adminProvider = await call(base, admin, 'POST', '/ai/providers', {
      name: 'admin-cli', kind: 'cli', command: 'custom', customCommand: 'codex', extraArgs: '',
    });
    check(adminProvider.status === 200, '本地 AI 程序：管理员仍可登记（未误伤）', `status=${adminProvider.status}`);

    /* ---- P1-1：OpenList 后台入口仅管理员 ---- */
    const bobAdmin = await call(base, bob, 'GET', '/openlist/admin');
    check(bobAdmin.status === 403, 'OpenList 后台：普通账号被拒（不再下发管理员 token）', `status=${bobAdmin.status}`);
    const bobAdminApi = await call(base, bob, 'GET', '/openlist/admin/api/admin/storage/list');
    check(bobAdminApi.status === 403, 'OpenList 后台 API：普通账号 GET 也被拒', `status=${bobAdminApi.status}`);

    /* ---- P1：仓库归属（id 不含下划线也必须生效） ---- */
    const bobMeta = await call(base, bob, 'PUT', '/repos/meta', { id: 'workspace:shared-repo', description: 'hacked' });
    check(bobMeta.status === 403, '仓库归属：非 owner 不能改仓库展示信息', `status=${bobMeta.status}`);
    const aliceMeta = await call(base, alice, 'PUT', '/repos/meta', { id: 'workspace:shared-repo', description: 'ok' });
    check(aliceMeta.status === 200, '仓库归属：owner 可改（未误伤）', `status=${aliceMeta.status}`);
    const bobRemove = await call(base, bob, 'POST', '/repos/remove', { id: 'workspace:shared-repo' });
    check(bobRemove.status === 403, '仓库归属：非 owner 不能移除有 ACL 的仓库', `status=${bobRemove.status}`);
    const bobPurge = await call(base, bob, 'POST', '/repos/remove', { id: 'workspace:shared-repo', purgeWorkspace: true });
    check(bobPurge.status === 403, '仓库归属：非 owner 不能连带删除工作区目录', `status=${bobPurge.status}`);
    const aliceRemove = await call(base, alice, 'POST', '/repos/remove', { id: 'workspace:shared-repo' });
    check(aliceRemove.status === 200, '仓库归属：owner 可移除（未误伤）', `status=${aliceRemove.status}`);

    /* ---- P1：Docker / 远程面板的 target 参与归属校验 ---- */
    const bobDocker = await call(base, bob, 'GET', '/docker/overview?target=server:srv_secret');
    check(bobDocker.status === 403, 'Docker 目标：普通账号不能操作他人服务器的 target', `status=${bobDocker.status}`);
    const bobDockerDel = await call(base, bob, 'DELETE', '/docker/containers/deadbeef?target=server:srv_secret&confirm=true');
    check(bobDockerDel.status === 403, 'Docker 目标：普通账号不能删他人服务器上的容器', `status=${bobDockerDel.status}`);
    const aliceDocker = await call(base, alice, 'GET', '/docker/overview?target=server:srv_secret');
    check(aliceDocker.status !== 403, 'Docker 目标：owner 不被归属校验拦下（未误伤）', `status=${aliceDocker.status}`);

    check(child.exitCode === null, '全部 HTTP 用例结束后进程仍存活', `exitCode=${child.exitCode}`);
  } catch (e) {
    check(false, '用例执行异常', String((e && e.message) || e));
  } finally {
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* noop */ }
    }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
  }

  runUnitChecks();

  console.log(`\n${failed === 0 ? '✔ 安全回归全部通过' : '✘ 有失败项'} · ${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
