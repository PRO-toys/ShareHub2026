@echo off
echo Stopping ShareHub2026...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3200" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)
echo Done.
timeout /t 2
