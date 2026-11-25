@echo off
setlocal
pushd "%~dp0.."
title Restore Original Settings (Zero Pollution)

set "ROOT_DIR=%CD%"
set "NODE_BIN="
if exist "%ROOT_DIR%\runtime\node.exe" (
    set "NODE_BIN=%ROOT_DIR%\runtime\node.exe"
) else (
    where node >nul 2>nul
    if not errorlevel 1 set "NODE_BIN=node"
)

if "%NODE_BIN%"=="" (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

"%NODE_BIN%" "%ROOT_DIR%\scripts\restore.js"
echo.
pause
popd
