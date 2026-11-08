@echo off
chcp 65001 >nul 2>&1
title DevPlatform Windows Installer
echo.
echo   DevPlatform - Windows one-click installer
echo   -------------------------------------------
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
if errorlevel 1 (
  echo   Installer reported an error. Please read the messages above.
) else (
  echo   Finished. Open http://localhost:9000 in your browser.
)
echo.
if "%~1"=="" pause
