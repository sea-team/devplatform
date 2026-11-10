'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const VIEW_META = {
  overview: ['总览', '平台各模块运行状态与关键指标'],
  repos: ['Git 仓库', '聚合平台自带与 GitHub / 自建 Gitea 等外部源，克隆后直接开发'],
  ide: ['在线 IDE', '基于 code-server 的浏览器版 VSCode，工作区与构建流水线共享'],
  storage: ['存储 / 文件', 'OpenList 连接、挂载存储、驱动与全功能文件管理器'],
  builds: ['构建 · 部署', '可降级构建后端：远程 Docker / 本机 Docker / WSL2 / 本地工具链'],
  servers: ['服务器', 'SSH 连接、Web 终端、远程文件管理与实时状态'],
  extensions: ['扩展 / 数据库', '清单化安装管理数据库、备份恢复、版本升级与 DbGate'],
  gitsrc: ['Git 源', '登记 GitHub / 自建 Gitea / GitLab，凭据加密保存且不落入仓库配置'],
  docker: ['Docker 管理', '容器 / 镜像 / 卷 / 网络 / 编排模板，非平台容器只读加二次确认'],
  proxy: ['代理配置', '全局 / 分组 / Git Host 规则 / 单项覆盖，四级优先级解析与连通性测试'],
  ai: ['AI 服务配置', 'API 服务、宿主机 / WSL 本地 AI 程序与代理'],
  ops: ['AI 运维', '让 AI 查询状态、分析日志并给出建议'],
};
const MODULE_ICONS = {
  overview: '◈', repos: '⑂', ide: '⌘', storage: '▤',
  builds: '⚙', servers: '▣', extensions: '▦', gitsrc: '⑃', docker: '⬡',
  proxy: '⇄', ai: '✦', ops: '◎',
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
  if (!json.ok) throw new Error(json.error || `请求失败 (${response.status})`);
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
  $$('.nav-item').forEach((b) => b.classList.toggle('active', tab.kind === 'module' && b.dataset.view === tab.module));
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
    const options = sources.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}${s.hasToken ? '' : '（未配置 Token）'}</option>`).join('');
    if ($('#repo-source')) $('#repo-source').innerHTML = options;
    if ($('#clone-source')) $('#clone-source').innerHTML = '<option value="">手动填写地址（不带凭据）</option>' + options;
    const errors = (d.errors || []).map((x) => `${x.label}：${x.error}`).join('；');
    $('#repo-source-hint').textContent = errors
      ? `部分源不可用：${errors}`
      : `已聚合 ${sources.length} 个 Git 源共 ${(d.items || []).length} 个仓库；外部源在「Git 源」页登记`;
    $('#repo-list').innerHTML = table(['仓库', '来源', '描述', '更新时间', '操作'], (d.items || []).map((r) => `
      <tr>
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
      </tr>`));
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
      toast('已填入克隆表单，点击「克隆到工作区」执行');
    }));
    $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('克隆地址已复制'); }
      catch { toast('复制失败，请手动选择', true); }
    }));
    $$('[data-proxy-repo]').forEach((b) => b.addEventListener('click', () => gotoProxyOverride('git', b.dataset.proxyRepo)));
    // 扩展实例的「绑定仓库」也复用这份聚合列表。
    repoState.items = d.items || [];
  } catch (e) {
    $('#repo-list').innerHTML = errorBlock(e.message, '请在「Git 源」页登记可用的仓库服务并配置 Token');
  }
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
  $('#openlist-status-text').textContent = online ? '● 在线' : '● 离线 / 未配置';
  $('#openlist-status-detail').textContent = online
    ? `${status.url} · ${status.version ? `v${status.version} · ` : ''}${status.siteTitle || 'OpenList'} · ${status.storageCount} 个挂载 · 配置来源：${status.source} · 代理：${status.effectiveProxy || '无'}`
    : `${status ? status.url || '' : ''} ${status ? (status.hint || status.error || '') : ''}`;
  $('#openlist-open').href = (status && status.manageUrl) || '#';
  $('#webdav-url').textContent = (status && status.webdav) || '-';
  if (online && !$('#openlist-frame-card').hidden) {
    $('#openlist-frame').src = status.manageUrl;
  }
  const form = $('#openlist-config-form');
  if (form && form.elements.url && !form.elements.url.value) form.elements.url.value = status.url || '';
  if (form && form.elements.user && !form.elements.user.value) form.elements.user.value = status.user || 'admin';
}

function renderBreadcrumb(p) {
  const parts = String(p || '/').split('/').filter(Boolean);
  let acc = '';
  const links = ['<button class="btn btn-ghost btn-sm" data-ol-go="/">根目录</button>'];
  parts.forEach((part) => {
    acc += `/${part}`;
    links.push(`<button class="btn btn-ghost btn-sm" data-ol-go="${esc(acc)}">${esc(part)}</button>`);
  });
  $('#storage-breadcrumb').innerHTML = `<div class="row gap wrap">${links.join('')}</div>`;
  $$('[data-ol-go]').forEach((b) => b.addEventListener('click', () => { currentStoragePath = b.dataset.olGo; loadStorage(); }));
}

function renderFileList(d) {
  storageState.files = d.content || [];
  storageState.selected.clear();
  $('#storage-provider').textContent = `${d.provider || 'OpenList'} · ${d.total || 0} 项${d.write ? '' : ' · 只读'}`;
  $('#file-list').innerHTML = table(['', '名称', '大小', '类型', '修改时间', '操作'], storageState.files.map((f) => {
    const full = olJoin(currentStoragePath, f.name);
    return `<tr>
      <td><input type="checkbox" data-ol-file="${esc(f.name)}" /></td>
      <td>${f.isDir ? '📁' : '📄'} <b>${esc(f.name)}</b></td>
      <td>${f.isDir ? '-' : fmtSize(f.size)}</td>
      <td>${f.isDir ? '目录' : '文件'}</td>
      <td class="muted">${esc(fmtTime(f.modified))}</td>
      <td class="actions"><div class="ext-actions">
        ${f.isDir
          ? `<button class="btn btn-sm" data-ol-enter="${esc(full)}">进入</button>`
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
  $$('[data-ol-enter]').forEach((b) => b.addEventListener('click', () => { currentStoragePath = b.dataset.olEnter; loadStorage(); }));
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
  const [status, files, mounts, drivers] = await Promise.all([
    settled(api('/openlist/status')),
    settled(api(`/openlist/files?path=${encodeURIComponent(currentStoragePath)}`)),
    settled(api('/openlist/storages')),
    settled(api('/openlist/drivers')),
  ]);
  renderOpenlistStatus(status);
  if (files && !files.error) renderFileList(files);
  else $('#file-list').innerHTML = errorBlock(files.error || '无法读取目录',
    '请在上方「连接设置」里填写 OpenList 地址与管理员 Token / 密码，并确认服务已启动');
  renderMountList(mounts && mounts.items || []);
  renderDriverList(drivers && drivers.items || []);
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
  } catch (e) { $('#server-list').innerHTML = `<div class="card">${errorBlock(e.message)}</div>`; }
}

async function checkStatus(id) {
  const box = $(`#metrics-${CSS.escape(id)}`);
  if (box) box.innerHTML = '<div class="muted">读取中…</div>';
  try {
    const s = await api(`/servers/${id}/status`);
    if (!box) return;
    box.innerHTML = `
      <div class="metric"><div class="k">负载 (1m)</div><div class="v">${esc(s.load1)}</div><div class="bar"><i style="width:${Math.min(100, s.load1 * 20)}%"></i></div></div>
      <div class="metric"><div class="k">内存</div><div class="v">${esc(s.memory.usagePct)}%</div><div class="bar"><i style="width:${Math.min(100, s.memory.usagePct)}%"></i></div></div>
      <div class="metric"><div class="k">磁盘</div><div class="v">${esc(s.disk.usagePct)}</div><div class="desc muted">${esc(s.cpuCores)} 核 · ${esc(s.containers.length)} 容器</div></div>`;
  } catch (e) {
    if (box) box.innerHTML = `<div class="muted" style="grid-column:1/-1;color:var(--red)">${esc(e.message)}</div>`;
    toast(e.message, true);
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
        <div class="file-toolbar">
          <button class="btn btn-sm" data-fs="up">↑ 上一级</button>
          <button class="btn btn-sm" data-fs="refresh">刷新</button>
          <input class="fs-path" data-role="fs-path" value="${esc(start)}" placeholder="/data/platform" />
          <button class="btn btn-sm" data-fs="go">跳转</button>
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
  q(pane, 'fs-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tab.ctx.path = e.target.value.trim() || '/';
      loadRemoteFiles(tab);
    }
  });
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
    const input = q(pane, 'fs-path');
    if (input) input.value = data.path;
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
    if (action === 'go') {
      const value = q(pane, 'fs-path').value.trim();
      if (value) { tab.ctx.path = value; await loadRemoteFiles(tab); }
      return;
    }
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

/* ------------------------------ 外部 Git 源 ------------------------------ */

async function loadGitSources() {
  try {
    const d = await api('/git-sources');
    const rows = (d.items || []).map((s) => `<tr>
      <td><b>${esc(s.label)}</b>${s.builtin ? ' ' + badge('内置', 'blue') : ''}<div class="ext-list-url">${esc(s.baseUrl)}</div></td>
      <td>${esc(s.type)}</td>
      <td>${s.hasToken ? badge('已配置', 'green') + `<div class="ext-list-url">${esc(s.tokenMasked)}</div>` : badge('未配置', 'amber')}</td>
      <td><div class="ext-actions">
        <button class="btn btn-sm" data-gitsrc-op="test" data-gitsrc-id="${esc(s.id)}">测试连通</button>
        <button class="btn btn-sm" data-gitsrc-op="repos" data-gitsrc-id="${esc(s.id)}">仓库列表</button>
        ${s.builtin ? '' : `<button class="btn btn-sm btn-danger" data-gitsrc-op="remove" data-gitsrc-id="${esc(s.id)}" data-gitsrc-name="${esc(s.label)}">删除</button>`}
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
      $('#docker-hint').textContent = d.hint || '可在上方切换远程目标';
      ['containers', 'images', 'volumes', 'networks'].forEach((k) => { $(`#docker-${k}`).innerHTML = '<div class="empty">Docker 不可用</div>'; });
      return;
    }
    const c = d.counts || {};
    $('#docker-status').textContent = `Docker ${d.status.version || ''} · ${d.status.endpoint || d.status.mode} · 容器 ${c.containers}（运行 ${c.running} / 平台自建 ${c.owned}）· 镜像 ${c.images} · 卷 ${c.volumes} · 网络 ${c.networks}`;
    $('#docker-hint').textContent = d.policy || '';
    renderDockerContainers();
    renderDockerImages();
    renderDockerVolumes();
    renderDockerNetworks();
    if (dockerState.tab === 'templates') renderDockerTemplates();
    if (dockerState.tab === 'settings') renderDockerSettings();
  } catch (e) {
    $('#docker-status').textContent = `加载失败：${e.message}`;
    $('#docker-containers').innerHTML = errorBlock(e.message);
  }
}

function renderDockerContainers() {
  const d = dockerState.data || {};
  const rows = (d.containers || []).map((c) => {
    const meta = `data-dk-id="${esc(c.id)}" data-dk-owned="${c.owned ? 1 : 0}" data-dk-name="${esc(c.name || '')}"`;
    const ops = [
      `<button class="btn btn-sm" data-dk-op="logs" ${meta}>日志</button>`,
      `<button class="btn btn-sm" data-dk-op="inspect" ${meta}>详情</button>`,
      `<button class="btn btn-sm" data-dk-op="stats" ${meta}>资源</button>`,
      `<button class="btn btn-sm" data-dk-op="proxy" ${meta}>代理</button>`,
    ];
    if (!/running|up/i.test(c.state)) ops.push(`<button class="btn btn-sm" data-dk-op="start" ${meta}>启动</button>`);
    else {
      ops.push(`<button class="btn btn-sm" data-dk-op="stop" ${meta}>停止</button>`);
      ops.push(`<button class="btn btn-sm" data-dk-op="restart" ${meta}>重启</button>`);
    }
    ops.push(`<button class="btn btn-sm btn-danger" data-dk-op="remove" ${meta}>删除</button>`);
    return `<tr>
      <td><b>${esc(c.name || c.id.slice(0, 12))}</b><div class="ext-list-url">${esc(c.image)}</div></td>
      <td>${c.owned ? badge('平台自建', 'blue') : badge('宿主机其它', 'gray')}</td>
      <td>${badge(/running|up/i.test(c.state) ? '运行中' : '已停止', /running|up/i.test(c.state) ? 'green' : 'gray')}<div class="ext-list-url">${esc(c.status)}</div></td>
      <td><div class="ext-list-url">${esc((c.ports || []).join(', ') || '-')}</div></td>
      <td><div class="ext-actions">${ops.join('')}</div></td>
    </tr>`;
  });
  $('#docker-containers').innerHTML = table(['容器', '归属', '状态', '端口', '操作'], rows);
}

function renderDockerImages() {
  const d = dockerState.data || {};
  const rows = (d.images || []).map((i) => `<tr>
    <td><b>${esc((i.tags || []).filter(Boolean).join(', ') || i.repository || i.id.slice(0, 19))}</b><div class="ext-list-url">${esc(i.id.slice(0, 24))}</div></td>
    <td>${typeof i.size === 'number' ? fmtSize(i.size) : esc(i.size || '-')}</td>
    <td class="muted">${esc(fmtTime(i.created))}</td>
    <td><div class="ext-actions">
      <button class="btn btn-sm" data-dk-op="export" data-dk-ref="${esc((i.tags || [])[0] || i.id)}">导出</button>
      <button class="btn btn-sm btn-danger" data-dk-op="rmi" data-dk-ref="${esc((i.tags || [])[0] || i.id)}">删除</button>
    </div></td>
  </tr>`);
  $('#docker-images').innerHTML = table(['镜像', '大小', '创建时间', '操作'], rows);
}

function renderDockerVolumes() {
  const rows = ((dockerState.data || {}).volumes || []).map((v) => `<tr>
    <td><b>${esc(v.name)}</b>${v.owned ? ' ' + badge('平台', 'blue') : ''}</td>
    <td>${esc(v.driver || '-')}</td><td><div class="ext-list-url">${esc(v.mountpoint || '-')}</div></td>
    <td><button class="btn btn-sm btn-danger" data-dk-op="rmvol" data-dk-ref="${esc(v.name)}">删除</button></td>
  </tr>`);
  $('#docker-volumes').innerHTML = table(['存储卷', '驱动', '挂载点', '操作'], rows);
}

function renderDockerNetworks() {
  const rows = ((dockerState.data || {}).networks || []).map((n) => `<tr>
    <td><b>${esc(n.name)}</b></td><td>${esc(n.driver)}</td><td>${esc(n.scope || '-')}</td>
    <td><button class="btn btn-sm btn-danger" data-dk-op="rmnet" data-dk-ref="${esc(n.id || n.name)}">删除</button></td>
  </tr>`);
  $('#docker-networks').innerHTML = table(['网络', '驱动', '作用域', '操作'], rows);
}

async function renderDockerTemplates() {
  try {
    const [tpl, audit] = await Promise.all([api('/docker/templates'), api('/docker/audit')]);
    $('#docker-templates').innerHTML = table(['模板', '行数', '说明', '更新时间', '操作'], (tpl.items || []).map((t) => `<tr>
      <td><b>${esc(t.name)}</b></td><td>${t.lines}</td><td>${esc(t.description || '-')}</td>
      <td class="muted">${esc(fmtTime(t.updatedAt))}</td>
      <td><button class="btn btn-sm btn-danger" data-dk-op="rmtpl" data-dk-ref="${esc(t.id)}">删除</button></td>
    </tr>`));
    $('#docker-audit').innerHTML = table(['时间', '操作', '目标', '对象', '确认'], (audit.items || []).map((a) => `<tr>
      <td class="muted">${esc(fmtTime(a.at))}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td>
      <td>${esc(a.object)}</td><td>${a.confirmed ? '是' : '否'}</td>
    </tr>`));
  } catch (e) { toast(e.message, true); }
}

function renderDockerSettings() {
  const d = dockerState.data || {};
  $('#docker-settings').textContent = JSON.stringify({
    target: d.target, status: d.status, counts: d.counts,
    policy: d.policy,
    importDir: 'data/images/（本机大镜像放这里，用「服务器上已有路径」导入）',
    remoteTmp: '远程镜像 tar 直接填服务器上的绝对路径',
  }, null, 2);
  renderDockerTemplates();
}

function switchDockerTab(tab) {
  dockerState.tab = tab;
  $$('.docker-tab').forEach((b) => b.classList.toggle('active', b.dataset.dockerTab === tab));
  $$('.docker-panel').forEach((p) => { p.hidden = p.id !== `docker-panel-${tab}`; });
  if (tab === 'templates' || tab === 'settings') renderDockerTemplates();
  if (tab === 'settings') renderDockerSettings();
}

/* -------------------------------- 事件绑定 ------------------------------- */

const loaders = {
  overview: loadOverview, repos: loadRepos, ide: loadIde, storage: loadStorage,
  builds: loadBuilds, servers: loadServers, extensions: loadExtensions,
  gitsrc: loadGitSources, docker: loadDocker, proxy: loadProxy,
  dbgate: loadExtExtras, backups: loadExtExtras,
  ai: loadAI, ops: loadOps,
};

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

$('#gitsrc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/git-sources', { method: 'POST', body: formData(e.target) });
    toast('Git 源已登记，仓库列表会自动聚合');
    e.target.reset();
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
    if (op === 'test') {
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
  switchView('repos');
  toast('已填入克隆表单，点击「克隆到工作区」执行');
});

/* ------------------------------ Docker 管理 ----------------------------- */

$('#docker-target').addEventListener('change', (e) => {
  dockerState.target = e.target.value || 'local';
  loadDocker();
});
$('#docker-tabbar').addEventListener('click', (e) => {
  const button = e.target.closest('[data-docker-tab]');
  if (button) switchDockerTab(button.dataset.dockerTab);
});
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

$('#view-docker').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-dk-op]');
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
  try {
    toast('正在拉取镜像，请稍候…');
    await api('/docker/images/pull', { method: 'POST', body: { ...body, target: dockerState.target } });
    toast(`镜像 ${body.image}:${body.tag || 'latest'} 已拉取`);
    e.target.reset();
    await loadDocker();
  } catch (err) { toast(err.message || String(err), true); }
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

$('#clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const d = await api('/repos/clone', { method: 'POST', body: formData(e.target) }); toast(`已克隆到 ${d.path}`); loadRepos(); }
  catch (err) { toast(err.message, true); }
});

$('#ide-open').addEventListener('click', openIde);

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
$('#openlist-config-toggle').addEventListener('click', () => {
  const form = $('#openlist-config-form');
  form.hidden = !form.hidden;
  if (!form.hidden && storageState.connection) {
    form.elements.url.value = storageState.connection.url || '';
    form.elements.user.value = storageState.connection.user || 'admin';
  }
});
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
  try {
    await api('/openlist/connection', { method: 'PUT', body: formData(e.target) });
    e.target.elements.token.value = '';
    e.target.elements.password.value = '';
    toast('连接已保存，正在重新检测'); loadStorage();
  } catch (err) { toast(err.message, true); }
});
$('#openlist-config-reset').addEventListener('click', async () => {
  if (!confirm('恢复使用 .env / 环境变量里的 OpenList 配置？')) return;
  try { await api('/openlist/connection/reset', { method: 'POST', body: {} }); toast('已恢复环境配置'); loadStorage(); }
  catch (err) { toast(err.message, true); }
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
})();
