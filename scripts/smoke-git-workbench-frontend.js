'use strict';

/**
 * v0.4.31 专项冒烟：Git 工作台「前端交互级」行为测试。
 *
 * 与 smoke-git-workbench.js（真实 server 后端全链路）互补：这里用 vm 加载
 * platform/public/app.js 与 platform/src/gitView.js 的**真实函数体**，注入轻量
 * DOM / fetch / 弹窗 stub，直接调用被修复的函数并对「实际产生的结果」做断言，
 * 而不是对源码做字符串护栏（字符串断言抓不到下面这些 P1）。
 *
 * 覆盖：
 *  - P1-1 stash-save 预设生成 `git stash push -u -m <说明>`（原来缺 -m 导致 stash 为空）
 *         + needHash 非法输入明确中止、不静默沿用 HEAD
 *  - P1-2 parseStatus 反转义 porcelain quoted path（空格 / 八进制中文 / rename / 中文原文）
 *  - P1-4 gitLoadView 对 400 错误走 catch 返回 null（不再渲染「错误文本伪装的提交详情」）
 *  - P2  splitGitCommand 引号分词 / gitTextWidth 中文宽度 / graphSvg 不截断 /
 *        破坏性确认期忙碌锁 / 远程分支短名
 *  - 后端旧 /repos/git 入口强制 confirmed（由 smoke-git-workbench.js 真实 server 覆盖，
 *    这里补一条源码级一致性断言：前后端破坏性集合对齐）
 *
 *   node scripts/smoke-git-workbench-frontend.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'platform', 'public', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'platform', 'public', 'index.html'), 'utf8');
const gitViewSrc = fs.readFileSync(path.join(ROOT, 'platform', 'src', 'gitView.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'platform', 'src', 'server.js'), 'utf8');
const workspaceGitSrc = fs.readFileSync(path.join(ROOT, 'platform', 'src', 'workspaceGit.js'), 'utf8');

const errors = [];
let passed = 0;
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (ok) passed += 1; else errors.push(label);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ *
 * 1) 加载 app.js：注入 stub，暴露纯函数与可控的执行入口
 * ------------------------------------------------------------------ */
function makeEl() {
  const el = {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    className: '', dataset: {}, style: {}, checked: false, tagName: 'DIV',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    appendChild() {}, remove() {}, focus() {}, select() {}, scrollIntoView() {},
    closest() { return null; }, contains() { return false; }, getAttribute() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
  };
  return el;
}

const requests = [];            // 捕获 api() 发出的所有请求
let promptAnswer = null;        // 控制 promptDialog 返回值
let confirmAnswer = true;       // 控制 confirmDialog 返回值
let apiHandler = async () => ({ ok: true, data: {} });
const toastCalls = [];
let gitOutText = '';

const sandbox = {
  console, Buffer, Math, JSON, String, Number, Array, Object, Promise, Set, Map, RegExp, Date, Error,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  document: {
    querySelector: () => makeEl(), querySelectorAll: () => [],
    createElement: () => makeEl(), addEventListener() {}, removeEventListener() {},
    body: makeEl(), head: makeEl(),
  },
  window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  EventSource: undefined, Terminal: undefined, FitAddon: undefined, CodeMirror: undefined,
  CSS: { escape: (v) => v },
  alert() {}, confirm: () => false, prompt: () => '',
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 顶层 function 声明会成为 context 的全局属性；用 runInContext 追加导出探针。
vm.runInContext(appSrc + `
;globalThis.__t = {
  splitGitCommand, gitTextWidth, graphSvg, repoGitNeedsConfirm,
  runGitPreset, runRepoGit, runGitAction, gitLoadView,
  get busy() { return repoGitBusy; },
  set repo(v) { repoGitRepo = v; },
  set presets(v) { repoGitPresets = v; },
  clearCache() { for (const k of Object.keys(repoGitCache)) delete repoGitCache[k]; },
};`, sandbox, { filename: 'app.js', timeout: 5000 });

const T = sandbox.__t;

// 覆盖交互依赖：弹窗 / 网络 / 提示 / 输出区，全部走可控 stub。
sandbox.promptDialog = async (opts) => promptAnswer;
sandbox.confirmDialog = async () => confirmAnswer;
sandbox.toast = (msg, isError) => { toastCalls.push({ msg, isError }); };
sandbox.gitOut = (text) => { gitOutText = String(text || ''); };
sandbox.gitOutAppend = (text) => { gitOutText += String(text); };
sandbox.api = async (url, options = {}) => {
  let body = options.body;
  if (body && typeof body !== 'string') body = JSON.stringify(body);
  const parsed = body ? JSON.parse(body) : {};
  requests.push({ url, body: parsed });
  return apiHandler(url, options, parsed);
};
sandbox.refreshGitTab = async () => {};
sandbox.$ = () => makeEl();
sandbox.esc = (s) => String(s == null ? '' : s);
sandbox.badge = (s) => String(s == null ? '' : s);
T.repo = 'demo';
T.clearCache();

const reset = () => { requests.length = 0; toastCalls.length = 0; promptAnswer = null; confirmAnswer = true; };

/* ------------------------------------------------------------------ *
 * 2) 加载 gitView.js：只取解析层纯函数（不依赖 workspaceGit.run 网络）
 * ------------------------------------------------------------------ */
const gvSandbox = {
  console, Buffer, String, Number, Array, Object, Promise, Math, RegExp, Error,
  module: { exports: {} },
  require: (m) => {
    if (m === './core') return { HttpError: class extends Error { constructor(s, msg) { super(msg); this.status = s; } } };
    if (m === './workspaceGit') return { classifyCommand: () => ({ write: false }), run: async () => ({ code: 0, output: '' }) };
    return {};
  },
};
gvSandbox.exports = gvSandbox.module.exports;
vm.createContext(gvSandbox);
vm.runInContext(gitViewSrc + `
;module.exports.__t = { unquotePath, splitStatusPath, parseStatus, view };`, gvSandbox, { filename: 'gitView.js', timeout: 5000 });
const GV = gvSandbox.module.exports.__t;

/* ------------------------------------------------------------------ *
 * 3) 真行为断言
 * ------------------------------------------------------------------ */
async function main() {
  T.presets = [
    { key: 'stash-save', group: 'stash', label: 'Stash 保存', command: 'stash', args: ['push', '-u'], write: true, needText: true },
    { key: 'revert', group: 'conflict', label: '还原提交', command: 'revert', args: ['--no-edit', 'HEAD'], write: true, destructive: true, needHash: true },
    { key: 'clean-preview', group: 'clean', label: '清理预览', command: 'clean', args: ['-n', '-d'] },
  ];

  /* --- P1-1：stash-save 预设必须生成 push -u -m <说明> --- */
  reset();
  promptAnswer = '我的改动说明';
  apiHandler = async () => ({ ok: true, data: { commandText: 'git stash push -u -m x', channelLabel: '本机', code: 0, output: '' } });
  await T.runGitPreset('stash-save');
  const stashReq = requests.find((r) => r.url === '/repos/git');
  note(Boolean(stashReq) && eq(stashReq.body.args, ['push', '-u', '-m', '我的改动说明']),
    'P1-1 stash-save 预设注入 -m（原缺 -m 导致 stash 为空）',
    stashReq ? JSON.stringify(stashReq.body.args) : '(未发出请求)');
  note(Boolean(stashReq) && !stashReq.body.confirmed,
    'P1-1 stash-save 非破坏性，不带 confirmed（后端不误强制确认）');

  /* --- P1-1 同源：needHash 非法输入明确中止，不静默沿用 HEAD --- */
  reset();
  promptAnswer = 'bad hash!!';
  await T.runGitPreset('revert');
  note(requests.length === 0 && toastCalls.some((t) => /提交号不合法/.test(t.msg)),
    'P1-1 needHash 非法输入报错中止，不再静默 git revert HEAD');
  reset();
  promptAnswer = 'a1b2c3d';
  confirmAnswer = true;
  apiHandler = async () => ({ ok: true, data: { commandText: 'git revert --no-edit a1b2c3d', channelLabel: '本机', code: 0, output: '' } });
  await T.runGitPreset('revert');
  const revertReq = requests.find((r) => r.url === '/repos/git');
  note(Boolean(revertReq) && eq(revertReq.body.args, ['--no-edit', 'a1b2c3d']) && revertReq.body.confirmed === true,
    'P1-1 合法 hash 正常替换且破坏性预设带 confirmed=true',
    revertReq ? JSON.stringify(revertReq.body) : '(未发出请求)');

  /* --- P1-2：parseStatus quoted-path 反转义 --- */
  const parseCases = [
    ['空格 quoted', '?? "with space.txt"', 'with space.txt', ''],
    ['中文 UTF-8 原文', '?? 中文文件.txt', '中文文件.txt', ''],
    ['八进制转义中文', '?? "\\344\\270\\255\\346\\226\\207.txt"', '中文.txt', ''],
    ['引号内嵌转义引号', '?? "a\\"b.txt"', 'a"b.txt', ''],
    ['制表符', '?? "tab\\tname.txt"', 'tab\tname.txt', ''],
    ['rename 两侧 quoted', 'R  "old name.txt" -> "new name.txt"', 'new name.txt', 'old name.txt'],
    ['普通文件', ' M app.js', 'app.js', ''],
  ];
  let p2ok = 0;
  for (const [name, line, wantPath, wantOrig] of parseCases) {
    const f = GV.parseStatus('## master\n' + line).files[0];
    const ok = f && f.path === wantPath && f.origPath === wantOrig;
    if (ok) p2ok += 1;
    else console.log(`   ↳ ${name}: got path=${JSON.stringify(f && f.path)} orig=${JSON.stringify(f && f.origPath)}`);
  }
  note(p2ok === parseCases.length, `P1-2 parseStatus 反转义 ${p2ok}/${parseCases.length} 全通过（空格/中文/八进制/rename）`);
  note(GV.unquotePath('plain.txt') === 'plain.txt' && !GV.unquotePath('"x"').startsWith('"'),
    'P1-2 未加引号路径原样返回、quoted 去引号');

  /* --- P1-4：gitLoadView 对 400 错误走 catch 返回 null --- */
  reset();
  apiHandler = async () => { const e = new Error('请求参数有误：Git 视图 show 执行失败'); e.status = 400; throw e; };
  const badView = await T.gitLoadView('show', { hash: 'NOPE' }, { refresh: true });
  note(badView === null && /读取「show」失败/.test(gitOutText),
    'P1-4 视图 400 错误被 gitLoadView 捕获返回 null（不再渲染伪提交详情）', gitOutText.slice(0, 80));

  /* --- P1-4 后端：view() 非零 code 上抛 HttpError(400) --- */
  const gvRunFail = { ...gvSandbox };
  gvRunFail.require = (m) => {
    if (m === './core') return { HttpError: class extends Error { constructor(s, msg) { super(msg); this.status = s; } } };
    if (m === './workspaceGit') return { classifyCommand: () => ({ write: false }), run: async () => ({ code: 128, output: 'fatal: ambiguous argument' }) };
    return {};
  };
  const gvFailBox = vm.createContext({ ...gvRunFail, module: { exports: {} }, console, Buffer, String, Number, Array, Object, Promise, Math, RegExp, Error });
  gvFailBox.exports = gvFailBox.module.exports;
  vm.runInContext(gitViewSrc + '\n;module.exports.__view = view;', gvFailBox, { filename: 'gitView.js', timeout: 5000 });
  let viewThrew = null;
  try { await gvFailBox.module.exports.__view({ repo: 'demo', view: 'show', args: { hash: 'x' } }); }
  catch (e) { viewThrew = e; }
  note(Boolean(viewThrew) && viewThrew.status === 400 && /执行失败/.test(viewThrew.message),
    'P1-4 view() 遇 git code≠0 抛 HttpError(400)（原仍返回 ok:true 夹带 fatal 文本）',
    viewThrew ? `${viewThrew.status}: ${viewThrew.message.slice(0, 60)}` : '(未抛错)');

  /* --- P2：自定义命令引号分词 --- */
  const splitCases = [
    ['commit -m "hello world"', ['commit', '-m', 'hello world']],
    ["commit -m 'fix: 修复登录'", ['commit', '-m', 'fix: 修复登录']],
    ['tag -a -m "release one" v1.0', ['tag', '-a', '-m', 'release one', 'v1.0']],
    ['diff -- "with space.txt"', ['diff', '--', 'with space.txt']],
    ['log --oneline -n 5', ['log', '--oneline', '-n', '5']],
  ];
  let sp = 0;
  for (const [input, want] of splitCases) if (eq(T.splitGitCommand(input), want)) sp += 1;
  note(sp === splitCases.length, `P2 splitGitCommand 引号分词 ${sp}/${splitCases.length} 全通过`);

  /* --- P2：graphSvg 宽度自适应（长中文行不被 1100 截断）--- */
  const longLine = '* ' + '很长的中文提交说明'.repeat(30);
  const svg = T.graphSvg(longLine);
  const wm = svg.match(/width="(\d+)"/);
  const svgWidth = wm ? Number(wm[1]) : 0;
  note(svgWidth > 1100 && T.gitTextWidth('中文') === 4,
    'P2 graphSvg 宽度按显示列数自适应（中文算 2 列），不再 Math.min(1100,…) 截断', `width=${svgWidth}`);

  /* --- P2：破坏性确认期忙碌锁 --- */
  reset();
  confirmAnswer = true;
  let releaseConfirm;
  sandbox.confirmDialog = () => new Promise((resolve) => { releaseConfirm = () => resolve(true); });
  apiHandler = async () => ({ ok: true, data: { commandText: 'git restore .', channelLabel: '本机', code: 0, output: '' } });
  const p = T.runRepoGit('restore', ['.']);
  await Promise.resolve(); // 让执行进入 confirmDialog
  const busyDuringConfirm = T.busy;
  // 弹窗期间并发触发另一条写操作，应被忙位挡下（不发出请求）
  const beforeCount = requests.length;
  const concurrent = T.runRepoGit('clean', ['-f', '-d']);
  const blockedNoRequest = requests.length === beforeCount;
  if (releaseConfirm) releaseConfirm();
  await Promise.all([p, concurrent]);
  note(busyDuringConfirm === true && blockedNoRequest,
    'P2 确认弹窗期间 repoGitBusy=true 且并发写操作被挡（原来可并发误删）');
  note(T.busy === false, 'P2 确认取消 / 执行完成后忙位复位，不残留死锁');
  sandbox.confirmDialog = async () => confirmAnswer;

  /* --- P2：远程分支 / 前后端破坏性集合一致性 --- */
  note(T.repoGitNeedsConfirm('clean', ['-n', '-d']) === false
    && T.repoGitNeedsConfirm('clean', ['-f', '-d']) === true
    && T.repoGitNeedsConfirm('restore', ['.']) === true
    && T.repoGitNeedsConfirm('status', []) === false,
    'P2 repoGitNeedsConfirm 与后端 classifyCommand 对齐（clean -n 预览免确认 / clean -f 强制）');
  note(/data-gfill/.test(appSrc) && /remotes\//.test(appSrc) && /remote/.test(appSrc),
    'P2 远程分支点选填短名 + 删除/合并拦截已落地');
  note(/cls\.destructive && b\.confirmed !== true/.test(serverSrc),
    'P1-3 旧 /repos/git 入口后端强制 confirmed（与 /action 对齐）');
  note(!htmlSrc.includes('id="repo-git-message"') && !htmlSrc.includes('id="repo-git-hash"')
    && htmlSrc.includes('id="repo-git-input"'),
    'P2 静态摆设输入框已移除，仅保留 repo-git-input');

  console.log(`\n${errors.length ? `✖ ${errors.length} 项未通过` : `✔ 全部 ${passed} 项通过`}`);
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
