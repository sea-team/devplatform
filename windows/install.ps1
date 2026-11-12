<#
  DevPlatform Windows 一键安装器（PowerShell 5.1+ 兼容，平台本体无需 Node / bash / Docker）
  用法：双击 windows\install.bat，或在 PowerShell 中：
    powershell -ExecutionPolicy Bypass -File windows\install.ps1
    powershell -ExecutionPolicy Bypass -File windows\install.ps1 -Mode local
    powershell -ExecutionPolicy Bypass -File windows\install.ps1 -Mode native
    powershell -ExecutionPolicy Bypass -File windows\install.ps1 -Mode remote -RemoteHost 10.0.0.246
    powershell -ExecutionPolicy Bypass -File windows\install.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File windows\install.ps1 -DistZip D:\share\devplatform-dist.zip

  git clone 后 platform\dist\ 为空是正常现象（构建产物不入库）：
    安装器会自动从 GitHub Release 下载 CI 发布的 devplatform-dist.zip 并解压，
    也可用 -DistZip（本地 zip / 已构建好的 dist 目录）、-DistUrl（内网 HTTP）离线安装，
    或把 zip 放进 windows\bootstrap\ 目录。-SkipDistDownload 可禁用自动下载。

  集成服务程序随发行包自带：windows\bin\ 下的 gitea.exe / openlist.exe /
  code-tunnel.exe 会被自动识别，三项齐全时直接纯离线安装，无需联网、无需
  手动 -BinDir / -NoDownload。轻量包用户可把 devplatform-services.zip
  放进 windows\bootstrap\，效果相同。

  三种集成服务模式：
    local  = Docker 容器（需 Docker Desktop）
    native = Windows 原生 exe（无 Docker，推荐普通 Windows 机器）
    remote = 复用已部署服务器（无需本机服务）
    auto   = 有 Docker 用 local；无 Docker 且已登记服务器用 remote；否则自动用 native
#>
[CmdletBinding()]
param(
  [ValidateSet('auto', 'local', 'remote', 'native')][string]$Mode = 'auto',
  [string]$RemoteHost = '',
  [switch]$InstallDocker,
  [switch]$NoService,
  [switch]$NoLaunch,
  [switch]$DryRun,
  [int]$Port = 9000,
  [string]$ImagePrefix = 'docker.m.daocloud.io',
  # ---- 仅 native 模式使用 ----
  [string]$BinDir = '',
  [switch]$NoDownload,
  [switch]$ForceEnv,
  [ValidateSet('auto', 'code', 'wsl', 'none')][string]$IdeMode = 'auto',
  [string]$GiteaVersion = '1.23.8',
  [string]$OpenListVersion = 'v4.2.6',
  [string]$DownloadProxy = 'https://ghfast.top/',
  [string]$ProxyUrl = '',
  # ---- 首次安装：获取 platform/dist 预构建包 ----
  [string]$DistZip = '',
  [string]$DistUrl = '',
  [string]$Repo = 'sea-team/devplatform',
  [string]$ReleaseTag = 'latest',
  [switch]$SkipDistDownload
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root 'platform\dist'
$Exe = Join-Path $Dist 'devplatform.exe'
$RootEnv = Join-Path $Root '.env'
$DistEnv = Join-Path $Dist '.env'
$ScriptsDir = Join-Path $Root 'scripts'
$StateFile = Join-Path $Root 'data\state.json'
$TaskName = 'DevPlatform'
$GiteaPort = 3002

# 预构建包获取模块（只定义 Dp-* / Get-DistPackage 函数，不产生副作用）
. (Join-Path $PSScriptRoot 'dist-package.ps1')

function Step($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Skip($msg) { Write-Host "    [DRY]  $msg" -ForegroundColor DarkGray }

function Invoke-Native([string]$Tool, [string[]]$Arguments, [switch]$Capture) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = ''
  try {
    if ($Capture) { $output = (& $Tool @Arguments 2>&1 | Out-String) }
    else { & $Tool @Arguments 2>&1 | Out-Null }
    $code = $LASTEXITCODE
  } catch {
    $code = 1
    $output = $_.Exception.Message
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ Code = $code; Output = $output }
}

function New-Secret([int]$Length = 24) {
  $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  $bytes = New-Object 'byte[]' $Length
  $rng = New-Object 'System.Security.Cryptography.RNGCryptoServiceProvider'
  $rng.GetBytes($bytes)
  $text = ''
  foreach ($b in $bytes) { $text += $chars[$b % $chars.Length] }
  return $text
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  if ($DryRun) { Skip "写入 $Key 到 $([IO.Path]::GetFileName($Path))"; return }
  $lines = @()
  if (Test-Path -LiteralPath $Path) { $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8) }
  $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) { $lines[$i] = "$Key=$Value"; $found = $true; break }
  }
  if (-not $found) { $lines += "$Key=$Value" }
  [IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))
}

function Read-EnvFile([string]$Path) {
  $result = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $result }
  foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $result[$Matches[1]] = $Matches[2].Trim('"', "'")
    }
  }
  return $result
}

function Wait-Http([string]$Name, [string]$Url, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
      if ([int]$r.StatusCode -ge 200 -and [int]$r.StatusCode -lt 400) {
        Good "$Name 已就绪 (HTTP $($r.StatusCode))"
        return $true
      }
    } catch { }
    Start-Sleep -Seconds 2
  }
  Warn "$Name 在 $Seconds 秒内未就绪"
  return $false
}

function Test-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  $r = Invoke-Native 'docker' @('info') -Capture
  return ($r.Code -eq 0)
}

function Get-Compose {
  $r = Invoke-Native 'docker' @('compose', 'version') -Capture
  if ($r.Code -eq 0) { return 'v2' }
  if (Get-Command docker-compose -ErrorAction SilentlyContinue) { return 'v1' }
  return ''
}

function New-RootEnv {
  Step '生成根目录 .env（集成服务配置）'
  if (Test-Path -LiteralPath $RootEnv) {
    Good '已存在 .env，保留原有配置'
    return (Read-EnvFile $RootEnv)
  }
  $pw = New-Secret 20
  $idePw = New-Secret 16
  $lines = @(
    '# 由 windows/install.ps1 生成；包含明文凭据，请勿提交 Git',
    '# ADMIN_TOKEN：控制台 / API 访问令牌。留空＝所有 /api/* 无鉴权（仅限可信本机 / 内网，',
    '#   且 /api/servers/:id/exec 降级为只读白名单）；对局域网 / 公网暴露时必须设置。',
    '# 启用：填强随机值 → 完全重启 exe → 每台浏览器执行 localStorage.setItem("dp_token","<同一令牌>")。',
    '# 详细风险与步骤见 .env.example、README §5 / §40 与控制台「环境配置 → 鉴权说明」。',
    'ADMIN_TOKEN=',
    "GITEA_URL=http://localhost:$GiteaPort",
    'GITEA_TOKEN=',
    "GITEA_PORT=$GiteaPort",
    "CODE_SERVER_URL=http://localhost:8080",
    "CODE_SERVER_PASSWORD=$idePw",
    'OPENLIST_URL=http://localhost:5244',
    'OPENLIST_TOKEN=',
    'OPENLIST_USER=admin',
    "OPENLIST_PASSWORD=$pw",
    'BUILD_EXECUTOR=local',
    'BUILD_TIMEOUT_MS=900000'
  )
  if ($ImagePrefix) {
    $p = $ImagePrefix.TrimEnd('/')
    $lines += @(
      "GITEA_IMAGE=$p/gitea/gitea:1.23",
      "OPENLIST_IMAGE=$p/openlistteam/openlist:latest",
      "CODE_SERVER_IMAGE=$p/codercom/code-server:4.96.4",
      "PLATFORM_NODE_IMAGE=$p/library/node:22-bookworm-slim"
    )
  }
  if ($DryRun) { Skip "生成 .env（随机密码、镜像前缀 $ImagePrefix）" }
  else {
    [IO.File]::WriteAllText($RootEnv, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))
    Good "已生成 .env（Gitea/OpenList 管理员密码随机，保存在 $RootEnv）"
  }
  return @{ OPENLIST_PASSWORD = $pw; GITEA_PORT = [string]$GiteaPort }
}

function Start-LocalServices([hashtable]$Cfg) {
  Step '启动本机集成服务（Gitea / OpenList / code-server）'
  if ($DryRun) {
    Skip "docker compose up -d gitea openlist code-server（工作目录 $Root）"
    Skip '等待 3002 / 5244 / 8080 健康端点'
    Skip '初始化 Gitea 管理员与 Token、OpenList Admin Token'
    return @{ GiteaToken = 'dry-run'; OpenListToken = 'dry-run' }
  }
  $compose = Get-Compose
  if (-not $compose) { Die '未找到 docker compose；请安装 Docker Desktop 后重试' }
  Push-Location $Root
  try {
    if ($compose -eq 'v2') { $r = Invoke-Native 'docker' @('compose', 'up', '-d', 'gitea', 'openlist', 'code-server') -Capture }
    else { $r = Invoke-Native 'docker-compose' @('up', '-d', 'gitea', 'openlist', 'code-server') -Capture }
    if ($r.Code -ne 0) { Write-Host $r.Output; Die 'docker compose 启动失败（见上方输出）' }
    Good '三个集成服务已启动'
  } finally { Pop-Location }

  Wait-Http 'Gitea' "http://localhost:$GiteaPort/api/v1/version" 180 | Out-Null
  Wait-Http 'OpenList' 'http://localhost:5244/api/public/settings' 180 | Out-Null
  Wait-Http 'code-server' 'http://localhost:8080/healthz' 180 | Out-Null

  Step '初始化集成服务凭据'
  $pw = $Cfg.OPENLIST_PASSWORD
  if (-not $pw) { Die '.env 中缺少 OPENLIST_PASSWORD，无法初始化 Gitea / OpenList' }

  Invoke-Native 'docker' @('exec', '--user', '1000', 'dp-gitea', 'gitea', 'admin', 'user', 'create',
    '--admin', '--username', 'admin', '--password', $pw, '--email', 'admin@example.com') -Capture | Out-Null

  $giteaToken = $Cfg.GITEA_TOKEN
  if ($giteaToken) {
    try {
      $check = Invoke-WebRequest -Uri "http://localhost:$GiteaPort/api/v1/user" -Headers @{ Authorization = "token $giteaToken" } -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
      if ([int]$check.StatusCode -eq 200) { Good '复用 .env 中已有的 Gitea Token' }
    } catch { $giteaToken = '' }
  }
  if (-not $giteaToken) {
    $pair = "admin:$pw"
    $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
    $body = @{ name = "devplatform-$((Get-Date).ToString('yyyyMMddHHmmss'))"; scopes = @('all') } | ConvertTo-Json
    try {
      $resp = Invoke-RestMethod -Uri "http://localhost:$GiteaPort/api/v1/users/admin/tokens" -Method Post `
        -Headers @{ Authorization = "Basic $b64" } -ContentType 'application/json' -Body $body -TimeoutSec 20 -ErrorAction Stop
      $giteaToken = [string]$resp.sha1
    } catch { Die "生成 Gitea Token 失败：$($_.Exception.Message)" }
    if (-not $giteaToken) { Die 'Gitea 未返回 Token，请确认管理员密码与 INSTALL_LOCK' }
    Good 'Gitea 访问令牌已生成'
  }
  Set-EnvValue $RootEnv 'GITEA_TOKEN' $giteaToken

  Invoke-Native 'docker' @('exec', '-w', '/opt/openlist', 'dp-openlist', './openlist', 'admin', 'set', $pw) -Capture | Out-Null
  Invoke-Native 'docker' @('restart', 'dp-openlist') -Capture | Out-Null
  Wait-Http 'OpenList（重启后）' 'http://localhost:5244/api/public/settings' 120 | Out-Null
  $tokenOut = Invoke-Native 'docker' @('exec', '-w', '/opt/openlist', 'dp-openlist', './openlist', 'admin', 'token') -Capture
  $openlistToken = ''
  foreach ($line in ($tokenOut.Output -split "`r?`n")) {
    if ($line -match 'Admin token:\s*(.+)$') { $openlistToken = $Matches[1].Trim() }
  }
  if ($openlistToken) { Good 'OpenList Admin Token 已获取'; Set-EnvValue $RootEnv 'OPENLIST_TOKEN' $openlistToken }
  else { Warn '未取得 OpenList Token，存储模块将回退到密码登录' }

  return @{ GiteaToken = $giteaToken; OpenListToken = $openlistToken }
}

function Write-LocalDistEnv([hashtable]$Tokens) {
  Step '生成 platform/dist/.env（供 exe 读取）'
  $lines = @(
    '# 由 windows/install.ps1 生成；修改后需完全重启 devplatform.exe',
    "PORT=$Port",
    "GITEA_URL=http://localhost:$GiteaPort",
    "GITEA_TOKEN=$($Tokens.GiteaToken)",
    'OPENLIST_URL=http://localhost:5244',
    "OPENLIST_TOKEN=$($Tokens.OpenListToken)",
    'OPENLIST_USER=admin',
    'CODE_SERVER_URL=http://localhost:8080',
    '# ADMIN_TOKEN：控制台 / API 访问令牌。留空＝所有 /api/* 无鉴权（仅限可信本机 / 内网，',
    '#   且 /api/servers/:id/exec 降级为只读白名单）；对局域网 / 公网暴露时必须设置。',
    '# 启用：填强随机值 → 完全重启 exe → 每台浏览器执行 localStorage.setItem("dp_token","<同一令牌>")。',
    '# 详细风险与步骤见 .env.example、README §5 / §40 与控制台「环境配置 → 鉴权说明」。',
    '# ADMIN_TOKEN=',
    'NO_PROXY=localhost,127.0.0.1'
  )
  if ($DryRun) { Skip '写入 dist/.env（三个 localhost 地址 + 两个 Token）'; return }
  if (-not (Test-Path -LiteralPath $Dist)) { New-Item -ItemType Directory -Path $Dist -Force | Out-Null }
  [IO.File]::WriteAllText($DistEnv, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))
  Good "已写入 $DistEnv"
}

function Start-RemoteServices {
  Step '复用已部署服务器上的集成服务'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Die 'remote 模式需要 Node.js 运行 scripts/sync-integrations.js；或改用 -Mode local' }
  $sync = Join-Path $ScriptsDir 'sync-integrations.js'
  if (-not (Test-Path -LiteralPath $sync)) { Die "缺少 $sync" }
  if (-not (Test-Path -LiteralPath $StateFile)) { Die "缺少 $StateFile，请先在控制台登记服务器" }
  if ($DryRun) {
    $target = if ($RemoteHost) { "--from $RemoteHost" } else { '（自动选择 state.json 中的服务器）' }
    Skip "node scripts/sync-integrations.js $target"
    return
  }
  $syncArgs = @($sync)
  if ($RemoteHost) { $syncArgs += @('--from', $RemoteHost) }
  $prevEncoding = [Console]::OutputEncoding
  [Console]::OutputEncoding = New-Object 'System.Text.UTF8Encoding' $false
  try { & node @syncArgs }
  finally { [Console]::OutputEncoding = $prevEncoding }
  if ($LASTEXITCODE -ne 0) { Die '同步集成服务配置失败' }
  $cfg = Read-EnvFile $DistEnv
  if (-not $cfg.GITEA_TOKEN -or -not $cfg.OPENLIST_TOKEN) { Die 'dist/.env 中缺少 Token，请检查服务器 /data/platform/.env' }
  Good "已指向 $($cfg.GITEA_URL) / $($cfg.OPENLIST_URL) / $($cfg.CODE_SERVER_URL)"
}

function Start-NativeSetup {
  Step '安装 Windows 原生集成服务（无需 Docker / WSL）'
  $script = Join-Path $PSScriptRoot 'native-services.ps1'
  if (-not (Test-Path -LiteralPath $script)) { Die "缺少 $script" }
  # PowerShell 5.1 对带 CmdletBinding 的脚本用「数组 splatting」会把 -Action 误当成参数值，
  # 这里统一用 hashtable splatting，参数绑定稳定。
  $h = @{
    Action = 'setup'; Root = $Root; Port = $Port; IdeMode = $IdeMode
    GiteaVersion = $GiteaVersion; OpenListVersion = $OpenListVersion
  }
  $bundledBin = Join-Path $PSScriptRoot 'bin'
  $bundled = @()
  foreach ($f in @('gitea.exe', 'openlist.exe', 'code-tunnel.exe')) {
    if (Test-Path -LiteralPath (Join-Path $bundledBin $f)) { $bundled += $f }
  }
  if ($bundled.Count -gt 0) {
    $mb = 0
    foreach ($f in $bundled) { $mb += (Get-Item -LiteralPath (Join-Path $bundledBin $f)).Length }
    Good "发行包已自带集成服务程序：$($bundled -join ' / ')（$([math]::Round($mb / 1MB)) MB）"
    if (-not $BinDir) { $h.BinDir = $bundledBin }
    if (-not $NoDownload -and $bundled.Count -eq 3) {
      $h.NoDownload = $true
      Good '三项齐全，启用纯离线安装（不访问任何下载源）'
    }
  }
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bootstrap\devplatform-services.zip')) {
    Good '检测到 windows\bootstrap\devplatform-services.zip，安装器会优先离线解压（无需联网）'
  }
  if ($BinDir) { $h.BinDir = $BinDir }
  if ($NoDownload) { $h.NoDownload = $true }
  if ($ForceEnv) { $h.ForceEnv = $true }
  if ($DryRun) { $h.DryRun = $true }
  if ($DownloadProxy) { $h.DownloadProxy = $DownloadProxy }
  if ($ProxyUrl) { $h.ProxyUrl = $ProxyUrl }
  & $script @h
  $cfg = Read-EnvFile $DistEnv
  if (-not $DryRun -and -not $cfg.GITEA_URL -and -not $cfg.OPENLIST_URL) {
    Warn 'dist/.env 未包含集成服务地址，请检查上方输出'
  }
}

function Ensure-Dist {
  if (Test-Path -LiteralPath $Exe) { Good "找到 $Exe"; return }
  Step '首次安装：获取 platform\dist 预构建程序包'
  $opt = @{
    Root          = $Root
    Dist          = $Dist
    Exe           = $Exe
    ZipPath       = $DistZip
    Url           = $DistUrl
    Repo          = $Repo
    Tag           = $ReleaseTag
    ProxyUrl      = $ProxyUrl
    Bootstrap     = (Join-Path $PSScriptRoot 'bootstrap\devplatform-dist.zip')
    DryRun        = [bool]$DryRun
    AllowDownload = (-not $SkipDistDownload)
  }
  if (Get-DistPackage -Opt $opt) {
    if (-not $DryRun -and -not (Test-Path -LiteralPath $Exe)) {
      Die "预构建包已处理，但仍未找到 $Exe；请检查包内是否含 devplatform.exe / bundle.cjs / public/"
    }
    return
  }
  $hints = @(
    "未能获取 $Exe。请任选一种方式后重跑：",
    '  1) 仓库维护者发布预构建包：git tag v0.2.0; git push origin v0.2.0（GitHub Actions 自动构建并发布 Release）',
    '  2) 内网/离线：在已有 dist 的机器执行 windows\pack-dist.ps1，把 zip 拷来后用 -DistZip <路径> 指定，或放入 windows\bootstrap\',
    '  3) 内网 HTTP 服务：-DistUrl http://<内网地址>/devplatform-dist.zip',
    '  4) 临时用 Node 构建：cd platform; npm ci; npm run build',
    '  5) 直接拷贝另一台机器的整个 platform\dist\ 目录（已有的 .env / data 会被自动保留）'
  ) -join "`n"
  Die $hints
}

function New-AutoStartVbs {
  $vbs = Join-Path $Dist 'autostart.vbs'
  $body = @(
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set sh = CreateObject("WScript.Shell")',
    'd = fso.GetParentFolderName(WScript.ScriptFullName)',
    'sh.CurrentDirectory = d',
    'r = fso.GetParentFolderName(fso.GetParentFolderName(d))',
    'svc = fso.BuildPath(r, "windows\native-services.ps1")',
    'mark = fso.BuildPath(r, "windows\runtime\services.json")',
    'If fso.FileExists(mark) And fso.FileExists(svc) Then',
    '  sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & svc & """ -Action start", 0, False',
    'End If',
    'p = fso.BuildPath(d, "devplatform.exe")',
    'sh.Run Chr(34) & p & Chr(34), 0, False'
  ) -join "`r`n"
  if ($DryRun) { Skip '生成 autostart.vbs（无窗口启动）'; return $vbs }
  [IO.File]::WriteAllText($vbs, $body + "`r`n", (New-Object 'System.Text.ASCIIEncoding'))
  return $vbs
}

function Register-AutoStart([string]$Vbs) {
  if ($NoService) { Warn '已指定 -NoService，跳过开机自启'; return }
  Step '配置开机自启'
  if ($DryRun) { Skip '注册登录计划任务 DevPlatform（失败则降级为启动文件夹快捷方式）'; return }
  try {
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Vbs + '"') -ErrorAction Stop
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" -ErrorAction Stop
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ErrorAction Stop
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
    Good "已注册登录计划任务 $TaskName"
    return
  } catch {
    Warn "计划任务不可用（$($_.Exception.Message)），改用启动文件夹"
  }
  try {
    $startup = [Environment]::GetFolderPath('Startup')
    $lnk = Join-Path $startup "$TaskName.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($lnk)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + $Vbs + '"'
    $shortcut.Save()
    Good "已创建启动项 $lnk"
  } catch { Warn "启动项创建失败，可手动运行 windows\\start.bat" }
}

function Start-Platform {
  Step '启动平台'
  if ($NoLaunch) { Warn '已指定 -NoLaunch，跳过启动'; return }
  if ($DryRun) { Skip "启动 $Exe 并打开 http://localhost:$Port"; return }
  $running = Get-Process 'devplatform' -ErrorAction SilentlyContinue
  if ($running) { Good '平台已在运行，跳过重复启动' }
  else {
    Start-Process -FilePath $Exe -WorkingDirectory $Dist -WindowStyle Hidden
    Good '平台已启动（后台无窗口）'
  }
  $healthy = Wait-Http '平台' "http://localhost:$Port/api/health" 40
  if ($healthy) { Start-Process "http://localhost:$Port" }
  else { Warn '健康检查未通过，请查看 platform\\dist 下的日志或手动运行 windows\\start.bat' }
}

function Show-Summary([string]$ActualMode) {
  Step '安装完成'
  $cfg = Read-EnvFile $DistEnv
  $gitea = if ($cfg.GITEA_URL) { $cfg.GITEA_URL } else { "http://localhost:$GiteaPort" }
  $openlist = if ($cfg.OPENLIST_URL) { $cfg.OPENLIST_URL } else { 'http://localhost:5244' }
  $ide = if ($cfg.CODE_SERVER_URL) { $cfg.CODE_SERVER_URL } else { 'http://localhost:8080' }
  if ($DryRun -and ($ActualMode -eq 'local' -or $ActualMode -eq 'native')) {
    $gitea = "http://localhost:$GiteaPort"
    $openlist = 'http://localhost:5244'
    $ide = 'http://localhost:8080'
  }
  Write-Host "    模式        : $ActualMode" -ForegroundColor White
  Write-Host "    控制台      : http://localhost:$Port" -ForegroundColor White
  if ($ActualMode -eq 'remote') { Write-Host '    集成服务    : 复用已部署服务器（本机无服务进程）' -ForegroundColor DarkGray }
  elseif ($ActualMode -eq 'native') {
    Write-Host '    集成服务    : Windows 原生 exe（windows\runtime，无需 Docker）' -ForegroundColor DarkGray
    $src = '联网下载 / 已有本机二进制'
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bin\gitea.exe')) { $src = '随发行包自带（纯离线安装）' }
    elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bootstrap\devplatform-services.zip')) { $src = '离线补充包 devplatform-services.zip（纯离线安装）' }
    Write-Host "    服务来源    : $src" -ForegroundColor DarkGray
    Write-Host "    在线 IDE    : $(if ($IdeMode -eq 'none') { '未启用' } elseif ($IdeMode -eq 'wsl') { 'WSL code-server（自行安装）' } else { 'VS Code serve-web' })" -ForegroundColor DarkGray
  } else { Write-Host '    集成服务    : Docker 容器（gitea / openlist / code-server）' -ForegroundColor DarkGray }
  Write-Host "    Gitea       : $gitea" -ForegroundColor White
  Write-Host "    OpenList    : $openlist" -ForegroundColor White
  Write-Host "    code-server : $ide" -ForegroundColor White
  Write-Host "    配置文件    : $DistEnv" -ForegroundColor White
  Write-Host "    开机自启    : $(if ($NoService) { '未启用' } else { "计划任务/启动项 $TaskName" })" -ForegroundColor White
  Write-Host ''
  Write-Host '    管理：start.bat 启动 | stop.bat 停止 | uninstall.ps1 卸载' -ForegroundColor DarkGray
  Write-Host '    改 .env 后必须完全重启 exe（reload 不重读配置）' -ForegroundColor DarkGray
}

Write-Host 'DevPlatform · Windows 一键安装' -ForegroundColor Cyan
Write-Host "安装目录: $Root" -ForegroundColor DarkGray
if ($DryRun) { Write-Host '模式: DRY-RUN（不修改任何系统状态）' -ForegroundColor Yellow }

Ensure-Dist

if ($Mode -eq 'auto') {
  if (Test-Docker) {
    $Mode = 'local'
    Good '检测到可用的 Docker，采用本机完整安装模式'
  } elseif ($RemoteHost -or ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $StateFile))) {
    $Mode = 'remote'
    Warn '本机没有可用的 Docker，自动切换为「复用已部署服务器」模式'
    Warn '若希望三个服务完全跑在本机且不需要 Docker，请加 -Mode native 重跑'
  } else {
    $Mode = 'native'
    Warn '本机没有 Docker，也没有已登记的服务器'
    Good '自动切换为「Windows 原生服务」模式：Gitea/OpenList 用官方 Windows exe，IDE 用 VS Code serve-web'
  }
}

if ($Mode -eq 'local' -and -not (Test-Docker) -and -not $DryRun) {
  Step '检查 Docker Desktop'
  if ($InstallDocker) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { Die 'winget 不可用，请手动安装 Docker Desktop: https://www.docker.com/products/docker-desktop/' }
    if ($DryRun) { Skip 'winget install --id Docker.DockerDesktop' }
    else {
      Invoke-Native 'winget' @('install', '--id', 'Docker.DockerDesktop', '-e', '--accept-source-agreements', '--accept-package-agreements') | Out-Null
      Warn 'Docker Desktop 安装后需重启 / 重新登录一次；完成后重新运行本脚本'
      return
    }
  } else {
    Die '本机 local 模式需要 Docker Desktop。可加 -InstallDocker 尝试自动安装、加 -Mode remote 复用已有服务器，或改用 -Mode native（无需 Docker）'
  }
}

if ($Mode -eq 'local') {
  $cfg = New-RootEnv
  $tokens = Start-LocalServices $cfg
  Write-LocalDistEnv $tokens
} elseif ($Mode -eq 'native') {
  Start-NativeSetup
} else {
  Start-RemoteServices
  $cfg = Read-EnvFile $DistEnv
  if ($cfg.GITEA_URL -match ':(\d+)/?$') { $GiteaPort = [int]$Matches[1] }
}

$vbs = New-AutoStartVbs
Register-AutoStart $vbs
Start-Platform
Show-Summary $Mode
