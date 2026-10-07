@echo off
rem Builds an installer for one edition.   build-edition.bat modern     (Windows 10 / 11)
rem                                         build-edition.bat legacy     (Windows 7 / 8 / 8.1)
rem Your package.json is backed up first and put back afterwards.
setlocal
cd /d "%~dp0\.."
set ED=%1
if "%ED%"=="" set ED=modern
if /i not "%ED%"=="modern" if /i not "%ED%"=="legacy" (echo Usage: build-edition.bat modern^|legacy & exit /b 2)

echo === Tools needed inside the installer (skip with Ctrl+C if you will install them later) ===
if /i "%ED%"=="legacy" (set EDARG=-Edition legacy) else (set EDARG=-Edition modern)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\setup-tools.ps1" %EDARG% -NoGitignore -SkipTests

echo === Preparing package.json for the %ED% edition ===
node editions\apply-edition.js %ED% || goto :fail
call npm install || goto :fail
call npx electron-builder --win || goto :fail

echo === Restoring your package.json ===
node editions\apply-edition.js --restore
call npm install
echo.
echo Done. Installers are in dist\%ED%
exit /b 0

:fail
echo Build failed. Restoring your package.json...
node editions\apply-edition.js --restore
exit /b 1
