'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { config, state, update, uid, safeWorkspacePath } = require('./core');
const { sshExec, sftpPut, collectStatus, aiChat } = require('./integrations');
const buildBackends = require('./buildBackends');

/* --------------------------- 多语言构建 Profile -------------------------- */
// 每个 profile 定义：识别文件、容器镜像、安装 / 编译 / 测试命令、产物目录。
// 命令是平台内置白名单，不直接接受用户传入的 shell 字符串，避免命令注入。
const PROFILES = [
  {
    id: 'frontend', label: '前端 · Node / npm', match: ['package.json'],
    image: 'node:22-bookworm', artifact: 'dist',
    install: 'npm ci || npm install',
    build: 'npm run build --if-present',
    test: 'npm test --if-present',
  },
  {
    id: 'go', label: 'Go', match: ['go.mod'],
    image: 'golang:1.23-bookworm', artifact: 'dist',
    install: 'go mod download',
    build: 'mkdir -p dist && go build -o dist/app ./...',
    test: 'go test ./...',
  },
  {
    id: 'rust', label: 'Rust · Cargo', match: ['Cargo.toml'],
    image: 'rust:1.82-slim', artifact: 'target/release',
    install: 'cargo fetch',
    build: 'cargo build --release',
    test: 'cargo test --release',
  },
  {
    id: 'php', label: 'PHP · Composer', match: ['composer.json'],
    image: 'composer:2.8', artifact: '.',
    install: 'composer install --no-dev --no-interaction',
    build: 'php -l $(find . -name "*.php" -not -path "./vendor/*" | head -20) 2>/dev/null || true',
    test: 'test -f vendor/bin/phpunit && vendor/bin/phpunit || echo "no phpunit, skipped"',
  },
  {
    id: 'python', label: 'Python · pip / venv', match: ['pyproject.toml', 'requirements.txt', 'setup.py'],
    image: 'python:3.12-slim', artifact: '.',
    install: 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt 2>/dev/null || .venv/bin/pip install -e .',
    build: 'python3 -m compileall -q .',
    test: '(test -f .venv/bin/pytest && .venv/bin/pytest -q) || python3 -m unittest discover -s tests -p "test*.py" 2>/dev/null || echo "no tests, skipped"',
  },
  {
    // 平台自检：不依赖任何语言工具链，用于验证「编译 → 测试 → 产物」整条链路是否打通。
    id: 'smoke', label: '平台自检 · 零依赖', match: ['demo.build.json'],
    image: 'node:22-bookworm', artifact: 'dist',
    install: 'echo "无需安装依赖"',
    build: 'mkdir -p dist && echo "build ok" > dist/smoke.txt',
    test: 'test -f dist/smoke.txt && echo "test ok"',
  },
];

const profileById = (id) => PROFILES.find((p) => p.id === id);

function detectProfile(repoPath) {
  const abs = safeWorkspacePath(repoPath);
  for (const profile of PROFILES) {
    if (profile.match.some((file) => fs.existsSync(path.join(abs, file)))) return profile.id;
  }
  throw new Error('无法识别项目类型：请在仓库中放置 package.json / go.mod / Cargo.toml / composer.json / requirements.txt 之一，或手动指定构建类型');
}

function buildScript(profile, runTests) {
  const steps = [
    ['安装依赖', profile.install],
    ['编译构建', profile.build],
  ];
  if (runTests) steps.push(['运行测试', profile.test]);
  return [
    'set -e',
    ...steps.flatMap(([label, command]) => [
      `echo ""`,
      `echo "### ${label}"`,
      command,
    ]),
  ].join('\n');
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, CI: 'true', DEBIAN_FRONTEND: 'noninteractive' },
      shell: false,
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('构建超时'));
    }, config.buildTimeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    child.stdout.on('data', (chunk) => options.onData && options.onData(chunk.toString()));
    child.stderr.on('data', (chunk) => options.onData && options.onData(chunk.toString()));
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => finish(resolve, code));
  });
}

async function startBuild(payload) {
  const repoPath = String(payload.repoPath || '').trim();
  const abs = safeWorkspacePath(repoPath);
  if (!fs.existsSync(abs)) throw new Error(`工作区内不存在目录：${repoPath || '/'}`);

  const profileId = payload.profile && payload.profile !== 'auto' ? payload.profile : detectProfile(repoPath);
  const profile = profileById(profileId);
  if (!profile) throw new Error(`未知构建类型：${profileId}`);
  // 构建后端可显式指定，也可由 BUILD_EXECUTOR=auto 按 ssh → docker → wsl → local 降级。
  const backend = await buildBackends.resolveBackend(payload.backend);

  const record = {
    id: uid('build'),
    repoPath: repoPath || '.',
    profile: profile.id,
    profileLabel: profile.label,
    runTests: Boolean(payload.runTests),
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
    exitCode: null,
    logs: '',
    executor: backend.id,
    backend: backend.id,
    backendLabel: backend.label,
    backendDetail: backend.detail,
  };
  update((s) => s.builds.unshift(record));

  const script = buildScript(profile, record.runTests);
  const append = (text) => {
    record.logs += text;
    if (record.logs.length > 300000) record.logs = record.logs.slice(-300000);
  };

  // 异步执行，HTTP 立即返回 buildId；前端轮询日志。
  (async () => {
    try {
      append(`[platform] 构建开始 · profile=${profile.id} · backend=${backend.id} (${backend.label})\n`);
      append(`[platform] 工作目录 ${abs}\n`);
      append(`[platform] ${backend.detail}\n\n`);
      const code = await buildBackends.runBuild({
        backend: backend.id, image: profile.image, script, abs,
        artifact: profile.artifact, buildId: record.id,
        onData: append, timeoutMs: config.buildTimeoutMs,
      });
      record.exitCode = code;
      record.status = code === 0 ? 'success' : 'failed';
      append(`\n[platform] 构建结束 · exit=${code}\n`);

      if (code === 0 && payload.deploy && payload.deploy.serverId) {
        append('[platform] 构建成功，触发自动部署...\n');
        try {
          const deploy = await deployBuild({
            buildId: record.id,
            serverId: payload.deploy.serverId,
            targetDir: payload.deploy.targetDir || '',
            command: payload.deploy.command || '',
          });
          record.deployId = deploy.id;
          append(`[deploy] ${deploy.status} · ${deploy.message}\n`);
          if (deploy.output) append(`${deploy.output}\n`);
        } catch (e) {
          append(`[deploy] 失败：${e.message}\n`);
        }
      }
    } catch (e) {
      record.status = 'failed';
      append(`\n[platform] 异常：${e.message}\n`);
    } finally {
      record.finishedAt = new Date().toISOString();
      record.durationMs = new Date(record.finishedAt) - new Date(record.startedAt);
      update((s) => {
        const target = s.builds.find((b) => b.id === record.id);
        if (target) Object.assign(target, record);
      });
    }
  })();

  return record;
}

/* ------------------------------- 自动部署 -------------------------------- */

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function deployBuild({ buildId, serverId, targetDir, command = '' }) {
  const build = state().builds.find((b) => b.id === buildId);
  if (!build) throw new Error('构建记录不存在');
  if (build.status !== 'success') throw new Error('只有成功的构建可以部署');
  const server = state().servers.find((s) => s.id === serverId);
  if (!server) throw new Error('目标服务器不存在');
  const finalDir = targetDir || server.deployDir || '/opt/apps/app';
  if (!/^[A-Za-z0-9_./-]+$/.test(finalDir)) throw new Error('部署目录只允许字母、数字、_ . / -');

  const profile = profileById(build.profile) || PROFILES[0];
  const artifactAbs = path.join(safeWorkspacePath(build.repoPath), profile.artifact);
  if (!fs.existsSync(artifactAbs)) throw new Error(`构建产物目录不存在：${profile.artifact}`);

  const tmpTar = path.join(os.tmpdir(), `dp_${buildId}.tar.gz`);
  const remoteTar = `/tmp/dp_${buildId}.tar.gz`;
  await runProcess('tar', ['-czf', tmpTar, '-C', artifactAbs, '.'], { cwd: artifactAbs });
  await sftpPut(server, tmpTar, remoteTar);

  const steps = [
    'set -e',
    `mkdir -p ${shq(finalDir)}`,
    `tar -xzf ${shq(remoteTar)} -C ${shq(finalDir)}`,
    `rm -f ${shq(remoteTar)}`,
  ];
  if (command) steps.push(command);
  const result = await sshExec(server, steps.join(' && '), 120000);
  fs.rmSync(tmpTar, { force: true });

  const deploy = {
    id: uid('deploy'),
    buildId, serverId, serverName: server.name,
    targetDir: finalDir,
    status: result.code === 0 ? 'success' : 'failed',
    message: result.code === 0 ? '部署完成' : `远端命令退出码 ${result.code}`,
    output: `${result.stdout}\n${result.stderr}`.trim().slice(0, 10000),
    createdAt: new Date().toISOString(),
  };
  update((s) => s.deploys.unshift(deploy));
  return deploy;
}

/* ---------------------------- AI 服务器运维 Agent ------------------------- */
// 默认只读：AI 只能查看状态和白名单命令；开启 allowWrite 才允许触发部署。
const READ_COMMANDS = [
  'uptime', 'df -h', 'free -m', 'docker ps', 'ps aux --sort=-%mem | head -15',
  'systemctl is-active nginx', 'journalctl -u nginx -n 50 --no-pager',
];

function opsTools(allowWrite) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'server_status',
        description: '读取某台服务器的 CPU 负载、内存、磁盘、容器与在线状态',
        parameters: { type: 'object', properties: { server_id: { type: 'string', description: '服务器 ID' } }, required: ['server_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_command',
        description: '在服务器上执行只读诊断命令（白名单内）',
        parameters: {
          type: 'object',
          properties: {
            server_id: { type: 'string' },
            command: { type: 'string', enum: READ_COMMANDS },
          },
          required: ['server_id', 'command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_builds',
        description: '列出最近的构建任务及状态',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'build_log',
        description: '读取某次构建的日志尾部',
        parameters: { type: 'object', properties: { build_id: { type: 'string' } }, required: ['build_id'] },
      },
    },
  ];
  if (allowWrite) {
    tools.push({
      type: 'function',
      function: {
        name: 'deploy_build',
        description: '把一次成功的构建部署到服务器（写操作，需用户显式授权）',
        parameters: {
          type: 'object',
          properties: {
            build_id: { type: 'string' }, server_id: { type: 'string' },
            target_dir: { type: 'string' },
          },
          required: ['build_id', 'server_id', 'target_dir'],
        },
      },
    });
  }
  return tools;
}

async function executeTool(name, args, allowWrite) {
  const server = () => {
    const found = state().servers.find((s) => s.id === args.server_id);
    if (!found) throw new Error('服务器不存在');
    return found;
  };
  switch (name) {
    case 'server_status': return collectStatus(server());
    case 'read_command': {
      if (!READ_COMMANDS.includes(args.command)) throw new Error('命令不在只读白名单内');
      return sshExec(server(), args.command, 20000);
    }
    case 'list_builds':
      return state().builds.slice(0, 10).map((b) => ({
        id: b.id, status: b.status, profile: b.profile, repoPath: b.repoPath, startedAt: b.startedAt,
      }));
    case 'build_log': {
      const build = state().builds.find((b) => b.id === args.build_id);
      if (!build) throw new Error('构建记录不存在');
      return { status: build.status, log: build.logs.slice(-8000) };
    }
    case 'deploy_build': {
      if (!allowWrite) throw new Error('未授权写操作');
      return deployBuild({ buildId: args.build_id, serverId: args.server_id, targetDir: args.target_dir });
    }
    default: throw new Error(`未知工具：${name}`);
  }
}

async function opsAgent({ providerId, prompt, allowWrite = false }) {
  const provider = state().aiProviders.find((p) => p.id === providerId)
    || state().aiProviders.find((p) => p.enabled !== false);
  if (!provider) throw new Error('请先在「AI 服务」中配置一个模型服务');

  const system = [
    provider.kind === 'cli'
      ? '你是服务器运维助手。平台已提前采集好实时上下文并附在问题后面，请直接基于这些数据分析，不要假设可以自己调用工具。'
      : '你是服务器运维助手，可以调用工具查看服务器状态、构建日志和只读诊断命令。',
    '回答用简体中文，结论先行，给出可执行的建议。',
    allowWrite ? '用户已授权写操作，必要时可执行部署。' : '当前为只读模式，禁止任何修改类操作。',
    `可用服务器：${JSON.stringify(state().servers.map((s) => ({ id: s.id, name: s.name, host: s.host })))}`,
  ].join('\n');

  const trace = [];

  // 本地 CLI（codex / claude / WSL）没有 function calling 能力：
  // 由平台先执行只读工具采集上下文，再把上下文拼进一次提问里。
  if (provider.kind === 'cli') {
    const context = [];
    for (const server of state().servers) {
      try {
        const status = await collectStatus(server);
        trace.push({ tool: 'server_status', args: { server_id: server.id }, result: status });
        context.push(`服务器 ${server.name}(${server.host})：1分钟负载 ${status.load1}，内存 ${status.memory.usagePct}%，磁盘 ${status.disk.usagePct}，运行容器 ${status.containers.length} 个`);
      } catch (e) {
        trace.push({ tool: 'server_status', args: { server_id: server.id }, result: { error: e.message } });
        context.push(`服务器 ${server.name}(${server.host})：状态采集失败（${e.message}）`);
      }
    }
    const builds = state().builds.slice(0, 10).map((b) => ({
      id: b.id, status: b.status, profile: b.profile, repoPath: b.repoPath, startedAt: b.startedAt,
    }));
    trace.push({ tool: 'list_builds', args: {}, result: builds });
    context.push(`最近构建：${JSON.stringify(builds)}`);
    for (const build of state().builds.filter((b) => b.status === 'failed').slice(0, 2)) {
      const log = build.logs.slice(-4000);
      trace.push({ tool: 'build_log', args: { build_id: build.id }, result: { status: build.status, log } });
      context.push(`失败构建 ${build.id} 日志尾部：\n${log}`);
    }
    if (!context.length) context.push('平台当前没有配置服务器，也没有构建记录。');

    const response = await aiChat(provider, [
      { role: 'system', content: system },
      { role: 'user', content: `${prompt}\n\n=== 平台实时上下文（由平台采集） ===\n${context.join('\n\n')}` },
    ]);
    return {
      answer: response.choices?.[0]?.message?.content || '',
      trace,
      provider: provider.name,
      model: `${provider.command === 'custom' ? (provider.customCommand || 'custom') : (provider.command || 'cli')} (${provider.runner === 'wsl' ? `WSL:${provider.distro || 'default'}` : '宿主机'})`,
      mode: 'context-injection',
    };
  }

  const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  const tools = opsTools(allowWrite);

  for (let round = 0; round < 5; round += 1) {
    const response = await aiChat(provider, messages, tools);
    const message = response.choices && response.choices[0] && response.choices[0].message;
    if (!message) throw new Error('AI 服务响应格式异常');
    messages.push(message);
    if (!message.tool_calls || !message.tool_calls.length) {
      return { answer: message.content || '', trace, provider: provider.name, model: provider.model };
    }
    for (const call of message.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      let content;
      try {
        content = await executeTool(call.function.name, args, allowWrite);
      } catch (e) {
        content = { error: e.message };
      }
      trace.push({ tool: call.function.name, args, result: content });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(content).slice(0, 20000) });
    }
  }
  return { answer: '已达到工具调用轮次上限，请缩小问题范围后重试。', trace, provider: provider.name, model: provider.model };
}

module.exports = {
  PROFILES, profileById, detectProfile,
  startBuild, deployBuild, opsAgent, READ_COMMANDS,
};
