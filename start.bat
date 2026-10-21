@echo off
chcp 65001 >nul
title taufran-draw-web (本地服务)
cd /d ""%~dp0""

echo ╔══════════════════════════════════════════╗
echo ║    taufran-draw-web  本地启动器          ║
echo ╚══════════════════════════════════════════╝
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 node，请先安装 Node.js
    pause
    exit /b 1
)

for /f ""tokens=*"" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%
echo [端口] 5178
echo [地址] http://127.0.0.1:5178/
echo.
echo 按 Ctrl+C 可停止服务
echo ----------------------------------------
echo.

node server.js

pause