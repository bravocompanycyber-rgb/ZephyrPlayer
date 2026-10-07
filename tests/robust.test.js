const H = require('./helpers');
if (!H.MPV || !H.FFMPEG) H.skip('robust', 'needs mpv and ffmpeg');
const { MpvSession, buildArgs, mouseBindings } = require(H.ROOT + '/mpv-session.js'); const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const T = H.sample();
const base = { quality: 'high', mode: 'off', voOverride: 'null', extra: ['--ao=null'] };
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(60); } throw new Error('timeout waiting'); }
const mk = () => new MpvSession({ mpvPath: H.MPV, platform: process.platform });
(async () => {
  // ---- 1. settings -> mpv arguments (validated + clamped)
  let a = buildArgs({ quality: 'high', ipcPath: 'x', platform: 'win32', volume: 250, cfg: { volumeMax: 300, cacheMb: 500, hrSeek: false, slang: 'fr,de', alang: 'jpn' } }).join(' ');
  for (const re of [/--volume-max=300/, /--volume=250/, /--demuxer-max-bytes=500MiB/, /--demuxer-max-back-bytes=250MiB/, /--hr-seek=no/, /--slang=fr,de/, /--alang=jpn/]) assert(re.test(a), String(re));
  a = buildArgs({ quality: 'high', ipcPath: 'x', platform: 'win32', volume: 999, cfg: { volumeMax: 99999, cacheMb: 1, slang: 'en;calc.exe' } }).join(' ');
  assert(/--volume-max=300/.test(a) && /--volume=300/.test(a) && /--demuxer-max-bytes=50MiB/.test(a) && /--slang=en,eng/.test(a), 'clamped / injection-proof: ' + a.match(/--(volume-max|slang)=\S+/g));
  assert(/--sub-auto=no/.test(buildArgs({ ipcPath: 'x', platform: 'win32', cfg: { slang: '' } }).join(' ')));
  assert(/--volume-max=200/.test(buildArgs({ ipcPath: 'x', platform: 'win32' }).join(' ')), 'default extra volume 200%');
  const mb = mouseBindings({ wheel: 'volume', wheelShift: 'seek', wheelCtrl: 'speed', click: 'playpause', dblclick: 'fullscreen', middleClick: 'mute', mouseBack: 'prev', mouseForward: 'next' }, { volume: 7, seek: 15 }, 'off');
  const bm = Object.fromEntries(mb); assert.strictEqual(bm.WHEEL_UP, 'add volume 7'); assert.strictEqual(bm['Shift+WHEEL_DOWN'], 'seek -15'); assert.strictEqual(bm['Ctrl+WHEEL_UP'], 'add speed 0.25'); assert.strictEqual(bm.MBTN_LEFT_DBL, 'cycle fullscreen'); assert.strictEqual(bm.MBTN_BACK, 'script-message zephyr-prev');
  assert.strictEqual(Object.fromEntries(mouseBindings({ dblclick: 'fullscreen' }, {}, 'child')).MBTN_LEFT_DBL, 'script-message zephyr-fs'); assert.strictEqual(Object.fromEntries(mouseBindings({ wheel: 'bogus' }, {}, 'off')).WHEEL_UP, 'ignore');
  console.log('cfg args + mouse binding tables OK');

  // ---- 2. the mouse settings really drive mpv's own window (volume boost beyond 100% too)
  const s = mk();
  await s.play(T, Object.assign({}, base, { volume: 100, cfg: { volumeMax: 300, mouse: { wheel: 'volume', wheelShift: 'seek', wheelCtrl: 'speed', click: 'playpause', dblclick: 'none', middleClick: 'mute' }, steps: { volume: 7, seek: 15 } } }));
  await waitFor(() => s.connected && s.props.duration > 19); await s.setProp('pause', true); await sleep(250);
  const key = (k) => s.ipc.command('keypress', k);
  await key('WHEEL_UP'); await sleep(150); assert.strictEqual(Math.round(await s.getProp('volume')), 107, 'wheel up = +7%');
  for (let i = 0; i < 40; i++) await key('WHEEL_UP'); await sleep(300); assert.strictEqual(Math.round(await s.getProp('volume')), 300, 'extra volume is capped at the configured 300%');
  await key('WHEEL_DOWN'); await sleep(150); assert.strictEqual(Math.round(await s.getProp('volume')), 293);
  const t0 = await s.getProp('time-pos'); await key('Shift+WHEEL_UP'); await sleep(350); const t1 = await s.getProp('time-pos'); assert(t1 - t0 > 12 && t1 - t0 < 18, 'shift+wheel seeks 15 s: ' + (t1 - t0));
  await key('Ctrl+WHEEL_UP'); await sleep(150); assert.strictEqual(await s.getProp('speed'), 1.25);
  const p0 = await s.getProp('pause'); await key('MBTN_LEFT'); await sleep(150); assert.strictEqual(await s.getProp('pause'), !p0, 'click toggles pause');
  await key('MBTN_MID'); await sleep(150); assert.strictEqual(await s.getProp('mute'), true, 'middle click mutes');
  console.log('mouse wheel / click settings drive the mpv window, volume boost to 300% works');

  // ---- 3. a frozen mpv is detected, killed and restarted at the same position (never freezes the app)
  if (process.platform !== 'win32') {
    const h = mk(); const ev = [];
    h.on('recovering', (e) => ev.push(e.reason)); h.on('failed', () => ev.push('FAILED'));
    await h.play(T, Object.assign({}, base, { startPos: 3, heartbeatMs: 250, heartbeatTimeoutMs: 350, heartbeatMisses: 2 }));
    await waitFor(() => h.props['time-pos'] >= 3.5); const pid1 = h.child.pid; const before = h.lastTime;
    process.kill(pid1, 'SIGSTOP');                                   // simulate a hard freeze
    await waitFor(() => ev.some((r) => /not responding|stopped responding/.test(r)), 15000);
    await waitFor(() => h.connected && h.child && h.child.pid !== pid1 && typeof h.props['time-pos'] === 'number', 15000); await sleep(500);
    console.log('freeze recovery:', JSON.stringify(ev), 'new pid, resumed near', h.lastTime.toFixed(1), '(was', before.toFixed(1) + ')');
    assert(h.lastTime >= before - 1.5); let dead = false; try { process.kill(pid1, 0); } catch { dead = true; } assert(dead, 'frozen process was killed');
    // stop() on a frozen process must also finish (SIGKILL escalation)
    const pid2 = h.child.pid; process.kill(pid2, 'SIGSTOP'); const t = Date.now(); await h.stop(); const took = Date.now() - t; assert(took < 5000, 'stop() on a frozen player took ' + took + ' ms');
    let dead2 = false; try { process.kill(pid2, 0); } catch { dead2 = true; } assert(dead2); console.log('stop() killed a frozen player in', took, 'ms');
  }

  // ---- 4. stalled network streams reconnect from the same spot; local files never do
  const st = mk(); const calls = []; const evs = [];
  st.on('recovering', (e) => evs.push(e.reason));
  st.inputs = ['https://example.com/live.m3u8']; st.opts = { cfg: {}, stallMs: 80 }; st.lastTime = 321; st.ipc = { connected: true }; st._loadfile = async (src, pos) => { calls.push([src, pos]); };
  st._onCacheStall(true); await sleep(40); st._onCacheStall(false); await sleep(150); assert.strictEqual(calls.length, 0, 'recovering by itself cancels the reload');
  st._onCacheStall(true); await sleep(250); assert.deepStrictEqual(calls, [['https://example.com/live.m3u8', 321]]); assert(/stalled/.test(evs[0]));
  st._stallReloads = 3; calls.length = 0; st._onCacheStall(true); await sleep(200); assert.strictEqual(calls.length, 0, 'at most 3 reloads');
  st._stallReloads = 0; st.inputs = ['/videos/local.mkv']; st._onCacheStall(true); await sleep(200); assert.strictEqual(calls.length, 0, 'local file: no reload');
  st.inputs = ['https://example.com/x.mp4']; st.opts.cfg = { streamReload: false }; st._onCacheStall(true); await sleep(200); assert.strictEqual(calls.length, 0, 'setting off: no reload');
  console.log('stream stall reconnect logic OK');

  // ---- 5. opening something that never opens does not hang forever
  const ow = mk(); let err = null; ow.on('end-file', (e) => { if (e.reason === 'error') err = e.error; });
  await ow.play('http://10.255.255.1/never.mp4', Object.assign({}, base, { openTimeoutMs: 700 }));
  await waitFor(() => err, 15000); console.log('open watchdog / failure reported:', String(err).slice(0, 70)); await ow.stop();
  // ---- 6. audio chain (limiter + loudness + night mode + EQ + gain) is accepted by the real mpv and plays
  const EC = require(H.ROOT + '/engine-config.js');
  const af = EC.composeAudioFilter({ eq: { bass: 4, mid: -2, treble: 3, gain: 6, normalize: false }, limiter: true, normalize: true, night: true });
  assert(/^lavfi=\[loudnorm=.*acompressor=.*equalizer=.*volume=6dB,alimiter=limit=0\.95:level=disabled\]$/.test(af), af); assert.strictEqual(EC.composeAudioFilter({ limiter: false, eq: {} }), ''); assert.strictEqual(EC.composeAudioFilter({ limiter: true }), 'lavfi=[alimiter=limit=0.95:level=disabled]');
  const au = mk(); await au.play(T, Object.assign({}, base, { volume: 100, cfg: { volumeMax: 300 } })); await waitFor(() => au.connected && au.props.duration > 19);
  await au.setProp('af', af); await au.setProp('volume', 250); await sleep(400); const afp = await au.getProp('af'); assert(afp && afp[0] && afp[0].name === 'lavfi' && /alimiter/.test(afp[0].params.graph), 'chain applied'); assert.strictEqual(Math.round(await au.getProp('volume')), 250, '250% volume with the limiter chain');
  const tt0 = await au.getProp('time-pos'); await sleep(1200); assert((await au.getProp('time-pos')) > tt0 + 0.8, 'audio chain does not stall playback'); await au.setProp('af', ''); await au.stop();
  console.log('limiter + loudnorm + night mode + EQ chain accepted by mpv, 250% volume plays');

  // ---- 7. a typo in the user's own mpv options never stops playback (falls back to safe mode)
  const up = EC.parseUserMpvOptions('sub-font-size=45\n# comment\n--deband=yes\nscript=evil.lua\nrun=calc\ninput-conf=x\nvolume-max=999\nbad line!\nytdl-path=x\nloop-file=inf');
  assert.deepStrictEqual(up.accepted, ['--sub-font-size=45', '--deband=yes', '--loop-file=inf']); assert.strictEqual(up.rejected.length, 6, 'dangerous / reserved / malformed lines rejected: ' + up.rejected);
  const ty = mk(); const lv = []; ty.on('recovering', (e) => lv.push(e.level));
  await ty.play(T, Object.assign({}, base, { userExtra: ['--this-option-does-not-exist=1'] })); await waitFor(() => ty.connected && ty.props.duration > 19 && ty.level >= 2, 20000);
  console.log('typo in extra options -> recovered at safety level', ty.level, JSON.stringify(lv)); assert(ty.level >= 2 && lv.length >= 1); await ty.stop();
  const cc = EC.cleanCfg({ volumeMax: 99999, cacheMb: -5, compat: 9, slang: 'x'.repeat(100), mouse: { wheel: 'format-c', click: 'playpause' }, steps: { volume: 0, seek: 1e9 }, extra: 'x' });
  assert.strictEqual(cc.volumeMax, 300); assert.strictEqual(cc.cacheMb, 50); assert.strictEqual(cc.compat, 2); assert.strictEqual(cc.slang.length, 40); assert.strictEqual(cc.mouse.wheel, 'volume', 'unknown action replaced by default'); assert.strictEqual(cc.steps.volume, 1); assert.strictEqual(cc.steps.seek, 300); assert(!('extra' in cc));
  console.log('ROBUSTNESS TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
