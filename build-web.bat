@echo off
setlocal
REM Production build for the web server.
REM Creates deploy layout in build\timelogger\ and emits build\timelogger.zip.
REM Extract the zip at the web root to get /timelogger/.
REM NOTE: data\ is for the FIRST deploy only. Never overwrite live data\ (records would be lost).
cd /d %~dp0

set VITE_BASE_PATH=/timelogger/
call npm run build
if errorlevel 1 (
  echo build failed
  exit /b 1
)

if exist build\timelogger rmdir /s /q build\timelogger
mkdir build\timelogger

xcopy /e /i /y dist build\timelogger >nul
xcopy /e /i /y api build\timelogger\api >nul
xcopy /e /i /y data build\timelogger\data >nul

if exist build\timelogger.zip del build\timelogger.zip
powershell -NoProfile -Command "Compress-Archive -Path 'build\timelogger' -DestinationPath 'build\timelogger.zip' -Force"
if errorlevel 1 (
  echo zip failed
  exit /b 1
)

echo.
echo OK: build\timelogger.zip
echo   NOTE: do not overwrite data\ on the server after the first deploy
endlocal
