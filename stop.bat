@echo off
setlocal
pushd "%~dp0"
title Stop Kiro-Claude-Bridge

set "NODE_BIN="
if exist "%~dp0runtime\node.exe" (
    set "NODE_BIN=%~dp0runtime\node.exe"
) else (
    where node >nul 2>nul
    if not errorlevel 1 set "NODE_BIN=node"
)

if "%NODE_BIN%"=="" (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

echo ========================================================
echo   Stopping all Kiro-Claude-Bridge services...
echo ========================================================
echo.
"%NODE_BIN%" "%~dp0scripts\stop.js"
echo.
pause
popd
