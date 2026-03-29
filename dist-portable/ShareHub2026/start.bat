@echo off
title ShareHub 2026
cd /d "%~dp0"

echo.
echo   ShareHub 2026 - Photo Sharing Server
echo   =====================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found!
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

:: Check .env
if not exist ".env" (
    echo First run - creating .env from template...
    copy .env.example .env >nul
    echo.
    echo IMPORTANT: Edit .env and set WATCH_FOLDER
    echo Then restart this script.
    echo.
    notepad .env
    pause
    exit /b 0
)

echo Starting server...
node server.js
pause
