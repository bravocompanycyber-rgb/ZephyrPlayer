const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  ipcMain,
  Tray,
  nativeImage,
  globalShortcut
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

  // Also print to console in development
  if (!app.isPackaged) {
    console.log(...args);
  }
}

// Catch uncaught errors
process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED REJECTION:', reason);
});

/* -------------------------------------------------------------------------- */
/* App State                                                                  */
/* -------------------------------------------------------------------------- */

let mainWindow = null;
let alwaysOnTop = false;
let mpvEmbedProcess = null;
let recordingProcess = null;
let recordingOutputPath = null;
let tray = null;
let isMini = false;

let embedMode = 'sync'; // sync | wid | off
let lastEmbedBounds = null;

// IPC connection to the "synced" borderless mpv window
let syncIpcPath = null;
let syncMpvSocket = null;

function sendSyncMpvOntop(onTop) {
  if (!syncMpvSocket || syncMpvSocket.destroyed) return;
  try {
    syncMpvSocket.write(JSON.stringify({
      command: ['set_property', 'ontop', !!onTop]
    }) + '\n');
  } catch {}
}

function connectSyncMpvIpc(pipePath, attempt = 0) {
  if (!pipePath) return;
  const socket = net.connect(pipePath, () => {
    syncMpvSocket = socket;
  });
  socket.on('error', () => {
    if (attempt < 5) {
      setTimeout(() => connectSyncMpvIpc(pipePath, attempt + 1), 300);
    }
  });
  socket.on('close', () => {
    if (syncMpvSocket === socket) syncMpvSocket = null;
  });
}

/*
 * Keep all playback state in one place.
 */
let lastPlay = {
  inputs: null,
  quality: 'high',
  embed: true,
  extraArgs: []
};

/* -------------------------------------------------------------------------- */
/* Helper: correct base path (works in both dev + packaged)                   */
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
/* Single instance / open-with-file / recent files (jump list)               */
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

function updateJumpList() {
  if (process.platform !== 'win32') return;
  try {
    app.setJumpList([
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
  } catch (e) {
    // Common on some Windows privacy settings – not critical
    log('setJumpList failed (privacy settings?):', e.message);
  }
}

function recordRecentFile(filePath) {
  if (!filePath || !fileExists(filePath)) return;
  recentFiles = [filePath, ...recentFiles.filter((f) => f !== filePath)].slice(0, 10);
  saveRecentFiles();
  updateJumpList();
}

function extractFilePathFromArgv(argv) {
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i];
    try {
      if (a && !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile()) {
        return a;
      }
    } catch {}
  }
  return null;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const filePath = extractFilePathFromArgv(argv);
    if (filePath) {
      safeSend('open-files', [filePath]);
      recordRecentFile(filePath);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* System media keys                                                         */
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

/* -------------------------------------------------------------------------- */
/* Taskbar thumbnail toolbar buttons                                         */
/* -------------------------------------------------------------------------- */

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
/* Find executables (packaging-aware)                                         */
/* -------------------------------------------------------------------------- */

function findMpv() {
  try {
    return mpv.findMpv();
  } catch (e) {
    log('findMpv failed:', e.message);
    return null;
  }
}

function findYtDlp() {
  const base = getAppPath();
  const candidates = [
    path.join(base, 'yt-dlp.exe'),
    path.join(base, 'yt-dlp'),
    path.join(process.resourcesPath || base, 'yt-dlp.exe'),
    path.join(process.resourcesPath || base, 'yt-dlp'),
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'yt-dlp')
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }

  try {
    if (process.platform === 'win32') {
      execSync('where yt-dlp', { stdio: 'ignore', windowsHide: true });
    } else {
      execSync('which yt-dlp', { stdio: 'ignore' });
    }
    return 'yt-dlp';
  } catch {}

  try {
    if (process.platform === 'win32') {
      execSync('where youtube-dl', { stdio: 'ignore', windowsHide: true });
      return 'youtube-dl';
    }
    execSync('which youtube-dl', { stdio: 'ignore' });
    return 'youtube-dl';
  } catch {}

  return null;
}

function findWhisper() {
  const base = getAppPath();
  const candidates = [
    path.join(base, 'whisper-cli.exe'),
    path.join(base, 'whisper.exe'),
    path.join(process.resourcesPath || base, 'whisper-cli.exe'),
    path.join(process.resourcesPath || base, 'whisper.exe'),
    path.join(__dirname, 'whisper-cli.exe'),
    path.join(__dirname, 'whisper.exe'),
    'whisper-cli',
    'whisper'
  ];

  for (const candidate of candidates) {
    try {
      if (isAbsoluteExecutable(candidate)) {
        if (fileExists(candidate)) return candidate;
      } else {
        const command = process.platform === 'win32' ? `where ${candidate}` : `which ${candidate}`;
        execSync(command, { stdio: 'ignore', windowsHide: true });
        return candidate;
      }
    } catch {}
  }
  return null;
}

function findFfmpeg() {
  const base = getAppPath();
  const candidates = [
    path.join(base, 'ffmpeg', 'ffmpeg.exe'),
    path.join(base, 'ffmpeg.exe'),
    path.join(process.resourcesPath || base, 'ffmpeg', 'ffmpeg.exe'),
    path.join(process.resourcesPath || base, 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg.exe'),
    'ffmpeg'
  ];

  for (const candidate of candidates) {
    try {
      if (isAbsoluteExecutable(candidate)) {
        if (fileExists(candidate)) return candidate;
      } else {
        const command = process.platform === 'win32' ? `where ${candidate}` : `which ${candidate}`;
        execSync(command, { stdio: 'ignore', windowsHide: true });
        return candidate;
      }
    } catch {}
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* mpv quality                                                                */
/* -------------------------------------------------------------------------- */

function qualityArgs(quality) {
  const q = quality || 'high';

  const args = [
    '--hwdec=auto-safe',
    '--vo=gpu',
    '--gpu-api=d3d11',
    '--gpu-context=d3d11',
    '--keep-open=yes',
    '--force-window=yes'
  ];

  if (q === 'high' || q === 'sharpen' || q === 'anime' || q === 'anime4k') {
    args.push(
      '--scale=ewa_lanczossharp',
      '--cscale=ewa_lanczossharp',
      '--dscale=mitchell',
      '--sharpen=0.45'
    );
  }

  if (q === 'sharpen') {
    args.push('--sharpen=0.85');
  }

  if (q === 'anime' || q === 'anime4k' || q === 'high') {
    args.push(
      '--deband=yes',
      '--deband-iterations=2',
      '--deband-threshold=64'
    );
  }

  if (q === 'anime4k') {
    const shaderDir = path.join(getAppPath(), 'shaders');

    const candidates = [
      'Anime4K_Clamp_Highlights.glsl',
      'Anime4K_Restore_CNN_M.glsl',
      'Anime4K_Upscale_CNN_x2_M.glsl',
      'Anime4K_AutoDownscalePre_x2.glsl',
      'Anime4K_AutoDownscalePre_x4.glsl',
      'Anime4K_Upscale_CNN_x2_S.glsl'
    ];

    const found = [];

    try {
      if (fileExists(shaderDir)) {
        for (const name of candidates) {
          const shaderPath = path.join(shaderDir, name);
          if (fileExists(shaderPath)) {
            found.push(shaderPath.replace(/\\/g, '/'));
          }
        }

        if (!found.length) {
          for (const name of fs.readdirSync(shaderDir)) {
            if (name.toLowerCase().endsWith('.glsl')) {
              found.push(path.join(shaderDir, name).replace(/\\/g, '/'));
            }
          }
        }
      }
    } catch (e) {
      log('Shader scan failed:', e.message);
    }

    if (found.length) {
      args.push('--glsl-shaders=' + found.join(';'));
    } else {
      args.push(
        '--scale=ewa_lanczossharp',
        '--cscale=ewa_lanczossharp',
        '--sharpen=0.6'
      );
    }
  }

  if (q === 'hdr') {
    args.push(
      '--tone-mapping=mobius',
      '--hdr-compute-peak=yes',
      '--target-trc=srgb',
      '--target-prim=bt.709',
      '--tone-mapping-mode=auto'
    );
  }

  if (q === 'fast') {
    args.push(
      '--scale=bilinear',
      '--cscale=bilinear',
      '--profile=fast'
    );
  }

  return args;
}

/* -------------------------------------------------------------------------- */
/* Embed process management                                                   */
/* -------------------------------------------------------------------------- */

function stopEmbedMpv() {
  if (!mpvEmbedProcess) return;

  const processToKill = mpvEmbedProcess;
  mpvEmbedProcess = null;

  try {
    if (!processToKill.killed) {
      processToKill.kill();
    }
  } catch (e) {
    log('Failed to stop mpv:', e.message);
  }
}

function normalizeInputs(inputs) {
  if (Array.isArray(inputs)) return inputs.filter(Boolean);
  if (inputs == null) return [];
  return [inputs];
}

function getCurrentEmbedGeometry() {
  if (lastEmbedBounds && lastEmbedBounds.width > 0 && lastEmbedBounds.height > 0) {
    return {
      x: Math.round(lastEmbedBounds.x),
      y: Math.round(lastEmbedBounds.y),
      width: Math.max(160, Math.round(lastEmbedBounds.width)),
      height: Math.max(90, Math.round(lastEmbedBounds.height))
    };
  }

  if (!mainWindow || mainWindow.isDestroyed()) return null;

  try {
    const cb = mainWindow.getContentBounds();
    const sidebar = 300;
    const top = 52;
    const controls = 90;

    return {
      x: Math.round(cb.x + sidebar),
      y: Math.round(cb.y + top),
      width: Math.max(160, Math.round(cb.width - sidebar)),
      height: Math.max(90, Math.round(cb.height - top - controls))
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Playback                                                                   */
/* -------------------------------------------------------------------------- */

function playWithMpvEmbedded(filesOrUrl, quality = 'high', preferEmbed = true, extraArgs = [], updateLastPlay = true) {
  const inputs = normalizeInputs(filesOrUrl);

  if (!inputs.length) {
    return { ok: false, error: 'No media input' };
  }

  const mpvPath = findMpv();
  if (!mpvPath) {
    log('mpv not found');
    return { ok: false, error: 'mpv not found' };
  }

  stopEmbedMpv();

  const mode = preferEmbed === false ? 'off' : (embedMode || 'sync');
  const args = qualityArgs(quality);

  const ytdlp = findYtDlp();
  if (ytdlp) {
    args.push('--script-opts=ytdl_hook-ytdl_path=' + ytdlp);
  }

  let embedded = false;

  // True HWND embedding
  if (mode === 'wid' && process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      const handle = mainWindow.getNativeWindowHandle();
      let hwnd;
      if (handle.length >= 8) {
        hwnd = handle.readBigUInt64LE(0);
      } else {
        hwnd = BigInt(handle.readUInt32LE(0));
      }

      args.push('--wid=' + hwnd.toString(), '--no-border', '--no-osc', '--osd-level=1');
      embedded = true;
    } catch (e) {
      log('HWND embed failed:', e.message);
    }
  }

  // Synchronized borderless window
  if (mode === 'sync') {
    const geometry = getCurrentEmbedGeometry();
    if (geometry) {
      syncIpcPath = process.platform === 'win32'
        ? `\\\\.\\pipe\\zephyr-sync-${Date.now().toString(36)}`
        : `/tmp/zephyr-sync-${Date.now().toString(36)}.sock`;

      args.push(
        '--no-border',
        '--ontop',
        `--input-ipc-server=${syncIpcPath}`,
        '--title=ZephyrPlayer-Video',
        `--geometry=${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`,
        `--autofit=${geometry.width}x${geometry.height}`
      );
      embedded = true;
    }
  }

  // Separate mpv window
  if (mode === 'off') {
    args.push('--force-window=yes');
  }

  if (Array.isArray(extraArgs) && extraArgs.length) {
    args.push(...extraArgs);
  }

  args.push(...inputs);

  try {
    const child = spawn(mpvPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: false,
      detached: false
    });

    mpvEmbedProcess = child;

    if (mode === 'sync' && syncIpcPath) {
      const pipeForThisProcess = syncIpcPath;
      setTimeout(() => {
        if (mpvEmbedProcess === child) {
          connectSyncMpvIpc(pipeForThisProcess);
        }
      }, 400);
    }

    let mpvStderr = '';
    if (child.stderr) {
      child.stderr.on('data', (d) => {
        mpvStderr += d.toString();
        if (mpvStderr.length > 8000) mpvStderr = mpvStderr.slice(-8000);
      });
    }

    child.once('exit', (code) => {
      if (mpvEmbedProcess === child) mpvEmbedProcess = null;

      if (syncMpvSocket) {
        try { syncMpvSocket.destroy(); } catch {}
        syncMpvSocket = null;
      }

      if (code !== 0 && code !== null) {
        log('mpv exited with code', code, mpvStderr.slice(-2000));
        safeSend('mpv-process-error', {
          error: mpvStderr.slice(-500) || ('mpv exited unexpectedly with code ' + code + ' (no output captured — likely a missing DLL/driver crash)')
        });
      }
    });

    child.once('error', (err) => {
      log('mpv process error:', err);
      if (mpvEmbedProcess === child) mpvEmbedProcess = null;
      safeSend('mpv-process-error', { error: err.message });
    });

    if (updateLastPlay) {
      lastPlay = {
        inputs: Array.isArray(filesOrUrl) ? [...filesOrUrl] : filesOrUrl,
        quality: quality || 'high',
        embed: preferEmbed !== false,
        extraArgs: Array.isArray(extraArgs) ? [...extraArgs] : []
      };
    }

    return { ok: true, embedded, mode, pid: child.pid };
  } catch (e) {
    log('Failed to spawn mpv:', e.message);
    return { ok: false, error: e.message };
  }
}

function playWithMpvEmbeddedTracked(filesOrUrl, quality, preferEmbed, extraArgs = []) {
  return playWithMpvEmbedded(filesOrUrl, quality, preferEmbed, extraArgs, true);
}

function replayWithExtraArgs(newArgs, removePatterns = []) {
  if (!lastPlay.inputs) {
    return { ok: false, error: 'Nothing playing' };
  }

  let previous = Array.isArray(lastPlay.extraArgs) ? [...lastPlay.extraArgs] : [];

  if (removePatterns.length) {
    previous = previous.filter(arg => {
      return !removePatterns.some(pattern => pattern.test(arg));
    });
  }

  const merged = [...previous, ...(Array.isArray(newArgs) ? newArgs : [])];

  return playWithMpvEmbeddedTracked(
    lastPlay.inputs,
    lastPlay.quality,
    lastPlay.embed,
    merged
  );
}

/* -------------------------------------------------------------------------- */
/* Window                                                                     */
/* -------------------------------------------------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
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
      sandbox: false,
      webSecurity: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('focus', () => sendSyncMpvOntop(true));
  mainWindow.on('blur', () => sendSyncMpvOntop(false));

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.show();
    setupThumbar();

    const mpvPath = findMpv();
    const ytdlpPath = findYtDlp();

    log('App ready. mpv:', mpvPath || 'NOT FOUND', '| yt-dlp:', ytdlpPath || 'NOT FOUND');

    safeSend('mpv-status', {
      available: !!mpvPath,
      path: mpvPath,
      ytdlp: !!ytdlpPath
    });

    const initialFile = extractFilePathFromArgv(process.argv);
    if (initialFile) {
      safeSend('open-files', [initialFile]);
      recordRecentFile(initialFile);
    }
  });

  mainWindow.on('close', () => {
    app.isQuitting = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopEmbedMpv();
    try { mpv.quit(); } catch {}
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(url); } catch {}
    return { action: 'deny' };
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
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [
                {
                  name: 'Media',
                  extensions: [
                    'mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'wmv', 'flv',
                    'ts', 'm2ts', 'mpg', 'mpeg', 'mp3', 'flac', 'wav', 'ogg',
                    'aac', 'm4a', 'opus', 'wma'
                  ]
                },
                { name: 'All Files', extensions: ['*'] }
              ]
            });
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
              title: 'ZephyrPlayer 2.5',
              message: 'ZephyrPlayer 2.5.0',
              detail:
                'mpv: ' + (mpvPath || 'not found') + '\n' +
                'yt-dlp: ' + (ytdlpPath || 'not found (needed for YouTube)') + '\n\n' +
                'Place mpv.exe and optionally yt-dlp.exe next to the app for full power.'
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
                message: 'Auto-update isn\'t set up.',
                detail: 'Run "npm install electron-updater" and configure "publish" in package.json to enable this.'
              });
              return;
            }
            if (!app.isPackaged) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Updates',
                message: 'Update checks only run in packaged (installed/portable) builds, not in development.'
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
/* IPC - dialogs                                                              */
/* -------------------------------------------------------------------------- */

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media',
        extensions: [
          'mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'wmv', 'flv',
          'ts', 'm2ts', 'mpg', 'mpeg', 'mp3', 'flac', 'wav', 'ogg',
          'aac', 'm4a', 'opus', 'wma'
        ]
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths.length) return [];

  const dir = result.filePaths[0];
  const mediaExt = new Set([
    '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.wmv', '.flv',
    '.ts', '.m2ts', '.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a',
    '.opus', '.wma'
  ]);

  const files = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isFile() && mediaExt.has(path.extname(name).toLowerCase())) {
          files.push(full);
        }
      } catch {}
    }
  } catch (e) {
    log('Folder scan failed:', e.message);
  }

  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
});

/* -------------------------------------------------------------------------- */
/* IPC - window                                                               */
/* -------------------------------------------------------------------------- */

ipcMain.handle('window:setAlwaysOnTop', () => {
  alwaysOnTop = !alwaysOnTop;
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
  return alwaysOnTop;
});

ipcMain.handle('window:setMini', async (_event, mini) => {
  isMini = !!mini;
  if (!mainWindow) return { ok: false, mini: isMini };

  if (isMini) {
    mainWindow.setMinimumSize(400, 280);
    mainWindow.setSize(480, 320, true);
  } else {
    mainWindow.setMinimumSize(900, 580);
    mainWindow.setSize(1320, 820, true);
  }
  return { ok: true, mini: isMini };
});

ipcMain.handle('window:hideToTray', async () => {
  if (mainWindow) mainWindow.hide();
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* IPC - mpv availability                                                     */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:available', () => {
  const mpvPath = findMpv();
  const ytdlpPath = findYtDlp();
  return {
    available: !!mpvPath,
    path: mpvPath,
    ytdlp: !!ytdlpPath
  };
});

/* -------------------------------------------------------------------------- */
/* IPC - playback                                                             */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:playExternal', async (_event, opts) => {
  const options = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const files = options.files != null ? options.files : opts;
  const quality = options.quality || 'high';
  const embed = options.embed !== false;
  const extra = [];

  if (options.vo) {
    if (options.vo === 'direct3d') {
      extra.push('--vo=gpu', '--gpu-api=d3d11');
    } else if (options.vo === 'gpu-next') {
      extra.push('--vo=gpu-next', '--gpu-api=d3d11');
    } else if (options.vo !== 'gpu') {
      extra.push('--vo=' + options.vo);
    }
  }

  if (options.hwdec) extra.push('--hwdec=' + options.hwdec);
  if (options.perf === 'low') {
    extra.push('--profile=fast', '--scale=bilinear', '--vd-lavc-threads=2');
  }

  return playWithMpvEmbedded(files, quality, embed, extra);
});

ipcMain.handle('mpv:playUrl', async (_event, { url, quality, embed } = {}) => {
  if (!url || !String(url).trim()) {
    return { ok: false, error: 'empty url' };
  }

  const u = String(url).trim();
  const needsYtdlp = /youtube\.com|youtu\.be|vimeo\.com|twitch\.tv/i.test(u);

  if (needsYtdlp && !findYtDlp()) {
    return {
      ok: false,
      error: 'yt-dlp required for YouTube. Download yt-dlp.exe and place it next to ZephyrPlayer.\nhttps://github.com/yt-dlp/yt-dlp/releases'
    };
  }

  return playWithMpvEmbedded(u, quality || 'high', embed !== false);
});

ipcMain.handle('mpv:stop', async () => {
  stopEmbedMpv();
  try { await mpv.quit(); } catch {}
  lastPlay = { inputs: null, quality: 'high', embed: true, extraArgs: [] };
  return { ok: true };
});

ipcMain.handle('mpv:setQuality', async (_event, quality) => {
  if (!lastPlay.inputs) return { ok: false, error: 'Nothing playing' };
  lastPlay.quality = quality || lastPlay.quality || 'high';
  return playWithMpvEmbeddedTracked(lastPlay.inputs, lastPlay.quality, lastPlay.embed, lastPlay.extraArgs);
});

/* -------------------------------------------------------------------------- */
/* IPC - video adjustments                                                    */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:applyVideoAdj', async (_event, adj) => {
  const extra = [];
  if (adj) {
    if (adj.brightness != null) extra.push('--brightness=' + Number(adj.brightness));
    if (adj.contrast != null) extra.push('--contrast=' + Number(adj.contrast));
    if (adj.saturation != null) extra.push('--saturation=' + Number(adj.saturation));
    if (adj.gamma != null) extra.push('--gamma=' + Number(adj.gamma));
    if (adj.hue != null) extra.push('--hue=' + Number(adj.hue));
  }
  return replayWithExtraArgs(extra, [
    /^--brightness=/, /^--contrast=/, /^--saturation=/, /^--gamma=/, /^--hue=/
  ]);
});

/* -------------------------------------------------------------------------- */
/* IPC - equalizer                                                            */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:applyEq', async (_event, eq) => {
  const extra = [];
  if (eq) {
    const filters = [];
    if (eq.normalize) filters.push('loudnorm');

    const bass = Number(eq.bass || 0);
    const mid = Number(eq.mid || 0);
    const treble = Number(eq.treble || 0);

    if (bass || mid || treble) {
      filters.push(`equalizer=f=100:width_type=o:width=2:g=${bass}`);
      filters.push(`equalizer=f=1000:width_type=o:width=2:g=${mid}`);
      filters.push(`equalizer=f=8000:width_type=o:width=2:g=${treble}`);
    }

    if (eq.gain != null) {
      const gain = Number(eq.gain);
      if (gain !== 0) filters.push(`volume=${gain}dB`);
    }

    if (filters.length) extra.push('--af=' + filters.join(','));
  }
  return replayWithExtraArgs(extra, [/^--af=/]);
});

/* -------------------------------------------------------------------------- */
/* IPC - frame step                                                           */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:frameStep', async (_event, dir) => {
  try {
    if (mpv.isReady()) {
      if (Number(dir) < 0) {
        await mpv.command('frame-back-step');
      } else {
        await mpv.command('frame-step');
      }
      return { ok: true };
    }
  } catch (e) {
    log('Frame step failed:', e.message);
  }
  return { ok: false, error: 'Frame step needs active mpv IPC session' };
});

/* -------------------------------------------------------------------------- */
/* IPC - media info                                                           */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:getMediaInfo', async () => {
  return {
    ok: true,
    info: {
      source: lastPlay.inputs,
      quality: lastPlay.quality,
      mpv: findMpv(),
      ytdlp: findYtDlp(),
      embedMode,
      embed: lastPlay.embed,
      extraArgs: [...(lastPlay.extraArgs || [])]
    }
  };
});

/* -------------------------------------------------------------------------- */
/* IPC - tracks                                                               */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:setTracks', async (_event, opts) => {
  const extra = [];
  if (opts) {
    if (opts.aid != null && opts.aid !== '') extra.push('--aid=' + opts.aid);
    if (opts.sid != null && opts.sid !== '') {
      if (opts.sid === 'no' || opts.sid === false) {
        extra.push('--sid=no');
      } else {
        extra.push('--sid=' + opts.sid);
      }
    }
    if (opts.subDelay != null) extra.push('--sub-delay=' + Number(opts.subDelay));
    if (opts.subScale != null) extra.push('--sub-scale=' + Number(opts.subScale));
  }
  return replayWithExtraArgs(extra, [
    /^--aid=/, /^--sid=/, /^--sub-delay=/, /^--sub-scale=/
  ]);
});

/* -------------------------------------------------------------------------- */
/* IPC - geometry                                                             */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:applyGeometry', async (_event, geo) => {
  const extra = [];
  if (geo) {
    if (geo.aspect && geo.aspect !== 'native') {
      extra.push('--video-aspect-override=' + geo.aspect);
    } else if (geo.aspect === 'native') {
      extra.push('--video-aspect-override=-1');
    }
    if (geo.rotate != null) extra.push('--video-rotate=' + Number(geo.rotate));

    const vfs = [];
    if (geo.flipH) vfs.push('hflip');
    if (geo.flipV) vfs.push('vflip');
    if (vfs.length) extra.push('--vf=' + vfs.join(','));

    if (geo.panscan != null) extra.push('--panscan=' + (Number(geo.panscan) / 100));

    if (geo.hdr && geo.hdr !== 'auto') {
      if (geo.hdr === 'no') {
        extra.push('--tone-mapping=no');
      } else {
        extra.push('--tone-mapping=' + geo.hdr);
      }
      extra.push('--hdr-compute-peak=yes');
    }
  }
  return replayWithExtraArgs(extra, [
    /^--video-aspect-override=/, /^--video-rotate=/, /^--vf=/,
    /^--panscan=/, /^--tone-mapping=/, /^--hdr-compute-peak=/
  ]);
});

/* -------------------------------------------------------------------------- */
/* IPC - audio devices                                                        */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:listAudioDevices', async () => {
  const mpvPath = findMpv();
  if (!mpvPath) {
    return { ok: false, devices: [{ id: 'auto', name: 'Auto' }] };
  }

  return new Promise(resolve => {
    try {
      execFile(mpvPath, ['--audio-device=help'], {
        timeout: 8000,
        windowsHide: true
      }, (err, stdout, stderr) => {
        const text = (stdout || '') + (stderr || '');
        const devices = [{ id: 'auto', name: 'Auto' }];

        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let match = trimmed.match(/^(\S+)\s+(.+)$/);
          if (!match) continue;

          const id = match[1].trim();
          const name = match[2].trim();

          if (!id || id === 'help' || id === 'Audio' || id.includes('---') || id === 'end') continue;

          devices.push({ id, name: name || id });
        }

        if (devices.length === 1) {
          devices.push({ id: 'wasapi', name: 'WASAPI (default)' });
        }

        resolve({ ok: !err, devices });
      });
    } catch (e) {
      resolve({ ok: false, devices: [{ id: 'auto', name: 'Auto' }] });
    }
  });
});

ipcMain.handle('mpv:setAudioDevice', async (_event, deviceId) => {
  const extra = [];
  if (deviceId && deviceId !== 'auto') {
    extra.push('--audio-device=' + deviceId);
  }
  return replayWithExtraArgs(extra, [/^--audio-device=/]);
});

/* -------------------------------------------------------------------------- */
/* IPC - shell                                                                */
/* -------------------------------------------------------------------------- */

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (!url) return { ok: false };
  try {
    await shell.openExternal(String(url));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* -------------------------------------------------------------------------- */
/* IPC - embedding                                                            */
/* -------------------------------------------------------------------------- */

ipcMain.handle('mpv:setEmbedMode', async (_event, mode) => {
  const allowed = new Set(['sync', 'wid', 'off']);
  embedMode = allowed.has(mode) ? mode : 'sync';
  return { ok: true, mode: embedMode };
});

ipcMain.handle('mpv:setEmbedBounds', async (_event, bounds) => {
  if (!bounds || !bounds.width || !bounds.height) {
    return { ok: true, bounds: lastEmbedBounds };
  }

  let x = Number(bounds.x || 0);
  let y = Number(bounds.y || 0);
  const width = Math.max(160, Math.round(Number(bounds.width)));
  const height = Math.max(90, Math.round(Number(bounds.height)));

  if (bounds.relative && mainWindow && !mainWindow.isDestroyed()) {
    try {
      const cb = mainWindow.getContentBounds();
      x += cb.x;
      y += cb.y;
    } catch {}
  }

  lastEmbedBounds = { x: Math.round(x), y: Math.round(y), width, height };
  return { ok: true, bounds: lastEmbedBounds };
});

ipcMain.handle('mpv:getEmbedMode', async () => ({ mode: embedMode }));

/* -------------------------------------------------------------------------- */
/* Tray                                                                       */
/* -------------------------------------------------------------------------- */

function createTray() {
  try {
    let icon;
    const iconPath = path.join(getAppPath(), 'assets', 'icons', 'favicon.svg');

    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) icon = nativeImage.createEmpty();
    } catch {
      icon = nativeImage.createEmpty();
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
/* IPC - playlists                                                            */
/* -------------------------------------------------------------------------- */

ipcMain.handle('playlist:saveM3u', async (_event, entries) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save playlist',
    defaultPath: 'playlist.m3u',
    filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false };

  const lines = ['#EXTM3U'];
  for (const entry of (entries || [])) {
    if (entry && entry.title) {
      lines.push('#EXTINF:-1,' + String(entry.title).replace(/\r?\n/g, ' '));
    }
    const value = entry && (entry.path || entry.url);
    if (value) lines.push(String(value));
  }

  try {
    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('playlist:loadM3u', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] },
      { name: 'All', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, entries: [] };
  }

  const filePath = result.filePaths[0];
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, entries: [], error: e.message };
  }

  const lines = text.split(/\r?\n/);
  const entries = [];
  let pendingTitle = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#EXTM3U')) continue;

    if (trimmed.startsWith('#EXTINF:')) {
      const comma = trimmed.indexOf(',');
      pendingTitle = comma >= 0 ? trimmed.slice(comma + 1).trim() : null;
      continue;
    }

    if (trimmed.startsWith('#')) continue;

    entries.push({
      path: trimmed,
      title: pendingTitle || path.basename(trimmed)
    });
    pendingTitle = null;
  }

  return { ok: true, entries };
});

/* -------------------------------------------------------------------------- */
/* IPC - subtitles / Whisper                                                  */
/* -------------------------------------------------------------------------- */

ipcMain.handle('subtitles:detectWhisper', async () => {
  const whisper = findWhisper();
  return { ok: !!whisper, path: whisper || null };
});

ipcMain.handle('subtitles:saveSrt', async (_event, { content, defaultName } = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
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
      reject(new Error(
        'ffmpeg.exe not found (expected in ffmpeg/ffmpeg.exe next to ZephyrPlayer). ' +
        'Needed to convert media to WAV for subtitle generation.'
      ));
      return;
    }

    const args = ['-y', '-i', mediaPath, '-ac', '1', '-ar', '16000', '-vn', wavOutPath];
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
        reject(new Error('ffmpeg failed to extract audio (code ' + code + '): ' + stderr.slice(-500)));
      }
    });
  });
}

ipcMain.handle('subtitles:generateLocal', async (_event, { mediaPath, model } = {}) => {
  if (!mediaPath || !fileExists(mediaPath)) {
    return { ok: false, error: 'Media file not found' };
  }

  const whisper = findWhisper();
  if (!whisper) {
    return {
      ok: false,
      error: 'whisper-cli.exe not found. Place whisper.cpp build next to ZephyrPlayer for local speech-to-text.'
    };
  }

  const outDir = path.join(app.getPath('temp'), 'zephyr-whisper');
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {}

  const base = path.join(outDir, path.basename(mediaPath, path.extname(mediaPath)));
  const modelName = model || 'base';

  // Models can be in extraResources or next to the app
  const modelPath = path.join(getResourcePath('models'), 'ggml-' + modelName + '.bin');

  const args = [];
  if (fileExists(modelPath)) {
    args.push('-m', modelPath);
  }

  let whisperInput = mediaPath;
  const wavPath = base + '.wav';

  try {
    whisperInput = await extractWavForWhisper(mediaPath, wavPath);
  } catch (e) {
    log('ffmpeg WAV extraction failed, falling back to raw media:', e.message);
  }

  args.push('-f', whisperInput, '-osrt', '-of', base);

  return new Promise(resolve => {
    let stderr = '';
    let child;

    try {
      child = spawn(whisper, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }

    if (child.stderr) {
      child.stderr.on('data', data => { stderr += data.toString(); });
    }

    child.once('error', error => {
      resolve({ ok: false, error: error.message });
    });

    child.once('close', code => {
      if (whisperInput === wavPath && fileExists(wavPath)) {
        try { fs.unlinkSync(wavPath); } catch {}
      }

      const srt = base + '.srt';
      if (fileExists(srt)) {
        try {
          const content = fs.readFileSync(srt, 'utf8');
          resolve({ ok: true, srtPath: srt, content, code });
          return;
        } catch (e) {
          resolve({ ok: false, error: e.message });
          return;
        }
      }

      resolve({
        ok: false,
        error: 'Whisper finished but no SRT found. Ensure model file exists in models/ggml-' +
          modelName + '.bin. ' + (stderr || '')
      });
    });
  });
});

/* -------------------------------------------------------------------------- */
/* IPC - history                                                              */
/* -------------------------------------------------------------------------- */

ipcMain.handle('history:clear', async () => ({ ok: true }));

ipcMain.handle('history:recordOpened', async (_event, filePath) => {
  recordRecentFile(filePath);
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* IPC - native taskbar progress                                             */
/* -------------------------------------------------------------------------- */

ipcMain.handle('player:reportProgress', async (_event, fraction) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const f = (typeof fraction === 'number' && fraction >= 0 && fraction <= 1) ? fraction : -1;
      mainWindow.setProgressBar(f);
    }
  } catch {}
  return { ok: true };
});

/* -------------------------------------------------------------------------- */
/* IPC - record / convert (via bundled ffmpeg)                               */
/* -------------------------------------------------------------------------- */

ipcMain.handle('media:startRecording', async (_event, { url } = {}) => {
  if (recordingProcess) return { ok: false, error: 'Already recording' };
  if (!url) return { ok: false, error: 'Nothing streaming to record' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found (expected in ffmpeg/ffmpeg.exe next to ZephyrPlayer).' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Record stream to file',
    defaultPath: 'ZephyrPlayer-recording-' + Date.now() + '.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, error: 'Canceled' };

  const args = ['-y', '-i', url, '-c', 'copy', result.filePath];

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

ipcMain.handle('media:stopRecording', async () => {
  if (!recordingProcess) return { ok: false, error: 'Not recording' };

  try {
    recordingProcess.stdin.write('q');
  } catch {
    try { recordingProcess.kill(); } catch {}
  }
  return { ok: true, path: recordingOutputPath };
});

ipcMain.handle('media:convertToMp4', async (_event, inputPath) => {
  if (!inputPath || !fileExists(inputPath)) return { ok: false, error: 'File not found' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found (expected in ffmpeg/ffmpeg.exe next to ZephyrPlayer).' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
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

ipcMain.handle('media:extractAudio', async (_event, inputPath) => {
  if (!inputPath || !fileExists(inputPath)) return { ok: false, error: 'File not found' };

  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg.exe not found (expected in ffmpeg/ffmpeg.exe next to ZephyrPlayer).' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
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
/* IPC - library scan                                                         */
/* -------------------------------------------------------------------------- */

ipcMain.handle('library:scanFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, files: [] };
  }

  const root = result.filePaths[0];
  const exts = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.ts', '.m2ts', '.mpg', '.mpeg', '.mp3', '.flac', '.aac', '.wav',
    '.ogg', '.opus', '.wma'
  ]);

  const files = [];

  function walk(dir, depth) {
    if (depth > 8 || files.length >= 5000) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (files.length >= 5000) break;

      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!exts.has(ext)) continue;

        let size = 0;
        try { size = fs.statSync(full).size; } catch {}

        files.push({ path: full, name: ent.name, size, root });
      }
    }
  }

  walk(root, 0);

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  }));

  return { ok: true, files, root };
});

/* -------------------------------------------------------------------------- */
/* File association export                                                    */
/* -------------------------------------------------------------------------- */

function getAssociationExecutable() {
  return process.execPath;
}

ipcMain.handle('assoc:exportReg', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows file associations are only supported on Windows.' };
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

  const result = await dialog.showSaveDialog(mainWindow, {
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

ipcMain.handle('shell:openDefaults', async () => {
  try {
    await shell.openExternal('ms-settings:defaultapps');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* -------------------------------------------------------------------------- */
/* IPC - application info                                                     */
/* -------------------------------------------------------------------------- */

ipcMain.handle('app:getInfo', async () => ({
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

  loadRecentFiles();
  updateJumpList();
  registerMediaKeys();

  createWindow();
  createMenu();
  createTray();

  // Auto-update check after 4 seconds (only in packaged builds)
  setTimeout(setupAutoUpdate, 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && mainWindow.isMinimized()) {
      mainWindow.restore();
    }
  });
});

app.on('window-all-closed', () => {
  stopEmbedMpv();
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
  stopEmbedMpv();

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