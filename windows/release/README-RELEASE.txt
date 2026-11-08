DevPlatform - Windows 免安装发行包
============================================================

从 GitHub Releases 直接下载解压即可使用：不需要 git、不需要 Node.js、
不需要 Docker、不需要 bash，也不需要再联网下载其它组件。
控制台地址：http://localhost:9000


一、最快使用（推荐先试这个）
------------------------------------------------------------
双击根目录的 START.bat

  - 自动启动控制台并打开浏览器
  - 首次启动会在 platform\dist\ 下释放 bundle.cjs、public\、
    release.json 和 .env 配置模板（只需一次）
  - 服务器管理、SSH / Web 终端、远程文件管理与编辑器、AI 服务、
    构建部署、系统状态等功能立即可用
  - Gitea / OpenList / 在线 IDE 三项集成服务默认显示「未配置 / 离线」，
    不影响其它模块；可直接把已有服务地址填进控制台，
    或运行 INSTALL.bat 在本机完整安装

停止：双击 STOP.bat


二、完整安装（集成服务 + 开机自启）
------------------------------------------------------------
双击根目录的 INSTALL.bat（等价于 windows\install.bat）

  - 有 Docker Desktop        : 自动用容器起 Gitea / OpenList / code-server
  - 没有 Docker              : 自动用 Windows 原生 exe 起 Gitea / OpenList，
                               在线 IDE 用本机 VS Code 的 serve-web
  - 复用已部署的服务器      :
      powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246
      （remote 模式需要本机有 Node.js，且先在控制台登记服务器）

无外网 / 内网机器：native 模式的 Gitea、OpenList 二进制可提前放到
windows\bin\，再用 -NoDownload 离线安装：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native -BinDir windows\bin -NoDownload

只预览、不改动系统：
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun


三、另一种下载方式：只要一个 exe
------------------------------------------------------------
Release 资产 devplatform.exe 是完整自包含的单文件程序。
把它单独放到任意空文件夹双击即可运行，首启会自动在旁边释放
bundle.cjs、public\、release.json、.env。适合只想要控制台、
或想自行管理集成服务地址的场景（改完 .env 必须完全重启 exe）。


四、目录与配置
------------------------------------------------------------
  START.bat / INSTALL.bat / STOP.bat   顶层快捷入口
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

完整文档：https://github.com/sea-team/devplatform#readme
