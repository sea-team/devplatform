'use strict';

/**
 * 前端自检（无需浏览器）：
 *  1) 静态一致性：HTML 中的 id / 模块 section / 脚本引入顺序、app.js 的 data-role 定义与引用；
 *  2) 用轻量 DOM stub 在 vm 中执行 app.js，跑一遍 boot（标签工作台初始化），捕获运行时异常。
 * 用法：node scripts/check-frontend.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.resolve(__dirname, '..', 'platform', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const errors = [];
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (!ok) errors.push(label);
};

/* --------------------------- 1. 静态一致性 --------------------------- */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const refs = [...new Set([...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
// ops-hint 由 loadOps 运行时创建，属于预期例外。
const missing = refs.filter((id) => !ids.has(id) && id !== 'ops-hint');
note(missing.length === 0, 'app.js 引用的静态 id 均存在', missing.length ? `缺失：${missing.join(', ')}` : `${refs.length} 个引用`);

const sections = [...html.matchAll(/class="page" id="view-([a-z]+)"/g)].map((m) => m[1]);
note(sections.length === 8, '8 个模块页面已转为可标签化的 .page', sections.join(', '));

const scripts = [...html.matchAll(/<script src="\/vendor\/([^"]+)"/g)].map((m) => m[1]);
const cmIndex = scripts.indexOf('codemirror.js');
const modesIndex = scripts.indexOf('cm-modes.js');
note(cmIndex >= 0 && modesIndex > cmIndex, 'CodeMirror 核心先于语言模式加载', scripts.join(' → '));
note(html.includes('<link rel="stylesheet" href="/cm-theme.css" />'), '浅色语法主题已引入');
note(!html.includes('id="remote-modal"'), '旧的单一模态框已移除');

// 顶部标题收敛到标签：无重复标题行、说明走悬停浮层、标签栏不再出现纵向滚动条。
note(!html.includes('id="view-title"') && !html.includes('id="view-desc"') && !/\$\('#view-(title|desc)'\)/.test(app),
  '顶部重复标题已移除且 app.js 无残留引用');
note(html.includes('id="tab-tip"') && html.includes('id="tab-info"'), '标签说明浮层与 ⓘ 入口已接入');
note(html.includes('id="tab-scroll-prev"') && html.includes('id="tab-scroll-next"'), '标签横向滚动按钮已接入');
note(/\.tabbar\s*\{[\s\S]*?overflow-y:\s*hidden/.test(css) && /scrollbar-width:\s*none/.test(css),
  '标签栏纵向溢出已锁定且原生滚动条隐藏');
note(!/\.topbar\s*\{/.test(css), '旧 topbar 样式已清理');

const definedRoles = new Set([...app.matchAll(/data-role="([a-z-]+)"/g)].map((m) => m[1]));
const usedRoles = new Set([...app.matchAll(/\bq\(pane, '([a-z-]+)'\)/g)].map((m) => m[1]));
const badRoles = [...usedRoles].filter((r) => !definedRoles.has(r));
note(badRoles.length === 0, '面板内 data-role 定义与引用一致', badRoles.length ? `缺失：${badRoles.join(', ')}` : `${definedRoles.size} 个`);

/* ---------------------- 2. 轻量 DOM 模拟执行 ---------------------- */
class El {
  constructor() {
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.scrollLeft = 0;
    this.scrollWidth = 0;
    this.clientWidth = 800;
    this.offsetWidth = 280;
    this.offsetHeight = 90;
    this.options = [];
    this.elements = {};
    this.selectedOptions = [{ textContent: '纯文本' }];
    this._classes = new Set();
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c, on) => (on === undefined ? (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c)) : (on ? this._classes.add(c) : this._classes.delete(c))),
      contains: (c) => this._classes.has(c),
    };
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  contains() { return false; }
  scrollBy() {}
  appendChild() {}
  remove() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, right: 200, top: 0, bottom: 30, width: 200, height: 30 }; }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
}

const store = new Map();
const textFile = {
  path: '/data/platform/a.txt', size: 5, content: 'hello', encoding: 'utf-8',
  newline: 'LF', bom: '', hasBom: false, language: '纯文本', mode: '',
  kind: 'text', mime: 'text/plain', icon: 'TXT', color: 'gray',
  editable: true, preview: null, binary: false, warning: '',
  languages: [{ value: '', label: '纯文本' }],
  encodings: [{ value: 'utf-8', label: 'UTF-8' }],
  newlines: [{ value: 'LF', label: 'LF' }],
};
const respond = (url) => {
  if (url.includes('/api/health')) return { ok: true, data: { mode: 'normal' } };
  if (url.includes('/api/overview')) {
    return { ok: true, data: {
      counts: { servers: 0, builds: 0, buildSuccess: 0, buildFailed: 0, deploys: 0, aiProviders: 0 },
      services: [],
    } };
  }
  if (url.includes('/files/content')) return { ok: true, data: textFile };
  if (url.includes('/files?')) return { ok: true, data: { path: '/data/platform', parent: '/data', items: [], total: 0 } };
  return { ok: true, data: {} };
};

const documentStub = {
  querySelector: () => new El(),
  querySelectorAll: () => [],
  createElement: () => new El(),
  addEventListener() {},
};
const sandbox = {
  document: documentStub,
  window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  fetch: async (url) => ({ json: async () => respond(String(url)) }),
  navigator: { clipboard: { writeText: async () => {} } },
  confirm: () => false,
  prompt: () => '',
  alert: () => {},
  //  stub 内不注册真实定时器，避免 toast / 日志轮询把自检进程挂住。
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  console,
  CSS: { escape: (v) => v },
  Terminal: undefined, FitAddon: undefined, CodeMirror: undefined, EventSource: undefined,
};
sandbox.globalThis = sandbox;

let runtimeError = null;
process.on('unhandledRejection', (reason) => { runtimeError = reason; });
try {
  // const/let 是词法声明，不会挂到 vm 全局对象上，追加一行探针导出内部状态。
  vm.runInNewContext(`${app}
;globalThis.__probe = {
  state: () => ({ tabs: [...tabs.keys()], active: activeTabId }),
  openMany: () => {
    const srv = { id: 'srv_check', name: '检查节点', host: '10.0.0.1', username: 'root', deployDir: '/data/platform' };
    openModuleTab('servers');
    openModuleTab('builds');
    openFilesTab(srv);
    openEditorTab({ serverId: srv.id, serverName: srv.name }, '/data/platform/a.txt', 'a.txt');
    openTerminalTab(srv);
    return [...tabs.keys()];
  },
  activate: (id) => activateTab(id),
  close: (id) => closeTab(id),
  tip: () => {
    const t = tabs.get(activeTabId);
    const tipHtml = tabTipHtml(t);
    showTabTip(t, $('#tab-info'));
    scrollTabs(120);
    updateTabScroll();
    hideTabTip();
    return tipHtml;
  },
};`, sandbox, { filename: 'app.js', timeout: 5000 });
  note(true, 'app.js 顶层执行无异常');
} catch (e) {
  note(false, 'app.js 顶层执行无异常', e.message);
}

setTimeout(() => {
  note(runtimeError === null, 'boot 流程无未处理的 Promise 异常', runtimeError ? String(runtimeError) : '');
  const probe = sandbox.__probe;
  const initial = probe ? probe.state() : null;
  note(Boolean(initial) && initial.tabs.length >= 1, '标签工作台状态已初始化',
    initial ? `初始标签 ${initial.tabs.length} 个 · 激活 ${initial.active}` : '(无)');
  if (probe) {
    try {
      probe.openMany();
      const many = probe.state();
      note(many.tabs.length >= 6, '多标签同时打开（模块 / 文件 / 编辑器 / 终端）', `${many.tabs.length} 个`);
      note(String(many.active).startsWith('term:'), '新建标签自动激活', many.active);
      probe.activate('module:overview');
      note(probe.state().active === 'module:overview', '标签间自由切换');
      const before = probe.state().tabs.length;
      probe.close('files:srv_check');
      note(probe.state().tabs.length === before - 1, '关闭标签正确清理状态');
      const tipHtml = probe.tip();
      note(tipHtml.includes('tip-desc') && tipHtml.includes('tip-meta') && tipHtml.length > 80,
        '标签说明浮层渲染 / 横向滚动 / 浮层关闭无异常');
    } catch (e) {
      note(false, '多标签交互无异常', e.message);
    }
  }
  const saved = store.get('dp_tabs');
  note(Boolean(saved) && saved.includes('overview'), '标签状态已持久化', saved || '(空)');
  console.log(`\n${errors.length ? `✖ ${errors.length} 项检查未通过` : '✔ 前端自检全部通过'}`);
  if (errors.length) process.exitCode = 1;
}, 120);
