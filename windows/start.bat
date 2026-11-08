@echo off
setlocal
set "DIST=%~dp0..\platform\dist"
if not exist "%DIST%\devplatform.exe" (
  echo   ERROR: devplatform.exe not found in %DIST%
  echo   Run windows\install.bat first, or build with: cd platform then npm run build
  exit /b 1
)
cd /d "%DIST%"
start "DevPlatform" /min devplatform.exe
echo   DevPlatform started in background: http://localhost:9000
endlocal
