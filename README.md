# ZephyrPlayer

A free desktop media player that plays **everything** (mkv, HEVC/x265, 4K, AC3/DTS, music, YouTube and hundreds of other sites),
with a modern playlist, posters and info, themes, clip export and no accounts, ads or paid parts.

Built with Electron. Video is played by the browser engine when that is best, and by **mpv** for everything else. It switches automatically.

---

## 1. Quick start

1. Install **Node.js LTS** (nodejs.org).
2. Open a terminal in the project folder and run `setup-tools.bat` (downloads mpv, yt-dlp, deno, ffmpeg and whisper, then **tests that they really work**; see `TOOLS.md`), then `npm install`.
3. Run `npm start`.
4. Drop files or folders on the window, press **Ctrl+O**, or paste a link with the **URL** button.

On first launch a small welcome screen lets you choose a theme and decide about the optional online posters.
Something missing? **Help > Tools & health** shows exactly what is installed and can install the rest for you.

## 2. Playing things

| You open | What happens |
|---|---|
| mp4, webm, mp3, flac, aac ... | Browser engine (instant start, picture-in-picture, seek thumbnails) |
| mkv, avi, HEVC/x265, 10-bit, AC3/DTS, ts, wmv ... | mpv (GPU decoding, all audio/subtitle tracks, chapters) |
| A file the browser engine fails on | Automatic hand-over to mpv at the same position |
| A link (YouTube, Vimeo, Twitch, direct m3u8/mp4 ...) | mpv + yt-dlp |
| A folder | Every media file inside, in natural order (E2 before E10) |
| A playlist link (YouTube playlist / channel) | Expanded into individual items with titles and durations |

The app reads each file's codecs when you add it, so HEVC/AC3/10-bit files go straight to mpv without a failed first attempt.

**mpv window mode** (selector in the control bar): *Separate window* (default, most robust) or *Embedded (beta)*.
In the separate window you get mpv's on-screen controller (seek bar at the bottom, bigger in fullscreen).
Extra keys there: `<` `>` previous/next item in **your** playlist, `F8` shows what is up next.

**Smooth playback is automatic:** if the video is too heavy for your GPU, the renderer is simplified on the fly (you see a short note).
If mpv ever fails or shows no picture, it restarts itself at the same position with safer settings, and finally falls back to the browser engine.

## 3. Playlist

* Each row shows a **poster frame**, duration, resolution, codec, 10-bit/HDR, number of audio tracks and subtitles, file size and a resume bar.
* **Shuffle** plays every item once per round (no immediate repeats). **Repeat**: off / all / one. Both are remembered.
* **Sort** (name, duration, size, order added, random), **remove duplicates**, **remove missing files**, live **filter** box, **drag to reorder**.
* Your playlist is restored on the next launch. Resume positions are remembered per file.
* **Continue watching** appears on the start screen for anything you left unfinished.
* Music shows tags (Artist - Title) and embedded cover art.

## 4. Fullscreen

Press **F** (or double-click the video). Everything hides. Then:

* move the mouse to the **bottom**: seek bar and all buttons appear;
* to the **right edge**: the playlist slides in (or press **L** to pin it);
* to the **top**: the title bar.

They hide again a moment after you move away. The cursor hides when idle, and a thin progress line stays at the bottom
(turn it off in Settings). In the separate mpv window, fullscreen uses mpv's controller instead.

## 5. Subtitles

Auto-loads `.srt .vtt .ass .ssa` files next to the video (also non-UTF-8 files), plus all embedded tracks in mpv.
Load more by dropping a subtitle file. **Generate subtitles with AI** (whisper, runs on your PC; installed by `setup-tools.bat`) from the subtitle menu.
Delay, size and style are adjustable live.

## 5b. Settings (Basic to Advanced, with explanations)

Open the gear (or press **Ctrl+,**). Settings are grouped: **General, Playback, Audio & volume, Video & performance, Subtitles, Keys & mouse,
Library & online, File types & players, Advanced**. The Advanced section and the advanced options inside each group stay hidden until you
turn on **Show advanced settings**; the defaults are already good, so most people never need them.

* **Hover any setting** (or its "i") for a short explanation of what it does.
* **Reset**: the ↺ next to a setting resets that one; **Reset this section** resets a group; **Advanced > Reset ALL settings** resets everything
  (your playlist, history and files are not touched). A badge shows how many settings in each group differ from the default.
* **Search** finds any setting by word ("volume", "subtitle", "fullscreen").
* **Export / Import** a settings file to back up or move to another PC. Invalid or unknown entries are ignored safely.
* Settings are validated and saved immediately; a damaged settings file is backed up and replaced by defaults instead of breaking the app.

## 5c. Volume and extra volume

* Volume goes **up to 300%** (default maximum 200%; change it under Audio & volume). Mouse wheel and arrow keys change it by a step you choose.
* Above 100% the **soft limiter** (on by default) stops peaks from crackling. **Even out loudness** makes quiet and loud videos similar;
  **Night mode** softens explosions and lifts whispers.
* The browser engine cannot exceed 100%, so asking for more volume hands the file to **mpv** automatically at the same position.

## 5d. Keys and mouse

Settings > **Keys & mouse**:

* **Every keyboard shortcut is rebindable**: click **+** on an action, press the new key. An action can have several keys; if a key is already used,
  it moves to the new action and you are told. ↺ restores a default; **Reset all shortcuts** restores all.
* **Mouse wheel** (plain, Shift, Ctrl): volume, skip, speed, previous/next item or nothing.
* **Click, double-click, middle button, and the two thumb buttons** (Back/Forward on many mice): play/pause, fullscreen, mute, screenshot,
  next/previous, skip, A-B loop, bookmark, playlist, mini player, or nothing.
* These also apply **inside the mpv window**. Esc is reserved for leaving fullscreen and closing panels.

## 5e. Reliability: it should not hang or crash

* **Frozen player**: if mpv stops responding for about 10 seconds, it is force-closed and restarted at the same position.
* **Won't open**: a file or link that does not open within 75 seconds is reported (and skipped if you chose that) instead of hanging.
* **Stalled streams** reconnect from the same spot (up to 3 times). **Bad files** are skipped. **A typo in your own mpv options** falls back to safe mode and still plays.
* **No picture / too heavy / crash**: automatic fallbacks (see section 2). If both engines fail, ZephyrPlayer offers VLC, MPC-HC or another installed player.

## 5f. Every codec, K-Lite, other players

* ZephyrPlayer plays through **mpv and FFmpeg**, which already decode almost every format K-Lite does (HEVC/x265, AV1, VP9, ProRes, MPEG-2, VC-1, AC-3, DTS, TrueHD,
  FLAC, WMA, RealVideo and many more) plus ASS/PGS subtitles. **Tools & health > Show codec support** lists exactly what your install can decode.
* **K-Lite works through DirectShow filters**, which only DirectShow players (like K-Lite's MPC-HC) can use, so mpv cannot load them. You do not need K-Lite to play files here.
  If a rare file still will not play, ZephyrPlayer finds **MPC-HC (including the K-Lite one), MPC-BE, VLC, PotPlayer, KMPlayer** and offers to open the file there
  (Settings > File types & players: ask / open automatically / do nothing).
* **Disc images and DVD/Blu-ray menus are not supported yet.**

## 5g. File associations

Settings > **File types & players**: pick Video / Audio / Playlists and press **Register ZephyrPlayer**. This adds the app to **Open with** and to the
Windows **Default apps** list without needing administrator rights, then opens that Windows page so you can pick it (Windows does not let any app set itself as default silently).
Opening a `.m3u`, `.m3u8` or `.pls` file loads it as a playlist, including links. **Remove registration** undoes everything.
Installers built with `editions/build-edition.bat` also register all these types during installation.

## 5h. Two editions: Modern and Legacy (Windows 8.1)

| | Modern | Legacy |
|---|---|---|
| Windows | 10 / 11 | 7 / 8 / 8.1 (also runs on 10 / 11) |
| Runtime | your current Electron | **Electron 22.3.27** (the last release that supports Windows 7/8/8.1) |
| JavaScript runtime for YouTube | Deno | QuickJS (Deno needs Windows 10) |
| Tool installer | PowerShell 5+ | works with PowerShell 4 (Windows 8.1) |

Build either with `editions\build-edition.bat modern` or `editions\build-edition.bat legacy` (details in `editions/README.md`). The app shows which edition is
running in Tools & health. `setup-tools.bat` picks the right tools for your Windows automatically (`-Edition legacy` to force).

**Honest limits of the legacy edition:** the app's own code is tested on the Node and Chromium versions inside Electron 22, but the third-party tools (mpv, yt-dlp,
FFmpeg, whisper) are downloaded from their official sites and their support for Windows 8.1 is decided by their authors and can change. The **self-test tells you
on your machine** which ones work. Where a tool does not run, the built-in browser engine still plays common formats and the other-player hand-over covers the rest.

## 6. Posters and info from the internet (optional)

Settings > **Fetch posters, covers & info**. Off by default.

* Free services, **no account or key**: TVmaze (TV), Apple iTunes (movies, music), Wikipedia, Deezer (music), YouTube thumbnails.
* Only a **cleaned title** is sent (for example `Inception 2010` or `The Mandalorian S02E03`). Never file paths, never your library.
* Press **D** for the **Details** panel: poster, year, genre, rating, plot, episode title.
* Choose whether playlist rows show video frames or online posters. Accent colour can follow the poster.
* **Fetch info for the whole playlist** runs slowly on purpose to respect the services' limits. Everything is cached on your PC and works offline afterwards.
* Name files like `Movie Name (2019).mkv` or `Show.Name.S01E02.mkv` for the best matches. A wrong match is never shown: low-confidence results are dropped.

## 7. Clips (A-B)

Press **A** at the start, **A** again at the end, then **More > Export A-B clip**:

* **MP4 clip** exact cut that plays everywhere;
* **Fast copy** lossless and instant (if the start is not near a keyframe it quietly switches to an exact cut, and tells you);
* **GIF** looping, 480 px wide.

Works for local files. Needs ffmpeg.

## 8. Themes and icons

15 themes (Zephyr, Midnight, AMOLED, Ocean, Forest, Sunset, Rose, Nord, Dracula, Mocha, Mono, High contrast, Light, Paper, Sky).
The accent colour can come from the theme, a colour you pick, or the current poster. The top-bar button flips between light and dark.

Every icon is a file in `assets/icons/`. Save your own with the same name (for example `play.svg`), alt-tab back to the app and it updates live.
`assets/icons/README.md` lists all names and where to download free sets; open `icon-sheet.html` to see them.
`File > Open icons folder` jumps there.

## 9. Keyboard shortcuts (press `?` in the app; all are rebindable, see 5d)

| Key | Action | Key | Action |
|---|---|---|---|
| Space / K | Play / pause | F | Fullscreen |
| Left / Right | Seek 10 s (Shift: 30 s) | Esc | Leave fullscreen / close panels |
| Up / Down | Volume | L | Playlist (pin in fullscreen) |
| [ / ] | Slower / faster | D | Details & poster |
| Shift+P / Shift+N | Previous / next | A | Set A / B / clear loop |
| PgUp / PgDn | Chapters (mpv) | S | Screenshot |
| . / , | Frame step | B | Bookmark |
| Home / End | Start / end | M | Mute |
| Ctrl+O | Open files | R | Repeat mode |
| Ctrl+, | Settings | Ctrl+H | Shuffle |
| Ctrl+U | Open a link | Ctrl+T | Always on top |
| Z / X | Subtitles earlier / later | V | Subtitles on / off |
| Shift+I | Stats (mpv) | ? | Shortcut list |

Media keys on the keyboard also work. Screenshots go to `Pictures\ZephyrPlayer`.

## 10. Tools & health

**Help > Tools & health** lists mpv, yt-dlp, deno, ffmpeg, ffprobe and whisper with versions and what each is for,
can install or update the missing ones, **Run self-test** (encodes, decodes HEVC, starts the GPU renderer, resolves a real YouTube video, transcribes a spoken sentence with whisper) and **Copy diagnostics** (versions, GPU, tool paths, recent log; your user name is removed) for bug reports.
A small banner appears at start if something essential is missing.

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| mkv / x265 shows nothing or is choppy | Tools & health: is mpv installed? Try Settings > video output "gpu-next" or the "Fast" quality. The app auto-simplifies and auto-restarts, and the log says what it did. |
| Audio and video out of sync | Bluetooth headsets add delay: use Audio delay in the audio menu. Otherwise lower the quality preset (heavy scalers can drop frames). |
| YouTube says "sign in" / "not a bot" | In the URL panel choose your browser under **Use cookies from**. |
| YouTube / link fails with a message | The message says why. Most often: File > **Update yt-dlp**, and make sure `deno.exe` is present (Tools & health). |
| No playlist thumbnails | Install ffmpeg (Tools & health). |
| A tool is installed but something fails | Tools & health > **Run self-test** (or `setup-tools.bat -TestOnly`): it tells you which tool fails and why. `-Force` reinstalls. |
| AI subtitles do nothing | Run the self-test: it shows whether whisper starts, finds `models\ggml-base.bin`, and what it hears. |
| No posters | Turn on online info in Settings; check the file name pattern; try Details > Look up again. |
| A tool shows Missing after installing | Press Re-check; if you copied files by hand keep them in the project root (ffmpeg in `ffmpeg\`). |
| Something else | Help > Copy diagnostics and paste it in your report. Logs: File > Open log folder. |

## 12. Privacy

No telemetry, no accounts. The app only contacts the internet for: playing links (via yt-dlp), `yt-dlp` self-update from GitHub,
and the optional posters/info above. Cookies-from-browser are read locally by yt-dlp and never stored by ZephyrPlayer.

## 13. Development

    npm install
    npm install --save-dev jsdom        # only needed for the UI test
    node tests/run-all.js

Add this to `package.json` to run it with `npm test`:  `"scripts": { "test": "node tests/run-all.js" }`.
Tests use real mpv/ffmpeg/ffprobe when they are installed (set `MPV`, `FFMPEG`, `FFPROBE` env vars to point at them) and skip the parts that need them otherwise.
Online lookups are tested against fixtures shaped like each service's documented responses.

If `package.json` has a `build.files` list, include `*.js`, `js/**`, `css/**`, `assets/**`, `splash.html`, `index.html`, `setup-tools.ps1`, `README.md`, `TOOLS.md`.

Layout: `main.js` (windows, IPC) | `mpv-session.js` + `mpv-ipc.js` (mpv control, recovery, hang protection) | `engine-config.js` (validated engine settings, audio chain) | `media-probe.js` (file info, posters) |
`external-players.js` + `file-assoc.js` + `edition.js` (other players, Windows associations, edition detection) | `js/settings-store.js` + `js/settings-ui.js` + `js/controls.js` (settings, shortcuts, mouse) |
`online-meta.js` (optional internet info) | `media-tools.js` (clips, diagnostics, codec report) | `js/player.js` (player core) | `js/features.js` (themes, fullscreen UI, panels).

## 14. Credits and licences

mpv (GPL/LGPL), FFmpeg (LGPL/GPL build), yt-dlp (Unlicense), Deno (MIT), whisper.cpp (MIT), Lucide icons (ISC, `assets/icons/LICENSE-lucide.txt`),
Electron (MIT). Poster and info data belongs to TVmaze, Apple, Wikipedia and Deezer; ZephyrPlayer only caches it locally for your own viewing.
If you distribute installers that include mpv or FFmpeg, GPL terms apply and you must offer their source (link to the projects above).
