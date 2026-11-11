'use strict';

/**
 * v0.3.4 专项冒烟：环境适配中心。
 *
 *  A) 注入 stub 模拟「精简容器、无 Git、SSH 宿主机兜底就绪」，验证自动推导 /
 *     策略优先级 / 自动降级 / 环境漂移触发（不依赖 Docker 或网络）；
 *  B) 拉起真实 server.js，走完 /api/environment 全套接口，并验证克隆通道
 *     策略真的作用到 /api/repos/clone 上。
 *
 *   node scripts/smoke-environment.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const PLATFORM = path.resolve(__dirname, '..', 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-env-smoke-'));
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

const defaultEnvState = () => ({
  activeProfile: 'auto', autoHeal: true, checkOnStartup: true,
  strategies: {}, profiles: {}, applied: {},
  lastFingerprint: '', lastCheckAt: '', lastProfile: '', history: [],
});

/** 用函数作用域注入 core / gitRuntime / integrations 的替身，隔离真实 require 缓存。 */
function loadEnv({ gitAvailable = false, fallbackReady = true, container = true,
  envVars = {}, stateEnv = null } = {}) {
  const st = {
    servers: [{ id: 'srv_1', name: '测试宿主机', host: '10.0.0.246', deployDir: '/data/platform' }],
    git: { bin: '', sshFallback: 'auto' },
    environment: stateEnv || defaultEnvState(),
  };
  const core = {
    config: {
      workspaceDir: path.join(TMP, 'stub-workspace'),
      hostWorkspaceDir: '/data/platform/workspace',
      dataDir: path.join(TMP, 'stub-data'),
      giteaUrl: 'http://127.0.0.1:1', openlistUrl: 'http://127.0.0.1:1',
      codeServerUrl: 'http://127.0.0.1:1',
      buildExecutor: 'local', gitBin: '', gitFallbackServerId: '', buildServerId: '',
      envProfile: envVars.DP_ENV_PROFILE || '', envAutoHeal: '', envCheckOnStartup: '',
      runtimeImage: 'node:20-alpine', runtimeKind: container ? 'container' : 'host',
    },
    state: () => st,
    update: (fn) => fn(st),
    __st: st,
  };
  const fb = {
    enabled: true, ready: fallbackReady, serverId: 'srv_1', serverName: '测试宿主机',
    serverHost: '10.0.0.246', hostWorkspaceDir: '/data/platform/workspace',
    source: 'HOST_WORKSPACE_DIR', reason: fallbackReady ? '' : '兜底关闭',
  };
  // v0.3.9：宿主机 Git 实测替身。容器内有 Git 时跳过探测；否则按兜底就绪情况返回实测结果。
  const hostGitProbe = () => ({
    checked: true, skipped: gitAvailable, available: !gitAvailable && fb.ready,
    bin: fb.ready ? '/usr/bin/git' : '', version: fb.ready ? '2.11.0' : '',
    host: '10.0.0.246', serverName: '测试宿主机', workspaceWritable: fb.ready,
    detail: fb.ready ? 'GIT_BIN=/usr/bin/git git version 2.11.0 WS_WRITABLE' : '',
    error: fb.ready ? '' : 'SSH 宿主机兜底未就绪', checkedAt: '2026-11-11T00:00:00.000Z',
  });
  const gitRt = {
    refresh: () => ({ available: gitAvailable }),
    probeHostGit: async () => hostGitProbe(),
    hostGitSummary: () => hostGitProbe(),
    resolve: () => ({ available: gitAvailable, bin: gitAvailable ? '/usr/bin/git' : '', version: gitAvailable ? '2.11.0' : '', source: 'PATH' }),
    describe: () => ({
      available: gitAvailable, bin: gitAvailable ? '/usr/bin/git' : '', version: gitAvailable ? '2.11.0' : '',
      source: 'PATH', tried: [], channel: gitAvailable ? 'local' : (fallbackReady ? 'ssh-host' : 'none'),
      fallback: fb, hint: '', configuredBin: '', workspaceDir: core.config.workspaceDir,
      hostWorkspaceDir: core.config.hostWorkspaceDir, installHint: '',
    }),
    fallback: () => fb,
    setFallback: (on) => { fb.enabled = on; fb.ready = on && fallbackReady; },
    missingMessage: () => '未找到可执行的 Git',
  };
  const src = fs.readFileSync(path.join(PLATFORM, 'src', 'environment.js'), 'utf8');
  const fakeRequire = (id) => {
    if (id === './core') return core;
    if (id === './gitRuntime') return gitRt;
    if (id === './integrations') return {
      sshExec: async () => ({ code: 0, stdout: 'git version 2.11.0\nWS_WRITABLE', stderr: '' }),
    };
    return require(id);
  };
  const mod = { exports: {} };
  const fakeProcess = Object.assign({}, process, {
    env: { ...process.env, ...envVars }, platform: 'linux',
  });
  const factory = new Function('require', 'module', 'exports', 'process', '__dirname', src);
  factory(fakeRequire, mod, mod.exports, fakeProcess, path.join(PLATFORM, 'src'));
  return { env: mod.exports, core, st, fb };
}

/* ---------- A. 精简容器：无 Git + SSH 兜底就绪，应自动推导并切到 ssh-host ---------- */
async function testAutoDerive() {
  const { env, st } = loadEnv();
  note(env.detect().kind === 'container' && env.detect().runtimeImage === 'node:20-alpine',
    '识别出「容器 + 运行镜像」环境事实');
  note(env.fingerprint() === env.fingerprint() && /^[a-f0-9]{12}$/.test(env.fingerprint()),
    '环境指纹稳定且可复现', env.fingerprint());

  const p = env.profile();
  note(p.id === 'auto' && p.derived === 'container-lite',
    'auto 档案在无 Git 容器中推导为 container-lite', p.derived);
  note(env.strategies().values.gitClone === 'ssh-host',
    '推导档案自动把克隆通道设为 SSH 宿主机');

  const healed = await env.heal({ deep: true, trigger: '冒烟' });
  note(healed.applied.gitClone === 'ssh-host' && env.gitStrategy() === 'ssh-host',
    '自动处置后克隆实际通道为 ssh-host', healed.applied.gitClone);
  note(healed.checks.some((c) => c.id === 'fallback' && /实测/.test(c.detail)),
    '深度体检会实测宿主机 Git 与工作区可写');
  // v0.3.9：宿主机 Git 属于已检测到的可用 Git，体检不应再报「提醒 / 未找到可用的 Git」。
  const gitCheck = healed.checks.find((c) => c.id === 'git');
  note(Boolean(gitCheck) && gitCheck.level === 'ok'
    && /宿主机 10\.0\.0\.246/.test(gitCheck.detail) && /2\.11\.0/.test(gitCheck.detail)
    && /\/usr\/bin\/git/.test(gitCheck.detail),
  '容器无 Git 但宿主机 Git 实测可用时体检判为正常，并显示版本与路径',
  gitCheck ? gitCheck.detail : '(无)');
  note(Array.isArray(healed.actions) && healed.actions.length >= 1 && st.environment.history.length >= 2,
    '处置动作与日志已写入 state.environment.history');
  note(st.environment.lastFingerprint === env.fingerprint(),
    '体检后记录当前环境指纹，供下次启动判断是否切换');

  // 漂移：指纹与上次记录不一致时，启动应自动触发「环境切换」体检。
  const driftState = defaultEnvState();
  driftState.lastFingerprint = '000000000000';
  const drift = loadEnv({ stateEnv: driftState });
  const boot = await drift.env.boot();
  note(!boot.skipped && drift.st.environment.history.some((h) => h.action.includes('环境切换')),
    '指纹变化被判定为环境切换，启动时自动重检并记录日志');

  // 策略不可用时必须自动降级，绝不留下「一点克隆就报错」的组合。
  const forced = loadEnv({ envVars: { DP_ENV_PROFILE: 'native' } });
  note(forced.env.profile().id === 'native' && forced.env.strategies().values.gitClone === 'local',
    'DP_ENV_PROFILE=native 可强制覆盖推导结果');
  const downgraded = await forced.env.heal({ deep: false });
  note(downgraded.applied.gitClone === 'ssh-host'
    && downgraded.actions.some((a) => a.action.includes('自动降级')),
  '策略要求 local 但环境无 Git 时自动降级为 ssh-host');

  // 部署期声明优先级高于控制台微调。
  const override = loadEnv({
    envVars: { DP_GIT_CLONE_STRATEGY: 'ssh-host' },
    stateEnv: { ...defaultEnvState(), strategies: { gitClone: 'local' } },
  });
  note(override.env.strategies().values.gitClone === 'ssh-host'
    && override.env.strategies().sources.gitClone.includes('DP_GIT_CLONE_STRATEGY'),
  '.env 的 DP_* 优先于 state.json 里的旧策略（换环境不被锁死）');

  const disabled = loadEnv({ envVars: { DP_GIT_CLONE_STRATEGY: 'disabled' } });
  await disabled.env.heal({ deep: false });
  note(disabled.env.gitStrategy() === 'disabled', '可显式禁用克隆通道');

  // 自定义档案增删改 + 切换
  const custom = loadEnv();
  custom.env.saveProfile({
    id: 'lab-offline', name: '内网精简环境',
    strategies: { gitClone: 'ssh-host', buildExecutor: '', gitInstall: 'never', sshFallback: 'on' },
  });
  note(custom.env.listProfiles().some((p) => p.id === 'lab-offline' && !p.builtin),
    '可把策略另存为自定义档案');
  const switched = await custom.env.switchProfile('lab-offline');
  note(custom.env.profile().id === 'lab-offline' && switched.applied.gitClone === 'ssh-host',
    '切换档案立即重跑体检并应用新通道');
  custom.env.deleteProfile('lab-offline');
  note(!custom.env.listProfiles().some((p) => p.id === 'lab-offline')
    && custom.st.environment.activeProfile === 'auto',
  '删除自定义档案后自动回退到 auto');
}

/* --------------------- B. 真实 HTTP 接口与克隆执行路径 --------------------- */
async function testApi() {
  const port = await freePort();
  const dataDir = path.join(TMP, 'http-data');
  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    cwd: PLATFORM,
    env: {
      ...process.env,
      DATA_DIR: dataDir, PORT: String(port), ADMIN_TOKEN: '',
      WORKSPACE_DIR: path.join(TMP, 'http-workspace'),
      GITEA_URL: 'http://127.0.0.1:1', OPENLIST_URL: 'http://127.0.0.1:1',
      CODE_SERVER_URL: 'http://127.0.0.1:1', DP_PROXY_GLOBAL: '',
      DP_RUNTIME_KIND: 'host', DP_RUNTIME_IMAGE: '',
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
    const r = await fetch(`http://127.0.0.1:${port}/api${pathname}`, init);
    const j = await r.json();
    if (!j.ok) throw new Error(`${pathname} → ${j.error}`);
    return j.data;
  };

  let ready = false;
  try {
    for (let i = 0; i < 40 && !ready; i += 1) {
      try { const h = await api('/health'); ready = h.name === 'devplatform'; } catch { await sleep(250); }
    }
    note(ready, '平台进程启动并完成健康检查', ready ? `port=${port}` : log.slice(-300));
    if (!ready) return;

    const health = await api('/health');
    note(Boolean(health.environment) && typeof health.environment.channel === 'string'
      && /^[a-f0-9]{12}$/.test(health.environment.fingerprint),
    '/api/health 暴露环境档案、通道与指纹', JSON.stringify(health.environment));

    const d = await api('/environment');
    note(d.checks.length >= 8 && d.profiles.length >= 5 && Boolean(d.options.gitClone)
      && Boolean(d.strategySources) && Array.isArray(d.history),
    'GET /api/environment 返回体检、档案、策略来源与处置日志', `${d.checks.length} 项 / ${d.profiles.length} 档案`);
    note(d.checks.some((c) => c.id === 'drift') && d.checks.some((c) => c.id === 'git')
      && d.checks.some((c) => c.id === 'strategy'),
    '体检覆盖环境漂移、Git 与策略匹配三项关键检查');

    const checked = await api('/environment/check', { method: 'POST', body: {} });
    note(checked.summary.total >= 8 && checked.checkedAt, 'POST /environment/check 可执行深度重检');

    const saved = await api('/environment/config', { method: 'PUT', body: {
      strategies: { gitClone: 'auto' }, autoHeal: true, checkOnStartup: true,
    } });
    note(saved.config.strategies.gitClone === 'auto', 'PUT /environment/config 可保存策略微调');

    const healed = await api('/environment/heal', { method: 'POST', body: {} });
    note(healed.healed === true && healed.actions.length >= 1 && Boolean(healed.applied.gitClone),
      'POST /environment/heal 返回处置动作与生效通道', healed.applied.gitClone);

    const withProfile = await api('/environment/profiles', { method: 'POST', body: {
      id: 'lab-http', name: 'HTTP 冒烟档案',
      strategies: { gitClone: 'local', buildExecutor: '', gitInstall: 'never', sshFallback: 'auto' },
    } });
    note(withProfile.some((p) => p.id === 'lab-http'), 'POST /environment/profiles 可新增自定义档案');

    const switched = await api('/environment/switch', { method: 'POST', body: { id: 'container-lite' } });
    note(switched.profile.id === 'container-lite' && Boolean(switched.applied.gitClone),
      'POST /environment/switch 切换档案后立即重检并处置', switched.applied.gitClone);

    // 禁用策略必须真的作用到克隆接口，而不只是写在报告里。
    await api('/environment/config', { method: 'PUT', body: { strategies: { gitClone: 'disabled' } } });
    await api('/environment/heal', { method: 'POST', body: {} });
    let blocked = '';
    try {
      await api('/repos/clone', { method: 'POST', body: { cloneUrl: 'https://example.invalid/a/b.git' } });
    } catch (e) { blocked = e.message; }
    note(blocked.includes('已被当前环境档案禁用'),
      '禁用策略实际阻止 /api/repos/clone（策略已接入执行路径）', blocked.slice(0, 60));
    await api('/environment/config', { method: 'PUT', body: { strategies: { gitClone: '' } } });
    await api('/environment/heal', { method: 'POST', body: {} });

    const removed = await api('/environment/profiles/lab-http', { method: 'DELETE' });
    note(!removed.some((p) => p.id === 'lab-http'), 'DELETE /environment/profiles/:id 可删除自定义档案');

    const final = await api('/environment', { method: 'GET' });
    note(final.history.length >= 2, '处置日志持续累积，可在控制台回看');
  } catch (e) {
    note(false, 'HTTP 接口执行异常', e.stack || String(e));
  } finally {
    child.kill('SIGTERM');
  }
}

(async () => {
  try { await testAutoDerive(); } catch (e) { note(false, '环境推导 / 自动处置异常', e.stack || String(e)); }
  try { await testApi(); } catch (e) { note(false, 'HTTP 接口冒烟异常', e.stack || String(e)); }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
  console.log(`\n${errors.length ? `✖ ${errors.length} 项未通过：${errors.join('；')}` : `✔ 全部 ${passed} 项环境适配冒烟通过`}`);
  if (errors.length) process.exitCode = 1;
})();
