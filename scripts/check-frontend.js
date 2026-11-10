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

const sections = [...html.matchAll(/class="page" id="view-([a-z0-9-]+)"/g)].map((m) => m[1]);
const SUBPAGES = ['repo-new', 'repo-clone', 'storage-conn', 'storage-mounts', 'storage-drivers',
  'build-start', 'deploys', 'server-new', 'docker-containers', 'docker-images',
  'docker-volumes', 'docker-networks', 'docker-compose'];
note(sections.length === 25 && sections.includes('gitsrc') && sections.includes('docker')
  && sections.includes('proxy') && SUBPAGES.every((v) => sections.includes(v)),
'25 个独立页面（12 主模块 + 13 个子功能页）均已转为可标签化的 .page', sections.join(', '));
note(['/git-sources', '/docker/overview', '/extensions/backups', '/extensions/dbgate', '/builds/backends']
  .every((p) => app.includes(p)) && app.includes('function loadGitSources') && app.includes('function loadDocker'),
'Git 源 / Docker 管理 / 备份 / DbGate / 构建后端接口已全部接线');

// v0.3.1：分层代理页 + OpenList 管理集成。
note(['/proxy/global', '/proxy/groups/', '/proxy/rules', '/proxy/overrides/', '/proxy/resolve', '/proxy/entities']
  .every((p) => app.includes(p)) && app.includes('function loadProxy') && app.includes('proxy: loadProxy'),
  '代理配置页四级优先级接口已全部接线');
note(['/openlist/status', '/openlist/storages', '/openlist/drivers', '/openlist/files', '/openlist/connection']
  .every((p) => app.includes(p)) && app.includes('function loadStorage') && app.includes('function olAction'),
  'OpenList 连接 / 挂载 / 驱动 / 文件管理接口已全部接线');
note(['id="openlist-config-form"', 'id="ol-driver"', 'id="storage-select-all"', 'data-ol-action="move"', 'id="openlist-frame"']
  .every((s) => html.includes(s)), 'OpenList 管理界面控件齐全');
note(['data-proxy-repo', 'data-dk-op="proxy"', 'data-server-proxy', 'data-ai-proxy']
  .every((s) => app.includes(s)) && app.includes('function gotoProxyOverride'),
  '四类对象均可一键跳到代理页预填单项覆盖');

// v0.3.2：单项代理说明、Git 账号密码、多 OpenList 连接、页面拆分。
note(html.includes('这一栏怎么填') && html.includes('留空并点「保存覆盖」')
  && html.includes('socks5://127.0.0.1:1080') && html.includes('单个仓库代理 &gt; Git Host'),
'单项代理覆盖已补齐格式 / 优先级 / 示例 / 留空与 direct 语义说明');
note(html.includes('id="gitsrc-auth-type"') && html.includes('id="gitsrc-password-fields"')
  && html.includes('id="clone-auth-mode"') && html.includes('id="clone-inline-fields"')
  && app.includes("body.authType === 'password'") && app.includes('syncCloneAuthFields'),
'外部 Git 源与克隆表单均支持账号密码 / Token 两种方式');
note(['/openlist/connections', 'data-olc-op="activate"', 'function renderOpenlistConnections',
  'function fillOpenlistConnectionForm']
  .every((s) => app.includes(s)) && html.includes('id="ol-conn-list"'),
'OpenList 多连接的登记 / 切换 / 编辑 / 删除已接线');
note((html.match(/data-open-view=/g) || []).length >= 20
  && app.includes("document.addEventListener('click'") && app.includes('switchView(button.dataset.openView)'),
'每个独立页都带子导航条，点击后打开对应标签');
note(html.includes('id="docker-container-filter"') && html.includes('id="docker-stat-grid"')
  && app.includes('function renderDockerContainers') && app.includes('class="dk-ops"'),
'Docker 列表筛选、统计卡与操作按钮分组已补齐');
note(html.includes('id="storage-current-conn"') && html.includes('id="view-server-new"')
  && html.includes('id="view-deploys"'),
'服务器 / 存储 / 构建部署的表单与列表已拆到独立页');

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

// 版本与热更新：界面入口、四个动作、菜单样式必须齐全。
const sysActions = [...html.matchAll(/data-sys="([a-z-]+)"/g)].map((m) => m[1]);
note(html.includes('id="sys-btn"') && html.includes('id="sys-menu"')
  && ['check', 'apply', 'reload', 'rollback'].every((a) => sysActions.includes(a)),
'版本徽标与热更新菜单四项动作已接入', sysActions.join(', '));
note(['/system/version', '/system/update/check', '/system/update/apply', '/system/reload', '/system/rollback']
  .every((p) => app.includes(`'${p}'`)) && app.includes('function loadSystemInfo'),
'版本接口与热更新动作已全部接线');
note(/\.sys-version\s*\{[^}]*width:\s*auto/.test(css) && /\.sys-menu\s*\{/.test(css),
'版本菜单样式已定义且不挤压标签栏');

// 集成服务：四态映射 + 可操作提示，避免本机直跑时只显示 fetch failed。
note(['online', 'partial', 'unconfigured', 'offline'].every((s) => app.includes(`${s}: [`))
  && /s\.hint/.test(app) && /\.list-item \.desc\.hint/.test(css),
'集成服务四态与修复提示已接线');

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
      services: [
        { name: 'Gitea', url: 'http://localhost:3002', status: 'online', configured: true, detail: 'v1.23.8', hint: '' },
        { name: 'Code', url: 'http://localhost:8080', status: 'partial', configured: false, detail: '可连接', hint: '补 Token' },
        { name: 'OpenList', url: 'http://localhost:5244', status: 'unconfigured', configured: false, detail: '未配置', hint: '补 Token' },
        { name: 'Down', url: 'http://gitea:3000', status: 'offline', configured: false, detail: '域名无法解析', hint: '改地址' },
      ],
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
