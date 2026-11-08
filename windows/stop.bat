@echo off
taskkill /IM devplatform.exe /F >nul 2>&1
if errorlevel 1 (
  echo   No running devplatform.exe process found.
) else (
  echo   DevPlatform stopped.
)
