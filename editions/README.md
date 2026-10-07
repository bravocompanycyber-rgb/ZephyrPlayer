# Modern and Legacy editions

One code base, two installers:

| Edition | For | Electron | Notes |
|---|---|---|---|
| **modern** | Windows 10 / 11 | whatever your `package.json` already uses | Deno for YouTube |
| **legacy** | Windows 7 / 8 / 8.1 (runs on 10 / 11 too) | **22.3.27** (pinned) | QuickJS for YouTube, 32-bit and 64-bit installers |

Electron 23 and newer do not start on Windows 7 / 8 / 8.1, and Electron 22 is the last line that does. That is the only reason for a separate legacy build.

## Build
    editions\build-edition.bat modern
    editions\build-edition.bat legacy

It (1) fetches the tools for that edition so they can be packed next to the exe, (2) merges the right settings into **your** `package.json`
(backed up as `package.json.edition-backup`; nothing is replaced), (3) runs `npm install` and `electron-builder`, (4) puts your `package.json` back.
Installers land in `dist\modern` or `dist\legacy` and are named `ZephyrPlayer-<version>-<edition>-<arch>.exe`, so they never overwrite each other.
The installer registers all media file types (so ZephyrPlayer shows up in **Open with** and **Default apps**) and also builds a portable `.exe`.

You can also run the merge on its own: `node editions/apply-edition.js legacy` and `node editions/apply-edition.js --restore`.

## What is verified and what is not
* The app's Node-side code is tested on Node 16 (the version inside Electron 22) and the interface code is checked to use only features Chromium 108 understands.
* An HTTP fallback replaces `fetch` on old Electron, so online posters still work there.
* **Not verified by me:** the Electron 22 build itself on a real Windows 8.1 PC, and whether the third-party tools (mpv, yt-dlp, FFmpeg, whisper, QuickJS) run on 8.1.
  Run **Tools & health > Run self-test** on the target PC: it proves which tools work. If the newest mpv does not start on Windows 8.1, install an older mpv build
  (from mpv.io/installation) next to the app; ZephyrPlayer only needs a working `mpv.exe`.

## Notes
* The installer script (`setup-tools.ps1`) and tools sit next to the installed exe. If you install into *Program Files* the in-app tool installer needs permission to write there;
  installing for the current user (the default here) avoids that.
* Keep legacy and modern update feeds separate if you publish updates, otherwise a legacy PC could be offered a modern build it cannot run.
