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
  // v0.4.16 B 批：TortoiseGit 式写操作。提交 / 推送 / 中止合并 / 还原 / 重置 / 暂存。
  'add', 'commit', 'push', 'merge', 'revert', 'reset', 'restore', 'stash', 'checkout',
]);
// 会改变工作区或远端状态的子命令：除 fetch 外都需要仓库级写权限。
const WRITE_COMMANDS = new Set([
  'fetch', 'pull', 'add', 'commit', 'push', 'merge', 'revert', 'reset',
  'restore', 'stash', 'checkout',
]);
// 破坏性写操作（前端需二次确认；仓库级写权限仍由 server 路由校验）。
const DESTRUCTIVE_COMMANDS = new Set(['reset', 'revert', 'merge', 'checkout', 'restore']);
const FORBIDDEN_ARGS = /[;&|`$<>\n\r\\]|^\s*-c\s*$|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config-env/;
// 会把「工作区外路径」带进 git 的合法选项：仅靠上面的字符黑名单拦不住
// （`git diff --no-index /app/data/state.json /tmp/x` 一个斜杠都不违规，却能把
// 平台凭据库读出来；`--file` / `--pathspec-from-file` 同理）。按选项名单独拒绝。
const FORBIDDEN_OPTIONS = /^(?:--no-index|--file|--pathspec-from-file|--output(?:-directory)?|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config-env|-F)(?:=|$)/;
const MAX_ARGS = 12;
const MAX_ARG_LEN = 500; // 放宽以容纳 commit -m 的提交说明；危险字符仍由 FORBIDDEN_ARGS 拦截

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * 防止「残缺 .git 向上逃逸」：git -C <dir> 遇到不完整/无效的 .git 时，
 * 会继续向父目录寻找外层仓库并对它执行写命令（如 reset --hard），
 * 从而误伤平台自身代码仓库。导入的纯 .git 包尤其容易触发（只有 HEAD/config，
 * 缺 objects/refs）。这里要求目标目录自身就是一个自包含的有效 git 仓库。
 * - .git 必须是目录（worktree 的 gitdir: 文件不适用于导入仓库，直接拒绝）；
 * - 必须具备 objects/ 与 refs/ 两个核心目录；
 * - HEAD 必须存在。
 */
function assertSelfContainedRepo(target, name) {
  const gitDir = path.join(target, '.git');
  let st;
  try { st = fs.statSync(gitDir); } catch { throw new HttpError(404, `工作区内没有这个 Git 仓库：${name}`); }
  if (!st.isDirectory()) {
    throw new HttpError(400, `仓库 ${name} 的 .git 不是完整目录（可能是 worktree 链接），拒绝执行 Git 命令`);
  }
  for (const sub of ['objects', 'refs']) {
    try {
      if (!fs.statSync(path.join(gitDir, sub)).isDirectory()) {
        throw new Error('not a dir');
      }
    } catch {
      throw new HttpError(400, `仓库 ${name} 的 .git 不完整（缺少 ${sub}/），拒绝执行 Git 命令以避免误操作外层仓库`);
    }
  }
  if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
    throw new HttpError(400, `仓库 ${name} 的 .git 不完整（缺少 HEAD），拒绝执行 Git 命令`);
  }
}

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
  // 关键防线：残缺 .git 会让 git 向上逃逸到外层仓库（平台自身代码库），
  // 造成 reset/restore 等写命令误伤未提交改动。必须是自包含仓库才放行。
  assertSelfContainedRepo(target, name);
  const cmd = String(command || '').trim();
  if (!ALLOWED_COMMANDS.has(cmd)) {
    throw new HttpError(400, `不支持的 Git 子命令：${cmd || '(空)'}。可用：${[...ALLOWED_COMMANDS].join(', ')}`);
  }
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];
  if (list.length > MAX_ARGS) throw new HttpError(400, `参数过多（最多 ${MAX_ARGS} 个）`);
  for (const a of list) {
    if (a.length > MAX_ARG_LEN || FORBIDDEN_ARGS.test(a) || FORBIDDEN_OPTIONS.test(a.trim())) {
      throw new HttpError(400, `参数含不允许的字符或选项：${a.slice(0, 60)}`);
    }
  }
  return { name, target, cmd, list };
}

/** 前端快捷命令（顺序即展示顺序）。 */
function presets() {
  return [
    // 只读 / 查看类
    { key: 'status', label: '状态', command: 'status', args: ['--short', '--branch'] },
    { key: 'log', label: '日志', command: 'log', args: ['--oneline', '--decorate', '-n', '20'] },
    { key: 'branch', label: '分支', command: 'branch', args: ['-a', '-vv'] },
    { key: 'remote', label: '远程地址', command: 'remote', args: ['-v'] },
    { key: 'diff', label: '差异对比', command: 'diff', args: ['--stat'] },
    { key: 'diff-full', label: '完整差异', command: 'diff', args: [] },
    { key: 'diff-staged', label: '暂存区差异', command: 'diff', args: ['--cached', '--stat'] },
    // 同步类（写，需仓库写权限）
    { key: 'fetch', label: '拉取元数据 (fetch)', command: 'fetch', args: ['--all', '--prune'], write: true },
    { key: 'pull', label: '拉取更新 (pull)', command: 'pull', args: ['--ff-only'], write: true },
    { key: 'push', label: '推送 (push)', command: 'push', args: [], write: true, hint: '推送当前分支到默认远端' },
    // 提交类（写）
    { key: 'add', label: '暂存全部改动', command: 'add', args: ['-A'], write: true },
    { key: 'commit', label: '提交', command: 'commit', args: ['-m', 'chore: platform git commit'], write: true, needMessage: true, hint: '需填写提交说明；自定义命令可用 commit -m "说明"' },
    // 破坏性（写 + 前端二次确认）
    { key: 'merge-abort', label: '中止合并', command: 'merge', args: ['--abort'], write: true, destructive: true, hint: '放弃进行中的合并' },
    { key: 'revert', label: '还原提交', command: 'revert', args: ['--no-edit', 'HEAD'], write: true, destructive: true, needHash: true, hint: '默认还原最近一次提交；自定义命令可指定 commit' },
    { key: 'reset', label: '重置到上一次', command: 'reset', args: ['--hard', 'HEAD~1'], write: true, destructive: true, hint: 'hard 重置会丢弃本地未提交改动，请谨慎' },
    { key: 'restore', label: '放弃本地改动', command: 'restore', args: ['.'], write: true, destructive: true, hint: '放弃工作区所有未暂存改动' },
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
    destructive: DESTRUCTIVE_COMMANDS.has(cmd),
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

module.exports = { run, presets, ALLOWED_COMMANDS, WRITE_COMMANDS, DESTRUCTIVE_COMMANDS };
