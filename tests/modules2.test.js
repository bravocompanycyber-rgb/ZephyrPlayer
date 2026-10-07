const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const EP = require(H.ROOT + '/external-players.js'), FA = require(H.ROOT + '/file-assoc.js'), ED = require(H.ROOT + '/edition.js'), MU = require(H.ROOT + '/media-utils.js'), MT = require(H.ROOT + '/media-tools.js');
(async () => {
  // ---- external players (K-Lite's MPC-HC, VLC, PotPlayer...) found in the usual places, none invented
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zep-')); const pf = path.join(root, 'Program Files'), pf86 = path.join(root, 'Program Files (x86)');
  const touch = (...p) => { const f = path.join(...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); };
  touch(pf86, 'K-Lite Codec Pack', 'MPC-HC64', 'mpc-hc64.exe'); touch(pf86, 'K-Lite Codec Pack', 'unins000.exe'); touch(pf, 'VideoLAN', 'VLC', 'vlc.exe'); touch(pf, 'DAUM', 'PotPlayer', 'PotPlayerMini64.exe');
  let pl = EP.detectPlayers({ env: { ProgramFiles: pf, 'ProgramFiles(x86)': pf86 }, exists: undefined });
  console.log('players:', pl.map((p) => p.name + (p.klite ? ' [K-Lite]' : '')).join(', '));
  assert.deepStrictEqual(pl.map((p) => p.id).sort(), ['mpc-hc', 'potplayer', 'vlc']); assert(pl.find((p) => p.id === 'mpc-hc').klite && pl.every((p) => p.kliteInstalled));
  assert.deepStrictEqual(EP.detectPlayers({ env: { ProgramFiles: path.join(root, 'nothing') } }), []);
  assert.deepStrictEqual(EP.launchArgs({ id: 'vlc' }, 'C:\\a b.mkv'), ['--play-and-exit', 'C:\\a b.mkv']); assert.deepStrictEqual(EP.launchArgs({ id: 'mpc-hc' }, 'x.mkv'), ['x.mkv', '/play']);
  let spawned; const fake = (exe, args) => { spawned = [exe, args]; return { once() {}, unref() {} }; };
  assert((await EP.openIn({ id: 'vlc', path: 'C:\\vlc.exe' }, 'D:\\movie one.mkv', fake)).ok); assert.deepStrictEqual(spawned, ['C:\\vlc.exe', ['--play-and-exit', 'D:\\movie one.mkv']], 'path with spaces passed as ONE argument, no shell');
  assert.strictEqual((await EP.openIn({ id: 'x', path: 'p' }, 'f', () => { throw new Error('boom'); })).ok, false);

  // ---- file associations: registry commands are correct and the whole flow survives failures
  const ctx = { exe: 'C:\\Users\\Tim\\My Apps\\ZephyrPlayer.exe', appDir: 'C:\\dev\\Zephyr Player', packaged: false };
  assert.strictEqual(FA.openCommand(ctx), '"C:\\Users\\Tim\\My Apps\\ZephyrPlayer.exe" "C:\\dev\\Zephyr Player" "%1"'); assert.strictEqual(FA.openCommand({ exe: 'C:\\z.exe', packaged: true }), '"C:\\z.exe" "%1"');
  const cmds = FA.buildRegCommands(Object.assign({}, ctx, { exts: ['mkv', 'mp3'] }));
  const flat = cmds.map((c) => c.join(' | ')); assert(flat.some((l) => /ZephyrPlayer\.Media\\shell\\open\\command \| \/ve \| \/t \| REG_SZ \| \/d \| "C:\\Users\\Tim\\My Apps\\ZephyrPlayer\.exe" "C:\\dev\\Zephyr Player" "%1"/.test(l)), 'open command'); assert(flat.some((l) => /\.mkv\\OpenWithProgids \| \/v \| ZephyrPlayer\.Media \| \/t \| REG_NONE \| \/f$/.test(l)), 'Open with entry (REG_NONE, no data)');
  assert(flat.some((l) => /RegisteredApplications \| \/v \| ZephyrPlayer/.test(l)) && flat.some((l) => /FileAssociations \| \/v \| \.mp3 \| \/t \| REG_SZ \| \/d \| ZephyrPlayer\.Media/.test(l)) && cmds.every((c) => c[1].startsWith('HKCU\\')), 'only HKCU: no admin needed');
  const log = []; const okRunner = (exe, args, o, cb) => { log.push(args); cb(null, ''); }; let r = await FA.register(Object.assign({}, ctx, { select: { video: true, audio: false, playlist: false } }), okRunner); assert(r.ok && r.total === FA.EXTS.video.length && log.length === 8 + 2 * FA.EXTS.video.length);
  let k = 0; const flaky = (exe, args, o, cb) => { k++; cb(k % 5 === 0 ? new Error('denied') : null, ''); }; r = await FA.register(ctx, flaky); assert.strictEqual(r.ok, false); assert(r.failed > 0 && /failed/.test(r.error));
  const queried = []; const q = (exe, args, o, cb) => { queried.push(args[1]); cb(/\.(mkv|mp3)\\/.test(args[1]) ? null : new Error('not found'), ''); }; const st = await FA.status(q); assert.strictEqual(st.registered, 2); assert.strictEqual(st.total, FA.EXTS.video.length + FA.EXTS.audio.length + 3);
  r = await FA.unregister(ctx, (e, a, o, cb) => cb(new Error('unable to find the specified registry key'), 'ERROR: The system was unable to find the specified registry key')); assert.strictEqual(r.ok, true, 'removing what is not there is fine');

  // ---- edition detection (legacy = Electron 22 line for Windows 7/8/8.1)
  const e1 = ED.detectEdition({ platform: 'win32', osRelease: '6.3.9600', electron: '22.3.27', node: '16.17.1' }); assert(e1.edition === 'legacy' && e1.windows === 'Windows 8.1' && e1.oldOS && e1.preferQuickJs && !e1.canUseElectronAsNode, JSON.stringify(e1));
  const e2 = ED.detectEdition({ platform: 'win32', osRelease: '10.0.22631', electron: '33.2.0', node: '20.18.1' }); assert(e2.edition === 'modern' && e2.windows === 'Windows 11' && !e2.preferQuickJs && e2.canUseElectronAsNode);
  assert.strictEqual(ED.windowsName('10.0.19045', 'win32'), 'Windows 10'); assert.strictEqual(ED.windowsName('6.1.7601', 'win32'), 'Windows 7'); assert.strictEqual(ED.detectEdition({ platform: 'linux', osRelease: '6.5', electron: '30.0.0', node: '20.0.0' }).windows, '');
  assert(ED.detectEdition({ platform: 'win32', osRelease: '6.3.9600', electron: '30.0.0', node: '20.1.0' }).preferQuickJs, 'modern build on 8.1 still prefers quickjs');

  // ---- playlist files open as playlists (m3u/m3u8/pls), relative paths resolved, URLs become streams
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-')); fs.writeFileSync(path.join(d, 'a.mp4'), 'x'); fs.mkdirSync(path.join(d, 'sub')); fs.writeFileSync(path.join(d, 'sub', 'b.mkv'), 'x');
  fs.writeFileSync(path.join(d, 'list.m3u8'), '#EXTM3U\n#EXTINF:-1,First\na.mp4\n#EXTINF:-1,Second\nsub/b.mkv\n#EXTINF:-1,Radio\nhttps://example.com/live.m3u8\nmissing.mp4\n');
  fs.writeFileSync(path.join(d, 'list.pls'), '[playlist]\nFile1=a.mp4\nTitle1=Alpha\nFile2=http://example.com/s.mp3\nTitle2=Stream\nNumberOfEntries=2\n');
  let x = await MU.expandPaths([path.join(d, 'list.m3u8')]); assert.deepStrictEqual(x.media.map((m) => m.name), ['a.mp4', 'b.mkv']); assert.deepStrictEqual(x.streams, [{ url: 'https://example.com/live.m3u8', title: 'Radio' }]);
  x = await MU.expandPaths([path.join(d, 'list.pls'), 'https://youtu.be/abc']); assert.deepStrictEqual(x.media.map((m) => m.name), ['a.mp4']); assert.deepStrictEqual(x.streams.map((s) => s.url), ['http://example.com/s.mp3', 'https://youtu.be/abc']);
  assert(MU.isPlaylist('X.M3U') && !MU.isPlaylist('x.mp4'));

  // ---- codec report from the real ffmpeg build
  if (H.FFMPEG) { const rep = await MT.codecReport(H.FFMPEG); assert(rep.ok && rep.total > 100 && rep.listed > 30, JSON.stringify(rep).slice(0, 200)); const f = (n) => rep.video.concat(rep.audio, rep.subtitles).find((c) => c.id === n);
    assert(f('h264').ok && f('hevc').ok && f('aac').ok && f('ac3').ok && f('subrip').ok, 'common codecs'); console.log('codec report:', rep.supported + '/' + rep.listed, 'listed codecs decodable,', rep.total, 'decoders total, hwaccels:', rep.hwaccels.join(','));
    assert.strictEqual((await MT.codecReport(null)).ok, false); }
  console.log('modules2 OK'); })().catch((e) => { console.error(e); process.exit(1); });
