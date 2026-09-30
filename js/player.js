(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const video = $('video');
  const videoWrapper = $('videoWrapper');
  const dropZone = $('dropZone');
  const bigPlay = $('bigPlay');
  const loader = $('loader');
  const playlistEl = $('playlist');
  const trackCount = $('trackCount');
  const videoTitle = $('videoTitle');
  const videoSubtitle = $('videoSubtitle');
  const fileInput = $('fileInput');
  const folderInput = $('folderInput');
  const subInput = $('subInput');
  const sidebar = $('sidebar');
  const subtitleDisplay = $('subtitleDisplay');
  const osd = $('osd');
  const abRange = $('abRange');

  const playPauseBtn = $('playPauseBtn');
  const iconPlay = playPauseBtn.querySelector('.icon-play');
  const iconPause = playPauseBtn.querySelector('.icon-pause');
  const prevBtn = $('prevBtn');
  const nextBtn = $('nextBtn');
  const muteBtn = $('muteBtn');
  const volumeSlider = $('volumeSlider');
  const progressBar = $('progressBar');
  const played = $('played');
  const buffered = $('buffered');
  const handle = $('handle');
  const currentTimeEl = $('currentTime');
  const durationEl = $('duration');
  const fullscreenBtn = $('fullscreenBtn');
  const pipBtn = $('pipBtn');
  const speedBtn = $('speedBtn');
  const speedLabel = $('speedLabel');
  const speedMenu = $('speedMenu');
  const subBtn = $('subBtn');
  const subMenu = $('subMenu');
  const audioBtn = $('audioBtn');
  const audioMenu = $('audioMenu');
  const rewindBtn = $('rewindBtn');
  const forwardBtn = $('forwardBtn');
  const abLoopBtn = $('abLoopBtn');
  const screenshotBtn = $('screenshotBtn');
  const themeToggle = $('themeToggle');
  const toggleSidebar = $('toggleSidebar');
  const closeSidebar = $('closeSidebar');
  const addFilesBtn = $('addFilesBtn');
  const addFolderBtn = $('addFolderBtn');
  const clearPlaylistBtn = $('clearPlaylistBtn');
  const browseBtn = $('browseBtn');
  const browseFolderBtn = $('browseFolderBtn');
  const shuffleBtn = $('shuffleBtn');
  const repeatBtn = $('repeatBtn');
  const alwaysOnTopBtn = $('alwaysOnTopBtn');
  const settingsBtn = $('settingsBtn');
  const settingsPanel = $('settingsPanel');
  const closeSettings = $('closeSettings');

  // State
  let playlist = [];
  let currentIndex = -1;
  let isSeeking = false;
  let repeatMode = 0; // 0=off, 1=all, 2=one
  let shuffle = false;
  let abLoop = { a: null, b: null, active: false };
  let externalSubs = [];
  let seekStep = 10;
  let autoNext = true;
  let rememberPos = true;
  let osdTimer = null;

  // Utils
  function pathToFileUrl(p) {
    if (!p) return '';
    let s = String(p).replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(s)) s = '/' + s;
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + encodeURI(s).replace(/#/g, '%23');
  }
  function formatTime(s) {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  }
  function formatSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
  }
  function showOSD(text, ms = 1200) {
    osd.textContent = text;
    osd.hidden = false;
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd.hidden = true, ms);
  }

  // Playlist
  function addFiles(files) {
    const media = Array.from(files).filter(f => {
      const name = f.name || f.path || '';
      return (f.type && (f.type.startsWith('video/') || f.type.startsWith('audio/'))) ||
        /\.(mp4|webm|mkv|avi|mov|m4v|wmv|flv|ts|m2ts|mpg|mpeg|3gp|ogv|ogg|mp3|flac|wav|aac|m4a|opus|wma)$/i.test(name) ||
        (!!f.path && !/\.(srt|vtt|ass|ssa|txt|jpg|png|json)$/i.test(name));
    });
    const subs = Array.from(files).filter(f => /\.(srt|vtt|ass|ssa)$/i.test(f.name || f.path || ''));

    media.forEach(file => {
      let url, name, fullName, size;
      if (file.path) {
        fullName = file.path.split(/[/\\]/).pop();
        name = fullName.replace(/\.[^/.]+$/, '');
        url = pathToFileUrl(file.path);
        size = file.size || 0;
      } else {
        fullName = file.name;
        name = file.name.replace(/\.[^/.]+$/, '');
        url = URL.createObjectURL(file);
        size = file.size;
      }
      playlist.push({ name, fullName, url, size, type: file.type || '', path: file.path || null });
    });

    if (subs.length && playlist.length) {
      externalSubs = subs;
      loadExternalSub(subs[0]);
    }

    renderPlaylist();
    if (currentIndex === -1 && playlist.length) playIndex(0);
  }

  function addNativePaths(paths) {
    addFiles(paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop(), size: 0 })));
  }

  function renderPlaylist() {
    playlistEl.innerHTML = '';
    if (!playlist.length) {
      playlistEl.innerHTML = '<li class="playlist-empty">No media yet.<br>Open files or drop them here.</li>';
      trackCount.textContent = '0 tracks';
      return;
    }
    playlist.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
      li.innerHTML = `
        <span class="index">${i+1}</span>
        <div class="info">
          <div class="name" title="${item.fullName}">${item.name}</div>
          <div class="meta">${formatSize(item.size)}</div>
        </div>
        <button class="remove" data-i="${i}">✕</button>`;
      li.addEventListener('click', e => { if (!e.target.closest('.remove')) playIndex(i); });
      li.querySelector('.remove').addEventListener('click', e => { e.stopPropagation(); removeIndex(i); });
      playlistEl.appendChild(li);
    });
    trackCount.textContent = `${playlist.length} track${playlist.length !== 1 ? 's' : ''}`;
  }

  function removeIndex(i) {
    if (playlist[i].url && playlist[i].url.startsWith('blob:')) URL.revokeObjectURL(playlist[i].url);
    playlist.splice(i, 1);
    if (currentIndex === i) {
      if (playlist.length) playIndex(Math.min(i, playlist.length - 1));
      else resetPlayer();
    } else if (currentIndex > i) currentIndex--;
    renderPlaylist();
  }

  function clearPlaylist() {
    playlist.forEach(item => { if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url); });
    playlist = [];
    currentIndex = -1;
    resetPlayer();
    renderPlaylist();
  }

  function resetPlayer() {
    video.removeAttribute('src');
    video.load();
    dropZone.classList.remove('hidden');
    bigPlay.hidden = true;
    videoTitle.textContent = 'ZephyrPlayer';
    videoSubtitle.textContent = 'Open files or drop media here';
    subtitleDisplay.textContent = '';
    updatePlayIcon(false);
    played.style.width = '0%';
    handle.style.left = '0%';
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
    if (window.electronAPI && window.electronAPI.reportProgress) {
      window.electronAPI.reportProgress(-1);
    }
  }

  // Chromium's built-in <video> element has no native demuxer for these
  // containers — it will silently fail to play them even though mpv handles
  // them fine. Route these straight to mpv instead of the browser engine.
  function needsMpvContainer(fullName) {
    return /\.(ts|m2ts|mts|wmv|flv|mpg|mpeg|asf|rm|rmvb|vob|divx)$/i.test(fullName || '');
  }

  function playIndex(i) {
    if (i < 0 || i >= playlist.length) return;
    // Save position
    if (rememberPos && currentIndex >= 0 && video.currentTime > 5) {
      try { localStorage.setItem('zephyr-pos-' + playlist[currentIndex].fullName, video.currentTime); } catch {}
    }
    currentIndex = i;
    const item = playlist[i];

    if (item.path && window.electronAPI && window.electronAPI.recordOpened) {
      window.electronAPI.recordOpened(item.path);
    }

    if (item.path && needsMpvContainer(item.fullName) && mpvReady) {
      loader.hidden = true;
      videoTitle.textContent = item.name;
      videoSubtitle.textContent = item.fullName;
      dropZone.classList.add('hidden');
      bigPlay.hidden = true;
      renderPlaylist();
      playWithMpv([item.path], getQuality());
      return;
    }

    loader.hidden = false;
    video.src = item.url;
    videoTitle.textContent = item.name;
    videoSubtitle.textContent = item.fullName;
    dropZone.classList.add('hidden');
    bigPlay.hidden = true;
    renderPlaylist();
    video.play().catch(() => { bigPlay.hidden = false; updatePlayIcon(false); });
  }

  // Safety net: if the browser engine fails on a format we didn't anticipate
  // (unsupported codec inside an otherwise-normal container, etc.), fall
  // back to mpv automatically instead of leaving a dead player.
  video.addEventListener('error', () => {
    const item = playlist[currentIndex];
    if (item && item.path && mpvReady) {
      showOSD('Browser engine can\'t play this — switching to mpv…');
      playWithMpv([item.path], getQuality());
    }
  });

  // Playback
  function togglePlay() {
    if (!video.src) return;
    video.paused ? video.play() : video.pause();
  }
  function updatePlayIcon(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }
  function seekRelative(sec) {
    if (!video.src) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + sec));
    showOSD((sec > 0 ? '+' : '') + sec + 's');
  }

  // Progress
  function updateProgress() {
    if (isSeeking || !video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    played.style.width = pct + '%';
    handle.style.left = pct + '%';
    currentTimeEl.textContent = formatTime(video.currentTime);

    if (window.electronAPI && window.electronAPI.reportProgress) {
      window.electronAPI.reportProgress(video.currentTime / video.duration);
    }

    // A-B loop
    if (abLoop.active && abLoop.b !== null && video.currentTime >= abLoop.b) {
      video.currentTime = abLoop.a;
    }
  }
  function updateBuffered() {
    if (!video.duration || !video.buffered.length) return;
    buffered.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100 + '%';
  }
  function seekFromEvent(e) {
    const rect = progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (video.duration) {
      video.currentTime = pct * video.duration;
      played.style.width = pct * 100 + '%';
      handle.style.left = pct * 100 + '%';
    }
  }
  function updateABVisual() {
    if (abLoop.a !== null && abLoop.b !== null && video.duration) {
      abRange.hidden = false;
      abRange.style.left = (abLoop.a / video.duration * 100) + '%';
      abRange.style.width = ((abLoop.b - abLoop.a) / video.duration * 100) + '%';
    } else {
      abRange.hidden = true;
    }
  }

  // Volume
  function setVolume(val) {
    video.volume = Math.min(1, val); // HTML5 max is 1, but we allow slider >1 for visual boost intent
    volumeSlider.value = val;
    video.muted = false;
    muteBtn.textContent = val === 0 || video.muted ? '🔇' : (val < 0.4 ? '🔈' : '🔊');
  }
  function toggleMute() {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
  }

  // Fullscreen / PiP
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      videoWrapper.requestFullscreen?.() || videoWrapper.webkitRequestFullscreen?.();
    } else {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    }
  }
  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (e) { console.warn(e); }
  }

  // Speed
  function setSpeed(rate) {
    video.playbackRate = rate;
    speedLabel.textContent = rate + '×';
    speedMenu.querySelectorAll('button').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === rate));
    speedMenu.hidden = true;
    showOSD(rate + '×');
  }

  // A-B Loop
  function handleABLoop() {
    if (abLoop.a === null) {
      abLoop.a = video.currentTime;
      abLoopBtn.classList.add('active');
      abLoopBtn.textContent = 'A–';
      showOSD('A point set');
    } else if (abLoop.b === null) {
      abLoop.b = video.currentTime;
      if (abLoop.b <= abLoop.a) { abLoop.b = null; showOSD('B must be after A'); return; }
      abLoop.active = true;
      abLoopBtn.textContent = 'A-B';
      updateABVisual();
      showOSD('A-B loop on');
    } else {
      abLoop = { a: null, b: null, active: false };
      abLoopBtn.classList.remove('active');
      abLoopBtn.textContent = 'A-B';
      updateABVisual();
      showOSD('A-B loop off');
    }
  }

  // Screenshot
  function takeScreenshot() {
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zephyr-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      showOSD('Screenshot saved');
    }, 'image/png');
  }

  // Subtitles (basic external)
  function loadExternalSub(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      // Very basic SRT/VTT parser for display
      parseAndShowSubs(text);
      showOSD('Subtitles loaded');
    };
    reader.readAsText(file);
  }

  let subCues = [];
  function parseAndShowSubs(text) {
    subCues = [];
    // Simple SRT-like parse
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    blocks.forEach(block => {
      const lines = block.trim().split('\n');
      if (lines.length < 2) return;
      const timeLine = lines.find(l => l.includes('-->')) || lines[1];
      const m = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
      if (!m) return;
      const start = timeToSec(m[1]);
      const end = timeToSec(m[2]);
      const content = lines.slice(lines.indexOf(timeLine) + 1).join('\n');
      subCues.push({ start, end, text: content });
    });
  }
  function timeToSec(t) {
    const p = t.replace(',', '.').split(':');
    return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
  }
  function updateSubtitles() {
    if (!subCues.length) { subtitleDisplay.textContent = ''; return; }
    const t = video.currentTime - (typeof subDelaySec === "number" ? subDelaySec : 0);
    const cue = subCues.find(c => t >= c.start && t <= c.end);
    subtitleDisplay.textContent = cue ? cue.text : '';
  }

  // Repeat / Shuffle
  function cycleRepeat() {
    repeatMode = (repeatMode + 1) % 3;
    const labels = ['🔁 Off', '🔁 All', '🔂 One'];
    repeatBtn.textContent = labels[repeatMode];
    repeatBtn.classList.toggle('active', repeatMode > 0);
    showOSD(labels[repeatMode]);
  }
  function toggleShuffle() {
    shuffle = !shuffle;
    shuffleBtn.classList.toggle('active', shuffle);
    showOSD(shuffle ? 'Shuffle on' : 'Shuffle off');
  }

  // Theme & Settings
  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('zephyr-theme', next);
  }
  function openSettings() {
    settingsPanel.hidden = false;
    $('settingTheme').value = document.documentElement.getAttribute('data-theme') || 'dark';
    $('settingVolume').value = volumeSlider.value;
    $('settingSeek').value = seekStep;
    $('settingAutoNext').checked = autoNext;
    $('settingRemember').checked = rememberPos;
  }
  function closeSettingsPanel() {
    if (settingsPanel) settingsPanel.hidden = true;
    const theme = $('settingTheme').value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('zephyr-theme', theme);
    setVolume(parseFloat($('settingVolume').value));
    seekStep = parseInt($('settingSeek').value, 10) || 10;
    autoNext = $('settingAutoNext').checked;
    rememberPos = $('settingRemember').checked;
  }

  // Always on top (Electron)
  function toggleAlwaysOnTop() {
    if (window.electronAPI && window.electronAPI.setAlwaysOnTop) {
      window.electronAPI.setAlwaysOnTop();
      alwaysOnTopBtn.classList.toggle('active');
    } else {
      showOSD('Always on top (desktop only)');
    }
  }

  // File open
  async function openFilesNative() {
    try {
      if (window.electronAPI && window.electronAPI.openFiles) {
        const paths = await window.electronAPI.openFiles();
        if (paths && paths.length) {
          addNativePaths(paths);
          showOSD(paths.length + ' file(s) added');
          return;
        }
        // user cancelled
        return;
      }
    } catch (e) {
      console.error(e);
      showOSD('Open failed – trying fallback');
    }
    if (fileInput) fileInput.click();
  }
  function openFolderNative() {
    if (window.electronAPI && window.electronAPI.openFolder) {
      window.electronAPI.openFolder().then(paths => {
        if (paths && paths.length) addNativePaths(paths);
        else showOSD('No media files in folder');
      });
      return;
    }
    folderInput.click();
  }

  // Events
  video.addEventListener('play', () => {
    updatePlayIcon(true);
    bigPlay.hidden = true;
  });
  video.addEventListener('pause', () => {
    updatePlayIcon(false);
    // Only show center play when we have a source and are paused
    if (video.src && !video.ended) bigPlay.hidden = false;
    else bigPlay.hidden = true;
  });
  video.addEventListener('timeupdate', () => { updateProgress(); updateSubtitles(); });
  video.addEventListener('progress', updateBuffered);
  video.addEventListener('loadedmetadata', () => {
    durationEl.textContent = formatTime(video.duration);
    loader.hidden = true;
    // Restore position
    if (rememberPos && currentIndex >= 0) {
      try {
        const pos = parseFloat(localStorage.getItem('zephyr-pos-' + playlist[currentIndex].fullName));
        if (pos > 5 && pos < video.duration - 5) video.currentTime = pos;
      } catch {}
    }
  });
  video.addEventListener('waiting', () => { if (video.src) loader.hidden = false; });
  video.addEventListener('canplay', () => loader.hidden = true);
  video.addEventListener('ended', () => {
    if (repeatMode === 2) { video.currentTime = 0; video.play(); return; }
    if (autoNext || repeatMode === 1) {
      let next = currentIndex + 1;
      if (shuffle) next = Math.floor(Math.random() * playlist.length);
      if (next >= playlist.length) next = repeatMode === 1 ? 0 : -1;
      if (next >= 0) playIndex(next);
      else { updatePlayIcon(false); bigPlay.hidden = false; }
    } else {
      updatePlayIcon(false); bigPlay.hidden = false;
    }
  });
  video.addEventListener('error', () => {
    loader.hidden = true;
    videoTitle.textContent = 'Cannot play this file';
    videoSubtitle.textContent = 'Format may not be supported by the current engine';
    showOSD('Playback error – try another format or add mpv later');
  });
  video.addEventListener('click', togglePlay);
  video.addEventListener('dblclick', toggleFullscreen);

  playPauseBtn.addEventListener('click', togglePlay);
  bigPlay.addEventListener('click', () => {
    bigPlay.hidden = true;
    togglePlay();
  });
  prevBtn.addEventListener('click', () => playIndex(currentIndex - 1));
  nextBtn.addEventListener('click', () => playIndex(currentIndex + 1));
  muteBtn.addEventListener('click', toggleMute);
  volumeSlider.addEventListener('input', e => setVolume(parseFloat(e.target.value)));
  rewindBtn.addEventListener('click', () => seekRelative(-seekStep));
  forwardBtn.addEventListener('click', () => seekRelative(seekStep));
  abLoopBtn.addEventListener('click', handleABLoop);
  screenshotBtn.addEventListener('click', takeScreenshot);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  pipBtn.addEventListener('click', togglePiP);

  speedBtn.addEventListener('click', e => { e.stopPropagation(); speedMenu.hidden = !speedMenu.hidden; positionMenu(speedMenu, speedBtn); });
  speedMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed))));

  subBtn.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    const open = subMenu.hidden;
    speedMenu.hidden = true;
    audioMenu.hidden = true;
    subMenu.hidden = !open;
    if (!subMenu.hidden) positionMenu(subMenu, subBtn);
  });
  subMenu.querySelector('[data-action="off"]').addEventListener('click', () => {
    subCues = []; subtitleDisplay.textContent = ''; subMenu.hidden = true; showOSD('Subtitles off');
  });
  subMenu.querySelector('[data-action="load"]').addEventListener('click', () => { subInput.click(); subMenu.hidden = true; });
  subInput.addEventListener('change', () => { if (subInput.files[0]) loadExternalSub(subInput.files[0]); subInput.value = ''; });

  audioBtn.addEventListener('click', e => {
    e.stopPropagation();
    // HTML5 video has limited multi-audio support; show placeholder
    const tracks = $('audioTracks');
    tracks.innerHTML = '<button class="active">Default track</button>';
    audioMenu.hidden = !audioMenu.hidden;
    positionMenu(audioMenu, audioBtn);
  });

  function positionMenu(menu, btn) {
    const r = btn.getBoundingClientRect();
    menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    menu.style.right = (window.innerWidth - r.right) + 'px';
    menu.style.left = 'auto';
    menu.style.top = 'auto';
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest && (e.target.closest('#subMenu') || e.target.closest('#speedMenu') || e.target.closest('#audioMenu') || e.target.closest('#subBtn') || e.target.closest('#speedBtn') || e.target.closest('#audioBtn'))) return;
    if (speedMenu) speedMenu.hidden = true;
    if (subMenu) subMenu.hidden = true;
    if (audioMenu) audioMenu.hidden = true;
  });

  progressBar.addEventListener('mousedown', e => {
    isSeeking = true;
    seekFromEvent(e);
    const move = ev => seekFromEvent(ev);
    const up = () => { isSeeking = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  folderInput.addEventListener('change', () => { addFiles(folderInput.files); folderInput.value = ''; });
  addFilesBtn.addEventListener('click', openFilesNative);
  browseBtn.addEventListener('click', openFilesNative);
  addFolderBtn.addEventListener('click', openFolderNative);
  browseFolderBtn.addEventListener('click', openFolderNative);
  clearPlaylistBtn.addEventListener('click', clearPlaylist);
  shuffleBtn.addEventListener('click', toggleShuffle);
  repeatBtn.addEventListener('click', cycleRepeat);
  themeToggle.addEventListener('click', toggleTheme);
  alwaysOnTopBtn.addEventListener('click', toggleAlwaysOnTop);
  settingsBtn.addEventListener('click', openSettings);
  if (closeSettings) {
    closeSettings.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsPanel();
    });
  }

  toggleSidebar.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  closeSidebar.addEventListener('click', () => sidebar.classList.add('collapsed'));

  // Drag & drop
  ['dragenter','dragover','dragleave','drop'].forEach(ev => {
    videoWrapper.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
  });
  videoWrapper.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
  videoWrapper.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  videoWrapper.addEventListener('drop', e => {
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // Electron menu open
  if (window.electronAPI?.onOpenFiles) {
    window.electronAPI.onOpenFiles(paths => { if (paths?.length) addNativePaths(paths); });
  }

  // Keyboard (VLC / PotPlayer style)
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    switch (k) {
      case ' ': case 'k': e.preventDefault(); togglePlay(); break;
      case 'arrowleft': seekRelative(e.shiftKey ? -30 : -seekStep); break;
      case 'arrowright': seekRelative(e.shiftKey ? 30 : seekStep); break;
      case 'arrowup': e.preventDefault(); setVolume(Math.min(1.5, parseFloat(volumeSlider.value) + 0.05)); break;
      case 'arrowdown': e.preventDefault(); setVolume(Math.max(0, parseFloat(volumeSlider.value) - 0.05)); break;
      case 'm': toggleMute(); break;
      case 'f': toggleFullscreen(); break;
      case 's': takeScreenshot(); break;
      case 'p': if (e.shiftKey) playIndex(currentIndex - 1); break;
      case 'n': if (e.shiftKey) playIndex(currentIndex + 1); break;
      case 'a': handleABLoop(); break;
      case 'r': cycleRepeat(); break;
      case '[': setSpeed(Math.max(0.25, video.playbackRate - 0.25)); break;
      case ']': setSpeed(Math.min(2, video.playbackRate + 0.25)); break;
      case 'escape': if (document.fullscreenElement) document.exitFullscreen(); break;
    }
    if (e.ctrlKey && k === 'o') { e.preventDefault(); openFilesNative(); }
  });

  // Init
  const savedTheme = localStorage.getItem('zephyr-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  setVolume(1);
  renderPlaylist();

  // ===== mpv as main engine =====
  const mpvPlayBtn = document.getElementById('mpvPlayBtn');
  const mpvStatus = document.getElementById('mpvStatus');
  let mpvReady = false;
  let useMpvEngine = false;

  async function refreshMpvStatus() {
    if (!window.electronAPI || !window.electronAPI.mpvAvailable) {
      if (mpvStatus) mpvStatus.textContent = 'Browser engine';
      if (mpvPlayBtn) mpvPlayBtn.style.display = 'none';
      return;
    }
    try {
      const st = await window.electronAPI.mpvAvailable();
      mpvReady = !!st.available;
      if (mpvStatus) {
        mpvStatus.textContent = mpvReady ? 'mpv ready' : 'mpv missing';
        mpvStatus.title = st.path || '';
        mpvStatus.style.color = mpvReady ? 'var(--accent)' : 'var(--text-muted)';
      }
      if (mpvPlayBtn) {
        mpvPlayBtn.style.display = mpvReady ? '' : 'none';
        mpvPlayBtn.title = mpvReady ? 'Play with mpv (full codecs + high quality)' : 'mpv not found';
      }
    } catch (e) {
      if (mpvPlayBtn) mpvPlayBtn.style.display = 'none';
    }
  }

  async function playWithMpv(files, quality) {
    if (typeof reportEmbedBounds === "function") reportEmbedBounds();
    if (!window.electronAPI) return false;
    const list = Array.isArray(files) ? files : [files];
    const q = quality || getQuality();
    if (window.electronAPI.mpvPlayExternal) {
      const res = await window.electronAPI.mpvPlayExternal({
        files: list,
        quality: q,
        embed: true,
        vo: localStorage.getItem('zephyr-settingVo') || 'gpu',
        hwdec: localStorage.getItem('zephyr-settingHwdec') || 'auto',
        perf: localStorage.getItem('zephyr-settingPerf') || 'smooth'
      });
      if (res && res.ok) {
        showOSD(res.embedded ? 'mpv embedded · ' + q : 'mpv · ' + q);
        return true;
      }
    }
    // Fallback IPC load
    if (window.electronAPI.mpvLoad && list[0]) {
      const res = await window.electronAPI.mpvLoad(list[0]);
      if (res && res.ok) {
        showOSD('mpv engine');
        return true;
      }
    }
    showOSD('mpv failed – check mpv.exe');
    return false;
  }

  if (mpvPlayBtn) {
    mpvPlayBtn.addEventListener('click', async () => {
      if (!mpvReady) {
        showOSD('Place mpv.exe next to the app');
        return;
      }
      const files = [];
      if (currentIndex >= 0 && playlist[currentIndex]) {
        const item = playlist[currentIndex];
        if (item.path) files.push(item.path);
      }
      if (!files.length) {
        // Try open dialog via electron
        if (window.electronAPI.openFiles) {
          const paths = await window.electronAPI.openFiles();
          if (paths && paths.length) {
            await playWithMpv(paths, 'high');
            return;
          }
        }
        showOSD('Open a local file first');
        return;
      }
      await playWithMpv(files, 'high');
    });
  }

  if (window.electronAPI) {
    if (window.electronAPI.onMpvStatus) {
      window.electronAPI.onMpvStatus((st) => {
        mpvReady = !!st.available;
        if (mpvStatus) {
          mpvStatus.textContent = mpvReady ? 'mpv ready' : 'mpv missing';
          mpvStatus.style.color = mpvReady ? 'var(--accent)' : 'var(--text-muted)';
        }
        if (mpvPlayBtn) mpvPlayBtn.style.display = mpvReady ? '' : 'none';
      });
    }
    if (window.electronAPI.onOpenFilesMpv) {
      window.electronAPI.onOpenFilesMpv(async (paths) => {
        if (paths && paths.length) {
          addNativePaths(paths);
          await playWithMpv(paths, 'high');
        }
      });
    }
  }

  
  // URL / YouTube panel + quality
  const addUrlBtn = document.getElementById('addUrlBtn');
  const urlPanel = document.getElementById('urlPanel');
  const urlInput = document.getElementById('urlInput');
  const playUrlBtn = document.getElementById('playUrlBtn');
  const cancelUrlBtn = document.getElementById('cancelUrlBtn');
  const closeUrlPanel = document.getElementById('closeUrlPanel');
  const qualitySelect = document.getElementById('qualitySelect');

  function getQuality() {
    return (qualitySelect && qualitySelect.value) || 'high';
  }

  function openUrlPanel() {
    if (urlPanel) {
      urlPanel.hidden = false;
      if (urlInput) { urlInput.value = ''; urlInput.focus(); }
    }
  }
  function closeUrl() {
    if (urlPanel) urlPanel.hidden = true;
  }

  if (addUrlBtn) addUrlBtn.addEventListener('click', openUrlPanel);
  if (cancelUrlBtn) cancelUrlBtn.addEventListener('click', closeUrl);
  if (closeUrlPanel) closeUrlPanel.addEventListener('click', closeUrl);
  if (playUrlBtn) {
    playUrlBtn.addEventListener('click', async () => {
      const url = (urlInput && urlInput.value || '').trim();
      if (!url) { showOSD('Paste a URL first'); return; }
      closeUrl();
      if (!window.electronAPI || !window.electronAPI.mpvPlayUrl) {
        showOSD('mpv required for URLs');
        return;
      }
      showOSD('Opening…');
      const res = await window.electronAPI.mpvPlayUrl(url, getQuality(), true);
      if (res && res.ok) {
        showOSD(res.embedded ? 'Playing (embedded mpv)' : 'Playing in mpv');
        videoTitle.textContent = url.length > 60 ? url.slice(0, 57) + '…' : url;
        videoSubtitle.textContent = 'Stream / YouTube';
        dropZone.classList.add('hidden');
      } else {
        showOSD((res && res.error) ? String(res.error).slice(0, 80) : 'Failed to play URL');
        if (res && res.error && res.error.includes('yt-dlp')) {
          alert(res.error);
        }
      }
    });
  }
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && playUrlBtn) playUrlBtn.click();
    });
  }

   
  // Update playWithMpv to use quality + embed

  
  // ===== Batch 1: Video adj, EQ, Info, Frame step =====
  const videoAdjBtn = document.getElementById('videoAdjBtn');
  const eqBtn = document.getElementById('eqBtn');
  const infoBtn = document.getElementById('infoBtn');
  const frameBackBtn = document.getElementById('frameBackBtn');
  const frameFwdBtn = document.getElementById('frameFwdBtn');
  const videoAdjPanel = document.getElementById('videoAdjPanel');
  const eqPanel = document.getElementById('eqPanel');
  const infoPanel = document.getElementById('infoPanel');

  function closeAllPanels() {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel].forEach(el => {
      if (el) el.hidden = true;
    });
  }

  if (videoAdjBtn) videoAdjBtn.addEventListener('click', () => {
    closeAllPanels();
    if (videoAdjPanel) videoAdjPanel.hidden = false;
  });
  if (eqBtn) eqBtn.addEventListener('click', () => {
    closeAllPanels();
    if (eqPanel) eqPanel.hidden = false;
  });
  if (infoBtn) infoBtn.addEventListener('click', async () => {
    closeAllPanels();
    if (infoPanel) infoPanel.hidden = false;
    const el = document.getElementById('mediaInfoText');
    if (!el) return;
    let text = '';
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const it = playlist[currentIndex];
      text += 'Title: ' + (it.name || '') + '\n';
      text += 'File: ' + (it.fullName || it.path || '') + '\n';
      text += 'Size: ' + (it.size ? (it.size/1048576).toFixed(2) + ' MB' : '—') + '\n';
    }
    if (video.videoWidth) {
      text += 'Resolution: ' + video.videoWidth + '×' + video.videoHeight + '\n';
      text += 'Duration: ' + formatTime(video.duration) + '\n';
    }
    if (window.electronAPI && window.electronAPI.mpvGetMediaInfo) {
      try {
        const res = await window.electronAPI.mpvGetMediaInfo();
        if (res && res.info) {
          text += '\n--- Engine ---\n';
          text += 'mpv: ' + (res.info.mpv || '—') + '\n';
          text += 'yt-dlp: ' + (res.info.ytdlp || '—') + '\n';
          text += 'Quality: ' + (res.info.quality || '—') + '\n';
          if (res.info.source) text += 'Source: ' + JSON.stringify(res.info.source) + '\n';
        }
      } catch {}
    }
    el.textContent = text || 'No file loaded';
  });

  ['closeVideoAdj','closeEq','closeInfo'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', closeAllPanels);
  });

  // Apply video adjustments (built-in CSS filter + mpv relaunch)
  function applyLocalVideoFilters() {
    const b = document.getElementById('adjBrightness');
    const c = document.getElementById('adjContrast');
    const s = document.getElementById('adjSaturation');
    if (!b) return;
    const br = 1 + (parseInt(b.value,10)/100);
    const ct = 1 + (parseInt(c.value,10)/100);
    const sat = 1 + (parseInt(s.value,10)/100);
    video.style.filter = `brightness(${br}) contrast(${ct}) saturate(${sat})`;
  }
  ['adjBrightness','adjContrast','adjSaturation','adjGamma','adjHue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', async () => {
      applyLocalVideoFilters();
      if (window.electronAPI && window.electronAPI.mpvApplyVideoAdj) {
        const adj = {
          brightness: parseInt(document.getElementById('adjBrightness').value,10),
          contrast: parseInt(document.getElementById('adjContrast').value,10),
          saturation: parseInt(document.getElementById('adjSaturation').value,10),
          gamma: parseInt(document.getElementById('adjGamma').value,10),
          hue: parseInt(document.getElementById('adjHue').value,10)
        };
        // debounced-ish: only send on change end would be better; apply on demand
      }
    });
  });
  const adjResetBtn = document.getElementById('adjResetBtn');
  if (adjResetBtn) adjResetBtn.addEventListener('click', () => {
    ['adjBrightness','adjContrast','adjSaturation','adjGamma','adjHue'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = 0;
    });
    video.style.filter = '';
    showOSD('Video adjustments reset');
  });
  // Apply to mpv when user releases slider or we add apply - apply on panel close via button
  // Add apply by double-using reset row - wire change to mpv on mouseup
  ['adjBrightness','adjContrast','adjSaturation','adjGamma','adjHue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', async () => {
      if (!window.electronAPI || !window.electronAPI.mpvApplyVideoAdj) return;
      const adj = {
        brightness: parseInt(document.getElementById('adjBrightness').value,10),
        contrast: parseInt(document.getElementById('adjContrast').value,10),
        saturation: parseInt(document.getElementById('adjSaturation').value,10),
        gamma: parseInt(document.getElementById('adjGamma').value,10),
        hue: parseInt(document.getElementById('adjHue').value,10)
      };
      const res = await window.electronAPI.mpvApplyVideoAdj(adj);
      if (res && res.ok) showOSD('Applied to mpv');
    });
  });

  // EQ
  const eqApplyBtn = document.getElementById('eqApplyBtn');
  const eqResetBtn = document.getElementById('eqResetBtn');
  if (eqApplyBtn) eqApplyBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.mpvApplyEq) {
      showOSD('mpv required for EQ');
      return;
    }
    const eq = {
      normalize: !!(document.getElementById('eqNormalize') || {}).checked,
      bass: parseInt((document.getElementById('eqBass') || {}).value || 0, 10),
      mid: parseInt((document.getElementById('eqMid') || {}).value || 0, 10),
      treble: parseInt((document.getElementById('eqTreble') || {}).value || 0, 10),
      gain: parseInt((document.getElementById('eqGain') || {}).value || 0, 10)
    };
    const res = await window.electronAPI.mpvApplyEq(eq);
    showOSD(res && res.ok ? 'EQ applied (mpv)' : (res && res.error) || 'EQ failed');
  });
  if (eqResetBtn) eqResetBtn.addEventListener('click', () => {
    const n = document.getElementById('eqNormalize'); if (n) n.checked = false;
    ['eqBass','eqMid','eqTreble','eqGain'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = 0;
    });
    showOSD('EQ reset');
  });

  // Frame step
  if (frameBackBtn) frameBackBtn.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.mpvFrameStep) {
      const r = await window.electronAPI.mpvFrameStep(-1);
      if (r && r.ok) return;
    }
    // fallback HTML5 ~1 frame at 24fps
    if (video.src) video.currentTime = Math.max(0, video.currentTime - 1/30);
  });
  if (frameFwdBtn) frameFwdBtn.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.mpvFrameStep) {
      const r = await window.electronAPI.mpvFrameStep(1);
      if (r && r.ok) return;
    }
    if (video.src) video.currentTime = Math.min(video.duration || 0, video.currentTime + 1/30);
  });

  // Keyboard frame step
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === ',') { e.preventDefault(); frameBackBtn && frameBackBtn.click(); }
    if (e.key === '.') { e.preventDefault(); frameFwdBtn && frameFwdBtn.click(); }
  });

  
  // ===== Batch 2: Tracks + subtitle delay/style =====
  let selectedAid = 'auto';
  let selectedSid = 'auto';
  let subDelaySec = 0;
  let subScale = 1;

  function refreshHtml5Tracks() {
    const subTracksEl = document.getElementById('subTracks');
    const audioTracksEl = document.getElementById('audioTracks');
    if (subTracksEl) {
      subTracksEl.innerHTML = '';
      const tracks = video.textTracks || [];
      let count = 0;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        count++;
        const btn = document.createElement('button');
        btn.textContent = (t.label || t.language || ('Track ' + count));
        btn.dataset.sid = String(i);
        if (t.mode === 'showing') btn.classList.add('active');
        btn.addEventListener('click', () => {
          for (let j = 0; j < tracks.length; j++) tracks[j].mode = 'disabled';
          t.mode = 'showing';
          selectedSid = i;
          subMenu.hidden = true;
          showOSD('Subtitle: ' + btn.textContent);
          refreshHtml5Tracks();
        });
        subTracksEl.appendChild(btn);
      }
      if (!count) {
        const hint = document.createElement('button');
        hint.disabled = true;
        hint.textContent = subCues.length ? 'External SRT loaded' : 'No embedded subs';
        subTracksEl.appendChild(hint);
      }
    }
    if (audioTracksEl) {
      audioTracksEl.innerHTML = '';
      // HTML5 audioTracks support is limited in Chromium
      const at = video.audioTracks;
      if (at && at.length) {
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          const btn = document.createElement('button');
          btn.textContent = t.label || t.language || ('Audio ' + (i + 1));
          if (t.enabled) btn.classList.add('active');
          btn.addEventListener('click', () => {
            for (let j = 0; j < at.length; j++) at[j].enabled = (j === i);
            selectedAid = i + 1;
            audioMenu.hidden = true;
            showOSD('Audio: ' + btn.textContent);
            if (window.electronAPI && window.electronAPI.mpvSetTracks) {
              window.electronAPI.mpvSetTracks({ aid: selectedAid });
            }
            refreshHtml5Tracks();
          });
          audioTracksEl.appendChild(btn);
        }
      } else {
        // Offer track numbers for mpv relaunch
        for (let i = 1; i <= 4; i++) {
          const btn = document.createElement('button');
          btn.textContent = 'Audio track ' + i + (i === 1 ? ' (default)' : '');
          if (selectedAid == i || (selectedAid === 'auto' && i === 1)) btn.classList.add('active');
          btn.addEventListener('click', async () => {
            selectedAid = i;
            audioMenu.hidden = true;
            showOSD('Audio track ' + i);
            if (window.electronAPI && window.electronAPI.mpvSetTracks) {
              await window.electronAPI.mpvSetTracks({ aid: i, sid: selectedSid, subDelay: subDelaySec, subScale });
            }
            refreshHtml5Tracks();
          });
          audioTracksEl.appendChild(btn);
        }
        const note = document.createElement('button');
        note.disabled = true;
        note.textContent = 'mpv: switch reloads with --aid';
        audioTracksEl.appendChild(note);
      }
    }
  }

  // Override sub menu open to refresh tracks
  if (subBtn) {
    subBtn.addEventListener('click', () => {
      refreshHtml5Tracks();
      // also offer sid 1-4 for mpv
      const subTracksEl = document.getElementById('subTracks');
      if (subTracksEl && window.electronAPI) {
        const existing = subTracksEl.querySelector('[data-mpv-sid]');
        if (!existing) {
          for (let i = 1; i <= 4; i++) {
            const btn = document.createElement('button');
            btn.dataset.mpvSid = String(i);
            btn.textContent = 'mpv sub track ' + i;
            btn.addEventListener('click', async () => {
              selectedSid = i;
              subMenu.hidden = true;
              showOSD('Subtitle track ' + i);
              if (window.electronAPI.mpvSetTracks) {
                await window.electronAPI.mpvSetTracks({
                  aid: selectedAid, sid: i, subDelay: subDelaySec, subScale
                });
              }
            });
            subTracksEl.appendChild(btn);
          }
        }
      }
    });
  }

  // Subtitle delay / size / position for on-screen display + mpv
  const subDelayEl = document.getElementById('subDelay');
  const subSizeEl = document.getElementById('subSize');
  const subPosEl = document.getElementById('subPos');
  const subDelayVal = document.getElementById('subDelayVal');
  const subSizeVal = document.getElementById('subSizeVal');
  const subPosVal = document.getElementById('subPosVal');

  function applySubStyle() {
    if (subtitleDisplay) {
      const sizePct = subSizeEl ? parseInt(subSizeEl.value, 10) : 100;
      const pos = subPosEl ? parseInt(subPosEl.value, 10) : 10;
      subtitleDisplay.style.fontSize = (1.35 * sizePct / 100) + 'rem';
      subtitleDisplay.style.bottom = (20 + pos * 0.6) + 'px';
    }
  }

  if (subDelayEl) {
    subDelayEl.addEventListener('input', () => {
      subDelaySec = parseFloat(subDelayEl.value) || 0;
      if (subDelayVal) subDelayVal.textContent = (subDelaySec >= 0 ? '+' : '') + subDelaySec.toFixed(1) + 's';
    });
    subDelayEl.addEventListener('change', async () => {
      subDelaySec = parseFloat(subDelayEl.value) || 0;
      showOSD('Sub delay ' + subDelaySec.toFixed(1) + 's');
      if (window.electronAPI && window.electronAPI.mpvSetTracks) {
        await window.electronAPI.mpvSetTracks({
          aid: selectedAid, sid: selectedSid, subDelay: subDelaySec, subScale
        });
      }
    });
  }
  if (subSizeEl) {
    subSizeEl.addEventListener('input', () => {
      const v = parseInt(subSizeEl.value, 10);
      subScale = v / 100;
      if (subSizeVal) subSizeVal.textContent = v + '%';
      applySubStyle();
    });
    subSizeEl.addEventListener('change', async () => {
      subScale = parseInt(subSizeEl.value, 10) / 100;
      applySubStyle();
      if (window.electronAPI && window.electronAPI.mpvSetTracks) {
        await window.electronAPI.mpvSetTracks({
          aid: selectedAid, sid: selectedSid, subDelay: subDelaySec, subScale
        });
      }
      showOSD('Sub size ' + Math.round(subScale * 100) + '%');
    });
  }
  if (subPosEl) {
    subPosEl.addEventListener('input', () => {
      const v = parseInt(subPosEl.value, 10);
      if (subPosVal) subPosVal.textContent = v < 30 ? 'Bottom' : (v > 70 ? 'Top' : 'Mid');
      applySubStyle();
    });
  }

  // Shift+G / Shift+F style delay adjust (common in players)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'z' || e.key === 'Z') {
      if (!subDelayEl) return;
      const step = e.shiftKey ? 0.5 : 0.1;
      let v = (parseFloat(subDelayEl.value) || 0) - step;
      v = Math.max(-10, Math.min(10, v));
      subDelayEl.value = v;
      subDelayEl.dispatchEvent(new Event('change'));
    }
    if (e.key === 'x' || e.key === 'X') {
      if (!subDelayEl) return;
      const step = e.shiftKey ? 0.5 : 0.1;
      let v = (parseFloat(subDelayEl.value) || 0) + step;
      v = Math.max(-10, Math.min(10, v));
      subDelayEl.value = v;
      subDelayEl.dispatchEvent(new Event('change'));
    }
  });

  // Apply delay to external SRT cue timing
  const _updateSubtitlesOrig = typeof updateSubtitles === 'function' ? updateSubtitles : null;

  
  // ===== Batch 3: Seek thumbnails, chapters, bookmarks =====
  const seekPreview = document.getElementById('seekPreview');
  const seekCanvas = document.getElementById('seekCanvas');
  const seekPreviewTime = document.getElementById('seekPreviewTime');
  const chapterMarks = document.getElementById('chapterMarks');
  const bookmarkBtn = document.getElementById('bookmarkBtn');
  const chapterBtn = document.getElementById('chapterBtn');
  const bookmarkPanel = document.getElementById('bookmarkPanel');
  const chapterPanel = document.getElementById('chapterPanel');
  const bookmarkList = document.getElementById('bookmarkList');
  const chapterList = document.getElementById('chapterList');
  const addBookmarkBtn = document.getElementById('addBookmarkBtn');

  let chapters = []; // { time, title }
  let thumbVideo = null;
  let thumbSeeking = false;
  let lastThumbTime = -1;

  function fileKey() {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      return playlist[currentIndex].fullName || playlist[currentIndex].path || playlist[currentIndex].name || 'unknown';
    }
    return 'unknown';
  }

  function loadBookmarks() {
    try {
      return JSON.parse(localStorage.getItem('zephyr-bm-' + fileKey()) || '[]');
    } catch { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem('zephyr-bm-' + fileKey(), JSON.stringify(list)); } catch {}
  }

  function renderBookmarks() {
    if (!bookmarkList) return;
    const list = loadBookmarks();
    bookmarkList.innerHTML = '';
    if (!list.length) {
      bookmarkList.innerHTML = '<li style="color:var(--text-muted);cursor:default;">No bookmarks yet</li>';
      return;
    }
    list.sort((a, b) => a.time - b.time).forEach((bm, idx) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="bm-time">' + formatTime(bm.time) + '</span>' +
        '<span class="bm-label">' + (bm.label || 'Bookmark') + '</span>' +
        '<button class="bm-del" title="Delete">✕</button>';
      li.addEventListener('click', (e) => {
        if (e.target.closest('.bm-del')) return;
        video.currentTime = bm.time;
        showOSD('Bookmark ' + formatTime(bm.time));
        bookmarkPanel.hidden = true;
      });
      li.querySelector('.bm-del').addEventListener('click', (e) => {
        e.stopPropagation();
        const next = loadBookmarks().filter((_, i) => i !== idx);
        // re-load sorted - safer filter by time+label
        const all = loadBookmarks().filter(b => !(Math.abs(b.time - bm.time) < 0.05 && b.label === bm.label));
        saveBookmarks(all);
        renderBookmarks();
        drawChapterAndBookmarkMarks();
      });
      bookmarkList.appendChild(li);
    });
  }

  function renderChapters() {
    if (!chapterList) return;
    chapterList.innerHTML = '';
    if (!chapters.length) {
      chapterList.innerHTML = '<li style="color:var(--text-muted);cursor:default;">No chapters in this file</li>';
      return;
    }
    chapters.forEach((ch) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="bm-time">' + formatTime(ch.time) + '</span>' +
        '<span class="bm-label">' + (ch.title || 'Chapter') + '</span>';
      li.addEventListener('click', () => {
        video.currentTime = ch.time;
        showOSD(ch.title || formatTime(ch.time));
        chapterPanel.hidden = true;
      });
      chapterList.appendChild(li);
    });
  }

  function drawChapterAndBookmarkMarks() {
    if (!chapterMarks || !video.duration) return;
    chapterMarks.innerHTML = '';
    const dur = video.duration;
    chapters.forEach(ch => {
      const mark = document.createElement('div');
      mark.className = 'chapter-mark';
      mark.style.left = (ch.time / dur * 100) + '%';
      mark.title = ch.title || formatTime(ch.time);
      chapterMarks.appendChild(mark);
    });
    loadBookmarks().forEach(bm => {
      const mark = document.createElement('div');
      mark.className = 'chapter-mark';
      mark.style.background = 'var(--accent)';
      mark.style.left = (bm.time / dur * 100) + '%';
      mark.title = 'Bookmark ' + formatTime(bm.time);
      chapterMarks.appendChild(mark);
    });
  }

  function extractChaptersFromTextTracks() {
    chapters = [];
    try {
      const tracks = video.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (tr.kind !== 'chapters' && tr.kind !== 'metadata') continue;
        tr.mode = 'hidden';
        if (!tr.cues) continue;
        for (let j = 0; j < tr.cues.length; j++) {
          const c = tr.cues[j];
          chapters.push({ time: c.startTime, title: c.text || ('Chapter ' + (j + 1)) });
        }
      }
    } catch {}
    chapters.sort((a, b) => a.time - b.time);
    renderChapters();
    drawChapterAndBookmarkMarks();
  }

  // Ensure thumb helper video
  function ensureThumbVideo() {
    if (thumbVideo) return thumbVideo;
    thumbVideo = document.createElement('video');
    thumbVideo.muted = true;
    thumbVideo.preload = 'metadata';
    thumbVideo.style.display = 'none';
    document.body.appendChild(thumbVideo);
    return thumbVideo;
  }

  function showSeekPreview(clientX) {
    if (!video.duration || !progressBar || !seekPreview) return;
    const rect = progressBar.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    const t = pct * video.duration;
    seekPreview.hidden = false;
    const previewWidth = 160;
    let left = clientX - rect.left;
    left = Math.max(previewWidth / 2, Math.min(rect.width - previewWidth / 2, left));
    seekPreview.style.left = left + 'px';
    if (seekPreviewTime) seekPreviewTime.textContent = formatTime(t);

    // Thumbnail capture via secondary video
    if (!video.src || video.src.startsWith('blob:') === false && !video.currentSrc) {
      // still show time
      return;
    }
    const src = video.currentSrc || video.src;
    if (!src) return;
    const tv = ensureThumbVideo();
    if (tv.src !== src) {
      tv.src = src;
    }
    if (thumbSeeking) return;
    if (Math.abs(t - lastThumbTime) < 0.35) return;
    lastThumbTime = t;
    thumbSeeking = true;
    const onSeeked = () => {
      tv.removeEventListener('seeked', onSeeked);
      try {
        const ctx = seekCanvas && seekCanvas.getContext('2d');
        if (ctx && tv.videoWidth) {
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, seekCanvas.width, seekCanvas.height);
          ctx.drawImage(tv, 0, 0, seekCanvas.width, seekCanvas.height);
        }
      } catch {}
      thumbSeeking = false;
    };
    tv.addEventListener('seeked', onSeeked);
    try {
      tv.currentTime = Math.min(t, (tv.duration || t) - 0.05);
    } catch {
      thumbSeeking = false;
    }
  }

  function hideSeekPreview() {
    if (seekPreview) seekPreview.hidden = true;
  }

  if (progressBar) {
    progressBar.addEventListener('mousemove', (e) => {
      if (!video.duration) return;
      showSeekPreview(e.clientX);
    });
    progressBar.addEventListener('mouseleave', hideSeekPreview);
  }

  video.addEventListener('loadedmetadata', () => {
    extractChaptersFromTextTracks();
    drawChapterAndBookmarkMarks();
    // reset thumb video source
    if (thumbVideo) {
      try { thumbVideo.src = video.currentSrc || video.src; } catch {}
    }
  });

  if (bookmarkBtn) bookmarkBtn.addEventListener('click', () => {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel, chapterPanel].forEach(el => { if (el) el.hidden = true; });
    if (bookmarkPanel) {
      bookmarkPanel.hidden = false;
      renderBookmarks();
    }
  });
  if (chapterBtn) chapterBtn.addEventListener('click', () => {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel, bookmarkPanel].forEach(el => { if (el) el.hidden = true; });
    if (chapterPanel) {
      chapterPanel.hidden = false;
      extractChaptersFromTextTracks();
      renderChapters();
    }
  });
  const closeBookmarks = document.getElementById('closeBookmarks');
  const closeChapters = document.getElementById('closeChapters');
  if (closeBookmarks) closeBookmarks.addEventListener('click', () => { if (bookmarkPanel) bookmarkPanel.hidden = true; });
  if (closeChapters) closeChapters.addEventListener('click', () => { if (chapterPanel) chapterPanel.hidden = true; });

  if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', () => {
    if (!video.src || !video.duration) {
      showOSD('Nothing playing');
      return;
    }
    const label = prompt('Bookmark label', 'Bookmark @ ' + formatTime(video.currentTime));
    if (label === null) return;
    const list = loadBookmarks();
    list.push({ time: video.currentTime, label: label || 'Bookmark' });
    saveBookmarks(list);
    renderBookmarks();
    drawChapterAndBookmarkMarks();
    showOSD('Bookmark saved');
  });

  // Hotkey B = add bookmark
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'b' || e.key === 'B') {
      if (addBookmarkBtn) addBookmarkBtn.click();
    }
  });

  
  // ===== Batch 4: m3u playlist, mini player, tray =====
  const savePlaylistBtn = document.getElementById('savePlaylistBtn');
  const loadPlaylistBtn = document.getElementById('loadPlaylistBtn');
  const miniModeBtn = document.getElementById('miniModeBtn');
  const m3uInput = document.getElementById('m3uInput');
  let miniMode = false;

  if (savePlaylistBtn) {
    savePlaylistBtn.addEventListener('click', async () => {
      if (!playlist.length) { showOSD('Playlist empty'); return; }
      const entries = playlist.map(item => ({
        title: item.name || item.fullName,
        path: item.path || item.url || item.fullName
      }));
      if (window.electronAPI && window.electronAPI.saveM3u) {
        const res = await window.electronAPI.saveM3u(entries);
        showOSD(res && res.ok ? 'Playlist saved' : 'Save cancelled');
      } else {
        // Browser fallback: download m3u
        let body = '#EXTM3U\n';
        entries.forEach(e => {
          body += '#EXTINF:-1,' + (e.title || 'Track') + '\n' + (e.path || '') + '\n';
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([body], { type: 'audio/x-mpegurl' }));
        a.download = 'playlist.m3u';
        a.click();
        showOSD('Playlist downloaded');
      }
    });
  }

  if (loadPlaylistBtn) {
    loadPlaylistBtn.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.loadM3u) {
        const res = await window.electronAPI.loadM3u();
        if (!res || !res.ok || !res.entries || !res.entries.length) {
          showOSD('No playlist loaded');
          return;
        }
        const paths = res.entries.map(e => e.path).filter(Boolean);
        // local paths vs urls
        const local = paths.filter(p => !/^https?:\/\//i.test(p));
        const urls = paths.filter(p => /^https?:\/\//i.test(p));
        if (local.length) addNativePaths(local);
        urls.forEach(u => {
          playlist.push({
            name: u.length > 40 ? u.slice(0, 37) + '…' : u,
            fullName: u,
            url: u,
            size: 0,
            type: '',
            path: null
          });
        });
        renderPlaylist();
        if (currentIndex === -1 && playlist.length) playIndex(0);
        showOSD('Loaded ' + res.entries.length + ' items');
      } else if (m3uInput) {
        m3uInput.click();
      }
    });
  }

  if (m3uInput) {
    m3uInput.addEventListener('change', async () => {
      const file = m3uInput.files && m3uInput.files[0];
      m3uInput.value = '';
      if (!file) return;
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      let pendingTitle = null;
      const paths = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === '#EXTM3U') continue;
        if (t.startsWith('#EXTINF:')) {
          const i = t.indexOf(',');
          pendingTitle = i >= 0 ? t.slice(i + 1) : null;
          continue;
        }
        if (t.startsWith('#')) continue;
        paths.push(t);
        pendingTitle = null;
      }
      const local = paths.filter(p => !/^https?:\/\//i.test(p));
      if (local.length) addNativePaths(local);
      showOSD('Loaded playlist');
    });
  }

  if (miniModeBtn) {
    miniModeBtn.addEventListener('click', async () => {
      miniMode = !miniMode;
      document.body.classList.toggle('mini-mode', miniMode);
      miniModeBtn.classList.toggle('active', miniMode);
      if (window.electronAPI && window.electronAPI.setMini) {
        await window.electronAPI.setMini(miniMode);
      }
      showOSD(miniMode ? 'Mini player' : 'Normal size');
    });
  }

  // Hotkeys from the main-process menu (File > Open URL, Ctrl+U, mini mode, etc.)
  // and from OS-level media keys / taskbar thumbar buttons.
  if (window.electronAPI && window.electronAPI.onHotkey) {
    window.electronAPI.onHotkey((key) => {
      if (key === 'mini' && miniModeBtn) miniModeBtn.click();
      if (key === 'openurl' && addUrlBtn) addUrlBtn.click();
      if (key === 'openfolder') openFolderNative();
      if (key === 'playpause') togglePlay();
      if (key === 'next' && nextBtn) nextBtn.click();
      if (key === 'prev' && prevBtn) prevBtn.click();
      if (key === 'stop') {
        video.pause();
        if (window.electronAPI && window.electronAPI.mpvStop) window.electronAPI.mpvStop();
      }
    });
  }

  // Surface mpv failures that previously failed silently
  if (window.electronAPI && window.electronAPI.onMpvProcessError) {
    window.electronAPI.onMpvProcessError((info) => {
      const msg = (info && info.error) ? String(info.error).slice(0, 300) : 'mpv failed to play this item';
      showOSD(msg);
      console.error('mpv-process-error:', info);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    // Ctrl+Shift+M mini
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      if (miniModeBtn) miniModeBtn.click();
    }
  });

  
  // ===== Batch 5: Anime4K / HDR / aspect / rotate / crop =====
  const geomBtn = document.getElementById('geomBtn');
  const geomPanel = document.getElementById('geomPanel');
  const closeGeom = document.getElementById('closeGeom');
  const geomApplyBtn = document.getElementById('geomApplyBtn');
  const geomResetBtn = document.getElementById('geomResetBtn');

  function getGeomState() {
    return {
      aspect: (document.getElementById('geomAspect') || {}).value || 'native',
      rotate: parseInt((document.getElementById('geomRotate') || {}).value || '0', 10),
      flipH: !!(document.getElementById('geomFlipH') || {}).checked,
      flipV: !!(document.getElementById('geomFlipV') || {}).checked,
      panscan: parseInt((document.getElementById('geomPanscan') || {}).value || '0', 10),
      hdr: (document.getElementById('geomHdr') || {}).value || 'auto'
    };
  }

  function applyLocalGeometry() {
    const g = getGeomState();
    const parts = [];
    if (g.rotate) parts.push('rotate(' + g.rotate + 'deg)');
    if (g.flipH) parts.push('scaleX(-1)');
    if (g.flipV) parts.push('scaleY(-1)');
    if (g.panscan > 0) parts.push('scale(' + (1 + g.panscan / 100) + ')');
    video.style.transform = parts.length ? parts.join(' ') : '';
    // aspect via object-fit / wrapper - approximate for built-in
    if (g.aspect === 'native') {
      video.style.objectFit = 'contain';
    } else {
      video.style.objectFit = 'fill';
    }
  }

  if (geomBtn) geomBtn.addEventListener('click', () => {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel, bookmarkPanel, chapterPanel].forEach(el => {
      if (el) el.hidden = true;
    });
    if (geomPanel) geomPanel.hidden = false;
  });
  if (closeGeom) closeGeom.addEventListener('click', () => { if (geomPanel) geomPanel.hidden = true; });

  ['geomAspect','geomRotate','geomFlipH','geomFlipV','geomPanscan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', applyLocalGeometry);
    if (el) el.addEventListener('change', applyLocalGeometry);
  });

  if (geomResetBtn) geomResetBtn.addEventListener('click', () => {
    const a = document.getElementById('geomAspect'); if (a) a.value = 'native';
    const r = document.getElementById('geomRotate'); if (r) r.value = '0';
    const h = document.getElementById('geomFlipH'); if (h) h.checked = false;
    const v = document.getElementById('geomFlipV'); if (v) v.checked = false;
    const p = document.getElementById('geomPanscan'); if (p) p.value = '0';
    const hdr = document.getElementById('geomHdr'); if (hdr) hdr.value = 'auto';
    applyLocalGeometry();
    showOSD('Geometry reset');
  });

  if (geomApplyBtn) geomApplyBtn.addEventListener('click', async () => {
    applyLocalGeometry();
    if (!window.electronAPI || !window.electronAPI.mpvApplyGeometry) {
      showOSD('Applied locally (mpv not available)');
      return;
    }
    const res = await window.electronAPI.mpvApplyGeometry(getGeomState());
    showOSD(res && res.ok ? 'Applied to mpv' : (res && res.error) || 'Apply failed');
  });

  // Quality changes now actually apply to whatever mpv is currently playing
  if (qualitySelect) {
    qualitySelect.addEventListener('change', async () => {
      if (qualitySelect.value === 'anime4k') {
        showOSD('Anime4K – put .glsl in shaders/ folder');
      }
      if (qualitySelect.value === 'hdr') {
        showOSD('HDR tone-map mode');
      }
      if (window.electronAPI && window.electronAPI.mpvSetQuality) {
        const res = await window.electronAPI.mpvSetQuality(qualitySelect.value);
        if (res && res.ok) {
          showOSD('Quality: ' + qualitySelect.value + ' (restarting stream)');
        }
      }
    });
  }

  
  // ===== Batch 6: OpenSubtitles, sleep timer, audio device, custom hotkeys =====
  const osBtn = document.getElementById('osBtn');
  const sleepBtn = document.getElementById('sleepBtn');
  const osPanel = document.getElementById('osPanel');
  const sleepPanel = document.getElementById('sleepPanel');
  let sleepTimerId = null;
  let sleepEndsAt = null;

  // Custom hotkeys state
  let hotkeys = {
    play: ' ',
    full: 'f',
    mute: 'm',
    shot: 's',
    book: 'b'
  };
  try {
    const saved = JSON.parse(localStorage.getItem('zephyr-hotkeys') || 'null');
    if (saved) hotkeys = Object.assign(hotkeys, saved);
  } catch {}

  function loadHotkeyInputs() {
    const map = { hkPlay: 'play', hkFull: 'full', hkMute: 'mute', hkShot: 'shot', hkBook: 'book' };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = hotkeys[map[id]] === ' ' ? 'Space' : hotkeys[map[id]];
    });
  }
  loadHotkeyInputs();

  const hkSaveBtn = document.getElementById('hkSaveBtn');
  if (hkSaveBtn) hkSaveBtn.addEventListener('click', () => {
    const read = (id, def) => {
      const el = document.getElementById(id);
      let v = (el && el.value || def).trim().toLowerCase();
      if (v === 'space') v = ' ';
      return v || def;
    };
    hotkeys = {
      play: read('hkPlay', ' '),
      full: read('hkFull', 'f'),
      mute: read('hkMute', 'm'),
      shot: read('hkShot', 's'),
      book: read('hkBook', 'b')
    };
    localStorage.setItem('zephyr-hotkeys', JSON.stringify(hotkeys));
    showOSD('Hotkeys saved');
  });

  // Override key handling for customizable ones - add capture listener
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const space = e.key === ' ' || e.code === 'Space';
    if (space && hotkeys.play === ' ') { /* already handled by existing */ return; }
    if (!space && key === hotkeys.play) { e.preventDefault(); togglePlay(); }
    if (key === hotkeys.full) { e.preventDefault(); toggleFullscreen(); }
    if (key === hotkeys.mute) { e.preventDefault(); toggleMute(); }
    if (key === hotkeys.shot) { e.preventDefault(); takeScreenshot(); }
    if (key === hotkeys.book && addBookmarkBtn) { e.preventDefault(); addBookmarkBtn.click(); }
  }, true);

  // OpenSubtitles removed (local-only build)


  // Sleep timer
  if (sleepBtn) sleepBtn.addEventListener('click', () => {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel, bookmarkPanel, chapterPanel, geomPanel].forEach(el => {
      if (el) el.hidden = true;
    });
    if (sleepPanel) sleepPanel.hidden = false;
  });
  const closeSleep = document.getElementById('closeSleep');
  if (closeSleep) closeSleep.addEventListener('click', () => { if (sleepPanel) sleepPanel.hidden = true; });

  function updateSleepStatus() {
    const el = document.getElementById('sleepStatus');
    if (!el) return;
    if (!sleepEndsAt) { el.textContent = 'Timer off'; return; }
    const left = Math.max(0, sleepEndsAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    el.textContent = 'Remaining: ' + m + 'm ' + s + 's';
  }

  const sleepStartBtn = document.getElementById('sleepStartBtn');
  const sleepCancelBtn = document.getElementById('sleepCancelBtn');
  if (sleepStartBtn) sleepStartBtn.addEventListener('click', () => {
    const mins = parseInt((document.getElementById('sleepMinutes') || {}).value || '30', 10);
    const action = ((document.getElementById('sleepAction') || {}).value || 'stop');
    if (!mins || mins < 1) { showOSD('Set minutes >= 1'); return; }
    if (sleepTimerId) clearInterval(sleepTimerId);
    sleepEndsAt = Date.now() + mins * 60 * 1000;
    showOSD('Sleep in ' + mins + ' min');
    sleepTimerId = setInterval(() => {
      updateSleepStatus();
      if (Date.now() >= sleepEndsAt) {
        clearInterval(sleepTimerId);
        sleepTimerId = null;
        sleepEndsAt = null;
        updateSleepStatus();
        if (action === 'exit') {
          showOSD('Sleep timer – quitting');
          if (window.electronAPI && window.electronAPI.mpvStop) window.electronAPI.mpvStop();
          setTimeout(() => { try { window.close(); } catch {} }, 500);
        } else {
          video.pause();
          if (window.electronAPI && window.electronAPI.mpvStop) window.electronAPI.mpvStop();
          showOSD('Sleep timer – stopped');
        }
      }
    }, 1000);
    updateSleepStatus();
  });
  if (sleepCancelBtn) sleepCancelBtn.addEventListener('click', () => {
    if (sleepTimerId) clearInterval(sleepTimerId);
    sleepTimerId = null;
    sleepEndsAt = null;
    updateSleepStatus();
    showOSD('Sleep timer cancelled');
  });

  // Audio devices
  async function refreshAudioDevices() {
    const sel = document.getElementById('settingAudioDevice');
    if (!sel || !window.electronAPI || !window.electronAPI.listAudioDevices) return;
    try {
      const res = await window.electronAPI.listAudioDevices();
      if (!res || !res.devices) return;
      const cur = sel.value;
      sel.innerHTML = '';
      res.devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name || d.id;
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    } catch {}
  }
  const settingAudioDevice = document.getElementById('settingAudioDevice');
  if (settingAudioDevice) {
    settingAudioDevice.addEventListener('change', async () => {
      const id = settingAudioDevice.value;
      localStorage.setItem('zephyr-audio-device', id);
      if (window.electronAPI && window.electronAPI.setAudioDevice) {
        const res = await window.electronAPI.setAudioDevice(id);
        showOSD(res && res.ok ? 'Audio device set' : 'Device saved (play with mpv to apply)');
      }
    });
    const savedDev = localStorage.getItem('zephyr-audio-device');
    if (savedDev) settingAudioDevice.value = savedDev;
  }

  // Refresh devices when opening settings
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      refreshAudioDevices();
      loadHotkeyInputs();
    });
  }

  
  // ===== Batch 7: Stronger mpv embed =====
  const embedSelect = document.getElementById('embedSelect');

  function reportEmbedBounds() {
    const wrap = document.getElementById('videoWrapper');
    if (!wrap || !window.electronAPI || !window.electronAPI.setEmbedBounds) return;
    const rect = wrap.getBoundingClientRect();
    // screen coordinates
    const x = rect.left + (window.screenX || window.screenLeft || 0);
    const y = rect.top + (window.screenY || window.screenTop || 0);
    // Electron: screenX includes frame; getBoundingClientRect is relative to client
    // For BrowserWindow content, use electron API if we had it — approximate:
    window.electronAPI.setEmbedBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      relative: true
    });
  }

  // More accurate bounds via requestAnimationFrame on resize
  let boundsTimer = null;
  function scheduleBounds() {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(reportEmbedBounds, 120);
  }
  window.addEventListener('resize', scheduleBounds);
  window.addEventListener('move', scheduleBounds);
  // Mutation-ish: when sidebar toggles
  if (toggleSidebar) toggleSidebar.addEventListener('click', () => setTimeout(reportEmbedBounds, 300));
  if (closeSidebar) closeSidebar.addEventListener('click', () => setTimeout(reportEmbedBounds, 300));

  if (embedSelect) {
    const saved = localStorage.getItem('zephyr-embed-mode');
    if (saved) embedSelect.value = saved;
    embedSelect.addEventListener('change', async () => {
      localStorage.setItem('zephyr-embed-mode', embedSelect.value);
      if (window.electronAPI && window.electronAPI.setEmbedMode) {
        await window.electronAPI.setEmbedMode(embedSelect.value);
      }
      reportEmbedBounds();
      showOSD('Embed: ' + embedSelect.value);
    });
    // init
    if (window.electronAPI && window.electronAPI.setEmbedMode) {
      window.electronAPI.setEmbedMode(embedSelect.value);
    }
  }

  // Report bounds before mpv play
  const _playWithMpvOrig = typeof playWithMpv === 'function' ? playWithMpv : null;
  // Hook existing playWithMpv by wrapping calls - report bounds first
  reportEmbedBounds();
  setInterval(reportEmbedBounds, 2000);

  // Visual hint when embed is on
  if (embedSelect) {
    const hint = document.createElement('div');
    // no permanent overlay needed
  }

  
  // Global drag-drop fallback (whole window)
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      addFiles(e.dataTransfer.files);
      showOSD('Added media');
    }
  });

  if (loader) loader.hidden = true;
  if (bigPlay) bigPlay.hidden = true;
  
  // ===== UX: close menus, context menu, history, subtitle browser / AI =====
  const closeSubMenu = document.getElementById('closeSubMenu');
  if (closeSubMenu) closeSubMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (subMenu) subMenu.hidden = true;
  });
  if (subMenu) {
    subMenu.addEventListener('click', (e) => e.stopPropagation());
  }
  if (speedMenu) speedMenu.addEventListener('click', (e) => e.stopPropagation());
  if (audioMenu) audioMenu.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [subMenu, speedMenu, audioMenu, document.getElementById('ctxMenu')].forEach(m => {
        if (m) m.hidden = true;
      });
    }
  });

  // Clear watch history
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('zephyr-pos-')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      // also sub cache keys
      const keys2 = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('zephyr-sub-')) keys2.push(k);
      }
      keys2.forEach(k => localStorage.removeItem(k));
      showOSD('Watch history cleared');
    });
  }

  // Context menu
  const ctxMenu = document.getElementById('ctxMenu');

  // Record / Convert / Extract audio use the bundled ffmpeg.exe (main.js).
  // Injected here rather than in index.html so this works without an HTML edit.
  if (ctxMenu && !document.getElementById('ctxRecordBtn')) {
    const divider = document.createElement('div');
    divider.className = 'menu-divider';
    const recordBtn = document.createElement('button');
    recordBtn.id = 'ctxRecordBtn';
    recordBtn.setAttribute('data-ctx', 'record');
    recordBtn.textContent = 'Record stream to file';
    const convertBtn = document.createElement('button');
    convertBtn.setAttribute('data-ctx', 'convert');
    convertBtn.textContent = 'Convert to MP4…';
    const extractBtn = document.createElement('button');
    extractBtn.setAttribute('data-ctx', 'extract-audio');
    extractBtn.textContent = 'Extract audio (MP3)…';
    ctxMenu.appendChild(divider);
    ctxMenu.appendChild(recordBtn);
    ctxMenu.appendChild(convertBtn);
    ctxMenu.appendChild(extractBtn);
  }

  let isRecording = false;

  function currentMediaSourceUrl() {
    // Prefer the live mpv/stream URL if one was opened via the URL box;
    // otherwise fall back to the current playlist item's path/url.
    if (urlInput && urlInput.value && urlInput.value.trim()) return urlInput.value.trim();
    const item = playlist[currentIndex];
    return item ? (item.path || item.url) : null;
  }

  async function handleRecordToggle() {
    if (!window.electronAPI || !window.electronAPI.startRecording) {
      showOSD('Recording needs a rebuilt preload.js');
      return;
    }
    if (isRecording) {
      const res = await window.electronAPI.stopRecording();
      showOSD(res && res.ok ? 'Recording stopped' : ((res && res.error) || 'Stop failed'));
      return;
    }
    const src = currentMediaSourceUrl();
    if (!src) {
      showOSD('Nothing playing to record');
      return;
    }
    showOSD('Choose where to save the recording…');
    const res = await window.electronAPI.startRecording(src);
    if (!(res && res.ok)) {
      showOSD((res && res.error) || 'Recording failed to start');
    }
  }

  async function handleConvert() {
    if (!window.electronAPI || !window.electronAPI.convertToMp4) {
      showOSD('Convert needs a rebuilt preload.js');
      return;
    }
    const item = playlist[currentIndex];
    if (!item || !item.path) {
      showOSD('Open a local file first');
      return;
    }
    showOSD('Converting… this can take a while for long files');
    const res = await window.electronAPI.convertToMp4(item.path);
    showOSD(res && res.ok ? ('Saved: ' + res.path.split(/[\\/]/).pop()) : ((res && res.error) || 'Convert failed'));
  }

  async function handleExtractAudio() {
    if (!window.electronAPI || !window.electronAPI.extractAudio) {
      showOSD('Extract audio needs a rebuilt preload.js');
      return;
    }
    const item = playlist[currentIndex];
    if (!item || !item.path) {
      showOSD('Open a local file first');
      return;
    }
    showOSD('Extracting audio…');
    const res = await window.electronAPI.extractAudio(item.path);
    showOSD(res && res.ok ? ('Saved: ' + res.path.split(/[\\/]/).pop()) : ((res && res.error) || 'Extract failed'));
  }

  if (window.electronAPI && window.electronAPI.onRecordingStatus) {
    window.electronAPI.onRecordingStatus((st) => {
      isRecording = !!(st && st.recording);
      const btn = document.getElementById('ctxRecordBtn');
      if (btn) btn.textContent = isRecording ? 'Stop recording ●' : 'Record stream to file';
      if (st && st.recording === false && st.path && !st.error) {
        showOSD('Saved recording: ' + st.path.split(/[\\/]/).pop());
      }
      if (st && st.error) showOSD('Recording error: ' + String(st.error).slice(0, 200));
    });
  }

  if (window.electronAPI && window.electronAPI.onUpdateStatus) {
    window.electronAPI.onUpdateStatus((st) => {
      if (!st) return;
      if (st.status === 'available') showOSD('Update available: v' + st.version + ' downloading…', 2500);
      if (st.status === 'downloaded') showOSD('Update v' + st.version + ' ready — restart to install', 3000);
      if (st.status === 'error') console.warn('Update error:', st.error);
    });
  }

  function hideCtx() { if (ctxMenu) ctxMenu.hidden = true; }
  function showCtx(x, y) {
    if (!ctxMenu) return;
    ctxMenu.hidden = false;
    const pad = 8;
    const w = ctxMenu.offsetWidth || 200;
    const h = ctxMenu.offsetHeight || 300;
    let left = x, top = y;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    ctxMenu.style.left = Math.max(pad, left) + 'px';
    ctxMenu.style.top = Math.max(pad, top) + 'px';
    ctxMenu.style.bottom = 'auto';
    ctxMenu.style.right = 'auto';
  }
  if (videoWrapper) {
    videoWrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtx(e.clientX, e.clientY);
    });
  }
  // Close context menu on any outside pointer action (capture phase)
  document.addEventListener('pointerdown', (e) => {
    if (!ctxMenu || ctxMenu.hidden) return;
    if (ctxMenu.contains(e.target)) return;
    hideCtx();
  }, true);
  document.addEventListener('click', (e) => {
    if (!ctxMenu || ctxMenu.hidden) return;
    if (ctxMenu.contains(e.target)) return;
    hideCtx();
  }, true);
  if (ctxMenu) {
    ctxMenu.querySelectorAll('[data-ctx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = btn.getAttribute('data-ctx');
        hideCtx();
        if (a === 'play') togglePlay();
        if (a === 'fullscreen') toggleFullscreen();
        if (a === 'mute') toggleMute();
        if (a === 'open') openFilesNative();
        if (a === 'url') { const b = document.getElementById('addUrlBtn'); if (b) b.click(); }
        if (a === 'folder') openFolderNative();
        if (a === 'sub' && subBtn) subBtn.click();
        if (a === 'sub-load' && subInput) subInput.click();
        if (a === 'shot') takeScreenshot();
        if (a === 'info' && infoBtn) infoBtn.click();
        if (a === 'bookmark' && addBookmarkBtn) addBookmarkBtn.click();
        if (a === 'browse-sub') openSubBrowse();
        if (a === 'gen-en') { openSubBrowse(); setTimeout(() => { const g = document.getElementById('genEnSubBtn'); if (g) g.click(); }, 100); }
        if (a === 'record') handleRecordToggle();
        if (a === 'convert') handleConvert();
        if (a === 'extract-audio') handleExtractAudio();
      });
    });
  }

  // Subtitle browser / editor
  const subBrowsePanel = document.getElementById('subBrowsePanel');
  function openSubBrowse() {
    [videoAdjPanel, eqPanel, infoPanel, settingsPanel, urlPanel, bookmarkPanel, chapterPanel, geomPanel, sleepPanel].forEach(el => {
      if (el) el.hidden = true;
    });
    if (subBrowsePanel) {
      subBrowsePanel.hidden = false;
      renderSubEditor();
      updateAiStatus();
    }
  }
  const closeSubBrowse = document.getElementById('closeSubBrowse');
  if (closeSubBrowse) closeSubBrowse.addEventListener('click', () => { if (subBrowsePanel) subBrowsePanel.hidden = true; });

  function cuesToSrt(cues) {
    return cues.map((c, i) => {
      const ts = (sec) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
      };
      return (i + 1) + '\n' + ts(c.start) + ' --> ' + ts(c.end) + '\n' + (c.text || '') + '\n';
    }).join('\n');
  }

  function renderSubEditor() {
    const body = document.getElementById('subEditorBody');
    if (!body) return;
    body.innerHTML = '';
    if (!subCues.length) {
      body.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">No subtitles loaded. Load SRT or generate English.</td></tr>';
      return;
    }
    subCues.forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td>' +
        '<td><input class="sub-time" data-i="' + i + '" data-f="start" value="' + c.start.toFixed(3) + '" /></td>' +
        '<td><input class="sub-time" data-i="' + i + '" data-f="end" value="' + c.end.toFixed(3) + '" /></td>' +
        '<td><input data-i="' + i + '" data-f="text" value="' + String(c.text || '').replace(/"/g, '&quot;') + '" /></td>' +
        '<td><button type="button" data-jump="' + i + '">▶</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = parseInt(inp.dataset.i, 10);
        const f = inp.dataset.f;
        if (!subCues[i]) return;
        if (f === 'text') subCues[i].text = inp.value;
        else subCues[i][f] = parseFloat(inp.value) || 0;
        cacheSubsForCurrent();
      });
    });
    body.querySelectorAll('[data-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-jump'), 10);
        if (subCues[i]) video.currentTime = subCues[i].start;
      });
    });
  }

  function cacheKey() {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      return 'zephyr-sub-' + (playlist[currentIndex].fullName || playlist[currentIndex].name);
    }
    return null;
  }
  function cacheSubsForCurrent() {
    const k = cacheKey();
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(subCues)); } catch {}
  }
  function loadCachedSubs() {
    const k = cacheKey();
    if (!k) return false;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length) {
        subCues = data;
        return true;
      }
    } catch {}
    return false;
  }

  // When playing new file, try cache
  const _playIndexOrig = playIndex;
  // can't easily wrap; hook loadedmetadata already exists - add listener
  video.addEventListener('loadedmetadata', () => {
    if (!subCues.length && loadCachedSubs()) {
      showOSD('Loaded cached subtitles');
      renderSubEditor();
    }
  });

  async function updateAiStatus() {
    const el = document.getElementById('subAiStatus');
    if (!el) return;
    let whisper = false;
    if (window.electronAPI && window.electronAPI.detectWhisper) {
      try {
        const r = await window.electronAPI.detectWhisper();
        whisper = r && r.ok;
      } catch {}
    }
    el.textContent = whisper
      ? 'Whisper found. Generate will transcribe when no existing subs.'
      : 'No whisper-cli found. Place whisper-cli.exe + models/ggml-*.bin next to the app for local speech-to-text. SRT load/edit/sync works offline.';
  }

  const genEnSubBtn = document.getElementById('genEnSubBtn');
  if (genEnSubBtn) genEnSubBtn.addEventListener('click', async () => {
    const status = document.getElementById('subAiStatus');
    if (subCues.length) {
      if (status) status.textContent = 'Existing subtitles loaded. Edit, sync, or save SRT below. All local.';
      showOSD('Using existing subtitles');
      renderSubEditor();
      return;
    }
    if (loadCachedSubs()) {
      showOSD('Restored cached subtitles');
      renderSubEditor();
      return;
    }
    const mediaPath = (currentIndex >= 0 && playlist[currentIndex] && playlist[currentIndex].path)
      ? playlist[currentIndex].path : null;
    if (!mediaPath) {
      showOSD('Open a local file first');
      if (status) status.textContent = 'Need a local file path for offline speech-to-text.';
      return;
    }
    if (!window.electronAPI || !window.electronAPI.generateLocalSubs) {
      showOSD('Local generate unavailable');
      return;
    }
    const model = ((document.getElementById('whisperModel') || {}).value || 'base');
    if (status) status.textContent = 'Running local whisper-cli (' + model + ')… this can take a while.';
    showOSD('Generating subtitles locally…');
    try {
      const res = await window.electronAPI.generateLocalSubs(mediaPath, model);
      if (res && res.ok && res.content) {
        // parse SRT into subCues
        const blocks = res.content.replace(/\r/g, '').split(/\n\n+/);
        const cues = [];
        blocks.forEach(block => {
          const lines = block.trim().split('\n');
          if (lines.length < 2) return;
          let idx = 0;
          if (/^\d+$/.test(lines[0].trim())) idx = 1;
          const times = lines[idx] || '';
          const tm = times.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
          if (!tm) return;
          const toSec = (h,m,s,ms) => (+h)*3600+(+m)*60+(+s)+(+ms)/1000;
          const text = lines.slice(idx + 1).join('\n');
          cues.push({ start: toSec(tm[1],tm[2],tm[3],tm[4]), end: toSec(tm[5],tm[6],tm[7],tm[8]), text });
        });
        subCues = cues;
        cacheSubsForCurrent();
        renderSubEditor();
        if (status) status.textContent = 'Generated ' + cues.length + ' cues locally.';
        showOSD('Subtitles ready');
      } else {
        if (status) status.textContent = (res && res.error) || 'Generate failed';
        showOSD('Generate failed – see status');
      }
    } catch (e) {
      if (status) status.textContent = String(e.message || e);
      showOSD('Generate error');
    }
  });

  const subBrowseLoadBtn = document.getElementById('subBrowseLoadBtn');
  if (subBrowseLoadBtn) subBrowseLoadBtn.addEventListener('click', () => { if (subInput) subInput.click(); });
  const subBrowseSaveBtn = document.getElementById('subBrowseSaveBtn');
  if (subBrowseSaveBtn) subBrowseSaveBtn.addEventListener('click', async () => {
    if (!subCues.length) { showOSD('No subtitles to save'); return; }
    const content = cuesToSrt(subCues);
    if (window.electronAPI && window.electronAPI.saveSrt) {
      const name = (playlist[currentIndex] && playlist[currentIndex].name) ? playlist[currentIndex].name + '.en.srt' : 'subtitles.en.srt';
      const res = await window.electronAPI.saveSrt(content, name);
      showOSD(res && res.ok ? 'Subtitles saved' : 'Save cancelled');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
      a.download = 'subtitles.srt';
      a.click();
    }
  });

  function nudgeSubSync(delta) {
    subDelaySec = (subDelaySec || 0) + delta;
    if (subDelayEl) {
      subDelayEl.value = subDelaySec;
      if (subDelayVal) subDelayVal.textContent = (subDelaySec >= 0 ? '+' : '') + subDelaySec.toFixed(1) + 's';
    }
    // Also shift cue times permanently option: apply to cues
    subCues.forEach(c => { c.start = Math.max(0, c.start + delta); c.end = Math.max(0, c.end + delta); });
    renderSubEditor();
    cacheSubsForCurrent();
    showOSD('Sub sync ' + (delta >= 0 ? '+' : '') + delta + 's');
  }
  const subSyncMinus = document.getElementById('subSyncMinus');
  const subSyncPlus = document.getElementById('subSyncPlus');
  const subSyncReset = document.getElementById('subSyncReset');
  if (subSyncMinus) subSyncMinus.addEventListener('click', () => nudgeSubSync(-0.5));
  if (subSyncPlus) subSyncPlus.addEventListener('click', () => nudgeSubSync(0.5));
  if (subSyncReset) subSyncReset.addEventListener('click', () => {
    subDelaySec = 0;
    if (subDelayEl) { subDelayEl.value = 0; if (subDelayVal) subDelayVal.textContent = '0.0s'; }
    showOSD('Sync reset (reload SRT to restore original times if shifted)');
  });

  // After external sub load, refresh editor
  if (subInput) {
    subInput.addEventListener('change', () => {
      setTimeout(() => { renderSubEditor(); cacheSubsForCurrent(); }, 200);
    });
  }

  
  // ===== Settings X, More menu, skins, About, panel outside-click =====
  const moreBtn = document.getElementById('moreBtn');
  const moreMenu = document.getElementById('moreMenu');
  const closeMoreMenu = document.getElementById('closeMoreMenu');
  const aboutBtn = document.getElementById('aboutBtn');
  const aboutPanel = document.getElementById('aboutPanel');
  const closeAbout = document.getElementById('closeAbout');
  const aboutCloseBtn = document.getElementById('aboutCloseBtn');

  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.hidden = !moreMenu.hidden;
      if (!moreMenu.hidden) positionMenu(moreMenu, moreBtn);
    });
  }
  if (closeMoreMenu) closeMoreMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreMenu) moreMenu.hidden = true;
  });
  if (moreMenu) moreMenu.addEventListener('click', (e) => e.stopPropagation());

  // When opening tools from More, hide menu
  ['videoAdjBtn','geomBtn','eqBtn','infoBtn','bookmarkBtn','chapterBtn','sleepBtn','frameBackBtn','frameFwdBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      if (moreMenu) moreMenu.hidden = true;
    });
  });

  async function openAbout() {
    if (moreMenu) moreMenu.hidden = true;
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    if (aboutPanel) aboutPanel.hidden = false;
    const v = document.getElementById('aboutVersion');
    if (v && window.electronAPI && window.electronAPI.getAppInfo) {
      try {
        const info = await window.electronAPI.getAppInfo();
        if (info && info.version) v.textContent = info.version;
      } catch {}
    }
  }
  if (aboutBtn) aboutBtn.addEventListener('click', openAbout);
  if (closeAbout) closeAbout.addEventListener('click', (e) => {
    e.stopPropagation();
    if (aboutPanel) aboutPanel.hidden = true;
  });
  if (aboutCloseBtn) aboutCloseBtn.addEventListener('click', () => {
    if (aboutPanel) aboutPanel.hidden = true;
  });

  // Every settings panel: click X works + Escape closes all
  document.querySelectorAll('.settings-panel .settings-header .icon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panel = btn.closest('.settings-panel');
      if (panel) panel.hidden = true;
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
      if (moreMenu) moreMenu.hidden = true;
    }
  });

  // Skins
  const settingTheme = document.getElementById('settingTheme');
  function applySkin(name) {
    document.body.classList.remove('skin-amoled', 'skin-ocean', 'skin-forest', 'theme-light');
    if (name === 'light') document.body.classList.add('theme-light');
    else if (name === 'amoled') document.body.classList.add('skin-amoled');
    else if (name === 'ocean') document.body.classList.add('skin-ocean');
    else if (name === 'forest') document.body.classList.add('skin-forest');
    localStorage.setItem('zephyr-skin', name || 'dark');
  }
  if (settingTheme) {
    const saved = localStorage.getItem('zephyr-skin') || 'dark';
    settingTheme.value = saved;
    applySkin(saved);
    settingTheme.addEventListener('change', () => applySkin(settingTheme.value));
  }

  // Performance prefs stored for next mpv launch
  ['settingPerf','settingVo','settingHwdec'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = 'zephyr-' + id;
    const saved = localStorage.getItem(key);
    if (saved) el.value = saved;
    el.addEventListener('change', () => {
      localStorage.setItem(key, el.value);
      showOSD('Applies on next mpv play');
    });
  });

  
  // ===== Library, TV parse, TMDB, ASS style, advanced audio, network, assoc =====
  const LIB_KEY = 'zephyr-library-v1';
  const RECENT_KEY = 'zephyr-recent-v1';

  function loadLib() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; }
  }
  function saveLib(list) {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(list.slice(0, 4000))); } catch {}
  }
  function loadRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  }
  function pushRecent(item) {
    let r = loadRecent().filter(x => x.path !== item.path);
    r.unshift({
      path: item.path,
      name: item.name,
      title: item.title || item.name,
      poster: item.poster || null,
      progress: item.progress || 0,
      at: Date.now()
    });
    r = r.slice(0, 80);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch {}
  }

  function parseTv(filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    let m = base.match(/[.\s_\-][Ss](\d{1,2})[Ee](\d{1,3})(?:[.\s_\-]|$)/);
    if (!m) m = base.match(/(\d{1,2})[xX](\d{1,3})(?:[.\s_\-]|$)/);
    if (m) {
      const season = parseInt(m[1], 10);
      const episode = parseInt(m[2], 10);
      let show = base.slice(0, m.index).replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
      return { isTv: true, show, season, episode, title: show + ' S' + String(season).padStart(2,'0') + 'E' + String(episode).padStart(2,'0') };
    }
    // movie: strip year
    const y = base.match(/[.\s_\-](19|20)\d{2}[.\s_\-]/);
    let title = base.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
    let year = null;
    if (y) {
      year = y[0].replace(/\D/g, '');
      title = base.slice(0, y.index).replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim() || title;
    }
    return { isTv: false, show: null, season: null, episode: null, title, year };
  }

  function watchedPctFor(path, durationHint) {
    try {
      const name = path.split(/[/\\]/).pop();
      const pos = parseFloat(localStorage.getItem('zephyr-pos-' + name) || '0');
      if (!pos) return 0;
      // duration often unknown offline — estimate from last known
      const dur = parseFloat(localStorage.getItem('zephyr-dur-' + name) || durationHint || '0');
      if (dur > 0) return Math.min(100, Math.round((pos / dur) * 100));
      return pos > 30 ? 5 : 0;
    } catch { return 0; }
  }

  // save duration when known
  video.addEventListener('loadedmetadata', () => {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      try {
        localStorage.setItem('zephyr-dur-' + playlist[currentIndex].fullName, String(video.duration || 0));
      } catch {}
      const item = playlist[currentIndex];
      if (item.path) {
        const meta = parseTv(item.fullName || item.name);
        pushRecent({
          path: item.path,
          name: item.fullName || item.name,
          title: meta.title,
          progress: watchedPctFor(item.path, video.duration)
        });
        // update library progress
        const lib = loadLib();
        const ix = lib.findIndex(x => x.path === item.path);
        if (ix >= 0) {
          lib[ix].progress = watchedPctFor(item.path, video.duration);
          saveLib(lib);
        }
      }
    }
  });

  function renderLibraryList(list, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    if (!list.length) {
      el.innerHTML = '<p class="settings-note">Empty. Scan a folder or play files to fill Recent.</p>';
      return;
    }
    // Group TV shows
    const shows = {};
    const movies = [];
    list.forEach(item => {
      const meta = item.meta || parseTv(item.name || item.path || '');
      if (meta.isTv && meta.show) {
        if (!shows[meta.show]) shows[meta.show] = [];
        shows[meta.show].push({ item, meta });
      } else {
        movies.push({ item, meta });
      }
    });
    function card(item, meta) {
      const pct = item.progress != null ? item.progress : watchedPctFor(item.path);
      const div = document.createElement('div');
      div.className = 'lib-card';
      const poster = item.poster
        ? '<img class="lib-poster" src="' + item.poster + '" alt="" />'
        : '<div class="lib-poster"></div>';
      let line2 = '';
      if (meta.isTv) line2 = 'S' + meta.season + 'E' + meta.episode + (item.year ? ' · ' + item.year : '');
      else line2 = (meta.year || '') + (item.size ? (meta.year ? ' · ' : '') + formatSize(item.size) : '');
      div.innerHTML = poster +
        '<div class="lib-info"><div class="lib-title">' + (item.title || meta.title || item.name) + '</div>' +
        '<div class="lib-meta">' + line2 + (pct ? ' · ' + pct + '%' : '') + '</div>' +
        '<div class="lib-progress"><span style="width:' + pct + '%"></span></div></div>';
      div.addEventListener('click', () => {
        if (item.path) {
          addNativePaths([item.path]);
          const i = playlist.findIndex(p => p.path === item.path);
          if (i >= 0) playIndex(i);
        }
      });
      return div;
    }
    Object.keys(shows).sort().forEach(show => {
      const h = document.createElement('div');
      h.className = 'lib-show-header';
      h.textContent = show;
      el.appendChild(h);
      shows[show]
        .sort((a, b) => (a.meta.season - b.meta.season) || (a.meta.episode - b.meta.episode))
        .forEach(({ item, meta }) => el.appendChild(card(item, meta)));
    });
    if (movies.length) {
      const h = document.createElement('div');
      h.className = 'lib-show-header';
      h.textContent = 'Movies / other';
      el.appendChild(h);
      movies.forEach(({ item, meta }) => el.appendChild(card(item, meta)));
    }
  }

  function switchSideTab(tab) {
    document.querySelectorAll('.side-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const pl = document.getElementById('playlist');
    const lv = document.getElementById('libraryView');
    const rv = document.getElementById('recentView');
    const qt = document.getElementById('queueTools');
    if (pl) pl.hidden = tab !== 'queue';
    if (qt) qt.hidden = tab !== 'queue';
    if (lv) lv.hidden = tab !== 'library';
    if (rv) rv.hidden = tab !== 'recent';
    if (tab === 'library') renderLibraryList(loadLib(), 'libraryList');
    if (tab === 'recent') renderLibraryList(loadRecent(), 'recentList');
  }
  document.querySelectorAll('.side-tab').forEach(b => {
    b.addEventListener('click', () => switchSideTab(b.dataset.tab));
  });

  const libScanBtn = document.getElementById('libScanBtn');
  if (libScanBtn) libScanBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.scanLibraryFolder) {
      showOSD('Desktop only');
      return;
    }
    showOSD('Scanning…');
    const res = await window.electronAPI.scanLibraryFolder();
    if (!res || !res.ok) { showOSD('Scan cancelled'); return; }
    const lib = loadLib();
    const map = new Map(lib.map(x => [x.path, x]));
    res.files.forEach(f => {
      const meta = parseTv(f.name);
      const prev = map.get(f.path) || {};
      map.set(f.path, {
        path: f.path,
        name: f.name,
        size: f.size,
        title: prev.title || meta.title,
        year: prev.year || meta.year,
        poster: prev.poster || null,
        overview: prev.overview || null,
        meta,
        progress: watchedPctFor(f.path)
      });
    });
    const next = Array.from(map.values());
    saveLib(next);
    renderLibraryList(next, 'libraryList');
    showOSD(res.files.length + ' files in library');
  });

  // TMDB metadata removed (local-only)

  const libSearch = document.getElementById('libSearch');
  if (libSearch) libSearch.addEventListener('input', () => {
    const q = libSearch.value.trim().toLowerCase();
    let list = loadLib();
    if (q) list = list.filter(x => (x.title || x.name || '').toLowerCase().includes(q));
    renderLibraryList(list, 'libraryList');
  });

  function applyAssStyleLocal() {
  const scale = (document.getElementById('assScale')?.value || 100) / 100;
  const color = document.getElementById('assColor')?.value || '#ffffff';
  const outline = document.getElementById('assOutline')?.value || '#000000';
  const outlineW = document.getElementById('assOutlineW')?.value || 2;
  const shadow = document.getElementById('assShadow')?.value || 1;
  const back = document.getElementById('assBack')?.checked || false;
  const bold = document.getElementById('assBold')?.checked || false;
  const font = document.getElementById('assFont')?.value || 'Sans';

  if (subtitleDisplay) {
    subtitleDisplay.style.fontSize = (scale * 100) + '%';
    subtitleDisplay.style.color = color;
    subtitleDisplay.style.fontFamily = font;
    subtitleDisplay.style.fontWeight = bold ? 'bold' : 'normal';
    subtitleDisplay.style.textShadow = `${outlineW}px ${outlineW}px ${shadow}px ${outline}`;
    subtitleDisplay.style.background = back ? 'rgba(0,0,0,0.6)' : 'transparent';
    subtitleDisplay.style.padding = back ? '2px 6px' : '0';
  }
}

  // no online metadata settings

  const assApplyBtn = document.getElementById('assApplyBtn');
  if (assApplyBtn) assApplyBtn.addEventListener('click', async () => {
    applyAssStyleLocal();
    const scale = parseInt((document.getElementById('assScale') || {}).value || 100, 10) / 100;
    if (window.electronAPI && window.electronAPI.mpvSetTracks) {
      await window.electronAPI.mpvSetTracks({ subScale: scale });
    }
    showOSD('Subtitle style applied');
  });
  ['assScale','assColor','assOutlineW','assShadow','assBack','assBold','assFont'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', applyAssStyleLocal);
  });

  // Advanced audio apply
  const audAdvApplyBtn = document.getElementById('audAdvApplyBtn');
  if (audAdvApplyBtn) audAdvApplyBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !window.electronAPI.mpvPlayExternal) {
      showOSD('mpv required');
      return;
    }
    // Stash prefs; next playWithMpv could read them — apply by reopening current
    const prefs = {
      replaygain: (document.getElementById('audReplayGain') || {}).value,
      delay: (document.getElementById('audDelay') || {}).value,
      channels: (document.getElementById('audChannels') || {}).value,
      downmix: !!(document.getElementById('audDownmix') || {}).checked,
      bitstream: !!(document.getElementById('audBitstream') || {}).checked,
      vis: (document.getElementById('audVis') || {}).value
    };
    localStorage.setItem('zephyr-audio-adv', JSON.stringify(prefs));
    showOSD('Audio prefs saved – re-open with mpv');
    if (currentIndex >= 0 && playlist[currentIndex] && playlist[currentIndex].path) {
      await playWithMpv([playlist[currentIndex].path], getQuality());
    }
  });

  // Network open
  const networkOpenBtn = document.getElementById('networkOpenBtn');
  if (networkOpenBtn) networkOpenBtn.addEventListener('click', async () => {
    const pathVal = ((document.getElementById('networkPath') || {}).value || '').trim();
    if (!pathVal) { showOSD('Enter a path or URL'); return; }
    if (/^https?:|^rtsp:|^rtsps:|^udp:|^smb:/i.test(pathVal)) {
      if (window.electronAPI && window.electronAPI.mpvPlayUrl) {
        await window.electronAPI.mpvPlayUrl(pathVal, getQuality(), true);
        showOSD('Opening stream');
      } else {
        playlist.push({ name: pathVal, fullName: pathVal, url: pathVal, size: 0, type: '', path: null });
        renderPlaylist();
        playIndex(playlist.length - 1);
      }
    } else {
      // UNC or local path
      addNativePaths([pathVal.replace(/^smb:/i, '')]);
    }
    const np = document.getElementById('networkPanel');
    if (np) np.hidden = true;
  });

  // File association
  const assocExportBtn = document.getElementById('assocExportBtn');
  if (assocExportBtn) assocExportBtn.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.exportAssocReg) {
      const res = await window.electronAPI.exportAssocReg();
      showOSD(res && res.ok ? 'Saved .reg – double-click to merge' : 'Cancelled');
    }
  });
  const assocOpenDefaultsBtn = document.getElementById('assocOpenDefaultsBtn');
  if (assocOpenDefaultsBtn) assocOpenDefaultsBtn.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.openDefaultApps) await window.electronAPI.openDefaultApps();
  });

  // Wire more-menu buttons to panels
  function openPanel(id) {
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    const moreMenu = document.getElementById('moreMenu');
    if (moreMenu) moreMenu.hidden = true;
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  const assStyleBtn = document.getElementById('assStyleBtn');
  const audioAdvBtn = document.getElementById('audioAdvBtn');
  const networkBtn = document.getElementById('networkBtn');
  const assocBtn = document.getElementById('assocBtn');
  if (assStyleBtn) assStyleBtn.addEventListener('click', () => openPanel('assStylePanel'));
  if (audioAdvBtn) audioAdvBtn.addEventListener('click', () => openPanel('audioAdvPanel'));
  if (networkBtn) networkBtn.addEventListener('click', () => openPanel('networkPanel'));
  if (assocBtn) assocBtn.addEventListener('click', () => openPanel('assocPanel'));

  refreshMpvStatus();

  // ===== Paste button for URL input =====
const pasteUrlBtn = document.getElementById('pasteUrlBtn');

if (pasteUrlBtn && urlInput) {
  pasteUrlBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        urlInput.value = text.trim();
        urlInput.focus();
        showOSD('Link pasted');
      } else {
        showOSD('Clipboard is empty');
      }
    } catch (err) {
      showOSD('Paste failed – use Ctrl+V');
    }
  });
}
})();

