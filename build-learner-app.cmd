@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
set "APK_PATH=%PROJECT_DIR%android\app\build\outputs\apk\debug\app-debug.apk"

echo.
echo ========================================
echo   EchoLoop 学习端 Android APP 打包
echo ========================================
echo.

cd /d "%PROJECT_DIR%" || goto :project_error

where node >nul 2>nul || goto :node_error
where npm >nul 2>nul || goto :node_error
where java >nul 2>nul || goto :java_error

if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_SDK_ROOT if defined ANDROID_HOME set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
if not defined ANDROID_HOME goto :android_error
if not exist "%ANDROID_HOME%\platform-tools" goto :android_error

if not exist "%PROJECT_DIR%node_modules" (
  echo [1/4] 首次运行，正在安装前端依赖...
  call npm ci || goto :failed
) else (
  echo [1/4] 前端依赖已存在，跳过安装。
)

echo [2/4] 构建学习端网页资源...
call npm run build || goto :failed

echo [3/4] 同步资源到 Android 工程...
call npx cap sync android || goto :failed

echo [4/4] 生成 Android APK...
pushd "%PROJECT_DIR%android" || goto :project_error
call gradlew.bat assembleDebug --no-daemon
set "GRADLE_RESULT=%ERRORLEVEL%"
popd
if not "%GRADLE_RESULT%"=="0" goto :failed

if not exist "%APK_PATH%" goto :apk_error

echo.
echo ========================================
echo   打包成功
echo ========================================
echo APK 路径：
echo %APK_PATH%
echo.
explorer /select,"%APK_PATH%"
exit /b 0

:node_error
echo [错误] 未找到 Node.js 或 npm，请先安装 Node.js 18 或更高版本。
goto :failed

:java_error
echo [错误] 未找到 Java，请安装并配置 JDK 17。
goto :failed

:android_error
echo [错误] 未找到 Android SDK。
echo 请设置 ANDROID_HOME，或者通过 Android Studio 安装到：
echo %LOCALAPPDATA%\Android\Sdk
goto :failed

:project_error
echo [错误] 无法进入 EchoLoop 项目目录。
goto :failed

:apk_error
echo [错误] Gradle 已结束，但没有找到 APK：
echo %APK_PATH%
goto :failed

:failed
echo.
echo 打包失败，请查看上方错误信息。
pause
exit /b 1
