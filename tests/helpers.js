'use strict';
// Shared by the tests: project root, tool lookup, and a tiny generated sample video (needs ffmpeg).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function which(cmd, localNames) {
  for (const n of localNames || []) { const p = path.join(ROOT, n); if (fs.existsSync(p)) return p; }
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return cmd; } catch { return null; }
}
const MPV = process.env.MPV || which('mpv', ['mpv.exe']);
const FFMPEG = process.env.FFMPEG || which('ffmpeg', ['ffmpeg/ffmpeg.exe', 'ffmpeg/bin/ffmpeg.exe']);
const FFPROBE = process.env.FFPROBE || which('ffprobe', ['ffmpeg/ffprobe.exe', 'ffmpeg/bin/ffprobe.exe']);

function sample() {
  const f = path.join(os.tmpdir(), 'zephyr-test-sample.mp4');
  if (!fs.existsSync(f)) {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  }
  return f;
}

function skip(name, why) { console.log('SKIP ' + name + ': ' + why); process.exit(0); }
module.exports = { ROOT, MPV, FFMPEG, FFPROBE, sample, skip };
