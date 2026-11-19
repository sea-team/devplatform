'use strict';

// E 批：仓库压缩包导入 + 解压安全 + .git 检测冒烟。
// 环境变量在 require core 之前设置，隔离 DATA_DIR / WORKSPACE_DIR，避免污染生产。
//
// v0.4.20 加固（修复「周期性 git reset 还原未提交改动」）：
//   1) 测试根目录从 <repo>/_smoke_import 移到系统临时目录，彻底脱离平台代码仓库树；
//      历史上纯 .git 包用残缺 .git，git -C 会向上逃逸命中 <repo>/.git 并 reset --hard，
//      表现为「改完几秒后未提交改动被还原」，看起来像有周期性进程在跑。
//   2) 用真实 git init + commit 造完整仓库，纯 .git 包现在能真正恢复工作树。
//   3) 新增断言直接锁定「残缺 .git 被拒绝（防逃逸）」这一修复点。
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const tar = (args, opts) => execFileSync('tar', ['--force-local', ...args], opts);
const git = (args, opts) => execFileSync('git', args, { windowsHide: true, ...opts });

// 关键：落在系统临时目录，绝不放进 devplatform 仓库树内
const base = path.join(os.tmpdir(), 'devplatform-smoke-import');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'data'), { recursive: true });
fs.mkdirSync(path.join(base, 'workspace'), { recursive: true });
process.env.DATA_DIR = path.join(base, 'data');
process.env.WORKSPACE_DIR = path.join(base, 'workspace');

const archive = require('../platform/src/archive.js');
const repoImporter = require('../platform/src/repoImporter.js');
const workspaceGit = require('../platform/src/workspaceGit.js');

let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ' :: ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// 造源目录：一个真实 git 仓库（完整 .git + 工作树 + 一次提交）
const src = path.join(base, 'src', 'myrepo');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'README.md'), 'hello worktree\n');
git(['init', '-b', 'main'], { cwd: src });
git(['config', 'user.email', 'smoke@example.com'], { cwd: src });
git(['config', 'user.name', 'smoke'], { cwd: src });
git(['config', 'commit.gpgsign', 'false'], { cwd: src });
git(['add', '.'], { cwd: src });
git(['commit', '-m', 'init'], { cwd: src });
const srcDir = path.join(base, 'src');

// 用系统 tar 造 tar / tar.gz（Windows Git Bash 有 tar，--force-local 避免盘符被当远程主机）
tar(['-cf', path.join(base, 'repo.tar'), 'myrepo'], { cwd: srcDir });
tar(['-czf', path.join(base, 'repo.tar.gz'), 'myrepo'], { cwd: srcDir });

// 用 Python 造 zip（含 deflate），递归打包整个 myrepo（含完整 .git）
const pyZip = `
import zipfile,sys,os
out=sys.argv[1]; root=sys.argv[2]
top=os.path.join(root,'myrepo')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for dp,dn,fn in os.walk(top):
        for f in fn:
            full=os.path.join(dp,f)
            arc=os.path.relpath(full,root).replace(os.sep,'/')
            z.write(full,arc)
`;
execFileSync('python', ['-c', pyZip, path.join(base, 'repo.zip'), srcDir], { cwd: base });

// 纯 .git 包（无工作树）：递归打包完整 .git 目录，恢复到 .git/ 前缀
const pyGitOnly = `
import zipfile,sys,os
out=sys.argv[1]; gitdir=sys.argv[2]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for dp,dn,fn in os.walk(gitdir):
        for f in fn:
            full=os.path.join(dp,f)
            arc='.git/'+os.path.relpath(full,gitdir).replace(os.sep,'/')
            z.write(full,arc)
`;
execFileSync('python', ['-c', pyGitOnly, path.join(base, 'gitonly.zip'), path.join(src, '.git')], { cwd: base });

// 恶意 zip-slip
const py3 = `
import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('../../escape.txt','pwned')
`;
execFileSync('python', ['-c', py3, path.join(base, 'evil.zip')], { cwd: base });

const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* noop */ } };

(async () => {
  const user = { id: 'usr_test', role: 'user', via: 'session' };

  // 1. tar 导入（单层包裹目录应上提）
  const r1 = await repoImporter.importRepo({ name: 'from-tar', buffer: fs.readFileSync(path.join(base, 'repo.tar')), filename: 'repo.tar', user });
  ck('tar 导入成功', r1.name === 'from-tar' && r1.hasGit === true, JSON.stringify({ entries: r1.entries, gitOnly: r1.gitOnly }));
  ck('tar 单层目录已上提(README 在根)', fs.existsSync(path.join(base, 'workspace', 'from-tar', 'README.md')));
  ck('tar .git 存在', fs.existsSync(path.join(base, 'workspace', 'from-tar', '.git')));

  // 2. tar.gz 导入
  const r2 = await repoImporter.importRepo({ name: 'from-tgz', buffer: fs.readFileSync(path.join(base, 'repo.tar.gz')), filename: 'repo.tar.gz', user });
  ck('tar.gz 导入成功 + 格式识别', r2.format === 'tgz' && fs.existsSync(path.join(base, 'workspace', 'from-tgz', 'README.md')));

  // 3. zip 导入（deflate）
  const r3 = await repoImporter.importRepo({ name: 'from-zip', buffer: fs.readFileSync(path.join(base, 'repo.zip')), filename: 'repo.zip', user });
  ck('zip 导入成功 + deflate 解压', r3.format === 'zip' && fs.readFileSync(path.join(base, 'workspace', 'from-zip', 'README.md'), 'utf8').includes('hello worktree'));

  // 4. 纯 .git 包：gitOnly=true，从完整 .git 恢复工作树（真实成功路径）
  const r4 = await repoImporter.importRepo({ name: 'git-only', buffer: fs.readFileSync(path.join(base, 'gitonly.zip')), filename: 'gitonly.zip', user });
  ck('纯.git 包 gitOnly=true', r4.gitOnly === true && r4.recovery.attempted === true, JSON.stringify(r4.recovery));
  ck('纯.git 包工作树已恢复', r4.recovery.ok === true && fs.readFileSync(path.join(base, 'workspace', 'git-only', 'README.md'), 'utf8').includes('hello worktree'), JSON.stringify(r4.recovery));

  // 5. 同名目录已存在 → 409
  let dupBlocked = false;
  try { await repoImporter.importRepo({ name: 'from-zip', buffer: fs.readFileSync(path.join(base, 'repo.zip')), user }); }
  catch (e) { dupBlocked = e.code === 409 || e.status === 409 || /已存在/.test(e.message); }
  ck('同名仓库拒绝覆盖(409)', dupBlocked);

  // 6. 无 .git 的普通目录包 → 拒绝
  const pyPlain = `
import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('plain/readme.txt','no git here')
`;
  execFileSync('python', ['-c', pyPlain, path.join(base, 'plain.zip')], { cwd: base });
  let plainBlocked = false;
  try { await repoImporter.importRepo({ name: 'plain', buffer: fs.readFileSync(path.join(base, 'plain.zip')), user }); }
  catch (e) { plainBlocked = /\.git/.test(e.message); }
  ck('无 .git 目录包被拒绝', plainBlocked);

  // 7. zip-slip 归档：archive 层已拦截（见 archive 自测），导入层也不会落盘到工作区外
  let evilBlocked = false;
  try { await repoImporter.importRepo({ name: 'evil', buffer: fs.readFileSync(path.join(base, 'evil.zip')), user }); }
  catch (e) { evilBlocked = true; }
  ck('zip-slip 导入被拦截', evilBlocked);

  // 8. 修复锁定：残缺 .git（只有 HEAD/config，缺 objects/refs）必须被 workspaceGit 拒绝，
  //    否则 git -C 会向上逃逸命中外层仓库并 reset，误伤未提交改动。
  const brokenDir = path.join(base, 'workspace', 'broken-repo');
  fs.mkdirSync(path.join(brokenDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(brokenDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(brokenDir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  let escapeBlocked = false, escapeMsg = '';
  try { await workspaceGit.run({ repo: 'broken-repo', command: 'status' }); }
  catch (e) { escapeMsg = (e && e.message) || String(e); escapeBlocked = /不完整|objects|refs/.test(escapeMsg); }
  ck('残缺.git 被拒绝(防逃逸误伤外层仓库)', escapeBlocked, escapeMsg.slice(0, 100));

  console.log(`\nE 批导入冒烟：${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常：', e);
  cleanup();
  process.exit(1);
});
