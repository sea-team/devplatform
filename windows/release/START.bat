@echo off
setlocal
set "ROOT=%~dp0"
set "DIST=%ROOT%platform\dist"
if not exist "%DIST%\devplatform.exe" (
  echo   ERROR: devplatform.exe not found in %DIST%
  echo   Please re-download the full package from GitHub Releases.
  exit /b 1
)
if exist "%ROOT%windows\runtime\services.json" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%windows\native-services.ps1" -Action start >nul 2>&1
)
cd /d "%DIST%"
start "DevPlatform" /min devplatform.exe
echo.
echo   DevPlatform is starting: http://localhost:9000
echo   First launch extracts embedded files into platform\dist - please wait a few seconds.
timeout /t 3 >nul
start "" http://localhost:9000
echo.
echo   Stop: STOP.bat      Full setup with integrations: INSTALL.bat
echo.
endlocal
