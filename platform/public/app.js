'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const VIEW_META = {
  overview: ['总览', '平台各模块运行状态与关键指标'],
  repos: ['仓库列表', '聚合平台自带与 GitHub / 自建 Gitea 等外部源，克隆后直接开发'],
  'repo-new': ['新建仓库', '在指定 Git 源上创建并自动初始化仓库'],
  'repo-clone': ['克隆到工作区', '支持已登记源凭据、本次账号密码 / Token，以及分层代理'],
  ide: ['在线 IDE', '基于 code-server 的浏览器版 VSCode，工作区与构建流水线共享'],
  storage: ['文件浏览', '当前 OpenList 连接下的文件、上传、下载与批量操作'],
  'storage-conn': ['OpenList 连接', '登记 / 切换本机与多个外部 OpenList，查看状态与后台'],
  'storage-mounts': ['挂载存储', '当前连接下的挂载点增删改、启停与重载'],
  'storage-drivers': ['WebDAV / 驱动', 'WebDAV 地址与当前连接支持的驱动清单'],
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
  proxy: ['代理配置', '全局 / 分组 / Git Host 规则 / 单项覆盖，四级优先级解析与连通性测试'],
  environment: ['环境适配', '自动识别环境、体检、切换档案与自动处置，换机器无需改代码'],
  ai: ['AI 服务配置', 'API 服务、宿主机 / WSL 本地 AI 程序与代理'],
  ops: ['AI 运维', '让 AI 查询状态、分析日志并给出建议'],
};
const MODULE_ICONS = {
  overview: '◈', repos: '⑂', 'repo-new': '＋', 'repo-clone': '⇩',
  ide: '⌘', storage: '▤', 'storage-conn': '⇄', 'storage-mounts': '⛁', 'storage-drivers': '⎗',
  builds: '⚙', 'build-start': '▶', deploys: '⇧',
  servers: '▣', 'server-new': '＋', extensions: '▦', gitsrc: '⑃',
  docker: '⬡', 'docker-containers': '▣', 'docker-images': '◫', 'docker-volumes': '⛁',
  'docker-networks': '⌘', 'docker-compose': '▦',
  proxy: '⇄', environment: '⌬', ai: '✦', ops: '◎',
};
// 子页面归属：侧边栏主项保持高亮，标签栏仍显示各自的子页标题。
const NAV_GROUP = {
  'repo-new': 'repos', 'repo-clone': 'repos',
  'storage-conn': 'storage', 'storage-mounts': 'storage', 'storage-drivers': 'storage',
  'build-start': 'builds', deploys: 'builds', 'server-new': 'servers',
  'docker-containers': 'docker', 'docker-images': 'docker', 'docker-volumes': 'docker',
  'docker-networks': 'docker', 'docker-compose': 'docker',
};

let currentView = 'overview';
let currentStoragePath = '/';
const storageState = { files: [], selected: new Set(), storages: [], drivers: [], connection: null, editId: '' };
const proxyState = { config: null, entities: null };
let logTimer = null;
let selectedBuildId = null;
let detectedPrograms = null;
let detectedOnce = false;
let serverCache = [];
let serverPollTimer = null;
let serverPollBusy = false;
let gitsrcEditId = '';
let gitsrcCache = [];

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

function toast(message, isError = false) {
  const box = $('#toast');
  box.textContent = message;
  box.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.className = 'toast'; }, 3600);
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
  persistTabs();
}

function registerTab(config) {
  const tab = { loaded: false, dirty: false, closable: true, dynamic: false, ...config };
  tabs.set(tab.id, tab);
  renderTabs();
  activateTab(tab.id);
  return tab;
}

function closeTab(id, force = false) {
  const tab = tabs.get(id);
  if (!tab || (!tab.closable && !force)) return;
  if (tab.dirty && !force && !confirm(`「${tab.title}」有未保存的修改，确定关闭吗？`)) return;
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
      ['已配置服务器', c.servers, 'SSH 可连接节点'],
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
  } catch (e) { toast(e.message, true); }
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
                <button class="btn btn-sm" data-repo-fix="gitsrc">编辑源</button>
                <button class="btn btn-sm" data-repo-fix="proxy">代理配置</button>
              </span></div>`).join('');
        errBox.querySelectorAll('[data-repo-fix]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.repoFix)));
      } else {
        errBox.textContent = `已聚合 ${sources.length} 个 Git 源、工作区 ${(d.workspace && d.workspace.count) || 0} 个本地仓库，共 ${(d.items || []).length} 条；外部源在「Git 源」页登记`;
      }
    }
    const rows = (d.items || []).map((r) => {
      // 工作区内已克隆的仓库：直接进 IDE，不重复提供「克隆」按钮。
      if (r.isLocal) return `<tr>
        <td><b>${esc(r.name)}</b><div class="desc muted">${esc(r.fullName)}</div></td>
        <td>${badge('工作区', 'green')}</td>
        <td>${esc(r.description || '-')}<div class="desc muted">${esc(r.localPath || '')}</div></td>
        <td class="muted">${esc(fmtTime(r.updatedAt))}</td>
        <td class="actions"><div class="ext-actions">
          <button class="btn btn-sm" data-ide="${esc(r.name)}">IDE 打开</button>
          ${r.cloneUrl ? `<button class="btn btn-sm" data-copy="${esc(r.cloneUrl)}">复制地址</button>` : ''}
        </div></td>
      </tr>`;
      return `<tr>
        <td><b>${esc(r.name)}</b><div class="desc muted">${esc(r.fullName)}</div></td>
        <td>${badge(esc(r.sourceLabel), r.sourceId === 'builtin-gitea' ? 'blue' : 'amber')}</td>
        <td>${esc(r.description || '-')}${r.private ? ' ' + badge('私有', 'gray') : ''}</td>
        <td class="muted">${esc(fmtTime(r.updatedAt))}</td>
        <td class="actions"><div class="ext-actions">
          <button class="btn btn-sm" data-ide="${esc(r.name)}">IDE 打开</button>
          <button class="btn btn-sm" data-clone-repo="${esc(r.cloneUrl)}" data-clone-source="${esc(r.sourceId)}" data-clone-name="${esc(r.name)}" data-clone-id="${esc(r.id)}">克隆</button>
          <button class="btn btn-sm" data-copy="${esc(r.cloneUrl || '')}">复制地址</button>
          <button class="btn btn-sm" data-proxy-repo="${esc(r.id)}">代理</button>
        </div></td>
      </tr>`;
    });
    $('#repo-list').innerHTML = rows.length ? table(['仓库', '来源', '描述', '更新时间', '操作'], rows)
      : '<div class="empty">尚未发现仓库：可到「克隆到工作区」拉取第一个仓库，或在「外部 Git 源」登记远程服务。</div>';
    $$('[data-ide]').forEach((b) => b.addEventListener('click', () => {
      $('#ide-path').value = b.dataset.ide;
      switchView('ide');
    }));
    $$('[data-clone-repo]').forEach((b) => b.addEventListener('click', () => {
      const url = b.dataset.cloneRepo;
      if (!url) { toast('该仓库没有可用的 HTTP 克隆地址', true); return; }
      $('#clone-form').elements.cloneUrl.value = url;
      $('#clone-form').elements.name.value = b.dataset.cloneName || '';
      $('#clone-source').value = b.dataset.cloneSource || '';
      $('#clone-repo-id').value = b.dataset.cloneId || '';
      switchView('repo-clone');
      toast('已填入克隆表单，点击「克隆到工作区」执行');
    }));
    $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('克隆地址已复制'); }
      catch { toast('复制失败，请手动选择', true); }
    }));
    $$('[data-proxy-repo]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('git', b.dataset.proxyRepo)));
    // 扩展实例的「绑定仓库」也复用这份聚合列表。
    repoState.items = d.items || [];
    void loadGitRuntime().catch(() => {});
  } catch (e) {
    $('#repo-list').innerHTML = errorBlock(e.message, '请在「Git 源」页登记可用的仓库服务并配置 Token');
  }
}

/* ------------------------- Git 运行时（v0.3.3） ------------------------- */
// 点击「克隆」之前就能看到 Git 是否就绪；容器镜像缺 Git 时提示走 SSH 宿主机兜底。
async function loadGitRuntime() {
  const box = $('#git-runtime-status');
  if (!box) return;
  try {
    const d = await api('/git/runtime');
    const fb = d.fallback || {};
    const stateBadge = d.available
      ? badge(`Git ${d.version || '可用'}`, 'green')
      : (d.channel === 'ssh-host' ? badge('本机无 Git · SSH 宿主机兜底', 'amber') : badge('Git 不可用', 'red'));
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
    const hintLines = String(d.hint || '').split('\n').map((line) => `<div>${esc(line)}</div>`).join('');
    // v0.3.7：把「检测」的完整结果展示出来，而不是只显示一句概要。
    box.innerHTML = `
      <div class="row gap wrap" style="align-items:center">
        ${stateBadge}<span>${channel}</span>
        <span class="muted small">检测于 ${esc(new Date().toLocaleTimeString('zh-CN', { hour12: false }))}</span>
        <button class="btn btn-sm" type="button" data-git-probe>重新检测</button>
      </div>
      <div class="dk-kv" style="margin-top:10px">
        ${kv('可执行文件', d.bin || '未找到')}
        ${kv('Git 版本', d.version || '—')}
        ${kv('探测来源', d.source || (d.configuredBin ? '手工指定' : '自动探测'))}
        ${kv('手工指定路径', d.configuredBin || '未指定')}
        ${kv('运行平台', d.platform || '—')}
        ${kv('工作区', d.workspaceDir || '—')}
        ${kv('宿主机映射', d.hostWorkspaceDir || '—')}
        ${kv('克隆通道', d.channel || '—')}
        ${kv('SSH 兜底', fb.enabled === false ? '已关闭' : (fb.ready
          ? `就绪 · ${fb.serverName || ''}（${fb.serverHost || ''}）` : `未就绪 · ${fb.reason || '未登记 SSH 服务器'}`))}
      </div>
      <div class="notice" style="margin-top:10px">${hintLines}</div>
      <details class="dk-raw" style="margin-top:8px">
        <summary>可执行文件探测明细（${tried.length} 条）</summary>
        <div class="git-probe-list">${triedHtml}</div>
      </details>
      ${d.installHint ? `<div class="hint" style="margin-top:8px">安装建议：<code>${esc(d.installHint)}</code></div>` : ''}`;
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

async function loadIde() {
  try {
    const d = await api('/ide');
    $('#ide-home').href = d.url;
    $('#ide-url').textContent = `服务地址：${d.url} · 平台工作区：${d.workspace}`;
  } catch (e) { toast(e.message, true); }
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
  const online = Boolean(status && status.online);
  const label = status && (status.connectionLabel || status.label) ? `「${status.connectionLabel || status.label}」` : '';
  $('#openlist-status-text').textContent = online ? '● 在线' : '● 离线 / 未配置';
  $('#openlist-status-detail').textContent = online
    ? `${label} ${status.url} · ${status.version ? `v${status.version} · ` : ''}${status.siteTitle || 'OpenList'} · ${status.storageCount} 个挂载 · 配置来源：${status.source} · 代理：${status.effectiveProxy || '无'}${status.admin ? '' : ` · [管理权限不可用] ${status.adminHint || status.adminError || 'Token 无效'}`}`
    : `${label} ${status ? status.url || '' : ''} ${status ? (status.hint || status.error || '') : ''}`;
  $('#openlist-open').href = (status && status.manageUrl) || '#';
  $('#webdav-url').textContent = (status && status.webdav) || '-';
  if (online && !$('#openlist-frame-card').hidden) {
    $('#openlist-frame').src = status.manageUrl;
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
        if (!confirm(`确定删除连接「${b.dataset.olcName || id}」？只移除平台里的登记，不会影响远端服务。`)) return;
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
  storageState.selected.clear();
  $('#storage-provider').textContent = `${d.provider || 'OpenList'} · ${d.total || 0} 项${d.write ? '' : ' · 只读'}`;
  $('#file-list').innerHTML = table(['', '名称', '大小', '类型', '修改时间', '操作'], storageState.files.map((f) => {
    const full = olJoin(currentStoragePath, f.name);
    return `<tr class="file-row${f.isDir ? ' is-dir' : ''}" data-ol-dir="${f.isDir ? esc(full) : ''}" ${f.isDir ? 'title="双击进入该目录"' : ''}>
      <td><input type="checkbox" data-ol-file="${esc(f.name)}" /></td>
      <td><span class="file-name">${f.isDir ? '📁' : '📄'} <b>${esc(f.name)}</b></span></td>
      <td>${f.isDir ? '-' : fmtSize(f.size)}</td>
      <td>${f.isDir ? '目录' : '文件'}</td>
      <td class="muted">${esc(fmtTime(f.modified))}</td>
      <td class="actions"><div class="ext-actions">
        ${f.isDir
          ? ''
          : `<button class="btn btn-sm" data-ol-get="${esc(full)}">下载</button>
             <button class="btn btn-sm" data-ol-link="${esc(full)}">直链</button>`}
        <button class="btn btn-sm" data-ol-one-rename="${esc(full)}">重命名</button>
        <button class="btn btn-sm btn-danger" data-ol-one-del="${esc(f.name)}">删除</button>
      </div></td>
    </tr>`;
  }));
  renderBreadcrumb(d.path || currentStoragePath);
  $$('[data-ol-file]').forEach((box) => box.addEventListener('change', () => {
    if (box.checked) storageState.selected.add(box.dataset.olFile);
    else storageState.selected.delete(box.dataset.olFile);
    const all = $$('[data-ol-file]');
    $('#storage-select-all').checked = all.length > 0 && all.every((x) => x.checked);
  }));
  // v0.3.6：目录双击进入（宝塔式），不再需要每行一个「进入」按钮。
  $$('[data-ol-dir]').forEach((row) => row.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, a')) return;
    const target = row.dataset.olDir;
    if (target) { currentStoragePath = target; loadStorage(); }
  }));
  $$('[data-ol-get]').forEach((b) => b.addEventListener('click', () => { window.open(olDownloadUrl(b.dataset.olGet), '_blank', 'noopener'); }));
  $$('[data-ol-link]').forEach((b) => b.addEventListener('click', () => olAction('link', [b.dataset.olLink])));
  $$('[data-ol-one-rename]').forEach((b) => b.addEventListener('click', () => olAction('rename', [b.dataset.olOneRename])));
  $$('[data-ol-one-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    olAction('remove', [b.dataset.olOneDel]);
  }));
}

function renderMountList(items) {
  storageState.storages = items || [];
  $('#mount-list').innerHTML = items.length ? items.map((m) => `
    <div class="list-item">
      <div><div class="title">${esc(m.mountPath)} ${m.disabled ? badge('已停用', 'gray') : badge('启用', 'green')}</div>
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
    if (!confirm('确认删除该挂载存储？不会删除底层文件，但会移除挂载点。')) return;
    try {
      await api(`/openlist/storages/${encodeURIComponent(b.dataset.olStorageDel)}`, { method: 'DELETE' });
      toast('已删除'); loadStorage();
    } catch (e) { toast(e.message, true); }
  }));
}

function renderDriverList(items) {
  storageState.drivers = items || [];
  const select = $('#ol-driver');
  if (select) {
    const current = select.value;
    select.innerHTML = items.length
      ? items.map((d) => `<option value="${esc(d.driver)}">${esc(d.name || d.driver)}</option>`).join('')
      : '<option value="">（未读取到驱动清单，可手填）</option>';
    if (current && items.some((d) => d.driver === current)) select.value = current;
  }
  $('#storage-driver-list').innerHTML = items.length ? items.slice(0, 120).map((d) => `
    <div class="list-item"><div><div class="title">${esc(d.name || d.driver)}</div>
      <div class="desc">${esc(d.driver)}${d.description ? ` · ${esc(d.description)}` : ''}</div></div>
      <button class="btn btn-sm" data-ol-driver="${esc(d.driver)}">选用</button>
    </div>`).join('') : '<div class="empty">未读取到驱动清单（需要管理员权限 Token）</div>';
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
    toast(`已选用驱动 ${b.dataset.olDriver}`);
  }));
}

async function loadStorage() {
  $('#storage-path').value = currentStoragePath;
  const settled = (p) => Promise.resolve(p).catch((e) => ({ error: e.message }));
  const [status, files, mounts, drivers, connections] = await Promise.all([
    settled(api('/openlist/status')),
    settled(api(`/openlist/files?path=${encodeURIComponent(currentStoragePath)}`)),
    settled(api('/openlist/storages')),
    settled(api('/openlist/drivers')),
    settled(api('/openlist/connections')),
  ]);
  renderOpenlistStatus(status);
  renderOpenlistConnections(connections);
  renderStorageDegraded([files, mounts, drivers]);
  if (files && !files.error) renderFileList(files);
  else $('#file-list').innerHTML = errorBlock(files.error || '无法读取目录',
    '请到「连接管理」切换到一个可用的 OpenList，或修复当前连接的管理员凭据');
  renderMountList(mounts && mounts.items || []);
  renderDriverList(drivers && drivers.items || []);
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
      const next = prompt('新的名称（不含路径）', p.split('/').pop() || '');
      if (!next) return;
      await api('/openlist/files/rename', { method: 'POST', body: { path: p, name: next } });
      toast('已重命名');
    } else if (action === 'move' || action === 'copy') {
      const dst = prompt(`把 ${names.length} 项${action === 'move' ? '移动' : '复制'}到哪个目录？`, '/');
      if (!dst) return;
      await api(`/openlist/files/${action}`, {
        method: 'POST', body: { srcDir: currentStoragePath, dstDir: dst, names },
      });
      toast(action === 'move' ? '移动任务已提交' : '复制任务已提交');
    } else if (action === 'remove') {
      if (!confirm(`确认从 OpenList 删除 ${names.length} 项？此操作不可撤销。`)) return;
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
      const json = await response.json();
      if (!json.ok) throw new Error(json.error);
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
      <input data-proxy-group-input="${scope}" placeholder="留空继承全局代理；direct 强制直连"
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

function renderProxyEntities() {
  const scope = $('#proxy-override-scope').value || 'git';
  const items = (proxyState.entities && proxyState.entities[scope]) || [];
  $('#proxy-override-id').innerHTML = items.length
    ? `<option value="">（选择已登记对象）</option>${items.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}`
    : '<option value="">（暂无对象，请在下方手填标识）</option>';
}

/** 从 Git / Docker / 服务器 / AI 页面一键跳到代理页并预填对象标识。 */
async function gotoProxyOverride(scope, id) {
  switchView('proxy');
  try {
    await loadProxy();
    $('#proxy-override-scope').value = scope;
    renderProxyEntities();
    $('#proxy-override-custom').value = id || '';
    const input = $('#proxy-override-form').elements.url;
    if (input && input.focus) input.focus();
    toast(`已选中 ${PROXY_LABELS[scope]} · ${id}，填写代理地址后点「保存覆盖」`);
  } catch (e) { toast(e.message, true); }
}

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
      $('#build-backend').innerHTML = `<option value="auto">自动选择（推荐，当前配置 ${esc(backends.current)}）</option>`
        + backendItems.map((b) => `<option value="${esc(b.id)}"${b.available ? '' : ' disabled'}>${esc(b.label)}${b.available ? ' · 可用' : ' · 不可用'}</option>`).join('');
    }
    if ($('#build-backends')) {
      $('#build-backends').textContent = backendItems.map((b) => `${b.available ? '●' : '○'} ${b.label}：${b.detail}`).join('　|　')
        + '　· 编译环境不引入 microVM';
    }
    if (!$('#profile-select').options.length) {
      $('#profile-select').innerHTML = '<option value="auto">自动识别</option>'
        + profiles.items.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    }
    $('#deploy-server').innerHTML = '<option value="">选择服务器</option>'
      + servers.items.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.host)})</option>`).join('');

    $('#build-list').innerHTML = (builds.items || []).length ? builds.items.map((b) => `
      <div class="list-item">
        <div><div class="title">${esc(b.repoPath || '.')} · ${esc(b.profileLabel || b.profile)}</div>
          <div class="desc">${esc(fmtTime(b.startedAt))} · ${esc(b.durationMs ? Math.round(b.durationMs / 1000) + 's' : '进行中')} · ${esc(b.id)}</div></div>
        <div class="row">
          ${badge(b.status === 'success' ? '成功' : b.status === 'failed' ? '失败' : b.status === 'running' ? '构建中' : b.status,
            b.status === 'success' ? 'green' : b.status === 'failed' ? 'red' : b.status === 'running' ? 'blue' : 'gray')}
          <button class="btn btn-sm" data-log="${esc(b.id)}">日志</button>
        </div>
      </div>`).join('') : '<div class="empty">还没有构建任务，先在上方启动一次</div>';
    $$('[data-log]').forEach((b) => b.addEventListener('click', () => watchLog(b.dataset.log)));

    $('#deploy-list').innerHTML = table(['时间', '服务器', '目标目录', '状态', '结果'], (deploys.items || []).map((d) => `
      <tr><td class="muted">${esc(fmtTime(d.createdAt))}</td><td>${esc(d.serverName || d.serverId)}</td>
      <td>${esc(d.targetDir)}</td><td>${badge(d.status === 'success' ? '成功' : '失败', d.status === 'success' ? 'green' : 'red')}</td>
      <td class="muted">${esc(d.message)}</td></tr>`));
  } catch (e) { toast(e.message, true); }
}

async function watchLog(id) {
  selectedBuildId = id;
  $('#log-target').textContent = `构建 ${id}`;
  if (logTimer) clearInterval(logTimer);
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
          <button class="btn btn-sm" data-status="${esc(s.id)}">检查状态</button>
          <button class="btn btn-sm" data-test="${esc(s.id)}">测试连接</button>
          <button class="btn btn-sm" data-server-proxy="${esc(s.id)}">代理</button>
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
    $$('[data-status]').forEach((b) => b.addEventListener('click', () => checkStatus(b.dataset.status)));
    $$('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api(`/servers/${b.dataset.test}/test`, { method: 'POST', body: {} }); toast(r.online ? `连接正常：${r.output}` : `连接失败：${r.error}`, !r.online); }
      catch (e) { toast(e.message, true); }
    }));
    $$('[data-server-proxy]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('server', b.dataset.serverProxy)));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('确认删除这台服务器？')) return;
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

function openFilesTab(server) {
  const id = `files:${server.id}`;
  if (tabs.has(id)) return activateTab(id);
  const start = server.deployDir || '/data/platform';
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
        <div class="term-hint">点击文件名在新标签页打开编辑器：按后缀自动识别语言并语法高亮，可切换编码 / 换行符 / BOM。可以同时打开多个文件、多个终端与多个模块页。</div>
      </div>
    </div>`);
  const tab = registerTab({
    id, kind: 'files', dynamic: true, closable: true, icon: '▤', pane,
    title: `文件 · ${server.name}`,
    sub: `${server.host} · SFTP 文件管理（可多标签编辑）`,
    ctx: { serverId: server.id, serverName: server.name, host: server.host, path: start, parent: '/' },
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

async function loadRemoteFiles(tab) {
  const pane = tab.pane;
  const box = q(pane, 'fs-list');
  if (!box) return;
  box.innerHTML = '<div class="muted" style="padding:14px">读取中…</div>';
  try {
    const data = await api(`/servers/${tab.ctx.serverId}/files?path=${encodeURIComponent(tab.ctx.path)}`);
    if (!tabs.has(tab.id)) return;
    tab.ctx.path = data.path;
    tab.ctx.parent = data.parent;
    const bar = q(pane, 'fs-pathbar');
    if (bar) {
      bar.innerHTML = pathBarHtml(data.path);
      bindPathBar(bar, {
        onGo: (v) => { tab.ctx.path = v; loadRemoteFiles(tab); },
        onUp: () => { tab.ctx.path = tab.ctx.parent || '/'; loadRemoteFiles(tab); },
      });
    }
    const rows = (data.items || []).map((item) => `
      <tr data-fs-path="${esc(item.path)}" data-fs-name="${esc(item.name)}" data-fs-dir="${item.isDir ? 1 : 0}">
        <td style="width:38px"><input type="checkbox" data-role="fs-check" value="${esc(item.name)}" /></td>
        <td><span class="ft-icon ft-${esc(item.color || 'gray')}">${esc(item.icon || 'TXT')}</span>
          <a href="#" class="fs-name">${esc(item.name)}</a>
          ${item.isDir ? '' : `<span class="ft-lang">${esc(item.language || '')}</span>`}</td>
        <td style="width:110px">${item.isDir ? '—' : fmtSize(item.size)}</td>
        <td style="width:170px" class="muted">${esc(fmtTime(item.mtime))}</td>
        <td class="fs-ops" style="width:230px">
          ${item.isDir ? '' : '<button class="btn btn-xs" data-fs-act="edit">编辑</button><button class="btn btn-xs" data-fs-act="download">下载</button>'}
          <button class="btn btn-xs" data-fs-act="rename">重命名</button>
          <button class="btn btn-xs btn-danger" data-fs-act="delete">删除</button>
        </td>
      </tr>`).join('');
    box.innerHTML = `<table><thead><tr>
      <th style="width:38px"></th><th>名称（按类型识别）</th><th style="width:110px">大小</th>
      <th style="width:170px">修改时间</th><th style="width:230px">操作</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">目录为空</td></tr>'}</tbody></table>`;
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
      const name = prompt('新建文件名称（后缀决定语法高亮，例如 app.py / config.yaml）', 'new.txt');
      if (!name) return;
      await api(`/servers/${id}/files/create`, { method: 'POST', body: { path: tab.ctx.path, name } });
      toast('文件已创建'); await loadRemoteFiles(tab); return;
    }
    if (action === 'mkdir') {
      const name = prompt('新建目录名称');
      if (!name) return;
      await api(`/servers/${id}/files/mkdir`, { method: 'POST', body: { path: tab.ctx.path, name } });
      toast('目录已创建'); await loadRemoteFiles(tab); return;
    }
    if (action === 'remove-selected') {
      const names = Array.from(pane.querySelectorAll('[data-role="fs-check"]:checked')).map((c) => c.value);
      if (!names.length) { toast('请先勾选要删除的项', true); return; }
      if (!confirm(`确认删除选中的 ${names.length} 项？目录会被递归删除。`)) return;
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
        const next = prompt('新名称', name);
        if (!next || next === name) return;
        await api(`/servers/${id}/files/rename`, { method: 'POST', body: { path: target, name: next } });
        toast('已重命名'); await loadRemoteFiles(tab); return;
      }
      case 'delete': {
        if (!confirm(`确认删除 ${name}？目录会被递归删除。`)) return;
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
          <label>语法高亮<select data-role="ed-lang"></select></label>
          <label>文件编码<select data-role="ed-encoding"></select></label>
          <label>换行符<select data-role="ed-newline"></select></label>
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
        if (tab.dirty && !confirm('重新载入会丢弃未保存的修改，继续？')) return;
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
    if (tab.dirty && !confirm('切换编码会重新读取文件并丢弃未保存的修改，继续？')) {
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

function openTerminalTab(server) {
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
    ctx: { serverId: server.id, sid: null, term: null, fit: null, source: null, resizeHandler: null },
    onActivate: (t) => {
      if (t.ctx.fit) { try { t.ctx.fit(); } catch { /* noop */ } }
      if (t.ctx.term) { try { t.ctx.term.focus(); } catch { /* noop */ } }
    },
    onClose: cleanupTerminal,
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
    renderDetected(await api(`/ai/local/programs${force ? '?refresh=1' : ''}`));
  } catch (e) {
    $('#detect-status').textContent = `检测失败：${e.message}`;
    $('#detected-list').innerHTML = errorBlock(e.message);
  }
}

function providerSummary(p) {
  if (p.kind === 'cli') {
    const where = p.runner === 'wsl' ? `WSL ${p.distro || '默认发行版'}` : '宿主机';
    return `${esc(p.command === 'custom' ? p.customCommand : p.command)} · ${esc(where)}${p.extraArgs ? ' · ' + esc(p.extraArgs) : ''}${p.proxy ? ' · 代理 ' + esc(p.proxy) : ''}`;
  }
  return `${esc(p.baseURL)} · ${esc(p.model)} · Key ${esc(p.apiKey || '未设置')}${p.proxy ? ' · 代理 ' + esc(p.proxy) : ''}`;
}

async function loadAI() {
  try {
    const d = await api('/ai/providers');
    const items = d.items || [];
    $('#provider-list').innerHTML = items.length ? items.map((p) => `
      <div class="list-item">
        <div><div class="title">${esc(p.name)} ${p.kind === 'cli' ? badge('本地 CLI', 'blue') : badge('API', 'gray')} ${p.enabled === false ? badge('已停用', 'gray') : badge('启用', 'green')}</div>
          <div class="desc">${providerSummary(p)}</div></div>
        <div class="actions">
          <button class="btn btn-sm" data-edit="${esc(p.id)}">编辑</button>
          <button class="btn btn-sm" data-ai-proxy="${esc(p.id)}">代理</button>
          <button class="btn btn-sm btn-danger" data-delprovider="${esc(p.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="empty">还没有配置 AI 服务</div>';
    const options = items.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.kind === 'cli' ? '本地 ' + esc(p.command) : esc(p.model)}</option>`).join('');
    $('#chat-provider').innerHTML = options || '<option value="">请先配置服务</option>';
    $('#ops-provider').innerHTML = options || '<option value="">请先配置服务</option>';

    $$('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
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
        if (p.kind === 'cli') {
          await detectPrograms(false);
          if (p.distro && !Array.from($('#cli-distro').options).some((o) => o.value === p.distro)) {
            $('#cli-distro').add(new Option(p.distro, p.distro));
          }
          $('#cli-distro').value = p.distro || '';
        }
        toast(`正在编辑 ${p.name}`);
      } catch (e) { toast(e.message, true); }
    }));
    $$('[data-ai-proxy]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('ai', b.dataset.aiProxy)));
    $$('[data-delprovider]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/ai/providers/${b.dataset.delprovider}`, { method: 'DELETE' }); toast('已删除'); loadAI(); }
      catch (e) { toast(e.message, true); }
    }));
  } catch (e) { $('#provider-list').innerHTML = errorBlock(e.message); }
}

/* -------------------------------- AI 运维 -------------------------------- */

async function loadOps() {
  try {
    const d = await api('/ai/tools');
    if (!$('#ops-hint')) {
      const hint = document.createElement('div');
      hint.id = 'ops-hint';
      hint.className = 'hint';
      hint.textContent = `只读命令白名单：${d.readCommands.join(' · ')}`;
      $('#ops-form').appendChild(hint);
    }
  } catch (e) { toast(e.message, true); }
}

/* ----------------------------- 扩展 / 数据库 ----------------------------- */
// 清单由后端下发（内置 + data/extensions/*.json），前端只按字段声明渲染表单，
// 不内置任何数据库专属逻辑；新增一种服务只需在后端加一条清单常量。
const extState = {
  catalog: null, items: [], manifestId: '', mode: 'external', defaultMode: 'external',
  backups: [], dbgate: null, reposInstanceId: '',
};
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
      <td><div class="ext-list-url">${esc(i.connectionMasked || '')}</div><div class="ext-actions" style="margin-top:8px">${ops.join('')}</div></td>
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
      input = `<select name="${esc(f.key)}">${opts}</select>`;
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
  $('#ext-install-card').hidden = false;
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

function openExtRepos(id) {
  extState.reposInstanceId = id;
  if (!repoState.items.length) loadRepos();
  $('#ext-repos-title').textContent = `绑定仓库 · ${id}`;
  renderExtReposOptions();
  $('#ext-repos-card').hidden = false;
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
          ${r.logsTail ? `<details class="dk-raw"><summary>日志尾部</summary><pre class="log short">${esc(r.logsTail)}</pre></details>` : ''}
        </div>`).join('') : '<div class="empty">还没有已登记的实例</div>');
    box.querySelectorAll('[data-ext-diag]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.extDiag === 'close') box.hidden = true;
      else runExtDiagnose();
    }));
    box.querySelectorAll('[data-ext-rebuild]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.extRebuild;
      if (!confirm('将用当前配置重建该实例的容器（数据卷与凭据保留），确认继续？')) return;
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
      <td>${esc(s.type)}</td>
      <td>${s.hasCreds
        ? badge(s.authType === 'password' ? '账号密码' : 'Token', 'green')
          + `<div class="ext-list-url">${esc(s.authType === 'password' ? `${s.username || '-'} / ${s.passwordMasked || '******'}` : (s.tokenMasked || ''))}</div>`
        : badge('未配置', 'amber')}</td>
      <td><div class="ext-actions">
        <button class="btn btn-sm" data-gitsrc-op="test" data-gitsrc-id="${esc(s.id)}">测试连通</button>
        <button class="btn btn-sm" data-gitsrc-op="repos" data-gitsrc-id="${esc(s.id)}">仓库列表</button>
        ${s.builtin ? '' : `<button class="btn btn-sm btn-primary" data-gitsrc-op="edit" data-gitsrc-id="${esc(s.id)}">编辑</button>
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

/* -------------------------------- 事件绑定 ------------------------------- */

const loaders = {
  overview: loadOverview,
  repos: loadRepos, 'repo-new': loadRepos, 'repo-clone': loadRepos,
  ide: loadIde,
  storage: loadStorage, 'storage-conn': loadStorage, 'storage-mounts': loadStorage, 'storage-drivers': loadStorage,
  builds: loadBuilds, 'build-start': loadBuilds, deploys: loadBuilds,
  servers: loadServers, 'server-new': loadServers,
  extensions: loadExtensions, gitsrc: loadGitSources,
  docker: loadDocker, 'docker-containers': loadDocker, 'docker-images': loadDocker,
  'docker-volumes': loadDocker, 'docker-networks': loadDocker, 'docker-compose': loadDocker,
  proxy: loadProxy,
  dbgate: loadExtExtras, backups: loadExtExtras,
  ai: loadAI, ops: loadOps, environment: loadEnvironment,
};

/* 每个独立页顶部的子导航：点按钮打开对应标签，而不是把功能堆在一页里。 */
document.addEventListener('click', (e) => {
  const button = e.target && e.target.closest ? e.target.closest('[data-open-view]') : null;
  if (button) switchView(button.dataset.openView);
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
      const source = sysSource || (prompt('输入更新源：本地目录路径或 release.json 的 URL', '') || '');
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
$('#ext-install-close').addEventListener('click', () => { $('#ext-install-card').hidden = true; });
$('#ext-install-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = formData(e.target);
  try {
    const created = await api('/extensions/instances', {
      method: 'POST', body: { catalogId: extState.manifestId, mode: extState.mode, values },
    });
    toast(`已创建实例 ${created.name}`);
    $('#ext-install-card').hidden = true;
    await loadExtensions();
  } catch (err) { toast(err.message || String(err), true); }
});
$('#ext-log-close').addEventListener('click', () => { $('#ext-log-card').hidden = true; });
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
    } else if (op === 'inject') {
      const inst = extState.items.find((x) => x.id === id);
      const target = prompt('写入工作区内的哪个文件？', '.env');
      if (!target) return;
      const bound = (inst && inst.repoIds) || [];
      const useRepos = bound.length && confirm(`该实例绑定了 ${bound.length} 个仓库。\n确定 = 一次写入这些仓库目录下的 ${target}\n取消 = 只写工作区根目录的 ${target}`);
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
      const tag = prompt(`输入要升级到的镜像版本（当前 ${inst ? inst.tag : '未知'}）`, inst ? inst.tag : '');
      if (!tag) return;
      if (!confirm(`升级前会自动备份，然后保留数据卷重建容器；健康检查失败将回滚到 ${inst ? inst.tag : '旧版本'}。继续？`)) return;
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
      $('#ext-log-card').hidden = false;
    } else if (op === 'remove') {
      const name = button.dataset.extName || '该实例';
      if (!confirm(`确定卸载扩展实例「${name}」？`)) return;
      const purge = confirm('是否同时删除数据卷？\n确定 = 连同数据一起删除（不可恢复）\n取消 = 保留数据卷，之后可重新挂载');
      const d = await api(`/extensions/instances/${id}?purge=${purge ? 1 : 0}`, { method: 'DELETE' });
      toast(d.volumeKept ? '已卸载，数据卷已保留' : '已卸载');
      $('#ext-log-card').hidden = true;
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
      if (!confirm(`确定用「${name}」恢复数据？当前实例的同名库会被覆盖，此操作不可撤销。`)) return;
      if (!confirm('再次确认：恢复过程可能需要重启数据库容器，期间连接会短暂中断。继续？')) return;
      const d = await api(`/extensions/backups/${id}/restore`, { method: 'POST', body: { confirm: true } });
      toast(`已恢复 ${fmtSize(d.size)} 数据${d.restartAfter ? '，容器已重启' : ''}`);
      await loadExtensions();
    } else if (op === 'delete') {
      if (!confirm('确定删除这份备份存档？删除后无法再用它恢复。')) return;
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

$('#ext-repos-close').addEventListener('click', () => { $('#ext-repos-card').hidden = true; });
$('#ext-repos-save').addEventListener('click', async () => {
  const id = extState.reposInstanceId;
  if (!id) return;
  const repoIds = $$('#ext-repos-options [data-ext-repo]:checked').map((x) => x.dataset.extRepo);
  try {
    const d = await api(`/extensions/instances/${id}/repos`, { method: 'PUT', body: { repoIds } });
    toast(`已绑定 ${d.repoIds.length} 个仓库`);
    $('#ext-repos-card').hidden = true;
    await loadExtensions();
  } catch (err) { toast(err.message || String(err), true); }
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
  $('#gitsrc-token').placeholder = s.hasToken ? `留空沿用原值（当前 ${s.tokenMasked || '已保存'}）` : '留空表示不设置 Token';
  $('#gitsrc-password').placeholder = s.hasPassword ? `留空沿用原值（当前 ${s.passwordMasked || '已保存'}）` : '留空表示不设置密码';
  $('#gitsrc-form-title').textContent = `编辑 Git 源 · ${s.label}`;
  $('#gitsrc-submit').textContent = '保存修改';
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
      $('#gitsrc-repos-card').hidden = false;
      if (!items.length && d.error) toast(d.error, true);
    } else if (op === 'remove') {
      if (!confirm(`确定删除 Git 源「${button.dataset.gitsrcName || id}」？只移除本地登记，不会影响远端仓库。`)) return;
      await api(`/git-sources/${id}`, { method: 'DELETE' });
      toast('Git 源已删除');
      await loadGitSources();
      await loadRepos();
    }
  } catch (err) { toast(err.message || String(err), true); }
});

$('#gitsrc-repos-close').addEventListener('click', () => { $('#gitsrc-repos-card').hidden = true; });
$('#gitsrc-repos').addEventListener('click', (e) => {
  const button = e.target.closest('[data-clone-repo]');
  if (!button) return;
  $('#clone-form').elements.cloneUrl.value = button.dataset.cloneRepo || '';
  $('#clone-form').elements.name.value = button.dataset.cloneName || '';
  $('#clone-source').value = button.dataset.cloneSource || '';
  switchView('repo-clone');
  toast('已填入克隆表单，点击「克隆到工作区」执行');
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

function dockerShowLog(title, text) {
  $('#docker-log').textContent = text || '(无输出)';
  $('#docker-log-card').hidden = false;
  $('#docker-log-card').querySelector('h2').textContent = title;
}

const dockerQuery = () => `target=${encodeURIComponent(dockerState.target)}`;
const dockerNeedConfirm = (label, owned) => {
  if (owned) return confirm(`确定对平台自建对象执行「${label}」？`);
  return confirm(`该对象不是平台创建的（可能是宿主机上的其它服务）。\n确定继续执行「${label}」？误操作可能影响生产服务。`)
    && confirm('再次确认：此操作不可撤销，继续？');
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
      if (!dockerNeedConfirm(label, owned)) return;
      const d = await api(`/docker/containers/${encodeURIComponent(id)}/action`, {
        method: 'POST', body: { target: dockerState.target, action: op, confirm: true },
      });
      toast(d.detail || '操作已完成');
      await loadDocker();
    } else if (op === 'remove') {
      if (!dockerNeedConfirm(label, owned)) return;
      const d = await api(`/docker/containers/${encodeURIComponent(id)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      toast(d.removed ? '容器已删除' : '操作已完成');
      await loadDocker();
    } else if (op === 'logs') {
      const d = await api(`/docker/containers/${encodeURIComponent(id)}/logs?${dockerQuery()}&tail=200`);
      dockerShowLog('容器日志', d.text);
    } else if (op === 'inspect' || op === 'stats') {
      const d = await api(`/docker/containers/${encodeURIComponent(id)}/${op}?${dockerQuery()}`);
      dockerShowLog(op === 'inspect' ? '容器详情' : '资源占用', JSON.stringify(d, null, 2));
    } else if (op === 'export') {
      window.open(`/api/docker/images/export?${dockerQuery()}&ref=${encodeURIComponent(ref)}${streamToken()}`, '_blank');
    } else if (op === 'rmi') {
      if (!dockerNeedConfirm(label, false)) return;
      await api(`/docker/images/remove?${dockerQuery()}&confirm=true`, { method: 'POST', body: { ref, target: dockerState.target, confirm: true } });
      toast('镜像已删除');
      await loadDocker();
    } else if (op === 'rmvol') {
      if (!dockerNeedConfirm(label, false)) return;
      await api(`/docker/volumes/${encodeURIComponent(ref)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      await loadDocker();
    } else if (op === 'rmnet') {
      if (!dockerNeedConfirm(label, false)) return;
      await api(`/docker/networks/${encodeURIComponent(ref)}?${dockerQuery()}&confirm=true`, { method: 'DELETE' });
      await loadDocker();
    } else if (op === 'rmtpl') {
      if (!confirm('确定删除这份编排模板？')) return;
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
    await api('/docker/templates', { method: 'POST', body: formData(e.target) });
    toast('编排模板已保存（仅保存文本，不在平台内执行）');
    e.target.reset();
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

$('#repo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  body.private = e.target.elements.private.checked;
  try { const d = await api('/repos', { method: 'POST', body }); toast(`仓库 ${d.repo.name || ''} 已创建`); e.target.reset(); loadRepos(); }
  catch (err) { toast(err.message, true); }
});

/** 克隆凭据方式切换：只展示当前方式需要的字段，避免残留值被误提交。 */
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
        b.addEventListener('click', () => switchView(b.dataset.cloneGoto));
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
$('#upload-input').addEventListener('change', (e) => uploadFiles(e.target.files));
$('#ol-conn-new').addEventListener('click', () => fillOpenlistConnectionForm(null));
$('#ol-conn-cancel').addEventListener('click', closeOpenlistConnectionForm);
$('#ol-conn-reload').addEventListener('click', () => loadStorage());
$('#openlist-embed-toggle').addEventListener('click', () => {
  const card = $('#openlist-frame-card');
  card.hidden = !card.hidden;
  if (!card.hidden && storageState.connection) {
    $('#openlist-frame').src = storageState.connection.manageUrl || '#';
  }
});
$('#openlist-frame-close').addEventListener('click', () => {
  $('#openlist-frame-card').hidden = true;
  $('#openlist-frame').src = 'about:blank';
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
  if (!confirm('恢复使用 .env / 环境变量里的默认 OpenList 连接？其它已登记连接会保留。')) return;
  try {
    await api('/openlist/connection/reset', { method: 'POST', body: {} });
    toast('已恢复 .env 默认连接');
    closeOpenlistConnectionForm();
    currentStoragePath = '/';
    await loadStorage();
  } catch (err) { toast(err.message, true); }
});
$('#webdav-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#webdav-url').textContent.trim()); toast('WebDAV 地址已复制'); }
  catch { toast('复制失败，请手动选择', true); }
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
  box.hidden = false; box.textContent = '测试中…';
  try {
    const d = await api('/proxy/test', { method: 'POST', body: { global: true, target: 'https://github.com' } });
    box.textContent = `✔ ${d.source} · ${d.proxy || '直连'} · ${d.ms} ms${d.status ? ` · HTTP ${d.status}` : ''} · 目标 ${d.target}`;
  } catch (err) { box.textContent = `✖ ${err.message}`; }
});
$('#proxy-rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/proxy/rules', { method: 'POST', body: formData(e.target) });
    toast('Host 规则已添加'); e.target.reset(); loadProxy();
  } catch (err) { toast(err.message, true); }
});
$('#proxy-override-scope').addEventListener('change', renderProxyEntities);
$('#proxy-entities-reload').addEventListener('click', () => loadProxy());
$('#proxy-override-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const id = String(body.customId || '').trim() || String(body.id || '').trim();
  if (!id) { toast('请选择对象或手填对象标识', true); return; }
  try {
    await api(`/proxy/overrides/${encodeURIComponent(body.scope)}?id=${encodeURIComponent(id)}`, {
      method: 'PUT', body: { url: body.url || '' },
    });
    toast(body.url ? '单项覆盖已保存' : '单项覆盖已删除');
    e.target.elements.url.value = '';
    e.target.elements.customId.value = '';
    loadProxy();
  } catch (err) { toast(err.message, true); }
});
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
  try { await api('/servers', { method: 'POST', body: formData(e.target) }); toast('服务器已保存'); e.target.reset(); loadServers(); }
  catch (err) { toast(err.message, true); }
});

function providerFormBody(form) {
  const body = formData(form);
  body.enabled = form.elements.enabled.checked;
  body.noKey = form.elements.noKey.checked;
  return body;
}

$('#provider-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/ai/providers', { method: 'POST', body: providerFormBody(e.target) });
    toast('AI 服务已保存');
    e.target.reset();
    setProviderKind('api');
    loadAI();
  } catch (err) { toast(err.message, true); }
});
$('#provider-reset').addEventListener('click', () => {
  $('#provider-form').reset();
  setProviderKind('api');
  $('#provider-test-result').hidden = true;
});
$('#provider-test').addEventListener('click', async (e) => {
  const box = $('#provider-test-result');
  box.hidden = false;
  box.textContent = '正在测试当前配置…';
  try {
    const body = providerFormBody($('#provider-form'));
    const d = await api('/ai/test', { method: 'POST', body: { ...body, prompt: '用一句话说明你是什么，不要执行任何操作。' } });
    box.textContent = `[${d.kind === 'cli' ? '本地 CLI' : 'API'}] ${d.answer}`;
  } catch (err) { box.textContent = `失败：${err.message}`; toast(err.message, true); }
});

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#chat-result').textContent = '请求中…';
  try {
    const d = await api('/ai/chat', { method: 'POST', body: { providerId: $('#chat-provider').value, prompt: $('#chat-prompt').value } });
    $('#chat-result').textContent = `[${d.provider} / ${d.model}]\n${d.answer}`;
  } catch (err) { $('#chat-result').textContent = `失败：${err.message}`; toast(err.message, true); }
});

$('#ops-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#ops-answer').textContent = 'AI 分析中…';
  $('#ops-trace').textContent = '—';
  try {
    const d = await api('/ai/ops', {
      method: 'POST',
      body: { providerId: $('#ops-provider').value, prompt: $('#ops-prompt').value, allowWrite: $('#ops-write').checked },
    });
    $('#ops-answer').textContent = d.answer || '（无文本结论）';
    $('#ops-trace').textContent = d.trace && d.trace.length
      ? JSON.stringify(d.trace, null, 2) : '（未调用任何工具）';
    if (d.mode === 'context-injection') toast('本地 CLI 模式：已由平台采集上下文后提问');
  } catch (err) { $('#ops-answer').textContent = `失败：${err.message}`; toast(err.message, true); }
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
  const area = $('#docker-template-content');
  if (!box || !area) return;
  const r = checkYaml(String(area.value || ''));
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
      const area = $('#docker-template-content');
      if (area) area.value = '';
    } else {
      f.elements.name.value = t.name;
      f.elements.description.value = t.description;
      $('#docker-template-content').value = t.content;
    }
    renderYamlCheck();
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
      $('#docker-template-content').value = t.content || '';
      renderYamlCheck();
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
if (tplCopyNow) tplCopyNow.addEventListener('click', () => copyText($('#docker-template-content').value, 'YAML 已复制'));
const tplDownloadNow = $('#docker-tpl-download');
if (tplDownloadNow) tplDownloadNow.addEventListener('click', () => {
  const f = $('#docker-template-form');
  downloadText(`${String(f.elements.name.value || 'docker-compose').trim()}.yml`, $('#docker-template-content').value);
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

/* --------------------------------- 启动 ---------------------------------- */

(async function boot() {
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
})();
