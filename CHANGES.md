# ZephyrPlayer upgrade v5

## v5: settings, controls, volume, robustness, editions
- **Settings centre** (gear / Ctrl+,): nine groups from Basic to Advanced, a hover explanation on every setting, per-setting / per-section / reset-all, search, export / import.
  Fixes a real bug: skip step, auto-next and remember-position were never saved and reset on every launch. All settings are validated, versioned and corruption-proof.
- **Keys and mouse**: every shortcut rebindable (capture, conflicts handled), mouse wheel / Shift / Ctrl, click, double-click, middle and thumb buttons configurable; also applied in the mpv window.
- **Volume**: up to 300% (default limit 200%) with a soft limiter, loudness evening and night mode in one audio chain; the browser engine hands over to mpv for boost.
- **Hang protection**: frozen mpv detected and restarted at the same position, force-kill when it will not quit, open-timeout, stalled-stream reconnect, safe-mode fallback for bad option typos.
- **Other players / K-Lite**: detects MPC-HC (K-Lite), MPC-BE, VLC, PotPlayer, KMPlayer and offers or automatically does a hand-over when nothing built-in can play a file. Codec support report.
- **File associations** written properly (no admin needed) + `.m3u/.m3u8/.pls` open as playlists. (The old .reg export had double-escaped paths: fixed.)
- **Editions**: Modern and Legacy (Windows 7 / 8 / 8.1, Electron 22.3.27) with a merge tool that never replaces your package.json; setup script works on PowerShell 4 and uses QuickJS on old Windows.
- Verified: all main-process tests also pass on Node 16; interface code parses as ES2022 and uses no post-Chromium-108 features.

# ZephyrPlayer upgrade v4

## Install (keep folder layout, back up first)
    root:   main.js preload.js mpv-ipc.js mpv-session.js mpv-controller.js media-utils.js media-probe.js media-tools.js online-meta.js
            engine-config.js external-players.js file-assoc.js edition.js
            index.html splash.html setup-tools.ps1 setup-tools.bat README.md TOOLS.md
    js/:    player.js features.js controls.js settings-store.js settings-ui.js subtitle-parser.js media-name.js icons.js icons-default.js
    css/:   style.css
    assets/icons/: all 80 icons + README.md + icon-sheet.html (your own zephyrplayer.ico/tray.png stay untouched)
    tests/: optional test suite (node tests/run-all.js)
    editions/: apply-edition.js, build-edition.bat, README.md
    package.json: if it has build.files, include the new root .js files, splash.html, setup-tools.ps1, README.md, TOOLS.md and assets/**

## Update: tools that are proven, not just present
- setup-tools.ps1 now installs whisper (exe + DLLs + the base speech model) by default and runs a self-test of every tool:
  ffmpeg encodes H.264 and 10-bit HEVC+AC3, ffprobe reads them, mpv decodes both and starts its Direct3D 11 GPU renderer,
  deno runs JS, yt-dlp resolves a real YouTube video with deno, whisper transcribes a spoken sentence (made with the Windows voice).
  Results are PASS / WARN / FAIL with a reason; exit code 0 / 1 (download failed) / 2 (installed but broken). `-TestOnly` re-runs just the tests.
- Tools & health got a **Run self-test** button (same tests) and installs whisper by default.
- mpv.com is installed too so the mpv version can be shown (mpv.exe prints nothing to a console).

## New in v4
- Fullscreen rebuilt: everything hides; mouse to the BOTTOM shows seek bar + buttons, RIGHT edge shows the playlist (or L), TOP shows the title.
  (Before, only the video was fullscreen, so controls and playlist were gone.) In the mpv window: bigger on-screen controller, < > and F8 for your playlist.
- Optional free online posters/covers/info (TVmaze, Apple iTunes, Wikipedia, Deezer, YouTube thumbnails). Off by default, cleaned titles only, cached.
  Details panel (D), episode titles, plots, ratings, poster-driven accent colour, album art for music.
- 15 themes + custom/poster accent, splash screen (can be turned off), first-run welcome.
- Tools & health panel with one-click install, copy-diagnostics, missing-tool banner. Help menu: user guide, shortcuts, tools, diagnostics.
- A-B clip export (MP4 / lossless copy / GIF) with automatic keyframe check.
- Per-file memory (audio/subtitle track, speed), Continue-watching shelf, embedded cover art, OS media-overlay metadata.
- README.md user guide, TOOLS.md, tests.

## Earlier fixes still included
Blank-screen guard no longer false-triggers on slow YouTube loads (v3), controls/icons/playlist upgrade, shuffle bag, codec-aware routing,
crash recovery, YouTube JS-runtime + yt-dlp updates, hardened security.
