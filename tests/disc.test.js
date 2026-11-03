const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync, spawnSync } = require('child_process');
const D = require(H.ROOT + '/disc-utils.js'); const MU = require(H.ROOT + '/media-utils.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zdisc-')); const mk = (...p) => { const f = path.join(tmp, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(2048, 1)); return f; };
(async () => {
  // folders
  mk('MyDVD', 'VIDEO_TS', 'VIDEO_TS.IFO'); mk('MyDVD', 'VIDEO_TS', 'VTS_01_1.VOB'); mk('MyBD', 'BDMV', 'STREAM', '00000.m2ts'); mk('MyBD', 'BDMV', 'index.bdmv'); mk('Plain', 'a.mp4');
  assert.deepStrictEqual(await D.detectDiscFolder(path.join(tmp, 'MyDVD')), { type: 'dvd', root: path.join(tmp, 'MyDVD') }); assert.deepStrictEqual(await D.detectDiscFolder(path.join(tmp, 'MyDVD', 'VIDEO_TS')), { type: 'dvd', root: path.join(tmp, 'MyDVD') }, 'dropping VIDEO_TS itself works'); assert.deepStrictEqual(await D.detectDiscFolder(path.join(tmp, 'MyBD', 'BDMV')), { type: 'bd', root: path.join(tmp, 'MyBD') }); assert.strictEqual(await D.detectDiscFolder(path.join(tmp, 'Plain')), null);
  // a folder containing discs: each disc is ONE item (not hundreds of vob/m2ts pieces); normal files beside them still come through
  const lib = path.join(tmp, 'Library'); fs.mkdirSync(lib); fs.cpSync(path.join(tmp, 'MyDVD'), path.join(lib, 'Movie One'), { recursive: true }); fs.cpSync(path.join(tmp, 'MyBD'), path.join(lib, 'Movie Two'), { recursive: true }); fs.writeFileSync(path.join(lib, 'clip.mp4'), 'x');
  const r = await MU.expandPaths([lib]); assert.deepStrictEqual(r.discs.map((d) => d.type + ':' + d.name).sort(), ['bd:Movie Two', 'dvd:Movie One']); assert.deepStrictEqual(r.media.map((m) => m.name), ['clip.mp4'], 'no VOB / M2TS pieces leak into the playlist');
  // disc images, detected by what is INSIDE (real ISO files made by genisoimage)
  if (spawnSync('genisoimage', ['-version']).error) { console.log('SKIP image creation: genisoimage not installed'); }
  else {
    const out = path.join(tmp, 'dvd.iso'); execFileSync('genisoimage', ['-quiet', '-o', out, '-V', 'MYDVD', path.join(tmp, 'MyDVD')]); assert.strictEqual(await D.detectDiscImage(out), 'dvd', 'DVD image');
    const out2 = path.join(tmp, 'bd.iso'); execFileSync('genisoimage', ['-quiet', '-udf', '-o', out2, '-V', 'MYBD', path.join(tmp, 'MyBD')]); assert.strictEqual(await D.detectDiscImage(out2), 'bd', 'Blu-ray image (UDF)');
    const out3 = path.join(tmp, 'data.iso'); execFileSync('genisoimage', ['-quiet', '-o', out3, path.join(tmp, 'Plain')]); assert.strictEqual(await D.detectDiscImage(out3), null, 'an ordinary data disc is not offered as a movie');
    const rr = await MU.expandPaths([out, out2, out3]); assert.deepStrictEqual(rr.discs.map((d) => d.type + ':' + d.name).sort(), ['bd:bd.iso', 'dvd:dvd.iso']); assert.strictEqual(rr.media.length, 0, 'the iso files are not treated as media files'); console.log('real ISO images detected: DVD, Blu-ray (UDF), and a plain data disc is ignored');
  }
  assert.strictEqual(await D.detectDiscImage(path.join(tmp, 'nope.iso')), null); fs.writeFileSync(path.join(tmp, 'tiny.iso'), 'x'); assert.strictEqual(await D.detectDiscImage(path.join(tmp, 'tiny.iso')), null);
  // what mpv receives
  assert.deepStrictEqual(D.discPlay('dvd', 'D:\\Movies\\My DVD'), { input: 'dvdnav://', args: ['--dvd-device=D:\\Movies\\My DVD'] }); assert.deepStrictEqual(D.discPlay('bd', 'E:\\x.iso'), { input: 'bd://', args: ['--bluray-device=E:\\x.iso'] });
  for (const bad of [['dvd', '--script=evil.lua'], ['dvd', 'a\nb'], ['bd', ''], ['cd', 'x'], ['dvd', null]]) assert.strictEqual(D.discPlay(...bad), null, JSON.stringify(bad));
  // mpv arguments
  const { buildArgs } = require(H.ROOT + '/mpv-session.js'); const a = buildArgs({ quality: 'high', ipcPath: 'x', platform: 'win32', discArgs: ['--dvd-device=D:\\My DVD'] }); assert(a.includes('--dvd-device=D:\\My DVD'), 'disc device is passed as one argument');
  if (H.MPV) { const p = spawnSync(H.MPV, ['--list-protocols'], { encoding: 'utf8' }); const t = (p.stdout || '') + (p.stderr || ''); console.log('this mpv supports:', ['dvdnav://', 'bd://', 'dvd://'].filter((x) => t.includes(x)).join(' ') || '(could not list)'); }
  console.log('disc OK');
})().catch((e) => { console.error(e); process.exit(1); });
