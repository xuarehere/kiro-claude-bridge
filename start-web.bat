@echo off
setlocal
pushd "%~dp0"
title Kiro-Claude-Bridge Launcher

set "NODE_BIN="
if exist "%~dp0runtime\node.exe" (
    set "NODE_BIN=%~dp0runtime\node.exe"
) else (
    where node >nul 2>nul
    if not errorlevel 1 set "NODE_BIN=node"
)

if "%NODE_BIN%"=="" (
    echo [ERROR] Node.js ^>= 18 is required.
    echo         Download Node.js from https://nodejs.org/ or use the Portable Release ZIP.
    pause
    exit /b 1
)

echo ========================================================
echo   Starting Kiro-Claude-Bridge Web Dashboard and Proxy...
echo ========================================================
echo.
"%NODE_BIN%" "%~dp0src\index.js" --open %*
if errorlevel 1 (
    echo.
    echo [WARN] Kiro-Claude-Bridge exited with code %errorlevel%.
    pause
)
popd
