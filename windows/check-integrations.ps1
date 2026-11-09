<#
  DevPlatform · 集成服务状态检查

  由 START.bat / windows\start.bat 在启动控制台前调用，也可单独运行：
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1 -StartNative
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\check-integrations.ps1 -Json

  作用：
    1. 读取 platform\dist\.env（回退根 .env / 进程环境变量）里的三个服务地址
    2. 用 TCP 连接快速探测每个地址是否在线（单个 1.2 秒超时）
    3. 判断 windows\runtime\services.json 是否存在 = 本机原生集成服务是否已安装
    4. -StartNative 时，若已安装则先拉起本机原生服务再检测
    5. 打印明确结论与下一步操作，避免「START.bat 启动了但集成服务离线」的困惑

  退出码：0 = 三项全部在线；2 = 至少一项离线（启动脚本不会因此中断）。
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [switch]$StartNative,
  [switch]$Json
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
try { $Root = (Resolve-Path -LiteralPath $Root).Path } catch { }

$DistEnv   = Join-Path $Root 'platform\dist\.env'
$RootEnv   = Join-Path $Root '.env'
$Services  = Join-Path $Root 'windows\runtime\services.json'
$NativePs1 = Join-Path $Root 'windows\native-services.ps1'

function Read-EnvFile([string]$File) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $File)) { return $map }
  foreach ($line in [IO.File]::ReadAllLines($File)) {
    if ($line -match '^\s*(#|$)') { continue }
    $m = [regex]::Match($line, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$')
    if (-not $m.Success) { continue }
    $v = $m.Groups[2].Value
    if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$m.Groups[1].Value] = $v
  }
  return $map
}

$cfg = Read-EnvFile $RootEnv
$distMap = Read-EnvFile $DistEnv
foreach ($k in $distMap.Keys) { $cfg[$k] = $distMap[$k] }
foreach ($k in @('GITEA_URL', 'OPENLIST_URL', 'CODE_SERVER_URL', 'GITEA_TOKEN', 'OPENLIST_TOKEN')) {
  $v = [Environment]::GetEnvironmentVariable($k)
  if ($v) { $cfg[$k] = $v }
}

function Get-Cfg([string]$Key, [string]$Fallback) {
  if ($cfg.ContainsKey($Key) -and $cfg[$Key]) { return [string]$cfg[$Key] }
  return $Fallback
}

function Test-Endpoint([string]$Url) {
  $client = $null
  try {
    $text = $Url
    if ($text -notmatch '^[A-Za-z]+://') { $text = 'http://' + $text }
    $u = [Uri]$text
    $hostName = $u.Host
    $port = [int]$u.Port
    if ($port -le 0) { $port = $(if ($u.Scheme -eq 'https') { 443 } else { 80 }) }
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($hostName, $port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(1200, $false)
    return ($ok -and $client.Connected)
  } catch {
    return $false
  } finally {
    if ($client) { try { $client.Close() } catch { } }
  }
}

$nativeInstalled = (Test-Path -LiteralPath $Services)

if ($StartNative -and $nativeInstalled -and (Test-Path -LiteralPath $NativePs1)) {
  if (-not $Json) { Write-Host '  检测到已安装的本机原生服务，正在拉起...' -ForegroundColor Cyan }
  # 用独立进程调用：native-services.ps1 内部出错时会 exit，避免连带终止本脚本。
  $psiArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $NativePs1,
               '-Action', 'start', '-Root', $Root)
  & powershell.exe @psiArgs | Out-Host
}

$items = @(
  [pscustomobject]@{ Name = 'Gitea';    Key = 'GITEA_URL';       Token = 'GITEA_TOKEN';    Url = (Get-Cfg 'GITEA_URL'       'http://localhost:3002') },
  [pscustomobject]@{ Name = 'OpenList'; Key = 'OPENLIST_URL';    Token = 'OPENLIST_TOKEN'; Url = (Get-Cfg 'OPENLIST_URL'    'http://localhost:5244') },
  [pscustomobject]@{ Name = 'Web IDE';  Key = 'CODE_SERVER_URL'; Token = '';              Url = (Get-Cfg 'CODE_SERVER_URL' 'http://localhost:8080') }
)
foreach ($it in $items) {
  $it | Add-Member -NotePropertyName Online -NotePropertyValue (Test-Endpoint $it.Url) -Force
  $it | Add-Member -NotePropertyName HasToken -NotePropertyValue ([bool](Get-Cfg $it.Token '')) -Force
}

$online = @($items | Where-Object { $_.Online }).Count
$offNames = @($items | Where-Object { -not $_.Online } | ForEach-Object { $_.Name })
$cfgSource = if (Test-Path -LiteralPath $DistEnv) { 'platform\dist\.env' } elseif (Test-Path -LiteralPath $RootEnv) { '根 .env' } else { '内置默认值' }
$exitCode = $(if ($online -eq $items.Count) { 0 } else { 2 })

if ($Json) {
  $payload = [ordered]@{
    root            = $Root
    configSource    = $cfgSource
    nativeInstalled = $nativeInstalled
    onlineCount     = $online
    total           = $items.Count
    services        = @($items | ForEach-Object {
      [ordered]@{ name = $_.Name; url = $_.Url; online = $_.Online; hasToken = $_.HasToken }
    })
  }
  $payload | ConvertTo-Json -Depth 5
  exit $exitCode
}

Write-Host ''
Write-Host 'DevPlatform · 集成服务状态检查' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
foreach ($it in $items) {
  $state = if ($it.Online) { '在线  ' } else { '离线  ' }
  $color = if ($it.Online) { 'Green' } else { 'Yellow' }
  Write-Host ("  {0,-10} {1,-34} {2}" -f $it.Name, $it.Url, $state) -ForegroundColor $color
}
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host "  配置来源: $cfgSource" -ForegroundColor DarkGray
if ($nativeInstalled) {
  Write-Host '  本机原生服务: 已安装 (windows\runtime\services.json)' -ForegroundColor DarkGray
} else {
  Write-Host '  本机原生服务: 未安装 (未运行过 INSTALL.bat 的 native 模式)' -ForegroundColor DarkGray
}
Write-Host ''

if ($exitCode -eq 0) {
  Write-Host '  => 三项集成服务均已就绪，控制台会显示「在线」。' -ForegroundColor Green
} else {
  Write-Host ("  => 集成服务未完全就绪（{0}/{1} 在线；未就绪：{2}）" -f $online, $items.Count, ($offNames -join '、')) -ForegroundColor Yellow
  Write-Host '     控制台里这几项会显示「未配置 / 离线」，其它模块不受影响。' -ForegroundColor Yellow
  Write-Host ''
  if (-not $nativeInstalled) {
    Write-Host '     要本机集成服务 -> 双击 INSTALL.bat（首次下载 Gitea / OpenList 二进制）' -ForegroundColor White
  } else {
    Write-Host '     服务已装但没起来 -> 跑 windows\native-services.ps1 -Action status 查日志' -ForegroundColor White
  }
  Write-Host '     复用已有服务   -> 在 platform\dist\.env 填 URL / Token 并重启 exe' -ForegroundColor White
  Write-Host '     只用控制台     -> 忽略本提示，其它模块不受影响' -ForegroundColor White
}
Write-Host ''
exit $exitCode
