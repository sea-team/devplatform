@echo off
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%windows\install.bat" (
  echo   ERROR: windows\install.bat not found.
  echo   Please re-download the full package from GitHub Releases.
  exit /b 1
)
call "%ROOT%windows\install.bat" %*
endlocal
