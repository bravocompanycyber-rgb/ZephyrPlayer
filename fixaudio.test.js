const H = require('./helpers'); if (!H.FFMPEG || !H.FFPROBE) H.skip('fixaudio', 'needs ffmpeg and ffprobe');
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const T = require(H.ROOT + '/media-tools.js'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zfa-'));
const probe = (f) => JSON.parse(execFileSync(H.FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f]).toString());
(async () => {
  // a "Blu-ray style" mp4: H.264 video + AC-3 5.1 audio (the browser engine cannot play AC-3)
  const src = path.join(dir, 'bluray.mp4'); execFileSync(H.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-filter_complex', '[1:a]pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', src]);
  assert.strictEqual(probe(src).streams.find((s) => s.codec_type === 'audio').codec_name, 'ac3');
  const out = path.join(dir, 'fixed.mp4'); const pct = []; const r = await T.fixAudio(H.FFMPEG, { input: src, out, duration: 6, onProgress: (p) => pct.push(p) });
  assert(r.ok && r.size > 1000, JSON.stringify(r)); const p = probe(out); const v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
  assert.strictEqual(a.codec_name, 'aac', 'audio is now AAC (plays in the built-in engine)'); assert.strictEqual(v.codec_name, 'h264'); assert(a.channels >= 2, 'channels kept'); assert(Math.abs(parseFloat(p.format.duration) - 6) < 0.5, 'same length');
  const srcV = probe(src).streams.find((s) => s.codec_type === 'video'); assert.strictEqual(v.width, srcV.width); assert.strictEqual(v.height, srcV.height); assert(pct.length && pct[pct.length - 1] === 100 && pct.every((x) => x >= 0 && x <= 100), 'progress reported 0..100: ' + pct.slice(-3));
  assert(/frames|nb_frames/.test(JSON.stringify(v)) && String(v.nb_frames) === String(srcV.nb_frames), 'video was copied, not re-encoded (same frame count)');
  assert.strictEqual((await T.fixAudio(null, { input: src, out })).ok, false); assert.match((await T.fixAudio(H.FFMPEG, { input: '/nope.mp4', out })).error, /not found/);
  fs.writeFileSync(path.join(dir, 'junk.mp4'), 'not a video'); const bad = await T.fixAudio(H.FFMPEG, { input: path.join(dir, 'junk.mp4'), out: path.join(dir, 'junk-out.mp4') }); assert.strictEqual(bad.ok, false); assert(!fs.existsSync(path.join(dir, 'junk-out.mp4')), 'no half-written file left behind');
  console.log('fixaudio OK: AC-3 5.1 -> AAC, video copied untouched, progress + errors handled');
})().catch((e) => { console.error(e); process.exit(1); });
