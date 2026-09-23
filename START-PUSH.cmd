@echo off
chcp 65001 >nul
cd /d "%~dp0cloudflare-push"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
call npm ci --no-fund --no-audit
if errorlevel 1 goto failed
node setup.mjs
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo Setup stopped. Read the error above. You can run this command again.
pause
exit /b 1
