const H = require('./helpers');
const { JSDOM } = require('jsdom'); const fs = require('fs'); const assert = require('assert');
const root = H.ROOT + '/';
const html = fs.readFileSync(root + 'index.html', 'utf8').replace(/<script[^>]*src[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/index.html' });
const w = dom.window;
const calls = []; const listeners = {};
const sub = (n) => (cb) => { listeners[n] = cb; return () => {}; };
w.electronAPI = new Proxy({
  getPathForFile: f => f.path || '', expandPaths: async (p) => ({ media: p.filter(x => !/\.srt$/.test(x)).map(x => ({ path: x, name: x.split('/').pop(), size: 10 })), subs: p.filter(x => /\.srt$/.test(x)) }),
  sidecarSubs: async () => ({ subs: [] }), readSubtitle: async () => ({ ok: true, bytes: new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHi') }),
  probeMedia: async (p) => /missing/.test(p) ? { ok: false, error: 'missing' } : /hevc/.test(p) ? { ok: true, duration: 5400, size: 2e9, width: 1920, height: 1080, hasVideo: true, vcodec: 'hevc', acodec: 'ac3', bitDepth: 10, audioTracks: 2, subTracks: 3, hdr: 'HDR10' } : /song/.test(p) ? { ok: true, duration: 200, hasVideo: false, acodec: 'mp3', title: 'Real Title', artist: 'Band' } : { ok: true, duration: 600, size: 1e8, width: 1280, height: 720, hasVideo: true, vcodec: 'h264', acodec: 'aac', bitDepth: 8, audioTracks: 1, subTracks: 0 },
  thumbMedia: async (p) => ({ ok: true, path: '/cache/' + p.split('/').pop() + '.jpg' }),
  getIcons: async () => ({ ok: true, icons: { play: { type: 'svg', data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>' } } }),
  externalList: async () => ({ ok: true, players: [{ id: 'mpc-hc', name: 'MPC-HC', path: 'C:/Program Files (x86)/K-Lite Codec Pack/MPC-HC64/mpc-hc64.exe', klite: true }, { id: 'vlc', name: 'VLC media player', path: 'C:/vlc.exe' }] }),
  externalOpen: async (o) => { calls.push(['extopen', o]); return { ok: true }; },
  assocStatus: async () => ({ ok: true, registered: 3, total: 40 }), assocRegister: async (sel) => { calls.push(['assoc', sel]); return { ok: true }; }, assocUnregister: async () => ({ ok: true }),
  codecReport: async () => ({ ok: true, total: 500, hwaccels: ['d3d11va'], video: [{ id: 'hevc', name: 'HEVC', ok: true }, { id: 'rv40', name: 'RealVideo', ok: false }], audio: [{ id: 'ac3', name: 'AC-3', ok: true }], subtitles: [] }),
  getEdition: async () => ({ ok: true, label: 'Modern edition (Windows 10 / 11)', version: '2.5.0' }),
  mpvApplyAudioPrefs: async (p) => { calls.push(['audioprefs', p]); return { ok: true }; },
  onlineLookup: async (q) => { calls.push(['online', q]); return q.kind === 'tv' ? { ok: true, kind: 'tv', source: 'TVmaze', title: 'The Mandalorian', year: 2019, genre: 'Action', rating: 8.4, overview: 'A lone gunfighter.', episode: { season: 2, number: 3, title: 'The Heiress' }, posterPath: '/cache/p.jpg', accent: '#dc281e', url: 'https://www.tvmaze.com/x' } : q.kind === 'music' ? { ok: true, kind: 'music', source: 'Apple iTunes', title: 'Real Title', artist: 'Band', album: 'LP', posterPath: '/cache/c.jpg', accent: '#22aa66' } : { ok: false }; },
  toolsStatus: async () => ({ ok: true, canInstall: true, jsRuntime: 'deno', tools: [{ name: 'mpv', path: 'C:/z/mpv.exe', version: 'mpv 0.40', role: 'Plays mkv', required: true }, { name: 'yt-dlp', path: null, version: null, role: 'YouTube', required: true }, { name: 'ffmpeg', path: null, version: null, role: 'Posters', required: false }] }),
  toolsInstall: async (o) => { calls.push(['install', o]); return { ok: true }; },
  exportClip: async (o) => { calls.push(['clip', o]); return { ok: true, path: '/x/clip.mp4', size: 2e6, switched: o.mode === 'copy' }; },
  collectDiagnostics: async () => { calls.push(['diag']); return { ok: true, text: 'x' }; },
  getSetting: async (k) => ({ ok: true, value: true }), setSetting: async (k, v) => { calls.push(['setting', k, v]); return { ok: true }; },
  ytdlpPlaylist: async (u) => ({ ok: true, title: 'My List', entries: [{ title: 'Vid A', url: 'https://youtu.be/a', duration: 60 }, { title: 'Vid B', url: 'https://youtu.be/b', duration: 90 }] }),
  mpvAvailable: async () => ({ available: true }), mpvPlayExternal: async (o) => { calls.push(['play', o]); return { ok: true, mode: 'off', embedded: false }; },
  mpvPlayUrl: async (u, q, e, x) => { calls.push(['url', u]); return { ok: true, mode: 'off' }; },
  mpvCommand: async (n, a) => { calls.push(['cmd', n, a]); return { ok: true }; },
  mpvSetProps: async (m) => { calls.push(['set', m]); return { ok: true }; },
  mpvStop: async () => { calls.push(['stop']); return { ok: true }; },
  recordOpened: async () => ({}), reportProgress: async () => ({}), setEmbedBounds: async () => ({}), setEmbedMode: async () => ({}), setEmbedSuspended: async () => ({}),
  detectWhisper: async () => ({ ok: false }), listAudioDevices: async () => ({ devices: [] }), getAppInfo: async () => ({}),
  onOpenFiles: sub('open'), onMpvStatus: sub('status'), onMpvState: sub('state'), onMpvEvent: sub('event'), onHotkey: sub('hotkey'),
  onMpvProcessError: sub('perr'), onRecordingStatus: sub('rec'), onUpdateStatus: sub('upd'), onSubtitleProgress: sub('sp'), onWindowState: sub('ws'), onOpenFilesMpv: sub('ofm'),
}, { get: (t, k) => k in t ? t[k] : (async () => ({ ok: true })) });
w.HTMLMediaElement.prototype.play = function () { this._playing = true; return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () { this._playing = false; };
w.HTMLMediaElement.prototype.load = function () {};
w.ResizeObserver = class { observe() {} };
const errs = []; w.addEventListener('error', e => errs.push(e.message));
for (const f of ['js/subtitle-parser.js', 'js/media-name.js', 'js/icons-default.js', 'js/icons.js', 'js/settings-store.js', 'js/player.js', 'js/features.js', 'js/controls.js', 'js/settings-ui.js']) w.eval(fs.readFileSync(root + f, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (k, extra = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, extra)));
(async () => {
  await sleep(100);
  await listeners.status({ available: true });
  // local mp4 -> browser engine
  await listeners.open(['/m/a.mp4', '/m/b.mkv', '/m/c.mp4']);
  await sleep(100);
  const video = w.document.getElementById('video');
  assert(/a\.mp4/.test(video.getAttribute('src')), 'mp4 -> html5: ' + video.getAttribute('src'));
  assert.strictEqual(w.document.querySelectorAll('#playlist .playlist-item').length, 3);
  // hotkeys fire ONCE: 'm' must mute (old code toggled twice => no-op)
  key('m'); assert.strictEqual(video.muted, true, 'mute once'); key('m'); assert.strictEqual(video.muted, false);
  // volume keys
  key('ArrowDown'); assert(video.volume < 1);
  // next -> mkv goes to mpv with start params
  key('N', { shiftKey: true }); await sleep(100);
  const play = calls.find(c => c[0] === 'play'); assert(play && /b\.mkv/.test(play[1].files[0]), 'mkv -> mpv'); console.log('mpv play opts:', JSON.stringify(play[1]));
  assert(!video.getAttribute('src'), 'html5 released');
  // mpv state drives the UI
  listeners.state({ duration: 100, 'time-pos': 25, pause: false, volume: 80, speed: 1.5,
    'track-list': [{ id: 1, type: 'audio', lang: 'eng', codec: 'ac3', selected: true }, { id: 2, type: 'audio', lang: 'jpn', codec: 'aac' }, { id: 1, type: 'sub', lang: 'eng', title: 'Full' }] });
  await sleep(250);
  const d = w.document;
  assert.strictEqual(d.getElementById('currentTime').textContent, '0:25'); assert.strictEqual(d.getElementById('duration').textContent, '1:40');
  assert.strictEqual(d.getElementById('played').style.width, '25%'); assert.strictEqual(d.getElementById('speedLabel').textContent, '1.5×');
  assert.strictEqual(d.getElementById('audioTracks').querySelectorAll('button').length, 2, 'real audio tracks listed');
  console.log('audio menu:', Array.from(d.querySelectorAll('#audioTracks button')).map(b => b.textContent));
  // controls go to mpv
  calls.length = 0;
  key(' '); key('ArrowRight'); key('m'); key('s');
  await sleep(50);
  console.log('commands:', JSON.stringify(calls));
  assert(calls.some(c => c[0] === 'cmd' && c[1] === 'cycle' && c[2][0] === 'pause'));
  assert(calls.some(c => c[0] === 'cmd' && c[1] === 'seek' && c[2][0] === 35));
  assert(calls.some(c => c[0] === 'set' && c[1].mute === true));
  assert(calls.some(c => c[0] === 'cmd' && c[1] === 'screenshot'));
  // eof => auto-next to c.mp4 (html5) and mpv stopped
  calls.length = 0; listeners.state({ 'eof-reached': true }); await sleep(100);
  assert(/c\.mp4/.test(video.getAttribute('src')), 'auto next'); assert(calls.some(c => c[0] === 'stop'));
  // user closes mpv window
  key('p', { shiftKey: true }); await sleep(100); // back to b.mkv via history
  assert(calls.some(c => c[0] === 'play')); listeners.event({ type: 'closed' }); await sleep(20);
  assert(!d.getElementById('bigPlay').hidden, 'play button shown after close');
  // stream url
  calls.length = 0; d.getElementById('urlInput').value = 'https://youtu.be/x'; d.getElementById('playUrlBtn').click(); await sleep(100);
  assert(calls.some(c => c[0] === 'url' && c[1] === 'https://youtu.be/x'));
  // XSS in playlist names is inert
  await listeners.open(['/m/<img src=x onerror=alert(1)>.mp4']); await sleep(100);
  assert.strictEqual(d.querySelectorAll('#playlist img[onerror], #playlist img[src="x"]').length, 0, 'no injected markup');
  // browser-engine error with mpv available falls back to mpv
  await listeners.open(['/m/d.mp4']); await sleep(50); calls.length = 0;
  video.dispatchEvent(new w.Event('error')); await sleep(100);
  assert(calls.some(c => c[0] === 'play' && /d\.mp4/.test(c[1].files[0])), 'html5 error -> mpv');
  // mpv crash event with no recovery -> falls back to browser engine
  listeners.event({ type: 'failed', error: 'boom' }); await sleep(50);
  assert(/d\.mp4/.test(video.getAttribute('src')), 'mpv failed -> html5');
  // stream failure shows the diagnosed message and keeps it on screen; cookies choice is persisted & forwarded
  const ck = d.getElementById('ytCookies'); ck.value = 'chrome'; ck.dispatchEvent(new w.Event('change'));
  calls.length = 0; d.getElementById('urlInput').value = 'https://youtu.be/y'; d.getElementById('playUrlBtn').click(); await sleep(100);
  const urlCall = calls.find(c => c[0] === 'url'); assert(urlCall, 'url call');
  listeners.event({ type: 'file-error', stream: true, error: 'YouTube needs a JavaScript runtime. Put deno.exe next to ZephyrPlayer.' }); await sleep(30);
  assert(/JavaScript runtime/.test(d.getElementById('videoSubtitle').textContent), 'diagnosis shown');
  listeners.event({ type: 'perf', stage: 1 }); listeners.event({ type: 'recovering', level: 1, reason: 'Video output failed to start' }); await sleep(20);
  // ---- v3: icons, probing, playlist features, shuffle bag ----
  assert(d.querySelectorAll('.zi').length > 25, 'icons rendered'); assert(/^url\("data:image\/svg/.test(d.getElementById('prevBtn').querySelector('.zi').style.getPropertyValue('--zi')), 'default icon applied');
  await sleep(50); assert(/rect/.test(decodeURIComponent(d.querySelector('#playPauseBtn .icon-play').style.getPropertyValue('--zi'))), 'custom file icon overrides default');
  w.document.getElementById('clearPlaylistBtn').click(); await sleep(30);
  await listeners.open(['/m/hevc.movie.mkv', '/m/song.mp3', '/m/missing.mp4', '/m/ok1.mp4', '/m/ok2.mp4']); await sleep(300);
  const rows = () => Array.from(d.querySelectorAll('#playlist .playlist-item'));
  const txt = rows().map(r => r.textContent); console.log('rows:', txt.map(t => t.replace(/\s+/g, ' ').slice(0, 90)));
  assert(/1:30:00/.test(txt[0]) && /1080p/.test(txt[0]) && /HEVC/.test(txt[0]) && /10-bit/.test(txt[0]) && /HDR10/.test(txt[0]) && /3 subs/.test(txt[0]) && /2 audio/.test(txt[0]), 'video info chips');
  assert(/Band – Real Title/.test(txt[1]) && /3:20/.test(txt[1]), 'music uses tags'); assert(/File not found/.test(txt[2]) && rows()[2].classList.contains('missing'));
  assert(rows()[0].querySelector('img'), 'poster frame shown'); assert(/5 tracks · /.test(d.getElementById('trackCount').textContent), d.getElementById('trackCount').textContent);
  // HEVC/AC3 goes straight to mpv without trying the browser first
  calls.length = 0; rows()[0].click(); await sleep(900); assert(calls.find(c => c[0] === 'play' && /hevc/.test(c[1].files[0])), 'probe-routed to mpv'); assert(!video.getAttribute('src'));
  // filter + sort + dedupe + remove missing
  const fl = d.getElementById('plFilter'); fl.value = 'ok'; fl.dispatchEvent(new w.Event('input')); assert.strictEqual(rows().length, 2); fl.value = ''; fl.dispatchEvent(new w.Event('input'));
  const sortSel = d.getElementById('plSort'); sortSel.value = 'dur-desc'; sortSel.dispatchEvent(new w.Event('change')); assert(/hevc/.test(rows()[0].textContent) || /1:30:00/.test(rows()[0].textContent)); assert(rows()[0].classList.contains('active'), 'current item follows sort');
  sortSel.value = 'missing'; sortSel.dispatchEvent(new w.Event('change')); assert.strictEqual(rows().length, 4);
  // persistence
  await sleep(700); const saved = JSON.parse(w.localStorage.getItem('zephyr-playlist-v1')); assert.strictEqual(saved.items.length, 4);
  // ---- shuffle bag: every item exactly once per round, no immediate repeats, ends when round is over (repeat off)
  d.getElementById('shuffleBtn').click(); assert(d.getElementById('shuffleBtn').classList.contains('active')); assert.strictEqual(w.localStorage.getItem('zephyr-shuffle'), '1');
  const order = []; const curName = () => d.querySelector('#playlist .playlist-item.active .name').textContent; order.push(curName());
  const endCurrent = () => { if (video.getAttribute('src')) video.dispatchEvent(new w.Event('ended')); else { listeners.state({ 'eof-reached': false }); listeners.state({ 'eof-reached': true }); } };
  for (let k = 0; k < 3; k++) { endCurrent(); await sleep(900); order.push(curName()); }
  console.log('shuffle round:', order); assert.strictEqual(new Set(order).size, 4, 'all 4 distinct in one round');
  const before = curName(); endCurrent(); await sleep(500);
  assert.strictEqual(curName(), before, 'round finished -> stops (repeat off)');
  d.getElementById('repeatBtn').click(); assert.strictEqual(d.getElementById('repeatBtn').querySelector('.lbl').textContent, 'All');
  // ---- playlist URL expands into entries and stream titles update
  calls.length = 0; d.getElementById('clearPlaylistBtn').click(); d.getElementById('urlInput').value = 'https://www.youtube.com/playlist?list=PLx'; d.getElementById('playUrlBtn').click(); await sleep(300);
  assert.strictEqual(rows().length, 2); assert(/Vid A/.test(rows()[0].textContent) && /1:00/.test(rows()[0].textContent)); assert(calls.some(c => c[0] === 'url' && c[1] === 'https://youtu.be/a'));
  listeners.state({ 'media-title': 'Real YouTube Title' }); await sleep(50); assert(/Real YouTube Title/.test(rows()[0].textContent), 'stream title updated');

  // ================= v4 features =================
  const FS_EL = { v: null }; Object.defineProperty(d, 'fullscreenElement', { get: () => FS_EL.v, configurable: true });
  const mm = (x, y) => d.dispatchEvent(new w.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  // -- themes & accent
  w.ZSettings.set('theme', 'sky');
  assert.strictEqual(d.documentElement.getAttribute('data-skin'), 'sky'); assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'light');
  d.getElementById('themeToggle').click(); assert.strictEqual(d.documentElement.getAttribute('data-theme'), 'dark', 'toggle goes to last dark theme');
  w.ZSettings.set('theme', 'dracula');
  w.ZSettings.set('accentMode', 'custom'); w.ZSettings.set('accentColor', '#ff8800');
  assert(/^#ff8800|#ff/i.test(d.documentElement.style.getPropertyValue('--accent')), 'custom accent'); w.ZSettings.set('accentMode', 'theme'); assert.strictEqual(d.documentElement.style.getPropertyValue('--accent'), '');
  // -- online off => never calls out; on => cleaned query only (no paths), poster + accent + episode label applied
  d.getElementById('clearPlaylistBtn').click(); await sleep(30); calls.length = 0;
  await listeners.open(['/secret/dir/The.Mandalorian.S02E03.1080p.WEB-DL.x265-GRP.mp4']); await sleep(300);
  assert(!calls.some(c => c[0] === 'online'), 'online is OFF by default');
  w.ZSettings.set('online', true); await sleep(200);
  const oc = calls.find(c => c[0] === 'online'); assert(oc, 'lookup after opt-in'); console.log('query sent:', JSON.stringify(oc[1]));
  assert(oc[1].allow === true && oc[1].kind === 'tv' && oc[1].title === 'The Mandalorian' && oc[1].season === 2 && oc[1].episode === 3 && !JSON.stringify(oc[1]).includes('secret'), 'cleaned title, no path');
  const row0 = () => d.querySelector('#playlist .playlist-item');
  assert(row0().querySelector('img') && !/p\.jpg/.test(row0().querySelector('img').src), 'default art = video frame');
  w.ZSettings.set('artMode', 'poster');
  assert(/p\.jpg/.test(row0().querySelector('img').src), 'poster art mode shows the online poster'); assert(/S02E03/.test(w.ZApp.item.epLabel || ''), 'episode label');
  w.ZSettings.set('artMode', 'frame');
  w.ZSettings.set('accentMode', 'poster'); { const hx = d.documentElement.style.getPropertyValue('--accent'); const rr = parseInt(hx.slice(1, 3), 16), gg = parseInt(hx.slice(3, 5), 16); assert(rr > 200 && rr > gg + 70, 'accent follows the (red) poster, lightened for dark themes: ' + hx); }
  // -- details panel
  key('d'); await sleep(50); assert(!d.getElementById('detailsPanel').hidden); assert.strictEqual(d.getElementById('detailsTitle').textContent, 'The Mandalorian'); assert(/lone gunfighter/.test(d.getElementById('detailsOverview').textContent) && /S02E03/.test(d.getElementById('detailsLine').textContent) && /TVmaze/.test(d.getElementById('detailsSource').textContent)); d.getElementById('closeDetails').click();
  // -- music: tags/online cover, audio art for browser engine
  await listeners.open(['/m/song.mp3']); await sleep(350); d.querySelectorAll('#playlist .playlist-item')[1].click(); await sleep(900);
  assert(!d.getElementById('audioArt').hidden, 'audio art visible for audio-only in browser engine'); assert(/Real Title/.test(d.getElementById('audioArtTitle').textContent) || /Band/.test(d.getElementById('audioArtSub').textContent));
  assert(!d.getElementById('welcomePanel').hidden, 'welcome on first run'); assert(d.querySelectorAll('#welcomeSwatches .swatch').length === 15);
  d.getElementById('welcomeGo').click(); assert(d.getElementById('welcomePanel').hidden); assert.strictEqual(w.localStorage.getItem('zephyr-welcomed'), '1');
  // -- fullscreen immersive UI: hidden by default, bottom reveals controls, right edge reveals playlist, L pins
  FS_EL.v = d.documentElement; d.dispatchEvent(new w.Event('fullscreenchange')); assert(d.body.classList.contains('is-fs'));
  assert(!d.body.classList.contains('fs-bottom') && !d.body.classList.contains('fs-side'), 'hidden at first');
  mm(500, 400); await sleep(250); assert(!d.body.classList.contains('fs-bottom'));
  mm(500, 740); await sleep(50); assert(d.body.classList.contains('fs-bottom'), 'mouse at bottom shows seek bar + buttons');
  mm(1020, 300); await sleep(50); assert(d.body.classList.contains('fs-side'), 'mouse at right edge shows playlist');
  mm(500, 40); await sleep(50); assert(d.body.classList.contains('fs-top'), 'top shows title');
  mm(500, 400); await sleep(1100); assert(!d.body.classList.contains('fs-bottom') && !d.body.classList.contains('fs-side') && !d.body.classList.contains('fs-top'), 'auto-hides after leaving the zones');
  key('l'); await sleep(250); assert(d.body.classList.contains('fs-side'), 'L pins playlist'); key('l'); await sleep(1000); assert(!d.body.classList.contains('fs-side'));
  mm(500, 400); await sleep(2600); assert(d.body.classList.contains('fs-nocursor'), 'cursor hides when idle');
  FS_EL.v = null; d.dispatchEvent(new w.Event('fullscreenchange')); assert(!d.body.classList.contains('is-fs') && !d.body.classList.contains('fs-nocursor'));
  // -- shortcuts + welcome (first run) + tools panel
  key('?', { code: 'Slash', shiftKey: true }); assert(!d.getElementById('shortcutsPanel').hidden && /Fullscreen/.test(d.getElementById('shortcutsBody').textContent)); d.getElementById('closeShortcuts').click();
  d.getElementById('toolsBtn').click(); await sleep(100); const trs = d.querySelectorAll('#toolsRows tr'); assert.strictEqual(trs.length, 3); assert(/✓/.test(trs[0].textContent) && /Missing/.test(trs[1].textContent) && /Optional/.test(trs[2].textContent), trs[1].textContent);
  d.getElementById('toolsInstall').click(); await sleep(150); const ic = calls.find(c => c[0] === 'install'); assert(ic && ic[1].whisper === true && !ic[1].testOnly, 'install includes whisper by default');
  calls.length = 0; d.getElementById('toolsTest').click(); await sleep(150); const tc = calls.find(c => c[0] === 'install'); assert(tc && tc[1].testOnly === true, 'self-test button runs the script in test-only mode'); assert(/Finished/.test(d.getElementById('toolsLog').textContent));
  d.getElementById('closeTools').click();
  listeners.hotkey('diagnostics'); await sleep(30); assert(calls.some(c => c[0] === 'diag'));
  // -- A-B clip export (mpv engine)
  d.getElementById('clearPlaylistBtn').click(); await sleep(30); await listeners.open(['/m/clipme.mkv']); await sleep(1000); calls.length = 0;
  listeners.state({ duration: 300, 'time-pos': 60 }); await sleep(50); key('a'); listeners.state({ 'time-pos': 90 }); await sleep(50); key('a'); await sleep(30);
  d.getElementById('clipBtn').click(); assert(!d.getElementById('clipPanel').hidden, 'clip panel opens once A and B are set'); assert(/1:00.*1:30.*30 s/.test(d.getElementById('clipRange').textContent), d.getElementById('clipRange').textContent);
  d.querySelector('#clipPanel [data-clip="copy"]').click(); await sleep(100); const cc = calls.find(c => c[0] === 'clip'); assert(cc && cc[1].start === 60 && cc[1].end === 90 && cc[1].mode === 'copy' && /clipme\.mkv$/.test(cc[1].path)); assert(/Saved/.test(d.getElementById('clipStatus').textContent) && /exact MP4/.test(d.getElementById('clipStatus').textContent));
  d.getElementById('closeClip').click();
  // -- queue overlay key from the mpv window, per-file memory of audio track, continue-watching shelf
  calls.length = 0; await listeners.open(['/m/b2.mkv', '/m/b3.mkv']); await sleep(300); listeners.hotkey('queue'); await sleep(30);
  const q = calls.find(c => c[0] === 'cmd' && c[1] === 'show-text' && /Up next/.test(c[2][0])); assert(q && /b3/.test(q[2][0]), JSON.stringify(calls.slice(-4)));
  const itemX = d.querySelectorAll('#playlist .playlist-item'); itemX[itemX.length - 2].click(); await sleep(900);
  listeners.state({ 'track-list': [{ id: 1, type: 'audio', lang: 'eng', selected: true }, { id: 2, type: 'audio', lang: 'jpn' }] }); await sleep(30);
  d.querySelector('#audioTracks button:nth-child(2)').click(); await sleep(30);
  d.querySelectorAll('#playlist .playlist-item')[0].click(); await sleep(700); calls.length = 0;
  d.querySelectorAll('#playlist .playlist-item')[itemX.length - 2].click(); await sleep(900);
  listeners.state({ 'track-list': [{ id: 1, type: 'audio', lang: 'eng', selected: true }, { id: 2, type: 'audio', lang: 'jpn' }] }); await sleep(50);
  assert(calls.some(c => c[0] === 'set' && c[1].aid === 2), 'remembered Japanese audio is re-selected on replay: ' + JSON.stringify(calls.filter(c => c[0] === 'set')));
  w.ZApp.emit('position', w.ZApp.item, 40, 100); w.ZApp.emit('idle'); await sleep(30);
  assert(!d.getElementById('continueShelf').hidden && d.querySelectorAll('#continueShelf .cw-card').length >= 1 && /Resume at 0:40/.test(d.getElementById('continueShelf').textContent), 'continue shelf');
  // -- turning online back off stops lookups
  w.ZSettings.set('online', false); calls.length = 0; d.getElementById('clearPlaylistBtn').click(); await listeners.open(['/m/Inception.2010.1080p.mp4']); await sleep(400); assert(!calls.some(c => c[0] === 'online'));
  // ================= v5: settings centre, hover descriptions, resets, shortcut editor, mouse, extra volume =================
  const ZS = w.ZSettings; const vid = d.getElementById('video'); const wrap = d.getElementById('videoWrapper');
  d.getElementById('settingsBtn').click(); await sleep(80); const sc = d.getElementById('settingsCenter'); assert(!sc.hidden, 'the gear opens the new settings centre'); assert(d.getElementById('settingsPanel').hidden !== false, 'old panel stays closed');
  const navs = () => Array.from(d.querySelectorAll('#scNav .scnav')).map((b) => b.dataset.group);
  assert.deepStrictEqual(navs(), ['general', 'playback', 'audio', 'video', 'subtitles', 'controls', 'library', 'system'], 'Advanced is hidden until asked for');
  d.getElementById('scAdvanced').checked = true; d.getElementById('scAdvanced').dispatchEvent(new w.Event('change')); assert(navs().includes('advanced'), 'advanced section appears'); assert(d.querySelector('#scNav .scnav .zi'), 'nav icons');
  for (const g of navs()) { if (g === 'controls') continue; d.querySelector('#scNav [data-group="' + g + '"]').click(); const rr = Array.from(d.querySelectorAll('#scBody .srow')); assert(rr.length >= 1, g + ' has settings'); for (const r of rr) assert(r.querySelector('.sname').getAttribute('data-tip').length > 20 && r.querySelector('.sinfo'), 'tooltip on ' + r.dataset.setting); }
  d.querySelector('#scNav [data-group="audio"]').click(); const volRow = d.querySelector('[data-setting="volumeMax"] .sname'); volRow.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true })); await sleep(450);
  assert(!d.getElementById('ztip').hidden && /above 100%/.test(d.getElementById('ztip').textContent), 'hovering a setting shows its description'); volRow.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); assert(d.getElementById('ztip').hidden, 'tooltip hides on click');
  d.querySelector('#scNav [data-group="playback"]').click(); const rng = () => d.querySelector('[data-setting="seekStep"] input[type=range]'); rng().value = '25'; rng().dispatchEvent(new w.Event('input', { bubbles: true })); rng().dispatchEvent(new w.Event('pointerup', { bubbles: true })); await sleep(30);
  assert.strictEqual(ZS.get('seekStep'), 25); assert.strictEqual(w.ZApp.seekStep, 25, 'applied live (it used to reset on every launch)'); assert(!d.querySelector('[data-setting="seekStep"] .sreset').hidden, 'per-setting reset appears when changed');
  d.querySelector('[data-setting="seekStep"] .sreset').click(); assert.strictEqual(ZS.get('seekStep'), 10); assert.strictEqual(w.ZApp.seekStep, 10, 'reset applies live');
  const sb = d.getElementById('scSearch'); sb.value = 'subtitle'; sb.dispatchEvent(new w.Event('input')); assert(Array.from(d.querySelectorAll('#scBody .sname')).some((e) => /subtitle/i.test(e.textContent)) && /Search results/.test(d.querySelector('#scBody h3').textContent)); sb.value = 'zzzz'; sb.dispatchEvent(new w.Event('input')); assert(/No setting matches/.test(d.getElementById('scBody').textContent)); sb.value = ''; sb.dispatchEvent(new w.Event('input'));
  calls.length = 0; ZS.set('volumeStep', 9); ZS.set('nightMode', true); await sleep(30); assert(calls.some((c) => c[0] === 'audioprefs' && c[1].night === true && c[1].limiter === true), 'audio prefs pushed to the engine'); assert.strictEqual(w.ZApp.volumeStep, 0.09);
  d.querySelector('#scNav [data-group="audio"]').click(); const rsec = Array.from(d.querySelectorAll('#scBody .schead button')).find((b) => /Reset this section/.test(b.textContent)); assert(rsec && !rsec.hidden); rsec.click(); assert(/confirm/i.test(rsec.textContent)); assert.strictEqual(ZS.get('nightMode'), true, 'first click only asks'); rsec.click(); assert.strictEqual(ZS.get('nightMode'), false); assert.strictEqual(ZS.get('volumeStep'), 5); assert.strictEqual(w.ZApp.volumeStep, 0.05);
  // -- shortcut editor: capture, conflict takeover, remove, reset
  d.querySelector('#scNav [data-group="controls"]').click(); const kr = (a) => d.querySelector('.keyrow[data-action="' + a + '"]'); kr('mute').querySelector('.keyadd').click(); assert(w.ZApp.capturingKey, 'capturing');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'y', bubbles: true, cancelable: true })); await sleep(20); assert(!w.ZApp.capturingKey); assert.strictEqual(JSON.stringify(ZS.get('keymap').mute), JSON.stringify(['m', 'y']));
  const mutedBefore = vid.muted; key('y'); assert.notStrictEqual(vid.muted, mutedBefore, 'the new key works immediately'); key('y');
  kr('mute').querySelector('.keyadd').click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })); await sleep(20);
  assert(ZS.get('keymap').mute.includes('f') && ZS.get('keymap').fullscreen.length === 0, 'conflicting key moved to the new action'); assert(/belongs to/.test(d.querySelector('.keymsg').textContent), d.querySelector('.keymsg').textContent);
  kr('mute').querySelector('.keyadd').click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await sleep(20); assert(!w.ZApp.capturingKey, 'Esc cancels capture');
  kr('mute').querySelector('.keyadd').click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Shift', bubbles: true, cancelable: true })); assert(w.ZApp.capturingKey, 'a lone modifier keeps waiting'); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true })); await sleep(20);
  assert(ZS.get('keymap').mute.includes('f5')); kr('mute').querySelector('.keyx').click(); assert(!ZS.get('keymap').mute.includes('m')); kr('mute').querySelector('.sreset').click(); assert.strictEqual(ZS.get('keymap').mute, undefined, 'row reset = default keys'); assert.strictEqual(JSON.stringify(w.ZApp.controls.effectiveKeys('mute')), JSON.stringify(['m']));
  Array.from(d.querySelectorAll('#scBody .sactions button')).find((b) => /Reset all shortcuts/.test(b.textContent)).click(); assert.strictEqual(JSON.stringify(ZS.get('keymap')), JSON.stringify({})); assert.strictEqual(JSON.stringify(w.ZApp.controls.effectiveKeys('fullscreen')), JSON.stringify(['f']));
  // -- other settings areas render real data: file associations, other players, library actions
  d.querySelector('#scNav [data-group="system"]').click(); await sleep(60); assert(/Registered for 3 of 40/.test(d.getElementById('scBody').textContent), 'association status'); assert(/MPC-HC/.test(d.getElementById('scBody').textContent) && /K-Lite/.test(d.getElementById('scBody').textContent), 'K-Lite player listed');
  calls.length = 0; Array.from(d.querySelectorAll('#scBody .sactions button')).find((b) => /Register ZephyrPlayer/.test(b.textContent)).click(); await sleep(60); assert.strictEqual(JSON.stringify(calls.find((c) => c[0] === 'assoc')[1]), JSON.stringify({ video: true, audio: true, playlist: true }));
  d.getElementById('scClose').click(); assert(d.getElementById('settingsCenter').hidden);
  // -- persistence: a fresh store sees what the UI saved
  ZS.set('seekStep', 20); ZS.set('wheel', 'seek'); const ZS2 = w.ZSettingsLib.createStore({ storage: w.localStorage }); assert.strictEqual(ZS2.get('seekStep'), 20); assert.strictEqual(ZS2.get('wheel'), 'seek'); ZS.set('wheel', 'volume'); ZS.set('seekStep', 10);
  // -- mouse: wheel (volume / speed / seek), click vs double-click, middle click, side buttons - all from settings
  d.getElementById('clearPlaylistBtn').click(); await sleep(30); await listeners.open(['/m/wheel.mp4']); await sleep(600); let fsCalls = 0; d.documentElement.requestFullscreen = () => { fsCalls++; return Promise.resolve(); };
  const wheel = (o) => { const ev = new w.WheelEvent('wheel', Object.assign({ deltaY: -100, bubbles: true, cancelable: true }, o)); vid.dispatchEvent(ev); return ev; };
  w.ZApp.setVolume(0.5, { silent: true }); let ev = wheel({ deltaY: -100 }); assert(ev.defaultPrevented && Math.abs(w.ZApp.volume - 0.55) < 0.001, 'wheel up = +5% volume'); wheel({ deltaY: 100 }); wheel({ deltaY: 100 }); assert(Math.abs(w.ZApp.volume - 0.45) < 0.001);
  w.ZApp.setSpeed(1); wheel({ ctrlKey: true, deltaY: -100 }); assert.strictEqual(w.ZApp.speed, 1.25, 'ctrl+wheel = speed'); w.ZApp.setSpeed(1);
  ZS.set('wheel', 'none'); const v1 = w.ZApp.volume; ev = wheel({}); assert(!ev.defaultPrevented && w.ZApp.volume === v1, 'wheel set to "do nothing" leaves the page alone'); ZS.set('wheel', 'speed'); wheel({ deltaY: -100 }); assert.strictEqual(w.ZApp.speed, 1.25); w.ZApp.setSpeed(1); ZS.set('wheel', 'volume');
  Object.defineProperty(vid, 'paused', { get: () => !vid._playing, configurable: true });
  const playing = () => !!vid._playing; vid._playing = true; vid.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0 })); assert(playing(), 'single click waits to see if it is a double-click'); await sleep(320); assert(!playing(), 'single click = play/pause');
  vid.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0 })); vid.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0 })); vid.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, button: 0 })); await sleep(320); assert.strictEqual(fsCalls, 1, 'double-click = fullscreen'); assert(!playing(), 'and it did not toggle play/pause');
  ZS.set('dblclick', 'none'); vid._playing = false; vid.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0 })); assert(playing(), 'with double-click off, a click reacts instantly'); ZS.set('dblclick', 'fullscreen'); ZS.set('click', 'none'); vid.dispatchEvent(new w.MouseEvent('click', { bubbles: true, button: 0 })); await sleep(300); ZS.set('click', 'playpause');
  const m0 = vid.muted; vid.dispatchEvent(new w.MouseEvent('auxclick', { bubbles: true, button: 1, cancelable: true })); assert.notStrictEqual(vid.muted, m0, 'middle click = mute'); w.ZApp.toggleMute();
  ZS.set('mouseBack', 'mute'); ev = new w.MouseEvent('mouseup', { bubbles: true, button: 3, cancelable: true }); d.dispatchEvent(ev); assert(ev.defaultPrevented && vid.muted !== m0, 'mouse back button runs its action'); ZS.set('mouseBack', 'prev'); w.ZApp.toggleMute();
  // -- extra volume: the browser engine cannot exceed 100%, so asking for more hands over to mpv automatically (same position)
  calls.length = 0; ZS.set('volumeMax', 200); w.ZApp.setVolume(1.5); await sleep(900); const bp = calls.find((c) => c[0] === 'play'); assert(bp && bp[1].volume === 150 && bp[1].cfg.volumeMax === 200 && bp[1].cfg.mouse.wheel === 'volume' && bp[1].cfg.steps.volume === 5 && bp[1].cfg.audio.limiter === true, 'boost -> mpv with the right settings: ' + JSON.stringify(bp && bp[1].cfg)); assert.strictEqual(d.getElementById('volumeSlider').max, '2');
  ZS.set('volumeMax', 100); assert.strictEqual(w.ZApp.volume, 1, 'lowering the maximum clamps the current volume'); assert.strictEqual(d.getElementById('volumeSlider').max, '1');
  // -- pause when minimised (opt-in)
  let hid = false; Object.defineProperty(d, 'hidden', { get: () => hid, configurable: true }); listeners.state({ pause: false, 'time-pos': 12, duration: 100 }); await sleep(30); calls.length = 0; ZS.set('pauseOnMinimize', true); hid = true; d.dispatchEvent(new w.Event('visibilitychange')); await sleep(30);
  assert(calls.some((c) => c[0] === 'set' && c[1].pause === true), 'pauses when hidden'); hid = false; d.dispatchEvent(new w.Event('visibilitychange')); await sleep(30); assert(calls.some((c) => c[0] === 'set' && c[1].pause === false), 'resumes on return'); ZS.set('pauseOnMinimize', false);
  // -- nothing can play it -> offer the K-Lite / VLC player, or open it automatically, or just say so
  const bad = { path: 'D:/odd/file.xyz', name: 'file' }; ZS.set('failAction', 'ask'); w.ZApp.emit('playfail', bad, 'boom'); await sleep(80); const fb = d.getElementById('failBanner'); assert(!fb.hidden && /MPC-HC \(K-Lite\)/.test(fb.textContent) && fb.querySelectorAll('#failPlayers button').length === 2, 'banner offers the installed players');
  calls.length = 0; fb.querySelector('#failPlayers button').click(); await sleep(60); assert.strictEqual(JSON.stringify(calls.find((c) => c[0] === 'extopen')[1]), JSON.stringify({ id: 'mpc-hc', file: 'D:/odd/file.xyz' }));
  calls.length = 0; ZS.set('failAction', 'auto'); w.ZApp.emit('playfail', bad, 'boom'); await sleep(80); assert(calls.some((c) => c[0] === 'extopen' && c[1].id === 'mpc-hc'), 'automatic hand-over'); calls.length = 0; ZS.set('failAction', 'never'); w.ZApp.emit('playfail', bad, 'boom'); await sleep(80); assert(!calls.some((c) => c[0] === 'extopen'));
  // -- tools panel: edition + codec report
  d.getElementById('toolsBtn').click(); await sleep(120); assert(/Modern edition/.test(d.getElementById('editionLabel').textContent)); d.getElementById('codecBtn').click(); await sleep(120); assert(/✓ HEVC/.test(d.getElementById('codecReport').textContent) && d.querySelector('#codecReport .codec.no') && /d3d11va/.test(d.getElementById('codecReport').textContent), 'codec support list'); d.getElementById('closeTools').click();
  assert.strictEqual(JSON.stringify(errs), JSON.stringify([]));
  console.log('DOM SMOKE TEST PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e, errs); process.exit(1); });
