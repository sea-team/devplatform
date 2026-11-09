DevPlatform - Windows 免安装发行包
============================================================

【请先读这三行，避免误解】
  START.bat    只启动控制台；不会安装集成服务。
               （若之前已用 INSTALL.bat 装好本机服务，会自动把它们拉起。）
  INSTALL.bat  在控制台之外，额外安装并启动 Gitea / OpenList / 在线 IDE
               （并配置开机自启）。首次安装需要联网下载二进制，或离线放置。

  因此：解压后双击 START.bat，控制台里三项集成服务显示「未配置 / 离线」
  是预期行为，不是故障。需要这三项就再双击一次 INSTALL.bat。

控制台地址：http://localhost:9000
不需要 git、不需要 Node.js、不需要 Docker、不需要 bash。
（只有 INSTALL.bat 安装集成服务时才需要联网，或提前放离线二进制。）


一、只启动控制台：START.bat
------------------------------------------------------------
双击根目录的 START.bat

  - 先运行集成服务状态检查，把三项服务是「在线 / 离线」、本机
    原生服务「已安装 / 未安装」直接打印在窗口里，并给出下一步指引
  - 若之前已用 INSTALL.bat 装过本机原生服务，会自动把它们拉起
  - 启动控制台并打开浏览器；首次启动会在 platform\dist\ 下释放
    bundle.cjs、public\、release.json 和 .env 配置模板（只需一次）
  - 服务器管理、SSH / Web 终端、远程文件管理与编辑器、AI 服务、
    构建部署、系统状态等功能立即可用
  - Gitea / OpenList / 在线 IDE 默认「未配置 / 离线」，不影响其它模块

停止：双击 STOP.bat

想单独查看集成服务状态：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1


二、连集成服务一起装：INSTALL.bat
------------------------------------------------------------
双击根目录的 INSTALL.bat（等价于 windows\install.bat）

  - 有 Docker Desktop        : 自动用容器起 Gitea / OpenList / code-server
  - 没有 Docker              : 自动用 Windows 原生 exe 起 Gitea / OpenList，
                               在线 IDE 用本机 VS Code 的 serve-web
  - 装完会写好 platform\dist\.env 里的地址与 Token，并启动全部服务
  - 之后每次开机用 START.bat 即可（会自动拉起已装好的原生服务）

  - 复用已部署的服务器      :
      powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246
      （remote 模式需要本机有 Node.js，且先在控制台登记服务器）

无外网 / 内网机器：native 模式的 Gitea、OpenList 二进制可提前放到
windows\bin\，再用 -NoDownload 离线安装：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native -BinDir windows\bin -NoDownload

只复用已有服务、不装本机服务：直接把地址与 Token 填进
platform\dist\.env（或在控制台登记），然后完全重启 devplatform.exe。

只预览、不改动系统：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun


三、另一种下载方式：只要一个 exe
------------------------------------------------------------
Release 资产 devplatform.exe 是完整自包含的单文件程序。
把它单独放到任意空文件夹双击即可运行，首启会自动在旁边释放
bundle.cjs、public\、release.json、.env。适合只想要控制台、
或想自行管理集成服务地址的场景（改完 .env 必须完全重启 exe）。
这个单文件不带 INSTALL.bat，也不会自动安装集成服务。


四、目录与配置
------------------------------------------------------------
  START.bat / INSTALL.bat / STOP.bat   顶层快捷入口
  windows\check-integrations.ps1      集成服务状态检查
  windows\                           安装、启停、卸载与原生服务脚本
  platform\dist\                      程序本体，所有运行时状态都在这里
  platform\dist\.env                  集成服务地址与 Token（首次启动生成）
  scripts\                            remote 模式同步配置用（需 Node.js）
  .env.example                       全部配置项说明

安全提示：.env 与 platform\dist\data\ 存有凭据，不要外传或提交到 git。
修改 .env 后必须完全关闭并重新启动 devplatform.exe（reload 不重读配置）。


五、校验与更新
------------------------------------------------------------
  powershell -Command "Get-FileHash devplatform-windows.zip -Algorithm SHA256"
与 Release 里的 SHA256SUMS.txt 比对。

业务与前端支持在线热更新：
  platform\dist\devplatform.exe update <目录或 release.json 的 URL>
  platform\dist\devplatform.exe rollback
exe 壳本身升级时，从新版 Release 下载 devplatform.exe 覆盖即可，
已有的 .env、data\、workspace\ 不会被覆盖。


六、常见疑问
------------------------------------------------------------
Q: 只跑了 START.bat，为什么 Gitea / OpenList / 在线 IDE 是离线？
A: 因为这三项要 INSTALL.bat 才装。START.bat 只启动控制台，
   状态检查也会在窗口里明确提示这一点。

Q: INSTALL.bat 会覆盖我已经改过的 .env / 数据吗？
A: 不会覆盖已有凭据；安装器只补齐缺失项。改完 .env 需完全重启 exe。

Q: 我只想连到别处已经部署好的三个服务？
A: 不用 INSTALL.bat，把地址与 Token 填进 platform\dist\.env 后重启 exe。

完整文档：https://github.com/sea-team/devplatform#readme
