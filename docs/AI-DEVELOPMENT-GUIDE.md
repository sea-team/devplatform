# DevPlatform 实现说明 · AI 接入开发手册

> **⚠️ 本文已由 [`docs/AI-HANDOFF.md`](AI-HANDOFF.md) 取代**（单文件版：启动简报 + 手册合一，可整篇贴给新会话）。本文保留作历史归档，**请勿再作为投喂入口**；所有基线数字以 `AI-HANDOFF.md` 为准。
>
> 目标读者：需要接手本项目继续开发的 AI 模型 / 工程师。
> 本文描述**代码实际怎么跑、怎么改、怎么验证**，不复述功能清单（功能清单见 `README.md`，版本演进见 `release-notes.md`）。
> 基线版本：v0.4.30（2026-11-24）。读本文前请先确认 `platform/package.json` 的 `version` 是否仍是本文基线。

---

## 0. 三十秒定位（先看这里）

| 你要做的事 | 直接去哪 |
|---|---|
| 加/改一个后端 API | `platform/src/server.js`（路由集中在这里）+ 对应 `platform/src/<模块>.js` |
| 加/改一个前端页面 | `platform/public/index.html`（静态 DOM）+ `platform/public/app.js`（逻辑与事件）+ `style.css` |
| 改样式 | `platform/public/style.css` |
| 前端静态自检 / 护栏 | `scripts/check-frontend.js`（159 条 `note()` 断言） |
| 部署到测试机 246 | `scripts/remote.js deploy 10.0.0.246` |
| 发版 | 升版本号 → commit/push → 推 `v*` tag → CI 自动发布 Release |
| Windows 单文件 exe / 分发包 | `platform/build.mjs` + `windows/*.ps1` + `.github/workflows/release.yml` |

**最重要的三条硬约定**（违反会直接导致线上故障，详见 §5）：

1. 前端 `index.html` 里 `app.js?v=XXX` 与 `style.css?v=XXX` 的缓存戳**必须一致**，且改前端后必须同步升 `scripts/check-frontend.js` 的 `CACHE_STAMP`。
2. `npm run typecheck` 是 **checkJs 棘轮**：错误数基线 `scripts/typecheck-baseline.json` = 78，**只许下降不许上升**；新增代码要用 JSDoc 把类型错误消掉，不要调高基线。
3. 任何改动都要跑完 §6 的验证链，再部署 246 实测；本项目没有单元测试覆盖 Web 层，`check-frontend.js` 的 VM boot + 线上 smoke 就是主要防线。

---

## 1. 项目是什么 / 不是什么

- **是什么**：一个零框架、零 Express 依赖的 Node.js 单进程控制台 + HTTP API 网关，前端是原生 JS 单页（多标签工作台），后端通过 HTTP/SSH/Docker Engine API 去操作 Gitea、OpenList、code-server、目标服务器、Docker、AI Provider。
- **不是什么**：不是 SPA 框架（无 React/Vue/构建步骤）、不是 Express/Koa（自研 `mini.js` 路由）、没有 ORM（状态就是一个 `data/state.json`）、没有 WebSocket（流式输出统一用 SSE）。
- **运行形态有 5 种**（`README.md §2`）：源码直跑、compose full、`remote.js` 远程部署（**当前 246 线上采用**）、单文件 exe（SEA）、Release 绿色包。不同形态的**版本号读取与路径解析不同**，见 §3.1、§8。

### 1.1 目录地图

```
devplatform/
├─ platform/
│  ├─ src/                  # 后端，41 个模块，1.7 万行；server.js 是唯一入口 + 279 条路由
│  ├─ public/               # 前端：index.html / app.js / style.css / vendor/
│  │  └─ vendor/            # xterm.min.js、addon-fit.min.js、codemirror*、qrcode.js（顺序不可乱）
│  ├─ appstore/             # 宝塔官方应用模板（320 个应用目录 / 314 有效模板 / 1272 文件 / 319 个模板 .env）
│  ├─ build.mjs             # 构建 dist/（bundle.cjs + public + release.json + exe）
│  ├─ launcher/             # 单文件 exe 的引导器（首启释放资源）
│  ├─ package.json          # ★ 版本号权威来源 + npm scripts
│  └─ package-lock.json     # ★ 版本号也要同步改（2 处）
├─ scripts/
│  ├─ remote.js             # 部署 / 远程执行 / 状态（deploy|exec|script|stop|status|probe）
│  ├─ check-frontend.js     # ★ 前端静态自检 + VM boot + 159 条护栏
│  ├─ typecheck.js / typecheck-baseline.json   # ★ checkJs 棘轮
│  ├─ sync-appstore.js      # 从 aaPanel/appstore 同步官方应用模板
│  └─ smoke-*.js / api-sweep.js / verify.js / api-audit.js   # 各类巡检脚本
├─ windows/                 # Windows 安装 / 打包 / 集成服务二进制获取（PowerShell + bat）
├─ .github/workflows/release.yml   # ★ 推 v* tag 触发，构建并发布 Release
├─ .env.example             # 环境变量清单（真实 .env 不入库）
├─ data/state.json          # ★ 运行时状态与凭据（不入库，600 权限）
├─ workspace/               # 克隆的仓库 / 构建产物（不入库）
├─ README.md                # 功能说明（§1–§69，按版本演进）
└─ release-notes.md         # 发布说明（CI 会把它整篇写进 Release notes）
```

---

## 2. 后端架构

### 2.1 入口与自研 HTTP 层（`mini.js`）

`platform/src/server.js` 只剩 `createApp()` + 路由注册，**没有 Express**。所有 HTTP 语义由 `platform/src/mini.js` 提供（232 行）：

```
createApp({ adminToken, staticDir, errorStatus, authGate })
  ├─ app.get/post/put/delete(pattern, handler, options)   # 注册到 routes[]
  ├─ app.useStatic(dir) / listen(port)
  └─ dispatch(req, res)                                   # 唯一请求分发
```

`dispatch` 的固定顺序（改代码前必须理解）：

1. `decorateResponse`：给 `res` 挂 `.json()` / `.status()` / `.sendFile()`；若注入了 `authGate.filterResponse`，**包一层响应过滤**（普通用户看不到他人资源）。
2. `new URL(req.url)` 解析；`decodeURIComponent(parsed.pathname)` 只做**一次**（二次解码会让 `%25xx` 绕过权限、或抛 URIError 打挂进程）。
3. **非 `/api/` 路径** → `serveStatic()`：读得到文件就返回，读不到一律 fallback `index.html`（所以前端不需要 history fallback 配置）；带目录穿越防护。
4. `/api/` 路径 → 身份解析（`authGate.identity`），未登录且非公开路径 → 401。
5. 遍历 `routes`，用 `matchPattern()` 匹配：支持 `:id` 与 `*` 通配（`*` 捕获存 `params[0]`、`params[1]`…）。**路由按注册顺序匹配，先注册先命中**——这是最容易踩的坑，见 §5.4。
6. `readBody()`：仅 POST/PUT/PATCH/DELETE 解析；`content-type: application/json` → `JSON.parse`；默认 2 MB，`options.bodyLimit` 可放宽，`options.raw` 走 Buffer（默认 100 MB，用于上传）。
7. `authGate.authorize(req, pathname)` → 403/401；`withUser()` 用 `AsyncLocalStorage` 把 `req.user` 注入上下文（业务模块用 `core.currentUser()` 取）。
8. `route.handler(req, res)`；异常统一收敛成 `{ok:false,error,status}`；`dispatch` 外层还有 `Promise.resolve(...).catch()` 兜底，防止 unhandledRejection 终止进程。

**加路由的模板**（照抄即可）：

```js
// 简单同步 / 异步 handler
app.get('/api/xxx/list', wrap(async (req, res) => {
  const items = visible(req, state().xxx || []);       // 列表要过滤归属
  ok(res, { items });
}));

// 写操作：走 permissions.guard / assertWritable，带二次确认
app.post('/api/xxx/:id/do', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const body = req.body || {};
  if (!body.confirm) throw badRequest('需要二次确认');   // 破坏性操作
  await update((s) => { s.xxx = s.xxx.filter((x) => x.id !== id); });
  ok(res, { removed: id });
}));
```

`wrap(fn)` = `Promise.resolve(fn(req,res)).catch(e => fail(res,e))`；`ok/fail/badRequest/notFound/conflict/upstream` 都来自 `core.js`。错误状态码由 `inferStatus()` 推断，客户端错误务必带显式 `status`，否则会被兜底猜成 502/500。

### 2.2 状态与配置（`core.js`）

- **单一状态文件** `data/state.json`（`DATA_DIR` 可覆盖），`state()` 读、`save()` 写、`update(mutator)` 带事务式快照回滚（mutator 抛错会还原内存，防状态分裂）。
- `save()` 强制 `0600`；`DATA_DIR` 目录 `0755`（不能 700，否则容器内其它用户读不到）。
- `.env` 查找顺序：`ROOT/.env` → cwd `.env`（详见 `envFileCandidates()`）。`config` 对象集中所有环境变量读取。
- `OWNED_COLLECTIONS` 是归属集合白名单；新建用户数据必须 `permissions.assignOwner()` 补 `ownerId` / `collaborators`。
- `DP_ROOT`：编译成单文件 exe 时由 `launcher.js` 注入，指向 exe 所在目录；不设时 `ROOT = platform/`，线上容器不受影响。

### 2.3 鉴权与权限（改任何接口前必读）

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
- **响应兜底过滤**：`server.js:filterResponse()` 会自动裁剪 `data.items` 里不属于当前用户的对象；但 `/api/ai/sessions` 被显式排除（轨迹里含合法资源 id，通用裁剪会误删）。
- 新增「用户可创建的数据」时：加入 `OWNED_COLLECTIONS` → 创建时 `assignOwner` → 列表用 `visible` → 单条操作走 `guardById`。

### 2.4 模块清单（按职责，不是按字母）

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
| `extensions.js` / `extRuntime.js` / `extLifecycle.js` / `backup.js` / `dbgateSync.js` / `serviceSetup.js` / `serviceCredentials.js` / `hostInfo.js` / `buildBackends.js` / `catalog.js` / `archive.js` / `fileTypes.js` | 扩展安装/备份/ rebuild、集成服务凭据、编译环境降级、模板字典、压缩包、文件类型 |
| `aiSessions.js` / `aiChat.js` / `dshTerminal.js` | AI 会话两页并存：会话落库 owner 隔离、AI 运维、DeepSeek Harness 终端 |
| `server.js` | **唯一路由注册处**：279 条路由，按前缀分组（docker 42 / openlist 37 / ai 34 / rclone 25 / extensions 23 / servers 21 / proxy 14 / auth 10 / repos 9 / …） |

### 2.5 流式输出：统一 SSE，不用 WebSocket

三个模块各自实现同构的会话模型：`remoteOps.js`（SSH）、`dshTerminal.js`（AI 终端）、`dockerExecTerm.js`（容器 PTY）。模式固定：

```
POST /xxx/open      → 返回 { sid }，会话存进模块内 sessions Map，带 ownerId
GET  /xxx/stream    → text/event-stream，每帧 `data: <base64>`；无订阅者时缓存最近 N 帧(pending)
POST /xxx/input     → 校验 sid + owner，送键盘输入
POST /xxx/resize    → 同步窗口尺寸
POST /xxx/close     → 关闭并回收
GET  /xxx/terminals → 列出当前用户会话
```

要点：

- 输出用 **base64** 编码原始字节（前端 `atob` → `Uint8Array` → `term.write(bytes)`），避免 SSE 文本帧破坏二进制/ANSI。
- 后端以 200 结束流时发 `event: closed`，**前端必须 `EventSource.close()`**，否则浏览器每 3 秒自动重连刷屏。
- 会话按 `ownerId` 归属：`attachStream` / `input` / `resize` / `close` 逐入口校验，非法 sid → 403。
- 15 分钟空闲且无订阅者自动回收。
- Docker 本机走 Engine API **connection hijack**：`POST /containers/{id}/exec`（`Tty=true` + `AttachStdin`）→ `POST /exec/{id}/start` 带 `Connection: Upgrade` / `Upgrade: tcp`，Node `http.request` 的 `upgrade` 事件拿双向裸 socket。`Tty=true` 时输出是**原始字节、无 8 字节 multiplexing 帧头**，可直接喂 xterm。远端 `target=server:<id>` 走 `ssh2` pty 执行 `docker exec -it [-u root] <id> <shell>`，命令用 `shq()` 防注入。

---

## 3. 前端架构

### 3.1 单页 + 多标签工作台

- `index.html` 里 35 个 `<section class="page" id="view-XXX">` 常驻 DOM，**没有路由库**。`switchView(view)` → `openModuleTab(view)` → `registerTab()` / `newPane()` / `activateTab()`，标签存在 `const tabs = new Map()` 并持久化。
- 三类标签：模块页（`module:xxx`）、文件/编辑器（`file:` / `editor:`）、终端（`term:`）。
- 弹窗两类：`.modal`（真弹窗，如 `#dk-modal`、`#repo-clone-modal`、`#repo-files-modal`）与 `.as-modal`（把页内卡片浮层化，配 `#card-modal-mask`）。**新功能优先用弹窗**，见 §5.5。
- `api(path, options)`：自动加 `Authorization: Bearer <localStorage.dp_token>`；`body` 是对象时自动 `JSON.stringify` 并设 `content-type: application/json`（**不要自己 stringify**，否则 params 会全丢）；按 400/404/409/502/500 分类错误并保留 `hint`；401 且非 `/auth/` 触发 `invalidateSession()`。
- `streamToken()` 给 SSE / 下载 URL 拼 `&token=...`（EventSource 不能带 header）。
- `xterm` 相关 vendor **加载顺序固定**：`xterm.min.js` → `addon-fit.min.js` → `codemirror.js` → `cm-modes.js` → `cm-addons.js` → `qrcode.js` → 最后 `app.js`。`check-frontend.js` 有护栏锁死。

### 3.2 事件委托偏好

前端大量用 `document.addEventListener('click', ...)` 全局委托（例如容器弹窗在 `app.js` 约 6823 行）。**写这类判断必须用 `e.target.id`**：

```js
// ✅ 正确
if (e.target && e.target.id === 'dk-term-connect') { dkTermConnect(); return; }
// ❌ 错误：事件对象 e 没有 id 属性，恒为 undefined，按钮永远无响应
if (e.target && e.id === 'dk-term-connect') { dkTermConnect(); return; }
```

v0.4.30 就栽在这里（「连接」按钮点击无响应），`check-frontend.js` 已加回归护栏。若按钮内含子元素，用 `e.target.closest('[data-xxx]')` 更稳。

### 3.3 缓存戳机制（改前端必做）

`index.html` 里：

```html
<link rel="stylesheet" href="/style.css?v=20261124q" />
<script src="/app.js?v=20261124q"></script>
```

- 两个戳**必须相同**；`scripts/check-frontend.js` 的 `const CACHE_STAMP = '20261124q'` 必须与之一致，护栏会断言 `index.html` 内所有 `?v=XXXXXXXX[a-z]` 唯一且等于该常量。
- 改了 `app.js` / `style.css` / `index.html` 任一前端文件 → 升戳（末位字母递增即可）→ 否则浏览器可能用旧缓存，你会误判「改动没生效」。
- `mini.js` 的 `sendFile` 对静态资源发 `cache-control: no-cache`，但版本号仍是必要防线。

---

## 4. 数据与外部依赖

### 4.1 应用商店数据（`platform/appstore/`，v0.4.29+）

来自官方 `aaPanel/appstore`，用 `scripts/sync-appstore.js` 同步（GitHub API git tree + raw，低并发重试、断点续传）。目录格式：

```
apps/<appname>/
├─ app.json                      # 元数据：appname/apptype/appversion/field[]/icon…
├─ ico-dkapp_<appname>.png
└─ <真实版本目录>/                # ★ 目录名 = appname（不是 appversion！）
   ├─ docker-compose.yml
   └─ .env                       # 大写键的模板变量
```

关键解析规则（`dockerApps.js`）：

- **版本目录发现**：按「含 `docker-compose.yml` 的子目录」找，不能按 `appversion` 拼路径；`appversion` 只是镜像 tag 来源。
- **`field.attr` 是小写**（`mysql_port`），`.env` 键是**大写**（`MYSQL_PORT`），`prepare()` 建立大小写映射后合并表单参数；现有非空值保留（不吞 `0` / `false`）。
- **`allow_access`** 复选框不在 `.env` 中，映射成 `HOST_IP=0.0.0.0|127.0.0.1`。
- 配置说明取官方 `field.suffix`，按 `type` 渲染 checkbox / textarea / number / password / text。
- 镜像加速双模式：默认宝塔式（`daemon.json` 的 `registry-mirrors`，compose 保持官方镜像名）；可选 `compose` 换源（改写 compose 里的镜像前缀）。
- `.gitignore` 有 `!platform/appstore/**/.env` 白名单——**模板 `.env` 必须入库**，否则 clone 后应用商店全缺配置。

> ⚠️ Dify 系列模板官方自带 `SECRET_KEY=sk-...` 示例串，会触发 **GitHub Push Protection (GH013)**。已统一替换成 `REPLACE_WITH_YOUR_OWN_SECRET_KEY`（4 个 `.env` + 4 个 `docker-compose.yml` 默认值，共 8 处）。**每次重新跑 `sync-appstore.js` 后必须重新替换**，否则 push 会被拦。替换后要 `git commit --amend` 掉未推送的 commit（只改工作区追加 commit 不够，历史 blob 仍会被扫）。

### 4.2 环境变量（`.env.example` 有完整清单）

`ADMIN_TOKEN`、`GITEA_*`、`OPENLIST_*`、`CODE_SERVER_*`、`BUILD_EXECUTOR`、`HOST_WORKSPACE_DIR`、`DOCKER_IMAGE_PREFIX`、`DP_AUTH_MODE`、`DP_CLI_SECRET`、`DP_TLS_INSECURE`、`DP_PROXY_*`、`DP_REMOTE_TMP_DIR` 等。真实 `.env` 与 `data/state.json` **绝不入库**（`.gitignore` 已排除）；`windows/bin|bootstrap|runtime`、`.native-probe/` 也不入库。

---

## 5. 硬约定与历史踩坑（最重要的一节）

### 5.1 类型检查棘轮

`npm run typecheck` 用 `tsconfig.typecheck.json`（`allowJs` + `checkJs` + `noEmit`）全量检查 `src/**/*.js`，错误数不得超过 `scripts/typecheck-baseline.json` 的 `maxErrors: 78`。新增代码若报错，用 **JSDoc `@param` / `@returns` 标注类型**消掉（v0.4.30 的 `dockerExecTerm.js openSession()` 就是这么修的），**不要改基线**。

### 5.2 前端自检即「测试」

`node scripts/check-frontend.js` 做两件事：

1. 静态断言（159 条 `note()`）：DOM id 引用完整性、section/page 数量、脚本加载顺序、缓存戳唯一性、各功能接线（路由字符串 / 函数名 / 关键 DOM）、以及大量历史 bug 的回归护栏（例如 `e.id` 拼写、SSE closed 时 close()、watchLog 的 clearInterval 等）。
2. 用轻量 DOM stub 在 `vm` 里执行 `app.js` 跑一遍 boot，捕获顶层异常与未处理的 Promise 异常，并模拟多标签创建/切换/关闭。

**加新功能请顺手加一条 `note()` 护栏**——这是本项目防止回归的主要手段。护栏写法：同时断言「正确写法存在」与「错误写法不存在」（如 `e.target.id` 与 `!e.id`）。

### 5.3 路由注册顺序

`mini.js` 按 `routes[]` 注册顺序匹配。参数路由 `/api/docker/apps/:name` 会抢先吃掉 `/api/docker/apps/config/daemon-json` 这类同前缀路径。**新增单段路由要么放在参数路由之前，要么改成多段路径**（历史修法：`config/mirror` → `config/daemon-json`）。

### 5.4 二次确认与归属

- 破坏性操作要求 `body.confirm === true` 或 query `confirm=true`；非平台自建容器（`isOwned()` 判定 `createdBy === 'bt_apps'` / `dp-(ext|build)-` 前缀）默认只读。
- Docker 全部写接口命中 `/^\/api\/docker\//` 全局护栏，**仅管理员**；GET（logs/inspect/stats）读权限可放行。
- 新增写接口务必复用 `dockerPanel.assertWritable()` / `permissions.guard()`，并写 `dockerPanel.audit(...)` 审计日志。

### 5.5 UI 约定

- 用户明确偏好**弹窗**而非「页面底部页内卡片」或跳页；日志 / 详情 / 资源 / 文件管理 / 克隆都走弹窗。
- 弹窗 DOM 放在 `#content` 之外，用 `.modal` + `.modal-mask`；静态搬家优于动态复制（保留所有 `id`，不破坏已有事件绑定）。
- Esc 关闭要注意**后开的优先**（见 `app.js` 的 keydown 链）。
- 行内 / 工具栏 `<select>` 统一挂 `.ui-select` 类（历史专门美化过，护栏覆盖 12 个）。

### 5.6 其他已踩过的坑

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

---

## 6. 验证链（改完代码必跑，按顺序）

```bash
cd devplatform

# 1) 语法检查（清单在 platform/package.json 的 check 脚本，新增 src 模块要加进去）
npm run check --prefix platform

# 2) 类型检查：必须显示「✔ 未超过基线」（78），不许上调基线
npm run typecheck --prefix platform

# 3) 前端静态自检 + VM boot：必须「✔ 前端自检全部通过」
node scripts/check-frontend.js

# 4) 可选：接口巡检 / 安全冒烟
npm run sweep --prefix platform
npm run smoke:security --prefix platform
```

**部署到 246 并实测**（当前线上环境，源码直跑容器）：

```bash
MSYS_NO_PATHCONV=1 DEPLOY_DIR=/data/platform node scripts/remote.js deploy 10.0.0.246
```

Windows Git Bash 必须带 `MSYS_NO_PATHCONV=1`（否则 `/data/platform` 被转义成本机路径）。部署脚本会自动打包上传、重启容器、跑健康检查与环境体检、准备 AI 终端运行时、登记宿主机 SSH 回连。

**线上验收**（用 `remote.js exec` 或 curl）：

```bash
# health：期望 version = package.json 版本、mode=normal
curl -s http://10.0.0.246:9000/api/health

# 体检应为 8 正常 / 0 提醒 / 0 异常（部署输出里已有）
# 前端缓存戳
curl -s http://10.0.0.246:9000/index.html | grep -o 'app.js?v=[0-9a-z]*'

# 远程执行任意命令（宿主机默认没有 node，用 python3）
MSYS_NO_PATHCONV=1 node scripts/remote.js exec 10.0.0.246 "python3 -c '...'"
```

> 246 宿主机是 Debian 9 / glibc 2.24、**无 Node**、Docker Hub 不可达；解析 JSON 用 `python3`（3.5，`json.loads` 需先 `.read().decode('utf8')`）。平台容器是 `node:20-alpine`。

**鉴权**：接口用 `Authorization: Bearer <ADMIN_TOKEN>`（从 246 的 `/data/platform/.env` 读）或 `?token=<ADMIN_TOKEN>`；浏览器把 token 存 `localStorage.dp_token`。脚本里用 Bearer 最省事。

---

## 7. 提交 / 发版链路

### 7.1 日常改动

```bash
git add -A && git commit -m "..." && git push origin main
```

注意：`.gitignore` 已排除 `.env` / `.env.*` / `data/` / `state.json` / `dist/` / `node_modules/` / `workspace/*` / `windows/{bin,bootstrap,runtime}` / `.workbuddy/`；**唯独 `platform/appstore/**/.env` 有白名单**（模板样例，必须入库）。提交前用 `git add -A -n | grep -E '^\.env|state\.json'` 确认没有凭据混入。

### 7.2 发版（v0.4.30 的实际流程，可复用）

1. 升版本号：`platform/package.json` 与 `platform/package-lock.json`（lock 里有 **2 处** `version`）一起改。
   - `server.js:localVersion()`：**源码直跑**（246 容器 / systemd / `npm start`）以 `package.json` 为准；**exe / 热更新模式**才读 `dist/release.json`。`platform/dist/` 被 gitignore 忽略，CI `npm run build` 会重建，**不用手改**。
2. 更新 `release-notes.md`（追加/修订本版段）与 `README.md`（版本头、§1.1.1 当前状态、相关章节的状态行）。
3. 跑 §6 验证链 → commit + push `main`。
4. 重部署 246，确认 health 版本号已变。
5. 打 tag 推上去，**CI 自动发布 Release**：

```bash
git tag -a v0.4.30 -m "..."   # tag 必须打在版本升级那个 commit 上
git push origin v0.4.30
```

`.github/workflows/release.yml` 在 `windows-latest` 上执行：`npm ci` → `npm run build` → `fetch-services.ps1`（下载 Gitea / OpenList / VS Code CLI / WinFsp 官方二进制）→ `pack-dist.ps1` → `pack-release.ps1` → `gh release create $tag`（header + **整篇 `release-notes.md`** 作为 notes）。资产 6 个：

`devplatform-dist.zip`、`devplatform-windows.zip`、`devplatform-windows-lite.zip`、`devplatform-services.zip`、`devplatform.exe`、`SHA256SUMS.txt`。

- 本机**没有 `gh` CLI**，但 CI 自带；CI 状态可用匿名 GitHub API 查：
  `https://api.github.com/repos/sea-team/devplatform/actions/runs?per_page=3` 与 `/releases/tags/v0.4.30`。
- workflow 也支持 `workflow_dispatch` 手动运行（可指定 tag）。
- `gh release create` 是幂等的：失败会先 `gh release delete` 再重建。

### 7.3 Windows 分发链

`build.mjs`：`bundle.cjs`（esbuild 打包）+ `public/` + `release.json`（含 bundle/public/appstore 的 sha256 清单）+ `appstore.tar.gz`（作 SEA asset 内嵌）+ `devplatform.exe`（postject 注入 SEA blob）。**管理员提权清单必须在 postject 之前注入**（反序会破坏 blob）。`launcher.js` 首启释放资源到 `dist/`。`pack-dist.ps1` / `pack-release.ps1` 生成组件包 / 全量包 / 轻量包 / 服务包。`check-frontend.js` 有 4 条护栏锁死这条链，别拆。

---

## 8. 不同运行形态下路径与版本号的差异（易错）

| 形态 | `ROOT` / `appRoot` | 版本号来源 | 应用商店模板位置 |
|---|---|---|---|
| 源码直跑 / 246 容器 / systemd | `platform/`（未设 `DP_ROOT`） | `platform/package.json` | `platform/appstore/` |
| 单文件 exe / 绿色包 | exe 所在目录（`DP_ROOT` 由 launcher 注入，指向 `dist/`） | `dist/release.json` | `dist/appstore/`（首启从 `appstore.tar.gz` 释放） |
| `remote.js` 部署 | `/data/platform/platform/` | 源码 → package.json | 整仓 tar 打包，天然包含 |

**改路径相关代码时，三种形态都要能跑通**；尤其不要假设 `appRoot` 一定等于 `platform/`。

---

## 9. 给接手 AI 的工作流建议

1. **先读**：本文 §0、§2.1、§2.3、§5、§6；再看 `README.md` 里对应版本章节（§65–§69 是最新的）。
2. **动手前**：`git status`、`git log -3`、`node -p "require('./platform/package.json').version"` 确认基线；读 `check-frontend.js` 里与目标功能相关的护栏，别和护栏对着干。
3. **改动时**：后端加路由 → 新模块加进 `package.json` 的 `check` 清单 → 前端加 DOM / 事件 → **升缓存戳** → 加一条 `note()` 护栏 → 更新 `release-notes.md` / `README.md`。
4. **改完**：按 §6 跑完 4 项 → 部署 246 → curl 实测（不要只看本地检查通过）→ 清理测试产生的会话/临时文件。
5. **提交前**：确认没有凭据入库、没有 `sk-`/`ghp_`/`AKIA` 类串（GitHub Push Protection 会拦）、工作区干净。
6. **不要擅自**：调高 typecheck 基线、删护栏、把模板 `.env` 加回忽略、把 `/api/` 路由注册顺序打乱、或用 Express 重写 `mini.js`。

---

## 10. 关键文件速查

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
