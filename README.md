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
| 2 | 四种运行方式如何选 |
| 3 | 快速开始（本机 / compose / 远程部署） |
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
| 18 | Windows 一键安装（含三个集成服务）、服务管理与排错 |

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

## 2. 四种运行方式如何选

| 方式 | 适用场景 | 优点 | 限制 |
|---|---|---|---|
| A. 宿主机直接跑 `node platform/src/server.js` | 本机开发、要用宿主机/WSL 里的 codex、claude | 能调用本机 CLI 与 WSL；改代码即时生效 | 需要 Node ≥ 20；集成服务要另行启动 |
| B. `docker compose --profile full up -d` | 一台机器上完整拉起全部组件 | 一条命令、组件网络互通 | 镜像需可拉取；容器内**无法**使用 WSL / 宿主机 CLI |
| C. `scripts/remote.js deploy <host>` | 部署到远程服务器（当前线上采用） | 自动选运行时（宿主机 Node ≥ 20 用 systemd，否则复用已有 node 镜像跑容器）；不依赖 Docker Hub | 需要先在本机 `data/state.json` 登记目标机凭据 |
| **D. 单文件程序 `platform/dist/devplatform.exe`** | **本机 / 内网机器免装 Node 直接运行** | 双击即跑；业务与前端可在线热更，支持回滚；详见 [§17](#17-单文件可执行程序与热更新) | 需要先用 Node 构建一次；exe 壳本身升级需手动替换 |

**当前线上是方式 C + 三个配套组件用 compose 单独启动**：`devplatform` 容器占用 9000，compose 的 `platform` 服务带 `profiles: ["full"]`，默认不启动，避免抢端口。方式 D 只影响本机运行，不改变线上部署方式。

---

## 3. 快速开始

> **Windows 用户推荐直接看第 18 章**：准备好 `platform/dist/devplatform.exe` 后双击 `windows\install.bat`，即可一键装好平台与 Gitea / OpenList / code-server 三个集成服务、初始化凭据并配置开机自启。下面 3.2–3.4 是各运行方式的手动步骤，用于理解原理或排错。

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
   - 自动打包（排除 `data/`、`.env`、`state.json`、`node_modules/`、`workspace/`、`.workbuddy/`）→ SFTP 上传 → 解压 → 选择运行时 → 启动容器/服务 → 健康检查 → 幂等登记远端服务器。
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

## 7. 八个功能模块

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
| `powershell -File windows\install.ps1 -Mode local\|remote -DryRun` | 指定模式安装 / 预演不改动系统 |
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
| OpenList | `GET /storage`、`POST /storage/mkdir`、`POST /storage/remove`、`PUT /storage/upload`、`GET /storage/mounts` |
| 构建 | `GET /profiles`、`GET/POST /builds`、`GET /builds/:id`、`GET /builds/:id/log`、`POST /deploy`、`GET /deploys` |
| 服务器 | `GET/POST /servers`、`DELETE /servers/:id`、`POST /servers/:id/test`、`GET /servers/:id/status`、`POST /servers/:id/exec` |
| 远程文件 | `GET /servers/:id/files`、`GET/PUT /servers/:id/files/content`、`GET .../files/download`、`PUT .../files/upload`、`POST .../files/create\|mkdir\|rename\|delete` |
| Web 终端 | `POST .../terminal/open`、`GET .../terminal/stream`（SSE）、`POST .../terminal/input\|resize\|close`、`GET .../terminals` |
| AI | `GET/POST /ai/providers`、`DELETE /ai/providers/:id`、`GET /ai/local/programs`、`POST /ai/local/test`、`POST /ai/test`、`POST /ai/chat`、`POST /ai/ops`、`GET /ai/tools` |

需要鉴权时，SSE 与下载链接用 `?token=<ADMIN_TOKEN>`，其余用 `Authorization: Bearer <ADMIN_TOKEN>`。

---

## 14. 安全须知

1. `data/state.json` 含**明文 SSH 口令与私钥**，保存时自动 `chmod 600`，数据目录 `700`；接口只回传「是否有凭据」标记，不回传明文。`.env` 同样是 600。
2. `.gitignore` 已排除 `.env*`（保留 `.env.example`）、`data/`、`node_modules/`、`workspace/`、私钥/证书、日志、打包产物。**提交前请确认没有把真实凭据加入版本控制。**
3. 对外暴露必须设置 `ADMIN_TOKEN`；控制台令牌存在浏览器 `localStorage`。
4. 挂载 `/var/run/docker.sock` 等价于把宿主机 root 能力交给容器，仅限可信内网。
5. SFTP 路径做 `..` 穿越与系统目录删除保护；构建命令使用内置白名单；编辑器对有损编码拒绝保存。
6. `.env.example` 与 `verify.js` 内含测试机内网地址和示例口令，如要推送到公共远程仓库，先替换为占位符。

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
├── .gitignore              # 排除凭据 / 依赖 / 运行时数据
├── README.md               # 本文
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
├── scripts/                # remote.js、setup-integrations.sh、verify.js、
│                           # check-frontend.js、sync-integrations.js（本机配置同步）
├── windows/                # Windows 一键安装：install.bat / install.ps1 /
│                           # start.bat / stop.bat / uninstall.ps1（§18）
├── data/                   # 运行时状态（不入库，600/700）
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
  "version": "0.2.1",
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

本章面向「拿到项目后在 Windows 上直接部署使用」。平台本体是免 Node 的 `devplatform.exe`，但 **Gitea / OpenList / code-server 是三个独立服务，不会打进 exe**，所以安装器把它们一起装好、初始化好凭据、写好配置，并配置开机自启。

### 18.1 两种安装模式

| 模式 | 集成服务在哪 | 前置条件 | 适用 |
|---|---|---|---|
| `local`（本机完整安装） | 本机 Docker Desktop 里跑三个 Linux 容器 | Docker Desktop（WSL2 后端）、能拉镜像 | 想完全本地、离线也能用三个服务 |
| `remote`（复用已部署服务器） | 已部署服务器上的 3002 / 5244 / 8080 | 该服务器已按第 3 章部署并初始化；本机需有 Node 与 `data/state.json` | 已有测试/生产服务器，本机只想开控制台 |
| `auto`（默认） | 自动选择 | — | 检测到可用 Docker → `local`；否则若有 Node 且已登记服务器 → `remote`；都没有 → 提示安装 Docker |

> **为什么本机模式需要 Docker Desktop**：code-server 官方只提供 Linux 版本，Windows 下没有原生可跑的等价物；Gitea / OpenList 虽有 Windows 二进制，但用同一套 compose 编排能保证三个服务与线上环境完全一致。Docker Desktop 用 Linux 容器即可，不需要在 Windows 上装 Node、Python 或 WSL 里的发行版（WSL2 只是 Docker 的后端）。

安装器**只启动 compose 里的 `gitea / openlist / code-server`**；`platform` 服务带 `profiles: ["full"]` 不会启动，9000 端口由 exe 占用，不会冲突。

### 18.2 前置要求

| 项 | 要求 | 检查方式 |
|---|---|---|
| 系统 | Windows 10 1809+ / Windows 11，PowerShell 5.1+ | `$PSVersionTable.PSVersion` |
| 平台程序 | `platform/dist/devplatform.exe` 已存在 | 没有则先在有 Node 的机器执行 `cd platform; npm run build`，或拷贝构建好的整个 `dist/` |
| 端口 | 9000 / 3002 / 5244 / 8080 未被占用（Gitea SSH 222、OpenList 5245 也需空闲） | `netstat -ano \| findstr ":9000 :3002 :5244 :8080"` |
| `local` 模式 | Docker Desktop 已安装并**正在运行**（托盘图标为 Running） | `docker info` |
| `remote` 模式 | 本机有 Node、`data/state.json` 已登记服务器、服务器 `/data/platform/.env` 已有 Token | `node -v`、`node scripts/sync-integrations.js --probe` |
| 权限 | 注册计划任务不强制管理员；失败会自动降级为「启动」文件夹快捷方式 | 安装器输出会说明 |

> 安装器不会自动安装 Docker Desktop（这通常需要重启 / 重新登录）；需要时用 `-InstallDocker` 显式触发 winget，装完重启后再跑一次脚本。

### 18.3 一键安装

**最简单**：双击 `windows\install.bat`，等它跑完，浏览器会自动打开 `http://localhost:9000`。

等价命令行（可加参数）：

```powershell
cd devplatform

# 完整本机安装（三个集成服务都跑在本机）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode local

# 复用已部署服务器
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246

# 先看会做什么、不改动任何东西
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun

# 尝试自动安装 Docker Desktop（winget 可用时）
powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -InstallDocker
```

`.bat` 入口会绕过执行策略并显示结果；带参数运行时不会在结尾等待按键。`.ps1` 文件是 UTF-8 BOM，PowerShell 5.1 中文提示不会乱码。

### 18.4 安装器做了什么

| 步骤 | `local` 模式 | `remote` 模式 |
|---|---|---|
| 1 | 校验 `devplatform.exe` 存在 | 同左 |
| 2 | 生成根 `.env`：随机 Gitea/OpenList 管理员密码、code-server 密码、镜像加速器前缀；**已存在则原样保留** | 调用 `scripts/sync-integrations.js` 从服务器读取地址与 Token |
| 3 | `docker compose up -d gitea openlist code-server` | — |
| 4 | 轮询 `3002/api/v1/version`、`5244/api/public/settings`、`8080/healthz` 直到就绪 | `sync-integrations.js --probe` 预检三个端点 |
| 5 | 创建 Gitea 管理员、生成 Access Token；设置 OpenList 管理员密码并取 Admin Token；写回根 `.env` | — |
| 6 | 生成 `platform/dist/.env`：`PORT`、三个 URL、两个 Token、`OPENLIST_USER`、`NO_PROXY` | 由同步脚本生成 `platform/dist/.env` |
| 7 | 生成 `platform/dist/autostart.vbs`（无窗口启动） | 同左 |
| 8 | 注册登录计划任务 `DevPlatform`；失败降级为启动文件夹快捷方式 | 同左 |
| 9 | 后台启动 exe、健康检查、打开浏览器 | 同左 |

所有凭据只落在本机 `.env`（根目录与 `dist/`），不打印到日志、不进 Git。安装器用 PowerShell 原生实现（HTTP、docker、计划任务、随机密码），**不依赖 Node / bash / curl**；只有 `remote` 模式复用 `sync-integrations.js` 的 SSH 逻辑才需要 Node。

### 18.5 参数表

| 参数 | 默认 | 说明 |
|---|---|---|
| `-Mode` | `auto` | `auto` / `local` / `remote` |
| `-RemoteHost` | 空 | remote 模式指定服务器 IP；留空取 `data/state.json` 第一台 |
| `-InstallDocker` | 关 | 无 Docker 时尝试 `winget install Docker.DockerDesktop`，之后需重启 |
| `-NoService` | 关 | 跳过开机自启注册 |
| `-NoLaunch` | 关 | 只装配置、不启动 exe、不开浏览器 |
| `-DryRun` | 关 | 只打印计划，不写文件、不启容器、不注册任务 |
| `-Port` | 9000 | 平台监听端口，写入 `dist/.env` 与浏览器地址 |
| `-ImagePrefix` | `docker.m.daocloud.io` | 镜像加速器前缀；能直连 Docker Hub 时用 `-ImagePrefix ''` |

### 18.6 服务管理

| 操作 | 命令 |
|---|---|
| 启动平台 | 双击 `windows\start.bat`（最小化窗口） |
| 停止平台 | 双击 `windows\stop.bat`（结束所有 `devplatform.exe`） |
| 开机自启 | 登录后由计划任务 `DevPlatform` 无窗口拉起；非管理员时是「启动」文件夹的 `DevPlatform.lnk` |
| 查看自启 | `Get-ScheduledTask -TaskName DevPlatform` |
| 关闭自启 | `Unregister-ScheduledTask -TaskName DevPlatform -Confirm:$false` |
| 卸载 | `powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1` |
| 连容器一起停 | 加 `-RemoveContainers`（`docker compose down`，**数据卷保留**） |
| 连配置一起删 | 加 `-RemoveConfig -Force`（删根 `.env`、`dist/.env`、`autostart.vbs`） |

卸载默认保留 `workspace/`、`data/`、`data/state.json` 与 Docker 卷，重装不会丢仓库和构建记录。

> **改 `.env` 后必须完全重启 exe**：`loadDotEnv()` 只在进程启动且环境变量未定义时注入，`devplatform.exe reload` 只重启业务进程、不重读配置（§17.8）。

### 18.7 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 提示「本机模式需要 Docker Desktop」 | 未安装或 Docker 没在运行 | 启动 Docker Desktop 等托盘变绿；或加 `-InstallDocker`；或改 `-Mode remote` |
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

### 18.9 安装后验证清单

```powershell
# 平台健康
curl http://localhost:9000/api/health
# 三项集成服务应全部 status=online
curl http://localhost:9000/api/overview
# 容器状态（local 模式）
docker compose ps
# 配置检查（不显示 Token）
node scripts/sync-integrations.js --check
node scripts/sync-integrations.js --probe
```

浏览器打开 `http://localhost:9000`，总览「集成服务」三项应为绿色「在线」；Gitea `http://localhost:3002`、OpenList `http://localhost:5244`、code-server `http://localhost:8080` 均可访问。Gitea/OpenList 管理员账号为 `admin`，密码在根 `.env` 的 `OPENLIST_PASSWORD`；code-server 密码在 `CODE_SERVER_PASSWORD`。

