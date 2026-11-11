'use strict';

/**
 * v0.3.10 · 工作区仓库的 Git 命令操作。
 *
 * 仓库列表里点开一个本地仓库后，除了文件管理与 IDE，还需要能直接跑常用 git 命令。
 * 平台可能跑在没有 Git 的精简容器里（246 就是这种情况），因此这里和 clone 一样走双通道：
 *   容器内有 Git → gitRuntime.exec(['-C', <工作区路径>, ...])
 *   容器内无 Git → 借 SSH 宿主机执行 git -C <HOST_WORKSPACE_DIR>/<repo> ...
 *
 * 安全边界（这条接口能执行 git，必须收紧）：
 *  - 仓库名只能是工作区一级目录名，且必须存在 .git；
 *  - 子命令白名单，写操作只放开 fetch / pull；
 *  - 参数禁止 shell 元字符、换行与可越权的 --git-dir / --work-tree / -c / --exec 等；
 *  - 输出里可能带凭据的 URL 统一脱敏；绝不拼接成任意 shell 命令。
 */
const fs = require('fs');
const path = require('path');
const { config, state, safeWorkspacePath, relativeWorkspacePath, HttpError } = require('./core');
const gitRuntime = require('./gitRuntime');
const { sshExec } = require('./integrations');

const ALLOWED_COMMANDS = new Set([
  'status', 'log', 'branch', 'remote', 'fetch', 'pull', 'diff', 'show',
  'rev-parse', 'ls-files', 'tag', 'describe', 'rev-list', 'ls-remote',
]);
const WRITE_COMMANDS = new Set(['fetch', 'pull']);
const FORBIDDEN_ARGS = /[;&|`$<>\n\r\\]|^\s*-c\s*$|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config-env/;
const MAX_ARGS = 12;
const MAX_ARG_LEN = 160;

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function scrub(text) {
  return String(text || '')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1******@')
    .replace(/(https?:\/\/)([^/\s]+@)/gi, '$1******@');
}

function validate(repo, command, args) {
  const name = String(repo || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') {
    throw new HttpError(400, '仓库名不合法：只能是工作区内一级目录名');
  }
  const target = safeWorkspacePath(name);
  if (!fs.existsSync(target) || !fs.existsSync(path.join(target, '.git'))) {
    throw new HttpError(404, `工作区内没有这个 Git 仓库：${name}`);
  }
  const cmd = String(command || '').trim();
  if (!ALLOWED_COMMANDS.has(cmd)) {
    throw new HttpError(400, `不支持的 Git 子命令：${cmd || '(空)'}。可用：${[...ALLOWED_COMMANDS].join(', ')}`);
  }
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];
  if (list.length > MAX_ARGS) throw new HttpError(400, `参数过多（最多 ${MAX_ARGS} 个）`);
  for (const a of list) {
    if (a.length > MAX_ARG_LEN || FORBIDDEN_ARGS.test(a)) {
      throw new HttpError(400, `参数含不允许的字符或选项：${a.slice(0, 60)}`);
    }
  }
  return { name, target, cmd, list };
}

/** 前端快捷命令（顺序即展示顺序）。 */
function presets() {
  return [
    { key: 'status', label: '状态', command: 'status', args: ['--short', '--branch'] },
    { key: 'log', label: '最近提交', command: 'log', args: ['--oneline', '--decorate', '-n', '12'] },
    { key: 'branch', label: '分支', command: 'branch', args: ['-a', '-vv'] },
    { key: 'remote', label: '远程地址', command: 'remote', args: ['-v'] },
    { key: 'diff', label: '改动统计', command: 'diff', args: ['--stat'] },
    { key: 'fetch', label: '拉取元数据 (fetch)', command: 'fetch', args: ['--all', '--prune'], write: true },
    { key: 'pull', label: '更新当前分支 (pull)', command: 'pull', args: ['--ff-only'], write: true },
  ];
}

async function run({ repo, command, args = [], timeoutMs = 60000 } = {}) {
  const { name, target, cmd, list } = validate(repo, command, args);
  const local = gitRuntime.resolve();
  const commandText = `git -C ${target} ${[cmd, ...list].join(' ')}`;
  const base = {
    repo: name,
    path: target,
    relativePath: relativeWorkspacePath(target),
    command: cmd,
    args: list,
    write: WRITE_COMMANDS.has(cmd),
    commandText,
  };

  if (local.available) {
    const r = await gitRuntime.exec(['-C', target, cmd, ...list], { timeoutMs });
    return {
      ...base,
      channel: 'local', channelLabel: '平台容器 / 本机',
      code: r.code, output: scrub(r.output).slice(-20000),
      gitVersion: local.version,
    };
  }

  const fb = gitRuntime.fallback();
  if (!fb.ready) {
    throw new HttpError(400, `当前环境没有可用的 Git：${fb.reason || 'SSH 宿主机兜底未就绪'}`, {
      errorCode: 'GIT_BIN_MISSING',
    });
  }
  const server = (state().servers || []).find((s) => s.id === fb.serverId);
  if (!server) throw new HttpError(400, `SSH 服务器 ${fb.serverId} 不存在`);
  const hostPath = path.posix.join(fb.hostWorkspaceDir || '/workspace', name);
  const remoteCmd = [
    'git --version >/dev/null 2>&1 || { echo GIT_MISSING; exit 2; }',
    `git -C ${shQuote(hostPath)} ${cmd} ${list.map(shQuote).join(' ')} 2>&1`,
  ].join('; ');
  const r = await sshExec(server, remoteCmd, timeoutMs);
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  if (/GIT_MISSING/.test(text)) {
    throw new HttpError(400, `SSH 宿主机「${server.name}」上也没有 Git，无法执行 ${cmd}`);
  }
  const hostGit = gitRuntime.hostGitSummary();
  return {
    ...base,
    hostPath,
    channel: 'ssh-host', channelLabel: `SSH 宿主机 ${server.name}（${server.host}）`,
    code: r.code, output: scrub(text).slice(-20000),
    gitVersion: hostGit.version || '',
    commandText: `git -C ${hostPath} ${[cmd, ...list].join(' ')}`,
  };
}

module.exports = { run, presets, ALLOWED_COMMANDS, WRITE_COMMANDS };
