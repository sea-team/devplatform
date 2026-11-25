<!-- BEGIN PENDING-RELEASE-NOTES: 待发版元信息，CI 生成 Release notes 时整块剥离，勿删此对标记 -->
【待发版 · v0.4.31 阶段】Git 工作台（TortoiseGit 式）—— 已完成实现与本地验证，尚未发版
  状态：仓库版本仍 `0.4.30`；未升版本号、未打 tag、未发 GitHub Release。
  代码已 push 到 origin/main（最新 e1f0f28）并部署 246 测试环境验证通过；正式发版（升版本 / tag / Release）待用户明确指令。
  1) 交互升级（README §70）：沿用仓库列表「Git 操作」按钮，弹窗内改为 10 分区多标签工作台
     —— 状态 / 提交日志 / 提交 / 分支·合并 / 同步 / Stash / 标签 / 冲突·还原 / 清理 / 自定义命令。
     参考本机 TortoiseGit 真实菜单术语（Commit / Pull / Push / Merge / Switch / Create Branch /
     Create Tag / Abort Merge / Stash / Clean up / Show log / Diff Two Commits）。
  2) 后端：新增 `platform/src/gitView.js`（11 个结构化只读视图 + 23 个语义动作）；
     `workspaceGit.js` 扩展命令白名单、新增 `classifyCommand()` 精确读写分类（混合命令按参数判定）、
     `presets()` 分组与 `groups()`；`server.js` 新增 `/repos/git/view`、`/repos/git/action`、`/repos/git/groups`，
     旧 `/repos/git` 保留兼容并改用精确分类做仓库级写权限收口。
  3) 前端：结构化状态表（逐文件暂存/取消/放弃）、可点选提交日志 + SVG 分支图 + 着色 diff、
     参数化分支 / 同步 / Stash / 标签 / 冲突 / 清理面板；破坏性动作统一二次确认；
     `check-frontend.js` 护栏累计 203 条，缓存戳 `20261124q → 20261124r → 20261125a → 20261125c → 20261125d`。
  3b) 复核修复（对照「分析未提交改动中的 bug 和不完善之处」逐条实测）：4 个 P1 功能 Bug
     （放弃改动无二次确认 / stash 预设缺 -m / quoted-path 未反转义 / view 忽略退出码）、
     6 项 P2 体验健壮性、文档数字与 release-notes 待发版段处理；详见 README §70.5。
  3c) 常用操作收敛（对标 TortoiseGit）：工作台只展示 6 个标签（状态/日志/提交/分支/同步/冲突还原），
     覆盖日志、分支、提交、推送、拉取(含 fetch)、中止合并、还原、重置 + 状态/暂存/差异/合并配套；
     Stash/标签/清理/自定义命令入口前端隐藏，远程地址表与「放弃改动」按钮移除。仅前端过滤
     （filterGitWorkbench 纯函数），后端 presets/视图/动作/测试全部保留不动，可回退。
  3d) 日志页 UI 调整（按用户本地 TortoiseGit 习惯）：去掉提交分支图；提交日志新增「分支」列
     （从 git decorations 提取，去 HEAD -> 前缀 / 排除 tag / 去重）；点击日志详情改走独立弹窗，
     字段用两列网格 + 带边框圆角只读文本框美化；去掉分区内局部滚动条，滚动改由弹窗统一承担。
     详见 README §70.6。
  3e) 显示修复：弹窗内工作台各分区默认被 flex 压缩到 min-height，超出的日志表 / 分支卡片溢出盖住「命令输出」区；
     给 `.git-wb-body > *` 加 `flex: 0 0 auto` 让内容自然撑开、滚动统一由弹窗承担；缓存戳 `20261125c → 20261125d`。详见 README §70.7。
  4) 验证：`scripts/smoke-git-workbench.js`（`npm run smoke:gitwb`，真实 server）35 项全过；
     新增 `scripts/smoke-git-workbench-frontend.js`（`npm run smoke:gitwb:fe`）23 项前端交互级
     行为测试全过（vm 跑真实函数体，覆盖 4 个 P1 + 收敛过滤 + 日志分支列提取，而非字符串护栏）；
     `npm run check` / `npm run typecheck`（75 ≤ 基线 78）/ `check-frontend.js` 全过；
     历史冒烟 smoke:git 31 / smoke:api 52 / smoke:security 49 / smoke:import 11 / smoke:hardening 12 全过。
<!-- END PENDING-RELEASE-NOTES -->

由 GitHub Actions 在 windows-latest 上构建，并把官方原版二进制内嵌进全量包。

【重要】START.bat 与 INSTALL.bat 不是一回事：
  START.bat   只启动控制台（服务器 / SSH / 终端 / 文件 / AI / 构建），
              不会安装、也不会自动启动 Gitea / OpenList / 在线 IDE；
              启动前会打印三项状态、本机服务是否已安装、以及是否自带二进制。
  INSTALL.bat 额外安装并启动三项集成服务（无 Docker 自动改用 Windows 原生 exe）。
              全量包已自带这三个程序，INSTALL.bat 全程离线，无需联网下载。

【本版新增 · 扩展能力】v0.3.0 在「扩展 / 数据库」之外新增四个模块（README §19-§25）：
  1) Git 源：登记 GitHub / 自建 Gitea / GitLab，仓库列表自动聚合；
     Token 只存本机且脱敏，clone 用临时 extraHeader，不写入 .git/config。
  2) Docker 管理：容器 / 镜像 / 卷 / 网络 / 编排模板 / 审计六分区；
     非平台容器默认只读，写操作需二次确认；支持离线镜像 tar 导入与导出。
  3) 扩展运维：SSH 远程安装、mysqldump/pg_dump/Redis RDB 备份恢复、
     版本升级（升级前强制备份、失败自动回滚）、一个实例绑定多个仓库。
  4) DbGate：GPL-3.0 开源多数据库 Web 客户端，连接随实例增删自动同步；
     编译环境改为 auto/ssh/docker/wsl/local 四级降级，Windows 无 Docker 时可走远程 Linux 构建。

  有 Docker -> 创建容器、自动生成密码与连接串、注入项目 .env、启停 / 日志 / 卸载。
  无 Docker -> 自动降级为「外部连接」，只登记已有数据库地址与凭据，不安装任何东西。
  只安装数据库容器才需要 Docker；平台本体与控制台功能依旧完全不需要 Docker。
  字段规范、自定义清单、凭据边界与容器部署变量见 README 第 19 章。

【本版新增 · v0.3.1】存储 / 文件与代理（README §26-§28）：
  1) OpenList 管理集成：连接配置、挂载存储增删改/启停、驱动清单与模板、
     站点设置、面包屑文件浏览、多选重命名/移动/复制/批量删除、直链、
     后端代理下载与多文件上传；并可一键打开 / 内嵌 OpenList 后台。
  2) 分层代理配置（第 12 个模块页）：
     单个仓库 > Git Host 匹配 > Git 分组 > 全局；
     单个容器 > Docker 代理 > 全局；
     单个服务器 > 服务器代理 > 全局；
     单个 AI 服务 > AI 服务代理 > 全局。
  3) 覆盖 Git API / git clone / Docker Engine / 容器 Env / 构建子进程 /
     SSH 与 Web 终端 / SFTP / AI API / 本地 AI CLI / OpenList 全部链路；
     支持 NO_PROXY、direct 强制直连、CONNECT 与 SOCKS5 隧道、解析预览与连通性测试。
  4) 代理凭据与 OpenList 凭据只存 state.json（600），所有接口输出一律脱敏。

【本版新增 · v0.3.2】页面拆分与凭据增强（README §29）：
  1) 25 个独立标签页：Git 仓库（列表 / 新建 / 克隆 / Git 源）、存储（文件 / 连接 /
     挂载 / 驱动）、构建部署（记录 / 启动 / 部署记录）、服务器（列表 / 添加）、
     Docker（总览 / 容器 / 镜像 / 存储卷 / 网络 / 编排）不再挤在单页；
     每页顶部有子导航条，点击即打开对应标签。
  2) 单项代理配置补齐填写指引：协议格式、示例、留空与 direct 语义、
     四条优先级链、NO_PROXY 与凭据脱敏说明。
  3) 外部 Git 源与「克隆到工作区」支持账号密码 / PAT；克隆可本次直填凭据，
     不保存、不写入 .git/config，失败日志自动脱敏。
  4) OpenList 支持多连接：本机与任意外部服务可同时登记、切换、编辑、删除；
     文件 / 挂载 / 驱动接口始终作用于当前连接，凭据互不混用。
  5) Docker 列表修复显示异常（按钮分组、状态筛选、统计卡、字段防御），
     六个分区按宝塔式信息架构拆为独立页。

【本版修复 · v0.3.3】克隆报 spawn git ENOENT（README §30）：
  1) 新增 Git 运行时探测：控制台配置 > GIT_BIN > PATH > 常见安装路径，
     ENOENT 一律转成带修复指引的中文提示；克隆页新增状态卡片与路径配置。
  2) 容器镜像不含 Git 时自动降级到已登记 SSH 宿主机执行克隆，
     依据 HOST_WORKSPACE_DIR 挂载映射写回工作区，仍是完整 .git 仓库。
  3) 远程部署选镜像时同时校验 Node 可启动与 Git 是否存在（老内核上部分
     glibc 镜像的 Node 会崩溃）；缺 Git 时优先走 SSH 宿主机兜底，
     需要容器内 Git 可用 DP_INSTALL_GIT=1 构建本地运行时镜像。
     部署阶段即校验并打印结论，不再等到点击克隆才暴露问题。
  4) 修复 git clone -c 把凭据写进 .git/config 的隐患：改用
     git -c ... clone，Token / 密码不再落到工作区任何文件。

【本版新增 · v0.3.4】环境适配中心（README §31）：
  1) 自动识别本机 / 完整容器 / 精简容器 / 远程部署并生成环境指纹；
     指纹变化即判定「环境已切换」，启动时自动重检 + 自动处置。
  2) 内置 5 套档案（auto / native / container / container-lite / remote）
     与自定义档案；四项策略可配置，优先级：DP_* > 控制台 > 档案 > 推导。
  3) 8 项自动体检（含 SSH 宿主机实测），自动把不可用的克隆通道 / 构建后端降级；
     只做安全动作，不改凭据、不重启容器、不删数据，动作全程留日志。
  4) 新增「环境适配」独立页与 /api/environment 系列接口；
     remote.js deploy 收尾自动跑体检并打印环境 / 档案 / 通道 / 处置结论。
  5) 克隆按策略调度，可显式禁用；/api/health 直接暴露环境档案与指纹。

【本版修复 · v0.3.5】全接口巡检与错误分类治理（README §32）：
  1) 统一 HTTP 错误模型：参数错误 400 / 对象不存在 404 /
     上游服务不可用 502，只有未预期的代码异常才是 500；
     错误响应统一带 status / code / hint，前端按类型显示可操作提示。
  2) 只读列表优雅降级：OpenList / Gitea 挂掉时返回 200 + 空数据 +
     degraded 诊断，页面不再整片报错；写操作仍明确返回 502，不静默成功。
  3) 新增 scripts/api-sweep.js 全接口巡检：自动提取 156 条路由、
     写接口只用不存在的 id、断言 500 为 0，支持 --full / --json / --skip-probe。
  4) 新增 scripts/smoke-api-status.js 33 项专项冒烟；
     check-frontend.js 补降级提示与错误分类断言。

【本版新增 · v0.3.6】交互打磨与镜像源治理（README §33）：
  1) 外部 Git 源支持编辑（名称 / 类型 / 地址 / 认证方式），凭据留空沿用原值；
     克隆遇同名目录返回 409 + 可操作指引，不再误报服务端 500。
  2) 宝塔式路径条：面包屑可点击、点空白处可直接输入完整路径；
     本地文件浏览与远程 SFTP 文件管理共用，目录双击进入、不再需要「进入」按钮。
  3) 服务器负载 / 内存 / 磁盘按可配置间隔自动刷新，切到后台自动暂停。
  4) 镜像加速前缀按命名空间智能拼接，DbGate 等命名空间镜像不再被 library/ 误拼；
     加速源拒绝时自动回退 Docker Hub 原始镜像并给出可操作提示。
  5) Docker 容器列表固定列宽 + 端口截断，解决超长端口撑爆行高；
     设置 / 镜像仓库 / 存储卷 / 网络 / 容器编排按主流面板重做，
     新增筛选、统计、快捷模板、YAML 校验、复制与下载、面板偏好。
  6) 代理连通性探测超时不再被判成 500：统一归为 502 目标不可达并附修复提示；
     冒烟里的版本号断言改为读取 package.json，避免发版时漏改。

【本版新增 · v0.3.7】弹窗交互、工作区仓库与扩展体检（README §34）：
  1) 外部 Git 源登记 / 编辑共用弹窗（遮罩 / Esc / 取消关闭），列表页更清爽；
  2) Git 运行时展示完整检测结果与逐条可执行文件探测明细，重新检测有明确反馈；
  3) 仓库列表聚合工作区已克隆的本地仓库，远程源故障不再导致列表为空；
     fetch failed 细化为 DNS / 拒绝连接 / 超时 / 自签证书并给出修复入口。
  4) 扩展 / 数据库新增一键体检（容器 / 端口 / 健康检查 / 日志 / 建议）
     与保留数据卷的「重建容器」；旧内核自动启用 seccomp 兼容，修复 Node 22 镜像
     在 Linux 4.x 上 uv_thread_create 断言导致的 exit 139 无限重启。
  5) 面板偏好与其它 .form 外表单统一为「标签在上、控件在下」排版，不再挤成一行。

【本版新增 · v0.3.8】TLS 忽略参数与 .env 平台化管理（README §35）：
  1) 外部 Git 源新增三态「TLS 证书校验」：跟随全局 / 忽略（应急）/ 始终严格；
     同时覆盖仓库列表 REST API 与 git clone（http.sslVerify=false，不写 .git/config）。
  2) 新增 DP_TLS_INSECURE / DP_TLS_INSECURE_HOSTS 全局开关，可按域名限定生效范围；
     证书过期 / 自签错误改为可操作提示，附「去配置 env」入口与防中间人攻击安全警告。
  3) 新增「环境配置」页：白名单读取 .env（敏感值脱敏）、显示运行时生效值与待重启标记、
     自动备份后写回（600 权限）、TLS 开关即时热生效；容器部署自动挂载宿主机 .env。
  4) 诊断结论直接生成可复制 / 一键填入的 .env 片段
     （TLS / 扩展地址 / 镜像源 / Git 运行时 / 代理）；
     仓库源错误卡与扩展体检可一键跳转并高亮对应配置项。

【本版修复 · v0.3.9】宿主机 Git 识别与体检结论（README §36）：
  1) 平台跑在精简 node:alpine 容器里时，自动通过 SSH 实测宿主机 Git
     （command -v git / git --version / 工作区可写），结果带短缓存；
  2) 「自动体检」的 Git 可执行文件项在宿主机 Git 可用时判定为正常，
     明细直接显示宿主机 IP、Git 版本与路径，不再笼统报「未找到可用的 Git」；
  3) Git 运行时卡片新增宿主机 Git、生效 Git、工作区可写与 SSH 探测明细；
  4) 探测失败也不影响接口，缺 Git 时仍给出安装 / DP_INSTALL_GIT=1 指引。

【本版新增 · v0.3.10】IDE 凭据、运行主机与仓库操作（README §37）：
  1) CODE_SERVER_PASSWORD 纳入「环境配置」白名单；在线 IDE 页说明 $PASSWORD 来源，
     提供显示 / 复制密码与一键跳转修改，明文只在显式点击后返回。
  2) 新增 /api/host-info：区分平台容器（Alpine / Node / 镜像）与 SSH 宿主机
     （发行版 / 内核 / CPU / 内存 / 磁盘 / 负载 / Git / Docker），总览新增「运行主机」卡片；
     Git 运行时卡片标明两侧平台，并可展开 lsb_release -a 原始输出。
  3) 工作区仓库列表新增「文件管理」（SFTP 标签直达仓库目录）、「终端」（自动 cd）、
     「Git 操作」（status / log / branch / remote / diff / fetch / pull 与自定义命令）；
     命令走白名单 + 路径校验，容器无 Git 时自动在 SSH 宿主机执行。

【本版新增 · v0.3.11】文件浏览、编辑器与页面整理（README §38）：
  1) 修复仓库文件管理路径条下方空白（纵向 flex 撑高）与 Docker 容器操作列竖排异常；
     两处文件列表均支持名称 / 大小 / 类型 / 修改时间排序，目录恒优先分组并显示文件夹图标。
  2) 存储 / 文件新增「编辑」弹窗（CodeMirror + 编码 / 换行 / BOM），后端新增
     GET/PUT /api/openlist/files/content；Compose YAML 改为同款富编辑器，可调高度、
     整理格式、语法高亮与折叠。
  3) 服务器卡片新增「编辑」（脱敏凭据沿用原值）；DbGate 安装可填登录账号，
     实例列表可查看账号与登录凭据；兼容旧实例默认 admin。
  4) 在线 IDE 拆成「工作台」与「配置 / 凭据」两页，项目目录改为可浏览的目录选择器
     （GET /api/ide/dirs，路径限制在工作区内）。
  5) 顺带修复镜像加速前缀拼接：node:22-bookworm 这类「官方镜像 + tag」不再被
     冒号误判为自带 registry，容器化构建恢复可用。

【本版修复 · v0.3.12】全接口审计与错误分类（README §39）：
  1) 畸形 JSON 请求体由误判的 502 改为 400；超大请求体不再重置连接，改为返回 413。
  2) 未设 ADMIN_TOKEN 时拒绝写命令、镜像导入内容为空等场景不再报 500，
     分别归到 403 / 400；docker load 等上游失败归到 502 并带修复提示。
  3) 补齐 403 / 409 / 502 / 400 业务语义兜底：静态扫描 234 处普通 Error，
     修复前 132 处会被误判成 500，现在 0 处；真·代码异常仍保持 500。
  4) 新增 scripts/api-audit.js：全路由安全请求 + 副作用接口校验 + 路径穿越 / 注入 /
     畸形输入 + 凭据脱敏扫描 + 20 并发，与巡检脚本一起作为回归基线。

【本版新增 · v0.4.0】账号体系与资源协作（README §41）：
  1) 默认强制登录：未登录的 /api/* 一律 401；首次启动自动建 admin，随机初始密码
     写入 data/initial-admin.txt，首次登录强制改密；scrypt 密码哈希 + HttpOnly 会话 Cookie。
  2) 数据归属与协作者：每条资源带 ownerId / collaborators，默认只有自己与管理员可见；
     协作者支持 read 只读 / write 可改（不可删、不可改协作者），参照 Gitea 仓库协作。
  3) 派生资源（SSH 文件 / 终端、Docker、存储、Git 仓库文件）继承父资源权限；
     全局配置（.env、系统更新、代理、环境适配）对普通用户只读。
  4) 新增登录页、账号管理页、资源协作页与协作者弹窗；
     ADMIN_TOKEN 保留为机器 / 应急管理员通道，DP_AUTH_MODE 可一键回退。
  5) 命令行重置管理员密码：devplatform.exe reset-admin 或
     node scripts/reset-admin-password.js（在线不停机 / 离线改 state.json）。
  6) 巡检脚本与 remote.js deploy 适配令牌通道，强制登录后仍可全接口回归。

升级提示：本版默认开启强制登录，升级后浏览器需先用初始密码登录并改密；
           自动化脚本请配 ADMIN_TOKEN（--token / DP_TOKEN）。详见 README §5、§41、§42。

【本版修复 · v0.4.1】编辑资源不再丢失归属与协作者（README §42）：
  1) POST /api/servers 等编辑型接口用新对象整体替换时，会清掉 ownerId / collaborators，
     导致普通用户或协作者「保存后看不到自己的资源」；现在显式保留原有归属。
  2) core.update 增加更新前归属快照兜底，覆盖其余同类编辑接口；
     启动时自动把历史遗留的无归属资源补回管理员。
  3) 账号冒烟补 6 项回归（33 -> 39 项）：协作者 / owner 编辑后可见性、落盘归属、启动补齐。

【本版新增 · v0.4.3】AI 配置拆页、AI 运维对话化与构建记录可删除（README §11）：
  1) AI 配置拆为“AI 服务 / AI 运维”两页：AI 服务登记 OpenAI 兼容云端 API 与宿主机 / WSL 本地程序，支持代理；
  2) AI 运维改为多轮对话：会话落在 state.json 的 aiSessions 数组，按 ownerId 隔离（管理员可查看全部），
     消息含文本、附件与工具调用轨迹，刷新或换设备后可恢复继续；
  3) 支持附加文本文件（日志 / 配置 / 代码）与图片（OpenAI vision，最长边 1600 像素压缩，
     本地无图像能力时自动纯文本降级），多轮最近 20 轮上下文注入；
  4) 构建记录支持单条删除，协作范围排除构建记录与部署记录（仍保留 ownerId 归属与可见性）；
  5) 相关接口：GET 与 POST /api/ai/sessions 及其消息 / 清空 / 删除接口，消息路由级请求体上限放宽到 20MB。

【本版新增 · v0.4.4】交互一致性、对象级配置与 AI 运维增强（README §43）：
  1) “配置 AI 服务”编辑态新增“取消编辑 / 返回列表”按钮；AI 回复末尾的下一步建议提示词以灰色 ghost text 浮于输入框，Tab 接受、Esc 消失；
  2) AI 运维会话支持选择服务器范围（全部 / 多台 / 单台），serverScope 持久化并随消息提交，约束上下文采集与工具可用服务器；
  3) 单项代理覆盖入口下沉到对应对象：对象行“代理”按钮 + 服务器 / AI 服务表单 + 仓库编辑弹窗内直接填写，代理页只留覆盖清单与规则说明；
  4) 构建记录支持复选框 / 全选 / 批量删除（DELETE /api/builds，单次上限 200、逐条校验删除权限），
     并新增 confirmDialog 与 promptDialog 统一全站 31 处 confirm 与 11 处 prompt；
  5) 存储 / 文件管理员“未读取到驱动清单”改为按上游响应分类的空态，/api/openlist/drivers 返回 diagnostic 与修复入口；
  6) Git 仓库列表新增编辑 / 删除（平台侧管理，不动远端、可恢复），并拆出独立“Git 运行时”子页；
  7) 移除冗余的“资源协作”独立页，协作者下沉到单个对象新增 / 编辑表单，对象删除时统一清理代理覆盖残留与账号禁用后的悬空协作者。

【本版修复 · v0.4.4 加固】重置密码接口不再接受空参数（README §43.6）：
  1) 巡检脚本对写路由统一发空对象时，POST /api/auth/reset-password 曾把空 password 当成自动生成随机密码，无声换掉管理员密码；
  2) 两套巡检把账号类写接口（重置密码 / 改密 / 2FA / 用户增改删）加入跳过清单，服务端对空 body 一律返回 400，
     自动生成随机密码须显式带 username 或 generate=true；
  3) auth.js 写入 passwordChangedAt 与 passwordChangedVia 及审计日志，GET /api/users 可查；smoke-auth 与前端自检各增回归项。

【本版新增 · v0.4.5】集成服务一键安装、Kiri / Docker Desktop 双兼容与总览管理区（README §44）：
  1) 平台内一键安装并配置集成服务：新增 services/setup-status、services/setup、services/setup/job 三个接口，
     管理员在总览直接点「一键安装并启动 / 启动服务 / 停止服务」，等价手工执行 windows\native-services.ps1；
     自动下载 Gitea / OpenList / VS Code Web IDE、生成凭据写入 .env，日志在页面实时滚动，
     单任务互斥并有超时兜底，成功后凭据热同步进运行时（无需重启）。
  2) 总览集成服务卡片提到首屏，管理区常驻并置于服务列表上方；逐服务显示「已安装 / 未安装 · 端口 · 端口通断 · 健康检查」，
     标题徽标汇总就绪数，旁边「刷新状态」重新探测；移除只做滚动、无实际作用的「管理集成服务 ↓」跳转按钮。
     普通用户只读；令牌通道（localStorage.dp_token）访问时不再被误判为未登录而隐藏管理区。
  3) Docker 端点三件套纳入平台环境配置：DOCKER_HOST（支持 npipe:// 与 tcp://）、DOCKER_PIPE、DOCKER_SOCKET；
     BUILD_EXECUTOR / DP_ENV_PROFILE / DOCKER_PIPE 等固定枚举改为下拉选择（带白名单校验）。
     Kiri 可用 DOCKER_PIPE=kiri 或 DOCKER_HOST=npipe:////./pipe/kiri + BUILD_EXECUTOR=docker，
     Docker Desktop 默认行为不变。Windows bind mount 兼容性仍待装 Kiri 后实测。
  4) 在线 IDE 改用 VS Code serve-web，健康探测由 /healthz 改为根路径；运行主机面板在本机直跑且无 SSH 节点时
     填充本机 CPU / 内存 / 磁盘 / Git 信息，不再全显示「无」。

【本版修复 · v0.4.5】：
  1) core.js 源码直跑启动时自动加载 .env（此前配置重启即丢）；
  2) openlist.applyConfig 不再用面板里的空凭据覆盖 .env 有效凭据（曾致重启后 OpenList 未配置）；
  3) PowerShell 安装日志按 UTF-8 输出，修复中文乱码；前端 480px 窄屏横向溢出与多处状态文案修正。
  4) 深度审计：畸形 URL 不再打挂进程、optional 模式匿名写被拦、部署嵌套 serverId 参与鉴权、
     SSH 终端会话按 ownerId 隔离、兼容存储接口补路径穿越校验、一键安装后重置 OpenList 凭据缓存；
     OpenList 连接权限下沉到对象归属，普通用户可登记并启用自己的 OpenList，协作者按 read / write 生效。
  5) OpenList 挂载链路：驱动字典解析、启停 / 删除 id 放进 query（上游 strconv.Atoi 要求）；
     全局单例服务不变，挂载改为按账号隔离（归属表 + 列表 / 写操作 / 文件访问 / 根目录写过滤）；
     启停做成幂等、编辑保留停用状态、兼容 /api/storage/mounts 同步归一化。详见 README §44.4-§44.6。

【本版新增 · v0.4.6】集成服务账号 / 口令与在线 IDE 修正（README §45）：
  1) 安装时自动为 Gitea / OpenList / 在线 IDE 生成账号与口令并写入 .env；总览新增「服务账号 / 口令」面板，
     管理员可查看 / 复制 / 修改，改密同步到上游服务（Gitea change-password、OpenList admin set + 自动刷新令牌），
     IDE 可在免密与口令保护间切换并单独重启。凭据真实值只存本机 .env，不写入文档 / 仓库。
  2) 修正 IDE 三处错配：serve-web 本就免密却提示去配不生效的 code-server 密码、打开目录用容器路径、
     跨端口 iframe 被 X-Frame-Options / CSP 拦截导致白屏；/api/ide/open 改按本机 / 容器形态返回正确目录。
  3) 单独重启 IDE 时按 --server-data-dir 精确结束 serve-web fork 出的进程树，避免旧 socket 占用端口
     导致新进程启动即退出；平台用真实 HTTP 响应确认重启成功，不再只看脚本退出码。
  4) 回归：npm run check（纳入两个新模块）、前端自检（+3 护栏）、smoke-auth 42/42、
     api-audit 312 请求 0 个 500、api-sweep --full 181 项 0 个 500、无头浏览器三视角无 JS 异常。
  说明：v0.4.5 已发布的 Release 不含本节内容，v0.4.6 是包含本节的首个发行包。

【本版新增 · v0.4.7】文件浏览与内嵌后台体验改进（README §46）：
  1) 启动构建：项目目录（相对工作区）输入框旁新增「浏览…」按钮，复用工作区目录树选择器，
     不再需要手输路径；IDE 与构建部署共用同一个选择器，标题随调用方切换。
  2) 文件浏览：新增「新建文件」（PUT 空内容创建）与「AI 会话」按钮（以当前目录为上下文
     新建一段 AI 运维会话并自动切到对话页）；操作列由文字按钮改为图标按钮（编辑 / 下载 /
     直链 / 重命名 / 删除），紧凑不换行，解决窄列错位。
  3) 连接管理「内嵌后台」：原来直接 iframe 加载 OpenList /@manage，跨域 + 需手动登录。
     现改为平台同源反向代理（/api/openlist/admin）：后端注入管理员 token 到 SPA 的
     localStorage，代理 assets / api 请求并注入 Authorization 头，SPA 自动登录进入后台，
     无跨域 / X-Frame-Options 问题。mini.js 路由新增 * 通配支持（匹配多段路径）。
  4) WebDAV / 驱动：可用驱动清单的说明改为明确可操作 —— 点「选用」自动跳到「挂载存储」页
     并带入配置模板；点「模板」弹出该驱动的 addition JSON 可复制或直接带到新增挂载表单。
  5) 回归：npm run check、前端自检（+4 护栏、缓存戳 20261116a）、smoke-auth 42/42、
     api-audit 319 请求 0 个 500、无头浏览器四功能实测（目录选择 / 图标操作列不溢出 /
     驱动 93 项 / 内嵌后台 SPA 渲染 title=admin | OpenList、runtimeErrors=[]）。

【本版修复 · v0.4.21】全面安全审核修复（README §58）：
  经一轮全面安全审计，改动 21 个文件 + 新增回归脚本 scripts/smoke-security-fixes.js。
  1) 严重（P0，全部修复）：
     - 畸形 Cookie 不再打挂进程（解码失败降级 + dispatch 统一 catch + unhandledRejection 兜底）；
     - AI 会话越权：去掉末尾兜底放行，非 owner 一律 403；
     - 普通账号不再能执行任意程序：CLI 类 AI 服务 / 本地程序接口 / CLI 测试与对话全部限管理员，
       AI 运维引擎增加角色校验；
     - 导入 .git 不再触发命令执行：只保留 config 数据描述键、丢弃可执行配置、清空自带 hooks，
       在 git reset --hard 之前净化；
     - OpenList 换地址不再沿用上一连接的凭据（避免凭据外带）；
     - Redis 恢复不再清库（重定向作用于整组命令），空备份拒绝恢复。
  2) 高危（P1，修复 10/12）：OpenList 后台代理限管理员；权限 id 预筛与 server target 越权堵住；
     SSH 构建上传前建目录、远程装扩展顺序修正；dsh 跨帧事件不再丢失；Git 拒绝工作区外读文件选项；
     解压加内存上限防解压炸弹；代理地址脱敏修正、NO_PROXY 匹配与 IPv6 修正；OpenList 下载
     同源限 token + 流式大小限制。另修复上传 code 校验、回执脱敏、2FA 匿名接口 401、
     超时杀整个进程树。
  3) 行为变化：普通账号不可用本地 CLI 类 AI（API 型不受影响）、看不到内嵌 OpenList 后台入口；
     有 ACL 的仓库权限真正生效；上传失败如实报错。
  4) 回归：npm run check（40 模块）、前端自检、npm run smoke:security 49/49（新增）、
     smoke-auth 42/42、smoke-proxy-openlist 60/60、smoke:git 31/31、smoke:env 29/29、
     smoke:userdirs 13/13、smoke:aiscope 11/11、smoke:import 11/11。
  说明：本版为安全加固版，单文件发行版（dist/、platform.exe）需发布前执行 npm run build 重建。

【本版修复 · v0.4.22】9 项前端状态 / 体验类 bug（README §59）：
  均为 app.js 行级改动，不涉及安全；静态资源缓存戳升到 20261120a。
  1) 存储列表加请求序号，快速切目录时晚到响应被丢弃，避免删/重命名误伤错误目录；
  2) watchLog 切构建后定时器正确重启，日志持续刷新；
  3) 终端 SSE 收到 closed 后主动 close，不再每 3 秒自动重连刷屏；
  4) 文件列表重建时复位全选复选框；
  5) AI 会话发送锁在首个 await 前置位，双击不再建两个会话；
  6) 刷新构建列表保留已选编译环境 / 目标服务器；
  7) badge 去掉双层转义；
  8) data-copy 只绑仓库列表，不再误抓模板弹窗的复制按钮；
  9) 三处裸 fetch 上传先查 response.ok 再解析，网关返 HTML 时给出明确 HTTP 错误。
  回归：前端自检新增 9 条护栏全部通过；行为级验证 7 项通过。
  说明：dist/ 与 platform.exe 需发布前执行 npm run build 重建。

【本版修复 · v0.4.23】三项安全遗留问题按产品决策落地（README §60）：
  1) AI baseURL 属地分级（SSRF）：公网地址所有账号可配，私网/本机/元数据地址仅管理员，
     覆盖新增服务/获取模型/表单试跑三个入口；管理员的本机 Ollama 与内网 vLLM 场景保留。
  2) SSH 克隆映射校验与回滚：克隆后校验容器内 .git 可见，映射猜错则带路径守卫删除宿主机
     错误克隆目录并明确报错；映射正确的现有部署不受影响。
  3) 2FA 账号级限速（5 次失败锁 1 分钟，防跨挑战爆破）；CLI 通道新增 DP_CLI_SECRET 共享密钥
     （配置后须带 x-dp-cli-key；未配置兼容旧脚本），重置脚本同步支持。ADMIN_TOKEN 不受影响。
  注意：设置 DP_CLI_SECRET 后，未更新带密钥头的旧重置脚本将无法走 CLI 通道。
  回归：新增 npm run smoke:hardening 12/12；前端自检 +5 条护栏；全套 smoke 通过。
  说明：dist/ 与 platform.exe 需发布前执行 npm run build 重建。

v0.4.24 · 2026-11-21 · 全面评审 P0/P1/P2 全修
  本版修复（三路并行评审 + 逐条实证，共 16 项）：
  - P0 高危：Docker 全部写接口加管理员校验（普通账号原可删容器/卷/镜像）；服务器 deployDir 加白名单；probeHostGit 改用 shq 转义，杜绝命令注入。
  - P1：远程 SFTP 列表加请求序号（防误删错误目录）；IDE 代登录按仓库 read 权限收口；core.update 改快照事务（防状态分裂）；AI 使用类接口 providerId 不再误判越权；CodeMirror 不再被 innerHTML+= 摧毁；openExtRepos 首开等待加载。
  - P2：sftpPut 出错销毁流；git 超时杀整进程组；AI 引擎 open 单飞防泄漏；远程构建临时目录 finally 清理；远程扩展 rebuild 修状态机；syncDbGate 并发锁；限速表加惰性清理与上限。
  - 验证：前端自检新增 16 条护栏，全量回归零失败；705KB state 下 update 平均 11.65ms/次。
  -   注意：本版改了前端 app.js/index.html，缓存戳刷新为 20261121a。Windows 单文件发行版需 npm run build 后才是本版代码。

v0.4.25 · 2026-11-21 · 修复「上传压缩包导入」跨页常驻
  本版修复：
  - 现象：「上传压缩包导入」卡片出现在环境配置等所有页面顶部。
  - 根因：该卡片在 index.html 里游离于所有 <section class="page"> 之外，而页面切换 CSS 只作用于 .page 内元素，导致它不受视图切换约束、每页常驻。
  - 修复：将该卡片整体移入「Git 仓库 → 克隆到工作区」页（view-repo-clone）——它本就是无法联网克隆时的替代入口；事件按 id 绑定，移动 DOM 无副作用。
  - 护栏：前端自检新增 2 条断言（导入表单归属 view-repo-clone；所有 .card 必须位于某个 page 容器内、无游离元素），防止同类跨页常驻问题复发。
  - 缓存戳刷新为 20261121b。246 已部署验证（0.4.24/normal，体检 8/0/0，仅前端资源变更）。

v0.4.26 · 2026-11-21 · 接入渐进式类型检查（不影响运行 / 构建 / 部署）
  本版新增：
  - 背景：评估"整体改用 Go 换强类型 / 低内存 / 部署便利"后，实测 246 上平台仅占 16.78MiB（0.21%，机器上最轻容器之一），内存非瓶颈；三项诉求均可低代价达成，无需重写。详见 README §63。
  - 棘轮式 checkJs：新增 platform/tsconfig.typecheck.json、scripts/typecheck.js、scripts/typecheck-baseline.json（基线 78）。错误数不超基线即通过，新增类型问题才 exit 1；只许收敛不许回退，收敛后可 --update-baseline 下调。
  - npm run typecheck：全量 platform/src（36 模块约 2.2 万行）实测 78 错 / 14 文件，多为 JSDoc 稀疏导致的推断问题、非真实 bug。
  - 依赖 typescript / @types/node 仅入 devDependencies；部署与 Dockerfile 用 --omit=dev，生产镜像不含 TS。
  - 修复 Windows 下 .bin/tsc.cmd 需 shell:true 的静默失败误报（否则空输出被误判为"0 错误通过"）。
  - 前端自检 +1 条设施完整性护栏；未改任何运行时代码，无需重新部署 246。

v0.4.27 · 2026-11-22 · 配置体验完善 + 脱敏 key 加固 + Git 源本源代理
  本版修复与新增：
  - 配置说明完善：代理配置页新增格式说明卡（HTTP / SOCKS5 / direct / 留空的含义、优先级、NO_PROXY、安全提示）；8 处代理输入框占位文案统一为"填一个地址：如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；direct 直连；留空继承/清除/删除"，避免示例被误当成必填格式。
  - 交互反馈修复：「测试全局代理」成功/失败均弹 toast（直连时提示"网络可达·未走代理"，不再误报"代理可用"）；同步补齐 detectPrograms、model-fetch、provider-test、chat-form 等同类按钮的成功反馈。
  - 菜单精简去重：主菜单 17 项精简为 14 项——删除冗余的「Git源」（Git 仓库内已有）、「IDE配置」，环境两页合并为单一「环境」入口、进入后用标签切换；补 NAV_GROUP 映射与页面标题前缀。
  - 加固：探测接口 /api/ai/models/fetch 对脱敏 apiKey（空或含 **** 且带 id）回退到已保存的真实 key，与保存接口 /api/ai/providers 行为对齐，避免表单回显的脱敏 key 请求上游导致 502；不改变正常调用路径。
  - 新功能：Git 仓库 → 外部 Git 源添加/编辑表单新增「本源代理」配置项（复用 proxy.overrides.git[源id]，优先于分组/全局）。解决外部 HTTPS Git 源经全局 SOCKS5 代理无法列 REST 目录（Invalid URL protocol）的问题——REST 列目录/分支只支持 http(s)/direct，SOCKS 仅用于 SSH/CLI clone。列表回显新增只读 proxyOverride（脱敏），创建/编辑先校验代理格式再写库，删除源时清理覆盖。实测设 direct 后列 34 仓库与 root/agent_data 分支全部 200，非法 ftp:// 返回 400。
  - 结构护栏：修复「上传压缩包导入」card 跨页常驻的残留问题（已归入 Git 仓库克隆页）；新增多条前端静态护栏（card 不得游离、代理说明卡存在、proxy 测试按钮与结果同卡且唯一、菜单无冗余项、环境两页互切、Git 源代理字段等）；缓存戳刷新为 20261122d。
  - 验证：84 项只读/探测接口零失败，AI 单轮/运维/Harness 会话/运维会话/脱敏拉模型五种实测均返回真实内容，Git 仓库/源仓库分支、服务器 SSH 实测通过。node --check、前端自检、类型检查（78=基线）全通过。详见 README §64 与《接口完整性测试报告.md》。

v0.4.28 · 2026-11-24 · rclone 存储层 + SMB 网关 + Windows 提权与 WinFsp 自动安装
  本版新增与修复：
  - 工具栏下拉框统一美化：新增 select.ui-select / .ui-select-sm 样式（自定义 SVG 箭头 + 圆角描边 + hover/focus 反馈），覆盖 12 个静态与多类动态生成的工具栏下拉框，修复「远端」等控件退化为浏览器默认样式的问题。
  - OpenList 连接根目录映射：新增按连接 id 的只读浏览接口 /api/openlist/connections/:id/root，不切 active、按归属 read 判定；文件浏览页可切换连接查看各自根目录（只读）。Windows 桌面新增 driveMount.js，把连接 WebDAV 根目录映射为本地网络盘（盘符白名单 / shell:false / 密码不回显 / 会话可见性探测），非 Windows 优雅降级。
  - rclone 存储层：新增 platform/src/rclone.js——二进制探测安装、子命令白名单 + spawn(shell:false)、全局代理注入；支持 WebDAV / S3 / SFTP / FTP / 本地目录的远端 CRUD 与文件读写接口，响应形状对齐 OpenList；凭据用 rclone obscure 加密写入 600 权限的 rclone.conf，API 一律脱敏。Docker 下可借 docker.sock 把静态二进制安装到 data/bin。
  - SMB 共享网关：新增 platform/src/storageGateway.js——Linux 通过 Docker API 构建带 rclone + Samba + fuse3 的网关容器，容器内 rclone mount + smbd -F，445 映射宿主机，停止即删容器、宿主机零安装；Windows 用 rclone mount + net share。/api/rclone 写操作收为管理员。
  - Windows exe 管理员提权 + WinFsp 自动安装：SEA 构建注入 requireAdministrator 清单（双击弹 UAC、全程管理员）；官方 winfsp-2.1.25156.msi 随全量包分发并做 SHA256 校验；运行时以 WinFsp.Launcher 服务为主判据检测、msiexec /qn 静默安装，修复「非标准路径安装漏检导致重复安装 1603」的缺陷；SMB 网关卡片新增状态条与一键安装。
  - 验证：246 实测 rclone 安装、WebDAV/local 全链路文件操作、网关容器 + Windows net use 映射成功；下拉框美化 3 条 + WinFsp 提权 6 条新增护栏，前端自检全过；npm run check 全过、类型检查 78 错=基线未突破。2026-11-24 已部署 246（health 0.4.28/normal、体检 8/0/0、登录 200、缓存戳 20261124b）。详见 README §65/§66/§67。
  - 注意：Windows UAC 弹窗与 WinFsp 首次静默安装需在干净 Windows 机上双击 exe 复验；OpenList 暂不降级为扩展服务（用户家目录/归属表/WebDAV 仍依赖它），待 rclone 层稳定后再迁。

下载哪个：
  1) devplatform-windows.zip       推荐 · 全量包：控制台 + 三项集成服务 + WinFsp MSI。
                                    START.bat 只启控制台；INSTALL.bat 离线装好服务。
  2) devplatform-windows-lite.zip  轻量包：只有控制台，INSTALL.bat 首次需联网下载服务。
  3) devplatform-services.zip      仅三项官方程序 + WinFsp MSI + 清单；放进轻量包 / git clone 的
                                    windows\bootstrap\ 目录，即可同样离线安装。
  4) devplatform.exe               自包含单文件（已请求管理员权限），放任意空目录双击即用；
                                    首次挂载 SMB 需全量包的 WinFsp MSI 或手动安装 WinFsp。
  5) devplatform-dist.zip          组件包，供 git clone 后 windows\install.bat 自动下载。
  6) SHA256SUMS.txt                以上文件的 SHA256 校验值。

全量包 windows\bin 内自带的官方原版二进制（未修改）：
  gitea.exe        Gitea Windows x64
  openlist.exe     OpenList Windows x64
  code-tunnel.exe  VS Code 独立 CLI（code.exe 重命名），用于 serve-web 在线 IDE
  winfsp.msi       WinFsp v2.1（内核驱动，供 rclone mount / SMB 共享使用）
版本、来源与 SHA256 见 services-manifest.json；第三方许可见 THIRD-PARTY.txt。

只跑 START.bat 时三项集成服务显示「未配置 / 离线」是预期行为，不是故障。
全程不需要 git、Node.js、Docker 或 bash；不再需要单独下载集成服务程序。
校验：Get-FileHash <文件> -Algorithm SHA256，与 SHA256SUMS.txt 比对。

v0.4.29 · 2026-11-24 · Docker 应用商店全量同步 + 镜像加速对齐宝塔（随 v0.4.30 一并发版）
  本版新增与修复：
  - Docker 应用商店全量同步：从官方 aaPanel/appstore 一次性拉取 320 个应用模板（314 个有效：含 app.json + compose + .env + 图标），覆盖 12 个官方分类（建站/数据库/存储/AI/工具/NAS/中间件/DevOps/多媒体/邮件/系统/MCP）。新增 scripts/sync-appstore.js（GitHub API git tree + raw 端点低并发重试，支持断点续传），以后可一条命令更新官方数据。前端改为分类 + 分页（每页 60）展示。
  - 官方格式适配：修正版本目录定位——官方真实版本目录名 = appname（如 apps/mysql/mysql/），appversion 是镜像 tag 而非目录名，改为按「含 docker-compose.yml 的子目录」发现；修正参数合并——官方 field.attr 小写（mysql_port）与 .env 大写键（MYSQL_PORT）建立大小写映射，占位符用默认值填充。
  - 镜像加速对齐宝塔（双模式并存，默认宝塔）：宝塔方式配置「加速 URL」（默认 https://docker.1ms.run），平台生成 /etc/docker/daemon.json 的 registry-mirrors 片段 + 配置命令，compose 保持官方镜像名不变；可选「改写 compose」模式（旧行为，默认镜像源 registry.cn-hangzhou.aliyuncs.com）。新增 GET/PUT /api/docker/apps/config/accelerator 与 GET /config/daemon-json，旧 config/mirror 接口保留兼容。前端「镜像加速设置」弹窗支持模式切换、加速 URL、镜像源、daemon.json 预览与一键复制。
  - Windows 端分发链修复：appstore 模板此前未进入 exe/绿色包分发路径（appRoot 指向 dist/），Windows 端应用商店会为空。build.mjs 同步模板到 dist/ + appstore.tar.gz 作 SEA asset 内嵌、launcher.js 首启释放、两个 PowerShell 打包脚本随包复制，check-frontend.js 护栏锁死四段。
  - 部署脚本 .env 误杀修复：remote.js 此前按纯文件名排除所有 .env，把 appstore 的模板 .env 也当凭据排除，导致线上 prepare 生成空 .env；改为只排除仓库根凭据 .env，子目录模板 .env 放行，.env.bak.* 仍全层级排除。
  - 一键部署与文件下载：生成部署文件后新增「下载 compose」「下载 .env」（浏览器下载到本地）和「部署到服务器」按钮；部署面板选择已配置服务器 + 目标目录，平台 SSH 上传 docker-compose.yml 和 .env 后执行 docker compose up -d；自动兼容 V1（docker-compose）和 V2（docker compose plugin）；日志逐步展示 mkdir / upload / compose_up 步骤；246 实测通过（文件正确上传、容器镜像拉取启动）。
  - 配置说明对齐宝塔：参数表单改为三列布局（左标签 / 中控件 / 右逐项说明），说明取官方 field.suffix（1364 处），尾部留空的动态上限补「取决于目标主机实际配置」；按 field.type 渲染 checkbox / textarea / number / password / text，default 为 0/false 时不再被吞。官方 allow_access 复选框不在 .env 中，prepare() 新增映射到 HOST_IP=0.0.0.0|127.0.0.1，外部访问开关真正生效。
  - 验证：所有功能 246 线上实测通过，缓存戳 20261124f，npm run check 全过、类型检查 78=基线、前端自检全过。

v0.4.30 · 2026-11-24 · Git 仓库弹窗化 + Docker exec PTY 交互式终端 + Docker 应用商店全量移植（已发版）
  本版把 v0.4.29 与 v0.4.30 两阶段改动合并为一次发布：前者为 Docker 应用商店全量移植（见上一段），后者为 Git 弹窗化与容器交互式终端。仓库版本号统一升到 `0.4.30`，tag `v0.4.30`。
  本版新增与修复：
  - Git 仓库弹窗化：「文件管理」「克隆到工作区」不再新建标签页 / 跳页，改为弹窗。clone-form 静态搬入 #repo-clone-modal（现有 JS 绑定不受影响），从仓库列表或外部 Git 源列表点「克隆到工作区 / 填入克隆表单」自动带入地址并弹出；克隆成功 / 关闭 / Esc 都回到仓库列表。文件管理用 #repo-files-modal 内嵌轻量浏览器（复用 /servers/:id/files，路径条 + 目录进入 + 上一级 / 刷新），不依赖 tab 系统。「终端」断开时返回仓库列表页（onClose 回调）。
  - Docker exec PTY 流式接口：新增 platform/src/dockerExecTerm.js，与 SSH Web 终端同构（SSE 推送输出 base64 / POST 送输入 / resize / close），不引入 WebSocket。本机走 Docker Engine API 的 connection hijack（execCreateInteractive 建 Tty=true + AttachStdin 的 exec，execAttach 用 Connection: Upgrade 拿双向裸 socket，Tty=true 无复用帧头，字节直接喂 xterm；对未升级的 200 响应做降级处理）；远端 target=server:<id> 走 ssh2 pty 执行 docker exec -it [-u root] <id> <shell>。会话按 ownerId 归属、15 分钟空闲回收，订阅 / 注入 / 尺寸 / 关闭都校验归属；写接口命中 /^\/api\/docker\// 全局护栏仅管理员。新增 6 个路由：terminal/open|stream|input|resize|close|terminals。
  - 容器终端 xterm 化：#dk-panel-term 从「一次性命令 + <pre> 输出」换成 xterm.js + FitAddon 交互式终端，支持 shell 选择（bash|sh）、root 权限执行复选框、连接 / 断开 / 清屏、窗口 ResizeObserver 自适应同步后端 PTY；关闭弹窗或切换容器自动断开旧会话，避免输入串到别的容器。
  - 自检与护栏：check-frontend.js 新增两条（Git 弹窗化 + PTY 全链路），package.json 的 npm run check 纳入 dockerExecTerm.js；dockerApi.js / dockerPanel.js 导出补齐。缓存戳 20261124p。
  - 验证：246 线上实测通过——health 0.4.28/normal、体检 8/0/0；PTY 端到端验证还原真实交互式 shell（/app # root 提示符、echo 命令回显与结果、ANSI 控制码）、bash / 非 root 模式、非平台容器二次确认 400、无效 sid 注入 403、无 token 401、resize / close / 会话回收均正常；测试会话已全部清理。npm run check 全过、类型检查 78=基线（未超）、前端自检全过。
  - 修复（用户反馈「docker终端连接无响应」）：app.js 全局 click 委托里「连接」「断开」按钮判断误写成 `e.id`（事件对象无此属性，恒为 undefined），导致 dkTermConnect() 永不触发；同一段「清屏」用的是正确的 `e.target.id`。已统一改为 `e.target.id === 'dk-term-connect'` / `'dk-term-disconnect'`，并在 check-frontend.js 加回归护栏（正确写法存在 + 错误写法不存在）。缓存戳 20261124p → 20261124q。246 重新部署并复测：线上文件已含修复，PTY 端到端仍还原真实 shell（echo TERM_BTN_FIX_OK 回显成功），会话已清理。后端 PTY 接口本身无问题，纯前端事件绑定缺陷。
