const H = require('./helpers');
if (!H.FFMPEG || !H.FFPROBE || !H.MPV) H.skip('probe', 'needs ffmpeg, ffprobe and mpv');
const { MediaProbe } = require(H.ROOT + '/media-probe.js'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-'));
  const T = H.sample();
  // richer test media: HEVC 10-bit + AC3 + 2 audio tracks + subtitle, in mkv
  require('child_process').execFileSync(H.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=6',
    '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-c:a', 'ac3', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', '-metadata', 'title=Test Title', path.join(dir, 'hevc.mkv')]);
  const p = new MediaProbe({ ffprobePath: H.FFPROBE, ffmpegPath: H.FFMPEG, mpvPath: H.MPV, cacheFile: path.join(dir, 'cache.json'), thumbDir: path.join(dir, 'thumbs'), log: console.log });
  let i = await p.probe(T); console.log('mp4 ffprobe:', JSON.stringify(i));
  assert(i.ok && Math.abs(i.duration - 20.02) < 0.1 && i.width === 640 && i.vcodec === 'h264' && i.acodec === 'aac' && i.fps === 25);
  i = await p.probe(path.join(dir, 'hevc.mkv')); console.log('mkv ffprobe:', JSON.stringify(i));
  assert(i.vcodec === 'hevc' && i.bitDepth === 10 && i.acodec === 'ac3' && i.audioTracks === 2 && i.title === 'Test Title' && i.audioLangs.join() === 'eng,jpn');
  // fallback to mpv when ffprobe is missing
  const p2 = new MediaProbe({ ffprobePath: null, mpvPath: H.MPV }); i = await p2.probe(path.join(dir, 'hevc.mkv')); console.log('mkv mpv-fallback:', JSON.stringify(i));
  assert(i.source === 'mpv' && i.vcodec === 'hevc' && i.width === 1280 && Math.abs(i.duration - 6) < 0.2 && i.acodec === 'ac3');
  // broken / missing files never throw
  fs.writeFileSync(path.join(dir, 'junk.mkv'), 'not media at all'); assert.strictEqual((await p.probe(path.join(dir, 'junk.mkv'))).ok, false); assert.strictEqual((await p.probe('/nope.mkv')).ok, false);
  // concurrency + dedupe + cache persistence
  const many = await Promise.all(Array.from({ length: 8 }, () => p.probe(T))); assert(many.every(x => x.ok));
  await new Promise(r => setTimeout(r, 1800)); assert(fs.existsSync(path.join(dir, 'cache.json')));
  const p3 = new MediaProbe({ cacheFile: path.join(dir, 'cache.json') }); assert((await p3.probe(T)).ok, 'cache hit with no tools at all');
  // poster frame
  const th = await p.thumb(T, 20); console.log('thumb:', th, th && fs.statSync(th).size); assert(th && fs.statSync(th).size > 500);
  assert.strictEqual(await p.thumb(T, 20), th);
  // embedded cover art in an mp3 -> hasCover + extractable
  const cov = path.join(dir, 'cover.png'); require('child_process').execFileSync(H.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=400x400:d=1', '-frames:v', '1', cov]);
  const mp3 = path.join(dir, 'withcover.mp3'); require('child_process').execFileSync(H.FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-i', cov, '-map', '0', '-map', '1', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-disposition:v', 'attached_pic', mp3]);
  const ci = await p.probe(mp3); assert(ci.ok && !ci.hasVideo && ci.hasCover, 'cover detected: ' + JSON.stringify(ci));
  const ct = await p.thumb(mp3, 3, true); assert(ct && fs.statSync(ct).size > 300, 'cover extracted'); console.log('cover art extracted', fs.statSync(ct).size + 'B');
  console.log('media-probe OK');
})().catch(e => { console.error(e); process.exit(1); });
