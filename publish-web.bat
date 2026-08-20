@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-web.ps1"
echo.
pause
