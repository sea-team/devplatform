@echo off
setlocal
set "ROOT=%~dp0.."
set "DIST=%ROOT%\platform\dist"
if not exist "%DIST%\devplatform.exe" (
  echo   ERROR: devplatform.exe not found in %DIST%
  echo   Run windows\install.bat first - it downloads the prebuilt package automatically.
  echo   Or copy platform\dist from another machine, or build with: cd platform; npm run build
  exit /b 1
)
if exist "%ROOT%\windows\runtime\services.json" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%\windows\native-services.ps1" -Action start >nul 2>&1
)
cd /d "%DIST%"
start "DevPlatform" /min devplatform.exe
echo   DevPlatform started in background: http://localhost:9000
endlocal
