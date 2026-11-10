'use strict';

/**
 * v0.3.1 / v0.3.2 冒烟：分层代理 + OpenList 管理 + 账号密码认证 + 多 OpenList 连接。
 * 本机起一个假的 OpenList(AList V3) API、一个假的 HTTP 代理(CONNECT + 绝对 URI 转发)，
 * 再拉起真正的平台 server.js，逐条调用新接口，不依赖任何外部网络或 Docker。
 *
 *   node scripts/smoke-proxy-openlist.js
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PLATFORM = path.resolve(__dirname, '..', 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-v031-smoke-'));
const errors = [];
let passed = 0;
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (ok) passed += 1; else errors.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let olPort = 0;
let proxyPort = 0;
let socksPort = 0;
let apiPort = 0;
const ops = [];

/* --------------------------- 假 OpenList 服务 --------------------------- */
function json(res, data) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 200, message: 'success', data }));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
const openlistServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${olPort}`);
  const p = u.pathname;
  if (req.method === 'PUT' || req.method === 'POST') {
    const buf = await readBody(req);
    ops.push({ path: p, method: req.method, size: buf.length, filePath: req.headers['file-path'] || '' });
  }
  if (p === '/api/auth/login') return json(res, { token: 'fake-token' });
  if (p === '/api/public/settings') return json(res, { version: '3.40.0', site_title: '冒烟 OpenList' });
  if (p === '/api/fs/list') return json(res, {
    content: [
      { name: 'a.txt', size: 5, is_dir: false, modified: '2026-11-10T10:00:00Z' },
      { name: 'sub', size: 0, is_dir: true, modified: '2026-11-10T09:00:00Z' },
    ], total: 2, provider: 'fake', write: true,
  });
  if (p === '/api/fs/get') return json(res, {
    raw_url: `http://127.0.0.1:${olPort}/d/a.txt`, sign: 'abc', name: 'a.txt', size: 5,
  });
  if (p === '/d/a.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('hello'); }
  if (p === '/api/admin/storage/list') return json(res, {
    content: [{ id: 1, mount_path: '/local', driver: 'Local', status: 'work', disabled: false, addition: '{}' }], total: 1,
  });
  if (p === '/api/admin/driver/list') return json(res, [{ driver: 'Local', name: '本地存储', description: '本地目录' }]);
  if (p === '/api/admin/driver/info') return json(res, { addition: { root_folder_path: '/data' } });
  if (p === '/api/admin/setting/list') return json(res, [
    { key: 'site_title', value: '冒烟 OpenList', type: 'string' },
    { key: 'token', value: '绝不能外泄', type: 'string' },
  ]);
  if (p.startsWith('/api/admin/storage/')) return json(res, null);
  if (p.startsWith('/api/fs/')) return json(res, null);
  res.writeHead(404); res.end('not found');
});

/* ----------------------------- 假 HTTP 代理 ----------------------------- */
// CONNECT：把隧道接到目标；普通请求：绝对 URI 转发。用于验证 SSH / Docker 隧道与 HTTP 代理。
const proxyServer = http.createServer((req, res) => {
  let target;
  try { target = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
  const upstream = http.request({
    host: target.hostname, port: Number(target.port || 80),
    path: `${target.pathname}${target.search}`, method: req.method, headers: { ...req.headers, host: target.host },
  }, (r) => {
    res.writeHead(r.statusCode || 200, r.headers);
    r.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('proxy upstream error'); });
  req.pipe(upstream);
});
proxyServer.on('connect', (req, clientSocket, head) => {
  const [host, portRaw] = req.url.split(':');
  const upstream = net.connect({ host, port: Number(portRaw || 80) }, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

// 极简 SOCKS5 服务端（无认证），验证 SSH 场景的 SOCKS 隧道握手。
const socksServer = net.createServer((socket) => {
  let buf = Buffer.alloc(0);
  let stage = 0;
  let upstream = null;
  socket.on('error', () => { if (upstream) upstream.destroy(); });
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === 0) {
      if (buf.length < 2) return;
      const n = buf[1];
      if (buf.length < 2 + n) return;
      buf = buf.subarray(2 + n);
      socket.write(Buffer.from([0x05, 0x00]));
      stage = 1;
    }
    if (stage === 1) {
      if (buf.length < 5) return;
      const atyp = buf[3];
      let host = '';
      let port = 0;
      let len = 4;
      if (atyp === 0x03) {
        const nameLen = buf[4];
        len = 5 + nameLen + 2;
        if (buf.length < len) return;
        host = buf.subarray(5, 5 + nameLen).toString();
        port = buf.readUInt16BE(5 + nameLen);
      } else if (atyp === 0x01) {
        len = 4 + 4 + 2;
        if (buf.length < len) return;
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        port = buf.readUInt16BE(8);
      } else { socket.destroy(); return; }
      buf = buf.subarray(len);
      stage = 2;
      upstream = net.connect({ host, port }, () => {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        if (buf.length) upstream.write(buf);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
    }
  });
});

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
// 让操作系统分配一个当前空闲且不在 Windows 保留段内的端口，避免 EACCES / 端口冲突。
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});

/* ----------------------------- 平台 API 客户端 ----------------------------- */
async function api(pathname, options = {}) {
  const init = { ...options };
  if (init.body !== undefined && typeof init.body !== 'string' && !Buffer.isBuffer(init.body)) {
    init.body = JSON.stringify(init.body);
    init.headers = { 'content-type': 'application/json', ...(init.headers || {}) };
  }
  const response = await fetch(`http://127.0.0.1:${apiPort}/api${pathname}`, init);
  if (init.raw) return response;
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${pathname} → ${payload.error}`);
  return payload.data;
}

(async () => {
  olPort = await listen(openlistServer);
  proxyPort = await listen(proxyServer);
  socksPort = await listen(socksServer);
  apiPort = await freePort();
  const proxyUrl = `http://user:pass@127.0.0.1:${proxyPort}`;

  // 直接 require：验证隧道实现（DATA_DIR 必须在 require core.js 之前设置）。
  process.env.DATA_DIR = TMP;
  const proxyModule = require(path.join(PLATFORM, 'src', 'proxy.js'));
  const gitSources = require(path.join(PLATFORM, 'src', 'gitSources.js'));

  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    cwd: PLATFORM,
    env: {
      ...process.env,
      DATA_DIR: TMP, PORT: String(apiPort),
      OPENLIST_URL: `http://127.0.0.1:${olPort}`, OPENLIST_TOKEN: 'fake-token',
      GITEA_URL: `http://127.0.0.1:${olPort}`, CODE_SERVER_URL: `http://127.0.0.1:${olPort}`,
      ADMIN_TOKEN: '', DP_PROXY_GLOBAL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (c) => { serverLog += c.toString(); });
  child.stderr.on('data', (c) => { serverLog += c.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 40; i += 1) {
      try { await api('/health'); ready = true; break; } catch { await sleep(150); }
    }
    note(ready, '平台进程启动并完成健康检查', ready ? `port=${apiPort}` : serverLog.slice(-300));

    /* ---------- 1. 代理优先级链 ---------- */
    const initial = await api('/proxy');
    note(initial.priority.length === 4 && initial.capabilities.httpProxy,
      '代理配置读取 / undici 能力探测', JSON.stringify(initial.capabilities));

    await api('/proxy/global', { method: 'PUT', body: { url: proxyUrl, noProxy: 'localhost,127.0.0.1,10.0.0.0/8' } });
    await api('/proxy/groups/git', { method: 'PUT', body: { url: 'http://git-group.invalid:1001' } });
    await api('/proxy/groups/docker', { method: 'PUT', body: { url: 'http://docker-group.invalid:1002' } });
    await api('/proxy/groups/server', { method: 'PUT', body: { url: 'http://server-group.invalid:1003' } });
    await api('/proxy/groups/ai', { method: 'PUT', body: { url: 'http://ai-group.invalid:1004' } });
    await api('/proxy/rules', { method: 'POST', body: { pattern: 'github.com', url: 'http://host-rule.invalid:1005' } });
    await api('/proxy/rules', { method: 'POST', body: { pattern: '*.gitea.internal', url: 'direct' } });
    await api(`/proxy/overrides/git?id=${encodeURIComponent('githubsrc:org/repo')}`, { method: 'PUT', body: { url: 'http://repo-item.invalid:1006' } });
    await api('/proxy/overrides/docker/dp-ext-mysql', { method: 'PUT', body: { url: 'http://container-item.invalid:1007' } });
    await api('/proxy/overrides/server/srv_1', { method: 'PUT', body: { url: 'direct' } });
    await api('/proxy/overrides/ai/ai_1', { method: 'PUT', body: { url: 'http://ai-item.invalid:1008' } });

    const repoHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', itemId: 'githubsrc:org/repo', url: 'https://github.com/org/repo.git' } });
    note(repoHit.source === 'override' && repoHit.url.includes('repo-item'), '单个仓库代理优先于 Host 规则', repoHit.sourceLabel);
    const ruleHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', itemId: 'x', url: 'https://github.com/a/b.git' } });
    note(ruleHit.source === 'rule' && ruleHit.url.includes('host-rule'), 'Git Host 匹配代理优先于 Git 分组', ruleHit.sourceLabel);
    const groupHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', itemId: 'x', url: 'https://gitlab.com/a/b.git' } });
    note(groupHit.source === 'group' && groupHit.url.includes('git-group'), 'Git 分组代理优先于全局', groupHit.sourceLabel);
    const groupServerHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'server', itemId: 'srv_x', host: '8.8.8.8' } });
    note(groupServerHit.source === 'group' && groupServerHit.url.includes('server-group'), '服务器代理优先于全局代理', groupServerHit.sourceLabel);
    const containerHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'docker', itemId: 'dp-ext-mysql' } });
    note(containerHit.source === 'override' && containerHit.url.includes('container-item'), '单个容器代理优先于 Docker 代理', containerHit.sourceLabel);
    const dockerGroupHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'docker', itemId: 'other' } });
    note(dockerGroupHit.source === 'group' && dockerGroupHit.url.includes('docker-group'), 'Docker 代理优先于全局代理', dockerGroupHit.sourceLabel);
    const aiHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'ai', itemId: 'ai_1' } });
    note(aiHit.source === 'override' && aiHit.url.includes('ai-item'), '单个 AI 服务代理优先于 AI 服务代理', aiHit.sourceLabel);
    const aiGroupHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'ai', itemId: 'other' } });
    note(aiGroupHit.source === 'group' && aiGroupHit.url.includes('ai-group'), 'AI 服务代理优先于全局代理', aiGroupHit.sourceLabel);
    await api('/proxy/groups/server', { method: 'PUT', body: { url: '' } });
    const globalHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'server', itemId: 'srv_x', host: '8.8.8.8' } });
    note(globalHit.source === 'global' && globalHit.url.includes(String(proxyPort)), '分组留空时回落到全局代理', globalHit.sourceLabel);
    const directHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'server', itemId: 'srv_1', host: '8.8.8.8' } });
    note(directHit.direct === true && directHit.source === 'override', '单项 direct 明确直连并终止链', directHit.sourceLabel);
    const wildcardHit = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', itemId: 'x', url: 'https://code.gitea.internal/a.git' } });
    note(wildcardHit.direct === true && wildcardHit.source === 'rule', '通配 Host 规则可强制直连', wildcardHit.sourceLabel);
    const bypass = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', itemId: 'x', url: 'http://10.0.0.246:3000' } });
    note(bypass.bypassed === true, 'NO_PROXY 命中内网地址时绕过代理');

    const entities = await api('/proxy/entities');
    note(['git', 'docker', 'server', 'ai'].every((k) => Array.isArray(entities.items[k]))
      && entities.items.git.length >= 1, '候选对象接口在 Git 源不可用时仍可降级返回', JSON.stringify(entities.overrideKeys));

    const cfg = await api('/proxy');
    note(!JSON.stringify(cfg).includes('user:pass') && JSON.stringify(cfg).includes('******'),
      '所有对外输出均已脱敏（不泄漏代理账号密码）');
    note(cfg.overrides.git.length === 1 && cfg.overrides.docker.length === 1
      && cfg.overrides.server.length === 1 && cfg.overrides.ai.length === 1,
      '四类单项覆盖均已持久化');

    const chainPreview = await api('/proxy/resolve', { method: 'POST', body: { scope: 'git', url: 'https://github.com/x/y.git' } });
    note(chainPreview.chain.length === 5 && chainPreview.chain[0].level === 'item' && chainPreview.chain[4].level === 'global',
      '解析预览返回完整层级链（Git 5 层，顺序由单项到全局）', `${chainPreview.chain.length} 层`);

    /* ---------- 2. 代理隧道 / 连通性 ---------- */
    const socket = await proxyModule.openTunnel(proxyUrl, '127.0.0.1', olPort, 5000);
    const tunnelText = await new Promise((resolve, reject) => {
      let buf = '';
      socket.on('data', (c) => { buf += c.toString(); if (buf.includes('\r\n\r\n')) resolve(buf); });
      socket.on('error', reject);
      socket.write(`GET /api/public/settings HTTP/1.1\r\nHost: 127.0.0.1:${olPort}\r\nConnection: close\r\n\r\n`);
    });
    socket.destroy();
    note(tunnelText.startsWith('HTTP/1.1 200'), 'HTTP CONNECT 隧道可转发真实请求（SSH / Docker TCP 用）');

    const socksSocket = await proxyModule.openTunnel(`socks5://127.0.0.1:${socksPort}`, '127.0.0.1', olPort, 5000);
    const socksText = await new Promise((resolve, reject) => {
      let buf = '';
      socksSocket.on('data', (c) => { buf += c.toString(); if (buf.includes('\r\n\r\n')) resolve(buf); });
      socksSocket.on('error', reject);
      socksSocket.write(`GET /api/public/settings HTTP/1.1\r\nHost: 127.0.0.1:${olPort}\r\nConnection: close\r\n\r\n`);
    });
    socksSocket.destroy();
    note(socksText.startsWith('HTTP/1.1 200'), 'SOCKS5 握手隧道可转发真实请求（SSH 场景）');

    const agentText = await new Promise((resolve, reject) => {
      const agent = proxyModule.tunnelAgent(proxyUrl, '127.0.0.1', olPort);
      const req = http.request({
        host: '127.0.0.1', port: olPort, path: '/api/public/settings', method: 'GET', agent,
      }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c.toString(); });
        r.on('end', () => resolve(`${r.statusCode}:${body}`));
      });
      req.on('error', reject);
      req.end();
    });
    note(agentText.startsWith('200:') && agentText.includes('3.40.0'),
      'tunnelAgent 可让 http.request（Docker Engine TCP）走代理');

    const tested = await api('/proxy/test', { method: 'POST', body: { global: true, target: `http://127.0.0.1:${olPort}/api/public/settings` } });
    note(tested.ok === true && tested.ms >= 0, '全局代理连通性测试', `${tested.mode} · ${tested.ms} ms`);

    const cloneCfg = proxyModule.resolve('git', { itemId: 'x', host: 'github.com', url: 'https://github.com/a/b.git' });
    const clone = gitSources.cloneArgs({ type: 'github', token: 'tok' }, 'https://github.com/a/b.git', cloneCfg);
    note(clone.args.includes(`http.proxy=${cloneCfg.url}`) && clone.env.HTTP_PROXY === cloneCfg.url,
      'git clone 注入 http.proxy 与子进程代理环境变量');
    // v0.3.3：git clone -c 会把配置写进 .git/config（凭据落盘），必须是 git -c ... clone。
    const credArgs = gitSources.cloneArgs({ type: 'github', token: 'tok' }, 'https://github.com/a/b.git').args;
    note(credArgs.indexOf('clone') > 0 && credArgs[0] === '-c'
      && credArgs.slice(0, credArgs.indexOf('clone')).some((a) => String(a).startsWith('http.extraHeader=')),
    '克隆凭据作为 clone 之前的临时 -c 参数，不写入 .git/config');

    /* ---------- 3. OpenList 管理 ---------- */
    const conn = await api('/openlist/connection');
    note(conn.url.includes(String(olPort)) && conn.hasToken && conn.manageUrl.includes('/@manage'),
      'OpenList 连接信息与后台地址', conn.source);
    const status = await api('/openlist/status');
    note(status.online && status.version === '3.40.0' && status.storageCount === 1,
      'OpenList 在线状态 / 版本 / 挂载数', `${status.siteTitle} · ${status.version}`);

    const settings = await api('/openlist/settings');
    note(settings.items.some((x) => x.key === 'site_title') && !JSON.stringify(settings).includes('绝不能外泄'),
      '站点设置白名单过滤敏感项');

    const storages = await api('/openlist/storages');
    note(storages.items.length === 1 && storages.items[0].driver === 'Local', '挂载存储列表归一化');
    const drivers = await api('/openlist/drivers');
    const driverInfo = await api('/openlist/drivers/info?driver=Local');
    note(drivers.items.length === 1 && driverInfo.addition && driverInfo.addition.root_folder_path === '/data',
      '驱动清单与配置模板');
    await api('/openlist/storages', { method: 'POST', body: { mountPath: '/new', driver: 'Local', addition: '{"root_folder_path":"/data"}' } });
    await api('/openlist/storages/1', { method: 'PUT', body: { mountPath: '/local2', driver: 'Local', addition: '{}' } });
    await api('/openlist/storages/1/toggle', { method: 'POST', body: { enabled: false } });
    await api('/openlist/storages/1', { method: 'DELETE' });
    await api('/openlist/storages/reload', { method: 'POST', body: {} });
    note(['/api/admin/storage/create', '/api/admin/storage/update', '/api/admin/storage/disable',
      '/api/admin/storage/delete', '/api/admin/storage/load_all'].every((p) => ops.some((o) => o.path === p)),
      '挂载存储增 / 改 / 启停 / 删 / 重载全部命中 OpenList 管理 API');

    const files = await api(`/openlist/files?path=${encodeURIComponent('/')}`);
    note(files.content.length === 2 && files.content[1].isDir === true && files.parent === '/',
      '文件列表归一化（含目录标记与父路径）', `${files.total} 项`);
    await api('/openlist/files/mkdir', { method: 'POST', body: { path: '/', name: 'newdir' } });
    await api('/openlist/files/rename', { method: 'POST', body: { path: '/a.txt', name: 'b.txt' } });
    await api('/openlist/files/move', { method: 'POST', body: { srcDir: '/', dstDir: '/sub', names: ['b.txt'] } });
    await api('/openlist/files/copy', { method: 'POST', body: { srcDir: '/', dstDir: '/sub', names: ['b.txt'] } });
    await api('/openlist/files/remove', { method: 'POST', body: { path: '/', names: ['b.txt'] } });
    note(['/api/fs/mkdir', '/api/fs/rename', '/api/fs/move', '/api/fs/copy', '/api/fs/remove']
      .every((p) => ops.some((o) => o.path === p)), '文件全操作：新建 / 重命名 / 移动 / 复制 / 批量删除');

    const link = await api(`/openlist/files/link?path=${encodeURIComponent('/a.txt')}`);
    note(link.rawUrl.includes('sign=abc'), '文件直链（自动拼接 sign）');
    const download = await fetch(`http://127.0.0.1:${apiPort}/api/openlist/files/download?path=%2Fa.txt`);
    note(download.status === 200 && (await download.text()) === 'hello', '后端代理下载文件（浏览器无需直连 OpenList）');
    const upload = await fetch(`http://127.0.0.1:${apiPort}/api/openlist/files/upload?path=%2F&name=up.bin`, {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3]),
    });
    const uploaded = await upload.json();
    note(uploaded.ok === true && ops.some((o) => o.path === '/api/fs/put' && o.size === 3), '二进制上传走 /api/fs/put');

    /* ---------- 4. 连接配置覆盖与校验 ---------- */
    const changed = await api('/openlist/connection', { method: 'PUT', body: { url: `http://127.0.0.1:${olPort}`, user: 'root' } });
    note(changed.user === 'root' && changed.source === '面板配置', '面板保存连接信息并标记来源');
    const restored = await api('/openlist/connection/reset', { method: 'POST', body: {} });
    note(restored.source.includes('.env'), '恢复 .env / 环境变量配置');
    let badUrlBlocked = false;
    try { await api('/openlist/connection', { method: 'PUT', body: { url: 'ftp://x' } }); }
    catch { badUrlBlocked = true; }
    note(badUrlBlocked, '非法 OpenList 地址被拒绝');
    let badAdditionBlocked = false;
    try { await api('/openlist/storages', { method: 'POST', body: { mountPath: '/x', driver: 'Local', addition: '{bad json' } }); }
    catch { badAdditionBlocked = true; }
    note(badAdditionBlocked, '非法 addition JSON 被拒绝');
    let badProxyBlocked = false;
    try { await api('/proxy/global', { method: 'PUT', body: { url: 'ftp://x' } }); }
    catch { badProxyBlocked = true; }
    note(badProxyBlocked, '非法代理协议被拒绝');

    const masked = await api('/proxy');
    await api('/proxy/global', { method: 'PUT', body: { url: masked.global.url, noProxy: masked.global.noProxy } });
    const afterResave = await api('/proxy');
    note(afterResave.global.url.includes('******') && !afterResave.global.url.includes('user:pass'),
      '脱敏值原样提交不会写坏已保存的代理地址');

    /* ---------- 5. 单项代理落到业务对象 ---------- */
    const srv = await api('/servers', { method: 'POST', body: {
      name: '代理节点', host: '203.0.113.9', username: 'root', password: 'p', proxy: 'http://u:p@127.0.0.1:7001',
    } });
    note(srv.proxy.includes('******') && !srv.proxy.includes('u:p@') && srv.effectiveProxy.includes('7001'),
      '服务器表单保存单个代理并脱敏', srv.proxy);
    const ai = await api('/ai/providers', { method: 'POST', body: {
      name: '代理模型', kind: 'api', baseURL: 'https://api.example.com/v1', model: 'm', apiKey: 'k',
      proxy: 'http://u:p@127.0.0.1:7002',
    } });
    note(ai.proxy.includes('******') && !ai.proxy.includes('u:p@') && ai.effectiveProxy.includes('7002'),
      'AI 服务表单保存单个代理并脱敏', ai.proxy);
    await api('/ai/providers', { method: 'POST', body: {
      id: ai.id, name: '代理模型', kind: 'api', baseURL: 'https://api.example.com/v1', model: 'm',
      apiKey: 'k', proxy: ai.proxy,
    } });
    const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'));
    const savedAi = (saved.aiProviders || []).find((x) => x.id === ai.id);
    note(Boolean(savedAi) && !String(savedAi.proxy).includes('******') && String(savedAi.proxy).includes('u:p@'),
      '脱敏值原样提交时业务对象保留真实代理地址');

    /* ---------- 6. v0.3.2：Git 源账号密码 ---------- */
    const gs = await api('/git-sources', { method: 'POST', body: {
      label: '账号密码源', type: 'gitea', baseUrl: `http://127.0.0.1:${olPort}`,
      authType: 'password', username: 'alice', password: 's3cret',
    } });
    note(gs.authType === 'password' && gs.hasCreds && gs.hasPassword
      && !gs.passwordMasked.includes('s3cret'), '外部 Git 源支持账号密码登记且列表脱敏');
    const gsList = await api('/git-sources');
    const pubGs = (gsList.items || []).find((x) => x.id === gs.id);
    note(Boolean(pubGs) && pubGs.authType === 'password' && pubGs.hasCreds,
      '账号密码源被聚合进仓库列表的来源清单');
    await api(`/git-sources/${gs.id}`, { method: 'PUT', body: { username: 'alice', password: gs.passwordMasked } });
    let gsState = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'));
    let rawGs = (gsState.gitSources || []).find((x) => x.id === gs.id);
    note(Boolean(rawGs) && rawGs.password === 's3cret', 'Git 源脱敏值回显沿用真实密码');
    await api(`/git-sources/${gs.id}`, { method: 'PUT', body: { authType: 'token', token: 'tok-123' } });
    gsState = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'));
    rawGs = (gsState.gitSources || []).find((x) => x.id === gs.id);
    note(Boolean(rawGs) && rawGs.authType === 'token' && rawGs.token === 'tok-123' && rawGs.password === '',
      '切换认证方式会清掉另一种明文凭据');
    await api(`/git-sources/${gs.id}`, { method: 'DELETE' });

    // cloneArgs 是纯函数：验证账号密码生成的 Basic 头、Token 头与 GitLab 头。
    const gsMod = require(path.join(PLATFORM, 'src', 'gitSources.js'));
    const caPwd = gsMod.cloneArgs({ type: 'gitea', authType: 'password', username: 'alice', password: 's3cret' },
      'http://example.com/x.git', null);
    const pwdHeader = caPwd.args.find((a) => String(a).startsWith('http.extraHeader=')) || '';
    note(caPwd.auth === true && pwdHeader.includes('Authorization: Basic ')
      && !pwdHeader.includes('s3cret') && caPwd.secrets.includes('s3cret'),
    '克隆时账号密码生成 Basic 头，且不写入 .git/config');
    const caToken = gsMod.cloneArgs({ type: 'github', authType: 'token', token: 'ghp_abc' },
      'https://github.com/o/r.git', null);
    note(caToken.args.some((a) => String(a).includes('eC1hY2Nlc3MtdG9rZW46Z2hwX2FiYw==')),
      'GitHub Token 克隆走 x-access-token Basic 头');
    const caGitlab = gsMod.cloneArgs({ type: 'gitlab', authType: 'token', token: 'glpat-xyz' },
      'https://gitlab.example.com/o/r.git', null);
    note(caGitlab.args.some((a) => String(a).includes('PRIVATE-TOKEN: glpat-xyz')),
      'GitLab Token 克隆走 PRIVATE-TOKEN 头');

    /* ---------- 7. v0.3.2：多 OpenList 连接 ---------- */
    const conns0 = await api('/openlist/connections');
    note(Array.isArray(conns0.items) && conns0.items.some((c) => c.active),
      '默认存在一条来自 .env 的 OpenList 连接');
    const added = await api('/openlist/connections', { method: 'POST', body: {
      label: '外部 OpenList', url: `http://127.0.0.1:${olPort}`, user: 'ext', token: 'ext-token',
    } });
    const conns1 = await api('/openlist/connections');
    note(conns1.items.length === conns0.items.length + 1
      && conns1.items.some((c) => c.id === added.id && c.active && c.hasToken),
    '可新增外部 OpenList 连接并自动设为当前');
    const stExternal = await api('/openlist/status');
    note(stExternal.connectionId === added.id && stExternal.online === true
      && stExternal.url === `http://127.0.0.1:${olPort}`,
    '切换连接后状态接口作用到新的 OpenList 服务');
    await api(`/openlist/connections/${added.id}`, { method: 'PUT', body: {
      label: '外部改名', token: added.tokenMasked,
    } });
    const connState = JSON.parse(fs.readFileSync(path.join(TMP, 'state.json'), 'utf8'));
    const rawConn = (connState.openlistConnections || []).find((c) => c.id === added.id);
    note(Boolean(rawConn) && rawConn.token === 'ext-token' && rawConn.label === '外部改名',
      '连接编辑时脱敏回显保留真实 Token');
    const back = await api('/openlist/connections/env-default/activate', { method: 'POST', body: {} });
    const stBack = await api('/openlist/status');
    note(back.activeId === 'env-default' && stBack.connectionId === 'env-default',
      '可切回 .env 默认连接，其它连接仍保留登记');
    await api(`/openlist/connections/${added.id}`, { method: 'DELETE' });
    const conns2 = await api('/openlist/connections');
    note(conns2.items.length === conns0.items.length, '删除连接只移除登记');
    let lastConnBlocked = false;
    try { await api('/openlist/connections/env-default', { method: 'DELETE' }); }
    catch { lastConnBlocked = true; }
    note(lastConnBlocked, '至少保留一个 OpenList 连接的约束生效');

    /* ---------- 8. 既有接口回归 ---------- */
    const overview = await api('/overview');
    note(overview.mode === 'normal' && typeof overview.counts.proxyRules === 'number',
      '总览接口回归（含代理规则计数）');
    const legacy = await api('/storage?path=%2F');
    note(Array.isArray(legacy.content), '旧 /api/storage 接口保持兼容');
  } catch (e) {
    note(false, '冒烟执行异常', e.stack || String(e));
  } finally {
    child.kill('SIGTERM');
    openlistServer.close();
    proxyServer.close();
    proxyServer.closeAllConnections && proxyServer.closeAllConnections();
    socksServer.close();
    console.log(`\n${errors.length ? `✖ ${errors.length} 项未通过：${errors.join('；')}` : `✔ 全部 ${passed} 项冒烟通过`}`);
    if (errors.length) process.exitCode = 1;
  }
})();
