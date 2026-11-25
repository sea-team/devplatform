# DevPlatform · 给接手 AI 的接入说明（单文件版，可整篇贴给新会话）

> **用法**：把本文件 `【开始粘贴】` 到 `【结束粘贴】` 之间的内容整篇复制，作为新 AI 会话的第一条消息。它假设接手者刚拿到 `sea-team/devplatform` 仓库、还没读过任何代码。
> 本文 = 启动简报（动作 / 红线 / 命令）+ 详细手册（架构 / 踩坑 / 速查）合一，**不依赖其它文档**；功能清单另见仓库 `README.md`，版本演进见 `release-notes.md`。
> 基线：v0.4.30 / 2026-11-24 / 缓存戳 `20261125a` / typecheck 基线 `78`（实测 75）/ 前端护栏 202 条 / 后端路由 282 条。**升版本或改缓存戳时只需同步维护这一个文件。**
> **工作区待发版改动**：v0.4.31 阶段「Git 工作台（TortoiseGit 式）」已完成实现与本地验证（README §70），并按复核结论修复了 4 个 P1 功能 Bug / 6 项 P2（README §70.5）；版本号仍 `0.4.30`、未打 tag、未发 Release、未部署 246。接手时先 `git status` 确认这批未提交改动存在；**不要擅自 commit / push / 打 tag / 升版本号 / 部署**，须等用户明确指令。新增关键文件：`platform/src/gitView.js`、`scripts/smoke-git-workbench.js`（后端全链路）、`scripts/smoke-git-workbench-frontend.js`（前端交互级行为测试）。

---

## 【开始粘贴】

你现在的任务是接手 **DevPlatform（统一 Web 开发管理平台）** 的开发。请先按下面的顺序建立上下文，再动手改任何代码。

---

### 第一部分 · 启动简报（先读，照着做）

#### 1. 先认清这个项目

它**不是**常规 Web 项目：没有 React/Vue、没有构建步骤、没有 Express、没有 ORM、没有 WebSocket、没有单元测试套件。它是：

- 一个 **Node.js 单进程**（`platform/src/server.js` 是唯一入口），用自研的 232 行 HTTP 框架 `platform/src/mini.js` 分发请求；
- 前端是**原生 JS 单页**（`platform/public/index.html` 常驻 35 个 `<section class="page">`，`app.js` 是多标签工作台 + 全局事件委托）；
- 状态只有**一个 `data/state.json`**；
- 流式输出（SSH 终端 / AI 会话 / 容器终端）统一用 **SSE**，不用 WebSocket。

当前规模（工作区当前代码实测，非 HEAD 提交态）：42 个后端模块 / 17991 行 / **282 条路由**（全在 `server.js`）/ 前端 `app.js` 9477 行 / 202 条自检护栏。行数口径：后端 = `platform/src/*.js` 全部 `wc -l` 之和，前端 = `public/app.js` 行数，护栏 = `scripts/check-frontend.js` 的 `note()` 数（可用 `wc -l platform/src/*.js | tail -1`、`grep -c 'note(' scripts/check-frontend.js` 复核）。运行环境：线上 `10.0.0.246:9000`（Debian 9 宿主机、无 Node、Docker Hub 不可达；平台跑在 `node:20-alpine` 容器里）。

#### 2. 动手前必须先做的 4 件事

```bash
cd devplatform
git status                                   # 确认工作区是否干净
git log -5 --oneline                         # 看最近改了什么
node -p "require('./platform/package.json').version"   # 当前版本（本简报基线 0.4.30）
grep "const CACHE_STAMP" scripts/check-frontend.js     # 当前缓存戳（基线 20261125a）
```

然后读两处（**不要一上来通读全部源码**）：本文第 4 节（红线）、第 6 节（验证链），以及 `scripts/check-frontend.js` 中与你任务相关的护栏——别和护栏对着干，护栏记录了历史 bug。需要架构细节时再查本文第二部分。

#### 3. 加功能的固定动作清单

- **后端**：在 `platform/src/server.js` 注册路由 → 业务逻辑放 `platform/src/<模块>.js` → **新模块要加进 `platform/package.json` 的 `check` 脚本清单** → 列表用 `visible(req, items)` 过滤归属、写操作走 `permissions.guard()` / `dockerPanel.assertWritable()` + 破坏性操作要 `confirm` + 写 `audit()` 日志 → 用 `wrap(async (req,res)=>...)` 和 `ok()/badRequest()` 等封装。
- **前端**：`index.html` 加静态 DOM（保留所有 `id`，静态搬家优于动态复制）→ `app.js` 加逻辑与事件委托 → `style.css` → **升缓存戳** → **在 `scripts/check-frontend.js` 加一条 `note()` 护栏**（同时断言「正确写法存在」和「错误写法不存在」）。
- **UI 偏好**：用户明确要求用**弹窗**（`.modal` + 遮罩，放在 `#content` 外），不要做成页面底部页内卡片或跳页；Esc 关闭要「后开的优先」；行内 `<select>` 统一挂 `.ui-select` 类。
- **文档**：改完更新 `release-notes.md`（追加/修订本版段）和 `README.md` 对应章节。发布时 CI 会把**整篇 `release-notes.md`** 写进 Release notes。

#### 4. 六条红线（违反会直接造成线上故障）

1. **缓存戳必须同步**：改了 `app.js` / `style.css` / `index.html` 任一前端文件，就要把 `index.html` 里 `app.js?v=` 与 `style.css?v=` 两个戳改成同一个新值，**并且**同步改 `scripts/check-frontend.js` 的 `CACHE_STAMP`。漏了会让你误判「改动没生效」。
2. **类型棘轮只许降不许升**：`npm run typecheck --prefix platform` 的错误数基线是 **78**（`scripts/typecheck-baseline.json`）。新增代码若报 checkJs 错误，用 JSDoc `@param` / `@returns` 把类型标注清楚消掉，**绝不调高基线**。
3. **事件委托必须写 `e.target.id`**：绝不能写 `e.id`（事件对象没有 `id` 属性，恒 `undefined`，按钮会完全无响应——v0.4.30 就因此修过一次）。按钮内含子元素时用 `e.target.closest('[data-xxx]')`。
4. **路由按注册顺序匹配**：`mini.js` 遍历 `routes[]`，参数路由（如 `/api/docker/apps/:name`）会抢先吃掉同前缀的单段路径。新增路由要么放在参数路由**之前**，要么改成多段路径（历史修法：`config/mirror` → `config/daemon-json`）。
5. **凭据绝不入库**：`.env`、`data/state.json`、`*.pem`、`id_rsa*` 已在 `.gitignore` 中排除。提交前跑 `git add -A -n | grep -E '\.env|state\.json'` 确认。注意**唯一例外**：`platform/appstore/**/.env` 是官方模板样例、有白名单，**必须入库**，否则 clone 后应用商店全缺配置。
6. **别把 `sk-` 类串带进提交**：Dify 系列应用模板官方自带 `SECRET_KEY=sk-...` 示例串，会触发 GitHub **Push Protection (GH013)** 拦下 push。已统一替换成 `REPLACE_WITH_YOUR_OWN_SECRET_KEY`（4 个 `.env` + 4 个 `docker-compose.yml`，共 8 处）。**每次重跑 `scripts/sync-appstore.js` 后必须重新替换**；若已被拦截，要 `git commit --amend` 掉未推送的提交（只改工作区追加 commit 没用，历史 blob 仍会被扫）。

#### 5. 提交与发版

日常改动：`git add -A && git commit -m "..." && git push origin main`。

**发版流程**（v0.4.30 实际走通，可复用）：

1. 升版本号：`platform/package.json` **和** `platform/package-lock.json`（lock 里有 **2 处** `version`）一起改。`server.js:localVersion()` 源码直跑（246 容器）读 `package.json`；exe/热更新模式才读 `dist/release.json`。**`platform/dist/` 被 gitignore 忽略、CI 会重建，不要手改**。
2. 更新 `release-notes.md` 与 `README.md` 对应内容（版本头、`README.md` 的 §1.1.1 当前状态、相关版本章节的状态行）。
3. 跑第 6 节验证链 → commit + push `main` → 重部署 246 确认 health 版本号已变。
4. 打 tag 推上去，**CI 自动发布 Release**：

```bash
git tag -a v0.4.31 -m "..."     # tag 必须打在版本升级那个 commit 上
git push origin v0.4.31
```

`.github/workflows/release.yml` 在 windows-latest 上跑 `npm ci → npm run build → fetch-services.ps1 → pack-dist.ps1 → pack-release.ps1 → gh release create`，产出 6 个资产（dist / windows / windows-lite / services / exe / SHA256SUMS.txt）。本机**没有 `gh` CLI**，但 CI 自带；用匿名 API 查状态：`https://api.github.com/repos/sea-team/devplatform/actions/runs?per_page=3` 和 `/releases/tags/<tag>`。

#### 6. 改完必须跑完这条验证链（不能只看本地）

```bash
cd devplatform
npm run check --prefix platform              # 语法检查（新增 src 模块记得进 check 清单）
npm run typecheck --prefix platform          # 必须显示「✔ 未超过基线」（78）
node scripts/check-frontend.js               # 必须「✔ 前端自检全部通过」（202 护栏 + VM boot）
```

然后**部署到 246 实测**：

```bash
MSYS_NO_PATHCONV=1 DEPLOY_DIR=/data/platform node scripts/remote.js deploy 10.0.0.246
```

Windows Git Bash 必须带 `MSYS_NO_PATHCONV=1`（否则 `/data/platform` 会被转义成本机路径）。部署脚本会自动打包上传、重启容器、健康检查、环境体检（应为 **8 正常 / 0 提醒 / 0 异常**）。

线上验收：

```bash
curl -s http://10.0.0.246:9000/api/health                    # version 应等于 package.json 版本、mode=normal
curl -s http://10.0.0.246:9000/index.html | grep -o 'app.js?v=[0-9a-z]*'   # 缓存戳应为新值
```

- 接口鉴权：`Authorization: Bearer <ADMIN_TOKEN>`（token 从 246 的 `/data/platform/.env` 读），或 URL 带 `?token=`；浏览器存 `localStorage.dp_token`。
- 在 246 上执行脚本用 `MSYS_NO_PATHCONV=1 node scripts/remote.js exec 10.0.0.246 "<命令>"`；宿主机**没有 node**，解析 JSON 用 `python3`（3.5，需 `.read().decode('utf8')`）。
- 测试产生的会话 / 临时文件**记得清理**（如 `/terminals` 应返回空）。

#### 7. 明确不要做的事

不要调高 typecheck 基线；不要删 `check-frontend.js` 的护栏；不要把模板 `.env` 加回忽略；不要打乱 `/api/` 路由注册顺序；不要用 Express 重写 `mini.js`；不要自己 `JSON.stringify` 后传给前端 `api()`（要传对象，让 `api()` 自动设 `content-type`，否则 params 全丢）；不要在未经用户明确授权时擅自 commit / push / 升版本号 / 打 Release。

---

### 第二部分 · 详细手册（遇到具体问题时查）

#### 8. 目录地图

```
devplatform/
├─ platform/
│  ├─ src/                  # 后端，42 个模块，1.7 万行；server.js 是唯一入口 + 282 条路由
│  ├─ public/               # 前端：index.html / app.js / style.css / vendor/
│  │  └─ vendor/            # xterm.min.js、addon-fit.min.js、codemirror*、qrcode.js（顺序不可乱）
│  ├─ appstore/             # 宝塔官方应用模板（320 应用目录 / 314 有效模板 / 1272 文件 / 319 个模板 .env）
│  ├─ build.mjs             # 构建 dist/（bundle.cjs + public + release.json + exe）
│  ├─ launcher/             # 单文件 exe 的引导器（首启释放资源）
│  ├─ package.json          # ★ 版本号权威来源 + npm scripts
│  └─ package-lock.json     # ★ 版本号也要同步改（2 处）
├─ scripts/
│  ├─ remote.js             # 部署 / 远程执行 / 状态（deploy|exec|script|stop|status|probe）
│  ├─ check-frontend.js     # ★ 前端静态自检 + VM boot + 202 条护栏
│  ├─ typecheck.js / typecheck-baseline.json   # ★ checkJs 棘轮
│  ├─ sync-appstore.js      # 从 aaPanel/appstore 同步官方应用模板
│  └─ smoke-*.js / api-sweep.js / verify.js / api-audit.js   # 各类巡检脚本
├─ windows/                 # Windows 安装 / 打包 / 集成服务二进制获取（PowerShell + bat）
├─ .github/workflows/release.yml   # ★ 推 v* tag 触发，构建并发布 Release
├─ .env.example             # 环境变量清单（真实 .env 不入库）
├─ data/state.json          # ★ 运行时状态与凭据（不入库，600 权限）
├─ workspace/               # 克隆的仓库 / 构建产物（不入库）
├─ docs/                    # 本文（AI 接入说明）
├─ README.md                # 功能说明（§1–§70，按版本演进）
└─ release-notes.md         # 发布说明（CI 会把它整篇写进 Release notes）
```

#### 9. 后端架构

**9.1 入口与自研 HTTP 层（`mini.js`）**

`platform/src/server.js` 只剩 `createApp()` + 路由注册，**没有 Express**。`dispatch` 的固定顺序（改代码前必须理解）：

1. `decorateResponse`：给 `res` 挂 `.json()` / `.status()` / `.sendFile()`；若注入了 `authGate.filterResponse`，**包一层响应过滤**（普通用户看不到他人资源）。
2. `new URL(req.url)` 解析；`decodeURIComponent(parsed.pathname)` 只做**一次**（二次解码会让 `%25xx` 绕过权限、或抛 URIError 打挂进程）。
3. **非 `/api/` 路径** → `serveStatic()`：读得到文件就返回，读不到一律 fallback `index.html`；带目录穿越防护。
4. `/api/` 路径 → 身份解析（`authGate.identity`），未登录且非公开路径 → 401。
5. 遍历 `routes`，用 `matchPattern()` 匹配：支持 `:id` 与 `*` 通配（`*` 捕获存 `params[0]`、`params[1]`…）。**先注册先命中**（见红线 4）。
6. `readBody()`：仅 POST/PUT/PATCH/DELETE 解析；`content-type: application/json` → `JSON.parse`；默认 2 MB，`options.bodyLimit` 可放宽，`options.raw` 走 Buffer（默认 100 MB，用于上传）。
7. `authGate.authorize(req, pathname)` → 403/401；`withUser()` 用 `AsyncLocalStorage` 把 `req.user` 注入上下文（业务模块用 `core.currentUser()` 取）。
8. `route.handler(req, res)`；异常统一收敛成 `{ok:false,error,status}`；`dispatch` 外层还有 `Promise.resolve(...).catch()` 兜底，防止 unhandledRejection 终止进程。

加路由模板：

```js
app.get('/api/xxx/list', wrap(async (req, res) => {
  const items = visible(req, state().xxx || []);       // 列表要过滤归属
  ok(res, { items });
}));

app.post('/api/xxx/:id/do', wrap(async (req, res) => {
  const body = req.body || {};
  if (!body.confirm) throw badRequest('需要二次确认');   // 破坏性操作
  await update((s) => { s.xxx = s.xxx.filter((x) => x.id !== req.params.id); });
  ok(res, { removed: req.params.id });
}));
```

`wrap(fn)` = `Promise.resolve(fn(req,res)).catch(e => fail(res,e))`；`ok/fail/badRequest/notFound/conflict/upstream` 都来自 `core.js`。错误状态码由 `inferStatus()` 推断，客户端错误务必带显式 `status`，否则会被兜底猜成 502/500。

**9.2 状态与配置（`core.js`）**

- **单一状态文件** `data/state.json`（`DATA_DIR` 可覆盖），`state()` 读、`save()` 写、`update(mutator)` 带事务式快照回滚（mutator 抛错会还原内存，防状态分裂）。
- `save()` 强制 `0600`；`DATA_DIR` 目录 `0755`（不能 700，否则容器内其它用户读不到）。
- `.env` 查找顺序：`ROOT/.env` → cwd `.env`。`OWNED_COLLECTIONS` 是归属集合白名单；新建用户数据必须 `permissions.assignOwner()` 补 `ownerId` / `collaborators`。
- `DP_ROOT`：编译成单文件 exe 时由 `launcher.js` 注入，指向 exe 所在目录；不设时 `ROOT = platform/`，线上容器不受影响。

**9.3 鉴权与权限（改任何接口前必读）**

`platform/src/auth.js`：

| 概念 | 说明 |
|---|---|
| `DP_AUTH_MODE` | `off`（应急回退，全 admin）/ `optional`（匿名只读灰度）/ `required`（默认） |
| 身份来源优先级 | `isCliRequest`（loopback + `x-dp-cli:1` + CLI 路径）→ `ADMIN_TOKEN`（`Authorization: Bearer` 或 `?token=`，等价管理员）→ Cookie `dp_session` |
| `PUBLIC_PATHS` | `/api/health`、`/api/auth/login`、`/api/auth/status`、`/api/auth/2fa` |
| `CLI_PATHS` | `/api/auth/reset-password`、`/api/system/reload` |
| 2FA | 账号级失败限速（按 userId，5 次锁 1 分钟） |

`platform/src/permissions.js`：

- 角色：`admin` 全权；`owner` 全权；`collaborator`（`read` 只读 / `write` 可操作但**不能删除、不能改协作者**）。
- `visible(user, items)` 过滤列表；`guard(req, pathname)` 在分发层按 body/params 里的 id 做对象级判定；`GLOBAL_WRITE_PATTERNS` 里的路径**仅管理员可写**（如 `/^\/api\/docker\//`）。
- **响应兜底过滤**：`server.js:filterResponse()` 自动裁剪 `data.items` 里不属于当前用户的对象；但 `/api/ai/sessions` 被显式排除（轨迹里含合法资源 id，通用裁剪会误删）。
- 新增「用户可创建的数据」时：加入 `OWNED_COLLECTIONS` → 创建时 `assignOwner` → 列表用 `visible` → 单条操作走 `guardById`。

**9.4 模块清单（按职责）**

| 模块 | 职责 |
|---|---|
| `mini.js` / `core.js` / `auth.js` / `permissions.js` | 基础设施层（HTTP / 状态 / 身份 / 权限） |
| `integrations.js` | 外部 HTTP 调用：Gitea / OpenList / code-server / AI Provider / 本地 CLI 探测 |
| `engine.js` | 构建 Profile、构建/部署执行、AI 运维 Agent 的只读命令白名单 |
| `remoteOps.js` | SSH/SFTP：远程终端、文件管理、状态采集 |
| `gitSources.js` / `repoImporter.js` / `gitRuntime.js` / `workspaceGit.js` | 外部 Git 源、压缩包导入、Git 运行时探测、工作区 Git 命令白名单 |
| `openlist.js` / `rclone.js` / `storageGateway.js` / `driveMount.js` / `userDirs.js` | 存储层：OpenList 多连接、rclone 挂载、SMB/WebDAV 网关、Windows 网络盘、用户家目录隔离 |
| `dockerApi.js` / `dockerPanel.js` / `dockerApps.js` / `dockerExecTerm.js` / `remoteDocker.js` | Docker：Engine API 封装、面板与归属、应用商店、交互式 PTY、远端 Docker |
| `proxy.js` / `environment.js` / `envConfig.js` / `aiNetworkPolicy.js` | 四级代理覆盖、环境档案推导与体检、`.env` 白名单读写、SSRF 属地分级 |
| `extensions.js` / `extRuntime.js` / `extLifecycle.js` / `backup.js` / `dbgateSync.js` / `serviceSetup.js` / `serviceCredentials.js` / `hostInfo.js` / `buildBackends.js` / `catalog.js` / `archive.js` / `fileTypes.js` | 扩展安装/备份/rebuild、集成服务凭据、编译环境降级、模板字典、压缩包、文件类型 |
| `aiSessions.js` / `aiChat.js` / `dshTerminal.js` | AI 会话两页并存：会话落库 owner 隔离、AI 运维、DeepSeek Harness 终端 |
| `server.js` | **唯一路由注册处**：282 条，按前缀分组（docker 42 / openlist 37 / ai 34 / rclone 25 / extensions 23 / servers 21 / proxy 14 / auth 10 / repos 9 / …） |

**9.5 流式输出：统一 SSE，不用 WebSocket**

三个模块各自实现同构的会话模型：`remoteOps.js`（SSH）、`dshTerminal.js`（AI 终端）、`dockerExecTerm.js`（容器 PTY）。模式固定：

```
POST /xxx/open      → 返回 { sid }，会话存进模块内 sessions Map，带 ownerId
GET  /xxx/stream    → text/event-stream，每帧 `data: <base64>`；无订阅者时缓存最近 N 帧(pending)
POST /xxx/input     → 校验 sid + owner，送键盘输入
POST /xxx/resize    → 同步窗口尺寸
POST /xxx/close     → 关闭并回收
GET  /xxx/terminals → 列出当前用户会话
```

- 输出用 **base64** 编码原始字节（前端 `atob` → `Uint8Array` → `term.write(bytes)`），避免 SSE 文本帧破坏二进制/ANSI。
- 后端以 200 结束流时发 `event: closed`，**前端必须 `EventSource.close()`**，否则浏览器每 3 秒自动重连刷屏。
- 会话按 `ownerId` 归属：`attachStream` / `input` / `resize` / `close` 逐入口校验，非法 sid → 403；15 分钟空闲且无订阅者自动回收。
- Docker 本机走 Engine API **connection hijack**：`POST /containers/{id}/exec`（`Tty=true` + `AttachStdin`）→ `POST /exec/{id}/start` 带 `Connection: Upgrade` / `Upgrade: tcp`，Node `http.request` 的 `upgrade` 事件拿双向裸 socket。`Tty=true` 时输出是**原始字节、无 8 字节 multiplexing 帧头**，可直接喂 xterm。远端 `target=server:<id>` 走 `ssh2` pty 执行 `docker exec -it [-u root] <id> <shell>`，命令用 `shq()` 防注入。

#### 10. 前端架构

- `index.html` 里 35 个 `<section class="page" id="view-XXX">` 常驻 DOM，**没有路由库**。`switchView(view)` → `openModuleTab(view)` → `registerTab()` / `newPane()` / `activateTab()`，标签存在 `const tabs = new Map()` 并持久化。三类标签：模块页（`module:xxx`）、文件/编辑器、终端。
- 弹窗两类：`.modal`（真弹窗，如 `#dk-modal`、`#repo-clone-modal`、`#repo-files-modal`）与 `.as-modal`（把页内卡片浮层化，配 `#card-modal-mask`）。**新功能优先用弹窗**；静态搬家优于动态复制（保留所有 `id`，不破坏已有事件绑定）。
- `api(path, options)`：自动加 `Authorization: Bearer <localStorage.dp_token>`；`body` 是对象时自动 `JSON.stringify` 并设 `content-type: application/json`（**不要自己 stringify**）；按 400/404/409/502/500 分类错误并保留 `hint`；401 且非 `/auth/` 触发 `invalidateSession()`。
- `streamToken()` 给 SSE / 下载 URL 拼 `&token=...`（EventSource 不能带 header）。
- `xterm` 相关 vendor **加载顺序固定**：`xterm.min.js` → `addon-fit.min.js` → `codemirror.js` → `cm-modes.js` → `cm-addons.js` → `qrcode.js` → 最后 `app.js`。`check-frontend.js` 有护栏锁死。
- **缓存戳机制**：`index.html` 里 `style.css?v=20261125a` 与 `app.js?v=20261125a` 两个戳必须相同，且等于 `scripts/check-frontend.js` 的 `const CACHE_STAMP`。`mini.js` 的 `sendFile` 发 `cache-control: no-cache`，但版本号仍是必要防线。

#### 11. 数据与外部依赖

**11.1 应用商店（`platform/appstore/`）**

来自官方 `aaPanel/appstore`，用 `scripts/sync-appstore.js` 同步。目录格式：

```
apps/<appname>/
├─ app.json                      # 元数据：appname/apptype/appversion/field[]/icon…
├─ ico-dkapp_<appname>.png
└─ <真实版本目录>/                # ★ 目录名 = appname（不是 appversion！）
   ├─ docker-compose.yml
   └─ .env                       # 大写键的模板变量
```

解析规则（`dockerApps.js`）：

- **版本目录发现**：按「含 `docker-compose.yml` 的子目录」找，不能按 `appversion` 拼路径；`appversion` 只是镜像 tag 来源。
- **`field.attr` 是小写**（`mysql_port`），`.env` 键是**大写**（`MYSQL_PORT`），`prepare()` 建立大小写映射后合并表单参数；现有非空值保留（不吞 `0` / `false`）。
- **`allow_access`** 复选框不在 `.env` 中，映射成 `HOST_IP=0.0.0.0|127.0.0.1`。
- 配置说明取官方 `field.suffix`，按 `type` 渲染 checkbox / textarea / number / password / text。
- 镜像加速双模式：默认宝塔式（`daemon.json` 的 `registry-mirrors`，compose 保持官方镜像名）；可选 `compose` 换源（改写 compose 里的镜像前缀）。
- `.gitignore` 有 `!platform/appstore/**/.env` 白名单——**模板 `.env` 必须入库**。

> ⚠️ Dify 系列模板官方自带 `SECRET_KEY=sk-...` 示例串，触发 **GitHub Push Protection (GH013)**。已替换为 `REPLACE_WITH_YOUR_OWN_SECRET_KEY`（8 处）。**每次重跑 `sync-appstore.js` 后必须重新替换**，替换后要 `git commit --amend` 掉未推送的 commit。

**11.2 环境变量**

`ADMIN_TOKEN`、`GITEA_*`、`OPENLIST_*`、`CODE_SERVER_*`、`BUILD_EXECUTOR`、`HOST_WORKSPACE_DIR`、`DOCKER_IMAGE_PREFIX`、`DP_AUTH_MODE`、`DP_CLI_SECRET`、`DP_TLS_INSECURE`、`DP_PROXY_*`、`DP_REMOTE_TMP_DIR` 等（完整清单 `.env.example`）。真实 `.env` 与 `data/state.json` **绝不入库**；`windows/bin|bootstrap|runtime`、`.native-probe/` 也不入库。

#### 12. 硬约定与历史踩坑（扩展版）

**12.1 类型检查棘轮**：`npm run typecheck` 用 `tsconfig.typecheck.json`（`allowJs` + `checkJs` + `noEmit`）全量检查 `src/**/*.js`，错误数不得超过 `scripts/typecheck-baseline.json` 的 `maxErrors: 78`。新增代码报错用 **JSDoc `@param` / `@returns`** 消掉（v0.4.30 的 `dockerExecTerm.js openSession()` 就是这么修的），**不要改基线**。

**12.2 前端自检即「测试」**：`node scripts/check-frontend.js` 做两件事——① 202 条静态断言（DOM id 引用完整性、section/page 数量、脚本加载顺序、缓存戳唯一性、各功能接线、历史 bug 回归护栏）；② 用轻量 DOM stub 在 `vm` 里执行 `app.js` 跑一遍 boot，捕获顶层异常与未处理 Promise 异常，并模拟多标签创建/切换/关闭。**加新功能请顺手加一条 `note()` 护栏**。

**12.3 二次确认与归属**：破坏性操作要求 `body.confirm === true` 或 query `confirm=true`；非平台自建容器（`isOwned()` 判定 `createdBy === 'bt_apps'` / `dp-(ext|build)-` 前缀）默认只读。Docker 全部写接口命中 `/^\/api\/docker\//` 全局护栏，**仅管理员**；GET（logs/inspect/stats）读权限可放行。新增写接口复用 `dockerPanel.assertWritable()` / `permissions.guard()` 并写 `dockerPanel.audit(...)`。

**12.4 已踩过的坑**

| 坑 | 正确做法 |
|---|---|
| `body: JSON.stringify(...)` 传给 `api()` | 传对象，让 `api()` 设 `content-type`；否则 params 全丢 |
| 部署排除 `.env` 误杀模板 | `remote.js:isExcludedFile(name, relDir)` 只排除**根** `.env`/`state.json`，子目录模板放行，`.env.bak.*` 全层级排除 |
| 本机部署「缺少 serverId」/ `docker-compose ENOENT` | 支持 `serverId === 'local'`；容器内自动 `apk add docker-cli docker-cli-compose` 后用绝对路径 spawn |
| `spawn git ENOENT` | `gitRuntime` 探测宿主机 Git + SSH 回连兜底；超时杀整进程组，不留孤儿 |
| 周期性地被 `git reset` 还原未提交改动 | 冒烟脚本里 `git -C <dir>` 会向父目录找外层 `.git`；临时目录不要放在平台仓库内 |
| 畸形 URL 编码打挂进程 | `dispatch` 里对 `decodeURIComponent` 做 try/catch → 400；`matchPattern` **不再二次解码** |
| 前端 SSE 自动重连刷屏 | 收到 `event: closed` 主动 `source.close()` 并置 `null` |
| 镜像 tag 冒号被误判为 registry 端口 | `resolveImage()` 里只在合法位置切分端口 |
| SSRF | 三处用户可控 baseURL 入口都过 `aiNetworkPolicy` 属地分级 |

#### 13. 不同运行形态下路径与版本号的差异（易错）

项目有 5 种运行形态（`README.md §2`）：源码直跑、compose full、`remote.js` 远程部署（**当前 246 线上采用**）、单文件 exe（SEA）、Release 绿色包。

| 形态 | `ROOT` / `appRoot` | 版本号来源 | 应用模板位置 |
|---|---|---|---|
| 源码直跑 / 246 容器 / systemd | `platform/`（未设 `DP_ROOT`） | `platform/package.json` | `platform/appstore/` |
| 单文件 exe / 绿色包 | exe 所在目录（`DP_ROOT` 由 launcher 注入，指向 `dist/`） | `dist/release.json` | `dist/appstore/`（首启从 `appstore.tar.gz` 释放） |
| `remote.js` 部署 | `/data/platform/platform/` | 源码 → package.json | 整仓 tar 打包，天然包含 |

**改路径相关代码时三种形态都要能跑通**；不要假设 `appRoot` 一定等于 `platform/`。`platform/dist/` 被 gitignore 忽略、CI `npm run build` 重建。

#### 14. Windows 分发链

`build.mjs`：`bundle.cjs`（esbuild 打包）+ `public/` + `release.json`（含 bundle/public/appstore 的 sha256 清单）+ `appstore.tar.gz`（作 SEA asset 内嵌）+ `devplatform.exe`（postject 注入 SEA blob）。**管理员提权清单必须在 postject 之前注入**（反序会破坏 blob）。`launcher.js` 首启释放资源到 `dist/`。`pack-dist.ps1` / `pack-release.ps1` 生成组件包 / 全量包 / 轻量包 / 服务包。`check-frontend.js` 有 4 条护栏锁死这条链，别拆。

#### 15. 关键文件速查

| 需求 | 文件 |
|---|---|
| 加后端路由 | `platform/src/server.js` |
| HTTP 框架行为 | `platform/src/mini.js` |
| 状态 / 配置 / 错误封装 | `platform/src/core.js` |
| 身份 / 权限 | `platform/src/auth.js`、`platform/src/permissions.js` |
| 前端页面 DOM | `platform/public/index.html` |
| 前端逻辑 / 事件 | `platform/public/app.js` |
| 样式 | `platform/public/style.css` |
| 自检护栏 | `scripts/check-frontend.js` |
| 类型基线 | `scripts/typecheck-baseline.json` |
| 部署 | `scripts/remote.js` |
| 应用模板同步 | `scripts/sync-appstore.js` |
| 构建 exe | `platform/build.mjs`、`platform/launcher/launcher.js` |
| Windows 打包 | `windows/pack-dist.ps1`、`windows/pack-release.ps1` |
| CI 发布 | `.github/workflows/release.yml` |
| 版本与脚本 | `platform/package.json`、`platform/package-lock.json` |
| 发布说明 | `release-notes.md`（CI 整篇写入 Release notes） |
| 功能总览 | `README.md` |

#### 16. 现象 → 排查速查表

| 现象 | 先查 |
|---|---|
| 前端改了没生效 | 缓存戳是否同步升；`index.html` 两个 `?v=` 是否一致 |
| 按钮点了没反应 | 事件委托里是不是写成了 `e.id` |
| 新接口 404 / 被别的接口吃掉 | `server.js` 里参数路由的注册顺序 |
| 类型检查报错变多 | 用 JSDoc 标注参数类型，不要调基线 |
| push 被 GH013 拦 | appstore 里 Dify 的 `sk-` 串；amend 掉未推送 commit |
| 线上 health 版本不对 | `package.json` 是否升了、是否重部署了 246 |
| 不确定约定 | 本文第 4 节（红线）与第 12 节（硬约定与踩坑） |

---

**现在请告诉我你理解到的项目基线，以及这次要做的具体任务，再开始动手。**

## 【结束粘贴】

---

### 附：给交付方（人类）的备注

- 本文件是**唯一**需要投喂给新 AI 的文档：第一部分（§1–§7）是启动简报，第二部分（§8–§16）是架构细节与速查表。两者编号连续、无互相跳转。
- 若未来升版本、改缓存戳或调整基线，**只需同步维护这一个文件**中的对应数字（当前：0.4.30 / 20261125a / 78 / 282 路由 / 202 护栏 / 42 模块 / 35 view / 8 正常体检）。
- 旧的两份文档 `AI-DEVELOPMENT-GUIDE.md` / `AI-ONBOARDING-BRIEF.md` 已由本文件取代，可保留作历史归档，但不要再作为投喂入口，以免两份数字不一致。
