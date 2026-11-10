<#
  DevPlatform · 生成可分发预构建包（供无 Node 的机器 git clone 后一键安装）
  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-dist.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\pack-dist.ps1 -Output D:\share\devplatform-dist.zip
  GitHub Actions 用同一个脚本打包，保证 zip 结构与安装器解压逻辑一致。
  只包含 devplatform.exe / bundle.cjs / release.json / public/，
  绝不包含 .env、data/、workspace/、state.json 等本机状态与凭据。
#>
[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Dist = '',
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# PowerShell 7 / CI 里该类型默认已可用；5.1 需要显式加载程序集。
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }

if (-not $Dist) { $Dist = Join-Path $Root 'platform\dist' }
if (-not $Output) { $Output = Join-Path (Join-Path $Root 'windows\bootstrap') 'devplatform-dist.zip' }
$outDir = Split-Path -Parent $Output
if (-not $outDir) { $outDir = (Get-Location).Path; $Output = Join-Path $outDir $Output }
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$required = @('devplatform.exe', 'bundle.cjs', 'release.json')
foreach ($f in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $Dist $f))) {
    throw "缺少 $Dist\$f；请先在含 Node 的机器执行 cd platform; npm ci; npm run build"
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $Dist 'public'))) { throw "缺少 $Dist\public" }

if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
$stage = Join-Path $env:TEMP ('dp-pack-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
  foreach ($f in $required) { Copy-Item -LiteralPath (Join-Path $Dist $f) -Destination $stage -Force }
  Copy-Item -LiteralPath (Join-Path $Dist 'public') -Destination (Join-Path $stage 'public') -Recurse -Force
  # 用 .NET ZipFile 而非 Compress-Archive：条目路径严格相对 stage，安装器能直接解压到 dist/
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $Output, [System.IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLower()
# 统一写 LF，保证 sha256sum -c 在 Git Bash / WSL / Linux 下可直接读取。
$sumFile = Join-Path $outDir 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sumFile, "$hash  $([IO.Path]::GetFileName($Output))`n", (New-Object 'System.Text.UTF8Encoding' $false))
$size = [Math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 1)
Write-Host "[pack] $Output ($size MB)" -ForegroundColor Green
Write-Host "[pack] SHA256 $hash" -ForegroundColor DarkGray
Write-Host "[pack] $sumFile" -ForegroundColor DarkGray
