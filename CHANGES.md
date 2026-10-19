# ZephyrPlayer upgrade — what changed and how to install

## Install
Copy these into your project, keeping the folder layout (back up first; keep your old preload.js):

    main.js, preload.js, mpv-ipc.js, mpv-session.js, media-utils.js, index.html   -> project root
    js/player.js, js/subtitle-parser.js                                            -> js/
    css/style.css, mpv-controller.js, package.json                                 -> unchanged

IMPORTANT: if package.json has a `build.files` list, add `mpv-ipc.js`, `mpv-session.js`, `media-utils.js`
(or use "*.js"), otherwise the packaged app will not find them.
preload.js was rewritten (your original wasn't in the upload) — if you added custom bridge functions there, re-add them.

## Fixed
- UI now really controls mpv (play/pause/seek/volume/speed/tracks/chapters/A-B/screenshot) and mirrors mpv state back.
- No more mpv restarts for EQ, tracks, geometry, video adjust, subtitle style, audio device — all live, position kept.
- Quality change / crash recovery resume at the same position.
- Keyboard shortcuts fired twice (M never muted; S, B doubled) — one dispatcher now.
- Bookmarks used prompt() (unsupported in Electron) — auto-label, double-click to rename.
- needsMpvContainer was defined twice (everything went to mpv) — single smart routing, HTML5 first for mp4/webm/mp3...
- Browser engine auto-hands over to mpv on: decode error, unsupported video codec (audio-only playback), unsupported audio codec (silent video), 15s stall.
- Subtitles: VTT without hours, ASS/SSA, UTF-16/ANSI encodings, overlapping cues, sidecar auto-load, SRT export rounding.
- Resume positions keyed by full path (same-named files no longer collide), saved every 5 s and on exit.
- HTML injection through file names / m3u / chapter titles closed (textContent / escaping).
- Drag & drop of files AND folders (works on Electron >= 32 where File.path was removed).
- Playlist: shuffle without immediate repeats, Prev = restart/history, bad files skipped on auto-next.
- m3u: relative paths, file:// URLs, BOM.

## Crash-proofing
- mpv exits abnormally -> relaunch at last position, escalating to safer settings (no hwdec, minimal args); bad options can't loop.
- mpv can't start at all -> browser engine takes over (and vice-versa).
- Renderer crash/hang -> auto reload; every IPC handler returns {ok:false,error} instead of throwing.
- No more blocking taskkill/where calls; tool lookups cached; single-instance lock exits cleanly.
- Hardening: sandbox on, webSecurity on, CSP, permission deny-list, URL scheme checks, mpv command/property whitelist.

## New
- Real audio/subtitle track names, chapters (PgUp/PgDn), mpv stats (Shift+I), speeds up to 4x, volume boost to 150% (mpv).
- Window size/position remembered; logs pruned; Whisper progress % + cancel; recording resolves YouTube pages via yt-dlp.
- Screenshots go to Pictures\ZephyrPlayer for both engines.
- Embed modes: "Separate window" (default, most robust), "Embedded (beta)" (native child window that follows the app), legacy modes kept.
