const H = require('./helpers');
if (!H.FFMPEG || !H.FFPROBE) H.skip('tools', 'needs ffmpeg and ffprobe');
const T = require(H.ROOT + '/media-tools.js'); const assert = require('assert'); const { execFileSync } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-')); const src = H.sample(); // 20 s, 25 fps, 640x360
  const dur = (f) => parseFloat(execFileSync(H.FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
  for (const mode of ['copy', 'precise', 'gif']) {
    // 'copy' at 5 s: the previous keyframe is at 0 s -> must auto-switch to precise (otherwise the clip would be ~9 s)
    const out = path.join(dir, T.clipName(src, 5, 9, mode, true)); const r = await T.exportClip(H.FFMPEG, { input: src, start: 5, end: 9, mode, out, hasVideo: true, ffprobePath: H.FFPROBE });
    assert(r.ok, mode + ': ' + r.error); const d = dur(out); console.log(mode, '->', r.mode, r.switched ? '(auto-switched)' : '', d.toFixed(2) + 's', r.size + 'B');
    assert(d > 3.7 && d < 4.4, mode + ' duration ' + d); assert.strictEqual(r.switched, mode === 'copy');
  }
  // 'copy' on a keyframe (10 s is a keyframe in this file) stays a true lossless copy
  const kf = path.join(dir, 'kf.mp4'); const rk = await T.exportClip(H.FFMPEG, { input: src, start: 10, end: 14, mode: 'copy', out: kf, hasVideo: true, ffprobePath: H.FFPROBE });
  assert(rk.ok && rk.mode === 'copy' && !rk.switched && Math.abs(dur(kf) - 4) < 0.5, JSON.stringify(rk)); console.log('copy on keyframe stays lossless', dur(kf).toFixed(2) + 's');
  assert.strictEqual(await T.findPrevKeyframe(H.FFPROBE, src, 5), 0); assert(Math.abs(await T.findPrevKeyframe(H.FFPROBE, src, 12) - 10) < 0.1); assert.strictEqual(await T.findPrevKeyframe(null, src, 5), null);
  // audio-only source
  execFileSync(H.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', path.join(dir, 'a.mp3')]);
  const ao = path.join(dir, T.clipName(path.join(dir, 'a.mp3'), 2, 5, 'precise', false)); assert(/\.m4a$/.test(ao));
  assert((await T.exportClip(H.FFMPEG, { input: path.join(dir, 'a.mp3'), start: 2, end: 5, mode: 'precise', out: ao, hasVideo: false })).ok);
  // guard rails never throw
  assert.match((await T.exportClip(H.FFMPEG, { input: src, start: 9, end: 5, mode: 'copy', out: path.join(dir, 'x.mp4') })).error, /after the A point/);
  assert.match((await T.exportClip(null, { input: src, start: 1, end: 5, mode: 'copy', out: 'x' })).error, /ffmpeg not found/);
  assert.match((await T.exportClip(H.FFMPEG, { input: '/nope.mp4', start: 1, end: 5, mode: 'copy', out: 'x' })).error, /not found/);
  assert.match((await T.exportClip(H.FFMPEG, { input: src, start: 1, end: 5, mode: 'gif', hasVideo: false, out: 'x' })).error, /GIF needs/);
  assert.strictEqual((await T.exportClip(H.FFMPEG, { input: path.join(dir, 'a.mp3'), start: 1, end: 5, mode: 'copy', out: '/nonexistent-dir/x.mp3', hasVideo: false })).ok, false);
  assert(/^ffmpeg version/.test(await T.getVersion(H.FFMPEG, ['-version']))); assert.strictEqual(await T.getVersion('/no/such/tool'), null); assert.strictEqual(await T.getVersion(null), null);
  const txt = T.buildDiagnostics({ version: '2.5', electron: '1', chrome: '2', node: '3', os: 'Win', cpu: 'x', ram: '8 GB', tools: [{ name: 'mpv', path: 'C:/mpv.exe', version: 'mpv 0.40' }, { name: 'deno', path: null }], log: 'a\nb' });
  assert(/deno\s+MISSING/.test(txt) && /mpv\s+OK/.test(txt)); console.log('media-tools OK');
})().catch(e => { console.error(e); process.exit(1); });
