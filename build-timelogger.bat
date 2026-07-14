@echo off
setlocal
cd /d "%~dp0"

if not defined VITE_BASE_PATH set VITE_BASE_PATH=/timelogger/

call npm run build
if errorlevel 1 exit /b 1

rem シンレンタル用: 静的成果物に API と data を同梱
xcopy /E /I /Y api dist\api >nul
xcopy /E /I /Y data dist\data >nul

echo.
echo Build OK: dist\ をサーバの %VITE_BASE_PATH% にアップロードしてください。
echo AI 用ログ例: https://あなたのドメイン%VITE_BASE_PATH%data/events.json
endlocal
