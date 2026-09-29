const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  onOpenFiles: (callback) => ipcRenderer.on('open-files', (_e, paths) => callback(paths)),
  onOpenFilesMpv: (callback) => ipcRenderer.on('open-files-mpv', (_e, paths) => callback(paths)),
  setAlwaysOnTop: () => ipcRenderer.invoke('window:setAlwaysOnTop'),
  setMini: (mini) => ipcRenderer.invoke('window:setMini', mini),
  hideToTray: () => ipcRenderer.invoke('window:hideToTray'),
  saveM3u: (entries) => ipcRenderer.invoke('playlist:saveM3u', entries),
  loadM3u: () => ipcRenderer.invoke('playlist:loadM3u'),

  mpvAvailable: () => ipcRenderer.invoke('mpv:available'),
  mpvPlayExternal: (opts, quality, embed) =>
    ipcRenderer.invoke('mpv:playExternal', typeof opts === 'object' && !Array.isArray(opts) ? opts : { files: opts, quality, embed }),
  mpvPlayUrl: (url, quality, embed) =>
    ipcRenderer.invoke('mpv:playUrl', { url, quality, embed }),
  mpvStop: () => ipcRenderer.invoke('mpv:stop'),
  mpvSetQuality: (quality) => ipcRenderer.invoke('mpv:setQuality', quality),
  mpvApplyVideoAdj: (adj) => ipcRenderer.invoke('mpv:applyVideoAdj', adj),
  mpvApplyEq: (eq) => ipcRenderer.invoke('mpv:applyEq', eq),
  mpvFrameStep: (dir) => ipcRenderer.invoke('mpv:frameStep', dir),
  mpvGetMediaInfo: () => ipcRenderer.invoke('mpv:getMediaInfo'),
  mpvSetTracks: (opts) => ipcRenderer.invoke('mpv:setTracks', opts),
  mpvApplyGeometry: (geo) => ipcRenderer.invoke('mpv:applyGeometry', geo),
  listAudioDevices: () => ipcRenderer.invoke('mpv:listAudioDevices'),
  setAudioDevice: (id) => ipcRenderer.invoke('mpv:setAudioDevice', id),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  setEmbedMode: (mode) => ipcRenderer.invoke('mpv:setEmbedMode', mode),
  setEmbedBounds: (bounds) => ipcRenderer.invoke('mpv:setEmbedBounds', bounds),
  getEmbedMode: () => ipcRenderer.invoke('mpv:getEmbedMode'),
  detectWhisper: () => ipcRenderer.invoke('subtitles:detectWhisper'),
  generateLocalSubs: (mediaPath, model) => ipcRenderer.invoke('subtitles:generateLocal', { mediaPath, model }),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  saveSrt: (content, defaultName) => ipcRenderer.invoke('subtitles:saveSrt', { content, defaultName }),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  scanLibraryFolder: () => ipcRenderer.invoke('library:scanFolder'),
  exportAssocReg: () => ipcRenderer.invoke('assoc:exportReg'),
  openDefaultApps: () => ipcRenderer.invoke('shell:openDefaults'),

  onMpvStatus: (callback) => ipcRenderer.on('mpv-status', (_e, status) => callback(status)),
  onMpvProcessError: (callback) => ipcRenderer.on('mpv-process-error', (_e, info) => callback(info)),
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_e, key) => callback(key)),

  reportProgress: (fraction) => ipcRenderer.invoke('player:reportProgress', fraction),
  recordOpened: (filePath) => ipcRenderer.invoke('history:recordOpened', filePath),

  startRecording: (url) => ipcRenderer.invoke('media:startRecording', { url }),
  stopRecording: () => ipcRenderer.invoke('media:stopRecording'),
  convertToMp4: (inputPath) => ipcRenderer.invoke('media:convertToMp4', inputPath),
  extractAudio: (inputPath) => ipcRenderer.invoke('media:extractAudio', inputPath),
  onRecordingStatus: (callback) => ipcRenderer.on('recording-status', (_e, status) => callback(status)),

  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_e, status) => callback(status))
});

