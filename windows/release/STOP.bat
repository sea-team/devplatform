@echo off
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%windows\stop.bat" (
  echo   ERROR: windows\stop.bat not found.
  exit /b 1
)
call "%ROOT%windows\stop.bat"
endlocal
