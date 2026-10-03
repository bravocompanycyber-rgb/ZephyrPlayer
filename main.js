const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  ipcMain,
  Tray,
  nativeImage,
  globalShortcut,
  screen
} = require('electron');

const path = require('path');
const net = require('net');
const fs = require('fs');
const { spawn, execSync, execFile } = require('child_process');

// Optional auto-updater
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  autoUpdater = null;
}

const { MpvController } = require('./mpv-controller');
const { MpvSession } = require('./mpv-session');
const mediaUtils = require('./media-utils');
const { MediaProbe } = require('./media-probe');
const os = require('os');

/* -------------------------------------------------------------------------- */
/* Error Logging                                                              */
/* -------------------------------------------------------------------------- */

const logDir = path.join(app.getPath('userData'), 'logs');
const logFile = path.join(logDir, `zephyr-${new Date().toISOString().slice(0, 10)}.log`);

function ensureLogDir() {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch {}
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  }).join(' ')}\n`;

  try {
    ensureLogDir();
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {}

  if (!app.isPackaged) {
    console.log(...args);
  }
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED REJECTION:', reason);
});

// GPU / utility process crashes are recoverable (Chromium restarts them); just record them.
app.on('child-process-gone', (_e, details) => {
  log('Child process gone:', details && details.type, details && details.reason, details && details.exitCode);
});

// keep the log folder tidy: drop logs older than 14 days
function pruneOldLogs() {
  try {
    const limit = Date.now() - 14 * 86400000;
    for (const f of fs.readdirSync(logDir)) {
      const full = path.join(logDir, f);
      try { if (/^zephyr-.*\.log$/.test(f) && fs.statSync(full).mtimeMs < limit) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}

/* -------------------------------------------------------------------------- */
/* App State                                                                  */
/* -------------------------------------------------------------------------- */

let mainWindow = null;
let alwaysOnTop = false;
let recordingProcess = null;
let recordingOutputPath = null;
let whisperProcess = null;
let tray = null;
let isMini = false;

let embedMode = 'off'; // child | sync | wid | off
let lastEmbedRect = null;   // CSS-pixel rect of the video area relative to the window content
let embedSuspended = false;
let embedWin = null;
let session = null;          // MpvSession (see mpv-session.js)

let lastPlay = { inputs: null, quality: 'high' };

/* -------------------------------------------------------------------------- */
/* Path helpers (dev + packaged)                                              */
/* -------------------------------------------------------------------------- */

function getAppPath() {
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

function getResourcePath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, ...parts);
}

/* -------------------------------------------------------------------------- */
/* Single instance / recent files                                             */
/* -------------------------------------------------------------------------- */

const recentFilesPath = () => path.join(app.getPath('userData'), 'recent.json');
let recentFiles = [];

function loadRecentFiles() {
  try {
    const raw = fs.readFileSync(recentFilesPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) recentFiles = parsed.filter(fileExists);
  } catch {
    recentFiles = [];
  }
}

function saveRecentFiles() {
  try {
    fs.writeFileSync(recentFilesPath(), JSON.stringify(recentFiles.slice(0, 10)), 'utf8');
  } catch {}
}

// Windows can deny "Recent" jump-list categories ("Show recently opened items" is off). Chromium prints an error
// every attempt, so after the first denial we remember it and never ask again.
function jumpListFlag() { return path.join(app.getPath('userData'), 'jumplist-denied'); }
let jumpListDenied = null;

function updateJumpList() {
  if (process.platform !== 'win32') return;
  if (jumpListDenied === null) jumpListDenied = fileExists(jumpListFlag());
  if (jumpListDenied) return;
  try {
    const result = app.setJumpList([
      {
        type: 'custom',
        name: 'Recent Media',
        items: recentFiles.slice(0, 10).map((fp) => ({
          type: 'task',
          title: path.basename(fp),
          description: fp,
          program: process.execPath,
          args: app.isPackaged ? `"${fp}"` : `"${__dirname}" "${fp}"`,
          iconPath: process.execPath,
          iconIndex: 0
        }))
      }
    ]);
    if (result === 'customCategoryAccessDeniedError') {
      jumpListDenied = true;
      try { fs.writeFileSync(jumpListFlag(), '1'); } catch {}
      log('Jump list disabled: Windows privacy settings block recent items (harmless).');
    }
  } catch (e) {
    log('setJumpList failed (privacy settings?):', e.message);
  }
}

function recordRecentFile(filePath) {
  if (!filePath || !fileExists(filePath)) return;
  recentFiles = [filePath, ...recentFiles.filter((f) => f !== filePath)].slice(0, 10);
  saveRecentFiles();
  updateJumpList();
}


const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    const paths = mediaUtils.argvPaths(argv, { appDir: __dirname });
    if (paths.length) {
      safeSend('open-files', paths);
      paths.forEach(recordRecentFile);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Media keys & thumbar                                                       */
/* -------------------------------------------------------------------------- */

function registerMediaKeys() {
  try {
    globalShortcut.register('MediaPlayPause', () => safeSend('hotkey', 'playpause'));
    globalShortcut.register('MediaNextTrack', () => safeSend('hotkey', 'next'));
    globalShortcut.register('MediaPreviousTrack', () => safeSend('hotkey', 'prev'));
    globalShortcut.register('MediaStop', () => safeSend('hotkey', 'stop'));
  } catch (e) {
    log('Media key registration failed:', e.message);
  }
}

function setupThumbar() {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'win32') return;
  try {
    const iconDir = path.join(getAppPath(), 'assets', 'icons');
    mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: nativeImage.createFromPath(path.join(iconDir, 'thumb-prev.png')),
        click: () => safeSend('hotkey', 'prev')
      },
      {
        tooltip: 'Play / Pause',
        icon: nativeImage.createFromPath(path.join(iconDir, 'thumb-play.png')),
        click: () => safeSend('hotkey', 'playpause')
      },
      {
        tooltip: 'Next',
        icon: nativeImage.createFromPath(path.join(iconDir, 'thumb-next.png')),
        click: () => safeSend('hotkey', 'next')
      }
    ]);
  } catch (e) {
    log('setThumbarButtons failed:', e.message);
  }
}

const mpv = new MpvController();

/* -------------------------------------------------------------------------- */
/* Utility                                                                    */
/* -------------------------------------------------------------------------- */

function safeSend(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (e) {
    log(`IPC send failed: ${channel}`, e.message);
  }
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function isAbsoluteExecutable(value) {
  return typeof value === 'string' && (
    value.includes('\\') ||
    value.includes('/') ||
    path.isAbsolute(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Find executables (cached; never blocks the UI repeatedly)                  */
/* -------------------------------------------------------------------------- */

const toolCache = new Map();

function cachedTool(key, finder) {
  const hit = toolCache.get(key);
  const now = Date.now();
  // found → trust for 60s; missing → re-check after 4s so dropping a file next to the app works
  if (hit && now - hit.at < (hit.value ? 60000 : 4000)) return hit.value;
  let value = null;
  try { value = finder(); } catch (e) { log(`find ${key} failed:`, e.message); }
  toolCache.set(key, { value, at: now });
  return value;
}

function onPath(command) {
  try {
    const { execFileSync } = require('child_process');
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore', windowsHide: true, timeout: 4000 });
    return true;
  } catch { return false; }
}

function firstExisting(names, dirs) {
  for (const d of dirs) for (const n of names) {
    const c = path.join(d, n);
    if (fileExists(c)) return c;
  }
  return null;
}

function toolDirs(...sub) {
  const bases = [getAppPath(), process.resourcesPath || getAppPath(), __dirname];
  const out = [];
  for (const b of bases) { out.push(path.join(b, ...sub)); }
  return Array.from(new Set(out));
}

function findMpv() {
  return cachedTool('mpv', () => {
    let found = null;
    try { found = mpv.findMpv(); } catch (e) { log('MpvController.findMpv failed:', e.message); }
    if (found && (!isAbsoluteExecutable(found) || fileExists(found))) return found;
    return firstExisting(['mpv.exe', 'mpv'], [...toolDirs(), ...toolDirs('mpv')]) || (onPath('mpv') ? 'mpv' : null);
  });
}

function findYtDlp() {
  return cachedTool('yt-dlp', () =>
    firstExisting(['yt-dlp.exe', 'yt-dlp'], toolDirs()) ||
    (onPath('yt-dlp') ? 'yt-dlp' : null) ||
    (onPath('youtube-dl') ? 'youtube-dl' : null));
}

function findWhisper() {
  return cachedTool('whisper', () =>
    firstExisting(['whisper-cli.exe', 'whisper.exe'], toolDirs()) ||
    (onPath('whisper-cli') ? 'whisper-cli' : null) || (onPath('whisper') ? 'whisper' : null));
}

function findFfmpeg() {
  return cachedTool('ffmpeg', () =>
    firstExisting(['ffmpeg.exe', 'ffmpeg'], [...toolDirs('ffmpeg'), ...toolDirs('ffmpeg', 'bin'), ...toolDirs()]) ||
    (onPath('ffmpeg') ? 'ffmpeg' : null));
}

function findFfprobe() {
  return cachedTool('ffprobe', () =>
    firstExisting(['ffprobe.exe', 'ffprobe'], [...toolDirs('ffmpeg'), ...toolDirs('ffmpeg', 'bin'), ...toolDirs()]) ||
    (onPath('ffprobe') ? 'ffprobe' : null));
}

let probeSvc = null;
function getProbe() {
  if (!probeSvc) {
    probeSvc = new MediaProbe({
      cacheFile: path.join(app.getPath('userData'), 'probe-cache.json'),
      thumbDir: path.join(app.getPath('userData'), 'thumbs'),
      log, concurrency: 3
    });
  }
  probeSvc.setTools({ ffprobePath: findFfprobe(), ffmpegPath: findFfmpeg(), mpvPath: findMpv() });
  return probeSvc;
}

// YouTube extraction now needs a JavaScript runtime for yt-dlp (https://github.com/yt-dlp/yt-dlp/wiki/EJS).
// Prefer deno.exe next to the app (free), otherwise reuse this app's own Electron binary as a Node runtime.
function findJsRuntime() {
  return cachedTool('jsruntime', () => {
    const deno = firstExisting(['deno.exe', 'deno'], toolDirs());
    if (deno) return { kind: 'deno', value: 'deno:' + deno.replace(/\\/g, '/'), env: null };
    if (onPath('deno')) return { kind: 'deno (PATH)', value: null, env: null };   // deno is yt-dlp's default
    return { kind: 'electron-node', value: 'node:' + process.execPath.replace(/\\/g, '/'), env: { ELECTRON_RUN_AS_NODE: '1' } };
  });
}

const COOKIE_BROWSERS = new Set(['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium']);
function ytdlArgsFor(cookies) {
  const rt = findJsRuntime();
  const args = ['--no-playlist'];
  if (rt && rt.value) args.push('--js-runtimes', rt.value);
  if (COOKIE_BROWSERS.has(cookies)) args.push('--cookies-from-browser', cookies);
  return { args, env: Object.assign({}, process.env, (rt && rt.env) || {}) };
}

function friendlyYtdlError(text) {
  const t = String(text || '');
  if (/sign in to confirm|not a bot|confirm you.?re not/i.test(t)) return 'YouTube wants you signed in. Open the link panel and pick your browser under "Use cookies from", then try again.';
  if (/javascript runtime|jsc|EJS/i.test(t)) return 'YouTube needs a JavaScript runtime. Put the free deno.exe (deno.com) next to ZephyrPlayer, then File ▸ Update yt-dlp.';
  if (/HTTP Error 403|nsig|SABR|unable to extract|Requested format is not available/i.test(t)) return 'yt-dlp is out of date for current YouTube. Use File ▸ Update yt-dlp, then retry.';
  if (/private|unavailable|removed|members-only|age/i.test(t)) return (t.split(/\r?\n/).reverse().find((l) => /ERROR/.test(l)) || t).replace(/^.*ERROR:\s*/, '').slice(0, 200);
  if (/Unsupported URL/i.test(t)) return 'This link is not supported by yt-dlp. If it is a direct video/stream URL, check that it is still valid.';
  const err = t.split(/\r?\n/).reverse().find((l) => /ERROR/.test(l));
  return (err ? err.replace(/^.*ERROR:\s*/, '') : t).trim().slice(0, 220) || 'Could not open this link';
}

function diagnoseUrl(url, cookies) {
  const ytdlp = findYtDlp();
  if (!ytdlp) return Promise.resolve('yt-dlp.exe was not found next to the app, so links cannot be resolved.');
  const { args, env } = ytdlArgsFor(cookies);
  return new Promise((resolve) => {
    try {
      execFile(ytdlp, [...args, '-g', '--', url], { timeout: 45000, windowsHide: true, env, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err && String(stdout).trim()) resolve('The link resolves, but mpv could not play it (' + String(stdout).trim().split(/\r?\n/)[0].slice(0, 60) + '…). Try a different quality or File ▸ Update yt-dlp.');
          else resolve(friendlyYtdlError(String(stderr || '') + '\n' + (err ? err.message : '')));
        });
    } catch (e) { resolve(e.message); }
  });
}

function ytdlpStampPath() { return path.join(app.getPath('userData'), 'ytdlp-update.json'); }

function updateYtDlp() {
  const y = findYtDlp();
  if (!y) return Promise.resolve({ ok: false, output: 'yt-dlp not found next to the app.' });
  return new Promise((resolve) => {
    execFile(y, ['-U'], { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
      toolCache.delete('yt-dlp');
      try { fs.writeFileSync(ytdlpStampPath(), JSON.stringify({ at: Date.now() })); } catch {}
      resolve({ ok: !err, output: (String(stdout) + String(stderr)).trim().slice(-700) || (err ? err.message : 'Done') });
    });
  });
}

// YouTube changes constantly; keep yt-dlp fresh without bothering the user (at most every 3 days, silent).
function maybeAutoUpdateYtDlp() {
  try {
    let last = 0;
    try { last = JSON.parse(fs.readFileSync(ytdlpStampPath(), 'utf8')).at || 0; } catch {}
    if (Date.now() - last < 3 * 86400000) return;
    updateYtDlp().then((r) => log('yt-dlp auto-update:', r.ok ? 'ok' : 'failed', r.output.split(/\r?\n/).pop()));
  } catch (e) { log('auto-update check failed:', e.message); }
}

function ensureScreenshotDir() {
  try {
    const dir = path.join(app.getPath('pictures'), 'ZephyrPlayer');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    try { const d = path.join(app.getPath('userData'), 'screenshots'); fs.mkdirSync(d, { recursive: true }); return d; } catch { return null; }
  }
}

/* -------------------------------------------------------------------------- */
/* Embedded video surface (child window that follows the player area)         */
/* -------------------------------------------------------------------------- */

function nativeHandleString(win) {
  const h = win.getNativeWindowHandle();
  return (h.length >= 8 ? h.readBigUInt64LE(0) : BigInt(h.readUInt32LE(0))).toString();
}

function ensureEmbedWindow() {
  if (embedWin && !embedWin.isDestroyed()) return embedWin;
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    embedWin = new BrowserWindow({
      parent: mainWindow,
      show: false,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#000000',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    });
    embedWin.setMenuBarVisibility(false);
    embedWin.on('closed', () => { embedWin = null; });
    embedWin.loadURL('about:blank').catch(() => {});
    return embedWin;
  } catch (e) {
    log('Embed window failed:', e.message);
    embedWin = null;
    return null;
  }
}

let layoutTimer = null;
function scheduleEmbedLayout() {
  if (layoutTimer) return;
  layoutTimer = setTimeout(() => { layoutTimer = null; layoutEmbed(); }, 16);
}

function layoutEmbed() {
  if (!embedWin || embedWin.isDestroyed()) return;
  try {
    if (!lastEmbedRect || embedSuspended || !session || !session.alive ||
        !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) {
      embedWin.hide();
      return;
    }
    const cb = mainWindow.getContentBounds();
    embedWin.setBounds({
      x: Math.round(cb.x + lastEmbedRect.x),
      y: Math.round(cb.y + lastEmbedRect.y),
      width: Math.max(160, Math.round(lastEmbedRect.width)),
      height: Math.max(90, Math.round(lastEmbedRect.height))
    });
    if (!embedWin.isVisible()) embedWin.showInactive();
  } catch (e) { log('layoutEmbed failed:', e.message); }
}

function hideEmbed() {
  try { if (embedWin && !embedWin.isDestroyed()) embedWin.hide(); } catch {}
}

/* -------------------------------------------------------------------------- */
/* mpv session (live IPC control, crash recovery)                             */
/* -------------------------------------------------------------------------- */

let propBatch = {};
let propTimer = null;

function queueProp(name, value) {
  propBatch[name] = value;
  if (propTimer) return;
  propTimer = setTimeout(() => {
    propTimer = null;
    const batch = propBatch;
    propBatch = {};
    safeSend('mpv-state', batch);
  }, name === 'time-pos' ? 200 : 60);
}

function getSession() {
  const mpvPath = findMpv();
  if (!mpvPath) return null;
  if (session && session.mpvPath !== mpvPath) {
    try { session.killNow(); } catch {}
    session = null;
  }
  if (session) return session;

  session = new MpvSession({ mpvPath, log });
  session.on('prop', queueProp);
  session.on('started', (info) => safeSend('mpv-event', { type: 'started', level: info.level }));
  session.on('file-loaded', () => safeSend('mpv-event', { type: 'file-loaded' }));
  session.on('end-file', (info) => {
    if (info.reason !== 'error') return;
    const src = session && session.inputs && session.inputs[0];
    if (src && mediaUtils.isUrl(src)) {
      // find out WHY a link failed (outdated yt-dlp, no JS runtime, sign-in wall...) instead of a generic error
      diagnoseUrl(src, session.opts && session.opts.cookies).then((msg) => safeSend('mpv-event', { type: 'file-error', error: msg, stream: true }));
    } else {
      safeSend('mpv-event', { type: 'file-error', error: info.error || 'Could not open this file' });
    }
  });
  session.on('perf', (info) => safeSend('mpv-event', { type: 'perf', stage: info.stage }));
  session.on('client-message', (args) => {
    if (args[0] === 'zephyr-fs') safeSend('hotkey', 'fullscreen');
  });
  session.on('closed', () => { hideEmbed(); safeSend('mpv-event', { type: 'closed' }); });
  session.on('stopped', () => hideEmbed());
  session.on('recovering', (info) => {
    log('mpv recovering, level', info.level, 'attempt', info.attempt);
    safeSend('mpv-event', { type: 'recovering', level: info.level, attempt: info.attempt, reason: String(info.reason || '').slice(0, 120) });
  });
  session.on('failed', (info) => {
    hideEmbed();
    log('mpv failed:', info.error);
    safeSend('mpv-process-error', { error: String(info.error || 'mpv failed').slice(-500) });
    safeSend('mpv-event', { type: 'failed', error: String(info.error || '').slice(-300) });
  });
  return session;
}

function normalizeInputs(inputs) {
  if (Array.isArray(inputs)) return inputs.filter((x) => typeof x === 'string' && x).slice(0, 200);
  if (typeof inputs === 'string' && inputs) return [inputs];
  return [];
}

async function startPlayback(opts = {}) {
  const inputs = normalizeInputs(opts.files);
  if (!inputs.length) return { ok: false, error: 'No media input' };

  const s = getSession();
  if (!s) { log('mpv not found'); return { ok: false, error: 'mpv not found' }; }

  for (const i of inputs) {
    if (!mediaUtils.isUrl(i) && !fileExists(i)) return { ok: false, error: 'File not found: ' + path.basename(i) };
  }

  let mode = opts.embed === false ? 'off' : (embedMode === 'child' ? 'child' : 'off');
  let wid = null;
  let syncGeometry = null;

  if (process.platform !== 'win32' && (mode === 'child' || mode === 'wid')) mode = 'off';

  if (mode === 'child') {
    const w = lastEmbedRect ? ensureEmbedWindow() : null;
    if (w) { layoutEmbed(); try { wid = nativeHandleString(w); } catch (e) { log('HWND failed:', e.message); } }
    if (!wid) mode = 'off';
  } else if (mode === 'wid') {
    try { wid = nativeHandleString(mainWindow); } catch (e) { log('HWND failed:', e.message); mode = 'off'; }
  } else if (mode === 'sync') {
    if (lastEmbedRect && mainWindow && !mainWindow.isDestroyed()) {
      const cb = mainWindow.getContentBounds();
      syncGeometry = {
        x: Math.round(cb.x + lastEmbedRect.x), y: Math.round(cb.y + lastEmbedRect.y),
        width: Math.max(160, Math.round(lastEmbedRect.width)), height: Math.max(90, Math.round(lastEmbedRect.height))
      };
    } else mode = 'off';
  }

  const base = {
    quality: opts.quality || 'high',
    vo: opts.vo, hwdec: opts.hwdec, perf: opts.perf,
    volume: opts.volume, mute: !!opts.mute,
    startPos: Number(opts.startPos) || 0,
    ytdlpPath: findYtDlp(), shaderDir: path.join(getAppPath(), 'shaders'),
    screenshotDir: ensureScreenshotDir(),
    reuse: opts.reuse !== false, restart: !!opts.restart,
    cookies: COOKIE_BROWSERS.has(opts.cookies) ? opts.cookies : null
  };
  if (inputs.some(mediaUtils.isUrl)) {
    const rt = findJsRuntime();
    base.jsRuntime = rt && rt.value;
    base.env = rt && rt.env;
  }

  let res = await s.play(inputs, Object.assign({}, base, { mode, wid, syncGeometry }));
  if (!res.ok && mode !== 'off') {
    log('Embedded start failed (' + mode + '), retrying in a separate window:', res.error);
    mode = 'off'; wid = null; hideEmbed();
    res = await s.play(inputs, Object.assign({}, base, { mode: 'off', restart: true }));
  }
  if (!res.ok) return { ok: false, error: res.error || 'mpv failed to start' };

  lastPlay = { inputs, quality: base.quality };
  const embedded = mode === 'child' || mode === 'wid' || mode === 'sync';
  if (mode === 'child') scheduleEmbedLayout();
  const ytdlp = findYtDlp();
  if (inputs.some(mediaUtils.isUrl) && !ytdlp) log('WARNING: yt-dlp not found – YouTube will not work');
  return { ok: true, embedded, mode, pid: res.pid, reused: !!res.reused };
}

async function stopPlayback() {
  try { if (session) await session.stop(); } catch (e) { log('stop failed:', e.message); }
  hideEmbed();
  lastPlay = { inputs: null, quality: 'high' };
}

/* -------------------------------------------------------------------------- */
/* Window                                                                     */
/* -------------------------------------------------------------------------- */

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const fallback = { width: 1320, height: 820, maximized: false };
  try {
    const st = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (!st || !Number.isFinite(st.width) || !Number.isFinite(st.height)) return fallback;
    const out = { width: Math.max(900, st.width), height: Math.max(580, st.height), maximized: !!st.maximized };
    if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
      // only restore the position if it is still on a connected display
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return st.x + 100 > b.x && st.x < b.x + b.width - 100 && st.y + 50 > b.y && st.y < b.y + b.height - 50;
      });
      if (visible) { out.x = st.x; out.y = st.y; }
    }
    return out;
  } catch { return fallback; }
}

let saveStateTimer = null;
function saveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed() || isMini || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
      const maximized = mainWindow.isMaximized();
      const b = maximized ? (mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds()) : mainWindow.getBounds();
      fs.writeFileSync(windowStatePath(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }), 'utf8');
    } catch {}
  }, 400);
}

function sendInitialFiles() {
  const paths = mediaUtils.argvPaths(process.argv, { appDir: __dirname });
  if (paths.length) {
    safeSend('open-files', paths);
    paths.forEach(recordRecentFile);
  }
}

function createWindow() {
  const st = loadWindowState();
  mainWindow = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 900,
    minHeight: 580,
    backgroundColor: '#0b0f14',
    title: 'ZephyrPlayer',
    icon: path.join(getAppPath(), 'assets', 'icons', 'zephyrplayer.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false // keep auto-next, sleep timer and progress running while minimized
    },
    autoHideMenuBar: true
  });

  if (st.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Deny every permission except the few the player UI needs.
  const allowed = new Set(['fullscreen', 'clipboard-read', 'clipboard-sanitized-write']);
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // The UI never navigates; anything that tries to is sent to the browser (http/https only) or dropped.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.on('focus', () => {
    if (session && session.opts && session.opts.mode === 'sync') session.setProp('ontop', true).catch(() => {});
  });
  mainWindow.on('blur', () => {
    if (session && session.opts && session.opts.mode === 'sync') session.setProp('ontop', false).catch(() => {});
  });

  for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'minimize', 'restore', 'show', 'hide', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(ev, scheduleEmbedLayout);
  }
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) mainWindow.on(ev, saveWindowState);
  mainWindow.on('enter-full-screen', () => safeSend('window-state', { fullscreen: true }));
  mainWindow.on('leave-full-screen', () => safeSend('window-state', { fullscreen: false }));

  /* ---- crash / hang recovery ---- */
  let reloads = 0;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('Renderer process gone:', details && details.reason);
    if (app.isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    if (details && details.reason === 'clean-exit') return;
    if (reloads++ < 3) {
      setTimeout(() => { try { mainWindow.webContents.reload(); } catch (e) { log('reload failed:', e.message); } }, 400);
    } else {
      dialog.showErrorBox('ZephyrPlayer', 'The player interface crashed repeatedly. Please restart the app.\n\nLog: ' + logFile);
    }
  });
  mainWindow.webContents.on('did-finish-load', () => { setTimeout(() => reloads = Math.max(0, reloads - 1), 60000); });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (isMain) log('Page failed to load:', code, desc);
  });
  let hangTimer = null;
  mainWindow.on('unresponsive', () => {
    log('Window unresponsive');
    clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); } catch {}
    }, 12000);
  });
  mainWindow.on('responsive', () => clearTimeout(hangTimer));

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    setupThumbar();
    log('App ready. mpv:', findMpv() || 'NOT FOUND', '| yt-dlp:', findYtDlp() || 'NOT FOUND', '| js runtime:', (findJsRuntime() || {}).kind);
  });

  // Send status + files once the renderer has actually registered its listeners.
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      const mpvPath = findMpv();
      safeSend('mpv-status', { available: !!mpvPath, path: mpvPath, ytdlp: !!findYtDlp() });
    }, 150);
  });
  mainWindow.webContents.once('did-finish-load', () => setTimeout(sendInitialFiles, 350));

  mainWindow.on('close', () => { app.isQuitting = true; });

  mainWindow.on('closed', () => {
    mainWindow = null;
    try { if (session) session.killNow(); } catch {}
    try { if (embedWin && !embedWin.isDestroyed()) embedWin.destroy(); } catch {}
    embedWin = null;
    try { mpv.quit(); } catch {}
  });
}

/* -------------------------------------------------------------------------- */
/* Menu                                                                       */
/* -------------------------------------------------------------------------- */

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Files…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await showOpen({ properties: ['openFile', 'multiSelections'], filters: mediaFilters() });
            if (!result.canceled && result.filePaths.length) {
              safeSend('open-files', result.filePaths);
            }
          }
        },
        {
          label: 'Open Folder…',
          click: () => safeSend('hotkey', 'openfolder')
        },
        {
          label: 'Open URL / YouTube…',
          accelerator: 'CmdOrCtrl+U',
          click: () => safeSend('hotkey', 'openurl')
        },
        { type: 'separator' },
        {
          label: 'Update yt-dlp (fixes YouTube / link problems)',
          click: async () => {
            const r = await updateYtDlp();
            dialog.showMessageBox(dialogParent() || undefined, { type: r.ok ? 'info' : 'warning', title: 'yt-dlp', message: r.ok ? 'yt-dlp is up to date' : 'Update failed', detail: r.output });
          }
        },
        {
          label: 'Open icons folder',
          click: () => { try { shell.openPath(ICON_DIRS().find((d) => fileExists(d)) || ICON_DIRS()[0]); } catch {} }
        },
        {
          label: 'Open log folder',
          click: () => { try { shell.openPath(logDir); } catch {} }
        },
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ZephyrPlayer',
          click: () => {
            if (!mainWindow) return;
            const mpvPath = findMpv();
            const ytdlpPath = findYtDlp();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'ZephyrPlayer ' + app.getVersion(),
              message: 'ZephyrPlayer ' + app.getVersion(),
              detail:
                'mpv: ' + (mpvPath || 'not found') + '\n' +
                'yt-dlp: ' + (ytdlpPath || 'not found (needed for YouTube)') + '\n\n' +
                'Place mpv.exe and yt-dlp.exe next to the app for full power.'
            });
          }
        },
        {
          label: 'Download mpv',
          click: () => shell.openExternal('https://github.com/shinchiro/mpv-winbuild-cmake/releases')
        },
        {
          label: 'Download yt-dlp (YouTube)',
          click: () => shell.openExternal('https://github.com/yt-dlp/yt-dlp/releases')
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            if (!autoUpdater) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Updates',
                message: 'Auto-update isn\'t set up.'
              });
              return;
            }
            if (!app.isPackaged) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Updates',
                message: 'Update checks only run in packaged builds.'
              });
              return;
            }
            setupAutoUpdate();
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* -------------------------------------------------------------------------- */
/* Auto Updater                                                               */
/* -------------------------------------------------------------------------- */

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    safeSend('update-status', { status: 'available', version: info && info.version });
  });

  autoUpdater.on('update-not-available', () => {
    safeSend('update-status', { status: 'none' });
  });

  autoUpdater.on('error', (err) => {
    log('Auto-updater error:', err);
    safeSend('update-status', { status: 'error', error: err && err.message });
  });

  autoUpdater.on('download-progress', (p) => {
    safeSend('update-status', { status: 'downloading', percent: p && p.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    safeSend('update-status', { status: 'downloaded', version: info && info.version });

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of ZephyrPlayer (' + (info && info.version || '') + ') has been downloaded.',
      detail: 'Restart now to install it, or it will install automatically next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0
    }).then((res) => {
      if (res.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  try {
    autoUpdater.checkForUpdates();
  } catch (e) {
    log('checkForUpdates failed:', e.message);
  }
}

/* -------------------------------------------------------------------------- */
/* IPC handlers                                                               */
/* -------------------------------------------------------------------------- */

// Every handler is wrapped: a throwing handler returns {ok:false,error} instead of rejecting into the UI.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (e) {
      log(`IPC ${channel} failed:`, e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

function dialogParent() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}
function showOpen(options) {
  const w = dialogParent();
  return w ? dialog.showOpenDialog(w, options) : dialog.showOpenDialog(options);
}
function showSave(options) {
  const w = dialogParent();
  return w ? dialog.showSaveDialog(w, options) : dialog.showSaveDialog(options);
}
function mediaFilters() {
  const exts = Array.from(mediaUtils.MEDIA_EXT).map((e) => e.slice(1)).concat(['srt', 'vtt', 'ass', 'ssa']);
  return [{ name: 'Media & subtitles', extensions: exts }, { name: 'All Files', extensions: ['*'] }];
}

handle('dialog:openFiles', async () => {
  const result = await showOpen({ properties: ['openFile', 'multiSelections'], filters: mediaFilters() });
  return result.canceled ? [] : result.filePaths;
});

handle('dialog:openFolder', async () => {
  const result = await showOpen({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return [];
  const { media } = await mediaUtils.expandPaths([result.filePaths[0]], { maxDepth: 0 });
  return media.map((m) => m.path);
});

// Files and/or folders (drag & drop, Open With) -> { media:[{path,name,size}], subs:[path] }
handle('files:expand', async (_e, paths) => mediaUtils.expandPaths(Array.isArray(paths) ? paths.slice(0, 500) : []));

handle('files:sidecarSubs', async (_e, mediaPath) => ({
  ok: true,
  subs: typeof mediaPath === 'string' ? await mediaUtils.findSidecarSubs(mediaPath) : []
}));

handle('files:readSubtitle', async (_e, filePath) => {
  if (typeof filePath !== 'string' || !mediaUtils.isSub(filePath)) return { ok: false, error: 'Not a subtitle file' };
  const st = await fs.promises.stat(filePath);
  if (st.size > 12 * 1024 * 1024) return { ok: false, error: 'Subtitle file too large' };
  return { ok: true, bytes: new Uint8Array(await fs.promises.readFile(filePath)) };
});

handle('window:setAlwaysOnTop', () => {
  alwaysOnTop = !alwaysOnTop;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'floating' : 'normal');
  return alwaysOnTop;
});

handle('window:setMini', async (_e, mini) => {
  isMini = !!mini;
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, mini: isMini };
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (isMini) {
    mainWindow.setMinimumSize(400, 280);
    mainWindow.setSize(480, 320, true);
  } else {
    mainWindow.setMinimumSize(900, 580);
    mainWindow.setSize(1320, 820, true);
  }
  scheduleEmbedLayout();
  return { ok: true, mini: isMini };
});

handle('window:hideToTray', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return { ok: true };
});

handle('capture:page', async (_e, rect) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No window' };
  const r = rect && Number.isFinite(rect.width) && rect.width > 0
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    : undefined;
  const image = await mainWindow.webContents.capturePage(r);
  const dir = ensureScreenshotDir();
  if (!dir) return { ok: false, error: 'No screenshot folder' };
  const file = path.join(dir, 'zephyr-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png');
  await fs.promises.writeFile(file, image.toPNG());
  return { ok: true, path: file };
});

/* ---- mpv ---- */

handle('mpv:available', () => ({ available: !!findMpv(), path: findMpv(), ytdlp: !!findYtDlp(), jsRuntime: (findJsRuntime() || {}).kind || null }));

handle('ytdlp:update', async () => updateYtDlp());

handle('mpv:playExternal', async (_e, opts) => {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : { files: opts };
  return startPlayback({
    files: o.files, quality: o.quality, embed: o.embed, vo: o.vo, hwdec: o.hwdec,
    perf: o.perf, startPos: o.startPos, volume: o.volume, mute: o.mute, cookies: o.cookies
  });
});

handle('mpv:loadFile', async (_e, file, startPos) =>
  startPlayback({ files: [file], quality: (lastPlay && lastPlay.quality) || 'high', startPos }));

handle('mpv:playUrl', async (_e, args) => {
  const { url, quality, embed, startPos, volume, mute, vo, hwdec, perf, cookies } = args && typeof args === 'object' ? args : {};
  if (!url || !String(url).trim()) return { ok: false, error: 'empty url' };
  const u = String(url).trim();
  if (/youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com/i.test(u) && !findYtDlp()) {
    return {
      ok: false,
      error: 'yt-dlp required for YouTube. Place yt-dlp.exe next to ZephyrPlayer.\nhttps://github.com/yt-dlp/yt-dlp/releases'
    };
  }
  return startPlayback({ files: [u], quality: quality || 'high', embed: embed !== false, startPos, volume, mute, vo, hwdec, perf, cookies });
});

handle('mpv:stop', async () => {
  await stopPlayback();
  return { ok: true };
});

// Quality needs a relaunch (stream format / scalers) — resume exactly where we were.
handle('mpv:setQuality', async (_e, quality) => {
  const s = session;
  if (!s || !s.alive || !s.inputs.length) return { ok: false, error: 'Nothing playing' };
  return startPlayback({
    files: s.inputs, quality: quality || (s.opts && s.opts.quality) || 'high',
    vo: s.opts && s.opts.vo, hwdec: s.opts && s.opts.hwdec, perf: s.opts && s.opts.perf,
    startPos: s.lastTime, volume: Number(s.props.volume), mute: !!s.props.mute, embed: true, restart: true,
    cookies: s.opts && s.opts.cookies
  });
});

function needSession() {
  const s = getSession();
  if (!s) throw new Error('mpv not found');
  return s;
}
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

handle('mpv:applyVideoAdj', async (_e, adj) => {
  const s = needSession();
  for (const k of ['brightness', 'contrast', 'saturation', 'gamma', 'hue']) {
    if (adj && adj[k] != null) await s.setProp(k, clampInt(adj[k], -100, 100));
  }
  return { ok: true, live: s.connected };
});

function buildAudioFilter(eq) {
  const f = [];
  if (eq && eq.normalize) f.push('loudnorm');
  const bass = clampNum(eq && eq.bass, -15, 15), mid = clampNum(eq && eq.mid, -15, 15), treble = clampNum(eq && eq.treble, -15, 15);
  if (bass || mid || treble) {
    f.push(`equalizer=f=100:width_type=o:width=2:g=${bass}`);
    f.push(`equalizer=f=1000:width_type=o:width=2:g=${mid}`);
    f.push(`equalizer=f=8000:width_type=o:width=2:g=${treble}`);
  }
  const gain = clampNum(eq && eq.gain, 0, 20);
  if (gain) f.push(`volume=${gain}dB`);
  return f.length ? 'lavfi=[' + f.join(',') + ']' : '';
}

handle('mpv:applyEq', async (_e, eq) => {
  const s = needSession();
  await s.setProp('af', buildAudioFilter(eq || {}));
  return { ok: true, live: s.connected };
});

handle('mpv:frameStep', async (_e, dir) => {
  const s = session;
  if (!s || !s.connected) return { ok: false, error: 'Frame step needs an active mpv session' };
  await s.command(Number(dir) < 0 ? 'frame-back-step' : 'frame-step');
  return { ok: true };
});

handle('mpv:getMediaInfo', async () => {
  const s = session;
  return {
    ok: true,
    info: {
      source: lastPlay.inputs,
      quality: lastPlay.quality,
      mpv: findMpv(),
      ytdlp: findYtDlp(),
      embedMode,
      embed: !!(s && s.alive && s.opts && s.opts.mode !== 'off'),
      level: s ? s.level : 0,
      details: s && s.connected ? await s.info() : null
    }
  };
});

function trackValue(v) {
  if (v === false || v === 'no' || v === 0) return 'no';
  if (v === 'auto') return 'auto';
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 'auto';
}

handle('mpv:setTracks', async (_e, opts) => {
  const s = needSession();
  const o = opts || {};
  if (o.aid != null && o.aid !== '') await s.setProp('aid', trackValue(o.aid));
  if (o.sid != null && o.sid !== '') await s.setProp('sid', trackValue(o.sid));
  if (o.subDelay != null) await s.setProp('sub-delay', clampNum(o.subDelay, -60, 60));
  if (o.subScale != null) await s.setProp('sub-scale', clampNum(o.subScale, 0.1, 5));
  return { ok: true, live: s.connected };
});

const TONE_MAPS = new Set(['auto', 'clip', 'mobius', 'reinhard', 'hable', 'gamma', 'linear', 'bt.2390', 'spline']);

handle('mpv:applyGeometry', async (_e, geo) => {
  const s = needSession();
  const g = geo || {};
  if (g.aspect) {
    const a = g.aspect === 'native' ? '-1' : String(g.aspect);
    if (/^(-1|\d+(\.\d+)?(:\d+(\.\d+)?)?)$/.test(a)) await s.setProp('video-aspect-override', a);
  }
  if (g.rotate != null) {
    const r = ((Math.round(Number(g.rotate) / 90) * 90) % 360 + 360) % 360;
    await s.setProp('video-rotate', r);
  }
  const vfs = [];
  if (g.flipH) vfs.push('hflip');
  if (g.flipV) vfs.push('vflip');
  await s.setProp('vf', vfs.join(','));
  if (g.panscan != null) await s.setProp('panscan', clampNum(Number(g.panscan) / 100, 0, 1));
  if (g.hdr) {
    const tm = g.hdr === 'no' ? 'clip' : (TONE_MAPS.has(g.hdr) ? g.hdr : 'auto');
    await s.setProp('tone-mapping', tm);
    if (tm !== 'auto' && tm !== 'clip') await s.setProp('hdr-compute-peak', 'yes');
  }
  return { ok: true, live: s.connected };
});

handle('mpv:listAudioDevices', async () => {
  const s = session;
  if (s && s.connected) {
    const list = await s.getProp('audio-device-list');
    if (Array.isArray(list) && list.length) {
      return { ok: true, devices: list.map((d) => ({ id: d.name, name: d.description || d.name })) };
    }
  }
  const mpvPath = findMpv();
  if (!mpvPath) return { ok: false, devices: [{ id: 'auto', name: 'Auto' }] };

  return new Promise((resolve) => {
    try {
      execFile(mpvPath, ['--audio-device=help'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
        const text = (stdout || '') + (stderr || '');
        const devices = [{ id: 'auto', name: 'Auto' }];
        for (const line of text.split(/\r?\n/)) {
          const m = line.trim().match(/^'?([^'\s]+)'?\s+\((.+)\)$|^(\S+)\s+(.+)$/);
          if (!m) continue;
          const id = (m[1] || m[3] || '').trim();
          const name = (m[2] || m[4] || '').trim();
          if (!id || id === 'help' || id === 'Audio' || id.includes('---') || id === 'end' || id === 'auto') continue;
          devices.push({ id, name: name || id });
        }
        if (devices.length === 1) devices.push({ id: 'wasapi', name: 'WASAPI (default)' });
        resolve({ ok: !err, devices });
      });
    } catch {
      resolve({ ok: false, devices: [{ id: 'auto', name: 'Auto' }] });
    }
  });
});

handle('mpv:setAudioDevice', async (_e, deviceId) => {
  const s = needSession();
  await s.setProp('audio-device', deviceId && /^[\w.:/\\{}@\- ]+$/.test(String(deviceId)) ? String(deviceId) : 'auto');
  return { ok: true, live: s.connected };
});

// Generic, whitelisted live property / command access (subtitle styling, audio options, tracks, chapters...)
handle('mpv:setProps', async (_e, map) => {
  const s = needSession();
  const errors = {};
  for (const [k, v] of Object.entries(map && typeof map === 'object' ? map : {}).slice(0, 40)) {
    try { await s.setProp(k, v); } catch (e) { errors[k] = e.message; }
  }
  return { ok: Object.keys(errors).length === 0, errors, live: s.connected };
});

handle('mpv:command', async (_e, name, args) => {
  const s = session;
  if (!s || !s.connected) return { ok: false, error: 'mpv not running' };
  return { ok: true, data: await s.command(String(name), ...(Array.isArray(args) ? args : [])) };
});

handle('mpv:getState', async () => {
  const s = session;
  return { ok: true, running: !!(s && s.alive), props: s && s.connected ? Object.assign({}, s.props) : {} };
});

/* ---- media info, posters, icons, playlists ---- */

handle('media:probe', async (_e, file) => getProbe().probe(file));

handle('media:thumb', async (_e, file, duration) => {
  const out = await getProbe().thumb(file, duration);
  return { ok: !!out, path: out };
});

const ICON_DIRS = () => Array.from(new Set([path.join(getAppPath(), 'assets', 'icons'), path.join(__dirname, 'assets', 'icons')]));

// Reads every icon file (svg/png) so the UI can use user-supplied replacements without file:// mask restrictions.
handle('icons:getAll', async () => {
  const out = {};
  for (const dir of ICON_DIRS()) {
    let names;
    try { names = await fs.promises.readdir(dir); } catch { continue; }
    for (const f of names) {
      const m = f.match(/^([a-z0-9][a-z0-9-]*)\.(svg|png)$/i);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (out[name] && out[name].type === 'svg') continue;           // svg wins over png
      try {
        const full = path.join(dir, f);
        const st = await fs.promises.stat(full);
        if (st.size > 200 * 1024) continue;
        const buf = await fs.promises.readFile(full);
        out[name] = m[2].toLowerCase() === 'svg'
          ? { type: 'svg', data: buf.toString('utf8') }
          : { type: 'png', data: buf.toString('base64') };
      } catch {}
    }
  }
  return { ok: true, icons: out };
});

handle('icons:openFolder', async () => {
  const dir = ICON_DIRS().find((d) => fileExists(d)) || ICON_DIRS()[0];
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  await shell.openPath(dir);
  return { ok: true, dir };
});

// Expand a YouTube/other playlist URL into individual entries (flat, fast, no downloads).
handle('ytdlp:playlist', async (_e, url, cookies) => {
  const ytdlp = findYtDlp();
  if (!ytdlp) return { ok: false, error: 'yt-dlp not found next to the app' };
  const u = String(url || '').trim();
  if (!mediaUtils.isUrl(u)) return { ok: false, error: 'Not a URL' };
  const { args, env } = ytdlArgsFor(cookies);
  const a = args.filter((x) => x !== '--no-playlist');
  return new Promise((resolve) => {
    execFile(ytdlp, [...a, '--flat-playlist', '-J', '--', u], { timeout: 90000, windowsHide: true, env, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) { resolve({ ok: false, error: friendlyYtdlError(String(stderr || err.message)) }); return; }
        try {
          const j = JSON.parse(String(stdout));
          const entries = (j.entries || []).filter(Boolean).slice(0, 500).map((e) => ({
            title: e.title || e.id || '', duration: Number(e.duration) || 0,
            url: e.url && /^https?:/i.test(e.url) ? e.url : (e.webpage_url || (e.id ? 'https://www.youtube.com/watch?v=' + e.id : ''))
          })).filter((e) => e.url);
          resolve({ ok: entries.length > 0, title: j.title || '', entries, error: entries.length ? null : 'No videos found in this link' });
        } catch (e) { resolve({ ok: false, error: 'Could not read playlist: ' + e.message }); }
      });
  });
});

handle('shell:openExternal', async (_e, url) => {
  const u = String(url || '');
  if (!/^(https?:|mailto:|ms-settings:)/i.test(u)) return { ok: false, error: 'Blocked URL scheme' };
  await shell.openExternal(u);
  return { ok: true };
});

handle('mpv:setEmbedMode', async (_e, mode) => {
  const next = mode === 'child' ? 'child' : 'off';   // legacy 'wid'/'sync' modes covered the whole UI; retired
  embedMode = next;
  return { ok: true, mode: embedMode };
});

handle('mpv:setEmbedBounds', async (_e, b) => {
  if (b && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0) {
    lastEmbedRect = { x: Number(b.x) || 0, y: Number(b.y) || 0, width: Number(b.width), height: Number(b.height) };
    scheduleEmbedLayout();
  }
  return { ok: true, bounds: lastEmbedRect };
});

// Menus / dialogs are DOM and would sit *under* a native video window, so the renderer parks it while they are open.
handle('mpv:setEmbedSuspended', async (_e, flag) => {
  embedSuspended = !!flag;
  layoutEmbed();
  return { ok: true };
});

handle('mpv:getEmbedMode', async () => ({ mode: embedMode }));

/* -------------------------------------------------------------------------- */
/* Tray                                                                       */
/* -------------------------------------------------------------------------- */

function createTray() {
  try {
    let icon = nativeImage.createEmpty();
    for (const name of ['tray.png', 'zephyrplayer.png', 'zephyrplayer.ico', 'favicon.png']) {
      try {
        const candidate = nativeImage.createFromPath(path.join(getAppPath(), 'assets', 'icons', name));
        if (!candidate.isEmpty()) { icon = candidate.resize({ width: 16, height: 16 }); break; }
      } catch {}
    }

    if (icon.isEmpty()) {
      icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVQ4T2NkYGD4z0BUYPz/nyoMAF9oAgX9eZ6qAAAAAElFTkSuQmCC'
      );
    }

    tray = new Tray(icon);
    tray.setToolTip('ZephyrPlayer');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show ZephyrPlayer',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: 'Mini mode',
        click: () => safeSend('hotkey', 'mini')
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    log('Tray failed:', e.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Playlists                                                                  */
/* -------------------------------------------------------------------------- */

handle('playlist:saveM3u', async (_event, entries) => {
  const result = await showSave({
    title: 'Save playlist',
    defaultPath: 'playlist.m3u8',
    filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  await fs.promises.writeFile(result.filePath, '\uFEFF' + mediaUtils.buildM3u(entries), 'utf8');
  return { ok: true, path: result.filePath };
});

handle('playlist:loadM3u', async () => {
  const result = await showOpen({
    properties: ['openFile'],
    filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }, { name: 'All', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, entries: [] };
  const filePath = result.filePaths[0];
  const text = await fs.promises.readFile(filePath, 'utf8');
  return { ok: true, entries: mediaUtils.parseM3u(text, path.dirname(filePath)) };
});

/* -------------------------------------------------------------------------- */
/* Subtitles / Whisper                                                        */
/* -------------------------------------------------------------------------- */

handle('subtitles:detectWhisper', async () => {
  const whisper = findWhisper();
  return { ok: !!whisper, path: whisper || null };
});

handle('subtitles:saveSrt', async (_event, { content, defaultName } = {}) => {
  const result = await showSave({
    title: 'Save subtitles',
    defaultPath: defaultName || 'subtitles.srt',
    filters: [{ name: 'SubRip', extensions: ['srt'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false };

  try {
    fs.writeFileSync(result.filePath, content || '', 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function extractWavForWhisper(mediaPath, wavOutPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = findFfmpeg();
    if (!ffmpegPath) {
      reject(new Error('ffmpeg.exe not found'));
      return;
    }

    const args = ['-y', '-nostdin', '-i', mediaPath, '-ac', '1', '-ar', '16000', '-vn', wavOutPath];
    let stderr = '';
    let child;

    try {
      child = spawn(ffmpegPath, args, { windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }

    if (child.stderr) {
      child.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
    }

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 && fileExists(wavOutPath)) {
        resolve(wavOutPath);
      } else {
        reject(new Error('ffmpeg failed (code ' + code + '): ' + stderr.slice(-500)));
      }
    });
  });
}

function findWhisperModel(modelName) {
  const safe = /^[A-Za-z0-9._-]+$/.test(String(modelName || '')) ? String(modelName) : 'base';
  const file = 'ggml-' + safe + '.bin';
  const dirs = [...toolDirs('models'), getResourcePath('models'), ...toolDirs()];
  return { file, found: firstExisting([file], dirs), searched: dirs };
}

handle('subtitles:generateLocal', async (_event, { mediaPath, model } = {}) => {
  if (!mediaPath || !fileExists(mediaPath)) return { ok: false, error: 'Media file not found' };
  if (whisperProcess) return { ok: false, error: 'A transcription is already running' };

  const whisper = findWhisper();
  if (!whisper) return { ok: false, error: 'whisper-cli.exe not found (place it next to the app)' };

  const { file, found: modelPath } = findWhisperModel(model);
  if (!modelPath) {
    return { ok: false, error: `Whisper model "${file}" not found. Put it in the models folder next to the app.` };
  }
  log('Using Whisper model:', modelPath);

  const outDir = path.join(app.getPath('temp'), 'zephyr-whisper');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

  // unique per input so two files with the same name can never collide
  const tag = require('crypto').createHash('sha1').update(mediaPath).digest('hex').slice(0, 10);
  const base = path.join(outDir, tag);
  const wavPath = base + '.wav';
  const srtPath = base + '.srt';
  try { fs.unlinkSync(srtPath); } catch {}

  let whisperInput = mediaPath;
  try {
    whisperInput = await extractWavForWhisper(mediaPath, wavPath);
  } catch (e) {
    log('ffmpeg WAV extraction failed, falling back to raw media:', e.message);
  }

  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const args = ['-m', modelPath, '-f', whisperInput, '-osrt', '-of', base, '-t', String(threads), '-pp'];

  return new Promise((resolve) => {
    let tail = '';
    let child;
    try {
      child = spawn(whisper, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    whisperProcess = child;
    let cancelled = false;
    child.cancel = () => { cancelled = true; try { child.kill(); } catch {} };

    const onData = (data) => {
      const text = data.toString();
      tail = (tail + text).slice(-3000);
      const m = text.match(/progress\s*=\s*(\d{1,3})%/g);
      if (m) {
        const last = parseInt(m[m.length - 1].replace(/\D/g, ''), 10);
        if (Number.isFinite(last)) safeSend('subtitles-progress', { percent: Math.min(100, last) });
      }
    };
    if (child.stderr) child.stderr.on('data', onData);
    if (child.stdout) child.stdout.on('data', onData);

    const cleanup = () => {
      whisperProcess = null;
      if (whisperInput === wavPath) { try { fs.unlinkSync(wavPath); } catch {} }
    };

    child.once('error', (error) => { cleanup(); resolve({ ok: false, error: error.message }); });
    child.once('close', (code) => {
      cleanup();
      if (cancelled) { resolve({ ok: false, cancelled: true, error: 'Cancelled' }); return; }
      if (fileExists(srtPath)) {
        try {
          const content = fs.readFileSync(srtPath, 'utf8');
          resolve({ ok: true, srtPath, content, code });
          return;
        } catch (e) {
          resolve({ ok: false, error: e.message });
          return;
        }
      }
      resolve({ ok: false, error: 'Whisper finished but produced no subtitles (exit ' + code + '). ' + tail.slice(-400) });
    });
  });
});

handle('subtitles:cancel', async () => {
  if (whisperProcess && whisperProcess.cancel) { whisperProcess.cancel(); return { ok: true }; }
  return { ok: false, error: 'Nothing to cancel' };
});

/* -------------------------------------------------------------------------- */
/* History / Progress                                                         */
/* -------------------------------------------------------------------------- */

handle('history:clear', async () => ({ ok: true }));

handle('history:recordOpened', async (_event, filePath) => {
  if (typeof filePath === 'string' && !mediaUtils.isUrl(filePath)) recordRecentFile(filePath);
  return { ok: true };
});

handle('player:reportProgress', async (_event, fraction) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const f = (typeof fraction === 'number' && fraction >= 0 && fraction <= 1) ? fraction : -1;
      mainWindow.setProgressBar(f);
    }
  } catch {}
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* Recording / Convert                                                        */
/* -------------------------------------------------------------------------- */

handle('media:startRecording', async (_event, { url } = {}) => {
  if (recordingProcess) return { ok: false, error: 'Already recording' };
  if (!url) return { ok: false, error: 'Nothing streaming to record' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found' };
  }

  const result = await showSave({
    title: 'Record stream to file',
    defaultPath: 'ZephyrPlayer-recording-' + Date.now() + '.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, error: 'Canceled' };

  let source = String(url);
  const ytdlp = findYtDlp();
  if (ytdlp && /youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com/i.test(source)) {
    try {
      const out = await new Promise((resolve, reject) => {
        execFile(ytdlp, ['-g', '-f', 'best[ext=mp4]/best', '--no-playlist', source],
          { timeout: 45000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
      });
      const direct = out.split(/\r?\n/).find(Boolean);
      if (direct) source = direct;
    } catch (e) {
      return { ok: false, error: 'Could not resolve stream: ' + e.message };
    }
  }

  const args = ['-y', '-nostdin'];
  if (/^https?:/i.test(source)) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  args.push('-i', source, '-c', 'copy', result.filePath);

  try {
    recordingProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  recordingOutputPath = result.filePath;

  recordingProcess.once('exit', () => {
    recordingProcess = null;
    safeSend('recording-status', { recording: false, path: recordingOutputPath });
  });

  recordingProcess.once('error', (err) => {
    recordingProcess = null;
    safeSend('recording-status', { recording: false, error: err.message });
  });

  safeSend('recording-status', { recording: true, path: result.filePath });
  return { ok: true, path: result.filePath };
});

handle('media:stopRecording', async () => {
  if (!recordingProcess) return { ok: false, error: 'Not recording' };

  try {
    recordingProcess.stdin.write('q');
  } catch {
    try { recordingProcess.kill(); } catch {}
  }
  return { ok: true, path: recordingOutputPath };
});

handle('media:convertToMp4', async (_event, inputPath) => {
  if (!inputPath || !fileExists(inputPath)) return { ok: false, error: 'File not found' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found' };
  }

  const result = await showSave({
    title: 'Convert to MP4',
    defaultPath: path.basename(inputPath, path.extname(inputPath)) + '.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, error: 'Canceled' };

  return new Promise((resolve) => {
    const args = [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac',
      result.filePath
    ];

    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.once('close', (code) => {
      if (code === 0 && fileExists(result.filePath)) {
        resolve({ ok: true, path: result.filePath });
      } else {
        resolve({ ok: false, error: 'ffmpeg exited with code ' + code + ': ' + stderr.slice(-400) });
      }
    });

    child.once('error', (e) => resolve({ ok: false, error: e.message }));
  });
});

handle('media:extractAudio', async (_event, inputPath) => {
  if (!inputPath || !fileExists(inputPath)) return { ok: false, error: 'File not found' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found' };
  }

  const result = await showSave({
    title: 'Extract audio to MP3',
    defaultPath: path.basename(inputPath, path.extname(inputPath)) + '.mp3',
    filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, error: 'Canceled' };

  return new Promise((resolve) => {
    const args = ['-y', '-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', result.filePath];

    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.once('close', (code) => {
      if (code === 0 && fileExists(result.filePath)) {
        resolve({ ok: true, path: result.filePath });
      } else {
        resolve({ ok: false, error: 'ffmpeg exited with code ' + code + ': ' + stderr.slice(-400) });
      }
    });

    child.once('error', (e) => resolve({ ok: false, error: e.message }));
  });
});

/* -------------------------------------------------------------------------- */
/* Library scan                                                               */
/* -------------------------------------------------------------------------- */

handle('library:scanFolder', async () => {
  const result = await showOpen({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return { ok: false, files: [] };
  const root = result.filePaths[0];
  const { media } = await mediaUtils.expandPaths([root], { maxFiles: 5000, maxDepth: 8 });
  const files = media.map((m) => ({ path: m.path, name: m.name, size: m.size, root }));
  files.sort((a, b) => mediaUtils.naturalCompare(a.name, b.name));
  return { ok: true, files, root };
});

/* -------------------------------------------------------------------------- */
/* File associations                                                          */
/* -------------------------------------------------------------------------- */

function getAssociationExecutable() {
  return process.execPath;
}

handle('assoc:exportReg', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows only' };
  }

  const exe = getAssociationExecutable().replace(/\\/g, '\\\\');
  const isPackaged = app.isPackaged;

  const types = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v', 'ts', 'mp3', 'flac', 'wav'];

  let command;
  if (isPackaged) {
    command = `"${exe}" "%1"`;
  } else {
    const appDir = __dirname.replace(/\\/g, '\\\\');
    command = `"${exe}" "${appDir}" "%1"`;
  }

  command = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  let reg = 'Windows Registry Editor Version 5.00\r\n\r\n';
  reg += '[HKEY_CURRENT_USER\\Software\\Classes\\ZephyrPlayer.File]\r\n';
  reg += '@="ZephyrPlayer media"\r\n';
  reg += '"FriendlyTypeName"="ZephyrPlayer media"\r\n\r\n';
  reg += '[HKEY_CURRENT_USER\\Software\\Classes\\ZephyrPlayer.File\\shell\\open\\command]\r\n';
  reg += '@="' + command + '"\r\n\r\n';

  for (const ext of types) {
    reg += '[HKEY_CURRENT_USER\\Software\\Classes\\.' + ext + '\\OpenWithProgids]\r\n';
    reg += '"ZephyrPlayer.File"=""\r\n\r\n';
  }

  const result = await showSave({
    title: 'Save file association registry',
    defaultPath: 'ZephyrPlayer-associations.reg',
    filters: [{ name: 'Registry', extensions: ['reg'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false };

  try {
    fs.writeFileSync(result.filePath, reg, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

handle('shell:openDefaults', async () => {
  try {
    await shell.openExternal('ms-settings:defaultapps');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

handle('app:getInfo', async () => ({
  version: app.getVersion(),
  name: app.getName(),
  supportEmail: 'bravocompanycyber@gmail.com',
  license: 'LICENSE.txt',
  localOnly: true
}));

/* -------------------------------------------------------------------------- */
/* App lifecycle                                                              */
/* -------------------------------------------------------------------------- */

app.whenReady().then(() => {
  log('ZephyrPlayer starting... isPackaged:', app.isPackaged);
  pruneOldLogs();

  loadRecentFiles();
  updateJumpList();
  registerMediaKeys();

  createWindow();
  createMenu();
  createTray();

  setTimeout(setupAutoUpdate, 4000);
  setTimeout(maybeAutoUpdateYtDlp, 20000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && mainWindow.isMinimized()) {
      mainWindow.restore();
    }
  });
});

app.on('window-all-closed', () => {
  try { if (session) session.killNow(); } catch {}
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch {}

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  try { if (session) session.killNow(); } catch {}
  try { if (whisperProcess) whisperProcess.kill(); } catch {}

  try {
    if (recordingProcess) {
      recordingProcess.stdin.write('q');
    }
  } catch {}

  try {
    globalShortcut.unregisterAll();
  } catch {}

  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch {}

  try {
    mpv.quit();
  } catch {}
});