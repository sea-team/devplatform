@echo off
setlocal
set "ROOT=%~dp0"
set "DIST=%ROOT%platform\dist"
if not exist "%DIST%\devplatform.exe" (
  echo   ERROR: devplatform.exe not found in %DIST%
  echo   Please re-download the full package from GitHub Releases.
  exit /b 1
)

echo.
echo   [1/3] Checking integration services (Gitea / OpenList / online IDE)...
if exist "%ROOT%windows\check-integrations.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%windows\check-integrations.ps1" -StartNative
) else (
  if exist "%ROOT%windows\runtime\services.json" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%windows\native-services.ps1" -Action start
  )
  echo   NOTE: integrations are NOT installed automatically; run INSTALL.bat.
)

echo.
echo   [2/3] Starting DevPlatform console (this does NOT install integrations)...
cd /d "%DIST%"
start "DevPlatform" /min devplatform.exe
echo.
echo   [3/3] Opening http://localhost:9000
echo         First launch extracts embedded files into platform\dist - wait a few seconds.
timeout /t 3 >nul
start "" http://localhost:9000
echo.
echo   ------------------------------------------------------------
echo   START.bat   = console only, integrations stay offline.
echo   INSTALL.bat = console + Gitea / OpenList / online IDE + autostart.
if exist "%ROOT%windows\bin\gitea.exe" (
  echo   Bundled service binaries found in windows\bin - INSTALL.bat is fully offline.
) else (
  echo   Lite package: INSTALL.bat downloads service binaries on first run.
)
echo   Stop: STOP.bat
echo   ------------------------------------------------------------
echo.
endlocal
