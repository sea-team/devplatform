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
echo.
echo   [1/2] Checking integration services (Gitea / OpenList / online IDE)...
if exist "%ROOT%\windows\check-integrations.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\windows\check-integrations.ps1" -StartNative
) else (
  if exist "%ROOT%\windows\runtime\services.json" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\windows\native-services.ps1" -Action start
  )
  echo   NOTE: integrations are NOT installed automatically; run windows\install.bat.
)
echo.
echo   [2/2] Starting DevPlatform console: http://localhost:9000
cd /d "%DIST%"
start "DevPlatform" /min devplatform.exe
echo.
echo   START.bat = console only. INSTALL.bat / windows\install.bat = with integrations.
if exist "%ROOT%\windows\bin\gitea.exe" (
  echo   Bundled service binaries found - INSTALL.bat works fully offline.
) else (
  echo   No bundled binaries - INSTALL.bat downloads them on first run.
)
echo   Stop: STOP.bat / windows\stop.bat
echo.
endlocal
