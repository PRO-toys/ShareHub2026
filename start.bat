@echo off
title ShareHub 2026
echo.
echo   ShareHub 2026 - Standalone Photo Sharing Server
echo   ================================================
echo.

cd /d "%~dp0"

:: Check if node is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found! Install from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if dist exists (compiled)
if exist "dist\index.js" (
    echo Starting compiled version...
    node dist/index.js
) else if exist "src\index.ts" (
    echo Starting dev version (tsx)...
    npx tsx src/index.ts
) else (
    echo ERROR: No index.js or index.ts found!
    pause
    exit /b 1
)

pause
