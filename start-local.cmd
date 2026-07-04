@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
where pnpm >nul 2>nul || call corepack enable
call pnpm install || goto :error
call pnpm build || goto :error
start "Seatly" http://localhost:4200
call pnpm start
exit /b 0
:error
echo Failed to start Seatly.
pause
exit /b 1

