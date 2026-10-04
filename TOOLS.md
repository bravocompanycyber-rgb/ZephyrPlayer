# External tools (not stored in GitHub)

These are too big or change too often for the repo. After cloning, fetch them with one command:

    setup-tools.bat                                  (double-click, or run in a terminal)
    setup-tools.bat -Npm                             (also npm install)
    setup-tools.bat -Force                           (update everything)
    setup-tools.bat -TestOnly                        (download nothing, just prove the tools work)
    setup-tools.bat -SkipWhisper                     (leave out the AI-subtitle tool; -SkipModel keeps the exe but not the 140 MB model)
    setup-tools.bat -DryRun                          (show what it would download, change nothing)

It installs **everything including whisper** (AI subtitles), then runs a **self-test** that proves each tool really works,
not just that the file exists.

You can also do it from inside the app: **Help > Tools & health...** (Install / update missing tools, or **Run self-test**).
It is safe to re-run: anything already present is skipped. If PowerShell blocks scripts, the .bat already bypasses that.

| File (location) | Needed for | Source |
|---|---|---|
| `mpv.exe` (root) | mkv, HEVC/x265, AC3, everything the browser engine cannot play | github.com/shinchiro/mpv-winbuild-cmake/releases (`mpv-x86_64-...7z`, not the `v3` one) |
| `yt-dlp.exe` (root) | YouTube and other sites | github.com/yt-dlp/yt-dlp/releases/latest |
| `deno.exe` (root) | JavaScript runtime yt-dlp needs for YouTube | github.com/denoland/deno/releases (`deno-x86_64-pc-windows-msvc.zip`) |
| `ffmpeg\ffmpeg.exe`, `ffmpeg\ffprobe.exe` | file info, poster frames, clips, convert, record | gyan.dev/ffmpeg/builds ("release essentials") |
| `whisper-cli.exe` + `whisper.dll`, `ggml*.dll` (root) | local AI subtitles (installed by default) | github.com/ggml-org/whisper.cpp/releases (`whisper-bin-x64.zip`) |
| `models\ggml-base.bin` (about 140 MB) | the Whisper speech model (`-ModelName small` for a better, slower one) | huggingface.co/ggerganov/whisper.cpp |
| `mpv.com`, `vulkan-1.dll`, `d3dcompiler_43.dll` (root) | mpv console launcher (used for version checks) and GPU support, copied from the mpv archive | included in the mpv download |

Also required once per machine: Node.js LTS (nodejs.org), then `npm install` (the script's `-Npm` does this).

## What the self-test proves
| Test | What it really does |
|---|---|
| ffmpeg | encodes an H.264+AAC clip and a 10-bit HEVC+AC3 clip |
| ffprobe | reads that clip and reports the right duration and codecs |
| mpv decode | plays both clips (H.264, and HEVC 10-bit + AC3 in mkv = the x265 case) |
| mpv GPU | starts the Direct3D 11 renderer (a tiny window flashes for a second) |
| deno | runs JavaScript |
| yt-dlp | resolves a real YouTube video using deno (needs internet) |
| whisper | transcribes a spoken sentence made with the built-in Windows voice and shows what it heard |

Each line says **PASS**, **WARN** (works but something is off, for example no internet or a sign-in wall) or **FAIL**.
The script's exit code is 0 (all good), 1 (a download failed) or 2 (something is installed but does not work).

## If something cannot be downloaded
Download that file by hand from the table and place it as shown. The app reports what it found in
Help > Tools & health, and in the log at startup (File > Open log folder).

## Notes
* `mpv.exe` ships as a `.7z`; the script fetches the small official `7zr.exe` extractor to open it.
* `yt-dlp.exe` also updates itself every few days (File > Update yt-dlp forces it). Re-run with `-Force` to refresh the rest.
* The script adds `*.exe`, `*.dll`, `ffmpeg/`, `models/`, `node_modules/`, `dist/`, `releases/` to `.gitignore` (skip with `-NoGitignore`).
