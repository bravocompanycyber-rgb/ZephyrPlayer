# ZephyrPlayer upgrade v4

## Install (keep folder layout, back up first)
    root:   main.js preload.js mpv-ipc.js mpv-session.js mpv-controller.js media-utils.js media-probe.js media-tools.js online-meta.js
            index.html splash.html setup-tools.ps1 setup-tools.bat README.md TOOLS.md
    js/:    player.js features.js subtitle-parser.js media-name.js icons.js icons-default.js
    css/:   style.css
    assets/icons/: all 80 icons + README.md + icon-sheet.html (your own zephyrplayer.ico/tray.png stay untouched)
    tests/: optional test suite (node tests/run-all.js)
    package.json: if it has build.files, include the new root .js files, splash.html, setup-tools.ps1, README.md, TOOLS.md and assets/**

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
