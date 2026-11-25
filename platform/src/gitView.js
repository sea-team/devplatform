'use strict';

/**
 * v0.4.31 · TortoiseGit 式 Git 工作台的后端支撑层。
 *
 * 设计要点：
 *  1) 只读视图（view）：把 `git status/log/branch/show/diff/stash/tag/...` 的纯文本输出
 *     解析成结构化 JSON，供前端「状态 / 日志 / 分支 / 提交 / 同步 / Stash / 标签 / 冲突」
 *     多标签工作台渲染表格、分支图与 diff 着色。
 *  2) 语义动作（resolveAction）：把「暂存选中文件 / 提交 / 推送 / 新建分支 / Stash 保存」等
 *     用户意图翻译成受控的 git 命令，前端不再自由拼接子命令与参数。
 *  3) 全部复用 workspaceGit.run() 的双通道（本机 / SSH 宿主机）、仓库自包含校验、
 *     参数黑名单与 URL 脱敏，不新增任何执行路径。
 *  4) 只读防线：view 层内部逐条断言命令为只读，绝不允许视图接口变成写接口。
 *  5) 视图参数（hash / path / count / ref）单独做严格校验，不把任意用户输入拼进命令。
 */
const { HttpError } = require('./core');
const workspaceGit = require('./workspaceGit');

// git log --pretty=format: 会解释 %x1e / %x1f，输出真实 \x1e（记录分隔）/ \x1f（字段分隔），
// 避免中文与空格引起的歧义。分支 / 标签不用 for-each-ref 的多字段格式串（Windows Git
// 对含 %09 的复合格式串解析不稳定），改解析 branch -a -vv / tag -n 的纯文本。
const RS = '\x1e';
const US = '\x1f';
const LOG_FORMAT = '--pretty=format:%x1e%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b';
const STASH_FORMAT = '--pretty=format:%x1e%gd%x1f%gs%x1f%aI';

/* ------------------------------ 参数校验 ------------------------------ */
function clampCount(v, def = 50, max = 200) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}
/** 提交号 / 分支 / 标签 / stash ref：拒绝以 - 开头（防止被 git 当成选项）与 shell 元字符。 */
function safeRef(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 120 || s.startsWith('-') || !/^[A-Za-z0-9._~^@:/{}-]+$/.test(s)) {
    throw new HttpError(400, '提交号 / 分支名 / 引用不合法');
  }
  return s;
}
/** 工作区文件路径：拒绝越界 ..、绝对路径、以 - 开头与 shell 元字符。 */
function safePath(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 300 || s.startsWith('-') || /^[\\/]/.test(s)
      || s.split(/[\\/]/).includes('..')) {
    throw new HttpError(400, '文件路径不合法');
  }
  return s;
}
/** 把文件列表转成 `-- <p1> <p2>` 形式，避免文件名被当成选项；最多 20 个。 */
function pathsArg(paths) {
  const list = Array.isArray(paths) ? paths.map(safePath) : [];
  if (list.length > 20) throw new HttpError(400, '单次最多处理 20 个文件');
  return list.length ? ['--', ...list] : [];
}
function optRef(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? [safeRef(s)] : [];
}
function optMessage(v, field = '说明') {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new HttpError(400, `请填写${field}`);
  if (s.length > 300) throw new HttpError(400, `${field}过长（最多 300 字）`);
  return s;
}

/* ------------------------------ 文本解析 ------------------------------ */
function parseLog(text) {
  const commits = String(text || '')
    .split(RS)
    .filter((rec) => rec && rec.trim())
    .map((rec) => {
      const f = rec.split(US);
      const refs = (f[3] || '').split(',').map((x) => x.trim()).filter(Boolean);
      return {
        hash: f[0] || '', short: f[1] || '',
        parents: (f[2] || '').split(' ').filter(Boolean),
        refs, decorations: refs,
        author: f[4] || '', email: f[5] || '', date: f[6] || '',
        subject: f[7] || '', body: (f[8] || '').trim(),
      };
    });
  return { commits, total: commits.length };
}

function statusLabel(x, y) {
  const k = `${x}${y}`;
  if (k === '??') return '未跟踪';
  if (k === '!!') return '已忽略';
  if (x === 'U' || y === 'U' || k === 'AA' || k === 'DD') return '冲突';
  if (x === 'R' || y === 'R') return '重命名';
  if (x === 'C' || y === 'C') return '复制';
  if (x === 'A' || y === 'A') return '新增';
  if (x === 'D' || y === 'D') return '已删除';
  if (x === 'M' || y === 'M') return '已修改';
  if (x === 'T' || y === 'T') return '类型变更';
  return '改动';
}

/**
 * 反转义 git porcelain v1 的 C-style quoted path。
 * 当路径含空格 / 特殊字符（或 core.quotePath 生效时的非 ASCII 字节）时，git 会输出
 * 被双引号包裹的 C 字符串，例如 `?? "with space.txt"`，八进制字节写作 `\344\270\255`、
 * 控制字符写作 `\t \n \r \" \\` 等。不复原就会把 `"with space.txt"` 当成字面路径，
 * 后续 `git add -- "with space.txt"` 直接 exit 128（文件不存在）。
 * 未加引号的路径（含 UTF-8 中文原文）原样返回，不做任何改动。
 */
function unquotePath(s) {
  const str = String(s == null ? '' : s);
  if (str.length < 2 || str[0] !== '"') return str;
  const bytes = [];
  const ctrl = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
  let closed = false;
  let i = 1;
  for (; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '"') { closed = true; break; }
    if (ch !== '\\') {
      // 引号内未转义的字符：按 UTF-8 展开为字节，避免多字节字符被截成一个字节。
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
      continue;
    }
    const n = str[i + 1];
    if (n == null) break;
    if (n >= '0' && n <= '7' && /^[0-7]{3}$/.test(str.slice(i + 1, i + 4))) {
      bytes.push(parseInt(str.slice(i + 1, i + 4), 8));
      i += 3;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(ctrl, n)) {
      bytes.push(ctrl[n]);
      i += 1;
      continue;
    }
    // \" \\ \' 及 git 可能输出的其余 \x → 字面字符
    for (const b of Buffer.from(n, 'utf8')) bytes.push(b);
    i += 1;
  }
  if (!closed) return str; // 异常未闭合：保守返回原文，不猜
  return Buffer.from(bytes).toString('utf8');
}

/** 把 status 行的路径部分拆成 { path, origPath }，两侧都可能是 C-style quoted path。 */
function splitStatusPath(rest) {
  const take = (s) => {
    if (s[0] !== '"') {
      const idx = s.indexOf(' -> ');
      return idx < 0 ? { token: s, tail: '' } : { token: s.slice(0, idx), tail: s.slice(idx) };
    }
    let i = 1;
    for (; i < s.length; i += 1) {
      if (s[i] === '\\') { i += 1; continue; } // 跳过转义字符（含 \nnn 的后续字节）
      if (s[i] === '"') { i += 1; break; }
    }
    return { token: s.slice(0, i), tail: s.slice(i) };
  };
  const a = take(rest);
  if (!a.tail.startsWith(' -> ')) return { path: unquotePath(rest), origPath: '' };
  const b = take(a.tail.slice(4));
  return { path: unquotePath(b.token), origPath: unquotePath(a.token) };
}

function parseStatus(text) {
  const lines = String(text || '').split('\n');
  let branch = '(未知)';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  const files = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const head = line.slice(3);
      const m = head.match(/^(.+?)(?:\.\.\.(.+?))?(?: \[(.*)\])?$/);
      branch = (m && m[1]) || head;
      upstream = (m && m[2]) || '';
      const flags = (m && m[3]) || '';
      const am = flags.match(/ahead (\d+)/);
      const bm = flags.match(/behind (\d+)/);
      ahead = am ? Number(am[1]) : 0;
      behind = bm ? Number(bm[1]) : 0;
      continue;
    }
    const x = line[0] || ' ';
    const y = line[1] || ' ';
    const { path, origPath } = splitStatusPath(line.slice(3));
    files.push({
      x, y, path, origPath,
      label: statusLabel(x, y),
      staged: x !== ' ' && x !== '?' && x !== '!',
      unstaged: y !== ' ' && y !== '?',
      conflicted: x === 'U' || y === 'U' || `${x}${y}` === 'AA' || `${x}${y}` === 'DD',
    });
  }
  return {
    branch, upstream, ahead, behind,
    clean: files.length === 0,
    files,
    conflicts: files.filter((f) => f.conflicted).map((f) => f.path),
  };
}

function parseBranches(text) {
  // `git branch -a -vv` 每行形如：
  //   * master    185e95d [origin/master: ahead 1] first commit
  //     feature/x 185e95d first commit
  //     remotes/origin/main 185e95d first commit
  const branches = String(text || '')
    .split('\n').filter(Boolean)
    .map((line) => {
      const current = line[0] === '*';
      const body = line.replace(/^[* ]\s*/, '');
      const parts = body.split(/\s+/);
      const name = parts.shift() || '';
      const hash = /^[0-9a-f]{4,40}$/i.test(parts[0] || '') ? parts.shift() : '';
      const rest = parts.join(' ');
      const m = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
      const upstreamFull = m ? m[1] : '';
      const track = upstreamFull.replace(/^[^:]+:\s*/, '').replace(/^[^:]+$/, '');
      const upstream = upstreamFull.split(':')[0].replace(/:.*$/, '');
      return {
        refname: name.startsWith('remotes/') ? `refs/${name}` : `refs/heads/${name}`,
        name,
        hash,
        upstream,
        track,
        current,
        subject: m ? m[2] : rest,
        kind: name.startsWith('remotes/') ? 'remote' : 'local',
      };
    });
  return { branches };
}

function parseRemotes(text) {
  const lines = String(text || '').split('\n').filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], { name: m[1], fetch: '', push: '' });
    const e = map.get(m[1]);
    if (m[3] === 'fetch') e.fetch = m[2]; else e.push = m[2];
  }
  return { remotes: [...map.values()] };
}

function parseStash(text) {
  const stashes = String(text || '')
    .split(RS).filter((rec) => rec && rec.trim())
    .map((rec) => {
      const f = rec.split(US);
      return { ref: f[0] || '', message: f[1] || '', date: f[2] || '' };
    });
  return { stashes };
}

function parseTags(text) {
  // `git tag -n` 每行形如：v1.0            release one（tag 名后跟若干空格与首行附注）。
  const tags = String(text || '')
    .split('\n').filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\S+)\s+(.*)$/);
      return { name: m ? m[1] : line.trim(), hash: '', date: '', message: m ? m[2] : '' };
    });
  return { tags };
}

function parseNumstat(text) {
  return String(text || '')
    .split('\n').filter(Boolean)
    .map((line) => {
      const f = line.split('\t');
      const binary = f[0] === '-' || f[1] === '-';
      return {
        path: f[2] || '',
        added: binary ? 0 : (Number(f[0]) || 0),
        deleted: binary ? 0 : (Number(f[1]) || 0),
        binary,
      };
    });
}

const lines = (t) => String(t || '').split('\n').filter(Boolean);

/* ------------------------------ 视图定义 ------------------------------ */
// 每个视图：calls = [[command, args], ...]；combine(outputs) 把多命令结果合成结构化数据。
// 所有命令必须只读，view() 会逐条断言，防止视图接口被扩写成写接口。
const VIEWS = {
  status: () => ({
    calls: [['status', ['--porcelain=v1', '-b', '-uall']]],
    combine: (o) => parseStatus(o[0]),
  }),
  log: (a) => ({
    calls: [['log', ['-n', String(clampCount(a.count, 50)), LOG_FORMAT, ...optRef(a.ref)]]],
    combine: (o) => parseLog(o[0]),
  }),
  graph: (a) => ({
    calls: [['log', ['--graph', '--oneline', '--decorate', '--all', '-n', String(clampCount(a.count, 40))]]],
    combine: (o) => ({ lines: lines(o[0]) }),
  }),
  branches: () => ({
    calls: [['branch', ['-a', '-vv']]],
    combine: (o) => parseBranches(o[0]),
  }),
  remotes: () => ({
    calls: [['remote', ['-v']]],
    combine: (o) => parseRemotes(o[0]),
  }),
  stash: () => ({
    calls: [['stash', ['list', STASH_FORMAT]]],
    combine: (o) => parseStash(o[0]),
  }),
  tags: () => ({
    calls: [['tag', ['-n']]],
    combine: (o) => parseTags(o[0]),
  }),
  diff: (a) => {
    const base = a.staged ? ['--cached'] : [];
    const p = pathsArg(a.paths);
    return {
      calls: [
        ['diff', [...base, ...p]],
        ['diff', [...base, '--numstat', ...p]],
      ],
      combine: (o) => ({ patch: o[0] || '', numstat: parseNumstat(o[1]), staged: Boolean(a.staged) }),
    };
  },
  show: (a) => {
    const ref = safeRef(a.hash || 'HEAD');
    return {
      calls: [
        ['show', ['--no-patch', LOG_FORMAT, ref]],
        ['show', ['--format=', '--numstat', ref]],
        ['show', ['--format=', ref]],
      ],
      combine: (o) => ({
        commit: (parseLog(o[0]).commits || [])[0] || null,
        numstat: parseNumstat(o[1]),
        patch: o[2] || '',
      }),
    };
  },
  conflicts: () => ({
    calls: [['diff', ['--name-only', '--diff-filter=U']]],
    combine: (o) => ({ files: lines(o[0]) }),
  }),
  reflog: (a) => ({
    calls: [['reflog', ['-n', String(clampCount(a.count, 30))]]],
    combine: (o) => ({ lines: lines(o[0]) }),
  }),
};

const VIEW_NAMES = Object.keys(VIEWS);

/**
 * 执行一个只读视图。所有命令经 workspaceGit.run()（双通道 + 安全边界 + 脱敏）。
 * @param {{repo?:string, view?:string, args?:object}} input
 */
async function view(input = {}) {
  const key = String((input && input.view) || '').trim();
  const builder = VIEWS[key];
  if (!builder) {
    throw new HttpError(400, `不支持的 Git 视图：${key || '(空)'}。可用：${VIEW_NAMES.join(', ')}`);
  }
  const spec = builder((input && input.args) || {});
  // 只读防线：视图层绝不允许执行写命令。
  for (const [cmd, list] of spec.calls) {
    if (workspaceGit.classifyCommand(cmd, list).write) {
      throw new HttpError(400, `视图 ${key} 内含写命令 ${cmd}，已拒绝`);
    }
  }
  /** @type {string[]} */
  const outputs = [];
  /** @type {Array<{ channel?: string, channelLabel?: string, code?: number, commandText?: string, output?: string }>} */
  const results = [];
  for (const [cmd, list] of spec.calls) {
    const r = await workspaceGit.run({ repo: input.repo, command: cmd, args: list });
    // v0.4.31 修复：git 命令失败（无效 hash 的 show、仓库损坏等）会返回非零 code +
    // `fatal: ...` 文本。以前只把它塞进 output、仍返回 ok:true，前端会把 fatal 文本
    // 渲染成「错误文本伪装的提交详情」。这里改为上抛 400，让前端 gitLoadView 走
    // catch 显示真实错误，而不是伪数据。
    if (Number(r.code) !== 0) {
      const detail = String(r.output || '').trim().split('\n').slice(0, 3).join(' ').slice(0, 300);
      throw new HttpError(400, `Git 视图 ${key} 执行失败（${cmd} 返回 ${r.code}）${detail ? `：${detail}` : ''}`);
    }
    outputs.push(String(r.output || ''));
    results.push(r);
  }
  const first = results[0] || {};
  return {
    ok: true,
    view: key,
    repo: String((input && input.repo) || ''),
    data: spec.combine(outputs),
    commandText: results.map((r) => r.commandText).join(' | '),
    channel: first.channel || '',
    channelLabel: first.channelLabel || '',
    code: results.reduce((acc, r) => (acc === 0 ? r.code : acc), 0),
  };
}

/* ------------------------------ 语义动作 ------------------------------ */
// 工作台按钮 → 受控 git 命令。needConfirm 供前端决定是否弹二次确认。
// 所有动作的 args 都由本表生成，不接受前端直接传 command/args，避免自由拼接。
const ACTIONS = {
  stage: (p) => {
    const a = pathsArg(p.paths);
    return { command: 'add', args: a.length ? a : ['-A'], label: '暂存改动' };
  },
  unstage: (p) => {
    const a = pathsArg(p.paths);
    if (!a.length) throw new HttpError(400, '请选择要取消暂存的文件');
    return { command: 'restore', args: ['--staged', ...a], label: '取消暂存' };
  },
  discard: (p) => {
    const a = pathsArg(p.paths);
    return { command: 'restore', args: a.length ? a : ['.'], label: '放弃本地改动', needConfirm: true };
  },
  commit: (p) => ({ command: 'commit', args: ['-m', optMessage(p.message, '提交说明')], label: '提交' }),
  push: (p) => ({ command: 'push', args: [...optRef(p.remote), ...optRef(p.branch)], label: '推送' }),
  pull: (p) => ({ command: 'pull', args: [...(p.ffOnly === false ? [] : ['--ff-only']), ...optRef(p.remote), ...optRef(p.branch)], label: '拉取更新' }),
  fetch: (p) => ({ command: 'fetch', args: p.all === false ? [] : ['--all', '--prune'], label: '拉取元数据' }),
  checkout: (p) => ({ command: 'checkout', args: [safeRef(p.ref)], label: '切换 / 检出', needConfirm: true }),
  createBranch: (p) => ({ command: 'branch', args: [safeRef(p.name), ...optRef(p.from)], label: '新建分支' }),
  switchBranch: (p) => ({ command: 'checkout', args: [safeRef(p.name)], label: '切换分支', needConfirm: true }),
  deleteBranch: (p) => ({ command: 'branch', args: [p.force === true ? '-D' : '-d', safeRef(p.name)], label: '删除分支', needConfirm: true }),
  merge: (p) => ({ command: 'merge', args: [safeRef(p.ref)], label: '合并分支', needConfirm: true }),
  mergeAbort: () => ({ command: 'merge', args: ['--abort'], label: '中止合并', needConfirm: true }),
  revert: (p) => ({ command: 'revert', args: ['--no-edit', safeRef(p.hash || 'HEAD')], label: '还原提交', needConfirm: true }),
  reset: (p) => {
    const mode = ['soft', 'mixed', 'hard'].includes(String(p.mode)) ? String(p.mode) : 'hard';
    return { command: 'reset', args: [`--${mode}`, safeRef(p.ref || 'HEAD~1')], label: '重置', needConfirm: true };
  },
  stashSave: (p) => ({ command: 'stash', args: ['push', ...(p.includeUntracked === false ? [] : ['-u']), ...(p.message ? ['-m', optMessage(p.message, 'Stash 说明')] : [])], label: 'Stash 保存' }),
  stashApply: (p) => ({ command: 'stash', args: ['apply', ...optRef(p.ref)], label: 'Stash 应用' }),
  stashPop: (p) => ({ command: 'stash', args: ['pop', ...optRef(p.ref)], label: 'Stash 弹出', needConfirm: true }),
  stashDrop: (p) => ({ command: 'stash', args: ['drop', ...optRef(p.ref)], label: 'Stash 丢弃', needConfirm: true }),
  tagCreate: (p) => ({ command: 'tag', args: [...(p.message ? ['-a', '-m', optMessage(p.message, '标签附注')] : []), safeRef(p.name), ...optRef(p.ref)], label: '新建标签' }),
  tagDelete: (p) => ({ command: 'tag', args: ['-d', safeRef(p.name)], label: '删除标签', needConfirm: true }),
  cleanPreview: () => ({ command: 'clean', args: ['-n', '-d'], label: '清理预览', readOnly: true }),
  clean: () => ({ command: 'clean', args: ['-f', '-d'], label: '清理未跟踪文件', needConfirm: true }),
};

const ACTION_NAMES = Object.keys(ACTIONS);

/**
 * 把语义动作解析成受控 git 命令（不执行）。
 * @param {string} action
 * @param {object} params
 */
function resolveAction(action, params = {}) {
  const key = String(action || '').trim();
  const builder = ACTIONS[key];
  if (!builder) {
    throw new HttpError(400, `不支持的 Git 动作：${key || '(空)'}。可用：${ACTION_NAMES.join(', ')}`);
  }
  const r = builder(params || {});
  const cls = workspaceGit.classifyCommand(r.command, r.args);
  // 预览类动作（clean -n）是只读的，显式标注 readOnly 才允许；其余动作必须产生写命令。
  if (r.readOnly !== true && !cls.write) {
    throw new HttpError(400, `动作 ${key} 未产生写命令，已拒绝`);
  }
  if (r.readOnly === true && cls.write) {
    throw new HttpError(400, `动作 ${key} 标记为只读却产生了写命令，已拒绝`);
  }
  return {
    action: key,
    command: r.command,
    args: r.args,
    label: r.label || key,
    write: cls.write,
    destructive: Boolean(r.needConfirm) || cls.destructive,
    needConfirm: Boolean(r.needConfirm),
    argsText: [r.command, ...r.args].join(' '),
  };
}

module.exports = { view, resolveAction, VIEW_NAMES, ACTION_NAMES };
