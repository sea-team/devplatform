<#
  DevPlatform · 准备「随发行包自带」的 Windows 集成服务二进制
  ------------------------------------------------------------------
  Gitea      : dl.gitea.com 官方 Windows amd64 exe（GitHub 镜像兜底）
  OpenList   : GitHub Release 的 windows-amd64 zip（多镜像 + lite 包兜底）
  在线 IDE   : VS Code 官方独立 CLI（code.exe），复制为 code-tunnel.exe

  产出目录默认 windows\bin\：
    gitea.exe / openlist.exe / code-tunnel.exe
    services-manifest.json   版本、来源、SHA256、大小（供安装器与校验使用）
    THIRD-PARTY.txt          上游项目、许可证与来源说明

  用法：
    powershell -ExecutionPolicy Bypass -File windows\fetch-services.ps1
    powershell -ExecutionPolicy Bypass -File windows\fetch-services.ps1 -RequireCore
    powershell -ExecutionPolicy Bypass -File windows\fetch-services.ps1 -OutDir D:\share\bin -Force
    powershell -ExecutionPolicy Bypass -File windows\fetch-services.ps1 -SkipIde -DownloadProxy https://ghfast.top/

  -RequireCore : Gitea / OpenList 任一缺失就报错（CI 发布时使用，避免发出「假全量包」）
  已存在且有效的文件默认跳过，可安全重复执行；二进制目录不入库（见 .gitignore）。
#>
[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$OutDir = '',
  [string]$GiteaVersion = '1.23.8',
  [string]$OpenListVersion = 'v4.2.6',
  [string]$DownloadProxy = 'https://ghfast.top/',
  [string]$ProxyUrl = '',
  [switch]$Force,
  [switch]$SkipIde,
  [switch]$RequireCore,
  [int]$Timeout = 420
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }

if (-not $OutDir) { $OutDir = Join-Path $Root 'windows\bin' }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

function Step($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Good($msg) { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

function Save-Download([string]$Url, [string]$Dest, [int]$Seconds) {
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force }
  $curl = Join-Path $env:WINDIR 'System32\curl.exe'
  if (Test-Path -LiteralPath $curl) {
    $a = @('-L', '--fail', '--silent', '--show-error', '--max-time', "$Seconds", '-o', $Dest, $Url)
    if ($ProxyUrl) { $a = @('-x', $ProxyUrl) + $a }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $curl @a 2>&1 | Out-Null } catch { }
    finally { $ErrorActionPreference = $prev }
    if (($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -gt 1024)) { return $true }
  }
  try {
    if ($ProxyUrl) { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Seconds -Proxy $ProxyUrl -ErrorAction Stop }
    else { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Seconds -ErrorAction Stop }
    return ((Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -gt 1024))
  } catch { return $false }
}

function Test-Pe([string]$Path, [int]$MinMb) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt ($MinMb * 1MB)) { return $false }
  $fs = $null
  try {
    $fs = [IO.File]::OpenRead($Path)
    $head = New-Object 'byte[]' 2
    if ($fs.Read($head, 0, 2) -ne 2) { return $false }
    return ($head[0] -eq 0x4D -and $head[1] -eq 0x5A)  # MZ
  } catch { return $false }
  finally { if ($fs) { $fs.Dispose() } }
}

# 从官方 zip 中提取 exe；Name 允许多个候选（VS Code CLI 里叫 code.exe）
function Install-FromZip([string]$Zip, [string[]]$Names, [string]$Target) {
  $tmp = Join-Path $OutDir ('unzip-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    Expand-Archive -LiteralPath $Zip -DestinationPath $tmp -Force -ErrorAction Stop
    foreach ($n in $Names) {
      $found = Get-ChildItem -LiteralPath $tmp -Filter "$n.exe" -Recurse -File | Select-Object -First 1
      if ($found) {
        Copy-Item -LiteralPath $found.FullName -Destination $Target -Force
        return $found.Name
      }
    }
    return ''
  } catch {
    Warn "解压失败：$($_.Exception.Message)"
    return ''
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-FileSha([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Resolve-Component([string]$Key, [string]$File, [int]$MinMb, [string[]]$Urls, [string[]]$Names, [string]$Source) {
  $target = Join-Path $OutDir $File
  if (-not $Force -and (Test-Pe $target $MinMb)) {
    Good "$Key 已存在 ($([math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)) MB)，跳过下载"
    return @{ ok = $true; file = $File; bytes = (Get-Item -LiteralPath $target).Length;
             sha256 = (Get-FileSha $target); source = 'local (already present)'; version = $Source }
  }
  if ($Force -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Force }

  $deadline = (Get-Date).AddMinutes(12)
  foreach ($url in $Urls) {
    if ((Get-Date) -gt $deadline) { Warn "$Key 下载总时长超过 12 分钟，停止重试"; break }
    Write-Host "    尝试: $url" -ForegroundColor DarkGray
    $isZip = [bool]($Names.Count -gt 0)
    $leaf = ($url -split '/')[-1]
    # update.code.visualstudio.com 以 /stable 结尾（302 到真实 zip），需给临时文件一个安全的 .zip 名
    if ($leaf -notmatch '^[A-Za-z0-9._-]+\.(zip|exe)$') { $leaf = (($Key -replace '\s', '') + '-download.zip') }
    $tmp = if ($isZip) { Join-Path $OutDir $leaf } else { $target }
    if (-not (Save-Download $url $tmp $Timeout)) { Warn "$Key 下载失败，尝试下一个源"; continue }
    if ($isZip) {
      $origin = Install-FromZip $tmp $Names $target
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      if (-not $origin) { Warn "$Key 压缩包里未找到 $($Names -join ' / ').exe，尝试下一个源"; continue }
      if (-not (Test-Pe $target $MinMb)) { Warn "$Key 解压出的文件无效，尝试下一个源"; continue }
      Good "$Key 已从 $origin 安装 ($([math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)) MB)"
    } else {
      if (-not (Test-Pe $target $MinMb)) { Warn "$Key 下载内容不是有效 exe，尝试下一个源"; continue }
      Good "$Key 下载完成 ($([math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)) MB)"
    }
    return @{ ok = $true; file = $File; bytes = (Get-Item -LiteralPath $target).Length;
             sha256 = (Get-FileSha $target); source = $url; version = $Source }
  }
  Warn "$Key 全部来源均失败"
  return @{ ok = $false; file = $File; bytes = 0; sha256 = ''; source = ''; version = $Source }
}

Write-Host 'DevPlatform · 准备随发行包自带的集成服务程序' -ForegroundColor Cyan
Write-Host "输出目录: $OutDir" -ForegroundColor DarkGray

# 1) Gitea（官方直链优先，GitHub 镜像兜底）
$giteaAsset = "gitea-$GiteaVersion-windows-4.0-amd64.exe"
$giteaGithub = "https://github.com/go-gitea/gitea/releases/download/v$GiteaVersion/$giteaAsset"
$giteaUrls = @("https://dl.gitea.com/gitea/$GiteaVersion/$giteaAsset")
if ($DownloadProxy) { $giteaUrls += ($DownloadProxy.TrimEnd('/') + '/' + $giteaGithub) }
$giteaUrls += $giteaGithub
Step 'Gitea 官方 Windows exe'
$gitea = Resolve-Component 'Gitea' 'gitea.exe' 40 $giteaUrls @() $GiteaVersion

# 2) OpenList（镜像优先；完整包与 lite 包都可用）
Step 'OpenList 官方 Windows zip'
$olMirrors = @()
if ($DownloadProxy) { $olMirrors += $DownloadProxy.TrimEnd('/') + '/' }
foreach ($m in @('https://ghfast.top/', 'https://ghproxy.net/', 'https://gh-proxy.com/',
                 'https://hub.gitmirror.com/', 'https://gh.llkk.cc/', 'https://ghproxy.cc/')) {
  if ($olMirrors -notcontains $m) { $olMirrors += $m }
}
$olMirrors += ''
$olBase = "https://github.com/OpenListTeam/OpenList/releases/download/$OpenListVersion/"
$olUrls = @()
foreach ($asset in @('openlist-windows-amd64.zip', 'openlist-windows-amd64-lite.zip')) {
  foreach ($m in $olMirrors) { $olUrls += ($m + $olBase + $asset) }
}
$openlist = Resolve-Component 'OpenList' 'openlist.exe' 30 $olUrls @('openlist') $OpenListVersion

# 3) VS Code 独立 CLI（code.exe -> code-tunnel.exe，用于 serve-web 在线 IDE）
$ide = @{ ok = $false; file = 'code-tunnel.exe'; bytes = 0; sha256 = ''; source = ''; version = 'vscode-cli-stable' }
if ($SkipIde) {
  Step 'VS Code CLI（已指定 -SkipIde，跳过）'
} else {
  Step 'VS Code 官方独立 CLI（在线 IDE）'
  # update.code.visualstudio.com 返回 302；Resolve-Component 会为 /stable 生成临时 .zip 名再解压
  $ide = Resolve-Component 'VS Code CLI' 'code-tunnel.exe' 8 @(
    'https://update.code.visualstudio.com/latest/cli-win32-x64/stable'
  ) @('code', 'code-tunnel') 'latest/stable'
}

# 4) 清单与第三方说明（随包分发，便于离线核对与合规追溯）
Step '生成二进制清单与第三方说明'
$components = @($gitea, $openlist, $ide)
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToString('s')
  platform    = 'windows-x64'
  note        = '随 DevPlatform 发行包分发的官方原版二进制，未经修改；SHA256 可用于离线校验'
  components  = @($components | ForEach-Object {
    [ordered]@{ name = $_.file; ok = $_.ok; version = $_.version; bytes = $_.bytes; sha256 = $_.sha256; source = $_.source }
  })
}
$manifestPath = Join-Path $OutDir 'services-manifest.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), (New-Object 'System.Text.UTF8Encoding' $false))
Good "已写入 $manifestPath"

$third = @(
  'DevPlatform 随包附带的第三方程序',
  '============================================================',
  '以下均为上游官方发布的原版 Windows x64 二进制，未做任何修改。',
  '具体版本号、下载地址与 SHA256 见同目录 services-manifest.json。',
  '',
  '1) gitea.exe',
  '   项目   : Gitea (https://github.com/go-gitea/gitea)',
  '   下载   : https://dl.gitea.com/gitea/ 或 GitHub Releases',
  '   许可证 : MIT（见上游仓库 LICENSE）',
  '',
  '2) openlist.exe',
  '   项目   : OpenList (https://github.com/OpenListTeam/OpenList)',
  '   下载   : GitHub Releases 的 openlist-windows-amd64.zip',
  '   许可证 : 见上游仓库 LICENSE；再分发请保留上游许可与源码获取方式',
  '',
  '3) code-tunnel.exe',
  '   来源   : Visual Studio Code 独立 CLI (code.exe)，仅重命名',
  '   下载   : https://update.code.visualstudio.com/latest/cli-win32-x64/stable',
  '   许可证 : MIT（Microsoft）；VS Code 名称与商标受 Microsoft 商标政策约束，',
  '            本包仅内嵌官方 CLI 用于 code serve-web，不修改、不冒用其品牌。',
  '',
  '这些文件只被 windows\install.ps1 / native-services.ps1 在用户主动运行',
  'INSTALL.bat 时复制到 windows\runtime\bin 并启动；START.bat 不会启动它们。',
  '若不需要集成服务，可直接删除 windows\bin 目录，不影响控制台功能。'
) -join "`r`n"
[IO.File]::WriteAllText((Join-Path $OutDir 'THIRD-PARTY.txt'), $third + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))
Good '已写入 THIRD-PARTY.txt'

Step '结果'
foreach ($c in $components) {
  $flag = if ($c.ok) { 'OK  ' } else { 'MISS' }
  Write-Host ("    {0} {1,-20} {2,8:N1} MB" -f $flag, $c.file, ($c.bytes / 1MB)) -ForegroundColor $(if ($c.ok) { 'Green' } else { 'Yellow' })
}
if ($RequireCore -and (-not $gitea.ok -or -not $openlist.ok)) {
  Die 'Gitea / OpenList 未能全部就绪（指定了 -RequireCore），本次不会发布缺少核心服务的全量包'
}
if (-not $ide.ok) { Warn 'VS Code CLI 未就绪；全量包仍可发布，在线 IDE 会回退到本机已装的 VS Code' }
Write-Host "    离线安装：windows\install.ps1 -Mode native -NoDownload（自动识别 $OutDir）" -ForegroundColor DarkGray
