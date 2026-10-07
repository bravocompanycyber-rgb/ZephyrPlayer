'use strict';
/** Which build is this? "legacy" = Electron 22 line (the last that runs on Windows 7 / 8 / 8.1), "modern" = anything newer. */
function windowsName(release, platform) {
  if (platform !== 'win32') return '';
  const m = /^(\d+)\.(\d+)\.?(\d*)/.exec(String(release || ''));
  if (!m) return 'Windows';
  const major = +m[1], minor = +m[2], build = +(m[3] || 0);
  if (major === 6 && minor === 1) return 'Windows 7';
  if (major === 6 && minor === 2) return 'Windows 8';
  if (major === 6 && minor === 3) return 'Windows 8.1';
  if (major === 10) return build >= 22000 ? 'Windows 11' : 'Windows 10';
  return 'Windows';
}
function detectEdition({ platform, osRelease, electron, node } = {}) {
  const emajor = parseInt(String(electron || '0').split('.')[0], 10) || 0;
  const nmajor = parseInt(String(node || '0').split('.')[0], 10) || 0;
  const win = windowsName(osRelease, platform);
  const oldOS = /^Windows (7|8|8\.1)$/.test(win);
  const legacyBuild = emajor > 0 && emajor < 23;
  return {
    edition: legacyBuild ? 'legacy' : 'modern',
    legacyBuild, oldOS, windows: win, electronMajor: emajor, nodeMajor: nmajor,
    label: (legacyBuild ? 'Legacy edition (Windows 7 / 8 / 8.1)' : 'Modern edition (Windows 10 / 11)') + (win ? ' · running on ' + win : ''),
    // yt-dlp needs a JS runtime for YouTube: Deno needs Windows 10+, so old systems use QuickJS; Electron-as-Node only if Node >= 20
    preferQuickJs: oldOS || legacyBuild,
    canUseElectronAsNode: nmajor >= 20
  };
}
module.exports = { detectEdition, windowsName };
