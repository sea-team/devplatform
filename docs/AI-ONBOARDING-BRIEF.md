# 给接手 AI 的接入说明（历史归档 · 已被 AI-HANDOFF.md 取代）

> **⚠️ 本文已由 [`docs/AI-HANDOFF.md`](AI-HANDOFF.md) 取代**（单文件版：简报 + 手册合一，整篇贴给新会话即可）。本文保留作历史归档，**请勿再作为投喂入口**；基线数字以 `AI-HANDOFF.md` 为准。
>
> 用法：把本文件**从下一行开始整篇复制**，作为新 AI 会话的第一条消息。它假设你（接手 AI）刚拿到 `sea-team/devplatform` 仓库、还没读过任何代码。
> 本简报基线：v0.4.30 / 2026-11-24。

---

## 【开始粘贴】

你现在的任务是接手 **DevPlatform（统一 Web 开发管理平台）** 的开发。请先按下面的顺序建立上下文，再动手改任何代码。

### 一、先认清这个项目

它**不是**常规 Web 项目：没有 React/Vue、没有构建步骤、没有 Express、没有 ORM、没有 WebSocket、没有单元测试套件。它是：

- 一个 **Node.js 单进程**（`platform/src/server.js` 是唯一入口），用自研的 232 行 HTTP 框架 `platform/src/mini.js` 分发请求；
- 前端是**原生 JS 单页**（`platform/public/index.html` 常驻 35 个 `<section class="page">`，`app.js` 是多标签工作台 + 全局事件委托）；
- 状态只有**一个 `data/state.json`**；
- 流式输出（SSH 终端 / AI 会话 / 容器终端）统一用 **SSE**，不用 WebSocket。

当前规模：41 个后端模块 / 17372 行 / **279 条路由**（全在 `server.js`）/ 前端 8831 行 / 159 条自检护栏。运行环境：线上 `10.0.0.246:9000`（Debian 9 宿主机、无 Node、Docker Hub 不可达；平台跑在 `node:20-alpine` 容器里）。

### 二、动手前必须先做的 4 件事

```bash
cd devplatform
git status                                   # 确认工作区是否干净
git log -5 --oneline                         # 看最近改了什么
node -p "require('./platform/package.json').version"   # 当前版本（本简报基线 0.4.30）
grep "const CACHE_STAMP" scripts/check-frontend.js     # 当前缓存戳（基线 20261124q）
```

然后读这三处（**不要一上来通读全部源码**）：

1. `docs/AI-DEVELOPMENT-GUIDE.md` 的 **§0、§2.1、§2.3、§5、§6**；
2. `README.md` 里与你任务相关的版本章节（最新是 §69）；
3. `scripts/check-frontend.js` 中**与你任务相关的护栏**——别和护栏对着干，护栏记录了历史 bug。

### 三、六条红线（违反会直接造成线上故障）

1. **缓存戳必须同步**：改了 `app.js` / `style.css` / `index.html` 任一前端文件，就要把 `index.html` 里 `app.js?v=` 与 `style.css?v=` 两个戳改成同一个新值，**并且**同步改 `scripts/check-frontend.js` 的 `CACHE_STAMP`。漏了会让你误判「改动没生效」。
2. **类型棘轮只许降不许升**：`npm run typecheck --prefix platform` 的错误数基线是 **78**（`scripts/typecheck-baseline.json`）。新增代码若报 checkJs 错误，用 JSDoc `@param` / `@returns` 把类型标注清楚消掉，**绝不调高基线**。
3. **事件委托必须写 `e.target.id`**：绝不能写 `e.id`（事件对象没有 `id` 属性，恒 `undefined`，按钮会完全无响应——v0.4.30 就因此修过一次）。按钮内含子元素时用 `e.target.closest('[data-xxx]')`。
4. **路由按注册顺序匹配**：`mini.js` 遍历 `routes[]`，参数路由（如 `/api/docker/apps/:name`）会抢先吃掉同前缀的单段路径。新增路由要么放在参数路由**之前**，要么改成多段路径（历史修法：`config/mirror` → `config/daemon-json`）。
5. **凭据绝不入库**：`.env`、`data/state.json`、`*.pem`、`id_rsa*` 已在 `.gitignore` 中排除。提交前跑 `git add -A -n | grep -E '\.env|state\.json'` 确认。注意**唯一例外**：`platform/appstore/**/.env` 是官方模板样例、有白名单，**必须入库**，否则 clone 后应用商店全缺配置。
6. **别把 `sk-` 类串带进提交**：Dify 系列应用模板官方自带 `SECRET_KEY=sk-...` 示例串，会触发 GitHub **Push Protection (GH013)** 拦下 push。已统一替换成 `REPLACE_WITH_YOUR_OWN_SECRET_KEY`（4 个 `.env` + 4 个 `docker-compose.yml`，共 8 处）。**每次重跑 `scripts/sync-appstore.js` 后必须重新替换**；若已被拦截，要 `git commit --amend` 掉未推送的提交（只改工作区追加 commit 没用，历史 blob 仍会被扫）。

### 四、加功能的固定动作清单

- **后端**：在 `platform/src/server.js` 注册路由 → 业务逻辑放 `platform/src/<模块>.js` → **新模块要加进 `platform/package.json` 的 `check` 脚本清单** → 列表用 `visible(req, items)` 过滤归属、写操作走 `permissions.guard()` / `dockerPanel.assertWritable()` + 破坏性操作要 `confirm` + 写 `audit()` 日志 → 用 `wrap(async (req,res)=>...)` 和 `ok()/badRequest()` 等封装。
- **前端**：`index.html` 加静态 DOM（保留所有 `id`，静态搬家优于动态复制）→ `app.js` 加逻辑与事件委托 → `style.css` → **升缓存戳** → **在 `scripts/check-frontend.js` 加一条 `note()` 护栏**（同时断言「正确写法存在」和「错误写法不存在」）。
- **UI 偏好**：用户明确要求用**弹窗**（`.modal` + 遮罩，放在 `#content` 外），不要做成页面底部页内卡片或跳页；Esc 关闭要「后开的优先」；行内 `<select>` 统一挂 `.ui-select` 类。
- **文档**：改完更新 `release-notes.md`（追加/修订本版段）和 `README.md` 对应章节。发布时 CI 会把**整篇 `release-notes.md`** 写进 Release notes。

### 五、改完必须跑完这条验证链（不能只看本地）

```bash
cd devplatform
npm run check --prefix platform              # 语法检查（新增 src 模块记得进 check 清单）
npm run typecheck --prefix platform          # 必须显示「✔ 未超过基线」（78）
node scripts/check-frontend.js               # 必须「✔ 前端自检全部通过」（159 护栏 + VM boot）
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

### 六、提交与发版

日常改动：`git add -A && git commit -m "..." && git push origin main`。

**发版流程**（v0.4.30 实际走通，可复用）：

1. 升版本号：`platform/package.json` **和** `platform/package-lock.json`（lock 里有 **2 处** `version`）一起改。`server.js:localVersion()` 源码直跑（246 容器）读 `package.json`；exe/热更新模式才读 `dist/release.json`。**`platform/dist/` 被 gitignore 忽略、CI 会重建，不要手改**。
2. 更新 `release-notes.md` 与 `README.md`（版本头、§1.1.1 当前状态、相关章节状态行）。
3. 跑第五节的验证链 → commit + push `main` → 重部署 246 确认 health 版本号已变。
4. 打 tag 推上去，**CI 自动发布 Release**：

```bash
git tag -a v0.4.31 -m "..."     # tag 必须打在版本升级那个 commit 上
git push origin v0.4.31
```

`.github/workflows/release.yml` 在 windows-latest 上跑 `npm ci → npm run build → fetch-services.ps1 → pack-dist.ps1 → pack-release.ps1 → gh release create`，产出 6 个资产（dist / windows / windows-lite / services / exe / SHA256SUMS.txt）。本机**没有 `gh` CLI**，但 CI 自带；用匿名 API 查状态：`https://api.github.com/repos/sea-team/devplatform/actions/runs?per_page=3` 和 `/releases/tags/<tag>`。

### 七、三个最容易搞混的形态差异

| 形态 | `ROOT` / `appRoot` | 版本号来源 | 应用模板位置 |
|---|---|---|---|
| 源码直跑 / 246 容器 / systemd | `platform/` | `platform/package.json` | `platform/appstore/` |
| 单文件 exe / 绿色包 | exe 目录（`DP_ROOT` 由 launcher 注入，指向 `dist/`） | `dist/release.json` | `dist/appstore/`（首启从 `appstore.tar.gz` 释放） |
| `remote.js` 部署 | `/data/platform/platform/` | 源码 → package.json | 整仓 tar，天然包含 |

改路径相关代码时**三种形态都要能跑通**，不要假设 `appRoot` 一定等于 `platform/`。

### 八、明确不要做的事

不要调高 typecheck 基线；不要删 `check-frontend.js` 的护栏；不要把模板 `.env` 加回忽略；不要打乱 `/api/` 路由注册顺序；不要用 Express 重写 `mini.js`；不要自己 `JSON.stringify` 后传给前端 `api()`（要传对象，让 `api()` 自动设 `content-type`，否则 params 全丢）；不要在未经用户明确授权时擅自 commit / push / 升版本号 / 打 Release。

### 九、遇到问题时查哪里

| 现象 | 先查 |
|---|---|
| 前端改了没生效 | 缓存戳是否同步升；`index.html` 两个 `?v=` 是否一致 |
| 按钮点了没反应 | 事件委托里是不是写成了 `e.id` |
| 新接口 404 / 被别的接口吃掉 | `server.js` 里参数路由的注册顺序 |
| 类型检查报错变多 | 用 JSDoc 标注参数类型，不要调基线 |
| push 被 GH013 拦 | appstore 里 Dify 的 `sk-` 串；amend 掉未推送 commit |
| 线上 health 版本不对 | `package.json` 是否升了、是否重部署了 246 |
| 不确定约定 | `docs/AI-DEVELOPMENT-GUIDE.md` §5（硬约定与历史踩坑） |

**现在请告诉我你理解到的项目基线，以及这次要做的具体任务，再开始动手。**

## 【结束粘贴】

---

### 附：给交付方（人类）的备注

- 本简报与 `docs/AI-DEVELOPMENT-GUIDE.md` 的分工：**简报 = 首条消息投喂 + 动作清单 + 红线**，**手册 = 遇到具体问题时查架构细节**。两者数字一致（版本 0.4.30、缓存戳 20261124q、基线 78、279 路由、159 护栏）。
- 若未来升版本或改缓存戳，两份文件都要同步更新，否则新 AI 会拿到过期基线。
- 简报刻意不含代码示例片段，避免把新会话的注意力带偏；具体写法在手册 §2.1 / §3.2 / §6。
