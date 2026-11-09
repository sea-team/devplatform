<#
  DevPlatform · 生成「GitHub Release 直接下载使用」的发行资产
  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1 -OutputDir D:\share
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-release.ps1 -Dist D:\build\dist -OutputDir D:\share

  产出（都在 -OutputDir）：
    devplatform-dist.zip     组件包，供 git clone 后的安装器自动下载（保持兼容）
    devplatform-windows.zip  完整绿色包；START.bat 只启动控制台，
                             INSTALL.bat 才安装 Gitea / OpenList / 在线 IDE
    devplatform.exe          独立自包含单文件，放到任意空目录双击即可运行
    SHA256SUMS.txt           以上三个文件的哈希

  绝不打包 .env、data\、workspace\、state.json、windows\runtime\ 等本机状态与凭据。
#>
[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Dist = '',
  [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# PowerShell 7 / CI 里该类型默认已可用；5.1 需要显式加载程序集。
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }

if (-not $Dist) { $Dist = Join-Path $Root 'platform\dist' }
if (-not $OutputDir) { $OutputDir = Join-Path $PSScriptRoot 'bootstrap' }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

function Copy-BatCrlf([string]$Src, [string]$DestDir) {
  # CI checkout 可能把 .bat 转成 LF；cmd.exe 对 LF 的括号块解析不稳，这里统一回 CRLF。
  $text = [IO.File]::ReadAllText($Src, [Text.Encoding]::ASCII)
  $text = $text -replace "`r`n", "`n"
  $text = $text -replace "`n", "`r`n"
  [IO.File]::WriteAllText((Join-Path $DestDir ([IO.Path]::GetFileName($Src))), $text, [Text.Encoding]::ASCII)
}

$WinDir = Join-Path $Root 'windows'
$Template = Join-Path $PSScriptRoot 'release'
$required = @('devplatform.exe', 'bundle.cjs', 'release.json')
foreach ($f in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $Dist $f))) {
    throw "缺少 $Dist\$f；请先在含 Node 的机器执行 cd platform; npm ci; npm run build"
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $Dist 'public\index.html'))) { throw "缺少 $Dist\public\index.html" }
if (-not (Test-Path -LiteralPath $Template)) { throw "缺少发行模板目录 $Template" }

# 1) 组件包（clone 用户由 install.ps1 自动下载；已存在则复用）
$distZip = Join-Path $OutputDir 'devplatform-dist.zip'
if (-not (Test-Path -LiteralPath $distZip)) {
  & (Join-Path $PSScriptRoot 'pack-dist.ps1') -Root $Root -Dist $Dist -Output $distZip | Out-Null
  if (-not (Test-Path -LiteralPath $distZip)) { throw '生成 devplatform-dist.zip 失败' }
}

# 2) 独立自包含 exe（Release 单资产，可直接下载双击）
$exeOut = Join-Path $OutputDir 'devplatform.exe'
Copy-Item -LiteralPath (Join-Path $Dist 'devplatform.exe') -Destination $exeOut -Force

# 3) 完整绿色包：platform\dist + windows 脚本 + scripts + 顶层快捷入口
$fullZip = Join-Path $OutputDir 'devplatform-windows.zip'
if (Test-Path -LiteralPath $fullZip) { Remove-Item -LiteralPath $fullZip -Force }
$stage = Join-Path $env:TEMP ('dp-release-' + [guid]::NewGuid().ToString('N'))
$base = Join-Path $stage 'DevPlatform'
New-Item -ItemType Directory -Path $base -Force | Out-Null
try {
  $targetDist = Join-Path $base 'platform\dist'
  New-Item -ItemType Directory -Path $targetDist -Force | Out-Null
  foreach ($f in $required) {
    Copy-Item -LiteralPath (Join-Path $Dist $f) -Destination $targetDist -Force
  }
  Copy-Item -LiteralPath (Join-Path $Dist 'public') -Destination (Join-Path $targetDist 'public') -Recurse -Force

  $targetWin = Join-Path $base 'windows'
  New-Item -ItemType Directory -Path $targetWin -Force | Out-Null
  foreach ($pattern in @('*.ps1', '*.bat')) {
    Get-ChildItem -LiteralPath $WinDir -File -Filter $pattern | ForEach-Object {
      if ($pattern -eq '*.bat') { Copy-BatCrlf $_.FullName $targetWin }
      else { Copy-Item -LiteralPath $_.FullName -Destination $targetWin -Force }
    }
  }
  # 保留离线包投放目录，便于内网用户把 devplatform-dist.zip 放进来
  $boot = Join-Path $targetWin 'bootstrap'
  New-Item -ItemType Directory -Path $boot -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $boot '.gitkeep'), '', (New-Object 'System.Text.UTF8Encoding' $false))

  $scripts = Join-Path $Root 'scripts'
  if (Test-Path -LiteralPath $scripts) {
    Copy-Item -LiteralPath $scripts -Destination (Join-Path $base 'scripts') -Recurse -Force
  }
  $envExample = Join-Path $Root '.env.example'
  if (Test-Path -LiteralPath $envExample) {
    Copy-Item -LiteralPath $envExample -Destination $base -Force
  }
  foreach ($f in @('START.bat', 'INSTALL.bat', 'STOP.bat', 'README-RELEASE.txt')) {
    $src = Join-Path $Template $f
    if (-not (Test-Path -LiteralPath $src)) { throw "缺少发行模板 $src" }
    if ($f.EndsWith('.bat')) { Copy-BatCrlf $src $base }
    else { Copy-Item -LiteralPath $src -Destination $base -Force }
  }

  # includeBaseDirectory=true：解压后得到整齐的 DevPlatform\ 文件夹
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $base, $fullZip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# 4) 汇总校验文件（覆盖 pack-dist.ps1 写的单文件版本）
$lines = @()
foreach ($f in @($distZip, $fullZip, $exeOut)) {
  $hash = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
  $lines += "$hash  $([IO.Path]::GetFileName($f))"
}
$sums = Join-Path $OutputDir 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sums, ($lines -join "`r`n") + "`r`n", (New-Object 'System.Text.UTF8Encoding' $false))

$release = Get-Content -LiteralPath (Join-Path $Dist 'release.json') -Raw | ConvertFrom-Json
Write-Host "[release] 版本 v$($release.version) · 输出目录 $OutputDir" -ForegroundColor Green
foreach ($f in @($distZip, $fullZip, $exeOut)) {
  Write-Host ("[release] {0,-28} {1,8:N1} MB" -f ([IO.Path]::GetFileName($f)), ((Get-Item -LiteralPath $f).Length / 1MB)) -ForegroundColor DarkGray
}
Write-Host "[release] 校验文件 $sums" -ForegroundColor DarkGray
