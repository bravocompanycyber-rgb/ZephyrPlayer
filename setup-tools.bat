@echo off
rem Double-click to download mpv, yt-dlp, deno, ffmpeg + ffprobe next to the app.
rem Options are passed through, e.g.:  setup-tools.bat -Whisper -WhisperModel -Npm
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-tools.ps1" %*
echo.
pause
