# ZephyrPlayer v2.6.0 — packaging fix + playlist context menu + fullscreen

## Critical fix (install crash)
**Error:** `Cannot find module './mpv-session'` after installing.

**Cause:** `package.json` → `build.files` did not include most root modules.

**Fix:** `files` and `asarUnpack` now include:
- mpv-session.js, mpv-ipc.js, engine-config.js
- external-players.js, file-assoc.js, edition.js
- media-probe.js, media-tools.js, media-utils.js, online-meta.js
- splash.html, deno.exe, qjs.exe, mpv.com, d3dcompiler_43.dll
- README.md, TOOLS.md, third-party notices

**You must rebuild the installer** for this fix to take effect:
```
npm install
editions\build-edition.bat modern
```
(or `npm run dist:win`)

## Playlist right-click menu (works in fullscreen)
Right-click any playlist row:
- Play / Play next
- Select / deselect, Select all, Clear selection
- Open file location, Copy path, Copy name
- Remove from playlist / Remove selected
- Delete file from disk (with confirmation)
- Play similar (same folder)
- Re-scan duration / info
- Media info

Multi-select: **Ctrl+click** toggle, **Shift+click** range.

## Selected items total runtime
Footer shows e.g. `12 tracks · 2h 15m · 3 selected (45 min)` when items are selected.

## Fullscreen seek bar
Controls (seek bar + buttons) now appear on **any mouse movement** for ~2.2 seconds, not only when the cursor is near the bottom edge. Playlist context menu keeps the UI visible while open.

## Other
- Version bumped to **2.6.0**
- `files:delete` IPC + `deleteFile` in preload (safe absolute-path-only delete)
- NSIS: differentialPackage enabled for cleaner updates

## Task Manager shows multiple processes
This is **normal for every Electron app**. Chromium uses:
- 1 main process
- 1+ renderer processes
- 1 GPU process
- utility / network processes

You will typically see 3–6 entries for one window. That is not a leak.

## Still unfinished (from docs)
- Disc images / DVD / Blu-ray menus
- Embedded mpv window mode (still beta)
- Legacy edition not fully verified on real Windows 8.1 hardware
- Tool auto-update from source (mpv/deno) — partially present via Tools & health + yt-dlp self-update; full version-check UI can be next

## How to apply on your machine
1. Copy the changed files from this folder into  
   `C:\Users\bntcl\Documents\T1911\Bravo Projects\ZephyrPlayer\`
2. Especially: `package.json`, `main.js`, `preload.js`, `index.html`, `js/player.js`, `js/features.js`, `css/style.css`
3. Rebuild: `npm run dist:win` or `editions\build-edition.bat modern`
4. Uninstall the broken install (or install over it) and test.
