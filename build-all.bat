@echo off
setlocal EnableExtensions

title ZephyrPlayer Build

echo.
echo ============================================
echo ZEPHYRPLAYER BUILD SYSTEM
echo ============================================
echo.

set "ROOT=%~dp0"
set "LEGACY_DIR=%ROOT%..\ZephyrPlayer-legacy"

cd /d "%ROOT%"

echo [CHECK] Verifying required files...

if not exist "package.json" goto :missing
if not exist "package-legacy.json" goto :missing
if not exist "assets\icons\zephyrplayer.ico" goto :missing

echo [OK] Required files found.
echo.

echo ============================================
echo [1/6] Installing modern dependencies
echo ============================================
call npm install
if errorlevel 1 goto :error

echo.
echo ============================================
echo [2/6] Cleaning modern distribution
echo ============================================

if exist "dist" (
echo Removing old dist folder...
rmdir /s /q "dist"
)

echo.
echo ============================================
echo [3/6] Building Windows 10/11 version
echo Electron 28.3.3
echo ============================================

call npx electron-builder --win nsis portable
if errorlevel 1 goto :error

echo.
echo [OK] Modern build completed.
echo.

echo ============================================
echo [4/6] Preparing Windows 8.1 build
echo ============================================

if exist "%LEGACY_DIR%" (
echo Removing previous legacy build tree...
rmdir /s /q "%LEGACY_DIR%"
)

mkdir "%LEGACY_DIR%"

set "SOURCE_DIR=%ROOT:~0,-1%"

robocopy "%SOURCE_DIR%" "%LEGACY_DIR%" /E ^
/XD "%SOURCE_DIR%\node_modules" "%SOURCE_DIR%\dist" "%SOURCE_DIR%\dist-legacy" "%SOURCE_DIR%\.git" ^
/XF "%SOURCE_DIR%\package-legacy.json" "%SOURCE_DIR%\build-all.bat" ^
/NFL /NDL /NJH /NJS

if errorlevel 8 goto :error


if errorlevel 8 goto :error

copy /Y "%ROOT%package-legacy.json" "%LEGACY_DIR%\package.json" >nul
if errorlevel 1 goto :error

echo [OK] Legacy source tree prepared.
echo.

echo ============================================
echo [5/6] Installing legacy dependencies
echo Electron 22.3.27
echo ============================================

pushd "%LEGACY_DIR%"

call npm install
if errorlevel 1 (
popd
goto :error
)

echo.
echo ============================================
echo [6/6] Building Windows 8.1 version
echo ============================================

call npx electron-builder --win nsis portable
if errorlevel 1 (
popd
goto :error
)

popd

echo.
echo ============================================
echo BUILD COMPLETE
echo ============================================
echo.
echo Modern Windows 10/11:
echo %ROOT%dist
echo.
echo Windows 8.1:
echo %LEGACY_DIR%\dist-legacy
echo.
echo ============================================
echo.
echo Modern EXE files:
dir /b "%ROOT%dist*.exe" 2>nul
echo.
echo Windows 8.1 EXE files:
dir /b "%LEGACY_DIR%\dist-legacy*.exe" 2>nul
echo.
echo ============================================
echo No errors reported.
echo ============================================
echo.

exit /b 0

:missing
echo.
echo ============================================
echo ERROR: Required project file is missing.
echo ============================================
echo.
exit /b 1

:error
echo.
echo ============================================
echo BUILD FAILED
echo ============================================
echo.
echo Read the error message above.
echo.
exit /b 1