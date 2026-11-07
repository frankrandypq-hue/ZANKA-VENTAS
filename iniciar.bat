@echo off
title Servidor ZANKA
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b)
node server.js
pause
