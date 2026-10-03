# ZephyrPlayer upgrade v3

## Install (keep folder layout, back up first)
    root:   main.js preload.js mpv-ipc.js mpv-session.js mpv-controller.js media-utils.js media-probe.js index.html
    js/:    player.js subtitle-parser.js icons.js icons-default.js
    css/:   style.css
    assets/icons/: everything in the zip's assets/icons (80 icons, README.md, icon-sheet.html). Your own zephyrplayer.ico stays untouched.
    package.json: if it has a build.files list add the new root .js files (or "*.js") and "assets/**".

## Your log: what happened
- "Video output failed to start" x3 was a FALSE ALARM from my v2 blank-screen guard: for a YouTube link mpv cannot show video
  until the stream has buffered, and the guard judged after ~7 s. The guard now only judges once playback is actually running
  (audio clock advancing) and needs two bad samples in a row, so loading/buffering/slow networks never trigger a restart.
- The second launch used the old "Full window (legacy)" mode (--wid), which draws over the whole UI. Legacy modes are removed;
  remaining: "Separate window" (default) and "Embedded (beta)". Saved legacy settings migrate automatically.
- "Failed to append custom category 'Recent Media' to Jump List" is Windows privacy settings ("show recently opened items" is off).
  Harmless; it is now detected once, remembered, and never retried (no more log spam).
- Good news in the log: deno found, yt-dlp 2026.08.19 up to date -> YouTube path is healthy.

## Icons
- New icon system: every button uses data-icon names. 80 icons ship in assets/icons (Lucide, ISC) + built-in fallbacks.
  Save your own `play.svg` etc. in assets/icons, alt-tab back: it updates live. See assets/icons/README.md and open icon-sheet.html.
- Controls are bigger (50 px buttons, 66 px play, 26–32 px icons), +10/-10 show a "10" badge, A-B shows state, speed is a pill,
  mute/repeat/fullscreen icons change with state. File menu > Open icons folder.
- logo-concept/: SVG + PNG + ICO + tray PNG logo to start from.

## Playlist (new)
- Auto-detect on add: duration, resolution, codec (HEVC/H.264/AV1...), 10-bit, HDR/Dolby Vision, audio+subtitle track counts,
  tags for music (Artist – Title), poster frame (ffmpeg), resume progress bar, total playlist time.
  ffprobe (fast) -> mpv (fallback) -> browser metadata; results cached on disk, so re-adding a folder is instant.
- Codec-aware routing: HEVC / AC3 / DTS / 10-bit go straight to mpv (no failed first attempt).
- Sort (name, duration, size, order added, random), remove duplicates, remove missing files, live filter box, drag to reorder.
- Playlist is remembered across launches; missing files are flagged.
- Shuffle fixed/rebuilt: "bag" shuffle — every item plays once per round, no immediate repeats, ends after the round (or continues with Repeat All);
  Previous follows real play history; Shuffle/Repeat states are remembered.
- YouTube: playlist/channel links expand into individual items (titles + durations); stream titles update to the real title.

## Also
Cookies-from-browser, yt-dlp auto-update, diagnosed link errors, JS runtime handling (v2) are unchanged.
