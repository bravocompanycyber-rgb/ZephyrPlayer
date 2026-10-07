'use strict';
/** Finds other media players on Windows (VLC, MPC-HC incl. the K-Lite Codec Pack one, MPC-BE, PotPlayer, KMPlayer)
 *  so a file that no built-in engine can play can be handed to them. Pure + injectable for tests. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CATALOG = [
  { id: 'mpc-hc', name: 'MPC-HC', exes: ['MPC-HC\\mpc-hc64.exe', 'MPC-HC\\mpc-hc.exe', 'K-Lite Codec Pack\\MPC-HC64\\mpc-hc64.exe', 'K-Lite Codec Pack\\MPC-HC\\mpc-hc.exe', 'MPC-HC x64\\mpc-hc64.exe'] },
  { id: 'mpc-be', name: 'MPC-BE', exes: ['MPC-BE x64\\mpc-be64.exe', 'MPC-BE\\mpc-be.exe'] },
  { id: 'vlc', name: 'VLC media player', exes: ['VideoLAN\\VLC\\vlc.exe'] },
  { id: 'potplayer', name: 'PotPlayer', exes: ['DAUM\\PotPlayer\\PotPlayerMini64.exe', 'PotPlayer\\PotPlayerMini64.exe', 'DAUM\\PotPlayer\\PotPlayerMini.exe', 'PotPlayer\\PotPlayerMini.exe'] },
  { id: 'kmplayer', name: 'KMPlayer', exes: ['The KMPlayer\\KMPlayer64.exe', 'The KMPlayer\\KMPlayer.exe', 'KMPlayer 64X\\KMPlayer64.exe'] },
  { id: 'smplayer', name: 'SMPlayer', exes: ['SMPlayer\\smplayer.exe'] }
];

function programDirs(env) {
  const e = env || process.env;
  const dirs = [e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432, e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Programs')].filter(Boolean);
  return Array.from(new Set(dirs));
}

function detectPlayers({ env, exists } = {}) {
  const has = exists || ((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  const dirs = programDirs(env);
  const out = [];
  for (const p of CATALOG) {
    let found = null;
    for (const d of dirs) {
      for (const rel of p.exes) { const full = path.win32.join(d, rel); const local = path.join(d, rel.replace(/\\/g, path.sep)); const f = has(full) ? full : (has(local) ? local : null); if (f) { found = f; break; } }
      if (found) break;
    }
    if (found) out.push({ id: p.id, name: p.name, path: found, klite: /k-lite/i.test(found) });
  }
  // a K-Lite install without its own player folder still tells the user what is available
  const klite = dirs.some((d) => has(path.win32.join(d, 'K-Lite Codec Pack', 'unins000.exe')) || has(path.join(d, 'K-Lite Codec Pack', 'unins000.exe')));
  return out.map((p) => Object.assign(p, { kliteInstalled: klite }));
}

function launchArgs(player, file) {
  switch (player.id) {
    case 'vlc': return ['--play-and-exit', file];
    case 'mpc-hc': case 'mpc-be': return [file, '/play'];
    default: return [file];
  }
}

function openIn(player, file, spawnImpl) {
  return new Promise((resolve) => {
    try {
      const child = (spawnImpl || spawn)(player.path, launchArgs(player, file), { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (e) => resolve({ ok: false, error: e.message }));
      if (child.unref) child.unref();
      setTimeout(() => resolve({ ok: true }), 250);
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

module.exports = { detectPlayers, launchArgs, openIn, CATALOG };
