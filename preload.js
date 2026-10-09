'use strict';
/**
 * ZephyrPlayer preload (sandboxed). Exposes a small, explicit API to the UI.
 * Event subscriptions return an unsubscribe function.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function on(channel, cb) {
  if (typeof cb !== 'function') return () => {};
  const handler = (_event, ...args) => { try { cb(...args); } catch (e) { console.error('[preload] listener error on ' + channel, e); } };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  /* files & dialogs */
  openFiles: () => invoke('dialog:openFiles'),
  openFolder: () => invoke('dialog:openFolder'),
  expandPaths: (paths) => invoke('files:expand', paths),
  sidecarSubs: (mediaPath) => invoke('files:sidecarSubs', mediaPath),
  readSubtitle: (filePath) => invoke('files:readSubtitle', filePath),
  getPathForFile: (file) => {
    try { if (webUtils && webUtils.getPathForFile) return webUtils.getPathForFile(file) || ''; } catch {}
    try { return (file && file.path) || ''; } catch { return ''; }
  },
  saveM3u: (entries) => invoke('playlist:saveM3u', entries),
  loadM3u: () => invoke('playlist:loadM3u'),
  scanLibraryFolder: () => invoke('library:scanFolder'),
  recordOpened: (p) => invoke('history:recordOpened', p),
  reportProgress: (fraction) => invoke('player:reportProgress', fraction),

  /* window */
  setAlwaysOnTop: () => invoke('window:setAlwaysOnTop'),
  setMini: (mini) => invoke('window:setMini', !!mini),
  hideToTray: () => invoke('window:hideToTray'),
  capturePage: (rect) => invoke('capture:page', rect),
  openExternal: (url) => invoke('shell:openExternal', url),
  getAppInfo: () => invoke('app:getInfo'),
  exportAssocReg: () => invoke('assoc:exportReg'),
  openDefaultApps: () => invoke('shell:openDefaults'),

  /* mpv engine */
  mpvAvailable: () => invoke('mpv:available'),
  mpvPlayExternal: (opts) => invoke('mpv:playExternal', opts),
  mpvLoad: (file, startPos) => invoke('mpv:loadFile', file, startPos),
  mpvPlayUrl: (url, quality, embed, extra) => invoke('mpv:playUrl', Object.assign({}, extra, { url, quality, embed })),
  mpvStop: () => invoke('mpv:stop'),
  mpvSetQuality: (q) => invoke('mpv:setQuality', q),
  mpvApplyVideoAdj: (adj) => invoke('mpv:applyVideoAdj', adj),
  mpvApplyEq: (eq) => invoke('mpv:applyEq', eq),
  mpvApplyGeometry: (geo) => invoke('mpv:applyGeometry', geo),
  mpvFrameStep: (dir) => invoke('mpv:frameStep', dir),
  mpvGetMediaInfo: () => invoke('mpv:getMediaInfo'),
  mpvSetTracks: (opts) => invoke('mpv:setTracks', opts),
  mpvSetProps: (map) => invoke('mpv:setProps', map),
  mpvCommand: (name, args) => invoke('mpv:command', name, args),
  mpvGetState: () => invoke('mpv:getState'),
  updateYtDlp: () => invoke('ytdlp:update'),
  ytdlpPlaylist: (url, cookies) => invoke('ytdlp:playlist', url, cookies),
  probeMedia: (file) => invoke('media:probe', file),
  thumbMedia: (file, duration, cover) => invoke('media:thumb', file, duration, !!cover),
  onlineLookup: (q) => invoke('online:lookup', q),
  onlineClearCache: () => invoke('online:clearCache'),
  exportClip: (o) => invoke('media:exportClip', o),
  showItem: (f) => invoke('shell:showItem', f),
  deleteFile: (f) => invoke('files:delete', f),
  toolsStatus: () => invoke('tools:status'),
  toolsInstall: (opts) => invoke('tools:install', opts),
  collectDiagnostics: () => invoke('diag:collect'),
  getSetting: (k) => invoke('app:getSetting', k),
  setSetting: (k, v) => invoke('app:setSetting', k, v),
  openDocs: (which) => invoke('docs:open', which),
  onToolsProgress: (cb) => on('tools-progress', cb),
  mpvApplyAudioPrefs: (p) => invoke('mpv:applyAudioPrefs', p),
  externalList: () => invoke('external:list'),
  externalOpen: (o) => invoke('external:open', o),
  assocStatus: () => invoke('assoc:status'),
  assocRegister: (sel) => invoke('assoc:register', sel),
  assocUnregister: () => invoke('assoc:unregister'),
  openAppFolder: (which) => invoke('app:openFolder', which),
  toggleDevTools: () => invoke('app:toggleDevTools'),
  getEdition: () => invoke('app:getEdition'),
  codecReport: () => invoke('codec:report'),
  getIcons: () => invoke('icons:getAll'),
  openIconsFolder: () => invoke('icons:openFolder'),
  listAudioDevices: () => invoke('mpv:listAudioDevices'),
  setAudioDevice: (id) => invoke('mpv:setAudioDevice', id),
  setEmbedMode: (mode) => invoke('mpv:setEmbedMode', mode),
  getEmbedMode: () => invoke('mpv:getEmbedMode'),
  setEmbedBounds: (b) => invoke('mpv:setEmbedBounds', b),
  setEmbedSuspended: (flag) => invoke('mpv:setEmbedSuspended', !!flag),

  /* subtitles */
  detectWhisper: () => invoke('subtitles:detectWhisper'),
  generateLocalSubs: (mediaPath, model) => invoke('subtitles:generateLocal', { mediaPath, model }),
  cancelLocalSubs: () => invoke('subtitles:cancel'),
  saveSrt: (content, defaultName) => invoke('subtitles:saveSrt', { content, defaultName }),

  /* recording / conversion */
  startRecording: (url) => invoke('media:startRecording', { url }),
  stopRecording: () => invoke('media:stopRecording'),
  convertToMp4: (p) => invoke('media:convertToMp4', p),
  extractAudio: (p) => invoke('media:extractAudio', p),

  /* events from the main process */
  onOpenFiles: (cb) => on('open-files', cb),
  onOpenFilesMpv: (cb) => on('open-files-mpv', cb),
  onMpvStatus: (cb) => on('mpv-status', cb),
  onMpvProcessError: (cb) => on('mpv-process-error', cb),
  onMpvState: (cb) => on('mpv-state', cb),
  onMpvEvent: (cb) => on('mpv-event', cb),
  onHotkey: (cb) => on('hotkey', cb),
  onRecordingStatus: (cb) => on('recording-status', cb),
  onUpdateStatus: (cb) => on('update-status', cb),
  onSubtitleProgress: (cb) => on('subtitles-progress', cb),
  onWindowState: (cb) => on('window-state', cb)
});
