@echo off
setlocal
set "JAVA_HOME=%LOCALAPPDATA%\jdks\jdk-17.0.20+8"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
cd /d "%~dp0"
call gradlew.bat assembleRelease %*
