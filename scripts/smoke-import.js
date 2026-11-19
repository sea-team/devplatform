'use strict';

// E 批：仓库压缩包导入 + 解压安全 + .git 检测冒烟。
// 环境变量在 require core 之前设置，隔离 DATA_DIR / WORKSPACE_DIR，避免污染生产。
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const tar = (args, opts) => execFileSync('tar', ['--force-local', ...args], opts);
const base = path.resolve(__dirname, '..', '_smoke_import');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'data'), { recursive: true });
fs.mkdirSync(path.join(base, 'workspace'), { recursive: true });
process.env.DATA_DIR = path.join(base, 'data');
process.env.WORKSPACE_DIR = path.join(base, 'workspace');

const archive = require('../platform/src/archive.js');
const gitSources = require('../platform/src/repoImporter.js');

let pass = 0, fail = 0;
const ck = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ' :: ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// 造源目录：一个含 .git + 工作树的仓库
const src = path.join(base, 'src', 'myrepo');
fs.mkdirSync(path.join(src, '.git'), { recursive: true });
fs.writeFileSync(path.join(src, 'README.md'), 'hello worktree\n');
fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(src, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
const srcDir = path.join(base, 'src');

// 用系统 tar 造 tar / tar.gz（Windows Git Bash 有 tar，--force-local 避免盘符被当远程主机）
tar(['-cf', path.join(base, 'repo.tar'), 'myrepo'], { cwd: srcDir });
tar(['-czf', path.join(base, 'repo.tar.gz'), 'myrepo'], { cwd: srcDir });

// 用 Python 造 zip（含 deflate）。源路径经 argv 传入，Python 侧用 os.path.join 拼接，规避转义。
const py = `
import zipfile,sys,os
out=sys.argv[1]; src=sys.argv[2]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(src,'README.md'),'myrepo/README.md')
    z.write(os.path.join(src,'.git','HEAD'),'myrepo/.git/HEAD')
    z.write(os.path.join(src,'.git','config'),'myrepo/.git/config')
`;
execFileSync('python', ['-c', py, path.join(base, 'repo.zip'), src], { cwd: base });

// 纯 .git 包（无工作树）
const py2 = `
import zipfile,sys,os
out=sys.argv[1]; src=sys.argv[2]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(src,'.git','HEAD'),'.git/HEAD')
    z.write(os.path.join(src,'.git','config'),'.git/config')
`;
execFileSync('python', ['-c', py2, path.join(base, 'gitonly.zip'), src], { cwd: base });

// 恶意 zip-slip
const py3 = `
import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
    z.writestr('../../escape.txt','pwned')
`;
execFileSync('python', ['-c', py3, path.join(base, 'evil.zip')], { cwd: base });

(async () => {
  const user = { id: 'usr_test', role: 'user', via: 'session' };

  // 1. tar 导入（单层包裹目录应上提）
  const r1 = await gitSources.importRepo({ name: 'from-tar', buffer: fs.readFileSync(path.join(base, 'repo.tar')), filename: 'repo.tar', user });
  ck('tar 导入成功', r1.name === 'from-tar' && r1.hasGit === true, JSON.stringify({ entries: r1.entries, gitOnly: r1.gitOnly }));
  ck('tar 单层目录已上提(README 在根)', fs.existsSync(path.join(base, 'workspace', 'from-tar', 'README.md')));
  ck('tar .git 存在', fs.existsSync(path.join(base, 'workspace', 'from-tar', '.git')));

  // 2. tar.gz 导入
  const r2 = await gitSources.importRepo({ name: 'from-tgz', buffer: fs.readFileSync(path.join(base, 'repo.tar.gz')), filename: 'repo.tar.gz', user });
  ck('tar.gz 导入成功 + 格式识别', r2.format === 'tgz' && fs.existsSync(path.join(base, 'workspace', 'from-tgz', 'README.md')));

  // 3. zip 导入（deflate）
  const r3 = await gitSources.importRepo({ name: 'from-zip', buffer: fs.readFileSync(path.join(base, 'repo.zip')), filename: 'repo.zip', user });
  ck('zip 导入成功 + deflate 解压', r3.format === 'zip' && fs.readFileSync(path.join(base, 'workspace', 'from-zip', 'README.md'), 'utf8').includes('hello worktree'));

  // 4. 纯 .git 包：gitOnly=true，触发恢复尝试但导入不失败
  const r4 = await gitSources.importRepo({ name: 'git-only', buffer: fs.readFileSync(path.join(base, 'gitonly.zip')), filename: 'gitonly.zip', user });
  ck('纯.git 包 gitOnly=true', r4.gitOnly === true && r4.recovery.attempted === true, JSON.stringify(r4.recovery));
  ck('纯.git 包导入未失败(.git 存在)', fs.existsSync(path.join(base, 'workspace', 'git-only', '.git')));

  // 5. 同名目录已存在 → 409
  let dupBlocked = false;
  try { await gitSources.importRepo({ name: 'from-zip', buffer: fs.readFileSync(path.join(base, 'repo.zip')), user }); }
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
  try { await gitSources.importRepo({ name: 'plain', buffer: fs.readFileSync(path.join(base, 'plain.zip')), user }); }
  catch (e) { plainBlocked = /\.git/.test(e.message); }
  ck('无 .git 目录包被拒绝', plainBlocked);

  // 7. zip-slip 归档：archive 层已拦截（见 archive 自测），导入层也不会落盘到工作区外
  let evilBlocked = false;
  try { await gitSources.importRepo({ name: 'evil', buffer: fs.readFileSync(path.join(base, 'evil.zip')), user }); }
  catch (e) { evilBlocked = true; }
  ck('zip-slip 导入被拦截', evilBlocked);

  console.log(`\nE 批导入冒烟：${pass} 通过 / ${fail} 失败`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟异常：', e);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(1);
});
