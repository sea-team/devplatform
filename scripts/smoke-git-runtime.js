'use strict';

/**
 * v0.3.3 专项冒烟：Git 运行时探测 / ENOENT 友好提示 / SSH 宿主机兜底判定 / 新接口。
 *
 * 分三段，均不依赖外部网络或 Docker：
 *  A) 用注入 stub 的「无 Git 环境」验证降级判定（真正复现 spawn git ENOENT 的决策路径）；
 *  B) 真实模块在本机的探测与转义；
 *  C) 拉起真实 server.js 调用 /api/git/runtime 三件套与 /api/health。
 *
 *   node scripts/smoke-git-runtime.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const PLATFORM = path.resolve(__dirname, '..', 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-git-runtime-smoke-'));
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

/* ---------- A. 注入 stub：模拟容器内完全没有 git 的场景 ---------- */
function makeCoreStub({ servers = [], hostWorkspaceDir = '' } = {}) {
  const st = { servers, git: { bin: '', sshFallback: 'auto' } };
  return {
    config: {
      gitBin: '', gitFallbackServerId: '', buildServerId: '',
      workspaceDir: '/workspace', hostWorkspaceDir,
    },
    state: () => st,
    update: (fn) => fn(st),
    __st: st,
  };
}

function loadNoGit(coreStub) {
  const src = fs.readFileSync(path.join(PLATFORM, 'src', 'gitRuntime.js'), 'utf8');
  const fakeChild = {
    // 所有探测都失败：等价于 PATH 里没有 git、常见安装路径也不存在。
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'git: not found' }),
    spawn: () => { throw new Error('无 git 时不应调用 spawn'); },
  };
  const fakeFs = Object.assign({}, fs, { existsSync: () => false });
  const fakeRequire = (id) => {
    if (id === 'child_process') return fakeChild;
    if (id === 'fs') return fakeFs;
    if (id === 'path') return path;
    if (id === './core') return coreStub;
    return require(id);
  };
  const mod = { exports: {} };
  // 用函数作用域隔离模块，避免污染真实 require 缓存。
  const factory = new Function('require', 'module', 'exports', 'process', '__dirname', src);
  factory(fakeRequire, mod, mod.exports, { ...process, platform: 'linux' }, path.join(PLATFORM, 'src'));
  return mod.exports;
}

async function testNoGit() {
  const core = makeCoreStub();
  const gr = loadNoGit(core);
  const initial = gr.describe();
  note(initial.available === false && initial.version === '', '无 Git 环境下探测结果正确（available=false）');
  note(initial.channel === 'none' && initial.fallback.ready === false,
    '无 Git 且未登记 SSH 服务器时通道为 none', initial.fallback.reason);
  note(initial.hint.includes('spawn git ENOENT') && initial.hint.includes('GIT_BIN')
    && initial.hint.includes('apk add') && initial.hint.includes('HOST_WORKSPACE_DIR'),
  '错误提示包含 5 条可执行的修复指引');

  const friendly = gr.friendlyError({ code: 'ENOENT', message: 'spawn git ENOENT' });
  note(!friendly.message.includes('spawn git ENOENT') || friendly.message.includes('原始错误'),
    'ENOENT 已转成中文诊断，不再裸抛底层错误');
  note(friendly.message.includes('未找到可执行的 Git'), '友好错误保留明确的中文结论');

  let thrown = '';
  try { await gr.exec(['clone', 'https://example.com/a.git']); } catch (e) { thrown = e.message; }
  note(thrown.includes('未找到可执行的 Git') && thrown.includes('修复方式'),
    'exec() 在无 Git 时直接给出修复指引而不是调用 spawn');

  // 登记宿主机 + 明确 HOST_WORKSPACE_DIR：兜底应变为就绪。
  const core2 = makeCoreStub({
    servers: [{ id: 'srv_1', name: '测试宿主机', host: '10.0.0.246', deployDir: '/data/platform' }],
    hostWorkspaceDir: '/data/platform/workspace',
  });
  const gr2 = loadNoGit(core2);
  const fb = gr2.fallback();
  const d2 = gr2.describe();
  note(fb.ready && fb.serverId === 'srv_1' && fb.hostWorkspaceDir === '/data/platform/workspace',
    '已登记 SSH 宿主机 + HOST_WORKSPACE_DIR 时兜底就绪', fb.hostWorkspaceDir);
  note(d2.channel === 'ssh-host' && d2.hint.includes('10.0.0.246') && d2.hint.includes('/data/platform/workspace'),
    '描述里明确标出实际执行通道与宿主机路径');

  gr2.setFallback(false);
  note(gr2.describe().channel === 'none' && gr2.fallback().reason.includes('关闭'),
    '控制台可关闭 SSH 宿主机兜底');
  gr2.setFallback(true);
  note(gr2.fallback().ready === true, '重新开启兜底后立即恢复就绪');

  gr2.setBin('/opt/custom/bin/git');
  note(gr2.describe().configuredBin === '/opt/custom/bin/git' && core2.__st.git.bin === '/opt/custom/bin/git',
    '手工指定 Git 路径写入 state 并在诊断中回显');

  // 只有 deployDir、没有 HOST_WORKSPACE_DIR 时也能推导出宿主机路径。
  const core3 = makeCoreStub({
    servers: [{ id: 'srv_2', name: '推导宿主机', host: '10.0.0.9', deployDir: '/srv/devplatform' }],
  });
  const fb3 = loadNoGit(core3).fallback();
  note(fb3.ready && fb3.hostWorkspaceDir === '/srv/devplatform/workspace' && fb3.source.includes('推导'),
    '未配置 HOST_WORKSPACE_DIR 时可按部署目录推导', fb3.hostWorkspaceDir);

  // 有服务器但没有路径映射：必须禁用兜底，避免克隆到无关机器上。
  const core4 = makeCoreStub({ servers: [{ id: 'srv_3', name: '无关机器', host: '10.0.0.8' }] });
  const fb4 = loadNoGit(core4).fallback();
  note(fb4.ready === false && fb4.reason.includes('HOST_WORKSPACE_DIR'),
    '无法确定宿主机工作区映射时禁用兜底（防止克隆到无关机器）');
}

/* -------------------- B. 真实模块：探测与 shell 转义 -------------------- */
function testRealModule() {
  const gr = require(path.join(PLATFORM, 'src', 'gitRuntime.js'));
  const gs = require(path.join(PLATFORM, 'src', 'gitSources.js'));
  const d = gr.describe();
  if (d.available) {
    note(Boolean(d.bin) && Boolean(d.version), '本机真实 Git 探测成功', `${d.bin} · ${d.version}`);
    note(gr.probe(d.bin).ok === true, 'probe() 对解析出的路径可重复成功');
    note(d.channel === 'local' && d.hint.includes('本机'), '有 Git 时通道固定为 local');
  } else {
    note(true, '本机未安装 Git，跳过真实探测断言', d.hint.slice(0, 60));
  }
  note(gs.shQuote("a'b") === `'a'\\''b'`, 'shQuote 正确转义单引号（SSH 宿主机参数安全）');
  const tricky = "core.sshCommand=ssh -o ProxyCommand='nc -X connect -x h:1 %h %p'";
  const quoted = gs.shQuote(tricky);
  note(quoted.startsWith("'") && quoted.endsWith("'") && quoted.includes("'\\''"),
    '含单引号的 core.sshCommand 参数被安全转义');
  const args = gs.cloneArgs({ type: 'github', token: 'tok-abc' }, 'https://github.com/a/b.git').args;
  const cloneAt = args.indexOf('clone');
  note(cloneAt > 0 && args[0] === '-c'
    && args.slice(0, cloneAt).some((a) => String(a).startsWith('http.extraHeader='))
    && args.slice(0, cloneAt).includes('http.extraHeaderRedact=true'),
  '凭据 -c 位于 clone 之前（不会把 extraHeader 持久化到 .git/config）');
  note(!args.some((a) => String(a).includes('tok-abc@')),
  'cloneArgs 不把凭据拼进 URL');
  note(gr.missingMessage().includes('scripts/remote.js deploy'), '修复指引包含重新部署命令');
}

/* ------------------------- C. HTTP 接口回归 ------------------------- */
async function testApi() {
  const apiPort = await freePort();
  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    cwd: PLATFORM,
    env: {
      ...process.env,
      DATA_DIR: TMP, PORT: String(apiPort), ADMIN_TOKEN: '',
      WORKSPACE_DIR: path.join(TMP, 'workspace'),
      GITEA_URL: 'http://127.0.0.1:1', OPENLIST_URL: 'http://127.0.0.1:1',
      CODE_SERVER_URL: 'http://127.0.0.1:1', DP_PROXY_GLOBAL: '',
      HOST_WORKSPACE_DIR: '/data/platform/workspace',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c.toString(); });
  child.stderr.on('data', (c) => { log += c.toString(); });

  const api = async (pathname, options = {}) => {
    const init = { ...options };
    if (init.body !== undefined && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
      init.headers = { 'content-type': 'application/json', ...(init.headers || {}) };
    }
    const r = await fetch(`http://127.0.0.1:${apiPort}/api${pathname}`, init);
    const j = await r.json();
    if (!j.ok) throw new Error(`${pathname} → ${j.error}`);
    return j.data;
  };

  let ready = false;
  try {
    for (let i = 0; i < 40 && !ready; i += 1) {
      try { const h = await api('/health'); ready = h.name === 'devplatform'; } catch { await sleep(250); }
    }
    note(ready, '平台进程启动并完成健康检查', ready ? `port=${apiPort}` : log.slice(-300));
    if (!ready) return;

    const health = await api('/health');
    note(typeof health.git.available === 'boolean' && ['local', 'ssh-host', 'none'].includes(health.git.channel),
      '/api/health 暴露 git.available 与 git.channel', `${health.git.available} / ${health.git.channel}`);
    note(health.version === '0.3.4', '源码模式版本号已升到 0.3.4', health.version);

    const d = await api('/git/runtime');
    note(Boolean(d.hint) && Boolean(d.fallback) && Array.isArray(d.tried)
      && 'configuredBin' in d && 'installHint' in d,
    'GET /api/git/runtime 返回完整诊断结构');
    note(d.workspaceDir === path.join(TMP, 'workspace'),
      '诊断里包含工作区路径（隔离到临时目录）', d.workspaceDir);

    const refreshed = await api('/git/runtime/refresh', { method: 'POST', body: {} });
    note(refreshed.available === d.available, 'POST /api/git/runtime/refresh 可重复执行');

    const realBin = d.available ? d.bin : '';
    if (realBin) {
      const saved = await api('/git/runtime', { method: 'PUT', body: { bin: realBin, sshFallback: false } });
      note(saved.configuredBin === realBin && saved.available === true && saved.fallback.enabled === false,
        'PUT 可保存 Git 路径并关闭兜底，且立即重新探测');
    }
    const restored = await api('/git/runtime', { method: 'PUT', body: { bin: '', sshFallback: true } });
    note(restored.configuredBin === '' && restored.fallback.enabled === true,
      'PUT 可清空手工路径并恢复兜底');

    const bad = await api('/git/runtime', { method: 'PUT', body: { bin: '/definitely/not/a/git' } });
    note(bad.available === (d.available) && bad.tried.some((t) => t.includes('文件不存在')),
      '无效路径被跳过并自动回退到自动探测（不会锁死克隆功能）');
    await api('/git/runtime', { method: 'PUT', body: { bin: '' } });

    const cloneMissing = await (async () => {
      try {
        await api('/repos/clone', { method: 'POST', body: { cloneUrl: 'http://127.0.0.1:1/a.git' } });
        return '';
      } catch (e) { return e.message; }
    })();
    note(!cloneMissing.includes('spawn git ENOENT') || cloneMissing.includes('原始错误'),
      '/api/repos/clone 不再把裸 ENOENT 返回给前端', cloneMissing.slice(0, 90));
  } catch (e) {
    note(false, 'HTTP 接口执行异常', e.stack || String(e));
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

(async () => {
  try { await testNoGit(); } catch (e) { note(false, '无 Git 场景判定异常', e.stack || String(e)); }
  try { testRealModule(); } catch (e) { note(false, '真实模块探测异常', e.stack || String(e)); }
  try { await testApi(); } catch (e) { note(false, 'HTTP 接口冒烟异常', e.stack || String(e)); }
  console.log(`\n${errors.length ? `✖ ${errors.length} 项未通过：${errors.join('；')}` : `✔ 全部 ${passed} 项 Git 运行时冒烟通过`}`);
  if (errors.length) process.exitCode = 1;
})();
