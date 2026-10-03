# External tools (not stored in GitHub)

These are too big or too often updated for the repo. Fetch them with one command after cloning:

    setup-tools.bat                                  (double-click, or run in a terminal)
    setup-tools.bat -Whisper -WhisperModel -Npm      (also AI subtitles + npm install)
    setup-tools.bat -Force                           (update everything)
    setup-tools.bat -DryRun                          (show what it would download, change nothing)

It is safe to re-run: anything already present is skipped. If PowerShell blocks scripts, the .bat already bypasses that.

| File (location) | Needed for | Source |
|---|---|---|
| `mpv.exe` (root) | mkv, HEVC/x265, AC3, everything the browser engine cannot play | github.com/shinchiro/mpv-winbuild-cmake/releases (`mpv-x86_64-...7z`, not the `v3` one) |
| `yt-dlp.exe` (root) | YouTube and other sites | github.com/yt-dlp/yt-dlp/releases/latest |
| `deno.exe` (root) | JavaScript runtime yt-dlp needs for YouTube | github.com/denoland/deno/releases (`deno-x86_64-pc-windows-msvc.zip`) |
| `ffmpeg\ffmpeg.exe`, `ffmpeg\ffprobe.exe` | file info, poster frames, convert, record | gyan.dev/ffmpeg/builds ("release essentials") |
| `whisper-cli.exe` + `whisper.dll`, `ggml*.dll` (root) | optional: local AI subtitles | github.com/ggml-org/whisper.cpp/releases (`whisper-bin-x64.zip`) |
| `models\ggml-base.bin` | optional: the Whisper model | huggingface.co/ggerganov/whisper.cpp |
| `vulkan-1.dll`, `d3dcompiler_43.dll` (root) | mpv GPU support (copied from the mpv archive) | included in the mpv download |

Also required once per machine: Node.js LTS (nodejs.org), then `npm install` (the script's `-Npm` does this).

## If the script cannot download something
Download that file by hand from the table and place it as shown. The app prints which tools it found at startup
(File > Open log folder), so you can confirm.

## Notes
* `mpv.exe` comes as a `.7z`; the script fetches the small official `7zr.exe` extractor to open it.
* `yt-dlp.exe` also updates itself every few days (File > Update yt-dlp forces it). Re-run with `-Force` to refresh the others.
* The script adds `*.exe`, `*.dll`, `ffmpeg/`, `models/`, `node_modules/`, `dist/`, `releases/` to `.gitignore` (skip with `-NoGitignore`).
