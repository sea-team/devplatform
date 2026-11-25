'use strict';

/**
 * v0.3.10 · 工作区仓库的 Git 命令操作；v0.4.31 完整版扩展为 TortoiseGit 式工作台后端。
 *
 * 仓库列表里点开一个本地仓库后，除了文件管理与 IDE，还需要能直接跑常用 git 命令。
 * 平台可能跑在没有 Git 的精简容器里（246 就是这种情况），因此这里和 clone 一样走双通道：
 *   容器内有 Git → gitRuntime.exec(['-C', <工作区路径>, ...])
 *   容器内无 Git → 借 SSH 宿主机执行 git -C <HOST_WORKSPACE_DIR>/<repo> ...
 *
 * 安全边界（这条接口能执行 git，必须收紧）：
 *  - 仓库名只能是工作区一级目录名，且必须存在自包含的 .git（防向上逃逸误伤平台自身仓库）；
 *  - 子命令白名单；写操作按 classifyCommand(cmd,args) 精确判定并做仓库级写权限校验；
 *  - 参数禁止 shell 元字符、换行与可越权的 --git-dir / --work-tree / -c / --exec 等；
 *  - 输出里可能带凭据的 URL 统一脱敏；绝不拼接成任意 shell 命令；
 *  - 结构化只读视图（gitView.js）与显式动作（action）都复用本模块的 run() 与校验。
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
  // v0.4.31 完整版：补齐 TortoiseGit「Create Branch / Switch / Tag / Clean up」等常用动作。
  'clean', 'rm', 'mv', 'blame', 'config', 'reflog', 'cat-file', 'for-each-ref',
]);
// 上面这一行 "'add', 'commit', 'push', 'merge', 'revert', 'reset', 'restore', 'stash', 'checkout'"
// 同时是 scripts/check-frontend.js 的静态护栏锚点，请勿拆行 / 改写（护栏保障写白名单不被误删）。
// 会改变工作区或远端状态的子命令（粗粒度基线，供前端按钮着色与历史语义兼容）。
// 注意：branch / tag / stash / clean / remote / config 属于「混合命令」，既有只读用法
// 也有写用法，不能整体归入本集合，否则 `git branch -a -vv` 这种列表也会被要求写权限。
// 精确判定统一走 classifyCommand(cmd, args)。
const WRITE_COMMANDS = new Set([
  'fetch', 'pull', 'add', 'commit', 'push', 'merge', 'revert', 'reset',
  'restore', 'stash', 'checkout', 'clean', 'rm', 'mv',
]);
// 破坏性写操作（前端需二次确认；仓库级写权限仍由 server 路由校验）。
const DESTRUCTIVE_COMMANDS = new Set([
  'reset', 'revert', 'merge', 'checkout', 'restore', 'clean', 'rm',
]);
// 混合命令：参数决定读 / 写，由 isReadOnlyForm 逐个识别查看类用法。
const MIXED_COMMANDS = new Set(['branch', 'tag', 'stash', 'clean', 'remote', 'config']);
const FORBIDDEN_ARGS = /[;&|`$<>\n\r\\]|^\s*-c\s*$|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config-env/;
// 会把「工作区外路径」带进 git 的合法选项：仅靠上面的字符黑名单拦不住
// （`git diff --no-index /app/data/state.json /tmp/x` 一个斜杠都不违规，却能把
// 平台凭据库读出来；`--file` / `--pathspec-from-file` 同理）。按选项名单独拒绝。
const FORBIDDEN_OPTIONS = /^(?:--no-index|--file|--pathspec-from-file|--output(?:-directory)?|--exec|--upload-pack|--receive-pack|--git-dir|--work-tree|--config-env|-F)(?:=|$)/;
const MAX_ARGS = 12;
const MAX_ARG_LEN = 500; // 放宽以容纳 commit -m 的提交说明；危险字符仍由 FORBIDDEN_ARGS 拦截

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** 混合命令的「只读用法」识别：所有参数都必须落在查看类选项里，出现写标志或对象名即视为写。 */
function isReadOnlyForm(cmd, list) {
  if (list.length === 0) return ['branch', 'tag', 'stash', 'remote', 'config'].includes(cmd);
  const first = list[0];
  const every = (re) => list.every((x) => re.test(x));
  switch (cmd) {
    case 'clean':
      // -n/--dry-run 只预览；一旦同时带 -f/--force 就是真删。
      return /^-n$|^--dry-run$/.test(first) && !list.some((x) => /^-f$|^-ff$|^--force$/.test(x));
    case 'stash':
      return /^list$|^show$/.test(first);
    case 'branch':
      return every(/^(?:-[arvq]{1,3}|--all|--remotes|--verbose|--list|--contains|--no-contains|--merged|--no-merged|--points-at|--column|--abbrev|--color(?:=[^=]+)?|--no-color|--quiet|-(?:sort|format|merged|no-merged|contains|points-at|abbrev)=.*)$/);
    case 'tag':
      return every(/^(?:-l|--list|-n|--format|--sort|--color(?:=[^=]+)?|--points-at|--contains|--no-contains|--merged|--no-merged|--column|--ignore-case|-i|--(?:sort|format|points-at|contains|merged|no-merged|abbrev)=.*)$/);
    case 'remote':
      return /^(?:-v|--verbose|show|get-url)$/.test(first);
    case 'config':
      return /^(?:--get|--get-all|--get-regexp|--list|--name-only|--null|--type|--default|--get-urlmatch)$/.test(first) || /^-l$/.test(first);
    default:
      return false;
  }
}

/**
 * 精确的读 / 写 / 破坏性分类，是权限判断的唯一权威。
 * - 天然只读命令（status/log/show/diff/...）永远只读；
 * - WRITE_COMMANDS 里的命令默认写；
 * - 混合命令按 isReadOnlyForm 判定，非只读用法一律按写处理（含 remote add / config set）。
 */
function classifyCommand(cmd, args = []) {
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];
  const destructive = DESTRUCTIVE_COMMANDS.has(cmd);
  if (MIXED_COMMANDS.has(cmd)) {
    return isReadOnlyForm(cmd, list)
      ? { write: false, destructive: false }
      : { write: true, destructive: destructive || /^-d$|^-D$|^--delete$/.test(list[0] || '') };
  }
  return { write: WRITE_COMMANDS.has(cmd), destructive };
}

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

/**
 * 前端快捷命令（顺序即展示顺序）。v0.4.31 起每条带 group / ico / hint，
 * 供 TortoiseGit 式工作台按标签分组渲染，并区分只读 / 写 / 破坏性。
 */
function presets() {
  return [
    // 状态 / 提交
    { key: 'status', group: 'status', ico: '◉', label: '状态', command: 'status', args: ['--short', '--branch'] },
    { key: 'log', group: 'log', ico: '≡', label: '日志', command: 'log', args: ['--oneline', '--decorate', '-n', '30'] },
    { key: 'branch', group: 'branch', ico: '⑂', label: '分支列表', command: 'branch', args: ['-a', '-vv'] },
    { key: 'remote', group: 'sync', ico: '⇄', label: '远程地址', command: 'remote', args: ['-v'] },
    { key: 'diff', group: 'status', ico: '±', label: '差异对比', command: 'diff', args: ['--stat'] },
    { key: 'diff-full', group: 'status', ico: '±', label: '完整差异', command: 'diff', args: [] },
    { key: 'diff-staged', group: 'status', ico: '±', label: '暂存区差异', command: 'diff', args: ['--cached', '--stat'] },
    // 同步
    { key: 'fetch', group: 'sync', ico: '↓', label: '拉取元数据 (fetch)', command: 'fetch', args: ['--all', '--prune'], write: true },
    { key: 'pull', group: 'sync', ico: '⇣', label: '拉取更新 (pull)', command: 'pull', args: ['--ff-only'], write: true },
    { key: 'push', group: 'sync', ico: '⇡', label: '推送 (push)', command: 'push', args: [], write: true, hint: '推送当前分支到默认远端' },
    // 提交
    { key: 'add', group: 'commit', ico: '+', label: '暂存全部改动', command: 'add', args: ['-A'], write: true },
    { key: 'commit', group: 'commit', ico: '✓', label: '提交', command: 'commit', args: ['-m', 'chore: platform git commit'], write: true, needMessage: true, hint: '需填写提交说明；自定义命令可用 commit -m "说明"' },
    // 冲突 / 还原
    { key: 'merge-abort', group: 'conflict', ico: '⊘', label: '中止合并', command: 'merge', args: ['--abort'], write: true, destructive: true, hint: '放弃进行中的合并' },
    { key: 'revert', group: 'conflict', ico: '↶', label: '还原提交', command: 'revert', args: ['--no-edit', 'HEAD'], write: true, destructive: true, needHash: true, hint: '默认还原最近一次提交；自定义命令可指定 commit' },
    { key: 'reset', group: 'conflict', ico: '↺', label: '重置到上一次', command: 'reset', args: ['--hard', 'HEAD~1'], write: true, destructive: true, hint: 'hard 重置会丢弃本地未提交改动，请谨慎' },
    { key: 'restore', group: 'conflict', ico: '↩', label: '放弃本地改动', command: 'restore', args: ['.'], write: true, destructive: true, hint: '放弃工作区所有未暂存改动' },
    // v0.4.31 新增：分支 / 标签 / 清理 / Stash
    { key: 'checkout', group: 'branch', ico: '⇄', label: '切换 / 检出 (checkout)', command: 'checkout', args: [], write: true, destructive: true, needText: true, hint: '切换到已存在的分支或提交；会改变工作区，请确认本地改动已备份' },
    { key: 'branch-new', group: 'branch', ico: '＋', label: '新建分支', command: 'branch', args: [], write: true, needText: true, hint: '填写新分支名' },
    { key: 'branch-del', group: 'branch', ico: '−', label: '删除分支', command: 'branch', args: ['-d'], write: true, destructive: true, needText: true, hint: '填写要删除的分支名（-d 安全删除）' },
    { key: 'merge', group: 'branch', ico: '⤳', label: '合并分支 (merge)', command: 'merge', args: [], write: true, destructive: true, needText: true, hint: '填写要合并进当前分支的分支名' },
    { key: 'tag-list', group: 'tag', ico: '⌗', label: '标签列表', command: 'tag', args: ['-n'] },
    { key: 'tag-new', group: 'tag', ico: '＋', label: '新建标签', command: 'tag', args: [], write: true, needText: true, hint: '填写标签名，附注信息可在自定义命令里用 -a -m' },
    { key: 'tag-del', group: 'tag', ico: '−', label: '删除标签', command: 'tag', args: ['-d'], write: true, destructive: true, needText: true, hint: '填写要删除的标签名' },
    { key: 'stash-list', group: 'stash', ico: '≡', label: 'Stash 列表', command: 'stash', args: ['list'] },
    { key: 'stash-save', group: 'stash', ico: '↓', label: 'Stash 保存', command: 'stash', args: ['push', '-u'], write: true, needText: true, hint: '可填写 stash 说明；包含未跟踪文件' },
    { key: 'stash-pop', group: 'stash', ico: '↑', label: 'Stash 弹出 (pop)', command: 'stash', args: ['pop'], write: true, destructive: true, hint: '恢复并删除最近一条 stash' },
    { key: 'stash-apply', group: 'stash', ico: '⇧', label: 'Stash 应用 (apply)', command: 'stash', args: ['apply'], write: true, hint: '恢复最近一条 stash 但不删除' },
    { key: 'stash-drop', group: 'stash', ico: '⊗', label: 'Stash 丢弃 (drop)', command: 'stash', args: ['drop'], write: true, destructive: true, hint: '删除最近一条 stash' },
    { key: 'clean-preview', group: 'clean', ico: '◇', label: '清理预览 (-n)', command: 'clean', args: ['-n', '-d'] },
    { key: 'clean-do', group: 'clean', ico: '✕', label: '清理未跟踪文件', command: 'clean', args: ['-f', '-d'], write: true, destructive: true, hint: 'TortoiseGit「Clean up」等价动作，会永久删除未跟踪文件' },
    { key: 'reflog', group: 'log', ico: '◷', label: '操作记录 (reflog)', command: 'reflog', args: ['-n', '20'] },
  ];
}

/** 工作台分组定义（供前端渲染标签与说明）。 */
function groups() {
  return [
    { id: 'status', label: '工作区状态', ico: '◉', desc: '查看文件改动、差异与冲突' },
    { id: 'log', label: '提交日志', ico: '≡', desc: '历史提交、分支图与提交详情' },
    { id: 'commit', label: '提交', ico: '✓', desc: '逐文件暂存并填写提交说明' },
    { id: 'branch', label: '分支 / 合并', ico: '⑂', desc: '分支列表、切换、新建、删除与合并' },
    { id: 'sync', label: '同步', ico: '⇄', desc: 'Fetch / Pull / Push 与远程地址' },
    { id: 'stash', label: 'Stash 储藏', ico: '↓', desc: '保存 / 应用 / 弹出 / 丢弃' },
    { id: 'tag', label: '标签', ico: '⌗', desc: '列出 / 新建 / 删除标签' },
    { id: 'conflict', label: '冲突 / 还原', ico: '⊘', desc: '中止合并、还原、重置、放弃改动' },
    { id: 'clean', label: '清理', ico: '◇', desc: 'Clean up：预览并删除未跟踪文件' },
    { id: 'custom', label: '自定义命令', ico: '⌘', desc: '输入白名单内的任意 Git 子命令与参数' },
  ];
}

/**
 * @param {{ repo?: string, command?: string, args?: string[], timeoutMs?: number }} [options]
 * @returns {Promise<{ repo: string, path: string, relativePath: string, command: string,
 *   args: string[], write: boolean, destructive: boolean, commandText: string,
 *   channel: string, channelLabel: string, code: number, output: string, gitVersion: string,
 *   hostPath?: string }>}
 */
async function run({ repo, command, args = [], timeoutMs = 60000 } = {}) {
  const { name, target, cmd, list } = validate(repo, command, args);
  const local = gitRuntime.resolve();
  const commandText = `git -C ${target} ${[cmd, ...list].join(' ')}`;
  const cls = classifyCommand(cmd, list);
  const base = {
    repo: name,
    path: target,
    relativePath: relativeWorkspacePath(target),
    command: cmd,
    args: list,
    write: cls.write,
    destructive: cls.destructive,
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

module.exports = {
  run, presets, groups, classifyCommand, validate, scrub,
  ALLOWED_COMMANDS, WRITE_COMMANDS, DESTRUCTIVE_COMMANDS,
};
