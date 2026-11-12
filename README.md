# DevPlatform · 统一 Web 开发管理平台 使用说明

> 适用版本：一期（2026-11-07）
> 当前线上环境：`http://10.0.0.246:9000`（部署目录 `/data/platform`，容器 `devplatform`）
> 本地代码：`devplatform/`，Git 分支 `main`
> 本文中的 `10.0.0.246` 为示例/测试机地址，换环境时请全局替换。

---

## 0. 目录

| 章节 | 内容 |
|---|---|
| 1 | 平台能力与架构、端口 |
| 2 | 五种运行方式如何选 |
| 3 | 快速开始（Release 免安装 / 本机 / compose / 远程部署） |
| 4 | 环境变量完整说明 |
| 5 | 访问与鉴权 |
| 6 | 工作台通用操作（多标签、悬停说明、快捷键） |
| 7 | 八个功能模块逐一说明 |
| 8 | 远程文件管理与类宝塔编辑器 |
| 9 | 构建与自动部署 |
| 10 | AI 服务配置与代理 |
| 11 | AI 运维 |
| 12 | 命令行工具与脚本 |
| 13 | API 速查 |
| 14 | 安全须知 |
| 15 | 故障排查 |
| 16 | 目录结构、Git 与已知限制 |
| 17 | 单文件可执行程序、热更新与本机集成服务配置（本机免 Node） |
| 18 | Windows 一键安装：Docker / 无 Docker 原生 / 复用服务器三种模式、Release 免安装发行包、服务管理与排错 |

---

## 1. 平台能力与架构

### 1.1 能力一览

| 能力 | 落地方式 | 控制台入口 |
|---|---|---|
| Git 仓库管理 | Gitea REST API：创建、列表、克隆到工作区 | Git 仓库 |
| 在线 VSCode | code-server，按项目目录打开工作区 | 在线 IDE |
| 多存储挂载 / 文件管理 | OpenList API + WebDAV | 存储 / 文件 |
| 多语言编译测试 | 6 种构建 Profile，本地或隔离容器执行 | 构建 · 部署 |
| 自动部署 | SSH + SFTP 上传产物并执行远端命令 | 构建 · 部署 |
| 服务器状态 | SSH 采集负载、内存、磁盘、容器 | 服务器 |
| 服务器 SSH | xterm.js Web 终端（SSE 推流） | 服务器 → Web 终端 |
| 远程文件 | SFTP 列目录 / 读写 / 上传下载 / 建删改名 | 服务器 → 文件管理 |
| AI 服务 | OpenAI 兼容网关 + 宿主机 / WSL 本地 CLI + 代理 | AI 服务配置 |
| AI 管理服务器 | 只读工具 + 可选写授权的运维 Agent | AI 运维 |

### 1.2 架构示意

```
浏览器 ── 9000 ──> DevPlatform 控制台 / API（Node，零依赖路由）
                      │
                      ├─ HTTP API ──> Gitea(3002) / OpenList(5244) / code-server(8080)
                      ├─ SSH/SFTP ─> 目标服务器（终端、文件、状态、部署）
                      ├─ Docker Engine API(docker.sock) ─> 一次性构建容器
                      └─ AI Provider ──> 云端 API / 宿主机 CLI / WSL CLI（可走代理）
```

数据全部落在本地 `data/state.json`（服务器、AI 服务、构建、部署记录），工作区代码在 `workspace/`。

### 1.3 端口表

| 端口 | 服务 | 说明 |
|---|---|---|
| 9000 | DevPlatform 控制台 / API | 固定，可用 `PORT` 覆盖 |
| 3002 | Gitea Web | 容器内 3000；`GITEA_PORT` 可改（3000 常被 grafana 占用） |
| 222 | Gitea SSH | 容器内 22 |
| 8080 | code-server | 密码见 `CODE_SERVER_PASSWORD` |
| 5244 | OpenList Web / API | |
| 5245 | OpenList 附加服务 | |

> 平台容器由 `remote.js` 启动时**不在 compose 网络内**，因此 `.env` 里三个服务地址必须写宿主机 IP，不能写 `gitea` / `openlist` 服务名；只有 compose 内的 `platform` 服务才用服务名。

---

## 2. 五种运行方式如何选

| 方式 | 适用场景 | 优点 | 限制 |
|---|---|---|---|
| A. 宿主机直接跑 `node platform/src/server.js` | 本机开发、要用宿主机/WSL 里的 codex、claude | 能调用本机 CLI 与 WSL；改代码即时生效 | 需要 Node ≥ 20；集成服务要另行启动 |
| B. `docker compose --profile full up -d` | 一台机器上完整拉起全部组件 | 一条命令、组件网络互通 | 镜像需可拉取；容器内**无法**使用 WSL / 宿主机 CLI |
| C. `scripts/remote.js deploy <host>` | 部署到远程服务器（当前线上采用） | 自动选运行时（宿主机 Node ≥ 20 用 systemd，否则复用已有 node 镜像跑容器）；不依赖 Docker Hub | 需要先在本机 `data/state.json` 登记目标机凭据 |
| **D. 单文件程序 `platform/dist/devplatform.exe`** | **本机 / 内网机器免装 Node 直接运行** | 双击即跑；业务与前端可在线热更，支持回滚；详见 [§17](#17-单文件可执行程序与热更新) | 构建产物不入库；`git clone` 后由安装器自动下载 CI 发布的预构建包（[§18.11](#1811-从-github-clone-后首次安装无-node无-dist)），或自行 `npm run build`；exe 壳升级需手动替换 |
| **E. GitHub Release 免安装发行包** | **不想 clone、不想装任何运行时的 Windows 机器** | 下载 `devplatform-windows.zip` 解压后，`START.bat` 立刻启动控制台（启动前会检查并打印三项集成服务状态）；或只下载自包含的 `devplatform.exe` 放任意空目录双击（首启自动释放业务包 / 前端 / `.env`），见 [§18.12](#1812-从-github-release-直接下载使用免-clone) | **`START.bat` 不会安装集成服务**，Gitea / OpenList / 在线 IDE 默认「未配置 / 离线」，需再跑 `INSTALL.bat` 或在 `.env` 填已有地址；exe 壳升级要重新下载 |

**当前线上是方式 C + 三个配套组件用 compose 单独启动**：`devplatform` 容器占用 9000，compose 的 `platform` 服务带 `profiles: ["full"]`，默认不启动，避免抢端口。方式 D 只影响本机运行，不改变线上部署方式。

---

## 3. 快速开始

> **Windows 用户最省事的路径**：打开 [GitHub Releases](https://github.com/sea-team/devplatform/releases/latest)，下载 `devplatform-windows.zip`，解压后双击 `START.bat` —— 不用 clone、不用 Node、不用 Docker，浏览器自动打开 `http://localhost:9000`。**注意 `START.bat` 只启动控制台**：Gitea / OpenList / 在线 IDE 需要再双击 `INSTALL.bat` 安装，或把已有服务地址填进 `.env`。`START.bat` 启动前会打印这三项的在线状态与「本机服务是否已安装」，不会再让人误以为装好了。详见 [§18.12](#1812-从-github-release-直接下载使用免-clone)。
>
> **想跟着源码走**：`git clone` 后也不必先准备 `platform/dist/devplatform.exe`——双击 `windows\install.bat`，安装器会自动下载 CI 发布的预构建包（或读取 `windows\bootstrap\` 里的离线 zip，见 [§18.11](#1811-从-github-clone-后首次安装无-node无-dist)），一键装好平台与集成服务、初始化凭据并配置开机自启。**没有 Docker 也能装**——安装器会自动改用 Windows 原生 exe（Gitea / OpenList）+ VS Code 内置 Web IDE，详见 §18.10。下面 3.2–3.4 是各运行方式的手动步骤，用于理解原理或排错。

### 3.1 前置条件

- Node.js ≥ 20（方式 A / B / 构建方式 D 的 exe / 运行 `scripts/*.js`）；**方式 D 运行时不需要 Node**。Docker 与 docker compose（方式 B / C）。
- Windows 下用 **Git Bash** 执行脚本；所有以 `/` 开头的路径参数必须加 `MSYS_NO_PATHCONV=1`，否则会被转义成本机 Windows 路径（例如 `/data/platform` 变成 `J:/...`），或改用 `DEPLOY_DIR=/data/platform` 环境变量。
- 平台核心零依赖即可启动；`ssh2`、`undici`、`iconv-lite` 为可选增强依赖，缺失时 SSH/代理/GBK 编码能力会降级。

### 3.2 方式 A：本机直接运行

```bash
cd devplatform/platform
npm install --omit=dev
cd ..
node platform/src/server.js
# 或：cd platform && npm start / npm run dev（--watch 热重载）
```

访问 `http://localhost:9000`。配置文件从进程环境变量读取，可直接写 `.env` 后由 compose/容器注入，或命令行临时指定：

```bash
GITEA_URL=http://127.0.0.1:3002 OPENLIST_URL=http://127.0.0.1:5244 \
CODE_SERVER_URL=http://127.0.0.1:8080 node platform/src/server.js
```

自检：`cd platform && npm run check`（逐个 `node --check` 全部源码）。

### 3.3 方式 B：compose 完整编排

```bash
cd devplatform
cp .env.example .env
# 编辑 .env：填 ADMIN_TOKEN、服务地址、镜像源，并设置 OPENLIST_PASSWORD
docker compose up -d                       # 启动 gitea / code-server / openlist
docker compose --profile full up -d        # 连平台一起启动（需先停掉占用 9000 的容器）
docker compose config --quiet              # 校验编排文件
```

首次启动后初始化凭据（生成 Gitea Token、OpenList Admin Token 并写回 `.env`）。
**前提**：`.env` 中的 `OPENLIST_PASSWORD` 必须非空——脚本用它作为 Gitea 管理员与 OpenList 的统一初始密码，为空会直接报错退出。

```bash
bash scripts/setup-integrations.sh
# 然后重新 deploy / 重启平台容器，让新凭据生效
```

compose 的 `platform` 服务默认 `BUILD_EXECUTOR=local`；要启用容器化构建，需手动打开 `docker-compose.yml` 中 `/var/run/docker.sock` 那一行挂载，并设置 `BUILD_EXECUTOR=docker`、`HOST_WORKSPACE_DIR`。

### 3.4 方式 C：部署到远程服务器（当前线上流程）

按顺序执行，第 2 步之后的所有命令都在**本机**运行：

1. 在本机平台「服务器」页登记目标机：名称、主机、端口、用户名、密码或私钥、私钥口令、默认部署目录（默认 `/data/platform`）。凭据写入本机 `data/state.json`，不会进入部署包。
2. 探测环境：`MSYS_NO_PATHCONV=1 node scripts/remote.js probe <host>`
3. 部署：`MSYS_NO_PATHCONV=1 node scripts/remote.js deploy <host> /data/platform`
   - 自动打包（排除 `data/`、`.env`、`state.json`、`node_modules/`、`workspace/`、`dist/`、`.workbuddy/`，以及 `windows/{bin,bootstrap,runtime}`、`.native-probe` 等随包大二进制）→ SFTP 上传 → 解压 → 选择运行时 → 启动容器/服务 → 健康检查 → 幂等登记远端服务器。
   - 容器方式复用目标机已有的 `node:20-alpine` 等镜像，代码/数据挂载到 `/data/platform/{platform,data,workspace}`，容器名 `devplatform`，端口 9000。
4. 在目标机启动三个配套组件：`docker compose up -d gitea openlist code-server`
5. 初始化凭据：`MSYS_NO_PATHCONV=1 node scripts/remote.js script <host> scripts/setup-integrations.sh`
   - 脚本幂等：等待三个服务就绪 → 创建 Gitea 管理员与 Token → 设置 OpenList 密码并取 `admin token` → 写回 `/data/platform/.env`（权限 600）。
6. 再 `deploy` 一次让平台容器通过 `--env-file` 加载新凭据。
7. 回归验证：`node scripts/verify.js http://<host>:9000`

日常：`node scripts/remote.js status|exec|script|stop <host>`；前端自检：`node scripts/check-frontend.js`。

### 3.5 验证是否就绪

```bash
curl -s http://<host>:9000/api/health
# {"ok":true,"data":{"mode":"normal","executor":"docker", ...}}
node scripts/verify.js http://<host>:9000
```

`verify.js` 覆盖：健康检查、三个集成服务、离线静态资源、SFTP 全部操作、路径穿越拦截、SSH 终端收发、容器化构建、多编码往返、图片/二进制识别。`check-frontend.js` 用轻量 DOM 模拟执行 `app.js`，验证启动流程与多标签交互，无需浏览器。

---

## 4. 环境变量完整说明

配置文件模板为 `.env.example`（已纳入 Git），实际 `.env` 与 `data/` 均被 `.gitignore` 排除。

### 4.1 平台自身

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 9000 | 控制台监听端口 |
| `ADMIN_TOKEN` | 空 | 控制台 / API 唯一访问令牌。**留空＝所有 API 无鉴权**（仅限可信本机 / 内网，且 `exec` 降级为只读白名单）；对局域网 / 公网暴露时必须设置。作用、影响与启用步骤见 §5、§40，`.env.example` 里有逐行注释 |
| `DATA_DIR` | `platform/data` | 状态文件目录，写入后自动 700 |
| `WORKSPACE_DIR` | `platform/workspace` | 项目工作区（克隆、构建、IDE 共用） |
| `GITEA_URL` | `http://localhost:3002` | 本机/源码直跑用 localhost；compose 内自动覆盖为 `http://gitea:3000`；独立容器用宿主机 IP |
| `GITEA_TOKEN` | 空 | Gitea 访问令牌；缺了仓库列表与创建不可用（总览仍显示「待配置」） |
| `CODE_SERVER_URL` | `http://localhost:8080` | 在线 IDE 地址 |
| `OPENLIST_URL` | `http://localhost:5244` | 本机/源码直跑用 localhost；compose 内自动覆盖为 `http://openlist:5244` |
| `OPENLIST_TOKEN` | 空 | Admin Token，优先于密码登录；缺了存储模块整体不可用 |
| `OPENLIST_USER` / `OPENLIST_PASSWORD` | `admin` / 空 | Token 缺失时的回退登录；`OPENLIST_PASSWORD` 同时也是 `setup-integrations.sh` 的初始密码来源，运行该脚本前必须设置 |

### 4.2 配套组件与镜像

| 变量 | 默认 | 说明 |
|---|---|---|
| `GITEA_PORT` | 3002 | Gitea 对外端口 |
| `CODE_SERVER_PASSWORD` | devplatform | code-server 登录密码 |
| `GITEA_IMAGE` / `OPENLIST_IMAGE` / `CODE_SERVER_IMAGE` / `PLATFORM_NODE_IMAGE` | 官方镜像名 | Docker Hub 不可达时改成加速器地址，或先 `docker pull` 再 `docker tag` 成官方名 |
| `GITEA_ADMIN` | admin | `setup-integrations.sh` 创建的管理员名 |

### 4.3 构建

| 变量 | 默认 | 说明 |
|---|---|---|
| `BUILD_EXECUTOR` | local | `docker` = 每种语言用独立官方镜像隔离构建（推荐） |
| `HOST_WORKSPACE_DIR` | 空 | **容器内必填**：容器内 `/workspace` 对应的宿主机真实路径，例如 `/data/platform/workspace` |
| `DOCKER_IMAGE_PREFIX` | 空 | 语言镜像加速器前缀，结尾带 `/`，例如 `docker.m.daocloud.io/library/` |
| `BUILD_TIMEOUT_MS` | 900000 | 单次构建超时（毫秒） |

> `docker` 模式通过 `/var/run/docker.sock` 直接调用 Docker Engine API，不依赖宿主机 `docker` CLI，因此在 Alpine 平台容器 + 老内核环境下同样可用。

---

## 5. 访问与鉴权

1. 浏览器打开 `http://<host>:9000`，左侧导航进入各模块，点击即在标签栏打开一个标签。
2. 若设置了 `ADMIN_TOKEN`，先在浏览器控制台执行一次：
   ```js
   localStorage.setItem('dp_token', '<与 ADMIN_TOKEN 相同的值>')
   ```
   之后所有请求自动带 `Authorization: Bearer ...`；SSE 终端与下载链接通过 `?token=` 传递同一令牌。
3. 未设置 `ADMIN_TOKEN` 时接口不鉴权（仅限可信本机/内网），且 `/api/servers/:id/exec` 会强制只允许只读白名单命令。
4. 静态资源响应带 `cache-control: no-cache`，前端改动部署后刷新页面即可生效，无需强制刷新。

### 5.1 `ADMIN_TOKEN` 的作用

它是平台唯一的一把**共享密钥**，不是账号体系：启动时读入 `config.adminToken`（`core.js`），非空时由 `mini.js` 在 `/api/*` 入口统一校验，除 `/api/health` 外所有接口缺令牌一律返回 **401**。

| 维度 | 说明 |
|---|---|
| 保护范围 | 所有 `/api/*`：系统更新 / 回滚、扩展明文连接串、服务器文件与 Web 终端、Docker 容器与镜像、构建部署、AI 运维等；`/api/health` 健康检查例外，静态页面文件本身也不鉴权 |
| 传递方式 | 普通请求 `Authorization: Bearer <令牌>`；SSE 终端 / 下载 / 上传链接无法带自定义 Header，用 `?token=<令牌>` |
| 前端链路 | `localStorage.dp_token` → `authHeaders()` 给 `fetch` 加头、`streamToken()` 给 SSE / 下载链接加查询参数；`devplatform.exe reload` 也带同一令牌 |
| 存放位置 | 明文写在 `.env`（600 权限）与浏览器 localStorage；`/api/env-config` 读取时一律脱敏，只回传「是否启用」布尔值 |
| 边界 | 与 Gitea / OpenList / code-server 各自的登录密码互不相干；没有多用户、过期时间、权限分级与操作审计，需要这些请前置网关 / SSO |

### 5.2 留空（未配置）的影响

| # | 影响 | 具体表现 |
|---|---|---|
| 1 | **所有 API 完全不鉴权** | 任何能访问 9000 端口的人（同网段、端口映射、反向代理）都能读配置与明文连接串、浏览 / 编辑服务器文件、打开 Web 终端、增删容器与镜像、触发构建部署，等同拿到平台管理员权限 |
| 2 | `exec` 被降级 | `/api/servers/:id/exec` 只允许内置只读白名单命令，写命令返回 **403**（`当前未设置 ADMIN_TOKEN，仅允许只读诊断命令`） |
| 3 | 没有日志追责 | 因为不校验身份，无法区分是谁调用了敏感接口 |
| 4 | 适用场景收窄 | 只适合可信本机，或已用防火墙 / 安全组限制 9000 端口的内网；对局域网开放即建议启用 |

> 它是「弱安全兜底」而非漏洞：设计上默认留空是为了本机开箱即用，但一旦平台监听 `0.0.0.0`，就应当视为必须配置。

### 5.3 启用步骤与注意事项

1. 生成强随机值：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`（或 `openssl rand -hex 32`）。
2. 写进 `.env` 的 `ADMIN_TOKEN=`，或在控制台「环境配置」页点「生成随机令牌并填入」→「保存并应用」（自动备份 `.env`、权限 600）。
3. **完全重启平台**：本机重启 `devplatform.exe`，容器部署重跑 `remote.js deploy`。`devplatform.exe reload` 只重启业务进程，不会重新读取 `.env`；`envConfig.write` 也不会热更新 `config.adminToken`。
4. 每台要访问控制台的浏览器按 F12 执行 `localStorage.setItem('dp_token', '<同一个令牌>')` 后刷新；`curl` 用 `-H 'Authorization: Bearer <令牌>'`，SSE / 下载链接用 `?token=<令牌>`。
5. 更换令牌后旧浏览器会持续 401，需要重新写入 `dp_token`；令牌不要提交 Git、不要出现在截图里。
6. `?token=` 会进入 URL，可能被反向代理 / 访问日志记录，公网部署请同时配置 HTTPS；需要更完整的身份体系请前置网关 / SSO。

控制台「环境配置 → ADMIN_TOKEN 鉴权说明」卡片会显示当前**是否已启用**、上述影响与步骤，`ADMIN_TOKEN` 行的「详细说明」可展开同样内容；未启用时「配置建议」会置顶一条提醒。

---

## 6. 工作台通用操作

界面顶部**没有重复的标题行**：标签本身就是标题，说明文字通过悬停查看。

| 操作 | 结果 |
|---|---|
| 鼠标悬停标签 220ms | 弹出说明卡：标题、模块说明、服务器 / 路径 / 编码 / 未保存状态等上下文 |
| 点击工具栏 `ⓘ` | 固定显示当前标签说明（适合触屏 / 键盘）；再点一次或点空白处、`Esc` 收起 |
| 左键标签 | 切换；表单内容、目录路径、终端会话、编辑器内容全部保留 |
| 中键标签 / 点击 `×` | 关闭；有未保存修改时弹确认 |
| 右键标签 | 菜单：关闭其他 / 关闭所有可关闭标签 / 打开全部模块页 / 刷新当前页 |
| `＋` | 打开服务器页（在卡片里开终端或文件管理，可多开） |
| `⋯` | 标签批量操作菜单；`⟳` 刷新当前页 |
| 标签较多时 | 仅在溢出时出现 `‹` `›` 按钮；也可在标签栏上直接滚轮横移，不会出现纵向滚动条 |
| 未保存圆点 | 编辑器标签出现橙色圆点，关闭时提示确认 |

**快捷键**：`Ctrl/⌘ + S` 保存当前编辑器；编辑器内 `Ctrl+F` 查找；`Esc` 关闭菜单或说明浮层。
浏览器标签页标题会同步为「当前标签 · DevPlatform」。模块标签顺序保存在 `localStorage.dp_tabs`，刷新后自动恢复；动态标签（文件 / 编辑器 / 终端）不跨刷新恢复。

---

## 7. 功能模块

> 控制台目前共 12 个可标签化模块：总览、Git 仓库、在线 IDE、存储 / 文件、构建 · 部署、服务器、扩展 / 数据库、Git 源、Docker 管理、代理配置、AI 服务配置、AI 运维。后加入的四个模块分别见 §21–§23、§26–§27。

### 7.1 总览

显示「已配置服务器 / 构建任务 / 部署次数」统计、三个集成服务的在线状态与架构说明。状态为真实探测结果：服务不可达时显示离线并给出真实错误，**不注入演示数据**。

### 7.2 Git 仓库

- **新建仓库**：填名称、描述、是否私有，调用 Gitea API 创建并初始化。
- **克隆到工作区**：填仓库地址与可选目录名，克隆到 `WORKSPACE_DIR`，随后可直接用在线 IDE 打开。
- **仓库列表**：展示名称、全名、描述，可刷新。

### 7.3 在线 IDE

输入项目目录（相对工作区）→「打开 IDE」按目录打开 code-server；「打开 IDE 首页」新窗口访问；页面内嵌 iframe 预览。若被浏览器 X-Frame-Options 拦截，用新窗口按钮。code-server 与构建流水线共享同一 `workspace` 目录。

### 7.4 存储 / 文件（OpenList）

- 路径输入 + 「浏览 / 上一级」列出文件；支持新建目录、上传文件、删除。
- 「已挂载存储」显示 OpenList 里配置的驱动与状态。
- WebDAV 地址可直接挂载到本机或 rclone：`http://<host>:5244/dav/`。

> 这一页操作的是 **OpenList 管理的存储**；操作服务器文件系统请用「服务器 → 文件管理」（SFTP）。

### 7.5 构建 · 部署

- 填「项目目录（相对工作区）」、选择构建类型（6 种，见第 9 章）。
- 勾选「构建后运行测试」「构建成功后自动部署」；自动部署时展开目标服务器、部署目录（留空用该服务器 `deployDir`）、部署后命令。
- 「构建记录」点击可查看实时日志；「部署记录」列出历史。

### 7.6 服务器

**添加服务器表单字段**：名称、主机、端口、用户名、登录密码、私钥密码 / Passphrase、默认部署目录、私钥 PEM 内容、或私钥文件路径。

- 密码、私钥 PEM、私钥路径三者填其一即可；**加密私钥必须填 Passphrase**，否则 SSH 报解密失败。
- 列表只回传 `hasPassword` / `hasPrivateKey` / `hasPassphrase` / `deployDir` 等标记，接口不回传明文。
- 卡片显示连接测试与状态采集结果：CPU 负载、内存、磁盘、容器数、在线状态。
- 「Web 终端」打开交互式 SSH 标签；「文件管理」打开 SFTP 标签，两者都可多开，会话互不干扰。

### 7.7 AI 服务配置

详见第 10 章。页面分「云端 API（OpenAI 兼容）」与「本地 AI 程序（Codex / Claude）」两段，可保存多个服务、测试当前配置、发送测试请求。

### 7.8 AI 运维

输入问题或指令、选择服务、默认只读执行分析，右侧展示「AI 结论」与「工具调用轨迹」。勾选「授权写操作」后 AI 才能触发部署。详见第 11 章。

---

## 8. 远程文件管理与类宝塔编辑器

### 8.1 SFTP 文件管理器

在「服务器」卡片点「文件管理」打开独立标签。工具栏：上一级、刷新、路径跳转、新建文件、新建目录、上传、删除选中；列表按文件类型显示彩色图标。每行可编辑、下载、重命名、删除。

- 路径经过 `safeRemotePath` 校验，拦截 `..` 穿越；删除操作额外保护 `/`、`/etc`、`/usr`、`/bin` 等系统目录。
- 与在线 IDE 共用同一服务器凭据，多个文件管理器标签可同时打开不同路径。

### 8.2 文件类型识别

按后缀 / 特殊文件名自动识别语言、CodeMirror 语法模式、图标、MIME 与可编辑性：

| 类别 | 覆盖后缀 / 文件名 |
|---|---|
| 前端 | js/mjs/cjs/jsx、ts/tsx/mts/cts、json/jsonc/json5、html/htm/vue/svelte/hbs/ejs、css、scss/sass、less |
| 后端 | py、go、rs、java、c/h、cc/cpp/hpp、cs、kt/kts、php、sh/bash/zsh、rb、pl、lua、sql |
| 配置与文档 | xml/svg/xsl、yml/yaml、toml、ini/conf/properties、md/markdown、txt/log/csv/tsv/lock/map |
| 特殊文件名 | Dockerfile、Makefile、Jenkinsfile、.env、.gitignore、.bashrc、.zshrc、nginx.conf、go.mod、Cargo.lock |
| 图片（只读预览） | png、jpg/jpeg、gif、webp、bmp、ico、avif |
| 二进制（禁止文本编辑） | zip/gz/tar/7z/pdf/exe/dll/so、字体、音视频、wasm、pyc、class、db/sqlite、jar/war/deb/rpm/iso、xlsx/docx/pptx 等 |

> `svg` 按 XML 文本编辑；`Swift`、`TOML` 等无对应语法模式时降级为纯文本，不会报错。

### 8.3 编码、换行与 BOM

- 编码下拉：自动检测、UTF-8、GB18030/GBK/GB2312、GBK、Big5、UTF-16 LE/BE、Latin-1。UTF-8 严格解码失败时自动判定 GB18030。
- 换行下拉：LF / CRLF / CR。读入时统一为 `\n`，保存时按所选换行还原。
- 「保留 BOM」复选框控制 UTF-8 / UTF-16 BOM 是否写回。
- **有损编码保护**：非 Unicode 编码若往返转换后内容不一致（例如把中文存成 `?`），平台直接拒绝保存，避免静默损坏文件。
- 编辑功能：语法高亮、行号、折叠、括号匹配、查找（Ctrl+F）、Ctrl+S 保存、行列与字符数状态栏。保存后自动刷新同服务器的文件管理标签。

### 8.4 Web 终端

基于 xterm.js，SSE 推送输出、POST 送输入与窗口 resize；支持中文、Tab 补全、Ctrl+C / Ctrl+D 按钮，窗口自适应。会话空闲 15 分钟自动回收，多个终端标签互不干扰。

---

## 9. 构建与自动部署

### 9.1 构建 Profile

| ID | 识别文件 | 容器镜像 | 产物目录 | 主要动作 |
|---|---|---|---|---|
| `frontend` | `package.json` | `node:22-bookworm` | `dist` | `npm ci/install` → `npm run build` → `npm test` |
| `go` | `go.mod` | `golang:1.23-bookworm` | `dist` | `go mod download` → `go build -o dist/app` → `go test ./...` |
| `rust` | `Cargo.toml` | `rust:1.82-slim` | `target/release` | `cargo fetch` → `cargo build --release` → `cargo test` |
| `php` | `composer.json` | `composer:2.8` | `.` | `composer install` → `php -l` 语法检查 → phpunit（可选） |
| `python` | `pyproject.toml` / `requirements.txt` / `setup.py` | `python:3.12-slim` | `.` | 建 venv 装依赖 → `compileall` → pytest / unittest |
| `smoke` | `demo.build.json` | `node:22-bookworm` | `dist` | 零依赖自检，验证「编译 → 测试 → 产物」整链路 |

未手动指定时，按上表顺序探测目录里的识别文件自动选择；找不到会提示补充 `package.json` / `go.mod` 等。

### 9.2 执行流程

识别类型 → 安装依赖 → 编译 → 测试（可关） → 打包产物 → （可选）SSH/SFTP 部署到目标服务器 → 执行部署后命令。日志每 1.5 秒轮询，完成后自动刷新记录。

构建命令是平台内置白名单，**不接受用户传入的 shell 字符串**，避免命令注入。

### 9.3 两种执行器

| | `local` | `docker`（推荐） |
|---|---|---|
| 运行位置 | 平台进程内 | 一次性官方镜像容器 |
| 依赖 | 宿主机需装好各语言工具链 | 只需 Docker |
| 隔离 | 无 | 每种语言独立镜像 |
| 实现 | `child_process` + 自动选 `bash`/`sh` | Docker Engine API over `/var/run/docker.sock` |

用 `docker` 执行器时务必设置 `HOST_WORKSPACE_DIR`，否则容器挂载到宿主机上不存在的路径导致构建目录为空。

### 9.4 自动部署

勾选后选择目标服务器、部署目录（留空则用服务器表单里的「默认部署目录」）、部署后命令（如 `systemctl restart myapp`，可选）。产物打包后经 SFTP 上传，再 SSH 执行命令；部署记录单独保存。

---

## 10. AI 服务配置与代理

### 10.1 云端 API（OpenAI 兼容）

字段：服务名称、代理地址、是否启用、Base URL、模型、API Key、自定义 Headers（JSON）、「本地免密服务（Ollama / vLLM 等无需 Key）」。
请求由平台转发到 `baseURL/chat/completions`，走 `undici` 代理；多 Provider 并存，可分别测试。

### 10.2 宿主机 / WSL 本地 AI 程序

字段：运行位置（宿主机 / WSL 子系统）、WSL 发行版、AI 程序（codex / claude / gemini / qwen / 自定义命令）、自定义命令名、附加参数、超时。

- 「检测本机 / WSL 已安装的 AI 程序」：Windows 用 `where.exe` 解析真实可执行文件，用 `wsl.exe -l -q` 枚举发行版并逐个 `bash -lc command -v` 探测，结果缓存 5 分钟。
- `codex` 自动用 `codex exec --skip-git-repo-check` 非交互模式；`.cmd/.bat` 走 `cmd.exe /d /s /c`，多行提示词会压平，避免被 `shell:true` 截断。
- **限制**：本地 CLI 与 WSL 只能在**宿主机直接运行平台**时使用；Linux 容器里没有 `wsl.exe`，也看不到宿主机安装的程序。
- 本地 CLI 不支持 function calling，因此 AI 运维会自动降级为「平台先采集上下文，再一次性提问」（context-injection）。

### 10.3 代理

两种类型都支持「代理地址」：

| 类型 | 代理生效方式 |
|---|---|
| 云端 API | HTTP 代理转发请求 |
| 宿主机 CLI | 注入 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 环境变量 |
| WSL CLI | 在 `bash -lc` 内额外 `export` 同一组变量 |

默认 `NO_PROXY` 为 `localhost,127.0.0.1,::1`。

---

## 11. AI 运维

### 11.1 只读工具（默认）

| 工具 | 作用 |
|---|---|
| `server_status` | 读取指定服务器的 CPU / 内存 / 磁盘 / 容器 / 在线状态 |
| `read_command` | 在白名单内执行只读诊断命令 |
| `list_builds` | 列出构建记录 |
| `build_log` | 读取某次构建日志 |

只读命令白名单：`uptime`、`df -h`、`free -m`、`docker ps`、`ps aux --sort=-%mem | head -15`、`systemctl is-active nginx`、`journalctl -u nginx -n 50 --no-pager`。

### 11.2 写授权

勾选「授权写操作」后才会出现 `deploy_build` 工具（触发部署）。未设置 `ADMIN_TOKEN` 时，`/api/servers/:id/exec` 也只允许白名单命令，避免平台变成任意命令执行入口。

示例指令：「检查所有服务器负载，找出最近失败的构建并分析原因」。执行结果分「AI 结论」与「工具调用轨迹」两栏展示，便于核对 AI 到底读了什么、做了什么。

---

## 12. 命令行工具与脚本

所有脚本在仓库根目录运行；`remote.js` 的凭据只从本机 `data/state.json` 读取，不出现在命令行、日志或部署包里。

| 命令 | 作用 |
|---|---|
| `cd platform && npm start` | 启动平台 |
| `cd platform && npm run watch` | `node --watch` 源码直跑（无引导器） |
| `cd platform && npm run dev` | 引导器开发模式：监听 `src/` + `public/`，自动重建并热重载（§17.6） |
| `cd platform && npm run build` | 构建单文件程序到 `platform/dist/`（§17.2） |
| `cd platform && npm run build:bundle` | 只重建 `bundle.cjs` 与 `public/`，不重新生成 exe |
| `platform/dist/devplatform.exe version\|reload\|update\|rollback` | 单文件程序的版本 / 重载 / 更新 / 回滚命令（§17.3） |
| `cd platform && npm run check` | 全量源码语法检查（含引导器与 mini.js） |
| `node scripts/remote.js probe <host>` | 探测目标机 OS / 内核 / Node / Docker / 端口 / 磁盘 / 网络 |
| `node scripts/remote.js deploy <host> [目录]` | 打包上传、解压、选运行时、启动、健康检查、幂等登记服务器 |
| `node scripts/remote.js status <host>` | 结构化采集服务器状态 |
| `node scripts/remote.js exec <host> "<命令>"` | 执行任意远程命令（谨慎） |
| `node scripts/remote.js script <host> <本地脚本>` | 上传 Bash 脚本（自动转 LF）并执行 |
| `node scripts/remote.js stop <host>` | 停止远端平台服务 |
| `bash scripts/setup-integrations.sh` | 幂等初始化 Gitea / OpenList 凭据并写回 `.env` |
| `node scripts/sync-integrations.js --from <IP>` | 从服务器同步集成服务地址与 Token 到 `platform/dist/.env`（§17.8） |
| `node scripts/sync-integrations.js --check\|--probe\|--local` | 查看配置 / 探测连通性 / 生成本机模板 |
| `windows\install.bat` | Windows 一键安装（自动装/连集成服务、写配置、注册自启），§18.3 |
| `powershell -File windows\install.ps1 -Mode local\|native\|remote -DryRun` | 指定模式安装 / 预演不改动系统（§18.5） |
| `powershell -File windows\native-services.ps1 -Action setup\|start\|stop\|status` | 无 Docker 原生服务的安装、启停与状态（§18.10） |
| `windows\start.bat` / `stop.bat` / `uninstall.ps1` | 启动 / 停止 / 卸载（§18.6） |
| `node scripts/verify.js [URL]` | 端到端回归（默认 `http://10.0.0.246:9000`，可用 `PLATFORM_URL` 覆盖） |
| `node scripts/check-frontend.js` | 无浏览器 DOM 模拟：静态一致性 + 多标签交互自检 |

---

## 13. API 速查

所有响应统一为 `{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": "..." }`；路径前缀 `/api`。

| 分组 | 主要端点 |
|---|---|
| 健康 / 总览 | `GET /health`、`GET /overview` |
| 仓库 | `GET/POST /repos`、`POST /repos/clone` |
| IDE | `GET /ide`、`POST /ide/open` |
| OpenList 文件（旧） | `GET /storage`、`POST /storage/mkdir`、`POST /storage/remove`、`PUT /storage/upload`、`GET /storage/mounts` |
| OpenList 管理（新） | `GET/PUT /openlist/connection`、`POST /openlist/connection/reset`、`GET /openlist/status\|settings`、`GET/POST/PUT/DELETE /openlist/storages...`、`GET /openlist/drivers...`、`GET/POST /openlist/files...`、`GET .../link\|download`、`PUT .../upload`（§26） |
| 构建 | `GET /profiles`、`GET/POST /builds`、`GET /builds/:id`、`GET /builds/:id/log`、`POST /deploy`、`GET /deploys` |
| 服务器 | `GET/POST /servers`、`DELETE /servers/:id`、`POST /servers/:id/test`、`GET /servers/:id/status`、`POST /servers/:id/exec` |
| 远程文件 | `GET /servers/:id/files`、`GET/PUT /servers/:id/files/content`、`GET .../files/download`、`PUT .../files/upload`、`POST .../files/create\|mkdir\|rename\|delete` |
| Web 终端 | `POST .../terminal/open`、`GET .../terminal/stream`（SSE）、`POST .../terminal/input\|resize\|close`、`GET .../terminals` |
| AI | `GET/POST /ai/providers`、`DELETE /ai/providers/:id`、`GET /ai/local/programs`、`POST /ai/local/test`、`POST /ai/test`、`POST /ai/chat`、`POST /ai/ops`、`GET /ai/tools` |
| 扩展 / 数据库 | `GET /extensions/catalog`、`GET/POST/DELETE /extensions/instances[/:id]`、`POST .../action\|health\|inject\|backup\|upgrade`、`GET/PUT .../repos`、`GET .../connection\|logs`、`GET/POST/DELETE /extensions/backups...`、`GET/POST /extensions/dbgate...`（§19 / §23） |
| 外部 Git 源 | `GET/POST /git-sources`、`PUT/DELETE /git-sources/:id`、`POST .../test`、`GET .../repos\|branches`、`GET /builds/backends`（§21） |
| Docker 管理 | `GET /docker/overview\|audit`、容器 `POST .../action\|exec`、`GET .../logs\|inspect\|stats`、镜像 `POST /docker/images/pull\|load\|load-path\|remove`、`GET /docker/images/export`、卷 / 网络 / 模板 CRUD（§22） |
| 分层代理 | `GET /proxy`、`PUT /proxy/global`、`PUT /proxy/groups/:scope`、`GET/POST/PUT/DELETE /proxy/rules...`、`GET /proxy/entities`、`PUT/DELETE /proxy/overrides/:scope...`、`POST /proxy/resolve\|test`（§27） |

需要鉴权时，SSE 与下载链接用 `?token=<ADMIN_TOKEN>`，其余用 `Authorization: Bearer <ADMIN_TOKEN>`。

---

## 14. 安全须知

1. `data/state.json` 含**明文 SSH 口令与私钥**，保存时自动 `chmod 600`，数据目录 `700`；接口只回传「是否有凭据」标记，不回传明文。`.env` 同样是 600。
2. `.gitignore` 已排除 `.env*`（保留 `.env.example`）、`data/`、`node_modules/`、`workspace/`、私钥/证书、日志、打包产物。**提交前请确认没有把真实凭据加入版本控制。**
3. 对外暴露必须设置 `ADMIN_TOKEN`；控制台令牌存在浏览器 `localStorage`。
4. 挂载 `/var/run/docker.sock` 等价于把宿主机 root 能力交给容器，仅限可信内网。
5. SFTP 路径做 `..` 穿越与系统目录删除保护；构建命令使用内置白名单；编辑器对有损编码拒绝保存。
6. `.env.example` 与 `verify.js` 内含测试机内网地址和示例口令，如要推送到公共远程仓库，先替换为占位符。
7. 代理 URL 里的账号密码、OpenList Token / 管理员密码同样只存 `data/state.json`（600）。`/api/proxy`、`/api/openlist/connection`、各类列表接口一律脱敏；表单把 `******` 原样提交时后端沿用已保存值，不会写入占位符。OpenList 站点设置接口只回白名单字段，不回传令牌类配置。

---

## 15. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 总览三个集成服务全离线 | `.env` 里写的是 compose 服务名，或地址不通 | 独立容器必须用宿主机 IP：`http://<IP>:3002/5244/8080`；改完重新 deploy |
| **本机 exe 集成服务全离线**（`gitea:3000` / `openlist:5244` fetch failed） | 全新 `dist/` 没有 `.env`，沿用默认地址；且本机没有启动这三个服务 | 执行 `node scripts/sync-integrations.js --from <服务器IP>` 复用已部署服务，或 `docker compose up -d gitea openlist code-server` 在本机启动；改完**完全重启 exe**，见 17.8 |
| Gitea 起不来 / 端口冲突 | 3000 被 grafana、3001 被其他服务占用 | 用 `GITEA_PORT=3002` 或换其他端口 |
| code-server 退出码 134、`uv_thread_create` | 老内核 4.x + Docker 19.03 默认 seccomp 拦 Node 20 | compose 已内置 `seccomp=unconfined`；自建时补上 |
| code-server / Gitea 写不了配置 | 挂载目录属主不是 uid 1000 | `chown -R 1000:1000 data/code-server data/gitea workspace` |
| OpenList 后台用密码登录 401 | 该版本密码登录状态不可靠 | 平台改用 `OPENLIST_TOKEN`（`openlist admin token`）；API 正常即可 |
| 镜像拉取失败 | Docker Hub 不可达 | 设置 `*_IMAGE` / `DOCKER_IMAGE_PREFIX` 指向加速器，或 `docker pull` 后 `docker tag` 成官方名 |
| 容器化构建挂到空目录 | 未设 `HOST_WORKSPACE_DIR` | 填宿主机真实路径，例如 `/data/platform/workspace` |
| 构建报 `docker: ENOENT` | 把宿主机 glibc 版 docker CLI 挂进 Alpine 容器 | 平台已改为通过 docker.sock 调 Engine API，勿再挂载 CLI |
| `Alpine 无 bash` / 命令不执行 | 镜像只有 `sh` | 平台 `localShell()` 自动选 `/bin/bash` 或 `sh` |
| Git Bash 把 `/data/platform` 变成本机路径 | MSYS 路径转换 | 命令前加 `MSYS_NO_PATHCONV=1`，或用 `DEPLOY_DIR` |
| 私钥登录失败 | 加密私钥没填 Passphrase | 表单补「私钥密码 / Passphrase」后重新保存 |
| WSL 检测不到程序 | `wsl.exe` 被安全软件拦截，或平台跑在 Linux 容器里 | 在宿主机直接运行平台并放行 `wsl.exe` |
| 中文保存后变 `?` | 目标编码无法表示该字符 | 平台会拒绝保存；改用 UTF-8 / GB18030 |
| 前端改动没生效 | 浏览器缓存 | 静态资源已是 `no-cache`；刷新一次即可 |
| 界面出现标签栏纵向滚动条 | `overflow-x:auto` 隐式把 `overflow-y` 变成 auto | 现版本已锁 `overflow-y:hidden` 并改用 `‹ ›` 横移 |

---

## 16. 目录结构、Git 与已知限制

### 16.1 目录结构

```
devplatform/
├── .env.example            # 配置模板（已入库）
├── .gitignore              # 排除凭据 / 依赖 / 运行时数据 / 构建产物
├── README.md               # 本文
├── .github/workflows/
│   └── release.yml         # CI：构建 Windows dist 并发布 Release 预构建包（§18.11）
├── docker-compose.yml      # gitea / code-server / openlist / platform(full profile)
├── platform/
│   ├── Dockerfile
│   ├── package.json        # npm start / dev / build / check
│   ├── build.mjs           # esbuild + Node SEA 打包，产出 dist/
│   ├── launcher/           # 引导器（内嵌 exe）：监督、热重载、更新、回滚
│   ├── dist/               # 构建产物（不入库）：devplatform.exe / bundle.cjs / public / release.json / .env
│   ├── public/             # 控制台：index.html、app.js、style.css、cm-theme.css
│   │   └── vendor/         # 离线 xterm.js + CodeMirror 5（无需外网）
│   └── src/                # core / mini / server / integrations / engine
│                           # dockerApi / remoteOps / fileTypes
│                           # catalog / extensions / extRuntime（§19）
│                           # gitSources / remoteDocker / buildBackends（§20-21）
│                           # dockerPanel / backup / extLifecycle / dbgateSync（§22-24）
├── scripts/                # remote.js、setup-integrations.sh、verify.js、
│                           # check-frontend.js、sync-integrations.js（本机配置同步）
├── windows/                # Windows 一键安装：install.bat / install.ps1 /
│                           # native-services.ps1（无 Docker 原生服务）/
│                           # dist-package.ps1（获取/校验/解压预构建包）/
│                           # pack-dist.ps1（组件 zip）/ pack-release.ps1（完整绿色包）/
│                           # start.bat / stop.bat / uninstall.ps1（§18）
│   ├── bootstrap/          # 离线预构建包放置处（zip 不入库，§18.11）
│   ├── release/            # 发行包模板：START/INSTALL/STOP.bat + README-RELEASE.txt（§18.12）
│   └── runtime/            # 运行时（不入库）：bin/ 下载的 exe、gitea/ 仓库、
│                           # openlist/ 数据、ide/、logs/、services.json、pids.txt
├── data/                   # 运行时状态（不入库，600/700）
│   ├── extensions/         # 自定义扩展清单 *.json（不入库，§19.7）
│   ├── backups/            # 数据库逻辑备份存档（§23.2）
│   └── images/             # 本机离线镜像 tar（§22.3）
└── workspace/              # 克隆与构建工作区（不入库）
```

### 16.2 Git

本地仓库已初始化，分支 `main`，首次提交包含源码、离线前端资源与脚本；`data/`、`.env`、`node_modules/`、`workspace/` 不入库。后续改动建议：

```bash
git status --short
git add -A
git commit -m "feat: ..."
```

提交前注意 `.env.example` 与 `scripts/verify.js` 中的测试机地址，推送到公共仓库前应改成占位符。

### 16.3 已知限制

- OpenList 后台 UI 用密码登录仍返回 401，但 Admin Token 方式完全可用。
- 远端平台中存在两条同 IP 的服务器记录（其中一条为手动添加），未自动删除，可在「服务器」页清理。
- 构建历史保留一次排查期间的失败记录，可直接查看日志，不影响后续构建。
- 本地 CLI 没有 function calling，AI 运维自动降级为上下文注入模式。
- Swift、TOML 等无对应 CodeMirror 模式时按纯文本编辑。
- 动态标签（文件 / 编辑器 / 终端）不跨浏览器刷新恢复；模块标签顺序会恢复。
- 一期未实现多租户 / 细粒度权限、GitOps 自动触发、Web 终端文件上传进度条。
- 扩展 / 数据库：SSH 远程安装、备份恢复、版本升级、离线镜像导入均已实现（§20–§24）；仍不支持 SQL 终端动态标签与外部连接模式的备份 / 升级（§19.9）。
- `wsl.exe` 在部分受安全策略管控的 Windows 沙箱内会被拦截，需在真实宿主机运行本地 CLI 能力。

---

## 17. 单文件可执行程序与热更新

让本机运行不再依赖 Node：把控制台编译成 `devplatform.exe`，同时保留「改代码不用重新编译、能在线升级和回滚」的能力。

### 17.1 设计取舍

| 路线 | 评估 |
|---|---|
| Go 重写后端 | 需移植 8 个模块约 2500 行（SSH/SFTP、SSE 终端、多编码、Docker Engine API、WSL CLI），约 3500–4500 行 Go 且要重做全量回归；线上容器也要换镜像。风险高，列为二期 |
| **Node SEA 单文件 + 外置业务包（已实现）** | 现有逻辑零改动；exe 内嵌 Node 运行时与引导器，业务代码 `bundle.cjs`、前端 `public/` 外置。既免装 Node，又天然支持热更新 |
| 纯 `pkg` 打成单个大 exe（业务也内嵌） | 改一行后端就要重新编译整个 exe，与热更新目标冲突，未采用 |

架构分层：exe（固化的运行时 + 引导器）→ 监督进程 `fork` 业务 worker；worker 通过 `DP_ROOT` 定位外置的 `bundle.cjs`、`public/`、`data/`。源码直跑时不设置 `DP_ROOT`，行为与原来完全一致，因此线上方式 C 不受影响。

### 17.2 构建与分发

```bash
cd platform
npm install                 # 仅构建时需要 Node；运行 exe 的机器不需要
npm run build               # 生成 platform/dist/
```

| 产物 | 说明 | 更新时 |
|---|---|---|
| `devplatform.exe` | 内嵌 Node 运行时、引导器、前端 `public.tar.gz`（首启释放），约 84 MB | 壳固化；升级引导器/Node 版本时手动替换 |
| `bundle.cjs` | esbuild 把 8 个后端模块 + 纯 JS 依赖打成单文件，约 2 MB | **可热替换** |
| `public/` | 前端静态资源，服务端 `no-cache`；首次启动从 exe 释放 | **可热替换** |
| `release.json` | 版本号 + 每个文件的 `sha256` / `size` 清单 | 随更新写入 |
| `data/` | `state.json`、`backups/`、`.staging/` | **永不覆盖** |
| `.env`（可选） | 与 `data/` 同级的运行配置，引导器启动时加载 | **永不覆盖** |

把整个 `dist/` 复制到任意 Windows 机器，双击 `devplatform.exe` 即可访问 `http://localhost:9000`。Linux / macOS 需在对应平台执行 `npm run build`，`build.mjs` 会生成 `devplatform`（无 `.exe` 后缀）并按平台注入 SEA 资源。

> 构建踩坑记录：Windows 上 postject 需要二进制内存在 `NODE_SEA_FUSE_...:0` 标记，且该字面量随 Node 构建不同而变化。`build.mjs` 已使用本机 Node 22 的正确值；换 Node 版本后如报 `Could not find the sentinel`，用 `node -e "console.log(require('fs').readFileSync(process.execPath).indexOf('NODE_SEA_FUSE_'))"` 核对并调整 `SEA_FUSE`。

### 17.3 运行命令

| 命令 | 作用 |
|---|---|
| `devplatform.exe` | 启动控制台（监督进程 + 业务 worker），默认 `http://localhost:9000` |
| `devplatform.exe --dev` | 开发模式，见 §17.6 |
| `devplatform.exe version` | 查看版本、运行模式、exe 根目录、备份数量 |
| `devplatform.exe reload` | 通过 HTTP 平滑重启正在运行的业务（需 `ADMIN_TOKEN` 一致） |
| `devplatform.exe update <源>` | 应用更新；`<源>` 是本地目录或 `release.json` 的 URL，省略时用 `DP_UPDATE_URL` |
| `devplatform.exe update <源> --force` | 版本号相同也强制重装 |
| `devplatform.exe rollback` | 回滚到最近一次备份并重载 |
| `devplatform.exe help` | 查看内置帮助 |

界面入口：标签栏右端的**版本徽标**（如 `v0.2.0`），点开可查看运行模式与构建时间，并执行「检查更新 / 应用更新 / 重载后端 / 回滚上一版本」。所有 `/api/system/*` 接口都受 `ADMIN_TOKEN` 保护。

### 17.4 三层热更新

| 层级 | 触发方式 | 是否重编译 exe | 生效时间 |
|---|---|---|---|
| 前端热更 | 直接改 `dist/public/` 下文件，浏览器刷新 | 否 | 即时（`cache-control: no-cache`） |
| 后端热替换 | 替换 `bundle.cjs` 后点「重载后端」或 `devplatform.exe reload` | 否 | 1–2 秒：旧 worker 收到 `SIGTERM` 优雅关闭，监督进程拉起加载新 bundle 的 worker |
| 版本自更新 | 界面「应用更新」或 `update <源>` | 否 | 校验 → 备份 → 原子替换 → 自动 reload |

更新流程会先按 `release.json` 逐个校验 `sha256`，任一文件不符即中止且不动现有版本；替换前把旧 `bundle.cjs` / `public/` / `release.json` 备份到 `dist/data/backups/<时间戳>-from-<旧版本>/`，失败可一键回滚。`data/state.json` 与 `.env` 从不参与替换。

### 17.5 更新源格式

本地目录或 HTTP 目录下放一份 `release.json` 与对应文件：

```json
{
  "version": "0.2.2",
  "buildTime": "2026-11-08T08:00:00.000Z",
  "bundle": { "path": "bundle.cjs", "sha256": "<64 位十六进制>", "size": 2175095 },
  "public": [
    { "path": "index.html", "sha256": "<64 位十六进制>", "size": 19287 }
  ]
}
```

发布新版本时执行 `npm run build:bundle`（若后端有改动则 `npm run build`），把 `dist/` 中的 `bundle.cjs`、`public/`、`release.json` 原样拷到更新源目录即可。内网离线环境用目录路径；有文件服务时用 `release.json` 的 URL，并设置 `DP_UPDATE_URL` 让「检查更新」默认指向它。

> 更新源必须可信：`sha256` 防传输损坏，但 manifest 本身没有数字签名，建议固定内网 HTTPS 地址并限制写入权限。

### 17.6 开发模式

```bash
cd platform
npm run dev          # 引导器 + 文件监听（推荐，验证热替换链路）
npm run watch        # 或者 node --watch 直接跑源码，不经过引导器
```

`npm run dev` 会用 `fs.watch` 递归监听 `platform/src/` 与 `platform/public/`，变更 400ms 后自动执行 `build.mjs --bundle-only`（重建 `bundle.cjs`、同步 `public/`），再触发平滑重载；因此改后端 JS 或前端文件都无需手工重启。该模式需要源码仓库与 `node_modules`（有 esbuild）， exe 分发包里不包含构建工具，普通启动模式下不会尝试监听。

### 17.7 相关 API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/system/version` | GET | 版本、构建时间、`runtime: binary/source`、`updateUrl`、备份数 |
| `/api/system/reload` | POST | 平滑重载 worker；源码模式返回 `mode: source` 提示 |
| `/api/system/update/check` | POST `{source}` | 只查询版本差异，不落盘 |
| `/api/system/update/apply` | POST `{source, force}` | 校验 + 备份 + 原子替换，随后自动重载 |
| `/api/system/rollback` | POST | 恢复最近备份并重载 |

源码模式（方式 A/B/C）没有引导器，`reload` 返回 `{reloaded:false, mode:'source'}`，更新请用 CLI 或重新部署；`/api/system/version` 仍可正常读取版本信息。

### 17.8 本机集成服务配置（总览全离线的处理）

单文件 exe 只包含平台自身，**不包含** Gitea / OpenList / code-server 这三个独立服务。全新 `dist/` 首次运行时没有 `.env`，三项都会显示离线；截图中 `http://gitea:3000`、`http://openlist:5244` 是旧默认值里的 compose 内部服务名，本机 DNS 无法解析。现版本默认值已改成 `localhost:3002/5244/8080`，并在首次构建时自动生成 `dist/.env` 模板。

三种处理方式，按本机条件选一种：

| 方式 | 适用 | 操作 | 结果 |
|---|---|---|---|
| **A. 复用已部署服务器**（推荐，零安装） | 已有一台跑着三个组件的服务器 | `node scripts/sync-integrations.js --from <IP>` → 完全重启 exe | 本机直连远端服务，三项立即在线 |
| **B. 本机自建服务** | 本机装了 Docker Desktop | `docker compose up -d gitea openlist code-server`，再 `scripts/setup-integrations.sh` 初始化 Token；`dist/.env` 保持 localhost 模板并填入 Token | 完全本地、不依赖服务器 |
| **C. 不使用集成服务** | 只用服务器管理 / 文件 / 终端 / AI / 构建 | 不改配置 | 三项显示「离线 / 未配置」并给出提示，其他模块照常可用 |

方式 A 的完整步骤：

```bash
cd devplatform
# 1. 从服务器 /data/platform/.env 读取服务地址 + GITEA_TOKEN / OPENLIST_TOKEN，
#    写入 platform/dist/.env（权限 600，不打印、不提交任何凭据）
node scripts/sync-integrations.js --from 10.0.0.246

# 2. 查看配置（只显示 URL 与「已设置」，不显示 Token）
node scripts/sync-integrations.js --check

# 3. 探测三个服务是否可达
node scripts/sync-integrations.js --probe

# 4. 完全重启程序（reload 只重启业务进程，不重读 .env）
#    Windows：任务管理器结束两个 devplatform.exe，再双击 dist/devplatform.exe
```

脚本其它用法：`--local` 生成纯 localhost 模板（不连服务器）；不带参数时自动取 `data/state.json` 里的第一台服务器。若远端 `.env` 写的是 `127.0.0.1`，脚本会自动替换成服务器 IP，避免本机连到自己。

`dist/.env` 的要点：

- 位置固定为 `platform/dist/.env`（与 exe 同级）；`dist/` 整体、`.env*` 均已被 `.gitignore` 排除。
- 内容只有 `PORT`、三个 URL、`GITEA_TOKEN`、`OPENLIST_TOKEN`、`OPENLIST_USER`、`ADMIN_TOKEN`（注释）、`NO_PROXY`；**更新与回滚不会覆盖它**，备份只涉及 `bundle.cjs` 与 `public/`。
- 修改后必须**完全重启** exe：`loadDotEnv()` 只在进程启动、`process.env` 未定义该键时注入，`reload` 不会重读。
- 若设置了 `ADMIN_TOKEN`，前端首次访问需按第 4 章写入 `dp_token`；本机自用可留空。

总览状态现在有四种，便于定位：

| 状态 | 含义 | 卡片提示 |
|---|---|---|
| 在线 | 探测成功且凭据齐全 | 显示 Gitea 版本号 |
| 待配置 | 服务可达但缺 Token（如 Gitea 的 version 接口无需鉴权） | 提示补 `GITEA_TOKEN` 并重启 |
| 未配置 | 因缺凭据导致探测失败（OpenList 常见） | 提示补 `OPENLIST_TOKEN` |
| 离线 | 地址不通 | 中文提示「域名无法解析 / 连接被拒绝 / 服务未启动」，不再只显示 `fetch failed` |

> **方式 A 的已知差异**：本机 exe 的工作区是 `dist/workspace`，而 code-server 里的 `/home/coder/project` 指向服务器上的挂载目录，二者不是同一份文件。通过本机控制台「打开 IDE」时会进入远端工作区；需要编辑本机项目时，请用「服务器 → 文件管理」走 SFTP，或把项目放在远端工作区中。

### 17.9 限制与后续

- **exe 壳不自更新**：Windows 不能覆盖正在运行的自身，且引导器与 Node 运行时属于固化部分；业务代码、前端资源、配置都可在线更新，壳升级需替换 exe 并重启一次。
- 更新会整体替换 `public/`，放在该目录下的自定义文件需重新拷入；建议自定义内容放在 `data/` 或工作区。
- SEA 里 `require` 只能加载快照内模块，外置 `bundle.cjs` 由引导器用 `createRequire` 加载；新增依赖必须是可打包的纯 JS，`cpu-features` 等可选原生模块已设为 external，运行时自动降级。
- 二期 Go 化路线：保持 `DP_ROOT` + `bundle.cjs` + `--worker` 协议不变，可逐个把后端模块换成 Go 实现的 worker 二进制，最终去掉内嵌 Node 运行时，无需重做前端与更新通道。

---

## 18. Windows 一键安装（含集成服务）

本章面向「拿到项目后在 Windows 上直接部署使用」。平台本体是免 Node 的 `devplatform.exe`，但 **Gitea / OpenList / code-server 是三个独立服务，不会打进 exe**，所以安装器把它们一起装好、初始化好凭据、写好配置，并配置开机自启。**GitHub Release 的全量包 `devplatform-windows.zip` 已把这三个官方 Windows 程序放进 `windows\bin\`**（Gitea / OpenList / VS Code 独立 CLI），`INSTALL.bat` 会自动识别并纯离线安装，不需要再单独下载集成服务程序。

### 18.1 三种模式（没有 Docker 也能装）

平台本体是单个 `devplatform.exe`，**不依赖 Docker**。Docker 只是集成服务的一种可选载体；Windows 上没有 Docker 时，安装器会走 `native` 模式，用官方 Windows 原生程序把服务跑起来。

| 模式 | 集成服务在哪 | 前置条件 | 适用 |
|---|---|---|---|
| `native`（**无 Docker 推荐**） | 本机 Windows 原生 exe：Gitea、OpenList 单文件程序；在线 IDE 用 `code-tunnel.exe serve-web` | 无需 Docker / WSL / Node / bash；**全量发行包已自带三个 exe**（`windows\bin\`，自动纯离线安装），轻量包 / clone 首次才需联网下载或离线放置 | 普通 Windows 机器、内网机器、不想装 Docker Desktop |
| `local` | 本机 Docker Desktop 里跑三个 Linux 容器 | Docker Desktop 正在运行、能拉镜像 | 想与线上环境完全一致、已有 Docker |
| `remote` | 已部署服务器上的 3002 / 5244 / 8080 | 服务器已按第 3 章部署并初始化；本机需 Node 与 `data/state.json` | 已有测试/生产服务器，本机只开控制台 |
| `auto`（默认） | 按下面决策树自动选 | — | 直接双击 `install.bat` |

`auto` 决策树：

```text
有可用 Docker (docker info 成功)          -> local
无 Docker + 指定了 -RemoteHost 或已登记服务器 -> remote（提示可改用 -Mode native）
无 Docker + 无服务器                      -> native（零依赖，自动装原生服务）
```

> **为什么需要 `native` 单独处理**：code-server 官方只提供 Linux 版本，Windows 下没有原生等价物；`local` 模式因此依赖 Docker Desktop 的 Linux 容器。`native` 模式改用 VS Code 自带的 `code-tunnel.exe serve-web`（Windows 原生 Web IDE，`/healthz` 与平台探测兼容），Gitea / OpenList 则直接用官方 Windows amd64 二进制（都是 Go 单文件，无运行时依赖）。
>
> `local` 模式只启动 compose 里的 `gitea / openlist / code-server`；`platform` 服务带 `profiles: ["full"]` 不会启动，9000 端口归 exe，不冲突。`native` 模式完全不用 compose。
>
> **逐组件降级**：某个组件下载失败时不会中断安装——脚本会先尝试保留 `dist/.env` 中已有的远程地址（混合模式），实在没有才留 localhost 占位并给出中文提示；平台其余模块始终可用。用 `-ForceEnv` 可强制三项全部指向本机。

### 18.2 前置要求

| 项 | 要求 | 检查方式 |
|---|---|---|
| 系统 | Windows 10 1809+ / Windows 11，PowerShell 5.1+ | `$PSVersionTable.PSVersion` |
| 平台程序 | **无需预先准备**：Release 完整包内已含 exe（§18.12）；或 `git clone` 后由安装器自动获取（§18.11） | 已存在则直接用；没有也能装，只需能访问 GitHub Release，或备好离线 zip / 内网 URL |
| 端口 | 9000 / 3002 / 5244 / 8080 未被占用（Gitea SSH 222、OpenList 5245 也需空闲） | `netstat -ano \| findstr ":9000 :3002 :5244 :8080"` |
| `native` 模式 | **无需 Docker / WSL / Node / bash / 联网**（全量包）：`windows\bin\` 已自带 Gitea / OpenList / VS Code CLI，安装器自动识别并启用 `-NoDownload`；轻量包 / clone 首次需联网下载或放离线二进制，本机是否装 VS Code 都不影响 | `Test-Path windows\bin\gitea.exe`、`windows\check-integrations.ps1` |
| `local` 模式 | Docker Desktop 已安装并**正在运行**（托盘图标为 Running） | `docker info` |
| `remote` 模式 | 本机有 Node、`data/state.json` 已登记服务器、服务器 `/data/platform/.env` 已有 Token | `node -v`、`node scripts/sync-integrations.js --probe` |
| 权限 | 注册计划任务不强制管理员；失败会自动降级为「启动」文件夹快捷方式 | 安装器输出会说明 |

> 安装器不会主动安装 Docker Desktop（这通常需要重启 / 重新登录）；`local` 模式缺 Docker 时可用 `-InstallDocker` 显式触发 winget，**但更推荐直接改用 `-Mode native`**，无需重启、无需虚拟化。
>
> 内网 / 无外网机器：直接下载 Release 全量包 `devplatform-windows.zip`（已自带三个程序），解压后双击 `INSTALL.bat` 即可纯离线安装；轻量包 / `git clone` 用户把 `devplatform-services.zip` 放进 `windows\bootstrap\` 效果相同（详见 §18.10.3）。

### 18.3 一键安装

**不 clone 也行**：从 [Releases](https://github.com/sea-team/devplatform/releases/latest) 下载 `devplatform-windows.zip`（**全量包，已自带三项集成服务程序**），解压后双击根目录 `START.bat`（**只启动控制台，集成服务不会自动安装**）或 `INSTALL.bat`（控制台 + 三项集成服务 + 开机自启，**全程离线**），见 §18.12。

**最简单**：`git clone` 后直接双击 `windows\install.bat`，等它跑完，浏览器会自动打开 `http://localhost:9000`。**没有 Docker 的机器会全自动走 `native` 模式**；**没有 `platform\dist\` 也会自动下载预构建包**（§18.11），两者都不需要额外参数。

> 从 GitHub 拉代码第一次安装时，安装器开头会多一步「获取 platform\dist 预构建程序包」。若机器不通外网，把 `devplatform-dist.zip` 放进 `windows\bootstrap\` 即可完全离线，详见 §18.11.2。

等价命令行（可加参数）：

```powershell
cd devplatform

# 无 Docker：Windows 原生服务（推荐普通 Windows 机器）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native

# 无 Docker + 内网离线：用提前放好的原生二进制，不联网
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native -BinDir windows\bin -NoDownload

# 有 Docker：三个 Linux 容器（与线上环境一致）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode local

# 复用已部署服务器
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246

# clone 后无外网：用离线预构建包（zip 放进 windows\bootstrap\ 时连参数都不用）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DistZip D:\share\devplatform-dist.zip

# 先看会做什么、不改动任何东西
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun

# 尝试自动安装 Docker Desktop（winget 可用时，需重启；一般改用 -Mode native 更省事）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -InstallDocker
```

`.bat` 入口会绕过执行策略并显示结果；带参数运行时不会在结尾等待按键。`.ps1` 文件是 UTF-8 BOM，PowerShell 5.1 中文提示不会乱码。

### 18.4 安装器做了什么

| 步骤 | `local` 模式 | `native` 模式（无 Docker） | `remote` 模式 |
|---|---|---|---|
| 1 | 校验 `devplatform.exe`；缺失则自动下载 / 解压预构建包（§18.11） | 同左 | 同左 |
| 2 | 生成根 `.env`：随机管理员密码、镜像加速器前缀；已存在则保留 | 读取/生成根 `.env` 的管理员密码；创建 `windows\runtime\` 运行目录 | 调用 `scripts/sync-integrations.js` 从服务器读取地址与 Token |
| 3 | `docker compose up -d gitea openlist code-server` | 下载（或复制离线）`gitea.exe`、`openlist.exe` 到 `runtime\bin\`；生成 Gitea `custom/conf/app.ini`（SQLite + INSTALL_LOCK） | — |
| 4 | 轮询三个健康端点 | 初始化 Gitea 数据库与 admin；隐藏窗口启动三个原生进程并记录 PID | `sync-integrations.js --probe` 预检三个端点 |
| 5 | 创建 Gitea 管理员、生成 Token；设置 OpenList 密码并取 Admin Token | 同样通过 HTTP / CLI 生成两个 Token；OpenList 缺失 Token 时回退密码登录 | — |
| 6 | 生成 `platform/dist/.env`（三个 localhost + 两个 Token） | 生成 `dist/.env`：**逐组件**决定 localhost / 保留远程地址 / 占位；写 `WORKSPACE_DIR` 指向 `dist\workspace` | 由同步脚本生成 `dist/.env` |
| 7 | 生成 `autostart.vbs`（无窗口启动） | 同左，且 VBS 会先调用 `native-services.ps1 -Action start` 拉起原生服务 | 同左 |
| 8 | 注册登录计划任务 `DevPlatform`；失败降级启动文件夹 | 同左 | 同左 |
| 9 | 后台启动 exe、健康检查、打开浏览器 | 同左 | 同左 |

所有凭据只落在本机 `.env`（根目录与 `dist/`），不打印到日志、不进 Git。安装器用 PowerShell 原生实现（HTTP、docker、计划任务、随机密码、zip 解压），**平台本体不依赖 Node / bash / curl**；只有 `remote` 模式复用 `sync-integrations.js` 的 SSH 逻辑才需要 Node。`native` 模式下载大文件时优先调用系统自带 `curl.exe`（自动读 `http_proxy` / `https_proxy`），也可用 `-ProxyUrl` 指定代理。

### 18.5 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Mode` | `auto` | `auto` / `local` / `native` / `remote`；无 Docker 时用 `native` |
| `-RemoteHost` | 空 | remote 模式指定服务器 IP；留空取 `data/state.json` 第一台 |
| `-InstallDocker` | 关 | 无 Docker 时尝试 `winget install Docker.DockerDesktop`，之后需重启 |
| `-NoService` | 关 | 跳过开机自启注册 |
| `-NoLaunch` | 关 | 只装配置、不启动 exe、不开浏览器 |
| `-DryRun` | 关 | 只打印计划，不写文件、不启容器、不注册任务 |
| `-Port` | 9000 | 平台监听端口，写入 `dist/.env` 与浏览器地址 |
| `-ImagePrefix` | `docker.m.daocloud.io` | 镜像加速器前缀；能直连 Docker Hub 时用 `-ImagePrefix ''` |
| `-BinDir` | 空 | `native`：提前放置 `gitea.exe` / `openlist.exe`（或官方 zip）的离线目录 |
| `-NoDownload` | 关 | `native`：禁止联网下载，只用 `-BinDir` 或 `runtime\bin\` 里已有的二进制 |
| `-ForceEnv` | 关 | `native`：强制 `dist/.env` 三项全部指向本机，不保留已有远程地址 |
| `-IdeMode` | `auto` | `auto`（找 VS Code）/ `code`（必须 VS Code）/ `wsl`（自行在 WSL 装 code-server）/ `none`（不启用在线 IDE） |
| `-GiteaVersion` | `1.23.8` | Gitea Windows exe 版本，决定 `dl.gitea.com` 下载路径 |
| `-OpenListVersion` | `v4.2.6` | OpenList release tag |
| `-DownloadProxy` | `https://ghfast.top/` | GitHub release 的加速前缀（实测该源最稳）；脚本还会依次尝试多个备用源与体积更小的 lite 包，直连可用时可填 `''` |
| `-ProxyUrl` | 空 | 供 `curl.exe` 使用的 HTTP 代理（`http_proxy` 环境变量通常已够用） |
| `-DistZip` | 空 | **首次安装**：本地 `devplatform-dist.zip` 或已构建好的 `platform\dist\` 目录；指定后不再尝试其它来源 |
| `-DistUrl` | 空 | **首次安装**：自定义下载地址（内网 HTTP 常用），优先于 GitHub Release |
| `-Repo` | `sea-team/devplatform` | **首次安装**：Release 所在仓库；fork 后改成自己的 `owner/repo` |
| `-ReleaseTag` | `latest` | **首次安装**：指定 Release tag，如 `v0.2.0` |
| `-SkipDistDownload` | 关 | **首次安装**：禁用联网下载，只用本地已有文件 / `-DistZip` / `-DistUrl` |

> `-NoDownload` 只管 `native` 模式的 Gitea / OpenList 二进制；禁用平台预构建包的自动下载要用 `-SkipDistDownload`，两者互不影响。

> `-DryRun` 对 `native` 模式同样有效：只打印「下载哪些文件、启动哪些进程、写入哪些配置」，不下载、不启动、不写文件、不注册任务。

### 18.6 服务管理

| 操作 | 命令 |
|---|---|
| 启动平台 | 双击 `windows\start.bat`（最小化窗口）；`native` 模式会先拉起原生服务 |
| 停止平台 | 双击 `windows\stop.bat`（结束 `devplatform.exe`；`native` 模式随后停掉三个原生服务） |
| 原生服务状态 | `powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action status` |
| 只启 / 只停原生服务 | 同上，把 `-Action` 换成 `start` / `stop` |
| 重装 / 补装原生服务 | `powershell -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native`（幂等，已有二进制不重复下载） |
| 开机自启 | 登录后由计划任务 `DevPlatform` 无窗口拉起；非管理员时是「启动」文件夹的 `DevPlatform.lnk` |
| 查看自启 | `Get-ScheduledTask -TaskName DevPlatform` |
| 关闭自启 | `Unregister-ScheduledTask -TaskName DevPlatform -Confirm:$false` |
| 卸载 | `powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1` |
| 连容器一起停 | 加 `-RemoveContainers`（`docker compose down`，**数据卷保留**） |
| 连原生服务数据一起删 | 加 `-RemoveNative -Force`（删除 `windows\runtime\`，含 Gitea 仓库与 OpenList 数据）；默认只停进程、保留数据 |
| 连配置一起删 | 加 `-RemoveConfig -Force`（删根 `.env`、`dist/.env`、`autostart.vbs`） |

卸载默认保留 `workspace/`、`data/`、`data/state.json` 与 Docker 卷，重装不会丢仓库和构建记录。

> **改 `.env` 后必须完全重启 exe**：`loadDotEnv()` 只在进程启动且环境变量未定义时注入，`devplatform.exe reload` 只重启业务进程、不重读配置（§17.8）。

### 18.7 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `git clone` 后报「缺少 devplatform.exe」 | `dist/` 按设计不入库，旧版安装器只做了校验 | 更新到含 §18.11 的版本后重跑 `install.bat`：会自动下载 Release 预构建包；无外网就把 `devplatform-dist.zip` 放进 `windows\bootstrap\` |
| 提示「本机 local 模式需要 Docker Desktop」 | 显式指定了 `-Mode local` 但没装 Docker | 直接改用 `-Mode native`（无需 Docker）；或启动 Docker Desktop 后重跑 |
| OpenList / Gitea 下载失败（504 / 超时 / 内网） | GitHub release 或代理不可达 | 默认已改用实测最稳的 `ghfast.top`，并会自动尝试多个源与 lite 包；仍失败则把 `gitea.exe` / `openlist.exe` 放到 `windows\bin\`，用 `-BinDir windows\bin -NoDownload` 重跑（§18.10.3）。期间平台本体照常装好，该组件显示「离线/未配置」 |
| 在线 IDE 显示离线或首次打开很慢 | 本机没装 VS Code，或 `serve-web` 首次需从微软 CDN 拉取 server 组件 | `-IdeMode none` 明确不启用；或装 VS Code 后重跑；`runtime\logs\ide.out.log` 看进度 |
| 原生服务起不来 | 端口被占、配置生成失败、exe 不匹配 | `-Action status` 看端口/PID；查 `windows\runtime\logs\*.err.log`；确认 3002 / 5244 / 8080 空闲 |
| 安装日志出现「已添加项，字典中的关键字…」或进程一个都起不来 | 本机代理工具同时注入了 `HTTPS_PROXY` 与 `https_proxy`，PowerShell 5.1 的 `Start-Process` 构造环境变量字典时大小写冲突 | 脚本已在启动子进程前自动去重并在结束后恢复，无需手工处理；若仍失败，临时执行 `Remove-Item Env:https_proxy,Env:http_proxy` 后重跑 |
| 重复安装时提示 `user already exists` | Gitea 管理员已创建，属幂等重跑的正常现象 | 脚本已把原生 CLI 的 stderr 降级为提示，不会中断安装；Token 会重新生成并写回 `.env` |
| `stop.bat` 没停掉服务 | 端口被非本平台进程占用，脚本为避免误杀主动跳过 | 输出会有 `[WARN] 被非本平台进程占用`；手工处理该进程，或改端口 |
| Docker Desktop 装完仍报未就绪 | WSL2 / 虚拟化未启用，或安装后需注销重登 | 重启一次再跑脚本；确认 `docker info` 成功 |
| 镜像拉取超时 | Docker Hub 不可达 | 保持默认 `-ImagePrefix docker.m.daocloud.io`；或换可达加速器后重跑（脚本会保留已有 `.env`，需手工改 `*_IMAGE`） |
| `docker compose` 不存在 | 老版 Docker | 安装器自动回退到 `docker-compose` v1 |
| Gitea Token 生成失败 | 管理员密码与 `.env` 不一致，或 `INSTALL_LOCK` 未生效 | 确认根 `.env` 的 `OPENLIST_PASSWORD` 与容器初始化一致；删除 `data/gitea` 后重跑会重建（会丢 Gitea 数据） |
| 三项仍显示离线 | `dist/.env` 未生效或地址不通 | 完全重启 exe；`node scripts/sync-integrations.js --probe`；看 §17.8 的四态说明 |
| 打开 IDE 不是本机项目 | code-server 容器里是 `./workspace:/home/coder/project` 映射 | 本机模式两者已一致（都指向 `workspace/`）；remote 模式见 §17.8 的已知差异 |
| 想对外网提供访问 | 默认 `ADMIN_TOKEN` 为空（不鉴权） | 在 `dist/.env` 设置 `ADMIN_TOKEN`，前端按第 5 章写入 `dp_token`，并配置防火墙 |
| 计划任务注册失败 | 组策略限制 | 安装器自动降级为启动文件夹快捷方式；或加 `-NoService` 用 `start.bat` 手动启动 |

### 18.8 手动安装对照（不用一键脚本）

```powershell
# 1. 已有 devplatform.exe（或先 npm run build）
cd platform; npm run build; cd ..

# 2. 配置：复制 .env.example 为 .env，至少填写
#    OPENLIST_PASSWORD=<随机密码>   CODE_SERVER_PASSWORD=<随机密码>
#    国内网络保留 GITEA_IMAGE / OPENLIST_IMAGE / CODE_SERVER_IMAGE 加速器

# 3. 启动三个集成服务（platform 服务带 full profile，不会被启动）
docker compose up -d gitea openlist code-server

# 4. 初始化凭据（Git Bash / WSL 里执行，幂等）
bash scripts/setup-integrations.sh

# 5. 把生成的 GITEA_TOKEN / OPENLIST_TOKEN 写进 platform/dist/.env：
#    GITEA_URL=http://localhost:3002
#    OPENLIST_URL=http://localhost:5244
#    CODE_SERVER_URL=http://localhost:8080
#    GITEA_TOKEN=...   OPENLIST_TOKEN=...   OPENLIST_USER=admin

# 6. 启动并验证
.\windows\start.bat
curl http://localhost:9000/api/overview
```

**无 Docker 的手动对照**（等价于 `-Mode native`，排错时可逐步执行）：

```powershell
# 1. 准备目录与二进制
New-Item -ItemType Directory -Force windows\runtime\bin, windows\bin
#    把 gitea.exe、openlist.exe 放进 windows\bin（见 §18.10.3 的下载地址）

# 2. 一键完成配置生成、进程启动、Token 初始化、写 dist/.env
powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action setup -BinDir windows\bin -NoDownload

# 3. 查看三个服务端口与 PID
powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action status

# 4. 完全重启 exe 让 dist/.env 生效，再验证
.\windows\stop.bat; .\windows\start.bat
curl http://localhost:9000/api/overview
```

### 18.9 安装后验证清单

```powershell
# 平台健康
curl http://localhost:9000/api/health
# 三项集成服务应全部 status=online
curl http://localhost:9000/api/overview
# 容器状态（local 模式）
docker compose ps
# 原生服务状态（native 模式，应全为 LISTENING）
powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action status
# 配置检查（不显示 Token）
node scripts/sync-integrations.js --check
node scripts/sync-integrations.js --probe
```

浏览器打开 `http://localhost:9000`，总览「集成服务」三项应为绿色「在线」。`local` / `remote` 模式下 Gitea `http://localhost:3002`、OpenList `http://localhost:5244`、code-server `http://localhost:8080` 均可访问；`native` 模式下 8080 打开的是 VS Code Web。Gitea/OpenList 管理员账号为 `admin`，密码在根 `.env` 的 `OPENLIST_PASSWORD`；code-server 密码在 `CODE_SERVER_PASSWORD`（`native` 模式的 VS Code Web 不需要密码，仅监听 127.0.0.1）。

---

### 18.10 无 Docker 环境（native 模式）详解

这一节专门说明「Windows 上没有 Docker Desktop、也不想装」时，集成服务是怎么跑起来的、文件放在哪、离线怎么办、以及和 Docker 模式的差异。

#### 18.10.1 三个组件换成什么

| 组件 | `native` 模式 | 来源 | 体积 |
|---|---|---|---|
| Git 仓库 | `gitea.exe web --config <app.ini>`，SQLite 单库、内置 SSH 关闭 | Gitea 官方 Windows amd64 exe（Go 单文件，无运行时依赖） | ≈ 112 MB |
| 存储挂载 | `openlist.exe server` | OpenList 官方 `openlist-windows-amd64.zip` 里的 `openlist.exe` | ≈ 48 MB |
| 在线 IDE | `code-tunnel.exe serve-web --port 8080 ...` | 全量包随带的 VS Code 官方独立 CLI（`code.exe` 重命名）；未自带时回退本机已装 VS Code | ≈ 29 MB（随包） |
| 平台本体 | `platform/dist/devplatform.exe` | 已构建好的单文件程序 | ≈ 84 MB |

`code-server` 官方没有 Windows 版，所以 `native` 模式用 VS Code 自带的 `serve-web` 代替。实测它的 `/healthz` 返回 2xx，平台现有的 `/api/overview` 探测逻辑**无需改动**即可判定在线；浏览器打开 `CODE_SERVER_URL` 就是完整的 VS Code Web UI。

> **全量发行包已内置这三项程序**（`windows\bin\`，由 CI 的 `windows/fetch-services.ps1` 从官方源抓取，并写入 `services-manifest.json` / `THIRD-PARTY.txt`）。`INSTALL.bat` 检测到三项齐全会自动加 `-NoDownload`，下面这些下载源只对轻量包 / `git clone` 用户生效。

下载源按可达性依次尝试，任一成功即停：

- Gitea：`https://dl.gitea.com/gitea/<版本>/gitea-<版本>-windows-4.0-amd64.exe`（官方 CDN，国内通常可达）→ `-DownloadProxy` 转发 GitHub → GitHub 直连；单文件超时 420 秒。
- OpenList：完整版 `openlist-windows-amd64.zip` 与体积更小的 `openlist-windows-amd64-lite.zip` 各试一轮；每轮按 `-DownloadProxy`（默认 `https://ghfast.top/`，实测最稳）→ `ghproxy.net` → `gh-proxy.com` → `hub.gitmirror.com` → `gh.llkk.cc` → `ghproxy.cc` → GitHub 直连依次尝试。任一成功即停，单个源超时 120 秒，**总下载预算 8 分钟**，超时后不再空转，直接走「逐组件降级」（§18.10.5）。
- 下载用系统自带 `curl.exe`（自动读 `http_proxy` / `https_proxy`），失败自动回退 `Invoke-WebRequest`；可用 `-ProxyUrl` 显式指定代理。

#### 18.10.2 目录与端口

```
windows/runtime/              # 整个目录不入库（.gitignore 已排除）
├── bin/                      # gitea.exe / openlist.exe（下载或离线复制）
├── gitea/
│   ├── custom/conf/app.ini   # 自动生成：SQLite、INSTALL_LOCK、127.0.0.1:3002
│   ├── data/gitea.db         # Gitea 数据库
│   ├── repositories/         # Git 仓库实体
│   └── logs/
├── openlist/data/            # config.json、data.db、日志（首次启动自动生成）
├── ide/                      # VS Code serve-web 的 server-data-dir
├── logs/                     # gitea/openlist/ide 各自的 out/err 日志
├── services.json             # 服务清单（存在即表示已装原生模式）
└── pids.txt                  # 三个进程的 PID
```

| 端口 | 用途 | 绑定 |
|---|---|---|
| 9000 | 平台控制台（exe） | 0.0.0.0 |
| 3002 | Gitea HTTP | 127.0.0.1（内置 SSH 已关闭，不占 222） |
| 5244 | OpenList | 默认（其 `data/config.json` 中 `scheme.http_port`） |
| 8080 | VS Code Web IDE | 127.0.0.1，`--without-connection-token` |

> `native` 模式把 `WORKSPACE_DIR` 显式写成 `platform/dist/workspace`——这是 exe 的实际工作区（`DP_ROOT/workspace`）。IDE 的 `--default-folder` 也指向它，因此**在线 IDE 与平台的文件管理器看到的是同一份文件**，这一点比 `remote` 模式更一致。

#### 18.10.3 内网 / 离线安装（全量包开箱即用）

**全量包 `devplatform-windows.zip` 不需要下面的手动步骤**：`windows\bin\` 已含 `gitea.exe` / `openlist.exe` / `code-tunnel.exe` + `services-manifest.json` + `THIRD-PARTY.txt`，由 CI 通过 `windows/fetch-services.ps1` 从官方源抓取。`install.ps1 -Mode native` 会自动把 `windows\bin` 作为离线源，三项齐全时自动启用 `-NoDownload`；`native-services.ps1` 再把 exe 复制进 `windows\runtime\bin\` 后启动。全程零联网。

轻量包 / `git clone` 用户有三种等价的离线补齐方式：

| 方式 | 操作 | 结果 |
|---|---|---|
| 全量包（推荐） | 直接下载 `devplatform-windows.zip` 解压 | 开箱离线 |
| 服务补充包 | 把 `devplatform-services.zip` 原样放到 `windows\bootstrap\devplatform-services.zip`，再跑 `INSTALL.bat` | `native-services.ps1` 自动解压到 `runtime\bin\` |
| 手工放置 | 把三个 exe / OpenList 官方 zip 放进 `windows\bin\` | 自动识别（zip 会自动解压取 exe） |

手工放置时的官方来源（也可用 `windows\fetch-services.ps1 -RequireCore` 一把抓齐，幂等、已有文件自动跳过）：

| 文件名 | 下载地址 |
|---|---|
| `gitea.exe` | `https://dl.gitea.com/gitea/1.23.8/gitea-1.23.8-windows-4.0-amd64.exe` |
| `openlist.exe` / `openlist-windows-amd64.zip` / `openlist-windows-amd64-lite.zip` | `https://github.com/OpenListTeam/OpenList/releases/download/v4.2.6/openlist-windows-amd64.zip` |
| `code-tunnel.exe` | `https://update.code.visualstudio.com/latest/cli-win32-x64/stable`（zip 里的 `code.exe` 重命名） |

强制纯离线安装（一般不必加参数，安装器会自动判断）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native -BinDir windows\bin -NoDownload
```

`-BinDir` 里可放 `gitea.exe`、`openlist.exe`、`code-tunnel.exe`、任一 OpenList 官方 zip 的任意组合；`-NoDownload` 保证完全不联网。另一种分发方式是：在一台联网机器跑完 `-Mode native`，把整个 `windows\runtime\` 连同 `platform\dist\` 一起拷到目标机，脚本检测到 `runtime\bin\` 里已有二进制就不会重复下载。

#### 18.10.4 在线 IDE 的四种选择

| `-IdeMode` | 行为 |
|---|---|
| `auto`（默认） | 优先用 `windows\runtime\bin\code-tunnel.exe` / 随包 `windows\bin\code-tunnel.exe`；没有再找 `code.cmd` 同目录的 `code-tunnel.exe`（含 `%LOCALAPPDATA%`、`%ProgramFiles%` 常见安装位置）；都找不到则该项保持「未配置」，其余模块照常 |
| `code` | 强制要求 VS Code；找不到时明确警告 |
| `wsl` | 不接管 IDE 生命周期，提示你在 WSL 发行版内自行安装并监听 8080 的 code-server |
| `none` | 完全不启用在线 IDE |

`serve-web` 的实际参数：`--host 127.0.0.1 --port 8080 --without-connection-token --accept-server-license-terms --disable-telemetry --server-data-dir runtime/ide --default-folder platform/dist/workspace`。首次启动可能从微软 CDN 拉取对应 commit 的 server 组件（日志在 `runtime/logs/ide.out.log`），内网机器若拉不到，IDE 会显示离线但不会拖垮安装。

#### 18.10.5 逐组件降级与混合模式

`native` 模式不会因某一个组件装不上而失败：

| 情况 | `dist/.env` 里这一项 | 结果 |
|---|---|---|
| 本机二进制成功启动 | `http://localhost:<端口>` + 新 Token | 在线 |
| 二进制下载失败，但已有可用的远程地址 | 保留原远程 URL 与 Token | **混合模式**：本机 Gitea/IDE + 远程 OpenList（或反之），仍在线 |
| 两者都没有 | `http://localhost:<端口>`，Token 留空 | 该项显示「未配置/离线」并给出中文提示，平台与其他模块正常 |

加 `-ForceEnv` 会强制三项全部写成本机地址，用于验证或彻底脱离服务器。改完 `dist/.env` 记得**完全重启 exe**（`reload` 不重读配置）。

#### 18.10.6 生命周期与安全

- 三个服务以**隐藏窗口**方式启动，PID 写入 `pids.txt`，标准输出/错误分别落到 `runtime/logs/*.out.log` / `*.err.log`。
- 开机自启：`platform/dist/autostart.vbs` 先调用 `native-services.ps1 -Action start` 拉起原生服务，再启动 exe；两者互不阻塞。`start.bat` / `stop.bat` 同样联动。
- 停止时先按 PID 结束；端口兜底只停「可执行文件位于 `windows/runtime/` 或命令行包含该路径」的进程，端口被别的程序占用时会**警告并跳过，绝不误杀**。
- 卸载默认停掉原生进程但**保留** `runtime\`（Gitea 仓库、OpenList 数据）；只有 `-RemoveNative -Force` 才会删除。
- 三个服务都只监听本机回环或默认本机端口；若要对局域网开放，需要自行改 Gitea `app.ini` / OpenList `config.json` / `serve-web --host`，并在 `dist/.env` 设置 `ADMIN_TOKEN`（§14）。

#### 18.10.7 与另外两种模式的差异

| 维度 | `native` | `local` | `remote` |
|---|---|---|---|
| 需要 Docker | 否 | 是 | 否 |
| 需要 Node / bash | 否 | 否 | 是（同步脚本） |
| 集成服务进程 | Windows 原生 exe + VS Code | Linux 容器 | 远端服务器 |
| Git 克隆方式 | HTTP（内置 SSH 关闭） | HTTP / SSH（compose 映射 222） | 远端配置 |
| IDE | VS Code Web（扩展随本机 VS Code） | code-server（独立扩展目录） | 远端 code-server |
| 工作区 | `platform/dist/workspace`，IDE 与文件管理一致 | compose 映射的 `workspace/` | 远端 `/home/coder/project`，与本机文件管理**不是同一份** |
| 离线可用 | 可以（全量包开箱离线；轻量包用 `devplatform-services.zip` 或 `-BinDir -NoDownload`） | 需先拉好镜像 | 需服务器在线 |
| 升级 | 替换 `runtime/bin/*.exe` 后重跑 setup | `docker compose pull && up -d` | 远端 deploy |

#### 18.10.8 已知限制

- `serve-web` 不是 code-server：扩展、设置、登录态都跟随本机 VS Code 安装，不共享 code-server 的扩展目录。
- Gitea Windows 版关闭了内置 SSH（`DISABLE_SSH = true`），请用 HTTP 地址克隆；若需要 SSH，编辑 `windows/runtime/gitea/custom/conf/app.ini` 自行开启并放行端口。
- 三个原生进程是「登录时由计划任务拉起」，不是 Windows 服务；注销后停止，重新登录自动恢复。
- OpenList 若未来调整 `admin token` 输出格式，脚本取不到 Token 时会回退到 `OPENLIST_PASSWORD` 登录（平台已支持），不会中断安装。
- 二进制版本默认固定为 Gitea `1.23.8` / OpenList `v4.2.6`；升级用 `-GiteaVersion` / `-OpenListVersion`，或手动替换 `runtime/bin/` 下的 exe。
- 下载大文件受网络影响较大（Gitea 约 112 MB）；Gitea 优先用官方 `dl.gitea.com`，OpenList 默认走 `ghfast.top`（2026-11 实测：GitHub 直连大文件会被代理截断到 2 MB，其它加速源多超时，仅该源可完整下载 48 MB 包并校验通过）。**全量发行包已内置这些二进制，可直接跳过整条下载链路**；只有轻量包 / `git clone` 用户才需要它，仍不通就下载 `devplatform-services.zip` 或用 `-BinDir -NoDownload` 离线放置。

### 18.11 从 GitHub clone 后首次安装（无 Node、无 dist）

**问题**：`git clone` 出来的仓库里没有 `platform/dist/devplatform.exe`——`dist/` 在 `.gitignore` 中，84 MB 的 exe 刻意不入库。以前直接跑 `install.ps1` 会报「缺少 devplatform.exe；请先在有 Node 的机器上执行 npm run build」。

**现在**：安装器第一步 `Ensure-Dist` 自动补齐，按以下优先级取包：

| 顺序 | 来源 | 触发方式 | 适用场景 |
|---|---|---|---|
| 1 | 已有 `platform/dist/` | 自动检测 | 已构建 / 已拷贝过 |
| 2 | `-DistZip <zip 或 dist 目录>` | 显式指定 | 内网、离线、指定版本 |
| 3 | `windows\bootstrap\devplatform-dist.zip` | 放进去即可，零参数 | **内网批量分发（推荐）** |
| 4 | `-DistUrl <http://...>` | 显式指定 | 内网文件服务器 |
| 5 | GitHub Release `devplatform-dist.zip` | 默认自动，`-ReleaseTag` 指定版本 | 有外网的新机器 |

下载依次尝试 `ghfast.top` 加速 → GitHub 直连 → `gh-proxy.com` / `hub.gitmirror.com` / `ghproxy.net`，单源超时 300 秒。拿到包后先校验结构（必须含 >10 MB 的 `devplatform.exe`，避免把 504 页面当包），再尝试下载同目录 `SHA256SUMS.txt` 做哈希校验（取不到则跳过、不阻断），最后解压到 `platform/dist/`。**已有的 `.env` / `data/` / `workspace/` 一律保留**，不会被覆盖。

#### 18.11.1 让仓库自动发布预构建包

仓库维护者做一次（有推送权限即可，不需要本机装 Node）：

```bash
git tag v0.2.2
git push origin v0.2.2
```

`.github/workflows/release.yml` 会在 `windows-latest` 上执行 `npm ci` → `npm run build` → `windows/pack-dist.ps1` → `windows/pack-release.ps1`，把四类资产发布到该 tag 的 Release：`devplatform-windows.zip`（完整绿色包）、`devplatform.exe`（自包含单文件）、`devplatform-dist.zip`（clone 用户自动下载的组件包）、`SHA256SUMS.txt`（三者校验值）。完整包与单 exe 的用法见 §18.12。也可在 Actions 页面手动运行并输入 tag。`build.mjs` 会**从当前 node.exe 动态提取 SEA sentinel 字面量**，所以 CI 换 Node 22 小版本也不会因硬编码常量构建失败。

> 仓库为 public，Release 资产无需任何 Token 即可下载。升版本时请同步 `platform/package.json` 的 `version` 与 tag。

#### 18.11.2 内网 / 完全离线

在**已有构建产物的一台机器**上生成包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-dist.ps1
# 产出 windows\bootstrap\devplatform-dist.zip（约 35 MB）+ SHA256SUMS.txt

# 一次性生成 Release 的全部四类资产（含完整绿色包与独立 exe）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1
```

`pack-release.ps1` 会复用已有的 `devplatform-dist.zip`，另外产出 `devplatform-windows.zip`（完整绿色包）、`devplatform.exe`（独立自包含单文件），并把三个文件的哈希一起写进 `SHA256SUMS.txt`。可直接把 `devplatform-windows.zip` 拷给内网机器解压使用，完全离线。

把 zip 拷到目标机器的 `windows\bootstrap\`（该目录随仓库存在），直接双击 `install.bat` 即可，不需要任何参数、不需要外网。也可以显式指定：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DistZip D:\share\devplatform-dist.zip
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DistUrl http://10.0.0.5/pkg/devplatform-dist.zip
```

`-DistZip` 也接受**一个已构建好的 `platform\dist\` 目录**，此时直接复制、不解压。用 `-SkipDistDownload` 可彻底禁用联网下载。

#### 18.11.3 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `未能获取 ... devplatform.exe` | 仓库还没有 Release，也没有离线包 | 按 §18.11.1 推 tag，或按 §18.11.2 放 zip |
| 「不是有效预构建包」 | 代理返回 504 页面 / 大文件被截断 | 换 `-DistUrl` 指向内网源，或用 `windows\bootstrap\` 离线包 |
| `SHA256 不匹配` | 包与校验文件不是同一版本 | 重跑或指定 `-ReleaseTag` |
| CI 报 `Could not find the sentinel` | Node 版本差异 | `build.mjs` 已动态提取；确认 `actions/setup-node` 用官方 Node 22 |
| fork 后仍下载到原仓库的包 | 默认 `-Repo` 未改 | 加 `-Repo <你的 owner/repo>` |
| `-DryRun` 没看到下载 | DryRun 只打印计划 | 去掉 `-DryRun` 才会真正下载解压 |

### 18.12 从 GitHub Release 直接下载使用（免 clone）

§18.11 解决的是「已经 clone 了仓库但没有 exe」；本节是**连仓库都不需要**的用法。Release 页面：https://github.com/sea-team/devplatform/releases/latest （public 仓库，无需登录 / Token）。

> **最容易误解的一点**：全量包里 `START.bat` **只启动控制台**，`INSTALL.bat` 才安装 Gitea / OpenList / 在线 IDE。只跑前者时三项显示「未配置 / 离线」是预期行为；`START.bat` 现在会在启动前把状态明确打印出来。**好消息是**：全量包已自带这三项的官方二进制，`INSTALL.bat` 全程离线，不用再单独去下载集成服务程序。

#### 18.12.1 六个资产怎么选

| 资产 | 体积 | 用途 | 需要 git / Node / Docker / 联网 |
|---|---|---|---|
| **`devplatform-windows.zip`** | 约 134 MB | **推荐 · 全量包**：程序 + 全部安装脚本 + `START/INSTALL/STOP.bat` + 中文说明 + **随包自带的三个集成服务程序**（`windows\bin\`，原始大小约 279 MB，压缩后随包） | 全不需要，**安装集成服务也不需要联网** |
| `devplatform-windows-lite.zip` | 约 36 MB | 轻量包：只含控制台与脚本；`INSTALL.bat` 首次需联网下载服务程序 | 全不需要，装服务时需联网 |
| `devplatform-services.zip` | 约 101 MB | 仅三个官方 exe + 清单；放进轻量包 / `git clone` 的 `windows\bootstrap\` 即可离线安装 | 全不需要 |
| `devplatform.exe` | 约 88 MB | 自包含单文件，放任意空目录双击即用；适合只要控制台或自行管理集成服务 | 全不需要 |
| `devplatform-dist.zip` | 约 35 MB | 只有 `platform\dist\` 内容；给 `git clone` 后 `install.bat` 自动下载用，**一般不用手工下载** | 需要仓库脚本配套 |
| `SHA256SUMS.txt` | < 1 KB | 以上资产的 SHA256 校验值 | — |

> 全量包内 `windows\bin\services-manifest.json` 记录三个二进制的版本、官方来源与 SHA256，`THIRD-PARTY.txt` 是上游许可说明；三个文件都是官方原版、未修改。

> **别混淆两个入口**：`START.bat` = **只启动控制台**；`INSTALL.bat` = 控制台 **+** 三项集成服务 **+** 开机自启。只跑 `START.bat` 时，控制台里 Gitea / OpenList / 在线 IDE 显示「未配置 / 离线」是**预期行为**，不是故障。`START.bat` 启动前会调用 `windows\check-integrations.ps1`，把三项的在线状态、本机原生服务是否已安装、以及下一步该做什么直接打印在窗口里。

> 都只依赖 Windows 自带的 PowerShell 5.1，没有 Node、bash、WSL、Docker 也能跑。

#### 18.12.2 全量绿色包：两个入口，按需选择（推荐）

1. 下载 `devplatform-windows.zip`，解压（建议路径**不要带中文和空格**，例如 `D:\devplatform\`）。
2. **只要控制台** → 双击解压根目录的 **`START.bat`**：
   - 启动前先运行 `windows\check-integrations.ps1`：窗口里打印 `Gitea / OpenList / 在线 IDE` 各自的地址与在线状态、本机原生服务是否已安装，以及下一步指引；若之前装过本机原生服务会自动拉起。
   - 然后启动控制台并打开 `http://localhost:9000`；首次启动会在 `platform\dist\` 下释放 `bundle.cjs`、`public\`、`release.json`、`.env` 模板。服务器管理、SSH / Web 终端、远程文件与编辑器、AI、构建部署、系统状态立即可用。
   - **这一步不会安装集成服务**，控制台里三项显示「未配置 / 离线」是预期行为。
3. **要 Gitea / OpenList / 在线 IDE** → 双击 **`INSTALL.bat`**（等价 `windows\install.bat`）：有 Docker 走容器、无 Docker 自动走 Windows 原生 exe（§18.10）。**全量包已自带三个程序**，安装器检测到 `windows\bin\` 三项齐全会自动启用 `-NoDownload`，全程离线；在线 IDE 也不要求本机装 VS Code。装完会写好 `.env` 的地址与 Token 并启动服务，之后日常只需 `START.bat`（自动拉起已装好的原生服务）。复用已部署服务器则执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246
```

4. **只想连已有服务、不想装本机组件**：把地址与 Token 填进 `platform\dist\.env`（或在控制台登记服务器），然后完全重启 exe。
5. 停止用根目录 `STOP.bat`；卸载用 `windows\uninstall.ps1`（默认保留数据）。

想单独复查集成服务状态（不改任何东西）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1 -Json
```

解压后的结构：

```
DevPlatform\
├─ START.bat / INSTALL.bat / STOP.bat   ← 顶层快捷入口
├─ README-RELEASE.txt                  ← 中文速查说明（随包附带）
├─ .env.example                        ← 全部配置项说明
├─ platform\dist\                      ← 程序本体与所有运行时状态
│   ├─ devplatform.exe / bundle.cjs / release.json / public\
│   └─ .env / data\ / workspace\       ← 首启生成，凭据都在这里
├─ windows\                            ← install / native-services / check-integrations / stop / uninstall 等脚本
│   ├─ bin\                            ← 随包自带的三个官方服务程序 + 清单 + 许可说明
│   └─ bootstrap\                      ← 内网可放 devplatform-dist.zip / devplatform-services.zip
└─ scripts\                            ← remote 模式同步配置用（需 Node）
```

包内**不含** `.env`、`data\`、`state.json`、`windows\runtime\` 等本机状态与凭据；`INSTALL.bat` 检测到 exe 已存在会跳过联网取包，且三个集成服务程序已在 `windows\bin\`，因此**整包可以在完全离线环境完成安装**（轻量包才需要首次联网下载）。

#### 18.12.3 单文件 exe：下载一个文件就能跑

`devplatform.exe` 的 SEA 快照里内嵌了 `bundle.cjs`、`release.json` 与 `public.tar.gz`。放到任意空文件夹双击，首启会在 exe 同目录自动补齐四个文件（**已存在的同名文件绝不覆盖**，所以热更新与用户改过的 `.env` 都保留）：

```
bundle.cjs     业务包（之后可用 devplatform.exe update 热更）
public\        前端资源
release.json   版本清单
.env           配置模板，集成服务地址 / Token 在这里改
```

注意事项：

- 首次启动后目录必须**可写**；不要放在 `C:\Program Files\` 等受限目录。
- 集成服务默认指向 `localhost:3002 / 5244 / 8080`，未启动时控制台显示「未配置 / 离线」，不影响其它模块。把已有服务地址与 Token 填进 `.env` 后**必须完全关闭并重启 exe**（`reload` 不重读配置）。
- 业务与前端可在线热更（`devplatform.exe update <目录或 release.json URL>` / `rollback`）；exe 壳本身升级时下载新版 `devplatform.exe` 覆盖即可，旁边的 `.env`、`data\`、`workspace\` 不会被覆盖。

#### 18.12.4 自己生成发行包 / 内网分发

在已有构建产物的机器上准备随包二进制并生成全部资产（默认输出到 `windows\bootstrap\`）：

```powershell
# 1) 从官方源抓取 Gitea / OpenList / VS Code CLI 到 windows\bin（幂等，已有则跳过）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\fetch-services.ps1 -RequireCore
# 2) 生成六个资产（全量包 / 轻量包 / 服务补充包 / 组件包 / 单 exe / 校验文件）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1 -IncludeServices
powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1 -IncludeServices -OutputDir D:\share
```

`fetch-services.ps1` 会校验 PE 头、写 `services-manifest.json`（版本 / 来源 / SHA256）与 `THIRD-PARTY.txt`；`pack-release.ps1 -IncludeServices` 调用 `pack-dist.ps1` 生成组件包，用 `windows\release\` 模板组装**全量包与轻量包**，另产出 `devplatform-services.zip`，并把五个文件的哈希写入 `SHA256SUMS.txt`。GitHub Actions (`.github/workflows/release.yml`) 用的就是这两个命令，CI 里还有 `actions/cache` 缓存二进制。不加 `-IncludeServices` 时保持旧行为（只产一个不含服务的 `devplatform-windows.zip`）；可用 `-Dist` / `-ServicesDir` 指定程序与二进制来源。

校验（Windows PowerShell）：

```powershell
Get-FileHash .\devplatform-windows.zip -Algorithm SHA256
# 与 SHA256SUMS.txt 比对
```

Git Bash / WSL / Linux 可直接 `sha256sum -c SHA256SUMS.txt`。**v0.3.1 及更早版本**的清单由 Windows CI 以 CRLF 写出，`\r` 会被 `sha256sum` 当成文件名的一部分而全部报 `FAILED open or read`，需先规范化换行：

```bash
tr -d '\r' < SHA256SUMS.txt | sha256sum -c -
```

仓库主分支的 `pack-dist.ps1` / `pack-release.ps1` 已统一改为 LF（无 BOM），PowerShell `Get-Content` / `Get-FileHash` 与 `sha256sum -c` 均可直接使用；已发布的旧资产内容不变，按上面的命令处理即可。

内网机器把整个 `devplatform-windows.zip` 拷过去解压即可，不需要访问 GitHub；解压后同样记得区分 `START.bat`（只启动控制台）与 `INSTALL.bat`（连集成服务一起装，**三项程序已在包内**）。已有轻量包 / clone 安装的机器，只需把 `devplatform-services.zip` 拷进 `windows\bootstrap\` 即可升级成离线全量；clone 方式取程序包则把 `devplatform-dist.zip` 也放进 `windows\bootstrap\`（§18.11.2）。

#### 18.12.5 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 双击 `START.bat` 一闪而过 | exe 不在 `platform\dist\`，或解压时丢了目录层级 | 保留 zip 里的 `DevPlatform\` 整层目录；确认 `platform\dist\devplatform.exe` 存在 |
| 首次启动浏览器显示连接失败 | 首启释放前端资源需要几秒 | 等 3–5 秒刷新；或看 exe 同目录是否生成了 `public\index.html` |
| 三项集成服务显示「离线 / 未配置」 | 只跑了 `START.bat`，没跑 `INSTALL.bat`；这是**预期行为** | 看 `START.bat` 窗口里的状态提示；要本机服务就双击 `INSTALL.bat`，已有服务则在 `.env` 填地址后完全重启 exe |
| 窗口里提示「本机原生服务：未安装」 | 从未执行过 `INSTALL.bat` 的 native 模式 | 单独复查：`windows\check-integrations.ps1`；装完会生成 `windows\runtime\services.json`，之后 `START.bat` 会自动拉起 |
| 提示端口 9000 被占用 | 已有一个实例在跑 | 用 `STOP.bat` 停掉旧实例，或改 `.env` 里的 `PORT` |
| 单 exe 提示「无法释放 bundle.cjs」 | exe 放在只读目录 | 移到可写目录（如 `D:\devplatform\`）再运行 |
| `INSTALL.bat` 仍在联网下载 / 提示下载超时 | 用的是轻量包或 `git clone` 安装，包内没有三个二进制 | 换全量包 `devplatform-windows.zip`；或把 `devplatform-services.zip` 放进 `windows\bootstrap\` 后重跑（§18.10.3） |
| 下载到的文件大小明显不对 | 代理返回了 504 页面 / 下载被截断 | 用 `SHA256SUMS.txt` 校验，换 `ghfast.top` 加速源或重新下载 |
| `sha256sum -c` 全部报 `FAILED open or read` | v0.3.1 及更早的清单是 CRLF，`\r` 被当成文件名的一部分 | `tr -d '\r' < SHA256SUMS.txt \| sha256sum -c -`，或改用 PowerShell `Get-FileHash` |

---

## 19. 扩展 / 数据库（通用清单标准）

功能开发常需要 MySQL、PostgreSQL、Redis 等中间件。平台为这类「项目开发资源」提供一套**通用扩展标准**，而不是每加一种数据库就改一遍前后端。

### 19.1 定位与取舍

| 对象 | 例子 | 管理方式 |
|---|---|---|
| 平台自身基础设施 | Gitea / OpenList / 在线 IDE | 固定三项，硬编码在 `core.js` / `docker-compose.yml` / Windows 安装器，**不并入扩展标准**（§18） |
| 项目开发资源 | MySQL / PgSQL / Redis / 自定义中间件 | 清单驱动，按「实例」管理，可多个、可卸载、连接串可注入项目 `.env` |

**为什么是「数据清单 + 内置适配器」，不是插件框架**：平台是 Node SEA 单文件 exe，`require` 只能加载构建快照内的模块（§17.9），动态加载用户放进来的 JS 跑不通。因此清单只含**数据**，命令一律来自平台内置模板，用户可覆盖的只有镜像 tag、端口、库名、凭据等参数，不能传 shell 字符串（与 `engine.js` 的 `PROFILES` 白名单思路一致）。

内置清单写在 `platform/src/catalog.js` 常量里，随 `bundle.cjs` 一起热更新；自定义清单放 `data/extensions/*.json`（不入库、不占 SEA assets），放进去后刷新页面即生效，无需重启或重新打包。新增一种服务**只需加一条清单**，前端表单、状态、连接串、日志全部自动具备。

### 19.2 manifest v1 字段

| 字段 | 含义 | 约束 |
|---|---|---|
| `id` / `label` / `kind` / `description` / `icon` | 标识与展示 | `id` 小写字母开头 2~32 位；`kind` ∈ database/cache/queue/storage/custom |
| `image` / `tags` / `defaultTag` | 官方镜像与可选版本 | tag 只允许 `[A-Za-z0-9._-]`；镜像前缀自动套用 `DOCKER_IMAGE_PREFIX` |
| `port` / `internalPort` / `volume` | 默认宿主机端口、容器内端口、数据目录 | 端口 1~65535；`volume` 必须是容器内绝对路径，映射为命名卷 `dp-ext-<name>-data` |
| `env` / `command` | 容器环境变量与启动命令 | 值只允许 `${HOST} ${PORT} ${INTERNAL_PORT} ${PASSWORD} ${USER} ${DB_NAME} ${TAG} ${IMAGE} ${NAME}` 九个白名单变量；`command` 是字符串数组，不经过 shell |
| `fields` / `defaults` | 安装表单字段与默认值 | 字段名大写下划线；`type` ∈ text/number/password；前端按声明动态渲染 |
| `envKey` / `connection` | 注入 `.env` 的键名与连接串模板 | `envKey` 大写；模板用同样的白名单变量，密码自动 URL 编码 |
| `health.cmd` | 容器内健康检查命令 | 固定字符串数组，用环境变量引用密码，不把凭据写进命令行 |

内置三份清单：

| id | 镜像 | 默认端口 | 注入键 | 健康检查 |
|---|---|---|---|---|
| `mysql` | `mysql:8.4 / 8.0 / 5.7` | 3306 | `DATABASE_URL` | `mysqladmin ping` |
| `pgsql` | `postgres:16 / 15 / 14` | 5432 | `DATABASE_URL` | `pg_isready` |
| `redis` | `redis:7.4 / 7.2 / 6.2` | 6379 | `REDIS_URL` | `redis-cli ping`（AOF + requirepass） |

### 19.3 两种运行形态与无 Docker 降级

| 形态 | 平台做什么 | 适用 |
|---|---|---|
| `docker` | 通过 Docker Engine API 创建带 `devplatform.ext=1` 标签的长期容器 + 命名卷，`restart: unless-stopped`，端口只绑 `DP_EXT_BIND_IP`（默认 `127.0.0.1`） | Linux / 有 Docker Desktop 的 Windows / 已挂载 docker.sock 的容器部署 |
| `external` | **只登记**地址、端口、账号与凭据，生成连接串；不安装、不连接、不改动外部服务 | 无 Docker 的 Windows native 模式、已有云数据库、内网已有中间件 |

`GET /extensions/catalog` 会探测 Docker 可达性（`/_ping`）：不可用时面板顶部明确显示原因与修复提示，`docker` 选项置灰，安装默认切到 `external`。**不会隐式下载或安装任何东西**。注意这与 §18 的「随包自带服务二进制」是两套机制：Gitea / OpenList 是单个 Windows exe，可以打进 zip；数据库镜像是 GB 级且依赖容器运行时，只能按需拉取或由运维预先 `docker load` 导入。

### 19.4 面板操作

左侧「扩展 / 数据库」页：选清单 → 选运行模式 → 填表单（密码留空自动生成 24 位随机串）→ 创建实例。安装前会检测端口占用；容器启动后等待端口就绪（最多 60 秒）再判定状态。

实例列表提供：复制连接串、注入工作区 `.env`（同名键覆盖、其它行保留）、检测健康、启动 / 停止 / 重启、查看容器日志、卸载。卸载**默认保留数据卷**，只有再次确认才删除；`external` 实例不能启停，删除只移除本地登记。总览页「集成服务」会把每个实例作为一条服务列出，沿用 online / partial / unconfigured / offline 四态。

### 19.5 凭据与安全边界

- 随机密码只写入 `state.json`（`core.save` 强制 600 权限）；列表与详情接口一律脱敏（`mysql://root:******@...`），明文连接串只能通过 `GET /extensions/instances/:id/connection` 单独取得（受 `ADMIN_TOKEN` 保护）。
- 端口默认只绑 `127.0.0.1`，不对公网暴露；容器带专属标签，平台只管理自己创建的容器，绝不触碰宿主机上其它容器。
- `health.cmd` 通过容器内环境变量引用密码，避免凭据出现在 `docker inspect`；Redis 的 `--requirepass` 是官方镜像的启动参数形式，会出现在 inspect 里，仅限本机 / 可信内网开发环境使用。
- 注入 `.env` 只能写工作区内的相对路径（`safeWorkspacePath` 防目录穿越），文件权限设为 600。

### 19.6 容器部署时的三个变量

平台本体跑在容器里时，容器内的 `127.0.0.1` **不是宿主机**，需要显式配置：

| 变量 | 默认 | 用途 |
|---|---|---|
| `DP_EXT_BIND_IP` | `127.0.0.1` | 扩展容器端口绑定的宿主机 IP；需要跨机访问时改 `0.0.0.0`（务必配合防火墙） |
| `DP_EXT_HOST` | `127.0.0.1` | 生成连接串与做 TCP 探测时使用的主机名；平台在容器内时填**宿主机 IP** |
| `DOCKER_HOST` | 空 | 显式指定 Docker 端点，如 `tcp://127.0.0.1:2375`；不填时依次用 `DOCKER_SOCKET`（默认 `/var/run/docker.sock`）或 Windows 命名管道 |

`docker-compose.yml` 里 `platform` 服务的 `docker.sock` 挂载默认注释，启用扩展的容器安装前需打开（挂载 docker.sock 等于把宿主机 root 权限交给平台容器，仅限可信内网）。镜像不可达时沿用已有的 `DOCKER_IMAGE_PREFIX` 加速器；内网离线可先 `docker load` 导入镜像，平台检测到本地已有镜像会跳过拉取。

### 19.7 自定义清单示例

把下面内容存为 `data/extensions/mongo.json`，刷新页面即可在「可安装的服务」里看到（解析失败的清单会显示在页面错误提示里，不影响其它清单）：

```json
{
  "id": "mongo", "label": "MongoDB", "kind": "database",
  "image": "mongo", "tags": ["7"], "defaultTag": "7",
  "port": 27017, "internalPort": 27017, "volume": "/data/db",
  "envKey": "MONGO_URL",
  "connection": "mongodb://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB_NAME}",
  "env": {}, "command": [], "health": {},
  "fields": [{ "key": "DB_NAME", "label": "库名", "type": "text", "default": "app" }],
  "defaults": { "USER": "root" }
}
```

校验规则：模板变量白名单、字段名 / 端口 / 镜像 tag 合法性、命令数组长度与单行限制；不接受任意脚本、不支持 `${}` 之外的表达式。自定义清单与内置清单同名时以内置为准。

### 19.8 API

| 端点 | 用途 |
|---|---|
| `GET /extensions/catalog` | 清单列表 + 表单字段 + Docker 探测结果 + 自定义清单目录与解析错误 |
| `GET/POST /extensions/instances` | 实例列表（脱敏）/ 创建实例 |
| `GET /extensions/instances/:id` | 单个实例（脱敏） |
| `POST /extensions/instances/:id/action` | `start` / `stop` / `restart`（仅 docker 实例） |
| `POST /extensions/instances/:id/health` | TCP + 容器内命令健康检查，并回写状态 |
| `POST /extensions/instances/:id/inject` | 把 `ENV_KEY=连接串` 写进工作区 `.env` |
| `GET /extensions/instances/:id/connection` | 明文连接串（`ADMIN_TOKEN` 保护） |
| `GET /extensions/instances/:id/logs?tail=200` | 容器日志 |
| `DELETE /extensions/instances/:id?purge=1` | 卸载；`purge=1` 才同时删除数据卷 |

### 19.9 当前能力边界

§19 是「标准版」的基线，**v0.3.0 起下面的能力已全部补齐**，见 §20–§24：

| 早期限制 | 现在的实现 | 章节 |
|---|---|---|
| 只能本机 Docker 安装 | 实例支持 `target: local / server:<id>`，SSH 远程下发 `docker run` | §20.2 / §23.2 |
| 无备份 / 恢复 | 内置 mysqldump / pg_dumpall / Redis RDB 模板，存档可下载 · 上传 · 恢复 · 删除 | §23.3 |
| 无版本升级 | 换 tag 前强制自动备份 → 保留命名卷重建 → 健康检查失败自动回滚 | §23.4 |
| 一个实例不能绑多仓库 | `repoIds[]`，注入 `.env` 可一次写多个工作区目录 | §23.5 |
| 无离线镜像导入 | Docker 管理·镜像支持 ≤100MB tar 直传与「服务器已有路径」导入 | §22.3 |
| 无多数据库 Web 工具 | 内置 DbGate 清单（GPL-3.0），连接随实例增删自动同步 | §24 |

仍然存在的边界：

- 外部连接（`external`）模式只做 TCP 可达性探测，**不会验证账号密码是否正确**，也不能备份 / 升级 / 启停。
- 容器日志与 SQL 查询在面板内展示，**未做成动态标签**；Docker 管理的 Compose 模板只保存文本，不在平台内执行。
- 卸载时默认保留命名卷，面板不再显示该卷；可用「Docker 管理 · 存储卷」查看，或 `docker volume ls`。
- 远程目标只支持**已登记在「服务器」页**的 Linux 机器（SSH 凭据复用 `state.json`），不支持临时填地址。

---

## 20. 编译环境与可降级的构建后端

### 20.1 结论：用 Docker 体系，不引入 microVM

microVM（Firecracker / Kata / gVisor）解决的是「隔离不可信代码 / 多租户强隔离」，而编译环境要的是「**可复现工具链 + 不污染宿主机**」，两者不是同一问题。容器已经够用，且有三个硬约束让 microVM 在本平台不成立：

| 约束 | 说明 |
|---|---|
| 平台要求 | Firecracker 依赖 Linux KVM，Windows 原生跑不了；Windows 上的 Docker Desktop 本身已跑在 Hyper-V / WSL2 虚拟机里，等于已有一层 VM 边界 |
| WSL2 定位 | 微软官方明确 WSL2 **不是安全沙箱**；Docker Sandboxes 之类 microVM 方案又要求先装 Docker Desktop，恰好不满足「无 Docker」前提 |
| 兼容性 | microVM 不兼容 OCI 镜像，会把 `engine.js` 里六套 `PROFILES` 白名单全部推翻，只换来开发编译并不需要的高隔离级别 |

因此 `BUILD_EXECUTOR` 从 `local | docker` 扩成 **可降级的四级后端**，让「Windows 无 Docker」由远程 Linux 服务器兜底——这与本轮的 SSH 远程安装、远程 Docker 管理共用同一条 `sshExec` / `sftpPut` 通道。

### 20.2 四级降级

| 后端 | 执行方式 | 适用 |
|---|---|---|
| `ssh`（优先） | 打包工作区 → SFTP 上传 → 目标机 `docker run` 编译 → 产物 tar 回传 → 清理远端临时目录 | **Windows 无 Docker 的主路径**；已有 Linux 构建机 |
| `docker` | 本机 Docker Engine API 起一次性构建容器（沿用 `PROFILES` 官方镜像） | Linux 服务器 / 装了 Docker Desktop 的 Windows |
| `wsl` | `wsl.exe -- bash -s`，把 Windows 路径转成 `/mnt/<盘符>/...` | Windows 有 WSL2 但没 Docker Desktop |
| `local` | 平台进程内 `bash -c` 直接跑工具链（无隔离，最后兜底） | 已有全套本机工具链 |

`BUILD_EXECUTOR=auto`（推荐）按 `ssh → docker → wsl → local` 依次探测，选第一个可用后端；`GET /api/builds/backends` 返回四项实时可用性与当前选择，构建页顶部显示实际后端。显式指定某后端而它不可用时**直接报错，不静默降级**，避免"以为在容器里编译、其实污染了宿主机"。

远程构建的日志由 `sshExec` 一次性返回（非实时流），这是它与本机后端唯一的体验差异；产物目录会被打回工作区，本地与远程结果一致。

### 20.3 相关配置

| 变量 | 默认 | 用途 |
|---|---|---|
| `BUILD_EXECUTOR` | `local` | `auto / ssh / docker / wsl / local`；`.env.example` 推荐 `auto` |
| `DP_BUILD_SERVER_ID` | 空 | 远程构建优先使用的服务器 id，留空取「服务器」页第一台 |
| `DP_WSL_DISTRO` | 空 | WSL 发行版名，留空用默认 |
| `DP_REMOTE_TMP_DIR` | `/tmp/devplatform` | 远程构建 / 备份 / 镜像导入的临时根目录 |
| `HOST_WORKSPACE_DIR` | — | 平台跑在容器里时，`/workspace` 对应的**宿主机真实路径**（§19.6） |

安全边界：远程构建只使用 `state.json` 里已登记的 SSH 凭据；远端脚本由平台按固定模板拼接，路径与 buildId 全部经 `shq` 转义；临时目录在 `finally` 中清理；`docker run --rm` 不留存容器。

---

## 21. 外部 Git 源（GitHub / 自建 Gitea / GitLab）

### 21.1 定位

平台自带 Gitea 只是**其中一个源**，不是唯一入口。`gitSources.js` 提供统一适配器：内置源恒为 `builtin-gitea`（地址与 Token 来自 `.env`），外部源登记在 `state.gitSources`，两者归一成同一种仓库结构，前端只认一套字段。

| 类型 | API 基址 | 认证头 |
|---|---|---|
| `github` | `baseUrl`（默认 `https://api.github.com`） | `Authorization: Bearer <token>` |
| `gitea` / `generic` | `<baseUrl>/api/v1` | `Authorization: token <token>` |
| `gitlab` | `<baseUrl>/api/v4` | `PRIVATE-TOKEN: <token>` |
| 账号密码 / PAT（任意类型，v0.3.2） | 同上 | `Authorization: Basic base64(用户名:密码)` |

登记表单的「认证方式」可在 **Token** 与 **账号 + 密码 / PAT** 之间切换：自建 Gitea / GitLab 可直接填账号密码，GitHub 已停用密码登录，请在密码栏填 PAT、用户名栏填 GitHub 账号。切换方式时会清掉另一种凭据，避免明文长期留在 `state.json`；列表接口对 Token 与密码都做脱敏，脱敏值原样提交时后端沿用真实值。「克隆到工作区」页还可选择**本次直填**账号密码或 Token，凭据只进本次 `git clone` 进程参数，不保存、不落盘。

「Git 源」页可登记 / 测试连通 / 查看该源仓库列表 / 删除；「仓库列表」页自动聚合**所有源**的仓库（单源失败只记入 `errors`，不影响其它源），每个仓库都能一键填入克隆表单或直接开在线 IDE。创建仓库时可选择目标 Git 源，不再只能建到平台自带 Gitea。v0.3.2 起「新建仓库 / 克隆到工作区 / 仓库列表 / Git 源」是四个独立标签页，见 §29。

### 21.2 凭据不落盘

这是外部源最要紧的一点：Token 只写 `state.json`（`core.save` 强制 600 权限），列表 / 详情接口一律脱敏成 `ghp****876`。克隆时用 `git -c http.extraHeader=<Authorization: Basic ...>` **临时**注入凭据：

- 参数只在本次 `git clone` 进程里出现，**不写进 `.git/config` 的 remote URL**，也不落到工作区任何文件；
- 附加 `-c http.extraHeaderRedact=true`，并对 stderr 做 `scrub()`，避免失败日志泄漏 Token 或 Base64 串；
- `GIT_TERMINAL_PROMPT=0`，凭据失效时直接失败而不是卡在交互式输入；
- SSH 形式（`git@` / `ssh://`）不做任何处理，走本机 SSH 密钥。

### 21.3 API

| 端点 | 用途 |
|---|---|
| `GET/POST /git-sources`、`PUT/DELETE /git-sources/:id` | 登记 / 更新 / 删除（内置源不可删，由 `.env` 配置） |
| `POST /git-sources/:id/test` | 列一次仓库验证连通性与 Token |
| `GET /git-sources/:id/repos` / `/branches?repo=owner/name` | 单源仓库 / 分支列表 |
| `GET/POST /repos` | 聚合所有源的仓库 / 在指定 `sourceId` 创建仓库 |
| `POST /repos/clone` | 带临时凭据克隆到工作区（可选 `sourceId` / `name` / `branch` / `proxy` / `repoId`，以及本次直填的 `username` / `password` / `token`） |

### 21.4 克隆凭据的四种方式

| 方式 | 说明 |
|---|---|
| 使用已登记 Git 源的凭据 | 从 `sourceId` 取 Token 或账号密码，最常用 |
| 本次填写账号密码 | 只在本次 `git clone` 生效，适合临时借用他人凭据 |
| 本次填写 Token | 同上，适合一次性 PAT |
| 不带凭据 | 公开仓库，或 `git@` / `ssh://` 走本机 SSH 密钥 |

四种方式都叠加分层代理解析（本次指定 > 单个仓库 > Git Host 规则 > Git 分组 > 全局），失败日志对密码、Token 与 Base64 串统一脱敏。

---

## 22. Docker 管理（宝塔式面板）

### 22.1 六个分区与宝塔对照

| 宝塔模块 | 平台对应 |
|---|---|
| 应用商店 / 一键部署 | 就是 §19 的 manifest v1 清单（纯数据，且能自动注入连接串） |
| 镜像：拉取 / 导入 / 导出 / 删除 | Docker 管理·镜像 |
| 容器：启停 / 日志 / 终端 / 详情 / 资源 / 批量 | Docker 管理·容器（只读诊断命令走白名单 `exec`） |
| Compose 模板 | 编排模板：只保存文本，**不在平台内执行**，避免把面板变成任意编排入口 |
| 网络 / 存储卷 | 同名分区，支持创建与删除 |
| 设置 / 日志 | 端点 · 版本 · 安全策略 + **操作审计** |

顶部「目标」下拉可切换 `本机 Docker` 或 `server:<id>`——远程目标复用 `remoteDocker.js` 下发 `docker ps / images / volume ls / network ls`，与远程安装、远程构建一条通道。

v0.3.2 起六个分区**各自是独立标签页**（总览 / 设置、容器、镜像 / 仓库、存储卷、网络、容器编排），每页顶部有子导航条可一键跳转，不再把所有表单堆在一页。容器列表新增名称 / 镜像 / 状态筛选与运行数统计，操作按钮分成「电源操作 / 查看诊断」两行，表格设最小宽度并横向滚动，修掉多按钮挤压导致的显示异常。总览页补了容器 / 镜像 / 卷 / 网络四张统计卡与端点设置、安全策略说明。

### 22.2 只读 + 二次确认

带 `devplatform.ext=1` 标签（或 `dp-ext-` / `dp-build-` 前缀）的是平台自建容器，可直接管理。**其余宿主机容器默认只读**：

- 查看状态 / 日志 / 详情 / 资源**无需确认**；
- 启停 / 重启 / 删除必须带 `confirm=true`，服务端 `assertWritable` 二次校验，前端弹两道确认并明确写出"可能是生产服务"；
- 删除镜像 / 卷 / 网络**一律**要求确认（不论归属）；
- 每次写操作写入 `state.dockerAudit`（保留最近 100 条），「设置 / 审计」页可见时间、动作、目标、对象、是否确认。

这一策略与宝塔"所有容器都可删"不同，是为了避免多人共用一个面板时误伤宿主机上的其它服务。

### 22.3 离线镜像导入

| 方式 | 上限 | 用法 |
|---|---|---|
| 直传 tar | ≤100 MB（`mini.js` raw body 上限） | 镜像页选 `.tar` / `.tar.gz`，POST `/docker/images/load` |
| **服务器已有路径** | 无上传限制 | 把 `docker save` 的 tar 放到目标机，填绝对路径；本机路径只允许 `data/images/` 下的文件名（防目录穿越） |

数据库镜像往往 GB 级，**推荐第二种**：内网机器先 `docker load -i /data/images/mysql.tar`，或在安装表单填路径让平台导入；平台检测到本地已有镜像会跳过拉取。导出镜像为 tar 下载，远程目标则提示在服务器上自行执行 `docker save`。

镜像标识常含 `/`（私有仓库），因此删除与导出提供 `/docker/images/remove`、`/docker/images/export?ref=...` 两个 query 形式端点，避免被路由分段拆开。

### 22.4 API 速查

`GET /docker/overview?target=`、`GET /docker/audit`、容器 `POST /docker/containers/:id/action`、`DELETE /docker/containers/:id`、`GET .../logs|inspect|stats`、`POST .../exec`；镜像 `POST /docker/images/pull|load|load-path|remove`、`GET /docker/images/export`；卷 `POST/DELETE /docker/volumes...`；网络 `POST/DELETE /docker/networks...`；模板 `GET/POST/DELETE /docker/templates...`。所有写操作都可带 `target` 与 `confirm`。

---

## 23. 统一运行时：远程安装 · 备份 · 升级 · 绑定仓库

### 23.1 一层运行时，四个模块共用

`extRuntime.js` 按实例的 `target` 分派，避免每个功能各写一套远程逻辑：

| target | 安装 | 健康检查 | 日志 / 启停 | 备份 / 恢复 |
|---|---|---|---|---|
| `local` | Docker Engine API 创建长期容器 + 命名卷 | TCP + 容器内 `exec` | Engine API | `exec` + `getArchive` / `putArchive` |
| `server:<id>` | SSH 下发 `docker run --env-file`（凭据走远端 600 权限文件，不进命令行） | TCP 探测宿主机 IP | `sshExec` 下发 docker CLI | `docker exec` stdout 重定向 → SFTP 拉回 / 灌入 |
| `external` | 不安装，只登记地址与凭据 | TCP 可达性 | 不可启停 | 不支持 |

远程安装与本机的差异：容器端口绑定在**服务器 IP** 上，连接串的 `host` 也自动取该服务器地址；`targetLabel` 会在实例列表标出是哪台机器。

### 23.2 备份 / 恢复

命令只来自 `backup.js` 的内置白名单模板（清单里只能写枚举 id，**不允许写 shell**），凭据通过容器内环境变量引用，不拼进命令行：

| 清单 | 备份 | 恢复 |
|---|---|---|
| MySQL | `mysqldump --all-databases --single-transaction --routines --triggers` | `mysql` 灌入 |
| PostgreSQL | `pg_dumpall` | `psql -d postgres` |
| Redis | `redis-cli SAVE` + 读 `dump.rdb` | 覆盖 RDB、清 AOF 后重启容器 |

本机路径：`exec` 生成容器内文件 → `getArchive` 取 tar → 解出**原始 dump 字节**存档；恢复反向操作。远端路径：`docker exec` stdout 重定向 → SFTP 拉回；恢复 `docker exec -i < file`。两条路径存档格式一致，便于下载、查看与人工修复。存档落在 `data/backups/`，恢复必须 `confirm=true` 且类型匹配，平台前端再叠两道确认。

### 23.3 版本升级与自动回滚

`POST /extensions/instances/:id/upgrade { tag }` 的顺序是：**升级前强制自动备份 → 只删容器（命名卷保留）→ 用新 tag 重建 → 端口健康检查 → 失败则回滚旧 tag 并恢复备份**。只有清单 `tags` 里列出的版本可选，同版本或 `external` 实例直接拒绝。成功后同步刷新 DbGate 连接，返回的 `backupId` 可在备份列表里找到那份"升级前自动"存档。

### 23.4 多实例绑定仓库

实例新增 `repoIds[]`。「注入 .env」时若绑定了仓库，可一次写入这些仓库目录下的 `.env`（同名键覆盖、其它行保留、文件 600），适合一个数据库给多个项目共用；未绑定时仍写工作区根目录。仓库候选来自 §21 的**多源聚合列表**，所以外部 GitHub / 自建 Gitea 的仓库同样可绑定。

### 23.5 新增端点

`PUT/GET /extensions/instances/:id/repos`、`POST .../backup`、`POST .../upgrade`、`GET/POST/DELETE /extensions/backups...`、`GET/POST /extensions/dbgate...`；`GET /builds/backends` 返回构建后端可用性。

---

## 24. DbGate：一套工具管多种数据库

### 24.1 选型

| 候选 | 许可 | 覆盖 | 连接可预置 | 判断 |
|---|---|---|---|---|
| **DbGate**（采用） | GPL-3.0 社区版免费 | MySQL / MariaDB / PgSQL / SQLServer / Oracle / SQLite / **MongoDB / Redis** / ClickHouse | **环境变量直接注入** | 推荐 |
| CloudBeaver | Apache 2.0 | JDBC 关系型很全，Redis / MongoDB 在商业版 | 需 GraphQL 或手工配置 | 备选 |
| Bytebase | MIT | 25 种引擎 | 偏变更审核 / 审计治理，生产还需外部 PgSQL | 不合定位 |
| phpMyAdmin | 开源 | 仅 MySQL | — | 已排除 |

决定性理由不是"支持得全"，而是**能被平台自动配置**：DbGate 官方镜像支持用 `CONNECTIONS` 加 `LABEL_x / ENGINE_x / SERVER_x / USER_x / PASSWORD_x / PORT_x / DATABASE_x` 预置连接。

### 24.2 自动联动

`dbgateSync.js` 把平台内所有非 dbgate 实例翻译成这组变量；`extRuntime.install` 检测到清单的 `dynamicEnv: 'dbgate-connections'` 时追加进容器 `Env`。实例创建 / 删除 / 升级后 `syncDbGate()` 会**保留命名卷重建 DbGate 容器**（Docker 不允许改运行中容器的 Env），Web 登录信息与查询历史不丢。用户点开就看到全部数据库，不用手工录一遍连接。

DbGate 本身作为一条内置清单（`kind: tool`）加入 manifest v1，因此安装表单、状态、日志、升级、卸载全部自动具备；Web 登录用清单里的 `LOGIN=admin` + 自动生成的 `PASSWORD`（可在实例详情取明文）。扩展页「打开管理界面」按钮与实例列表里的同名按钮直达 `http://<host>:<port>/`。

**无 Docker 的 Windows native 模式**：DbGate 可降级为 `external` 登记（指向机器上已装的 DbGate 桌面版 / 服务），仍可一键复制连接串；不会隐式下载任何东西。

### 24.3 许可说明

DbGate 社区版按 GPL-3.0 分发，平台只提供官方镜像清单与连接预置，不修改、不内嵌其代码；发行包里不包含该镜像（GB 级且依赖容器运行时），首次安装按 §19.3 的镜像分发机制拉取或离线导入。上游许可与来源记录在 `windows/bin/services-manifest.json` 的同类清单里，数据库镜像由运维按自身合规要求引入。

---

## 25. v0.3.0 新增文件与验证

| 文件 | 职责 |
|---|---|
| `src/gitSources.js` | 外部 Git 源适配器、多源聚合、临时凭据克隆 |
| `src/remoteDocker.js` | SSH 下发 docker CLI（安装 / 镜像 / 备份 / 容器管理共用） |
| `src/buildBackends.js` | 四级构建后端探测与执行 |
| `src/dockerPanel.js` | 宝塔式 Docker 管理六分区 + 只读策略 + 审计 |
| `src/backup.js` | 逻辑备份 / 恢复、零依赖 tar 读写 |
| `src/extLifecycle.js` | 版本升级回滚、DbGate 同步、仓库绑定 |
| `src/dbgateSync.js` | DbGate 连接环境变量生成 |

前端新增「Git 源」「Docker 管理」两个模块页（共 11 个可标签化模块），扩展页增加备份存档、绑定仓库、打开管理界面、升级等卡片；`public/index.html` 资源版本升至 `?v=20261110b`。

验证方式：`npm run check`（19 个后端模块）、`scripts/check-frontend.js`（静态一致性 + DOM stub 跑 boot）、`scripts/verify.js`；隔离实例冒烟覆盖外部 Git 源登记 / 脱敏 / 连通 / 分支 / 多源聚合 / **真实 git clone**、外部实例绑定仓库与多目录注入、模板 CRUD、路径穿越与缺参校验；Docker Engine API 模拟覆盖容器二次确认与审计、镜像拉取 / 裸 tar 导入 / 含斜杠 ref 导出与删除、卷与网络 CRUD、`mysqldump` 备份 → 下载 → 恢复、tag 升级（升级前自动备份）、DbGate 安装与连接同步、`purge=1` 卸载。完整 SEA 构建验证新增模块打进单文件 exe 后还原运行实例的 `dist`。

---

## 26. OpenList 管理集成（存储 / 文件）

「存储 / 文件」页不再只是只读的目录列表：平台把 OpenList（兼容 AList V3 API）的**连接配置、挂载存储、驱动清单、站点设置与全部文件操作**接成原生 API，同时保留「打开 / 内嵌 OpenList 后台」入口处理更复杂的高级设置。

> **v0.3.2 起支持多连接**：可同时登记本机与任意外部 OpenList，逐条切换当前连接；文件浏览、挂载存储、驱动清单始终作用于当前连接。相关区块也已拆成四个独立标签页，详见 §29。

### 26.1 页面能力

| 区块 | 能力 |
|---|---|
| 连接状态 | 在线 / 离线、版本、站点名、挂载数、配置来源（面板 / .env）、生效代理、WebDAV 地址；一键打开或内嵌 `/@manage` 后台 |
| 连接设置 | 服务地址、管理员账号、API Token、管理员密码；可一键「恢复 .env 配置」。凭据只写 `data/state.json`（600），列表一律脱敏 |
| 文件浏览 | 面包屑导航、多选全选、进入目录、下载、直链（自动拼 `sign`）、重命名、移动、复制、批量删除、新建目录、多文件上传 |
| 挂载存储 | 列出 / 新增 / 编辑 / 启停 / 删除 / 重载全部挂载；`addition` 用 JSON 填写，点驱动清单可自动带出配置模板 |
| 驱动清单 | `/api/admin/driver/list` 与 `/api/admin/driver/info`，展示可用驱动并回填模板 |
| WebDAV | 复制 `http://<host>:5244/dav/`，可直接挂到本机或 rclone |

> 存储增删、驱动清单、站点设置需要**管理员权限的 Token**。用只读 Token 或密码登录换取到的令牌权限不足时，对应卡片会显示真实错误而不是空数据。

### 26.2 后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / PUT | `/api/openlist/connection` | 读取 / 保存连接信息 |
| POST | `/api/openlist/connection/reset` | 恢复 `.env` 配置 |
| GET | `/api/openlist/status` `/api/openlist/settings` | 在线状态与站点设置（敏感项白名单过滤） |
| GET / POST / PUT / DELETE | `/api/openlist/storages[/:id]` | 挂载存储 CRUD；`/:id/toggle` 启停；`/reload` 重载 |
| GET | `/api/openlist/drivers` `/api/openlist/drivers/info?driver=` | 驱动清单与配置模板 |
| GET | `/api/openlist/files?path=` | 列目录（归一化 `isDir / size / modified / parent`） |
| POST | `/api/openlist/files/{mkdir,rename,remove,move,copy}` | 文件全操作 |
| GET | `/api/openlist/files/link?path=` `/api/openlist/files/download?path=` | 直链与**后端代理下载**（浏览器不必直连 OpenList / 对象存储，不暴露 Token） |
| PUT | `/api/openlist/files/upload?path=&name=` | 二进制上传（raw body，上限 100 MB） |

旧的 `/api/storage` `/api/storage/mkdir` `/api/storage/remove` `/api/storage/upload` `/api/storage/mounts` **继续保留**，供已有脚本兼容；前端已切到新接口。

路径安全：所有路径必须以 `/` 开头、拒绝 `..` / 空字节 / 换行；名称拒绝 `/`、`\`、`.`、`..`。下载有 100 MB 上限，避免把平台内存打爆。

---

## 27. 分层代理配置

新增「代理配置」模块页（第 12 个可标签化模块）。**命中即停止**的优先级链：

| 作用域 | 优先级（高 → 低） |
|---|---|
| Git 仓库 | 单个仓库代理 → Git Host 匹配规则 → Git 分组代理 → 全局代理 |
| Docker / 容器 | 单个容器代理 → Docker 代理 → 全局代理 |
| 服务器 / SSH | 单个服务器代理 → 服务器代理 → 全局代理 |
| AI 服务 | 单个 AI 服务代理 → AI 服务代理 → 全局代理 |

Git 作用域额外支持 Host 规则（`github.com`、`*.gitea.internal`、完整 URL 或仓库 id，支持 `*` 通配），按匹配精确度与规则长度排序。**克隆表单里的「本次克隆代理」**位于所有层级之上，优先级最高，仅对这一次请求生效。

「Git 仓库 / Docker 管理 / 服务器 / AI 服务配置」四处的列表都新增了「代理」按钮，点击直接跳到代理页并预填该对象标识，不用手工复制 id。

### 27.1 取值语义

| 值 | 含义 |
|---|---|
| 留空 | 继承下一级 |
| `http://` `https://` | HTTP 转发（undici ProxyAgent）；账号密码只存 `state.json`，界面显示 `******` |
| `socks5://` `socks4://` | 用于 SSH 隧道与本地 CLI 环境变量；HTTP 请求不支持，会给出明确报错 |
| `direct` | 明确直连：终止链，并把 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY` 显式清空，避免子进程继承平台环境 |

`NO_PROXY` 支持精确域名、`.后缀`、`*` 与 IPv4 CIDR，默认已含 `localhost / 127.0.0.1 / ::1 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16`。

### 27.2 各链路的实际落地方式

| 链路 | 生效方式 |
|---|---|
| Git API / Gitea | 每次 `httpJSON` 传入该作用域解析出的代理；内置 Gitea 也按 host 走同一条链 |
| `git clone` | `-c http.proxy=... -c https.proxy=...` + 子进程环境变量；SSH 地址在非 Windows 下用 `core.sshCommand` 挂 `nc -X connect` |
| Docker Engine | `DOCKER_HOST=tcp://...` 时通过 CONNECT 隧道转发；平台创建的容器把代理注入 `Env`（远程安装走 600 权限 `--env-file`） |
| 构建 / 编译 | `npm / go / pip / cargo` 等构建子进程注入代理环境变量 |
| SSH / SFTP / Web 终端 | `sshConnect()` 用 HTTP CONNECT 或 SOCKS5 握手生成裸 socket，传给 ssh2 的 `sock` 选项 |
| AI API | `aiChat()` 按 AI 作用域链设置 undici dispatcher |
| 本地 AI CLI | 注入 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY`；WSL 下在 bash 里 `export` 或 `unset` |
| OpenList / 内置服务 | 不属于四个作用域，统一走全局代理 + `NO_PROXY` |

### 27.3 接口与自检

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/proxy` | 全量配置（脱敏）、优先级说明、能力探测 |
| PUT | `/api/proxy/global` `/api/proxy/groups/:scope` | 全局 / 分组设置 |
| GET / POST / PUT / DELETE | `/api/proxy/rules[/:id]` | Git Host 规则 CRUD |
| GET | `/api/proxy/entities` | 四类对象的下拉候选（仓库 / 容器 / 服务器 / AI 服务，网络探测失败自动降级） |
| PUT / DELETE | `/api/proxy/overrides/:scope[/:id]` | 单项覆盖；id 含 `/` 时用 `?id=` 传 |
| POST | `/api/proxy/resolve` | 解析预览：返回每一层的命中情况与最终代理 |
| POST | `/api/proxy/test` | 连通性测试（可测全局 / 分组 / 单项 / 手动指定） |

`DP_PROXY_GLOBAL / DP_PROXY_GIT / DP_PROXY_DOCKER / DP_PROXY_SERVER / DP_PROXY_AI / DP_PROXY_NO / DP_PROXY_GIT_RULES / DP_PROXY_ENABLED` 是**首次启动默认值**，见 `.env.example`；界面保存后以 `state.json` 为准。`DP_PROXY_GIT_RULES` 格式为 `分号分隔的 pattern=proxy`，例如 `github.com=http://127.0.0.1:7890;gitlab.internal=direct`。

安全边界：代理 URL 中的凭据不会出现在任何 API 响应、日志或前端表单回显里；表单把脱敏值原样提交时后端会沿用已保存的真实地址，不会把 `******` 写回配置。

---

## 28. v0.3.1 新增文件与验证

| 文件 | 职责 |
|---|---|
| `src/proxy.js` | 分层代理配置、四级解析、脱敏、NO_PROXY、HTTP CONNECT / SOCKS5 隧道、连通性测试 |
| `src/openlist.js` | OpenList 连接 / 挂载存储 / 驱动 / 设置 / 文件全操作客户端 |
| `scripts/smoke-proxy-openlist.js` | 本地假 OpenList + 假 HTTP 代理的端到端冒烟（不依赖外网 / Docker） |

改动：`src/core.js`（state 新增 `proxy / openlist`）、`src/integrations.js`（统一代理注入、SSH 隧道、OpenList 通用 API）、`src/gitSources.js`（clone 代理）、`src/dockerApi.js` / `src/extRuntime.js` / `src/engine.js` / `src/buildBackends.js`（容器与构建代理）、`src/remoteOps.js`（sshConnect）、`src/extensions.js` / `src/server.js`（实例代理 + 40 余条新路由）、前端三件套（第 12 个模块页 + 重构存储页）、`docker-compose.yml` / `.env.example` / 单文件 `.env` 模板。

验证：`npm run check`（21 个后端模块）、`scripts/check-frontend.js`（12 个模块页 + DOM stub 跑 boot）、`scripts/smoke-proxy-openlist.js`（**45 项全通过**：四组优先级链、direct / 通配 / NO_PROXY / 脱敏 / 回显保护、HTTP CONNECT 与 SOCKS5 隧道转发真实请求、`tunnelAgent` 转发 Docker Engine TCP、代理连通性、git clone 注入、OpenList 连接 / 状态 / 设置白名单 / 挂载 CRUD / 驱动模板 / 文件全操作 / 直链 / 下载 / 上传 / 非法参数拦截 / 旧接口回归）、完整 SEA 构建（release.json = 0.3.1，bundle 含新模块）。

前端资源版本升至 `?v=20261110c`；已发布包升级到 v0.3.1 后前端会自动刷新（静态资源 `cache-control: no-cache`）。

---

## 29. v0.3.2：页面拆分 · 凭据增强 · 多 OpenList 连接

### 29.1 从「一页塞全部」到 25 个独立标签页

侧边栏保持 12 个主模块，把原本挤在一页的表单与列表拆成独立 `.page`，每页顶部有 `subnav` 子导航条，点按钮即打开对应标签（表单内容、终端会话不会互相干扰）。`VIEW_META` / `MODULE_ICONS` / `loaders` / `NAV_GROUP` 同步注册，侧边栏主项仍保持高亮。

| 模块 | 拆分后的独立页 |
|---|---|
| Git 仓库 | 仓库列表 · 新建仓库 · 克隆到工作区 · 外部 Git 源 |
| 存储 / 文件 | 文件浏览 · 连接管理 · 挂载存储 · WebDAV / 驱动 |
| 构建 · 部署 | 构建记录 / 日志 · 启动构建 · 部署记录 |
| 服务器 | 服务器列表 · 添加服务器 |
| Docker 管理 | 总览 / 设置 · 容器 · 镜像 / 仓库 · 存储卷 · 网络 · 容器编排 |

关键实现策略：**所有既有 DOM id 保持不变，只把卡片移到新的 section**，因此事件绑定、自检脚本与旧接口全部沿用，回归风险最低。跨页跳转（如仓库列表点「克隆」）改为 `switchView('repo-clone')` 并自动预填表单。

### 29.2 单项代理配置补齐说明

「代理配置 → 单项代理覆盖」原本只有一个裸文本框，现在补上完整的填写指引：作用域 / 对象 / 代理地址三步、可填的协议与示例（`http://user:pass@host:port`、`socks5://`、`direct`）、留空 = 删除覆盖、四条优先级链、NO_PROXY 与凭据脱敏说明。分组代理、Git Host 规则、服务器表单、AI 表单、克隆表单的代理输入框也各自加了语义提示。

### 29.3 外部 Git 源与克隆支持账号密码

`gitSources.js` 新增 `authType: token | password`；账号密码方式统一走 HTTP Basic（GitHub 请在密码栏填 PAT）。凭据写入 `state.json`（600），列表输出 `hasCreds / authType / tokenMasked / passwordMasked`，脱敏值回显时后端沿用真实值，切换认证方式会清掉另一种明文凭据。

克隆表单新增「凭据方式」：使用已登记源凭据 / 本次填写账号密码 / 本次填写 Token / 不带凭据。本次直填的凭据只进 `git clone` 进程参数，**不写 state.json、不进 .git/config**；`scrub()` 现在对密码、Token 与 Base64 串统一脱敏。

### 29.4 多个 OpenList 连接

`state.openlistConnections` 保存连接数组，`openlistActiveId` 指向当前生效项。切换时 `applyConfig()` 把该连接的 url / user / token / password 写回运行时 `config` 并清掉 `openlistApi` 的 token 缓存，因此所有既有文件 / 挂载 / 驱动接口无需改动。旧版 `state.openlist` 单连接会在首次启动时自动迁移成一条「面板配置连接」。

| 端点 | 用途 |
|---|---|
| `GET /openlist/connections` | 连接清单 + 当前 activeId（凭据脱敏） |
| `POST /openlist/connections` | 新增连接并自动设为当前 |
| `PUT/DELETE /openlist/connections/:id` | 编辑 / 删除（至少保留一条） |
| `POST /openlist/connections/:id/activate` | 切换当前连接 |

旧的 `/openlist/connection` 三件套保持兼容。外部服务请填平台（或平台所在容器）能访问到的 `http(s)://` 地址；容器内的 `localhost` 指向平台自身而非外部服务。管理接口（挂载 / 驱动 / 设置）必须有管理员权限的 Token，凭据失效时状态页会明确显示 `[管理权限不可用]` 而不是伪装成空列表。

### 29.5 Docker 列表与子页重构

容器列表加名称 / 镜像 / 状态筛选、运行数统计与统计卡；操作按钮分成「电源操作」「查看诊断」两行，表格设最小宽度 + 横向滚动，修掉按钮挤压造成的显示异常；`renderDocker*` 全部补了字段缺失的防御（空 id / 空 tags 不再抛异常）。六个分区各自有独立页、说明文字与表单提示，总览页补端点设置、安全策略与操作审计。`[data-dk-op]` 事件委托改为文档级，保证拆页后所有按钮仍可用。

> 本次开发时 `10.0.0.246:8008` 宝塔面板所有路径均返回 nginx 404（安全入口可能已变更），因此按宝塔 Docker 模块的既有信息架构（设置 / 镜像仓库 / 容器 / 存储卷 / 网络 / 编排）组织，未做界面像素级仿制。

### 29.6 改动文件与验证

| 文件 | 职责 |
|---|---|
| `platform/src/gitSources.js` | 账号密码认证、Basic 头、克隆临时凭据、脱敏 |
| `platform/src/openlist.js` | 多连接 CRUD / 切换 / 迁移 / 脱敏 |
| `platform/src/core.js` | `defaultState` 新增 `openlistConnections` / `openlistActiveId` |
| `platform/src/server.js` | 新增 5 条多连接路由 |
| `platform/public/index.html` / `app.js` / `style.css` | 25 个独立页、子导航、多连接 UI、Docker 重构、代理说明 |
| `scripts/check-frontend.js` / `scripts/smoke-proxy-openlist.js` | 页面数与新接口断言、端到端覆盖 |

验证：`npm run check`（21 个后端模块）、`scripts/check-frontend.js`（**30 项全通过**，25 个页面 + DOM stub boot）、`scripts/smoke-proxy-openlist.js`（**59 项全通过**，含账号密码登记 / 脱敏 / 切换清理、三种克隆凭据头、多连接增改切删与最后一条保护、原有 45 项代理 / OpenList 回归）。前端资源版本升至 `?v=20261110d`，`package.json` / `package-lock.json` 升到 `0.3.2`。

## 30. v0.3.3：Git 运行时自愈（修复 `spawn git ENOENT`）

### 30.1 现象与根因

在「Git 仓库 → 克隆到工作区」点击克隆，返回：

```json
{"ok":false,"error":"spawn git ENOENT"}
```

根因不在 Git 源、凭据或代理，而是**运行平台代码的进程里根本没有 `git` 可执行文件**。旧实现直接 `spawn('git', args, { shell: false })`，完全依赖 PATH。典型触发场景：

| 场景 | 说明 |
|---|---|
| `remote.js` 部署到无宿主 Node 的机器 | 复用 `node:20-alpine` 镜像，Alpine 基础镜像不含 git；宿主机虽有 `/usr/bin/git`，但容器看不到 |
| Windows 单文件 exe | 机器没装 Git for Windows，或 `git.exe` 不在启动进程的 PATH（系统服务 / 计划任务常见） |
| 精简镜像 | `node:*-slim`、`*-alpine` 一律不带 git；只有 `node:*-bookworm` 等完整镜像自带 |

本次在 `10.0.0.246` 实测确认：平台容器 `node:20-alpine` 内 `command -v git` 为 `GIT_MISSING`，宿主机 `/usr/bin/git` 正常。

### 30.2 三层修复

**① 统一探测（`platform/src/gitRuntime.js`）**：按「控制台配置 → `GIT_BIN` → PATH → 平台常见安装路径」解析可执行文件，用绝对路径 spawn；Windows 覆盖 Git for Windows / Scoop / Chocolatey / 便携版，Linux 覆盖 `/usr/bin/git`、`/usr/local/bin/git`、Homebrew 等。所有 ENOENT 被转成带 5 条修复指引的中文错误，不再抛出原始 `spawn git ENOENT`。每次克隆重新探测，装完 git 或改完配置无需重启。

**② 自动降级（SSH 宿主机通道）**：当前环境没有 Git 时，`cloneRepo()` 不再直接失败，而是借已登记的 SSH 服务器在宿主机执行同一条 `git clone`。工作区是 bind mount，宿主机写入后容器内立即可见，结果仍是完整 `.git` 仓库。启用条件：已登记 SSH 服务器 + 能确定宿主机工作区路径（`HOST_WORKSPACE_DIR`，或由服务器 `deployDir + /workspace` 推导）；不满足时给出明确原因，避免把仓库克隆到无关机器上造成「看似成功实则不可见」。凭据仍走临时 `http.extraHeader`（不写 `.git/config`），远程输出经同一套 `scrub()` 脱敏；代理通过环境变量前缀一并传递。

**③ 部署侧（`scripts/remote.js`）**：`pickNodeImage()` 不再用 `^node:` 匹配（会漏掉 `docker.m.daocloud.io/library/node:22-bookworm` 这类带仓库前缀的镜像），改为**先验证镜像里的 Node 能真正启动，再在其中优先选自带 Git 的镜像**。这一步很关键：本次在 `10.0.0.246`（老内核 Debian 9）上发现 `node:22-bookworm` 虽自带 git 2.39.5，但 Node 会 `uv_thread_create` 断言崩溃（exit 139），只看 git 会选出一个跑不了平台的镜像。若所有可运行镜像都不含 Git，默认**不联网安装**（该机 apk 源不可达，硬等会让部署挂死），直接交给第 ② 层 SSH 兜底；确需容器内直接执行 Git 时可设 `DP_INSTALL_GIT=1`，脚本会 `apk add` / `apt-get install` 后 `docker commit` 固化成 `devplatform-runtime:git` 并在后续部署复用。启动后新增「校验平台容器内的 Git」步骤，直接给出结论。

**④ 顺带修复凭据落盘（重要）**：远端实测时发现，`git clone -c http.extraHeader=...` 会把配置**持久化到新仓库的 `.git/config`**（里面是真实 Token 的 Basic base64），与原先「不写 .git/config」的设计相悖。已把所有 `-c` 选项移到 `clone` 子命令之前，改为 `git -c http.extraHeader=... clone ...`，只对本次进程生效。修复后重新克隆验证，`.git/config` 只剩 `[core] / [remote "origin"] / [branch "main"]`，无任何凭据；两个冒烟脚本都加了参数顺序断言防回归。

> `docker-compose --profile full` 路径不受影响：`platform/Dockerfile` 本来就在 `apt-get install` 里装了 git / openssh-client。

### 30.3 控制台可见性

「克隆到工作区」页顶部新增 **Git 运行时** 卡片，在点击克隆之前就显示：

- 绿色 `Git x.y.z` + 执行通道「本机 / 当前容器」；
- 黄色「本机无 Git · SSH 宿主机兜底」+ 借用的服务器与宿主机工作区路径；
- 红色「Git 不可用」+ 逐条修复指引（含安装命令、路径填写位置、重新部署命令）。

可直接填写 Git 可执行文件绝对路径、开关 SSH 兜底、重新检测，配置写入 `state.json` 且立即生效。克隆成功提示会附上实际执行通道，例如 `· SSH 宿主机 10.0.0.246（10.0.0.246）`。

### 30.4 配置项

| 配置 | 位置 | 说明 |
|---|---|---|
| `GIT_BIN` | `.env` / compose | git 绝对路径；优先级低于控制台配置 |
| `DP_GIT_FALLBACK_SERVER_ID` | `.env` / compose | 指定借用的 SSH 服务器 id；留空自动挑选 |
| `HOST_WORKSPACE_DIR` | `.env` | 容器内 `WORKSPACE_DIR` 对应的宿主机目录；既是 Docker 构建挂载映射，也是 Git 兜底的路径依据 |
| `DP_INSTALL_GIT=1` | 部署命令环境变量 | 可选：让 `remote.js` 联网给运行时镜像装 Git；不设则依赖 SSH 兜底（内网机器推荐不设） |
| `git.bin` / `git.sshFallback` | `state.json`（控制台写入） | 手工指定路径 / 关闭兜底，无需重启 |

`/api/health` 新增 `git: { available, channel }`，远程排障时不用登录容器就能判断。

### 30.5 新增接口

| 接口 | 说明 |
|---|---|
| `GET /api/git/runtime` | 完整诊断（版本 / 来源 / 探测记录 / 执行通道 / 兜底就绪度 / 修复指引） |
| `POST /api/git/runtime/refresh` | 清空缓存重新探测（容器内装完 git 后点「仅重新检测」） |
| `PUT /api/git/runtime` | 保存 `{ bin, sshFallback }` 并立即重新探测 |

`POST /api/repos/clone` 返回值新增 `channel` / `channelLabel` / `gitVersion`，旧字段保持不变。

### 30.6 排查顺序

1. 打开克隆页看「Git 运行时」卡片，或直接 `curl http://<host>:9000/api/health` 看 `git.channel`；
2. `channel=local` → 正常；`channel=ssh-host` → 可用但建议给镜像补 git；`channel=none` → 按卡片指引处理；
3. 容器方式最快修法：重新执行 `node scripts/remote.js deploy <host>`，新版会自动选/构建带 git 的镜像；
4. 不方便重新部署时：在控制台填写 `GIT_BIN`，或确保已配置 `HOST_WORKSPACE_DIR` 并登记宿主机 SSH 走兜底；
5. 若远端 git 也无法访问仓库（例如 `cloneUrl` 用了 compose 内部服务名 `gitea:3000`），需改成宿主机可达的地址（`http://<host>:3002`）。

### 30.7 验证结果（`10.0.0.246` 实测）

| 项目 | 结果 |
|---|---|
| 部署前 | 平台容器 `node:20-alpine` 内 `GIT_MISSING`，宿主机 `git 2.11.0`；克隆返回 `spawn git ENOENT` |
| 镜像选择 | `node:22-bookworm` 因 Node 崩溃被跳过，保留可运行的 `node:20-alpine`，未让部署失败 |
| 部署后健康检查 | `0.3.3` · `git.available=false` · `git.channel=ssh-host` |
| 兜底详情 | `测试服务器 10.0.0.246` → `/data/platform/workspace`（来源 `HOST_WORKSPACE_DIR`），容器内 SSH 回连成功 |
| 真实克隆 | 内置 Gitea 临时仓库 → `ok:true` · `authenticated:true` · `channel:ssh-host` · `gitVersion: git 2.11.0` |
| 产物 | 宿主机与容器内均可见完整 `.git` 与 `README.md`，`HEAD → refs/heads/main` |
| 凭据安全 | 修复后 `.git/config` 不含 `extraheader` / `Authorization` / Token；测试仓库与目录已清理（Gitea 删除返回 204） |
| 自检 | `npm run check` 22 个模块、`check-frontend.js` 39 项、`smoke-proxy-openlist.js` 60 项、`smoke-git-runtime.js` 31 项全通过 |

> 本机 `9000` 上的旧实例未覆盖；如需同步，重启该实例或按 §30.6 重新部署即可。

## 31. v0.3.4：环境适配中心（切换环境自动检查处理）

### 31.1 解决什么问题

§30 只修好了「容器里没有 Git」这一个点，但同一份代码还会跑在本机单文件 exe、完整 compose 容器、`node:*-alpine` 精简容器、远程 SSH 部署等不同环境里：有的没有 Git、有的 Docker socket 不可达、有的软件源不通、有的必须借宿主机执行。每换一次环境都要人工排查、改参数、重新部署。

v0.3.4 把这件事收敛成 **识别 → 体检 → 按档案自动处置**：平台启动时（以及每次 `remote.js deploy` 收尾）自动识别当前环境、生成指纹、重跑体检，并按可配置策略把克隆通道 / 构建后端 / SSH 兜底调整到当前环境可用的组合。环境换了但没改任何配置，也能直接工作。

### 31.2 三层配置与优先级

| 层级 | 位置 | 用途 |
|---|---|---|
| 部署期声明（最高） | `.env` / compose / `docker run -e` 的 `DP_*` | 换机器时**覆盖旧 state**，避免被上一台机器的配置锁死 |
| 控制台策略微调 | 「环境适配」页，存 `state.json` | 日常手工固定某一项；留空 = 跟随档案 |
| 环境档案 | 内置 5 套 + 自定义档案 | 一套环境一套策略，一键切换 |
| 自动推导（最低） | `auto` 档案 | 按体检结果推导，默认行为 |

**默认全部留空即全自动**，无需任何配置。`DP_*` 变量清单见 `.env.example` 的「环境适配」段。

### 31.3 内置档案

| id | 适用环境 | 克隆通道 | 其它 |
|---|---|---|---|
| `auto` | 默认；按能力推导 | 随推导结果 | 指纹变化时自动重算 |
| `native` | 本机 / 单文件 exe | `local` | 不联网装 Git |
| `container` | 自带 Git 的完整镜像 | `local` | 不联网装 Git |
| `container-lite` | `alpine` / `slim` 等无 Git 镜像 | `ssh-host` | 强制开启 SSH 宿主机兜底 |
| `remote` | 远程 SSH 部署 | `ssh-host` | 构建后端 `auto` |

自定义档案可在控制台「另存档案」，把四个策略项存成一个 id，随时用 `DP_ENV_PROFILE=<id>` 或「切换档案并应用」一键套用。

四个策略项：`gitClone`（`auto` / `local` / `ssh-host` / `disabled`）、`buildExecutor`（`auto` / `local` / `docker` / `ssh` / `wsl`）、`gitInstall`（`never` / `auto`）、`sshFallback`（`auto` / `on` / `off`）。

### 31.4 自动体检的 8 项

运行时（Node 版本 / 平台 / 容器 / 镜像）、Git 可执行文件、SSH 宿主机兜底（深度体检会真连一次，验证宿主机 Git 与目录可写）、工作区可写与挂载映射、Docker / 构建能力、集成服务连通性（Gitea / OpenList / code-server，1.5 秒超时）、策略与环境是否冲突、环境漂移（指纹变化）。每项都有状态、详情、建议，以及「是否可自动处置」。

### 31.5 自动处置边界（重要）

会做：刷新 Git 探测缓存、按档案开关 SSH 兜底、把不可用的通道自动降级（`local` 无 Git → `ssh-host`；`ssh-host` 无兜底 → `local`）、构建后端在 `docker` / `ssh` 不可用时降级为 `auto`、按**显式授权**联网安装 Git（`gitInstall=auto`，45 秒硬超时）。

**不会做**：改任何凭据、重启容器、删除数据、替换运行镜像。默认 `gitInstall=never`——内网机器 `apk` / `apt` 源常常不可达，开启会把部署挂住，所以自动安装必须显式打开。所有动作写入 `state.environment.history`，控制台可回看。

### 31.6 新增接口

| 接口 | 作用 |
|---|---|
| `GET /api/environment` | 完整报告：环境事实 / 档案 / 策略来源 / 8 项体检 / 处置日志 / DP_* 声明（30 秒缓存） |
| `POST /api/environment/check` | 强制深度重检（含 SSH 宿主机实测） |
| `POST /api/environment/heal` | 按策略执行自动处置，返回动作列表与生效通道 |
| `PUT /api/environment/config` | 保存档案、策略微调、体检 / 处置开关 |
| `POST /api/environment/switch` | 切换档案并立即体检 + 处置 |
| `GET/POST /api/environment/profiles`、`DELETE /api/environment/profiles/:id` | 自定义档案增删查 |
| `GET /api/health` | 新增 `environment.{profile,derived,channel,fingerprint,kind,autoHeal}`，部署脚本 / 监控无需登录即可读 |

`POST /api/repos/clone` 现在按 `environment.gitStrategy()` 调度，并多返回 `strategy` / `profile`；策略设为 `disabled` 时会明确拒绝，不会静默换通道。

### 31.7 换环境的三种典型用法

1. **什么都不配（推荐）**：`node scripts/remote.js deploy <新机器> /data/platform` → 部署收尾自动跑深度体检 + 处置，日志直接打印「环境 / 档案 / 克隆通道 / 体检统计 / 每个动作」；平台启动也会因指纹变化自动重检。
2. **固定目标环境策略**：在新机器 `.env` 写 `DP_ENV_PROFILE=container-lite`（或自定义档案 id），重新 deploy。环境变量优先级高于 `state.json`，旧配置不生效。
3. **临时排障**：控制台「环境适配」页 → 重新体检（含 SSH 实测）→ 应用自动处置；或手动改某一项后点「切换档案并应用」。克隆页「Git 运行时」卡片会同步显示当前档案与生效通道。

### 31.8 验证结果

| 项目 | 结果 |
|---|---|
| 后端自检 | `npm run check` 23 个模块全通过 |
| 前端自检 | `scripts/check-frontend.js` 42 项全通过（26 个独立页） |
| 端到端冒烟 | `smoke-proxy-openlist.js` 60 项、`smoke-git-runtime.js` 31 项 |
| 环境专项冒烟 | `scripts/smoke-environment.js` 28 项全通过：自动推导 `container-lite`、策略降级、DP_* 优先级、漂移触发、档案增删改切、禁用策略真实阻止克隆 |
| 远端实测 | 见下方 31.9 |

### 31.9 远端实测（`10.0.0.246`）

| 项目 | 结果 |
|---|---|
| 部署 | `remote.js deploy 10.0.0.246 /data/platform` 自动注入 `DP_RUNTIME_KIND=container` / `DP_RUNTIME_IMAGE=node:20-alpine`；收尾自动跑深度体检，日志直接打印环境 / 档案 / 通道 / 统计 / 处置动作 |
| 自动识别 | `/api/health` → `0.3.4` · `kind=container` · `profile=auto` → `derived=container-lite` · `channel=ssh-host` · 指纹 `b60920e38bba` |
| 体检 | 8 项：7 正常 / 1 提醒（容器内无 Git）/ 0 异常；SSH 宿主机实测「Git 可用 / 目录可写」；Gitea / OpenList / code-server 分别 200 / 200 / 302 |
| 自动降级 | 强制切到 `native`（要求 `local`）→ 自动降级 `local → ssh-host` 并写入日志；切回 `auto` 立即恢复 `container-lite` |
| 环境切换 | 把 `environment.lastFingerprint` 改成旧值后重启容器，启动日志出现「已检测到环境切换」并自动重检，`history` 留下「触发环境切换体检」 |
| health 实时性 | 切到 `native` 后 `/api/health.environment.profile=native`，切回后为 `auto`（档案不被缓存） |
| 策略优先级 | 控制台设 `gitClone=auto` → 生效值与来源均变为「控制台策略微调」；清空后恢复档案预设 |
| 真实克隆 | 内置 Gitea 临时仓库 → `channel:ssh-host` · `strategy:ssh-host` · `authenticated:true` · `gitVersion: git 2.11.0` |
| 凭据安全 | `.git/config` 仅含 `[core] / [remote "origin"] / [branch "main"]`，无 `extraheader` / Token |
| 清理 | 测试仓库删除返回 204，工作区只剩原有 `smoke-test`；`state.json` 权限仍为 600 |

> v0.3.4 未打 tag、未触发 Release；本机 `9000` 的旧实例仍未覆盖。

## 32. v0.3.5：全接口巡检与错误分类治理（修复「大多接口报 500」）

### 32.1 现象与三个根因

用户反馈「大多功能接口都返回 500」。对 156 条路由逐条探测后确认，**不是大面积代码崩溃**，而是三类问题叠加：

| # | 根因 | 典型表现 |
|---|---|---|
| ① | 外部集成服务凭据失效 | 远端 OpenList 数据库里 `admin` 用户被删（只剩一个 disabled 的 `guest`），Token / 密码登录都失败，`/api/fs/*`、`/api/admin/*` 全部返回 `code=500 record not found`。平台把这类上游错误统一包成 HTTP 500，存储/文件页一次并发 4~6 个这样的请求，看起来就是「一片 500」 |
| ② | 错误状态码没有分层 | 参数写错、对象不存在、上游服务挂了、真的代码异常，全部走 `wrap → fail(res, e)` 默认 500。连「缺少参数：name」都是 500 |
| ③ | 只读接口没有降级 | 列表类接口遇到上游异常直接抛错，前端整块渲染红色错误块，而不是空态 + 修复提示 |

### 32.2 修复一：统一 HTTP 错误模型（`core.js` / `mini.js` / `integrations.js`）

- 新增 `HttpError` 与 `badRequest()` / `notFound()` / `upstream()`；`fail()` 输出 `{ ok:false, error, status, code?, hint? }`。
- `wrap()` 与 `mini.js` 的顶层 catch 共用 `inferStatus()` 兜底推断（**只匹配明确短语，其余一律保持 500**，避免把真实 bug 伪装成用户输入错误）：参数/校验 → 400，对象不存在 → 404，外部服务不可用 → 502，未预期异常 → 500。
- `httpJSON()` 的网络异常、非 2xx 响应与 OpenList 的「HTTP 200 + `code != 200`」统一打上 `upstream:true` + 可操作 `hint`；登录失败、`record not found` 单独提示「admin 用户可能被删除」。
- 前端 `api()` 按 400 / 404 / 502 / 500 生成带分类前缀的错误，并把 `hint` 一并展示。

### 32.3 修复二：只读列表优雅降级（`server.js`）

新增 `tolerant(handler, empty)` 包装，覆盖 `/api/storage`、`/api/storage/mounts`、`/api/openlist/{settings,storages,drivers,drivers/info,files}`、`/api/git-sources/:id/repos`：

- 上游不可用时返回 **HTTP 200 + `degraded:true` + 空数组/空对象 + `error` + `hint`**，页面照常渲染；
- 前端「存储/文件」页新增 `#storage-degraded` 黄色提示区，显示原因、修复建议与「前往连接管理」按钮；
- **写操作不降级**，仍返回 502 明确告知「上游不可用，操作未执行」，避免静默成功。

### 32.4 修复三：恢复远端 OpenList（`10.0.0.246`）

在 `/data/platform/data/openlist/` 上：

1. 先备份 `data.db` → `data.db.bak-20261110`；
2. 官方 CLI `openlist admin set` 只更新不创建（日志 `failed get admin user: record not found`），因此先补一条 `admin` 占位行（role=2、enabled），再由 CLI 写入 `.env` 里**已有的那个密码**——没有改动任何凭据值、没有重置密码；
3. 重启 `dp-openlist`，`/api/auth/login` / `/api/me` / `/api/admin/storage/list` 全部 `code=200`；
4. 通过平台自身 `POST /api/openlist/storages` 新增 `/workspace` Local 挂载（顺带验证写接口），`/api/openlist/files?path=/` 开始返回真实目录；
5. 新建的 admin 用户 `permission=0` 会让 `/api/fs/mkdir|remove|rename` 返回 `code=403 permission denied`，把权限掩码设为全开（`2147483647`）并重启后，文件写操作恢复 200。

> 备份与变更只在平台自己部署的 `dp-openlist` 容器数据目录内；宿主 `/opt/openlist` 的另一实例与其它服务未改动。凭据沿用 `.env` 原有值，没有重置 / 轮换任何密码或 Token。

### 32.5 全接口巡检工具（`scripts/api-sweep.js`）

```bash
# 对运行中的实例跑一遍全部 156 条路由
node scripts/api-sweep.js --base http://10.0.0.246:9000
# 额外做 CRUD 循环（临时实体带 __sweep_ 前缀，结束自动清理）
node scripts/api-sweep.js --base http://127.0.0.1:9000 --full
# 机器可读报告，便于接 CI
node scripts/api-sweep.js --base http://10.0.0.246:9000 --json
```

- 路由直接从 `server.js` 提取，**新增接口自动纳入巡检**；
- 写接口一律使用不存在的 id，保证巡检不会误删 / 误改真实数据；会重启服务、执行远程命令、上传文件或建立 SSE 长连接的路由显式跳过；
- 断言：**500 必须为 0**、无超时、只读列表降级正常、所有错误响应带结构化 `status`；
- Windows 本机加 `--skip-probe` 跳过「构建后端 / 本地 AI 程序」探测（否则会尝试启动 `wsl.exe`）；
- 也可用 `npm run sweep -- --base ...` 调用。

### 32.6 验证结果

| 项目 | 结果 |
|---|---|
| 后端自检 | `npm run check` 含新增 `api-sweep.js` / `smoke-api-status.js` 语法校验，全通过 |
| 前端自检 | `check-frontend.js` 44 项全通过（含降级提示区与 api() 错误分类） |
| 错误模型专项 | `scripts/smoke-api-status.js` 33 项全通过：分类表、结构化响应、6 个只读接口降级、写操作 502、400 / 404 归类 |
| 既有冒烟 | `smoke-proxy-openlist.js` 60 项、`smoke-git-runtime.js` 31 项、`smoke-environment.js` 28 项 |
| 本地全接口巡检 | 142 项 · 0 个 500 / 0 超时 / 0 降级异常；`--full` 149 项同样全绿 |
| 远端全接口巡检 | 见下方 32.7 |

### 32.7 远端实测（`10.0.0.246`）

| 项目 | 结果 |
|---|---|
| 部署 | `remote.js deploy 10.0.0.246 /data/platform` 成功；`/api/health` → `0.3.5` · `environment=auto → container-lite` · 克隆通道 `ssh-host`；启动体检 7 正常 / 1 提醒 / 0 异常 |
| 修复前基线 | 主 GET 接口 6 个 500（全部 OpenList）、带参 GET 另有 5 个 500、写接口 20 余个 500，参数错误与对象不存在也被包成 500 |
| 全接口巡检 | `api-sweep.js --base http://10.0.0.246:9000 --full`：156 条路由 / 实测 147 项 / 跳过 24 个有副作用或长连接路由 → **83 个 200、62 个 4xx、1 个 502、0 个 500**、0 超时、0 降级异常、0 错误体缺 status；`failures: []` |
| 剩余 1 个 502 | 巡检故意请求不存在路径 `/__sweep_missing__` 触发 OpenList `failed get storage`，属预期上游响应，带 hint，不是程序错误 |
| 页面并发接口 | 总览 / 仓库 / Git 源 / 存储 / 挂载 / 文件 / 驱动 / 设置 / 连接 / 代理 / Docker / 扩展 / 服务器 / AI / 环境共 16 个接口全部 200，无红错 |
| OpenList 状态 | `online=true` · `admin=true` · `write=true` · `storageCount=1` · `adminError=''` · v4.2.9 |
| 文件 CRUD | `mkdir → list → rename → list → remove` 全部 200；最终工作区只剩原有 `smoke-test`，测试目录已清理 |
| 前端资源 | `?v=20261110g`，页面含 `#storage-degraded` 降级提示区 |

> 以上是 v0.3.5 当时的实测记录。v0.3.5 已于 2026-11-11 补打 tag 并发布 Release；本机 `127.0.0.1:9000` 也已重编译升级（SEA 单文件内部 bundle 必须 `npm run build` 才会更新），见 §33。

---

## 33. v0.3.6：交互打磨、镜像源治理与 Docker 分区重构

### 33.1 `10.0.0.246` 现场排查结论

| 现象 | 实际原因 |
|---|---|
| 克隆报 `{"ok":false,"error":"目录已存在：secure","status":500}` | 宿主 `/data/platform/workspace/secure` 在 03:45 已克隆成功（含 `.git`、`app/`、`web/` 等完整内容），用户再次点了克隆。真正的问题是**错误分类**：这是业务冲突，却被 `wrap()` 兜底成 500，提示也没告诉用户「已经成功了，直接去打开」 |
| 安装 DbGate 报 `Docker API ... → 500: {"message":"denied"}` | 远端 `.env` 为 `DOCKER_IMAGE_PREFIX=docker.m.daocloud.io/library/`，与清单镜像 `dbgate/dbgate` 直接拼接成 `.../library/dbgate/dbgate`。`library/` 只适用于 Docker Hub 官方单段镜像，命名空间镜像必须由平台自动去掉 |
| Git 源「不支持编辑」 | 后端 `PUT /api/git-sources/:id` 与 `updateSource()` 一直存在，缺的只是前端的编辑入口与编辑态 |

### 33.2 修复

- **克隆冲突**：`gitSources.js` 抛 `HttpError(409)`，带 `WORKSPACE_TARGET_EXISTS` code 与 `hint`；本地通道会检查 `.git` 判断「完整仓库 / 失败残留」，SSH 宿主机通道给中性提示。前端克隆页增加常驻冲突提示区与「打开仓库列表 / 在线 IDE」按钮，成功提示也明确指向入口。`core.js` 新增 `conflict()` 与 `inferStatus` 的 409 兜底，`api()` 增加「操作冲突」分类。
- **Git 源编辑**：列表加「编辑」按钮，回填名称 / 类型 / 地址 / 认证方式 / 用户名；凭据栏留空表示沿用原值（前端直接不提交该字段，避免把脱敏值或空串写回 `state.json`），标题与按钮切换为「保存修改」，可随时「取消编辑」。内置源仍由 `.env` 管理，不提供编辑入口。
- **镜像源治理**（`core.js` 新增 `resolveImage()` / `imageCandidates()`）：按镜像名自动决定是否补 `library/`，自带 registry 域名的镜像（ghcr.io 等）不加速；扩展安装、镜像拉取、构建后端三处统一接入。拉取遇 `denied / manifest unknown` 自动回退原始 Docker Hub 镜像，并把实际使用的镜像回写实例；失败时给出带当前前缀的可操作 hint。`/api/docker/overview` 新增 `imagePrefix` 字段，设置页与镜像页直接显示当前加速源。
- **宝塔式路径条**（`pathBarHtml()` / `bindPathBar()`，本地文件浏览与远程 SFTP 共用）：面包屑每段可点击跳转，点条内空白处或「输入」切换为可编辑输入框（默认全选、回车确认、Esc 取消、失焦确认），返回按钮直达上一级。本地文件列表目录行改为**双击进入**，移除每行「进入」按钮。
- **服务器状态定时刷新**：默认 15 秒，可选 10/15/30/60 秒或关闭（存 `localStorage`）；只在服务器页激活、标签页可见、上一轮已结束时请求，切回前台立即补一次，失败不弹 toast；列表刷新后自动补拉状态，避免满屏「—」。
- **Docker 分区重做**：容器列表改为固定列宽 + 单行截断，端口映射只显示前两条并附总数、完整列表放 `title`，创建时间独立成列，解决超长端口把其它列挤成竖排；新增「仅平台自建」筛选与统计 chips。设置页由裸 JSON 改为分组键值卡 + 原始诊断折叠 + 复制，另有自动刷新间隔与表格密度偏好。镜像 / 仓库页加快捷镜像、当前加速前缀、拉取结果与「复制引用」；存储卷与网络页加高级参数生成命令、筛选、创建时间 / 子网 / 已接入容器数 / 内置网络标识与复制挂载点；容器编排页加 4 套内置模板、YAML 基础校验、载入 / 复制 / 下载。

### 33.3 兼容与边界

- 旧的 `DOCKER_IMAGE_PREFIX=.../library/` 配置**无需修改**，平台会自动规范化；留空则直连 Docker Hub。
- 编排模板仍只登记文本、不在平台内执行；卷 / 网络的高级参数生成命令由用户自行到服务器执行，平台创建接口仍只接受名称。
- Docker 面板偏好、刷新间隔只影响当前浏览器；安全策略（非平台容器只读 + 二次确认 + 审计）不变。
- 前端资源版本 `?v=20261111a`；`check-frontend.js` 同步更新版本断言并新增对模拟 DOM 的防御。
- **回归补修**：远端全接口巡检复测发现 `POST /api/proxy/test` 直连 `github.com` 超时被判成 500。现把网络层不可达（直连/隧道超时、DNS 失败、连接被拒）统一归为 `502 / PROXY_TARGET_UNREACHABLE` 并附「配置代理或换内网测试地址」的修复提示；`inferStatus` 与 `smoke-api-status.js` 补了防回归断言，真·代码异常仍保持 500。两套冒烟里的版本号断言改为读取 `package.json`，不再随发版硬编码。

### 33.4 实测（`10.0.0.246` 与本机，2026-11-11）

| 验证项 | 结果 |
|---|---|
| 部署 / 版本 | `remote.js deploy 10.0.0.246` 成功；远端与本机 `/api/health` 均为 `0.3.6`；本机 SEA exe 已重编译并重启 |
| 克隆冲突 | 手动复现同名 `secure` → `409 / WORKSPACE_TARGET_EXISTS`，hint 明确指出「已存在同名完整仓库，可直接打开」 |
| Git 源编辑 | `PUT /api/git-sources/:id` 回写成功，密码脱敏值保持 `******03` 未被清空 |
| DbGate 镜像 | `POST /api/docker/images/pull` → `docker.m.daocloud.io/dbgate/dbgate:latest`，`usedFallback=false`，不再出现 `library/dbgate/dbgate` 的 denied |
| Docker 元数据 | `/api/docker/overview` 返回 `imagePrefix`；69 个卷带创建时间 / 标签、16 个网络带子网 / 网关 / 已接入容器数 |
| 全接口巡检 | 本机 138 项、远端 `--full` 147 项，补修 `proxy/test` 后复测均 **0 个 500**、0 超时、0 降级异常、0 错误体缺 status |
| 自检 | `npm run check`、`check-frontend.js`、四套冒烟（40 / 31 / 28 / 60 项）、release.yml YAML 解析全部通过 |

> v0.3.6 只提交到 `main`，未打 tag、未触发 Release；需要发版时补一个 `v0.3.6` tag 即可（release notes 已包含本版说明）。

---

## 34. v0.3.7：弹窗交互、工作区仓库、扩展体检与表单排版

### 34.1 五类反馈

| 用户反馈 | 落地结果 |
|---|---|
| Git 源「登记 / 编辑」改为弹窗 | 新增 `gitsrc` 弹窗（遮罩 / Esc / 取消关闭），列表卡片只留「＋ 登记 Git 源」；表单 id 不变，提交后自动关闭并刷新列表与仓库聚合 |
| Git 运行时检测要显示结果 | 检测卡片展示可执行文件、版本、探测来源、平台、工作区 / 宿主机映射、SSH 兜底状态与检测时间；新增可展开的逐条探测明细（`tried`），「重新检测」带按钮态与即时反馈 |
| 仓库列表看不到已克隆的 `secure` | `/api/repos` 增加工作区扫描：枚举含 `.git` 的目录、读取 remote 与更新时间，以「工作区」来源置顶；源故障拆成逐条错误卡片 + 「编辑源 / 代理配置」入口，远端源全挂也不影响本地仓库 |
| 扩展 / 数据库要检测各项功能、DbGate 不可用 | 新增 `POST /api/extensions/diagnose` 一键体检（容器状态 / 端口 / 内部检查 / 日志特征 / 修复建议）与 `POST /api/extensions/instances/:id/rebuild` 保留卷与凭据重建容器 |
| Docker 面板偏好标签与下拉框挤在一起 | `.form` 外的 `label` 没有纵向排版样式，退化成浏览器默认横排；统一 `.grid-2/.grid-3 > label` 与 `label.field` 的标签 / 控件 / 说明三段式，偏好区改为卡片 + 说明文字，同类位置一并生效 |

### 34.2 关键排查结论（10.0.0.246）

- **DbGate 崩溃**：容器 `dp-ext-dbgate` 状态 `Restarting (139)`，日志为 `Assertion failed: (0) == (uv_thread_create(...)) at ../src/node_platform.cc:104`。容器无 `PidsLimit` / 内存限制，宿主 `threads-max=63707`、负载约 1.4，排除资源耗尽；宿主是 **Debian 9 / 内核 4.9**，而 `dbgate/dbgate:latest` 内置 **Node 22.23.4** —— Node 20+ 在旧内核 + Docker 默认 seccomp 下创建工作线程被拦截，属已知的 `clone3` 兼容问题。
- **兼容策略**：`extRuntime.kernelCompat()` 用 `os.release()`（容器共享宿主内核）判定，内核主版本 < 5 时仅给**平台自建容器**加 `SecurityOpt: ["seccomp:unconfined"]`；新内核仍用 Docker 默认安全策略，不触碰宿主机其它容器。
- **外部源报错笼统**：Node 的 fetch 失败只给 `fetch failed`，真实原因在 `e.cause.code`；`httpJSON` 现把 DNS / 拒绝连接 / 超时 / 自签证书分别翻译成可操作提示。

### 34.3 版本与文件

`platform/package.json` → `0.3.7`，静态资源 `?v=20261111b`；`check-frontend.js` 新增 5 条本版断言；`smoke-api-status.js` 的版本号断言改为读取 `package.json`，不再随发版硬编码。

### 34.4 实测（10.0.0.246 与本机，2026-11-11）

| 验证项 | 结果 |
|---|---|
| 版本 / 部署 | 本机 SEA exe 重编译重启、`remote.js deploy 10.0.0.246` 成功，两端 `/api/health` 均为 `0.3.7` |
| 仓库列表 | `/api/repos` 返回 1 条「工作区 / `secure`」，读到分支 `master` 与 remote `https://47.100.44.43:6443/root/secure.git`；远端源全挂也照常显示 |
| 源错误诊断 | 笼统的 `fetch failed` 细化为 `无法连接上游服务 [47.100.44.43:6443]：TLS 证书已过期（CERT_HAS_EXPIRED）` 并附证书链修复建议 |
| 扩展体检 | 2 个实例：Redis 正常；DbGate 精确定位 `NODE_THREAD_CREATE_FAILED`（exit 139、重启 30 次、日志含 `uv_thread_create`） |
| DbGate 重建 | 调用 `POST /api/extensions/instances/:id/rebuild`，容器带 `SecurityOpt=['seccomp:unconfined']` 重建后 **running / exitCode 0 / restartCount 0**，日志出现 `DbGate API listening on port 3000`，线程断言消失 |
| 残留项 | 实例对外地址仍是 `127.0.0.1`，体检报 `PORT_UNREACHABLE` 并给出 `DP_EXT_BIND_IP=0.0.0.0`、`DP_EXT_HOST=10.0.0.246` 的配置指引；**未擅自修改生产 `.env`**，需用户确认后再改并重建实例 |
| 全接口巡检 | 本机 138 项、远端 `--full` 148 项，均 **0 个 500**、0 超时、0 降级异常、0 错误体缺 status |
| 自检 | `npm run check`、`check-frontend.js`（含 5 条本版断言）、四套冒烟（40 / 31 / 28 / 60 项）、release.yml YAML 全通过 |

> v0.3.7 在 2026-11-11 补打 annotated tag `v0.3.7`（指向 `5026cac`）并推送，由 `release.yml` 构建发布 6 个资产；本版随后把 TLS 忽略参数与 .env 管理作为 v0.3.8 继续演进。

---

## 35. v0.3.8：TLS 校验忽略参数与 .env 平台化管理

### 35.1 需求背景

v0.3.7 把外部 Gitea 的笼统 `fetch failed` 定位成 `CERT_HAS_EXPIRED`，但当时的结论只有一句「请在服务端续期 / 换受信任证书，平台侧不会跳过证书校验」。内网自建服务换证书往往不在平台使用者的控制范围内，用户需要：

1. 一个**显式、可关闭、影响面可控**的「忽略证书校验」参数，而不是被迫改代码或全局关掉安全校验；
2. 遇到 `PORT_UNREACHABLE` 这类「其实是 env 配置问题」时，平台能**直接告诉该改哪个键、写成什么值、改完要不要重启**，最好能在页面上改。

### 35.2 TLS 忽略参数（三态 + 全局兜底）

| 层次 | 位置 | 取值 | 作用范围 |
|---|---|---|---|
| 源级（最高） | 「Git 源」登记 / 编辑弹窗 → TLS 证书校验 | `auto` 跟随全局 / `on` 忽略 / `off` 始终严格 | 该源的仓库列表、分支、新建仓库 API，以及从该源克隆 |
| 克隆本次 | 「克隆到工作区」→ TLS 证书校验 | `auto` / `on` / `off` | 仅本次 `git clone` |
| 全局 | `.env` 的 `DP_TLS_INSECURE` | `1` 开启，留空关闭 | 所有出站 HTTPS（内置 Gitea / OpenList / 在线 IDE）与未显式设置的外部源 |
| 域名限定 | `.env` 的 `DP_TLS_INSECURE_HOSTS` | 逗号分隔域名 / IP | 配合全局开关，只对这些主机跳过校验 |

- **默认严格校验**，只有显式打开才跳过；源级 `off` 可以覆盖全局 `on`，避免「开了全局就关不掉公网源」。
- 实现上 REST API 走 `undici` 的跳过校验 dispatcher（直连 `Agent.connect`、代理链路 `requestTls` + `proxyTls` 两跳都覆盖）；`git clone` 用 `git -c http.sslVerify=false clone`，`-c` 在 `clone` 之前，**不写进 `.git/config`**。
- 证书类错误的 `errorCode` 统一为 `TLS_CERT_INVALID`，hint 同时给出「推荐续期 / 换证书」与「临时应急」两条路径；全局安全警告在弹窗与环境配置页各有一处。
- `DP_TLS_INSECURE*` 属于「即时生效」键：在控制台保存后同步热更新运行时 `config`，**无需重启**。

> ⚠ 跳过证书校验会失去防中间人攻击能力，只建议用于可信任内网的临时应急；长期方案始终是给服务端续期 / 换受信任证书，并把内网 CA 加入平台容器信任链。

### 35.3 .env 在平台上的管理

新增独立页「环境配置」（`view-envcfg`）与模块 `platform/src/envConfig.js`：

| 接口 | 作用 |
|---|---|
| `GET /api/env-config` | 返回 `.env` 路径 / 是否可写 / 白名单键（脱敏值、运行时生效值、待重启标记、说明、示例）/ 分组 / 配置建议片段 |
| `PUT /api/env-config` | `{ confirm: true, values: { KEY: value } }` 按白名单写回，自动备份为 `.env.bak.<时间戳>`、600 权限、保留原注释与顺序 |

- **白名单**：只认 `SPECS` 里登记过的键，杜绝通过页面注入任意环境变量；值禁止换行 / 控制字符，URL / 布尔类做格式校验。
- **脱敏**：Token / 密码只返回 `abc******xyz`；前端把脱敏占位符回传时后端跳过，不会误把 `******` 写进文件。
- **待重启提示**：文件值 ≠ 运行时生效值时标 `待重启`；容器部署提示重新执行 `remote.js deploy`，并说明扩展地址改完还要重建实例。
- **容器支持**：`remote.js deploy` 在有 `.env` 时追加 `-v <部署目录>/.env:/app/.env:rw` 与 `-e DP_ENV_FILE=/app/.env`，页面读到的是宿主机真实配置文件；因为单文件 bind mount 不能用 tmp + rename 顶掉挂载 inode，写回采用**原地 `writeFileSync`**。
- **不自动重启**：平台只写文件、不执行 shell、不重启容器、不改 `state.json`；保存前强制 `confirm` 二次确认。

### 35.4 诊断联动：从「请改 .env」到「告诉你怎么改」

`envConfig.adviceFor(problem, ctx)` 把诊断结论翻译成可直接复制的 `.env` 片段，覆盖 `TLS_CERT_INVALID` / `PORT_UNREACHABLE` / `IMAGE_DENIED` / `GIT_BIN_MISSING` / `PROXY_TARGET_UNREACHABLE`：

- 仓库列表的源错误卡：证书类故障新增「去配置 env · 关闭证书校验」按钮；
- 扩展一键体检：`PORT_UNREACHABLE` 结论带 `envAdvice`（含宿主机 IP 猜测），显示「去配置 env」按钮；
- 两处跳转都会带上 `envKeys` 与 `problem`，环境配置页**高亮对应配置行、自动把建议值预填进「新值」列**（仍未写文件），用户确认后点「保存并应用」；
- 建议片段也可单独「复制片段」，或手工粘到服务器上的 `.env`。

### 35.5 文件清单

| 文件 | 变更 |
|---|---|
| `platform/src/envConfig.js` | 新增：白名单元数据、读写、脱敏、热更新、建议片段、TLS 决策 |
| `platform/src/core.js` | `config` 增加 `tlsInsecure` / `tlsInsecureHosts` / `envFile`，新增 `resolveEnvFile()` 多形态路径探测 |
| `platform/src/proxy.js` | `dispatcher(proxyUrl, insecure)` + 缓存的 `insecureDispatcher()` |
| `platform/src/integrations.js` | `httpJSON` 支持 `insecure`，证书错误升级为结构化 `TLS_CERT_INVALID` |
| `platform/src/gitSources.js` | 源三态 `insecure`、`publicSource` 暴露、`git clone` 的 `http.sslVerify`、错误卡结构化字段 |
| `platform/src/extRuntime.js` | `diagnose()` 输出 `envAdvice`，端口不通提示指向环境配置页 |
| `platform/src/server.js` | `GET/PUT /api/env-config` |
| `platform/public/*` | 新页、Git 源 / 克隆表单 TLS 选项、错误卡与体检卡跳转、样式 |
| `scripts/remote.js` | 部署时挂载宿主机 `.env` 并注入 `DP_ENV_FILE` |
| `scripts/check-frontend.js` / `api-sweep.js` | 本版断言；`PUT /api/env-config` 列入副作用跳过 |

### 35.6 实测（本机 + 10.0.0.246，2026-11-11）

| 验证项 | 结果 |
|---|---|
| v0.3.7 补发 Release | annotated tag `v0.3.7` → `5026cac` 已推送，CI 发布 6 个资产（含 `SHA256SUMS.txt` 445 B） |
| 本机 / 246 版本 | SEA exe 重编译重启、`remote.js deploy 10.0.0.246` 两次成功，两端 `/api/health` 均为 `0.3.8` |
| `.env` 挂载 | 246 容器新增 `/data/platform/.env → /app/.env` 单文件挂载并注入 `DP_ENV_FILE=/app/.env`；`/api/env-config` 读到 `/app/.env`（22 项、5 条建议、可写、Token 脱敏、`DP_EXT_HOST` 已是 `10.0.0.246` 且无待重启项） |
| TLS 端到端 | 默认 `/api/repos` 报 `TLS_CERT_INVALID`（`CERT_HAS_EXPIRED`）→ 通过 `PUT /api/env-config` 写入 `DP_TLS_INSECURE=1` + `DP_TLS_INSECURE_HOSTS=47.100.44.43`，**无需重启立即生效**，`/api/repos` 错误消失、远端仓库聚合成功 → 还原为空值后 `tlsInsecure=false`，恢复严格校验 |
| 写入安全边界 | 每次写入自动备份到 `DP_ENV_BACKUP_DIR`（容器注入 `/app/data` → 宿主机 `/data/platform/data/`）、600 权限，部署包排除 `.env.bak.*`；脱敏占位符回传不覆盖原 Token；未带 `confirm` 返回 400；非白名单键（如 `PATH`）返回 400 |
| 备份落点回归 | 实测两次写入的备份均为 `/app/data/.env.bak.<时间戳>`（600），宿主机落在 `/data/platform/data/`，代码目录 `/data/platform/platform/` 已无备份残留 |
| DbGate（D 中的 A） | `.env` 写入 `DP_EXT_BIND_IP=0.0.0.0` / `DP_EXT_HOST=10.0.0.246`（原文件备份为 `.env.bak.pre-v038`），重新 deploy 重启平台后重建实例；修复「重建不更新 host」后 `host=10.0.0.246`、`status=online`、连接串 `http://10.0.0.246:3003/`，宿主机访问 `3003` 返回 HTTP 200 |
| 扩展体检 | 2 / 2 项正常，Redis 与 DbGate 均无 `problem`、无 `PORT_UNREACHABLE` |
| 全接口巡检 | 本机 0 个 500；246 `--full` 已测 149 项（跳过 26 个副作用路由），**0 个 500**、0 超时、0 降级异常 |
| 自检与冒烟 | `npm run check`、`check-frontend.js` 60 项断言、四套冒烟 40 / 31 / 28 / 60 全部通过；`release.yml` YAML 通过 |

> 提醒：246 的全局 TLS 开关在验证结束时已还原为关闭；如需长期连那个证书过期的外部 Gitea，请在「Git 源」弹窗**只对该源**选择「忽略证书校验」，或在「环境配置」页按域名限定开启，避免影响其它服务。
>
> 版本说明：`v0.3.7` tag → `5026cac`，`v0.3.8` tag → `bc4bb59`，两次 Release 均由 CI 构建并发布 6 个资产。发布后追加的「.env 备份目录」修复（`3f597ba`）已在 `main` 与 10.0.0.246 生效；Windows 单文件版的 `.env` 与备份同在 exe 目录，不受该问题影响。需要与 `main` 完全一致的源码时直接用仓库主分支。

---

## 36. v0.3.9 · 宿主机 Git 识别（「246 上明明有 git」）

### 36.1 现象与根因

10.0.0.246 宿主机装有 `git 2.11.0 (/usr/bin/git)`，控制台「自动体检」却把「Git 可执行文件」标为提醒，详情写「当前运行环境未找到可用的 Git」。

原因是**两个运行环境被混为一谈**：

| 位置 | Git | 说明 |
|---|---|---|
| 246 宿主机 | ✅ `/usr/bin/git` 2.11.0 | 平台通过 SSH 兜底在这台机器上执行克隆 |
| 平台容器 `node:20-alpine` | ❌ 无 git | 精简镜像默认不装；`remote.js` 默认 `DP_INSTALL_GIT=0`，避免内网软件源不可达时部署卡死 |

旧版体检只看容器内 `resolve()`，虽然 `cloneViaSshHost()` 每次克隆前也会 `git --version` 探测宿主机，但这个结果**没有回传给体检和运行时卡片**，于是出现「功能其实可用、页面却报缺失」的误导。

### 36.2 改动

| 位置 | 改动 |
|---|---|
| `platform/src/gitRuntime.js` | 新增 `probeHostGit()`：借已登记的 SSH 服务器实测 `command -v git` / `git --version` / 宿主机工作区可写；成功缓存 90 s、失败 20 s，`force` 强制重连；本机已有 Git 时跳过，探测异常一律返回结构化结果，**绝不让接口 500**。`describe()` 新增 `hostGit` / `effective` / `effectiveGit` |
| `platform/src/server.js` | `GET /api/git/runtime` 与 `POST /api/git/runtime/refresh`、`PUT /api/git/runtime` 异步带上宿主机实测结果 |
| `platform/src/environment.js` | `runChecks()` 复用 `probeHostGit({force:deep})`；Git 检查项在「容器内 Git 可用」或「宿主机 Git 实测可用且兜底就绪」时判定为 `ok`，明细写明宿主机 IP / 版本 / 路径；deep 体检不再重复发起第二次 SSH |
| `platform/public/app.js` | Git 运行时卡片新增「宿主机 Git」「生效 Git」「宿主机工作区可写」，徽章改为绿色「宿主机 Git x.y.z · SSH 兜底」，探测明细追加 SSH 实测行 |
| `.env.example` / release notes / 前端自检 | 说明 `DP_INSTALL_GIT=1` 的用途并新增断言 |

判定矩阵：

| 容器内 Git | 宿主机 Git | SSH 兜底 | 体检结论 |
|---|---|---|---|
| ✅ | — | — | 正常 · 显示容器版本与路径 |
| ❌ | ✅ 实测 | ✅ | **正常** · 显示「宿主机 10.0.0.246 实测 Git 2.11.0（/usr/bin/git）」 |
| ❌ | 未实测 / 失败 | ✅ | 提醒 · 提示点「重新体检」实测 |
| ❌ | ❌ | ❌ | 错误 · 安装 / `GIT_BIN` / 登记宿主机 |

> 说明：宿主机有 Git 时**不需要**在容器内再装 Git，克隆本来就走 SSH 兜底。若确实要求容器内直接执行（例如调试 `git` 子命令），部署前设 `DP_INSTALL_GIT=1` 构建带 Git 的本地运行时镜像，或容器内 `apk add --no-cache git` 后重启。

### 36.3 实测（本机 + 10.0.0.246，2026-11-11）

| 验证项 | 结果 |
|---|---|
| 修复前 | `/api/environment` = `7 正常 / 1 提醒`，git 项详情「当前运行环境未找到可用的 Git」；容器 `node:20-alpine` 无 git，宿主机有 `/usr/bin/git` 2.11.0 |
| 部署 | `remote.js deploy 10.0.0.246` 成功，启动自检输出「体检：8 正常 / 0 提醒 / 0 异常」 |
| `/api/git/runtime` | `hostGit.available=true`、`bin=/usr/bin/git`、`version=2.11.0`、`host=10.0.0.246`、`workspaceWritable=true`；`effectiveGit.location=ssh-host`、`verified=true` |
| 体检（GET / 深度 POST） | 两次均 `8 正常 / 0 提醒 / 0 异常`；git 项详情「容器内无 Git · 宿主机 10.0.0.246 实测 Git 2.11.0（/usr/bin/git）· 克隆由 SSH 宿主机执行」；深度体检 fallback 项「实测：Git 可用 / 目录可写」 |
| 功能侧证据 | 工作区 `/data/platform/workspace/secure`（825 MB，remote 指向外部 Gitea）本就是容器无 Git 时由 SSH 宿主机克隆产生，`/api/repos` 已把它聚合为「工作区」仓库；深度体检另通过同一条 SSH 通道实测了 `git --version` 与目录可写 |
| 安全边界 | 用 `file://` 本地路径试探克隆被 `cloneUrl 必须是 http(s)/ssh/git 地址` 拦截（预期行为），未产生任何残留目录 |
| 回归 | 本机巡检 0 个 500；246 `--full` 149 项（跳过 26 个副作用路由）0 个 500、0 超时、0 降级异常；扩展体检 2 / 2 正常 |
| 自检 | `npm run check`、前端自检 61 项、四套冒烟 40 / 31 / 29 / 60 全部通过；`smoke-environment.js` 新增「容器无 Git + 宿主机 Git 可用 → 体检判正常」断言 |

---

## 37. v0.3.10 · IDE 凭据、运行主机信息与仓库操作

### 37.1 在线 IDE 的 `$PASSWORD`

code-server 登录页提示「Please log in below. Password was set from $PASSWORD.」，而 `.env` 里明明有 `CODE_SERVER_PASSWORD`，控制台「环境配置」页却查不到这一项 —— 根因是白名单只登记了 `CODE_SERVER_URL`，`core.js` 也从未读取该值。

| 位置 | 改动 |
|---|---|
| `core.js` / `envConfig.js` | 新增 `config.codeServerPassword`；`CODE_SERVER_PASSWORD` 纳入白名单（敏感、脱敏、需重启）并在运行时生效值中展示 |
| `GET /api/ide` | 返回 `{ configured, masked, key, envVar, hint }`，**列表接口绝不返回明文** |
| `POST /api/ide/password` | 只有显式 `{reveal:true}` 才返回明文；巡检列入副作用跳过 |
| IDE 页 | 「登录凭据」卡说明 `$PASSWORD` 与本平台 `.env` 键的对应关系，提供显示 / 复制密码与「去环境配置修改」 |

### 37.2 运行平台与总览主机信息

`linux/x64` 无法区分「平台容器」与「真正执行 Git 的宿主机」。现在同一份报告把两侧分开：

| 数据来源 | 内容 |
|---|---|
| 平台进程（本地同步） | 版本、Node、OS 发行版、内核、主机名、CPU / 内存、已运行时间、容器形态与镜像、工作区、`.env` 路径 |
| SSH 宿主机（复用 `probeHostGit` 的同一次 SSH） | `lsb_release -ds` / `/etc/os-release` 的 PRETTY_NAME、`uname -sr`、`hostname -I`、Git 版本与路径、`lsb_release -a` 原始输出 |
| `collectStatus()` | CPU 核数、负载、内存、磁盘 `/`、运行中容器数 |

`GET /api/host-info` 整份报告缓存 60 秒（`?force=1` 强制重采）；总览新增全宽「运行主机」卡片，Git 运行时卡片新增「运行平台」（`linux/x64 · Alpine Linux 3.23.3 · 内核 ...`）、「运行镜像」与「Git 宿主机」（`Debian GNU/Linux 9.13 (stretch) · 内核 4.9.x · Git 2.11.0`），并可展开宿主机 `lsb_release -a`。

### 37.3 仓库列表的文件管理与 Git 命令

工作区仓库（来源标为「工作区」）现在每个都有 5 个入口：

| 入口 | 行为 |
|---|---|
| IDE 打开 | 原有，按目录打开 code-server |
| **文件管理** | 打开独立 SFTP 远程文件标签并直接定位到 `<HOST_WORKSPACE_DIR>/<仓库名>`，可浏览 / 编辑 / 上传 / 删除，和「服务器 → 文件管理」一致 |
| **终端** | 打开 SSH Web 终端标签，连接后自动 `cd` 到仓库目录，可直接敲任意 git 命令 |
| **Git 操作** | 弹窗提供 status / log / branch / remote / diff / fetch / pull 快捷命令和自定义命令，显示完整命令、执行通道、Git 版本与输出 |
| 复制地址 | 原有 |

`POST /api/repos/git`（`GET /api/repos/git/presets` 取快捷命令）安全边界：

- 仓库名只能是工作区一级目录且必须含 `.git`；子命令白名单，**写操作只放开 `fetch` / `pull`**；
- 参数禁止 `; & | \` $ < >` 换行及 `--git-dir` / `--work-tree` / `-c` / `--exec` 等越权选项；
- 容器内有 Git 走 `gitRuntime.exec(['-C', ...])`，容器内无 Git 则借 SSH 宿主机执行 `git -C <hostPath> ...`（与克隆同一通道）；
- 输出中的带凭据 URL 自动脱敏，最多回传 20 KB。

### 37.4 实测（本机 + 10.0.0.246，2026-11-11）

| 验证项 | 结果 |
|---|---|
| IDE 凭据 | `/api/ide` → `configured=true`、脱敏 `4d3******22a`、key `CODE_SERVER_PASSWORD`；`POST /api/ide/password` 不带 `reveal` 返回空、带 `reveal` 返回 24 位明文；环境配置页可见该项（脱敏、敏感、运行时生效值一致） |
| 密码真实性 | 246 上 `.env` 的 `CODE_SERVER_PASSWORD` 与 `dp-code-server` 容器的 `PASSWORD` 逐字比对 **MATCH**，IDE 页复制的就是登录密码 |
| 运行主机 | `/api/host-info`：平台进程 `v0.3.10 · Alpine Linux v3.23 · node:20-alpine · Node v20.20.1`；宿主机 `Debian GNU/Linux 9.13 (stretch) · Linux 4.9.0-19-amd64 · 10.0.0.246 · Git 2.11.0 · 8 核 / 7986 MB / 16G（58%）/ 18 个容器`，`lsb_release -a` 原始输出可展开 |
| Git 运行时 | 运行平台 `linux/x64 · Alpine Linux v3.23 · 内核 4.9.0-19-amd64`；Git 宿主机 `Debian GNU/Linux 9.13 (stretch) · 内核 Linux 4.9.0-19-amd64 · debian` |
| Git 命令 | `POST /api/repos/git {repo:secure, command:status}` → 通道 `ssh-host`、exit 0、输出 `## master...origin/master`；`command:rm` 返回 400 白名单拒绝；7 个快捷命令（含 fetch / pull 两项写操作） |
| 安全校验（本机单测） | `rm` / `; echo pwned` / `--git-dir=/etc` / `-c` 全部 400；合法 `status` 走 local 通道 |
| 回归 | 本机巡检 0 个 500；246 `--full` **151 项**（跳过 28 个副作用路由）0 个 500、0 超时（2 个 502 为外部服务不可达）；扩展体检 2 / 2 正常；启动体检 8 正常 / 0 提醒 / 0 异常 |
| 自检 | `npm run check`、前端自检 63 项、四套冒烟 40 / 31 / 29 / 60 全部通过 |

---

## 38. v0.3.11 · 文件浏览体验、编辑器与页面整理

### 38.1 两处布局问题

| 现象 | 根因 | 修复 |
|---|---|---|
| Git 仓库文件管理里，路径条与工具栏之间被撑出一大块空白 | `.pathbar-slot { flex:1 1 auto }` 是为「存储 / 文件」页的横向 `.row` 设计的，但远程文件标签的父容器 `.ws-body` 是纵向 flex，于是它在**垂直方向**吃掉了所有剩余高度 | `.ws-body > .pathbar-slot { flex:0 0 auto; width:100% }`，横向容器里的路径条仍保持自适应 |
| Docker 容器列表「操作」列的 7 个按钮竖排、整列被挤窄 | 通用 `.actions { display:flex }` 把 `<td class="actions">` 变成了 flex 项，不再是表格单元格；叠加 `.dk-ops { flex-direction:column }` 后宽度塌成内容宽 | `td.actions { display:table-cell }` 恢复表格布局，`.dk-ops` 改为横向 wrap 的两组紧凑按钮 |

### 38.2 文件浏览：排序 + 目录 / 文件区分

「存储 / 文件」与「Git 仓库 / 服务器」打开的远程 SFTP 文件标签共用一套前端逻辑：

- 表头「名称 / 大小 / 类型 / 修改时间」可点击排序，再点一次切升 / 降序（每个文件标签独立记住排序）；
- **文件夹永远排在文件前面**，并插入「📁 文件夹 · N 项」「📄 文件 · N 项」分组行；
- 目录使用黄色文件夹 SVG，文件按后缀生成彩色类型角标（远程文件沿用后端 `fileTypes` 的语言识别结果）；
- 目录行保持双击进入（宝塔式），不新增「进入」按钮。

### 38.3 文件编辑与 Compose 富编辑器

| 模块 | 改动 |
|---|---|
| 后端 | 新增 `GET /api/openlist/files/content`（≤2 MB、编码 / 换行 / BOM / 语法识别，二进制与图片禁止编辑）与 `PUT`（按所选编码还原后覆盖上传）；复用 `fileTypes` 与远程 SFTP 编辑器同一套逻辑 |
| 存储 / 文件 | 文件行新增「编辑」按钮，弹窗式 CodeMirror：语法高亮、编码、换行符、BOM、查找、重载、保存（Ctrl+S），保存后自动刷新列表 |
| 容器编排 | YAML 输入改为 CodeMirror（行号 / YAML 高亮 / 折叠 / 自动缩进 / 查找），编辑器高度可选 360 / 480 / 640 px 且可拖拽，新增「整理格式」（Tab 转空格、去行尾空白、合并连续空行、统一 LF，不改写 YAML 语义），保留原有基础检查 |

`PUT /api/openlist/files/content` 属于真实写操作，已加入 API 巡检副作用跳过清单。

### 38.4 服务器编辑、DbGate 登录账号、IDE 拆页

| 需求 | 实现 |
|---|---|
| 服务器要支持编辑修改 | 卡片新增「编辑」，复用「添加 / 编辑服务器」表单回填；凭据字段显示 `******` 表示沿用原值（后端 `keepSecret` 已支持），保存后回到列表并提供「取消编辑」 |
| DbGate 安装只有密码、登录却要账号 | 清单 `LOGIN` 由硬编码 `admin` 改为 `${USER}`，安装表单新增「登录账号」（默认 admin，写入容器 `LOGIN`）；旧实例没有 `user` 时由 `manifest.defaults.USER` 兜底，重建不会产生空账号；实例列表显示账号，并提供「登录凭据」弹窗（`GET /api/extensions/instances/:id/credentials`，明文只在主动点击时返回） |
| 在线 IDE 上下堆在一起 | 拆成「IDE 工作台」（选目录 / 打开 / 内嵌预览）与「IDE 配置 / 凭据」（服务地址、工作区映射、密码管理）两个独立页面，各有侧栏入口与子导航 |
| 项目目录要能浏览选择 | 新增 `GET /api/ide/dirs?path=`：只列工作区内的下一级目录，路径经 `safeWorkspacePath` 校验；弹窗支持面包屑、上一级、进入子目录、「选择此目录」与「选择当前目录」，也可继续手填 |

### 38.5 实测（本机 + 10.0.0.246，2026-11-11）

| 验证项 | 结果 |
|---|---|
| 版本与静态资源 | 本机 / 246 `/api/health` 均为 `0.3.11`；246 `index.html` 静态版本 `?v=20261111f`（需 Ctrl+F5 刷新缓存） |
| 目录选择器 | `GET /api/ide/dirs?path=/` → `secure`、`smoke-test` 两个目录；`?path=/secure` → 7 个子目录；`?path=/../` 返回 400「路径越界」 |
| IDE 凭据 | 246 `/api/ide` → `CODE_SERVER_PASSWORD` 已配置；「IDE 配置」页可显示 / 复制 |
| DbGate 账号 | 安装表单 6 个字段含 `USER:登录账号`（默认 admin）；246 现有实例 `loginUser=admin`，`/credentials` 返回 `login=admin` + 24 位密码；非 Web 管理端实例调用该接口返回 400（不再是 500） |
| OpenList 文件编辑 | 读取 `/workspace/secure/cmd.php` → `PHP / utf-8 / LF / 148 B`；临时文件「上传 → GET → PUT（CRLF + BOM）→ GET」内容一致，原始字节以 `EF BB BF` 开头且换行为 `0D 0A`，随后删除，无残留 |
| 扩展体检 | 246 `2 / 2` 健康；DbGate `10.0.0.246:3003` 仍在线 |
| 接口巡检 | 本机 `--full --skip-probe` 152 项、246 `--full` **154 项**（29 个副作用路由跳过）：均 **0 个 500、0 超时**；246 唯一 502 是 OpenList 虚拟根目录未挂存储（预期） |
| 端到端 | `scripts/verify.js` 全通过：静态资源、SFTP 读写 / 二进制 / 下载 / 删除保护、编辑器 9 种语言与 GBK / CRLF 回写、SSH 终端、**容器化构建 + 测试 `status=success exit=0`** |
| 自检 | `npm run check`、前端自检 **70 项**、四套冒烟 40 / 31 / 29 / 60 全部通过 |

> 说明：本机 Windows 的 OpenList 未挂载实际存储，因此写入回环测试在 246 完成；本机只验证接口分类与降级行为。

### 38.6 顺带修复：带 tag 的官方镜像被跳过加速前缀

端到端回归 `scripts/verify.js` 在 246 发现「容器化构建 + 测试」失败：`Docker API POST /containers/create → 404 No such image: node:22-bookworm`。根因是 `core.resolveImage()` 用 `raw.split('/')[0].includes(':')` 判断「镜像自带 registry 域名」，把 `node:22-bookworm` 的 **tag 冒号**误当成 registry 端口，于是整个镜像被原样保留、加速前缀未生效，而 246 上只有 `docker.m.daocloud.io/library/node:22-bookworm`。

现在只在「第一个 `/` 之前确实存在域名段」时才跳过拼接：

| 输入 | 前缀 | 结果 |
|---|---|---|
| `node:22-bookworm` | `docker.m.daocloud.io/library/` | `docker.m.daocloud.io/library/node:22-bookworm` |
| `dbgate/dbgate` | `docker.m.daocloud.io/library/` | `docker.m.daocloud.io/dbgate/dbgate` |
| `ghcr.io/a/b` | `docker.m.daocloud.io/` | `ghcr.io/a/b`（第三方仓库不加速） |

修复后 246 的 `smoke` 构建恢复成功（`dist/smoke.txt`），前端自检新增该项断言。

**发布**：`main=31edc1c`，annotated tag `v0.3.11`，CI success，Release 2026-11-11T14:25:48Z 发布，6 个资产齐全（`devplatform.exe` 90,089,984 B、`SHA256SUMS.txt` 445 B），draft / prerelease 均为 false。

---

## 39. v0.3.12 · 全接口审计与错误分类修复

### 39.1 审计方法

`api-sweep.js` 只回答「所有接口有没有 500」，且主动跳过 29 个有副作用的路由；常规巡检用安全参数也打不到真实操作时的校验分支。本版新增 `scripts/api-audit.js`：

| 维度 | 覆盖 |
|---|---|
| 全路由 | 从 `server.js` 自动提取 168 条路由，GET 用真实 id、写用不存在的 id |
| 副作用接口 | 巡检 SKIP 的接口里，20 个用「缺参 / 不存在 id」安全触发校验；10 个「调用即改状态」的接口只登记、绝不发请求 |
| 边界 | 路径穿越、编码穿越、Git 命令 / 参数注入、超长路径、畸形 JSON、非 JSON / 数组 / 数字 body、>2 MB 超大 body |
| 脱敏 | 主动 reveal 取到明文后扫描所有只读接口响应，确认列表页不夹带密码 |
| 并发 | `/api/overview`、`/api/host-info`、`/api/health`、`/api/docker/overview` 各 20 并发 |

单轮 284 次请求，全部是只读 / 不存在的 id / 缺参，不会误改数据；发现问题退出码为 1。

### 39.2 发现并修复的 5 类缺陷

| # | 现象（修复前） | 根因 | 修复 |
|---|---|---|---|
| 1 | 畸形 JSON 请求体返回 **502** | `inferStatus` 的 `不是合法 JSON` 正则把 mini.js 的「请求体**不是合法 JSON**」当成上游返回非 JSON | `readBody` 给解析错误显式 `status=400`；正则改为只精确匹配「AI 服务返回内容不是合法 JSON」 |
| 2 | >2 MB 请求体客户端直接 `fetch failed`，**收不到任何 HTTP 响应** | `readBody` 超限后 `req.destroy()` 把 socket 重置了 | 继续把请求流 drain 完再 reject，返回 **413** |
| 3 | 未设 `ADMIN_TOKEN` 时 `/api/servers/:id/exec` 拒绝写命令返回 **500** | 普通 `Error` 没被短语表命中 | 归入 **403**，同类「未授权写操作 / 命令不在只读白名单内」一并修复 |
| 4 | `POST /api/docker/images/load` 传空 / 2 字节内容会真的把 `{}` 当 tar 送给 Docker，失败返回 **500** | raw 路由只校验 buffer 非空 | handler 增加 `<1024` 字节校验 → **400**；`docker load 失败` 归入 **502** |
| 5 | 静态扫描 234 处 `throw new Error(...)`，**132 处**业务校验 / 上游失败会被误判成 500 | `inferStatus` 只认早期的一批短语，后来新增模块的校验消息都没覆盖 | 增加 403 / 409 / 502 / 400 四层业务语义兜底；完全陌生的异常（如 `Unexpected token in JSON`）仍保持 **500** |

> 第 5 项是这轮最主要的系统性隐患：平时巡检全绿，但用户填错一个字段、选错一个文件、上游返回一次失败，页面上就会看到「服务端异常 500」。

### 39.3 非代码问题：246 未配置 `ADMIN_TOKEN`

审计顺带确认远端 `.env` 里 `ADMIN_TOKEN` 为空，意味着当前 **所有 API 无鉴权**（仅建议内网隔离环境使用），并且 `/api/servers/:id/exec` 只能执行只读白名单命令。这属于部署配置，不是代码缺陷；如需启用，在「环境配置」页写 `ADMIN_TOKEN` 并重启，前端 / EventSource / 下载链接需带 `Bearer` 或 `?token=`。**本版未擅自改动该配置。**

> 补充（§40）：v0.3.13 起在 `.env.example`、各安装模板与控制台「环境配置」页补齐了 `ADMIN_TOKEN` 的作用、留空影响与启用步骤说明，并在未启用时于「配置建议」置顶提醒；246 的 `.env` 仍保持原样，是否启用由使用者决定。

静态资源穿越也做了 6 种 payload 验证：`/..%2f.env` 返回 403，其余返回的是 SPA fallback 的 `index.html`，均未读到 `.env` 内容。前端 117 条 `api()` 路径全部有对应后端路由（3 条启发式误报已核实是模板字符串动态拼接）。

### 39.4 回归实测

| 项目 | 结果 |
|---|---|
| 深度审计（修复前 → 后） | 246：284 次请求、**6 项问题 / 3 个 500 / 1 次连接重置** → **0 问题 / 0 个 500 / 0 网络异常**；本机同样 0 问题 |
| `api-sweep --full` | 246 154 项、本机 152 项：均 0 个 500、0 超时、0 降级异常、0 错误体缺 status |
| `verify.js`（246） | 全通过：SFTP 读写 / 编码回写 / SSH 终端 SSE / 容器化构建 success(exit=0) / 集成服务在线 |
| 静态错误分类 | 234 处普通 Error：修复前 132 处 → 修复后 **0 处**会被判 500 |
| 其它 | `npm run check`、前端自检 70 项、四套冒烟 52 / 31 / 29 / 60 全通过；扩展体检 8 正常 / 0 提醒 / 0 异常 |

本机与 246 均为 `0.3.12`；本版未改前端静态资源，缓存版本号仍为 `?v=20261111f`。

**发布**：`main=71f0a0d`，annotated tag `v0.3.12`，CI success，Release 2026-11-12T08:09:59Z 发布，6 个资产齐全（`devplatform.exe` 90,092,032 B、`SHA256SUMS.txt` 445 B），draft / prerelease 均为 false。

---

## 40. `ADMIN_TOKEN` 配置说明补全（2026-11-12）

§39 的全接口审计确认 246 的 `.env` 里 `ADMIN_TOKEN` 为空（所有 API 无鉴权），但原说明只有一句「留空不做鉴权（仅限本机）」，看不出影响面，也没讲启用后前端要做什么配合。本次只补说明与状态展示：**鉴权逻辑未改、版本号保持 `0.3.12`、没有替任何部署写入令牌**；前端静态缓存版本升到 `?v=20261112a`。完整概念见 §5.1–§5.3。

### 40.1 说明写到了哪里

| 位置 | 新增内容 |
|---|---|
| `.env.example` | `ADMIN_TOKEN` 上方逐行注释：作用 / 令牌传递方式 / 留空影响 / 5 步启用流程 / 局限与注意 |
| 各安装模板 | `platform/build.mjs`、`platform/launcher/launcher.js`、`scripts/sync-integrations.js`（2 处）、`windows/install.ps1`（2 处）、`windows/native-services.ps1` 生成的 `.env` 都带同一段简版说明 |
| `platform/src/envConfig.js` | `desc` 扩写 + 5 条 `detail` 行内详细说明；`read()` 新增 `security.authEnabled`（只回布尔值，不回令牌）；未启用时 `advice` 置顶 `AUTH_DISABLED`；`validateValue` 拒绝把占位符 / 含空格的值写成令牌 |
| 前端「环境配置」页 | 新增「ADMIN_TOKEN 鉴权说明」卡片（作用 / 留空影响 / 启用步骤 / 局限）、运行时状态徽标、行内「详细说明」折叠区、「生成随机令牌并填入」按钮；鉴权建议卡片把「填入表单」换成「生成随机令牌」，避免把说明文字当成令牌写进 .env |
| README | §4.1 表格指引、§5.1 作用、§5.2 留空影响、§5.3 启用步骤与注意、§39.3 补充指引 |
| `scripts/check-frontend.js` | 新增 2 项静态检查（前端卡片链路 / 后端状态与防呆），自检 70 → 72 项 |

### 40.2 行为边界

- 未启用时 API 行为与之前完全一致；启用后仍由 `mini.js` 统一校验 `Bearer` / `?token=`，`/api/health` 例外。
- 新增的 `security` 只暴露布尔值，`/api/env-config` 里的令牌值仍一律脱敏。
- `.env` 写入仍需二次确认、自动备份与 600 权限；`envConfig.write()` 不热更新 `config.adminToken`，因此卡片明确写「必须完全重启」，`reload` 不算。
- 246 的 `.env` 未改动；是否启用鉴权由使用者按 §5.3 自行决定。

### 40.3 验证

| 项目 | 结果 |
|---|---|
| `node scripts/check-frontend.js` | **72 项全通过**（含新增 2 项），app.js 顶层与 boot 无异常 |
| `npm run check` + 5 个改动 JS 的 `node --check` | 全部通过 |
| `smoke-environment.js` / `smoke-api-status.js` | 29 项 / 52 项全通过 |
| `envConfig.read()` 结构实测 | `security.authEnabled=false`、`advice` 首项 `AUTH_DISABLED`、`detail` 5 条 |
| 鉴权行为实测（`mini.js`） | 令牌为空：无 token → **200**；令牌为 `s3cr3t`：无 token → **401**、`Bearer` → **200**、`?token=` → **200**、`/api/health` 不受 401 拦截 |

> 本版只提交源码与文档：未重新构建 `devplatform.exe`、未打 tag、未部署 246。需要发布 / 部署时再执行 `npm run build` 与 `scripts/remote.js deploy`。

---

## 41. 账号体系与资源协作（v0.4.0 功能）

需求：默认初始管理账号；未登录不能调用任何操作接口；各账号添加的数据仅自己可查看 / 操作，管理员可查看 / 操作全部；数据可指定协作人，按 Gitea 仓库协作者语义授权。

### 41.1 设计

| 层 | 实现 |
|---|---|
| 账号 | `state.json.users[]`：`id / username / displayName / passwordHash(scrypt+salt) / role(admin\|user) / status / mustChangePassword`。首次启动无账号时自动建 `admin`，随机初始密码写 `data/initial-admin.txt`（600）并在启动日志打印一次，首次登录强制改密 |
| 会话 | `state.json.sessions[]`；Cookie `dp_session` 只放随机 token 的 sha256 索引，HttpOnly + SameSite=Lax（HTTPS 自动加 Secure），7 天过期。改密 / 重置 / 禁用会吊销该账号全部会话；登录失败 5 次锁 60 秒 |
| 拦截 | `mini.js` 分发层统一解析身份：`/api/health`、`/api/auth/login`、`/api/auth/status` 公开，其余未登录一律 **401**。`DP_AUTH_MODE=off\|optional\|required`（默认 `required`）可一键回退 |
| 兼容 | `ADMIN_TOKEN` 的 `Bearer` / `?token=` 仍等价管理员，巡检脚本、SSE、下载链接与应急排障不受影响；本机 CLI 用回环 + `x-dp-cli: 1` 头调用「重置密码 / 重载」两个白名单路径 |
| 归属 | 用户创建的集合（`servers / gitSources / aiProviders / builds / deploys / extensions / composeTemplates / backups / openlistConnections`）新增 `ownerId` + `collaborators`。`core.update()` 借 `AsyncLocalStorage` 请求上下文，给本次新增对象自动补 ownerId，**168 条原路由无需逐个改** |
| 过滤 | `mini.js` 包装 `res.json`，普通用户响应里的 `items` 数组按 id 反查归属自动过滤；`permissions.guard()` 在 body / params 解析后校验带 id 的单条与派生资源操作，越权 **403** |

### 41.2 权限矩阵

| 动作 | 管理员 | owner | 协作者 read | 协作者 write | 无关账号 |
|---|---|---|---|---|---|
| 查看资源列表 / 详情 | ✔ 全部 | ✔ 自己的 + 被协作的 | ✔ 被协作的 | ✔ 被协作的 | ✖ |
| 修改资源 | ✔ | ✔ | ✖ 403 | ✔ | ✖ |
| 删除资源 | ✔ | ✔ | ✖ 403 | ✖ 403 | ✖ |
| 管理协作者 | ✔ | ✔ | ✖ 403 | ✖ 403 | ✖ |
| 全局配置（.env / 系统更新 / 代理 / 环境适配 / Git 运行时） | 可改 | 只读 | 只读 | 只读 | 只读 |
| 账号管理 | ✔ | ✖ | ✖ | ✖ | ✖ |

派生资源继承父资源：`/api/servers/:id/*`（SSH 文件、Web 终端、状态）、Docker 容器 / 镜像（按 `serverId`）、OpenList 文件（按 `connectionId`）、Git 仓库文件（按 `sourceId`）都会先校验父资源权限。

### 41.3 界面

- 未登录：全屏登录遮罩，工作台不初始化；`api()` 收到 401 自动回到登录页。
- 首次登录 / 侧栏「修改密码」：改密表单；改密后旧会话失效，需重新登录。
- 侧栏底部：当前账号、角色、修改密码、登出。
- **账号管理**（仅管理员）：新增账号、切角色、禁用 / 启用、重置密码。禁用是软删除，避免资源 `ownerId` 悬空。
- **资源协作**：列出当前账号可见的所有资源与我的权限；点「协作者」在弹窗里按账号设置 `read` / `write`，参照 Gitea 仓库协作者。

### 41.4 命令行重置密码

| 命令 | 场景 |
|---|---|
| `node scripts/reset-admin-password.js` | 本机；平台在线自动走 CLI 通道不停机重置，离线直接改 `state.json` |
| `node scripts/reset-admin-password.js alice -p '新密码'` | 指定账号与新密码 |
| `devplatform.exe reset-admin [账号]` | 单文件版在线重置（launcher 走本机 CLI 通道） |
| `--offline` | 强制离线改 `state.json`，需先停平台 |
| `--api http://10.0.0.246:9000 --token <ADMIN_TOKEN>` | 远端实例 |

重置成功后返回新密码并吊销该账号所有会话；初始密码文件 `data/initial-admin.txt` 应在首次改密后删除。

### 41.5 迁移与边界

- 升级时 `auth.initialize()` 建初始管理员，把历史资源（无 `ownerId`）整体归到该管理员，不丢数据；`state.json` 仍 600 权限。
- 不允许降级 / 禁用「最后一个管理员」，也不允许禁用自己。
- **隔离粒度只到平台登记的资源对象**：某账号被授权操作一台服务器后，能看到该主机上的全部容器与文件；外部系统（SSH / Docker / OpenList / Git）内部的多租户隔离需靠它们自己的账号体系。
- 部署到已有实例（如 246）后，所有浏览器与脚本立刻需要登录 / 令牌：建议先给 `.env` 配 `ADMIN_TOKEN` 供脚本使用，再从 `data/initial-admin.txt` 取初始密码登录并改密；忘记密码用上面的命令行重置。
- `DP_AUTH_MODE=off` 是完全不鉴权的应急状态，排障后应立即改回 `required`；`?token=` 会进 URL 与访问日志，公网请配 HTTPS。
- 账号体系没有 SSO / 多租户审计日志，需要这些能力请前置网关。

### 41.6 验证

| 项目 | 结果 |
|---|---|
| `scripts/smoke-auth.js` | **33 项全通过**：401 拦截、登录 / 改密、账号管理、owner 隔离、协作者 read/write、管理员全权、全局配置只读、令牌通道、CLI 重置、off 回退 |
| `scripts/check-frontend.js` | **75 项全通过**（新增 3 项账号体系检查） |
| 旧冒烟 | 四套脚本显式 `DP_AUTH_MODE=off`：52 / 29 / 31 / 60 项保持通过 |
| `api-sweep --full`（临时实例） | 180 条路由、166 项已测：**0 个 500、0 超时、0 降级异常、0 错误体缺 status** |
| `api-audit`（临时实例） | 180 条路由、296 次请求：**0 个 500、0 网络异常、0 问题** |
| `npm run check` | 含新增 `auth.js` / `permissions.js` / `smoke-auth.js` / `reset-admin-password.js`，全部通过 |

> 本次只提交源码与文档：**`package.json` 版本号仍为 `0.3.12`（发版时统一 bump 到 `0.4.0`）、未重新构建 exe、未打 tag、未部署 246**。发版与部署（尤其 246 会立刻要求登录）需单独确认。
