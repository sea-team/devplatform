<#
  DevPlatform · 预构建包获取模块
  仅定义函数，由 windows/install.ps1 dot-source 引用；不修改全局状态，便于单独测试。
  负责：git clone 后 dist/ 为空时，从本地 zip/目录、内网 URL 或 GitHub Release 获取
  devplatform.exe + bundle.cjs + public/ + release.json，并校验、解压到 platform/dist/。
#>

# PowerShell 7 / CI 里该类型默认已可用；5.1 需要显式加载程序集。
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }

function Dp-Info($msg) { Write-Host "    [dist] $msg" -ForegroundColor Cyan }
function Dp-Ok($msg) { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Dp-Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }

# 下载单个文件：优先系统 curl.exe（自动读 http_proxy/https_proxy），失败回退 Invoke-WebRequest。
# 不抛异常、不改调用方的 $ErrorActionPreference：原生命令 stderr 在 Stop 模式下会变成终止错误。
function Dp-Download([string]$Url, [string]$Dest, [string]$ProxyUrl, [int]$Timeout = 300, [int]$MinSize = 65536) {
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $curl = Join-Path $env:WINDIR 'System32\curl.exe'
    if (Test-Path -LiteralPath $curl) {
      $a = @('-L', '--fail', '--silent', '--show-error', '--retry', '2',
             '--max-time', "$Timeout")
      if ($ProxyUrl) { $a += @('-x', $ProxyUrl) }
      # 内网 / 本机地址不要走系统代理（代理工具常会截断大文件或返回 504 页面）
      if ($Url -match '^https?://(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
        $a += @('--noproxy', '*')
      }
      $a += @('-o', $Dest, $Url)
      try { & $curl @a 2>&1 | Out-Null } catch { }
      if (($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $Dest) -and
          ((Get-Item -LiteralPath $Dest).Length -ge $MinSize)) { return $true }
    }
    try {
      if ($ProxyUrl) { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Timeout -Proxy $ProxyUrl -ErrorAction Stop }
      else { Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $Timeout -ErrorAction Stop }
      return ((Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -ge $MinSize))
    } catch { return $false }
  } finally { $ErrorActionPreference = $prev }
}

# 结构校验：压缩包里必须有一个体积合理的 devplatform.exe，避免把 504 页面/HTML 当包解压。
function Dp-TestZip([string]$Zip) {
  try {
    if (-not (Test-Path -LiteralPath $Zip)) { return $false }
    $z = [System.IO.Compression.ZipFile]::OpenRead($Zip)
    try {
      foreach ($e in $z.Entries) {
        if (($e.FullName -match '(^|/)devplatform\.exe$') -and ($e.Length -gt 10MB)) { return $true }
      }
      return $false
    } finally { $z.Dispose() }
  } catch { return $false }
}

# 可选校验：同一目录下的 SHA256SUMS.txt。取不到就跳过（内网镜像常只放 zip），不阻断安装。
function Dp-Verify([string]$Zip, [string]$Url, [string]$ProxyUrl, [string]$Work) {
  $sumUrl = $Url -replace 'devplatform-dist\.zip(\?.*)?$', 'SHA256SUMS.txt'
  if ($sumUrl -eq $Url) { return $true }
  $sum = Join-Path $Work 'SHA256SUMS.txt'
  if (-not (Dp-Download $sumUrl $sum $ProxyUrl 45 1)) {
    Dp-Warn '未取到 SHA256SUMS.txt，跳过哈希校验（仍会校验包结构）'
    return $true
  }
  $expect = ''
  foreach ($line in (Get-Content -LiteralPath $sum)) {
    if ($line -match '^\s*([0-9a-fA-F]{64})\s') { $expect = $Matches[1].ToLower(); break }
  }
  if (-not $expect) { Dp-Warn 'SHA256SUMS.txt 格式不符，跳过校验'; return $true }
  $actual = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expect) { Dp-Warn 'SHA256 不匹配，拒绝使用这个包'; return $false }
  Dp-Ok 'SHA256 校验通过'
  return $true
}

# 把已解压/已有的目录内容复制进 dist/，保护本机已有的配置与数据不被覆盖。
function Dp-CopyPayload([string]$SrcDir, [string]$Dist) {
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $SrcDir 'devplatform.exe'))) { return $false }
    if (-not (Test-Path -LiteralPath $Dist)) { New-Item -ItemType Directory -Path $Dist -Force | Out-Null }
    $keep = @('.env', 'data', 'workspace', 'state.json', 'autostart.vbs', 'logs')
    foreach ($item in Get-ChildItem -LiteralPath $SrcDir -Force) {
      if ($keep -contains $item.Name) { continue }
      Copy-Item -LiteralPath $item.FullName -Destination $Dist -Recurse -Force
    }
    return (Test-Path -LiteralPath (Join-Path $Dist 'devplatform.exe'))
  } catch {
    Dp-Warn "复制预构建包失败：$($_.Exception.Message)"
    return $false
  }
}

function Dp-InstallZip([string]$Zip, [string]$Dist) {
  $tmp = Join-Path $env:TEMP ('dp-unpack-' + [guid]::NewGuid().ToString('N'))
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $tmp)
    $exe = Get-ChildItem -LiteralPath $tmp -Filter 'devplatform.exe' -Recurse -File | Select-Object -First 1
    if (-not $exe) { Dp-Warn '压缩包内没有 devplatform.exe'; return $false }
    return (Dp-CopyPayload $exe.Directory.FullName $Dist)
  } catch {
    Dp-Warn "解压失败：$($_.Exception.Message)"
    return $false
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 主入口：$Opt 为 hashtable，键：
#   Exe / Dist / Root / ZipPath / Url / Repo / Tag / ProxyUrl / Bootstrap / DryRun / AllowDownload
# 返回 $true（dist 已就绪或 DryRun）或 $false（需要调用方报错）。
function Get-DistPackage([hashtable]$Opt) {
  $exe = [string]$Opt.Exe
  $dist = [string]$Opt.Dist
  if (Test-Path -LiteralPath $exe) { Dp-Ok "找到 $exe"; return $true }

  Dp-Info 'platform\dist 为空（git clone 后属正常：构建产物按设计不入库）'
  if ([bool]$Opt.DryRun) { Dp-Info 'DRY-RUN：仅打印计划，不下载、不解压'; return $true }

  $zipPath = [string]$Opt.ZipPath
  $bootstrap = [string]$Opt.Bootstrap
  $url = [string]$Opt.Url
  $repo = [string]$Opt.Repo
  $tag = [string]$Opt.Tag
  $proxy = [string]$Opt.ProxyUrl
  $allow = [bool]$Opt.AllowDownload
  $work = Join-Path $env:TEMP ('dp-dist-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work -Force | Out-Null

  try {
    # 1) 显式指定的本地 zip 或已构建好的 dist 目录；指定失败就不再自动下载，避免误取旧版本。
    if ($zipPath) {
      if (-not (Test-Path -LiteralPath $zipPath)) {
        Dp-Warn "-DistZip 指向的路径不存在：$zipPath"
        return $false
      }
      $item = Get-Item -LiteralPath $zipPath
      if ($item.PSIsContainer) {
        if (Dp-CopyPayload $item.FullName $dist) { Dp-Ok "已从目录 $zipPath 复制"; return $true }
        Dp-Warn "$zipPath 里没有 devplatform.exe"
        return $false
      }
      if (-not (Dp-TestZip $item.FullName)) { Dp-Warn "$zipPath 不是有效的预构建包"; return $false }
      if (Dp-InstallZip $item.FullName $dist) { Dp-Ok "已从 $zipPath 解压"; return $true }
      return $false
    }

    # 2) 仓库内自带的离线包（内网机器最省事：把 zip 丢进 windows\bootstrap\ 即可）
    if ($bootstrap -and (Test-Path -LiteralPath $bootstrap) -and (Dp-TestZip $bootstrap)) {
      if (Dp-InstallZip $bootstrap $dist) { Dp-Ok "已使用离线包 $bootstrap"; return $true }
    }

    # 3) 自定义 URL / GitHub Release（多镜像自动回退）
    $candidates = @()
    if ($url) {
      $candidates += $url
    } elseif ($allow) {
      if (-not $repo) { $repo = 'sea-team/devplatform' }
      if (-not $tag -or $tag -eq 'latest') { $asset = 'latest/download/devplatform-dist.zip' }
      else { $asset = "download/$tag/devplatform-dist.zip" }
      $gh = "https://github.com/$repo/releases/$asset"
      # ghfast.top 为 2026-11 实测唯一能完整下载 48 MB 包的源，放首位
      $candidates += @("https://ghfast.top/$gh", $gh, "https://gh-proxy.com/$gh",
                       "https://hub.gitmirror.com/$gh", "https://ghproxy.net/$gh")
    } else {
      Dp-Warn '已指定 -SkipDistDownload，跳过自动下载'
    }

    $downloaded = Join-Path $work 'devplatform-dist.zip'
    foreach ($u in $candidates) {
      Dp-Info "尝试下载 $u"
      if (-not (Dp-Download $u $downloaded $proxy 300)) { Dp-Warn '下载失败，换下一个源'; continue }
      if (-not (Dp-TestZip $downloaded)) { Dp-Warn '文件不是有效预构建包（可能被代理截断），换下一个源'; continue }
      if (-not (Dp-Verify $downloaded $u $proxy $work)) { continue }
      if (Dp-InstallZip $downloaded $dist) { Dp-Ok "已从 $u 获取预构建包"; return $true }
      Dp-Warn '解压失败，换下一个源'
    }
    return $false
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
