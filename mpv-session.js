'use strict';
/**
 * MpvSession — owns one mpv process + its JSON-IPC channel.
 *  - launches with a validated argument set (a bad option can never kill startup twice)
 *  - live control through IPC (no restarts for EQ / tracks / geometry / video adjust)
 *  - crash recovery: relaunches at the last known position with progressively safer settings
 *  - whitelisted command / property surface for the renderer
 */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MpvIpc } = require('./mpv-ipc');

const OBSERVED = [
  'time-pos', 'duration', 'pause', 'volume', 'mute', 'speed', 'eof-reached',
  'track-list', 'chapter-list', 'paused-for-cache', 'ab-loop-a', 'ab-loop-b',
  'media-title', 'seekable', 'fullscreen'
];

const SETTABLE = new RegExp('^(' + [
  'pause', 'volume', 'mute', 'speed', 'brightness', 'contrast', 'saturation', 'gamma', 'hue',
  'sub-[a-z-]+', 'secondary-sid', 'aid', 'sid', 'vid', 'audio-delay', 'audio-channels', 'audio-spdif',
  'audio-device', 'replaygain', 'af', 'vf', 'video-aspect-override', 'video-rotate', 'panscan',
  'video-zoom', 'video-pan-[xy]', 'tone-mapping', 'hdr-compute-peak', 'target-trc', 'target-prim',
  'ab-loop-[ab]', 'loop-file', 'loop-playlist', 'ontop', 'fullscreen', 'lavfi-complex', 'deinterlace',
  'interpolation', 'hwdec', 'time-pos', 'percent-pos', 'chapter', 'audio-pitch-correction',
  'osd-level', 'osc'
].join('|') + ')$');

// Properties worth re-applying after a crash/relaunch or quality change.
const NOT_PERSISTED = /^(pause|time-pos|percent-pos|chapter|aid|sid|vid|ab-loop-[ab]|fullscreen|osc|osd-level|ontop|secondary-sid)$/;

const COMMANDS = new Set([
  'seek', 'cycle', 'add', 'set', 'frame-step', 'frame-back-step', 'screenshot', 'screenshot-to-file',
  'sub-add', 'sub-remove', 'sub-reload', 'audio-add', 'script-binding', 'script-message', 'show-text',
  'cycle-values', 'multiply', 'revert-seek', 'apply-profile', 'osd-auto', 'keybind', 'ab-loop'
]);

function isSafeToken(v) { return typeof v === 'string' && /^[A-Za-z0-9_.,:+-]{1,80}$/.test(v); }

/* ------------------------------ argument builder ------------------------------ */

function qualityArgs(quality, shaderDir, log, light) {
  const q = quality || 'high';
  const a = [];
  if (q === 'fast') {
    a.push('--ytdl-format=best[height<=480]/worst');
  } else if (q === 'high' || q === 'sharpen') {
    a.push('--ytdl-format=bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
  } else if (q === 'anime' || q === 'anime4k') {
    a.push('--ytdl-format=bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
  } else if (q === 'hdr') {
    a.push('--ytdl-format=bestvideo[height<=1440]+bestaudio/best[height<=1440]/best');
  } else {
    a.push('--ytdl-format=bestvideo[height<=720]+bestaudio/best[height<=720]/best');
  }
  if (light || q === 'fast') {
    a.push('--scale=bilinear', '--cscale=bilinear', '--dscale=bilinear', '--deband=no', '--sharpen=0',
      '--correct-downscaling=no', '--linear-downscaling=no', '--sigmoid-upscaling=no', '--framedrop=decoder+vo');
    if (q === 'hdr') a.push('--tone-mapping=mobius', '--hdr-compute-peak=no', '--target-trc=srgb', '--target-prim=bt.709');
    return a;
  }
  // "high" is deliberately the balanced preset: spline36 looks great and runs on any GPU.
  // The ewa_lanczos family is reserved for the explicit sharpen/anime presets (they need a decent GPU).
  if (q === 'high') a.push('--scale=spline36', '--cscale=spline36', '--dscale=mitchell', '--correct-downscaling=yes');
  if (q === 'sharpen' || q === 'anime' || q === 'anime4k') {
    a.push('--scale=ewa_lanczossharp', '--cscale=ewa_lanczossharp', '--dscale=mitchell', q === 'sharpen' ? '--sharpen=0.85' : '--sharpen=0.45');
  }
  if (q === 'anime' || q === 'anime4k') a.push('--deband=yes', '--deband-iterations=2', '--deband-threshold=64');
  if (q === 'anime4k' && shaderDir) {
    try {
      const found = fs.readdirSync(shaderDir).filter(n => /\.glsl$/i.test(n)).sort()
        .map(n => path.join(shaderDir, n).replace(/\\/g, '/'));
      if (found.length) a.push('--glsl-shaders=' + found.join(process.platform === 'win32' ? ';' : ':'));
    } catch (e) { if (log) log('Shader scan failed:', e.message); }
  }
  if (q === 'hdr') a.push('--tone-mapping=mobius', '--hdr-compute-peak=yes', '--target-trc=srgb', '--target-prim=bt.709');
  return a;
}

function buildArgs(o) {
  const win = (o.platform || process.platform) === 'win32';
  const level = o.level || 0;
  const vol = Math.max(0, Math.min(150, Math.round(Number(o.volume) || 100)));
  const a = [
    '--input-ipc-server=' + o.ipcPath,
    '--idle=no', '--keep-open=yes', '--force-window=yes',
    '--no-input-terminal', '--msg-level=all=error', '--term-status-msg=',
    '--osd-level=1',
    '--title=${?media-title:${media-title} - }ZephyrPlayer',
    '--volume-max=150', '--volume=' + vol,
    '--sub-auto=fuzzy', '--slang=en,eng', '--network-timeout=20'
  ];
  if (o.mute) a.push('--mute=yes');
  if (o.screenshotDir) a.push('--screenshot-format=png', '--screenshot-template=zephyr-%F-%04n', '--screenshot-directory=' + o.screenshotDir);
  if (o.startPos && o.startPos > 3) a.push('--start=' + Math.floor(o.startPos));

  // decode / cache profile
  if (level < 3) {
    a.push('--cache=yes', '--demuxer-max-bytes=200MiB', '--demuxer-max-back-bytes=100MiB',
      '--demuxer-readahead-secs=30', '--hr-seek=yes', '--video-sync=audio', '--interpolation=no',
      '--audio-pitch-correction=yes', '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5');
  }
  // hwdec ladder: native GPU decode (fast, low CPU: HEVC/x265, 10-bit, 4K) -> copy-back (compatible) -> software
  if (level === 0) {
    const hw = isSafeToken(o.hwdec) && o.hwdec !== 'auto' ? o.hwdec : 'auto-safe';
    a.push('--hwdec=' + hw, '--hwdec-codecs=all', '--vd-lavc-threads=0', '--framedrop=vo');
  } else if (level === 1) {
    a.push('--hwdec=auto-copy', '--hwdec-codecs=all', '--vd-lavc-threads=0', '--framedrop=vo');
  } else {
    a.push('--hwdec=no', '--vd-lavc-threads=0', '--framedrop=decoder+vo');
  }

  // video output
  // only VOs that work from the CLI ('libmpv' / 'direct3d' are not usable and would abort startup)
  const vo = o.vo === 'gpu-next' ? 'gpu-next' : 'gpu';
  if (o.voOverride) a.push('--vo=' + o.voOverride);
  else if (win) {
    if (level === 0) a.push('--vo=' + vo, '--gpu-api=d3d11', '--gpu-context=d3d11');
    else if (level === 1) a.push('--vo=gpu', '--gpu-api=d3d11', '--gpu-context=d3d11');
    else if (level === 2) a.push('--vo=gpu');
    else a.push('--vo=gpu', '--gpu-api=opengl', '--gpu-context=win');
  } else {
    a.push('--vo=' + (level === 0 ? vo : 'gpu'));
  }

  // quality + ytdl (skipped in minimal safe mode, except the ytdl path which is required for URLs)
  if (level < 2) a.push(...qualityArgs(o.quality, o.shaderDir, o.log, (o.perfStage || 0) >= 1));
  else a.push('--ytdl-format=bestvideo[height<=720]+bestaudio/best[height<=720]/best');
  a.push('--ytdl=yes');
  {
    // yt-dlp options forwarded by mpv. Values are length-prefixed (%n%value) so paths with commas are safe.
    const lp = (v) => '%' + String(v).length + '%' + v;
    const raw = ['no-playlist='];
    if (o.jsRuntime) raw.push('js-runtimes=' + lp(o.jsRuntime));
    if (o.cookies && /^(chrome|edge|firefox|brave|opera|vivaldi|chromium|safari)$/.test(o.cookies)) raw.push('cookies-from-browser=' + o.cookies);
    a.push('--ytdl-raw-options=' + raw.join(','));
  }
  if (o.ytdlpPath) a.push('--script-opts=ytdl_hook-ytdl_path=' + String(o.ytdlpPath).replace(/\\/g, '/'));

  if (o.perf === 'low') a.push('--profile=fast', '--scale=bilinear', '--vd-lavc-threads=2', '--hwdec=no');

  // window placement
  const mode = o.mode || 'off';
  if (mode === 'child' && o.wid) {
    a.push('--wid=' + o.wid, '--no-border', '--osc=yes', '--cursor-autohide=1500');
  } else if (mode === 'wid' && o.wid) {
    a.push('--wid=' + o.wid, '--no-border', '--no-osc');
  } else if (mode === 'sync' && o.syncGeometry) {
    const g = o.syncGeometry;
    a.push('--no-border', '--ontop', '--title=ZephyrPlayer-Video',
      `--geometry=${g.width}x${g.height}+${g.x}+${g.y}`, `--autofit=${g.width}x${g.height}`);
  } else {
    a.push('--autofit=75%x75%', '--autofit-larger=92%x92%', '--geometry=50%:50%');
  }

  if (Array.isArray(o.extra)) a.push(...o.extra);
  return a;
}

/* ---------------------------------- session ---------------------------------- */

class MpvSession extends EventEmitter {
  constructor({ mpvPath, log, platform } = {}) {
    super();
    this.mpvPath = mpvPath;
    this.log = typeof log === 'function' ? log : () => {};
    this.platform = platform || process.platform;
    this.child = null;
    this.ipc = null;
    this.opts = null;
    this.inputs = [];
    this.level = 0;
    this.recoveries = 0;
    this.startedAt = 0;
    this.lastTime = 0;
    this.tail = '';
    this.live = new Map();
    this._expected = new WeakSet();
    this._stableTimer = null;
    this._generation = 0;
  }

  get alive() { return !!(this.child && this.child.exitCode === null && !this.child.killed); }
  get connected() { return !!(this.ipc && this.ipc.connected); }
  get props() { return this.ipc ? this.ipc.props : {}; }

  /** Start (or re-use) mpv for the given inputs. */
  async play(inputs, opts = {}) {
    const list = (Array.isArray(inputs) ? inputs : [inputs]).filter(Boolean).map(String);
    if (!list.length) return { ok: false, error: 'No media input' };
    if (!this.mpvPath) return { ok: false, error: 'mpv not found' };

    const sameLaunch = this.opts && this.alive && this.connected && opts.reuse !== false &&
      (opts.restart !== true) &&
      this.opts.quality === opts.quality && this.opts.mode === opts.mode &&
      this.opts.vo === opts.vo && this.opts.hwdec === opts.hwdec && this.opts.perf === opts.perf &&
      (this.opts.wid || null) === (opts.wid || null);

    if (sameLaunch && list.length === 1) {
      try {
        await this._loadfile(list[0], opts.startPos);
        this.inputs = list;
        this.opts = Object.assign({}, this.opts, opts);
        return { ok: true, reused: true, pid: this.child.pid };
      } catch (e) {
        this.log('loadfile reuse failed, relaunching:', e.message);
      }
    }

    await this.stop();
    this.inputs = list;
    this.opts = Object.assign({}, opts);
    this.level = 0;
    this.recoveries = 0;
    this.perfStage = 0;
    this.tail = '';
    return this._launch(opts.startPos || 0);
  }

  async _loadfile(file, startPos) {
    const optStr = startPos && startPos > 3 ? 'start=' + Math.floor(startPos) : 'start=none';
    try {
      await this.ipc.command('loadfile', file, 'replace', optStr);
    } catch (e1) {
      await this.ipc.command('loadfile', file, 'replace', -1, optStr); // mpv >= 0.38 signature
    }
    await this.ipc.set('pause', false).catch(() => {});
  }

  _ipcPath() {
    const id = process.pid + '-' + Date.now().toString(36) + '-' + (++this._generation);
    return this.platform === 'win32'
      ? '\\\\.\\pipe\\zephyr-' + id
      : path.join(os.tmpdir(), 'zephyr-' + id + '.sock');
  }

  async _launch(startPos) {
    const ipcPath = this._ipcPath();
    const args = buildArgs(Object.assign({}, this.opts, {
      level: this.level, ipcPath, startPos, platform: this.platform, log: this.log, perfStage: this.perfStage || 0
    }));
    this.log('mpv launch (level ' + this.level + '):', args.join(' '), '--', this.inputs.join(' '));

    let child;
    try {
      child = spawn(this.mpvPath, [...args, '--', ...this.inputs], {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, detached: false,
        env: Object.assign({}, process.env, this.opts.env || {})
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.child = child;
    this.startedAt = Date.now();
    this.tail = '';
    const collect = (d) => { this.tail = (this.tail + d.toString()).slice(-6000); };
    if (child.stdout) child.stdout.on('data', collect);
    if (child.stderr) child.stderr.on('data', collect);
    child.once('error', (err) => {
      this.log('mpv spawn error:', err.message);
      if (this.child === child) { this.child = null; this.emit('failed', { error: err.message }); }
    });
    child.once('exit', (code, signal) => this._onExit(child, code, signal));

    const ipc = new MpvIpc();
    this.ipc = ipc;
    ipc.on('prop', (name, val) => {
      if (name === 'time-pos' && typeof val === 'number') this.lastTime = val;
      this.emit('prop', name, val);
    });
    ipc.on('mpv-event', (m) => this._onMpvEvent(m));
    ipc.on('close', () => this.emit('ipc-close'));

    try {
      await ipc.connect(ipcPath, { attempts: 80, delayMs: 100 });
    } catch (e) {
      // process may have died before the pipe appeared; the exit handler deals with recovery
      if (!this.alive) return { ok: false, error: this.tail.slice(-400) || e.message, pending: true };
      return { ok: true, pid: child.pid, ipc: false };
    }

    for (const p of OBSERVED) ipc.observe(p).catch(() => {});
    if (this.opts.mode === 'child' || this.opts.mode === 'wid') {
      ipc.command('keybind', 'MBTN_LEFT', 'cycle pause').catch(() => {});
      ipc.command('keybind', 'MBTN_LEFT_DBL', 'script-message zephyr-fs').catch(() => {});
      ipc.command('script-message', 'osc-visibility', 'never', 'no-osd').catch(() => {});
    }
    this._applyLive();
    this._armGuards();
    clearTimeout(this._stableTimer);
    this._stableTimer = setTimeout(() => { this.recoveries = 0; }, 30000);
    this.emit('started', { pid: child.pid, level: this.level });
    return { ok: true, pid: child.pid, level: this.level };
  }

  _applyLive() {
    for (const [k, v] of this.live) this.ipc.set(k, v).catch(() => {});
  }

  _onMpvEvent(m) {
    if (m.event === 'file-loaded') { this._applyLive(); this._armGuards(); this.emit('file-loaded'); }
    else if (m.event === 'end-file') this.emit('end-file', { reason: m.reason, error: m.file_error || null });
    else if (m.event === 'client-message') this.emit('client-message', m.args || []);
  }

  _onExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    try { if (this.ipc) this.ipc.destroy(); } catch {}
    this.ipc = null;
    clearTimeout(this._stableTimer);
    this._clearGuards();
    if (this._expected.has(child)) { this.emit('stopped'); return; }
    if (code === 0 && !signal) { this.emit('closed', { code }); return; }

    const tail = this.tail.slice(-500);
    this.log('mpv exited abnormally', code, signal, tail);
    if (this.recoveries >= 4) { this.emit('failed', { error: tail || ('mpv exited with code ' + code) }); return; }
    this.recoveries++;
    const badOption = /option not found|Error parsing option|Unknown option|Setting commandline option/i.test(tail);
    const earlyDeath = Date.now() - this.startedAt < 5000;
    if (badOption) this.level = 3;
    else if (earlyDeath && this.level < 3) this.level++;
    this.emit('recovering', { level: this.level, attempt: this.recoveries, reason: tail });
    setTimeout(() => {
      if (this.child || !this.opts) return;
      this._launch(this.lastTime).then((r) => {
        if (r && r.ok === false && !r.pending) this.emit('failed', { error: r.error });
      });
    }, 300);
  }

  async stop() {
    const child = this.child;
    clearTimeout(this._stableTimer);
    this._clearGuards();
    if (!child) return;
    this._expected.add(child);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try { if (this.ipc && this.ipc.connected) await this.ipc.command('quit').catch(() => {}); } catch {}
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {}
      if (this.platform === 'win32' && child.pid) {
        try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {}
      }
    }, 800);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 2500))]);
    clearTimeout(killTimer);
    if (this.child === child) {
      this.child = null;
      try { if (this.ipc) this.ipc.destroy(); } catch {}
      this.ipc = null;
    }
  }

  /* ----- self-healing guards ----- */

  _clearGuards() {
    clearTimeout(this._blankTimer);
    clearInterval(this._perfTimer);
    this._blankTimer = null;
    this._perfTimer = null;
  }

  _armGuards() {
    this._clearGuards();
    this._loadedAt = Date.now();
    this._lastDrops = null;
    this._badTicks = 0;
    // 1) blank / frozen video detection. Starts polling after load but ONLY judges once playback is really
    //    running (audio clock advancing). Buffering / slow networks / yt-dlp resolution are never treated as blank.
    this._blankChecks = 0;
    this._blankBad = 0;
    this._blankLastT = null;
    this._blankTimer = setTimeout(function tick(self) {
      self._checkBlank().then((done) => {
        if (done || !self.connected || ++self._blankChecks > 40) return;
        self._blankTimer = setTimeout(() => tick(self), 2500);
      }).catch(() => {});
    }, 5000, this);
    // 2) adaptive performance: sustained frame drops -> lighter rendering, live
    if (this.opts && this.opts.adaptive !== false) {
      this._perfTimer = setInterval(() => { this._perfTick().catch(() => {}); }, 3000);
    }
  }

  /** Resolves true when no more checking is needed. */
  async _checkBlank() {
    if (!this.connected || this._escalating) return true;
    const p = this.ipc.props;
    const tracks = Array.isArray(p['track-list']) ? p['track-list'] : [];
    const hasVideo = tracks.some(t => t.type === 'video' && !t.albumart && !t.image);
    if (!hasVideo) return tracks.length > 0;          // audio-only: nothing to verify (tracks not known yet: keep waiting)
    const t = this.lastTime;
    const prev = this._blankLastT;
    this._blankLastT = t;
    // not playing yet (paused, buffering, still opening): reset and keep waiting
    if (p.pause || p['paused-for-cache'] || prev === null || !(t - prev > 1.2)) { this._blankBad = 0; return false; }
    const configured = await this.getProp('vo-configured');
    const fps = await this.getProp('estimated-vf-fps');
    const cfps = await this.getProp('container-fps');
    const frozen = typeof fps === 'number' && fps < 0.5 && typeof cfps === 'number' && cfps >= 5;
    if (configured === true && !frozen) return true;   // healthy: stop checking
    this._blankBad++;
    if (this._blankBad >= 2) {                         // two consecutive bad samples while the clock is running
      await this._escalate(configured === false ? 'Video output failed to start' : 'Video is not being displayed');
      return true;
    }
    return false;
  }

  async _perfTick() {
    if (!this.connected || this._escalating) return;
    const p = this.ipc.props;
    if (p.pause || p['paused-for-cache'] || p['eof-reached'] || Date.now() - this._loadedAt < 6000) { this._lastDrops = null; return; }
    const [a, b] = await Promise.all([this.getProp('frame-drop-count'), this.getProp('decoder-frame-drop-count')]);
    const total = (Number(a) || 0) + (Number(b) || 0);
    const now = Date.now();
    if (this._lastDrops) {
      const dt = (now - this._lastDrops.at) / 1000;
      const rate = (total - this._lastDrops.total) / dt;
      if (dt > 1) this._badTicks = rate > 4 ? this._badTicks + 1 : Math.max(0, this._badTicks - 1);
    }
    this._lastDrops = { total, at: now };
    if (this._badTicks >= 2 && (this.perfStage || 0) < 3) { this._badTicks = 0; await this._degradePerf(); }
  }

  async _degradePerf() {
    const stage = (this.perfStage = (this.perfStage || 0) + 1);
    const set = (k, v) => this.ipc.set(k, v).catch(() => {});
    if (stage >= 1) {
      await Promise.all([set('scale', 'bilinear'), set('cscale', 'bilinear'), set('dscale', 'bilinear'), set('deband', false),
        set('sharpen', 0), set('correct-downscaling', false), set('linear-downscaling', false), set('sigmoid-upscaling', false),
        set('glsl-shaders', ''), set('hdr-compute-peak', 'no')]);
    }
    if (stage >= 2) {
      await set('framedrop', 'decoder+vo');
      await set('vd-lavc-skiploopfilter', 'nonref');
      const hw = await this.getProp('hwdec-current');
      if (hw === 'no' && this.level < 2) await set('hwdec', 'auto-safe'); // try the GPU decoder if we are on the CPU
    }
    if (stage >= 3) await set('vd-lavc-fast', true);
    this.log('perf guard: stage', stage);
    this.emit('perf', { stage });
  }

  async _escalate(reason) {
    if (this._escalating || this.level >= 3 || this.recoveries >= 4 || !this.opts) return false;
    this._escalating = true;
    try {
      this.level++;
      this.recoveries++;
      const t = this.lastTime;
      this.log('escalating to level', this.level, ':', reason);
      this.emit('recovering', { level: this.level, attempt: this.recoveries, reason });
      await this.stop();
      if (!this.opts) return false;
      const r = await this._launch(t);
      if (r && r.ok === false && !r.pending) this.emit('failed', { error: r.error });
      return true;
    } finally { this._escalating = false; }
  }

  /** Synchronous, best-effort kill for app shutdown. */
  killNow() {
    const child = this.child;
    clearTimeout(this._stableTimer);
    this._clearGuards();
    if (!child) return;
    this._expected.add(child);
    try { child.kill(); } catch {}
    if (this.platform === 'win32' && child.pid) {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {}
    }
    try { if (this.ipc) this.ipc.destroy(); } catch {}
    this.ipc = null;
    this.child = null;
  }

  /* ----- control surface (validated) ----- */

  async command(name, ...args) {
    if (!COMMANDS.has(name)) throw new Error('command not allowed: ' + name);
    if (!this.connected) throw new Error('mpv not running');
    return this.ipc.command(name, ...args);
  }

  async setProp(name, value) {
    if (!SETTABLE.test(String(name))) throw new Error('property not allowed: ' + name);
    if (!NOT_PERSISTED.test(name)) this.live.set(name, value);
    if (!this.connected) return false;     // remembered; applied on next launch
    await this.ipc.set(name, value);
    return true;
  }

  async getProp(name) {
    if (!this.connected) return undefined;
    try { return await this.ipc.get(name); } catch { return undefined; }
  }

  forgetLive(pattern) {
    for (const k of Array.from(this.live.keys())) if (pattern.test(k)) this.live.delete(k);
  }

  async info() {
    const names = ['path', 'media-title', 'file-format', 'video-codec', 'audio-codec-name', 'video-params',
      'audio-params', 'container-fps', 'estimated-vf-fps', 'hwdec-current', 'current-vo', 'current-ao',
      'video-bitrate', 'audio-bitrate', 'frame-drop-count', 'file-size', 'duration'];
    const out = {};
    await Promise.all(names.map(async (n) => { out[n] = await this.getProp(n); }));
    return out;
  }
}

module.exports = { MpvSession, buildArgs, qualityArgs, OBSERVED, SETTABLE, COMMANDS };
