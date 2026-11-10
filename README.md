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
| `ADMIN_TOKEN` | 空 | 对外暴露时**必须设置**；空则不鉴权 |
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
