const H = require('./helpers');
if (!H.MPV || !H.FFMPEG) H.skip('session', 'needs mpv and ffmpeg (set MPV/FFMPEG env vars)');
const { MpvSession, buildArgs } = require(H.ROOT + '/mpv-session.js');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const T = H.sample();
const base = { quality: 'high', mode: 'off', voOverride: 'null', extra: ['--ao=null'], screenshotDir: '/tmp/zshots' };
require('fs').mkdirSync('/tmp/zshots', { recursive: true });

async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(80); } throw new Error('timeout waiting'); }

(async () => {
  // 1. every quality preset must be accepted by real mpv
  for (const q of ['fast', 'high', 'sharpen', 'anime', 'anime4k', 'hdr', 'medium']) {
    const s = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
    const r = await s.play(T, Object.assign({}, base, { quality: q, startPos: 4 }));
    assert(r.ok, 'launch ' + q);
    await waitFor(() => typeof s.props['duration'] === 'number');
    assert.strictEqual(s.level, 0, 'quality ' + q + ' needed fallback: ' + s.tail);
    await s.stop();
    console.log('quality ok:', q);
  }

  // 2. live control
  const s = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  const ev = [];
  s.on('recovering', e => ev.push(['recovering', e.level, e.attempt])); s.on('failed', e => ev.push(['failed']));
  s.on('closed', () => ev.push(['closed'])); s.on('stopped', () => ev.push(['stopped']));
  let r = await s.play(T, Object.assign({}, base, { startPos: 5, volume: 80 }));
  assert(r.ok);
  await waitFor(() => s.props['duration'] > 19);
  await waitFor(() => s.props['time-pos'] >= 5);
  console.log('start pos ok, time-pos=', s.props['time-pos'].toFixed(2), 'duration=', s.props['duration']);
  assert.strictEqual(Math.round(s.props['volume']), 80);
  assert(Array.isArray(s.props['track-list']) && s.props['track-list'].length >= 2, 'tracks');
  await s.setProp('pause', true); await waitFor(() => s.props['pause'] === true);
  await s.command('seek', 12, 'absolute'); await sleep(300);
  assert(Math.abs((await s.getProp('time-pos')) - 12) < 0.6, 'seek');
  await s.setProp('brightness', 20); await s.setProp('speed', 1.5);
  await s.setProp('ab-loop-a', 2); await s.setProp('ab-loop-b', 4);
  await s.setProp('video-aspect-override', '16:9'); await s.setProp('video-rotate', 90);
  await s.setProp('vf', 'hflip,vflip');
  await s.setProp('af', 'lavfi=[loudnorm,equalizer=f=100:width_type=o:width=2:g=3,equalizer=f=1000:width_type=o:width=2:g=0,volume=3dB]');
  await sleep(300);
  assert.strictEqual(await s.getProp('brightness'), 20);
  console.log('af =>', await s.getProp('af'));
  console.log('vf =>', JSON.stringify(await s.getProp('vf')));
  await s.setProp('sub-delay', 0.5); await s.setProp('sub-color', '#FFFF00'); await s.setProp('sub-border-color', '#000000');
  await s.setProp('sub-scale', 1.2); await s.setProp('sub-pos', 90); await s.setProp('sub-back-color', '#99000000'); await s.setProp('sub-bold', true); await s.setProp('sub-font', 'Arial');
  await s.setProp('audio-delay', 0.1); await s.setProp('replaygain', 'track'); await s.setProp('audio-channels', 'stereo');
  await s.setProp('audio-spdif', 'ac3,dts');
  await s.setProp('audio-spdif', '');
  await s.setProp('lavfi-complex', '[aid1]asplit[ao][a];[a]showcqt[vo]'); await s.setProp('lavfi-complex', '');
  console.log('props accepted by mpv');
  try { await s.command('screenshot'); } catch (e) { console.log('screenshot (expected to fail headless with vo=null):', e.message); }
  await s.command('keybind', 'MBTN_LEFT_DBL', 'script-message zephyr-fs');
  let got = null; s.on('client-message', a => got = a);
  await s.command('script-message', 'zephyr-fs'); await waitFor(() => got); console.log('client-message ok', got);
  // whitelist enforcement
  await assert.rejects(() => s.command('run', 'calc'), /not allowed/);
  await assert.rejects(() => s.setProp('script-opts', 'x'), /not allowed/);
  console.log('whitelist ok');

  // reuse: loadfile on same session (no relaunch)
  const pid1 = s.child.pid;
  r = await s.play(T, Object.assign({}, base, { startPos: 8, volume: 80 }));
  assert(r.reused && s.child.pid === pid1, 'reuse');
  await waitFor(() => s.props['time-pos'] >= 8);
  console.log('loadfile reuse ok, pos', s.props['time-pos'].toFixed(1));

  // 3. crash recovery (SIGKILL) resumes near last position, keeps live settings
  await s.setProp('pause', false);
  await sleep(800);
  const before = s.lastTime;
  s.child.kill('SIGKILL');
  await waitFor(() => ev.some(e => e[0] === 'recovering'));
  await waitFor(() => s.connected && typeof s.props['time-pos'] === 'number');
  await sleep(600);
  console.log('recovered at', s.props['time-pos'].toFixed(1), 'was', before.toFixed(1), 'events', JSON.stringify(ev));
  assert(s.props['time-pos'] >= before - 1);
  assert.strictEqual(await s.getProp('brightness'), 20, 'live props re-applied');
  await s.stop();
  assert(ev.some(e => e[0] === 'stopped'));

  // 4. bad option => escalates to safe level, finally reports failure instead of looping
  const s2 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  const ev2 = []; s2.on('recovering', e => ev2.push(e.level)); s2.on('failed', e => ev2.push('failed'));
  await s2.play(T, Object.assign({}, base, { extra: ['--ao=null', '--definitely-not-an-option=1'] }));
  await waitFor(() => ev2.includes('failed'), 15000);
  console.log('bad option escalation:', JSON.stringify(ev2)); assert.strictEqual(ev2[ev2.length-1], 'failed');

  // 4b. blank-video guard: audio clock runs but vo never configures -> escalate; slow loading must NOT escalate
  const s6 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  const ev6 = []; s6.on('recovering', e => ev6.push([e.level, e.reason]));
  await s6.play(T, Object.assign({}, base, { startPos: 2 }));
  await waitFor(() => s6.props['time-pos'] >= 2 && Array.isArray(s6.props['track-list']));
  const realGet = s6.getProp.bind(s6);
  // (a) loading/buffering: clock not advancing, vo reports not configured -> never escalates
  s6.getProp = async (n) => (n === 'vo-configured' ? false : realGet(n));
  await s6.setProp('pause', true); await sleep(300);
  for (let i = 0; i < 4; i++) await s6._checkBlank();
  assert.strictEqual(ev6.length, 0, 'paused/buffering must not escalate'); assert.strictEqual(s6.level, 0);
  await s6.setProp('pause', false);
  // (b) clock advancing but no video output twice in a row -> escalate once
  await s6._checkBlank(); await sleep(1500); await s6._checkBlank(); await sleep(1500); await s6._checkBlank();
  await waitFor(() => s6.connected && s6.level === 1 && typeof s6.props['time-pos'] === 'number');
  console.log('blank-video guard:', JSON.stringify(ev6), 'resumed at', (s6.props['time-pos'] || 0).toFixed(1));
  assert.strictEqual(ev6.length, 1); assert.strictEqual(ev6[0][0], 1);
  await s6.stop();

  // 4c. adaptive perf guard: sustained frame drops -> live light scalers, then frame dropping policy
  const s7 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  const perfEv = []; s7.on('perf', e => perfEv.push(e.stage));
  await s7.play(T, Object.assign({}, base, { quality: 'anime' }));
  await waitFor(() => s7.props['duration'] > 19);
  assert.strictEqual(await s7.getProp('scale'), 'ewa_lanczossharp');
  s7._loadedAt = 0; let drops = 0; const real7 = s7.getProp.bind(s7);
  s7.getProp = async (n) => (n === 'frame-drop-count' ? (drops += 40) : n === 'decoder-frame-drop-count' ? 0 : real7(n));
  for (let i = 0; i < 4; i++) { await s7._perfTick(); await sleep(1100); }
  s7.getProp = real7;
  console.log('perf stages:', perfEv, 'scale now', await s7.getProp('scale'), 'deband', await s7.getProp('deband'));
  assert(perfEv.length >= 1 && (await s7.getProp('scale')) === 'bilinear' && (await s7.getProp('deband')) === false);
  await s7.stop();

  // 4d. quality presets: "high" is the balanced preset (no ewa_lanczos / deband); heavy ones stay opt-in
  const { buildArgs: ba } = require(H.ROOT + '/mpv-session.js');
  const hi = ba({ quality: 'high', ipcPath: 'x', platform: 'win32', level: 0 }).join(' ');
  assert(/--scale=spline36/.test(hi) && !/ewa_lanczos|deband=yes/.test(hi) && /--hwdec=auto-safe/.test(hi) && /--gpu-api=d3d11/.test(hi));
  const lvl2 = ba({ quality: 'high', ipcPath: 'x', platform: 'win32', level: 2 }).join(' ');
  assert(/--hwdec=no/.test(lvl2) && !/--gpu-api=d3d11/.test(lvl2));
  const yt = ba({ quality: 'high', ipcPath: 'x', platform: 'win32', jsRuntime: 'deno:C:/Tools,x/deno.exe', cookies: 'chrome' }).join(' ');
  assert(/--ytdl-raw-options=no-playlist=,js-runtimes=%24%deno:C:\/Tools,x\/deno\.exe,cookies-from-browser=chrome/.test(yt), yt.match(/--ytdl-raw-options=\S+/)[0]);
  console.log('buildArgs ok');

  // 5. user closes window => 'closed' (exit 0), no recovery
  const s3 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  const ev3 = []; s3.on('closed', () => ev3.push('closed')); s3.on('recovering', () => ev3.push('recovering'));
  await s3.play(T, base); await waitFor(() => s3.connected && s3.props['duration']);
  await s3.ipc.command('quit'); await waitFor(() => ev3.length);
  assert.deepStrictEqual(ev3, ['closed']); console.log('user-quit => closed ok');

  // 6. filename that looks like an option is safe thanks to '--'
  const WD = require('os').tmpdir(); require('fs').copyFileSync(T, require('path').join(WD, '-weird name.mp4'));
  const s4 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  await s4.play(require('path').join(WD, '-weird name.mp4'), base);
  const s5 = new MpvSession({ mpvPath: H.MPV, platform: process.platform });
  process.chdir(WD);
  await s5.play('-weird name.mp4', base);
  await waitFor(() => s5.props['duration'] > 19); console.log('dash-leading filename ok');
  await s4.stop(); await s5.stop();
  console.log('ALL SESSION TESTS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
