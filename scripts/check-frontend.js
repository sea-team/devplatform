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
const catalog = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'catalog.js'), 'utf8');
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
// v0.3.11：新增「IDE 配置」主模块页（有自己的侧栏入口），总数 27 → 28。
note(sections.length === 28 && sections.includes('gitsrc') && sections.includes('docker')
  && sections.includes('proxy') && sections.includes('environment') && sections.includes('envcfg')
  && sections.includes('ide-config') && SUBPAGES.every((v) => sections.includes(v)),
'28 个独立页面（15 主模块 + 13 个子功能页）均已转为可标签化的 .page', sections.join(', '));
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

// v0.3.3：克隆前可见的 Git 运行时状态、路径配置、兜底开关与执行通道提示。
note(['id="git-runtime-status"', 'id="git-runtime-form"', 'id="git-runtime-bin"',
  'id="git-runtime-fallback"', 'id="git-runtime-refresh"', 'spawn git ENOENT',
  'HOST_WORKSPACE_DIR'].every((s) => html.includes(s)),
'Git 运行时状态卡片、路径配置与 ENOENT 说明已加入克隆页');
note(['function loadGitRuntime', "/git/runtime'", '/git/runtime/refresh',
  'd.channelLabel', 'loadGitRuntime().catch'].every((s) => app.includes(s)),
'Git 运行时诊断 / 保存 / 重新检测接口与克隆通道提示已接线');
note(html.includes('?v=20261111f'), '静态资源版本已升到 20261111f');

// v0.3.10：IDE 登录凭据、总览运行主机卡片、仓库文件 / 终端 / Git 操作。
note(html.includes('id="ide-cred"') && html.includes('id="ide-cred-reveal"')
  && html.includes('id="host-info-body"') && html.includes('id="repo-git-modal"')
  && app.includes('revealIdePassword') && app.includes('loadHostInfo')
  && app.includes('openRepoGitModal') && app.includes('data-repo-files'),
'IDE 登录凭据、总览运行主机卡片与仓库 Git 操作弹窗已接线');
note(app.includes("api('/repos/git'") && app.includes("api('/host-info")
  && app.includes('openFilesTab(ctx.server') && app.includes('openTerminalTab(ctx.server')
  && app.includes('initialCommand'),
'工作区仓库可直接打开文件管理 / 终端，并经白名单接口执行 Git 命令');

// v0.3.11：布局修复、排序分组、文件编辑、Compose 富编辑器、服务器编辑、DbGate 账号、IDE 拆页。
note(css.includes('.ws-body > .pathbar-slot') && css.includes('td.actions { display: table-cell; }')
  && css.includes('#view-docker-containers .dk-ops'),
'远程文件管理路径条间距与容器操作列布局已修复');
note(app.includes('function sortFileItems') && app.includes('data-ol-sort') && app.includes('data-fs-sort')
  && app.includes('class="file-group"') && css.includes('th.sortable'),
'两处文件列表均支持名称 / 大小 / 类型 / 修改时间排序与目录分组图标');
note(html.includes('id="ol-editor-modal"') && html.includes('id="docker-tpl-height"')
  && app.includes('/openlist/files/content') && app.includes('function ensureComposeEditor')
  && app.includes('function formatComposeYaml'),
'OpenList 文件编辑弹窗与 Compose YAML 富编辑器 / 高度 / 格式整理已接线');
note(html.includes('id="server-edit-id"') && app.includes('data-edit-server')
  && app.includes('function fillServerEditForm') && app.includes('function resetServerEditForm'),
'服务器卡片支持编辑并复用添加表单（凭据脱敏沿用）');
note(catalog.includes("LOGIN: '${USER}'") && app.includes('data-ext-op="credentials"')
  && html.includes('id="ext-cred-modal"') && app.includes('/credentials'),
'DbGate 登录账号可在安装时填写，实例可查看凭据');
note(html.includes('id="view-ide-config"') && html.includes('id="ide-browse"')
  && html.includes('id="ide-dir-modal"') && app.includes('/ide/dirs')
  && app.includes('function openIdeDirPicker') && app.includes("'ide-config': loadIde"),
'在线 IDE 拆成工作台与配置两页，项目目录可浏览选择');
// 附带修复：官方镜像的 tag 冒号不能被当成 registry 端口，否则构建容器永远找不到镜像。
const { resolveImage } = require('../platform/src/core');
note(resolveImage('node:22-bookworm', 'docker.m.daocloud.io/library/') === 'docker.m.daocloud.io/library/node:22-bookworm'
  && resolveImage('ghcr.io/a/b', 'docker.m.daocloud.io/') === 'ghcr.io/a/b'
  && resolveImage('dbgate/dbgate', 'docker.m.daocloud.io/library/') === 'docker.m.daocloud.io/dbgate/dbgate',
'镜像前缀拼接：tag 冒号不误判为 registry 端口，第三方仓库仍原样保留');

// v0.3.9：宿主机 Git 实测结果在运行时卡片与环境体检中可见。
note(app.includes('const hg = d.hostGit || {}') && app.includes("kv('宿主机 Git'")
  && app.includes('hostProbeLine') && app.includes('eff.verified'),
'Git 运行时卡片展示宿主机 Git、生效 Git、工作区可写与 SSH 探测明细');

// v0.3.8：TLS 忽略参数 + .env 平台化管理 + 诊断联动配置指引。
note(html.includes('id="gitsrc-insecure"') && html.includes('id="gitsrc-tls-note"')
  && html.includes('name="insecure"') && app.includes('syncGitSourceTlsNote')
  && app.includes('s.insecure || \'auto\''),
'Git 源弹窗与克隆表单均有三态 TLS 校验开关，编辑可回填');
note(html.includes('id="view-envcfg"') && html.includes('id="envcfg-list"')
  && html.includes('id="envcfg-advice"') && app.includes("api('/env-config'")
  && app.includes('function loadEnvConfig') && app.includes('envcfg: loadEnvConfig'),
'环境配置页具备白名单读取、写入与建议片段渲染链路');
note(app.includes('function openEnvConfig') && app.includes('data-repo-fix="envcfg"')
  && app.includes('data-ext-env') && app.includes('envcfgFillAdvice'),
'Git 源证书错误与扩展体检结论可一键跳到 env 配置并预填建议值');
note(html.includes('DP_TLS_INSECURE_HOSTS') && html.includes('id="envcfg-save"')
  && css.includes('.envcfg-advice-card') && css.includes('.envcfg-focus'),
'TLS / 扩展地址的 env 提示文案与配置页样式齐全');

// v0.3.7：Git 源弹窗、运行时检测明细、工作区仓库、扩展体检、表单控件统一排版。
note(html.includes('id="gitsrc-modal"') && html.includes('id="gitsrc-add"')
  && html.includes('data-gitsrc-close') && app.includes('function openGitSourceModal')
  && app.includes('closeGitSourceModal()'),
'Git 源登记与编辑共用弹窗，含新增入口 / 遮罩 / ESC 关闭链路');
note(app.includes('git-probe-list') && app.includes('function refreshGitRuntime')
  && app.includes("d.tried") && app.includes('data-git-probe'),
'Git 运行时展示可执行文件探测明细与明确检测反馈');
note(app.includes('r.isLocal') && app.includes('data-repo-fix')
  && app.includes('工作区') && html.includes('id="repo-source-hint"'),
'仓库列表展示工作区本地仓库并把源故障拆成可操作提示');
note(html.includes('id="ext-diagnose-btn"') && html.includes('id="ext-diagnose"')
  && app.includes('/extensions/diagnose') && app.includes('data-ext-rebuild'),
'扩展一键体检与异常实例一键重建入口齐全');
note(html.includes('dk-pref') && css.includes('.grid-2 > label:not(.check)')
  && css.includes('.dk-pref > label'),
'面板偏好与 .form 外标签统一为「标签在上、控件在下」排版');

// v0.3.6：Git 源编辑、路径条、服务器轮询、409 冲突提示与 Docker 分区接线。
note(html.includes('id="gitsrc-cancel"') && html.includes('id="gitsrc-form-title"')
  && app.includes('data-gitsrc-op="edit"') && app.includes("method: 'PUT'"),
'外部 Git 源具备编辑态与 PUT 更新链路');
note(html.includes('id="storage-breadcrumb"') && html.includes('id="server-poll-interval"')
  && html.includes('id="clone-conflict"'),
'宝塔式路径条、服务器自动刷新控件与克隆冲突提示区齐全');
note(html.includes('id="docker-owned-only"') && html.includes('id="docker-copy-diag"')
  && html.includes('data-dk-tpl="lnmp"') && html.includes('id="docker-image-prefix"'),
'Docker 六分区的筛选 / 设置 / 模板库 / 镜像源控件齐全');
note(app.includes('function pathBarHtml') && app.includes('function bindPathBar')
  && app.includes('data-ol-dir') && app.includes('dblclick') && app.includes('fs-pathbar'),
'本地文件浏览与远程文件管理共用路径条、目录双击进入');
note(app.includes('restartServerPolling') && app.includes('serverPollTick')
  && app.includes('hideInput(true)'),
'服务器状态定时刷新与路径条回车确认已接线');
note(app.includes("status === 409 ? '操作冲突'") && app.includes('clone-conflict'),
'409 操作冲突有专门分类与常驻提示，不再显示成 500');
note(app.includes('resolveImage') === false && app.includes('imagePrefix'),
'镜像加速前缀在设置页与镜像页可见');

// v0.3.4：环境适配中心（自动识别 / 体检 / 自动处置 / 档案切换）。
note(sections.includes('environment') && html.includes('data-view="environment"')
  && ['env-summary', 'env-config-form', 'env-checks', 'env-history', 'env-overrides', 'env-profile-list']
    .every((id) => html.includes(`id="${id}"`)),
'环境适配独立页：环境摘要、策略表单、体检结果、处置日志与环境声明齐全');
note(['/environment/check', '/environment/heal', '/environment/config', '/environment/switch',
  '/environment/profiles'].every((s) => app.includes(s))
  && app.includes('function loadEnvironment') && app.includes('function renderEnvironment')
  && app.includes('environment: loadEnvironment')
  && html.includes('data-open-view="environment"'),
'环境体检 / 自动处置 / 策略保存 / 档案切换 / 自定义档案接口全部接线');
note(html.includes('DP_ENV_PROFILE=container-lite') && html.includes('环境指纹变化会自动触发体检')
  && html.includes('id="git-runtime-env"') && app.includes("api('/environment')"),
'克隆页 Git 卡片联动环境档案，界面写明换环境固定策略的方法');

// v0.3.5：上游服务不可用时前端展示降级提示，并把 4xx / 502 与 500 区分开。
note(html.includes('id="storage-degraded"') && app.includes('function renderStorageDegraded')
  && app.includes('renderStorageDegraded([files, mounts, drivers])')
  && app.includes('data-open-view="storage-conn"'),
'存储页有降级提示区：列表置空 + 修复建议 + 直达连接管理');
note(app.includes("status === 502 ? '上游服务不可用'") && app.includes('err.status = status')
  && app.includes('err.hint = json.hint') && app.includes('json.error'),
'api() 按 400 / 404 / 502 / 500 分类错误并保留 hint，不再统一显示 500');

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
