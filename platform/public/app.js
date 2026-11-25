'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const VIEW_META = {
  overview: ['总览', '平台各模块运行状态与关键指标'],
  repos: ['仓库列表', '聚合平台自带与 GitHub / 自建 Gitea 等外部源，克隆后直接开发'],
  'repo-new': ['新建仓库', '在指定 Git 源上创建并自动初始化仓库'],
  'repo-clone': ['克隆到工作区', '支持已登记源凭据、本次账号密码 / Token，以及分层代理'],
  'git-runtime': ['Git 运行时', 'Git 可执行文件、SSH 宿主机兜底与执行通道检测'],
  ide: ['在线 IDE', '打开 code-server 项目：工作区目录可浏览选择，内嵌预览'],
  'ide-config': ['IDE 配置 / 凭据', 'code-server 服务地址、工作区映射与登录密码管理'],
  storage: ['文件浏览', '当前 OpenList 连接下的文件、上传、下载与批量操作'],
  'storage-conn': ['OpenList 连接', '登记 / 切换本机与多个外部 OpenList，查看状态与后台'],
  'storage-mounts': ['挂载存储', '当前连接下的挂载点增删改、启停与重载'],
  'storage-drivers': ['WebDAV / 驱动', 'WebDAV 地址与当前连接支持的驱动清单'],
  rclone: ['rclone 挂载', '用 rclone 管理远端存储（无需 FUSE），并经由共享网关以 SMB 共享出去'],
  builds: ['构建记录', '历史构建、实时日志与构建后端状态'],
  'build-start': ['启动构建', '选择项目、构建类型、编译环境与自动部署'],
  deploys: ['部署记录', 'SSH + SFTP 产物发布记录'],
  servers: ['服务器列表', '已登记 SSH 节点、终端、文件管理与连通性'],
  'server-new': ['添加服务器', '登记 SSH 凭据、默认部署目录与单个服务器代理'],
  extensions: ['扩展 / 数据库', '清单化安装管理数据库、备份恢复、版本升级与 DbGate'],
  gitsrc: ['Git 源', '登记 GitHub / 自建 Gitea / GitLab，支持 Token 与账号密码'],
  docker: ['Docker · 总览', 'Docker 端点、运行统计、安全策略与操作审计'],
  'docker-containers': ['Docker · 容器', '容器列表、日志、详情、资源占用与启停'],
  'docker-images': ['Docker · 镜像', '从仓库拉取、离线导入、导出与删除镜像'],
  'docker-volumes': ['Docker · 存储卷', '持久化卷的创建、挂载点与删除'],
  'docker-networks': ['Docker · 网络', '容器网络的创建、驱动与作用域'],
  'docker-compose': ['Docker · 编排', 'Compose YAML 模板登记（不在平台内执行）'],
  'docker-apps': ['Docker · 应用商店', '复用宝塔 appstore 模板：筛选 / 搜索 / 填参生成 compose 与 .env'],
  proxy: ['代理配置', '全局 / 分组 / Git Host 规则 / 单项覆盖，四级优先级解析与连通性测试'],
  environment: ['环境 · 自适应诊断', '自动识别环境、体检、切换档案与自动处置，换机器无需改代码'],
  envcfg: ['环境 · 变量配置', '查看与管理 .env：白名单写入、脱敏、待重启提示与诊断联动的配置指引'],
  ai: ['配置 AI 模型', 'API 服务、宿主机 / WSL 本地 AI 程序与代理'],
  'ai-list': ['已配置模型', '查看、编辑、删除已保存的 AI 服务'],
  'ai-test': ['连通性测试', '向已保存的服务发起真实请求验证可用性'],
  ops: ['AI 运维', '多轮对话式运维助手，支持文件 / 图片与会话留存'],
  aichat: ['AI 会话', 'DeepSeek Harness 驱动的会话式助手，对话与工具轨迹一目了然'],
  users: ['账号管理', '管理员新增账号、调整角色、禁用与重置密码'],
};
const MODULE_ICONS = {
  overview: '◈', repos: '⑂', 'repo-new': '＋', 'repo-clone': '⇩', 'git-runtime': '⚙',
  ide: '⌘', 'ide-config': '⎈', storage: '▤', 'storage-conn': '⇄', 'storage-mounts': '⛁', 'storage-drivers': '⎗', rclone: '⇄',
  builds: '⚙', 'build-start': '▶', deploys: '⇧',
  servers: '▣', 'server-new': '＋', extensions: '▦', gitsrc: '⑃',
  docker: '⬡', 'docker-containers': '▣', 'docker-images': '◫', 'docker-volumes': '⛁',
  'docker-networks': '⌘', 'docker-compose': '▦', 'docker-apps': '◉',
  proxy: '⇄', environment: '⌬', envcfg: '⚙', ai: '✦', 'ai-list': '☷', 'ai-test': '⇆', ops: '◎', aichat: '✧',
  users: '♙',
};
// 子页面归属：侧边栏主项保持高亮，标签栏仍显示各自的子页标题。
const NAV_GROUP = {
  'repo-new': 'repos', 'repo-clone': 'repos', 'git-runtime': 'repos', gitsrc: 'repos',
  'storage-conn': 'storage', 'storage-mounts': 'storage', 'storage-drivers': 'storage', rclone: 'storage',
  'build-start': 'builds', deploys: 'builds', 'server-new': 'servers',
  'ai-list': 'ai', 'ai-test': 'ai', 'ide-config': 'ide',
  'docker-containers': 'docker', 'docker-images': 'docker', 'docker-volumes': 'docker',
  'docker-networks': 'docker', 'docker-compose': 'docker', 'docker-apps': 'docker',
  envcfg: 'environment',
};

let currentView = 'overview';
let currentStoragePath = '/';
const storageState = {
  files: [], selected: new Set(), storages: [], drivers: [], connection: null, editId: '',
  // v0.4.28 · 连接根目录映射：非空表示正在只读浏览指定连接的根目录，写操作隐藏。
  rootMapConnId: '',
  // v0.3.11：文件浏览排序（目录恒优先，组内按所选字段升降序）。
  sort: { key: 'name', dir: 'asc' },
};
// v0.4.29 rclone 存储层状态。与 storageState 分离，避免影响 OpenList 文件页。
const rcloneState = { path: '/', remote: '', editId: '', remotes: [], status: null, gateway: null };
const proxyState = { config: null, entities: null };
let logTimer = null;
// 存储列表请求序号：快速切目录时，晚到的旧响应必须丢弃，避免「列表=A、路径=B」导致删除/重命名误伤别处。
let storageLoadSeq = 0;
let selectedBuildId = null;
let detectedPrograms = null;
let detectedOnce = false;
// AI 模型配置：编辑表单里的模型目录（{id,name} 数组）与「获取可用模型」结果缓存。
let providerModelRows = [];
let providerAvailableModels = [];
let serverCache = [];
let serverPollTimer = null;
let serverPollBusy = false;
let gitsrcEditId = '';
let gitsrcCache = [];
// v0.3.8：从 Git 源错误卡 / 扩展体检跳到「环境配置」时，带过来的高亮键与问题编号。
let envcfgFocus = [];
let envcfgProblem = '';

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false });
}

function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/* ---------------- v0.3.11 · 文件浏览排序与目录 / 文件区分 ---------------- */
const FOLDER_SVG = '<svg viewBox="0 0 20 16" width="18" height="15" aria-hidden="true"><path d="M1.5 2.5h6l2 2.2h9v9.3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" fill="#f7bd4b" stroke="#d99a20" stroke-width=".8"/></svg>';
// v0.4.7：文件操作列改用图标按钮，避免文字按钮在窄列里换行错位。
const ACT_ICONS = {
  edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11.5 1.5l3 3-9 9H2.5v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5M9.5 6.5a2.5 2.5 0 0 1 0 3.5L8 11.5a2.5 2.5 0 0 1-3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  rename: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 13l3-1 7-7-2-2-7 7zM11 4l2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  del: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M5 4l.8 9h4.4L11 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const EXT_COLORS = {
  js: 'amber', ts: 'blue', json: 'amber', php: 'purple', py: 'blue', go: 'cyan', rs: 'orange',
  java: 'orange', css: 'blue', scss: 'pink', html: 'orange', xml: 'orange', sh: 'green',
  yml: 'green', yaml: 'green', md: 'cyan', sql: 'purple', env: 'gray', conf: 'gray',
  png: 'pink', jpg: 'pink', jpeg: 'pink', gif: 'pink', svg: 'orange', pdf: 'red',
  zip: 'amber', gz: 'amber', tar: 'amber', exe: 'red', dll: 'red', so: 'red',
};

function fileExt(item) {
  const name = String(item.name || '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function fileTypeLabel(item) {
  if (item.isDir) return '文件夹';
  const ext = fileExt(item);
  return ext ? `${ext.toUpperCase()} 文件` : '文件';
}

/** 目录统一用黄色文件夹图标；文件按后缀给彩色类型角标，与远程 SFTP 的识别结果兼容。 */
function fileGlyph(item) {
  if (item.isDir) return `<span class="ft-icon ft-folder" title="文件夹">${FOLDER_SVG}</span>`;
  if (item.icon) return `<span class="ft-icon ft-${esc(item.color || 'gray')}" title="${esc(item.language || fileTypeLabel(item))}">${esc(item.icon)}</span>`;
  const ext = fileExt(item);
  const label = ext ? ext.slice(0, 3).toUpperCase() : 'TXT';
  return `<span class="ft-icon ft-${EXT_COLORS[ext] || 'ext'}" title="${esc(fileTypeLabel(item))}">${esc(label)}</span>`;
}

function sortHeader(label, key, sort, attr) {
  const active = sort.key === key;
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅';
  return `<th class="sortable${active ? ' sorted' : ''}" ${attr}="${key}" title="点击按${esc(label)}排序，再点切换升 / 降序">${esc(label)}<span class="sort-arrow">${arrow}</span></th>`;
}

function toggleSort(sort, key) {
  if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
  else { sort.key = key; sort.dir = 'asc'; }
  return sort;
}

/** 文件夹永远排在文件前面；组内按名称 / 修改时间 / 类型 / 大小排序。 */
function sortFileItems(items, sort) {
  const key = sort.key || 'name';
  const sign = sort.dir === 'desc' ? -1 : 1;
  const name = (f) => String(f.name || '');
  const cmpName = (a, b) => name(a).localeCompare(name(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
  const time = (f) => {
    const v = Date.parse(f.mtime || f.modified || 0);
    return Number.isFinite(v) ? v : 0;
  };
  return (Array.isArray(items) ? [...items] : []).sort((a, b) => {
    if (Boolean(a.isDir) !== Boolean(b.isDir)) return a.isDir ? -1 : 1;
    let r = 0;
    if (key === 'mtime') r = time(a) - time(b);
    else if (key === 'size') r = Number(a.size || 0) - Number(b.size || 0);
    else if (key === 'type') r = fileTypeLabel(a).localeCompare(fileTypeLabel(b), 'zh-CN', { sensitivity: 'base' });
    else r = cmpName(a, b);
    return (r || cmpName(a, b)) * sign;
  });
}

function toast(message, isError = false) {
  const box = $('#toast');
  box.textContent = message;
  box.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.className = 'toast'; }, 3600);
}

/**
 * 平台统一确认弹窗（v0.4.4）：替代浏览器原生 confirm()，视觉与站点模态框一致。
 * 返回 Promise<boolean>；Esc / 遮罩 / 关闭按钮一律视为取消，支持自定义按钮文案。
 */
function confirmDialog(options = {}) {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    if (!modal) { resolve(false); return; }
    $('#confirm-title').textContent = opts.title || '请确认';
    $('#confirm-body').textContent = opts.message || '';
    const okBtn = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    okBtn.textContent = opts.confirmText || '确认';
    cancelBtn.textContent = opts.cancelText || '取消';
    okBtn.className = `btn ${opts.danger === false ? 'btn-primary' : 'btn-danger'}`;
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    const finish = (value) => {
      modal.hidden = true;
      okBtn.onclick = null; cancelBtn.onclick = null; modal.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    modal.onclick = (e) => {
      if (e.target === modal || (e.target.closest && e.target.closest('[data-confirm-close]'))) finish(false);
    };
    document.addEventListener('keydown', onKey);
    modal.hidden = false;
    okBtn.focus();
  });
}

/**
 * 平台统一输入 / 信息弹窗（v0.4.4）：替代浏览器原生 prompt()，与确认弹窗同款视觉。
 * 返回 Promise<string|null>；取消 / Esc / 遮罩 / 空输入一律 null。
 * readOnly 用于「只展示一次性信息」（如自动生成的初始密码），确定按钮一键复制。
 */
function promptDialog(options = {}, fallbackValue) {
  // 兼容原生 prompt(message, defaultValue) 的两参数写法。
  const opts = typeof options === 'string'
    ? { message: options, value: fallbackValue === undefined ? '' : fallbackValue }
    : options;
  return new Promise((resolve) => {
    const modal = $('#prompt-modal');
    if (!modal) { resolve(null); return; }
    const input = $('#prompt-input');
    const okBtn = $('#prompt-ok');
    const cancelBtn = $('#prompt-cancel');
    const err = $('#prompt-error');
    const body = $('#prompt-body');
    $('#prompt-title').textContent = opts.title || '请输入';
    body.textContent = opts.message || '';
    body.hidden = !opts.message;
    input.value = opts.value === undefined || opts.value === null ? '' : String(opts.value);
    input.type = opts.password ? 'password' : 'text';
    input.readOnly = Boolean(opts.readOnly);
    input.placeholder = opts.placeholder || '';
    input.hidden = Boolean(opts.hideInput);
    err.hidden = true;
    okBtn.textContent = opts.confirmText || (opts.readOnly ? '复制并关闭' : '确定');
    cancelBtn.textContent = opts.cancelText || '取消';
    cancelBtn.hidden = Boolean(opts.readOnly);
    const finish = (value) => {
      modal.hidden = true;
      okBtn.onclick = null; cancelBtn.onclick = null; modal.onclick = null; input.onkeydown = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const submit = () => {
      const value = opts.readOnly ? String(opts.copyText || opts.value || '') : input.value;
      if (!opts.readOnly && !opts.allowEmpty && !value.trim()) {
        err.textContent = '请输入内容，或点「取消」放弃本次操作';
        err.hidden = false;
        input.focus();
        return;
      }
      if (opts.copyText) {
        try { if (navigator.clipboard) navigator.clipboard.writeText(String(opts.copyText)); } catch { /* 剪贴板权限不影响关闭 */ }
      }
      finish(opts.readOnly ? true : value);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    okBtn.onclick = submit;
    cancelBtn.onclick = () => finish(null);
    modal.onclick = (e) => {
      if (e.target === modal || (e.target.closest && e.target.closest('[data-prompt-close]'))) finish(null);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    document.addEventListener('keydown', onKey);
    modal.hidden = false;
    input.focus();
    if (opts.readOnly) input.select();
  });
}

// 若平台设置了 ADMIN_TOKEN，可在浏览器控制台执行：
// localStorage.setItem('dp_token', '<你的 token>')
function authHeaders() {
  const token = localStorage.getItem('dp_token');
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const init = { headers: authHeaders(), ...options };
  if (init.body !== undefined && typeof init.body !== 'string' && !(init.body instanceof ArrayBuffer)) {
    init.body = JSON.stringify(init.body);
    init.headers['content-type'] = 'application/json';
  }
  const response = await fetch(`/api${path}`, init);
  let json;
  try { json = await response.json(); } catch { throw new Error('服务端返回内容不是 JSON'); }
  if (!json.ok) {
    const status = Number(json.status || response.status);
    const prefix = status === 502 ? '上游服务不可用'
      : status === 404 ? '资源不存在'
        : status === 409 ? '操作冲突'
          : status === 400 ? '请求参数有误'
            : status >= 500 ? '服务端异常' : '请求失败';
    const hint = json.hint ? `（${String(json.hint).slice(0, 140)}）` : '';
    const err = new Error(`${prefix}：${json.error || `HTTP ${status}`}${hint}`);
    err.status = status;
    err.code = json.code || '';
    err.hint = json.hint || '';
    err.rawError = json.error || '';
    if (status === 401 && !path.startsWith('/auth/')) invalidateSession('登录状态已失效，请重新登录');
    throw err;
  }
  return json.data;
}

function streamToken() {
  const token = localStorage.getItem('dp_token');
  return token ? `&token=${encodeURIComponent(token)}` : '';
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function badge(text, tone = 'gray') {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">暂无数据</div>';
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function errorBlock(message, hint = '') {
  return `<div class="empty"><div style="color:var(--red);font-weight:600">${esc(message)}</div>${hint ? `<div style="margin-top:6px">${esc(hint)}</div>` : ''}</div>`;
}

/* =========================== 多标签工作台 =========================== */
// 每个标签持有一个常驻 DOM 面板；切换只改 display，表单内容 / 终端会话 / 编辑器内容都不会丢。
const tabs = new Map();
let activeTabId = null;
let tabCounter = 0;

const q = (pane, role) => pane.querySelector(`[data-role="${role}"]`);
const qq = (pane, role) => Array.from(pane.querySelectorAll(`[data-role="${role}"]`));
const tabEl = (id) => Array.from($('#tabbar').querySelectorAll('.tab')).find((el) => el.dataset.tabId === id);

function renderTabs() {
  const bar = $('#tabbar');
  const scroll = Number(bar.scrollLeft) || 0;
  bar.innerHTML = Array.from(tabs.values()).map((t) => `
    <div class="tab ${t.id === activeTabId ? 'active' : ''}" data-tab-id="${esc(t.id)}" aria-label="${esc(t.title)}">
      <span class="tab-ico">${esc(t.icon || '◇')}</span>
      <span class="tab-title">${esc(t.title)}</span>
      ${t.dirty ? '<span class="tab-dirty"></span>' : ''}
      ${t.closable ? `<span class="tab-close" data-tab-close="${esc(t.id)}" title="关闭标签">×</span>` : ''}
    </div>`).join('');
  bar.scrollLeft = scroll;
  revealActiveTab();
  updateTabScroll();
}

/* 只做横向定位，不用 scrollIntoView：后者会顺带滚动整页，造成"上下乱跳"。 */
function revealActiveTab() {
  const bar = $('#tabbar');
  const active = tabEl(activeTabId);
  if (!active || !active.getBoundingClientRect || !bar.getBoundingClientRect) return;
  try {
    const b = bar.getBoundingClientRect();
    const t = active.getBoundingClientRect();
    if (t.left < b.left + 4) bar.scrollLeft -= (b.left + 4 - t.left);
    else if (t.right > b.right - 4) bar.scrollLeft += (t.right - b.right + 4);
  } catch { /* noop */ }
}

/* 溢出时才出现 ‹ ›，标签栏本身不显示任何原生滚动条。 */
function updateTabScroll() {
  const bar = $('#tabbar');
  const prev = $('#tab-scroll-prev');
  const next = $('#tab-scroll-next');
  const max = Math.max(0, (Number(bar.scrollWidth) || 0) - (Number(bar.clientWidth) || 0));
  const left = Number(bar.scrollLeft) || 0;
  prev.hidden = max <= 2 || left <= 2;
  next.hidden = max <= 2 || left >= max - 2;
}

function scrollTabs(delta) {
  const bar = $('#tabbar');
  hideTabTip();
  if (bar.scrollBy) { try { bar.scrollBy({ left: delta, behavior: 'smooth' }); return; } catch { /* noop */ } }
  bar.scrollLeft = (Number(bar.scrollLeft) || 0) + delta;
}

/* --------------------------- 标签说明浮层 --------------------------- */
let tipTimer = null;
let tipAnchorId = null;
let tipPinned = false;

function tabTipHtml(tab) {
  if (!tab) return '';
  const kinds = { module: '模块页面', files: '远程文件', editor: '代码编辑', terminal: 'SSH 终端' };
  const meta = [];
  if (tab.kind === 'files' || tab.kind === 'editor') {
    meta.push(`服务器：${tab.ctx.serverName || tab.ctx.host || '-'}`);
    meta.push(`${tab.kind === 'editor' ? '文件' : '当前目录'}：${tab.ctx.path || '-'}`);
  }
  if (tab.kind === 'editor' && tab.ctx.meta) {
    meta.push(`识别：${tab.ctx.meta.language || '纯文本'} · ${tab.ctx.meta.encoding || 'UTF-8'} · ${tab.ctx.meta.newline || 'LF'}`);
  }
  if (tab.kind === 'terminal') meta.push('会话：交互式 SSH · 多终端互不干扰');
  if (tab.kind === 'module') meta.push('左键切换 · 右键批量操作 · 中键关闭');
  if (tab.dirty) meta.push('● 当前有未保存的修改');
  return `
    <div class="tip-title">${esc(tab.icon || '◇')} ${esc(tab.title)}<span class="tip-kind">${esc(kinds[tab.kind] || '标签')}</span></div>
    <div class="tip-desc">${esc(tab.sub || '暂无说明')}</div>
    ${meta.length ? `<div class="tip-meta">${meta.map((m) => esc(m)).join('<br>')}</div>` : ''}`;
}

function showTabTip(tab, anchor) {
  if (!tab || !anchor || !anchor.getBoundingClientRect) return;
  const tip = $('#tab-tip');
  tip.innerHTML = tabTipHtml(tab);
  tip.hidden = false;
  tipAnchorId = tab.id;
  const info = $('#tab-info');
  if (info) info.classList.toggle('on', anchor === info);
  try {
    const r = anchor.getBoundingClientRect();
    const width = tip.offsetWidth || 280;
    const height = tip.offsetHeight || 90;
    const left = Math.max(10, Math.min(r.left, window.innerWidth - width - 10));
    const below = r.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 8) : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  } catch { /* noop */ }
}

function hideTabTip() {
  clearTimeout(tipTimer);
  tipTimer = null;
  const tip = $('#tab-tip');
  if (tip) tip.hidden = true;
  const info = $('#tab-info');
  if (info) info.classList.remove('on');
  tipAnchorId = null;
}

function scheduleTabTip(tab, anchor, delay = 220) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTabTip(tab, anchor), delay);
}

function setTabDirty(tab, dirty) {
  tab.dirty = Boolean(dirty);
  const el = tabEl(tab.id);
  if (el) {
    const dot = el.querySelector('.tab-dirty');
    if (dirty && !dot) {
      const marker = document.createElement('span');
      marker.className = 'tab-dirty';
      el.insertBefore(marker, el.querySelector('.tab-close'));
    }
    if (!dirty && dot) dot.remove();
  }
  const state = tab.kind === 'editor' ? q(tab.pane, 'ed-state') : null;
  if (state) {
    state.textContent = dirty ? '未保存' : '已保存';
    state.className = `ed-state ${dirty ? 'dirty' : 'saved'}`;
  }
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  activeTabId = id;
  // 先清所有面板（含已关闭但 DOM 常驻的模块页），再激活当前，避免两页同时显示。
  $$('#content .page').forEach((el) => el.classList.remove('active'));
  tabs.forEach((t) => { if (t.pane) t.pane.classList.toggle('active', t.id === id); });
  $$('.nav-item').forEach((b) => b.classList.toggle('active', tab.kind === 'module' && b.dataset.view === (NAV_GROUP[tab.module] || tab.module)));
  $$('.subnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.openView === tab.module));
  // 顶部不再重复标题：浏览器标签页标题 + 悬停浮层 + ⓘ 承载上下文说明。
  document.title = `${tab.title} · DevPlatform`;
  const info = $('#tab-info');
  if (info && info.setAttribute) info.setAttribute('aria-label', `查看当前标签说明：${tab.title}${tab.sub ? ` — ${tab.sub}` : ''}`);
  hideTabTip();
  if (tab.kind === 'module') currentView = tab.module;
  renderTabs();
  if (!tab.loaded && tab.loader) {
    tab.loaded = true;
    Promise.resolve(tab.loader(tab)).catch((e) => toast(e.message, true));
  }
  if (tab.onActivate) {
    try { tab.onActivate(tab); } catch { /* noop */ }
  }
  // v0.3.11：Compose 的 CodeMirror 在隐藏页里初始化，切到该页后必须刷新一次才能正确布局。
  if (tab.kind === 'module' && tab.module === 'docker-compose') {
    try { if (composeState.cm) setTimeout(() => composeState.cm.refresh(), 0); } catch { /* noop */ }
  }
  persistTabs();
}

function registerTab(config) {
  const tab = { loaded: false, dirty: false, closable: true, dynamic: false, ...config };
  tabs.set(tab.id, tab);
  renderTabs();
  activateTab(tab.id);
  return tab;
}

async function closeTab(id, force = false) {
  const tab = tabs.get(id);
  if (!tab || (!tab.closable && !force)) return;
  if (tab.dirty && !force && !await confirmDialog({ message: `「${tab.title}」有未保存的修改，确定关闭吗？` })) return;
  if (tab.onClose) { try { tab.onClose(tab); } catch { /* noop */ } }
  if (tab.dynamic && tab.pane) tab.pane.remove();
  tabs.delete(id);
  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    activeTabId = null;
    if (remaining.length) activateTab(remaining[remaining.length - 1]);
    else openModuleTab('overview');
  } else renderTabs();
  persistTabs();
}

function openModuleTab(view) {
  const id = `module:${view}`;
  if (tabs.has(id)) return activateTab(id);
  const pane = $(`#view-${view}`);
  if (!pane) return;
  registerTab({
    id, kind: 'module', module: view,
    title: VIEW_META[view][0], sub: VIEW_META[view][1], icon: MODULE_ICONS[view],
    closable: view !== 'overview', pane,
    loader: () => loaders[view] && loaders[view](),
  });
}

function switchView(view) { openModuleTab(view); }

function refreshActiveTab() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  if (tab.kind === 'module') { if (loaders[tab.module]) loaders[tab.module](); toast('已刷新当前页'); return; }
  if (tab.kind === 'files') { loadRemoteFiles(tab); return; }
  if (tab.kind === 'editor') { loadEditor(tab, tab.ctx.requestedEncoding || 'auto', true); return; }
  if (tab.kind === 'terminal' && tab.ctx.fit) { tab.ctx.fit(); toast('终端已自适应'); }
}

function persistTabs() {
  try {
    localStorage.setItem('dp_tabs', JSON.stringify({
      modules: Array.from(tabs.values()).filter((t) => t.kind === 'module').map((t) => t.module),
      active: activeTabId,
    }));
  } catch { /* 隐私模式下忽略 */ }
}

function restoreTabs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('dp_tabs') || '{}'); } catch { saved = {}; }
  const list = Array.isArray(saved.modules) && saved.modules.length
    ? saved.modules.filter((v) => VIEW_META[v]) : ['overview'];
  if (!list.includes('overview')) list.unshift('overview');
  list.forEach((v) => openModuleTab(v));
  activateTab(tabs.has(saved.active) ? saved.active : 'module:overview');
}

function newPane(id, html) {
  const pane = document.createElement('div');
  pane.className = 'page tab-pane';
  pane.dataset.paneId = id;
  pane.innerHTML = html;
  $('#content').appendChild(pane);
  return pane;
}

function fillSelect(select, options, value) {
  if (!select) return;
  select.innerHTML = (options || []).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (value !== undefined) select.value = value;
}

function showTabMenu(x, y) {
  const menu = $('#tab-menu');
  menu.hidden = false;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 190))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 160))}px`;
    menu.style.right = 'auto';
  } else {
    menu.style.position = 'absolute';
    menu.style.left = 'auto';
    menu.style.top = '34px';
    menu.style.right = '0';
  }
}

/* --------------------------------- 总览 ---------------------------------- */

async function loadOverview() {
  try {
    const d = await api('/overview');
    const c = d.counts;
    $('#stat-grid').innerHTML = [
      ['已配置模型器', c.servers, 'SSH 可连接节点'],
      ['构建任务', c.builds, `成功 ${c.buildSuccess} · 失败 ${c.buildFailed}`],
      ['部署次数', c.deploys, '产物自动发布'],
      ['AI 服务', c.aiProviders, 'API / 本地 CLI / 代理'],
    ].map(([label, value, sub]) => `
      <div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>
    `).join('');
    $('#service-list').innerHTML = d.services.map((s) => {
      const meta = {
        online: ['在线', 'green'],
        partial: ['待配置', 'amber'],
        unconfigured: ['未配置', 'amber'],
        offline: ['离线', 'red'],
      }[s.status] || ['离线', 'red'];
      return `
      <div class="list-item">
        <div>
          <div class="title">${esc(s.name)}</div>
          <div class="desc">${esc(s.url)} · ${esc(s.detail)}</div>
          ${s.hint ? `<div class="desc hint">↳ ${esc(s.hint)}</div>` : ''}
        </div>
        ${badge(meta[0], meta[1])}
      </div>`;
    }).join('');
    const pill = $('#demo-pill');
    pill.textContent = '正常模式';
    pill.classList.add('live');
    void loadHostInfo().catch(() => {});
    return await refreshSvcSetup(d.services).catch(() => false);
  } catch (e) { toast(e.message, true); return false; }
}

/* --------------------- 集成服务一键安装（v0.4.5） --------------------- */
// 概览页「集成服务」卡片内：管理员可一键触发 native-services.ps1
// （下载二进制 → 生成凭据写 .env → 启动），日志实时滚动，无需手工跑脚本。
// 管理区位于服务列表上方常驻，标题旁只保留「状态摘要 + 刷新状态」两个有实际作用的元素，
// 不再放只做滚动/高亮、点了看不出变化的「管理集成服务 ↓」跳转按钮。
let svcJobTimer = null;
let lastOverviewServices = [];

function svcSummary(downCount, total, runningJob, unavailable = false) {
  const el = $('#svc-setup-summary');
  if (!el) return;
  el.hidden = false;
  el.className = 'badge ' + (unavailable ? 'gray' : runningJob ? 'blue' : downCount ? 'amber' : 'green');
  el.textContent = unavailable ? '状态未知'
    : runningJob ? '任务执行中…'
      : downCount ? `${Math.max(0, total - downCount)}/${total} 就绪 · ${downCount} 项未就绪`
        : `${total}/${total} 就绪`;
}

async function refreshSvcSetup(overviewServices) {
  const box = $('#svc-setup');
  if (!box) return false;
  if (Array.isArray(overviewServices)) lastOverviewServices = overviewServices;
  let st;
  try { st = await api('/services/setup-status'); }
  catch { svcSummary(0, 0, false, true); return false; }
  if (!st.scriptAvailable) {
    box.hidden = true;
    const el = $('#svc-setup-summary');
    if (el) { el.hidden = false; el.className = 'badge gray'; el.textContent = '未找到安装脚本'; }
    return true;
  }
  const services = st.services || [];
  const bad = services.filter((s) => !s.running);
  // 概览口径（连通性）与安装状态口径（端口 + 健康检查）都算未就绪，避免提示与按钮不一致。
  // lastOverviewServices 沿用最近一次概览结果，任务刚启动、无参刷新时徽标不会闪回「全部就绪」。
  const downFromOverview = lastOverviewServices.filter((s) => s && s.status !== 'online');
  const downCount = Math.max(bad.length, downFromOverview.length);
  const isAdmin = currentUser && currentUser.role === 'admin';
  const running = st.runningJob || null;
  svcSummary(downCount, services.length, running);
  const $actions = $('#svc-setup-actions');
  const $note = $('#svc-setup-note');
  const $log = $('#svc-setup-log');
  const $install = $('#svc-setup-install');
  const $start = $('#svc-setup-start');
  const $stop = $('#svc-setup-stop');
  const $rows = $('#svc-setup-services');
  const btn = (el, show, disabled = false) => { if (el) { el.hidden = !show; el.disabled = disabled; } };
  // 管理员常驻显示：一键安装/启动/停止是「集成服务管理」入口，不该只在故障时出现。
  // 普通用户无写权限，仅在有故障或任务进行中看到状态说明。
  const show = Boolean(isAdmin || downCount || running);
  box.hidden = !show;
  if (!show) return true;
  // 管理员进总览时拉一次凭据清单；后续由「重新读取」或安装任务完成后刷新。
  if (isAdmin && !svcCredLoaded) void loadServiceCredentials();
  btn($install, isAdmin && !running);
  btn($start, isAdmin && !running);
  btn($stop, isAdmin && !running);
  if ($actions) $actions.hidden = !isAdmin;
  // 逐服务明细：一眼看清「装没装 / 端口通不通 / 健康检查过没过」，管理动作才有依据。
  if ($rows) {
    $rows.innerHTML = services.map((s) => {
      const tone = s.running ? 'green' : (s.portOpen ? 'amber' : 'red');
      const state = s.running ? '就绪' : (s.portOpen ? '健康检查未过' : '未运行');
      const detail = `${s.installed ? '已安装' : '未安装'} · :${s.port} · ${s.portOpen ? '端口通' : '端口不通'}`;
      return `<div class="svc-setup-row"><span class="svc-setup-name">${esc(s.name)}</span>${badge(state, tone)}<span class="muted small">${esc(detail)}</span></div>`;
    }).join('');
  }
  if ($note) {
    if (running) {
      $note.hidden = false;
      $note.textContent = `正在执行「${running.action === 'setup' ? '安装并启动' : running.action === 'start' ? '启动服务' : '停止服务'}」，日志见下方…`;
    } else if (!isAdmin) {
      $note.hidden = downCount === 0;
      $note.textContent = downCount ? `有 ${downCount} 个服务未就绪，请联系管理员在页面上一键安装，或手工执行 windows\\native-services.ps1` : '';
    } else if (downFromOverview.length && !bad.length) {
      $note.hidden = false;
      $note.textContent = '概览显示服务未就绪，但端口与健康检查均正常（多为状态缓存）；可点「刷新状态」重新探测，或点「启动服务」重新拉起';
    } else {
      $note.hidden = false;
      $note.textContent = bad.length
        ? `${bad.length} 项未就绪：可点「一键安装并启动」修复，或点「启动服务」重新拉起；执行日志见下方。`
        : '全部就绪。按钮可重复执行：「一键安装并启动」用于修复或更新，「停止服务」用于释放端口。';
    }
  }
  // 任务进行中：拉日志滚动轮询；结束时刷新概览与新状态。
  if (running) {
    const j = await api('/services/setup/job').catch(() => null);
    if (j && $log) {
      $log.hidden = false;
      const tail = (j.logs || []).slice(-200).join('\n');
      if ($log.textContent !== tail) { $log.textContent = tail; $log.scrollTop = $log.scrollHeight; }
    }
    if (!svcJobTimer) {
      svcJobTimer = setInterval(async () => {
        try {
          const cur = await api('/services/setup/job');
          if (!cur || cur.status !== 'running') {
            clearInterval(svcJobTimer); svcJobTimer = null;
            if (cur && cur.status === 'success') {
              toast('集成服务任务完成');
              // 安装脚本可能重新生成账号 / 令牌，凭据面板要跟着刷新。
              void loadServiceCredentials();
            } else if (cur && cur.status === 'failed') toast('集成服务任务失败，请查看日志', true);
            await loadOverview();
            return;
          }
          if ($('#svc-setup-log')) {
            const tail = (cur.logs || []).slice(-200).join('\n');
            const el = $('#svc-setup-log');
            if (el.textContent !== tail) { el.textContent = tail; el.scrollTop = el.scrollHeight; }
          }
        } catch { clearInterval(svcJobTimer); svcJobTimer = null; }
      }, 1500);
    }
  } else if ($log) { $log.hidden = true; $log.textContent = ''; }
  return true;
}

/* --------------------- 集成服务账号 / 口令（v0.4.5） --------------------- */
// 三项服务的账号 / 口令由安装脚本自动生成；这里统一查看、复制、修改，
// 修改会写 .env 并同步到上游服务（IDE 切换模式会单独重启）。
const svcCredState = { items: [], plain: {} };
let svcCredLoaded = false;

function svcCredRow(item) {
  const key = esc(item.key);
  const isIde = item.key === 'ide';
  const modeBadge = item.modeLabel ? badge(item.modeLabel, item.mode === 'token' ? 'amber' : 'green') : '';
  const links = [
    `<a class="btn btn-sm" href="${esc(item.loginUrl)}" target="_blank" rel="noopener">${isIde ? '打开 IDE' : '登录页'}</a>`,
    item.manageUrl ? `<a class="btn btn-sm" href="${esc(item.manageUrl)}" target="_blank" rel="noopener">管理后台</a>` : '',
  ].join('');
  return `<div class="svc-cred-card" data-svc-cred="${key}">
    <div class="svc-cred-top"><b>${esc(item.name)}</b>${modeBadge}<span class="muted small">${esc(item.url)}</span><span class="svc-cred-links">${links}</span></div>
    <div class="svc-cred-grid">
      <span class="muted small">账号</span><code>${item.user ? esc(item.user) : '（无用户名，仅访问口令）'}</code>
      <span class="muted small">${isIde ? '访问口令' : '登录密码'}</span><code data-svc-cred-value="${key}">${esc(item.masked || '—')}</code>
      <span class="muted small">访问令牌</span><code>${esc(item.tokenMasked || (item.tokenKey ? '未配置' : '不适用'))}</code>
    </div>
    <div class="svc-cred-actions">
      <button class="btn btn-sm" type="button" data-svc-cred-reveal="${key}">显示${isIde ? '口令' : '密码'}</button>
      <button class="btn btn-sm" type="button" data-svc-cred-copy="${key}">复制</button>
      <input type="password" class="svc-cred-input" data-svc-cred-new="${key}" placeholder="新口令（8–128 位）" autocomplete="new-password" />
      <button class="btn btn-sm btn-primary" type="button" data-svc-cred-save="${key}">修改并同步</button>
    </div>
    ${isIde ? `<div class="svc-cred-actions svc-cred-mode">
      <label class="muted small">访问模式
        <select class="ui-select ui-select-sm" data-svc-cred-mode="${key}">
          <option value="open"${item.mode === 'token' ? '' : ' selected'}>免密访问（默认）</option>
          <option value="token"${item.mode === 'token' ? ' selected' : ''}>口令保护</option>
        </select>
      </label>
      <button class="btn btn-sm" type="button" data-svc-cred-mode-save="${key}">应用并重启 IDE</button>
    </div>` : ''}
    <div class="hint">${esc(item.note)}　·　配置项 <code>${esc(item.passwordKey)}</code>${item.tokenKey ? ` / <code>${esc(item.tokenKey)}</code>` : ''}</div>
  </div>`;
}

function renderServiceCredentials() {
  const box = $('#svc-credentials');
  if (!box) return;
  const admin = Boolean(currentUser && currentUser.role === 'admin');
  box.hidden = !admin;
  if (!admin) return;
  const list = $('#svc-cred-list');
  if (list) list.innerHTML = svcCredState.items.map(svcCredRow).join('');
  const hint = $('#svc-cred-hint');
  if (hint) {
    hint.hidden = false;
    hint.textContent = '改口令会写入 .env（自动备份）并同步到服务本身：Gitea / OpenList 的访问令牌不因改密失效，OpenList 会自动刷新令牌；IDE 切换访问模式会单独重启 IDE，不打断另外两项服务。';
  }
}

async function loadServiceCredentials() {
  const box = $('#svc-credentials');
  if (!box) return;
  if (!currentUser || currentUser.role !== 'admin') { box.hidden = true; return; }
  try {
    const d = await api('/services/credentials');
    svcCredState.items = d.services || [];
    svcCredState.plain = {};
    svcCredLoaded = true;
    renderServiceCredentials();
  } catch (e) {
    box.hidden = false;
    const list = $('#svc-cred-list');
    if (list) list.innerHTML = `<div class="muted small">读取失败：${esc(e.message)}</div>`;
  }
}

const $svcCredList = $('#svc-cred-list');
if ($svcCredList) {
  $svcCredList.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    const reveal = t.dataset.svcCredReveal;
    const copy = t.dataset.svcCredCopy;
    const save = t.dataset.svcCredSave;
    const modeSave = t.dataset.svcCredModeSave;
    const service = reveal || copy || save || modeSave;
    if (!service) return;
    try {
      if (reveal || copy) {
        let plain = svcCredState.plain[service];
        if (!plain) {
          const d = await api('/services/credentials/reveal', { method: 'POST', body: { service } });
          plain = d.password || '';
          svcCredState.plain[service] = plain;
        }
        const code = document.querySelector(`[data-svc-cred-value="${service}"]`);
        if (reveal) {
          if (code) code.textContent = plain || '—';
          toast('已显示明文，请留意周围环境');
        } else {
          if (!plain) { toast('没有可复制的口令', true); return; }
          await navigator.clipboard.writeText(plain);
          toast('已复制到剪贴板');
        }
        return;
      }
      if (modeSave) {
        const sel = document.querySelector(`[data-svc-cred-mode="${service}"]`);
        const mode = sel ? sel.value : 'open';
        if (!await confirmDialog({ message: `确认把在线 IDE 切换为「${mode === 'token' ? '口令保护' : '免密访问'}」？会单独重启 IDE（约 10 秒），Gitea / OpenList 不受影响。` })) return;
        const d = await api('/services/credentials', { method: 'PUT', body: { service, mode } });
        toast(d.message || '访问模式已更新');
        await loadServiceCredentials();
        return;
      }
      if (save) {
        const input = document.querySelector(`[data-svc-cred-new="${service}"]`);
        const password = input ? input.value.trim() : '';
        if (!password) { toast('请先输入新口令', true); return; }
        if (!await confirmDialog({ message: `确认修改「${service}」的登录口令？将写入 .env 并同步到服务本身，旧口令立即失效。` })) return;
        const d = await api('/services/credentials', { method: 'PUT', body: { service, password } });
        if (input) input.value = '';
        toast(d.message || '口令已更新');
        await loadServiceCredentials();
      }
    } catch (err) { toast(err.message, true); }
  });
}
const $svcCredRefresh = $('#svc-cred-refresh');
if ($svcCredRefresh) $svcCredRefresh.addEventListener('click', () => loadServiceCredentials());

async function svcSetupAction(action) {
  const verb = action === 'setup' ? '一键安装并启动全部集成服务' : action === 'start' ? '启动集成服务' : '停止集成服务';
  if (!await confirmDialog({ message: `确认${verb}？${action === 'setup' ? '首次安装需下载约 100~200MB 二进制（支持国内镜像加速），并自动写入服务凭据。' : ''}` })) return;
  try {
    await api('/services/setup', { method: 'POST', body: { action } });
    toast('任务已开始，请查看下方日志');
    await refreshSvcSetup();
  } catch (e) { toast(e.message, true); }
}

$('#svc-setup-install') && $('#svc-setup-install').addEventListener('click', () => svcSetupAction('setup'));
$('#svc-setup-start') && $('#svc-setup-start').addEventListener('click', () => svcSetupAction('start'));
$('#svc-setup-stop') && $('#svc-setup-stop').addEventListener('click', () => svcSetupAction('stop'));

// 「刷新状态」是真动作：重新拉概览连通性 + 端口/健康检查，明细与徽标随之更新。
const $svcRefresh = $('#svc-setup-refresh');
if ($svcRefresh) {
  $svcRefresh.addEventListener('click', async () => {
    $svcRefresh.disabled = true;
    $svcRefresh.textContent = '刷新中…';
    const okState = await loadOverview();
    $svcRefresh.disabled = false;
    $svcRefresh.textContent = okState === false ? '刷新状态' : '已刷新';
    if (okState !== false) setTimeout(() => { $svcRefresh.textContent = '刷新状态'; }, 1500);
  });
}

/* ------------------------- 运行主机信息（v0.3.10） ------------------------- */
async function loadHostInfo(force = false) {
  const body = $('#host-info-body');
  if (!body) return;
  const checked = $('#host-info-checked');
  try {
    if (checked) checked.textContent = '采集中…';
    const d = await api('/host-info' + (force ? '?force=1' : ''));
    const l = d.local || {};
    const h = d.host || {};
    const kv = (k, v) => `<div class="dk-kv-row"><span class="dk-kv-key">${esc(k)}</span><span class="dk-kv-val">${esc(v || '—')}</span></div>`;
    const side = (title, rows, extra = '') => `<div class="host-info-side"><h3>${esc(title)}</h3><div class="dk-kv">${rows.join('')}</div>${extra}</div>`;
    const localRows = [
      kv('平台版本', l.version ? `v${l.version}` : ''),
      kv('运行形态', l.container ? `容器 · ${l.runtimeImage || '未知镜像'}` : '宿主机 / 本机进程'),
      kv('操作系统', l.os),
      kv('内核', l.kernel),
      kv('主机名', l.hostname),
      kv('运行时', `${l.node || '—'} · ${l.platform || '—'}/${l.arch || '—'}`),
      kv('CPU / 内存', `${l.cpuCores || '—'} 核 · ${l.totalMemMB || '—'} MB（空闲 ${l.freeMemMB || '—'} MB）`),
      kv('已运行', l.uptime),
      kv('工作区', l.workspaceDir),
      kv('.env 文件', l.envFile),
    ];
    const hostRows = [
      kv('发行版', h.os),
      kv('内核', h.kernel),
      kv('主机名 / IP', `${h.hostname || h.systemHost || '—'}${h.ip ? ` · ${h.ip}` : ''}`),
      kv('登记节点', `${h.name || '—'}（${h.host || '—'}）`),
      kv('CPU / 负载', `${h.cpuCores || '—'} 核 · ${h.load1 !== null && h.load1 !== undefined ? `${h.load1} / ${h.load5} / ${h.load15}` : '—'}`),
      kv('内存', h.memory ? `${h.memory.usedMB} / ${h.memory.totalMB} MB（${h.memory.usagePct}%）` : ''),
      kv('磁盘 /', h.disk ? `${h.disk.used} / ${h.disk.total}（${h.disk.usagePct}）` : ''),
      kv('Git', h.git && h.git.available ? `${h.git.version} · ${h.git.bin}` : '未检测到'),
      kv('宿主机工作区', h.workspace ? `${h.workspace}${h.workspaceWritable === true ? ' · 可写' : (h.workspaceWritable === false ? ' · 不可写' : '')}` : ''),
      kv('Docker 容器', h.containers !== null && h.containers !== undefined ? String(h.containers) : (h.source === 'local' ? '未采集（本机直跑）' : '')),
    ];
    const lsbExtra = h.lsb
      ? `<details class="dk-raw" style="margin-top:8px"><summary>lsb_release -a 原始输出</summary><pre class="log short">${esc(h.lsb)}</pre></details>`
      : '';
    const hostTitle = h.source === 'local'
      ? '运行主机（本机直跑，Git / Docker 在本机执行）'
      : 'SSH 宿主机（真正执行 Git / Docker 的机器）';
    body.innerHTML = side('平台进程（当前运行环境）', localRows)
      + side(hostTitle, hostRows, lsbExtra)
      + (h.note ? `<div class="notice" style="grid-column:1/-1">${esc(h.note)}</div>` : '')
      + (h.error ? `<div class="notice warn" style="grid-column:1/-1">${esc(h.error)}</div>` : '');
    if (checked) {
      const t = d.checkedAt ? new Date(d.checkedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
      checked.textContent = `检测于 ${t}${d.cached ? ' · 缓存' : ''}`;
    }
  } catch (e) {
    body.innerHTML = `<div class="empty">主机信息采集失败：${esc(e.message)}</div>`;
    if (checked) checked.textContent = '采集失败';
  }
}

/* --------------------------------- 仓库 ---------------------------------- */

async function loadRepos() {
  try {
    const d = await api('/repos');
    const sources = d.sources || [];
    const options = sources.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}${s.hasCreds ? '' : '（未配置凭据）'}</option>`).join('');
    if ($('#repo-source')) $('#repo-source').innerHTML = options;
    if ($('#clone-source')) $('#clone-source').innerHTML = '<option value="">手动填写地址（不带凭据）</option>' + options;
    // v0.3.7：源故障不再只是一句「部分源不可用」，逐条给出原因与修复入口；
    // 且远端源全挂时，工作区本地仓库仍然照常显示。
    const errors = d.errors || [];
    const errBox = $('#repo-source-hint');
    if (errBox) {
      if (errors.length) {
        errBox.innerHTML = `<div class="row gap wrap" style="align-items:center">
            <b style="color:var(--amber)">${errors.length} 个 Git 源暂时不可用</b>
            <span class="muted">不影响下方「工作区」里已克隆的本地仓库</span></div>`
          + errors.map((x) => `<div class="repo-src-error">
              <span>⚠ <b>${esc(x.label)}</b>：${esc(x.error)}</span>
              ${x.hint ? `<span class="repo-src-hint">↳ ${esc(x.hint)}</span>` : ''}
              <span class="row gap">
                ${x.code === 'TLS_CERT_INVALID' ? `<button class="btn btn-sm btn-primary" data-repo-fix="envcfg" data-env-keys="${esc((x.envKeys || []).join(','))}" data-env-problem="${esc(x.code)}">去配置 env · 关闭证书校验</button>` : ''}
                <button class="btn btn-sm" data-repo-fix="gitsrc">编辑源</button>
                <button class="btn btn-sm" data-repo-fix="proxy">代理配置</button>
              </span></div>`).join('');
        errBox.querySelectorAll('[data-repo-fix]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.repoFix === 'envcfg') {
            openEnvConfig(String(b.dataset.envKeys || '').split(',').filter(Boolean), b.dataset.envProblem || '');
          } else switchView(b.dataset.repoFix);
        }));
      } else {
        errBox.textContent = `已聚合 ${sources.length} 个 Git 源、工作区 ${(d.workspace && d.workspace.count) || 0} 个本地仓库，共 ${(d.items || []).length} 条；外部源在「Git 源」页登记`;
      }
    }
    repoState.items = d.items || [];
    renderRepoHidden(d.hiddenRepos);
    const rows = repoState.items.map((r) => {
      // 工作区内已克隆的仓库：直接进 IDE，不重复提供「克隆」按钮。
      if (r.isLocal) return `<tr>
        <td><b>${esc(r.name)}</b><div class="desc muted">${esc(r.fullName)}</div></td>
        <td>${badge('工作区', 'green')}</td>
        <td>${esc(r.description || '-')}<div class="desc muted">${esc(r.localPath || '')}</div></td>
        <td class="muted">${esc(fmtTime(r.updatedAt))}</td>
        <td class="actions"><div class="ext-actions">
          <button class="btn btn-sm" data-ide-direct="${esc(r.name)}" title="直接用仓库目录打开 IDE 编辑器">IDE 打开</button>
          <button class="btn btn-sm" data-repo-files="${esc(r.name)}">文件管理</button>
          <button class="btn btn-sm" data-repo-git="${esc(r.name)}">Git 操作</button>
          <button class="btn btn-sm" data-repo-term="${esc(r.name)}">终端</button>
          ${r.cloneUrl ? `<button class="btn btn-sm" data-copy="${esc(r.cloneUrl)}">复制地址</button>` : ''}
          <button class="btn btn-sm" data-repo-edit="${esc(r.id)}">编辑</button>
          <button class="btn btn-sm" data-collab-open="repoAcl|${esc(r.id)}">协作者</button>
          <button class="btn btn-sm btn-danger" data-repo-del="${esc(r.id)}">删除</button>
        </div></td>
      </tr>`;
      // v0.4.16 B 批：未克隆到平台存储的远端仓库不显示「IDE 打开」；代理按钮统一收到「编辑」里处理。
      return `<tr>
        <td><b>${esc(r.name)}</b><div class="desc muted">${esc(r.fullName)}</div></td>
        <td>${badge(r.sourceLabel, r.sourceId === 'builtin-gitea' ? 'blue' : 'amber')}</td>
        <td>${esc(r.description || '-')}${r.private ? ' ' + badge('私有', 'gray') : ''}</td>
        <td class="muted">${esc(fmtTime(r.updatedAt))}</td>
        <td class="actions"><div class="ext-actions">
          <button class="btn btn-sm" data-clone-repo="${esc(r.cloneUrl)}" data-clone-source="${esc(r.sourceId)}" data-clone-name="${esc(r.name)}" data-clone-id="${esc(r.id)}">克隆到工作区</button>
          <button class="btn btn-sm" data-copy="${esc(r.cloneUrl || '')}">复制地址</button>
          <button class="btn btn-sm" data-repo-edit="${esc(r.id)}">编辑</button>
          <button class="btn btn-sm" data-collab-open="repoAcl|${esc(r.id)}">协作者</button>
          <button class="btn btn-sm btn-danger" data-repo-del="${esc(r.id)}" title="从平台列表移除">删除</button>
        </div></td>
      </tr>`;
    });
    $('#repo-list').innerHTML = rows.length ? table(['仓库', '来源', '描述', '更新时间', '操作'], rows)
      : '<div class="empty">尚未发现仓库：可到「克隆到工作区」拉取第一个仓库，或在「外部 Git 源」登记远程服务。</div>';
    $$('[data-ide-direct]').forEach((b) => b.addEventListener('click', () => void openRepoIdeDirect(b.dataset.ideDirect)));
    // v0.3.10：工作区仓库像文件管理一样可打开目录，并可直接执行 Git 命令。
    $$('[data-repo-files]').forEach((b) => b.addEventListener('click', () => openRepoFiles(b.dataset.repoFiles)));
    $$('[data-repo-git]').forEach((b) => b.addEventListener('click', () => openRepoGitModal(b.dataset.repoGit)));
    $$('[data-repo-term]').forEach((b) => b.addEventListener('click', () => openRepoTerminal(b.dataset.repoTerm)));
    $$('[data-clone-repo]').forEach((b) => b.addEventListener('click', () => {
      const url = b.dataset.cloneRepo;
      if (!url) { toast('该仓库没有可用的 HTTP 克隆地址', true); return; }
      fillCloneForm(url, b.dataset.cloneName || '', b.dataset.cloneSource || '', b.dataset.cloneId || '');
      openRepoCloneModal(b.dataset.cloneName || '');
    }));
    // 只绑定仓库列表内的复制按钮；全局 [data-copy] 会误抓驱动模板弹窗的「复制 JSON」（无值），把剪贴板写成空串。
    ($('#repo-list') ? $$('#repo-list [data-copy]') : []).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('克隆地址已复制'); }
      catch { toast('复制失败，请手动选择', true); }
    }));
    $$('[data-repo-edit]').forEach((b) => b.addEventListener('click', () => openRepoEditModal(b.dataset.repoEdit)));
    $$('[data-repo-del]').forEach((b) => b.addEventListener('click', () => {
      const r = repoState.items.find((x) => x.id === b.dataset.repoDel) || {};
      removeRepo(b.dataset.repoDel, r.name || b.dataset.repoDel, Boolean(r.isLocal));
    }));
    // 扩展实例的「绑定仓库」也复用这份聚合列表。
    repoState.items = d.items || [];
    void loadGitRuntime().catch(() => {});
  } catch (e) {
    $('#repo-list').innerHTML = errorBlock(e.message, '请在「Git 源」页登记可用的仓库服务并配置 Token');
  }
}

/* ---------- v0.4.4 仓库平台侧管理：编辑展示信息 / 移除 / 恢复 ---------- */
function renderRepoHidden(hidden) {
  const list = Array.isArray(hidden) ? hidden : [];
  const count = $('#repo-hidden-count');
  const sel = $('#repo-hidden-select');
  const btn = $('#repo-restore');
  if (count) count.textContent = list.length ? `已移除 ${list.length} 个` : '';
  if (sel) {
    sel.hidden = !list.length;
    sel.innerHTML = list.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
  }
  if (btn) btn.hidden = !list.length;
}

function openRepoEditModal(id) {
  const r = repoState.items.find((x) => x.id === id);
  if (!r) { toast('仓库信息已过期，请刷新后重试', true); return; }
  const form = $('#repoedit-form');
  form.reset();
  $('#repoedit-id').value = r.id;
  $('#repoedit-title').textContent = `编辑仓库 · ${r.name || r.id}`;
  $('#repoedit-sub').textContent = r.isLocal ? '工作区本地仓库' : (r.fullName || r.sourceLabel || r.id);
  form.elements.name.value = r.name || '';
  form.elements.description.value = r.description || '';
  form.elements.note.value = r.note || '';
  form.elements.proxy.value = r.proxy || '';
  renderCollabInline('repoAcl', r.id);
  $('#repo-edit-modal').hidden = false;
}

async function removeRepo(id, name, isLocal) {
  if (!id) return;
  if (!await confirmDialog({ message: `确定从平台列表移除仓库「${name}」？远端仓库与 Git 源不受影响，之后可恢复。` })) return;
  let purgeWorkspace = false;
  if (isLocal) {
    purgeWorkspace = await confirmDialog({
      title: '是否同时删除本地工作区目录？',
      message: `仓库「${name}」位于平台工作区。删除目录会一并移除本地克隆及其中未提交的文件，且不可撤销。`,
      confirmText: '一并删除目录', cancelText: '仅从列表移除',
    });
  }
  try {
    await api('/repos/remove', { method: 'POST', body: { id, purgeWorkspace } });
    toast(purgeWorkspace ? '仓库与本地目录已删除' : '仓库已从平台列表移除');
    loadRepos();
  } catch (e) { toast(e.message, true); }
}

$('#repoedit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    await api('/repos/meta', { method: 'PUT', body });
    await saveCollabInline('repoAcl', body.id);
    toast('仓库信息已保存');
    $('#repo-edit-modal').hidden = true;
    loadRepos();
  } catch (err) { toast(err.message, true); }
});
$$('[data-repoedit-close]').forEach((b) => b.addEventListener('click', () => {
  $('#repo-edit-modal').hidden = true;
}));
$('#repo-restore').addEventListener('click', async () => {
  const id = ($('#repo-hidden-select') || {}).value;
  if (!id) return;
  try { await api('/repos/restore', { method: 'POST', body: { id } }); toast('仓库已恢复'); loadRepos(); }
  catch (e) { toast(e.message, true); }
});

/* ------------------- 工作区仓库 · 文件 / 终端 / Git 操作 ------------------- */

/** 工作区仓库在宿主机上的真实目录 + 可用于 SFTP / SSH 的服务器。 */
async function repoHostContext() {
  const [rt, list] = await Promise.all([api('/git/runtime'), api('/servers')]);
  const fb = rt.fallback || {};
  const dir = String(fb.hostWorkspaceDir || rt.hostWorkspaceDir || '').replace(/\/+$/, '');
  const items = (list && list.items) || [];
  const server = items.find((s) => s.id === fb.serverId) || items[0];
  if (!server) { toast('未登记 SSH 服务器：请先在「服务器」页登记宿主机', true); return null; }
  const base = dir || `${String(server.deployDir || '/data/platform').replace(/\/+$/, '')}/workspace`;
  return { server, base };
}

function repoHostPath(ctx, name) {
  return `${ctx.base}/${String(name).replace(/[^A-Za-z0-9_.-]/g, '-')}`;
}

/* ---------- v0.4.30：Git 仓库「文件管理」「克隆到工作区」弹窗化 ---------- */
/* 两个弹窗都直接复用静态 DOM（表单/文件列表在弹窗里），不新建标签页；关闭时回到仓库列表。 */
const repoModalState = { cloneOpenedFrom: '', files: { ctx: null, path: '', name: '', seq: 0 } };

function fillCloneForm(url, name, sourceId, repoId) {
  const form = $('#clone-form');
  if (!form) return;
  form.elements.cloneUrl.value = url || '';
  form.elements.name.value = name || '';
  if ($('#clone-source')) $('#clone-source').value = sourceId || '';
  if ($('#clone-repo-id')) $('#clone-repo-id').value = repoId || '';
  const conflict = $('#clone-conflict');
  if (conflict) conflict.hidden = true;
  syncCloneAuthFields();
}

function openRepoCloneModal(name) {
  const modal = $('#repo-clone-modal');
  if (!modal) return;
  $('#repo-clone-modal-title').textContent = name ? `克隆到工作区 · ${name}` : '克隆到工作区';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const input = $('#clone-form') && $('#clone-form').elements.cloneUrl;
  if (input) setTimeout(() => input.focus(), 30);
}

function closeRepoCloneModal() {
  const modal = $('#repo-clone-modal');
  if (modal) modal.hidden = true;
  if (!$('#repo-files-modal') || $('#repo-files-modal').hidden) document.body.style.overflow = '';
  // 从仓库列表点开克隆弹窗，关闭后仍停在仓库列表，不再跳页。
  switchView('repos');
}

$('#repo-clone-open-btn') && $('#repo-clone-open-btn').addEventListener('click', () => {
  fillCloneForm('', '', '', '');
  openRepoCloneModal('');
});
// 关闭按钮 / 遮罩（文档级委托，避免重复绑定）
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-repo-modal-close]') : null;
  if (!btn) return;
  if (btn.dataset.repoModalClose === 'clone') closeRepoCloneModal();
  else if (btn.dataset.repoModalClose === 'files') closeRepoFilesModal();
});

/** 轻量弹窗文件浏览器：复用后端 /servers/:id/files，不新建标签页、不依赖 tab 系统。 */
async function openRepoFilesModal(name) {
  const modal = $('#repo-files-modal');
  const slot = $('#repo-files-modal-slot');
  if (!modal || !slot) return;
  $('#repo-files-modal-title').textContent = `文件管理 · ${name}`;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  slot.innerHTML = '<div class="muted" style="padding:16px">正在解析仓库目录…</div>';
  try {
    const ctx = await repoHostContext();
    if (!ctx) { slot.innerHTML = '<div class="notice error" style="margin:16px">无法定位仓库目录：请先在「服务器」页登记宿主机</div>'; return; }
    repoModalState.files.ctx = ctx;
    repoModalState.files.path = repoHostPath(ctx, name);
    repoModalState.files.name = name;
    slot.innerHTML = `
      <div class="ws-panel" style="border:0;border-radius:0;box-shadow:none">
        <div class="file-toolbar" style="padding:10px 14px 0">
          <button class="btn btn-sm" data-repo-fs="up">↑ 上一级</button>
          <button class="btn btn-sm" data-repo-fs="refresh">刷新</button>
          <span class="flex-spacer"></span>
          <span class="muted small" data-role="repo-fs-path"></span>
        </div>
        <div class="fs-table" data-role="repo-fs-list" style="margin:10px 14px 14px"></div>
      </div>`;
    slot.querySelector('.ws-panel').addEventListener('click', (ev) => {
      const tool = ev.target.closest('[data-repo-fs]');
      if (tool) { repoFsToolbar(tool.dataset.repoFs); return; }
      const link = ev.target.closest('.repo-fs-name');
      if (link) {
        ev.preventDefault();
        const row = link.closest('tr');
        if (row && row.dataset.repoFsDir === '1') {
          repoModalState.files.path = row.dataset.repoFsPath;
          loadRepoFs();
        }
      }
    });
    loadRepoFs();
  } catch (e) { slot.innerHTML = `<div class="notice error" style="margin:16px">${esc(e.message)}</div>`; }
}

async function loadRepoFs() {
  const st = repoModalState.files;
  const slot = $('#repo-files-modal-slot');
  if (!slot || !st.ctx) return;
  const list = slot.querySelector('[data-role="repo-fs-list"]');
  const bar = slot.querySelector('[data-role="repo-fs-path"]');
  if (!list) return;
  const seq = (st.seq = (st.seq || 0) + 1);
  const snapshot = st.path;
  if (bar) bar.textContent = snapshot;
  list.innerHTML = '<div class="muted" style="padding:14px">读取中…</div>';
  try {
    const d = await api(`/servers/${st.ctx.server.id}/files?path=${encodeURIComponent(snapshot)}`);
    if (seq !== st.seq) return;
    st.path = d.path || snapshot;
    if (bar) bar.textContent = st.path;
    const items = d.items || [];
    list.innerHTML = `<table><thead><tr><th>名称</th><th style="width:110px">大小</th><th style="width:120px">类型</th><th style="width:170px">修改时间</th></tr></thead><tbody>${
      items.map((it) => `<tr data-repo-fs-path="${esc(it.path)}" data-repo-fs-dir="${it.isDir ? 1 : 0}">
        <td>${it.isDir ? '📁' : '📄'} <a href="#" class="repo-fs-name">${esc(it.name)}</a></td>
        <td>${it.isDir ? '—' : fmtSize(it.size)}</td>
        <td>${esc(it.isDir ? '目录' : (it.language || '文件'))}</td>
        <td class="muted">${esc(fmtTime(it.mtime))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">目录为空</td></tr>'
    }</tbody></table>`;
  } catch (e) { list.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
}

function repoFsToolbar(action) {
  const st = repoModalState.files;
  if (action === 'up') { st.path = pathParent(st.path) || '/'; loadRepoFs(); return; }
  if (action === 'refresh') { loadRepoFs(); return; }
}

function closeRepoFilesModal() {
  const modal = $('#repo-files-modal');
  if (modal) modal.hidden = true;
  if (!$('#repo-clone-modal') || $('#repo-clone-modal').hidden) document.body.style.overflow = '';
  switchView('repos');
}

async function openRepoFiles(name) {
  await openRepoFilesModal(name);
}

async function openRepoTerminal(name) {
  try {
    const ctx = await repoHostContext();
    if (!ctx) return;
    // v0.4.30：终端断开 / 关闭标签时回到「仓库列表」页。
    openTerminalTab(ctx.server, repoHostPath(ctx, name), {
      onClose: () => { switchView('repos'); },
    });
    toast(`终端已打开并切换到 ${name}`);
  } catch (e) { toast(e.message, true); }
}

/* ================= v0.4.31 · TortoiseGit 式 Git 工作台 ================= */
/* 沿用仓库列表「Git 操作」按钮入口，收敛为 TortoiseGit 常用操作：
   「状态 / 日志 / 提交 / 分支 / 同步 / 冲突还原」六个标签，覆盖日志、分支、提交、
   推送、拉取(含 fetch)、中止合并、还原、重置；工作区状态 / 暂存 / 差异 / 合并作为
   配套项一并保留。Stash / 标签 / 清理 / 自定义命令等低频入口在前端隐藏。
   后端视图 / 语义动作 / 预设 / 测试一律保留不动，仅前端过滤，随时可回退。 */
let repoGitRepo = '';
let repoGitPresets = [];
let repoGitGroups = [];
let repoGitTab = 'status';
let repoGitBusy = false;
const repoGitCache = {}; // 每个视图的结构化数据缓存

/** 工作台保留的标签（TortoiseGit 常用操作 + 配套项），其余标签前端不展示。 */
const REPO_GIT_VISIBLE_TABS = ['status', 'log', 'commit', 'branch', 'sync', 'conflict'];
/** 隐藏的低频快捷命令：远程地址（同步页已展示上游）、放弃改动（易误删，冲突页已移除按钮）。 */
const REPO_GIT_HIDDEN_PRESETS = ['remote', 'restore'];
/** 对后端返回的 groups / presets 做前端收敛过滤（纯函数，便于行为测试）。 */
function filterGitWorkbench(groups, presets) {
  const gs = Array.isArray(groups) ? groups : [];
  const ps = Array.isArray(presets) ? presets : [];
  return {
    groups: gs.filter((g) => REPO_GIT_VISIBLE_TABS.includes(g.id)),
    presets: ps.filter((p) => REPO_GIT_VISIBLE_TABS.includes(p.group) && !REPO_GIT_HIDDEN_PRESETS.includes(p.key)),
  };
}

function gitOut(text) {
  const out = $('#repo-git-output');
  if (out) out.textContent = String(text || '');
}
function gitOutAppend(text) {
  const out = $('#repo-git-output');
  if (out) out.textContent = `${out.textContent || ''}${text}`;
}
function gitBadge(text, tone) { return badge(text, tone || 'gray'); }
function gitPane(id) { return $(`#git-wb-pane-${id}`); }
function gitEmpty(msg) { return `<div class="git-wb-empty">${esc(msg)}</div>`; }
function gitVal(id) { const el = $(`#${id}`); return el ? String(el.value || '').trim() : ''; }
/**
 * 自定义命令分词：支持单 / 双引号包裹含空格的参数（如 `commit -m "hello world"`），
 * 引号本身不进入参数。以前用 split(/\s+/) 会把提交说明拆碎成多个参数。
 * 不含引号的语法保持原样；引号未闭合时按普通字符收尾，避免静默吞掉输入。
 */
function splitGitCommand(text) {
  const s = String(text || '').trim();
  const out = [];
  let cur = '';
  let quote = '';
  let token = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = ''; continue; }
      if (ch === '\\' && i + 1 < s.length && (s[i + 1] === quote || s[i + 1] === '\\')) { cur += s[i + 1]; i += 1; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; token = true; continue; }
    if (/\s/.test(ch)) {
      if (token) { out.push(cur); cur = ''; token = false; }
      continue;
    }
    cur += ch;
    token = true;
  }
  if (token) out.push(cur);
  return out;
}
function gitCheckedPaths() {
  return [...document.querySelectorAll('#git-wb-pane-status [data-gf]:checked')]
    .map((c) => c.getAttribute('data-gf'));
}

/** 读取一个结构化视图，失败时把错误写进输出区并返回 null。 */
async function gitLoadView(view, args = {}, { refresh = false } = {}) {
  if (!repoGitRepo) return null;
  const key = `${view}:${JSON.stringify(args)}`;
  if (!refresh && repoGitCache[key]) return repoGitCache[key];
  try {
    const r = await api('/repos/git/view', {
      method: 'POST', body: { repo: repoGitRepo, view, args },
    });
    if (!r.ok) throw new Error(r.error || '视图读取失败');
    repoGitCache[key] = r.data;
    return r.data;
  } catch (e) {
    gitOut(`读取「${view}」失败：${e.message}`);
    return null;
  }
}

/** 渲染标签导航。 */
function renderGitTabs() {
  const box = $('#repo-git-tabs');
  if (!box) return;
  box.innerHTML = `<span class="subnav-label">Git 工作台</span>` + repoGitGroups.map((g) =>
    `<button class="subnav-btn ${g.id === repoGitTab ? 'active' : ''}" type="button" data-gtab="${esc(g.id)}" title="${esc(g.desc)}"><span class="gico">${esc(g.ico)}</span>${esc(g.label)}</button>`
  ).join('');
  box.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    repoGitTab = b.dataset.gtab;
    renderGitTabs();
    for (const g of repoGitGroups) {
      const p = gitPane(g.id);
      if (p) p.hidden = g.id !== repoGitTab;
    }
    void refreshGitTab(repoGitTab);
  }));
}

/** 顶部工具条：当前分区的快捷动作（按 preset.group 过滤）。 */
function renderGitToolbar() {
  const box = $('#repo-git-toolbar');
  if (!box) return;
  const ps = repoGitPresets.filter((p) => p.group === repoGitTab);
  if (repoGitTab === 'custom') {
    box.innerHTML = `<span class="muted">直接输入白名单内的 Git 子命令与参数（不含开头的 git）</span>`;
    return;
  }
  box.innerHTML = `<span class="muted" style="font-size:12px">${esc((repoGitGroups.find((g) => g.id === repoGitTab) || {}).desc || '')}</span><span class="grow"></span>`
    + `<div class="git-wb-actions">` + ps.map((p) =>
      `<button class="btn btn-sm ${p.destructive ? 'btn-danger' : (p.write ? 'btn-primary' : '')}" type="button" data-gpreset="${esc(p.key)}" title="${esc(p.hint || (p.write ? '会写入仓库 / 远端，需要仓库写权限' : '只读命令'))}">${esc(p.ico)} ${esc(p.label)}</button>`
    ).join('') + `</div>`;
  box.querySelectorAll('[data-gpreset]').forEach((b) => b.addEventListener('click', () => {
    void runGitPreset(b.dataset.gpreset);
  }));
}

/**
 * 旧 /repos/git 入口里，后端会对这些命令强制 confirmed=true。
 * 复刻 workspaceGit.classifyCommand(cmd,args).destructive 的判定（只取 destructive 一位），
 * 让前端在同一处决定「先弹二次确认 + 带 confirmed」。clean -n/--dry-run 是只读预览，排除。
 */
function repoGitNeedsConfirm(command, args) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (command === 'clean') {
    const dry = /^-n$|^--dry-run$/.test(list[0] || '');
    const force = list.some((x) => /^-f$|^-ff$|^--force$/.test(x));
    return !(dry && !force);
  }
  if (['branch', 'tag', 'stash', 'remote', 'config'].includes(command)) {
    return /^-d$|^-D$|^--delete$/.test(list[0] || '');
  }
  return ['reset', 'revert', 'merge', 'checkout', 'restore', 'rm'].includes(command);
}

/** 纯执行：发 /repos/git 请求并回显输出，不管理 busy / 二次确认（供 runRepoGit / runGitPreset 复用）。 */
async function execRepoGit(command, args, extra = {}) {
  gitOut(`执行中：git ${command} ${(args || []).join(' ')} …`);
  try {
    const r = await api('/repos/git', {
      method: 'POST', body: { repo: repoGitRepo, command, args: args || [], ...extra },
    });
    gitOut(`> ${r.commandText}\n[${r.channelLabel} · Git ${r.gitVersion || '—'} · exit ${r.code}]\n\n${r.output || '(无输出)'}`);
    if (r.code !== 0) toast(`Git ${command} 返回 ${r.code}，请查看输出`, true);
    return r;
  } catch (e) {
    gitOut(`执行失败：${e.message}`);
    toast(e.message, true);
    return null;
  }
}

/** 执行快捷预设：needMessage / needHash / needText 走统一输入弹窗，破坏性动作二次确认。 */
async function runGitPreset(key) {
  const p = repoGitPresets.find((x) => x.key === key);
  if (!p || repoGitBusy) return;
  // 忙位覆盖 promptDialog / confirmDialog 全程：弹窗期间无法并发触发其它 Git 写操作。
  repoGitBusy = true;
  try {
    let args = [...(p.args || [])];
    if (p.needMessage) {
      const msg = await promptDialog({ title: '提交说明', message: '填写本次提交的说明（commit -m）', placeholder: '例如 fix: 修复登录判断' });
      if (!msg) return;
      args = ['-m', msg];
    }
    if (p.needHash) {
      const hash = await promptDialog({ title: '还原提交', message: '填写要还原的提交号；留空则还原最近一次 HEAD', allowEmpty: true, placeholder: '例如 a1b2c3d' });
      // 修复：填写了非法 hash 要明确报错并中止，绝不静默沿用预设里的 HEAD。
      if (hash) {
        if (!/^[A-Za-z0-9._~^-]{1,64}$/.test(hash)) {
          toast('提交号不合法：只允许字母、数字、. _ ~ ^ -', true);
          return;
        }
        args = ['--no-edit', hash];
      }
    }
    if (p.needText) {
      const text = await promptDialog({ title: p.label, message: p.hint || '请输入参数', placeholder: p.hint || '' });
      if (!text) return;
      // 修复 P1-1：stash-save 预设的 needText 是「stash 说明」，必须用 -m 注入。
      // 直接 append 会生成 `git stash push -u <说明>`，说明被当成路径，git 返回
      // "No local changes to save" 且 stash 为空；正确写法是 `git stash push -u -m <说明>`。
      // 其余 needText（分支名 / 标签名 / 检出目标）仍是位置参数，直接 append。
      if (p.command === 'stash' && (p.args || []).includes('push')) {
        args = [...args, '-m', text];
      } else {
        args = [...args, text];
      }
    }
    if (p.destructive) {
      const okRun = await confirmDialog({
        title: '破坏性 Git 操作确认',
        message: `确定执行「${p.label}」（git ${p.command} ${args.join(' ')}）？该操作会改变工作区 / 提交历史，通常不可撤销，请先确认本地改动已备份。`,
        confirmText: '确定执行', cancelText: '取消',
      });
      if (!okRun) return;
    }
    // 后端对破坏性命令强制 confirmed；preset 已确认（或命令本身需确认）时带上。
    const confirmed = p.destructive || repoGitNeedsConfirm(p.command, args);
    await execRepoGit(p.command, args, confirmed ? { confirmed: true } : {});
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab(repoGitTab);
  } finally {
    repoGitBusy = false;
  }
}

/** 通用命令执行（自定义命令走 /repos/git 白名单入口）：忙位覆盖二次确认弹窗全程。 */
async function runRepoGit(command, args) {
  if (!repoGitRepo) { toast('请先从仓库列表选择仓库', true); return null; }
  if (repoGitBusy) return null;
  repoGitBusy = true;
  try {
    let confirmed = false;
    if (repoGitNeedsConfirm(command, args)) {
      const okRun = await confirmDialog({
        title: '破坏性 Git 操作确认',
        message: `确定执行「git ${command} ${(args || []).join(' ')}」？该操作会改变工作区 / 提交历史，通常不可撤销，请先确认本地改动已备份。`,
        confirmText: '确定执行', cancelText: '取消',
      });
      if (!okRun) return null;
      confirmed = true;
    }
    return await execRepoGit(command, args, confirmed ? { confirmed: true } : {});
  } finally {
    repoGitBusy = false;
  }
}

/** 执行语义动作：破坏性动作先二次确认，再带 confirmed=true 调 /repos/git/action。 */
async function runGitAction(action, params = {}) {
  if (!repoGitRepo) { toast('请先从仓库列表选择仓库', true); return null; }
  if (repoGitBusy) return null;
  // 忙位在 await confirmDialog() 之前就置位：弹窗期间无法并发触发其它 Git 写操作。
  repoGitBusy = true;
  const btn = $('#repo-git-run');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  try {
    let confirmed = false;
    const DESTRUCTIVE_ACTIONS = ['discard', 'checkout', 'switchBranch', 'deleteBranch', 'merge', 'mergeAbort', 'revert', 'reset', 'stashPop', 'stashDrop', 'tagDelete', 'clean'];
    if (DESTRUCTIVE_ACTIONS.includes(action)) {
      confirmed = await confirmDialog({
        title: '破坏性 Git 操作确认',
        message: `确定执行「${action}」？该操作会改变工作区 / 提交历史，通常不可撤销，请先确认本地改动已备份。`,
        confirmText: '确定执行', cancelText: '取消',
      });
      if (!confirmed) return null;
    }
    gitOut(`执行中：${action} ${JSON.stringify(params)} …`);
    const r = await api('/repos/git/action', {
      method: 'POST', body: { repo: repoGitRepo, action, params, confirmed },
    });
    gitOut(`> ${r.commandText}\n[${r.channelLabel} · ${r.actionLabel || action} · exit ${r.code}]\n\n${r.output || '(无输出)'}`);
    if (r.code !== 0) toast(`${r.actionLabel || action} 返回 ${r.code}，请查看输出`, true);
    return r;
  } catch (e) {
    gitOut(`执行失败：${e.message}`);
    toast(e.message, true);
    return null;
  } finally {
    repoGitBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '执行'; }
  }
}

/* --------------------------- 各分区渲染 --------------------------- */
function colorizeDiff(patch) {
  const lines = String(patch || '').split('\n');
  return lines.map((l) => {
    const t = esc(l);
    if (/^\+\+\+|^--- /.test(l)) return `<span class="meta">${t}</span>`;
    if (/^@@/.test(l)) return `<span class="hunk">${t}</span>`;
    if (l.startsWith('+')) return `<span class="add">${t}</span>`;
    if (l.startsWith('-')) return `<span class="del">${t}</span>`;
    return t;
  }).join('\n');
}

/** Unicode 显示宽度：东亚全角 / 宽字符按 2 列，其余按 1 列，用于给 SVG 文本留足横向空间。 */
function gitTextWidth(s) {
  let w = 0;
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    const wide = (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a
      || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f)
      || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
      || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)));
    w += wide ? 2 : 1;
  }
  return w;
}

function graphSvg(text) {
  // 把 git log --graph 的纯字符画转成等宽 SVG：按行画字符，保留 |/\\* 分支拓扑视觉。
  // v0.4.31 修复：宽度按每行「显示列数」自适应（中文/宽字符算 2 列），不再用
  // 固定上限（原 1100px）硬截断；长行由 .git-wb-branch-graph 的 overflow:auto 横向滚动查看。
  const rows = String(text || '').split('\n');
  const w = 8.2, h = 16, pad = 6;
  const maxCols = Math.max(1, ...rows.map((r) => gitTextWidth(r)));
  const width = Math.ceil(maxCols * w + pad * 2 + 24);
  const height = Math.min(600, rows.length * h + pad * 2);
  let out = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,Consolas,monospace" font-size="12">`;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    // graph 部分（首个字母/数字前的字符）着色，其余按普通文本
    const m = line.match(/^([^\w]*)(.*)$/);
    const glyph = m ? m[1] : '';
    const rest = m ? m[2] : line;
    let x = pad;
    for (const ch of glyph) {
      const color = /[|\\/_]/.test(ch) ? '#2563eb' : (/[*_]/.test(ch) ? '#dc2626' : '#7c3aed');
      out += `<text x="${x.toFixed(1)}" y="${(pad + (i + 1) * h - 4).toFixed(1)}" fill="${color}">${esc(ch)}</text>`;
      x += gitTextWidth(ch) * w;
    }
    if (rest) out += `<text x="${x.toFixed(1)}" y="${(pad + (i + 1) * h - 4).toFixed(1)}" fill="#334155">${esc(rest)}</text>`;
  }
  out += '</svg>';
  return out;
}

async function renderGitStatus() {
  const pane = gitPane('status');
  if (!pane) return;
  const d = await gitLoadView('status');
  if (!d) { pane.innerHTML = gitEmpty('无法读取工作区状态'); return; }
  const sum = `<div class="git-wb-summary">
    ${gitBadge(`分支 ${d.branch}`)}
    ${d.upstream ? gitBadge(`上游 ${d.upstream}`, 'blue') : ''}
    ${d.ahead ? gitBadge(`领先 ${d.ahead}`, 'green') : ''}
    ${d.behind ? gitBadge(`落后 ${d.behind}`, 'amber') : ''}
    ${d.clean ? gitBadge('工作区干净', 'green') : gitBadge(`${d.files.length} 个改动`, 'amber')}
    ${d.conflicts && d.conflicts.length ? gitBadge(`${d.conflicts.length} 个冲突`, 'red') : ''}
  </div>`;
  const rows = d.files.length ? d.files.map((f) => `<tr>
    <td class="git-wb-check"><input type="checkbox" data-gf="${esc(f.path)}" /></td>
    <td class="mono">${esc(f.x + f.y)}</td>
    <td>${gitBadge(f.label, f.conflicted ? 'red' : (f.staged ? 'green' : 'gray'))}</td>
    <td class="mono">${esc(f.path)}${f.origPath ? ` <span class="muted">← ${esc(f.origPath)}</span>` : ''}</td>
    <td>${f.staged ? gitBadge('已暂存', 'green') : ''}${f.unstaged ? gitBadge('未暂存', 'amber') : ''}</td>
  </tr>`).join('') : `<tr><td colspan="5" class="git-wb-empty">没有未提交的改动</td></tr>`;
  pane.innerHTML = `<div class="git-wb-card">
    <h4>工作区状态</h4>${sum}
    <div class="table-wrap"><table class="git-wb-table"><thead><tr><th></th><th>状态</th><th>类型</th><th>文件</th><th>暂存区</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="git-wb-actions" style="margin-top:10px">
      <button class="btn btn-sm btn-primary" type="button" data-gact="stageSel">暂存选中</button>
      <button class="btn btn-sm" type="button" data-gact="stageAll">暂存全部</button>
      <button class="btn btn-sm" type="button" data-gact="unstageSel">取消暂存</button>
      <button class="btn btn-sm" type="button" data-gact="showDiff">查看差异</button>
    </div>
  </div><div id="git-wb-status-diff"></div>`;
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.gact;
    const paths = gitCheckedPaths();
    if (act === 'stageSel') {
      if (!paths.length) { toast('请先勾选要暂存的文件', true); return; }
      await runGitAction('stage', { paths });
    } else if (act === 'stageAll') {
      await runRepoGit('add', ['-A']);
    } else if (act === 'unstageSel') {
      if (!paths.length) { toast('请先勾选要取消暂存的文件', true); return; }
      await runGitAction('unstage', { paths });
    } else if (act === 'showDiff') {
      const box = $('#git-wb-status-diff');
      if (box) box.innerHTML = `<div class="git-wb-card"><h4>差异</h4><div class="git-wb-inline"><label><input type="checkbox" id="git-wb-diff-staged" /> 仅暂存区</label><button class="btn btn-sm" type="button" id="git-wb-diff-load">加载</button></div><div id="git-wb-diff-body"></div></div>`;
      const load = async () => {
        const staged = Boolean(($('#git-wb-diff-staged') || {}).checked);
        const dd = await gitLoadView('diff', { staged, paths }, { refresh: true });
        const body = $('#git-wb-diff-body');
        if (body && dd) body.innerHTML = `<div class="git-wb-diff">${colorizeDiff(dd.patch)}</div>`;
      };
      const lb = $('#git-wb-diff-load');
      if (lb) lb.addEventListener('click', () => void load());
      await load();
      return;
    }
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('status');
  }));
}

/**
 * 从 git log 的 decorations（refs）里提取分支名，供日志「分支」列展示。
 * refs 形如 ['HEAD -> master', 'origin/master', 'tag: v1.2']：
 *  - 去掉 'HEAD -> ' 前缀；排除 tag: 标签引用；保留本地 / 远程分支短名。
 */
function gitCommitBranches(refs) {
  const out = [];
  for (const raw of Array.isArray(refs) ? refs : []) {
    let s = String(raw || '').trim();
    if (!s || /^tag:/i.test(s)) continue;
    s = s.replace(/^HEAD\s*->\s*/i, '');
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/** 点击提交日志行：用弹窗展示提交详情（不再在页内内嵌展开）。 */
async function showGitCommitDetail(hash) {
  const dd = await gitLoadView('show', { hash }, { refresh: true });
  if (!dd) return;
  const c = dd.commit || {};
  const modal = $('#git-commit-modal');
  const body = $('#git-commit-body');
  if (!modal || !body) return;
  const title = $('#git-commit-title');
  if (title) title.textContent = `提交详情 · ${c.short || hash}`;
  // 字段用带边框的只读文本框展示（与同步页 label + input 同款视觉，便于选中复制）。
  const field = (label, value, full) => `<label class="git-detail-field${full ? ' full' : ''}">${label}<input type="text" readonly value="${esc(value || '')}" /></label>`;
  body.innerHTML = `<div class="form git-detail-form">
    ${field('提交号', c.hash || hash, true)}
    ${field('作者', c.author || '', false)}
    ${field('邮箱', c.email || '', false)}
    ${field('日期', c.date || '', true)}
    ${field('说明', c.subject || '', true)}
    ${c.body ? field('正文', c.body, true) : ''}
    ${gitCommitBranches(c.refs).length ? field('分支', gitCommitBranches(c.refs).join(', '), true) : ''}
  </div>
  <div class="git-wb-card" style="margin-top:12px"><h4>改动内容</h4><div class="git-wb-diff">${colorizeDiff(dd.patch)}</div></div>
  <div class="git-wb-actions" style="margin-top:12px">
    <button class="btn btn-sm btn-danger" type="button" data-gdetail="revert">还原此提交</button>
    <button class="btn btn-sm btn-danger" type="button" data-gdetail="reset">重置到此提交</button>
  </div>`;
  body.querySelectorAll('[data-gdetail]').forEach((b) => b.addEventListener('click', async () => {
    closeGitCommitModal();
    if (b.dataset.gdetail === 'revert') await runGitAction('revert', { hash });
    else await runGitAction('reset', { mode: 'hard', ref: hash });
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('log');
  }));
  modal.hidden = false;
}

async function renderGitLog() {
  const pane = gitPane('log');
  if (!pane) return;
  // v0.4.31 UI：按用户要求去掉「提交分支图」，日志表增加「分支」列（来自 decorations）。
  const d = await gitLoadView('log', { count: 50 });
  if (!d) { pane.innerHTML = gitEmpty('无法读取提交日志'); return; }
  const rows = d.commits.map((c) => `<tr class="clickable" data-ghash="${esc(c.hash)}">
    <td class="mono">${esc(c.short)}</td>
    <td>${esc(c.subject)}</td>
    <td>${gitCommitBranches(c.refs).map((r) => gitBadge(r, 'blue')).join(' ') || '—'}</td>
    <td class="mono">${esc(c.author)}</td>
    <td class="mono">${esc((c.date || '').slice(0, 16).replace('T', ' '))}</td>
  </tr>`).join('');
  pane.innerHTML = `<div class="git-wb-card"><h4>提交日志（点击行在弹窗查看提交详情）</h4>
    <div class="table-wrap"><table class="git-wb-table"><thead><tr><th>提交</th><th>说明</th><th>分支</th><th>作者</th><th>时间</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="git-wb-empty">暂无提交</td></tr>`}</tbody></table></div>
  </div>`;
  pane.querySelectorAll('[data-ghash]').forEach((tr) => tr.addEventListener('click', () => void showGitCommitDetail(tr.dataset.ghash)));
}

async function renderGitCommit() {
  const pane = gitPane('commit');
  if (!pane) return;
  const d = await gitLoadView('status');
  if (!d) { pane.innerHTML = gitEmpty('无法读取工作区状态'); return; }
  const staged = d.files.filter((f) => f.staged);
  const unstaged = d.files.filter((f) => !f.staged);
  pane.innerHTML = `<div class="git-wb-card"><h4>提交（逐文件暂存 → 填写说明 → 提交）</h4>
    <div class="git-wb-inline"><b style="font-size:12px">待提交（${staged.length}）</b></div>
    <div class="table-wrap"><table class="git-wb-table"><tbody>${staged.length ? staged.map((f) => `<tr><td class="mono">${esc(f.x + f.y)}</td><td class="mono">${esc(f.path)}</td></tr>`).join('') : `<tr><td class="git-wb-empty">暂存区为空</td></tr>`}</tbody></table></div>
    <div class="git-wb-inline" style="margin-top:10px"><b style="font-size:12px">未暂存（${unstaged.length}）</b></div>
    <div class="table-wrap"><table class="git-wb-table"><tbody>${unstaged.length ? unstaged.map((f) => `<tr><td class="mono">${esc(f.x + f.y)}</td><td class="mono">${esc(f.path)}</td><td><button class="btn btn-sm" type="button" data-gstage="${esc(f.path)}">暂存</button></td></tr>`).join('') : `<tr><td class="git-wb-empty">无未暂存改动</td></tr>`}</tbody></table></div>
    <div class="form" style="margin-top:12px">
      <label>提交说明<input id="git-wb-commit-msg" placeholder="例如 fix: 修复登录判断" autocomplete="off" /></label>
      <div class="git-wb-actions"><button class="btn btn-sm" type="button" data-gact="stageAll">暂存全部改动</button><button class="btn btn-primary" type="button" data-gact="commit">提交</button><button class="btn btn-sm" type="button" data-gact="commitPush">提交并推送</button></div>
    </div></div>`;
  pane.querySelectorAll('[data-gstage]').forEach((b) => b.addEventListener('click', async () => {
    await runGitAction('stage', { paths: [b.dataset.gstage] });
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('commit');
  }));
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.gact;
    if (act === 'stageAll') {
      await runRepoGit('add', ['-A']);
    } else if (act === 'commit' || act === 'commitPush') {
      const msg = gitVal('git-wb-commit-msg');
      if (!msg) { toast('请填写提交说明', true); return; }
      const r = await runGitAction('commit', { message: msg });
      if (act === 'commitPush' && r && r.code === 0) await runGitAction('push', {});
    }
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('commit');
  }));
}

async function renderGitBranch() {
  const pane = gitPane('branch');
  if (!pane) return;
  const d = await gitLoadView('branches');
  if (!d) { pane.innerHTML = gitEmpty('无法读取分支列表'); return; }
  const rows = d.branches.map((b) => {
    // v0.4.31 修复：远程分支行（remotes/origin/x）点选时若把完整引用名填进输入框，
    // 「删除分支 / 合并」必然失败（git 不接受远程引用作为本地分支名）。
    // 这里点选填入去掉 remotes/<remote>/ 前缀的短名，仅供切换 / 检出；删除 / 合并
    // 仍在点击动作时按 kind 拦截提示，避免误操作。
    const shortName = b.kind === 'remote' ? String(b.name).replace(/^remotes\/[^/]+\//, '') : b.name;
    return `<tr class="clickable" data-gbranch="${esc(b.name)}" data-gfill="${esc(shortName)}" data-gkind="${esc(b.kind || 'local')}">
    <td>${b.current ? gitBadge('当前', 'green') : ''}</td>
    <td class="mono">${esc(b.name)}</td>
    <td class="mono">${esc(b.hash)}</td>
    <td class="mono">${esc(b.upstream || '')}</td>
    <td>${esc(b.track || '')}</td>
    <td>${esc(b.subject || '')}</td>
    <td>${b.kind === 'remote' ? gitBadge('远程', 'blue') : ''}</td>
  </tr>`;
  }).join('');
  pane.innerHTML = `<div class="git-wb-card"><h4>分支列表（点击行切换）</h4>
    <div class="table-wrap"><table class="git-wb-table"><thead><tr><th></th><th>分支</th><th>提交</th><th>上游</th><th>同步</th><th>说明</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="git-wb-empty">暂无分支</td></tr>`}</tbody></table></div></div>
    <div class="git-wb-card"><h4>分支操作</h4>
      <div class="git-wb-inline">
        <input id="git-wb-branch-name" placeholder="分支名" autocomplete="off" />
        <button class="btn btn-sm btn-primary" type="button" data-gact="create">新建分支</button>
        <button class="btn btn-sm" type="button" data-gact="switch">切换 / 检出</button>
        <button class="btn btn-sm btn-danger" type="button" data-gact="delete">删除分支</button>
        <button class="btn btn-sm btn-danger" type="button" data-gact="merge">合并进当前分支</button>
      </div></div>`;
  pane.querySelectorAll('[data-gbranch]').forEach((tr) => tr.addEventListener('click', () => {
    const el = $('#git-wb-branch-name');
    // 远程分支填短名（去掉 remotes/origin/ 前缀），可用作切换目标；
    // 删除 / 合并需要本地分支名，下面按 kind 校验。
    if (el) el.value = tr.dataset.gfill || tr.dataset.gbranch;
  }));
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const name = gitVal('git-wb-branch-name');
    if (!name) { toast('请填写或点选分支名', true); return; }
    const act = b.dataset.gact;
    // 拦截远程引用误用：点选 remotes/* 行或手工输入含 remotes/ 前缀时，
    // 删除 / 合并 / 新建本地分支都会失败，直接给出明确提示。
    if (/^remotes\//.test(name) && ['create', 'delete', 'merge'].includes(act)) {
      toast('这是远程分支引用，删除 / 合并 / 新建请填本地分支名；远程分支只用于「切换 / 检出」', true);
      return;
    }
    if (act === 'create') await runGitAction('createBranch', { name });
    else if (act === 'switch') await runGitAction('switchBranch', { name });
    else if (act === 'delete') await runGitAction('deleteBranch', { name });
    else if (act === 'merge') await runGitAction('merge', { ref: name });
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('branch');
  }));
}

async function renderGitSync() {
  const pane = gitPane('sync');
  if (!pane) return;
  const st = await gitLoadView('status');
  const s = st || {};
  pane.innerHTML = `<div class="git-wb-card"><h4>同步状态</h4>
    <div class="git-wb-summary">${gitBadge(`分支 ${s.branch || '—'}`)}${s.upstream ? gitBadge(`上游 ${s.upstream}`, 'blue') : ''}${s.ahead ? gitBadge(`领先 ${s.ahead} 待推送`, 'green') : ''}${s.behind ? gitBadge(`落后 ${s.behind} 待拉取`, 'amber') : ''}</div>
    <div class="git-wb-inline"><label>远端 <input id="git-wb-sync-remote" placeholder="留空用默认远端" autocomplete="off" /></label><label>分支 <input id="git-wb-sync-branch" placeholder="留空用当前分支" autocomplete="off" /></label></div>
    <div class="git-wb-actions" style="margin-top:10px">
      <button class="btn btn-sm btn-primary" type="button" data-gact="fetch">Fetch 拉取元数据</button>
      <button class="btn btn-sm btn-primary" type="button" data-gact="pull">Pull 拉取更新</button>
      <button class="btn btn-sm btn-primary" type="button" data-gact="push">Push 推送</button>
    </div></div>`;
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const remote = gitVal('git-wb-sync-remote');
    const branch = gitVal('git-wb-sync-branch');
    const params = { ...(remote ? { remote } : {}), ...(branch ? { branch } : {}) };
    const act = b.dataset.gact;
    await runGitAction(act, params);
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('sync');
  }));
}

async function renderGitStash() {
  const pane = gitPane('stash');
  if (!pane) return;
  const d = await gitLoadView('stash');
  if (!d) { pane.innerHTML = gitEmpty('无法读取 Stash 列表'); return; }
  const rows = d.stashes.map((s, i) => `<tr class="clickable" data-gstash="${esc(s.ref || `stash@{${i}}`)}">
    <td class="mono">${esc(s.ref || `stash@{${i}}`)}</td><td>${esc(s.message)}</td><td class="mono">${esc((s.date || '').slice(0, 16).replace('T', ' '))}</td>
  </tr>`).join('');
  pane.innerHTML = `<div class="git-wb-card"><h4>Stash 储藏（点击行选中）</h4>
    <div class="table-wrap"><table class="git-wb-table"><thead><tr><th>引用</th><th>说明</th><th>时间</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="git-wb-empty">暂无 Stash</td></tr>`}</tbody></table></div>
    <div class="git-wb-inline" style="margin-top:10px"><input id="git-wb-stash-ref" placeholder="stash@{0}（留空用最近一条）" autocomplete="off" /><input id="git-wb-stash-msg" placeholder="Stash 说明（保存时可选）" autocomplete="off" /></div>
    <div class="git-wb-actions" style="margin-top:8px">
      <button class="btn btn-sm btn-primary" type="button" data-gact="save">保存 Stash</button>
      <button class="btn btn-sm" type="button" data-gact="apply">应用 (apply)</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="pop">弹出 (pop)</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="drop">丢弃 (drop)</button>
    </div></div>`;
  pane.querySelectorAll('[data-gstash]').forEach((tr) => tr.addEventListener('click', () => {
    const el = $('#git-wb-stash-ref');
    if (el) el.value = tr.dataset.gstash;
  }));
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const ref = gitVal('git-wb-stash-ref');
    const msg = gitVal('git-wb-stash-msg');
    const act = b.dataset.gact;
    const params = ref ? { ref } : {};
    if (act === 'save') await runGitAction('stashSave', { includeUntracked: true, ...(msg ? { message: msg } : {}) });
    else if (act === 'apply') await runGitAction('stashApply', params);
    else if (act === 'pop') await runGitAction('stashPop', params);
    else if (act === 'drop') await runGitAction('stashDrop', params);
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('stash');
  }));
}

async function renderGitTag() {
  const pane = gitPane('tag');
  if (!pane) return;
  const d = await gitLoadView('tags');
  if (!d) { pane.innerHTML = gitEmpty('无法读取标签列表'); return; }
  const rows = d.tags.map((t) => `<tr class="clickable" data-gtag="${esc(t.name)}"><td class="mono">${esc(t.name)}</td><td>${esc(t.message || '')}</td></tr>`).join('');
  pane.innerHTML = `<div class="git-wb-card"><h4>标签（点击行选中）</h4>
    <div class="table-wrap"><table class="git-wb-table"><thead><tr><th>标签</th><th>附注</th></tr></thead><tbody>${rows || `<tr><td colspan="2" class="git-wb-empty">暂无标签</td></tr>`}</tbody></table></div>
    <div class="git-wb-inline" style="margin-top:10px"><input id="git-wb-tag-name" placeholder="标签名" autocomplete="off" /><input id="git-wb-tag-msg" placeholder="附注信息（可选）" autocomplete="off" /></div>
    <div class="git-wb-actions" style="margin-top:8px"><button class="btn btn-sm btn-primary" type="button" data-gact="create">新建标签</button><button class="btn btn-sm btn-danger" type="button" data-gact="delete">删除标签</button></div></div>`;
  pane.querySelectorAll('[data-gtag]').forEach((tr) => tr.addEventListener('click', () => { const el = $('#git-wb-tag-name'); if (el) el.value = tr.dataset.gtag; }));
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const name = gitVal('git-wb-tag-name');
    if (!name) { toast('请填写或点选标签名', true); return; }
    const msg = gitVal('git-wb-tag-msg');
    if (b.dataset.gact === 'create') await runGitAction('tagCreate', { name, ...(msg ? { message: msg } : {}) });
    else await runGitAction('tagDelete', { name });
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('tag');
  }));
}

async function renderGitConflict() {
  const pane = gitPane('conflict');
  if (!pane) return;
  const [st, cf] = await Promise.all([gitLoadView('status'), gitLoadView('conflicts')]);
  const conflicts = (cf && cf.files) || (st && st.conflicts) || [];
  pane.innerHTML = `<div class="git-wb-card"><h4>冲突 / 还原 / 重置</h4>
    <div class="git-wb-summary">${conflicts.length ? gitBadge(`${conflicts.length} 个冲突文件`, 'red') : gitBadge('无冲突', 'green')}</div>
    ${conflicts.length ? `<div class="table-wrap"><table class="git-wb-table"><tbody>${conflicts.map((f) => `<tr><td class="mono">${esc(f)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="git-wb-inline" style="margin-top:10px"><input id="git-wb-conflict-ref" placeholder="提交号 / 分支（留空用 HEAD）" autocomplete="off" /></div>
    <div class="git-wb-actions" style="margin-top:8px">
      <button class="btn btn-sm" type="button" data-gact="abort">中止合并 (merge --abort)</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="revert">还原提交</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="resetSoft">重置 (soft)</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="resetMixed">重置 (mixed)</button>
      <button class="btn btn-sm btn-danger" type="button" data-gact="resetHard">重置 (hard)</button>
    </div></div>`;
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    const ref = gitVal('git-wb-conflict-ref');
    const act = b.dataset.gact;
    if (act === 'abort') await runGitAction('mergeAbort', {});
    else if (act === 'revert') await runGitAction('revert', ref ? { hash: ref } : {});
    else if (act === 'resetSoft') await runGitAction('reset', { mode: 'soft', ref: ref || 'HEAD~1' });
    else if (act === 'resetMixed') await runGitAction('reset', { mode: 'mixed', ref: ref || 'HEAD~1' });
    else if (act === 'resetHard') await runGitAction('reset', { mode: 'hard', ref: ref || 'HEAD~1' });
    // v0.4.31 收敛：「放弃全部本地改动」低频且易误删，前端入口已移除（后端 discard 动作保留不动，可回退）。
    for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
    await refreshGitTab('conflict');
  }));
}

async function renderGitClean() {
  const pane = gitPane('clean');
  if (!pane) return;
  pane.innerHTML = `<div class="git-wb-card"><h4>Clean up · 清理未跟踪文件</h4>
    <div class="notice warn">清理会永久删除未跟踪的文件 / 目录。建议先「预览」确认清单，再执行清理。</div>
    <div class="git-wb-actions" style="margin-top:10px"><button class="btn btn-sm" type="button" data-gact="preview">预览将被清理的文件</button><button class="btn btn-sm btn-danger" type="button" data-gact="clean">执行清理</button></div>
  </div><div id="git-wb-clean-result"></div>`;
  pane.querySelectorAll('[data-gact]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.gact === 'preview') {
      const r = await runRepoGit('clean', ['-n', '-d']);
      const box = $('#git-wb-clean-result');
      if (box) box.innerHTML = `<div class="git-wb-card"><h4>清理预览结果</h4><pre class="git-wb-diff">${esc((r && r.output) || '（无未跟踪文件）')}</pre></div>`;
    } else {
      await runGitAction('clean', {});
      for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
      await refreshGitTab('clean');
    }
  }));
}

function renderGitCustom() {
  const pane = gitPane('custom');
  if (!pane) return;
  const presetsCard = `<div class="git-wb-card" style="margin-top:12px"><h4>全部快捷命令</h4><div class="git-wb-actions">${repoGitPresets.map((p) => `<button class="btn btn-sm ${p.destructive ? 'btn-danger' : (p.write ? 'btn-primary' : '')}" type="button" data-gpreset-all="${esc(p.key)}" title="${esc(p.hint || '')}">${esc(p.ico)} ${esc(p.label)}</button>`).join('')}</div></div>`;
  if (!pane.dataset.built) {
    pane.innerHTML = `<div class="git-wb-card"><h4>自定义 Git 命令</h4>
      <div class="notice warn">只接受白名单内的 Git 子命令与参数，禁止 shell 元字符与 --git-dir / --work-tree 等越权选项。写操作需仓库写权限。</div>
      <div id="git-wb-custom-form-slot"></div></div>${presetsCard}`;
    // 把静态 form 搬进本分区（静态 id 保持不变，boot 期绑定不失效）。
    const form = $('#repo-git-form');
    const slot = $('#git-wb-custom-form-slot');
    if (form && slot && slot.appendChild) { slot.appendChild(form); form.hidden = false; }
    pane.dataset.built = '1';
    pane.querySelectorAll('[data-gpreset-all]').forEach((b) => b.addEventListener('click', () => void runGitPreset(b.dataset.gpresetAll)));
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const parts = splitGitCommand(gitVal('repo-git-input'));
      if (!parts.length) { toast('请输入 Git 子命令，例如 status 或 log --oneline -n 5', true); return; }
      void runRepoGit(parts[0], parts.slice(1));
    });
    const clear = $('#repo-git-clear');
    if (clear) clear.addEventListener('click', () => gitOut('—'));
  } else {
    // 只刷新「全部快捷命令」卡片，form 已存在且不重建，避免重复绑定。
    const card = pane.querySelector('.git-wb-card:last-child');
    if (card) card.outerHTML = presetsCard.trim();
    pane.querySelectorAll('[data-gpreset-all]').forEach((b) => b.addEventListener('click', () => void runGitPreset(b.dataset.gpresetAll)));
  }
}

async function refreshGitTab(tab) {
  renderGitToolbar();
  const map = {
    status: renderGitStatus, log: renderGitLog, commit: renderGitCommit,
    branch: renderGitBranch, sync: renderGitSync, stash: renderGitStash,
    tag: renderGitTag, conflict: renderGitConflict, clean: renderGitClean,
    custom: renderGitCustom,
  };
  const fn = map[tab];
  if (fn) await fn();
}

async function openRepoGitModal(repo) {
  repoGitRepo = String(repo || '');
  const modal = $('#repo-git-modal');
  if (!modal) return;
  const title = $('#repo-git-title');
  if (title) title.textContent = `Git 操作 · ${repoGitRepo}`;
  gitOut('选择一个标签开始操作。');
  for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
  repoGitTab = 'status';
  try {
    const [rt, presets, groups] = await Promise.all([
      api('/git/runtime'), api('/repos/git/presets'), api('/repos/git/groups'),
    ]);
    const eff = rt.effectiveGit || {};
    const sub = $('#repo-git-sub');
    if (sub) sub.textContent = `通道：${rt.effective === 'container' ? '平台容器 / 本机' : `SSH 宿主机 ${eff.host || ''}`}${eff.version ? ` · Git ${eff.version}` : ''} · 工作区仓库 ${repoGitRepo}`;
    // v0.4.31 收敛：只展示 TortoiseGit 常用操作标签与配套命令，低频入口前端隐藏（后端不动）。
    const filtered = filterGitWorkbench(groups.items || [], presets.items || []);
    repoGitGroups = filtered.groups;
    repoGitPresets = filtered.presets;
  } catch (e) { toast(e.message, true); return; }
  renderGitTabs();
  for (const g of repoGitGroups) {
    const p = gitPane(g.id);
    if (p) p.hidden = g.id !== repoGitTab;
  }
  // v0.4.31 收敛：自定义命令标签隐藏后，原本在 renderGitCustom 里绑定的「清空输出」
  // 按钮改在这里一次性绑定（dataset 标记防重复），保证输出区清空功能不随入口下架而失效。
  const clearOut = $('#repo-git-clear');
  if (clearOut && !clearOut.dataset.bound) {
    clearOut.addEventListener('click', () => gitOut('—'));
    clearOut.dataset.bound = '1';
  }
  // 提交详情弹窗：一次性绑定关闭按钮 / 遮罩 / Esc（dataset 防重复）。
  const commitModal = $('#git-commit-modal');
  if (commitModal && !commitModal.dataset.bound) {
    commitModal.querySelectorAll('[data-git-commit-close]').forEach((el) =>
      el.addEventListener('click', closeGitCommitModal));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !commitModal.hidden) closeGitCommitModal();
    });
    commitModal.dataset.bound = '1';
  }
  modal.hidden = false;
  await refreshGitTab(repoGitTab);
}

function closeRepoGitModal() {
  const modal = $('#repo-git-modal');
  if (modal) modal.hidden = true;
}

function closeGitCommitModal() {
  const modal = $('#git-commit-modal');
  if (modal) modal.hidden = true;
}


/* ------------------------- Git 运行时（v0.3.3） ------------------------- */
// 点击「克隆」之前就能看到 Git 是否就绪；容器镜像缺 Git 时提示走 SSH 宿主机兜底。
async function loadGitRuntime() {
  const box = $('#git-runtime-status');
  if (!box) return;
  try {
    const d = await api('/git/runtime');
    const fb = d.fallback || {};
    const hg = d.hostGit || {};
    const eff = d.effectiveGit || {};
    const pd = d.platformDetail || {};
    // v0.3.9：宿主机实测到 Git 就按「正常」展示，不再笼统报「未找到可用的 Git」。
    const stateBadge = d.available
      ? badge(`Git ${d.version || '可用'}`, 'green')
      : (hg.available
        ? badge(`宿主机 Git ${hg.version || '可用'} · SSH 兜底`, 'green')
        : (d.channel === 'ssh-host' ? badge('本机无 Git · SSH 宿主机兜底（未实测）', 'amber') : badge('Git 不可用', 'red')));
    const channel = d.available
      ? `执行通道：本机 / 当前容器（${esc(d.source || '自动探测')}）`
      : (fb.ready
        ? `执行通道：SSH 宿主机 ${esc(fb.serverName || '')}（${esc(fb.serverHost || '')}）→ ${esc(fb.hostWorkspaceDir || '')}`
        : `兜底未就绪：${esc(fb.reason || '未登记 SSH 服务器')}`);
    const kv = (k, v) => `<div class="dk-kv-row"><span class="dk-kv-key">${esc(k)}</span><span class="dk-kv-val">${esc(v || '—')}</span></div>`;
    const tried = Array.isArray(d.tried) ? d.tried : [];
    const triedHtml = tried.length
      ? tried.map((t) => {
        const ok = /可用|OK|found|v?\d+\.\d+/i.test(String(t)) && !/不存在|exit=null|ENOENT|不可用/i.test(String(t));
        return `<div class="git-probe-line ${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✖'} ${esc(t)}</div>`;
      }).join('')
      : '<div class="muted">没有探测记录</div>';
    const hostProbeLine = hg.checked && !hg.skipped
      ? `<div class="git-probe-line ${hg.available ? 'ok' : 'bad'}">${hg.available ? '✔' : '✖'} SSH 宿主机 ${esc(hg.host || hg.serverName || '')}：${esc(hg.detail || hg.error || '无输出')}</div>`
      : '';
    const hintLines = String(d.hint || '').split('\n').map((line) => `<div>${esc(line)}</div>`).join('');
    // v0.3.7：把「检测」的完整结果展示出来，而不是只显示一句概要。
    box.innerHTML = `
      <div class="row gap wrap" style="align-items:center">
        ${stateBadge}<span>${channel}</span>
        <span class="muted small">检测于 ${esc(new Date().toLocaleTimeString('zh-CN', { hour12: false }))}</span>
        <button class="btn btn-sm" type="button" data-git-probe>重新检测</button>
      </div>
      <div class="dk-kv" style="margin-top:10px">
        ${kv('可执行文件', d.bin || '未找到（当前容器）')}
        ${kv('Git 版本', d.version || '—')}
        ${kv('探测来源', d.source || (d.configuredBin ? '手工指定' : '自动探测'))}
        ${kv('宿主机 Git', hg.available
          ? `${hg.version} · ${hg.bin} · ${hg.host || hg.serverName}`
          : (hg.skipped ? '无需探测（当前环境已有 Git）' : (hg.checked ? `未检测到${hg.error ? ` · ${hg.error}` : ''}` : '未实测')))}
        ${kv('生效 Git', eff.verified
          ? (eff.location === 'container' ? '当前容器 / 本机' : `SSH 宿主机 ${eff.host || eff.serverName} · ${eff.version || ''}`)
          : '无可用 Git')}
        ${kv('宿主机工作区可写', hg.workspaceWritable === true ? '是' : (hg.workspaceWritable === false ? '否' : '—'))}
        ${kv('手工指定路径', d.configuredBin || '未指定')}
        ${kv('运行平台', pd.current || d.platform || '—')}
        ${pd.runtimeImage ? kv('运行镜像', pd.runtimeImage) : ''}
        ${pd.host ? kv('Git 宿主机', `${pd.host}${hg.version ? ` · Git ${hg.version}` : ''}`) : ''}
        ${kv('工作区', d.workspaceDir || '—')}
        ${kv('宿主机映射', d.hostWorkspaceDir || '—')}
        ${kv('克隆通道', d.channel || '—')}
        ${kv('SSH 兜底', fb.enabled === false ? '已关闭' : (fb.ready
          ? `就绪 · ${fb.serverName || ''}（${fb.serverHost || ''}）` : `未就绪 · ${fb.reason || '未登记 SSH 服务器'}`))}
      </div>
      <div class="notice" style="margin-top:10px">${hintLines}</div>
      ${pd.lsb ? `<details class="dk-raw" style="margin-top:8px"><summary>宿主机发行版信息（lsb_release -a）</summary><pre class="log short">${esc(pd.lsb)}</pre></details>` : ''}
      <details class="dk-raw" style="margin-top:8px">
        <summary>可执行文件探测明细（${tried.length + (hostProbeLine ? 1 : 0)} 条）</summary>
        <div class="git-probe-list">${triedHtml}${hostProbeLine}</div>
      </details>
      ${d.installHint ? `<div class="hint" style="margin-top:8px">${hg.available ? '可选（希望容器内直接执行 Git）' : '安装建议'}：<code>${esc(d.installHint)}</code></div>` : ''}`;
    box.querySelectorAll('[data-git-probe]').forEach((b) => b.addEventListener('click', refreshGitRuntime));
    if ($('#git-runtime-bin')) $('#git-runtime-bin').value = d.configuredBin || '';
    if ($('#git-runtime-fallback')) $('#git-runtime-fallback').value = fb.enabled === false ? 'off' : 'on';
    // v0.3.4：显示当前环境档案与「实际生效」的克隆通道，异常时引导去环境适配页处置。
    api('/environment').then((env) => {
      const envBox = $('#git-runtime-env');
      if (!envBox) return;
      const name = env.profile.derived ? `${env.profile.name} → ${env.profile.derived}` : env.profile.name;
      const channel = env.applied.gitClone || env.strategies.gitClone;
      envBox.innerHTML = `环境档案 <b>${esc(name)}</b> · 生效克隆通道 <b>${esc(channel || '自动')}</b>`
        + (env.environmentChanged ? ` ${badge('环境已切换，建议重新体检', 'amber')}` : '')
        + ' · 可在「环境适配」页切换策略或应用自动处置';
    }).catch(() => { if ($('#git-runtime-env')) $('#git-runtime-env').textContent = '环境档案读取失败，请打开「环境适配」页查看'; });
  } catch (e) {
    box.textContent = `Git 运行时检测失败：${e.message}`;
  }
}

/** 重新探测并给出明确反馈，避免点了按钮却看不到结果变化。 */
async function refreshGitRuntime() {
  const btn = $('#git-runtime-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '检测中…'; }
  try {
    await api('/git/runtime/refresh', { method: 'POST', body: {} });
    await loadGitRuntime();
    toast('检测完成：可执行文件结果与探测明细已更新');
  } catch (err) { toast(err.message, true); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = '仅重新检测'; }
  }
}

/* ---------------------- 环境适配中心（v0.3.4） ---------------------- */
// 决策（识别 / 体检 / 自动处置）都在后端 environment.js，这里只做展示与配置。
let envReport = null;

const ENV_OPTION_LABELS = {
  gitClone: { auto: '自动（按体检结果）', local: '本机 / 当前容器', 'ssh-host': 'SSH 宿主机', disabled: '禁用克隆' },
  buildExecutor: { auto: '自动降级', local: '本机工具链', docker: 'Docker Engine', ssh: '远程 SSH', wsl: 'WSL' },
  gitInstall: { never: '不自动安装（推荐）', auto: '允许自动安装（需联网）' },
  sshFallback: { auto: '跟随档案', on: '强制开启', off: '强制关闭' },
};

function envOptions(key, current, effective) {
  const values = ['', ...((envReport && envReport.options && envReport.options[key]) || []).filter((v) => v !== '')];
  return values.map((v) => {
    const label = v === ''
      ? `跟随档案（当前生效：${effective || '保持现有'}）`
      : ((ENV_OPTION_LABELS[key] || {})[v] || v);
    return `<option value="${esc(v)}"${String(v) === String(current || '') ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function renderEnvironment(d) {
  envReport = d;
  const info = d.info || {};
  const cfg = d.config || {};
  const profileName = d.profile.derived ? `${d.profile.name} → ${d.profile.derived}` : d.profile.name;
  const activeChannel = d.applied.gitClone || d.strategies.gitClone;
  const box = $('#env-summary');
  if (box) {
    box.innerHTML = `${badge(info.container ? '容器内' : '宿主机', 'green')} ${badge(`Node ${esc(info.node || '')}`, 'gray')}`
      + `${d.environmentChanged ? badge('检测到环境切换', 'amber') : badge('环境未变化', 'green')}`
      + `${badge(`克隆 ${esc(activeChannel || '自动')}`, activeChannel === 'none' || activeChannel === 'disabled' ? 'red' : 'green')}`
      + `<div style="margin-top:8px">档案 <b>${esc(profileName)}</b> · 指纹 <code>${esc(d.fingerprint)}</code> · 体检 ${d.summary.ok} 正常 / ${d.summary.warn} 提醒 / ${d.summary.error} 异常</div>`
      + `<div>工作区 <code>${esc(info.workspaceDir)}</code>${info.hostWorkspaceDir ? ` · 宿主机映射 <code>${esc(info.hostWorkspaceDir)}</code>` : ''}</div>`
      + `<div class="muted">检查时间 ${esc(fmtTime(d.checkedAt))}${d.cached ? '（缓存）' : ''}${info.runtimeImage ? ` · 镜像 ${esc(info.runtimeImage)}` : ''}</div>`;
  }
  const profileSelect = $('#env-profile');
  if (profileSelect) {
    profileSelect.innerHTML = (d.profiles || []).map((p) =>
      `<option value="${esc(p.id)}"${p.id === cfg.activeProfile ? ' selected' : ''}>${esc(p.name)}${p.builtin ? '' : '（自定义）'}</option>`).join('');
  }
  const current = (d.profiles || []).find((p) => p.id === (d.profile && d.profile.id));
  if ($('#env-profile-desc')) {
    $('#env-profile-desc').textContent = current
      ? `${current.description}｜策略来源：${(d.strategySources || {}).gitClone || '档案预设'}`
      : '—';
  }
  const selects = {
    gitClone: '#env-git-clone', buildExecutor: '#env-build-executor',
    gitInstall: '#env-git-install', sshFallback: '#env-ssh-fallback',
  };
  for (const [key, selector] of Object.entries(selects)) {
    const el = $(selector);
    if (el) el.innerHTML = envOptions(key, (cfg.strategies || {})[key] || '', (d.strategies || {})[key]);
  }
  if ($('#env-auto-heal')) $('#env-auto-heal').checked = cfg.autoHeal !== false;
  if ($('#env-check-startup')) $('#env-check-startup').checked = cfg.checkOnStartup !== false;

  const customs = (d.profiles || []).filter((p) => !p.builtin);
  if ($('#env-profile-list')) {
    $('#env-profile-list').innerHTML = customs.length
      ? customs.map((p) => `<div class="row" style="justify-content:space-between;margin:4px 0"><span><b>${esc(p.name)}</b> <code>${esc(p.id)}</code> · ${esc(p.description)}</span><button class="btn btn-sm" type="button" data-env-del="${esc(p.id)}">删除</button></div>`).join('')
      : '<span class="muted">暂无自定义档案；内置档案已覆盖本机 / 完整容器 / 精简容器 / 远程部署</span>';
  }
  if ($('#env-checks')) {
    const tones = { ok: 'green', warn: 'amber', error: 'red', info: 'gray' };
    const labels = { ok: '正常', warn: '提醒', error: '异常', info: '提示' };
    $('#env-checks').innerHTML = table(['状态', '检查项', '详情', '建议 / 自动动作'], (d.checks || []).map((c) =>
      `<tr><td>${badge(labels[c.level] || c.level, tones[c.level] || 'gray')}</td><td><b>${esc(c.label)}</b></td>`
      + `<td>${esc(c.detail)}</td><td>${esc(c.advice)}${c.autoAction ? `<div class="muted">可自动：${esc(c.autoAction)}</div>` : ''}</td></tr>`));
  }
  if ($('#env-history')) {
    const hist = d.history || [];
    $('#env-history').textContent = hist.length
      ? hist.map((h) => `[${fmtTime(h.at)}] ${h.level === 'warn' ? '⚠' : h.level === 'error' ? '✖' : '✔'} ${h.action}${h.detail ? ` · ${h.detail}` : ''}`).join('\n')
      : '暂无处置记录；点「应用自动处置」后会记录每一步';
  }
  if ($('#env-overrides')) {
    const ov = Object.entries(cfg.envOverrides || {});
    $('#env-overrides').innerHTML = ov.length
      ? ov.map(([k, v]) => `<div><code>${esc(k)}</code> = ${esc(v.value)} <span class="muted">→ ${esc(v.key)}</span></div>`).join('')
      : '<span class="muted">未声明 DP_*；当前完全按档案 / 自动推导运行</span>';
  }
}

async function loadEnvironment() {
  try { renderEnvironment(await api('/environment')); }
  catch (e) { if ($('#env-summary')) $('#env-summary').textContent = `环境体检失败：${e.message}`; }
}

/* ---------------------------------- IDE ---------------------------------- */

const ideCredState = { configured: false, plain: '' };

async function loadIde() {
  try {
    const d = await api('/ide');
    $('#ide-home').href = d.url;
    $('#ide-url').textContent = `服务地址：${d.url} · 平台工作区：${d.workspace}`;
    // v0.4.5：info 区按实际 IDE 形态展示。旧版一律按 code-server 容器写死
    // /home/coder/project 与 $PASSWORD，本机 VS Code serve-web 下全是错的。
    const a = d.access || {};
    const p = d.password || {};
    const info = $('#ide-config-info');
    if (info) {
      info.innerHTML = [
        ['服务地址', d.url],
        ['平台工作区', d.workspace],
        ['目录映射', a.native ? '本机绝对路径（VS Code serve-web）' : '/home/coder/project'],
        ['访问模式', a.modeLabel || '免密（VS Code serve-web）'],
        ['口令配置项', String(p.key || 'CODE_SERVER_PASSWORD')],
        ['口令状态', p.configured ? '已自动配置 · 可在下方显示 / 复制' : '未配置 · 请到「集成服务」生成'],
      ].map(([k, v]) => `<div class="ide-config-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    }
    ideCredState.configured = Boolean(p.configured);
    ideCredState.plain = '';
    const st = $('#ide-cred-state');
    if (st) st.textContent = p.configured
      ? `已配置 · ${a.modeLabel || ''} · 在「集成服务 → 服务账号 / 口令」里可修改`
      : '未配置 · 请到「集成服务 → 服务账号 / 口令」生成';
    const h = $('#ide-cred-hint');
    if (h) h.textContent = p.hint || a.note || '';
    const v = $('#ide-cred-value');
    if (v) v.textContent = p.configured ? (p.masked || '******') : '—';
  } catch (e) { toast(e.message, true); }
}

/** 显式点「显示 / 复制」才向后端取明文，列表接口永远只给脱敏值。 */
async function revealIdePassword() {
  if (!ideCredState.configured) { toast('尚未配置 CODE_SERVER_PASSWORD', true); return ''; }
  if (ideCredState.plain) return ideCredState.plain;
  const d = await api('/ide/password', { method: 'POST', body: { reveal: true } });
  ideCredState.plain = d.password || '';
  const v = $('#ide-cred-value');
  if (v) v.textContent = d.password || '—';
  return ideCredState.plain;
}

async function openIde() {
  const repoPath = $('#ide-path').value.trim();
  try {
    const d = await api('/ide/open', { method: 'POST', body: { repoPath } });
    $('#ide-url').textContent = `打开目录：${d.folder}`;
    $('#ide-frame').src = d.url;
    window.open(d.url, '_blank', 'noopener');
  } catch (e) { toast(e.message, true); }
}

/** v0.4.16 B 批：仓库列表「IDE 打开」直接用该仓库的工作区目录打开 IDE，不跳转到「在线 IDE」页。 */
async function openRepoIdeDirect(repoName) {
  const repoPath = String(repoName || '').trim();
  if (!repoPath) { toast('缺少仓库目录名', true); return; }
  try {
    const d = await api('/ide/open', { method: 'POST', body: { repoPath } });
    // 同步「在线 IDE」页的输入框，便于用户后续在 IDE 页复用同一目录。
    const p = $('#ide-path'); if (p) p.value = repoPath;
    const label = $('#ide-url'); if (label) label.textContent = `打开目录：${d.folder}`;
    const frame = $('#ide-frame'); if (frame) frame.src = d.url;
    window.open(d.url, '_blank', 'noopener');
    toast(`已用仓库目录打开 IDE：${d.folder}`);
  } catch (e) { toast(e.message, true); }
}

/* ------------- v0.3.11 · 工作区目录浏览选择器（IDE / 构建部署共用） ------------- */
const ideDirState = { path: '/', parent: '/', bound: false };
// 当前选择器的目标输入框 id：IDE 用 'ide-path'，构建部署用 'build-repo-path'。
let dirPickerTarget = 'ide-path';

async function loadIdeDirs(path) {
  const box = $('#ide-dir-list');
  if (box) box.innerHTML = '<div class="muted" style="padding:14px">读取中…</div>';
  try {
    const d = await api(`/ide/dirs?path=${encodeURIComponent(path || '/')}`);
    ideDirState.path = d.path || '/';
    ideDirState.parent = d.parent || '/';
    const bar = $('#ide-dir-pathbar');
    if (bar) {
      bar.innerHTML = pathBarHtml(ideDirState.path);
      bindPathBar(bar, {
        onGo: (v) => loadIdeDirs(v),
        onUp: () => loadIdeDirs(ideDirState.parent),
      });
    }
    const cur = $('#ide-dir-current');
    if (cur) cur.textContent = `当前目录：${ideDirState.path} · 容器内 /home/coder/project${ideDirState.path === '/' ? '' : ideDirState.path}`;
    const sub = $('#ide-dir-sub');
    if (sub) sub.textContent = `${d.workspace || '工作区'} · ${d.total || 0} 个子目录`;
    if (box) {
      const items = d.items || [];
      box.innerHTML = items.length ? items.map((item) => `
        <div class="dir-pick-row">
          <button class="dir-pick-name" type="button" data-ide-dir-enter="${esc(item.path)}" title="进入 ${esc(item.name)}">${FOLDER_SVG}<b>${esc(item.name)}</b></button>
          <button class="btn btn-sm" type="button" data-ide-dir-pick="${esc(item.path)}">选择此目录</button>
        </div>`).join('') : '<div class="empty">该目录下没有子目录，可直接点「选择当前目录」</div>';
    }
  } catch (e) {
    if (box) box.innerHTML = `<div class="notice error" style="margin:10px">${esc(e.message)}</div>`;
  }
}

function selectIdeDir(path) {
  const rel = String(path || '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const input = $('#' + dirPickerTarget);
  if (input) input.value = rel;
  // IDE 页有已选提示，构建页没有，按存在性渲染。
  const picked = $('#ide-picked');
  if (picked) {
    picked.hidden = false;
    picked.textContent = `已选择：${rel || '工作区根目录'} · IDE 内路径 /home/coder/project${rel ? `/${rel}` : ''}`;
  }
  const modal = $('#ide-dir-modal');
  if (modal) modal.hidden = true;
  toast(rel ? `已选择项目目录 ${rel}` : '已选择工作区根目录');
}

function openIdeDirPicker(targetInputId) {
  if (targetInputId) dirPickerTarget = targetInputId;
  const current = String(($('#' + dirPickerTarget) && $('#' + dirPickerTarget).value) || '').trim();
  const modal = $('#ide-dir-modal');
  if (modal) modal.hidden = false;
  // 标题随调用方调整：构建部署时强调「选择构建项目目录」。
  const title = $('#ide-dir-title');
  if (title) title.textContent = dirPickerTarget === 'build-repo-path' ? '选择构建项目目录' : '选择项目目录';
  loadIdeDirs(current ? `/${current.replace(/^\/+/, '')}` : '/');
  if (ideDirState.bound) return;
  ideDirState.bound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-ide-dir-close]')) {
      const m = $('#ide-dir-modal');
      if (m) m.hidden = true;
      return;
    }
    const pick = e.target.closest && e.target.closest('[data-ide-dir-pick]');
    if (pick) { selectIdeDir(pick.dataset.ideDirPick); return; }
    const enter = e.target.closest && e.target.closest('[data-ide-dir-enter]');
    if (enter) loadIdeDirs(enter.dataset.ideDirEnter);
  });
  const up = $('#ide-dir-up');
  if (up) up.addEventListener('click', () => loadIdeDirs(ideDirState.parent));
  const root = $('#ide-dir-root');
  if (root) root.addEventListener('click', () => loadIdeDirs('/'));
  const choose = $('#ide-dir-select');
  if (choose) choose.addEventListener('click', () => selectIdeDir(ideDirState.path));
}

/* --------------------------------- 存储 ---------------------------------- */

function pathParent(p) {
  if (!p || p === '/') return '/';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

/* ------------------- 存储 / 文件（OpenList 管理集成） ------------------- */

const olJoin = (dir, name) => `${String(dir || '/').replace(/\/+$/, '')}/${String(name).replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');

function olDownloadUrl(p) {
  const token = localStorage.getItem('dp_token');
  return `/api/openlist/files/download?path=${encodeURIComponent(p)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

function olResult(text) {
  const box = $('#storage-result');
  box.textContent = text;
  box.hidden = false;
}

function renderOpenlistStatus(status) {
  storageState.connection = status || null;
  // 内嵌 OpenList 后台需要管理员 token（后端 /api/openlist/admin 已限管理员），
  // 普通账号不展示该入口，避免点开只看到 403。
  const embedToggle = $('#openlist-embed-toggle');
  if (embedToggle) embedToggle.hidden = !(currentUser && currentUser.role === 'admin');
  const online = Boolean(status && status.online);
  const label = status && (status.connectionLabel || status.label) ? `「${status.connectionLabel || status.label}」` : '';
  $('#openlist-status-text').textContent = online ? '● 在线' : '● 离线 / 未配置';
  $('#openlist-status-detail').textContent = online
    ? `${label} ${status.url} · ${status.version ? `v${status.version} · ` : ''}${status.siteTitle || 'OpenList'} · ${status.storageCount} 个挂载 · 配置来源：${status.source} · 代理：${status.effectiveProxy || '无'}${status.admin ? '' : ` · [管理权限不可用] ${status.adminHint || status.adminError || 'Token 无效'}`}`
    : `${label} ${status ? status.url || '' : ''} ${status ? (status.hint || status.error || '') : ''}`;
  $('#openlist-open').href = (status && status.manageUrl) || '#';
  $('#webdav-url').textContent = (status && status.webdav) || '-';
  if (online && $('#openlist-frame-card').classList.contains('as-modal')) {
    // v0.4.7：走平台同源代理，自动注入 token 登录，避免跨域 / 手动登录。
    $('#openlist-frame').src = '/api/openlist/admin';
  }
  $('#storage-current-conn').textContent = online
    ? `当前连接：${label || status.url} ${status.url}${status.admin ? '' : ' · 管理权限不可用（挂载 / 驱动接口会报错，请到连接管理修复凭据）'}`
    : `当前连接不可用：${status ? (status.hint || status.error || '') : '未配置'} · 请到「连接管理」切换或修复`;
}

/** v0.3.2：多 OpenList 连接列表，可切换 / 编辑 / 删除。 */
function renderOpenlistConnections(d) {
  const items = (d && d.items) || [];
  storageState.connections = items;
  storageState.activeId = (d && d.activeId) || '';
  $('#ol-conn-list').innerHTML = table(['连接', '服务地址', '凭据', '状态', '操作'], items.map((c) => `
    <tr>
      <td><b>${esc(c.label)}</b>${c.active ? ' ' + badge('当前', 'green') : ''}<div class="ext-list-url">${esc(c.user || 'admin')} · ${c.source === 'env' ? '来自 .env' : '面板登记'}</div></td>
      <td><div class="ext-list-url">${esc(c.url)}</div><div class="ext-list-url">代理 ${esc(c.effectiveProxy || '无')}</div></td>
      <td>${c.hasToken ? badge('Token', 'blue') : ''} ${c.hasPassword ? badge('密码', 'blue') : ''}${!c.hasToken && !c.hasPassword ? badge('匿名 / 未配置', 'amber') : ''}</td>
      <td>${c.active ? badge('生效中', 'green') : badge('已登记', 'gray')}</td>
      <td class="actions"><div class="ext-actions">
        ${c.active ? '' : `<button class="btn btn-sm" data-olc-op="activate" data-olc-id="${esc(c.id)}" data-olc-name="${esc(c.label)}">设为当前</button>`}
        <button class="btn btn-sm" data-olc-op="edit" data-olc-id="${esc(c.id)}">编辑</button>
        ${items.length > 1 ? `<button class="btn btn-sm btn-danger" data-olc-op="remove" data-olc-id="${esc(c.id)}" data-olc-name="${esc(c.label)}">删除</button>` : ''}
      </div></td>
    </tr>`));
  $$('[data-olc-op]').forEach((b) => b.addEventListener('click', async () => {
    const op = b.dataset.olcOp;
    const id = b.dataset.olcId;
    try {
      if (op === 'edit') {
        fillOpenlistConnectionForm((storageState.connections || []).find((c) => c.id === id));
      } else if (op === 'activate') {
        await api(`/openlist/connections/${encodeURIComponent(id)}/activate`, { method: 'POST', body: {} });
        toast(`已切换到「${b.dataset.olcName || id}」，正在重新加载`);
        currentStoragePath = '/';
        closeOpenlistConnectionForm();
        await loadStorage();
      } else if (op === 'remove') {
        if (!await confirmDialog({ message: `确定删除连接「${b.dataset.olcName || id}」？只移除平台里的登记，不会影响远端服务。` })) return;
        await api(`/openlist/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('连接已删除');
        closeOpenlistConnectionForm();
        await loadStorage();
      }
    } catch (err) { toast(err.message || String(err), true); }
  }));
}

function fillOpenlistConnectionForm(c) {
  const f = $('#openlist-config-form');
  f.hidden = false;
  $('#ol-conn-tip').hidden = true;
  $('#ol-conn-title').textContent = c ? `编辑连接 · ${c.label}` : '新增连接';
  f.elements.id.value = c ? c.id : '';
  f.elements.label.value = c ? c.label : '';
  f.elements.url.value = c ? c.url : '';
  f.elements.user.value = c ? (c.user || 'admin') : 'admin';
  f.elements.token.value = c && c.hasToken ? c.tokenMasked : '';
  f.elements.password.value = c && c.hasPassword ? c.passwordMasked : '';
  if (f.elements.url && f.elements.url.focus) f.elements.url.focus();
}

function closeOpenlistConnectionForm() {
  const f = $('#openlist-config-form');
  f.hidden = true;
  if (f.reset) f.reset();
  if (f.elements.id) f.elements.id.value = '';
  $('#ol-conn-tip').hidden = false;
  $('#ol-conn-title').textContent = '新增连接';
}

/**
 * v0.3.6 · 宝塔式路径条（本地文件浏览与远程 SFTP 文件管理共用）。
 * 面包屑每段可点击跳转；点条内空白处或「输入」切换成可编辑输入框，
 * 回车确认 / Esc 取消 / 失焦自动确认，输入框默认全选当前路径。
 */
function pathBarHtml(current) {
  const p = '/' + String(current || '/').split('/').filter(Boolean).join('/');
  const parts = p.split('/').filter(Boolean);
  let acc = '';
  const bits = ['<button type="button" class="pathbar-crumb" data-path="/">根目录</button>'];
  parts.forEach((part) => {
    acc += `/${part}`;
    bits.push(`<span class="pathbar-sep">›</span><button type="button" class="pathbar-crumb" data-path="${esc(acc)}">${esc(part)}</button>`);
  });
  bits.push('<span class="pathbar-sep">›</span>');
  return `<div class="pathbar" data-role="pathbar">
    <button type="button" class="pathbar-up" data-path-up title="上一级">←</button>
    <div class="pathbar-crumbs" data-role="pathbar-crumbs" title="点击空白处可直接输入路径">${bits.join('')}</div>
    <input class="pathbar-input" data-role="pathbar-input" value="${esc(p)}" spellcheck="false" hidden />
    <button type="button" class="pathbar-edit" data-path-edit title="输入完整路径">输入</button>
  </div>`;
}

function bindPathBar(root, { onGo, onUp }) {
  const bar = root.querySelector('[data-role="pathbar"]');
  if (!bar || bar.dataset.pathBound === '1') return;
  bar.dataset.pathBound = '1';
  const crumbs = bar.querySelector('[data-role="pathbar-crumbs"]');
  const input = bar.querySelector('[data-role="pathbar-input"]');
  input.dataset.current = input.value;
  const showInput = () => {
    input.value = input.dataset.current || input.value;
    crumbs.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  };
  const hideInput = (commit) => {
    if (input.hidden) return;
    const value = String(input.value || '/').trim() || '/';
    crumbs.hidden = false;
    input.hidden = true;
    if (commit && value !== input.dataset.current) onGo(value);
    else input.value = input.dataset.current || value;
  };
  crumbs.addEventListener('click', (e) => {
    const crumb = e.target.closest('[data-path]');
    if (crumb) onGo(crumb.dataset.path);
    else showInput();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); hideInput(true); }
    else if (e.key === 'Escape') { e.preventDefault(); hideInput(false); }
  });
  input.addEventListener('blur', () => hideInput(true));
  const edit = bar.querySelector('[data-path-edit]');
  if (edit) edit.addEventListener('click', (e) => { e.preventDefault(); showInput(); });
  const up = bar.querySelector('[data-path-up]');
  if (up) up.addEventListener('click', (e) => { e.preventDefault(); onUp(); });
}

/* ------------------------- v0.4.29 · rclone 存储层 ------------------------- */

function rcLog(message, isError = false) {
  const box = $('#rclone-result');
  if (box) { box.hidden = false; box.textContent = String(message); }
  if (isError) toast(String(message), true);
}
function gwLog(message, isError = false) {
  const box = $('#gw-result');
  if (box) { box.hidden = false; box.textContent = String(message); }
  if (isError) toast(String(message), true);
}

async function loadRclone() {
  await Promise.all([
    loadRcloneStatus().catch(() => {}),
    loadRcloneRemotes().catch(() => {}),
    loadRcloneFiles().catch(() => {}),
    loadGatewayStatus().catch(() => {}),
  ]);
}

async function loadRcloneStatus() {
  const d = await api('/rclone/status');
  rcloneState.status = d;
  const text = $('#rclone-status-text');
  const detail = $('#rclone-status-detail');
  if (text) text.textContent = d.installed ? d.version : '未检测到 rclone';
  if (detail) detail.textContent = d.installed
    ? `可执行文件：${d.bin} · 已配置远端 ${d.remotes} 个 · 配置：${d.config}`
    : `未找到 rclone 可执行文件。请把二进制放到 data/bin/，或在服务端配置 rclone.bin 后重启平台。${d.error ? `（${d.error}）` : ''}`;
}

function renderRcloneRemotes() {
  const list = $('#rclone-remote-list');
  if (!list) return;
  const items = rcloneState.remotes || [];
  list.innerHTML = items.length ? items.map((r) => `<div class="list-item" style="padding:8px 0;border-bottom:1px solid var(--color-border-tertiary)">
    <div class="row gap wrap" style="align-items:center">
      <b>${esc(r.label || r.name)}</b>
      <span class="muted small">${esc(r.name)} · ${esc(r.type)}${r.id === (rcloneState.status || {}).active?.id ? ' · 当前' : ''}</span>
      <span class="flex-spacer"></span>
      <button class="btn btn-ghost btn-sm" data-rc-remote-activate="${esc(r.id)}">设为当前</button>
      <button class="btn btn-sm" data-rc-remote-probe="${esc(r.id)}">测试</button>
      <button class="btn btn-sm" data-rc-remote-edit="${esc(r.id)}">编辑</button>
      <button class="btn btn-ghost btn-sm btn-danger" data-rc-remote-del="${esc(r.id)}">删除</button>
    </div>
    <div class="muted small" style="margin-top:4px">${Object.entries(r.fields || {}).filter(([k]) => !/pass|secret|token/i.test(k)).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(' · ') || '（无参数）'}</div>
  </div>`).join('') : '<div class="muted">还没有 rclone 远端。添加一个 WebDAV 远端即可开始浏览。</div>';
  for (const sel of [$('#rclone-remote-picker'), $('#gw-remote')]) {
    if (!sel) continue;
    const keep = sel === $('#gw-remote') ? (rcloneState.gateway?.settings?.remoteId || '') : rcloneState.remote;
    sel.innerHTML = '<option value="">默认远端</option>' + items.map((r) =>
      `<option value="${esc(r.id)}" ${r.id === keep ? 'selected' : ''}>${esc(r.label || r.name)} (${esc(r.type)})</option>`).join('');
  }
}

async function loadRcloneRemotes() {
  const d = await api('/rclone/remotes');
  rcloneState.remotes = d.items || [];
  renderRcloneRemotes();
}

function renderRcloneFiles(d) {
  const box = $('#rclone-file-list');
  if (!box) return;
  const files = d.content || [];
  const dirs = files.filter((f) => f.isDir).length;
  const provider = $('#rclone-provider');
  if (provider) provider.textContent = `${d.provider || 'rclone'} · ${d.total || 0} 项 · 文件夹 ${dirs} / 文件 ${files.length - dirs}${d.write ? '' : ' · 只读'}`;
  const rows = files.map((f) => `<tr class="file-row ${f.isDir ? 'is-dir' : 'is-file'}"
      data-rc-dir="${f.isDir ? esc(f.name) : ''}" ${f.isDir ? 'title="双击进入"' : ''}>
      <td style="width:38px"><input type="checkbox" data-rc-file="${esc(f.name)}" /></td>
      <td><span class="file-name">${f.isDir ? '📁' : '📄'} <b>${esc(f.name)}</b></span></td>
      <td style="width:110px">${f.isDir ? '-' : fmtSize(f.size)}</td>
      <td class="muted" style="width:170px">${esc(fmtTime(f.modified))}</td>
      <td class="actions" style="width:70px">${f.isDir ? '' : `<button class="btn btn-ghost btn-sm" data-rc-edit="${esc(f.name)}" title="重命名">✎</button>`}</td>
    </tr>`).join('');
  box.innerHTML = `<table><thead><tr><th></th><th>名称</th><th>大小</th><th>修改时间</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">此目录为空</td></tr>'}</tbody></table>`;
  box.querySelectorAll('tr[data-rc-dir]').forEach((tr) => {
    tr.addEventListener('dblclick', () => {
      rcloneState.path = `${d.path === '/' ? '' : d.path}/${tr.dataset.rcDir}`;
      loadRcloneFiles();
    });
  });
  const crumb = $('#rclone-breadcrumb');
  if (crumb) {
    crumb.innerHTML = pathBarHtml(d.path || '/');
    bindPathBar(crumb, {
      onGo: (v) => { rcloneState.path = v; loadRcloneFiles(); },
      onUp: () => {
        const segs = String(rcloneState.path || '/').split('/').filter(Boolean);
        segs.pop();
        rcloneState.path = `/${segs.join('/')}` || '/';
        loadRcloneFiles();
      },
    });
  }
}

async function loadRcloneFiles() {
  const params = new URLSearchParams({ remote: rcloneState.remote || '', path: rcloneState.path || '/' });
  const d = await api(`/rclone/files?${params}`);
  renderRcloneFiles(d);
}

function renderGateway(d) {
  rcloneState.gateway = d;
  const info = $('#gw-info');
  const mode = $('#gw-mode-label');
  if (mode) mode.textContent = `${d.mode === 'windows' ? 'Windows 本机' : 'Linux 容器'} · ${d.platform}`;
  if (info) {
    const container = d.container ? `容器 ${d.container.id.slice(0, 12)}（${d.container.status || 'unknown'}）` : '容器未创建';
    info.textContent = d.mode === 'windows'
      ? `WinFsp：${d.winFsp && d.winFsp.installed ? '已安装' : '未安装'} · rclone：${d.rclone && d.rclone.installed ? d.rclone.version : '未安装'} · ${d.session ? d.session.visibleHint : ''}`
      : `网关镜像：${d.image ? '已构建' : '未构建'} · ${container} · SMB 端口 ${d.port || 445}。${d.note || ''}`;
  }
  renderWinFspBar(d);
  const g = d.settings || {};
  const put = (sel, value) => { const el = $(sel); if (el && value !== undefined && value !== null && !/password/.test(el.type || '')) el.value = value; };
  put('#gw-remote', g.remoteId || '');
  put('#gw-port', g.smbPort || 445);
  put('#gw-share', g.shareName || 'dpstorage');
  put('#gw-user', g.smbUser || 'dpstorage');
  put('#gw-drive', g.winDrive || 'Z:');
  const addr = $('#gw-address');
  if (addr) addr.textContent = `\\\\127.0.0.1\\${g.shareName || 'dpstorage'}`;
}

function renderWinFspBar(d) {
  const bar = $('#gw-winfsp-bar');
  if (!bar) return;
  // 仅在 Windows 模式显示；Linux 容器不涉及 WinFsp。
  if (d.mode !== 'windows') { bar.hidden = true; return; }
  bar.hidden = false;
  const f = d.winFsp || {};
  const adminPill = $('#gw-admin-pill');
  const fspPill = $('#gw-fsp-pill');
  const msiNote = $('#gw-msi-note');
  const installBtn = $('#gw-winfsp-install');
  if (adminPill) {
    adminPill.textContent = `权限：${f.admin ? '管理员 ✓' : '非管理员'}`;
    adminPill.className = 'pill-mini ' + (f.admin ? 'live' : '');
  }
  if (fspPill) {
    fspPill.textContent = `WinFsp：${f.installed ? '已安装 ' + (f.version || '') : '未安装'}`;
    fspPill.className = 'pill-mini ' + (f.installed ? 'live' : '');
  }
  if (msiNote) {
    msiNote.textContent = f.installed
      ? '内核依赖就绪，可启动共享'
      : f.msi ? '已找到随包 MSI，可静默安装' : '未找到随包 MSI（轻量包 / 单文件 exe 需补齐 windows/bin/winfsp.msi）';
  }
  // 未安装才显示安装按钮：已装则隐藏；未提权时按钮仍可点（点了会提示提权做法）。
  if (installBtn) installBtn.hidden = Boolean(f.installed);
}

async function loadGatewayStatus() {
  const d = await api('/rclone/gateway');
  renderGateway(d);
}

function renderBreadcrumb(p) {
  const box = $('#storage-breadcrumb');
  if (!box) return;
  box.innerHTML = pathBarHtml(p || '/');
  bindPathBar(box, {
    onGo: (v) => { currentStoragePath = v; loadStorage(); },
    onUp: () => { currentStoragePath = pathParent(currentStoragePath); loadStorage(); },
  });
}

function renderFileList(d) {
  storageState.files = d.content || [];
  storageState.listData = d;
  storageState.selected.clear();
  // 列表重建后选择集已清空，表头的全选框不在 #file-list 内，需显式复位，否则显示「全选」但无选中项。
  const selectAll = $('#storage-select-all');
  if (selectAll) selectAll.checked = false;
  const sort = storageState.sort;
  const items = sortFileItems(storageState.files, sort);
  const dirCount = items.filter((f) => f.isDir).length;
  const fileCount = items.length - dirCount;
  $('#storage-provider').textContent = `${d.provider || 'OpenList'} · ${d.total || 0} 项 · 文件夹 ${dirCount} / 文件 ${fileCount}${d.write ? '' : ' · 只读'}`;
  const rows = [];
  let group = '';
  items.forEach((f) => {
    const next = f.isDir ? 'dir' : 'file';
    if (next !== group) {
      group = next;
      rows.push(`<tr class="file-group"><td colspan="6">${f.isDir
        ? `📁 文件夹 · ${dirCount} 项（目录恒排在最前）`
        : `📄 文件 · ${fileCount} 项`}</td></tr>`);
    }
    const full = olJoin(currentStoragePath, f.name);
    rows.push(`<tr class="file-row ${f.isDir ? 'is-dir' : 'is-file'}" data-ol-dir="${f.isDir ? esc(full) : ''}" ${f.isDir ? 'title="双击进入该目录"' : ''}>
      <td style="width:38px"><input type="checkbox" data-ol-file="${esc(f.name)}" /></td>
      <td><span class="file-name">${fileGlyph(f)} <b>${esc(f.name)}</b></span></td>
      <td style="width:110px">${f.isDir ? '-' : fmtSize(f.size)}</td>
      <td style="width:120px">${esc(fileTypeLabel(f))}</td>
      <td class="muted" style="width:170px">${esc(fmtTime(f.modified))}</td>
      <td class="actions"><div class="ext-actions icon-actions">
        ${storageState.readonlyMapped
          ? '<span class="muted small">只读映射</span>'
          : `${f.isDir
            ? ''
            : `<button class="icon-btn" data-ol-edit="${esc(full)}" data-ol-edit-name="${esc(f.name)}" title="编辑">${ACT_ICONS.edit}</button>
               <button class="icon-btn" data-ol-get="${esc(full)}" title="下载">${ACT_ICONS.download}</button>
               <button class="icon-btn" data-ol-link="${esc(full)}" title="直链">${ACT_ICONS.link}</button>`}
          <button class="icon-btn" data-ol-one-rename="${esc(full)}" title="重命名">${ACT_ICONS.rename}</button>
          <button class="icon-btn icon-btn-danger" data-ol-one-del="${esc(f.name)}" title="删除">${ACT_ICONS.del}</button>`}
      </div></td>
    </tr>`);
  });
  $('#file-list').innerHTML = `<table><thead><tr>
    <th style="width:38px"></th>
    ${sortHeader('名称', 'name', sort, 'data-ol-sort')}
    ${sortHeader('大小', 'size', sort, 'data-ol-sort')}
    ${sortHeader('类型', 'type', sort, 'data-ol-sort')}
    ${sortHeader('修改时间', 'mtime', sort, 'data-ol-sort')}
    <th style="width:150px">操作</th>
  </tr></thead><tbody>${rows.join('') || '<tr><td colspan="6" class="muted">目录为空</td></tr>'}</tbody></table>`;
  renderBreadcrumb(d.path || currentStoragePath);
  // 表头即排序控件：同列再点一次切换升 / 降序，目录始终优先分组。
  $('#file-list').querySelectorAll('[data-ol-sort]').forEach((th) => th.addEventListener('click', () => {
    toggleSort(sort, th.dataset.olSort);
    renderFileList(storageState.listData || d);
  }));
  $$('[data-ol-file]').forEach((box) => box.addEventListener('change', () => {
    if (box.checked) storageState.selected.add(box.dataset.olFile);
    else storageState.selected.delete(box.dataset.olFile);
    const all = $$('[data-ol-file]');
    $('#storage-select-all').checked = all.length > 0 && all.every((x) => x.checked);
  }));
  // v0.3.6 起目录统一双击进入（宝塔式），不额外占一列「进入」按钮。
  $$('[data-ol-dir]').forEach((row) => row.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, a')) return;
    const target = row.dataset.olDir;
    if (target) { currentStoragePath = target; loadStorage(); }
  }));
  $$('[data-ol-edit]').forEach((b) => b.addEventListener('click', () => openOlEditor(b.dataset.olEdit, b.dataset.olEditName)));
  $$('[data-ol-get]').forEach((b) => b.addEventListener('click', () => { window.open(olDownloadUrl(b.dataset.olGet), '_blank', 'noopener'); }));
  $$('[data-ol-link]').forEach((b) => b.addEventListener('click', () => olAction('link', [b.dataset.olLink])));
  $$('[data-ol-one-rename]').forEach((b) => b.addEventListener('click', () => olAction('rename', [b.dataset.olOneRename])));
  $$('[data-ol-one-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    olAction('remove', [b.dataset.olOneDel]);
  }));
}

/* ------------- v0.3.11 · OpenList 文件编辑（弹窗式 CodeMirror） ------------- */
const olEditorState = {
  path: '', name: '', cm: null, meta: null, bound: false,
  encoding: 'utf-8', newline: 'LF', bom: false, dirty: false,
};

function olEditorValue() {
  if (olEditorState.cm) {
    try { return olEditorState.cm.getValue(); } catch { /* noop */ }
  }
  const area = $('#ol-ed-area');
  return area ? String(area.value || '') : '';
}

function setOlEditorValue(text) {
  const area = $('#ol-ed-area');
  if (area) area.value = String(text || '');
  if (olEditorState.cm) {
    try { olEditorState.cm.setValue(String(text || '')); olEditorState.cm.refresh(); } catch { /* noop */ }
  }
}

function setOlDirty(dirty) {
  olEditorState.dirty = Boolean(dirty);
  const el = $('#ol-ed-state');
  if (el) { el.textContent = dirty ? '未保存' : '已保存'; el.className = `ed-state ${dirty ? 'dirty' : 'saved'}`; }
}

function updateOlEditorStatus() {
  const text = olEditorValue();
  let line = 1; let col = 1;
  if (olEditorState.cm) {
    try { const c = olEditorState.cm.getCursor(); line = c.line + 1; col = c.ch + 1; } catch { /* noop */ }
  }
  const pos = $('#ol-ed-pos');
  const meta = $('#ol-ed-meta');
  if (pos) pos.textContent = `行 ${line} · 列 ${col} / 共 ${text.split('\n').length} 行`;
  if (meta) meta.textContent = `${olEditorState.meta ? (olEditorState.meta.language || '文本') : '文本'} · ${olEditorState.encoding} · ${olEditorState.newline}${olEditorState.bom ? ' · BOM' : ''} · ${fmtSize(olEditorState.meta ? olEditorState.meta.size : 0)}`;
}

function ensureOlCodeMirror() {
  if (olEditorState.cm || typeof CodeMirror === 'undefined') return;
  const area = $('#ol-ed-area');
  if (!area) return;
  olEditorState.cm = CodeMirror.fromTextArea(area, {
    lineNumbers: true, mode: null, indentUnit: 2, tabSize: 2, indentWithTabs: false,
    lineWrapping: false, matchBrackets: true, autoCloseBrackets: true,
    styleActiveLine: true, foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S': () => saveOlEditor(), 'Cmd-S': () => saveOlEditor(),
      'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
    },
  });
  olEditorState.cm.on('change', () => { setOlDirty(true); updateOlEditorStatus(); });
  olEditorState.cm.on('cursorActivity', updateOlEditorStatus);
}

async function loadOlEditor(encoding = 'auto') {
  try {
    const d = await api(`/openlist/files/content?path=${encodeURIComponent(olEditorState.path)}&encoding=${encodeURIComponent(encoding)}`);
    olEditorState.meta = d;
    olEditorState.encoding = d.encoding || 'utf-8';
    olEditorState.newline = d.newline || 'LF';
    olEditorState.bom = Boolean(d.hasBom);
    fillSelect($('#ol-ed-lang'), d.languages, d.mode || '');
    fillSelect($('#ol-ed-encoding'), d.encodings, 'auto');
    fillSelect($('#ol-ed-newline'), d.newlines, olEditorState.newline);
    const bom = $('#ol-ed-bom');
    if (bom) bom.checked = olEditorState.bom;
    const editable = d.editable !== false && d.kind === 'text';
    setOlEditorValue(editable ? (d.content || '') : '');
    const area = $('#ol-ed-area');
    const cmEl = olEditorState.cm && typeof olEditorState.cm.getWrapperElement === 'function'
      ? olEditorState.cm.getWrapperElement() : document.querySelector('.ol-ed-body .CodeMirror');
    if (cmEl) cmEl.style.display = editable ? '' : 'none'; // 从二进制文件切回文本时恢复编辑器
    if (area && !olEditorState.cm) area.style.display = editable ? 'block' : 'none';
    // 安全评审 P1-2：不能用 innerHTML += 往 .ol-ed-body 追加提示——那会序列化并重建
    // 整个容器，摧毁在位的 CodeMirror 实例（cm 变量仍指向游离节点，编辑器看似冻结）。
    // 改用固定的 #ol-ed-preview 节点，仅切换文本与显隐。
    const preview = $('#ol-ed-preview');
    if (preview) {
      preview.textContent = d.warning || '该文件不能按文本编辑，请使用下载 / 上传。';
      preview.hidden = editable;
    }
    if (olEditorState.cm) {
      try { olEditorState.cm.setOption('mode', resolveMode(d.mode)); olEditorState.cm.refresh(); } catch { /* noop */ }
    }
    setOlDirty(false);
    updateOlEditorStatus();
  } catch (e) { toast(e.message, true); }
}

async function saveOlEditor() {
  if (!olEditorState.meta || olEditorState.meta.kind !== 'text' || olEditorState.meta.editable === false) {
    toast('该文件不能按文本编辑', true); return;
  }
  try {
    const d = await api('/openlist/files/content', {
      method: 'PUT',
      body: {
        path: olEditorState.path, content: olEditorValue(),
        encoding: olEditorState.encoding === 'auto' ? 'utf-8' : olEditorState.encoding,
        newline: olEditorState.newline, bom: olEditorState.bom,
      },
    });
    olEditorState.meta.size = d.size;
    setOlDirty(false);
    updateOlEditorStatus();
    toast(`已保存 ${olEditorState.name}（${d.encoding} / ${d.newline}）`);
    loadStorage();
  } catch (e) { toast(e.message, true); }
}

async function closeOlEditor(force = false) {
  if (!force && olEditorState.dirty && !await confirmDialog({ message: '文件有未保存的修改，确定关闭吗？' })) return;
  const modal = $('#ol-editor-modal');
  if (modal) modal.hidden = true;
  olEditorState.dirty = false;
}

function openOlEditor(path, name) {
  olEditorState.path = path;
  olEditorState.name = name || path.split('/').filter(Boolean).pop() || path;
  const title = $('#ol-editor-title');
  const sub = $('#ol-editor-path');
  if (title) title.textContent = `编辑 · ${olEditorState.name}`;
  if (sub) sub.textContent = path;
  // 上一次打开二进制文件时的提示先隐藏（固定节点，不移除，避免破坏 CodeMirror 容器）。
  const preview = $('#ol-ed-preview');
  if (preview) preview.hidden = true;
  const modal = $('#ol-editor-modal');
  if (modal) modal.hidden = false;
  ensureOlCodeMirror();
  if (olEditorState.cm) { try { olEditorState.cm.refresh(); } catch { /* noop */ } }
  if (!olEditorState.bound) {
    olEditorState.bound = true;
    document.addEventListener('click', async (e) => {
      if (e.target.closest && e.target.closest('[data-ol-ed-close]')) { closeOlEditor(); return; }
      const button = e.target.closest && e.target.closest('[data-ol-ed]');
      if (!button) return;
      if (button.dataset.olEd === 'save') saveOlEditor();
      else if (button.dataset.olEd === 'reload') {
        if (olEditorState.dirty && !await confirmDialog({ message: '重新载入会丢弃未保存的修改，继续？' })) return;
        loadOlEditor($('#ol-ed-encoding') ? $('#ol-ed-encoding').value : 'auto');
      } else if (button.dataset.olEd === 'find') {
        if (olEditorState.cm && typeof CodeMirror !== 'undefined') { olEditorState.cm.focus(); CodeMirror.commands.findPersistent(olEditorState.cm); }
        else toast('查找需要 CodeMirror 组件', true);
      }
    });
    const lang = $('#ol-ed-lang');
    if (lang) lang.addEventListener('change', () => {
      if (olEditorState.cm) olEditorState.cm.setOption('mode', resolveMode(lang.value));
      toast('语法高亮已切换');
    });
    const enc = $('#ol-ed-encoding');
    if (enc) enc.addEventListener('change', async () => {
      if (olEditorState.dirty && !await confirmDialog({ message: '切换编码会重新读取文件并丢弃未保存的修改，继续？' })) return;
      loadOlEditor(enc.value);
    });
    const nl = $('#ol-ed-newline');
    if (nl) nl.addEventListener('change', () => { olEditorState.newline = nl.value; updateOlEditorStatus(); });
    const bom = $('#ol-ed-bom');
    if (bom) bom.addEventListener('change', () => { olEditorState.bom = bom.checked; updateOlEditorStatus(); });
  }
  loadOlEditor('auto');
}

function renderMountList(items) {
  storageState.storages = items || [];
  $('#mount-list').innerHTML = items.length ? items.map((m) => `
    <div class="list-item">
      <div><div class="title">${esc(m.mountPath)} ${m.disabled ? badge('已停用', 'gray') : badge('启用', 'green')}${currentUser && currentUser.role === 'admin' && m.ownerName ? ` ${badge(`由 ${m.ownerName} 添加`, 'blue')}` : ''}</div>
        <div class="desc">${esc(m.driver)} · ${esc(m.status || '-')} · ${esc(m.remark || '')}</div></div>
      <div class="actions ext-actions">
        <button class="btn btn-sm" data-ol-storage-edit="${esc(m.id)}">编辑</button>
        <button class="btn btn-sm" data-ol-storage-toggle="${esc(m.id)}" data-disabled="${m.disabled ? '1' : '0'}">${m.disabled ? '启用' : '停用'}</button>
        <button class="btn btn-sm btn-danger" data-ol-storage-del="${esc(m.id)}">删除</button>
      </div>
    </div>`).join('') : '<div class="empty">暂无挂载，点「新增存储」或到 OpenList 后台添加驱动</div>';
  $$('[data-ol-storage-edit]').forEach((b) => b.addEventListener('click', () => {
    const item = storageState.storages.find((x) => String(x.id) === b.dataset.olStorageEdit);
    if (!item) return;
    const form = $('#storage-add-form');
    form.hidden = false;
    form.elements.mountPath.value = item.mountPath;
    form.elements.driver.value = item.driver;
    form.elements.addition.value = item.addition || '{}';
    form.elements.remark.value = item.remark || '';
    $('#ol-storage-id').value = item.id;
    storageState.editId = item.id;
  }));
  $$('[data-ol-storage-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/openlist/storages/${encodeURIComponent(b.dataset.olStorageToggle)}/toggle`, {
        method: 'POST', body: { enabled: b.dataset.disabled === '1' },
      });
      toast('状态已更新'); loadStorage();
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-ol-storage-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDialog({ message: '确认删除该挂载存储？不会删除底层文件，但会移除挂载点。' })) return;
    try {
      await api(`/openlist/storages/${encodeURIComponent(b.dataset.olStorageDel)}`, { method: 'DELETE' });
      toast('已删除'); loadStorage();
    } catch (e) { toast(e.message, true); }
  }));
}

function renderDriverList(data) {
  // v0.4.4：区分「OpenList 上游不可用 / 凭据权限不足」与「上游返回空清单」，
  // 不再把空列表笼统归因为「需要管理员权限 Token」（平台账号权限与此无关）。
  const items = (data && data.items) || [];
  storageState.drivers = items;
  const select = $('#ol-driver');
  if (select) {
    const current = select.value;
    select.innerHTML = items.length
      ? items.map((d) => `<option value="${esc(d.driver)}">${esc(d.name || d.driver)}</option>`).join('')
      : '<option value="">（未读取到驱动清单，可手填）</option>';
    if (current && items.some((d) => d.driver === current)) select.value = current;
  }
  const empty = data && data.degraded
    ? `<div class="empty">驱动清单读取失败（OpenList 上游连接 / 凭据异常，<b>与当前登录的平台账号是否为管理员无关</b>）
        <div class="desc">${esc(data.hint || data.error || '请检查 OpenList 服务与连接配置')}</div>
        <div style="margin-top:8px"><button class="btn btn-sm" data-open-view="storage-conn">前往「连接管理」检查凭据</button></div>
      </div>`
    : `<div class="empty">未读取到驱动清单
        <div class="desc">${esc((data && (data.diagnostic || data.error)) || '上游未返回任何驱动条目')}</div>
        <div class="desc">这与平台登录账号的权限无关；若该 OpenList 要求管理员 Token，请在「连接管理」里更新凭据后刷新。</div>
      </div>`;
  $('#storage-driver-list').innerHTML = items.length ? items.slice(0, 120).map((d) => `
    <div class="list-item"><div><div class="title">${esc(d.name || d.driver)}</div>
      <div class="desc">${esc(d.driver)}${d.description ? ` · ${esc(d.description)}` : ''}</div></div>
      <div class="row gap">
        <button class="btn btn-sm btn-primary" data-ol-driver="${esc(d.driver)}" title="带入新增挂载表单并跳转">选用</button>
        <button class="btn btn-sm" data-ol-driver-template="${esc(d.driver)}" title="查看 / 复制该驱动的 addition 配置模板">模板</button>
      </div>
    </div>`).join('') : empty;
  $$('[data-ol-driver]').forEach((b) => b.addEventListener('click', async () => {
    const d = storageState.drivers.find((x) => x.driver === b.dataset.olDriver);
    const form = $('#storage-add-form');
    form.hidden = false;
    form.elements.driver.value = b.dataset.olDriver;
    $('#ol-storage-id').value = '';
    storageState.editId = '';
    if (d && d.config) {
      form.elements.addition.value = typeof d.config === 'string' ? d.config : JSON.stringify(d.config, null, 2);
    }
    try {
      const info = await api(`/openlist/drivers/info?driver=${encodeURIComponent(b.dataset.olDriver)}`);
      const addition = info && (info.addition || info.config || info.common);
      if (addition) form.elements.addition.value = JSON.stringify(addition, null, 2);
    } catch { /* 驱动详情接口可能不存在，保留清单里的模板 */ }
    // v0.4.7：选用后自动切到「挂载存储」页，让用户直接看到已带入的表单。
    switchView('storage-mounts');
    toast(`已选用驱动 ${b.dataset.olDriver}，配置模板已带入下方表单`);
  }));
  // v0.4.7：「模板」按钮 —— 拉取该驱动的 addition 配置模板，可复制后粘贴到任意挂载表单。
  $$('[data-ol-driver-template]').forEach((b) => b.addEventListener('click', async () => {
    const drv = b.dataset.olDriverTemplate;
    const d = storageState.drivers.find((x) => x.driver === drv);
    let tpl = d && d.config ? (typeof d.config === 'string' ? d.config : JSON.stringify(d.config, null, 2)) : '';
    try {
      const info = await api(`/openlist/drivers/info?driver=${encodeURIComponent(drv)}`);
      const addition = info && (info.addition || info.config || info.common);
      if (addition) tpl = JSON.stringify(addition, null, 2);
    } catch { /* 保留清单模板 */ }
    if (!tpl) { toast(`驱动 ${drv} 未返回配置模板`, true); return; }
    showDriverTemplate(drv, tpl);
  }));
}

// v0.4.7：驱动配置模板预览弹窗 —— 可复制 JSON 后粘贴到挂载表单或外部工具。
function showDriverTemplate(driver, tpl) {
  const old = document.getElementById('driver-template-modal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'driver-template-modal';
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('role', 'dialog');
  modal.innerHTML = `
    <div class="modal-mask" data-close></div>
    <div class="modal-panel modal-narrow">
      <div class="modal-head">
        <div><h2>${esc(driver)} 配置模板</h2><span class="muted">addition 字段模板，可复制后粘贴到新增挂载的「驱动配置 addition」</span></div>
        <button class="btn btn-ghost btn-sm" type="button" data-close>✕ 关闭</button>
      </div>
      <div class="modal-body">
        <pre class="log" style="max-height:50vh;overflow:auto;margin:0">${esc(tpl)}</pre>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary btn-sm" type="button" data-copy>复制 JSON</button>
          <button class="btn btn-ghost btn-sm" type="button" data-jump>带到「挂载存储」新增</button>
          <span class="flex-spacer"></span>
          <button class="btn btn-sm" type="button" data-close>关闭</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.hidden = false;
  const close = () => modal.remove();
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  modal.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tpl); toast('已复制配置模板到剪贴板'); }
    catch { toast('复制失败，请手动选择文本复制', true); }
  });
  modal.querySelector('[data-jump]').addEventListener('click', () => {
    const form = $('#storage-add-form');
    if (form) {
      form.hidden = false;
      form.elements.driver.value = driver;
      form.elements.addition.value = tpl;
      $('#ol-storage-id').value = '';
      storageState.editId = '';
    }
    close();
    switchView('storage-mounts');
    toast(`已带入 ${driver} 模板到新增挂载表单`);
  });
}

let storageHomeInit = false;
async function loadStorage() {
  // C 批：普通账号首次进入存储页默认落在自己的家目录 /workspace/users/<username>；
  // 管理员保持根目录，便于总览全部挂载。只初始化一次，之后尊重用户的路径选择。
  if (!storageHomeInit && currentUser && currentUser.role !== 'admin' && currentUser.username) {
    currentStoragePath = `/workspace/users/${currentUser.username}`;
    storageHomeInit = true;
  } else if (!storageHomeInit) storageHomeInit = true;
  $('#storage-path').value = currentStoragePath;
  // 请求序号：本页读取的是 currentStoragePath 的快照；若期间用户切了目录（发起新请求），
  // 旧响应晚到时序号已失效，直接丢弃，绝不渲染旧列表，防止选择集/路径错配导致删除误伤。
  const seq = ++storageLoadSeq;
  const pathSnapshot = currentStoragePath;
  const settled = (p) => Promise.resolve(p).catch((e) => ({ error: e.message }));
  // v0.4.28：映射模式按连接 id 只读浏览根目录（不切 active）；普通模式沿用 /openlist/files。
  const mapped = Boolean(storageState.rootMapConnId);
  const filesUrl = mapped
    ? `/openlist/connections/${encodeURIComponent(storageState.rootMapConnId)}/root?path=${encodeURIComponent(pathSnapshot)}`
    : `/openlist/files?path=${encodeURIComponent(pathSnapshot)}`;
  const [status, files, mounts, drivers, connections] = await Promise.all([
    settled(api('/openlist/status')),
    settled(api(filesUrl)),
    settled(api('/openlist/storages')),
    settled(api('/openlist/drivers')),
    settled(api('/openlist/connections')),
  ]);
  if (seq !== storageLoadSeq) return; // 已有更新的请求，丢弃本次晚到响应
  renderOpenlistStatus(status);
  renderOpenlistConnections(connections);
  renderRootConnPicker(connections);
  renderDriveMountConnPicker(connections);
  applyRootMapMode(mapped);
  renderStorageDegraded([files, mounts, drivers]);
  if (files && !files.error) renderFileList(files);
  else $('#file-list').innerHTML = errorBlock(files.error || '无法读取目录',
    '请到「连接管理」切换到一个可用的 OpenList，或修复当前连接的管理员凭据');
  renderMountList(mounts && mounts.items || []);
  renderDriverList(drivers || {});
  loadDriveMountStatus(); // v0.4.28：探测 Windows 网络盘映射能力（轻量、非阻塞）
}

/** v0.4.28：填充「连接根目录映射」选择器（文件浏览页 + 网络盘页共用连接清单）。 */
function connOptionsHtml(connections, withActive) {
  const items = (connections && connections.items) || [];
  const activeId = (connections && connections.activeId) || '';
  const head = withActive ? `<option value="">当前激活连接</option>` : '';
  return head + items.map((c) => {
    const label = `${c.label || c.url}${c.active ? '（当前）' : ''}`;
    return `<option value="${esc(c.id)}">${esc(label)}</option>`;
  }).join('');
}

function renderRootConnPicker(connections) {
  const sel = $('#ol-root-conn-picker');
  if (!sel) return;
  const prev = storageState.rootMapConnId;
  sel.innerHTML = connOptionsHtml(connections, true);
  sel.value = prev;
  // 若上次选的连接已被删除，回退到当前激活连接。
  if (prev && !Array.from(sel.options).some((o) => o.value === prev)) {
    storageState.rootMapConnId = '';
    sel.value = '';
  }
}

function renderDriveMountConnPicker(connections) {
  const sel = $('#dm-conn');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = connOptionsHtml(connections, true);
  if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
}

/** 映射模式：隐藏写操作工具条，文件行禁用编辑/删除，标注只读。 */
function applyRootMapMode(mapped) {
  const bar = document.querySelector('.file-toolbar');
  if (bar) bar.hidden = mapped;
  const note = $('#ol-root-map-note');
  if (note) note.textContent = mapped
    ? '正在只读浏览所选连接的根目录；重命名 / 移动 / 删除 / 上传请在「连接管理」设为当前后使用。'
    : '可任选一条已登记连接直接浏览其根目录；非当前连接为只读映射，写操作请在「连接管理」设为当前后进行。';
  storageState.readonlyMapped = mapped;
}

/** 集成服务不可用时列表接口会返回 degraded 空数据：给一条可操作的黄色提示，而不是满屏 500。 */
function renderStorageDegraded(parts) {
  const box = $('#storage-degraded');
  if (!box) return;
  const bad = parts.filter((x) => x && x.degraded);
  if (!bad.length) { box.hidden = true; box.textContent = '—'; return; }
  const first = bad[0];
  box.hidden = false;
  box.innerHTML = `<b>⚠ ${bad.length} 项数据暂不可用（列表已安全置空，不影响其它功能）</b>`
    + `<div>${esc(first.error || '')}</div>`
    + `<div>处理建议：${esc(first.hint || '检查集成服务状态')}</div>`
    + `<div style="margin-top:6px"><button class="btn btn-sm" data-open-view="storage-conn">前往「连接管理」修复</button></div>`;
}

function olSelected() { return Array.from(storageState.selected); }
function olFull(name) { return olJoin(currentStoragePath, name); }

async function olAction(action, forced = null) {
  const names = forced || olSelected();
  if (!names.length) { toast('请先勾选文件，或使用行内操作按钮', true); return; }
  try {
    if (action === 'rename') {
      const p = forced ? forced[0] : olFull(names[0]);
      const next = await promptDialog('新的名称（不含路径）', p.split('/').pop() || '');
      if (!next) return;
      await api('/openlist/files/rename', { method: 'POST', body: { path: p, name: next } });
      toast('已重命名');
    } else if (action === 'move' || action === 'copy') {
      const dst = await promptDialog(`把 ${names.length} 项${action === 'move' ? '移动' : '复制'}到哪个目录？`, '/');
      if (!dst) return;
      await api(`/openlist/files/${action}`, {
        method: 'POST', body: { srcDir: currentStoragePath, dstDir: dst, names },
      });
      toast(action === 'move' ? '移动任务已提交' : '复制任务已提交');
    } else if (action === 'remove') {
      if (!await confirmDialog({ message: `确认从 OpenList 删除 ${names.length} 项？此操作不可撤销。` })) return;
      await api('/openlist/files/remove', { method: 'POST', body: { path: currentStoragePath, names } });
      toast('删除请求已提交');
    } else if (action === 'link') {
      const p = forced ? forced[0] : olFull(names[0]);
      const d = await api(`/openlist/files/link?path=${encodeURIComponent(p)}`);
      olResult(`直链：${d.rawUrl || '（该存储未返回直链）'}\n文件：${d.name} · ${fmtSize(d.size)} · 代理：${d.proxy || '无'}`);
      if (d.rawUrl && navigator.clipboard) {
        try { await navigator.clipboard.writeText(d.rawUrl); toast('直链已复制到剪贴板'); } catch { /* noop */ }
      }
      return;
    } else if (action === 'download') {
      const p = forced ? forced[0] : olFull(names[0]);
      window.open(olDownloadUrl(p), '_blank', 'noopener');
      return;
    }
    loadStorage();
  } catch (e) { toast(e.message, true); olResult(`操作失败：${e.message}`); }
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    try {
      const token = localStorage.getItem('dp_token');
      const response = await fetch(`/api/openlist/files/upload?path=${encodeURIComponent(currentStoragePath)}&name=${encodeURIComponent(file.name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...authHeaders() },
        body: await file.arrayBuffer(),
      });
      if (!response.ok) throw new Error(`服务端返回 HTTP ${response.status}（网关可能未转发到平台）`);
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || '上传失败');
      toast(`已上传 ${file.name}`);
    } catch (e) { toast(`${file.name} 上传失败：${e.message}`, true); }
  }
  $('#upload-input').value = '';
  loadStorage();
}

/* ------------------------------ 分层代理配置 ------------------------------ */

const PROXY_SCOPES = ['git', 'docker', 'server', 'ai'];
const PROXY_LABELS = { git: 'Git 仓库', docker: 'Docker / 容器', server: '服务器 / SSH', ai: 'AI 服务' };

function renderProxyGlobal(cfg) {
  $('#proxy-global-url').value = cfg.global.direct ? 'direct' : (cfg.global.url || '');
  $('#proxy-global-no').value = cfg.global.noProxy || '';
  $('#proxy-global-enabled').checked = cfg.global.enabled !== false;
  $('#proxy-capability').textContent = cfg.capabilities.httpProxy
    ? 'HTTP / SSH / SOCKS 隧道均可用'
    : '缺少 undici：SSH 隧道可用，HTTP 代理需 npm install';
}

function renderProxyGroups(cfg) {
  $('#proxy-groups').innerHTML = PROXY_SCOPES.map((scope) => `
    <div class="row gap wrap" style="margin-bottom:8px">
      <span class="muted" style="min-width:130px">${esc(PROXY_LABELS[scope])}</span>
      <input data-proxy-group-input="${scope}" placeholder="填一个地址：如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；direct 直连；留空继承全局"
        value="${esc(cfg.groups[scope].direct ? 'direct' : (cfg.groups[scope].url || ''))}" style="flex:1;min-width:220px" />
      <button class="btn btn-sm btn-primary" data-proxy-group-save="${scope}">保存</button>
      <button class="btn btn-ghost btn-sm" data-proxy-group-clear="${scope}">清空</button>
      <span class="muted small">${cfg.groups[scope].enabled ? '启用' : '停用'}</span>
    </div>`).join('');
  $$('[data-proxy-group-save]').forEach((b) => b.addEventListener('click', async () => {
    const scope = b.dataset.proxyGroupSave;
    const value = $(`[data-proxy-group-input="${scope}"]`).value.trim();
    try {
      await api(`/proxy/groups/${scope}`, { method: 'PUT', body: { url: value } });
      toast(`${PROXY_LABELS[scope]}代理已保存`); loadProxy();
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-proxy-group-clear]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/proxy/groups/${b.dataset.proxyGroupClear}`, { method: 'PUT', body: { url: '' } });
      toast('已清空，恢复继承全局'); loadProxy();
    } catch (e) { toast(e.message, true); }
  }));
}

function renderProxyRules(cfg) {
  const items = cfg.rules || [];
  $('#proxy-rules').innerHTML = table(['Host 匹配规则', '代理', '备注', '状态', '操作'], items.map((r) => `
    <tr>
      <td><b>${esc(r.pattern)}</b></td>
      <td>${esc(r.url || '继承')}</td>
      <td class="muted">${esc(r.note || '-')}</td>
      <td>${r.enabled === false ? badge('停用', 'gray') : badge('启用', 'green')}</td>
      <td class="actions"><div class="ext-actions">
        <button class="btn btn-sm" data-proxy-rule-toggle="${esc(r.id)}" data-enabled="${r.enabled === false ? '0' : '1'}">${r.enabled === false ? '启用' : '停用'}</button>
        <button class="btn btn-sm btn-danger" data-proxy-rule-del="${esc(r.id)}">删除</button>
      </div></td>
    </tr>`));
  $$('[data-proxy-rule-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/proxy/rules/${encodeURIComponent(b.dataset.proxyRuleToggle)}`, {
        method: 'PUT', body: { enabled: b.dataset.enabled === '0' },
      });
      loadProxy();
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-proxy-rule-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/proxy/rules/${encodeURIComponent(b.dataset.proxyRuleDel)}`, { method: 'DELETE' }); toast('规则已删除'); loadProxy(); }
    catch (e) { toast(e.message, true); }
  }));
}

function renderProxyOverrides(cfg) {
  const rows = [];
  for (const scope of PROXY_SCOPES) {
    for (const item of cfg.overrides[scope] || []) rows.push({ scope, ...item });
  }
  $('#proxy-overrides').innerHTML = table(['作用域', '对象标识', '代理', '操作'], rows.map((r) => `
    <tr>
      <td>${esc(PROXY_LABELS[r.scope] || r.scope)}</td>
      <td><b>${esc(r.id)}</b></td>
      <td>${esc(r.direct ? '直接连接' : r.url)}</td>
      <td><button class="btn btn-sm btn-danger" data-proxy-override-del="${esc(`${r.scope}|${r.id}`)}">删除覆盖</button></td>

    </tr>`));
  $$('[data-proxy-override-del]').forEach((b) => b.addEventListener('click', async () => {
    const at = b.dataset.proxyOverrideDel.indexOf('|');
    const scope = b.dataset.proxyOverrideDel.slice(0, at);
    const id = b.dataset.proxyOverrideDel.slice(at + 1);
    try {
      await api(`/proxy/overrides/${encodeURIComponent(scope)}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('覆盖已删除'); loadProxy();
    } catch (e) { toast(e.message, true); }
  }));
}

function renderProxyPriority(cfg) {
  $('#proxy-priority').innerHTML = (cfg.priority || []).map((p) => `
    <div class="arch-row"><b>${esc(PROXY_LABELS[p.scope] || p.scope)}</b>
      <span>${p.chain.map((c, i) => `${i + 1}. ${esc(c)}`).join('　›　')}</span></div>`).join('');
}

// v0.4.4：代理页不再维护「对象下拉」，单项覆盖统一在对象自己的弹窗 / 表单里配置。
function renderProxyEntities() { /* 保留调用点，避免历史代码引用报错 */ }

/** 由对象行「代理」按钮打开：只影响该对象，不再跳转到代理页预填。 */
const objProxyTarget = { scope: '', id: '' };
async function openObjectProxy(scope, id) {
  const targetId = String(id || '');
  if (!targetId) { toast('对象标识为空，无法设置代理', true); return; }
  objProxyTarget.scope = scope;
  objProxyTarget.id = targetId;
  const label = $('#objproxy-label');
  if (label) label.textContent = `${PROXY_LABELS[scope] || scope} · ${targetId}`;
  const form = $('#objproxy-form');
  if (form) form.reset();
  const modal = $('#object-proxy-modal');
  if (modal) modal.hidden = false;
  try {
    const cfg = await api('/proxy');
    const found = ((cfg.overrides || {})[scope] || []).find((o) => o.id === targetId);
    if (found && form) form.elements.note.value = found.note || '';
  } catch { /* 清单读取失败不阻止编辑 */ }
}

function gotoProxyOverride(scope, id) { openObjectProxy(scope, id); }

async function loadProxy() {
  try {
    const [cfg, entities] = await Promise.all([
      api('/proxy'),
      api('/proxy/entities').catch(() => ({ items: {} })),
    ]);
    proxyState.config = cfg;
    proxyState.entities = entities.items || {};
    renderProxyGlobal(cfg);
    renderProxyGroups(cfg);
    renderProxyRules(cfg);
    renderProxyOverrides(cfg);
    renderProxyPriority(cfg);
    renderProxyEntities();
  } catch (e) {
    toast(e.message, true);
    $('#proxy-capability').textContent = `读取失败：${e.message}`;
  }
}

/* ------------------------------- 构建 / 部署 ------------------------------ */

async function loadBuilds() {
  try {
    const [profiles, builds, deploys, servers, backends] = await Promise.all([
      api('/profiles'), api('/builds'), api('/deploys'), api('/servers'), api('/builds/backends'),
    ]);
    $('#executor-label').textContent = `构建后端：${profiles.executor === 'auto' ? '自动降级' : profiles.executor}`;
    const backendItems = backends.items || [];
    if ($('#build-backend')) {
      const prevBackend = $('#build-backend').value;
      $('#build-backend').innerHTML = `<option value="auto">自动选择（推荐，当前配置 ${esc(backends.current)}）</option>`
        + backendItems.map((b) => `<option value="${esc(b.id)}"${b.available ? '' : ' disabled'}>${esc(b.label)}${b.available ? ' · 可用' : ' · 不可用'}</option>`).join('');
      // 刷新构建列表不应重置用户已选的编译环境；仅当选项仍存在（且未禁用）时恢复。
      for (const o of $('#build-backend').options) {
        if (o.value === prevBackend && !o.disabled) { $('#build-backend').value = prevBackend; break; }
      }
    }
    if ($('#build-backends')) {
      $('#build-backends').textContent = backendItems.map((b) => `${b.available ? '●' : '○'} ${b.label}：${b.detail}`).join('　|　')
        + '　· 编译环境不引入 microVM';
    }
    if (!$('#profile-select').options.length) {
      $('#profile-select').innerHTML = '<option value="auto">自动识别</option>'
        + profiles.items.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    }
    const prevServer = $('#deploy-server').value;
    $('#deploy-server').innerHTML = '<option value="">选择服务器</option>'
      + servers.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.host)})</option>`).join('');
    for (const o of $('#deploy-server').options) {
      if (o.value === prevServer) { $('#deploy-server').value = prevServer; break; }
    }

    $('#build-list').innerHTML = (builds.items || []).length ? builds.items.map((b) => `
      <div class="list-item">
        <label class="check" title="选中后可批量删除"><input type="checkbox" data-build-check="${esc(b.id)}" /></label>
        <div><div class="title">${esc(b.repoPath || '.')} · ${esc(b.profileLabel || b.profile)}</div>
          <div class="desc">${esc(fmtTime(b.startedAt))} · ${esc(b.durationMs ? Math.round(b.durationMs / 1000) + 's' : '进行中')} · ${esc(b.id)}</div></div>
        <div class="row">
          ${badge(b.status === 'success' ? '成功' : b.status === 'failed' ? '失败' : b.status === 'running' ? '构建中' : b.status,
            b.status === 'success' ? 'green' : b.status === 'failed' ? 'red' : b.status === 'running' ? 'blue' : 'gray')}
          <button class="btn btn-sm" data-log="${esc(b.id)}">日志</button>
          <button class="btn btn-sm btn-danger" data-build-del="${esc(b.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="empty">还没有构建任务，先在上方启动一次</div>';
    $$('[data-log]').forEach((b) => b.addEventListener('click', () => watchLog(b.dataset.log)));
    $$('[data-build-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ message: '确认删除这条构建记录？（仅删除记录与日志，不影响已部署的产物）' })) return;
      try {
        const id = b.dataset.buildDel;
        await api(`/builds/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('构建记录已删除');
        if (typeof logTimer !== 'undefined' && logTimer) { clearInterval(logTimer); logTimer = null; }
        if (typeof selectedBuildId !== 'undefined' && selectedBuildId === id) {
          selectedBuildId = '';
          const logBox = $('#build-log'); if (logBox) logBox.textContent = '—';
          const target = $('#log-target'); if (target) target.textContent = '选择一条构建记录';
        }
        loadBuilds();
      } catch (e) { toast(e.message, true); }
    }));
    $$('[data-build-check]').forEach((box) => box.addEventListener('change', updateBuildSelection));
    updateBuildSelection();

    $('#deploy-list').innerHTML = table(['时间', '服务器', '目标目录', '状态', '结果'], (deploys.items || []).map((d) => `
      <tr><td class="muted">${esc(fmtTime(d.createdAt))}</td><td>${esc(d.serverName || d.serverId)}</td>
      <td>${esc(d.targetDir)}</td><td>${badge(d.status === 'success' ? '成功' : '失败', d.status === 'success' ? 'green' : 'red')}</td>
      <td class="muted">${esc(d.message)}</td></tr>`));
  } catch (e) { toast(e.message, true); }
}

/* ---------- v0.4.4 构建记录批量删除 ---------- */
function updateBuildSelection() {
  const boxes = $$('[data-build-check]');
  const checked = boxes.filter((b) => b.checked);
  const btn = $('#build-del-selected');
  if (btn) btn.disabled = !checked.length;
  const all = $('#build-select-all');
  if (all) all.checked = boxes.length > 0 && checked.length === boxes.length;
}
$('#build-select-all').addEventListener('change', (e) => {
  $$('[data-build-check]').forEach((b) => { b.checked = e.target.checked; });
  updateBuildSelection();
});
$('#build-del-selected').addEventListener('click', async () => {
  const ids = $$('[data-build-check]:checked').map((b) => b.dataset.buildCheck);
  if (!ids.length) return;
  if (!await confirmDialog({ message: `确认删除选中的 ${ids.length} 条构建记录？（仅删除记录与日志，不影响已部署的产物）` })) return;
  try {
    await api('/builds', { method: 'DELETE', body: { ids } });
    if (typeof selectedBuildId !== 'undefined' && ids.includes(selectedBuildId)) {
      if (typeof logTimer !== 'undefined' && logTimer) { clearInterval(logTimer); logTimer = null; }
      selectedBuildId = '';
      const logBox = $('#build-log'); if (logBox) logBox.textContent = '—';
      const target = $('#log-target'); if (target) target.textContent = '选择一条构建记录';
    }
    toast(`已删除 ${ids.length} 条构建记录`);
    loadBuilds();
  } catch (e) { toast(e.message, true); }
});

async function watchLog(id) {
  selectedBuildId = id;
  $('#log-target').textContent = `构建 ${id}`;
  if (logTimer) { clearInterval(logTimer); logTimer = null; }
  const tick = async () => {
    try {
      const d = await api(`/builds/${id}/log`);
      $('#build-log').textContent = d.logs || '（暂无日志）';
      if (d.status !== 'running') { clearInterval(logTimer); logTimer = null; loadBuilds(); }
    } catch (e) { clearInterval(logTimer); logTimer = null; toast(e.message, true); }
  };
  await tick();
  if (!logTimer && $('#build-log').textContent.includes('[platform] 构建开始')) {
    logTimer = setInterval(tick, 1500);
  }
}

/* -------------------------------- 服务器 --------------------------------- */

/* ------------- v0.3.11 · 服务器登记信息可编辑 ------------- */
/** 列表接口只回凭据「有没有」，不回明文；编辑表单用 ****** 占位，提交时后端沿用原值。 */
function fillServerEditForm(server) {
  const form = $('#server-form');
  if (!form) return;
  form.reset();
  const f = form.elements;
  $('#server-edit-id').value = server.id || '';
  f.name.value = server.name || '';
  f.host.value = server.host || '';
  f.port.value = server.port || 22;
  f.username.value = server.username || 'root';
  f.password.value = server.hasPassword ? '******' : '';
  f.passphrase.value = server.hasPassphrase ? '******' : '';
  f.privateKey.value = server.hasPrivateKey && !server.privateKeyPath ? '******' : '';
  f.privateKeyPath.value = server.privateKeyPath || '';
  f.deployDir.value = server.deployDir || '/data/platform';
  f.proxy.value = server.proxy || '';
  renderCollabInline('servers', server.id);
  $('#server-form-title').textContent = `编辑服务器 · ${server.name || ''}`;
  $('#server-edit-tip').hidden = false;
}

function resetServerEditForm() {
  const form = $('#server-form');
  if (form) form.reset();
  const id = $('#server-edit-id');
  if (id) id.value = '';
  const title = $('#server-form-title');
  if (title) title.textContent = '添加服务器';
  const tip = $('#server-edit-tip');
  if (tip) tip.hidden = true;
  renderCollabInline('servers', '');
}

async function loadServers() {
  try {
    const d = await api('/servers');
    const cards = d.items || [];
    serverCache = cards;
    $('#server-list').innerHTML = cards.length ? cards.map((s) => `
      <div class="card server-card" data-server="${esc(s.id)}">
        <div class="card-head"><h2>${esc(s.name)}</h2>
          <span class="muted">${esc(s.username || '-')}@${esc(s.host)}:${esc(s.port || 22)}</span></div>
        <div class="chip-row" style="margin-bottom:4px">
          ${s.hasPassword ? badge('密码登录', 'blue') : ''}
          ${s.hasPrivateKey ? badge('私钥', 'blue') : ''}
          ${s.hasPassphrase ? badge('私钥口令', 'green') : ''}
          ${s.deployDir ? badge(`部署目录 ${s.deployDir}`, 'blue') : ''}
          ${s.privateKeyPath ? `<span class="chip" style="cursor:default">${esc(s.privateKeyPath)}</span>` : ''}
        </div>
        <div class="metrics" id="metrics-${esc(s.id)}">
          <div class="metric"><div class="k">负载 (1m)</div><div class="v">—</div></div>
          <div class="metric"><div class="k">内存</div><div class="v">—</div></div>
          <div class="metric"><div class="k">磁盘</div><div class="v">—</div></div>
        </div>
        <div class="actions">
          <button class="btn btn-sm btn-primary" data-terminal="${esc(s.id)}">Web 终端</button>
          <button class="btn btn-sm" data-files="${esc(s.id)}">文件管理</button>
          <button class="btn btn-sm" data-edit-server="${esc(s.id)}">编辑</button>
          <button class="btn btn-sm" data-status="${esc(s.id)}">检查状态</button>
          <button class="btn btn-sm" data-test="${esc(s.id)}">测试连接</button>
          <button class="btn btn-sm" data-server-proxy="${esc(s.id)}">代理</button>
          <button class="btn btn-sm" data-collab-open="servers|${esc(s.id)}">协作者</button>
          <button class="btn btn-sm btn-danger" data-remove="${esc(s.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="card"><div class="empty">还没有服务器，先用上方表单添加</div></div>';

    $$('[data-terminal]').forEach((b) => b.addEventListener('click', () => {
      const server = cards.find((s) => s.id === b.dataset.terminal);
      if (server) openTerminalTab(server);
    }));
    $$('[data-files]').forEach((b) => b.addEventListener('click', () => {
      const server = cards.find((s) => s.id === b.dataset.files);
      if (server) openFilesTab(server);
    }));
    $$('[data-edit-server]').forEach((b) => b.addEventListener('click', () => {
      const server = cards.find((s) => s.id === b.dataset.editServer);
      if (server) { fillServerEditForm(server); switchView('server-new'); }
    }));
    $$('[data-status]').forEach((b) => b.addEventListener('click', () => checkStatus(b.dataset.status)));
    $$('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api(`/servers/${b.dataset.test}/test`, { method: 'POST', body: {} }); toast(r.online ? `连接正常：${r.output}` : `连接失败：${r.error}`, !r.online); }
      catch (e) { toast(e.message, true); }
    }));
    $$('[data-server-proxy]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('server', b.dataset.serverProxy)));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ message: '确认删除这台服务器？' })) return;
      try { await api(`/servers/${b.dataset.remove}`, { method: 'DELETE' }); toast('已删除'); loadServers(); }
      catch (e) { toast(e.message, true); }
    }));
    // 列表重建后立刻补一次状态，避免用户看到一屏「—」。
    serverPollTick();
  } catch (e) { $('#server-list').innerHTML = `<div class="card">${errorBlock(e.message)}</div>`; }
}

async function checkStatus(id, silent = false) {
  const box = $(`#metrics-${CSS.escape(id)}`);
  if (box && !silent) box.innerHTML = '<div class="muted">读取中…</div>';
  try {
    const s = await api(`/servers/${id}/status`);
    if (!box) return;
    box.innerHTML = `
      <div class="metric"><div class="k">负载 (1m)</div><div class="v">${esc(s.load1)}</div><div class="bar"><i style="width:${Math.min(100, s.load1 * 20)}%"></i></div></div>
      <div class="metric"><div class="k">内存</div><div class="v">${esc(s.memory.usagePct)}%</div><div class="bar"><i style="width:${Math.min(100, s.memory.usagePct)}%"></i></div></div>
      <div class="metric"><div class="k">磁盘</div><div class="v">${esc(s.disk.usagePct)}</div><div class="desc muted">${esc(s.cpuCores)} 核 · ${esc(s.containers.length)} 容器</div></div>`;
  } catch (e) {
    if (box) box.innerHTML = `<div class="muted" style="grid-column:1/-1;color:var(--red)">${esc(e.message)}</div>`;
    if (!silent) toast(e.message, true);
  }
}

/* v0.3.6：状态定时刷新。只在服务器页激活、标签页可见、上一轮已结束时才请求，
   失败不弹 toast（避免每 15 秒刷屏），间隔可在本页选择并记住。 */
const SERVER_POLL_KEY = 'dp_server_poll_ms';
function serverPollMs() {
  const raw = Number(localStorage.getItem(SERVER_POLL_KEY));
  return Number.isFinite(raw) && raw >= 0 ? raw : 15000;
}
async function serverPollTick() {
  if (document.hidden || serverPollBusy) return;
  if (!['servers', 'server-new'].includes(currentView)) return;
  const cards = serverCache.slice();
  if (!cards.length) return;
  serverPollBusy = true;
  try { await Promise.allSettled(cards.map((s) => checkStatus(s.id, true))); }
  finally { serverPollBusy = false; }
  const at = $('#server-poll-at');
  if (at) at.textContent = `最近 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}
function restartServerPolling() {
  if (serverPollTimer) { clearInterval(serverPollTimer); serverPollTimer = null; }
  const ms = serverPollMs();
  const sel = $('#server-poll-interval');
  if (sel) sel.value = String(ms);
  if (ms > 0) {
    serverPollTimer = setInterval(serverPollTick, ms);
    serverPollTick();
  } else {
    const at = $('#server-poll-at');
    if (at) at.textContent = '自动刷新已关闭';
  }
}

/* ==================== 远程文件管理器（独立标签） ==================== */

function openFilesTab(server, startPath) {
  // v0.3.10：从仓库列表打开时按「服务器 + 起始目录」开独立标签，可直接落在仓库目录。
  const id = startPath ? `files:${server.id}:${encodeURIComponent(startPath)}` : `files:${server.id}`;
  if (tabs.has(id)) return activateTab(id);
  const start = startPath || server.deployDir || '/data/platform';
  const pane = newPane(id, `
    <div class="ws-panel">
      <div class="ws-head">
        <h2><span class="tab-ico">▤</span>远程文件 · ${esc(server.name)}</h2>
        <span class="muted">${esc(server.username || 'root')}@${esc(server.host)} · SFTP 直连</span>
      </div>
      <div class="ws-body">
        <div class="pathbar-slot" data-role="fs-pathbar" style="margin-bottom:10px"></div>
        <div class="file-toolbar">
          <button class="btn btn-sm" data-fs="up">↑ 上一级</button>
          <button class="btn btn-sm" data-fs="refresh">刷新</button>
          <span class="flex-spacer"></span>
          <button class="btn btn-sm" data-fs="newfile">新建文件</button>
          <button class="btn btn-sm" data-fs="mkdir">新建目录</button>
          <label class="file-btn btn-sm">上传文件<input type="file" data-role="fs-upload" /></label>
          <button class="btn btn-sm btn-danger" data-fs="remove-selected">删除选中</button>
        </div>
        <div class="fs-table" data-role="fs-list"></div>
        <div class="term-hint">目录与文件分组显示，点表头「名称 / 大小 / 类型 / 修改时间」可切换排序；点击文件名在新标签页打开编辑器（语法高亮 + 编码 / 换行符 / BOM）。可以同时打开多个文件、多个终端与多个模块页。</div>
      </div>
    </div>`);
  const tab = registerTab({
    id, kind: 'files', dynamic: true, closable: true, icon: '▤', pane,
    title: `文件 · ${server.name}`,
    sub: `${server.host} · SFTP 文件管理（可多标签编辑）`,
    ctx: {
      serverId: server.id, serverName: server.name, host: server.host,
      path: start, parent: pathParent(start),
      // v0.3.11：每个文件标签独立记住自己的排序方式。
      sort: { key: 'name', dir: 'asc' }, items: [],
    },
  });
  bindFilesPane(tab);
  loadRemoteFiles(tab);
  return tab;
}

function bindFilesPane(tab) {
  const pane = tab.pane;
  pane.addEventListener('click', async (e) => {
    const tool = e.target.closest('[data-fs]');
    if (tool) { await fsToolbar(tab, tool.dataset.fs); return; }
    const action = e.target.closest('[data-fs-act]');
    if (action) { e.preventDefault(); await fsRowAction(tab, action); return; }
    const link = e.target.closest('.fs-name');
    if (link) {
      e.preventDefault();
      const row = link.closest('tr');
      if (!row) return;
      if (row.dataset.fsDir === '1') { tab.ctx.path = row.dataset.fsPath; await loadRemoteFiles(tab); }
      else openEditorTab(tab.ctx, row.dataset.fsPath, row.dataset.fsName);
    }
  });
  q(pane, 'fs-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await api(`/servers/${tab.ctx.serverId}/files/upload?path=${encodeURIComponent(tab.ctx.path)}&name=${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      toast(`已上传 ${file.name}`);
      await loadRemoteFiles(tab);
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
  // 路径跳转由上方 pathbar 统一处理：面包屑点击 / 空白点击输入 / 回车确认。
}

/** v0.3.11：目录恒优先并分组；表头点击按名称 / 大小 / 类型 / 修改时间升降序排列。 */
function renderRemoteFileTable(tab) {
  const box = q(tab.pane, 'fs-list');
  if (!box) return;
  const sort = tab.ctx.sort || (tab.ctx.sort = { key: 'name', dir: 'asc' });
  const items = sortFileItems(tab.ctx.items || [], sort);
  const dirCount = items.filter((i) => i.isDir).length;
  const rows = [];
  let group = '';
  items.forEach((item) => {
    const next = item.isDir ? 'dir' : 'file';
    if (next !== group) {
      group = next;
      rows.push(`<tr class="file-group"><td colspan="6">${item.isDir
        ? `📁 文件夹 · ${dirCount} 项（目录恒排在最前）`
        : `📄 文件 · ${items.length - dirCount} 项`}</td></tr>`);
    }
    rows.push(`<tr class="file-row ${item.isDir ? 'is-dir' : 'is-file'}" data-fs-path="${esc(item.path)}" data-fs-name="${esc(item.name)}" data-fs-dir="${item.isDir ? 1 : 0}">
      <td style="width:38px"><input type="checkbox" data-role="fs-check" value="${esc(item.name)}" /></td>
      <td>${fileGlyph(item)} <a href="#" class="fs-name">${esc(item.name)}</a>
        ${item.isDir ? '' : `<span class="ft-lang">${esc(item.language || '')}</span>`}</td>
      <td style="width:110px">${item.isDir ? '—' : fmtSize(item.size)}</td>
      <td style="width:120px">${esc(fileTypeLabel(item))}</td>
      <td style="width:170px" class="muted">${esc(fmtTime(item.mtime))}</td>
      <td class="fs-ops" style="width:230px">
        ${item.isDir ? '' : '<button class="btn btn-xs" data-fs-act="edit">编辑</button><button class="btn btn-xs" data-fs-act="download">下载</button>'}
        <button class="btn btn-xs" data-fs-act="rename">重命名</button>
        <button class="btn btn-xs btn-danger" data-fs-act="delete">删除</button>
      </td>
    </tr>`);
  });
  box.innerHTML = `<table><thead><tr>
    <th style="width:38px"></th>
    ${sortHeader('名称（按类型识别）', 'name', sort, 'data-fs-sort')}
    ${sortHeader('大小', 'size', sort, 'data-fs-sort')}
    ${sortHeader('类型', 'type', sort, 'data-fs-sort')}
    ${sortHeader('修改时间', 'mtime', sort, 'data-fs-sort')}
    <th style="width:230px">操作</th>
  </tr></thead><tbody>${rows.join('') || '<tr><td colspan="6" class="muted">目录为空</td></tr>'}</tbody></table>`;
  box.querySelectorAll('[data-fs-sort]').forEach((th) => th.addEventListener('click', () => {
    toggleSort(sort, th.dataset.fsSort);
    renderRemoteFileTable(tab);
  }));
}

async function loadRemoteFiles(tab) {
  const pane = tab.pane;
  const box = q(pane, 'fs-list');
  if (!box) return;
  // 安全评审 P1-1：与 loadStorage 同构的请求序号。快速切目录（双击进入 + 面包屑返回）
  // 时，晚到的旧响应不得覆盖 tab.ctx.path，否则删除/重命名会作用到错误目录。
  const seq = (tab.ctx.loadSeq = (tab.ctx.loadSeq || 0) + 1);
  const pathSnapshot = tab.ctx.path;
  box.innerHTML = '<div class="muted" style="padding:14px">读取中…</div>';
  try {
    const data = await api(`/servers/${tab.ctx.serverId}/files?path=${encodeURIComponent(pathSnapshot)}`);
    if (seq !== tab.ctx.loadSeq || !tabs.has(tab.id)) return; // 已有更新的目录请求，丢弃晚到响应
    tab.ctx.path = data.path;
    tab.ctx.parent = data.parent;
    tab.ctx.items = data.items || [];
    const bar = q(pane, 'fs-pathbar');
    if (bar) {
      bar.innerHTML = pathBarHtml(data.path);
      bindPathBar(bar, {
        onGo: (v) => { tab.ctx.path = v; loadRemoteFiles(tab); },
        onUp: () => { tab.ctx.path = tab.ctx.parent || '/'; loadRemoteFiles(tab); },
      });
    }
    renderRemoteFileTable(tab);
  } catch (e) {
    box.innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
  }
}

async function fsToolbar(tab, action) {
  const id = tab.ctx.serverId;
  const pane = tab.pane;
  try {
    if (action === 'up') { tab.ctx.path = tab.ctx.parent || '/'; await loadRemoteFiles(tab); return; }
    if (action === 'refresh') { await loadRemoteFiles(tab); return; }
    if (action === 'go') { await loadRemoteFiles(tab); return; }
    if (action === 'newfile') {
      const name = await promptDialog('新建文件名称（后缀决定语法高亮，例如 app.py / config.yaml）', 'new.txt');
      if (!name) return;
      await api(`/servers/${id}/files/create`, { method: 'POST', body: { path: tab.ctx.path, name } });
      toast('文件已创建'); await loadRemoteFiles(tab); return;
    }
    if (action === 'mkdir') {
      const name = await promptDialog('新建目录名称');
      if (!name) return;
      await api(`/servers/${id}/files/mkdir`, { method: 'POST', body: { path: tab.ctx.path, name } });
      toast('目录已创建'); await loadRemoteFiles(tab); return;
    }
    if (action === 'remove-selected') {
      const names = Array.from(pane.querySelectorAll('[data-role="fs-check"]:checked')).map((c) => c.value);
      if (!names.length) { toast('请先勾选要删除的项', true); return; }
      if (!await confirmDialog({ message: `确认删除选中的 ${names.length} 项？目录会被递归删除。` })) return;
      await api(`/servers/${id}/files/delete`, { method: 'POST', body: { path: tab.ctx.path, names } });
      toast('已删除'); await loadRemoteFiles(tab);
    }
  } catch (e) { toast(e.message, true); }
}

async function fsRowAction(tab, button) {
  const row = button.closest('tr');
  if (!row) return;
  const target = row.dataset.fsPath;
  const name = row.dataset.fsName;
  const id = tab.ctx.serverId;
  try {
    switch (button.dataset.fsAct) {
      case 'download':
        window.open(`/api/servers/${id}/files/download?path=${encodeURIComponent(target)}${streamToken()}`, '_blank');
        return;
      case 'edit': openEditorTab(tab.ctx, target, name); return;
      case 'rename': {
        const next = await promptDialog('新名称', name);
        if (!next || next === name) return;
        await api(`/servers/${id}/files/rename`, { method: 'POST', body: { path: target, name: next } });
        toast('已重命名'); await loadRemoteFiles(tab); return;
      }
      case 'delete': {
        if (!await confirmDialog({ message: `确认删除 ${name}？目录会被递归删除。` })) return;
        await api(`/servers/${id}/files/delete`, { method: 'POST', body: { path: tab.ctx.path, names: [name] } });
        toast('已删除'); await loadRemoteFiles(tab); return;
      }
      default: return;
    }
  } catch (e) { toast(e.message, true); }
}

function refreshFileTabs(serverId) {
  tabs.forEach((t) => {
    if (t.kind === 'files' && t.ctx.serverId === serverId) loadRemoteFiles(t);
  });
}

/* ==================== 类宝塔文件编辑器（独立标签） ==================== */

function openEditorTab(ctx, filePath, fileName) {
  const id = `editor:${ctx.serverId}:${filePath}`;
  if (tabs.has(id)) return activateTab(id);
  const pane = newPane(id, `
    <div class="ws-panel">
      <div class="ws-head">
        <h2><span class="ft-icon ft-gray" data-role="ed-icon">TXT</span><span data-role="ed-name">${esc(fileName)}</span></h2>
        <span class="muted" data-role="ed-path">${esc(filePath)}</span>
      </div>
      <div class="ed-toolbar">
        <div class="ed-opts">
          <label>语法高亮<select class="ui-select ui-select-sm" data-role="ed-lang"></select></label>
          <label>文件编码<select class="ui-select ui-select-sm" data-role="ed-encoding"></select></label>
          <label>换行符<select class="ui-select ui-select-sm" data-role="ed-newline"></select></label>
          <label class="ed-bom"><input type="checkbox" data-role="ed-bom" /> 保留 BOM</label>
        </div>
        <div class="ed-ops">
          <button class="btn btn-sm" data-ed="find">查找</button>
          <button class="btn btn-sm" data-ed="reload">重载</button>
          <button class="btn btn-sm btn-primary" data-ed="save">保存 · Ctrl+S</button>
        </div>
      </div>
      <div class="ed-body" data-role="ed-body">
        <textarea data-role="ed-area" spellcheck="false"></textarea>
        <div class="ed-preview" data-role="ed-preview" hidden></div>
      </div>
      <div class="ed-status">
        <span data-role="ed-pos">行 1 · 列 1</span>
        <span data-role="ed-count">0 字符</span>
        <span data-role="ed-meta">—</span>
        <span class="ed-state saved" data-role="ed-state">已保存</span>
      </div>
    </div>`);
  const tab = registerTab({
    id, kind: 'editor', dynamic: true, closable: true, icon: '✎', pane,
    title: fileName,
    sub: `${ctx.serverName || ctx.host || ''} · ${filePath}`,
    ctx: {
      serverId: ctx.serverId, serverName: ctx.serverName, path: filePath, name: fileName,
      cm: null, meta: null, encoding: 'utf-8', newline: 'LF', bom: false,
      hasBom: false, mode: '', editable: true, requestedEncoding: 'auto',
    },
    onActivate: (t) => {
      if (t.ctx.cm) { try { t.ctx.cm.refresh(); t.ctx.cm.focus(); } catch { /* noop */ } }
    },
  });
  bindEditorPane(tab);
  loadEditor(tab, 'auto', false);
  return tab;
}

function editorValue(tab) {
  return tab.ctx.cm ? tab.ctx.cm.getValue() : (q(tab.pane, 'ed-area') || {}).value || '';
}

// 未知/未打包的 mode 直接降级为纯文本，避免 CodeMirror 报「Unknown mode」。
function resolveMode(mode) {
  if (!mode || typeof CodeMirror === 'undefined') return null;
  try {
    if (CodeMirror.modes[mode] || CodeMirror.mimeModes[mode]) return mode;
  } catch { /* noop */ }
  return null;
}

function updateEditorStatus(tab) {
  const pane = tab.pane;
  const c = tab.ctx;
  const content = editorValue(tab);
  let line = 1;
  let col = 1;
  if (c.cm) {
    try { const cursor = c.cm.getCursor(); line = cursor.line + 1; col = cursor.ch + 1; } catch { /* noop */ }
  }
  const pos = q(pane, 'ed-pos');
  const count = q(pane, 'ed-count');
  const meta = q(pane, 'ed-meta');
  if (pos) pos.textContent = `行 ${line} · 列 ${col} / 共 ${content.split('\n').length} 行`;
  if (count) count.textContent = `${content.length} 字符 · ${fmtSize(c.meta ? c.meta.size : 0)}`;
  if (meta) meta.textContent = `${c.meta ? c.meta.language : '文本'} · ${c.encoding} · ${c.newline}${c.hasBom ? ' · BOM' : ''}`;
}

function showEditorPreview(tab, data) {
  const pane = tab.pane;
  const wrap = pane.querySelector('.CodeMirror');
  if (wrap) wrap.style.display = 'none';
  const area = q(pane, 'ed-area');
  if (area && !area.classList.contains('ed-fallback')) area.style.display = 'none';
  if (area && area.classList.contains('ed-fallback')) area.style.display = 'none';
  const preview = q(pane, 'ed-preview');
  preview.hidden = false;
  const download = `<div class="row" style="justify-content:center;margin-top:12px">
      <button class="btn btn-sm" data-ed="download">下载文件</button></div>`;
  preview.innerHTML = data.kind === 'image' && data.preview
    ? `<img src="${esc(data.preview)}" alt="${esc(tab.ctx.name)}" />${download}`
    : `<div class="empty" style="max-width:560px">${esc(data.warning || '该文件不能按文本编辑')}${download}</div>`;
}

function ensureCodeMirror(tab) {
  const c = tab.ctx;
  if (c.cm) return;
  const area = q(tab.pane, 'ed-area');
  if (typeof CodeMirror === 'undefined') {
    area.classList.add('ed-fallback');
    area.style.display = 'block';
    area.addEventListener('input', () => { setTabDirty(tab, true); updateEditorStatus(tab); });
    toast('CodeMirror 组件未加载，已降级为纯文本编辑器', true);
    return;
  }
  area.classList.remove('ed-fallback');
  c.cm = CodeMirror.fromTextArea(area, {
    lineNumbers: true,
    mode: resolveMode(c.mode),
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S': () => saveEditor(tab),
      'Cmd-S': () => saveEditor(tab),
      'Ctrl-F': 'findPersistent',
      'Cmd-F': 'findPersistent',
    },
  });
  c.cm.on('change', () => { setTabDirty(tab, true); updateEditorStatus(tab); });
  c.cm.on('cursorActivity', () => updateEditorStatus(tab));
}

async function loadEditor(tab, encoding = 'auto', silent = false) {
  const c = tab.ctx;
  const pane = tab.pane;
  const state = q(pane, 'ed-state');
  if (state && !c.cm) state.textContent = '读取中…';
  try {
    const data = await api(`/servers/${c.serverId}/files/content?path=${encodeURIComponent(c.path)}&encoding=${encodeURIComponent(encoding)}`);
    if (!tabs.has(tab.id)) return;
    c.meta = data;
    c.requestedEncoding = encoding;
    c.encoding = data.encoding || 'utf-8';
    c.newline = data.newline || 'LF';
    c.bom = Boolean(data.hasBom);
    c.hasBom = Boolean(data.hasBom);
    c.mode = data.mode || '';
    c.editable = data.editable !== false;

    const icon = q(pane, 'ed-icon');
    if (icon) { icon.className = `ft-icon ft-${data.color || 'gray'}`; icon.textContent = data.icon || 'TXT'; }
    const name = q(pane, 'ed-name'); if (name) name.textContent = c.name;
    const path = q(pane, 'ed-path'); if (path) path.textContent = `${c.serverName || ''} · ${c.path}`;

    fillSelect(q(pane, 'ed-lang'), data.languages, c.mode);
    fillSelect(q(pane, 'ed-encoding'), data.encodings, encoding === 'auto' ? 'auto' : c.encoding);
    fillSelect(q(pane, 'ed-newline'), data.newlines, c.newline);
    const bom = q(pane, 'ed-bom'); if (bom) bom.checked = c.hasBom;

    if (data.kind !== 'text' || !data.editable) {
      showEditorPreview(tab, data);
      setTabDirty(tab, false);
      updateEditorStatus(tab);
      if (data.warning && !silent) toast(data.warning);
      return;
    }

    const preview = q(pane, 'ed-preview');
    preview.hidden = true;
    preview.innerHTML = '';
    ensureCodeMirror(tab);
    if (c.cm) {
      const wrap = c.cm.getWrapperElement();
      wrap.style.display = '';
      c.cm.setValue(data.content || '');
      c.cm.setOption('mode', resolveMode(c.mode));
      c.cm.setOption('readOnly', !c.editable);
      c.cm.clearHistory();
      c.cm.refresh();
    } else {
      const area = q(pane, 'ed-area');
      area.style.display = 'block';
      area.value = data.content || '';
    }
    setTabDirty(tab, false);
    updateEditorStatus(tab);
    if (data.warning && !silent) toast(data.warning);
    if (silent) toast('文件已重新载入');
  } catch (e) {
    const preview = q(pane, 'ed-preview');
    preview.hidden = false;
    preview.innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    toast(e.message, true);
  }
}

async function saveEditor(tab) {
  const c = tab.ctx;
  if (!c.editable || !c.meta || c.meta.kind !== 'text') { toast('该文件不可编辑', true); return; }
  const saveBtn = tab.pane.querySelector('[data-ed="save"]');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const result = await api(`/servers/${c.serverId}/files/content`, {
      method: 'PUT',
      body: {
        path: c.path,
        content: editorValue(tab),
        encoding: c.encoding,
        newline: c.newline,
        bom: c.bom,
      },
    });
    c.meta.size = result.size;
    setTabDirty(tab, false);
    updateEditorStatus(tab);
    refreshFileTabs(c.serverId);
    toast(`已保存 ${c.name}（${result.encoding} / ${result.newline}）`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function bindEditorPane(tab) {
  const pane = tab.pane;
  const c = tab.ctx;
  pane.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-ed]');
    if (!button) return;
    switch (button.dataset.ed) {
      case 'save': await saveEditor(tab); break;
      case 'reload':
        if (tab.dirty && !await confirmDialog({ message: '重新载入会丢弃未保存的修改，继续？' })) return;
        await loadEditor(tab, c.requestedEncoding || 'auto', true);
        break;
      case 'find':
        if (c.cm && typeof CodeMirror !== 'undefined') { c.cm.focus(); CodeMirror.commands.findPersistent(c.cm); }
        else toast('查找需要 CodeMirror 组件', true);
        break;
      case 'download':
        window.open(`/api/servers/${c.serverId}/files/download?path=${encodeURIComponent(c.path)}${streamToken()}`, '_blank');
        break;
      default: break;
    }
  });
  q(pane, 'ed-lang').addEventListener('change', (e) => {
    c.mode = e.target.value;
    if (c.cm) c.cm.setOption('mode', resolveMode(c.mode));
    toast(`语法高亮已切换为：${e.target.selectedOptions[0].textContent}`);
  });
  q(pane, 'ed-encoding').addEventListener('change', async (e) => {
    if (tab.dirty && !await confirmDialog({ message: '切换编码会重新读取文件并丢弃未保存的修改，继续？' })) {
      e.target.value = c.requestedEncoding || 'auto';
      return;
    }
    await loadEditor(tab, e.target.value, false);
    toast(`编码：${c.encoding === 'auto' ? '自动检测' : c.encoding}`);
  });
  q(pane, 'ed-newline').addEventListener('change', (e) => { c.newline = e.target.value; updateEditorStatus(tab); });
  q(pane, 'ed-bom').addEventListener('change', (e) => { c.bom = e.target.checked; });
}

/* ==================== Web SSH 终端（可多标签多会话） ==================== */

function openTerminalTab(server, cwd, options = {}) {
  // v0.3.10：从仓库列表打开时自动 cd 到该仓库目录，进去就能敲 git 命令。
  const initialCommand = cwd ? `cd '${String(cwd).replace(/'/g, "'\\''")}' && pwd\n` : '';
  const id = `term:${server.id}:${++tabCounter}`;
  const pane = newPane(id, `
    <div class="ws-panel">
      <div class="ws-head">
        <h2><span class="tab-ico">⌨</span>Web 终端 · ${esc(server.name)}</h2>
        <span class="muted">${esc(server.username || 'root')}@${esc(server.host)}:${esc(server.port || 22)}</span>
      </div>
      <div class="ws-body">
        <div class="term-toolbar">
          <span class="chip" data-role="term-state">连接中…</span>
          <span class="muted small">支持中文、Tab 补全、Ctrl+C；窗口大小自适应，多个终端互不干扰</span>
          <div class="row gap term-actions">
            <button class="btn btn-sm" data-term-ctrl="c">Ctrl+C</button>
            <button class="btn btn-sm" data-term-ctrl="d">Ctrl+D</button>
            <button class="btn btn-sm" data-term-ctrl="clear">清屏</button>
            <button class="btn btn-sm btn-danger" data-term-ctrl="close">断开</button>
          </div>
        </div>
        <div class="term-wrap" data-role="term-wrap"></div>
        <div class="term-hint">关闭标签会结束该 SSH 会话；空闲 15 分钟自动回收。</div>
      </div>
    </div>`);
  const tab = registerTab({
    id, kind: 'terminal', dynamic: true, closable: true, icon: '⌨', pane,
    title: `终端 · ${server.name}`,
    sub: `${server.username || 'root'}@${server.host} · 交互式 SSH`,
    ctx: { serverId: server.id, sid: null, term: null, fit: null, source: null, resizeHandler: null, initialCommand },
    onActivate: (t) => {
      if (t.ctx.fit) { try { t.ctx.fit(); } catch { /* noop */ } }
      if (t.ctx.term) { try { t.ctx.term.focus(); } catch { /* noop */ } }
    },
    onClose: (tab) => { cleanupTerminal(tab); if (options.onClose) options.onClose(tab); },
  });
  bindTerminalPane(tab);
  connectTerminal(tab, server);
  return tab;
}

function cleanupTerminal(tab) {
  const c = tab.ctx;
  if (c.resizeHandler) { window.removeEventListener('resize', c.resizeHandler); c.resizeHandler = null; }
  if (c.source) { try { c.source.close(); } catch { /* noop */ } c.source = null; }
  if (c.sid) {
    api(`/servers/${c.serverId}/terminal/close`, { method: 'POST', body: { sid: c.sid } }).catch(() => {});
    c.sid = null;
  }
  if (c.term) { try { c.term.dispose(); } catch { /* noop */ } c.term = null; }
  c.fit = null;
}

function bindTerminalPane(tab) {
  const pane = tab.pane;
  pane.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-term-ctrl]');
    if (!button) return;
    const key = button.dataset.termCtrl;
    const c = tab.ctx;
    if (key === 'clear') { if (c.term) c.term.clear(); return; }
    if (key === 'close') { closeTab(tab.id); return; }
    if (!c.sid) return;
    try {
      await api(`/servers/${c.serverId}/terminal/input`, {
        method: 'POST', body: { sid: c.sid, input: key === 'c' ? '\u0003' : '\u0004' },
      });
    } catch (err) { toast(err.message, true); }
  });
}

async function connectTerminal(tab, server) {
  const pane = tab.pane;
  const c = tab.ctx;
  const wrap = q(pane, 'term-wrap');
  const state = q(pane, 'term-state');
  try {
    if (typeof Terminal === 'undefined') throw new Error('终端组件未加载：请确认 /vendor/xterm.min.js 已部署');
    const session = await api(`/servers/${server.id}/terminal/open`, {
      method: 'POST', body: { cols: 100, rows: 28 },
    });
    if (!tabs.has(tab.id)) {
      await api(`/servers/${server.id}/terminal/close`, { method: 'POST', body: { sid: session.sid } }).catch(() => {});
      return;
    }
    c.sid = session.sid;
    c.term = new Terminal({
      cols: 100, rows: 28, cursorBlink: true, fontSize: 13, scrollback: 5000,
      fontFamily: 'Consolas, "SF Mono", Menlo, monospace',
      theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#60a5fa', selectionBackground: '#1d4ed855' },
    });
    if (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) {
      c.fit = new FitAddon.FitAddon();
      c.term.loadAddon(c.fit);
    }
    c.term.open(wrap);
    if (c.fit && activeTabId === tab.id) { try { c.fit.fit(); } catch { /* noop */ } }
    if (state) { state.textContent = '已连接'; state.className = 'chip chip-green'; }

    c.term.onData((data) => {
      if (!c.sid) return;
      api(`/servers/${server.id}/terminal/input`, {
        method: 'POST', body: { sid: c.sid, input: data },
      }).catch((err) => toast(err.message, true));
    });

    // 连接建立后自动切到仓库目录（延迟一拍，等 shell 提示符就绪）。
    if (c.initialCommand) {
      setTimeout(() => {
        if (!c.sid) return;
        api(`/servers/${server.id}/terminal/input`, {
          method: 'POST', body: { sid: c.sid, input: c.initialCommand },
        }).catch(() => {});
      }, 900);
    }

    const syncSize = () => {
      if (activeTabId !== tab.id || !c.term || !c.sid) return;
      if (c.fit) { try { c.fit.fit(); } catch { /* noop */ } }
      api(`/servers/${server.id}/terminal/resize`, {
        method: 'POST', body: { sid: c.sid, cols: c.term.cols, rows: c.term.rows },
      }).catch(() => {});
    };
    c.resizeHandler = syncSize;
    window.addEventListener('resize', syncSize);

    c.source = new EventSource(`/api/servers/${server.id}/terminal/stream?sid=${encodeURIComponent(session.sid)}${streamToken()}`);
    c.source.onmessage = (event) => {
      if (!c.term) return;
      try {
        const binary = atob(event.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        c.term.write(bytes);
      } catch { /* 忽略坏帧 */ }
    };
    c.source.addEventListener('closed', (event) => {
      let reason = '远程连接已关闭';
      try { reason = JSON.parse(event.data).reason || reason; } catch { /* noop */ }
      if (state) { state.textContent = reason; state.className = 'chip'; }
      if (c.term) c.term.write(`\r\n\x1b[90m[${reason}]\x1b[0m\r\n`);
      // 后端以 200 结束 SSE 流；不 close() 会被浏览器当成断线每 3 秒自动重连、刷屏。
      if (c.source) { try { c.source.close(); } catch { /* noop */ } c.source = null; }
      c.sid = null;
    });
    c.source.onerror = () => {
      if (state && c.sid) { state.textContent = '连接中断'; state.className = 'chip'; }
    };
    if (activeTabId === tab.id) c.term.focus();
  } catch (e) {
    wrap.innerHTML = `<div class="notice error" style="color:#fecaca;background:#451b1b;border:0">${esc(e.message)}</div>`;
    if (state) state.textContent = '连接失败';
    cleanupTerminal(tab);
  }
}

/* ------------------------------- AI 服务 --------------------------------- */

function setProviderKind(kind) {
  const cli = kind === 'cli';
  $$('#kind-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === (cli ? 'cli' : 'api')));
  $('#provider-kind').value = cli ? 'cli' : 'api';
  $('#api-fields').hidden = cli;
  $('#cli-fields').hidden = !cli;
  if (cli && !detectedOnce) detectPrograms(false);
}

function renderDetected(data) {
  detectedPrograms = data;
  const chips = [];
  (data.host || []).forEach((p) => chips.push({
    label: p.command, sub: `宿主机 · ${p.path}`, runner: 'host', distro: '', command: p.command,
  }));
  const distros = (data.wsl && data.wsl.distros) || [];
  distros.forEach((d) => (d.programs || []).forEach((p) => chips.push({
    label: `${p.command} @ ${d.name}`, sub: `WSL · ${p.path}`, runner: 'wsl', distro: d.name, command: p.command,
  })));

  $('#cli-distro').innerHTML = '<option value="">默认发行版</option>'
    + distros.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}（${(d.programs || []).length} 个程序）</option>`).join('');

  $('#detected-list').innerHTML = chips.length
    ? chips.map((c, i) => `<button type="button" class="chip" data-idx="${i}">${esc(c.label)}<span class="chip-sub">${esc(c.sub)}</span></button>`).join('')
    : `<div class="empty" style="width:100%;padding:12px">未检测到已安装程序${data.wsl && data.wsl.error ? '（' + esc(data.wsl.error) + '）' : ''}，也可以手动选择命令后试跑</div>`;

  $$('#detected-list [data-idx]').forEach((b) => b.addEventListener('click', () => {
    const c = chips[Number(b.dataset.idx)];
    $('#cli-runner').value = c.runner;
    $('#cli-distro').value = c.distro;
    $('#cli-command').value = c.command;
    toast(`已选择 ${c.label}`);
  }));

  const wslCount = distros.reduce((n, d) => n + (d.programs || []).length, 0);
  const suffix = data.platform === 'win32'
    ? ` · WSL ${distros.length} 个发行版 / ${wslCount} 个程序${data.wsl && !data.wsl.available ? '（' + data.wsl.error + '）' : ''}`
    : ' · 当前非 Windows，无 WSL';
  $('#detect-status').textContent = `检测于 ${fmtTime(data.detectedAt)} · 宿主机 ${(data.host || []).length} 个${suffix}`;
}

async function detectPrograms(force = false) {
  detectedOnce = true;
  $('#detect-status').textContent = '检测中…（扫描 WSL 发行版可能需要十几秒）';
  try {
    const data = await api(`/ai/local/programs${force ? '?refresh=1' : ''}`);
    renderDetected(data);
    const n = (data.host || []).length + ((data.wsl && data.wsl.distros) || [])
      .reduce((sum, d) => sum + (d.programs || []).length, 0);
    toast(`检测完成：找到 ${n} 个可用 AI 程序`);
  } catch (e) {
    $('#detect-status').textContent = `检测失败：${e.message}`;
    $('#detected-list').innerHTML = errorBlock(e.message);
    toast(`检测失败：${e.message}`, true);
  }
}

function providerSummary(p) {
  if (p.kind === 'cli') {
    const where = p.runner === 'wsl' ? `WSL ${p.distro || '默认发行版'}` : '宿主机';
    return `${esc(p.command === 'custom' ? p.customCommand : p.command)} · ${esc(where)}${p.extraArgs ? ' · ' + esc(p.extraArgs) : ''}${p.proxy ? ' · 代理 ' + esc(p.proxy) : ''}`;
  }
  return `${esc(p.baseURL)} · ${esc(p.model)} · Key ${esc(p.apiKey || '未设置')}${p.proxy ? ' · 代理 ' + esc(p.proxy) : ''}`;
}

/** 渲染编辑表单里的模型目录：显示名 + 模型 ID，可设为默认 / 删除 / 拖拽排序。 */
function renderProviderModelRows(defaultModel) {
  const box = $('#model-rows');
  if (!box) return;
  if (!providerModelRows.length) {
    box.innerHTML = '<div class="model-add-hint">尚无模型。点「获取可用模型」拉取，或手动「添加模型」。</div>';
    return;
  }
  box.innerHTML = providerModelRows.map((m, i) => `
    <div class="model-row ${m.id === defaultModel ? 'is-default' : ''}" data-model-row="${i}" draggable="true">
      <span class="model-grip" title="拖拽排序">≡</span>
      <input class="model-name" data-model-name="${i}" value="${esc(m.name || m.id)}" placeholder="显示名称" />
      <input class="model-id" data-model-id="${i}" value="${esc(m.id)}" placeholder="模型 ID" />
      <button type="button" class="btn btn-sm" data-model-default="${i}" title="设为默认模型">${m.id === defaultModel ? '默认' : '设为默认'}</button>
      <button type="button" class="btn btn-sm btn-danger" data-model-del="${i}" title="删除">✕</button>
    </div>`).join('');

  box.querySelectorAll('[data-model-name]').forEach((el) => el.addEventListener('input', () => {
    providerModelRows[Number(el.dataset.modelName)].name = el.value;
  }));
  box.querySelectorAll('[data-model-id]').forEach((el) => el.addEventListener('input', () => {
    providerModelRows[Number(el.dataset.modelId)].id = el.value;
  }));
  box.querySelectorAll('[data-model-del]').forEach((b) => b.addEventListener('click', () => {
    providerModelRows.splice(Number(b.dataset.modelDel), 1);
    renderProviderModelRows(getDefaultModelValue());
    renderAvailableModels();
  }));
  box.querySelectorAll('[data-model-default]').forEach((b) => b.addEventListener('click', () => {
    const m = providerModelRows[Number(b.dataset.modelDefault)];
    if (!m) return;
    const id = String(m.id || m.name || '').trim();
    if (!id) { toast('请先填写模型 ID', true); return; }
    const modelInput = $('#provider-form [name="model"]');
    if (modelInput) modelInput.value = id;
    renderProviderModelRows(id);
    toast(`默认模型已设为 ${id}`);
  }));
  let dragIdx = -1;
  box.querySelectorAll('[data-model-row]').forEach((row) => {
    row.addEventListener('dragstart', () => { dragIdx = Number(row.dataset.modelRow); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = Number(row.dataset.modelRow);
      if (dragIdx < 0 || dragIdx === to) return;
      const [moved] = providerModelRows.splice(dragIdx, 1);
      providerModelRows.splice(to, 0, moved);
      renderProviderModelRows(getDefaultModelValue());
    });
  });
}

function getDefaultModelValue() {
  const el = $('#provider-form [name="model"]');
  return el ? String(el.value || '').trim() : '';
}

/** 把模型目录同步进表单提交体：默认模型置顶并写入 model 字段。 */
function syncModelCatalogToForm() {
  const rows = providerModelRows
    .map((m) => ({ id: String((m && m.id) || '').trim(), name: String((m && m.name) || '').trim() }))
    .filter((m) => m.id);
  const def = getDefaultModelValue();
  const ordered = def ? rows.filter((m) => m.id === def).concat(rows.filter((m) => m.id !== def)) : rows;
  const modelInput = $('#provider-form [name="model"]');
  if (modelInput && ordered.length && !def) modelInput.value = ordered[0].id;
  return ordered;
}

/** 渲染「获取可用模型」结果：默认全部勾选加入目录，点胶囊可取消 / 再点恢复。 */
function renderAvailableModels() {
  const box = $('#model-available');
  if (!box) return;
  if (!providerAvailableModels.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const added = new Set(providerModelRows.map((m) => String(m.id || '')));
  box.innerHTML = providerAvailableModels.map((m, i) => `
    <button type="button" class="model-chip ${added.has(m.id) ? 'is-added' : ''}" data-avail="${i}" title="${esc(added.has(m.id) ? '点击取消勾选' : (m.ownedBy ? '提供者 ' + m.ownedBy : '点击勾选加入目录'))}">
      <span class="model-chip-add">${added.has(m.id) ? '✓' : '＋'}</span>${esc(m.name || m.id)}
    </button>`).join('');
  box.querySelectorAll('[data-avail]').forEach((b) => b.addEventListener('click', () => {
    const m = providerAvailableModels[Number(b.dataset.avail)];
    if (!m) return;
    const idx = providerModelRows.findIndex((x) => x.id === m.id);
    if (idx >= 0) {
      if (m.id === getDefaultModelValue()) { toast('默认模型不能取消勾选', true); return; }
      providerModelRows.splice(idx, 1);
      toast(`已取消 ${m.name || m.id}`);
    } else {
      providerModelRows.push({ id: m.id, name: m.name || m.id });
      toast(`已勾选 ${m.name || m.id}`);
    }
    renderProviderModelRows(getDefaultModelValue());
    renderAvailableModels();
  }));
}

function loadProviderModels(p) {
  const raw = Array.isArray(p.models) && p.models.length ? p.models : [{ id: p.model || '', name: p.model || '' }];
  providerModelRows = raw.map((m) => ({
    id: String((m && (m.id || m.name)) || ''),
    name: String((m && m.name) || (m && m.id) || ''),
  })).filter((m) => m.id);
  providerAvailableModels = [];
  renderProviderModelRows(p.model || '');
  renderAvailableModels();
}

function clearProviderModels() {
  providerModelRows = [];
  providerAvailableModels = [];
  renderProviderModelRows('');
  renderAvailableModels();
  const r = $('#model-fetch-result'); if (r) { r.hidden = true; r.textContent = ''; }
}

/** 把已配置模型填进所有页面的服务商下拉（连通性测试 / AI 运维会话）。 */
function fillProviderSelects(items) {
  const options = items.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.kind === 'cli' ? '本地 ' + esc(p.command) : esc(p.model)}</option>`).join('')
    || '<option value="">请先配置服务</option>';
  ['#chat-provider', '#ops-provider'].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    const keep = el.value;
    el.innerHTML = options;
    if (keep && items.some((p) => p.id === keep)) el.value = keep;
  });
}

async function loadAI() {
  try {
    const d = await api('/ai/providers');
    const items = d.items || [];
    fillProviderSelects(items);
    const box = $('#provider-list');
    if (!box) return;
    box.innerHTML = items.length ? items.map((p) => `
      <div class="list-item">
        <div><div class="title">${esc(p.name)} ${p.kind === 'cli' ? badge('本地 CLI', 'blue') : badge('API', 'gray')} ${p.enabled === false ? badge('已停用', 'gray') : badge('启用', 'green')}</div>
          <div class="desc">${providerSummary(p)}</div></div>
        <div class="actions">
          <button class="btn btn-sm" data-edit="${esc(p.id)}">编辑</button>
          <button class="btn btn-sm" data-ai-proxy="${esc(p.id)}">代理</button>
          <button class="btn btn-sm" data-collab-open="aiProviders|${esc(p.id)}">协作者</button>
          <button class="btn btn-sm btn-danger" data-delprovider="${esc(p.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="empty">还没有配置 AI 模型，请在「配置 AI 模型」页添加</div>';

    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const all = await api('/ai/providers');
        const p = (all.items || []).find((x) => x.id === b.dataset.edit);
        if (!p) return;
        const form = $('#provider-form');
        form.reset();
        Object.keys(p).forEach((key) => {
          const el = form.elements[key];
          if (el && el.type !== 'checkbox') el.value = p[key] || '';
        });
        form.elements.enabled.checked = p.enabled !== false;
        form.elements.noKey.checked = Boolean(p.noKey);
        form.elements.apiKey.value = '';
        form.elements.apiKey.placeholder = '留空表示不修改已保存的 Key';
        setProviderKind(p.kind || 'api');
        loadProviderModels(p);
        renderCollabInline('aiProviders', p.id);
        const cancel = $('#provider-cancel');
        if (cancel) cancel.textContent = '取消编辑 / 返回列表';
        if (p.kind === 'cli') {
          await detectPrograms(false);
          if (p.distro && !Array.from($('#cli-distro').options).some((o) => o.value === p.distro)) {
            $('#cli-distro').add(new Option(p.distro, p.distro));
          }
          $('#cli-distro').value = p.distro || '';
        }
        switchView('ai');                    // 表单已拆到独立子页，编辑时自动跳过去
        toast(`正在编辑 ${p.name}`);
      } catch (e) { toast(e.message, true); }
    }));
    box.querySelectorAll('[data-ai-proxy]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('ai', b.dataset.aiProxy)));
    box.querySelectorAll('[data-delprovider]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ message: '确认删除这个 AI 模型配置？' })) return;
      try { await api(`/ai/providers/${b.dataset.delprovider}`, { method: 'DELETE' }); toast('已删除'); loadAI(); }
      catch (e) { toast(e.message, true); }
    }));
  } catch (e) { if ($('#provider-list')) $('#provider-list').innerHTML = errorBlock(e.message); }
}

const opsState = {
  sessions: [], currentId: '', attachments: [], sending: false, bound: false,
  suggestion: '',           // AI 回复给出的下一步提示词，Tab 可填入输入框
  serverScope: 'all',       // 'all' | 服务器 id 数组（多台 / 单台 / 空）
  servers: [],
};

/* ---------- v0.4.4：会话服务器范围 + 输入框 ghost-text 建议 ---------- */
const OPS_PROMPT_PLACEHOLDER = '检查所有服务器负载，找出最近失败的构建并分析原因…（Ctrl/⌘ + Enter 发送）';

function opsScopeLabel(scope) {
  if (!Array.isArray(scope)) return '服务器：全部';
  if (!scope.length) return '服务器：不选';
  return `服务器：${scope.length} 台`;
}

function renderOpsScope() {
  const btn = $('#ops-server-btn');
  if (btn) btn.textContent = `🖥 ${opsScopeLabel(opsState.serverScope)}`;
  const boxes = $$('#ops-server-list input[type="checkbox"]');
  const scope = opsState.serverScope;
  boxes.forEach((b) => { b.checked = !Array.isArray(scope) || scope.includes(b.value); });
}

function renderOpsServerList() {
  const box = $('#ops-server-list');
  if (!box) return;
  box.innerHTML = opsState.servers.length ? opsState.servers.map((s) => `
    <label class="check ops-scope-item" title="${esc(s.host || '')}">
      <input type="checkbox" value="${esc(s.id)}" /> ${esc(s.name || s.host || s.id)}
    </label>`).join('') : '<div class="empty">还没有登记服务器，默认按「全部」处理</div>';
  renderOpsScope();
}

async function applyOpsScope(scope) {
  opsState.serverScope = Array.isArray(scope) ? scope.slice() : 'all';
  renderOpsScope();
  const panel = $('#ops-server-panel');
  if (panel) panel.hidden = true;
  if (opsState.currentId) {
    try {
      await api(`/ai/sessions/${encodeURIComponent(opsState.currentId)}`, {
        method: 'PUT', body: { serverScope: opsState.serverScope },
      });
    } catch (e) { toast(e.message, true); }
  }
  toast(`范围已更新：${opsScopeLabel(opsState.serverScope)}`);
}

function renderOpsGhost() {
  const ghost = $('#ops-ghost');
  const input = $('#ops-prompt');
  if (!ghost || !input) return;
  const show = Boolean(opsState.suggestion) && !input.value;
  ghost.hidden = !show;
  input.placeholder = show ? '' : OPS_PROMPT_PLACEHOLDER;
  if (show) {
    ghost.innerHTML = `${esc(opsState.suggestion)}<span class="ops-ghost-tag">Tab 填入 · Esc 忽略</span>`;
  }
}

function acceptOpsSuggestion() {
  const input = $('#ops-prompt');
  if (!input || !opsState.suggestion || input.value) return false;
  input.value = opsState.suggestion;
  opsState.suggestion = '';
  renderOpsGhost();
  input.focus();
  return true;
}

function opsStatus(text) { const el = $('#ops-status'); if (el) el.textContent = text || ''; }

/* 附件读取：图片转 dataURL、文本转纯文本；过大文件直接拒绝。 */
function readOpsAttachment(file) {
  return new Promise((resolve, reject) => {
    const name = file.name || 'file';
    const mime = file.type || '';
    const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    if (file.size > 3 * 1024 * 1024) return reject(new Error(`「${name}」超过 3MB，请压缩后再附加`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取「${name}」失败`));
    if (isImage) {
      reader.onload = () => compressOpsImage(String(reader.result), mime)
        .then((data) => resolve({ name, mime: mime || 'image/png', size: file.size, kind: 'image', data }))
        .catch(reject);
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve({
        name, mime: mime || 'text/plain', size: file.size, kind: 'text',
        data: String(reader.result || '').slice(0, 200000),
      });
      reader.readAsText(file);
    }
  });
}

/* 图片等比压缩到最长边 1600px、JPEG 0.82，避免 base64 撑爆请求体与 state.json。 */
function compressOpsImage(dataUrl, mime) {
  return new Promise((resolve) => {
    if (/svg/i.test(mime)) return resolve(dataUrl);   // SVG 直接透传
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      try {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/jpeg', 0.82);
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch { resolve(dataUrl); }
    };
    img.src = dataUrl;
  });
}

function renderOpsAttachments() {
  const box = $('#ops-attachments');
  if (!box) return;
  box.hidden = !opsState.attachments.length;
  box.innerHTML = opsState.attachments.map((a, i) => `
    <div class="ops-attach-item">
      ${a.kind === 'image' && /^data:image\//.test(a.data)
        ? `<img src="${esc(a.data)}" alt="${esc(a.name)}" class="ops-attach-thumb" />`
        : '<span class="ops-attach-ico">▤</span>'}
      <span class="ops-attach-name" title="${esc(a.name)}">${esc(a.name)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-ops-attach-del="${i}" title="移除">✕</button>
    </div>`).join('');
  box.querySelectorAll('[data-ops-attach-del]').forEach((b) => b.addEventListener('click', () => {
    opsState.attachments.splice(Number(b.dataset.opsAttachDel), 1);
    renderOpsAttachments();
  }));
}

function opsMessageHtml(m) {
  const mine = m.role === 'user';
  const attachments = (m.attachments || []).map((a) => {
    if (a.kind === 'image' && a.data && /^data:image\//.test(a.data)) {
      return `<a href="${esc(a.data)}" target="_blank" rel="noopener" class="ops-msg-image"><img src="${esc(a.data)}" alt="${esc(a.name)}" /></a>`;
    }
    return `<div class="ops-msg-file"><span>▤</span><span>${esc(a.name)}</span><span class="muted small">${esc(fmtSize(a.size || 0))}</span></div>`;
  }).join('');

  let trace = '';
  if (m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length) {
    trace = `<details class="ops-trace"><summary>工具调用轨迹 · ${m.trace.length} 步</summary>
      <pre class="log">${esc(JSON.stringify(m.trace, null, 2))}</pre></details>`;
  }
  const meta = m.role === 'assistant'
    ? `<div class="ops-msg-meta muted small">${esc(fmtTime(m.at))}${m.provider ? ' · ' + esc(m.provider) : ''}${m.model ? ' · ' + esc(m.model) : ''}${m.attachmentMode === 'text-fallback' ? ' · 图片已降级为文字' : ''}${m.mode === 'context-injection' ? ' · 上下文注入模式' : ''}</div>`
    : `<div class="ops-msg-meta muted small">${esc(fmtTime(m.at))}</div>`;
  const body = m.error
    ? `<div class="ops-msg-error">失败：${esc(m.error)}</div>`
    : `<div class="ops-msg-text">${esc(m.content || '(空)')}</div>`;
  return `<div class="ops-msg ${mine ? 'mine' : 'ai'}">
    <div class="ops-msg-avatar">${mine ? '我' : 'AI'}</div>
    <div class="ops-msg-body">
      ${attachments ? `<div class="ops-msg-attachments">${attachments}</div>` : ''}
      ${body}${trace}${meta}
    </div>
  </div>`;
}

function renderOpsMessages(messages, scroll = true) {
  const box = $('#ops-messages');
  if (!box) return;
  box.innerHTML = messages && messages.length
    ? messages.map(opsMessageHtml).join('')
    : '<div class="empty">还没有消息，输入问题或附加日志 / 截图开始分析</div>';
  if (scroll) box.scrollTop = box.scrollHeight;
}

function renderOpsSessions() {
  const box = $('#ops-session-list');
  if (!box) return;
  box.innerHTML = opsState.sessions.length ? opsState.sessions.map((s) => `
    <div class="ops-session ${s.id === opsState.currentId ? 'active' : ''}" data-ops-session="${esc(s.id)}">
      <div class="ops-session-title">${esc(s.title || '新会话')}</div>
      <div class="ops-session-meta muted small">${esc(fmtTime(s.updatedAt))} · ${s.messageCount || 0} 条</div>
    </div>`).join('') : '<div class="empty">还没有会话，点「＋ 新建」开始</div>';
  box.querySelectorAll('[data-ops-session]').forEach((b) => b.addEventListener('click', () => openOpsSession(b.dataset.opsSession)));
}

async function loadOpsSessions(preferId = '') {
  try {
    const d = await api('/ai/sessions');
    opsState.sessions = d.items || [];
    const wanted = preferId || opsState.currentId;
    if (wanted && opsState.sessions.some((s) => s.id === wanted)) {
      if (wanted === opsState.currentId) { renderOpsSessions(); return; }
      return openOpsSession(wanted);
    }
    if (opsState.sessions.length) return openOpsSession(opsState.sessions[0].id);
    opsState.currentId = '';
    renderOpsSessions();
    renderOpsMessages([]);
    const t = $('#ops-chat-title'); if (t) t.textContent = 'AI 运维';
    const sub = $('#ops-chat-sub'); if (sub) sub.textContent = '点「＋ 新建」开始一段新对话';
  } catch (e) { toast(e.message, true); }
}

async function openOpsSession(id) {
  try {
    const s = await api(`/ai/sessions/${encodeURIComponent(id)}`);
    opsState.currentId = s.id;
    opsState.attachments = [];
    renderOpsAttachments();
    const t = $('#ops-chat-title'); if (t) t.textContent = s.title || '新会话';
    const sub = $('#ops-chat-sub'); if (sub) sub.textContent = s.messageCount ? `${s.messageCount} 条消息 · 会话已留存，可继续对话` : '新会话';
    const prov = $('#ops-provider'); if (prov && s.providerId) prov.value = s.providerId;
    const w = $('#ops-write'); if (w) w.checked = Boolean(s.allowWrite);
    opsState.serverScope = Array.isArray(s.serverScope) ? s.serverScope : (s.serverScope || 'all');
    renderOpsScope();
    const last = [...(s.messages || [])].reverse().find((m) => m && m.role === 'assistant' && m.suggestion);
    opsState.suggestion = last ? String(last.suggestion) : '';
    renderOpsGhost();
    renderOpsSessions();
    renderOpsMessages(s.messages);
  } catch (e) { toast(e.message, true); }
}

function createOpsSession() {
  // 新建只重置为草稿态，不立即落库：发送第一条消息时才创建会话，
  // 避免点一下「＋ 新建」就留下 0 条消息的无效记录。
  opsState.currentId = '';
  opsState.attachments = [];
  renderOpsAttachments();
  const t = $('#ops-chat-title'); if (t) t.textContent = '新会话';
  const sub = $('#ops-chat-sub'); if (sub) sub.textContent = '输入第一条消息后自动创建会话';
  opsState.suggestion = '';
  renderOpsGhost();
  renderOpsMessages([]);
  renderOpsSessions();
  const input = $('#ops-prompt'); if (input) { input.value = ''; input.focus(); }
}

async function deleteOpsSession() {
  if (!opsState.currentId) return;
  if (!await confirmDialog({ message: '确认删除当前会话？其中的消息与附件将无法恢复。' })) return;
  try {
    await api(`/ai/sessions/${encodeURIComponent(opsState.currentId)}`, { method: 'DELETE' });
    opsState.currentId = '';
    toast('会话已删除');
    await loadOpsSessions();
  } catch (e) { toast(e.message, true); }
}

async function clearOpsSession() {
  if (!opsState.currentId) return;
  if (!await confirmDialog({ message: '确认清空当前会话的全部消息？（会话本身保留）' })) return;
  try {
    const s = await api(`/ai/sessions/${encodeURIComponent(opsState.currentId)}/clear`, { method: 'POST' });
    renderOpsMessages(s.messages);
    const sub = $('#ops-chat-sub'); if (sub) sub.textContent = '消息已清空，可继续对话';
    await loadOpsSessions(opsState.currentId);
    toast('已清空消息');
  } catch (e) { toast(e.message, true); }
}

async function renameOpsSession() {
  if (!opsState.currentId) return;
  const title = await promptDialog('会话标题', ($('#ops-chat-title') || {}).textContent || '新会话');
  if (!title || !title.trim()) return;
  try {
    await api(`/ai/sessions/${encodeURIComponent(opsState.currentId)}`, { method: 'PUT', body: { title: title.trim() } });
    const t = $('#ops-chat-title'); if (t) t.textContent = title.trim();
    await loadOpsSessions(opsState.currentId);
    toast('已重命名');
  } catch (e) { toast(e.message, true); }
}

async function sendOpsMessage() {
  if (opsState.sending) return;
  const input = $('#ops-prompt');
  const content = (input ? input.value : '').trim();
  const attachments = opsState.attachments.slice();
  if (!content && !attachments.length) { toast('请输入内容或附加文件', true); return; }
  if (!opsState.currentId) {
    try {
      const s = await api('/ai/sessions', { method: 'POST', body: {
        providerId: ($('#ops-provider') || {}).value || '',
        allowWrite: Boolean(($('#ops-write') || {}).checked),
        serverScope: opsState.serverScope,
      } });
      opsState.currentId = s.id;
    } catch (e) { toast(e.message, true); return; }
  }

  opsState.sending = true;
  const sendBtn = $('#ops-send');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '分析中…'; }
  if (input) input.value = '';
  opsState.attachments = [];
  opsState.suggestion = '';
  renderOpsGhost();
  renderOpsAttachments();
  const box = $('#ops-messages');
  if (box) {
    if (box.querySelector('.empty')) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', opsMessageHtml({ role: 'user', content, attachments, at: new Date().toISOString() }));
    box.insertAdjacentHTML('beforeend', '<div class="ops-msg ai" id="ops-pending"><div class="ops-msg-avatar">AI</div><div class="ops-msg-body"><div class="ops-msg-text ops-typing">正在分析平台状态与日志…</div></div></div>');
    box.scrollTop = box.scrollHeight;
  }
  opsStatus('AI 正在调用工具分析，可能需要几十秒');

  try {
    const d = await api(`/ai/sessions/${encodeURIComponent(opsState.currentId)}/messages`, {
      method: 'POST',
      body: {
        content, attachments,
        providerId: ($('#ops-provider') || {}).value || '',
        allowWrite: Boolean(($('#ops-write') || {}).checked),
        serverScope: opsState.serverScope,
      },
    });
    const pending = $('#ops-pending');
    if (pending) {
      pending.outerHTML = opsMessageHtml(d.assistantMessage);
    } else if (box) {
      box.insertAdjacentHTML('beforeend', opsMessageHtml(d.assistantMessage));
    }
    if (box) box.scrollTop = box.scrollHeight;
    if (d.assistantMessage && d.assistantMessage.error) toast(d.assistantMessage.error, true);
    if (d.assistantMessage && d.assistantMessage.attachmentMode === 'text-fallback') {
      toast('当前服务不支持图像识别，图片已降级为文字说明');
    }
    const sub = $('#ops-chat-sub'); if (sub) sub.textContent = '会话已留存，可继续追问或稍后恢复';
    opsState.suggestion = String((d.assistantMessage && d.assistantMessage.suggestion) || '');
    renderOpsGhost();
    await loadOpsSessions(opsState.currentId);
    opsStatus('');
  } catch (e) {
    const pending = $('#ops-pending');
    if (pending) pending.outerHTML = opsMessageHtml({ role: 'assistant', content: '', error: e.message, at: new Date().toISOString() });
    toast(e.message, true);
    opsStatus('发送失败');
  } finally {
    opsState.sending = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送'; }
  }
}

async function loadOps() {
  try {
    const [tools, providers, servers] = await Promise.all([
      api('/ai/tools'), api('/ai/providers'), api('/servers'),
    ]);
    const hint = $('#ops-hint');
    if (hint) hint.textContent = `只读：${(tools.readCommands || []).join(' · ')}`;
    fillProviderSelects(providers.items || []);
    opsState.servers = servers.items || [];
    renderOpsServerList();
  } catch (e) { toast(e.message, true); }
  await loadOpsSessions();

  if (opsState.bound) return;
  opsState.bound = true;
  $('#ops-form').addEventListener('submit', (e) => { e.preventDefault(); sendOpsMessage(); });
  const promptEl = $('#ops-prompt');
  if (promptEl) {
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && acceptOpsSuggestion()) { e.preventDefault(); }
      else if (e.key === 'Escape' && opsState.suggestion) { opsState.suggestion = ''; renderOpsGhost(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendOpsMessage(); }
    });
    promptEl.addEventListener('input', renderOpsGhost);
  }
  $('#ops-server-btn').addEventListener('click', () => {
    const panel = $('#ops-server-panel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderOpsScope();
  });
  $('#ops-scope-all').addEventListener('click', () => applyOpsScope('all'));
  $('#ops-scope-none').addEventListener('click', () => applyOpsScope([]));
  $('#ops-scope-apply').addEventListener('click', () => {
    const boxes = $$('#ops-server-list input[type="checkbox"]');
    const checked = boxes.filter((b) => b.checked).map((b) => b.value);
    applyOpsScope(boxes.length && checked.length === boxes.length ? 'all' : checked);
  });
  $('#ops-new').addEventListener('click', createOpsSession);
  $('#ops-delete').addEventListener('click', deleteOpsSession);
  $('#ops-clear').addEventListener('click', clearOpsSession);
  $('#ops-rename').addEventListener('click', renameOpsSession);
  $('#ops-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (opsState.attachments.length + files.length > 6) { toast('每条消息最多 6 个附件', true); e.target.value = ''; return; }
    for (const file of files) {
      try { opsState.attachments.push(await readOpsAttachment(file)); }
      catch (err) { toast(err.message, true); }
    }
    e.target.value = '';
    renderOpsAttachments();
  });
}

/* ------------- AI 会话（DeepSeek Harness 会话式，v0.4.10） ---------------- */
// 与「AI 运维」两页并存：运维页走 opsAgent 平台上下文；本页由 dsh 在工作区多步执行，
// text / 轨迹结构化事件通过 SSE 实时回显，界面仿会话式助手（气泡 / tab / 统计）。

const aiChatState = {
  chats: [], currentId: '', engineSid: '', source: null,
  sending: false, tab: 'chat', streamText: '', streamTrace: [],
  stats: { turns: 0, steps: 0 }, attachments: [], bound: false,
  lastDone: false,
};

function achStatus(text, busy = false) {
  const el = $('#ach-status');
  if (!el) return;
  el.textContent = text || '';
  const stop = $('#ach-stop');
  if (stop) stop.hidden = !busy;
  const send = $('#ach-send');
  if (send) { send.disabled = busy; send.textContent = busy ? '生成中…' : '发送 ↑'; }
}

function achStatsText() {
  const el = $('#ach-stats');
  if (!el) return;
  const s = aiChatState.stats || {};
  el.textContent = `${s.turns || 0} 轮 · ${s.steps || 0} 步 · — tok/s · 上下文 —`;
}

function achMessageHtml(m) {
  const mine = m && m.role === 'user';
  const content = String((m && m.content) || '');
  const attachments = ((m && m.attachments) || []).map((a) => (
    a && a.kind === 'image' && a.data && /^data:image\//.test(a.data)
      ? `<a href="${esc(a.data)}" target="_blank" rel="noopener" class="ops-msg-image"><img src="${esc(a.data)}" alt="${esc(a.name)}" /></a>`
      : `<div class="ops-msg-file"><span>▤</span><span>${esc((a && a.name) || 'file')}</span></div>`
  )).join('');
  const err = m && m.error ? `<div class="ops-msg-error">失败：${esc(m.error)}</div>` : '';
  const hasTrace = !mine && Array.isArray(m && m.trace) && m.trace.length;
  const traceBtn = hasTrace ? `<button class="ach-msg-trace" type="button" data-ach-viewtrace="${esc(m.id || '')}" title="查看工具调用轨迹">轨迹 · ${m.trace.length} 步</button>` : '';
  const meta = mine
    ? `<div class="ops-msg-meta muted small">${esc(fmtTime(m.at))}</div>`
    : `<div class="ops-msg-meta muted small">${esc(fmtTime(m.at))}${m.model ? ' · ' + esc(m.model) : ''}</div>`;
  return `<div class="ops-msg ${mine ? 'mine' : 'ai'}">
    <div class="ops-msg-avatar">${mine ? '我' : '✧'}</div>
    <div class="ops-msg-body">
      ${attachments ? `<div class="ops-msg-attachments">${attachments}</div>` : ''}
      <div class="ops-msg-text ach-msg-text">${esc(content || (mine ? '' : '（无文本输出）'))}</div>
      ${err}${traceBtn}${meta}
    </div>
  </div>`;
}

function achRenderMessages(messages, scroll = true) {
  const box = $('#ach-msgs');
  if (!box) return;
  const list = Array.isArray(messages) ? messages : [];
  box.innerHTML = list.length
    ? list.map(achMessageHtml).join('')
    : '<div class="empty">输入问题开始对话，DeepSeek Harness 会在工作区里分析并执行</div>';
  box.querySelectorAll('[data-ach-viewtrace]').forEach((b) => b.addEventListener('click', () => achSwitchTab('trace')));
  if (scroll) box.scrollTop = box.scrollHeight;
}

function achRenderTrace() {
  const box = $('#ach-trace');
  if (!box) return;
  const events = aiChatState.streamTrace.slice();
  if (!events.length) {
    box.innerHTML = '<div class="empty">暂无轨迹。发送消息后可查看每一轮的工具调用与状态。</div>';
    return;
  }
  box.innerHTML = events.map((ev) => {
    const phase = String((ev && ev.phase) || (ev && ev.type) || 'event');
    const detail = ev && ev.text ? String(ev.text).slice(0, 600) : JSON.stringify(ev || {});
    return `<div class="ach-trace-row"><span class="badge">${esc(phase)}</span><pre class="log">${esc(detail)}</pre></div>`;
  }).join('');
}

function achSwitchTab(tab) {
  aiChatState.tab = tab;
  $$('.aichat-tab').forEach((b) => b.classList.toggle('active', b.dataset.achTab === tab));
  const msgs = $('#ach-msgs'); const trace = $('#ach-trace');
  if (msgs) msgs.hidden = tab !== 'chat';
  if (trace) { trace.hidden = tab !== 'trace'; if (tab === 'trace') achRenderTrace(); }
}

function achRenderSessions() {
  const box = $('#ach-sessions');
  if (!box) return;
  box.innerHTML = aiChatState.chats.length ? aiChatState.chats.map((s) => `
    <div class="ops-session ${s.id === aiChatState.currentId ? 'active' : ''}" data-ach-session="${esc(s.id)}">
      <div class="ops-session-title">${esc(s.title || '新会话')}</div>
      <div class="ops-session-meta muted small">${esc(fmtTime(s.updatedAt))} · ${s.messageCount || 0} 条</div>
    </div>`).join('') : '<div class="empty">还没有会话，点「＋ 新会话」开始</div>';
  box.querySelectorAll('[data-ach-session]').forEach((b) => b.addEventListener('click', () => openAIChat(b.dataset.achSession)));
}

async function achLoadSessions(preferId = '') {
  try {
    const d = await api('/ai/chats');
    aiChatState.chats = d.items || [];
    const wanted = preferId || aiChatState.currentId;
    if (wanted && aiChatState.chats.some((s) => s.id === wanted)) {
      if (wanted === aiChatState.currentId) { achRenderSessions(); return; }
      return openAIChat(wanted);
    }
    if (aiChatState.chats.length) return openAIChat(aiChatState.chats[0].id);
    aiChatState.currentId = ''; aiChatState.engineSid = '';
    achRenderSessions(); achRenderMessages([]);
    const t = $('#ach-title'); if (t) t.textContent = '新会话';
    const sub = $('#ach-sub'); if (sub) sub.textContent = '点「＋ 新会话」开始对话';
  } catch (e) { toast(e.message, true); }
}

function achCloseSource() {
  if (aiChatState.source) { try { aiChatState.source.close(); } catch { /* noop */ } aiChatState.source = null; }
}

async function openAIChat(id, selectionOverride = '') {
  achCloseSource();
  try {
    const picked = achParseSelection(selectionOverride);
    const opened = await api(`/ai/chats/${encodeURIComponent(id)}/open`, {
      method: 'POST', body: picked ? { providerId: picked.providerId, model: picked.model } : {},
    });
    const detailData = await api(`/ai/chats/${encodeURIComponent(id)}`);
    aiChatState.currentId = id;
    aiChatState.engineSid = opened.engineSid || '';
    aiChatState.streamText = ''; aiChatState.streamTrace = [];
    aiChatState.stats = Object.assign({ turns: 0, steps: 0 }, detailData.stats || {});
    const sel = $('#ach-provider');
    if (sel) {
      const wanted = `${opened.providerId || ''}::${opened.model || ''}`;
      const has = Array.from(sel.options).some((o) => o.value === wanted);
      sel.value = has ? wanted : (Array.from(sel.options).some((o) => o.value === `${opened.providerId || ''}::`) ? `${opened.providerId || ''}::` : '');
    }
    const t = $('#ach-title'); if (t) t.textContent = detailData.title || '新会话';
    const sub = $('#ach-sub'); if (sub) sub.textContent = `${detailData.messageCount || 0} 条消息 · 会话已留存`;
    achStatsText();
    achRenderMessages(detailData.messages);
    achRenderSessions();
    achSwitchTab(aiChatState.tab || 'chat');
  } catch (e) { toast(e.message, true); }
}

function createAIChat() {
  // 与 AI 运维一致：草稿态，发送第一条消息时才真正创建会话。
  achCloseSource();
  aiChatState.currentId = '';
  aiChatState.engineSid = '';
  aiChatState.streamText = ''; aiChatState.streamTrace = [];
  aiChatState.lastDone = false;
  aiChatState.stats = { turns: 0, steps: 0 };
  aiChatState.attachments = []; achRenderAttachments();
  const t = $('#ach-title'); if (t) t.textContent = '新会话';
  const sub = $('#ach-sub'); if (sub) sub.textContent = '输入第一条消息后自动创建会话';
  achStatsText();
  achRenderMessages([]);
  achRenderSessions();
  achSwitchTab('chat');
  const input = $('#ach-input'); if (input) { input.value = ''; input.focus(); }
}

async function deleteAIChat() {
  if (!aiChatState.currentId) return;
  if (!await confirmDialog({ message: '确认删除当前会话？其中的消息将无法恢复。' })) return;
  try {
    achCloseSource();
    await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}`, { method: 'DELETE' });
    aiChatState.currentId = ''; aiChatState.engineSid = '';
    toast('会话已删除');
    await achLoadSessions();
  } catch (e) { toast(e.message, true); }
}

async function clearAIChat() {
  if (!aiChatState.currentId) return;
  if (!await confirmDialog({ message: '确认清空当前会话的全部消息？（会话本身保留）' })) return;
  try {
    achCloseSource();
    const s = await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}/clear`, { method: 'POST' });
    aiChatState.streamText = ''; aiChatState.streamTrace = [];
    aiChatState.stats = { turns: 0, steps: 0 };
    achRenderMessages(s.messages || []); achStatsText();
    await openAIChat(aiChatState.currentId);
    toast('已清空消息');
  } catch (e) { toast(e.message, true); }
}

async function renameAIChat() {
  if (!aiChatState.currentId) return;
  const title = await promptDialog('会话标题', ($('#ach-title') || {}).textContent || '新会话');
  if (!title || !title.trim()) return;
  try {
    await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}`, { method: 'PUT', body: { title: title.trim() } });
    const t = $('#ach-title'); if (t) t.textContent = title.trim();
    await achLoadSessions(aiChatState.currentId);
    toast('已重命名');
  } catch (e) { toast(e.message, true); }
}

function achReadAttachment(file) {
  return new Promise((resolve, reject) => {
    const name = file.name || 'file';
    const mime = file.type || '';
    const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    if (file.size > 3 * 1024 * 1024) return reject(new Error(`「${name}」超过 3MB`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取「${name}」失败`));
    reader.onload = () => resolve({ name, mime: mime || (isImage ? 'image/png' : 'text/plain'),
      size: file.size, kind: isImage ? 'image' : 'text', data: String(reader.result || '').slice(0, 200000) });
    if (isImage) reader.readAsDataURL(file); else reader.readAsText(file);
  });
}

function achRenderAttachments() {
  const box = $('#ach-attachments');
  if (!box) return;
  box.hidden = !aiChatState.attachments.length;
  box.innerHTML = aiChatState.attachments.map((a, i) => `
    <div class="ops-attach-item"><span class="ops-attach-ico">${a.kind === 'image' ? '▧' : '▤'}</span>
      <span class="ops-attach-name">${esc(a.name)}</span>
      <button class="btn btn-ghost btn-sm" type="button" data-ach-attach-del="${i}">✕</button></div>`).join('');
  box.querySelectorAll('[data-ach-attach-del]').forEach((b) => b.addEventListener('click', () => {
    aiChatState.attachments.splice(Number(b.dataset.achAttachDel), 1);
    achRenderAttachments();
  }));
}

async function sendAIChatMessage() {
  if (aiChatState.sending) return;
  const input = $('#ach-input');
  const content = (input ? input.value : '').trim();
  if (!content) { toast('请输入内容', true); return; }
  // 在任何 await 之前抢锁：否则双击会在锁置位前并发进入，建出两个会话/发两条消息。
  aiChatState.sending = true;
  if (!aiChatState.currentId) {
    try {
      const p = achCurrentSelection();
      const s = await api('/ai/chats', { method: 'POST', body: { providerId: p.providerId, model: p.model } });
      aiChatState.currentId = s.id; await achLoadSessions(s.id);
    } catch (e) { aiChatState.sending = false; toast(e.message, true); return; }
  }

  aiChatState.streamText = '';
  aiChatState.streamTrace = [];
  aiChatState.lastDone = false;
  if (input) input.value = '';
  const attachments = aiChatState.attachments.slice();
  aiChatState.attachments = []; achRenderAttachments();

  const box = $('#ach-msgs');
  if (box) {
    if (box.querySelector('.empty')) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', achMessageHtml({ role: 'user', content, attachments, at: new Date().toISOString() }));
    box.insertAdjacentHTML('beforeend', '<div class="ops-msg ai" id="ach-pending"><div class="ops-msg-avatar">✧</div><div class="ops-msg-body"><div class="ops-msg-text ach-msg-text ach-typing">正在工作区里分析并执行…</div></div></div>');
    box.scrollTop = box.scrollHeight;
  }
  achStatus('DeepSeek Harness 正在执行，可切换到「轨迹」查看步骤', true);

  // 先打开会话拿到引擎 sid，再订阅结构化事件流。
  let engineSid = aiChatState.engineSid;
  try {
    const p = achCurrentSelection();
    const opened = await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}/open`, {
      method: 'POST', body: p.providerId ? { providerId: p.providerId, model: p.model } : {},
    });
    engineSid = opened.engineSid || engineSid;
    aiChatState.engineSid = engineSid;
    achCloseSource();
    aiChatState.source = new EventSource(`/api/ai/chats/stream?sid=${encodeURIComponent(engineSid)}${streamToken()}`);
    aiChatState.source.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.type === 'session') return;
      if (d.type === 'echo') return;
      if (d.type === 'status') {
        aiChatState.streamTrace.push(d);
        if (d.phase === 'step_start') { aiChatState.stats.steps = (aiChatState.stats.steps || 0) + 1; achStatsText(); }
        if (d.phase === 'turn_start') { aiChatState.stats.turns = Math.max(aiChatState.stats.turns || 0, Number(d.turn) || 0); achStatsText(); }
      } else if (d.type === 'reasoning') {
        aiChatState.streamTrace.push(d);
      } else if (d.type === 'text') {
        aiChatState.streamText += String(d.text || '');
        const pendingText = $('#ach-pending .ach-msg-text');
        if (pendingText) { pendingText.classList.remove('ach-typing'); pendingText.textContent = aiChatState.streamText; }
        if (box) box.scrollTop = box.scrollHeight;
      } else if (d.type === 'final') {
        if (d.reason && d.reason.kind === 'error') {
          const msg = (d.reason.error && d.reason.error.message) || '执行失败';
          aiChatState.streamText = aiChatState.streamText || `失败：${msg}`;
        } else if (d.text && !aiChatState.streamText) {
          aiChatState.streamText = String(d.text);
        }
        const pendingText = $('#ach-pending .ach-msg-text');
        if (pendingText) pendingText.textContent = aiChatState.streamText;
      } else if (d.type === 'done') {
        aiChatState.lastDone = true;
      }
      if (aiChatState.tab === 'trace') achRenderTrace();
    };
    aiChatState.source.onerror = () => { /* SSE 结束由 done / close 处理 */ };
  } catch (e) { /* 订阅失败仍继续发送，落库后刷新即可看到结果 */ }

  try {
    const d = await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}/send`, {
      method: 'POST', body: { content },
    });
    const pending = $('#ach-pending');
    if (pending) pending.outerHTML = achMessageHtml(d.assistantMessage);
    else if (box) box.insertAdjacentHTML('beforeend', achMessageHtml(d.assistantMessage));
    if (d.assistantMessage && d.assistantMessage.error) toast(d.assistantMessage.error, true);
    aiChatState.stats = Object.assign(aiChatState.stats || {}, (d.session && d.session.stats) || {});
    achStatsText();
    await achLoadSessions(aiChatState.currentId);
    achStatus('');
  } catch (e) {
    const pending = $('#ach-pending');
    if (pending) pending.outerHTML = achMessageHtml({ role: 'assistant', content: '', error: e.message, at: new Date().toISOString() });
    toast(e.message, true);
    achStatus('发送失败');
  } finally {
    aiChatState.sending = false;
    achCloseSource();
    achStatus('');
  }
}

/** 解析「providerId::model」选择值；空/无模型时返回 null。 */
function achParseSelection(value) {
  const v = String(value || '');
  if (!v) return null;
  const i = v.indexOf('::');
  return { providerId: i < 0 ? v : v.slice(0, i), model: i < 0 ? '' : v.slice(i + 2) };
}

/** 当前下拉框选中的服务 + 模型。 */
function achCurrentSelection() {
  const sel = $('#ach-provider');
  return achParseSelection(sel ? sel.value : '') || { providerId: '', model: '' };
}

async function loadAIChat() {
  try {
    const [models, servers] = await Promise.all([api('/ai/models'), api('/servers')]);
    const items = models.items || [];
    const sel = $('#ach-provider');
    if (sel) {
      const prev = sel.value;
      const groups = new Map();
      items.forEach((m) => {
        if (!groups.has(m.providerId)) groups.set(m.providerId, { name: m.providerName, entries: [] });
        groups.get(m.providerId).entries.push(m);
      });
      sel.innerHTML = items.length
        ? Array.from(groups.values()).map((g) => {
            const opts = g.entries.map((m) => `<option value="${esc(m.value)}">${esc(m.label)}</option>`).join('');
            return `<optgroup label="${esc(g.name)}">${opts}</optgroup>`;
          }).join('')
        : '<option value="">（无可用 AI 模型）</option>';
      if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    }
    if (!items.length) toast('尚未配置 AI 模型：请在「AI 模型配置」页添加 API 类型模型并拉取可用模型', true);
    const ws = $('#ach-workspace');
    if (ws) {
      const cur = (servers.items || []).find((s) => s.id === 'local') || (servers.items || [])[0];
      ws.textContent = '工作区 · ' + (cur ? (cur.workspaceDir || cur.name || cur.host || cur.id) : '本机 /workspace');
    }
  } catch (e) { toast(e.message, true); }
  await achLoadSessions();

  if (aiChatState.bound) return;
  aiChatState.bound = true;
  $('#ach-form').addEventListener('submit', (e) => { e.preventDefault(); sendAIChatMessage(); });
  const input = $('#ach-input');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendAIChatMessage(); }
  });
  const modelSel = $('#ach-provider');
  if (modelSel) modelSel.addEventListener('change', async () => {
    if (!aiChatState.currentId) return;
    const p = achCurrentSelection();
    if (!p.providerId) return;
    // 切换模型后立即重建引擎；保留会话消息上下文。
    try {
      await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}/open`, {
        method: 'POST', body: { providerId: p.providerId, model: p.model },
      });
      const detailData = await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}`);
      aiChatState.engineSid = '';
      const sub = $('#ach-sub'); if (sub) sub.textContent = `${detailData.messageCount || 0} 条消息 · 会话已留存`;
      toast(`已切换到模型 ${p.model || p.providerId}：下一条消息起生效`);
    } catch (e) { toast(e.message, true); }
  });
  $('#ach-new').addEventListener('click', createAIChat);
  $('#ach-delete').addEventListener('click', deleteAIChat);
  $('#ach-clear').addEventListener('click', clearAIChat);
  $('#ach-rename').addEventListener('click', renameAIChat);
  $('#ach-stop').addEventListener('click', async () => {
    if (!aiChatState.currentId) return;
    try { await api(`/ai/chats/${encodeURIComponent(aiChatState.currentId)}/interrupt`, { method: 'POST', body: {} }); toast('已请求中断'); }
    catch (e) { toast(e.message, true); }
  });
  $$('.aichat-tab').forEach((b) => b.addEventListener('click', () => achSwitchTab(b.dataset.achTab)));
  $('#ach-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (aiChatState.attachments.length + files.length > 6) { toast('每条消息最多 6 个附件', true); e.target.value = ''; return; }
    for (const file of files) {
      try { aiChatState.attachments.push(await achReadAttachment(file)); }
      catch (err) { toast(err.message, true); }
    }
    e.target.value = ''; achRenderAttachments();
  });
  achStatsText();
}

/* ----------------------------- 扩展 / 数据库 ----------------------------- */
// 清单由后端下发（内置 + data/extensions/*.json），前端只按字段声明渲染表单，
// 不内置任何数据库专属逻辑；新增一种服务只需在后端加一条清单常量。
const extState = {
  catalog: null, items: [], manifestId: '', mode: 'external', defaultMode: 'external',
  backups: [], dbgate: null, reposInstanceId: '',
};
// v0.3.11：DbGate 登录凭据弹窗的复制文本，明文只在用户主动点开弹窗时暂存于内存。
const extCredState = { text: '' };
const repoState = { items: [] };
const dockerState = { target: 'local', data: null, tab: 'containers' };

function extManifest(id) {
  const items = (extState.catalog && extState.catalog.items) || [];
  return items.find((m) => m.id === id);
}

function renderExtRuntime(cat) {
  const d = cat && cat.docker;
  const label = $('#ext-runtime');
  const hint = $('#ext-runtime-hint');
  if (!d) {
    label.textContent = '状态未知';
    hint.textContent = '未能读取运行环境信息，可点击「刷新」重试。';
    return;
  }
  const catalogState = extState.catalog || {};
  const remotes = (catalogState.servers || []).length;
  if (d.available) {
    label.textContent = `Docker 可用 · ${d.mode}${d.version ? ` v${d.version}` : ''}${remotes ? ` · 另有 ${remotes} 台可远程安装的服务器` : ''}`;
    hint.textContent = `安装实例会在 ${d.endpoint} 上创建带 devplatform.ext 标签的容器，数据落在命名卷；端口只绑定内网地址。选择「安装到」里的服务器可走 SSH 远程安装，也可切到「外部数据库」只登记连接信息。`;
  } else {
    label.textContent = remotes ? '本机无 Docker · 可远程安装' : 'Docker 不可用';
    hint.textContent = remotes
      ? `${d.hint}。已登记 ${remotes} 台服务器，可在安装表单的「安装到」选择它们，通过 SSH 远程创建容器；本机无需 Docker。若只想登记已有数据库的连接信息，请选「外部数据库」。`
      : `${d.hint}。此时「安装」会默认使用外部连接模式，平台不会创建容器，也不会下载任何程序。`;
  }
}

function renderExtCatalog() {
  const items = (extState.catalog && extState.catalog.items) || [];
  const errors = (extState.catalog && extState.catalog.errors) || [];
  const errorHtml = errors.length
    ? `<div class="empty" style="grid-column:1/-1;text-align:left">自定义清单解析失败（已跳过，不影响其它清单）：<br>${errors.map((e) => esc(e)).join('<br>')}</div>`
    : '';
  $('#ext-catalog').innerHTML = errorHtml + (items.length ? items.map((m) => `
    <div class="ext-card">
      <h3>${esc(m.label)} ${badge(m.kind === 'database' ? '数据库' : m.kind === 'cache' ? '缓存' : '扩展', 'blue')}</h3>
      <p>${esc(m.description || '自定义清单')}</p>
      <div class="ext-meta">${esc(m.image)} · 默认 ${esc(m.port)} · ${esc((m.tags || []).join(' / '))}</div>
      <div class="row">
        <button class="btn btn-primary btn-sm" data-ext-install="${esc(m.id)}">安装</button>
        ${m.builtin ? '' : badge('自定义清单', 'amber')}
      </div>
    </div>`).join('') : '<div class="empty">暂无可用清单</div>');
}

function extStatusMeta(status) {
  return {
    online: ['在线', 'green'], partial: ['待就绪', 'amber'],
    installing: ['安装中', 'amber'], offline: ['离线', 'red'], error: ['异常', 'red'],
  }[status] || ['未知', 'amber'];
}

function renderExtList() {
  const rows = extState.items.map((i) => {
    const meta = extStatusMeta(i.status);
    const db = i.catalogId === 'dbgate';
    const ops = [
      `<button class="btn btn-sm" data-ext-op="connection" data-ext-id="${esc(i.id)}">复制连接串</button>`,
      `<button class="btn btn-sm" data-ext-op="inject" data-ext-id="${esc(i.id)}">注入 .env</button>`,
      `<button class="btn btn-sm" data-ext-op="repos" data-ext-id="${esc(i.id)}">绑定仓库</button>`,
      `<button class="btn btn-sm" data-ext-op="health" data-ext-id="${esc(i.id)}">检测</button>`,
    ];
    if (i.canManage) {
      ops.push(`<button class="btn btn-sm" data-ext-op="start" data-ext-id="${esc(i.id)}">启动</button>`);
      ops.push(`<button class="btn btn-sm" data-ext-op="stop" data-ext-id="${esc(i.id)}">停止</button>`);
      ops.push(`<button class="btn btn-sm" data-ext-op="restart" data-ext-id="${esc(i.id)}">重启</button>`);
      ops.push(`<button class="btn btn-sm" data-ext-op="logs" data-ext-id="${esc(i.id)}">日志</button>`);
    }
    if (i.openable) ops.push(`<button class="btn btn-sm" data-ext-op="credentials" data-ext-id="${esc(i.id)}">登录凭据</button>`);
    if (i.canBackup && !db) ops.push(`<button class="btn btn-sm" data-ext-op="backup" data-ext-id="${esc(i.id)}">备份</button>`);
    if (i.canUpgrade) ops.push(`<button class="btn btn-sm" data-ext-op="upgrade" data-ext-id="${esc(i.id)}">升级</button>`);
    if (i.openable && i.status === 'online') {
      ops.push(`<button class="btn btn-sm btn-primary" data-ext-op="open" data-ext-id="${esc(i.id)}">打开管理界面</button>`);
    }
    ops.push(`<button class="btn btn-sm btn-danger" data-ext-op="remove" data-ext-id="${esc(i.id)}" data-ext-name="${esc(i.name)}">卸载</button>`);
    const repoNote = (i.repoIds || []).length ? `<div class="ext-list-url">已绑定 ${i.repoIds.length} 个仓库</div>` : '';
    return `<tr>
      <td><b>${esc(i.name)}</b><div class="ext-list-url">${esc(i.label)} · ${esc(i.image)}:${esc(i.tag)}</div>${repoNote}</td>
      <td>${i.mode === 'docker' ? badge('容器', 'blue') : badge('外部', 'gray')}<div class="ext-list-url">${esc(i.targetLabel || '本机')}</div></td>
      <td>${esc(i.host)}:${esc(i.port)}</td>
      <td>${badge(meta[0], meta[1])}<div class="ext-list-url">${esc(i.statusDetail || '')}</div></td>
      <td><div class="ext-list-url">${esc(i.connectionMasked || '')}</div>${i.openable ? `<div class="ext-list-url" style="margin-top:5px">登录账号：<b>${esc(i.loginUser || i.user || 'admin')}</b></div>` : ''}<div class="ext-actions" style="margin-top:8px">${ops.join('')}</div></td>
    </tr>`;
  });
  $('#ext-list').innerHTML = table(['实例', '模式 / 位置', '地址', '状态', '连接串与操作'], rows);
}

function renderExtInstallForm() {
  const m = extManifest(extState.manifestId);
  if (!m) return;
  const fields = ((m.forms || {})[extState.mode]) || [];
  const html = fields.map((f) => {
    const value = f.default === undefined || f.default === null ? '' : f.default;
    let input;
    if (f.type === 'tags' || f.type === 'select') {
      const opts = (f.options || []).map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
      }).join('');
      input = `<select class="ui-select" name="${esc(f.key)}">${opts}</select>`;
    } else {
      const type = f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text';
      input = `<input name="${esc(f.key)}" type="${type}" value="${esc(value)}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}" />`;
    }
    return `<label>${esc(f.label)}${input}${f.help ? `<span class="field-help">${esc(f.help)}</span>` : ''}</label>`;
  }).join('');
  const note = extState.mode === 'docker'
    ? '按「安装到」在本机或 SSH 远程服务器创建容器与命名数据卷；首次安装会拉取镜像，也可先用「Docker 管理」离线导入'
    : '只登记地址与凭据，平台不会连接、安装或改动外部服务';
  $('#ext-install-form').innerHTML = `${html}<div class="form-actions"><button class="btn btn-primary" type="submit">创建实例</button><span class="muted">${esc(note)}</span></div>`;
}

function openExtInstall(id) {
  const m = extManifest(id);
  if (!m) return;
  extState.manifestId = id;
  extState.mode = extState.defaultMode;
  const select = $('#ext-mode');
  select.value = extState.mode;
  const cat = extState.catalog || {};
  const docker = cat.docker;
  // 本机没 Docker，但只要登记了服务器就仍可走 SSH 远程安装，不能把 docker 选项置灰。
  const canInstallDocker = Boolean((docker && docker.available) || (cat.servers || []).length);
  const dockerOption = select.querySelector('option[value="docker"]');
  if (dockerOption) dockerOption.disabled = !canInstallDocker;
  if (!canInstallDocker) extState.mode = 'external';
  select.value = extState.mode;
  $('#ext-install-title').textContent = `安装 ${m.label}`;
  renderExtInstallForm();
  openAsModal('ext-install-card');
}

/* ------------------------- 备份 / 升级 / 绑定仓库 ------------------------- */

function renderExtBackups() {
  const rows = extState.backups.map((b) => `<tr>
    <td><b>${esc(b.filename)}</b><div class="ext-list-url">${esc(b.recipeLabel || b.recipe)} · ${esc(b.instanceName)}</div></td>
    <td>${fmtSize(b.size)}</td>
    <td>${esc(b.reason === 'pre-upgrade' ? '升级前自动' : '手动')}</td>
    <td class="muted">${esc(fmtTime(b.createdAt))}</td>
    <td><div class="ext-actions">
      <button class="btn btn-sm" data-bak-op="download" data-bak-id="${esc(b.id)}">下载</button>
      <button class="btn btn-sm" data-bak-op="restore" data-bak-id="${esc(b.id)}" data-bak-name="${esc(b.filename)}">恢复</button>
      <button class="btn btn-sm btn-danger" data-bak-op="delete" data-bak-id="${esc(b.id)}">删除</button>
    </div></td>
  </tr>`);
  $('#ext-backups').innerHTML = table(['存档', '大小', '来源', '时间', '操作'], rows);
}

function renderExtDbGate() {
  const d = extState.dbgate;
  if (!d || !d.installed) {
    $('#ext-dbgate').innerHTML = '尚未安装 DbGate。在上方「可安装的服务」里选择 <b>DbGate 数据库管理</b> 安装后，平台会把所有数据库实例的连接自动同步进去。'
      + ' <button class="btn btn-sm" id="ext-dbgate-sync">刷新状态</button>';
    return;
  }
  const inst = d.instance || {};
  $('#ext-dbgate').innerHTML = `已安装 <b>${esc(inst.name || 'DbGate')}</b> · ${badge(inst.status === 'online' ? '在线' : '待就绪', inst.status === 'online' ? 'green' : 'amber')}`
    + ` · 自动同步 <b>${d.count || 0}</b> 个连接 · 访问地址 <code>http://${esc(inst.host)}:${esc(inst.port)}/</code>`
    + `<div class="ext-actions" style="margin-top:10px">
        <button class="btn btn-sm btn-primary" id="ext-dbgate-open">打开管理界面</button>
        <button class="btn btn-sm" id="ext-dbgate-sync">重新同步连接</button>
      </div>`;
}

function renderExtReposOptions() {
  const id = extState.reposInstanceId;
  const inst = extState.items.find((x) => x.id === id);
  const bound = new Set((inst && inst.repoIds) || []);
  const items = repoState.items;
  if (!items.length) {
    $('#ext-repos-options').innerHTML = '<div class="empty">还没有可用仓库，请先到「Git 仓库」页刷新列表</div>';
    return;
  }
  $('#ext-repos-options').innerHTML = items.map((r) => `
    <label class="check" style="display:block;border:1px solid var(--border);border-radius:8px;padding:8px;margin:0">
      <input type="checkbox" data-ext-repo="${esc(r.id)}"${bound.has(r.id) ? ' checked' : ''} />
      <span>${esc(r.fullName)}</span><div class="ext-list-url">${esc(r.sourceLabel)}</div>
    </label>`).join('');
}

async function openExtRepos(id) {
  extState.reposInstanceId = id;
  // 安全评审 P1-3：等待仓库列表加载完成再渲染，否则首次打开（未访问过仓库页）时
  // repoState.items 为空，会误显示「还没有可用仓库」。
  if (!repoState.items.length) await loadRepos();
  $('#ext-repos-title').textContent = `绑定仓库 · ${id}`;
  renderExtReposOptions();
  openAsModal('ext-repos-card');
}

async function loadExtExtras() {
  try {
    const [backups, dbgate] = await Promise.all([
      api('/extensions/backups'), api('/extensions/dbgate'),
    ]);
    extState.backups = (backups && backups.items) || [];
    extState.dbgate = dbgate || null;
    renderExtBackups();
    renderExtDbGate();
  } catch (e) { toast(e.message, true); }
}

async function loadExtensions() {
  try {
    const [cat, list] = await Promise.all([api('/extensions/catalog'), api('/extensions/instances')]);
    extState.catalog = cat || null;
    extState.items = (list && list.items) || [];
    extState.defaultMode = (cat && cat.defaultMode) || 'external';
    renderExtRuntime(cat);
    renderExtCatalog();
    renderExtList();
    await loadExtExtras();
  } catch (e) { toast(e.message, true); }
}

/* --------------------- 扩展一键体检（v0.3.7） --------------------- */
/** 逐实例展示容器状态 / 端口 / 内部检查 / 日志特征与修复建议。 */
async function runExtDiagnose() {
  const box = $('#ext-diagnose');
  const btn = $('#ext-diagnose-btn');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<div class="hint">正在逐项检测：容器状态、端口连通、内部健康检查与日志特征…</div>';
  if (btn) { btn.disabled = true; btn.textContent = '检测中…'; }
  try {
    const d = await api('/extensions/diagnose', { method: 'POST', body: {} });
    const items = d.items || [];
    const mark = (v) => (v === null || v === undefined)
      ? '<span class="muted">—</span>'
      : (v ? '<span style="color:#15803d">✔</span>' : '<span style="color:#dc2626">✖</span>');
    box.innerHTML = `
      <div class="row gap wrap" style="align-items:center;margin-bottom:10px">
        <b>${esc(d.healthy)} / ${esc(d.total)} 项正常</b>
        <span class="muted small">检测于 ${esc(fmtTime(d.checkedAt))}</span>
        <span class="muted small">${esc((d.compat && d.compat.reason) || '')}</span>
        <button class="btn btn-sm" type="button" data-ext-diag="again">重新检测</button>
        <button class="btn btn-sm btn-ghost" type="button" data-ext-diag="close">收起</button>
      </div>`
      + (items.length ? items.map((r) => `
        <div class="ext-diag-card ${r.healthy ? 'ok' : 'bad'}">
          <div class="row gap wrap" style="align-items:center">
            <b>${esc(r.name)}</b>
            ${badge(r.healthy ? '正常' : '异常', r.healthy ? 'green' : 'red')}
            <span class="muted small">${esc(r.mode)} · ${esc(r.host)}:${esc(r.port)} · ${esc(r.ms)}ms</span>
            ${r.mode === 'docker' ? `<button class="btn btn-sm" type="button" data-ext-rebuild="${esc(r.id)}">重建容器</button>` : ''}
          </div>
          <div class="ext-diag-checks">${(r.checks || []).map((c) => `<span>${mark(c.ok)} ${esc(c.name)} <span class="muted">${esc(c.detail || '')}</span></span>`).join('')}</div>
          ${r.container ? `<div class="muted small">容器 ${esc(r.container.name || r.container.id || r.container.error || '-')} · ${esc(r.container.status || '')} · 退出码 ${esc(r.container.exitCode)} · 重启 ${esc(r.container.restartCount)} 次${r.container.securityOpt ? ' · 兼容模式已启用' : ''}</div>` : ''}
          ${(r.hints || []).map((h) => `<div class="ext-diag-hint">↳ ${esc(h)}</div>`).join('')}
          ${r.envAdvice ? `<div class="row gap" style="margin-top:6px">
            <button class="btn btn-sm btn-primary" type="button" data-ext-env="${esc(r.envAdvice.problem)}" data-ext-env-keys="${esc((r.envAdvice.keys || []).join(','))}">去配置 env · ${esc(r.envAdvice.title)}</button>
            <code class="muted small">${esc((r.envAdvice.keys || []).join(', '))}</code>
          </div>` : ''}
          ${r.logsTail ? `<details class="dk-raw"><summary>日志尾部</summary><pre class="log short">${esc(r.logsTail)}</pre></details>` : ''}
        </div>`).join('') : '<div class="empty">还没有已登记的实例</div>');
    box.querySelectorAll('[data-ext-diag]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.extDiag === 'close') box.hidden = true;
      else runExtDiagnose();
    }));
    box.querySelectorAll('[data-ext-env]').forEach((b) => b.addEventListener('click', () => {
      openEnvConfig(String(b.dataset.extEnvKeys || '').split(',').filter(Boolean), b.dataset.extEnv || '');
    }));
    box.querySelectorAll('[data-ext-rebuild]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.extRebuild;
      if (!await confirmDialog({ message: '将用当前配置重建该实例的容器（数据卷与凭据保留），确认继续？' })) return;
      try {
        toast('正在重建容器…');
        await api(`/extensions/instances/${encodeURIComponent(id)}/rebuild`, { method: 'POST', body: {} });
        toast('容器已重建，正在复检');
        await loadExtensions();
        await runExtDiagnose();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (e) {
    box.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '检测各项功能'; }
  }
}
if ($('#ext-diagnose-btn')) $('#ext-diagnose-btn').addEventListener('click', runExtDiagnose);

/* ------------------------------ 外部 Git 源 ------------------------------ */

async function loadGitSources() {
  try {
    const d = await api('/git-sources');
    gitsrcCache = d.items || [];
    const rows = gitsrcCache.map((s) => `<tr>
      <td><b>${esc(s.label)}</b>${s.builtin ? ' ' + badge('内置', 'blue') : ''}<div class="ext-list-url">${esc(s.baseUrl)}</div></td>
      <td>${esc(s.type)}<div class="ext-list-url">${s.tlsInsecure
        ? `<span style="color:var(--amber)">⚠ 忽略 TLS 校验${s.insecure === 'auto' ? '（全局）' : '（本源）'}</span>`
        : 'TLS 严格校验'}</div></td>
      <td>${s.hasCreds
        ? badge(s.authType === 'password' ? '账号密码' : 'Token', 'green')
          + `<div class="ext-list-url">${esc(s.authType === 'password' ? `${s.username || '-'} / ${s.passwordMasked || '******'}` : (s.tokenMasked || ''))}</div>`
        : badge('未配置', 'amber')}</td>
      <td><div class="ext-actions">
        <button class="btn btn-sm" data-gitsrc-op="test" data-gitsrc-id="${esc(s.id)}">测试连通</button>
        <button class="btn btn-sm" data-gitsrc-op="repos" data-gitsrc-id="${esc(s.id)}">仓库列表</button>
        ${s.builtin ? '' : `<button class="btn btn-sm btn-primary" data-gitsrc-op="edit" data-gitsrc-id="${esc(s.id)}">编辑</button>
          <button class="btn btn-sm" data-collab-open="gitSources|${esc(s.id)}">协作者</button>
          <button class="btn btn-sm btn-danger" data-gitsrc-op="remove" data-gitsrc-id="${esc(s.id)}" data-gitsrc-name="${esc(s.label)}">删除</button>`}
      </div></td>
    </tr>`);
    $('#gitsrc-list').innerHTML = table(['名称 / 地址', '类型', '凭据', '操作'], rows);
  } catch (e) { $('#gitsrc-list').innerHTML = errorBlock(e.message); }
}

/* ------------------------------- Docker 管理 ------------------------------ */

async function loadDocker() {
  try {
    const d = await api(`/docker/overview?target=${encodeURIComponent(dockerState.target)}`);
    dockerState.data = d;
    const servers = d.servers || [];
    const select = $('#docker-target');
    select.innerHTML = '<option value="local">本机 Docker</option>'
      + servers.map((s) => `<option value="server:${esc(s.id)}"${dockerState.target === `server:${s.id}` ? ' selected' : ''}>${esc(s.name)} · ${esc(s.host)}</option>`).join('');
    if (!d.available) {
      $('#docker-status').textContent = `Docker 不可用：${d.error || ''}`;
      $('#docker-hint').textContent = d.hint || '可在「目标」里切换到已登记的 Linux 服务器远程管理';
      $('#docker-stat-grid').innerHTML = '';
      ['containers', 'images', 'volumes', 'networks'].forEach((k) => {
        $(`#docker-${k}`).innerHTML = errorBlock('Docker 不可用', d.hint || '请切换远程目标或检查本机 Docker 服务');
      });
      renderDockerSettings();
      renderDockerTemplates();
      return;
    }
    const c = d.counts || {};
    $('#docker-status').textContent = `Docker ${d.status.version || ''} · ${d.status.endpoint || d.status.mode} · 容器 ${c.containers}（运行 ${c.running} / 平台自建 ${c.owned}）· 镜像 ${c.images} · 卷 ${c.volumes} · 网络 ${c.networks}`;
    $('#docker-hint').textContent = d.policy || '';
    $('#docker-stat-grid').innerHTML = [
      ['容器', c.containers, `运行中 ${c.running} · 平台自建 ${c.owned}`],
      ['镜像', c.images, '本地镜像 / 仓库'],
      ['存储卷', c.volumes, '持久化数据'],
      ['网络', c.networks, '容器互联'],
    ].map(([label, value, sub]) => `
      <div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>
    `).join('');
    renderDockerContainers();
    renderDockerImages();
    renderDockerVolumes();
    renderDockerNetworks();
    renderDockerTemplates();
    renderDockerSettings();
  } catch (e) {
    $('#docker-status').textContent = `加载失败：${e.message}`;
    if ($('#docker-containers')) $('#docker-containers').innerHTML = errorBlock(e.message);
  }
}

function renderDockerContainers() {
  const d = dockerState.data || {};
  const all = Array.isArray(d.containers) ? d.containers : [];
  const keyword = String(($('#docker-container-filter') && $('#docker-container-filter').value) || '').trim().toLowerCase();
  const stateFilter = ($('#docker-container-state') && $('#docker-container-state').value) || 'all';
  const ownedOnly = Boolean($('#docker-owned-only') && $('#docker-owned-only').checked);
  const isRunning = (c) => /running|up/i.test(String(c.state || ''));
  const list = all.filter((c) => {
    if (stateFilter === 'running' && !isRunning(c)) return false;
    if (stateFilter === 'stopped' && isRunning(c)) return false;
    if (ownedOnly && !c.owned) return false;
    if (!keyword) return true;
    return [c.name, c.image, c.status, c.state, (c.ports || []).join(' ')]
      .join(' ').toLowerCase().includes(keyword);
  });
  const count = $('#docker-container-count');
  if (count) count.textContent = `显示 ${list.length} / ${all.length} 个容器`;
  const summary = $('#docker-container-summary');
  if (summary) {
    const running = all.filter(isRunning).length;
    const owned = all.filter((c) => c.owned).length;
    summary.innerHTML = `<span class="chip">共 ${all.length} 个</span>
      <span class="chip">运行中 ${running}</span><span class="chip">已停止 ${all.length - running}</span>
      <span class="chip">平台自建 ${owned}</span>`;
  }
  if (!list.length) {
    $('#docker-containers').innerHTML = `<div class="empty">${all.length ? '没有符合筛选条件的容器' : '暂无容器'}</div>`;
    return;
  }
  const rows = list.map((c) => {
    const id = String(c.id || '');
    const meta = `data-dk-id="${esc(id)}" data-dk-owned="${c.owned ? 1 : 0}" data-dk-name="${esc(c.name || '')}"`;
    const view = [
      `<button class="btn btn-sm" data-dk-op="logs" ${meta}>日志</button>`,
      `<button class="btn btn-sm" data-dk-op="inspect" ${meta}>详情</button>`,
      `<button class="btn btn-sm" data-dk-op="stats" ${meta}>资源</button>`,
      `<button class="btn btn-sm" data-dk-op="term" ${meta}>终端</button>`,
      `<button class="btn btn-sm" data-dk-op="proxy" ${meta}>代理</button>`,
    ];
    const power = isRunning(c)
      ? [`<button class="btn btn-sm" data-dk-op="stop" ${meta}>停止</button>`,
        `<button class="btn btn-sm" data-dk-op="restart" ${meta}>重启</button>`]
      : [`<button class="btn btn-sm" data-dk-op="start" ${meta}>启动</button>`];
    power.push(`<button class="btn btn-sm btn-danger" data-dk-op="remove" ${meta}>删除</button>`);
    // v0.3.6：端口映射动辄几十条，整串塞进单元格会把行撑高、把其它列挤成竖排。
    // 现在只显示前两条 + 总数，完整内容放 title；创建时间独立成列。
    const ports = Array.isArray(c.ports) ? c.ports : [];
    const portsBrief = ports.length
      ? `${ports.slice(0, 2).join(', ')}${ports.length > 2 ? ` … 共 ${ports.length} 项` : ''}`
      : '-';
    return `<tr>
      <td><b class="dk-ellipsis" title="${esc(c.name || id)}">${esc(c.name || id.slice(0, 12) || '(未命名)')}</b><div class="ext-list-url dk-ellipsis" title="${esc(c.image || '')}">${esc(c.image || '-')}</div><div class="ext-list-url dk-ellipsis">${esc(id.slice(0, 12))}</div></td>
      <td>${c.owned ? badge('平台自建', 'blue') : badge('其它', 'gray')}</td>
      <td>${badge(isRunning(c) ? '运行中' : '已停止', isRunning(c) ? 'green' : 'gray')}<div class="ext-list-url dk-ellipsis" title="${esc(c.status || '')}">${esc(c.status || '-')}</div></td>
      <td><div class="dk-ports" title="${esc(ports.join('\n') || '-')}">${esc(portsBrief)}</div></td>
      <td class="muted dk-ellipsis">${esc(fmtTime(c.created))}</td>
      <td class="actions"><div class="dk-ops"><div class="ext-actions">${power.join('')}</div><div class="ext-actions">${view.join('')}</div></div></td>
    </tr>`;
  });
  $('#docker-containers').innerHTML = table(['容器 / 镜像', '归属', '状态', '端口映射', '创建时间', '操作'], rows);
}

const dkFilter = (sel) => { const el = $(sel); return String((el && el.value) || '').trim().toLowerCase(); };
const dkEmpty = (text) => `<div class="empty">${esc(text)}</div>`;
const dkCopyButton = (value, label = '复制') => `<button class="btn btn-sm" data-dk-copy="${esc(value)}">${esc(label)}</button>`;

function renderDockerImages() {
  const d = dockerState.data || {};
  const kw = dkFilter('#docker-image-filter');
  const all = Array.isArray(d.images) ? d.images : [];
  const list = all.filter((i) => !kw || [i.id, i.repository, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(kw));
  const count = $('#docker-image-count');
  if (count) count.textContent = `显示 ${list.length} / ${all.length} 个镜像`;
  const rows = list.map((i) => {
    const id = String(i.id || '');
    const tags = (Array.isArray(i.tags) ? i.tags : []).filter(Boolean);
    const ref = tags[0] || i.repository || id;
    return `<tr>
      <td><b class="dk-ellipsis" title="${esc(ref)}">${esc(tags.join(', ') || i.repository || id.slice(0, 19) || '(未命名)')}</b><div class="ext-list-url dk-ellipsis">${esc(id.slice(0, 24))}</div></td>
      <td>${typeof i.size === 'number' ? fmtSize(i.size) : esc(i.size || '-')}</td>
      <td class="muted">${esc(fmtTime(i.created))}</td>
      <td><div class="ext-actions">
        ${dkCopyButton(ref, '复制引用')}
        <button class="btn btn-sm" data-dk-op="export" data-dk-ref="${esc(ref)}">导出</button>
        <button class="btn btn-sm btn-danger" data-dk-op="rmi" data-dk-ref="${esc(ref)}">删除</button>
      </div></td>
    </tr>`;
  });
  $('#docker-images').innerHTML = rows.length
    ? table(['镜像 / 标签', '大小', '创建时间', '操作'], rows)
    : dkEmpty(all.length ? '没有符合筛选条件的镜像' : '暂无本地镜像，可在上方从仓库拉取');
}

function renderDockerVolumes() {
  const all = ((dockerState.data || {}).volumes) || [];
  const kw = dkFilter('#docker-volume-filter');
  const list = all.filter((v) => !kw || [v.name, v.driver, v.mountpoint].join(' ').toLowerCase().includes(kw));
  const count = $('#docker-volume-count');
  if (count) count.textContent = `显示 ${list.length} / ${all.length} 个存储卷`;
  const rows = list.map((v) => `<tr>
    <td><b>${esc(v.name)}</b>${v.owned ? ' ' + badge('平台自建', 'blue') : ''}</td>
    <td>${esc(v.driver || '-')}</td>
    <td><div class="ext-list-url dk-ellipsis" title="${esc(v.mountpoint || '')}">${esc(v.mountpoint || '-')}</div></td>
    <td class="muted">${esc(fmtTime(v.created))}</td>
    <td><div class="ext-actions">
      ${dkCopyButton(v.mountpoint || '', '复制挂载点')}
      <button class="btn btn-sm btn-danger" data-dk-op="rmvol" data-dk-ref="${esc(v.name)}">删除</button>
    </div></td>
  </tr>`);
  $('#docker-volumes').innerHTML = rows.length
    ? table(['存储卷', '驱动', '挂载点', '创建时间', '操作'], rows)
    : dkEmpty(all.length ? '没有符合筛选条件的存储卷' : '暂无命名卷，可在上方创建');
}

function renderDockerNetworks() {
  const all = ((dockerState.data || {}).networks) || [];
  const kw = dkFilter('#docker-network-filter');
  const list = all.filter((n) => !kw || [n.name, n.driver, n.subnet, n.gateway].join(' ').toLowerCase().includes(kw));
  const count = $('#docker-network-count');
  if (count) count.textContent = `显示 ${list.length} / ${all.length} 个网络`;
  const rows = list.map((n) => `<tr>
    <td><b>${esc(n.name)}</b>${n.builtin ? ' ' + badge('内置', 'gray') : ''}${n.internal ? ' ' + badge('仅内部', 'amber') : ''}</td>
    <td>${esc(n.driver || '-')} <span class="muted small">${esc(n.scope || '')}</span></td>
    <td><div class="ext-list-url dk-ellipsis">${esc(n.subnet || '-')}</div>${n.gateway ? `<div class="ext-list-url">网关 ${esc(n.gateway)}</div>` : ''}</td>
    <td>${esc(n.containers || 0)} 个</td>
    <td>${n.builtin ? '<span class="muted small">不可删除</span>'
      : `<button class="btn btn-sm btn-danger" data-dk-op="rmnet" data-dk-ref="${esc(n.id || n.name)}">删除</button>`}</td>
  </tr>`);
  $('#docker-networks').innerHTML = rows.length
    ? table(['网络', '驱动 / 作用域', '子网 / 网关', '已接入容器', '操作'], rows)
    : dkEmpty(all.length ? '没有符合筛选条件的网络' : '暂无自定义网络');
}

async function renderDockerTemplates() {
  try {
    const [tpl, audit] = await Promise.all([api('/docker/templates'), api('/docker/audit')]);
    dockerState.templates = tpl.items || [];
    const rows = dockerState.templates.map((t) => `<tr>
      <td><b>${esc(t.name)}</b></td><td>${t.lines} 行</td><td>${esc(t.description || '-')}</td>
      <td class="muted">${esc(fmtTime(t.updatedAt))}</td>
      <td><div class="ext-actions">
        <button class="btn btn-sm" data-dk-tpl-load="${esc(t.id)}">载入</button>
        <button class="btn btn-sm" data-dk-tpl-copy="${esc(t.id)}">复制</button>
        <button class="btn btn-sm" data-dk-tpl-download="${esc(t.id)}">下载</button>
        <button class="btn btn-sm btn-danger" data-dk-op="rmtpl" data-dk-ref="${esc(t.id)}">删除</button>
      </div></td>
    </tr>`);
    $('#docker-templates').innerHTML = rows.length
      ? table(['模板', '规模', '说明', '更新时间', '操作'], rows)
      : dkEmpty('还没有编排模板，可点上方「快速套用」生成一份');
    $('#docker-audit').innerHTML = table(['时间', '操作', '目标', '对象', '确认'], (audit.items || []).map((a) => `<tr>
      <td class="muted">${esc(fmtTime(a.at))}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td>
      <td>${esc(a.object)}</td><td>${a.confirmed ? '是' : '否'}</td>
    </tr>`));
  } catch (e) { toast(e.message, true); }
}

function renderDockerSettings() {
  const d = dockerState.data || {};
  const s = d.status || {};
  const rows = [
    ['当前目标', d.target || dockerState.target],
    ['连接状态', d.available === false ? '不可用' : '已连接'],
    ['Docker 版本', s.version || '-'],
    ['端点 / 模式', s.endpoint || s.mode || '-'],
    ['镜像加速前缀', d.imagePrefix || '未设置（直连 Docker Hub）'],
    ['离线导入目录', 'data/images/（大镜像放这里，用「服务器上已有路径」导入）'],
    ['安全策略', d.policy || '非平台容器只读；写操作二次确认'],
  ];
  $('#docker-settings').innerHTML = `<div class="dk-kv-list">${rows.map(([k, v]) => `
    <div class="dk-kv-row"><span class="dk-kv-key">${esc(k)}</span><span class="dk-kv-val">${esc(v)}</span></div>`).join('')}</div>`;
  const prefixBox = $('#docker-image-prefix');
  if (prefixBox) prefixBox.innerHTML = rows.slice(4, 5).map(([k, v]) => `
    <div class="dk-kv-row"><span class="dk-kv-key">${esc(k)}</span><span class="dk-kv-val">${esc(v)}</span></div>`).join('');
  $('#docker-raw').textContent = JSON.stringify({
    target: d.target, status: s, counts: d.counts, policy: d.policy,
    imagePrefix: d.imagePrefix || '', importDir: 'data/images/', remoteTmp: '服务器绝对路径',
  }, null, 2);
}

/** 兼容旧调用：现在每个 Docker 分区都是独立标签页。 */
function switchDockerTab(tab) {
  const map = {
    containers: 'docker-containers', images: 'docker-images',
    volumes: 'docker-volumes', networks: 'docker-networks',
    templates: 'docker-compose', settings: 'docker',
  };
  dockerState.tab = tab;
  switchView(map[tab] || 'docker');
}

/* ------------------------- Docker 应用商店（移植宝塔 appstore） ------------------------- */
const daState = {
  apps: [], types: [], type: '', search: '', current: null, version: '',
  accelerator: null, page: 1, pageSize: 60, total: 0,
};

async function loadDockerApps() {
  await Promise.all([loadDockerAppList(), loadDockerAppMeta()]);
}

async function loadDockerAppMeta() {
  try {
    const [status, types] = await Promise.all([
      api('/docker/apps/status'), api('/docker/apps/types'),
    ]);
    daState.types = types || [];
    daState.accelerator = status && status.accelerator;
    const acc = daState.accelerator || {};
    const tag = $('#da-mirror-tag');
    if (tag) {
      tag.textContent = acc.mode === 'compose'
        ? `加速器：改写 compose（${acc.mirror || '原始镜像'}）`
        : `加速器：宝塔方式（${acc.accelerateUrl || '未设置'}）`;
    }
    const box = $('#da-status');
    if (box) box.textContent = `内置 ${status && status.count || 0} 个应用 · 目录 ${status && status.appsDir || 'appstore/apps'} · 全量兼容宝塔 aaPanel/appstore 官方数据`;
    renderDockerAppCats();
  } catch (e) { /* toast 由 api() 统一处理 */ }
}

async function loadDockerAppList() {
  const grid = $('#da-grid');
  const params = new URLSearchParams();
  if (daState.type) params.set('type', daState.type);
  if (daState.search) params.set('search', daState.search);
  params.set('page', String(daState.page));
  params.set('pageSize', String(daState.pageSize));
  try {
    const data = await api('/docker/apps?' + params.toString());
    daState.apps = (data && data.list) || [];
    daState.total = (data && data.total) || 0;
    const all = $('#da-cnt-all');
    if (all) all.textContent = String(daState.total);
    renderDockerAppGrid();
    renderDockerAppPager();
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="muted" style="padding:24px">应用加载失败，请点「重载目录」重试。</div>';
  }
}

function renderDockerAppPager() {
  const box = $('#da-pager');
  if (!box) return;
  const pages = Math.max(1, Math.ceil(daState.total / daState.pageSize));
  if (pages <= 1) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const btn = (p, label, active, disabled) => `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}" data-da-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const parts = [];
  parts.push(btn(Math.max(1, daState.page - 1), '‹ 上一页', false, daState.page <= 1));
  // 简化的页码窗口：当前页 ±2
  const start = Math.max(1, daState.page - 2);
  const end = Math.min(pages, daState.page + 2);
  for (let p = start; p <= end; p += 1) parts.push(btn(p, String(p), p === daState.page, false));
  parts.push(btn(Math.min(pages, daState.page + 1), '下一页 ›', false, daState.page >= pages));
  parts.push(`<span class="muted small" style="margin-left:8px">第 ${daState.page}/${pages} 页 · 共 ${daState.total} 个</span>`);
  box.innerHTML = parts.join('');
}

function renderDockerAppCats() {
  const box = $('#da-cats');
  if (!box) return;
  const allActive = daState.type ? '' : ' active';
  box.innerHTML = daState.types.map((t) => {
    const active = daState.type === t.type ? ' active' : '';
    return `<div class="da-cat${active}" data-da-type="${escAttr(t.type)}"><span>${escText(t.typeCN || t.type)}</span><span class="da-cnt">${t.count}</span></div>`;
  }).join('');
  const allBtn = document.querySelector('.da-cat-all');
  if (allBtn) allBtn.className = 'da-cat da-cat-all' + allActive;
}

function renderDockerAppGrid() {
  const grid = $('#da-grid');
  const empty = $('#da-empty');
  if (!grid) return;
  const apps = daState.apps;
  if (empty) empty.hidden = apps.length > 0;
  grid.innerHTML = apps.map((a) => {
    const initial = escText((a.apptitle || a.appname || '?').slice(0, 1).toUpperCase());
    const icon = a.icon
      ? `<img src="/api/docker/apps/${encodeURIComponent(a.appname)}/icon/${encodeURIComponent(a.icon)}" alt="" />`
      : initial;
    return `<div class="da-card" data-da-app="${escAttr(a.appname)}" tabindex="0" role="button">
      <div class="da-card-head">
        <div class="da-card-icon">${icon}</div>
        <div class="da-card-title"><b>${escText(a.apptitle || a.appname)}</b><span class="da-card-type">${escText(a.appTypeCN || a.apptype)}</span></div>
      </div>
      <p class="da-card-desc">${escText(a.appdesc || '')}</p>
      <div class="da-card-foot"><span class="muted small">${(a.versions || []).length} 个版本</span><span class="da-card-go">详情 ▸</span></div>
    </div>`;
  }).join('');
}

async function openDockerApp(name) {
  try {
    const app = await api('/docker/apps/' + encodeURIComponent(name));
    daState.current = app;
    daState.version = (app.versions && app.versions[0]) || 'latest';
    $('#da-modal-title').textContent = app.apptitle || app.appname;
    $('#da-modal-sub').textContent = `${app.appTypeCN || app.apptype} · ${app.appname}`;
    const icon = $('#da-modal-icon');
    if (app.icon) icon.innerHTML = `<img src="/api/docker/apps/${encodeURIComponent(app.appname)}/icon/${encodeURIComponent(app.icon)}" alt="" />`;
    else icon.textContent = (app.apptitle || app.appname || '?').slice(0, 1).toUpperCase();
    $('#da-modal-desc').textContent = app.appdesc || '';
    const links = [];
    if (app.home) links.push(`<a href="${escAttr(app.home)}" target="_blank" rel="noopener">官网 ↗</a>`);
    if (app.help) links.push(`<a href="${escAttr(app.help)}" target="_blank" rel="noopener">文档 ↗</a>`);
    $('#da-modal-links').innerHTML = links.join('');
    const dep = $('#da-modal-depend');
    if (app.depend && app.depend.length) {
      dep.hidden = false;
      dep.textContent = '依赖应用：' + app.depend.map((d) => (d.appname || []).join('/')).join('、') + '（请先部署依赖）';
    } else dep.hidden = true;
    const vs = $('#da-version');
    vs.innerHTML = (app.versions || ['latest']).map((v) => `<option value="${escAttr(v)}">${escText(v)}</option>`).join('');
    vs.value = daState.version;
    renderDaForm(app.field || []);
    await refreshDaCompose();
    // 重置部署面板状态（上一次的日志和按钮状态）
    const dp = $('#da-deploy-panel'); if (dp) dp.hidden = true;
    const deployLog = $('#da-deploy-log'); if (deployLog) { deployLog.textContent = '—'; deployLog.style.display = 'none'; }
    if ($('#da-deploy-btn')) {
      $('#da-deploy-btn').disabled = false;
      $('#da-deploy-btn').textContent = '部署到服务器';
      $('#da-deploy-btn').classList.add('da-deploy-pending');
      $('#da-deploy-btn').title = '生成部署文件后即可部署';
    }
    if ($('#da-deploy-dir')) $('#da-deploy-dir').value = '';
    loadDaServers();
    $('#da-modal').hidden = false;
    document.body.style.overflow = 'hidden';
  } catch (e) { /* api() 已提示 */ }
}

// 官方 field.suffix 是宝塔创建弹窗里每项配置右侧的说明；尾部为运行时上限
// 留空（如「0为不限制,最大可用核心数为: 」）。本平台部署目标机不固定，不能拿
// 自身资源冒充，补通用文案避免显示半句话。
function daFieldHelp(f) {
  let s = String((f && (f.suffix || f.desc)) || '').trim();
  if (/[:：]\s*$/.test(s)) {
    if (/核心|cpu|内存|memory/i.test(s)) s += '取决于目标主机实际配置';
    else s += '（以目标主机实际配置为准）';
  }
  const unit = String((f && f.unit) || '').trim();
  if (unit) s += (s ? ' · ' : '') + '单位：' + unit;
  return s;
}

function renderDaForm(fields) {
  const box = $('#da-form-fields');
  if (!box) return;
  if (!fields.length) {
    box.innerHTML = '<div class="muted small" style="padding:8px 0">该应用无需额外参数，使用模板默认值即可。</div>';
    return;
  }
  box.innerHTML = fields.map((f) => {
    const attr = escAttr(f.attr || f.key || '');
    const type = String(f.type || 'text');
    const isCheck = type === 'checkbox';
    const isArea = type === 'textarea' || type === 'ace:json';
    // 官方 default 可能是 0 / false，不能用 `|| ''` 兜底，否则默认值被吞掉
    const raw = f.default === undefined || f.default === null ? '' : String(f.default);
    let input;
    if (isCheck) {
      const on = f.default === true || f.default === 1 || /^(1|true|yes)$/i.test(raw);
      input = `<input type="checkbox" data-da-field="${attr}" data-da-kind="checkbox" ${on ? 'checked' : ''} />`;
    } else if (isArea) {
      input = `<textarea rows="2" data-da-field="${attr}" placeholder="${escAttr(f.name || attr)}">${escText(raw)}</textarea>`;
    } else {
      const inputType = type === 'password' ? 'password' : (type === 'number' || type === 'port') ? 'number' : 'text';
      input = `<input type="${inputType}" data-da-field="${attr}" value="${escAttr(raw)}" placeholder="${escAttr(f.name || attr)}" />`;
    }
    const help = daFieldHelp(f);
    return `<div class="da-field-row">
      <div class="da-field-name" title="${escAttr(f.name || attr)}">${escText(f.name || attr)}</div>
      <div class="da-field-input">${input}</div>
      <div class="da-field-help">${help ? `<span class="da-help-mark">*</span>${escText(help)}` : ''}</div>
    </div>`;
  }).join('');
}

function collectDaParams() {
  const params = {};
  $$('#da-form-fields [data-da-field]').forEach((el) => {
    const attr = el.getAttribute('data-da-field');
    params[attr] = el.getAttribute('data-da-kind') === 'checkbox'
      ? (el.checked ? 'true' : 'false') : el.value;
  });
  return params;
}

async function refreshDaCompose() {
  if (!daState.current) return;
  const name = daState.current.appname;
  const ver = ($('#da-version') && $('#da-version').value) || daState.version;
  daState.version = ver;
  try {
    const data = await api('/docker/apps/' + encodeURIComponent(name) + '/compose?version=' + encodeURIComponent(ver));
    $('#da-compose').textContent = data.compose || '（无 compose 内容）';
    // 基础 .env 先展示；点「生成部署文件」后合并表单参数
    $('#da-env').textContent = data.env || '（无 .env 内容）';
  } catch (e) { $('#da-compose').textContent = 'compose 加载失败'; }
}

async function generateDaFiles() {
  if (!daState.current) return;
  try {
    const params = collectDaParams();
    const data = await api('/docker/apps/' + encodeURIComponent(daState.current.appname) + '/prepare', {
      method: 'POST',
      body: { version: daState.version, params },
    });
    $('#da-compose').textContent = data.compose || '';
    $('#da-env').textContent = data.env || '';
    // 生成后解锁部署按钮（移除半透明 pending 状态）
    if ($('#da-deploy-btn')) {
      $('#da-deploy-btn').classList.remove('da-deploy-pending');
      $('#da-deploy-btn').title = '部署到已选服务器';
    }
    const dp = $('#da-deploy-panel');
    if (dp) dp.hidden = false;
    toast('部署文件已生成：复制、下载或一键部署到服务器');
  } catch (e) { /* api() 已提示 */ }
}

function dlText(filename, text) {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text || '');
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function deployDaToServer() {
  const btn = $('#da-deploy-btn');
  // 未生成部署文件时点击给用户明确提示（按钮无 disabled，靠 pending class 区分）
  if (btn && btn.classList.contains('da-deploy-pending')) {
    toast('请先点「生成部署文件」，再执行部署');
    return;
  }
  const serverId = $('#da-deploy-server') && $('#da-deploy-server').value;
  if (!serverId) { toast('请先选择目标服务器'); return; }
  if (!daState.current) return;
  const compose = $('#da-compose') && $('#da-compose').textContent || '';
  const env = $('#da-env') && $('#da-env').textContent || '';
  if (!compose || compose === '—') { toast('请先生成部署文件'); return; }
  const dir = ($('#da-deploy-dir') && $('#da-deploy-dir').value.trim()) || '';
  const logBox = $('#da-deploy-log');
  if (logBox) { logBox.style.display = 'block'; logBox.textContent = '部署中，请稍候…'; }
  const deployBtn = $('#da-deploy-btn');
  if (deployBtn) { deployBtn.disabled = true; deployBtn.textContent = '部署中…'; deployBtn.classList.remove('da-deploy-pending'); }
  try {
    const data = await api('/docker/apps/' + encodeURIComponent(daState.current.appname) + '/deploy', {
      method: 'POST',
      body: { serverId, compose, env, dir },
      timeout: 200000,
    });
    const steps = (data.log || []).map((l) => {
      const out = [l.out, l.err].filter(Boolean).join('\n').trim();
      return `[${l.step}]\n${out || '(无输出)'}`;
    }).join('\n\n');
    if (logBox) logBox.textContent = `✔ 部署完成 → ${data.server}:${data.dir}\n\n${steps}`;
    toast(`已在 ${data.server} 成功部署 ${daState.current.apptitle || daState.current.appname}`);
  } catch (e) {
    if (logBox) logBox.textContent = '✖ 部署失败：' + (e && e.message || String(e));
  } finally {
    if (deployBtn) { deployBtn.disabled = false; deployBtn.textContent = '部署到服务器'; }
  }
}

// 加载服务器列表到部署下拉框；固定第一项为「本机」（serverId=local，直接 spawn，无需 SSH）
async function loadDaServers() {
  const sel = $('#da-deploy-server');
  if (!sel) return;
  try {
    const srvData = await api('/servers');
    const servers = (srvData && srvData.items) || [];
    // 本机始终是第一个选项，无需服务器配置也能用
    const opts = ['<option value="local">本机（平台宿主机，无需 SSH）</option>'];
    opts.push(...servers.map((s) => `<option value="${escAttr(s.id)}">${escText(s.name || s.host)}</option>`));
    sel.innerHTML = opts.join('');
    // 默认选本机
    sel.value = 'local';
  } catch { sel.innerHTML = '<option value="local">本机（平台宿主机）</option>'; }
}

function closeDaModal() {
  const m = $('#da-modal');
  if (m) m.hidden = true;
  document.body.style.overflow = '';
  daState.current = null;
}

function escText(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(v) { return escText(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// 事件委托：分类切换 / 卡片打开
document.addEventListener('click', (e) => {
  const cat = e.target && e.target.closest ? e.target.closest('[data-da-type]') : null;
  if (cat) { daState.type = cat.getAttribute('data-da-type') || ''; daState.page = 1; renderDockerAppCats(); loadDockerAppList(); return; }
  const pg = e.target && e.target.closest ? e.target.closest('[data-da-page]') : null;
  if (pg) { daState.page = parseInt(pg.getAttribute('data-da-page'), 10) || 1; loadDockerAppList(); return; }
  const card = e.target && e.target.closest ? e.target.closest('[data-da-app]') : null;
  if (card) { openDockerApp(card.getAttribute('data-da-app')); return; }
  const closeBtn = e.target && e.target.closest ? e.target.closest('[data-da-close]') : null;
  if (closeBtn) { closeDaModal(); return; }
  const damClose = e.target && e.target.closest ? e.target.closest('[data-dam-close]') : null;
  if (damClose) { const m = $('#da-mirror-modal'); if (m) m.hidden = true; return; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-da-app]')) {
    openDockerApp(e.target.getAttribute('data-da-app'));
  }
  if (e.key === 'Escape') { closeDaModal(); const m = $('#da-mirror-modal'); if (m) m.hidden = true; }
});

let daSearchTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target || e.target.id !== 'da-search') return;
  daState.search = e.target.value.trim();
  daState.page = 1;
  clearTimeout(daSearchTimer);
  daSearchTimer = setTimeout(() => loadDockerAppList(), 250);
});
document.addEventListener('change', (e) => {
  if (!e.target || e.target.id !== 'da-version') return;
  daState.version = e.target.value;
  refreshDaCompose();
});

/* -------------------------------- 事件绑定 ------------------------------- */

const loaders = {
  overview: loadOverview,
  repos: loadRepos, 'repo-new': loadRepos, 'repo-clone': loadRepos, 'git-runtime': loadRepos,
  ide: loadIde, 'ide-config': loadIde,
  storage: loadStorage, 'storage-conn': loadStorage, 'storage-mounts': loadStorage, 'storage-drivers': loadStorage,
  rclone: loadRclone,
  builds: loadBuilds, 'build-start': loadBuilds, deploys: loadBuilds,
  servers: loadServers, 'server-new': loadServers,
  extensions: loadExtensions, gitsrc: loadGitSources,
  docker: loadDocker, 'docker-containers': loadDocker, 'docker-images': loadDocker,
  'docker-volumes': loadDocker, 'docker-networks': loadDocker, 'docker-compose': loadDocker,
  'docker-apps': loadDockerApps,
  proxy: loadProxy,
  dbgate: loadExtExtras, backups: loadExtExtras,
  ai: loadAI, 'ai-list': loadAI, 'ai-test': loadAI, ops: loadOps, aichat: loadAIChat,
  environment: loadEnvironment, envcfg: loadEnvConfig,
  users: loadUsers,
};

// 应用商店：目录重载 / 镜像源设置 / 生成部署文件 / 复制
const daReload = $('#da-reload');
if (daReload) daReload.addEventListener('click', async () => {
  try { const r = await api('/docker/apps/reload', { method: 'POST', body: '{}' }); toast(`已重载 ${r.count} 个应用`); await loadDockerAppMeta(); loadDockerAppList(); }
  catch (e) { /* api() 已提示 */ }
});
async function refreshDaDaemonPreview() {
  const box = $('#da-daemon-json');
  if (!box) return;
  try {
    const data = await api('/docker/apps/config/daemon-json');
    box.textContent = data && data.json || '（无内容）';
    box.dataset.cmd = data && data.commands ? data.commands.join('\n') : '';
  } catch (e) { box.textContent = 'daemon.json 预览加载失败'; }
}

function openDaAccModal() {
  const m = $('#da-mirror-modal');
  const acc = daState.accelerator || {};
  const mode = $('#da-acc-mode');
  if (mode) mode.value = acc.mode || 'baota';
  const url = $('#da-acc-url');
  if (url) url.value = acc.accelerateUrl || '';
  const mirror = $('#da-acc-mirror');
  if (mirror) mirror.value = acc.mirror || '';
  m.hidden = false;
  refreshDaDaemonPreview();
}

const daMirrorBtn = $('#da-mirror-btn');
if (daMirrorBtn) daMirrorBtn.addEventListener('click', openDaAccModal);
const daAccMode = $('#da-acc-mode');
if (daAccMode) daAccMode.addEventListener('change', refreshDaDaemonPreview);
const daAccUrl = $('#da-acc-url');
if (daAccUrl) daAccUrl.addEventListener('change', refreshDaDaemonPreview);
const daMirrorSave = $('#da-mirror-save');
if (daMirrorSave) daMirrorSave.addEventListener('click', async () => {
  try {
    const body = {
      mode: ($('#da-acc-mode') || {}).value || 'baota',
      accelerateUrl: ($('#da-acc-url') || {}).value || '',
      mirror: ($('#da-acc-mirror') || {}).value || '',
    };
    await api('/docker/apps/config/accelerator', { method: 'PUT', body });
    $('#da-mirror-modal').hidden = true;
    await loadDockerAppMeta(); loadDockerAppList();
    toast('镜像加速设置已保存');
  } catch (e) { /* api() 已提示 */ }
});
const daCopyDaemon = $('#da-copy-daemon');
if (daCopyDaemon) daCopyDaemon.addEventListener('click', () => copyText($('#da-daemon-json').textContent, 'daemon.json 已复制'));
const daCopyDaemonCmd = $('#da-copy-daemon-cmd');
if (daCopyDaemonCmd) daCopyDaemonCmd.addEventListener('click', () => {
  const cmd = ($('#da-daemon-json').dataset || {}).cmd || '';
  copyText(cmd, '配置命令已复制');
});
const daGenerate = $('#da-generate');
if (daGenerate) daGenerate.addEventListener('click', generateDaFiles);
const daCopyCompose = $('#da-copy-compose');
if (daCopyCompose) daCopyCompose.addEventListener('click', () => copyText($('#da-compose').textContent, 'compose 已复制'));
const daCopyEnv = $('#da-copy-env');
if (daCopyEnv) daCopyEnv.addEventListener('click', () => copyText($('#da-env').textContent, '.env 已复制'));

const daDlCompose = $('#da-dl-compose');
if (daDlCompose) daDlCompose.addEventListener('click', () => {
  const name = (daState.current && daState.current.appname) || 'app';
  dlText('docker-compose.yml', $('#da-compose').textContent);
  toast(`docker-compose.yml 已下载（${name}）`);
});
const daDlEnv = $('#da-dl-env');
if (daDlEnv) daDlEnv.addEventListener('click', () => {
  const name = (daState.current && daState.current.appname) || 'app';
  dlText('.env', $('#da-env').textContent);
  toast(`.env 已下载（${name}）`);
});
const daDeployBtn = $('#da-deploy-btn');
if (daDeployBtn) daDeployBtn.addEventListener('click', deployDaToServer);

/* 每个独立页顶部的子导航：点按钮打开对应标签，而不是把功能堆在一页里。 */
document.addEventListener('click', (e) => {
  const button = e.target && e.target.closest ? e.target.closest('[data-open-view]') : null;
  // 从子导航点「添加 / 编辑服务器」表示要新增，先清掉上一次的编辑态。
  if (button) {
    if (button.dataset.openView === 'server-new') resetServerEditForm();
    switchView(button.dataset.openView);
  }
});

$('#nav').addEventListener('click', (e) => {
  const button = e.target.closest('.nav-item');
  if (button) openModuleTab(button.dataset.view);
});

$('#tabbar').addEventListener('click', (e) => {
  hideTabTip();
  const close = e.target.closest('[data-tab-close]');
  if (close) { closeTab(close.dataset.tabClose); return; }
  const tab = e.target.closest('[data-tab-id]');
  if (tab) activateTab(tab.dataset.tabId);
});
/* 悬停标签 220ms 后显示说明；移出标签栏立即收起。 */
$('#tabbar').addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tab-id]');
  if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  const tab = tabs.get(el.dataset.tabId);
  if (tab) scheduleTabTip(tab, el);
  else hideTabTip();
});
$('#tabbar').addEventListener('mouseleave', () => { if (!tipPinned) hideTabTip(); });
$('#tabbar').addEventListener('scroll', () => { hideTabTip(); updateTabScroll(); });
/* 滚轮在标签栏上转为横向滚动，避免"标签多时滚不动、页面却在上下滚"。 */
$('#tabbar').addEventListener('wheel', (e) => {
  const bar = $('#tabbar');
  if (((Number(bar.scrollWidth) || 0) - (Number(bar.clientWidth) || 0)) <= 2) return;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  e.preventDefault();
  bar.scrollLeft += delta;
  hideTabTip();
}, { passive: false });
$('#tabbar').addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const tab = e.target.closest('[data-tab-id]');
  if (tab) { e.preventDefault(); closeTab(tab.dataset.tabId); }
});
$('#tabbar').addEventListener('contextmenu', (e) => {
  const tab = e.target.closest('[data-tab-id]');
  if (!tab) return;
  e.preventDefault();
  hideTabTip();
  activateTab(tab.dataset.tabId);
  showTabMenu(e.clientX, e.clientY);
});
$('#tab-scroll-prev').addEventListener('click', () => scrollTabs(-280));
$('#tab-scroll-next').addEventListener('click', () => scrollTabs(280));
window.addEventListener('resize', updateTabScroll);
/* ⓘ：触屏 / 键盘用户也能查看当前标签说明；点一下可固定浮层。 */
$('#tab-info').addEventListener('click', (e) => {
  e.stopPropagation();
  tipPinned = !tipPinned;
  if (!tipPinned) { hideTabTip(); return; }
  const tab = tabs.get(activeTabId);
  if (tab) scheduleTabTip(tab, e.currentTarget, 0);
});
$('#tab-info').addEventListener('mouseenter', (e) => {
  if (tipPinned) return;
  const tab = tabs.get(activeTabId);
  if (tab) scheduleTabTip(tab, e.currentTarget, 120);
});
$('#tab-info').addEventListener('mouseleave', () => { if (!tipPinned) hideTabTip(); });
$('#tab-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#tab-menu');
  if (!menu.hidden) { menu.hidden = true; return; }
  showTabMenu();
});
$('#tab-menu').addEventListener('click', (e) => {
  const button = e.target.closest('[data-tab-menu]');
  if (!button) return;
  $('#tab-menu').hidden = true;
  const action = button.dataset.tabMenu;
  if (action === 'close-others') {
    Array.from(tabs.keys()).filter((id) => id !== activeTabId).forEach((id) => closeTab(id));
  } else if (action === 'close-all') {
    Array.from(tabs.keys()).forEach((id) => closeTab(id, true));
    if (!tabs.size) openModuleTab('overview');
  } else if (action === 'open-modules') {
    Object.keys(VIEW_META).forEach((v) => openModuleTab(v));
  } else if (action === 'refresh') {
    refreshActiveTab();
  }
});
document.addEventListener('click', (e) => {
  const menu = $('#tab-menu');
  if (!menu.hidden && !e.target.closest('.tab-menu') && !e.target.closest('#tab-menu-btn')) menu.hidden = true;
  const sysMenu = $('#sys-menu');
  if (!sysMenu.hidden && !e.target.closest('.sys-menu') && !e.target.closest('#sys-btn')) sysMenu.hidden = true;
  if (!e.target.closest('#tab-info')) { tipPinned = false; hideTabTip(); }
});
$('#tab-new').addEventListener('click', () => {
  openModuleTab('servers');
  toast('在服务器卡片中打开终端或文件管理，可同时开多个标签');
});
$('#refresh-btn').addEventListener('click', refreshActiveTab);

/* -------------------- 版本与热更新（单文件程序） -------------------- */
let sysInfo = null;
let sysSource = '';

async function loadSystemInfo() {
  try {
    sysInfo = await api('/system/version');
    const version = sysInfo && sysInfo.version ? `v${sysInfo.version}` : 'v?';
    $('#sys-btn').textContent = version;
    $('#sys-version').textContent = version;
    $('#sys-meta').textContent = `${sysInfo.runtime === 'binary' ? '单文件程序' : '源码模式'} · `
      + `${sysInfo.buildTime ? fmtTime(sysInfo.buildTime) : '开发构建'}`
      + `${sysInfo.backups ? ` · ${sysInfo.backups} 份备份` : ''}`;
    sysSource = sysInfo.updateUrl || '';
  } catch {
    $('#sys-btn').textContent = '版本';
    $('#sys-version').textContent = '未提供版本接口';
    $('#sys-meta').textContent = '源码模式或旧版服务，不影响日常使用';
  }
}

async function sysAction(action) {
  $('#sys-menu').hidden = true;
  try {
    if (action === 'check') {
      const d = await api('/system/update/check', { method: 'POST', body: { source: sysSource } });
      if (d.sourceMode) toast('源码模式请用 CLI：node launcher/launcher.js update <源>');
      else if (d.available) toast(`发现新版本 v${d.latest}（当前 v${d.current}），可点「应用更新」`);
      else toast(`已是最新版本 v${d.current}`);
    } else if (action === 'apply') {
      const source = sysSource || (await promptDialog('输入更新源：本地目录路径或 release.json 的 URL', '') || '');
      if (!source) { toast('已取消：未指定更新源'); return; }
      const d = await api('/system/update/apply', { method: 'POST', body: { source } });
      toast(d.updated ? `已更新 v${d.from} → v${d.version}，正在重载…` : (d.reason || '无变化'));
    } else if (action === 'reload') {
      const d = await api('/system/reload', { method: 'POST', body: {} });
      toast(d.reloaded ? '后端正在平滑重启（约 1–2 秒）' : (d.hint || '源码模式请用 npm run dev'));
    } else if (action === 'rollback') {
      const d = await api('/system/rollback', { method: 'POST', body: {} });
      toast(`已回滚到 v${d.version}，正在重载…`);
    }
  } catch (err) {
    toast(err.message || String(err), true);
  }
}

$('#sys-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#sys-menu');
  menu.hidden = !menu.hidden;
  if (!menu.hidden) { $('#tab-menu').hidden = true; loadSystemInfo(); }
});
$('#sys-menu').addEventListener('click', (e) => {
  const button = e.target.closest('[data-sys]');
  if (button) sysAction(button.dataset.sys);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#tab-menu').hidden = true;
    $('#sys-menu').hidden = true;
    tipPinned = false; hideTabTip(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    const tab = tabs.get(activeTabId);
    if (tab && tab.kind === 'editor') { e.preventDefault(); saveEditor(tab); }
  }
});
$$('[data-reload]').forEach((b) => b.addEventListener('click', () => loaders[b.dataset.reload]()));

$('#ext-catalog').addEventListener('click', (e) => {
  const button = e.target.closest('[data-ext-install]');
  if (button) openExtInstall(button.dataset.extInstall);
});
$('#ext-mode').addEventListener('change', (e) => {
  extState.mode = e.target.value;
  renderExtInstallForm();
});
$('#ext-install-close').addEventListener('click', () => closeAsModal({ cardId: 'ext-install-card' }));
$('#ext-install-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = formData(e.target);
  try {
    const created = await api('/extensions/instances', {
      method: 'POST', body: { catalogId: extState.manifestId, mode: extState.mode, values },
    });
    toast(`已创建实例 ${created.name}`);
    closeAsModal({ cardId: 'ext-install-card' });
    await loadExtensions();
  } catch (err) { toast(err.message || String(err), true); }
});
$('#ext-log-close').addEventListener('click', () => closeAsModal({ cardId: 'ext-log-card' }));
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('[data-ext-cred-close]')) {
    $('#ext-cred-modal').hidden = true;
    extCredState.text = '';
  }
});
const extCredCopyBtn = $('#ext-cred-copy');
if (extCredCopyBtn) extCredCopyBtn.addEventListener('click', () => {
  if (!extCredState.text) { toast('请先打开登录凭据弹窗', true); return; }
  copyText(extCredState.text, '账号与密码已复制');
});
$('#ext-list').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-ext-op]');
  if (!button) return;
  const id = button.dataset.extId;
  const op = button.dataset.extOp;
  try {
    if (op === 'connection') {
      const d = await api(`/extensions/instances/${id}/connection`);
      await navigator.clipboard.writeText(d.url);
      toast('连接串已复制到剪贴板');
    } else if (op === 'credentials') {
      const d = await api(`/extensions/instances/${id}/credentials`);
      extCredState.text = `账号：${d.login}\n密码：${d.password || '(未设置)'}`;
      $('#ext-cred-title').textContent = `${d.label} · 登录凭据`;
      $('#ext-cred-sub').textContent = '登录页需要账号 + 密码，明文只在本次弹窗显示';
      $('#ext-cred-hint').textContent = d.hint || '';
      $('#ext-cred-body').innerHTML = [
        ['登录账号', d.login], ['登录密码', d.password || '（未设置）'],
        ['账号环境变量', d.envLogin], ['密码环境变量', d.envPassword],
      ].map(([k, v]) => `<div class="ide-config-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
      $('#ext-cred-modal').hidden = false;
    } else if (op === 'inject') {
      const inst = extState.items.find((x) => x.id === id);
      const target = await promptDialog('写入工作区内的哪个文件？', '.env');
      if (!target) return;
      const bound = (inst && inst.repoIds) || [];
      const useRepos = bound.length && await confirmDialog({
        title: '写入范围',
        message: `该实例绑定了 ${bound.length} 个仓库，请选择把 ${target} 写到哪里。`,
        confirmText: `写入 ${bound.length} 个仓库目录`, cancelText: '只写工作区根目录',
        danger: false,
      });
      const d = await api(`/extensions/instances/${id}/inject`, {
        method: 'POST', body: { target, useRepos: Boolean(useRepos) },
      });
      toast(`已写入 ${d.paths ? d.paths.length + ' 个文件' : d.path}（${d.envKey}）`);
    } else if (op === 'repos') {
      openExtRepos(id);
    } else if (op === 'backup') {
      toast('正在生成备份，请稍候…');
      const d = await api(`/extensions/instances/${id}/backup`, { method: 'POST', body: { reason: 'manual' } });
      toast(`备份已生成：${d.filename || '完成'}`);
      await loadExtExtras();
    } else if (op === 'upgrade') {
      const inst = extState.items.find((x) => x.id === id);
      const tag = await promptDialog(`输入要升级到的镜像版本（当前 ${inst ? inst.tag : '未知'}）`, inst ? inst.tag : '');
      if (!tag) return;
      if (!await confirmDialog({ message: `升级前会自动备份，然后保留数据卷重建容器；健康检查失败将回滚到 ${inst ? inst.tag : '旧版本'}。继续？` })) return;
      toast('正在升级（备份 → 换版本 → 健康检查），请稍候…');
      const d = await api(`/extensions/instances/${id}/upgrade`, { method: 'POST', body: { tag: tag.trim() } });
      toast(`已升级到 ${d.to}（数据卷保留${d.backupId ? '，升级前已自动备份' : ''}）`);
      await loadExtensions();
    } else if (op === 'open') {
      const inst = extState.items.find((x) => x.id === id);
      if (!inst) return;
      window.open(`http://${inst.host}:${inst.port}/`, '_blank', 'noopener');
    } else if (op === 'health') {
      const d = await api(`/extensions/instances/${id}/health`, { method: 'POST', body: {} });
      toast(d.healthy ? '健康检查通过' : d.detail, !d.healthy);
      await loadExtensions();
    } else if (['start', 'stop', 'restart'].includes(op)) {
      await api(`/extensions/instances/${id}/action`, { method: 'POST', body: { action: op } });
      toast('操作已完成');
      await loadExtensions();
    } else if (op === 'logs') {
      const d = await api(`/extensions/instances/${id}/logs?tail=200`);
      $('#ext-log').textContent = d.text || '(暂无日志)';
      openAsModal('ext-log-card');
    } else if (op === 'remove') {
      const name = button.dataset.extName || '该实例';
      if (!await confirmDialog({ message: `确定卸载扩展实例「${name}」？` })) return;
      const purge = await confirmDialog({
        title: '是否同时删除数据卷？',
        message: '删除后无法恢复；保留数据卷则之后可重新挂载。',
        confirmText: '连同数据一起删除', cancelText: '保留数据卷',
      });
      const d = await api(`/extensions/instances/${id}?purge=${purge ? 1 : 0}`, { method: 'DELETE' });
      toast(d.volumeKept ? '已卸载，数据卷已保留' : '已卸载');
      closeAsModal({ cardId: 'ext-log-card' });
      await loadExtensions();
    }
  } catch (err) { toast(err.message || String(err), true); }
});

/* ------------------ 扩展：备份存档 / 绑定仓库 / DbGate ------------------ */

$('#ext-backups').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-bak-op]');
  if (!button) return;
  const id = button.dataset.bakId;
  const op = button.dataset.bakOp;
  try {
    if (op === 'download') {
      window.open(`/api/extensions/backups/${encodeURIComponent(id)}/download${streamToken()}`, '_blank');
    } else if (op === 'restore') {
      const name = button.dataset.bakName || id;
      if (!await confirmDialog({ message: `确定用「${name}」恢复数据？当前实例的同名库会被覆盖，此操作不可撤销。` })) return;
      if (!await confirmDialog({ message: '再次确认：恢复过程可能需要重启数据库容器，期间连接会短暂中断。继续？' })) return;
      const d = await api(`/extensions/backups/${id}/restore`, { method: 'POST', body: { confirm: true } });
      toast(`已恢复 ${fmtSize(d.size)} 数据${d.restartAfter ? '，容器已重启' : ''}`);
      await loadExtensions();
    } else if (op === 'delete') {
      if (!await confirmDialog({ message: '确定删除这份备份存档？删除后无法再用它恢复。' })) return;
      await api(`/extensions/backups/${id}`, { method: 'DELETE' });
      toast('备份已删除');
      await loadExtExtras();
    }
  } catch (err) { toast(err.message || String(err), true); }
});

$('#ext-dbgate').addEventListener('click', async (e) => {
  const button = e.target.closest('#ext-dbgate-sync, #ext-dbgate-open');
  if (!button) return;
  try {
    if (button.id === 'ext-dbgate-sync') {
      const d = await api('/extensions/dbgate/sync', { method: 'POST', body: {} });
      toast(d.synced ? `已同步 ${d.connections} 个数据库连接` : (d.reason || d.error || '同步未执行'));
      await loadExtExtras();
    } else {
      const inst = extState.dbgate && extState.dbgate.instance;
      if (inst) window.open(`http://${inst.host}:${inst.port}/`, '_blank', 'noopener');
    }
  } catch (err) { toast(err.message || String(err), true); }
});

$('#ext-repos-close').addEventListener('click', () => closeAsModal({ cardId: 'ext-repos-card' }));
$('#ext-repos-save').addEventListener('click', async () => {
  const id = extState.reposInstanceId;
  if (!id) return;
  const repoIds = $$('#ext-repos-options [data-ext-repo]:checked').map((x) => x.dataset.extRepo);
  try {
    const d = await api(`/extensions/instances/${id}/repos`, { method: 'PUT', body: { repoIds } });
    toast(`已绑定 ${d.repoIds.length} 个仓库`);
    closeAsModal({ cardId: 'ext-repos-card' });
    await loadExtensions();
  } catch (err) { toast(err.message || String(err), true); }
});

/* --------------------- 环境配置 / .env 管理（v0.3.8） --------------------- */
/**
 * 从 Git 源错误卡 / 扩展体检结论跳转过来时，带上要修改的 env 键与问题编号；
 * 页面会高亮对应配置行，并把建议片段预填进「新值」列（仍未写入文件）。
 */
function openEnvConfig(keys = [], problem = '') {
  envcfgFocus = Array.isArray(keys) ? keys : [];
  envcfgProblem = problem || '';
  switchView('envcfg');
  setTimeout(() => loadEnvConfig(), 40);
}

let envcfgData = null;

function envcfgAdviceHtml(d) {
  return (d.advice || []).map((a, i) => {
    // 鉴权建议的片段是说明文字，不该被「填入表单」当成令牌原样写进去；改成一键生成随机值。
    const actionBtn = a.action === 'gen-token'
      ? '<button class="btn btn-sm btn-primary" type="button" data-env-gen="1">生成随机令牌</button>'
      : `<button class="btn btn-sm btn-primary" type="button" data-env-fill="${i}">填入表单</button>`;
    return `
    <div class="envcfg-advice-card${envcfgProblem === a.problem ? ' envcfg-focus' : ''}" data-env-advice="${esc(a.problem)}">
      <div class="row gap wrap" style="align-items:center">
        <b>${esc(a.title)}</b>
        ${envcfgProblem === a.problem ? badge('来自刚才的诊断', 'red') : ''}
        <button class="btn btn-sm" type="button" data-env-copy="${i}">复制片段</button>
        ${actionBtn}
      </div>
      <div class="muted small" style="margin-top:4px">${esc(a.reason)}</div>
      <pre class="envcfg-snippet">${esc(a.snippet)}</pre>
      <div class="muted small">↳ ${esc(a.note)}</div>
    </div>`;
  }).join('') || '<div class="empty">暂无建议</div>';
}

/** 根据 /api/env-config 的 security 字段，把「当前有没有鉴权」讲清楚。 */
function renderEnvcfgAuthState(security) {
  const state = $('#envcfg-auth-state');
  const notice = $('#envcfg-auth-notice');
  if (!state || !notice) return;
  const enabled = security ? Boolean(security.authEnabled) : null;
  state.innerHTML = enabled === null ? '<span class="muted small">状态未知（请刷新）</span>'
    : enabled ? badge('已启用鉴权', 'green') : badge('未启用鉴权 · 所有 API 无鉴权', 'red');
  notice.className = `notice${enabled === false ? ' warn' : ''}`;
  notice.innerHTML = enabled === false
    ? '⚠ 当前 <code>ADMIN_TOKEN</code> 为空：任何能访问 9000 端口的人都能调用全部 API（读配置 / 连接串、改服务器文件、开终端、增删容器、触发部署），且 <code>/api/servers/:id/exec</code> 被降级为只读白名单。若这台机器不止你一个人能访问，请按下方步骤启用鉴权。'
    : enabled === true
      ? '✔ 已启用鉴权：除 <code>/api/health</code> 外所有 <code>/api/*</code> 都需要 <code>Bearer</code> 或 <code>?token=</code>。若页面一直 401，检查浏览器 <code>localStorage.dp_token</code> 是否与 .env 里的值完全一致；更换令牌后需要每台浏览器重新写入。'
      : '未能取得鉴权状态，请点「刷新」重试；完整说明见 <code>.env.example</code> 与 README §5 / §40。';
}

/** 只生成并填入表单，不写 .env；保存后用户还需要把这个值写进 dp_token。 */
async function generateAdminToken() {
  const input = document.querySelector('#envcfg-list .envcfg-input[data-env-key="ADMIN_TOKEN"]');
  if (!input) { toast('配置表还没加载完，请稍后重试', true); return; }
  let token = '';
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch { toast('浏览器不支持安全随机数，请用 node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" 生成', true); return; }
  input.value = token;
  const row = document.querySelector('#view-envcfg .envcfg-row[data-env-key="ADMIN_TOKEN"]');
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  let copied = false;
  try { await navigator.clipboard.writeText(token); copied = true; } catch { /* http 下可能没有剪贴板权限 */ }
  if (!copied) { input.focus(); input.select(); }
  toast(copied
    ? '已生成 64 位随机令牌并复制到剪贴板；保存并重启后，请把它写入浏览器 dp_token'
    : '已生成 64 位随机令牌（已选中，请手动复制）；保存并重启后需要写入浏览器 dp_token');
}

function envcfgFillAdvice(advice, announce = true) {
  const lines = String(advice.snippet || '').split(/\r?\n/);
  const filled = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const input = document.querySelector(`#envcfg-list .envcfg-input[data-env-key="${m[1]}"]`);
    if (!input) continue;
    input.value = m[2].replace(/^["']|["']$/g, '');
    filled.push(m[1]);
  }
  if (filled.length) {
    const row = document.querySelector(`#view-envcfg .envcfg-row[data-env-key="${filled[0]}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (announce) toast(`已把建议值填入 ${filled.join(' / ')}，确认后点「保存并应用」`);
  } else if (announce) toast('该建议没有对应可编辑的配置项', true);
  return filled;
}

async function loadEnvConfig() {
  const summary = $('#envcfg-summary');
  const adviceBox = $('#envcfg-advice');
  const listBox = $('#envcfg-list');
  if (!listBox) return;
  try {
    const d = await api('/env-config');
    envcfgData = d;
    renderEnvcfgAuthState(d.security);
    const pending = (d.items || []).filter((x) => x.pendingRestart).length;
    if (summary) {
      summary.innerHTML = `<div class="row gap wrap" style="align-items:center">
          <b>配置文件</b><code>${esc(d.path)}</code>
          ${d.exists ? badge('已存在', 'green') : badge('尚未创建', 'amber')}
          ${d.writable ? badge('可写', 'green') : badge('只读', 'red')}
          ${d.runtime.runtimeKind === 'container' ? '<span class="muted small">容器部署 · 宿主机文件以单文件挂载方式映射进来</span>' : ''}
        </div>
        <div style="margin-top:6px" class="muted small">
          共 ${(d.items || []).length} 个白名单配置项${pending ? ` · <b style="color:var(--amber)">${pending} 项文件值与运行时不一致，需重启平台</b>` : ' · 文件值与运行时一致'}
          ${d.runtime.tlsInsecure ? ` · <b style="color:var(--amber)">全局跳过 TLS 校验已开启${d.runtime.tlsInsecureHosts ? `（限定 ${esc(d.runtime.tlsInsecureHosts)}）` : '（全部主机）'}</b>` : ''}
        </div>
        <div class="notice warn" style="margin-top:8px">⚠ ${esc(d.warning)}</div>`;
    }
    if (adviceBox) {
      adviceBox.innerHTML = envcfgAdviceHtml(d);
      adviceBox.querySelectorAll('[data-env-copy]').forEach((b) => b.addEventListener('click', async () => {
        const a = (d.advice || [])[Number(b.dataset.envCopy)];
        if (!a) return;
        try { await navigator.clipboard.writeText(a.snippet); toast('配置片段已复制，可粘贴到 .env'); }
        catch { toast('复制失败，请手动选中片段复制', true); }
      }));
      adviceBox.querySelectorAll('[data-env-fill]').forEach((b) => b.addEventListener('click', () => {
        const a = (d.advice || [])[Number(b.dataset.envFill)];
        if (a) envcfgFillAdvice(a);
      }));
      adviceBox.querySelectorAll('[data-env-gen]').forEach((b) => b.addEventListener('click', () => generateAdminToken()));
    }
    const rows = [];
    for (const g of (d.groups || [])) {
      const gItems = (d.items || []).filter((x) => x.group === g.id);
      if (!gItems.length) continue;
      rows.push(`<tr class="envcfg-group"><td colspan="5"><b>${esc(g.label)}</b> <span class="muted small">${esc(g.desc)}</span></td></tr>`);
      for (const it of gItems) {
        const focus = envcfgFocus.includes(it.key) ? ' envcfg-focus' : '';
        const detail = (it.detail && it.detail.length)
          ? `<details class="envcfg-detail"><summary>详细说明（${it.detail.length} 条）</summary><ul>${it.detail.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`
          : '';
        // 固定候选值的配置项用下拉选择，杜绝手滑写错；自由格式仍用输入框。
        const field = (Array.isArray(it.options) && it.options.length)
          ? `<select class="envcfg-input ui-select ui-select-sm" data-env-key="${esc(it.key)}" autocomplete="off">
              <option value="">留空表示不修改</option>
              ${it.options.map((o) => {
                const v = typeof o === 'string' ? o : o.value;
                const label = typeof o === 'string' ? o : (o.label || o.value);
                return `<option value="${esc(v)}">${esc(label)}</option>`;
              }).join('')}
            </select>`
          : `<input class="envcfg-input" data-env-key="${esc(it.key)}" placeholder="留空表示不修改" autocomplete="off" spellcheck="false" />`;
        rows.push(`<tr class="envcfg-row${focus}" data-env-key="${esc(it.key)}">
          <td><b>${esc(it.key)}</b><div class="desc muted">${esc(it.label)}</div><div class="desc muted small">${esc(it.desc)}</div>${detail}</td>
          <td><code class="envcfg-val">${esc(it.display)}</code>${it.masked ? ' <span class="muted small">脱敏</span>' : ''}</td>
          <td><code class="envcfg-val">${esc(it.runtimeValue || '默认')}</code>${it.pendingRestart ? ` ${badge('待重启', 'amber')}` : ''}</td>
          <td>${field}</td>
          <td>${it.hot ? badge('即时生效', 'green') : badge('需重启', 'gray')}${it.example ? `<div class="muted small">示例 <code>${esc(it.example)}</code></div>` : ''}</td>
        </tr>`);
      }
    }
    listBox.innerHTML = table(['配置项', '文件里的值', '运行时生效值', '新值', '生效方式'], rows);
    // 从诊断结论跳来：自动预填建议值，让「怎么配置 env」一眼可见。
    if (envcfgProblem) {
      const a = (d.advice || []).find((x) => x.problem === envcfgProblem);
      if (a) envcfgFillAdvice(a, false);
      envcfgProblem = '';
      envcfgFocus = [];
    }
  } catch (e) {
    renderEnvcfgAuthState(null);
    if (summary) summary.innerHTML = errorBlock(e.message, e.hint || '');
    if (listBox) listBox.innerHTML = '';
    if (adviceBox) adviceBox.innerHTML = '';
  }
}

if ($('#envcfg-gen-token')) $('#envcfg-gen-token').addEventListener('click', () => generateAdminToken());
if ($('#envcfg-reload')) $('#envcfg-reload').addEventListener('click', () => loadEnvConfig());
if ($('#envcfg-save')) $('#envcfg-save').addEventListener('click', async () => {
  const values = {};
  $$('#envcfg-list .envcfg-input').forEach((el) => {
    if (el.value !== '') values[el.dataset.envKey] = el.value;
  });
  const keys = Object.keys(values);
  if (!keys.length) { toast('还没有填写任何新值', true); return; }
  if (!await confirmDialog({ message: `将把 ${keys.length} 项写入 .env（自动备份、权限 600）：\n${keys.join(', ')}\n\n敏感项只有在你填写新值时才会更新。确认继续？` })) return;
  try {
    const r = await api('/env-config', { method: 'PUT', body: { confirm: true, values } });
    await loadEnvConfig();
    const box = $('#envcfg-summary');
    if (box) box.insertAdjacentHTML('beforeend', `<div class="notice ${r.requiresRestart ? 'warn' : ''}" style="margin-top:8px">
      ✔ ${esc(r.message)}${r.backup ? `<br />备份：<code>${esc(r.backup)}</code>` : ''}
      ${r.hotApplied && r.hotApplied.length ? `<br />已即时生效：<code>${esc(r.hotApplied.join(', '))}</code>` : ''}
      ${r.requiresRestart ? `<br />需重启后生效：<code>${esc((r.restartKeys || []).join(', '))}</code>。容器部署可重新执行 <code>remote.js deploy</code>；扩展地址改完还要到「扩展 / 数据库」重建对应实例。` : ''}
    </div>`);
    toast(r.message);
  } catch (e) { toast(e.message || String(e), true); }
});

/* ----------------------------- 外部 Git 源 ----------------------------- */

/** 外部 Git 源认证方式切换：Token / 账号密码二选一。 */
function syncGitSourceAuthFields() {
  const mode = ($('#gitsrc-auth-type') && $('#gitsrc-auth-type').value) || 'token';
  const tokenField = $('#gitsrc-token-field');
  const passFields = $('#gitsrc-password-fields');
  if (tokenField) tokenField.hidden = mode !== 'token';
  if (passFields) passFields.hidden = mode !== 'password';
  const form = $('#gitsrc-form');
  // v0.3.6：编辑态下凭据可以留空（沿用原值），不能要求必填。
  const editing = Boolean(gitsrcEditId);
  if (form && form.elements.token) form.elements.token.required = mode === 'token' && !editing;
  if (form && form.elements.password) form.elements.password.required = mode === 'password' && !editing;
}
$('#gitsrc-auth-type').addEventListener('change', syncGitSourceAuthFields);

/** v0.3.8 · 勾选「忽略证书校验」时展示安全提醒。 */
function syncGitSourceTlsNote() {
  const sel = $('#gitsrc-insecure');
  const note = $('#gitsrc-tls-note');
  if (note) note.hidden = !sel || sel.value !== 'on';
}
if ($('#gitsrc-insecure')) $('#gitsrc-insecure').addEventListener('change', syncGitSourceTlsNote);

/** 退出编辑态，恢复成「登记新源」（弹窗内表单复位）。 */
function resetGitSourceForm() {
  gitsrcEditId = '';
  const form = $('#gitsrc-form');
  if (form) form.reset();
  $('#gitsrc-form-title').textContent = '登记外部 Git 源';
  $('#gitsrc-submit').textContent = '登记 Git 源';
  const token = $('#gitsrc-token');
  const password = $('#gitsrc-password');
  if (token) token.placeholder = 'ghp_... / Gitea Token / GitLab PAT';
  if (password) password.placeholder = 'GitHub 必须填 PAT（已停用密码登录）';
  const tls = $('#gitsrc-insecure');
  if (tls) tls.value = 'auto';
  syncGitSourceTlsNote();
  syncGitSourceAuthFields();
}

/** v0.3.7 · 登记 / 编辑共用同一个弹窗。 */
function openGitSourceModal(source) {
  const modal = $('#gitsrc-modal');
  if (!modal) return;
  if (source) fillGitSourceForm(source);
  else resetGitSourceForm();
  modal.hidden = false;
  const first = $('#gitsrc-form') && $('#gitsrc-form').elements.label;
  if (first) setTimeout(() => first.focus(), 30);
}
function closeGitSourceModal() {
  const modal = $('#gitsrc-modal');
  if (modal) modal.hidden = true;
  resetGitSourceForm();
}

function fillGitSourceForm(s) {
  gitsrcEditId = s.id;
  const form = $('#gitsrc-form');
  form.elements.label.value = s.label || '';
  form.elements.type.value = s.type || 'gitea';
  form.elements.baseUrl.value = s.baseUrl || '';
  form.elements.authType.value = s.authType || 'token';
  form.elements.username.value = s.username || '';
  form.elements.token.value = '';
  form.elements.password.value = '';
  // 代理：本源独立覆盖值（脱敏）直接回填；脱敏串提交时由服务端 unmask 复用原值。
  // 若为空则 placeholder 提示当前继承的生效代理，方便区分「没单独设」与「设了但看不懂」。
  const proxyInput = $('#gitsrc-proxy');
  if (proxyInput) {
    proxyInput.value = s.proxyOverride || '';
    proxyInput.placeholder = s.proxyOverride
      ? '填一个地址：如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；direct 直连；留空继承上级'
      : (s.effectiveProxy
        ? `当前继承：${s.effectiveProxy}；填地址覆盖，direct 直连，留空继续继承`
        : '填一个地址：如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；direct 直连；留空继承上级');
  }
  $('#gitsrc-token').placeholder = s.hasToken ? `留空沿用原值（当前 ${s.tokenMasked || '已保存'}）` : '留空表示不设置 Token';
  $('#gitsrc-password').placeholder = s.hasPassword ? `留空沿用原值（当前 ${s.passwordMasked || '已保存'}）` : '留空表示不设置密码';
  $('#gitsrc-form-title').textContent = `编辑 Git 源 · ${s.label}`;
  $('#gitsrc-submit').textContent = '保存修改';
  const tls = $('#gitsrc-insecure');
  if (tls) tls.value = s.insecure || 'auto';
  syncGitSourceTlsNote();
  syncGitSourceAuthFields();
}

$('#gitsrc-add').addEventListener('click', () => openGitSourceModal());
$('#gitsrc-cancel').addEventListener('click', closeGitSourceModal);
$$('[data-gitsrc-close]').forEach((b) => b.addEventListener('click', closeGitSourceModal));
document.addEventListener('keydown', (e) => {
  const modal = $('#gitsrc-modal');
  if (e.key === 'Escape' && modal && !modal.hidden) closeGitSourceModal();
});

$('#gitsrc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const editing = Boolean(gitsrcEditId);
  if (body.authType === 'password') {
    body.token = '';
    if (!body.username) { toast('账号密码方式必须填写用户名', true); return; }
    if (!body.password && !editing) { toast('账号密码方式必须填写密码 / PAT', true); return; }
  } else {
    body.password = '';
    if (!body.token && !editing) { toast('请填写访问令牌 Token，或切换为账号密码方式', true); return; }
  }
  if (editing) {
    // 空凭据字段不传给后端，避免把已保存的 Token / 密码清空。
    if (!body.token) delete body.token;
    if (!body.password) delete body.password;
  }
  try {
    if (editing) await api(`/git-sources/${encodeURIComponent(gitsrcEditId)}`, { method: 'PUT', body });
    else await api('/git-sources', { method: 'POST', body });
    toast(editing ? 'Git 源已更新，仓库列表会自动重新聚合' : 'Git 源已登记，仓库列表会自动聚合');
    closeGitSourceModal();
    await loadGitSources();
    await loadRepos();
  } catch (err) { toast(err.message || String(err), true); }
});

$('#gitsrc-list').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-gitsrc-op]');
  if (!button) return;
  const id = button.dataset.gitsrcId;
  const op = button.dataset.gitsrcOp;
  try {
    if (op === 'edit') {
      const source = gitsrcCache.find((s) => s.id === id);
      if (source) openGitSourceModal(source);
      else toast('源信息尚未加载完成，请刷新后重试', true);
    } else if (op === 'test') {
      toast('正在测试连通性…');
      const d = await api(`/git-sources/${id}/test`, { method: 'POST', body: {} });
      toast(`连接正常 · 可见 ${d.count} 个仓库`);
    } else if (op === 'repos') {
      const d = await api(`/git-sources/${id}/repos`);
      const items = d.items || [];
      $('#gitsrc-repos-title').textContent = `源仓库列表 · ${items.length} 个`;
      $('#gitsrc-repos').innerHTML = table(['仓库', '可见性', '更新时间', '操作'], items.map((r) => `
        <tr>
          <td><b>${esc(r.name)}</b><div class="ext-list-url">${esc(r.fullName || '')}</div></td>
          <td>${r.private ? badge('私有', 'amber') : badge('公开', 'gray')}</td>
          <td class="muted">${esc(fmtTime(r.updatedAt))}</td>
          <td><button class="btn btn-sm" data-clone-repo="${esc(r.cloneUrl)}" data-clone-source="${esc(id)}" data-clone-name="${esc(r.name)}">填入克隆表单</button></td>
        </tr>`));
      openAsModal('gitsrc-repos-card');
      if (!items.length && d.error) toast(d.error, true);
    } else if (op === 'remove') {
      if (!await confirmDialog({ message: `确定删除 Git 源「${button.dataset.gitsrcName || id}」？只移除本地登记，不会影响远端仓库。` })) return;
      await api(`/git-sources/${id}`, { method: 'DELETE' });
      toast('Git 源已删除');
      await loadGitSources();
      await loadRepos();
    }
  } catch (err) { toast(err.message || String(err), true); }
});

$('#gitsrc-repos-close').addEventListener('click', () => closeAsModal({ cardId: 'gitsrc-repos-card' }));
$('#gitsrc-repos').addEventListener('click', (e) => {
  const button = e.target.closest('[data-clone-repo]');
  if (!button) return;
  fillCloneForm(button.dataset.cloneRepo || '', button.dataset.cloneName || '', button.dataset.cloneSource || '', '');
  // v0.4.30：源仓库列表本身也是弹窗，先关它再开克隆弹窗，避免两层遮罩叠着。
  closeAsModal({ cardId: 'gitsrc-repos-card' });
  openRepoCloneModal(button.dataset.cloneName || '');
});

/* ------------------------------ Docker 管理 ----------------------------- */

$('#docker-target').addEventListener('change', (e) => {
  dockerState.target = e.target.value || 'local';
  loadDocker();
});
// 容器列表筛选：拆分后各页独立，筛选条件只作用于容器页。
if ($('#docker-container-filter')) {
  $('#docker-container-filter').addEventListener('input', renderDockerContainers);
  $('#docker-container-state').addEventListener('change', renderDockerContainers);
}
$('#docker-log-close').addEventListener('click', () => { $('#docker-log-card').hidden = true; });

/* ─────── 通用「弹窗化」工具函数 ────────────────────────────────────────────
 * 把原本在页面底部展开的卡片浮层化为弹窗，不移动 DOM，只加/移除 class。
 * 点遮罩或 Esc 关闭；closeId 是卡片内的关闭按钮 id（可选，同时触发其原本逻辑）。
 * ────────────────────────────────────────────────────────────────────────── */
let _asModalActive = null;

function openAsModal(cardId, { wide = false, onClose = null } = {}) {
  const card = $(`#${cardId}`);
  if (!card) return;
  if (_asModalActive) closeAsModal(_asModalActive);
  card.hidden = false;
  card.classList.add('as-modal');
  if (wide) card.classList.add('as-modal-wide');
  const mask = $('#card-modal-mask');
  if (mask) mask.hidden = false;
  document.body.style.overflow = 'hidden';
  _asModalActive = { cardId, onClose };
}

function closeAsModal(ctx) {
  if (!ctx) ctx = _asModalActive;
  if (!ctx) return;
  const card = $(`#${ctx.cardId}`);
  if (card) { card.classList.remove('as-modal', 'as-modal-wide'); card.hidden = true; }
  const mask = $('#card-modal-mask');
  if (mask) mask.hidden = true;
  document.body.style.overflow = '';
  if (ctx.onClose) ctx.onClose();
  _asModalActive = null;
}

// 点遮罩关闭
(function () {
  const mask = $('#card-modal-mask');
  if (mask) mask.addEventListener('click', () => closeAsModal(_asModalActive));
})();

function dockerShowLog(title, text) {
  $('#docker-log').textContent = text || '(无输出)';
  $('#docker-log-card').hidden = false;
  $('#docker-log-card').querySelector('h2').textContent = title;
}

/* ─────── 容器操作弹窗（日志 / 详情 / 资源 / 终端）────────────────────────── */
const dkModalState = { id: '', name: '', tab: '', statsTimer: null, termHistory: [], termIdx: -1 };

function dkOpenPanel(tab) {
  ['logs', 'inspect', 'stats', 'term'].forEach((p) => {
    const el = $(`#dk-panel-${p}`);
    if (el) el.hidden = p !== tab;
  });
  $$('#dk-modal-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.dkTab === tab));
  dkModalState.tab = tab;
}

async function openDkModal(id, name, tab) {
  // v0.4.30：终端是全局单例，换了容器必须先断开旧 PTY，否则输入会串到别的容器。
  if (dkTerm.sid && dkModalState.id && dkModalState.id !== id) {
    void dkTermDisconnect('已切换到其它容器');
  }
  dkModalState.id = id;
  dkModalState.name = name;
  $('#dk-modal-title').textContent = name || id.slice(0, 12);
  // 渲染标签栏
  $('#dk-modal-tabs').innerHTML = [
    ['logs', '日志'], ['inspect', '详情'], ['stats', '资源'], ['term', '终端'],
  ].map(([t, l]) => `<button class="btn btn-sm${tab === t ? ' active' : ''}" data-dk-tab="${escAttr(t)}">${l}</button>`).join('');
  $('#dk-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  dkOpenPanel(tab);
  if (tab === 'logs') await dkLoadLogs();
  else if (tab === 'inspect') await dkLoadInspect();
  else if (tab === 'stats') { for (const k of Object.keys(dkHistories)) dkHistories[k] = []; dkPrevStats = null; await dkLoadStats(); }
  else if (tab === 'term') dkInitTerm();
}

function closeDkModal() {
  // v0.4.30：关闭弹窗即断开 PTY 会话，避免 exec 进程与 SSE 长期挂在后台。
  if (dkTerm.sid) void dkTermDisconnect('弹窗已关闭');
  $('#dk-modal').hidden = true;
  document.body.style.overflow = '';
  if (dkModalState.statsTimer) { clearInterval(dkModalState.statsTimer); dkModalState.statsTimer = null; }
  const autoChk = $('#dk-stats-auto');
  if (autoChk) autoChk.checked = false;
}

async function dkLoadLogs() {
  const tail = ($('#dk-log-tail') && $('#dk-log-tail').value) || '200';
  const box = $('#dk-log-content');
  box.textContent = '加载中…';
  try {
    const d = await api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/logs?${dockerQuery()}&tail=${tail}`);
    box.textContent = d.text || '（无日志输出）';
    box.scrollTop = box.scrollHeight;
  } catch (e) { box.textContent = '加载失败：' + e.message; }
}

async function dkLoadInspect() {
  const box = $('#dk-inspect-content');
  box.textContent = '加载中…';
  try {
    const d = await api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/inspect?${dockerQuery()}`);
    box.textContent = JSON.stringify(d, null, 2);
  } catch (e) { box.textContent = '加载失败：' + e.message; }
}

// 双线 SVG 折线图（带面积）
function dkSvgChart2(svgId, seriesA, seriesB, colorA, colorB) {
  const svg = $(`#${svgId}`);
  if (!svg) return;
  const W = 400, H = 120, PAD = 24, RPAD = 12;
  const all = [...(seriesA || []).map((p) => p.v), ...(seriesB || []).map((p) => p.v)];
  const maxV = Math.max(...all, 0.001);
  const n = Math.max((seriesA || []).length, (seriesB || []).length, 1);
  const toX = (i) => PAD + (i / (n - 1 || 1)) * (W - PAD - RPAD);
  const toY = (v) => H - PAD - (v / maxV) * (H - PAD - 10);
  const line = (s, c) => {
    if (!s || !s.length) return '';
    const pts = s.map((p, i) => `${toX(i).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ');
    const areaClose = `${toX(s.length - 1).toFixed(1)},${(H - PAD)} ${PAD},${(H - PAD)}`;
    return `<polygon fill="${c}" opacity="0.15" points="${pts} ${areaClose}" />
      <polyline fill="none" stroke="${c}" stroke-width="1.8" points="${pts}" />`;
  };
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = toY(maxV * f).toFixed(1);
    const label = (maxV * f).toFixed(maxV < 1 ? 3 : maxV < 100 ? 1 : 0);
    return `<line x1="${PAD}" y1="${y}" x2="${W - RPAD}" y2="${y}" stroke="var(--border)" stroke-width="0.5" />
      <text x="${PAD - 3}" y="${y}" font-size="8" fill="var(--muted)" text-anchor="end" dominant-baseline="middle">${label}</text>`;
  });
  const timeLabels = (seriesA || seriesB || []).filter((_, i, a) => i === 0 || i === a.length - 1).map((p, j, a) =>
    `<text x="${j === 0 ? PAD : W - RPAD}" y="${H - 4}" font-size="8" fill="var(--muted)" text-anchor="${j === 0 ? 'start' : 'end'}">${p.label || ''}</text>`
  );
  svg.innerHTML = gridLines.join('') + line(seriesA, colorA) + line(seriesB, colorB) + timeLabels.join('');
}

function dkSvgChart(svgId, points, color) {
  dkSvgChart2(svgId, points, null, color, null);
}

const dkHistories = { cpu: [], mem: [], memCache: [], blkR: [], blkW: [], netRx: [], netTx: [] };
let dkPrevStats = null; // 上一次采样值，用于差值计算

async function dkLoadStats() {
  const info = $('#dk-stats-info');
  try {
    const d = await api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/stats?${dockerQuery()}`);
    if (!d || !d.available) {
      const msg = `<div class="muted small" style="padding:16px">${(d && d.hint) || '容器未运行或不支持实时统计'}</div>`;
      if (info) info.outerHTML = msg;
      return;
    }
    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // 基础信息
    const ml = $('#dk-info-memlimit'); if (ml) ml.textContent = d.memLimitMB ? (d.memLimitMB / 1024).toFixed(2) + ' GB' : '不限';
    const pt = $('#dk-info-pids'); if (pt) pt.textContent = d.pids || '-';
    const ntx = $('#dk-info-nettx'); if (ntx) ntx.textContent = fmtKB(d.netTxKB);
    const nrx = $('#dk-info-netrx'); if (nrx) nrx.textContent = fmtKB(d.netRxKB);

    // CPU 直接用百分比
    dkHistories.cpu.push({ v: d.cpuPercent, label: now });

    // 内存（MB）
    dkHistories.mem.push({ v: d.memUsedMB, label: now });
    dkHistories.memCache.push({ v: d.memCacheMB || 0, label: now });

    // 磁盘/网络需要差值（累计值的速率）
    if (dkPrevStats) {
      const dt = 1; // 2 秒轮询，取 1 作为系数（近似）
      dkHistories.blkR.push({ v: Math.max(0, d.blkReadKB - dkPrevStats.blkReadKB) / dt, label: now });
      dkHistories.blkW.push({ v: Math.max(0, d.blkWriteKB - dkPrevStats.blkWriteKB) / dt, label: now });
      dkHistories.netRx.push({ v: Math.max(0, d.netRxKB - dkPrevStats.netRxKB) / dt, label: now });
      dkHistories.netTx.push({ v: Math.max(0, d.netTxKB - dkPrevStats.netTxKB) / dt, label: now });
    } else {
      dkHistories.blkR.push({ v: 0, label: now });
      dkHistories.blkW.push({ v: 0, label: now });
      dkHistories.netRx.push({ v: 0, label: now });
      dkHistories.netTx.push({ v: 0, label: now });
    }
    dkPrevStats = d;

    // 限制历史长度
    for (const k of Object.keys(dkHistories)) {
      if (dkHistories[k].length > 30) dkHistories[k].shift();
    }

    // 渲染 4 图表
    dkSvgChart('dk-chart-cpu', dkHistories.cpu, '#3b82f6');
    dkSvgChart2('dk-chart-mem', dkHistories.mem, dkHistories.memCache, '#3b82f6', '#ec4899');
    dkSvgChart2('dk-chart-blk', dkHistories.blkR, dkHistories.blkW, '#ec4899', '#3b82f6');
    dkSvgChart2('dk-chart-net', dkHistories.netTx, dkHistories.netRx, '#f97316', '#3b82f6');

    const t = $('#dk-stats-time'); if (t) t.textContent = '更新于 ' + now;
  } catch (e) { const t = $('#dk-stats-time'); if (t) t.textContent = '加载失败：' + e.message; }
}

function fmtKB(kb) {
  if (!kb && kb !== 0) return '-';
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  return (kb / 1024).toFixed(2) + ' MB';
}

/* ---------- v0.4.30 容器交互式终端（xterm.js + Docker exec PTY 流式接口） ---------- */
const dkTerm = {
  sid: '', term: null, fit: null, source: null, onData: null,
  resizeObserver: null, connected: false,
};

function dkTermSetState(text, tone) {
  const el = $('#dk-term-state');
  if (!el) return;
  el.textContent = text;
  el.className = `chip${tone ? ` chip-${tone}` : ''}`;
}

function dkTermWrite(text) {
  if (dkTerm.term) dkTerm.term.write(text);
}

/** 断开并释放 xterm / SSE / 后端会话；关闭弹窗、切换标签页时都会调用。 */
async function dkTermDisconnect(reason) {
  const sid = dkTerm.sid;
  dkTerm.sid = '';
  dkTerm.connected = false;
  if (dkTerm.source) { try { dkTerm.source.close(); } catch { /* noop */ } dkTerm.source = null; }
  if (dkTerm.resizeObserver) { try { dkTerm.resizeObserver.disconnect(); } catch { /* noop */ } dkTerm.resizeObserver = null; }
  if (sid) {
    try {
      await api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/terminal/close?${dockerQuery()}`, {
        method: 'POST', body: { sid },
      });
    } catch { /* 后端可能已回收 */ }
  }
  if (dkTerm.term) {
    try { dkTerm.term.write(`\r\n\x1b[90m[${reason || '已断开'}]\x1b[0m\r\n`); } catch { /* noop */ }
  }
  dkTermSetState('未连接', '');
}

function dkInitTerm() {
  // 每次切到终端标签：已有会话就聚焦并自适应，否则只初始化一次 xterm 实例等待连接。
  const wrap = $('#dk-term-xterm');
  if (!wrap) return;
  if (dkTerm.term) {
    if (dkTerm.fit) { try { dkTerm.fit.fit(); } catch { /* noop */ } }
    if (dkTerm.connected) dkTerm.term.focus();
    return;
  }
  if (typeof Terminal === 'undefined') {
    wrap.innerHTML = '<div class="notice error" style="margin:12px;color:#fecaca;background:#451b1b;border:0">终端组件未加载：请确认 /vendor/xterm.min.js 已部署</div>';
    return;
  }
  const term = new Terminal({
    cols: 100, rows: 28, cursorBlink: true, fontSize: 13, scrollback: 5000,
    fontFamily: 'Consolas, "SF Mono", Menlo, monospace',
    theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#60a5fa', selectionBackground: '#1d4ed855' },
  });
  if (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) {
    dkTerm.fit = new FitAddon.FitAddon();
    term.loadAddon(dkTerm.fit);
  }
  term.open(wrap);
  dkTerm.term = term;
  try { dkTerm.fit && dkTerm.fit.fit(); } catch { /* noop */ }
  dkTerm.onData = (data) => {
    if (!dkTerm.sid) return;
    api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/terminal/input?${dockerQuery()}`, {
      method: 'POST', body: { sid: dkTerm.sid, input: data },
    }).catch(() => {});
  };
  term.onData(dkTerm.onData);
  dkTermWrite('\x1b[90m点击「连接」进入容器交互式终端（sh / bash，可切换 root 权限）\x1b[0m\r\n');
  // 弹窗尺寸变化时同步 xterm 列宽与后端 PTY 窗口。
  if (typeof ResizeObserver !== 'undefined') {
    dkTerm.resizeObserver = new ResizeObserver(() => {
      if (!dkTerm.term || !$('#dk-term-xterm') || $('#dk-term-xterm').offsetParent === null) return;
      try { dkTerm.fit && dkTerm.fit.fit(); } catch { /* noop */ }
      if (dkTerm.sid) dkTermResize();
    });
    dkTerm.resizeObserver.observe(wrap);
  }
}

function dkTermResize() {
  if (!dkTerm.sid || !dkTerm.term) return;
  api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/terminal/resize?${dockerQuery()}`, {
    method: 'POST', body: { sid: dkTerm.sid, cols: dkTerm.term.cols, rows: dkTerm.term.rows },
  }).catch(() => {});
}

async function dkTermConnect() {
  const wrap = $('#dk-term-xterm');
  if (!wrap) return;
  if (dkTerm.sid) { toast('终端已连接；如需换 shell 或 root，请先点「断开」', true); return; }
  dkInitTerm();
  if (!dkTerm.term) return;
  dkTermSetState('连接中…', '');
  const shell = ($('#dk-term-shell') && $('#dk-term-shell').value) || 'sh';
  const root = Boolean($('#dk-term-root') && $('#dk-term-root').checked);
  try {
    const session = await api(`/docker/containers/${encodeURIComponent(dkModalState.id)}/terminal/open?${dockerQuery()}`, {
      method: 'POST', body: {
        target: dockerState.target, shell, root,
        confirm: true,
        cols: dkTerm.term.cols, rows: dkTerm.term.rows,
      },
    });
    dkTerm.sid = session.sid;
    dkTerm.connected = true;
    dkTermSetState(`已连接 · ${shell}${root ? ' · root' : ''}`, 'green');
    // 建立 SSE 输出流（Tty=true 时是原始字节，base64 编码在每个事件里）。
    dkTerm.source = new EventSource(`/api/docker/containers/${encodeURIComponent(dkModalState.id)}/terminal/stream?sid=${encodeURIComponent(session.sid)}&target=${encodeURIComponent(dockerState.target)}${streamToken()}`);
    dkTerm.source.onmessage = (event) => {
      if (!dkTerm.term) return;
      try {
        const binary = atob(event.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        dkTerm.term.write(bytes);
      } catch { /* 忽略坏帧 */ }
    };
    dkTerm.source.addEventListener('closed', (event) => {
      let reason = '容器终端已关闭';
      try { reason = JSON.parse(event.data).reason || reason; } catch { /* noop */ }
      // 后端以 200 结束 SSE 流；不 close() 会被浏览器当成断线每 3 秒自动重连、刷屏。
      if (dkTerm.source) { try { dkTerm.source.close(); } catch { /* noop */ } dkTerm.source = null; }
      dkTerm.sid = '';
      dkTerm.connected = false;
      dkTermSetState(reason, '');
      dkTermWrite(`\r\n\x1b[90m[${reason}]\x1b[0m\r\n`);
    });
    dkTerm.source.onerror = () => {
      if (dkTerm.sid) dkTermSetState('连接中断', '');
    };
    dkTermResize();
    dkTerm.term.focus();
  } catch (e) {
    dkTermSetState('连接失败', '');
    dkTermWrite(`\r\n\x1b[31m连接失败：${e.message}\x1b[0m\r\n`);
  }
}

async function dkRunCmd() { /* v0.4.30：一次性命令终端已由 xterm PTY 取代，保留空实现兼容旧调用点 */ }

// 弹窗事件绑定
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'dk-modal-close') { closeDkModal(); return; }
  if (e.target && e.target.id === 'dk-modal-mask') { closeDkModal(); return; }
  const tab = e.target && e.target.closest ? e.target.closest('[data-dk-tab]') : null;
  if (tab && $('#dk-modal') && !$('#dk-modal').hidden) {
    const t = tab.dataset.dkTab;
    dkOpenPanel(t);
    if (t === 'logs') dkLoadLogs();
    else if (t === 'inspect') dkLoadInspect();
    else if (t === 'stats') { for (const k of Object.keys(dkHistories)) dkHistories[k] = []; dkPrevStats = null; dkLoadStats(); }
    else if (t === 'term') dkInitTerm();
    return;
  }
  if (e.target && e.target.id === 'dk-log-refresh') { dkLoadLogs(); return; }
  if (e.target && e.target.id === 'dk-log-copy') { copyText($('#dk-log-content').textContent, '日志已复制'); return; }
  if (e.target && e.target.id === 'dk-stats-refresh') { dkLoadStats(); return; }
  if (e.target && e.target.id === 'dk-term-connect') { dkTermConnect(); return; }
  if (e.target && e.target.id === 'dk-term-disconnect') { dkTermDisconnect('用户已断开'); return; }
  if (e.target && e.target.id === 'dk-term-clear') { if (dkTerm.term) dkTerm.term.clear(); return; }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#dk-modal') && !$('#dk-modal').hidden) { closeDkModal(); return; }
  // v0.4.30：Git 仓库弹窗（后开的优先）
  if (e.key === 'Escape' && $('#repo-files-modal') && !$('#repo-files-modal').hidden) { closeRepoFilesModal(); return; }
  if (e.key === 'Escape' && $('#repo-clone-modal') && !$('#repo-clone-modal').hidden) { closeRepoCloneModal(); return; }
  if (e.key === 'Escape' && _asModalActive) { closeAsModal(_asModalActive); return; }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'dk-stats-auto') {
    if (e.target.checked) {
      if (!dkModalState.statsTimer) dkModalState.statsTimer = setInterval(() => { if (!$('#dk-modal').hidden && dkModalState.tab === 'stats') dkLoadStats(); }, 2000);
    } else {
      if (dkModalState.statsTimer) { clearInterval(dkModalState.statsTimer); dkModalState.statsTimer = null; }
    }
    return;
  }
  if (e.target && e.target.id === 'dk-log-tail') { dkLoadLogs(); return; }
});

const dockerQuery = () => `target=${encodeURIComponent(dockerState.target)}`;
const dockerNeedConfirm = async (label, owned) => {
  if (owned) return await confirmDialog({ message: `确定对平台自建对象执行「${label}」？` });
  return await confirmDialog({ message: `该对象不是平台创建的（可能是宿主机上的其它服务）。\n确定继续执行「${label}」？误操作可能影响生产服务。` })
    && await confirmDialog({ message: '再次确认：此操作不可撤销，继续？' });
};

// 拆分成独立页后，Docker 操作按钮分散在多个 section，统一用文档级委托。
document.addEventListener('click', async (e) => {
  const button = e.target && e.target.closest ? e.target.closest('[data-dk-op]') : null;
  if (!button) return;
  const op = button.dataset.dkOp;
  const id = button.dataset.dkId || '';
  const ref = button.dataset.dkRef || '';
  const owned = button.dataset.dkOwned === '1';
  const label = { start: '启动', stop: '停止', restart: '重启', remove: '删除容器',
    rmi: '删除镜像', rmvol: '删除存储卷', rmnet: '删除网络', rmtpl: '删除模板', proxy: '设置单个容器代理' }[op] || op;
  if (op === 'proxy') {
    gotoProxyOverride('docker', button.dataset.dkName || id);
    return;
  }
  try {
    if (['start', 'stop', 'restart'].includes(op)) {
      if (!(await dockerNeedConfirm(label, owned))) return;
      const d = await api(`/docker/containers/${encodeURIComponent(id)}/action`, {
        method: 'POST', body: { target: dockerState.target, action: op, confirm: true },
      });
      toast(d.detail || '操作已完成');
      await loadDocker();
    } else if (op === 'remove') {
      if (!(await dockerNeedConfirm(label, owned))) return;
      const d = await api(`/docker/containers/${encodeURIComponent(id)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      toast(d.removed ? '容器已删除' : '操作已完成');
      await loadDocker();
    } else if (op === 'logs') {
      openDkModal(id, button.dataset.dkName || id, 'logs');
    } else if (op === 'inspect') {
      openDkModal(id, button.dataset.dkName || id, 'inspect');
    } else if (op === 'stats') {
      openDkModal(id, button.dataset.dkName || id, 'stats');
    } else if (op === 'term') {
      openDkModal(id, button.dataset.dkName || id, 'term');
    } else if (op === 'export') {
      window.open(`/api/docker/images/export?${dockerQuery()}&ref=${encodeURIComponent(ref)}${streamToken()}`, '_blank');
    } else if (op === 'rmi') {
      if (!(await dockerNeedConfirm(label, false))) return;
      await api(`/docker/images/remove?${dockerQuery()}&confirm=true`, { method: 'POST', body: { ref, target: dockerState.target, confirm: true } });
      toast('镜像已删除');
      await loadDocker();
    } else if (op === 'rmvol') {
      if (!(await dockerNeedConfirm(label, false))) return;
      await api(`/docker/volumes/${encodeURIComponent(ref)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      await loadDocker();
    } else if (op === 'rmnet') {
      if (!(await dockerNeedConfirm(label, false))) return;
      await api(`/docker/networks/${encodeURIComponent(ref)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      await loadDocker();
    } else if (op === 'rmtpl') {
      if (!await confirmDialog({ message: '确定删除这份编排模板？' })) return;
      await api(`/docker/templates/${encodeURIComponent(ref)}`, { method: 'DELETE' });
      await renderDockerTemplates();
    }
  } catch (err) { toast(err.message || String(err), true); }
});

$('#docker-pull-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const box = $('#docker-pull-result');
  try {
    toast('正在拉取镜像，请稍候…');
    const d = await api('/docker/images/pull', { method: 'POST', body: { ...body, target: dockerState.target } });
    if (box) {
      box.hidden = false;
      box.innerHTML = `✔ 已拉取 <b>${esc(d.pulled || `${body.image}:${body.tag || 'latest'}`)}</b>${d.usedFallback ? '<br />加速源不可用，平台已自动回退到 Docker Hub 原始镜像。' : ''}`;
    }
    toast(`镜像 ${body.image}:${body.tag || 'latest'} 已拉取`);
    e.target.reset();
    await loadDocker();
  } catch (err) {
    if (box) { box.hidden = false; box.innerHTML = `<b>拉取失败</b>：${esc(err.message || String(err))}`; }
    toast(err.message || String(err), true);
  }
});

$('#docker-load-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const file = form.elements.file.files[0];
  const remotePath = String(form.elements.path.value || '').trim();
  try {
    if (file) {
      toast(`正在导入 ${file.name}（${fmtSize(file.size)}），请稍候…`);
      const response = await fetch(`/api/docker/images/load?${dockerQuery()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...authHeaders() },
        body: await file.arrayBuffer(),
      });
      if (!response.ok) throw new Error(`服务端返回 HTTP ${response.status}（网关可能未转发到平台）`);
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || '导入失败');
      toast(json.data && json.data.loaded ? `已导入 ${json.data.loaded}` : '镜像导入完成');
    } else if (remotePath) {
      toast('正在从服务器已有路径导入…');
      await api('/docker/images/load-path', { method: 'POST', body: { target: dockerState.target, path: remotePath } });
      toast('镜像导入完成');
    } else {
      toast('请选择 ≤100MB 的 tar 文件，或填写服务器上已有的镜像路径', true);
      return;
    }
    form.reset();
    await loadDocker();
  } catch (err) { toast(err.message || String(err), true); }
});

$('#docker-volume-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/docker/volumes', { method: 'POST', body: { ...formData(e.target), target: dockerState.target } });
    toast('存储卷已创建'); e.target.reset(); await loadDocker();
  } catch (err) { toast(err.message || String(err), true); }
});

$('#docker-network-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/docker/networks', { method: 'POST', body: { ...formData(e.target), target: dockerState.target } });
    toast('网络已创建'); e.target.reset(); await loadDocker();
  } catch (err) { toast(err.message || String(err), true); }
});

$('#docker-template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    // CodeMirror 的内容在编辑器实例里，提交前显式回写 textarea，保证 FormData 拿到最新文本。
    const area = $('#docker-template-content');
    if (area) area.value = composeContent();
    await api('/docker/templates', { method: 'POST', body: formData(e.target) });
    toast('编排模板已保存（仅保存文本，不在平台内执行）');
    e.target.reset();
    setComposeContent('');
    await renderDockerTemplates();
  } catch (err) { toast(err.message || String(err), true); }
});

$('#kind-seg').addEventListener('click', (e) => {
  const button = e.target.closest('.seg-btn');
  if (button) setProviderKind(button.dataset.kind);
});
$('#detect-btn').addEventListener('click', () => detectPrograms(true));
$('#cli-runner').addEventListener('change', () => {
  if ($('#cli-runner').value === 'wsl' && detectedPrograms && detectedPrograms.platform !== 'win32') {
    toast('当前平台不是 Windows，WSL 运行位置不可用', true);
  }
});

/** 新建仓库：凭据方式切换，只展示当前方式需要的字段。 */
function syncRepoAuthFields() {
  const mode = ($('#repo-auth-mode') && $('#repo-auth-mode').value) || 'source';
  const inline = mode === 'password' || mode === 'token';
  const box = $('#repo-inline-fields'); if (box) box.hidden = !inline;
  const u = $('#repo-username-field'); if (u) u.hidden = mode !== 'password';
  const p = $('#repo-password-field'); if (p) p.hidden = mode !== 'password';
  const t = $('#repo-token-field'); if (t) t.hidden = mode !== 'token';
}
const repoAuthMode = $('#repo-auth-mode');
if (repoAuthMode) repoAuthMode.addEventListener('change', syncRepoAuthFields);

$('#repo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  body.private = e.target.elements.private.checked;
  body.autoWorkspace = e.target.elements.autoWorkspace.checked;
  const mode = String(body.authMode || 'source');
  if (mode !== 'password') { delete body.username; delete body.password; }
  if (mode !== 'token') delete body.token;
  if (mode === 'password' && (!body.username || !body.password)) { toast('请填写用户名和密码', true); return; }
  if (mode === 'token' && !body.token) { toast('请填写访问令牌 Token', true); return; }
  try {
    const d = await api('/repos', { method: 'POST', body });
    let msg = `仓库 ${d.repo.name || ''} 已创建`;
    if (d.repo.workspace && d.repo.workspace.path) msg += `，已克隆到 ${d.repo.workspace.path}`;
    else if (d.repo.workspaceError) msg += `（自动克隆失败：${d.repo.workspaceError}，可到列表手动克隆）`;
    toast(msg);
    e.target.reset();
    syncRepoAuthFields();
    loadRepos();
  } catch (err) { toast(err.message, true); }
});

/** 克隆凭据方式切换：只展示当前方式需要的字段，避免残留值被误提交。 */
/** v0.4.19 E 批：上传仓库压缩包导入为工作区仓库。 */
$('#repo-import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const file = form.elements.file.files[0];
  if (!file) { toast('请选择仓库压缩包', true); return; }
  if (file.size > 100 * 1024 * 1024) { toast('压缩包不能超过 100MB', true); return; }
  const name = String(form.elements.name.value || '').trim();
  const query = new URLSearchParams();
  if (name) query.set('name', name);
  query.set('filename', file.name);
  toast(`正在上传并导入 ${file.name}（${fmtSize(file.size)}），请稍候…`);
  try {
    const response = await fetch(`/api/repos/import?${query.toString()}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', ...authHeaders() },
      body: await file.arrayBuffer(),
    });
    if (!response.ok) throw new Error(`服务端返回 HTTP ${response.status}（网关可能未转发到平台）`);
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || '导入失败');
    const d = json.data || {};
    let msg = `已导入仓库 ${d.name}（${d.path || ''}）`;
    if (d.gitOnly) msg += d.recovery && d.recovery.ok ? '，已自动从 .git 恢复工作树文件' : '，仅含 .git；工作树恢复未自动完成（见页面说明）';
    else msg += '（含工作树文件）';
    toast(msg); form.reset(); loadRepos();
  } catch (err) { toast(err.message, true); }
});

function syncCloneAuthFields() {
  const mode = ($('#clone-auth-mode') && $('#clone-auth-mode').value) || 'source';
  const inline = mode === 'password' || mode === 'token';
  $('#clone-inline-fields').hidden = !inline;
  $('#clone-username-field').hidden = mode !== 'password';
  $('#clone-password-field').hidden = mode !== 'password';
  $('#clone-token-field').hidden = mode !== 'token';
  const src = $('#clone-source');
  if (src) src.disabled = mode !== 'source';
}
$('#clone-auth-mode').addEventListener('change', syncCloneAuthFields);

$('#clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const mode = String(body.authMode || 'source');
  delete body.authMode;
  if (mode !== 'password') { delete body.username; delete body.password; }
  if (mode !== 'token') delete body.token;
  if (mode === 'none') body.sourceId = '';
  if (mode === 'password' && (!body.username || !body.password)) { toast('请填写用户名和密码 / PAT', true); return; }
  if (mode === 'token' && !body.token) { toast('请填写访问令牌 Token', true); return; }
  const conflictBox = $('#clone-conflict');
  if (conflictBox) conflictBox.hidden = true;
  try {
    const d = await api('/repos/clone', { method: 'POST', body });
    toast(`已克隆到 ${d.path}${d.authenticated ? '（已携带凭据）' : ''}${d.channelLabel ? ` · ${d.channelLabel}` : ''}；可在「仓库列表 / 在线 IDE」打开`);
    // 本次填写的凭据不留在表单里，也不写入 state.json。
    if (e.target.elements.password) e.target.elements.password.value = '';
    if (e.target.elements.token) e.target.elements.token.value = '';
    // v0.4.30：克隆成功后关闭弹窗并回到仓库列表。
    const cloneModal = $('#repo-clone-modal');
    if (cloneModal && !cloneModal.hidden) {
      cloneModal.hidden = true;
      document.body.style.overflow = '';
      switchView('repos');
    }
    loadRepos();
  } catch (err) {
    // v0.3.6：409 是「工作区已有同名目录」的业务冲突，给出可操作指引，
    // 不再显示成含糊的「服务端异常 500」。
    if (err.status === 409 && conflictBox) {
      conflictBox.innerHTML = `<b>克隆未执行</b>：${esc(err.rawError || err.message)}<br />
        <span class="muted">${esc(err.hint || '请换一个本地目录名，或清理工作区里的同名目录后重试。')}</span><br />
        <span class="row gap" style="margin-top:8px">
          <button class="btn btn-sm" type="button" data-clone-goto="repos">打开仓库列表</button>
          <button class="btn btn-sm" type="button" data-clone-goto="ide">打开在线 IDE</button>
        </span>`;
      conflictBox.hidden = false;
      conflictBox.querySelectorAll('[data-clone-goto]').forEach((b) => {
        b.addEventListener('click', () => {
          const cloneModal = $('#repo-clone-modal');
          if (cloneModal && !cloneModal.hidden) { cloneModal.hidden = true; document.body.style.overflow = ''; }
          switchView(b.dataset.cloneGoto);
        });
      });
      toast('工作区已有同名目录，请按下方提示处理', true);
    } else toast(err.message, true);
  }
});

$('#git-runtime-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/git/runtime', { method: 'PUT', body: {
      bin: String(e.target.elements.bin.value || '').trim(),
      sshFallback: e.target.elements.sshFallback.value !== 'off',
    } });
    toast('Git 运行时配置已保存并重新检测');
    await loadGitRuntime();
  } catch (err) { toast(err.message, true); }
});

$('#git-runtime-refresh').addEventListener('click', refreshGitRuntime);

/* --------------------------- v0.3.10 交互绑定 --------------------------- */
const idePlainAllowed = () => Boolean(currentUser && currentUser.role === 'admin');
const ideCredRevealBtn = $('#ide-cred-reveal');
if (ideCredRevealBtn) ideCredRevealBtn.addEventListener('click', async () => {
  if (!idePlainAllowed()) { toast('IDE 明文密码仅管理员可查看', true); return; }
  try { await revealIdePassword(); toast('已显示当前 IDE 登录密码'); }
  catch (e) { toast(e.message, true); }
});
const ideCredCopyBtn = $('#ide-cred-copy');
if (ideCredCopyBtn) ideCredCopyBtn.addEventListener('click', async () => {
  if (!idePlainAllowed()) { toast('IDE 明文密码仅管理员可查看', true); return; }
  try {
    const pwd = await revealIdePassword();
    if (!pwd) { toast('没有可复制的密码：请先在环境配置页设置', true); return; }
    await navigator.clipboard.writeText(pwd);
    toast('IDE 登录密码已复制');
  } catch (e) { toast(e.message, true); }
});
const ideCredEnvBtn = $('#ide-cred-env');
if (ideCredEnvBtn) ideCredEnvBtn.addEventListener('click', () => {
  // 「集成服务」卡片在总览首屏，切过去后展开凭据面板并滚到可见位置。
  switchView('overview');
  setTimeout(() => {
    const box = $('#svc-credentials');
    if (box) { box.hidden = false; if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    void loadServiceCredentials();
  }, 260);
});

const hostInfoRefreshBtn = $('#host-info-refresh');
if (hostInfoRefreshBtn) hostInfoRefreshBtn.addEventListener('click', () => { void loadHostInfo(true); });

// v0.4.31：Git 操作弹窗改为 TortoiseGit 式多标签工作台。
// 自定义命令表单由 renderGitCustom() 动态绑定（见工作台 JS），此处只保留关闭 / 刷新 / ESC。
const repoGitRefreshBtn = $('#repo-git-refresh');
if (repoGitRefreshBtn) repoGitRefreshBtn.addEventListener('click', () => {
  for (const k of Object.keys(repoGitCache)) delete repoGitCache[k];
  void refreshGitTab(repoGitTab);
});
$$('[data-repo-git-close]').forEach((b) => b.addEventListener('click', closeRepoGitModal));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = $('#repo-git-modal');
  if (m && !m.hidden) closeRepoGitModal();
});

/* ----------------- 环境适配中心：配置 / 体检 / 处置（v0.3.4） ----------------- */
const envConfigForm = $('#env-config-form');
if (envConfigForm) envConfigForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/environment/config', { method: 'PUT', body: {
      activeProfile: $('#env-profile').value,
      strategies: {
        gitClone: $('#env-git-clone').value,
        buildExecutor: $('#env-build-executor').value,
        gitInstall: $('#env-git-install').value,
        sshFallback: $('#env-ssh-fallback').value,
      },
      autoHeal: $('#env-auto-heal').checked,
      checkOnStartup: $('#env-check-startup').checked,
    } });
    toast('环境策略已保存');
    await loadEnvironment();
  } catch (err) { toast(err.message, true); }
});

const envCheckBtn = $('#env-check');
if (envCheckBtn) envCheckBtn.addEventListener('click', async () => {
  try {
    renderEnvironment(await api('/environment/check', { method: 'POST', body: {} }));
    toast('已完成深度体检（含 SSH 宿主机实测）');
  } catch (err) { toast(err.message, true); }
});

const envHealBtn = $('#env-heal');
if (envHealBtn) envHealBtn.addEventListener('click', async () => {
  try {
    const d = await api('/environment/heal', { method: 'POST', body: {} });
    toast(`自动处置完成：${(d.actions || []).length} 个动作，克隆通道 ${d.applied.gitClone}`);
    await loadEnvironment();
  } catch (err) { toast(err.message, true); }
});

const envSwitchBtn = $('#env-switch-apply');
if (envSwitchBtn) envSwitchBtn.addEventListener('click', async () => {
  try {
    const d = await api('/environment/switch', { method: 'POST', body: { id: $('#env-profile').value } });
    toast(`已切换到「${d.profile.name}」并应用：克隆通道 ${d.applied.gitClone}`);
    await loadEnvironment();
  } catch (err) { toast(err.message, true); }
});

const envProfileForm = $('#env-profile-form');
if (envProfileForm) envProfileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/environment/profiles', { method: 'POST', body: {
      id: e.target.elements.id.value,
      name: e.target.elements.name.value,
      description: e.target.elements.description.value,
      strategies: {
        gitClone: $('#env-git-clone').value,
        buildExecutor: $('#env-build-executor').value,
        gitInstall: $('#env-git-install').value,
        sshFallback: $('#env-ssh-fallback').value,
      },
    } });
    toast('已另存为自定义环境档案');
    e.target.reset();
    await loadEnvironment();
  } catch (err) { toast(err.message, true); }
});

// 自定义档案删除按钮是动态渲染的，用文档级委托。
document.addEventListener('click', async (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-env-del]') : null;
  if (!btn) return;
  try {
    await api(`/environment/profiles/${encodeURIComponent(btn.dataset.envDel)}`, { method: 'DELETE' });
    toast('自定义档案已删除');
    await loadEnvironment();
  } catch (err) { toast(err.message, true); }
});

$('#ide-open').addEventListener('click', openIde);
const ideBrowseBtn = $('#ide-browse');
if (ideBrowseBtn) ideBrowseBtn.addEventListener('click', () => openIdeDirPicker('ide-path'));
// v0.4.7：构建部署「启动构建」项目目录复用同一个工作区目录选择器。
const buildPathBrowseBtn = $('#build-path-browse');
if (buildPathBrowseBtn) buildPathBrowseBtn.addEventListener('click', () => openIdeDirPicker('build-repo-path'));
const ideGotoConfigBtn = $('#ide-goto-config');
if (ideGotoConfigBtn) ideGotoConfigBtn.addEventListener('click', () => switchView('ide-config'));
const ideConfigGotoBtn = $('#ide-config-goto');
if (ideConfigGotoBtn) ideConfigGotoBtn.addEventListener('click', () => switchView('ide'));

// 服务器状态自动刷新：间隔可切换并记住；从后台标签切回来时立即补一次。
$('#server-poll-interval').addEventListener('change', (e) => {
  const ms = Number(e.target.value) || 0;
  localStorage.setItem(SERVER_POLL_KEY, String(ms));
  restartServerPolling();
  toast(ms > 0 ? `状态自动刷新：每 ${ms / 1000} 秒` : '状态自动刷新已关闭');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) serverPollTick(); });

$('#storage-path-form').addEventListener('submit', (e) => {
  e.preventDefault();
  currentStoragePath = $('#storage-path').value.trim() || '/';
  loadStorage();
});
$('#storage-up').addEventListener('click', () => { currentStoragePath = pathParent(currentStoragePath); loadStorage(); });
$('#storage-refresh').addEventListener('click', () => loadStorage());
$('#openlist-refresh').addEventListener('click', () => loadStorage());
$('#storage-select-all').addEventListener('change', (e) => {
  $$('[data-ol-file]').forEach((box) => {
    box.checked = e.target.checked;
    if (e.target.checked) storageState.selected.add(box.dataset.olFile);
    else storageState.selected.delete(box.dataset.olFile);
  });
});
$$('[data-ol-action]').forEach((b) => b.addEventListener('click', () => olAction(b.dataset.olAction)));
$('#mkdir-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/openlist/files/mkdir', { method: 'POST', body: { path: currentStoragePath, name: e.target.elements.name.value } });
    toast('目录已创建'); e.target.reset(); loadStorage();
  } catch (err) { toast(err.message, true); }
});
// v0.4.7：新建空文件 —— 用 PUT content 写入空内容创建文件，等价于上传空 buffer。
$('#newfile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = String(e.target.elements.name.value || '').trim();
  if (!name) return;
  if (name.includes('/')) { toast('文件名不能包含 /', true); return; }
  try {
    await api('/openlist/files/content', { method: 'PUT', body: { path: olJoin(currentStoragePath, name), content: '' } });
    toast('文件已创建'); e.target.reset(); loadStorage();
  } catch (err) { toast(err.message, true); }
});
// OpenList 的「AI 会话」入口：跳到 DeepSeek Harness 会话式助手，
// 当前目录可在对话中直接引用。原「AI 运维」仍保留在侧栏独立入口。
$('#ol-ai-session').addEventListener('click', () => {
  switchView('aichat');
  toast(`已打开 AI 会话，可在对话中引用目录：${currentStoragePath}`);
});
$('#upload-input').addEventListener('change', (e) => uploadFiles(e.target.files));
$('#ol-conn-new').addEventListener('click', () => fillOpenlistConnectionForm(null));
$('#ol-conn-cancel').addEventListener('click', closeOpenlistConnectionForm);
$('#ol-conn-reload').addEventListener('click', () => loadStorage());
$('#openlist-embed-toggle').addEventListener('click', () => {
  const card = $('#openlist-frame-card');
  if (!card.hidden) { closeAsModal({ cardId: 'openlist-frame-card', onClose: () => { $('#openlist-frame').src = 'about:blank'; } }); return; }
  $('#openlist-frame').src = '/api/openlist/admin';
  openAsModal('openlist-frame-card', { wide: true });
});
$('#openlist-frame-close').addEventListener('click', () => {
  closeAsModal({ cardId: 'openlist-frame-card', onClose: () => { $('#openlist-frame').src = 'about:blank'; } });
});
$('#openlist-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = formData(form);
  const id = String(body.id || '');
  try {
    if (id) await api(`/openlist/connections/${encodeURIComponent(id)}`, { method: 'PUT', body });
    else await api('/openlist/connections', { method: 'POST', body });
    toast(id ? '连接已更新，正在重新检测' : '连接已登记并设为当前，正在重新检测');
    closeOpenlistConnectionForm();
    currentStoragePath = '/';
    await loadStorage();
  } catch (err) { toast(err.message || String(err), true); }
});
$('#openlist-config-reset').addEventListener('click', async () => {
  if (!await confirmDialog({ message: '恢复使用 .env / 环境变量里的默认 OpenList 连接？其它已登记连接会保留。' })) return;
  try {
    await api('/openlist/connection/reset', { method: 'POST', body: {} });
    toast('已恢复 .env 默认连接');
    closeOpenlistConnectionForm();
    currentStoragePath = '/';
    await loadStorage();
  } catch (err) { toast(err.message, true); }
});
// v0.4.28 · 连接根目录映射：切换目标连接后从该连接根目录重新加载（只读映射）。
const rootConnPicker = $('#ol-root-conn-picker');
if (rootConnPicker) rootConnPicker.addEventListener('change', (e) => {
  storageState.rootMapConnId = e.target.value || '';
  currentStoragePath = '/';
  loadStorage();
  toast(storageState.rootMapConnId ? '已切换到所选连接的根目录（只读）' : '已回到当前激活连接');
});

/* ---------- v0.4.28 · Windows 网络盘映射 ---------- */
async function loadDriveMountStatus(drive) {
  const platformEl = $('#dm-platform');
  const noteEl = $('#dm-support-note');
  const controls = $('#dm-controls');
  if (!platformEl || !noteEl || !controls) return;
  try {
    const q = drive ? `?drive=${encodeURIComponent(drive)}` : '';
    const d = await api('/drive-mount/status' + q);
    platformEl.textContent = d.supported ? '● 当前支持（Windows）' : '● 当前不支持（' + (d.platform || '未知') + '）';
    noteEl.textContent = d.supported
      ? (d.session && d.session.visibleHint) || '可把 OpenList WebDAV 根目录映射为本地磁盘。'
      : (d.reason || '当前平台不支持网络盘映射');
    controls.hidden = !d.supported;
    if (d.supported && d.drive) {
      const box = $('#dm-result');
      if (box) { box.hidden = false; box.textContent = d.mapped ? `盘符 ${d.drive} 已映射。${d.detail || ''}` : `盘符 ${d.drive} 未映射。${d.detail || ''}`; }
    }
  } catch (e) {
    platformEl.textContent = '● 检测失败';
    noteEl.textContent = e.message || String(e);
    controls.hidden = true;
  }
}

function dmResult(text) {
  const box = $('#dm-result');
  if (!box) return;
  box.hidden = false;
  box.textContent = text;
  toast(text.slice(0, 120), /失败|错误|不支持/.test(text));
}

const dmMapBtn = $('#dm-map');
if (dmMapBtn) dmMapBtn.addEventListener('click', async () => {
  const body = {
    connectionId: $('#dm-conn').value || undefined,
    drive: $('#dm-drive').value.trim(),
    persistent: $('#dm-persistent').checked,
  };
  if (!/^[A-Za-z]:$/.test(body.drive)) { toast('盘符格式应为单个字母加冒号，如 Z:', true); return; }
  try {
    const r = await api('/drive-mount/map', { method: 'POST', body });
    dmResult(`已把「${r.connectionLabel}」映射到 ${r.drive}（WebDAV ${r.webdav}）${r.session && !r.session.interactive ? '。注意：平台运行于非交互会话，盘符可能不在资源管理器显示。' : '。'}`);
  } catch (e) { dmResult('映射失败：' + (e.message || String(e))); }
});

const dmProbeBtn = $('#dm-probe');
if (dmProbeBtn) dmProbeBtn.addEventListener('click', () => loadDriveMountStatus($('#dm-drive').value.trim()));

const dmUnmapBtn = $('#dm-unmap');
if (dmUnmapBtn) dmUnmapBtn.addEventListener('click', async () => {
  const drive = $('#dm-drive').value.trim();
  if (!/^[A-Za-z]:$/.test(drive)) { toast('盘符格式应为单个字母加冒号，如 Z:', true); return; }
  try {
    const r = await api('/drive-mount/unmap', { method: 'POST', body: { drive } });
    dmResult(`已断开映射 ${r.drive}。`);
  } catch (e) { dmResult('断开失败：' + (e.message || String(e))); }
});

$('#webdav-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#webdav-url').textContent.trim()); toast('WebDAV 地址已复制'); }
  catch { toast('复制失败，请手动选择', true); }
});

/* ---- v0.4.29 · rclone 存储层 / SMB 网关事件 ---- */
const rcloneRefresh = $('#rclone-refresh');
if (rcloneRefresh) rcloneRefresh.addEventListener('click', async () => {
  await loadRclone(); toast('rclone 状态已刷新');
});

const rcloneInstall = $('#rclone-install');
if (rcloneInstall) rcloneInstall.addEventListener('click', async () => {
  try {
    const r = await api('/rclone/install', { method: 'POST', body: {} });
    toast(r.ok ? 'rclone 已安装到 data/bin' : (r.hint || '当前环境不支持自动安装'), !r.ok);
    await loadRcloneStatus();
  } catch (err) { toast(`安装失败：${err.message}`, true); }
});

const rcloneRemoteForm = $('#rclone-remote-form');
if (rcloneRemoteForm) rcloneRemoteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  const fields = {};
  for (const key of ['url', 'user', 'pass', 'endpoint', 'host']) if (f[key]) fields[key] = f[key];
  if (f.extra) {
    try { Object.assign(fields, JSON.parse(f.extra)); }
    catch { toast('其它参数必须是合法 JSON', true); return; }
  }
  const body = { name: f.name, label: f.label || f.name, type: f.type, fields };
  try {
    if (rcloneState.editId) {
      await api(`/rclone/remotes/${encodeURIComponent(rcloneState.editId)}`, { method: 'PUT', body });
      toast('rclone 远端已更新');
    } else {
      await api('/rclone/remotes', { method: 'POST', body });
      toast('rclone 远端已添加');
    }
    rcloneState.editId = '';
    e.target.reset();
    await loadRclone();
  } catch (err) { toast(`保存失败：${err.message}`, true); }
});

const rcloneRemoteReset = $('#rclone-remote-reset');
if (rcloneRemoteReset) rcloneRemoteReset.addEventListener('click', () => {
  rcloneState.editId = '';
  rcloneRemoteForm.reset();
});

const rcloneRemoteList = $('#rclone-remote-list');
if (rcloneRemoteList) rcloneRemoteList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { rcRemoteActivate, rcRemoteProbe, rcRemoteEdit, rcRemoteDel } = btn.dataset;
  const id = rcRemoteActivate || rcRemoteProbe || rcRemoteEdit || rcRemoteDel;
  if (!id) return;
  try {
    if (rcRemoteActivate) { await api(`/rclone/remotes/${encodeURIComponent(id)}/activate`, { method: 'POST', body: {} }); toast('已设为当前远端'); }
    else if (rcRemoteProbe) {
      const r = await api(`/rclone/remotes/${encodeURIComponent(id)}/probe`, { method: 'POST', body: {} });
      toast(`连接正常，根目录 ${r.count} 项`);
    } else if (rcRemoteEdit) {
      const r = (rcloneState.remotes || []).find((x) => x.id === id);
      if (!r) return;
      rcloneState.editId = id;
      const form = rcloneRemoteForm.elements;
      form.name.value = r.name; form.label.value = r.label || ''; form.type.value = r.type;
      form.url.value = r.fields.url || ''; form.user.value = r.fields.user || '';
      form.pass.value = ''; form.pass.placeholder = '留空沿用原值';
      form.endpoint.value = r.fields.endpoint || ''; form.host.value = r.fields.host || '';
      form.extra.value = '';
      form.name.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    } else if (rcRemoteDel) {
      if (!await confirmDialog({ title: '删除确认', message: '确定删除这个 rclone 远端？' })) return;
      await api(`/rclone/remotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('远端已删除');
    }
    await loadRclone();
  } catch (err) { toast(`操作失败：${err.message}`, true); }
});

const rclonePicker = $('#rclone-remote-picker');
if (rclonePicker) rclonePicker.addEventListener('change', () => {
  rcloneState.remote = rclonePicker.value;
  rcloneState.path = '/';
  loadRcloneFiles().catch((e) => rcLog(e.message, true));
});
const rcloneUp = $('#rclone-up');
if (rcloneUp) rcloneUp.addEventListener('click', () => {
  const segs = String(rcloneState.path || '/').split('/').filter(Boolean);
  segs.pop();
  rcloneState.path = `/${segs.join('/')}` || '/';
  loadRcloneFiles().catch((e) => rcLog(e.message, true));
});
const rcloneRefreshFiles = $('#rclone-refresh-files');
if (rcloneRefreshFiles) rcloneRefreshFiles.addEventListener('click', () => loadRcloneFiles().catch((e) => rcLog(e.message, true)));

const rcloneMkdir = $('#rclone-mkdir-form');
if (rcloneMkdir) rcloneMkdir.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  try {
    await api('/rclone/files/mkdir', { method: 'POST', body: { remote: rcloneState.remote, path: rcloneState.path, name: f.name } });
    rcLog(`已新建目录 ${f.name}`);
    e.target.reset();
    loadRcloneFiles();
  } catch (err) { rcLog(`新建失败：${err.message}`, true); }
});

const rcloneUpload = $('#rclone-upload-input');
if (rcloneUpload) rcloneUpload.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      const token = localStorage.getItem('dp_token');
      const qs = new URLSearchParams({ remote: rcloneState.remote, path: rcloneState.path, name: file.name });
      if (token) qs.set('token', token);
      const response = await fetch(`/api/rclone/files/upload?${qs}`, {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...authHeaders() },
        body: await file.arrayBuffer(),
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || '上传失败');
      toast(`已上传 ${file.name}`);
    } catch (err) { toast(`${file.name} 上传失败：${err.message}`, true); }
  }
  e.target.value = '';
  loadRcloneFiles();
});

const rcloneFileList = $('#rclone-file-list');
if (rcloneFileList) rcloneFileList.addEventListener('click', async (e) => {
  const edit = e.target.closest('button[data-rc-edit]');
  if (edit) {
    const name = edit.dataset.rcEdit;
    const next = await promptDialog({ title: `重命名 ${name}`, message: '输入新名称：' }, name);
    if (!next || next === name) return;
    api('/rclone/files/rename', { method: 'POST', body: { remote: rcloneState.remote, path: rcloneState.path, name, newName: next } })
      .then(() => { toast('已重命名'); loadRcloneFiles(); })
      .catch((err) => toast(`重命名失败：${err.message}`, true));
  }
});

$$('[data-rc-action]').forEach((btn) => btn.addEventListener('click', async () => {
  const action = btn.dataset.rcAction;
  const names = Array.from(document.querySelectorAll('#rclone-file-list input[data-rc-file]:checked')).map((x) => x.dataset.rcFile);
  if (action !== 'link' && !names.length) { toast('请先勾选文件', true); return; }
  try {
    if (action === 'remove') {
      if (!await confirmDialog({ title: '删除确认', message: `确定删除选中的 ${names.length} 项？` })) return;
      await api('/rclone/files/remove', { method: 'POST', body: { remote: rcloneState.remote, path: rcloneState.path, names } });
      rcLog(`已删除 ${names.length} 项`);
    } else if (action === 'link') {
      if (names.length !== 1) { toast('获取直链请只勾选一个文件', true); return; }
      const p = `${rcloneState.path === '/' ? '' : `${rcloneState.path}/`}${names[0]}`;
      const r = await api(`/rclone/files/link?remote=${encodeURIComponent(rcloneState.remote || '')}&path=${encodeURIComponent(p)}`);
      rcLog(r.url || '（该后端不支持公开直链）');
      if (r.url && navigator.clipboard) navigator.clipboard.writeText(r.url).catch(() => {});
    } else if (action === 'download') {
      if (names.length !== 1) { toast('下载请只勾选一个文件', true); return; }
      const token = localStorage.getItem('dp_token');
      const p = `${rcloneState.path === '/' ? '' : `${rcloneState.path}/`}${names[0]}`;
      const qs = new URLSearchParams({ remote: rcloneState.remote || '', path: p });
      if (token) qs.set('token', token);
      window.open(`/api/rclone/files/download?${qs}`, '_blank');
      return;
    }
    loadRcloneFiles();
  } catch (err) { rcLog(`操作失败：${err.message}`, true); }
}));

const gwSave = $('#gw-save');
if (gwSave) gwSave.addEventListener('click', async () => {
  const body = {
    remoteId: $('#gw-remote').value, smbPort: Number($('#gw-port').value),
    shareName: $('#gw-share').value.trim(), smbUser: $('#gw-user').value.trim(),
    smbPass: $('#gw-pass').value, winDrive: $('#gw-drive').value.trim(),
  };
  try { await api('/rclone/gateway', { method: 'PUT', body }); gwLog('共享网关设置已保存'); loadGatewayStatus(); }
  catch (err) { gwLog(`保存失败：${err.message}`, true); }
});
const gwStart = $('#gw-start');
if (gwStart) gwStart.addEventListener('click', async () => {
  try { const r = await api('/rclone/gateway/start', { method: 'POST', body: {} }); gwLog(`已启动：${JSON.stringify(r).slice(0, 300)}`); toast('共享网关已启动'); loadGatewayStatus(); }
  catch (err) { gwLog(`启动失败：${err.message}`, true); }
});
const gwStop = $('#gw-stop');
if (gwStop) gwStop.addEventListener('click', async () => {
  try { await api('/rclone/gateway/stop', { method: 'POST', body: {} }); gwLog('共享网关已停止'); toast('共享网关已停止'); loadGatewayStatus(); }
  catch (err) { gwLog(`停止失败：${err.message}`, true); }
});
const gwLogs = $('#gw-logs');
if (gwLogs) gwLogs.addEventListener('click', async () => {
  try {
    const r = await api('/rclone/gateway/logs?tail=120');
    const box = $('#gw-log-view');
    box.hidden = false; box.textContent = (r.lines || []).join('\n') || '（无日志）';
  } catch (err) { gwLog(`读取日志失败：${err.message}`, true); }
});
const gwFspInstall = $('#gw-winfsp-install');
if (gwFspInstall) gwFspInstall.addEventListener('click', async () => {
  gwFspInstall.disabled = true;
  gwLog('正在静默安装 WinFsp（约 10-30 秒）…');
  try {
    const r = await api('/rclone/gateway/winfsp/install', { method: 'POST', body: {} });
    gwLog(`WinFsp 安装完成：${JSON.stringify(r).slice(0, 300)}`);
    if (r.rebootRequired) toast('WinFsp 已安装，需重启一次后生效', true);
    else toast('WinFsp 已安装');
    loadGatewayStatus();
  } catch (err) { gwLog(`WinFsp 安装失败：${err.message}`, true); toast('WinFsp 安装失败，详见结果框', true); }
  finally { gwFspInstall.disabled = false; }
});
$('#storage-storages-reload').addEventListener('click', () => loadStorage());
$('#storage-drivers-reload').addEventListener('click', () => loadStorage());
$('#storage-add-toggle').addEventListener('click', () => {
  const form = $('#storage-add-form');
  form.hidden = !form.hidden;
  if (!form.hidden) { $('#ol-storage-id').value = ''; storageState.editId = ''; }
});
$('#storage-add-cancel').addEventListener('click', () => {
  $('#storage-add-form').hidden = true;
  $('#ol-storage-id').value = '';
});
$('#storage-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try {
    JSON.parse(body.addition || '{}');
  } catch { toast('驱动配置必须是合法 JSON', true); return; }
  const id = body.id || $('#ol-storage-id').value;
  delete body.id;
  try {
    await api(id ? `/openlist/storages/${encodeURIComponent(id)}` : '/openlist/storages', {
      method: id ? 'PUT' : 'POST', body,
    });
    toast(id ? '存储已更新' : '存储已创建');
    e.target.reset(); $('#ol-storage-id').value = '';
    $('#storage-add-form').hidden = true;
    loadStorage();
  } catch (err) { toast(err.message, true); }
});

/* ------------------------------ 代理配置事件 ------------------------------ */
$('#proxy-global-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/proxy/global', { method: 'PUT', body: {
      url: e.target.elements.url.value.trim(),
      noProxy: e.target.elements.noProxy.value.trim(),
      enabled: e.target.elements.enabled.checked,
    } });
    toast('全局代理已保存'); loadProxy();
  } catch (err) { toast(err.message, true); }
});
$('#proxy-test-global').addEventListener('click', async () => {
  const box = $('#proxy-test-result');
  box.hidden = false; box.textContent = '测试中…（正在通过代理访问 https://github.com）';
  try {
    const d = await api('/proxy/test', { method: 'POST', body: { global: true, target: 'https://github.com' } });
    const via = d.proxy ? `代理 ${d.proxy}` : '直连（未配置代理或已设 direct）';
    const detail = `✔ 测试成功 · ${via} · ${d.ms} ms${d.status ? ` · HTTP ${d.status}` : ''} · 目标 ${d.target}`;
    box.textContent = detail;
    toast(d.proxy ? `全局代理可用：${d.proxy}（${d.ms} ms）` : `网络可达：直连成功（${d.ms} ms，当前未走代理）`);
  } catch (err) {
    box.textContent = `✖ 测试失败：${err.message}`;
    toast(`全局代理测试失败：${err.message}`, true);
  }
});
$('#proxy-rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/proxy/rules', { method: 'POST', body: formData(e.target) });
    toast('Host 规则已添加'); e.target.reset(); loadProxy();
  } catch (err) { toast(err.message, true); }
});
/* ---------- v0.4.4 对象级单项代理覆盖弹窗 ---------- */
async function saveObjectProxy(url, note) {
  const { scope, id } = objProxyTarget;
  if (!scope || !id) throw new Error('请先选择一个对象');
  await api(`/proxy/overrides/${encodeURIComponent(scope)}?id=${encodeURIComponent(id)}`, {
    method: 'PUT', body: { id, url, note },
  });
  const modal = $('#object-proxy-modal');
  if (modal) modal.hidden = true;
  toast(url ? '单项代理覆盖已保存' : '单项代理覆盖已删除');
  if (currentView === 'proxy') loadProxy();
}
$('#objproxy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try { await saveObjectProxy(String(body.url || '').trim(), String(body.note || '').trim()); }
  catch (err) { toast(err.message, true); }
});
$('#objproxy-remove').addEventListener('click', async () => {
  if (!await confirmDialog({ message: '确定删除该对象的单项代理覆盖？删除后回归分组 / 全局代理。' })) return;
  try { await saveObjectProxy('', ''); }
  catch (err) { toast(err.message, true); }
});
$$('[data-objproxy-close]').forEach((b) => b.addEventListener('click', () => {
  const modal = $('#object-proxy-modal');
  if (modal) modal.hidden = true;
}));
$('#proxy-resolve-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try {
    const d = await api('/proxy/resolve', { method: 'POST', body });
    $('#proxy-resolve-result').textContent = [
      `最终代理：${d.masked || '无'}`,
      `命中层级：${d.sourceLabel}`,
      d.bypassed ? '目标命中 NO_PROXY，将绕过代理直连' : '',
      `NO_PROXY：${d.noProxy}`,
      '',
      ...d.chain.map((c) => `  ${c.label.padEnd(22, ' ')} ${c.mode === 'custom' ? c.url : (c.mode === 'direct' ? '明确直连' : '未设置，继续继承')}`),
    ].filter(Boolean).join('\n');
  } catch (err) { $('#proxy-resolve-result').textContent = `解析失败：${err.message}`; }
});

$('#auto-deploy').addEventListener('change', (e) => { $('#deploy-fields').hidden = !e.target.checked; });
$('#build-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  body.runTests = e.target.elements.runTests.checked;
  const autoDeploy = e.target.elements.autoDeploy.checked;
  delete body.autoDeploy;
  if (autoDeploy) {
    if (!body.serverId) { toast('请选择目标服务器', true); return; }
    body.deploy = { serverId: body.serverId, targetDir: body.targetDir, command: body.command };
  }
  delete body.serverId; delete body.targetDir; delete body.command;
  try {
    const d = await api('/builds', { method: 'POST', body });
    toast(`构建已启动：${d.id}`);
    watchLog(d.id);
    setTimeout(loadBuilds, 800);
  } catch (err) { toast(err.message, true); }
});

$('#server-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editing = Boolean($('#server-edit-id') && $('#server-edit-id').value);
  const editingId = ($('#server-edit-id') || {}).value || '';
  try {
    await api('/servers', { method: 'POST', body: formData(e.target) });
    if (editingId) await saveCollabInline('servers', editingId);
    toast(editing ? '服务器信息已更新' : '服务器已保存');
    resetServerEditForm();
    loadServers();
    if (editing) switchView('servers');
  } catch (err) { toast(err.message, true); }
});
const serverEditCancelBtn = $('#server-edit-cancel');
if (serverEditCancelBtn) serverEditCancelBtn.addEventListener('click', () => {
  resetServerEditForm();
  switchView('servers');
  toast('已取消编辑');
});

function providerFormBody(form) {
  const body = formData(form);
  body.enabled = form.elements.enabled.checked;
  body.noKey = form.elements.noKey.checked;
  if (form.elements.protocol) body.protocol = form.elements.protocol.value;
  if (form.elements.retryPolicy) body.retryPolicy = form.elements.retryPolicy.value;
  if ($('#api-fields') && !$('#api-fields').hidden) body.models = syncModelCatalogToForm();
  return body;
}

$('#provider-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editingId = (e.target.elements.id || {}).value || '';
  try {
    await api('/ai/providers', { method: 'POST', body: providerFormBody(e.target) });
    if (editingId) await saveCollabInline('aiProviders', editingId);
    renderCollabInline('aiProviders', '');
    toast('AI 模型已保存');
    e.target.reset();
    setProviderKind('api');
    clearProviderModels();
    $('#provider-test-result').hidden = true;
    if ($('#provider-cancel')) $('#provider-cancel').textContent = '取消 / 返回列表';
    await loadAI();
    switchView('ai-list');                 // 保存后跳到「已配置模型」看到结果
  } catch (err) { toast(err.message, true); }
});
$('#provider-cancel').addEventListener('click', () => {
  $('#provider-form').reset();
  setProviderKind('api');
  clearProviderModels();
  $('#provider-test-result').hidden = true;
  $('#provider-cancel').textContent = '取消 / 返回列表';
  renderCollabInline('aiProviders', '');
  switchView('ai-list');                 // 编辑时一键放弃修改并回到列表
});
$('#provider-reset').addEventListener('click', () => {
  $('#provider-form').reset();
  setProviderKind('api');
  clearProviderModels();
  $('#provider-test-result').hidden = true;
  $('#provider-cancel').textContent = '取消 / 返回列表';
  renderCollabInline('aiProviders', '');
});
// 模型目录：添加 / 恢复默认 / 获取可用模型（上游 OpenAI 兼容 /models）。
$('#model-add').addEventListener('click', () => {
  providerModelRows.push({ id: '', name: '' });
  renderProviderModelRows(getDefaultModelValue());
  const last = $('#model-rows input.model-id:last-of-type');
  if (last) last.focus();
});
$('#model-restore').addEventListener('click', () => {
  const def = getDefaultModelValue();
  providerModelRows = def ? [{ id: def, name: def }] : [];
  providerAvailableModels = [];
  renderProviderModelRows(def);
  renderAvailableModels();
  toast('模型目录已恢复为默认模型');
});
$('#model-fetch').addEventListener('click', async () => {
  const box = $('#model-fetch-result');
  box.hidden = false;
  box.textContent = '正在从上游 /models 拉取可用模型…';
  try {
    const body = providerFormBody($('#provider-form'));
    const d = await api('/ai/models/fetch', { method: 'POST', body });
    providerAvailableModels = (d.items || []).map((m) => ({ id: m.id, name: m.id, ownedBy: m.ownedBy || '' }));
    // 拉取到的可用模型默认全部勾选加入模型目录；已存在的条目保留原来填的显示名。
    const existing = new Map(providerModelRows.map((m) => [String(m.id || ''), String(m.name || '')]));
    for (const m of providerAvailableModels) {
      if (m.id && !existing.has(m.id)) providerModelRows.push({ id: m.id, name: m.name || m.id });
    }
    // 没有默认模型时自动把第一个可用模型设为默认，避免保存后目录无主。
    const modelInput = $('#provider-form [name="model"]');
    if (modelInput && !String(modelInput.value || '').trim() && providerModelRows.length) {
      modelInput.value = providerModelRows[0].id;
    }
    renderProviderModelRows(getDefaultModelValue());
    renderAvailableModels();
    const got = d.count || providerAvailableModels.length;
    box.textContent = `已获取 ${got} 个可用模型${d.effectiveProxy ? ' · 代理 ' + d.effectiveProxy : ''}：已全部勾选加入模型目录，点击胶囊可取消`;
    toast(got ? `成功获取 ${got} 个可用模型` : '上游未返回可用模型，请检查地址与 Key');
  } catch (err) {
    providerAvailableModels = []; renderAvailableModels();
    box.textContent = `获取失败：${err.message}`;
    toast(err.message, true);
  }
});

$('#provider-test').addEventListener('click', async (e) => {
  const box = $('#provider-test-result');
  box.hidden = false;
  box.textContent = '正在测试当前配置…';
  try {
    const body = providerFormBody($('#provider-form'));
    const d = await api('/ai/test', { method: 'POST', body: { ...body, prompt: '用一句话说明你是什么，不要执行任何操作。' } });
    box.textContent = `[${d.kind === 'cli' ? '本地 CLI' : 'API'}] ${d.answer}`;
    toast('测试成功：服务已正常响应');
  } catch (err) { box.textContent = `失败：${err.message}`; toast(`测试失败：${err.message}`, true); }
});

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#chat-result').textContent = '请求中…';
  try {
    const d = await api('/ai/chat', { method: 'POST', body: { providerId: $('#chat-provider').value, prompt: $('#chat-prompt').value } });
    $('#chat-result').textContent = `[${d.provider} / ${d.model}]\n${d.answer}`;
    toast(`测试成功：${d.provider} / ${d.model} 已响应`);
  } catch (err) { $('#chat-result').textContent = `失败：${err.message}`; toast(`测试失败：${err.message}`, true); }
});

/* ------------------- v0.3.6 · Docker 分区交互增强 ------------------- */
const DK_TPL = {
  lnmp: {
    name: 'lnmp', description: 'Nginx + PHP-FPM + MySQL 最小开发栈',
    content: `services:\n  web:\n    image: nginx:latest\n    ports:\n      - "8080:80"\n    depends_on: [php, db]\n    volumes:\n      - ./www:/usr/share/nginx/html\n  php:\n    image: php:8.3-fpm\n    volumes:\n      - ./www:/var/www/html\n  db:\n    image: mysql:8.4\n    environment:\n      MYSQL_ROOT_PASSWORD: change-me\n    volumes:\n      - db-data:/var/lib/mysql\nvolumes:\n  db-data: {}\n`,
  },
  wordpress: {
    name: 'wordpress', description: 'WordPress + MariaDB',
    content: `services:\n  web:\n    image: wordpress:latest\n    ports:\n      - "8080:80"\n    environment:\n      WORDPRESS_DB_HOST: db\n      WORDPRESS_DB_USER: wp\n      WORDPRESS_DB_PASSWORD: change-me\n      WORDPRESS_DB_NAME: wp\n    depends_on: [db]\n  db:\n    image: mariadb:11\n    environment:\n      MARIADB_ROOT_PASSWORD: change-me\n      MARIADB_DATABASE: wp\n      MARIADB_USER: wp\n      MARIADB_PASSWORD: change-me\n    volumes:\n      - db-data:/var/lib/mysql\nvolumes:\n  db-data: {}\n`,
  },
  redis: {
    name: 'redis', description: 'Redis 单实例 + 持久化卷',
    content: `services:\n  redis:\n    image: redis:7-alpine\n    command: ["redis-server", "--appendonly", "yes"]\n    ports:\n      - "6379:6379"\n    volumes:\n      - redis-data:/data\nvolumes:\n  redis-data: {}\n`,
  },
  postgres: {
    name: 'postgres', description: 'PostgreSQL 单实例',
    content: `services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_USER: app\n      POSTGRES_PASSWORD: change-me\n      POSTGRES_DB: app\n    ports:\n      - "5432:5432"\n    volumes:\n      - pg-data:/var/lib/postgresql/data\nvolumes:\n  pg-data: {}\n`,
  },
};

function copyText(text, okMsg = '已复制到剪贴板') {
  const value = String(text || '');
  if (!value) { toast('没有可复制的内容', true); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(() => toast(okMsg)).catch(() => legacyCopy(value, okMsg));
    return;
  }
  legacyCopy(value, okMsg);
}
function legacyCopy(value, okMsg) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast(okMsg); }
  catch { toast('复制失败，请手工选择文本', true); }
  ta.remove();
}
function downloadText(filename, text) {
  const blob = new Blob([String(text || '')], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const dkTplById = (id) => (dockerState.templates || []).find((t) => t.id === id);

function dkFormValue(form, name, fallback = '') {
  const el = form && form.elements ? form.elements[name] : null;
  return el && typeof el.value === 'string' ? el.value : fallback;
}
function dockerVolumeCmd() {
  const f = $('#docker-volume-form');
  if (!f) return 'docker volume create <卷名>';
  const name = String(dkFormValue(f, 'name')).trim() || '<卷名>';
  const driver = String(dkFormValue(f, 'driver', 'local'));
  const label = String(dkFormValue(f, 'label')).trim();
  const parts = ['docker volume create'];
  if (driver !== 'local') parts.push(`--driver ${driver}`);
  if (label) parts.push(`--label "${label.replace(/"/g, '\\"')}"`);
  parts.push(name);
  return parts.join(' ');
}
function dockerNetworkCmd() {
  const f = $('#docker-network-form');
  if (!f) return 'docker network create <网络名>';
  const name = String(dkFormValue(f, 'name')).trim() || '<网络名>';
  const driver = String(dkFormValue(f, 'driver', 'bridge'));
  const subnet = String(dkFormValue(f, 'subnet')).trim();
  const internalEl = f.elements ? f.elements.internal : null;
  const internal = Boolean(internalEl && internalEl.checked);
  const parts = ['docker network create'];
  if (driver !== 'bridge') parts.push(`--driver ${driver}`);
  if (subnet) parts.push(`--subnet ${subnet}`);
  if (internal) parts.push('--internal');
  parts.push(name);
  return parts.join(' ');
}
function updateDockerCommands() {
  const vc = $('#docker-volume-cmd'); if (vc) vc.textContent = dockerVolumeCmd();
  const nc = $('#docker-network-cmd'); if (nc) nc.textContent = dockerNetworkCmd();
}
/* ------------- v0.3.11 · Compose 编排模板富编辑器 ------------- */
const composeState = { cm: null, height: 480 };

/** 始终以 CodeMirror 为准读内容，避免 textarea 与编辑器不同步。 */
function composeContent() {
  if (composeState.cm) {
    try { return composeState.cm.getValue(); } catch { /* noop */ }
  }
  const area = $('#docker-template-content');
  return area ? String(area.value || '') : '';
}

function setComposeContent(text) {
  const value = String(text || '');
  const area = $('#docker-template-content');
  if (area) area.value = value;
  if (composeState.cm) {
    try { composeState.cm.setValue(value); composeState.cm.refresh(); } catch { /* noop */ }
  }
  renderYamlCheck();
}

/** 与文件编辑器同款：行号、YAML 高亮、折叠、括号匹配、查找与自动缩进。 */
function ensureComposeEditor() {
  const area = $('#docker-template-content');
  if (!area || composeState.cm || typeof CodeMirror === 'undefined') return;
  composeState.cm = CodeMirror.fromTextArea(area, {
    lineNumbers: true, mode: resolveMode('yaml') || null,
    indentUnit: 2, tabSize: 2, indentWithTabs: false, lineWrapping: false,
    matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
    foldGutter: true, gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Ctrl-S': () => { const f = $('#docker-template-form'); if (f && f.requestSubmit) f.requestSubmit(); },
      'Cmd-S': () => { const f = $('#docker-template-form'); if (f && f.requestSubmit) f.requestSubmit(); },
      'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
    },
  });
  composeState.cm.on('change', () => renderYamlCheck());
  applyComposeHeight(composeState.height);
}

function applyComposeHeight(px) {
  const h = Math.max(220, Math.min(900, Number(px) || 480));
  composeState.height = h;
  const el = document.querySelector('.cm-compose .CodeMirror');
  if (el) el.style.height = `${h}px`;
  if (composeState.cm) {
    try { composeState.cm.setSize(null, h); composeState.cm.refresh(); } catch { /* noop */ }
  }
  try { localStorage.setItem('dp_compose_height', String(h)); } catch { /* 隐私模式忽略 */ }
}

/** 安全的「整理格式」：只做空白归一化，不改写 YAML 语义与内容。 */
function formatComposeYaml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  const out = [];
  lines.forEach((line) => {
    const clean = line.replace(/[ \t]+$/, '');
    if (!clean.trim() && out.length && !out[out.length - 1].trim()) return;
    out.push(clean);
  });
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return `${out.join('\n')}\n`;
}

function checkYaml(text) {
  const raw = String(text || '');
  const issues = [];
  if (!raw.trim()) return { ok: false, issues: ['内容为空'] };
  if (!/^services\s*:/m.test(raw)) issues.push('缺少顶层 services: 段');
  if (/\t/.test(raw)) issues.push('检测到 Tab，YAML 缩进只能用空格');
  if (!/\bimage\s*:/.test(raw) && !/\bbuild\s*:/.test(raw)) issues.push('没有发现 image: 或 build:，服务可能无法启动');
  if (/^\s*ports\s*:/m.test(raw) && !/["']?\d+:\d+/.test(raw)) issues.push('ports 建议写成 "宿主机端口:容器端口"');
  return { ok: issues.length === 0, issues };
}
function renderYamlCheck() {
  const box = $('#docker-yaml-check');
  if (!box) return;
  const r = checkYaml(composeContent());
  box.innerHTML = r.ok
    ? '✔ 基础检查通过：已包含 services 段与镜像定义，缩进使用空格。'
    : `⚠ 需要留意：${r.issues.map(esc).join('；')}`;
}

/* 列表筛选 / 快捷填充 / 复制下载 / 模板库：统一用文档级委托，动态行无需重绑。 */
[['#docker-image-filter', renderDockerImages], ['#docker-volume-filter', renderDockerVolumes],
  ['#docker-network-filter', renderDockerNetworks]].forEach(([sel, fn]) => {
  const el = $(sel);
  if (el) el.addEventListener('input', fn);
});
const ownedOnlyBox = $('#docker-owned-only');
if (ownedOnlyBox) ownedOnlyBox.addEventListener('change', renderDockerContainers);
[['#docker-volume-form', updateDockerCommands], ['#docker-network-form', updateDockerCommands]].forEach(([sel, fn]) => {
  const el = $(sel);
  if (el) { el.addEventListener('input', fn); el.addEventListener('change', fn); }
});
const yamlArea = $('#docker-template-content');
if (yamlArea) yamlArea.addEventListener('input', renderYamlCheck);
// CodeMirror 未加载（离线 / 自检环境）时自动降级为原生 textarea，功能仍可用。
ensureComposeEditor();
try {
  const savedHeight = Number(localStorage.getItem('dp_compose_height'));
  const heightSel = $('#docker-tpl-height');
  if (heightSel) {
    if ([360, 480, 640].includes(savedHeight)) heightSel.value = String(savedHeight);
    composeState.height = Number(heightSel.value) || 480;
  }
  applyComposeHeight(composeState.height);
} catch { /* noop */ }
const heightSel = $('#docker-tpl-height');
if (heightSel) heightSel.addEventListener('change', () => applyComposeHeight(heightSel.value));
const formatBtn = $('#docker-tpl-format');
if (formatBtn) formatBtn.addEventListener('click', () => {
  setComposeContent(formatComposeYaml(composeContent()));
  toast('已整理缩进与空白（YAML 内容未改写）');
});

document.addEventListener('click', (e) => {
  const quick = e.target.closest && e.target.closest('[data-dk-quick-image]');
  if (quick) {
    const f = $('#docker-pull-form');
    if (f) { f.elements.image.value = quick.dataset.dkQuickImage; f.elements.tag.value = 'latest'; }
    toast(`已填入 ${quick.dataset.dkQuickImage}:latest`);
    return;
  }
  const copy = e.target.closest && e.target.closest('[data-dk-copy]');
  if (copy) { copyText(copy.dataset.dkCopy); return; }
  const preset = e.target.closest && e.target.closest('[data-dk-tpl]');
  if (preset) {
    const f = $('#docker-template-form');
    const t = DK_TPL[preset.dataset.dkTpl];
    if (!f) return;
    if (!t) {
      f.reset();
      setComposeContent('');
    } else {
      f.elements.name.value = t.name;
      f.elements.description.value = t.description;
      setComposeContent(t.content);
    }
    if (t) toast(`已套用「${t.name}」模板，可继续修改后保存`);
    return;
  }
  const load = e.target.closest && e.target.closest('[data-dk-tpl-load]');
  if (load) {
    const t = dkTplById(load.dataset.dkTplLoad);
    const f = $('#docker-template-form');
    if (t && f) {
      f.elements.name.value = t.name;
      f.elements.description.value = t.description || '';
      setComposeContent(t.content || '');
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`已载入「${t.name}」，修改后点保存即可更新`);
    }
    return;
  }
  const tplCopy = e.target.closest && e.target.closest('[data-dk-tpl-copy]');
  if (tplCopy) {
    const t = dkTplById(tplCopy.dataset.dkTplCopy);
    if (t) copyText(t.content, `已复制「${t.name}」的 YAML`);
    return;
  }
  const tplDl = e.target.closest && e.target.closest('[data-dk-tpl-download]');
  if (tplDl) {
    const t = dkTplById(tplDl.dataset.dkTplDownload);
    if (t) downloadText(`${t.name}.yml`, t.content || '');
  }
});

const copyDiag = $('#docker-copy-diag');
if (copyDiag) copyDiag.addEventListener('click', () => copyText($('#docker-raw').textContent, '诊断信息已复制'));
const copyVolCmd = $('#docker-volume-copy-cmd');
if (copyVolCmd) copyVolCmd.addEventListener('click', () => copyText(dockerVolumeCmd(), '命令已复制，可到服务器执行'));
const copyNetCmd = $('#docker-network-copy-cmd');
if (copyNetCmd) copyNetCmd.addEventListener('click', () => copyText(dockerNetworkCmd(), '命令已复制，可到服务器执行'));
const tplCopyNow = $('#docker-tpl-copy');
if (tplCopyNow) tplCopyNow.addEventListener('click', () => copyText(composeContent(), 'YAML 已复制'));
const tplDownloadNow = $('#docker-tpl-download');
if (tplDownloadNow) tplDownloadNow.addEventListener('click', () => {
  const f = $('#docker-template-form');
  downloadText(`${String(f.elements.name.value || 'docker-compose').trim()}.yml`, composeContent());
});

/* 面板偏好：自动刷新只在 Docker 分区激活且页面可见时工作，默认关闭。 */
const DK_POLL_KEY = 'dp_docker_poll_ms';
const DK_DENSITY_KEY = 'dp_docker_density';
let dockerPollTimer = null;
let dockerPollBusy = false;
function applyDockerPrefs() {
  const ms = Number(localStorage.getItem(DK_POLL_KEY) || 0);
  const density = localStorage.getItem(DK_DENSITY_KEY) || 'normal';
  const sel = $('#docker-poll-interval'); if (sel) sel.value = String(ms);
  const dsel = $('#docker-density'); if (dsel) dsel.value = density;
  if (document.body && document.body.classList && document.body.classList.toggle) {
    document.body.classList.toggle('dk-compact', density === 'compact');
  }
  if (dockerPollTimer) { clearInterval(dockerPollTimer); dockerPollTimer = null; }
  if (ms > 0) {
    dockerPollTimer = setInterval(() => {
      if (document.hidden || dockerPollBusy || !String(currentView).startsWith('docker')) return;
      dockerPollBusy = true;
      loadDocker().catch(() => {}).finally(() => { dockerPollBusy = false; });
    }, ms);
  }
}
const dockerPollSel = $('#docker-poll-interval');
if (dockerPollSel) dockerPollSel.addEventListener('change', (e) => {
  localStorage.setItem(DK_POLL_KEY, String(Number(e.target.value) || 0));
  applyDockerPrefs();
  toast(Number(e.target.value) ? `Docker 数据每 ${Number(e.target.value) / 1000} 秒自动刷新` : 'Docker 自动刷新已关闭');
});
const dockerDensitySel = $('#docker-density');
if (dockerDensitySel) dockerDensitySel.addEventListener('change', (e) => {
  localStorage.setItem(DK_DENSITY_KEY, e.target.value);
  applyDockerPrefs();
  toast(e.target.value === 'compact' ? '已切换为紧凑表格' : '已切换为标准表格');
});
updateDockerCommands();
renderYamlCheck();

/* --------------------- 账号 / 会话 / 协作者（v0.4.0） --------------------- */
let currentUser = null;
let workbenchStarted = false;
let authMode = 'required';
let collabTarget = null;
let forcePasswordChange = false;
let pendingTotpToken = '';
let twofaMethod = 'totp';

/** 登录 / 改密走原生 fetch，避免 api() 的 401 自动跳登录造成循环。 */
async function authFetch(path, options = {}) {
  const init = { method: options.method || 'GET', headers: { ...(options.headers || {}) } };
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`/api${path}`, init);
  let json = null;
  try { json = await response.json(); } catch { /* 非 JSON 响应，下面统一报错 */ }
  // 旧写法只检查 !response.ok || json.ok === false：代理/网关偶发返回 200 + HTML
  // 时 json = {}，会被当成「登录成功」继续走工作台；也可能把错误页吞成空对象。
  if (!response.ok || !json || json.ok !== true) {
    const message = (json && json.error)
      || (json === null ? `服务端返回了非 JSON 响应（HTTP ${response.status}）` : `HTTP ${response.status}`);
    throw new Error(message);
  }
  return json.data || {};
}

function setLoginError(selector, message) {
  const box = $(selector);
  if (!box) return;
  box.textContent = message || '';
  box.hidden = !message;
}

/** 会话失效 / 登出后停掉所有后台轮询，避免每 1.5s 一次 401 反复打断登录界面。 */
function stopBackgroundPolling() {
  const timers = [
    () => { if (typeof logTimer !== 'undefined' && logTimer) { clearInterval(logTimer); logTimer = null; } },
    () => { if (typeof serverPollTimer !== 'undefined' && serverPollTimer) { clearInterval(serverPollTimer); serverPollTimer = null; } },
    () => { if (typeof svcJobTimer !== 'undefined' && svcJobTimer) { clearInterval(svcJobTimer); svcJobTimer = null; } },
    () => { if (typeof dockerPollTimer !== 'undefined' && dockerPollTimer) { clearInterval(dockerPollTimer); dockerPollTimer = null; } },
  ];
  for (const stop of timers) { try { stop(); } catch { /* 尚未初始化 */ } }
}

/**
 * 401 统一入口：只在登录遮罩尚未显示时才重置表单。
 * 旧实现每次 401 都调 showLogin()，会清空 pendingTotpToken 并隐藏 2FA 表单，
 * 用户在二次验证过程中被后台轮询打断，永远无法完成登录。
 */
function invalidateSession(message = '登录状态已失效，请重新登录') {
  const view = $('#login-view');
  currentUser = null;
  stopBackgroundPolling();
  const box = $('#auth-wrap');
  if (box) box.hidden = true;
  if (view && !view.hidden) {
    setLoginError('#login-error', message);
    return;
  }
  showLogin(message);
}

function showLogin(message = '') {
  const view = $('#login-view');
  if (view) view.hidden = false;
  // 登出 / 会话失效后不能残留上一个账号的身份，否则集成服务管理区仍按管理员渲染。
  currentUser = null;
  stopBackgroundPolling();
  const form = $('#login-form');
  const pass = $('#password-form');
  const twofa = $('#twofa-form');
  if (form) form.hidden = false;
  if (pass) pass.hidden = true;
  if (twofa) { twofa.hidden = true; twofaMethod = 'totp'; }
  pendingTotpToken = '';
  setLoginError('#login-error', message);
  const box = $('#auth-wrap');
  if (box) box.hidden = true;
}

function showTwofaForm(totpToken) {
  pendingTotpToken = totpToken || '';
  twofaMethod = 'totp';
  const view = $('#login-view');
  if (view) view.hidden = false;
  const form = $('#login-form');
  const pass = $('#password-form');
  const twofa = $('#twofa-form');
  if (form) form.hidden = true;
  if (pass) pass.hidden = true;
  if (twofa) twofa.hidden = false;
  setLoginError('#twofa-error', '');
  const codeEl = twofa && twofa.elements.code;
  if (codeEl) { codeEl.placeholder = '6 位数字'; codeEl.value = ''; }
  const rt = $('#twofa-recovery-toggle');
  if (rt) rt.textContent = '使用恢复码';
}

function showPasswordForm(title = '首次登录 · 请修改初始密码') {
  const view = $('#login-view');
  if (view) view.hidden = false;
  const form = $('#login-form');
  const pass = $('#password-form');
  if (form) form.hidden = true;
  if (pass) pass.hidden = false;
  const heading = $('#password-title');
  if (heading) heading.textContent = title;
  setLoginError('#password-error', '');
  const box = $('#auth-wrap');
  if (box) box.hidden = true;
}

function hideLogin() {
  const view = $('#login-view');
  if (view) view.hidden = true;
}

function renderAuthBox(user) {
  currentUser = user || null;
  const box = $('#auth-wrap');
  if (!box) return;
  if (!currentUser) {
    box.hidden = true;
    ['#ide-cred-reveal', '#ide-cred-copy'].forEach((sel) => {
      const el = $(sel);
      if (el) el.hidden = true;
    });
    const cred = $('#svc-credentials');
    if (cred) cred.hidden = true;
    svcCredState.plain = {};
    return;
  }
  box.hidden = false;
  if (typeof window.__setAuthMenu === 'function') window.__setAuthMenu(false);
  const name = $('#auth-name');
  const role = $('#auth-role');
  const avatar = $('#auth-avatar');
  const flag2fa = $('#auth-2fa');
  const display = currentUser.displayName || currentUser.username || '';
  if (name) name.textContent = display;
  if (role) role.textContent = currentUser.role === 'admin' ? '管理员' : '普通用户';
  if (avatar) avatar.textContent = (display.trim()[0] || 'U');
  if (flag2fa) flag2fa.hidden = !currentUser.totpEnabled;
  const navUsers = $('#nav-users');
  if (navUsers) navUsers.hidden = currentUser.role !== 'admin';
  // IDE 明文密码（reveal）仅管理员可读；普通用户不展示「显示 / 复制」入口，
  // 避免点了才吃到 403。是否已配置的脱敏状态仍对所有登录用户可见。
  const ideReveal = $('#ide-cred-reveal');
  if (ideReveal) ideReveal.hidden = currentUser.role !== 'admin';
  const ideCopy = $('#ide-cred-copy');
  if (ideCopy) ideCopy.hidden = currentUser.role !== 'admin';
  // 集成服务账号 / 口令明文仅管理员可见；切换账号或登出后立即收起。
  const svcCred = $('#svc-credentials');
  if (svcCred) {
    svcCred.hidden = currentUser.role !== 'admin';
    if (currentUser.role === 'admin' && !svcCredLoaded) void loadServiceCredentials();
  }
}

const loginFormEl = $('#login-form');
if (loginFormEl) loginFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  setLoginError('#login-error', '');
  try {
    const data = await authFetch('/auth/login', {
      method: 'POST',
      body: { username: f.elements.username.value, password: f.elements.password.value },
    });
    if (data.requiresTwoFactor) {
      showTwofaForm(data.totpToken);
      return;
    }
    renderAuthBox(data.user);
    if (data.mustChangePassword) {
      forcePasswordChange = true;
      showPasswordForm();
      toast('首次登录请先修改初始密码');
      return;
    }
    hideLogin();
    await startWorkbench();
  } catch (err) { setLoginError('#login-error', err.message || String(err)); }
});

const twofaFormEl = $('#twofa-form');
if (twofaFormEl) twofaFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  setLoginError('#twofa-error', '');
  try {
    const data = await authFetch('/auth/2fa', {
      method: 'POST',
      body: { totpToken: pendingTotpToken, code: f.elements.code.value, method: twofaMethod },
    });
    renderAuthBox(data.user);
    if (data.mustChangePassword) {
      forcePasswordChange = true;
      showPasswordForm();
      toast('首次登录请先修改初始密码');
      return;
    }
    hideLogin();
    await startWorkbench();
  } catch (err) { setLoginError('#twofa-error', err.message || String(err)); }
});

if ($('#twofa-recovery-toggle')) $('#twofa-recovery-toggle').addEventListener('click', () => {
  twofaMethod = twofaMethod === 'totp' ? 'recovery' : 'totp';
  const codeEl = twofaFormEl && twofaFormEl.elements.code;
  if (codeEl) {
    codeEl.placeholder = twofaMethod === 'recovery' ? '输入恢复码，如 XXXXX-XXXXX' : '6 位数字';
    codeEl.value = '';
  }
  const rt = $('#twofa-recovery-toggle');
  if (rt) rt.textContent = twofaMethod === 'recovery' ? '改用动态码' : '使用恢复码';
});

if ($('#twofa-back')) $('#twofa-back').addEventListener('click', () => showLogin('已返回登录'));

const passwordFormEl = $('#password-form');
if (passwordFormEl) passwordFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.elements.newPassword.value !== f.elements.confirmPassword.value) {
    setLoginError('#password-error', '两次输入的新密码不一致');
    return;
  }
  setLoginError('#password-error', '');
  try {
    await authFetch('/auth/password', {
      method: 'POST',
      body: { oldPassword: f.elements.oldPassword.value, newPassword: f.elements.newPassword.value },
    });
    forcePasswordChange = false;
    toast('密码已修改，请重新登录');
    showLogin('密码已修改，请用新密码重新登录');
  } catch (err) { setLoginError('#password-error', err.message || String(err)); }
});

if ($('#password-cancel')) $('#password-cancel').addEventListener('click', () => {
  if (forcePasswordChange || !currentUser) showLogin();
  else { hideLogin(); renderAuthBox(currentUser); }
});
if ($('#auth-password')) $('#auth-password').addEventListener('click', () => {
  forcePasswordChange = false;
  showPasswordForm('修改当前账号密码');
});
if ($('#auth-logout')) $('#auth-logout').addEventListener('click', async () => {
  try { await authFetch('/auth/logout', { method: 'POST' }); } catch { /* 忽略 */ }
  renderAuthBox(null);
  showLogin('已登出');
  // 只清会话 Cookie 是不够的：boot 会带上 localStorage.dp_token 重新判定为管理员，
  // 刷新后等于没登出；dp_tabs 里还留着上一个账号的服务器文件 / 终端标签。
  try {
    localStorage.removeItem('dp_token');
    localStorage.removeItem('dp_tabs');
  } catch { /* 隐私模式下 localStorage 可能不可写 */ }
  if (typeof location !== 'undefined') location.reload();
});

/* 顶栏账号图标：点击展开 / 收起菜单（与版本徽标同款交互） */
(function setupAuthMenu() {
  const btn = $('#auth-btn');
  const menu = $('#auth-menu');
  if (!btn || !menu) return;
  const setMenu = (open) => {
    const show = open === undefined ? menu.hidden : open;
    menu.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(); });
  document.addEventListener('click', (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    setMenu(false);
  });
  ['#auth-security', '#auth-password', '#auth-logout'].forEach((sel) => {
    const b = $(sel);
    if (b) b.addEventListener('click', () => setMenu(false));
  });
  window.__setAuthMenu = setMenu;
})();

/* --------------------------- 账号安全 · 二次验证 --------------------------- */
if ($('#auth-security')) $('#auth-security').addEventListener('click', () => openSecurityModal());
$$('[data-security-close]').forEach((b) => b.addEventListener('click', () => { const m = $('#security-modal'); if (m) m.hidden = true; }));

async function openSecurityModal() {
  const modal = $('#security-modal');
  if (modal) modal.hidden = false;
  const statusEl = $('#security-status');
  const setupEl = $('#security-setup');
  const actionsEl = $('#security-actions');
  if (setupEl) setupEl.hidden = true;
  if (actionsEl) actionsEl.innerHTML = '';
  if (statusEl) statusEl.textContent = '加载中…';
  try {
    const data = await api('/auth/2fa');
    if (statusEl) {
      statusEl.innerHTML = data.enabled
        ? `当前状态：${badge('已启用', 'green')} 二次验证已开启，登录时需额外输入动态码。剩余恢复码 ${data.recoveryCount} 个。`
        : `当前状态：${badge('未启用', 'gray')} 二次验证默认关闭，启用后登录将要求动态码。`;
    }
    if (actionsEl) {
      if (data.enabled) {
        actionsEl.innerHTML = '<button class="btn btn-sm btn-danger" type="button" id="security-disable">禁用二次验证</button>';
        const dbtn = $('#security-disable');
        if (dbtn) dbtn.addEventListener('click', async () => {
          if (!await confirmDialog({ message: '确定禁用二次验证吗？禁用后登录将不再要求动态码。' })) return;
          try { await api('/auth/2fa/disable', { method: 'POST' }); toast('已禁用二次验证'); await openSecurityModal(); }
          catch (e) { toast(e.message || String(e), true); }
        });
      } else {
        actionsEl.innerHTML = '<button class="btn btn-sm btn-primary" type="button" id="security-enable">启用二次验证</button>';
        const ebtn = $('#security-enable');
        if (ebtn) ebtn.addEventListener('click', startSecuritySetup);
      }
    }
  } catch (e) { if (statusEl) statusEl.textContent = '加载失败：' + (e.message || String(e)); }
}

async function startSecuritySetup() {
  const statusEl = $('#security-status');
  const setupEl = $('#security-setup');
  const actionsEl = $('#security-actions');
  if (statusEl) statusEl.textContent = '正在生成密钥…';
  try {
    const data = await api('/auth/2fa/setup', { method: 'POST' });
    if (setupEl) setupEl.hidden = false;
    if (actionsEl) actionsEl.innerHTML = '';
    const secretEl = $('#security-secret');
    if (secretEl) secretEl.value = data.secret;
    const qrEl = $('#security-qr');
    if (qrEl) {
      qrEl.innerHTML = '';
      try {
        const qr = qrcode(0, 'M');
        qr.addData(data.otpauthUri);
        qr.make();
        qrEl.innerHTML = qr.createSvgTag(4, 1);
      } catch { qrEl.innerHTML = '<div class="hint">二维码渲染失败，请使用上方密钥手动添加。</div>'; }
    }
    const recEl = $('#security-recovery');
    if (recEl) recEl.textContent = (data.recoveryCodes || []).join('\n');
    if (statusEl) statusEl.innerHTML = '请先扫描二维码 / 记录密钥，并保存恢复码，再输入动态码启用。';
  } catch (e) { if (statusEl) statusEl.textContent = '生成失败：' + (e.message || String(e)); }
}

if ($('#security-confirm')) $('#security-confirm').addEventListener('click', async () => {
  const codeEl = $('#security-code');
  const code = codeEl ? codeEl.value.trim() : '';
  if (!code) { toast('请输入动态码', true); return; }
  try {
    await api('/auth/2fa/confirm', { method: 'POST', body: { code } });
    toast('二次验证已启用');
    await openSecurityModal();
  } catch (e) { toast(e.message || String(e), true); }
});

/* ------------------------------- 账号管理 -------------------------------- */
async function loadUsers() {
  const box = $('#users-list');
  if (!box) return;
  try {
    const [data, dirData] = await Promise.all([
      api('/users'),
      api('/user-dirs').catch(() => ({ items: [] })),
    ]);
    const dirByOwner = {};
    for (const d of (dirData.items || [])) dirByOwner[d.ownerId] = d;
    const rows = (data.items || []).map((u) => {
      const dir = dirByOwner[u.id];
      const dirCell = dir
        ? `<div class="small">${esc(dir.dirPath)}</div>`
          + `<button class="btn btn-sm" type="button" data-collab-open="directories|${esc(dir.id)}">目录协作者${dir.collaborators ? ` (${dir.collaborators})` : ''}</button>`
        : '<span class="muted small">未创建</span>';
      return `<tr>
        <td><b>${esc(u.username)}</b><div class="desc muted small">${esc(u.displayName || '')}</div></td>
        <td>${badge(u.role === 'admin' ? '管理员' : '普通用户', u.role === 'admin' ? 'green' : 'gray')}</td>
        <td>${badge(u.status === 'disabled' ? '已禁用' : '正常', u.status === 'disabled' ? 'red' : 'green')}</td>
        <td>${dirCell}</td>
        <td>${badge(u.totpEnabled ? '已启用' : '未启用', u.totpEnabled ? 'green' : 'gray')}</td>
        <td class="small">${esc(u.lastLoginAt ? fmtTime(u.lastLoginAt) : '从未登录')}</td>
        <td class="actions">
          <button class="btn btn-sm" type="button" data-user-reset="${esc(u.id)}">重置密码</button>
          <button class="btn btn-sm" type="button" data-user-status="${esc(u.id)}">${u.status === 'disabled' ? '启用' : '禁用'}</button>
        </td>
      </tr>`;
    });
    box.innerHTML = table(['账号', '角色', '状态', '用户目录', '二次验证', '最近登录', '操作'], rows);
    box.querySelectorAll('[data-user-reset]').forEach((b) => b.addEventListener('click', async () => {
      const password = await promptDialog({
        title: '重置账号密码',
        message: '输入新密码（至少 8 位）；留空并确定 = 自动生成随机初始密码；点「取消」= 放弃本次重置。',
        value: '', allowEmpty: true, password: true,
      });
      if (password === null) return;
      try {
        const r = await api(`/users/${b.dataset.userReset}`, { method: 'PUT', body: password.trim() ? { password: password.trim() } : {} });
        toast(`已重置 ${r.username} 的密码`);
        await loadUsers();
      } catch (e) { toast(e.message || String(e), true); }
    }));
    box.querySelectorAll('[data-user-status]').forEach((b) => b.addEventListener('click', async () => {
      const u = (data.items || []).find((x) => x.id === b.dataset.userStatus);
      if (!u) return;
      try {
        await api(`/users/${u.id}`, { method: 'PUT', body: { status: u.status === 'disabled' ? 'active' : 'disabled' } });
        await loadUsers(); toast('账号状态已更新');
      } catch (e) { toast(e.message || String(e), true); }
    }));
  } catch (e) { box.innerHTML = errorBlock(e.message, e.hint || ''); }
}

const userFormEl = $('#user-form');
if (userFormEl) userFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const username = f.elements.username.value.trim();
  const password = f.elements.password.value;
  try {
    const r = await api('/users', { method: 'POST', body: {
      username,
      displayName: f.elements.displayName.value,
      password: password || undefined,
    } });
    if (f.reset) f.reset();
    toast(`账号「${r.username || username}」已创建`);
    if (r.generatedPassword) {
      await promptDialog({
        title: '初始密码已生成',
        message: '请复制保存，关闭后无法再次查看；可先在下方选中并手动复制。',
        value: r.generatedPassword, readOnly: true,
        copyText: r.generatedPassword, confirmText: '复制并关闭',
      });
    }
    await loadUsers();
  } catch (err) { toast(err.message || String(err), true); }
});
if ($('#users-reload')) $('#users-reload').addEventListener('click', () => loadUsers());

/* ---------------- 单个对象协作者（v0.4.4：资源协作页已移除） ---------------- */
/** 在对象的新增 / 编辑表单里内嵌协作者勾选区；id 为空（新建）时不显示。 */
async function renderCollabInline(type, id) {
  const box = $(`#collab-inline-${type}`);
  if (!box) return;
  if (!id) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<div class="muted small">正在读取协作者…</div>';
  try {
    const d = await api(`/collaborators?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
    const rows = (d.users || []).map((u) => {
      const cur = (d.collaborators || []).find((c) => c.userId === u.id);
      const dis = d.canManage ? '' : 'disabled';
      return `<div class="collab-inline-row">
        <input type="checkbox" data-collab-user="${esc(u.id)}" ${cur ? 'checked' : ''} ${dis} />
        <span title="${esc(u.displayName || u.username)}">${esc(u.displayName || u.username)}</span>
        <select data-collab-perm="${esc(u.id)}" ${dis}>
          <option value="read"${cur && cur.permission === 'write' ? '' : ' selected'}>只读</option>
          <option value="write"${cur && cur.permission === 'write' ? ' selected' : ''}>可写</option>
        </select>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="collab-inline-head"><b>协作者</b><span class="muted small">${d.canManage ? '保存对象时一并生效' : '仅所有者 / 管理员可修改'}</span></div>
      <div class="collab-inline-list">${rows || '<div class="muted small">暂无其它可协作账号</div>'}</div>`;
  } catch (e) { box.innerHTML = `<div class="muted small">协作者读取失败：${esc(e.message)}</div>`; }
}

/** 对象保存成功后，把表单里的协作者勾选写回该对象。 */
async function saveCollabInline(type, id) {
  const box = $(`#collab-inline-${type}`);
  if (!box || box.hidden || !id) return;
  const list = [];
  box.querySelectorAll('[data-collab-user]').forEach((c) => {
    if (!c.checked || c.disabled) return;
    const sel = box.querySelector(`[data-collab-perm="${c.dataset.collabUser}"]`);
    list.push({ userId: c.dataset.collabUser, permission: sel ? sel.value : 'read' });
  });
  try { await api('/collaborators', { method: 'PUT', body: { type, id, collaborators: list } }); }
  catch (e) { toast(e.message, true); }
}

// 对象列表行的「协作者」按钮：按单个对象打开协作者弹窗。
document.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('[data-collab-open]') : null;
  if (!b) return;
  const parts = String(b.dataset.collabOpen).split('|');
  const type = parts.shift();
  const id = parts.join('|');
  if (type && id) openCollabModal(type, id);
});

async function openCollabModal(type, id) {
  try {
    const data = await api(`/collaborators?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
    collabTarget = { type, id };
    const modal = $('#collab-modal');
    if (modal) modal.hidden = false;
    const title = $('#collab-title');
    const sub = $('#collab-sub');
    const hint = $('#collab-hint');
    if (title) title.textContent = `协作者 · ${data.label}`;
    if (sub) sub.textContent = `${data.name} (${id})`;
    if (hint) hint.textContent = data.canManage
      ? '可增删协作者：read 只读，write 可查看与操作但不能删除资源。'
      : '你只有查看权限；只有资源创建者或管理员能修改协作者。';
    const selected = new Map((data.collaborators || []).map((c) => [c.userId, c.permission]));
    const rows = (data.users || []).map((u) => {
      const cur = selected.get(u.id) || '';
      return `<div class="collab-user">
        <span><b>${esc(u.username)}</b> <span class="muted small">${esc(u.displayName || '')}</span></span>
        <select class="ui-select ui-select-sm" data-collab-user="${esc(u.id)}">
          <option value=""${cur ? '' : ' selected'}>不协作</option>
          <option value="read"${cur === 'read' ? ' selected' : ''}>只读 read</option>
          <option value="write"${cur === 'write' ? ' selected' : ''}>可写 write</option>
        </select>
      </div>`;
    }).join('');
    const body = $('#collab-body');
    if (body) body.innerHTML = rows || '<div class="empty">暂无其他账号可授权</div>';
    const save = $('#collab-save');
    if (save) save.disabled = !data.canManage;
  } catch (e) { toast(e.message || String(e), true); }
}

if ($('#collab-save')) $('#collab-save').addEventListener('click', async () => {
  if (!collabTarget) return;
  const collaborators = $$('#collab-body [data-collab-user]')
    .map((el) => ({ userId: el.dataset.collabUser, permission: el.value }))
    .filter((x) => x.permission);
  try {
    await api('/collaborators', { method: 'PUT',
      body: { type: collabTarget.type, id: collabTarget.id, collaborators } });
    const modal = $('#collab-modal');
    if (modal) modal.hidden = true;
    toast('协作者已保存');
  } catch (e) { toast(e.message || String(e), true); }
});
$$('[data-collab-close]').forEach((b) => b.addEventListener('click', () => {
  const modal = $('#collab-modal');
  if (modal) modal.hidden = true;
}));
/* --------------------------------- 启动 ---------------------------------- */

async function startWorkbench() {
  if (workbenchStarted) return;
  workbenchStarted = true;
  try {
    await api('/health');
    $('#health-dot').classList.add('on');
    $('#health-text').textContent = '服务运行中 · 正常模式';
  } catch (e) {
    $('#health-text').textContent = '服务未连接';
  }
  restoreTabs();
  loadSystemInfo();
  restartServerPolling();
  applyDockerPrefs();
}

(async function boot() {
  let authStatus = null;
  let reachable = false;
  try {
    // 令牌通道（localStorage.dp_token）与 Cookie 会话并列：boot 用原生 fetch，必须把令牌带上，
    // 否则后端判定「未登录」而弹出登录遮罩、工作台不启动，管理员也就看不到集成服务管理区。
    const token = localStorage.getItem('dp_token');
    const response = await fetch('/api/auth/status', token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const json = await response.json();
    if (json && json.ok === true) {
      reachable = true;
      authStatus = json.data || null;
    }
  } catch { /* 服务不可达 / 返回错误页：下面按「未认证」处理 */ }
  authMode = (authStatus && authStatus.mode) || 'required';
  if (!reachable) {
    // 旧写法把请求失败静默当成 mode=off 继续启动工作台：网络抖动或代理返回 HTML
    // 时会在未认证状态下恢复标签、拉起轮询，然后被一连串 401 打断。
    showLogin('无法连接平台服务，请确认服务已启动后刷新页面');
    return;
  }
  if (authStatus && authStatus.mode === 'required' && authStatus.authenticated === false) {
    showLogin();
    return;
  }
  renderAuthBox(authStatus && authStatus.user ? authStatus.user : null);
  if (authStatus && authStatus.user && authStatus.user.mustChangePassword) {
    forcePasswordChange = true;
    showPasswordForm();
    return;
  }
  await startWorkbench();
})();
