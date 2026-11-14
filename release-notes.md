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

下载哪个：
  1) devplatform-windows.zip       推荐 · 全量包：控制台 + 三项集成服务程序。
                                    START.bat 只启控制台；INSTALL.bat 离线装好服务。
  2) devplatform-windows-lite.zip  轻量包：只有控制台，INSTALL.bat 首次需联网下载服务。
  3) devplatform-services.zip      仅三项官方程序 + 清单；放进轻量包 / git clone 的
                                    windows\bootstrap\ 目录，即可同样离线安装。
  4) devplatform.exe               自包含单文件，放任意空目录双击即用（只有控制台）。
  5) devplatform-dist.zip          组件包，供 git clone 后 windows\install.bat 自动下载。
  6) SHA256SUMS.txt                以上文件的 SHA256 校验值。

全量包 windows\bin 内自带的官方原版二进制（未修改）：
  gitea.exe        Gitea Windows x64
  openlist.exe     OpenList Windows x64
  code-tunnel.exe  VS Code 独立 CLI（code.exe 重命名），用于 serve-web 在线 IDE
版本、来源与 SHA256 见 services-manifest.json；第三方许可见 THIRD-PARTY.txt。

只跑 START.bat 时三项集成服务显示「未配置 / 离线」是预期行为，不是故障。
全程不需要 git、Node.js、Docker 或 bash；不再需要单独下载集成服务程序。
校验：Get-FileHash <文件> -Algorithm SHA256，与 SHA256SUMS.txt 比对。
