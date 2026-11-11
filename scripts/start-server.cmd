@echo off
rem Run Geulbeot server; logs appended to logs\server.log
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

rem Skip if a server is already listening on port 5174
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 exit /b 0

set "NODE_EXE=node.exe"
where node.exe >nul 2>&1 || set "NODE_EXE=C:\Program Files\nodejs\node.exe"

echo ===== %DATE% %TIME% : server start ===== >> "logs\server.log"
"%NODE_EXE%" server.js >> "logs\server.log" 2>&1
echo ===== %DATE% %TIME% : server exit (code %ERRORLEVEL%) ===== >> "logs\server.log"
