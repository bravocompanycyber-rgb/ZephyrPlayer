# ZephyrPlayer

A free desktop media player that plays **everything** (mkv, HEVC/x265, 4K, AC3/DTS, music, YouTube and hundreds of other sites),
with a modern playlist, posters and info, themes, clip export and no accounts, ads or paid parts.

Built with Electron. Video is played by the browser engine when that is best, and by **mpv** for everything else. It switches automatically.

---

## 1. Quick start

1. Install **Node.js LTS** (nodejs.org).
2. Open a terminal in the project folder and run `setup-tools.bat` (downloads mpv, yt-dlp, deno, ffmpeg; see `TOOLS.md`), then `npm install`.
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
Load more by dropping a subtitle file. **Generate subtitles with AI** (whisper, runs on your PC, optional) from the subtitle menu.
Delay, size and style are adjustable live.

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

## 9. Keyboard shortcuts (press `?` in the app)

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
| Shift+I | Stats (mpv) | ? | Shortcut list |

Media keys on the keyboard also work. Screenshots go to `Pictures\ZephyrPlayer`.

## 10. Tools & health

**Help > Tools & health** lists mpv, yt-dlp, deno, ffmpeg, ffprobe and whisper with versions and what each is for,
can install or update the missing ones, and has **Copy diagnostics** (versions, GPU, tool paths, recent log; your user name is removed) for bug reports.
A small banner appears at start if something essential is missing.

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| mkv / x265 shows nothing or is choppy | Tools & health: is mpv installed? Try Settings > video output "gpu-next" or the "Fast" quality. The app auto-simplifies and auto-restarts, and the log says what it did. |
| Audio and video out of sync | Bluetooth headsets add delay: use Audio delay in the audio menu. Otherwise lower the quality preset (heavy scalers can drop frames). |
| YouTube says "sign in" / "not a bot" | In the URL panel choose your browser under **Use cookies from**. |
| YouTube / link fails with a message | The message says why. Most often: File > **Update yt-dlp**, and make sure `deno.exe` is present (Tools & health). |
| No playlist thumbnails | Install ffmpeg (Tools & health). |
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

Layout: `main.js` (windows, IPC) | `mpv-session.js` + `mpv-ipc.js` (mpv control, recovery) | `media-probe.js` (file info, posters) |
`online-meta.js` (optional internet info) | `media-tools.js` (clips, diagnostics) | `js/player.js` (player core) | `js/features.js` (themes, fullscreen UI, panels).

## 14. Credits and licences

mpv (GPL/LGPL), FFmpeg (LGPL/GPL build), yt-dlp (Unlicense), Deno (MIT), whisper.cpp (MIT), Lucide icons (ISC, `assets/icons/LICENSE-lucide.txt`),
Electron (MIT). Poster and info data belongs to TVmaze, Apple, Wikipedia and Deezer; ZephyrPlayer only caches it locally for your own viewing.
If you distribute installers that include mpv or FFmpeg, GPL terms apply and you must offer their source (link to the projects above).
