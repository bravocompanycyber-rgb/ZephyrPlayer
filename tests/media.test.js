const H = require('./helpers');
const U = require(H.ROOT + '/media-utils.js'); const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zmu-'));
  const mk = (p, c = 'x') => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c); };
  mk('Show/S01E10.mkv'); mk('Show/S01E2.mkv'); mk('Show/S01E2.en.srt'); mk('Show/S01E2.fr.ass'); mk('Show/notes.txt'); mk('Show/sub/deep.mp3'); mk('lone.MP4'); mk('cover.jpg'); mk('dir/Other.srt');
  const r = await U.expandPaths([path.join(root, 'Show'), path.join(root, 'lone.MP4'), path.join(root, 'missing.mkv'), path.join(root, 'Show/S01E2.mkv'), 42, '']);
  console.log(r.media.map(m => path.relative(root, m.path)), r.subs.map(s => path.basename(s)));
  assert.deepStrictEqual(r.media.map(m => m.name), ['S01E2.mkv', 'S01E10.mkv', 'deep.mp3', 'lone.MP4']); // natural order, deduped, files before subdir? (walk order)
  assert.strictEqual(r.subs.length, 2);
  const side = await U.findSidecarSubs(path.join(root, 'Show/S01E2.mkv'));
  assert.deepStrictEqual(side.map(s => path.basename(s)), ['S01E2.en.srt', 'S01E2.fr.ass']);
  const m3u = U.parseM3u('\uFEFF#EXTM3U\r\n#EXTINF:-1,My Song\r\nsongs\\a.mp3\r\nhttp://x.y/z.m3u8\r\n#comment\r\nfile:///tmp/q.mp3\r\n', root);
  console.log(m3u);
  assert.strictEqual(m3u[0].title, 'My Song'); assert.strictEqual(m3u[1].path, 'http://x.y/z.m3u8'); assert.strictEqual(m3u[2].path, '/tmp/q.mp3');
  assert(U.buildM3u(m3u).startsWith('#EXTM3U'));
  assert.deepStrictEqual(U.argvPaths(['electron', '.', '--flag', path.join(root, 'lone.MP4'), '/no/such'], { appDir: path.resolve('.') }), [path.join(root, 'lone.MP4')]);
  console.log('media-utils OK');
})().catch(e => { console.error(e); process.exit(1); });
