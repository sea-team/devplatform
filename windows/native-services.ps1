<#
  DevPlatform Windows 原生集成服务（无 Docker / 无 WSL 也能用）
  ------------------------------------------------------------------
  Gitea      : 官方 Windows amd64 单文件 exe（SQLite，无需运行时）
  OpenList   : 官方 Windows amd64 zip 解压出的单文件 exe
  在线 IDE   : VS Code 自带的 code-tunnel.exe serve-web（Windows 原生 Web IDE）
               code-server 官方没有 Windows 版，此处用等价替代

  用法：
    powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action setup
    powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action start
    powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action stop
    powershell -ExecutionPolicy Bypass -File windows\native-services.ps1 -Action status

  setup 额外参数：-BinDir（额外离线目录）、-NoDownload、-IdeMode、
                  -ForceEnv、-GiteaVersion、-OpenListVersion、-DownloadProxy、-DryRun
  随包自带（无需 -BinDir / -NoDownload，安装器会自动识别）：
    windows\bin\gitea.exe / openlist.exe / code-tunnel.exe
    windows\bootstrap\devplatform-services.zip（轻量包用户的离线补充包）
  数据/日志/PID 全部在 windows\runtime\，该目录不入库。
#>
[CmdletBinding()]
param(
  [ValidateSet('setup', 'start', 'stop', 'status')][string]$Action = 'status',
  [string]$Root = '',
  [string]$BinDir = '',
  [switch]$NoDownload,
  [switch]$ForceEnv,
  [switch]$DryRun,
  [ValidateSet('auto', 'code', 'wsl', 'none')][string]$IdeMode = 'auto',
  [string]$GiteaVersion = '1.23.8',
  [string]$OpenListVersion = 'v4.2.6',
  [string]$DownloadProxy = 'https://ghfast.top/',
  [string]$ProxyUrl = '',
  [int]$Port = 9000,
  [int]$GiteaPort = 3002,
  [int]$OpenListPort = 5244,
  [int]$IdePort = 8080
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Runtime   = Join-Path $Root 'windows\runtime'
$Bin       = Join-Path $Runtime 'bin'
$GiteaHome = Join-Path $Runtime 'gitea'
$OlHome    = Join-Path $Runtime 'openlist'
$IdeHome   = Join-Path $Runtime 'ide'
$LogDir    = Join-Path $Runtime 'logs'
$Services  = Join-Path $Runtime 'services.json'
$PidsFile  = Join-Path $Runtime 'pids.txt'
$Dist      = Join-Path $Root 'platform\dist'
$DistEnv   = Join-Path $Dist '.env'
$RootEnv   = Join-Path $Root '.env'
$Workspace = Join-Path $Dist 'workspace'
$GiteaExe  = Join-Path $Bin 'gitea.exe'
$OlExe     = Join-Path $Bin 'openlist.exe'
$IdeExe    = Join-Path $Bin 'code-tunnel.exe'
# 发行包随附的官方二进制（只读来源，不写运行时状态）
$BundledBin = Join-Path $Root 'windows\bin'
$BundledZip = Join-Path $Root 'windows\bootstrap\devplatform-services.zip'
# setup 时按优先级填充：-BinDir > 随包 windows\bin > 已装好的 runtime\bin
$script:OfflineDirs = @()
# DryRun 下不解压离线补充包，用虚拟文件清单让预览也显示「离线安装」而非「将联网下载」
$script:OfflineVirtual = @()

function Step($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Skip($msg) { Write-Host "    [DRY]  $msg" -ForegroundColor DarkGray }

# PowerShell 5.1 + $ErrorActionPreference='Stop' 时，原生 exe 往 stderr 写任何内容
# 都会被当作 NativeCommandError 直接中止脚本（Gitea「user already exists」即如此）。
# 所有 CLI 调用统一走这里：临时降级为 Continue，吃掉 stderr 并保留退出码。
function Invoke-Cli([string]$Exe, [string[]]$CliArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = ''
  try { $out = (& $Exe @CliArgs 2>&1 | Out-String) }
  catch { $out = [string]$_.Exception.Message }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Code = $code; Output = [string]$out }
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

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
}

function Test-Port([int]$P) {
  $client = New-Object 'System.Net.Sockets.TcpClient'
  try {
    $r = $client.BeginConnect('127.0.0.1', $P, $null, $null)
    if (-not $r.AsyncWaitHandle.WaitOne(400, $false)) { return $false }
    return $client.Connected
  } catch { return $false }
  finally { $client.Close() }
}

function Wait-Http([string]$Name, [string]$Url, [int]$Seconds = 90) {
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
  Warn "$Name 在 $Seconds 秒内未就绪（平台仍可运行，该项会显示离线）"
  return $false
}

function Read-Pids {
  $map = @{}
  if (-not (Test-Path -LiteralPath $PidsFile)) { return $map }
  foreach ($line in (Get-Content -LiteralPath $PidsFile -Encoding ASCII)) {
    if ($line -match '^([a-z]+)=(\d+)$') { $map[$Matches[1]] = [int]$Matches[2] }
  }
  return $map
}

function Save-Pids([hashtable]$Map) {
  if ($DryRun) { return }
  $lines = @()
  foreach ($k in $Map.Keys) { $lines += "$k=$($Map[$k])" }
  if ($lines.Count -eq 0) { Remove-Item -LiteralPath $PidsFile -Force -ErrorAction SilentlyContinue }
  else { [IO.File]::WriteAllText($PidsFile, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.ASCIIEncoding')) }
}

function Read-Services {
  if (-not (Test-Path -LiteralPath $Services)) { return $null }
  try { return (Get-Content -LiteralPath $Services -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Save-Services([hashtable]$Obj) {
  if ($DryRun) { Skip '写入 windows\runtime\services.json（服务清单）'; return }
  $json = $Obj | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Services, $json, (New-Object 'System.Text.UTF8Encoding' $false))
}

# 下载：优先系统自带 curl.exe（自动读 http_proxy / https_proxy），回退 Invoke-WebRequest。
function Save-Download([string]$Url, [string]$Dest, [int]$Timeout = 180) {
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force }
  $curl = Join-Path $env:WINDIR 'System32\curl.exe'
  if (Test-Path -LiteralPath $curl) {
    $a = @('-L', '--fail', '--silent', '--show-error', '--max-time', "$Timeout", '-o', $Dest, $Url)
    if ($ProxyUrl) { $a = @('-x', $ProxyUrl) + $a }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $curl @a 2>&1 | Out-Null } catch { }
    finally { $ErrorActionPreference = $prev }
    if (($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -gt 1024)) { return $true }
  }
  try {
    if ($ProxyUrl) { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Timeout -Proxy $ProxyUrl -ErrorAction Stop }
    else { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Timeout -ErrorAction Stop }
    return ((Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -gt 1024))
  } catch { return $false }
}

# 从官方 zip 里挑出 <Name>.exe；离线目录里直接放 zip 也走这里，避免把压缩包当成 exe。
function Install-FromZip([string]$Zip, [string]$Name, [string]$Target) {
  $unzip = Join-Path $Runtime 'unzip-tmp'
  if (Test-Path -LiteralPath $unzip) { Remove-Item -LiteralPath $unzip -Recurse -Force }
  try {
    Expand-Archive -LiteralPath $Zip -DestinationPath $unzip -Force -ErrorAction Stop
    $found = Get-ChildItem -LiteralPath $unzip -Filter "$Name.exe" -Recurse -File | Select-Object -First 1
    if ($found) {
      Copy-Item -LiteralPath $found.FullName -Destination $Target -Force
      Good "$Name 已从压缩包安装 ($($found.Name))"
      return $true
    }
    Warn "$Name 压缩包里没有 $Name.exe"
  } catch { Warn "$Name 压缩包解压失败：$($_.Exception.Message)" }
  finally { Remove-Item -LiteralPath $unzip -Recurse -Force -ErrorAction SilentlyContinue }
  return $false
}

# 轻量包 / git clone 用户把 devplatform-services.zip 放进 windows\bootstrap\ 后，
# 自动解压成与全量包等价的离线二进制；全量包里 windows\bin 已有文件，此处直接跳过。
function Expand-BundledServices {
  if (-not (Test-Path -LiteralPath $BundledZip)) { return }
  $need = @()
  foreach ($f in @('gitea.exe', 'openlist.exe', 'code-tunnel.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Bin $f))) { $need += $f }
  }
  if ($need.Count -eq 0) { return }
  Step '解压随包附带的集成服务补充包'
  if ($DryRun) {
    Skip "解压 $BundledZip 到 $Bin"
    $script:OfflineVirtual = @('gitea.exe', 'openlist.exe', 'code-tunnel.exe')
    return
  }
  $tmp = Join-Path $Runtime 'services-unzip'
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  try {
    Expand-Archive -LiteralPath $BundledZip -DestinationPath $tmp -Force -ErrorAction Stop
    foreach ($f in @('gitea.exe', 'openlist.exe', 'code-tunnel.exe')) {
      if (Test-Path -LiteralPath (Join-Path $Bin $f)) { continue }
      $found = Get-ChildItem -LiteralPath $tmp -Filter $f -Recurse -File | Select-Object -First 1
      if ($found) {
        Copy-Item -LiteralPath $found.FullName -Destination (Join-Path $Bin $f) -Force
        Good "$f 已从离线补充包安装"
      }
    }
  } catch { Warn "集成服务补充包解压失败：$($_.Exception.Message)" }
  finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

function Install-BundledIde {
  if (Test-Path -LiteralPath $IdeExe) { return }
  if ($DryRun -and ($script:OfflineVirtual -contains 'code-tunnel.exe')) {
    Skip '从离线补充包安装 code-tunnel.exe（在线 IDE）'
    return
  }
  $src = Join-Path $BundledBin 'code-tunnel.exe'
  if (-not (Test-Path -LiteralPath $src)) { return }
  if ($DryRun) { Skip '复制随包自带的 code-tunnel.exe（在线 IDE）'; return }
  Copy-Item -LiteralPath $src -Destination $IdeExe -Force
  Good '在线 IDE 使用随包自带的 VS Code CLI（无需本机安装 VS Code）'
}

function Resolve-Binary([string]$Name, [string]$Target, [string[]]$Urls, [string[]]$ZipNames, [int]$Timeout = 120) {
  if (Test-Path -LiteralPath $Target) { Good "$Name 已存在，跳过下载"; return $true }
  if ($DryRun -and ($script:OfflineVirtual -contains "$Name.exe")) {
    Skip "从离线补充包安装 $Name.exe（$BundledZip）"
    return $true
  }
  $local = ''
  foreach ($dir in @($script:OfflineDirs)) {
    if (-not $dir) { continue }
    $candidates = @((Join-Path $dir "$Name.exe"), (Join-Path $dir $Name))
    foreach ($z in $ZipNames) { if ($z) { $candidates += (Join-Path $dir $z) } }
    foreach ($candidate in $candidates) {
      if (Test-Path -LiteralPath $candidate) { $local = $candidate; break }
    }
    if ($local) { break }
  }
  if ($local) {
    if ($DryRun) { Skip "从离线目录安装 $local"; return $true }
    if ($local -match '\.zip$') {
      if (Install-FromZip $local $Name $Target) { return $true }
      Warn "$local 解压失败，继续尝试其他来源"
    } else {
      Copy-Item -LiteralPath $local -Destination $Target -Force
      Good "$Name 已从离线目录安装"
      return $true
    }
  }
  if ($NoDownload) { Warn "$Name 缺失且指定了 -NoDownload；请把 $Name.exe 或官方 zip 放到 $(@($script:OfflineDirs) -join ' / ') 后重跑"; return $false }
  if ($DryRun) { Skip "下载 $Name（首选 $($Urls[0])）"; return $true }

  $deadline = (Get-Date).AddMinutes(8)
  foreach ($url in $Urls) {
    if ((Get-Date) -gt $deadline) { Warn "$Name 下载总时长超过 8 分钟，停止重试（可用 -BinDir 离线安装）"; break }
    Write-Host "    尝试: $url" -ForegroundColor DarkGray
    $tmp = if (($ZipNames.Count -gt 0) -and ($url -match '\.zip')) {
      $leaf = ($url -split '/')[-1]
      if ($leaf -notmatch '\.zip$') { $leaf = $ZipNames[0] }
      Join-Path $Runtime $leaf
    } else { $Target }
    if (Save-Download $url $tmp $Timeout) {
      if ($tmp -ne $Target) {
        if (Install-FromZip $tmp $Name $Target) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; return $true }
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Warn "$Name 尝试下一个源"
      } else {
        Good "$Name 下载完成 ($([math]::Round((Get-Item -LiteralPath $Target).Length / 1MB, 1)) MB)"
        return $true
      }
    } else { Warn "$Name 下载失败，尝试下一个源" }
  }
  Warn "$Name 全部下载源均失败"
  return $false
}

function Find-VsCodeTunnel {
  # 优先级：安装器已复制的 runtime\bin > 随包 windows\bin > 本机安装的 VS Code
  foreach ($p in @($IdeExe, (Join-Path $BundledBin 'code-tunnel.exe'))) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  $cmd = Get-Command code.cmd -ErrorAction SilentlyContinue
  if ($cmd) {
    $exe = Join-Path (Split-Path -Parent $cmd.Source) 'code-tunnel.exe'
    if (Test-Path -LiteralPath $exe) { return $exe }
  }
  foreach ($p in @(
      (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code-tunnel.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code-tunnel.exe'),
      (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft VS Code\bin\code-tunnel.exe'))) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return ''
}

function Get-IdePlan {
  if ($IdeMode -eq 'none') { Warn '已指定 -IdeMode none，跳过在线 IDE'; return $null }
  if ($IdeMode -eq 'wsl') {
    Warn '-IdeMode wsl：请在 WSL 发行版内自行安装 code-server 并监听 8080；脚本不接管其生命周期'
    return $null
  }
  $exe = Find-VsCodeTunnel
  if (-not $exe) {
    if ($IdeMode -eq 'code') { Warn '未找到 VS Code 的 code-tunnel.exe，在线 IDE 将不可用' }
    else { Warn '未找到 VS Code，且未启用 WSL；在线 IDE 将保持未配置（其余模块不受影响）' }
    return $null
  }
  Ensure-Dir $IdeHome
  $args = @('serve-web', '--host', '127.0.0.1', '--port', "$IdePort",
    '--without-connection-token', '--accept-server-license-terms', '--disable-telemetry',
    '--server-data-dir', $IdeHome, '--default-folder', $Workspace)
  return @{ kind = 'code'; exe = $exe; args = $args; workdir = (Split-Path -Parent $exe); port = $IdePort; enabled = $true }
}

# PowerShell 5.1 的 Start-Process 会构造一个大小写不敏感的环境变量字典；
# 若进程环境里同时存在 HTTPS_PROXY 与 https_proxy（装了代理工具时常见），
# 会直接抛「已添加项，字典中的关键字...」，导致任何子进程都起不来。
# 启动期间临时移除重复的「小写」键，结束后原样恢复。
function Invoke-WithoutDuplicateEnv([scriptblock]$Block) {
  $saved = @{}
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $envMap = [Environment]::GetEnvironmentVariables()
  $keys = @($envMap.Keys)
  foreach ($k in $keys) {
    $lower = $k.ToLowerInvariant()
    if (-not $seen.Add($lower)) {
      $saved[$k] = $envMap[$k]
      [Environment]::SetEnvironmentVariable($k, $null, 'Process')
    }
  }
  try { return & $Block }
  finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
  }
}

function Start-One([string]$Key, [hashtable]$Spec, [string]$HealthUrl, [int]$WaitSeconds) {
  $port = [int]$Spec.port
  $pids = Read-Pids
  if (Test-Port $port) {
    Good "$Key :$port 已有服务在监听，跳过启动"
    return $true
  }
  if ($DryRun) { Skip "启动 $Key（$($Spec.exe)）"; return $true }
  Ensure-Dir $LogDir
  $out = Join-Path $LogDir "$Key.out.log"
  $err = Join-Path $LogDir "$Key.err.log"
  $argList = @()
  foreach ($a in $Spec.args) { if ($a -match '\s') { $argList += '"' + $a + '"' } else { $argList += $a } }
  try {
    $proc = Invoke-WithoutDuplicateEnv {
      Start-Process -FilePath $Spec.exe -ArgumentList $argList -WorkingDirectory $Spec.workdir `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err -ErrorAction Stop
    }
    $pids[$Key] = [int]$proc.Id
    Save-Pids $pids
    Good "$Key 已启动 (PID $($proc.Id))，日志 $LogDir"
  } catch { Warn "$Key 启动失败：$($_.Exception.Message)"; return $false }
  if ($HealthUrl) { Wait-Http $Key $HealthUrl $WaitSeconds | Out-Null }
  return $true
}

function Stop-ProcessById([int]$Id) {
  if ($Id -le 0) { return $false }
  $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  Stop-Process -Id $Id -Force -Confirm:$false -ErrorAction SilentlyContinue
  return $true
}

function Test-OurProcess([int]$Id) {
  if ($Id -le 0) { return $false }
  $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($p -and $p.Path -and $p.Path.StartsWith($Runtime, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  try {
    $ci = Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
    if ($ci -and $ci.CommandLine -and $ci.CommandLine.IndexOf($Runtime, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  } catch { }
  return $false
}

function Stop-PortOwner([int]$P) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      $stopped = $false
      foreach ($c in $conns) {
        $id = [int]$c.OwningProcess
        if (Test-OurProcess $id) { Stop-ProcessById $id | Out-Null; $stopped = $true }
        else { Warn "端口 $P 被非本平台进程占用 (PID $id)，已跳过以免误杀" }
      }
      return $stopped
    }
  } catch { }
  return $false
}

function Test-RemoteUrl([string]$U) { return [bool]($U -and ($U -notmatch 'localhost|127\.0\.0\.1')) }

function Write-NativeDistEnv([hashtable]$Tokens, [bool]$GiteaOk, [bool]$OpenListOk, [bool]$IdeOk) {
  Step '生成 platform/dist/.env（无 Docker 本机配置）'
  $existing = Read-EnvFile $DistEnv

  # 逐组件决定：本机可用 → localhost；本机不可用但已有远程地址 → 保留远程；
  # 都没有 → localhost 占位（该项显示离线/未配置，但不影响平台其余模块）。
  # -ForceEnv 强制全部指向本机，便于验证或彻底脱离服务器。
  $gUrl = "http://localhost:$GiteaPort"
  $gToken = $Tokens.GiteaToken
  if (-not $ForceEnv -and -not $GiteaOk -and $existing.GITEA_TOKEN -and (Test-RemoteUrl $existing.GITEA_URL)) {
    $gUrl = $existing.GITEA_URL; $gToken = $existing.GITEA_TOKEN
    Warn 'Gitea 本机二进制不可用，保留已有远程 Gitea 配置（混合模式）'
  }
  $oUrl = "http://localhost:$OpenListPort"
  $oToken = $Tokens.OpenListToken
  $oPw = $Tokens.Password
  if (-not $ForceEnv -and -not $OpenListOk -and $existing.OPENLIST_URL -and (Test-RemoteUrl $existing.OPENLIST_URL)) {
    $oUrl = $existing.OPENLIST_URL
    $oToken = $existing.OPENLIST_TOKEN
    if ($existing.OPENLIST_PASSWORD) { $oPw = $existing.OPENLIST_PASSWORD }
    Warn 'OpenList 本机二进制不可用，保留已有远程 OpenList 配置（混合模式）'
  }
  $iUrl = "http://localhost:$IdePort"
  if (-not $ForceEnv -and -not $IdeOk -and (Test-RemoteUrl $existing.CODE_SERVER_URL)) {
    $iUrl = $existing.CODE_SERVER_URL
    Warn '本机在线 IDE 不可用，保留已有远程 IDE 地址'
  }

  $lines = @(
    '# 由 windows/native-services.ps1 生成；修改后需完全重启 devplatform.exe',
    "PORT=$Port",
    "GITEA_URL=$gUrl",
    "GITEA_TOKEN=$gToken",
    "OPENLIST_URL=$oUrl",
    "OPENLIST_TOKEN=$oToken",
    'OPENLIST_USER=admin',
    "OPENLIST_PASSWORD=$oPw",
    "CODE_SERVER_URL=$iUrl",
    "WORKSPACE_DIR=$Workspace",
    '# ADMIN_TOKEN=',
    'NO_PROXY=localhost,127.0.0.1'
  )
  if ($DryRun) { Skip '写入 dist/.env（逐组件地址 + Token）'; return }
  Ensure-Dir $Dist
  [IO.File]::WriteAllText($DistEnv, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))
  Good "已写入 $DistEnv"
}

function New-GiteaIni([string]$Pw) {
  $confDir = Join-Path $GiteaHome 'custom\conf'
  Ensure-Dir $confDir
  Ensure-Dir (Join-Path $GiteaHome 'data')
  Ensure-Dir (Join-Path $GiteaHome 'repositories')
  Ensure-Dir (Join-Path $GiteaHome 'logs')
  $ini = Join-Path $confDir 'app.ini'
  if (Test-Path -LiteralPath $ini) { Good 'Gitea app.ini 已存在，保留'; return $ini }
  $fwd = (Join-Path $GiteaHome 'data').Replace('\', '/')
  $repo = (Join-Path $GiteaHome 'repositories').Replace('\', '/')
  $logs = (Join-Path $GiteaHome 'logs').Replace('\', '/')
  $secret = New-Secret 40
  $text = @(
    'APP_NAME = DevPlatform Gitea',
    'RUN_MODE = prod',
    '',
    '[server]',
    'PROTOCOL = http',
    'DOMAIN = localhost',
    'HTTP_ADDR = 127.0.0.1',
    "HTTP_PORT = $GiteaPort",
    "ROOT_URL = http://localhost:$GiteaPort/",
    'DISABLE_SSH = true',
    'LFS_START_SERVER = false',
    'OFFLINE_MODE = true',
    '',
    '[database]',
    'DB_TYPE = sqlite3',
    "PATH = $fwd/gitea.db",
    '',
    '[repository]',
    "ROOT = $repo",
    '',
    '[security]',
    'INSTALL_LOCK = true',
    "SECRET_KEY = $secret",
    '',
    '[service]',
    'DISABLE_REGISTRATION = true',
    '',
    '[log]',
    'MODE = file',
    'LEVEL = warn',
    "ROOT_PATH = $logs"
  ) -join "`r`n"
  if ($DryRun) { Skip '生成 Gitea custom/conf/app.ini（SQLite + INSTALL_LOCK）' }
  else { [IO.File]::WriteAllText($ini, $text + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false)); Good 'Gitea app.ini 已生成' }
  return $ini
}

function Initialize-Gitea([string]$Ini, [string]$Pw) {
  if ($DryRun) { Skip '初始化 Gitea 数据库并创建 admin 用户'; return }
  Invoke-Cli $GiteaExe @('--config', $Ini, 'migrate') | Out-Null
  $r = Invoke-Cli $GiteaExe @('--config', $Ini, 'admin', 'user', 'create', '--admin', '--username', 'admin',
    '--password', $Pw, '--email', 'admin@example.com', '--must-change-password=false')
  if ($r.Output -match 'already exists|已存在') { Good 'Gitea 管理员已存在' }
  elseif ($r.Code -eq 0) { Good 'Gitea 管理员已创建' }
  else {
    $brief = if ($r.Output) { $r.Output.Trim() } else { '(无输出)' }
    if ($brief.Length -gt 160) { $brief = $brief.Substring(0, 160) }
    Warn "Gitea 管理员创建返回非零（若已存在可忽略）：$brief"
  }
}

function Get-GiteaToken([string]$Pw) {
  if ($DryRun) { return 'dry-run' }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("admin:$Pw"))
  $url = "http://127.0.0.1:$GiteaPort/api/v1/users/admin/tokens"
  foreach ($bodyObj in @(
      @{ name = "devplatform-$((Get-Date).ToString('yyyyMMddHHmmss'))"; scopes = @('all') },
      @{ name = "devplatform-$((Get-Date).ToString('yyyyMMddHHmmss'))" })) {
    try {
      $body = $bodyObj | ConvertTo-Json
      $resp = Invoke-RestMethod -Uri $url -Method Post -Headers @{ Authorization = "Basic $b64" } `
        -ContentType 'application/json' -Body $body -TimeoutSec 20 -ErrorAction Stop
      if ($resp.sha1) { Good 'Gitea 访问令牌已生成'; return [string]$resp.sha1 }
    } catch { }
  }
  Warn 'Gitea Token 生成失败（仓库模块不可用）；确认 admin 密码与 Gitea 已就绪'
  return ''
}

function Get-OpenListToken([string]$Pw) {
  if ($DryRun) { return 'dry-run' }
  Push-Location $OlHome
  try {
    Invoke-Cli $OlExe @('admin', 'set', $Pw) | Out-Null
    $out = (Invoke-Cli $OlExe @('admin', 'token')).Output
    if ($out -match 'Admin token:\s*(\S+)') { Good 'OpenList Admin Token 已获取'; return $Matches[1].Trim() }
    $brief = if ($out) { $out.Trim() } else { '(无输出)' }
    if ($brief.Length -gt 120) { $brief = $brief.Substring(0, 120) }
    Warn "未取得 OpenList Token，将回退到 OPENLIST_PASSWORD 登录（$brief）"
  } finally { Pop-Location }
  return ''
}

function Invoke-Setup {
  Step '准备无 Docker 原生运行环境'
  foreach ($d in @($Runtime, $Bin, $GiteaHome, $OlHome, $IdeHome, $LogDir, $Workspace)) {
    if ($DryRun) { } else { Ensure-Dir $d }
  }
  if ($DryRun) { Skip "运行目录 $Runtime（将创建）" } else { Good "运行目录 $Runtime" }

  # 离线来源优先级：显式 -BinDir > 随包 windows\bin > 已装好的 runtime\bin
  $script:OfflineDirs = @()
  if ($BinDir) { $script:OfflineDirs += $BinDir }
  $script:OfflineDirs += $BundledBin
  $script:OfflineDirs += $Bin
  Expand-BundledServices
  Install-BundledIde
  $bundled = @()
  foreach ($f in @('gitea.exe', 'openlist.exe', 'code-tunnel.exe')) {
    if (Test-Path -LiteralPath (Join-Path $BundledBin $f)) { $bundled += $f }
  }
  if ($bundled.Count -gt 0) {
    Good "检测到随包自带的集成服务程序（$($bundled -join ' / ')），无需联网下载"
  }

  $rootCfg = Read-EnvFile $RootEnv
  $pw = $rootCfg.OPENLIST_PASSWORD
  if (-not $pw) {
    $pw = New-Secret 20
    if ($DryRun) { Skip '生成随机管理员密码并写入根 .env' }
    else { Set-EnvValue $RootEnv 'OPENLIST_PASSWORD' $pw; Good '已生成随机管理员密码并写入根 .env' }
  }

  $giteaFile = "gitea-$GiteaVersion-windows-4.0-amd64.exe"
  $giteaDirect = "https://dl.gitea.com/gitea/$GiteaVersion/$giteaFile"
  $giteaGithub = "https://github.com/go-gitea/gitea/releases/download/v$GiteaVersion/$giteaFile"
  $giteaProxy = if ($DownloadProxy) { $DownloadProxy.TrimEnd('/') + '/' + $giteaGithub } else { $giteaGithub }
  $giteaOk = Resolve-Binary -Name 'gitea' -Target $GiteaExe -Urls @($giteaDirect, $giteaProxy, $giteaGithub) -ZipNames @() -Timeout 420

  # 官方同时提供完整版与 lite 版；网络受限时可只放任一 zip 到 -BinDir 离线安装。
  $olZip = 'openlist-windows-amd64.zip'
  $olLite = 'openlist-windows-amd64-lite.zip'
  $olBase = "https://github.com/OpenListTeam/OpenList/releases/download/$OpenListVersion/"
  $olSources = @()
  $mirrors = @()
  if ($DownloadProxy) { $mirrors += $DownloadProxy.TrimEnd('/') + '/' }
  # 实测 ghfast.top 对 GitHub release 最稳（其余源常见超时 / 截断），故排在最前。
  foreach ($m in @('https://ghfast.top/', 'https://ghproxy.net/', 'https://gh-proxy.com/',
                   'https://hub.gitmirror.com/', 'https://gh.llkk.cc/', 'https://ghproxy.cc/')) {
    if ($mirrors -notcontains $m) { $mirrors += $m }
  }
  $mirrors += ''
  foreach ($asset in @($olZip, $olLite)) {
    $direct = $olBase + $asset
    foreach ($p in $mirrors) { $olSources += ($(if ($p) { $p + $direct } else { $direct })) }
  }
  $olOk = Resolve-Binary -Name 'openlist' -Target $OlExe -Urls $olSources -ZipNames @($olZip, $olLite) -Timeout 120

  $ide = Get-IdePlan

  $ini = New-GiteaIni $pw
  if ($giteaOk) { Initialize-Gitea $ini $pw }
  else { Warn 'Gitea 二进制不可用，跳过初始化（可离线放置后重跑 -Action setup）' }

  $plan = @{
    mode = 'native'; installedAt = (Get-Date).ToString('s')
    giteaPort = $GiteaPort; openlistPort = $OpenListPort; idePort = $IdePort
    gitea = @{}
    openlist = @{}
    ide = @{}
  }
  if ($giteaOk) {
    $plan.gitea = @{ enabled = $true; exe = $GiteaExe; args = @('--config', $ini, 'web');
                     workdir = $GiteaHome; port = $GiteaPort }
  } else { $plan.gitea = @{ enabled = $false; port = $GiteaPort } }
  if ($olOk) {
    $plan.openlist = @{ enabled = $true; exe = $OlExe; args = @('server');
                        workdir = $OlHome; port = $OpenListPort }
  } else { $plan.openlist = @{ enabled = $false; port = $OpenListPort } }
  if ($ide) { $plan.ide = $ide } else { $plan.ide = @{ enabled = $false; port = $IdePort; kind = 'none' } }

  Save-Services $plan

  Step '启动原生集成服务'
  if ($giteaOk) { Start-One 'gitea' $plan.gitea "http://127.0.0.1:$GiteaPort/api/v1/version" 90 | Out-Null }
  if ($olOk) { Start-One 'openlist' $plan.openlist "http://127.0.0.1:$OpenListPort/api/public/settings" 90 | Out-Null }
  if ($ide) { Start-One 'ide' $plan.ide "http://127.0.0.1:$IdePort/healthz" 120 | Out-Null }

  Step '初始化访问凭据'
  $gToken = ''
  $oToken = ''
  if ($giteaOk -and -not $DryRun -and (Test-Port $GiteaPort)) {
    $gToken = Get-GiteaToken $pw
    Set-EnvValue $RootEnv 'GITEA_TOKEN' $gToken
  } elseif ($DryRun) { $gToken = 'dry-run' }
  if ($olOk -and -not $DryRun -and (Test-Port $OpenListPort)) {
    $oToken = Get-OpenListToken $pw
    Set-EnvValue $RootEnv 'OPENLIST_TOKEN' $oToken
  } elseif ($DryRun) { $oToken = 'dry-run' }

  Write-NativeDistEnv @{ GiteaToken = $gToken; OpenListToken = $oToken; Password = $pw } ([bool]$giteaOk) ([bool]$olOk) ([bool]$ide)

  Step '无 Docker 安装完成'
  $final = Read-EnvFile $DistEnv
  Write-Host "    Gitea      : $(if ($giteaOk) { "http://localhost:$GiteaPort (原生 exe)" } else { "$($final.GITEA_URL) (复用/未配置)" })" -ForegroundColor White
  Write-Host "    OpenList   : $(if ($olOk) { "http://localhost:$OpenListPort (原生 exe)" } else { "$($final.OPENLIST_URL) (复用/未配置)" })" -ForegroundColor White
  Write-Host "    在线 IDE   : $(if ($ide) { "http://localhost:$IdePort (VS Code serve-web)" } else { "$($final.CODE_SERVER_URL) (复用/未配置)" })" -ForegroundColor White
  Write-Host "    工作区     : $Workspace" -ForegroundColor White
  Write-Host '    管理：windows\start.bat / stop.bat / native-services.ps1 -Action status' -ForegroundColor DarkGray
}

function Invoke-Start {
  $plan = Read-Services
  if (-not $plan) { Write-Host '    未安装原生服务（windows\runtime\services.json 不存在），跳过' -ForegroundColor DarkGray; return }
  foreach ($pair in @(@('gitea', 'gitea'), @('openlist', 'openlist'), @('ide', 'ide'))) {
    $key = $pair[0]
    $spec = $plan.($pair[1])
    if (-not $spec -or -not $spec.enabled) { continue }
    $h = @{}
    foreach ($p in $spec.PSObject.Properties) { $h[$p.Name] = $p.Value }
    $url = ''
    if ($key -eq 'gitea') { $url = "http://127.0.0.1:$([int]$spec.port)/api/v1/version" }
    if ($key -eq 'openlist') { $url = "http://127.0.0.1:$([int]$spec.port)/api/public/settings" }
    if ($key -eq 'ide') { $url = "http://127.0.0.1:$([int]$spec.port)/healthz" }
    Start-One $key $h $url 45 | Out-Null
  }
}

function Invoke-Stop {
  $pids = Read-Pids
  foreach ($k in @('ide', 'openlist', 'gitea')) {
    if ($pids.ContainsKey($k)) { Stop-ProcessById $pids[$k] | Out-Null; $pids.Remove($k) }
  }
  Save-Pids $pids
  $plan = Read-Services
  if ($plan) {
    foreach ($p in @($plan.ide.port, $plan.openlist.port, $plan.gitea.port)) {
      if ($p) { Stop-PortOwner ([int]$p) | Out-Null }
    }
  }
  Good '原生集成服务已停止'
}

function Invoke-Status {
  $plan = Read-Services
  if (-not $plan) { Write-Host '    未安装原生服务（未执行过 -Mode native）' -ForegroundColor DarkGray; return }
  $pids = Read-Pids
  foreach ($k in @('gitea', 'openlist', 'ide')) {
    $spec = $plan.$k
    $port = if ($spec -and $spec.port) { [int]$spec.port } else { 0 }
    $pidValue = if ($pids.ContainsKey($k)) { $pids[$k] } else { 0 }
    $alive = if ($port -gt 0) { Test-Port $port } else { $false }
    Write-Host ("    {0,-10} port={1,-6} pid={2,-8} {3}" -f $k, $port, $pidValue, $(if ($alive) { 'LISTENING' } else { 'STOPPED' })) -ForegroundColor $(if ($alive) { 'Green' } else { 'DarkGray' })
  }
}

Write-Host 'DevPlatform · Windows 原生集成服务（无 Docker）' -ForegroundColor Cyan
if ($DryRun) { Write-Host '模式: DRY-RUN（不下载、不启动、不写文件）' -ForegroundColor Yellow }
switch ($Action) {
  'setup'  { Invoke-Setup }
  'start'  { Invoke-Start }
  'stop'   { Invoke-Stop }
  'status' { Invoke-Status }
}
