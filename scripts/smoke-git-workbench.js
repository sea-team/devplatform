'use strict';

/**
 * v0.4.31 专项冒烟：TortoiseGit 式 Git 工作台后端全链路。
 *
 * 不依赖外部网络 / Docker：
 *  1) 在临时 WORKSPACE_DIR 下用真实 git 建一个含改动、分支、标签、stash、远程的仓库；
 *  2) 拉起真实 server.js（鉴权关闭，隔离 DATA_DIR / PORT）；
 *  3) 逐一验证 /repos/git/groups、/presets、/view 全部只读视图、/action 语义动作、
 *     旧 /repos/git 兼容入口、只读防线、破坏性二次确认、参数校验与 URL 脱敏。
 *
 *   node scripts/smoke-git-workbench.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM = path.join(ROOT, 'platform');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-git-wb-smoke-'));
const WORKSPACE = path.join(TMP, 'workspace');
const REPO = path.join(WORKSPACE, 'demo');
const REPO_NAME = 'demo';

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
const git = (args) => execFileSync('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

function makeRepo() {
  fs.mkdirSync(REPO, { recursive: true });
  git(['init', '-q']);
  git(['config', 'user.name', 'Workbench Tester']);
  git(['config', 'user.email', 'wb@example.com']);
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'hello\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'init commit']);
  fs.writeFileSync(path.join(REPO, 'b.txt'), 'world\n');
  git(['add', 'b.txt']);
  git(['tag', 'v1.0']);
  git(['branch', 'feature/x']);
  // 未暂存改动 + 未跟踪文件
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'hello changed\n');
  fs.writeFileSync(path.join(REPO, 'untracked.txt'), 'new\n');
  // 带凭据的远程（验证输出脱敏）
  git(['remote', 'add', 'origin', 'https://user:secret@example.com/demo.git']);
  git(['stash', 'push', '-u', '-q', '-m', 'wip stash']);
}

async function main() {
  makeRepo();
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(PLATFORM, 'src', 'server.js')], {
    cwd: PLATFORM,
    env: {
      ...process.env,
      DATA_DIR: TMP, PORT: String(port), ADMIN_TOKEN: '', DP_AUTH_MODE: 'off',
      WORKSPACE_DIR: WORKSPACE,
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
    const r = await fetch(`http://127.0.0.1:${port}/api${pathname}`, init);
    return r.json();
  };
  const must = async (pathname, body) => {
    const j = await api(pathname, body ? { method: 'POST', body } : {});
    if (!j.ok) throw new Error(j.error || 'unknown');
    return j.data;
  };

  let ready = false;
  try {
    for (let i = 0; i < 40 && !ready; i += 1) {
      try { const h = await must('/health'); ready = h.name === 'devplatform'; } catch { await sleep(250); }
    }
    note(ready, '平台进程启动并完成健康检查', ready ? `port=${port}` : log.slice(-400));
    if (!ready) return;

    /* --- 元数据 --- */
    const groups = await must('/repos/git/groups');
    note(groups.items.length === 10 && groups.items.some((g) => g.id === 'status')
      && groups.items.some((g) => g.id === 'custom'), 'groups 返回 10 个工作台分区');
    const presets = await must('/repos/git/presets');
    note(presets.items.length >= 30 && presets.items.every((p) => p.group)
      && presets.items.some((p) => p.key === 'clean-do')
      && presets.items.some((p) => p.key === 'stash-save'), 'presets 全部分组且含 Clean up / Stash 动作');

    /* --- 只读视图 --- */
    const viewNames = ['status', 'log', 'graph', 'branches', 'remotes', 'stash', 'tags', 'diff', 'show', 'conflicts', 'reflog'];
    for (const v of viewNames) {
      const d = await must('/repos/git/view', { repo: REPO_NAME, view: v, args: {} });
      note(Boolean(d && d.ok && d.data !== undefined), `只读视图 ${v} 返回结构化数据`,
        v === 'status' ? `files=${d.data.files.length}` : (v === 'log' ? `commits=${d.data.commits.length}` : ''));
    }
    const status = (await must('/repos/git/view', { repo: REPO_NAME, view: 'status' })).data;
    note(status.branch === 'master' || status.branch === 'main', 'status 解析出当前分支', status.branch);
    const branches = (await must('/repos/git/view', { repo: REPO_NAME, view: 'branches' })).data;
    note(branches.branches.some((b) => b.current) && branches.branches.some((b) => b.name === 'feature/x'),
      'branches 解析出当前分支与新建分支');
    const tags = (await must('/repos/git/view', { repo: REPO_NAME, view: 'tags' })).data;
    note(tags.tags.some((t) => t.name === 'v1.0'), 'tags 解析出 v1.0');
    const remotes = (await must('/repos/git/view', { repo: REPO_NAME, view: 'remotes' })).data;
    note(remotes.remotes.some((r) => r.fetch.includes('******@') && !r.fetch.includes('secret')),
      '远程 URL 凭据已脱敏（user:secret@ → ******@）');
    const log = (await must('/repos/git/view', { repo: REPO_NAME, view: 'log', args: { count: 10 } })).data;
    note(log.commits[0] && log.commits[0].subject === 'init commit', 'log 解析出提交主题与作者');
    const show = (await must('/repos/git/view', { repo: REPO_NAME, view: 'show', args: { hash: 'HEAD' } })).data;
    note(Boolean(show.commit && show.commit.hash) && Array.isArray(show.numstat), 'show 返回提交详情与 numstat');

    /* --- 只读防线：视图不允许含写命令（用一个不存在的 repo 触发校验前的分类，直接测内部断言） --- */
    const badView = await api('/repos/git/view', { method: 'POST', body: { repo: REPO_NAME, view: 'nope' } });
    note(!badView.ok && /不支持的 Git 视图/.test(badView.error || ''), '未知视图被拒绝');

    // v0.4.31 修复 P1-4：无效 hash 的 show 会返回非 0 code + fatal 文本。
    // 以前仍 ok:true 把 fatal 塞进 commit.hash/patch，前端渲染成「错误文本伪装的提交详情」。
    const badShow = await api('/repos/git/view', {
      method: 'POST', body: { repo: REPO_NAME, view: 'show', args: { hash: 'NO_SUCH_REF_zzz' } },
    });
    note(!badShow.ok && badShow.status === 400 && /执行失败/.test(badShow.error || ''),
      'P1-4 无效 hash 的 show 上抛 400，不再返回 ok:true 夹带 fatal 文本');

    /* --- 语义动作：破坏性必须二次确认 --- */
    const noConfirm = await api('/repos/git/action', {
      method: 'POST', body: { repo: REPO_NAME, action: 'reset', params: { mode: 'hard', ref: 'HEAD~1' } },
    });
    note(!noConfirm.ok && /需要二次确认/.test(noConfirm.error || ''), '破坏性动作缺 confirmed 被拒绝');

    const badHash = await api('/repos/git/action', {
      method: 'POST', body: { repo: REPO_NAME, action: 'checkout', params: { ref: '-x' }, confirmed: true },
    });
    note(!badHash.ok, '以 - 开头的非法引用被拒绝');

    const badPath = await api('/repos/git/action', {
      method: 'POST', body: { repo: REPO_NAME, action: 'stage', params: { paths: ['../etc/passwd'] } },
    });
    note(!badPath.ok, '越界文件路径被拒绝');

    /* --- 语义动作：真实执行一条只读预览与一条写动作 --- */
    const preview = await must('/repos/git/action', { repo: REPO_NAME, action: 'cleanPreview', params: {} });
    note(preview.code === 0 && preview.write === false, 'cleanPreview 走只读动作且不写仓库');

    // 用 createBranch 做一次真实写动作，再验证分支出现，最后删掉（带确认）。
    const created = await must('/repos/git/action', {
      repo: REPO_NAME, action: 'createBranch', params: { name: 'smoke-branch' },
    });
    note(created.code === 0 && created.action === 'createBranch', '语义动作 createBranch 真实执行成功');
    const after = (await must('/repos/git/view', { repo: REPO_NAME, view: 'branches' })).data;
    note(after.branches.some((b) => b.name === 'smoke-branch'), '新建分支出现在分支视图中');
    const deleted = await must('/repos/git/action', {
      repo: REPO_NAME, action: 'deleteBranch', params: { name: 'smoke-branch' }, confirmed: true,
    });
    note(deleted.code === 0, '删除分支（带二次确认）执行成功');

    /* --- 旧入口兼容：白名单 + 混合命令读写分类 --- */
    const st = await must('/repos/git', { repo: REPO_NAME, command: 'status', args: ['--short', '--branch'] });
    note(st.code === 0 && st.write === false, '旧 /repos/git 入口仍可执行 status');
    const br = await must('/repos/git', { repo: REPO_NAME, command: 'branch', args: ['-a', '-vv'] });
    note(br.write === false, 'branch -a -vv 被正确分类为只读（不需写权限）');
    const forbidden = await api('/repos/git', {
      method: 'POST', body: { repo: REPO_NAME, command: 'diff', args: ['--no-index', '/etc/passwd'] },
    });
    note(!forbidden.ok, '--no-index 越权选项被参数黑名单拒绝');
    const notAllowed = await api('/repos/git', {
      method: 'POST', body: { repo: REPO_NAME, command: 'rebase', args: [] },
    });
    note(!notAllowed.ok, '白名单外子命令被拒绝');

    // v0.4.31 修复 P1-3：旧 /repos/git 入口对破坏性命令强制 confirmed=true，
    // 防止自定义命令 / 快捷预设绕过前端确认误删本地改动（与 /action 对齐）。
    const noConfirmLegacy = await api('/repos/git', {
      method: 'POST', body: { repo: REPO_NAME, command: 'reset', args: ['--hard', 'HEAD~1'] },
    });
    note(!noConfirmLegacy.ok && /需要二次确认/.test(noConfirmLegacy.error || ''),
      'P1-3 旧入口破坏性命令缺 confirmed 被拒绝');
    const confirmLegacy = await api('/repos/git', {
      method: 'POST', body: { repo: REPO_NAME, command: 'clean', args: ['-n', '-d'] },
    });
    note(confirmLegacy.ok && confirmLegacy.data.write === false,
      'P1-3 clean -n 只读预览无需 confirmed，不受强制确认影响');
  } catch (e) {
    note(false, '冒烟过程未抛异常', e.message);
  } finally {
    try { child.kill(); } catch { /* noop */ }
    await sleep(150);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${errors.length ? `✖ ${errors.length} 项未通过` : `✔ 全部 ${passed} 项通过`}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
