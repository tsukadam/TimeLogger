@echo off
setlocal
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
set "APK=%~dp0app\build\outputs\apk\release\app-release.apk"
if not exist "%APK%" (
  echo APK がありません。先に build.bat を実行してください。
  exit /b 1
)
adb devices
adb install -r "%APK%"
if errorlevel 1 (
  echo.
  echo ウォッチが adb に出ていません。ウォッチで開発者向けオプションを開き、
  echo 無線デバッグを ON にしてペアリングポートとコードを出してください。
  echo   adb pair IP:ペアリングポート
  echo   adb connect IP:接続ポート
  echo そのあと、もう一度 install.bat を実行します。
  exit /b 1
)
adb shell am start -n com.timelogger.wear/.MainActivity
