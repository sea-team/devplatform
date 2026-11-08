@echo off
setlocal
set "ROOT=%~dp0.."
taskkill /IM devplatform.exe /F >nul 2>&1
if errorlevel 1 (
  echo   No running devplatform.exe process found.
) else (
  echo   DevPlatform stopped.
)
if exist "%ROOT%\windows\runtime\services.json" (
  echo   Stopping native integration services...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%\windows\native-services.ps1" -Action stop
)
endlocal
