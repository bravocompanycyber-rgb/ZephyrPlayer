@echo off
rem =====================================================================================================
rem  Builds installers for DISTRIBUTION (to give to other people / other PCs). This is NOT a test run.
rem
rem    build-release.bat              both editions
rem    build-release.bat modern       Windows 10 / 11
rem    build-release.bat legacy       Windows 7 / 8 / 8.1
rem    build-release.bat both skiptools     (do not pack mpv, yt-dlp ... into the installer; the app then downloads them)
rem
rem  Each edition gets its OWN tools packed inside (the legacy one gets QuickJS instead of Deno), the installer file
rem  list is checked, and nothing is published. Copy the "Setup" .exe from dist\<edition> to the other PC.
rem =====================================================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0\.."
set WHICH=%1
set SKIPTOOLS=0
if /i "%WHICH%"=="skiptools" (set WHICH=both& set SKIPTOOLS=1)
if /i "%2"=="skiptools" set SKIPTOOLS=1
if "%WHICH%"=="" set WHICH=both
if /i not "%WHICH%"=="both" if /i not "%WHICH%"=="modern" if /i not "%WHICH%"=="legacy" (echo Usage: build-release.bat [modern^|legacy^|both] [skiptools] & exit /b 2)

where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & exit /b 1)
if exist dist\modern rmdir /s /q dist\modern
if exist dist\legacy rmdir /s /q dist\legacy

if /i not "%WHICH%"=="legacy" call :build modern || goto :fail
if /i not "%WHICH%"=="modern" call :build legacy || goto :fail
goto :summary

:build
set ED=%1
echo.
echo ===================== %ED% edition =====================
if not exist "build\tools-%ED%" mkdir "build\tools-%ED%"
if "%SKIPTOOLS%"=="0" (
  echo Fetching the %ED% tools into build\tools-%ED% ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\setup-tools.ps1" -Edition %ED% -InstallDir "%CD%\build\tools-%ED%" -NoGitignore -SkipTests
  if errorlevel 1 (echo Tool download had problems - see above. & exit /b 1)
)
node editions\fix-build-files.js || exit /b 1
node editions\apply-edition.js %ED% || exit /b 1
call npm install || (node editions\apply-edition.js --restore & exit /b 1)
call npx electron-builder --win --publish never || (node editions\apply-edition.js --restore & exit /b 1)
node editions\apply-edition.js --restore
exit /b 0

:summary
echo.
echo ===================== DONE =====================
echo Copy THIS file to the other PC and run it (it installs ZephyrPlayer):
if exist dist\modern dir /b dist\modern\*Setup*.exe dist\modern\*.exe 2>nul
if exist dist\legacy dir /b dist\legacy\*.exe 2>nul
echo.
echo   dist\modern  = Windows 10 / 11        dist\legacy = Windows 7 / 8 / 8.1 (also works on 10 / 11)
echo   Do NOT copy the win-unpacked folder or the .blockmap / .yml files. The "portable" .exe runs without installing.
echo   After installing on the other PC: Tools ^& health ^> Run self-test.
exit /b 0

:fail
echo.
echo BUILD FAILED - your package.json was restored. Read the messages above.
node editions\apply-edition.js --restore
exit /b 1
