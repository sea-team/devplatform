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
const envcfg = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'envConfig.js'), 'utf8');
const authSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'auth.js'), 'utf8');
const permSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'permissions.js'), 'utf8');
const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'server.js'), 'utf8');
const coreSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'core.js'), 'utf8');
const engineSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'engine.js'), 'utf8');
const sessionsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'aiSessions.js'), 'utf8');
const dshSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dshTerminal.js'), 'utf8');
const aiChatSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'aiChat.js'), 'utf8');
const miniSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'mini.js'), 'utf8');
const remoteSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'remoteOps.js'), 'utf8');
const openlistSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'openlist.js'), 'utf8');
const integrationsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'integrations.js'), 'utf8');
const workspaceGitSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'workspaceGit.js'), 'utf8');
const gitSourcesSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'gitSources.js'), 'utf8');
const credsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'serviceCredentials.js'), 'utf8');
const userDirsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'userDirs.js'), 'utf8');
const archiveSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'archive.js'), 'utf8');
const repoImporterSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'repoImporter.js'), 'utf8');
const nativeSrc = fs.readFileSync(path.resolve(__dirname, '..', 'windows', 'native-services.ps1'), 'utf8');
const errors = [];
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (!ok) errors.push(label);
};

/* --------------------------- 1. 静态一致性 --------------------------- */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const refs = [...new Set([...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
// 这些 id 由 JS 运行时动态注入（附件预览 / 会话 pending 气泡 / 2FA 弹窗按钮 / 登录提示）。
const RUNTIME_IDS = new Set(['ops-hint', 'ops-pending', 'ach-pending', 'security-disable', 'security-enable']);
const missing = refs.filter((id) => !ids.has(id) && !RUNTIME_IDS.has(id));
note(missing.length === 0, 'app.js 引用的静态 id 均存在', missing.length ? `缺失：${missing.join(', ')}` : `${refs.length} 个引用`);

const sections = [...html.matchAll(/class="page" id="view-([a-z0-9-]+)"/g)].map((m) => m[1]);
const SUBPAGES = ['repo-new', 'repo-clone', 'git-runtime', 'storage-conn', 'storage-mounts', 'storage-drivers',
  'build-start', 'deploys', 'server-new', 'docker-containers', 'docker-images',
  'docker-volumes', 'docker-networks', 'docker-compose', 'ai-list', 'ai-test'];
// v0.4.10：新增「AI 会话」独立页，总页面数 32 -> 33（AI 运维保留、二者并存）。
note(sections.length === 33 && sections.includes('gitsrc') && sections.includes('docker')
  && sections.includes('proxy') && sections.includes('environment') && sections.includes('envcfg')
  && sections.includes('ide-config') && sections.includes('users') && sections.includes('git-runtime')
  && sections.includes('aichat') && sections.includes('ops')
  && !sections.includes('collab') && SUBPAGES.every((v) => sections.includes(v)),
'33 个独立页面（AI 运维 + AI 会话两页并存；资源协作页已下线）均已转为可标签化的 .page', sections.join(', '));
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
note(['data-dk-op="proxy"', 'data-server-proxy', 'data-ai-proxy']
  .every((s) => app.includes(s)) && !app.includes('data-proxy-repo')
  && app.includes('function gotoProxyOverride')
  && app.includes('function openObjectProxy') && html.includes('id="object-proxy-modal"')
  && html.includes('id="collab-inline-repoAcl"')
  && !html.includes('id="proxy-override-form"'),
'代理覆盖弹窗：服务器/Docker/AI 行上打开，仓库代理改在「编辑」弹窗内（列表不再显示代理按钮）');

// v0.4.4：代理页只保留覆盖清单与说明，配置入口下沉到对象。
note(html.includes('单项代理覆盖清单') && html.includes('不在本页填写')
  && html.includes('id="proxy-overrides"') && app.includes('function saveObjectProxy'),
'代理页只汇总 / 清理单项覆盖，填写入口已下沉到对应对象');
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
// 发布时只需改这个常量；断言同时保证 index.html 内所有静态资源用同一个戳，避免新旧缓存混用。
const CACHE_STAMP = '20261120a';
const stamps = [...new Set([...html.matchAll(/\?v=(\d{8}[a-z])/g)].map((m) => m[1]))];
note(stamps.length === 1 && stamps[0] === CACHE_STAMP, `静态资源版本已升到 ${CACHE_STAMP}`);

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

/* ---- v0.4.22：9 项状态 / 体验类前端 bug 的回归护栏 ---- */
note(app.includes('let storageLoadSeq = 0') && app.includes('const seq = ++storageLoadSeq')
  && app.includes('if (seq !== storageLoadSeq) return;') && app.includes('const pathSnapshot = currentStoragePath'),
'#1 存储列表请求序号：晚到响应被丢弃，防止列表/路径错配导致误删');
note(app.includes('if (logTimer) { clearInterval(logTimer); logTimer = null; }'),
'#2 watchLog 切换时 clearInterval 后置 null，日志定时刷新不失效');
note(app.includes("addEventListener('closed'") && app.includes('c.source.close(); } catch { /* noop */ } c.source = null;'),
'#3 终端 SSE closed 时 close() 并置 null，防止后端 200 结束流后自动重连刷屏');
note(app.includes("if (selectAll) selectAll.checked = false;"),
'#4 文件列表重建时复位全选复选框');
note(/aiChatState\.sending = true;[\s\S]{0,120}if \(!aiChatState\.currentId\)/.test(app)
  && app.includes('} catch (e) { aiChatState.sending = false; toast(e.message, true); return; }'),
'#5 AI 会话发送锁在首个 await 前置位，防双击建双会话');
note(app.includes('const prevBackend = $(\'#build-backend\').value')
  && app.includes('const prevServer = $(\'#deploy-server\').value')
  && app.includes('for (const o of $(\'#deploy-server\').options)'),
'#6 刷新构建列表时保留已选编译环境 / 目标服务器');
note(!app.includes('badge(esc(') && app.includes('badge(r.sourceLabel,'),
'#7 badge 不再双层转义（badge 内置 esc，调用处不重复）');
note(app.includes("$('#repo-list') ? $$('#repo-list [data-copy]') : []"),
'#8 data-copy 仅绑定仓库列表内按钮，不误抓模板弹窗的复制 JSON');
note((app.match(/if \(!response\.ok\) throw new Error\(`服务端返回 HTTP \$\{response\.status\}/g) || []).length >= 3,
'#9 三处裸 fetch 上传先查 response.ok 再解析 JSON');
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

// ADMIN_TOKEN 作用 / 影响 / 启用步骤的说明闭环（说明补全，不改版本号）。
note(html.includes('id="envcfg-auth-card"') && html.includes('id="envcfg-auth-state"')
  && html.includes('id="envcfg-gen-token"') && html.includes('Authorization: Bearer')
  && app.includes('renderEnvcfgAuthState') && app.includes('generateAdminToken')
  && app.includes('envcfg-detail') && css.includes('.envcfg-auth-grid'),
'环境配置页有 ADMIN_TOKEN 鉴权说明卡片、启用状态、行内详细说明与随机令牌生成入口');
note(envcfg.includes('AUTH_DISABLED') && envcfg.includes('authEnabled')
  && envcfg.includes('detail:') && envcfg.includes('ADMIN_TOKEN 不能含空格')
  && app.includes('renderEnvcfgAuthState(d.security)'),
'后端 env-config 回传鉴权布尔状态、详细说明与未启用时的置顶建议（不泄露令牌）');

// v0.4.0：账号体系（登录、owner 隔离、协作者、全局配置只读）。
note(html.includes('id="login-view"') && html.includes('id="login-form"')
  && html.includes('id="password-form"') && html.includes('id="auth-wrap"')
  && app.includes('async function startWorkbench') && app.includes("fetch('/api/auth/status'")
  // boot 用原生 fetch，须把 localStorage.dp_token 带上，否则令牌通道会被误判为未登录、工作台不启动。
  && app.includes("localStorage.getItem('dp_token')") && app.includes('Bearer ${token}')
  && app.includes("authFetch('/auth/login'") && css.includes('.login-view[hidden]'),
'未登录遮罩、首次改密、登录状态检查与工作台延迟启动链路齐全');

// 深度审计回归护栏：以下每一条都对应一个实测可复现的真实缺陷。
note(miniSrc.includes('非法请求路径编码') && miniSrc.includes('try { pathname = decodeURIComponent')
  && !miniSrc.includes('params[key] = decodeURIComponent')
  && miniSrc.includes('if (authGate && !authGate.isPublic(pathname)'),
'畸形 URL 编码收敛为 400、路由参数不再二次解码、未登录写请求不再跳过鉴权');
note(authSrc.includes("['GET', 'HEAD'].includes") && permSrc.includes('越权收口')
  && permSrc.includes('body.deploy.serverId') && permSrc.includes('findResourceById(targetId)')
  && permSrc.includes('body.reveal !== true')
  && permSrc.includes('普通用户能登记并启用自己的 OpenList'),
'optional 模式仅匿名只读、嵌套部署目标参与鉴权、OpenList 权限下沉到对象归属');
note(openlistSrc.includes('s.openlistActiveId = item.id') && app.includes('idePlainAllowed')
  && app.includes('ideCredRevealBtn'),
'普通用户登记 OpenList 后立即设为当前、IDE 明文入口按角色隐藏');
note(openlistSrc.includes('Object.entries(d)') && integrationsSrc.includes('?id=${encodeURIComponent(id)}'),
'OpenList 驱动字典能转成下拉选项、挂载删除/启停把 id 放进 query（上游 strconv.Atoi 要求）');
note(coreSrc.includes('openlistMountOwners: {}') && openlistSrc.includes('function recordMountOwner')
  && openlistSrc.includes('function assertMountOwner') && openlistSrc.includes('function visibleStorages')
  && openlistSrc.includes('function filterRootContent')
  && serverSrc.includes('openlist.listStorages(req.user)')
  && permSrc.includes('function fileWriteScopeAllows') && permSrc.includes('mountFileScopeAllows')
  && app.includes('m.ownerName'),
'OpenList 服务保持全局单例，挂载按账号隔离（归属表 / 列表 / 写操作 / 根目录文件 / 管理员标注创建者）');
note(openlistSrc.includes('currentStorageState') && openlistSrc.includes('unchanged: true')
  && openlistSrc.includes('payload.disabled = Boolean(current.disabled)')
  && openlistSrc.includes('have (enabled|disabled)')
  && serverSrc.includes('items.map((x) => ({ ...x, mount_path: x.mountPath }))'),
'挂载启停幂等不再误报 502、编辑保留停用状态、兼容 /api/storage/mounts 同步归一化过滤');
note(html.includes('id="svc-credentials"') && html.includes('id="svc-cred-list"')
  && html.includes('id="svc-cred-refresh"') && app.includes('function loadServiceCredentials')
  && app.includes('function renderServiceCredentials') && app.includes('data-svc-cred-save')
  && app.includes('data-svc-cred-mode-save') && app.includes('/services/credentials/reveal'),
'集成服务账号 / 口令面板已接线（查看 / 复制 / 改密 / IDE 访问模式切换，明文仅管理员）');
note(credsSrc.includes('admin user change-password') && credsSrc.includes("['admin', 'set', password]")
  && credsSrc.includes('refreshOpenlistToken') && credsSrc.includes('openlistApi.resetToken()')
  && credsSrc.includes('serviceSetup.applyServiceEnv()') && credsSrc.includes('ensureGenerated')
  && envcfg.includes('GITEA_ADMIN_PASSWORD') && envcfg.includes('IDE_ACCESS_MODE')
  && serverSrc.includes("app.put('/api/services/credentials'")
  && permSrc.includes('集成服务账号 / 口令（明文与写操作仅管理员）'),
'改口令先同步上游 Gitea / OpenList 再写 .env、刷新令牌与连接对象；安装时自动补齐账号 / 口令白名单');
note(serverSrc.includes('serviceCredentials.ideNative()') && serverSrc.includes('abs.replace(/\\\\/g,')
  && serverSrc.includes('modeLabel') && app.includes('a.modeLabel')
  && html.includes('id="ide-frame"') && html.includes('frame-ancestors')
  && nativeSrc.includes('Stop-IdeTree') && nativeSrc.includes('restart-ide')
  && nativeSrc.includes('--connection-token-file'),
'IDE 不再按容器模型误导：本机路径打开、免密语义、跨端口禁嵌入说明、重启清理 fork 进程树');
note(remoteSrc.includes('canUseTerminal') && serverSrc.includes('remoteOps.activeTerminals(req.user)'),
'SSH 终端会话按 ownerId 隔离（stream / input / resize / close / 列表逐入口校验）');
note(app.includes('function invalidateSession') && app.includes('function stopBackgroundPolling')
  && app.includes('json.ok !== true') && app.includes("localStorage.removeItem('dp_token')")
  && app.includes('if (!reachable)'),
'会话失效不打断 2FA、登出清理令牌与标签、非 JSON 响应不再误判成功');
// v0.4.7：启动构建目录浏览、文件浏览新建文件 / AI 会话 / 图标操作列、内嵌后台同源代理、驱动清单可操作化。
note(html.includes('id="build-path-browse"') && html.includes('id="build-repo-path"')
  && app.includes("openIdeDirPicker('build-repo-path')") && app.includes('dirPickerTarget'),
'启动构建项目目录支持浏览选择（复用工作区目录选择器，IDE / 构建部署共用）');
note(html.includes('id="newfile-form"') && html.includes('id="ol-ai-session"')
  && app.includes('ACT_ICONS') && app.includes('icon-btn')
  && app.includes("#newfile-form').addEventListener") && app.includes("#ol-ai-session').addEventListener")
  && app.includes("/openlist/files/content', { method: 'PUT'") && css.includes('.icon-btn'),
'文件浏览新增新建文件 / AI 会话入口，操作列改图标按钮不再换行错位');
note(app.includes("'/api/openlist/admin'") && serverSrc.includes("app.get('/api/openlist/admin'")
  && serverSrc.includes('proxyOpenlistApi') && serverSrc.includes('localStorage.setItem')
  && openlistSrc.includes('getToken: () => openlistApi.token()') && miniSrc.includes('starCount'),
'内嵌后台走同源代理自动登录（注入 token、代理 assets / api、通配路由支持）');
note(app.includes('data-ol-driver-template') && app.includes('function showDriverTemplate')
  && app.includes("switchView('storage-mounts')") && html.includes('点「模板」可查看'),
'驱动清单可操作化：选用自动跳挂载页带入模板、模板按钮可复制 / 带入表单');
note(html.includes('id="view-users"') && html.includes('id="collab-modal"')
  && html.includes('id="collab-inline-servers"') && html.includes('id="collab-inline-aiProviders"')
  && app.includes('users: loadUsers') && app.includes('function renderCollabInline')
  && app.includes('function saveCollabInline') && app.includes('data-collab-open=')
  && app.includes("api('/collaborators'") && !app.includes('loadCollabResources'),
'账号管理页 + 对象表单内嵌协作者 + 单对象弹窗均已接线（资源协作页已下线）');
note(authSrc.includes('scryptSync') && authSrc.includes('initial-admin.txt')
  && authSrc.includes('dp_session') && permSrc.includes('function guard')
  && permSrc.includes('collaborators') && serverSrc.includes('filterResponse')
  && serverSrc.includes('authGate'),
'后端密码哈希 / 会话 / 请求守卫 / 响应过滤 / 协作者链路齐全');

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

/* ---------------------- v0.4.3 四项改造自检 ---------------------- */
// 1) AI 服务配置拆成三个独立页 + subnav。
note(['id="view-ai"', 'id="view-ai-list"', 'id="view-ai-test"'].every((s) => html.includes(s))
  && ['data-open-view="ai"', 'data-open-view="ai-list"', 'data-open-view="ai-test"']
    .every((s) => html.includes(s))
  && app.includes("'ai-list': loadAI") && app.includes("'ai-test': loadAI")
  && app.includes("'ai-list': 'ai'") && app.includes('function fillProviderSelects')
  && app.includes("switchView('ai-list')"),
'AI 服务配置拆成「配置 / 已配置服务 / 连通性测试」三个独立子页并共享 subnav');

// v0.4.11：AI 服务配置改名 AI 模型配置；配置页支持获取可用模型并维护模型目录。
note(html.includes('AI 模型配置') && html.includes('class="model-catalog"')
  && html.includes('id="model-rows"') && html.includes('id="model-fetch"')
  && html.includes('id="model-add"') && html.includes('id="model-restore"')
  && app.includes('function renderProviderModelRows') && app.includes('function loadProviderModels')
  && app.includes('/ai/models/fetch') && app.includes('function syncModelCatalogToForm'),
'AI 模型配置：表单含模型目录（显示名 / 模型 ID），支持「获取可用模型」拉取上游 /models');

// v0.4.15 A 批：仓库级协作者 + 目录对象（可归属 / 可协作），复用 collaborators 体系。
note(coreSrc.includes("'repoAcl', 'directories'") && coreSrc.includes('repoAcl: []')
  && serverSrc.includes('permission.ensureAclRecord')===false && serverSrc.includes('permissions.ensureAclRecord')
  && permSrc.includes("repoAcl: '仓库', directories: '目录'")
  && permSrc.includes("item.aclKind === 'repo' && action === 'read'")
  && app.includes('data-collab-open="repoAcl|'),
'仓库级协作者 + 目录对象：repoAcl/directories 归属集合、懒建归属、仓库 read 放宽、列表协作者按钮');

// v0.4.16 B 批①：Git 写操作白名单 + 破坏性命令 + 仓库级写权限校验。
note(workspaceGitSrc.includes("'add', 'commit', 'push', 'merge', 'revert', 'reset', 'restore', 'stash', 'checkout'")
  && workspaceGitSrc.includes('DESTRUCTIVE_COMMANDS') && workspaceGitSrc.includes('needMessage: true')
  && serverSrc.includes('workspaceGit.WRITE_COMMANDS.has(cmd)') && serverSrc.includes("permissions.assertCan(req.user, acl, 'write')")
  && app.includes('破坏性 Git 操作确认') && app.includes('needMessage') && app.includes('needHash'),
'Git 写操作：commit/push/merge-abort/revert/reset 等白名单 + 破坏性二次确认 + 仓库级写权限校验');

// v0.4.16 B 批②：新建仓库内联凭据/代理/TLS + 自动克隆工作区；列表去代理按钮、IDE 直达。
note(gitSourcesSrc.includes('function effectiveSource') && gitSourcesSrc.includes('autoWorkspace')
  && gitSourcesSrc.includes('repo.workspace = await cloneRepo') && gitSourcesSrc.includes('repo.workspaceError')
  && app.includes('function openRepoIdeDirect') && app.includes('data-ide-direct')
  && app.includes('syncRepoAuthFields') && !app.includes('data-proxy-repo')
  && html.includes('name="autoWorkspace"') && html.includes('id="repo-git-message"'),
'新建仓库内联凭据/代理/TLS + 自动克隆工作区；列表去代理按钮、IDE 直达、Git 提交/还原输入');

// v0.4.17①：IDE 直达免密 —— 服务端代登录 code-server 并透传会话 Cookie。
note(serverSrc.includes('async function ideAutoLoginCookie') && serverSrc.includes('code-server-session=')
  && serverSrc.includes("res.setHeader('Set-Cookie', cookie)") && serverSrc.includes('autoLogin'),
'IDE 直达免密：POST /api/ide/open 代登录 code-server 透传会话 Cookie，失败降级');

// v0.4.17② C 批：建账号自动建 OpenList 家目录 + 完整路径前缀隔离 + 目录协作。
note(userDirsSrc.includes('async function provision') && userDirsSrc.includes('function allowsPath')
  && userDirsSrc.includes('function canWritePath') && userDirsSrc.includes('HOME_ROOT')
  && serverSrc.includes("await userDirs.provision(user)") && serverSrc.includes("'/api/user-dirs'")
  && permSrc.includes('userDirs.allowsPath(user, dir)') && permSrc.includes('userDirs.canWritePath(user, d)')
  && permSrc.includes("/api\\/openlist\\/admin\\/api") && openlistSrc.includes("dir === userDirs.HOME_ROOT")
  && userDirsSrc.includes("HOME_ROOT = '/workspace/users'")
  && app.includes('data-collab-open="directories|') && app.includes('/user-dirs')
  && app.includes('storageHomeInit'),
'C 批：建账号建家目录 + 完整路径前缀隔离（read 协作者只读）+ 目录协作按钮 + admin 代理写收口 + 默认进家目录');

// v0.4.18 D 批：AI 运维 / 会话按服务器 read 权限过滤（后端防线在 engine.scopedServers）。
note(engineSrc.includes("const permissions = require('./permissions')")
  && engineSrc.includes('function scopedServers(serverIds, user)')
  && engineSrc.includes('permissions.visible(user || null, all)')
  && engineSrc.includes('async function opsAgent({ providerId, prompt, allowWrite = false, history = [], attachments = [], serverIds, user })')
  && engineSrc.includes('const servers = scopedServers(serverIds, user)')
  && sessionsSrc.includes('function constrainScope(user, scope)')
  && sessionsSrc.includes('user, // D 批：AI 链路按服务器 read 权限收敛')
  && serverSrc.includes("user: req.user, // D 批：直调入口同样按服务器 read 权限收敛")
  && engineSrc.includes('你有权限访问的全部已登记服务器'),
'D 批：AI 服务器范围经 permissions.visible 收敛（伪造/越权 id 裁掉），opsAgent 两入口均传 user');

// v0.4.19 E 批
note(archiveSrc.includes('function detectFormat') && archiveSrc.includes('function extractTar')
  && archiveSrc.includes('function extractZip') && archiveSrc.includes('function safeRel')
  && archiveSrc.includes('zlib.inflateRawSync') && archiveSrc.includes('function resolveInside')
  && repoImporterSrc.includes('async function importRepo')
  && repoImporterSrc.includes("command: 'reset', args: ['--hard', 'HEAD']")
  && serverSrc.includes("app.post('/api/repos/import'") && serverSrc.includes('raw: true, bodyLimit: 100 * 1024 * 1024')
  && serverSrc.includes("require('./repoImporter')")
  && app.includes('/api/repos/import?') && app.includes("$('#repo-import-form')")
  && html.includes('id="repo-import-file"'),
'E 批：压缩包上传导入（tar/tgz/zip 纯 JS 解压 + zip-slip 防护 + 仅 .git 自动 reset 恢复）');

// v0.4.14：所有代理地址输入框的 placeholder 都带 socks5 示例。
note((html.match(/socks5:\/\/127\.0\.0\.1:1080/g) || []).length >= 5
  && app.includes('socks5://127.0.0.1:1080'),
'代理地址输入框 placeholder 统一带 socks5:// 示例（全局 / 分组 / Git 规则 / 单项覆盖 / 各对象）');

// v0.4.13：「新建」不再立即落库，发送第一条消息时才创建会话（两页一致）。
note(app.includes('新建只重置为草稿态，不立即落库')
  && app.includes('与 AI 运维一致：草稿态，发送第一条消息时才真正创建会话')
  && app.includes('输入第一条消息后自动创建会话'),
'AI 运维 / AI 会话：点「新建」只重置草稿态，发送第一条消息才落库，避免 0 条消息空记录');

// v0.4.12：获取可用模型后默认全部勾选加入模型目录，胶囊可切换取消。
note(app.includes('拉取到的可用模型默认全部勾选加入模型目录')
  && app.includes('const existing = new Map(providerModelRows.map')
  && app.includes('默认模型不能取消勾选') && app.includes('点击胶囊可取消'),
'获取可用模型：拉取结果默认全部勾选加入模型目录，胶囊点击可取消 / 恢复，默认模型不可取消');

// 2) AI 运维（v0.4.3）：v0.4.10 原样恢复被终端替换掉的会话式对话功能。
note(['id="view-ops"', 'id="ops-new"', 'id="ops-session-list"', 'id="ops-provider"',
  'id="ops-server-btn"', 'id="ops-server-panel"', 'id="ops-write"', 'id="ops-ghost"',
  'id="ops-file"', 'id="ops-messages"', 'id="ops-prompt"', 'id="ops-send"']
  .every((s) => html.includes(s))
  && ['function loadOps', 'function sendOpsMessage', 'function renderOpsGhost', 'function acceptOpsSuggestion',
    'function readOpsAttachment', 'function renderOpsAttachments', 'function applyOpsScope',
    'function createOpsSession', 'function deleteOpsSession', 'function renameOpsSession',
    'function clearOpsSession', '/ai/sessions'].every((s) => app.includes(s))
  && app.includes("ops: loadOps"),
'AI 运维会话式对话已恢复：会话管理 / 服务器范围 / 写授权 / 附件 / Tab 建议 / 工具轨迹齐全');
// 2b) AI 会话（v0.4.10）：DeepSeek Harness 驱动的会话式界面，结构化事件 SSE + dsh 后端。
note(['id="view-aichat"', 'id="ach-new"', 'id="ach-sessions"', 'id="ach-provider"',
  'id="ach-title"', 'id="ach-msgs"', 'id="ach-trace"', 'data-ach-tab="chat"',
  'data-ach-tab="trace"', 'id="ach-input"', 'id="ach-send"', 'id="ach-stop"', 'id="ach-stats"']
  .every((s) => html.includes(s))
  && ['function loadAIChat', 'function sendAIChatMessage', 'function openAIChat',
    'function achSwitchTab', 'function achRenderTrace', '/ai/chats/stream', '/ai/chats/',
    'new EventSource(', 'data-ach-session'].every((s) => app.includes(s))
  && css.includes('#view-aichat .aichat-layout') && app.includes("aichat: loadAIChat")
  && html.includes('data-view="aichat"'),
'AI 会话页：会话列表 / 对话·轨迹 tab / 用户气泡 / 模型选择 / 统计 / SSE 增量接线完成');
// v0.4.11：AI 会话下拉按服务分组列出全部可用模型，切换即重建引擎并落库模型名。
note(app.includes('function achParseSelection') && app.includes('function achCurrentSelection')
  && app.includes("api('/ai/models')") && app.includes("body: { providerId: p.providerId, model: p.model }")
  && serverSrc.includes("app.get('/api/ai/models'") && serverSrc.includes("req.body?.model || ''")
  && aiChatSrc.includes('modelOverride') && dshSrc.includes('chosenModel')
  && dshSrc.includes('renderPatch(session.dir, pickProvider(state, session.providerId), session.model)'),
'AI 会话可按服务分组选择具体模型：/ai/models 聚合目录 + open/send 传 model + dsh patch 按选中模型渲染');
note(['function openSession', 'function attachStream', 'function submit', 'function interrupt',
  'function close', 'function active', 'function emitEvent', 'function attachEventStream',
  'function submitWithEvents', 'cordis.patch.yml', '--session-id', 'agent-default-model',
  'canUse(session, user)'].every((s) => dshSrc.includes(s))
  && ['/api/ai/terminal/open', '/api/ai/terminal/stream', '/api/ai/terminal/input',
    '/api/ai/terminal/active', '/api/ai/chats', '/api/ai/chats/stream',
    '/api/ai/chats/:id/send', '/api/ai/chats/:id/open'].every((s) => serverSrc.includes(s))
  && ['function send', 'function open', 'function list', 'function clearMessages',
    'dshTerminal.submitWithEvents', 'state.aiChats'].every((s) => aiChatSrc.includes(s))
  && coreSrc.includes('aiChats'),
'AI 会话后端：结构化事件通道 + 会话落库 owner 隔离 + patch 注入 + session-id 续接 + 路由齐全');
note(['image_url', 'function buildUserContent', 'function buildPrompt', 'function historyTurns',
  'visionFallback', 'text-fallback'].every((s) => engineSrc.includes(s))
  && miniSrc.includes('route.options.bodyLimit')
  && serverSrc.includes('bodyLimit: 20 * 1024 * 1024')
  && sessionsSrc.includes('MAX_ATTACHMENT_CHARS'),
'图片走 vision / 文本入上下文 / 不支持时自动降级，请求体上限按路由放宽');

// 3) 资源协作不再出现构建 / 部署记录，但归属与删除权限仍保留。
note(permSrc.includes('COLLAB_COLLECTIONS') && permSrc.includes("t !== 'builds' && t !== 'deploys'")
  && permSrc.includes('for (const type of COLLAB_COLLECTIONS)')
  && permSrc.includes('if (!COLLAB_COLLECTIONS.includes(type))')
  && coreSrc.includes("'aiProviders', 'builds', 'deploys'"),
'资源协作排除构建 / 部署记录，但二者仍保留在归属集合内（删除权限有效）');

// 4) 构建记录删除。
note(serverSrc.includes("app.delete('/api/builds/:id'")
  && app.includes('data-build-del') && app.includes("/builds/${encodeURIComponent")
  && app.includes("method: 'DELETE'"),
'构建部署页构建记录支持删除（后端 DELETE + 前端按钮与确认）');

/* --------------------------- v0.4.4 本轮改造 --------------------------- */
// 1) 统一确认 / 输入弹窗：全站不再有原生 confirm / prompt / alert 调用。
const appCode = app.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
note(html.includes('id="confirm-modal"') && html.includes('id="confirm-ok"')
  && html.includes('id="prompt-modal"') && html.includes('id="prompt-input"')
  && css.includes('.modal-panel.confirm-panel') && css.includes('.prompt-field')
  && app.includes('function confirmDialog') && app.includes('function promptDialog')
  && app.includes('await confirmDialog({') && (app.match(/await promptDialog\(/g) || []).length >= 10
  && !/\b(confirm|prompt|alert)\(/.test(appCode),
'平台统一确认 / 输入弹窗已接线，原生 confirm / prompt / alert 全部替换');

// 2) AI：编辑取消按钮保留；AI 运维对话功能恢复 + AI 会话页新增，二者并存。
note(html.includes('id="provider-cancel"')
  && app.includes('function loadOps') && app.includes('function loadAIChat')
  && html.includes('id="ops-ghost"') && html.includes('id="ops-server-panel"')
  && html.includes('id="view-aichat"'),
'AI 服务编辑取消保留；AI 运维对话功能恢复，DeepSeek Harness 会话式 AI 会话页并存');

// 3) 构建记录批量删除、驱动清单空态不再误报平台账号权限。
note(serverSrc.includes("app.delete('/api/builds'") && html.includes('id="build-select-all"')
  && html.includes('id="build-del-selected"') && app.includes('data-build-check')
  && app.includes("api('/builds', { method: 'DELETE'"),
'构建记录支持全选 / 批量删除（后端批量接口 + 前端复选框）');
note(!app.includes('未读取到驱动清单（需要管理员权限 Token）')
  && app.includes('与当前登录的平台账号是否为管理员无关')
  && serverSrc.includes('diagnostic'),
'驱动清单空态按上游原因分类，不再误报平台账号权限不足');

// 4) Git 运行时拆页 + 仓库平台侧编辑 / 移除 / 恢复。
note(html.includes('id="view-git-runtime"') && app.includes("'git-runtime': loadRepos")
  && html.includes('id="repo-edit-modal"') && app.includes("api('/repos/meta'")
  && app.includes("api('/repos/remove'") && serverSrc.includes("app.put('/api/repos/meta'")
  && serverSrc.includes("app.post('/api/repos/remove'") && serverSrc.includes("app.post('/api/repos/restore'"),
'Git 运行时独立子页 + 仓库平台侧编辑 / 移除 / 恢复（远端仓库不受影响）');

// 5) 资源协作页下线，协作者下沉到对象表单；删除对象 / 禁用账号时清理悬空引用。
note(!html.includes('id="view-collab"') && !app.includes('loadCollabResources')
  && html.includes('id="collab-inline-servers"') && app.includes('data-collab-open=')
  && coreSrc.includes('removedIds') && permSrc.includes("status !== 'disabled'")
  && permSrc.includes('proxy\\/overrides'),
'资源协作页已移除；协作者按单个对象配置，删除 / 禁用时清理悬空引用');

// 6) 2026-11-13 事故复盘：巡检不得再无声改掉管理员密码。
const sweepSrc = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'api-sweep.js'), 'utf8');
const auditSrc = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'api-audit.js'), 'utf8');
note(serverSrc.includes('b.generate !== true') && authSrc.includes('auditPasswordChange')
  && authSrc.includes('passwordChangedAt') && sweepSrc.includes("'POST /api/auth/reset-password'")
  && auditSrc.includes("'POST /api/auth/reset-password'") && auditSrc.includes('重置密码空参数被拒绝'),
'重置密码空 body 被拒绝、密码变更可追溯，两套巡检均跳过账号类写接口');

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
