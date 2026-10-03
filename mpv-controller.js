/**
 * ZephyrPlayer – mpv locator.
 *
 * Playback control now lives in mpv-session.js (JSON IPC, crash recovery, live settings).
 * This module only finds mpv.exe and keeps the old export names so existing code keeps working.
 * It never blocks: the PATH probe is cached and runs once.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

let pathProbe; // undefined = not probed yet, null/'mpv' afterwards

function probePath() {
  if (pathProbe !== undefined) return pathProbe;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mpv'], { stdio: 'ignore', windowsHide: true, timeout: 4000 });
    pathProbe = 'mpv';
  } catch {
    pathProbe = null;
  }
  return pathProbe;
}

class MpvController {
  findMpv() {
    const names = process.platform === 'win32' ? ['mpv.exe'] : ['mpv'];
    const dirs = [
      process.resourcesPath,
      __dirname,
      path.join(__dirname, 'mpv'),
      path.join(__dirname, 'bin'),
      path.dirname(process.execPath),
      path.join(path.dirname(process.execPath), 'mpv'),
      path.join(path.dirname(process.execPath), 'resources')
    ].filter(Boolean);
    for (const d of dirs) {
      for (const n of names) {
        const p = path.join(d, n);
        try { if (fs.existsSync(p)) return p; } catch {}
      }
    }
    return probePath();
  }

  isAvailable() { return !!this.findMpv(); }
  isReady() { return false; }
  async quit() { /* nothing to stop here: mpv-session.js owns the process */ }
}

module.exports = { MpvController, findMpv: () => new MpvController().findMpv() };
