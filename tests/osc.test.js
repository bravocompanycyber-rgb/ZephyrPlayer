const H = require('./helpers');
if (!H.MPV || !H.FFMPEG) H.skip('osc', 'needs mpv and ffmpeg');
const { MpvSession, buildArgs } = require(H.ROOT + '/mpv-session.js'); const assert = require('assert');
(async () => {
  const a = buildArgs({ quality: 'high', ipcPath: 'x', platform: 'win32', ytdlpPath: 'C:\\Tools,x\\yt-dlp.exe' });
  const so = a.filter(x => x.startsWith('--script-opts')); assert.strictEqual(so.length, 1, 'exactly one --script-opts'); console.log(so[0]);
  const s = new MpvSession({ mpvPath: H.MPV, platform: process.platform }); const got = [];
  s.on('client-message', m => got.push(m[0]));
  await s.play(H.sample(), { quality: 'high', mode: 'off', voOverride: 'null', extra: ['--ao=null'], ytdlpPath: '/opt/my,tools/yt-dlp' });
  await new Promise(r => setTimeout(r, 1200)); assert.strictEqual(s.level, 0, s.tail);
  const props = await s.getProp('script-opts'); console.log('script-opts =>', JSON.stringify(props));
  assert.strictEqual(props['osc-layout'], 'bottombar'); assert.strictEqual(props['ytdl_hook-ytdl_path'], '/opt/my,tools/yt-dlp');
  for (const k of ['<', '>', 'F8']) { const r = await s.ipc.command('keypress', k).then(() => 'ok').catch(e => e.message); console.log('keypress', k, r); }
  await new Promise(r => setTimeout(r, 400)); console.log('client messages from keys:', got); assert.deepStrictEqual(got.sort(), ['zephyr-next', 'zephyr-prev', 'zephyr-queue']);
  await s.stop(); console.log('OSC/keybind OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
