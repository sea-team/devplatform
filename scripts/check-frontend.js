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
const dockerAppsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dockerApps.js'), 'utf8');
const dockerApiSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dockerApi.js'), 'utf8');
const dockerPanelSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dockerPanel.js'), 'utf8');
const dockerExecTermSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dockerExecTerm.js'), 'utf8');
const engineSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'engine.js'), 'utf8');
const sessionsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'aiSessions.js'), 'utf8');
const dshSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'dshTerminal.js'), 'utf8');
const aiChatSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'aiChat.js'), 'utf8');
const miniSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'mini.js'), 'utf8');
const remoteSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'remoteOps.js'), 'utf8');
const openlistSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'openlist.js'), 'utf8');
const integrationsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'integrations.js'), 'utf8');
const workspaceGitSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'workspaceGit.js'), 'utf8');
const gitViewSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'gitView.js'), 'utf8');
const gitSourcesSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'gitSources.js'), 'utf8');
const rcloneSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'rclone.js'), 'utf8');
const gatewaySrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'storageGateway.js'), 'utf8');
const credsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'serviceCredentials.js'), 'utf8');
const userDirsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'userDirs.js'), 'utf8');
const archiveSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'archive.js'), 'utf8');
const repoImporterSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'repoImporter.js'), 'utf8');
const aiPolicySrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'aiNetworkPolicy.js'), 'utf8');
const resetPwSrc = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'reset-admin-password.js'), 'utf8');
const nativeSrc = fs.readFileSync(path.resolve(__dirname, '..', 'windows', 'native-services.ps1'), 'utf8');
const buildSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'build.mjs'), 'utf8');
const fetchSvcSrc = fs.readFileSync(path.resolve(__dirname, '..', 'windows', 'fetch-services.ps1'), 'utf8');
const APPSTORE_DIR = path.resolve(__dirname, '..', 'platform', 'appstore', 'apps');
const appstoreDirFiles = fs.existsSync(APPSTORE_DIR)
  ? fs.readdirSync(APPSTORE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
const packReleaseSrc = fs.readFileSync(path.resolve(__dirname, '..', 'windows', 'pack-release.ps1'), 'utf8');
const packDistSrc = fs.readFileSync(path.resolve(__dirname, '..', 'windows', 'pack-dist.ps1'), 'utf8');
const launcherSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'launcher', 'launcher.js'), 'utf8');
const deploySrc = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'remote.js'), 'utf8');
const releaseYml = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
const errors = [];
const note = (ok, label, extra = '') => {
  console.log(`${ok ? '✔' : '✖'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (!ok) errors.push(label);
};

/* --------------------------- 1. 静态一致性 --------------------------- */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const refs = [...new Set([...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
// 这些 id 由 JS 运行时动态注入（附件预览 / 会话 pending 气泡 / 2FA 弹窗按钮 / 登录提示 /
// v0.4.31 Git 工作台各分区的输入框与结果容器：分区内容按需渲染，静态 HTML 里不落节点）。
const RUNTIME_IDS = new Set([
  'ops-hint', 'ops-pending', 'ach-pending', 'security-disable', 'security-enable',
  'git-wb-status-diff', 'git-wb-diff-staged', 'git-wb-diff-body', 'git-wb-diff-load',
  'git-wb-commit-detail', 'git-wb-commit-msg', 'git-wb-branch-name', 'git-wb-stash-ref',
  'git-wb-stash-msg', 'git-wb-tag-name', 'git-wb-tag-msg', 'git-wb-clean-result',
  'git-wb-sync-remote', 'git-wb-sync-branch', 'git-wb-conflict-ref',
  'git-wb-custom-form-slot',
]);
const missing = refs.filter((id) => !ids.has(id) && !RUNTIME_IDS.has(id));
note(missing.length === 0, 'app.js 引用的静态 id 均存在', missing.length ? `缺失：${missing.join(', ')}` : `${refs.length} 个引用`);

const sections = [...html.matchAll(/class="page" id="view-([a-z0-9-]+)"/g)].map((m) => m[1]);
const SUBPAGES = ['repo-new', 'repo-clone', 'git-runtime', 'storage-conn', 'storage-mounts', 'storage-drivers',
  'build-start', 'deploys', 'server-new', 'docker-containers', 'docker-images',
  'docker-volumes', 'docker-networks', 'docker-compose', 'docker-apps', 'ai-list', 'ai-test'];
// v0.4.10：新增「AI 会话」独立页，总页面数 32 -> 33（AI 运维保留、二者并存）。
// v0.4.29：新增 rclone 挂载页，总页面数 33 -> 34。
// v0.4.28+：新增 Docker 应用商店页，总页面数 34 -> 35。
note(sections.length === 35 && sections.includes('gitsrc') && sections.includes('docker')
  && sections.includes('proxy') && sections.includes('environment') && sections.includes('envcfg')
  && sections.includes('ide-config') && sections.includes('users') && sections.includes('git-runtime')
  && sections.includes('aichat') && sections.includes('ops')
  && !sections.includes('collab') && SUBPAGES.every((v) => sections.includes(v)),
'35 个独立页面（AI 运维 + AI 会话两页并存 + rclone 挂载 + Docker 应用商店；资源协作页已下线）均已转为可标签化的 .page', sections.join(', '));
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
// v0.4.28：连接根目录映射（按 id 只读浏览，不切 active）+ Windows 网络盘映射。
note(['/openlist/connections/${encodeURIComponent(storageState.rootMapConnId)}/root',
  'function renderRootConnPicker', 'function applyRootMapMode', 'storageState.readonlyMapped']
  .every((s) => app.includes(s)) && html.includes('id="ol-root-conn-picker"'),
'连接根目录映射：选择器 + 按连接 id 只读浏览接口已接线');
note(html.includes('id="drive-mount-card"') && html.includes('id="dm-map"')
  && app.includes('function loadDriveMountStatus') && app.includes('/drive-mount/map')
  && app.includes('/drive-mount/unmap') && app.includes('/drive-mount/status'),
'Windows 网络盘映射：状态探测 + 映射 / 断开 / 查询已接线');
note((html.match(/data-open-view=/g) || []).length >= 20
  && app.includes("document.addEventListener('click'") && app.includes('switchView(button.dataset.openView)'),
'每个独立页都带子导航条，点击后打开对应标签');
// v0.4.27：主菜单去重——gitsrc/ide-config/envcfg 已是子页，不再单列主菜单；
// 环境两页合并为单一「环境」入口，靠 subnav 互切；删主菜单按钮后靠 NAV_GROUP 保持父菜单高亮。
{
  const navBlock = (html.match(/<nav class="nav" id="nav">[\s\S]*?<\/nav>/) || [''])[0];
  const navViews = [...navBlock.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
  note(!navViews.includes('gitsrc') && !navViews.includes('ide-config') && !navViews.includes('envcfg')
    && navViews.includes('environment') && navViews.length === 14,
  '主菜单无冗余项：gitsrc/ide-config/envcfg 不单列，环境两页合并为单一入口',
  `nav=${navViews.join(',')}`);
  note(/id="view-environment"[\s\S]*?data-open-view="environment"[\s\S]*?data-open-view="envcfg"/.test(html)
    && /id="view-envcfg"[\s\S]*?data-open-view="environment"[\s\S]*?data-open-view="envcfg"/.test(html),
  '环境两页顶部均有「环境适配 / 环境配置」互切 subnav');
  note(app.includes("gitsrc: 'repos'") && app.includes("'ide-config': 'ide'") && app.includes("envcfg: 'environment'"),
  'NAV_GROUP 映射完整：被去重的子页打开时父菜单保持高亮');
}
note(html.includes('id="docker-container-filter"') && html.includes('id="docker-stat-grid"')
  && app.includes('function renderDockerContainers') && app.includes('class="dk-ops"'),
'Docker 列表筛选、统计卡与操作按钮分组已补齐');

// v0.4.28+：Docker 应用商店（移植宝塔 appstore）—— section / subnav / 分类 / 卡片 / 弹窗 / 接口接线。
note(html.includes('id="view-docker-apps"') && html.includes('data-open-view="docker-apps"')
  && html.includes('id="da-grid"') && html.includes('id="da-modal"')
  && html.includes('id="da-mirror-modal"')
  && app.includes('function loadDockerApps') && app.includes('function renderDockerAppGrid')
  && app.includes("'docker-apps': loadDockerApps")
  && serverSrc.includes('/api/docker/apps/status') && serverSrc.includes('/api/docker/apps/:name/prepare')
  && coreSrc.includes("'dockerApps'") === false,
'Docker 应用商店页：section / subnav / 分类卡片 / 部署弹窗 / 后端接口已接线');
note(app.includes("'/docker/apps?'") && app.includes("'/docker/apps/config/accelerator'")
  && app.includes('function generateDaFiles') && app.includes('function renderDockerAppPager')
  && appstoreDirFiles.length >= 300,
'应用商店前端调用 / 分页 + 全量内置应用模板（≥300 个）就绪');
// v0.4.29：加速器双模式——默认宝塔（加速 URL → daemon.json），可选 compose 换源。
note(serverSrc.includes('/api/docker/apps/config/accelerator') && serverSrc.includes('/api/docker/apps/config/daemon-json')
  && dockerAppsSrc.includes('function daemonJson(') && dockerAppsSrc.includes('function setAccelerator(')
  && dockerAppsSrc.includes("mode !== 'baota' && mode !== 'compose'")
  && app.includes('da-acc-mode') && app.includes('refreshDaDaemonPreview'),
'镜像加速双模式：宝塔 daemon.json（默认）+ compose 换源（可选），前端已接线');
// v0.4.29：官方真实版本目录=appname，解析器须按「含 docker-compose.yml 的子目录」发现版本，
// 而非把 appversion 当目录名（否则官方应用 compose 全空）。
note(dockerAppsSrc.includes('function discoverVersionDirs(')
  && dockerAppsSrc.includes("path.join(hit.dir, 'docker-compose.yml')")
  && dockerAppsSrc.includes('upperToKey'),
'官方格式解析：真实版本目录发现 + 小写 field.attr ↔ 大写 .env 键映射');
// v0.4.29：宝塔创建弹窗每项配置右侧都有说明（官方 field.suffix），按真实类型渲染控件。
note(app.includes('function daFieldHelp') && app.includes('f.suffix')
  && app.includes('data-da-kind="checkbox"') && app.includes("type === 'textarea'")
  && html.includes('class="da-form-fields" id="da-form-fields"')
  && css.includes('.da-field-help') && css.includes('.da-field-row'),
'配置说明对齐宝塔：官方 suffix 逐项展示 + checkbox/textarea 类型适配');
// v0.4.29：官方 allow_access 复选框不在 .env 中，宝塔据此设置 HOST_IP；不映射则勾选无效。
note(dockerAppsSrc.includes("hasOwnProperty.call(params, 'allow_access')")
  && dockerAppsSrc.includes('upperToKey.HOST_IP') && dockerAppsSrc.includes("'0.0.0.0' : '127.0.0.1'"),
'宝塔外部访问开关：allow_access → HOST_IP 映射已接线');
// v0.4.29：一键部署（SSH 上传 + docker compose up -d）+ 下载 compose/.env 文件。
note(serverSrc.includes("'/api/docker/apps/:name/deploy'") && serverSrc.includes('sftpPut(server')
  && serverSrc.includes('docker compose') && serverSrc.includes('up -d --pull always')
  && serverSrc.includes("serverId === 'local'") && serverSrc.includes("server: '本机'")
  && app.includes('function deployDaToServer') && app.includes('function dlText(')
  && app.includes('function loadDaServers') && app.includes("'#da-deploy-btn'")
  && app.includes('da-deploy-pending') && app.includes("value=\"local\"")
  && app.includes("本机（平台宿主机")
  && html.includes('id="da-deploy-panel"') && html.includes('id="da-deploy-server"')
  && html.includes('id="da-deploy-log"') && html.includes('id="da-dl-compose"')
  && html.includes('id="da-dl-env"'),
'应用商店一键部署（SSH + compose up）和文件下载已接线');
// v0.4.29：Windows 端 appRoot 指向 dist/，模板必须随 exe/组件包/绿色包全链路分发，
// 否则桌面端应用商店为空。四段缺一即失败。
note(buildSrc.includes('APPSTORE_SRC') && buildSrc.includes('syncAppstore()')
  && buildSrc.includes("'appstore.tar.gz'") && buildSrc.includes('appstore: fs.existsSync')
  && launcherSrc.includes('SEA_APPSTORE_ASSET') && launcherSrc.includes('function ensureAppstore()')
  && packDistSrc.includes("Join-Path $Dist 'appstore'") && packDistSrc.includes("Join-Path $stage 'appstore'")
  && packReleaseSrc.includes("Join-Path $Dist 'appstore'") && packReleaseSrc.includes("Join-Path $targetDist 'appstore'"),
'应用商店模板随 exe/组件包/绿色包分发（SEA asset + 首启释放 + 两个打包脚本）');
// v0.4.29：246 部署脚本必须只排除仓库根的凭据 .env，放行 appstore 模板 .env
// （否则线上 prepare 生成空 .env）。同时 .env.bak.* 任何层级都不能进包。
note(deploySrc.includes("isExcludedFile = (name, relDir)")
  && deploySrc.includes("(!relDir && EXCLUDE_FILES.has(name))")
  && deploySrc.includes("/^\\.env\\.bak\\./.test(name)")
  && deploySrc.includes("isExcludedFile(entry.name, relDir)"),
'246 部署排除逻辑：根 .env 凭据排除 + appstore 模板 .env 放行 + .env.bak.* 全层级排除');
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
// v0.4.30：Git 仓库「文件管理 / 克隆到工作区」弹窗化（不再 newPane / switchView 跳页），
// 终端断开返回仓库列表。表单与弹窗容器静态存在，现有 JS 绑定不受 DOM 搬移影响。
note(html.includes('id="repo-clone-modal"') && html.includes('id="repo-files-modal"')
  && html.includes('id="repo-clone-open-btn"')
  && app.includes('function openRepoCloneModal') && app.includes('function openRepoFilesModal')
  && app.includes('function closeRepoFilesModal')   && html.includes('id="repo-clone-modal-slot"')
  && app.includes('loadRepoFs') && app.includes('data-repo-modal-close')
  && !app.includes('openFilesTab(ctx.server'),
'Git 仓库文件管理 / 克隆弹窗化，终端断开返回仓库列表');
// v0.4.30：容器交互式终端 = xterm + Docker exec PTY 流式接口。
// 后端：hijack 双向 socket / 远端 SSH pty / owner 归属 / SSE 广播 / resize；
// 前端：shell(bash|sh) + root 选择 / SSE base64 → xterm / FitAddon / 断开清理。
note(dockerApiSrc.includes('function execAttach(') && dockerApiSrc.includes("connection: 'Upgrade'")
  && dockerApiSrc.includes('function execCreateInteractive(') && dockerApiSrc.includes('function execResize(')
  && dockerExecTermSrc.includes('function openSession(') && dockerExecTermSrc.includes('function attachStream(')
  && dockerExecTermSrc.includes('pty: {') && dockerExecTermSrc.includes('session.ownerId')
  && dockerPanelSrc.includes('assertWritable,')
  && serverSrc.includes("'/api/docker/containers/:id/terminal/open'")
  && serverSrc.includes("'/api/docker/containers/:id/terminal/stream'")
  && html.includes('id="dk-term-xterm"') && html.includes('id="dk-term-shell"')
  && html.includes('id="dk-term-root"') && html.includes('id="dk-term-connect"')
  && app.includes('function dkTermConnect(') && app.includes('function dkTermDisconnect(')
  && app.includes('new Terminal(') && app.includes('terminal/stream?sid=')
  && app.includes('closeDkModal()') ,
'Docker exec PTY 流式接口 + xterm 交互式终端（shell / root / 自适应 / 断开清理）');
// v0.4.30 修复：连接 / 断开按钮曾用 e.id（事件对象无此属性）导致点击无响应。
// 护栏同时断言「正确写法存在」与「错误写法不存在」，防止回归。
const termBtnBind = app.match(/if \(e\.target && ([^)]*?)=== 'dk-term-connect'\) \{ dkTermConnect\(\); return; \}/);
note(Boolean(termBtnBind) && termBtnBind[1].includes('e.target.id')
  && app.includes("e.target.id === 'dk-term-disconnect'")
  && !app.includes("e.id === 'dk-term-connect'")
  && !app.includes("e.id === 'dk-term-disconnect'"),
'Docker 终端连接 / 断开按钮事件委托使用 e.target.id（修复 e.id 导致的点击无响应）');

// v0.4.31：Git 工作台（TortoiseGit 式）—— 后端结构化视图 + 语义动作 + 多标签前端 + 分支图/diff 着色。
// 沿用仓库列表「Git 操作」按钮入口，不做右键菜单。护栏覆盖全链路，缺一段即判失败。
note(serverSrc.includes("app.post('/api/repos/git/view'") && serverSrc.includes("app.post('/api/repos/git/action'")
  && serverSrc.includes("app.get('/api/repos/git/groups'") && serverSrc.includes('gitView.view(')
  && serverSrc.includes('gitView.resolveAction(') && serverSrc.includes('assertRepoGitWrite(')
  && serverSrc.includes('act.needConfirm && b.confirmed !== true')
  && serverSrc.includes("app.post('/api/repos/git', wrap"),
'Git 工作台后端：/view 只读视图 + /action 语义动作 + /groups 分组 + 旧入口兼容 + 写权限收口');
note(workspaceGitSrc.includes('function classifyCommand(') && workspaceGitSrc.includes('function isReadOnlyForm(')
  && workspaceGitSrc.includes('function groups(') && workspaceGitSrc.includes('group: ')
  && workspaceGitSrc.includes("'clean', 'rm', 'mv', 'blame', 'config', 'reflog'")
  && workspaceGitSrc.includes('classifyCommand(cmd, list)')
  && workspaceGitSrc.includes("'add', 'commit', 'push', 'merge', 'revert', 'reset', 'restore', 'stash', 'checkout'"),
'workspaceGit：混合命令精确读写分类（branch/tag/stash/clean）+ 分组预设 + 命令白名单扩展');
note(gitViewSrc.includes('const VIEWS =') && gitViewSrc.includes('const ACTIONS =')
  && gitViewSrc.includes('function parseStatus(') && gitViewSrc.includes('function parseLog(')
  && gitViewSrc.includes('function parseBranches(') && gitViewSrc.includes('function parseStash(')
  && gitViewSrc.includes('function parseTags(') && gitViewSrc.includes('function parseNumstat(')
  && ['status:', 'log:', 'graph:', 'branches:', 'remotes:', 'stash:', 'tags:', 'diff:', 'show:', 'conflicts:', 'reflog:']
    .every((k) => gitViewSrc.includes(k)),
'gitView：11 个只读视图定义与 status/log/branch/stash/tag/diff 解析器齐备');
note(gitViewSrc.includes('VIEW_NAMES') && gitViewSrc.includes('ACTION_NAMES')
  && gitViewSrc.includes('async function view(') && gitViewSrc.includes('function resolveAction(')
  && gitViewSrc.includes('workspaceGit.classifyCommand')
  && gitViewSrc.includes('parseStatus(o[0])') && gitViewSrc.includes('parseLog(o[0])')
  && gitViewSrc.includes('parseNumstat(') && gitViewSrc.includes('function safeRef(')
  && gitViewSrc.includes('function safePath(') && gitViewSrc.includes('workspaceGit.run(')
  && gitViewSrc.includes('classifyCommand(r.command, r.args)')
  && gitViewSrc.includes('视图 ${key} 内含写命令'),
'gitView.js：11 个只读视图 + 23 个语义动作 + 只读防线 + 参数校验 + 复用 workspaceGit.run');
note(html.includes('class="modal-panel git-workbench"') && html.includes('id="repo-git-tabs"')
  && html.includes('id="git-wb-pane-status"') && html.includes('id="git-wb-pane-log"')
  && html.includes('id="git-wb-pane-commit"') && html.includes('id="git-wb-pane-branch"')
  && html.includes('id="git-wb-pane-sync"') && html.includes('id="git-wb-pane-stash"')
  && html.includes('id="git-wb-pane-tag"') && html.includes('id="git-wb-pane-conflict"')
  && html.includes('id="git-wb-pane-clean"') && html.includes('id="git-wb-pane-custom"')
  && html.includes('id="repo-git-refresh"') && html.includes('id="repo-git-form"')
  // v0.4.31 复核修复：repo-git-message / repo-git-hash 是从未被 app.js 读取的摆设输入框，
  // 已移除；提交说明 / 还原提交号改由 promptDialog 弹窗即时填写。
  && !html.includes('id="repo-git-message"') && !html.includes('id="repo-git-hash"')
  && html.includes('id="repo-git-input"')
  && (html.match(/id="repo-git-clear"/g) || []).length === 1,
'Git 工作台 DOM：10 个标签分区 + 刷新按钮 + 静态自定义命令表单（保留历史 id）');
note(app.includes('async function gitLoadView(') && app.includes("api('/repos/git/view'")
  && app.includes("api('/repos/git/action'") && app.includes('async function runGitAction(')
  && app.includes('function renderGitTabs(') && app.includes('function renderGitToolbar(')
  && app.includes('async function renderGitStatus(') && app.includes('async function renderGitLog(')
  && app.includes('async function renderGitCommit(') && app.includes('async function renderGitBranch(')
  && app.includes('async function renderGitSync(') && app.includes('async function renderGitStash(')
  && app.includes('async function renderGitTag(') && app.includes('async function renderGitConflict(')
  && app.includes('async function renderGitClean(') && app.includes('function renderGitCustom(')
  && app.includes('function graphSvg(') && app.includes('function colorizeDiff(')
  && app.includes("api('/repos/git/groups'"),
'Git 工作台前端：10 个分区渲染 + 结构化视图调用 + 语义动作 + SVG 分支图 + diff 着色');
note(css.includes('.modal-panel.git-workbench') && css.includes('.git-wb-pane')
  && css.includes('.git-wb-diff .add') && css.includes('.git-wb-diff .del')
  && css.includes('.git-wb-branch-graph'),
'Git 工作台样式：宽面板 / 分区 / diff 增删着色 / 分支图容器');

// v0.4.31 复核修复护栏（对照「分析未提交改动中的 bug 和不完善之处」逐条实测结论）。
note(app.includes('if (p.command === \'stash\' && (p.args || []).includes(\'push\'))')
  && app.includes("args = [...args, '-m', text]")
  && app.includes('提交号不合法'),
'P1-1 修复：stash-save 预设 needText 用 -m 注入；非法 hash 明确报错中止，不静默沿用 HEAD');
note(gitViewSrc.includes('function unquotePath(') && gitViewSrc.includes('function splitStatusPath(')
  && gitViewSrc.includes('Buffer.from(bytes).toString(\'utf8\')')
  && gitViewSrc.includes('combine: (o) => parseStatus(o[0])')
  && gitViewSrc.includes('splitStatusPath(line.slice(3))'),
'P1-2 修复：parseStatus 补 porcelain quoted-path 反转义（八进制字节 / 中文 / rename）');
note(app.includes("await runGitAction('discard', {})")
  && serverSrc.includes('cls.destructive && b.confirmed !== true')
  && app.includes('function repoGitNeedsConfirm('),
'P1-3 修复：放弃全部改动走 discard 语义动作 + 旧 /repos/git 入口强制 confirmed');
note(gitViewSrc.includes('if (Number(r.code) !== 0)')
  && gitViewSrc.includes('Git 视图 ${key} 执行失败'),
'P1-4 修复：view() 遇 git code≠0 抛 HttpError(400)，不再返回 ok:true 夹带 fatal 文本');
note(app.includes('function splitGitCommand(') && app.includes('function gitTextWidth(')
  && !app.includes('Math.min(1100,') && app.includes('data-gfill')
  && app.includes('repoGitBusy = true;'),
'P2 修复：自定义命令引号分词 / SVG 宽度自适应 / 远程分支短名 / 确认期忙碌锁');
note(releaseYml.includes('BEGIN PENDING-RELEASE-NOTES')
  && releaseYml.includes('-replace') && releaseYml.includes('END PENDING-RELEASE-NOTES'),
'文档修复：CI 生成 Release notes 前剥离「待发版」元信息块，避免污染正式发布说明');
{
  const smokePath = path.resolve(__dirname, 'smoke-git-workbench.js');
  const feSmokePath = path.resolve(__dirname, 'smoke-git-workbench-frontend.js');
  const pkg = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'package.json'), 'utf8');
  const be = fs.existsSync(smokePath) ? fs.readFileSync(smokePath, 'utf8') : '';
  const fe = fs.existsSync(feSmokePath) ? fs.readFileSync(feSmokePath, 'utf8') : '';
  note(fs.existsSync(smokePath)
    && pkg.includes('"smoke:gitwb"') && pkg.includes('node --check ../scripts/smoke-git-workbench.js')
    && be.includes("'/repos/git/view'") && be.includes("'/repos/git/action'")
    && be.includes('需要二次确认') ,
  'Git 工作台后端冒烟脚本存在并接入 npm scripts / check 链（view + action + 破坏性确认）');
  // v0.4.31 复核修复：新增前端交互级行为测试，用 vm 跑真实函数体而非字符串护栏，
  // 覆盖 4 个 P1 + P2 交互（后端 smoke 只测后端，一个 P1 都抓不到）。
  note(fs.existsSync(feSmokePath)
    && pkg.includes('"smoke:gitwb:fe"') && pkg.includes('node --check ../scripts/smoke-git-workbench-frontend.js')
    && fe.includes('P1-1 stash-save') && fe.includes('P1-2 parseStatus')
    && fe.includes('P1-4') && fe.includes('确认弹窗期间'),
  'Git 工作台前端交互级行为测试接入 npm scripts / check 链（真函数体断言，覆盖 4 个 P1）');
}

// 发布时只需改这个常量；断言同时保证 index.html 内所有静态资源用同一个戳，避免新旧缓存混用。
const CACHE_STAMP = '20261125a';
const stamps = [...new Set([...html.matchAll(/\?v=(\d{8}[a-z])/g)].map((m) => m[1]))];
note(stamps.length === 1 && stamps[0] === CACHE_STAMP, `静态资源版本已升到 ${CACHE_STAMP}`);

// v0.4.29：行内 / 工具栏下拉框统一美化——这批 select 不在 .form / .grid-2 / label.field 内，
// 过去退化为浏览器默认控件。护栏确保所有同类控件都挂上 ui-select，样式与动态模板不漏。
{
  const styledIds = ['docker-target', 'docker-container-state', 'docker-tpl-height',
    'rclone-remote-picker', 'ol-root-conn-picker', 'server-poll-interval', 'ext-mode',
    'ops-provider', 'ach-provider', 'ol-ed-lang', 'ol-ed-encoding', 'ol-ed-newline'];
  const missing = styledIds.filter((id) => {
    const re = new RegExp('<select[^>]*id="' + id + '"[^>]*class="[^"]*ui-select');
    return !re.test(html);
  });
  note(css.includes('select.ui-select {') && css.includes('appearance: none')
    && css.includes('select.ui-select-sm'),
  '工具栏下拉框统一样式（圆角 / 自定义箭头 / 焦点反馈 / 紧凑变体）已加入');
  note(missing.length === 0, '所有行内 / 工具栏下拉框均已挂 ui-select 样式类',
    missing.length ? `未覆盖：${missing.join(', ')}` : `覆盖 ${styledIds.length} 个`);
  note(app.includes('class="ui-select ui-select-sm" data-svc-cred-mode')
    && app.includes('class="ui-select ui-select-sm" data-role="ed-lang"')
    && app.includes('data-collab-perm')   // collab inline 改为 CSS 自定义样式，不再需要 ui-select class
    && app.includes('class="ui-select" name="${esc(f.key)}"'),
  '动态生成的凭据 / 编辑器 / 协作者 / 扩展安装下拉框同步套用美化样式');
}

// v0.4.29：Windows 提权 + WinFsp 自动安装链路护栏。
// 两个决策：exe 清单强制 requireAdministrator；WinFsp MSI 仅随全量包分发。
{
  note(buildSrc.includes('requireAdministrator') && buildSrc.includes('outputresource')
    && buildSrc.includes('injectAdminManifest(EXE)') && buildSrc.includes('findMt()'),
  'build.mjs 在 postject 之前注入 requireAdministrator 清单（含 Windows SDK 自动查找与降级）');
  note(buildSrc.indexOf('injectAdminManifest(EXE)') < buildSrc.indexOf('await inject(EXE'),
  '清单注入顺序在 SEA blob 注入之前（实测两者兼容，反序会破坏 blob）');
  note(gatewaySrc.includes('function isAdmin()') && gatewaySrc.includes("['session']")
    && gatewaySrc.includes('function winFspServiceRunning()') && gatewaySrc.includes('WinFsp\\.Launcher')
    && gatewaySrc.includes('detectedBy'),
  'WinFsp 检测以服务为主判据（net start），修复非标准路径漏检导致的重复安装 1603');
  note(gatewaySrc.includes('async function ensureWinFsp') && gatewaySrc.includes('/qn')
    && gatewaySrc.includes('/norestart') && gatewaySrc.includes('msiexec.exe')
    && gatewaySrc.includes('function findMsi()') && gatewaySrc.includes('await ensureWinFsp({ auto: true })'),
  'WinFsp 静默安装（msiexec /qn）已接通启动流程，含随包 MSI 定位与二次校验');
  note(fetchSvcSrc.includes('Resolve-Msi') && fetchSvcSrc.includes('winfsp.msi')
    && fetchSvcSrc.includes('WinFspSha256') && packReleaseSrc.includes('$SvcMsi')
    && packReleaseSrc.includes('winfsp.msi') && releaseYml.includes('winfsp-2.1'),
  'WinFsp MSI 随全量包/服务包下载分发（SHA256 校验）并纳入 CI 缓存键');
  note(serverSrc.includes('/api/rclone/gateway/winfsp/install') && serverSrc.includes('requireAdmin(req)')
    && html.includes('id="gw-winfsp-install"') && html.includes('id="gw-winfsp-bar"')
    && app.includes('renderWinFspBar') && app.includes('/rclone/gateway/winfsp/install'),
  'WinFsp 安装接口（管理员）+ 网关页状态条与一键安装按钮已接线');
}

// v0.4.24 补丁：所有 .card 必须落在某个 <section class="page"> 内，否则会脱离视图切换
// 而常驻显示在每个页面（曾导致「上传压缩包导入」出现在环境配置等无关页）。同时确认
// 仓库导入表单归位到「克隆到工作区」页。
{
  const lines = html.split('\n');
  const formLine = lines.findIndex((l) => l.includes('id="repo-import-form"'));
  let start = -1, end = -1;
  for (let i = formLine - 1; i >= 0; i--) { if (/<section class="page"/.test(lines[i])) { start = i; break; } }
  for (let i = formLine - 1; i < lines.length; i++) { if (/<\/section>/.test(lines[i])) { end = i; break; } }
  const sectionId = start >= 0 ? (lines[start].match(/id="([^"]+)"/) || [])[1] : '';
  note(formLine >= 0 && sectionId === 'view-repo-clone' && formLine > start && formLine < end,
    '上传压缩包导入表单归属「克隆到工作区」页', `section=${sectionId}`);
  let depth = 0, stray = 0;
  for (const line of lines) {
    if (/<section class="page"/.test(line)) depth++;
    if (/<div class="card"/.test(line) && depth === 0) stray++;
    if (/<\/section>/.test(line)) depth = Math.max(0, depth - 1);
  }
  note(stray === 0, '所有 card 均位于 page 容器内，无跨页常驻元素', `游离 card=${stray}`);
}

// v0.4.25：渐进式类型检查设施（棘轮基线）完整性——不跑 tsc，仅校验文件齐备与基线合法。
{
  const root = path.resolve(__dirname, '..');
  const tcConfig = path.join(root, 'platform', 'tsconfig.typecheck.json');
  const tcScript = path.join(__dirname, 'typecheck.js');
  const tcBaseline = path.join(__dirname, 'typecheck-baseline.json');
  let ok = fs.existsSync(tcConfig) && fs.existsSync(tcScript) && fs.existsSync(tcBaseline);
  let maxErrors = -1;
  if (ok) {
    try { maxErrors = Number(JSON.parse(fs.readFileSync(tcBaseline, 'utf8')).maxErrors); } catch { ok = false; }
    ok = ok && Number.isInteger(maxErrors) && maxErrors >= 0;
    ok = ok && /checkJs/.test(fs.readFileSync(tcConfig, 'utf8')) && /tsc/.test(fs.readFileSync(tcScript, 'utf8'));
    ok = ok && /typecheck/.test(fs.readFileSync(path.join(root, 'platform', 'package.json'), 'utf8'));
  }
  note(ok, '渐进式类型检查设施齐备（tsconfig / 脚本 / 基线）', `基线=${maxErrors}`);
}

// v0.3.10：IDE 登录凭据、总览运行主机卡片、仓库文件 / 终端 / Git 操作。
note(html.includes('id="ide-cred"') && html.includes('id="ide-cred-reveal"')
  && html.includes('id="host-info-body"') && html.includes('id="repo-git-modal"')
  && app.includes('revealIdePassword') && app.includes('loadHostInfo')
  && app.includes('openRepoGitModal') && app.includes('data-repo-files'),
'IDE 登录凭据、总览运行主机卡片与仓库 Git 操作弹窗已接线');
// v0.4.30：文件管理改为弹窗内嵌浏览器（不再 newPane），克隆表单也弹窗化；终端仍是标签页但断开返回仓库列表。
note(app.includes("api('/repos/git'") && app.includes("api('/host-info")
  && app.includes('openRepoFilesModal') && app.includes('repo-clone-modal')
  && app.includes('openTerminalTab(ctx.server') && app.includes('initialCommand')
  && app.includes("onClose: () => { switchView('repos'); }"),
'工作区仓库文件管理 / 克隆弹窗化，终端断开返回仓库列表，并经白名单接口执行 Git 命令');

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

/* ---- v0.4.23：三项产品决策落地的安全加固护栏 ---- */
note(aiPolicySrc.includes('function classify') && aiPolicySrc.includes('function assertAllowed')
  && serverSrc.includes('aiNetworkPolicy.assertAllowed'),
'SSRF: 新增地址属地分级模块并接入三处写入口');
note((serverSrc.match(/aiNetworkPolicy\.assertAllowed/g) || []).length >= 3,
'SSRF: 三个用户可控 baseURL 入口全部做属地校验');
note(gitSourcesSrc.includes('SSH_HOST_MAPPING_MISMATCH') && gitSourcesSrc.includes('已自动清理宿主机上的错误克隆目录')
  && gitSourcesSrc.includes('const safeToRemove'),
'SSH 克隆: 校验容器内 .git 可见性，映射错则带路径守卫回滚并报明确错误');
note(authSrc.includes('const rateKey = `2fa|${user.id}`') && authSrc.includes("二次验证尝试次数过多"),
'2FA: 账号级失败限速（按 userId，5 次锁 1 分钟）');
note(coreSrc.includes('cliSecret: env(\'DP_CLI_SECRET\')') && authSrc.includes('x-dp-cli-key')
  && authSrc.includes('safeEqualStr') && envcfg.includes('DP_CLI_SECRET')
  && resetPwSrc.includes('x-dp-cli-key') && resetPwSrc.includes('DP_CLI_SECRET'),
'CLI 通道: 共享密钥 DP_CLI_SECRET 全链路（core 配置 + auth 校验 + 环境页 + 重置脚本）');

// ===== v0.4.24 安全评审 P0/P1/P2 全修静态护栏 =====
const gitRtSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'gitRuntime.js'), 'utf8');
const buildBeSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'buildBackends.js'), 'utf8');
const extRtSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'extRuntime.js'), 'utf8');
const extLifeSrc = fs.readFileSync(path.resolve(__dirname, '..', 'platform', 'src', 'extLifecycle.js'), 'utf8');
note(permSrc.includes("/^\\/api\\/docker\\//") && permSrc.includes('Docker 写操作'),
'P0: Docker 全部写接口纳入全局写保护（含 delete 容器/卷/网络/镜像）');
note(serverSrc.includes('部署目录不合法') && serverSrc.includes('^\\/[A-Za-z0-9_.\\/-]+$'),
'P0: 服务器 deployDir 白名单校验，杜绝 shell 元字符');
note(gitRtSrc.includes('const shq =') && gitRtSrc.includes('const dir = shq(') && !gitRtSrc.includes('const dir = JSON.stringify'),
'P0: probeHostGit 用 shq 单引号转义替代 JSON.stringify');
note(coreSrc.includes('const snapshot = JSON.parse(JSON.stringify(state()))') && coreSrc.includes('_state = snapshot; // 回滚'),
'P1: core.update 快照事务，mutator 抛错回滚内存防状态分裂');
note(serverSrc.includes("assertCan(req.user, acl, 'read')") && serverSrc.includes('repoSegment'),
'P1: /api/ide/open 按仓库 read 权限代登录，堵住越权拿 IDE 会话');
note(permSrc.includes('/api\\/ai\\/(?:sessions|chats|chat|ops|models|tools)'),
'P1: AI 使用类接口的 providerId 选型参数不再被误判为 write 资源');
note(app.includes('tab.ctx.loadSeq') && app.includes('seq !== tab.ctx.loadSeq'),
'P1: 远程 SFTP 文件列表加请求序号，丢弃晚到响应防误删');
note(html.includes('id="ol-ed-preview"') && app.includes('preview.hidden = editable') && !app.includes("body.innerHTML += `<div class=\"ed-preview\""),
'P1: OpenList 编辑器用固定预览节点，不再 innerHTML+= 摧毁 CodeMirror');
note(app.includes('async function openExtRepos') && app.includes('await loadRepos()'),
'P1: openExtRepos 等待仓库列表加载完成再渲染');
note(integrationsSrc.includes('const failStreams =') && integrationsSrc.includes('reader.destroy()'),
'P2: sftpPut 出错时销毁读写两端流，不泄漏 fd');
note(gitRtSrc.includes('detached: process.platform !==') && gitRtSrc.includes('process.kill(-child.pid'),
'P2: gitRuntime.exec 超时杀整进程组，不留 git 孤儿进程');
note(aiChatSrc.includes('engineOpenInFlight') && aiChatSrc.includes('openEngineInner'),
'P2: AI 会话引擎 open 单飞，并发不泄漏 dsh 引擎');
note(buildBeSrc.includes('} finally {') && buildBeSrc.includes('rm -rf ${shq(base)}'),
'P2: 远程构建临时目录在 finally 中清理，失败不残留');
note(extRtSrc.includes('if (isRemote(inst))') && extRtSrc.includes('remoteDocker.remove(serverIdOf(inst)'),
'P2: 远程扩展 rebuild 走 remoteDocker.remove 清理旧容器');
note(extLifeSrc.includes('dbgateSyncInFlight') && extLifeSrc.includes('syncDbGateInner'),
'P2: syncDbGate 单飞锁，并发增删实例不产生孤儿容器');
note(authSrc.includes('MAX_RATE_ENTRIES') && authSrc.includes('pruneMap(attempts'),
'P2: attempts/pending2fa 惰性清理 + 硬上限，防内存无界增长');
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

// v0.4.27：Git 源添加/编辑表单的本源代理覆盖（解决外部 HTTPS 源经全局 socks5 无法列 REST 目录）。
// HTML：表单内含 name="proxy" + id="gitsrc-proxy" + REST 仅支持 http(s)/direct 的提示；
// 前端：回显 s.proxyOverride；后端：create/update 经 applySourceProxy 写入 git 作用域单项覆盖。
note(html.includes('id="gitsrc-proxy"') && html.includes('name="proxy"')
  && html.includes('id="gitsrc-proxy-note"') && html.includes('列仓库 / 分支走 REST API'),
'Git 源表单含本源代理输入框与 REST 仅 http(s)/direct 的说明');
note(app.includes('proxyInput.value = s.proxyOverride') && app.includes('s.effectiveProxy'),
'Git 源编辑回显本源代理覆盖与当前生效代理');
note(gitSourcesSrc.includes('applySourceProxy') && gitSourcesSrc.includes('proxyModule.setOverride(\'git\'')
  && gitSourcesSrc.includes('proxyOverride') && gitSourcesSrc.includes("proxyModule.removeOverride('git', id)"),
'后端 Git 源增删改写代理单项覆盖且列表回显脱敏 proxyOverride');
// v0.4.29：rclone 存储层（控制面无需 FUSE）+ SMB 共享网关（Linux 专用容器 / Windows WinFsp）。
note(html.includes('id="view-rclone"') && html.includes('id="rclone-file-list"')
  && html.includes('id="rclone-remote-form"') && html.includes('id="gw-info"'),
'rclone 挂载页含远端配置、文件浏览与 SMB 网关状态卡片');
note(app.includes('rclone: loadRclone') && app.includes("NAV_GROUP") && app.includes("rclone: 'storage'")
  && app.includes('/rclone/files?') && app.includes('/rclone/gateway/start'),
'rclone 页已接入导航、加载器与文件/网关接口');
note(rcloneSrc.includes("ALLOWED = new Set") && rcloneSrc.includes("spawn(bin, fullArgs")
  && rcloneSrc.includes("mode: 0o600") && serverSrc.includes("app.get('/api/rclone/status'"),
'rclone 后端含子命令白名单、shell:false 进程与脱敏配置落盘');
note(gatewaySrc.includes("CapAdd: ['SYS_ADMIN']") && gatewaySrc.includes("rclone mount")
  && gatewaySrc.includes("smbd -F -s /etc/samba/smb.conf") && gatewaySrc.includes("winFsp()")
  && permSrc.includes("/^\\/api\\/rclone/"),
'SMB 网关具备 FUSE 容器/Windows 降级双路径且写操作限管理员');
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
// v0.4.31：写判定从 WRITE_COMMANDS.has(cmd) 升级为 classifyCommand(cmd,args)（覆盖混合命令），
// 权限校验抽成 assertRepoGitWrite(req, repo, needWrite)，安全语义不变且更严。
note(workspaceGitSrc.includes("'add', 'commit', 'push', 'merge', 'revert', 'reset', 'restore', 'stash', 'checkout'")
  && workspaceGitSrc.includes('DESTRUCTIVE_COMMANDS') && workspaceGitSrc.includes('needMessage: true')
  && serverSrc.includes('classifyCommand(cmd, args)') && serverSrc.includes('assertRepoGitWrite(req, b.repo, cls.write)')
  && serverSrc.includes("permissions.assertCan(req.user, acl, 'write')")
  && app.includes('破坏性 Git 操作确认') && app.includes('needMessage') && app.includes('needHash'),
'Git 写操作：commit/push/merge-abort/revert/reset 等白名单 + 破坏性二次确认 + 仓库级写权限校验（v0.4.31 精确分类）');

// v0.4.16 B 批②：新建仓库内联凭据/代理/TLS + 自动克隆工作区；列表去代理按钮、IDE 直达。
note(gitSourcesSrc.includes('function effectiveSource') && gitSourcesSrc.includes('autoWorkspace')
  && gitSourcesSrc.includes('repo.workspace = await cloneRepo') && gitSourcesSrc.includes('repo.workspaceError')
  && app.includes('function openRepoIdeDirect') && app.includes('data-ide-direct')
  && app.includes('syncRepoAuthFields') && !app.includes('data-proxy-repo')
  && html.includes('name="autoWorkspace"') && html.includes('id="repo-git-input"'),
'新建仓库内联凭据/代理/TLS + 自动克隆工作区；列表去代理按钮、IDE 直达、Git 自定义命令输入');

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

// v0.4.27：代理地址说明清晰化 —— placeholder 明确「只填一个值 + direct 直连 + 留空继承」，
// 且代理页顶部有权威「代理地址怎么填」四选一格式卡；禁止退回晦涩的斜杠堆叠写法。
note(html.includes('代理地址怎么填')
  && html.includes('每个代理框<b>只填一个值</b>')
  && html.includes('不走代理的地址（NO_PROXY）'),
'代理页顶部有「代理地址怎么填」四选一格式说明卡');
note(!/placeholder="http:\/\/127\.0\.0\.1:7890 \/ socks5/.test(html)
  && !/placeholder="http:\/\/127\.0\.0\.1:7890 \/ socks5/.test(app)
  && (html.match(/填一个地址：如 http:\/\/127\.0\.0\.1:7890/g) || []).length >= 5,
'代理输入框已改为「填一个地址」清晰文案，无斜杠堆叠占位符');

// v0.4.28：「测试全局代理」结果框必须与按钮同卡（此前被放在页底「优先级规则」卡，
// 点顶部按钮无可见反馈）；且成功 / 失败两条分支都要 toast，不能只写隐藏/异地元素。
{
  const btnIdx = html.indexOf('id="proxy-test-global"');
  const resIdx = html.indexOf('id="proxy-test-result"');
  const between = btnIdx >= 0 && resIdx > btnIdx ? html.slice(btnIdx, resIdx) : '';
  const sameCard = between !== '' && !between.includes('<div class="card"');
  note(sameCard && (html.match(/id="proxy-test-result"/g) || []).length === 1,
    '测试全局代理：结果框与按钮同卡且唯一（不再藏在页底优先级规则卡）');
  const m = app.match(/\$\('#proxy-test-global'\)\.addEventListener\([\s\S]*?\n\}\);/);
  const handler = m ? m[0] : '';
  note(/\btoast\(/.test(handler) && /测试失败/.test(handler) && /测试成功|全局代理可用|直连成功/.test(handler),
    '测试全局代理：成功与失败均有 toast 明显提示');
}

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
