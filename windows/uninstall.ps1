<#
  DevPlatform Windows 卸载 / 清理脚本
    powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1 -RemoveContainers
    powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1 -RemoveConfig -Force
  默认保留数据：workspace/、data/、Docker 卷均不删除。
#>
[CmdletBinding()]
param(
  [switch]$RemoveContainers,
  [switch]$RemoveConfig,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root 'platform\dist'
$TaskName = 'DevPlatform'

function Good($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

Write-Host 'DevPlatform · Windows 卸载' -ForegroundColor Cyan

$running = Get-Process 'devplatform' -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force -Confirm:$false
  Good "已停止 $($running.Count) 个平台进程"
} else { Warn '没有运行中的平台进程' }

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Good "已删除计划任务 $TaskName"
  }
} catch { Warn "计划任务删除失败：$($_.Exception.Message)" }

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) "$TaskName.lnk"
if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force; Good '已删除启动项' }

if ($RemoveContainers) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    Push-Location $Root
    try {
      & docker compose down 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { Good '已停止并移除集成服务容器（数据卷保留）' }
      else { & docker-compose down 2>&1 | Out-Null; Warn '已尝试 docker-compose down' }
    } finally { Pop-Location }
  } else { Warn '未找到 docker，跳过容器清理' }
} else { Warn '未指定 -RemoveContainers，集成服务容器保持运行' }

if ($RemoveConfig) {
  if (-not $Force) { Warn '删除配置需显式 -Force（避免误删凭据），本次已跳过' }
  else {
    foreach ($f in @((Join-Path $Root '.env'), (Join-Path $Dist '.env'), (Join-Path $Dist 'autostart.vbs'))) {
      if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; Good "已删除 $f" }
    }
  }
}

Write-Host ''
Write-Host '  数据保留：workspace/、data/、Docker 卷。如需彻底清理请手动删除。' -ForegroundColor DarkGray
Write-Host '  重新安装：双击 windows\install.bat' -ForegroundColor DarkGray
