@echo off
chcp 65001 >nul
title taufran-draw-web + Cloudflare Tunnel
cd /d ""%~dp0""

echo ╔══════════════════════════════════════════╗
echo ║    taufran-draw-web  公网启动器          ║
echo ║    (Cloudflare Tunnel)                   ║
echo ╚══════════════════════════════════════════╝
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 node，请先安装 Node.js
    pause
    exit /b 1
)

where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 bin\cloudflared.exe
    pause
    exit /b 1
)

echo [1/2] 正在启动本地服务...
start "" /B cmd /c ""node server.js""
timeout /t 3 >nul

echo [2/2] 正在启动 Cloudflare 隧道...
bin\cloudflared.exe tunnel --url http://localhost:5178

pause