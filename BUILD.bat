@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ZephyrPlayer - One-Click Distribution Build

echo.
echo ============================================
echo   ZephyrPlayer Distribution Build
echo   Modern (Win 10/11) + Legacy (Win 8/8.1)
echo ============================================
echo.

:: -------------------------------------------------
:: 1. Refresh the required-files list
:: -------------------------------------------------
echo [1/5] Updating required files list...
node editions\fix-build-files.js
if errorlevel 1 (
  echo WARNING: fix-build-files had issues - continuing anyway
)

:: -------------------------------------------------
:: 2. Clean previous outputs
:: -------------------------------------------------
echo.
echo [2/5] Cleaning old builds...
if exist "dist\modern" rmdir /s /q "dist\modern"
if exist "dist\legacy" rmdir /s /q "dist\legacy"
if exist "package.json.edition-backup" del /q "package.json.edition-backup"

:: -------------------------------------------------
:: 3. Prepare tools for MODERN and build it
:: -------------------------------------------------
echo.
echo [3/5] Preparing tools + building MODERN (Windows 10/11)...
powershell -NoProfile -ExecutionPolicy Bypass -File "setup-tools.ps1" -Edition modern -NoGitignore -SkipTests >nul 2>&1

if not exist "build\tools-modern" mkdir "build\tools-modern"
xcopy /Y /Q "mpv.exe"          "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "mpv.com"          "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "yt-dlp.exe"       "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "deno.exe"         "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "whisper-cli.exe"  "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "whisper.dll"      "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "ggml*.dll"        "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "d3dcompiler_43.dll" "build\tools-modern\" >nul 2>&1
xcopy /Y /Q "vulkan-1.dll"     "build\tools-modern\" >nul 2>&1
if exist "ffmpeg"  xcopy /E /I /Y /Q "ffmpeg"  "build\tools-modern\ffmpeg\"  >nul 2>&1
if exist "models"  xcopy /E /I /Y /Q "models"  "build\tools-modern\models\"  >nul 2>&1
if exist "shaders" xcopy /E /I /Y /Q "shaders" "build\tools-modern\shaders\" >nul 2>&1

call editions\build-edition.bat modern
if errorlevel 1 goto :fail

:: -------------------------------------------------
:: 4. Prepare tools for LEGACY and build it
:: -------------------------------------------------
echo.
echo [4/5] Preparing tools + building LEGACY (Windows 8 / 8.1)...
powershell -NoProfile -ExecutionPolicy Bypass -File "setup-tools.ps1" -Edition legacy -NoGitignore -SkipTests >nul 2>&1

if not exist "build\tools-legacy" mkdir "build\tools-legacy"
xcopy /Y /Q "mpv.exe"          "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "mpv.com"          "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "yt-dlp.exe"       "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "qjs.exe"          "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "whisper-cli.exe"  "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "whisper.dll"      "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "ggml*.dll"        "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "d3dcompiler_43.dll" "build\tools-legacy\" >nul 2>&1
xcopy /Y /Q "vulkan-1.dll"     "build\tools-legacy\" >nul 2>&1
if exist "ffmpeg"  xcopy /E /I /Y /Q "ffmpeg"  "build\tools-legacy\ffmpeg\"  >nul 2>&1
if exist "models"  xcopy /E /I /Y /Q "models"  "build\tools-legacy\models\"  >nul 2>&1
if exist "shaders" xcopy /E /I /Y /Q "shaders" "build\tools-legacy\shaders\" >nul 2>&1

call editions\build-edition.bat legacy
if errorlevel 1 goto :fail

:: -------------------------------------------------
:: 5. Done
:: -------------------------------------------------
echo.
echo [5/5] Finished.
echo.
echo ============================================
echo   READY FOR DISTRIBUTION
echo ============================================
echo.
echo Modern (Windows 10 / 11):
dir /b "dist\modern\*Setup.exe" 2>nul
dir /b "dist\modern\*Portable.exe" 2>nul
echo.
echo Legacy (Windows 8 / 8.1):
dir /b "dist\legacy\*Setup.exe" 2>nul
dir /b "dist\legacy\*Portable.exe" 2>nul
echo.
echo Copy the Setup.exe files to other PCs.
echo They are fully self-contained.
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo   BUILD FAILED
echo ============================================
echo Restoring package.json...
node editions\apply-edition.js --restore 2>nul
echo.
echo Look at the error messages above.
pause
exit /b 1