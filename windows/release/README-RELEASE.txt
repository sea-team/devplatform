DevPlatform - Windows 免安装发行包（集成服务程序已随包自带）
============================================================

【请先读这四行，避免误解】
  START.bat    只启动控制台；不会安装、也不会自动启动集成服务。
               （若之前已用 INSTALL.bat 装好本机服务，会自动把它们拉起。）
  INSTALL.bat  在控制台之外，额外安装并启动 Gitea / OpenList / 在线 IDE，
               并配置开机自启。本包已自带这三个程序，全程离线可装。
  本包 windows\bin\ 内自带官方原版 gitea.exe / openlist.exe /
  code-tunnel.exe，INSTALL.bat 会自动识别并纯离线安装，
  不需要联网、不需要单独下载任何集成服务程序。

  因此：解压后只双击 START.bat，三项集成服务显示「未配置 / 离线」
  是预期行为，不是故障。需要这三项就再双击一次 INSTALL.bat。

控制台地址：http://localhost:9000
不需要 git、不需要 Node.js、不需要 Docker、不需要 bash；全量包也不需要联网。


一、只启动控制台：START.bat
------------------------------------------------------------
双击根目录的 START.bat

  - 先运行集成服务状态检查，把三项服务「在线 / 离线」、本机原生服务
    「已安装 / 未安装」、以及本包是否自带二进制直接打印在窗口里
  - 若之前已用 INSTALL.bat 装过本机原生服务，会自动把它们拉起
  - 启动控制台并打开浏览器；首次启动会在 platform\dist\ 下释放
    bundle.cjs、public\、release.json 和 .env 配置模板（只需一次）
  - 服务器管理、SSH / Web 终端、远程文件管理与编辑器、AI 服务、
    构建部署、系统状态等功能立即可用
  - Gitea / OpenList / 在线 IDE 默认「未配置 / 离线」，不影响其它模块

停止：双击 STOP.bat

想单独查看集成服务状态：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1


二、连集成服务一起装：INSTALL.bat（本包为纯离线安装）
------------------------------------------------------------
双击根目录的 INSTALL.bat（等价于 windows\install.bat）

  - 有 Docker Desktop : 自动用容器起 Gitea / OpenList / code-server
  - 没有 Docker       : 自动用随包自带的 Windows 原生 exe 起三项服务，
                        在线 IDE 用随包自带的 VS Code 独立 CLI（serve-web），
                        本机没装 VS Code 也能用
  - 安装器检测到 windows\bin 三项齐全时，会自动启用 -NoDownload，
    不访问任何下载源；装完写好 platform\dist\.env 的地址与 Token，
    并启动全部服务
  - 之后每次开机用 START.bat 即可（会自动拉起已装好的原生服务）

  - 复用已部署的服务器 :
      powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246
      （remote 模式需要本机有 Node.js，且先在控制台登记服务器）

只复用已有服务、不装本机服务：直接把地址与 Token 填进
platform\dist\.env（或在控制台登记），然后完全重启 devplatform.exe。

只预览、不改动系统：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun


三、随包自带了什么
------------------------------------------------------------
  windows\bin\
    gitea.exe                Gitea 官方 Windows x64 单文件程序（约 112 MB）
    openlist.exe             OpenList 官方 Windows x64 单文件程序（约 137 MB）
    code-tunnel.exe          VS Code 官方独立 CLI（code.exe 重命名，约 29 MB）
    services-manifest.json   版本、官方来源、文件大小与 SHA256
    THIRD-PARTY.txt          上游项目、许可证与再分发说明

三个文件都是上游官方发布的原版二进制，未做任何修改。
INSTALL.bat 会把它们复制到 windows\runtime\bin\ 后启动；数据、日志、
PID 全部写在 windows\runtime\，不会改动 windows\bin\ 里的原文件。
Gitea 用 SQLite、OpenList 用本地 data.db，都不需要额外数据库或运行时。

离线校验示例：
  powershell -NoProfile -Command "Get-FileHash windows\bin\gitea.exe -Algorithm SHA256"
与 services-manifest.json 里的 sha256 比对即可。

如果只需要控制台，可以直接删除 windows\bin 目录（约 280 MB），
不影响 START.bat 与平台其它功能。


四、轻量包 / git clone 用户如何也变成离线
------------------------------------------------------------
Release 里另有 devplatform-services.zip（只有上面三个 exe + 清单）。
二选一：

  1) 把 devplatform-services.zip 原样放到
     windows\bootstrap\devplatform-services.zip，
     然后双击 INSTALL.bat —— 安装器会自动解压并识别，效果与全量包一致。
  2) 解压后把三个 exe 直接复制进 windows\bin\，再双击 INSTALL.bat。

git clone 的用户第一次安装仍会自动获取 platform\dist 程序包
（devplatform-dist.zip）；把它也放进 windows\bootstrap\ 即可全程离线。


五、另一种下载方式：只要一个 exe
------------------------------------------------------------
Release 资产 devplatform.exe 是完整自包含的单文件程序。
把它单独放到任意空文件夹双击即可运行，首启会自动在旁边释放
bundle.cjs、public\、release.json、.env。适合只想要控制台、
或想自行管理集成服务地址的场景（改完 .env 必须完全重启 exe）。
这个单文件不含 INSTALL.bat，也不自带三项集成服务程序。


六、目录与配置
------------------------------------------------------------
  START.bat / INSTALL.bat / STOP.bat   顶层快捷入口
  windows\bin\                        随包自带的三个官方服务程序
  windows\check-integrations.ps1      集成服务状态检查
  windows\                           安装、启停、卸载与原生服务脚本
  windows\runtime\                    首次 INSTALL 后生成的数据与日志
  platform\dist\                      程序本体，所有运行时状态都在这里
  platform\dist\.env                  集成服务地址与 Token（首次启动生成）
  scripts\                            remote 模式同步配置用（需 Node.js）
  .env.example                       全部配置项说明

安全提示：.env 与 platform\dist\data\ 存有凭据，不要外传或提交到 git。
修改 .env 后必须完全关闭并重新启动 devplatform.exe（reload 不重读配置）。


七、校验与更新
------------------------------------------------------------
  powershell -Command "Get-FileHash devplatform-windows.zip -Algorithm SHA256"
与 Release 里的 SHA256SUMS.txt 比对。

业务与前端支持在线热更新：
  platform\dist\devplatform.exe update <目录或 release.json 的 URL>
  platform\dist\devplatform.exe rollback
exe 壳本身升级时，从新版 Release 下载 devplatform.exe 覆盖即可，
已有的 .env、data\、workspace\ 不会被覆盖。
集成服务程序要升级时，替换 windows\bin\ 下的 exe 后重跑 INSTALL.bat。


八、常见疑问
------------------------------------------------------------
Q: 只跑了 START.bat，为什么 Gitea / OpenList / 在线 IDE 是离线？
A: 因为这三项要 INSTALL.bat 才装。START.bat 只启动控制台，
   状态检查也会在窗口里明确提示这一点。

Q: INSTALL.bat 还要联网吗？
A: 本全量包不需要。三个程序已在 windows\bin\ 里，安装器检测到
   三项齐全会自动启用纯离线模式。轻量包首次 INSTALL.bat 才需联网。

Q: 本机没装 VS Code，在线 IDE 能用吗？
A: 能。本包自带 VS Code 官方独立 CLI（code-tunnel.exe），
   由它执行 serve-web 提供 Web IDE，不依赖本机 VS Code 安装。

Q: INSTALL.bat 会覆盖我已经改过的 .env / 数据吗？
A: 不会覆盖已有凭据；安装器只补齐缺失项。改完 .env 需完全重启 exe。

Q: 我只想连到别处已经部署好的三个服务？
A: 不用 INSTALL.bat，把地址与 Token 填进 platform\dist\.env 后重启 exe。

Q: 项目要用 MySQL / PostgreSQL / Redis，或要连 GitHub 上的仓库，怎么弄？
A: 控制台左侧新增了「扩展 / 数据库」「Git 源」「Docker 管理」「代理配置」四个模块，
   「存储 / 文件」页也已集成 OpenList 后台管理：
   - 有 Docker：可一键装数据库容器，自动生成密码与连接串并注入项目 .env；
     还能装 DbGate（开源多数据库 Web 客户端），连接会自动同步。
   - 无 Docker：自动降级为「外部连接」，只登记已有数据库地址与凭据，
     不安装、不下载任何东西；本机无需 Docker 也能用。
   - 外部 Git 源：登记 GitHub / 自建 Gitea / GitLab 后，仓库列表会自动聚合，
     Token 只存本机且脱敏，克隆时不写入 .git/config。
   - 需要编译环境但本机无 Docker：在「服务器」页登记一台 Linux 机器，
     构建后端 auto 会自动走 SSH 远程容器构建，不需要本机装 Docker Desktop。
   数据库镜像不含在本安装包内（体积 GB 级且依赖容器运行时）；
   内网可先用「Docker 管理 · 镜像」离线导入，详见 README 第 19-25 章。

Q: 公司网络要走代理，Git / Docker / SSH / AI 能不能分别配？
A: 可以。控制台「代理配置」页按四级优先级生效（命中即停止）：
   - 单个仓库代理 > Git Host 匹配 > Git 分组 > 全局；
   - 单个容器代理 > Docker 代理 > 全局；
   - 单个服务器代理 > 服务器代理 > 全局；
   - 单个 AI 服务代理 > AI 服务代理 > 全局。
   留空继承下一级，填 direct 表示强制直连；支持 NO_PROXY、解析预览与连通性测试。
   代理账号密码只存 state.json（600），界面和接口一律显示 ******。详见 README 第 27 章。

Q: 文件管理除了服务器 SFTP，OpenList 里的挂载和文件怎么管？
A: 「存储 / 文件」页已集成 OpenList：可改连接信息、增删启停挂载存储、查看驱动模板，
   并支持面包屑浏览、多选、重命名 / 移动 / 复制 / 批量删除、直链、下载、多文件上传；
   也可一键打开或内嵌 OpenList 后台。需要管理员权限的 Token。详见 README 第 26 章。

完整文档：https://github.com/sea-team/devplatform#readme
