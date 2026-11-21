@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.13+ is required. Get it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing Duck dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your connection and the error above.
    pause
    exit /b 1
  )
)
echo Open http://localhost:8080 in your browser after Duck starts.
call npm start
pause
