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
    // the DOM sits under a native mpv window, so mirror the message into mpv's own OSD
    if (typeof engine !== 'undefined' && engine === 'mpv' && window.electronAPI && window.electronAPI.mpvCommand) {
      window.electronAPI.mpvCommand('show-text', [String(text), ms]).catch(() => {});
    }
  }

  /* ====================================================================== */
  /*  Engine core: HTML5 <video> + mpv (IPC-controlled), playlist, subtitles  */
  /* ====================================================================== */
  const api = () => window.electronAPI || null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch {} }
  function posKey(item) { return 'zephyr-pos2-' + ((item && (item.path || item.url || item.fullName)) || ''); }

  // Containers/codecs the browser engine cannot do (or does poorly: no embedded subs / multi-audio) -> mpv first.
  const MPV_PREFERRED = /\.(mkv|avi|ts|m2ts|mts|wmv|flv|mpg|mpeg|m2v|asf|rm|rmvb|vob|divx|ogm|mxf|f4v|ape|wv|mka|ac3|eac3|dts|amr|mpc|tta)$/i;
  const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|ts|m2ts|mts|mpg|mpeg|m2v|3gp|3g2|ogv|ogm|vob|asf|divx|f4v|rm|rmvb)$/i;
  function needsMpvContainer(fullName) { return MPV_PREFERRED.test(fullName || ''); }

  // Which engine is active, and the mirrored mpv state (driven by IPC events from the main process).
  let engine = 'html5';          // 'html5' | 'mpv'
  let mpvMode = 'off';           // embed mode actually in use
  let loadToken = 0;             // invalidates stale async work when the user switches items quickly
  let errorStreak = 0;
  let volumeLevel = 1;
  let userMuted = false;
  let speedRate = 1;
  const mp = { active: false, time: 0, duration: 0, paused: true, eof: false, tracks: [] };

  const isMpv = () => engine === 'mpv';
  const curTime = () => (isMpv() ? mp.time : (video.currentTime || 0));
  const curDur = () => { const d = isMpv() ? mp.duration : video.duration; return isFinite(d) && d > 0 ? d : 0; };
  const hasMedia = () => (isMpv() ? mp.active : !!video.getAttribute('src'));

  function mpvCmd(name, ...args) {
    const a = api();
    if (!a || !a.mpvCommand) return Promise.resolve({ ok: false });
    return a.mpvCommand(name, args).catch(() => ({ ok: false }));
  }
  function mpvSet(name, value) {
    const a = api();
    if (!a || !a.mpvSetProps) return Promise.resolve({ ok: false });
    return a.mpvSetProps({ [name]: value }).catch(() => ({ ok: false }));
  }

  const history = [];   // items (not indices) so reordering/sorting can never break "previous"
  const playedSet = new Set();   // shuffle: items already played in the current cycle
  const plFilterEl = document.getElementById('plFilter');
  const plSortEl = document.getElementById('plSort');
  let plFilter = '';
  let dragItem = null;

  const BROWSER_V = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora']);
  const BROWSER_A = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le']);
  // Does the browser engine decode this? (HEVC/x265, AC3/DTS, MPEG-2, VC-1... it does not -> mpv straight away)
  function browserCanPlay(info) {
    if (!info) return true;
    if (info.vcodec && info.hasVideo && !BROWSER_V.has(info.vcodec)) return false;
    if (info.acodec && !BROWSER_A.has(info.acodec)) return false;
    if (info.bitDepth > 8 && info.hasVideo) return false;       // 10-bit H.264 is not hardware/browser friendly
    return true;
  }
  const itemDuration = (it) => (it.info && it.info.duration) || it.duration || 0;

  function makeItem(m) {
    const fullName = m.name || String(m.path).split(/[/\\]/).pop();
    return {
      name: m.title || fullName.replace(/\.[^/.]+$/, ''), fullName, size: m.size || 0, type: '',
      path: m.path, url: pathToFileUrl(m.path), subPath: m.subPath || null, addedAt: Date.now()
    };
  }
  function makeStreamItem(url, title, duration) {
    const label = title || (url.length > 70 ? url.slice(0, 67) + '…' : url);
    return { name: label, fullName: url, size: 0, type: '', path: null, url, stream: true, duration: duration || 0, addedAt: Date.now() };
  }

  // ------------------------------------------------------- probing (duration, codecs, tracks, posters)
  let pActive = 0; const pQueue = [];
  function limited(fn, max) {
    return new Promise((resolve) => {
      const run = () => { pActive++; fn().catch(() => null).then((r) => { pActive--; resolve(r); const n = pQueue.shift(); if (n) n(); }); };
      if (pActive < max) run(); else pQueue.push(run);
    });
  }
  function applyInfo(item, info) {
    item.info = info;
    if (!item.size && info.size) item.size = info.size;
    if (!browserCanPlay(info)) item.forceMpv = true;
    if (!info.hasVideo && info.title && !item._renamed) {
      item.name = (info.artist ? info.artist + ' – ' : '') + info.title;      // music: tags beat file names
    }
    updateRow(item);
    if (playlist[currentIndex] === item) { videoTitle.textContent = item.name; }
    savePlaylistSoon();
  }
  function probeItem(item) {
    const a = api();
    if (item.info) return Promise.resolve(item.info);
    if (item._probe) return item._probe;
    if (!item.path || !a || !a.probeMedia) return Promise.resolve(null);
    item._probe = limited(async () => {
      const info = await a.probeMedia(item.path);
      if (info && info.ok) applyInfo(item, info);
      else if (info && info.error === 'missing') { item.missing = true; updateRow(item); }
      return item.info || null;
    }, 4).then((r) => { item._probe = null; return r; });
    return item._probe;
  }
  let tActive = 0; const tQueue = [];
  function queueThumb(item) {
    const a = api();
    if (item.thumb || item._thumbing || !item.path || !a || !a.thumbMedia || !(item.info && (item.info.hasVideo || item.info.hasCover))) return;
    item._thumbing = true;
    const run = async () => {
      tActive++;
      try {
        const r = await a.thumbMedia(item.path, itemDuration(item), !item.info.hasVideo);
        if (r && r.ok && r.path) { item.thumb = pathToFileUrl(r.path); updateRow(item); }
      } catch {}
      tActive--; item._thumbing = false;
      const n = tQueue.shift(); if (n) n();
    };
    if (tActive < 2) run(); else tQueue.push(run);
  }
  const thumbObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting && en.target._item) { thumbObserver.unobserve(en.target); queueThumb(en.target._item); }
    }), { root: playlistEl, rootMargin: '240px' })
    : null;

  // ------------------------------------------------------- playlist persistence (restored on next launch)
  let saveTimer = null;
  function savePlaylistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const cur = playlist[currentIndex];
        lsSet('zephyr-playlist-v1', JSON.stringify({
          cur: cur ? (cur.path || cur.url) : null,
          items: playlist.slice(0, 1500).map((it) => ({ p: it.path || null, u: it.stream ? it.url : null, n: it.name, d: Math.round(itemDuration(it)) }))
        }));
      } catch {}
    }, 600);
  }
  function restorePlaylist() {
    let saved;
    try { saved = JSON.parse(lsGet('zephyr-playlist-v1') || 'null'); } catch { saved = null; }
    if (!saved || !Array.isArray(saved.items) || !saved.items.length || playlist.length) return;
    for (const s of saved.items) {
      if (s.u) playlist.push(makeStreamItem(s.u, s.n, s.d));
      else if (s.p) { const it = makeItem({ path: s.p, name: String(s.p).split(/[/\\]/).pop() }); if (s.n) it.name = s.n; if (s.d) it.duration = s.d; playlist.push(it); }
    }
    const idx = playlist.findIndex((it) => (it.path || it.url) === saved.cur);
    if (idx >= 0) { currentIndex = idx; videoTitle.textContent = playlist[idx].name; videoSubtitle.textContent = 'Press play to continue where you left off'; }
    renderPlaylist();
    playlist.forEach((it) => { probeItem(it); });
  }

  // ---------------------------------------------------------------- playlist
  function addFiles(files) {
    const list = Array.from(files || []);
    const a = api();
    const paths = a && a.getPathForFile ? list.map(f => a.getPathForFile(f)).filter(Boolean) : [];
    if (a && a.expandPaths && paths.length) { addNativePaths(paths); return; }

    // Plain-browser fallback (no Electron bridge): blob URLs, browser engine only.
    const subs = list.filter(f => /\.(srt|vtt|ass|ssa)$/i.test(f.name || ''));
    const media = list.filter(f => !subs.includes(f) && (/^(video|audio)\//.test(f.type || '') || VIDEO_EXT.test(f.name || '') ||
      /\.(mp3|flac|wav|aac|m4a|opus|ogg|oga)$/i.test(f.name || '')));
    media.forEach(file => playlist.push({
      name: file.name.replace(/\.[^/.]+$/, ''), fullName: file.name, url: URL.createObjectURL(file),
      size: file.size, type: file.type || '', path: null, addedAt: Date.now()
    }));
    if (subs.length && playlist.length) loadExternalSub(subs[0]);
    renderPlaylist();
    if (currentIndex === -1 && playlist.length) playIndex(0);
  }

  async function addNativePaths(paths, opts = {}) {
    const a = api();
    paths = (paths || []).filter(p => typeof p === 'string' && p);
    if (!paths.length) return;
    let media = [], subs = [];
    if (a && a.expandPaths) {
      const r = await a.expandPaths(paths).catch(() => null);
      if (r) { media = r.media || []; subs = r.subs || []; }
    } else {
      media = paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop(), size: 0 }));
    }
    if (!media.length && !subs.length) { showOSD('No playable media found'); return; }

    const byPath = new Map(playlist.map((it, i) => [it.path, i]));
    let firstIdx = -1;
    const fresh = [];
    media.forEach((m, n) => {
      if (byPath.has(m.path)) { if (firstIdx < 0) firstIdx = byPath.get(m.path); return; }
      const item = makeItem(m);
      if (n === 0 && subs.length) item.subPath = subs[0];
      playlist.push(item);
      fresh.push(item);
      byPath.set(m.path, playlist.length - 1);
      if (firstIdx < 0) firstIdx = playlist.length - 1;
    });
    renderPlaylist();
    fresh.forEach(probeItem);                       // durations / codecs / posters fill in as they are read
    if (!media.length && subs.length) { loadSubFromPath(subs[0]); return; }
    if (media.length > 1) showOSD(media.length + ' files added');
    if (firstIdx >= 0 && (opts.play || currentIndex === -1)) playIndex(firstIdx);
    savePlaylistSoon();
  }

  // ---- row rendering
  const CODEC_NAMES = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg2video: 'MPEG-2', mpeg4: 'MPEG-4', vc1: 'VC-1', wmv3: 'WMV',
    aac: 'AAC', ac3: 'AC3', eac3: 'E-AC3', dts: 'DTS', truehd: 'TrueHD', flac: 'FLAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC', pcm_s16le: 'PCM', wmav2: 'WMA' };
  const codecName = (c) => CODEC_NAMES[c] || String(c || '').toUpperCase();
  function resLabel(i) {
    const h = Math.max(i.height || 0, Math.round((i.width || 0) * 9 / 16));
    return h >= 2000 ? '4K' : h >= 1400 ? '1440p' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : h >= 460 ? '480p' : (i.height ? i.height + 'p' : '');
  }
  function metaParts(item) {
    const parts = [];
    const i = item.info;
    if (item.missing) return ['File not found'];
    if (item.stream) parts.push('Stream');
    if (i) {
      if (i.hasVideo) { const r = resLabel(i); if (r) parts.push(r); if (i.vcodec) parts.push(codecName(i.vcodec)); if (i.bitDepth >= 10) parts.push('10-bit'); if (i.hdr) parts.push(i.hdr); }
      else if (i.acodec) parts.push(codecName(i.acodec));
      if (i.audioTracks > 1) parts.push(i.audioTracks + ' audio');
      if (i.subTracks) parts.push(i.subTracks + ' subs');
    }
    if (item.size) parts.push(formatSize(item.size));
    return parts;
  }

  function buildRow(item, i) {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (i === currentIndex ? ' active' : '') + (item.missing ? ' missing' : '');
    li._item = item;
    li.draggable = !plFilter;
    const idx = document.createElement('span'); idx.className = 'index'; idx.textContent = String(i + 1);
    const th = document.createElement('div'); th.className = 'thumb';
    const artUrl = (window.ZApp && window.ZApp.artFor) ? window.ZApp.artFor(item) : item.thumb;
    if (artUrl) { const img = document.createElement('img'); img.src = artUrl; img.alt = ''; img.loading = 'lazy'; th.appendChild(img); }
    else th.appendChild(window.ZIcons ? window.ZIcons.make(item.stream ? 'network' : (item.info && !item.info.hasVideo ? 'music' : 'film')) : document.createTextNode(''));
    const dur = itemDuration(item);
    if (dur > 0) { const b = document.createElement('span'); b.className = 'dur'; b.textContent = formatTime(dur); th.appendChild(b); }
    const info = document.createElement('div'); info.className = 'info';
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = item.name; nm.title = item.fullName;
    const meta = document.createElement('div'); meta.className = 'meta';
    metaParts(item).forEach((t, n) => { const s = document.createElement('span'); s.className = 'chip' + (n === 0 && item.missing ? ' bad' : ''); s.textContent = t; meta.appendChild(s); });
    info.append(nm, meta);
    const rm = document.createElement('button'); rm.className = 'remove'; rm.title = 'Remove'; rm.appendChild(window.ZIcons ? window.ZIcons.make('close') : document.createTextNode('✕'));
    const pb = document.createElement('div'); pb.className = 'pbar';
    const pf = document.createElement('i'); pb.appendChild(pf);
    const saved = getSavedPos(item);
    pf.style.width = dur > 0 && saved > 0 ? Math.min(100, saved / dur * 100) + '%' : '0%';
    li.append(idx, th, info, rm, pb);

    li.addEventListener('click', e => { if (!e.target.closest('.remove')) playIndex(playlist.indexOf(item)); });
    rm.addEventListener('click', e => { e.stopPropagation(); removeIndex(playlist.indexOf(item)); });

    li.addEventListener('dragstart', e => {
      if (plFilter) { e.preventDefault(); return; }
      dragItem = item; li.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'zephyr-item'); } catch {}
    });
    li.addEventListener('dragend', () => { dragItem = null; li.classList.remove('dragging'); playlistEl.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    li.addEventListener('dragover', e => {
      if (!dragItem || dragItem === item) return;
      e.preventDefault();
      const r = li.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
      li.classList.toggle('drop-before', before); li.classList.toggle('drop-after', !before);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', e => {
      if (!dragItem) return;
      e.preventDefault(); e.stopPropagation();
      const r = li.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
      moveItem(dragItem, item, before);
      dragItem = null;
    });

    if (!item.thumb && item.info && (item.info.hasVideo || item.info.hasCover)) { if (thumbObserver) thumbObserver.observe(li); else queueThumb(item); }
    return li;
  }

  function matchesFilter(item) {
    if (!plFilter) return true;
    return (item.name + ' ' + item.fullName).toLowerCase().includes(plFilter);
  }

  function updateFooter() {
    const total = playlist.reduce((s, it) => s + itemDuration(it), 0);
    const known = playlist.filter(it => itemDuration(it) > 0).length;
    const hrs = total / 3600;
    const dur = total > 0 ? ' · ' + (hrs >= 1 ? Math.floor(hrs) + 'h ' + Math.round((hrs % 1) * 60) + 'm' : Math.max(1, Math.round(total / 60)) + ' min') + (known < playlist.length ? '+' : '') : '';
    trackCount.textContent = `${playlist.length} track${playlist.length !== 1 ? 's' : ''}${dur}`;
  }

  function renderPlaylist() {
    playlistEl.textContent = '';
    if (!playlist.length) {
      const li = document.createElement('li');
      li.className = 'playlist-empty';
      li.append('No media yet.', document.createElement('br'), 'Open files, drop media or paste a link.');
      playlistEl.appendChild(li);
      trackCount.textContent = '0 tracks';
      return;
    }
    const frag = document.createDocumentFragment();
    let shown = 0;
    playlist.forEach((item, i) => {
      if (!matchesFilter(item)) { item._row = null; return; }
      const li = buildRow(item, i);
      item._row = li; shown++;
      frag.appendChild(li);
    });
    if (!shown) { const li = document.createElement('li'); li.className = 'playlist-empty'; li.textContent = 'Nothing matches "' + plFilter + '"'; frag.appendChild(li); }
    playlistEl.appendChild(frag);
    updateFooter();
    const active = playlistEl.querySelector('.playlist-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function updateRow(item) {
    const i = playlist.indexOf(item);
    if (i < 0) return;
    if (item._row && item._row.parentNode) {
      const li = buildRow(item, i);
      item._row.replaceWith(li);
      item._row = li;
    }
    updateFooter();
  }
  function updateRowProgress(item) {
    if (!item || !item._row) return;
    const pf = item._row.querySelector('.pbar i'); if (!pf) return;
    const d = itemDuration(item), s = getSavedPos(item);
    pf.style.width = d > 0 && s > 0 ? Math.min(100, s / d * 100) + '%' : '0%';
  }

  function moveItem(item, target, before) {
    const cur = playlist[currentIndex];
    const from = playlist.indexOf(item);
    if (from < 0) return;
    playlist.splice(from, 1);
    let to = playlist.indexOf(target);
    if (to < 0) to = playlist.length;
    playlist.splice(before ? to : to + 1, 0, item);
    currentIndex = cur ? playlist.indexOf(cur) : -1;
    renderPlaylist();
    savePlaylistSoon();
  }

  function sortPlaylist(mode) {
    if (!mode || !playlist.length) return;
    const cur = playlist[currentIndex];
    const by = (f, dir = 1) => (a, b) => dir * (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
    const nat = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
    let label = '';
    switch (mode) {
      case 'name': playlist.sort(nat); label = 'name'; break;
      case 'name-desc': playlist.sort((a, b) => -nat(a, b)); label = 'name (Z→A)'; break;
      case 'dur': playlist.sort(by(itemDuration)); label = 'shortest first'; break;
      case 'dur-desc': playlist.sort(by(itemDuration, -1)); label = 'longest first'; break;
      case 'size-desc': playlist.sort(by((x) => x.size || 0, -1)); label = 'largest first'; break;
      case 'added': playlist.sort(by((x) => x.addedAt || 0)); label = 'order added'; break;
      case 'random':
        for (let i = playlist.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [playlist[i], playlist[j]] = [playlist[j], playlist[i]]; }
        label = 'random'; break;
      case 'dedupe': {
        const seen = new Set(); const before = playlist.length;
        playlist = playlist.filter((it) => { const k = (it.path || it.url || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        showOSD(before - playlist.length + ' duplicate(s) removed'); label = null; break;
      }
      case 'missing': {
        const before = playlist.length; playlist = playlist.filter((it) => !it.missing);
        showOSD(before - playlist.length + ' missing file(s) removed'); label = null; break;
      }
    }
    currentIndex = cur ? playlist.indexOf(cur) : -1;
    if (label) showOSD('Sorted: ' + label);
    renderPlaylist();
    savePlaylistSoon();
  }

  function removeIndex(i) {
    const it = playlist[i];
    if (!it) return;
    if (it.url && it.url.startsWith('blob:')) URL.revokeObjectURL(it.url);
    playlist.splice(i, 1);
    for (let h = history.length - 1; h >= 0; h--) if (history[h] === it) history.splice(h, 1);
    playedSet.delete(it);
    if (currentIndex === i) {
      currentIndex = -1;
      if (playlist.length) playIndex(Math.min(i, playlist.length - 1), { noHistory: true });
      else resetPlayer();
    } else if (currentIndex > i) currentIndex--;
    renderPlaylist();
    savePlaylistSoon();
  }

  function clearPlaylist() {
    playlist.forEach(item => { if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url); });
    playlist = [];
    currentIndex = -1;
    history.length = 0;
    playedSet.clear();
    resetPlayer();
    renderPlaylist();
    lsDel('zephyr-playlist-v1');
  }

  if (plFilterEl) plFilterEl.addEventListener('input', () => { plFilter = plFilterEl.value.trim().toLowerCase(); renderPlaylist(); });
  if (plSortEl) plSortEl.addEventListener('change', () => { const m = plSortEl.value; plSortEl.value = ''; sortPlaylist(m); });

  function resetPlayer() {
    loadToken++;
    savePosition();
    if (isMpv() || mp.active) { const a = api(); if (a && a.mpvStop) a.mpvStop(); }
    engine = 'html5'; mp.active = false; mp.time = 0; mp.duration = 0; mp.tracks = [];
    video.pause();
    video.removeAttribute('src');
    video.load();
    dropZone.classList.remove('hidden');
    bigPlay.hidden = true;
    loader.hidden = true;
    videoTitle.textContent = 'ZephyrPlayer';
    videoSubtitle.textContent = 'Open files or drop media here';
    subtitleDisplay.textContent = '';
    subCues = [];
    updatePlayIcon(false);
    played.style.width = '0%';
    handle.style.left = '0%';
    currentTimeEl.textContent = '0:00';
    durationEl.textContent = '0:00';
    if (api() && api().reportProgress) api().reportProgress(-1);
    if (window.ZApp) window.ZApp.emit('idle');
  }

  // ------------------------------------------------------- resume positions
  function savePosition() {
    if (!rememberPos || currentIndex < 0) return;
    const item = playlist[currentIndex];
    if (!item || !hasMedia()) return;
    const t = curTime(), d = curDur();
    if (!(d > 0)) return;
    if (window.ZApp) window.ZApp.emit('position', item, t, d);
    if (t > 5 && t < d - 8) {
      updateRowProgress(item);
      lsSet(posKey(item), String(Math.floor(t)));
      lsSet('zephyr-pos-' + item.fullName, String(Math.floor(t))); // legacy key: library "watched %"
    } else if (t >= d - 8) {
      lsDel(posKey(item)); lsDel('zephyr-pos-' + item.fullName);
    }
  }
  function getSavedPos(item) {
    if (!rememberPos || !item) return 0;
    const v = parseFloat(lsGet(posKey(item)) || lsGet('zephyr-pos-' + item.fullName) || '0');
    return v > 5 ? v : 0;
  }
  setInterval(() => { if (!document.hidden || isMpv()) savePosition(); }, 5000);
  window.addEventListener('beforeunload', savePosition);

  // ------------------------------------------------------------ engine routing
  function chooseEngine(item) {
    if (item.stream) return 'mpv';
    if (!mpvReady) return 'html5';
    if (item.forceMpv || needsMpvContainer(item.fullName)) return 'mpv';
    return 'html5';
  }

  function playIndex(i, opts = {}) {
    if (i < 0 || i >= playlist.length) return;
    savePosition();
    const prev = playlist[currentIndex];
    if (prev) updateRowProgress(prev);
    const item = playlist[i];
    if (prev && prev !== item && !opts.noHistory) {
      history.push(prev);
      if (history.length > 100) history.shift();
    }
    currentIndex = i;
    if (shuffle) playedSet.add(item);
    item._triedMpv = false;
    item._audioChecked = false;
    const token = ++loadToken;
    resetAB();
    subCues = [];
    subtitleDisplay.textContent = '';
    if (typeof chapters !== 'undefined') chapters = [];

    videoTitle.textContent = item.name;
    videoSubtitle.textContent = item.stream ? 'Stream' : item.fullName;
    dropZone.classList.add('hidden');
    bigPlay.hidden = true;
    renderPlaylist();
    savePlaylistSoon();
    if (window.ZApp) window.ZApp.emit('itemstart', item);
    if (item.path && api() && api().recordOpened) api().recordOpened(item.path);

    const start = opts.startPos != null ? opts.startPos : getSavedPos(item);
    const go = () => {
      if (token !== loadToken) return;
      if (chooseEngine(item) === 'mpv') startMpvItem(item, start, token);
      else startHtml5(item, start, token);
    };
    // Know the codecs BEFORE choosing the engine (HEVC/AC3/10-bit go straight to mpv, no failed first attempt).
    if (!item.info && item.path && api() && api().probeMedia && !item.missing) {
      Promise.race([probeItem(item), new Promise(r => setTimeout(r, 700))]).then(go, go);
    } else go();
  }

  function setABTag(txt) {
    const tag = document.getElementById('abTag');
    if (!tag) return;
    tag.hidden = !txt;
    tag.textContent = txt;
  }

  function resetAB() {
    abLoop = { a: null, b: null, active: false };
    abLoopBtn.classList.remove('active');
    setABTag('');
    abRange.hidden = true;
  }

  function startHtml5(item, start, token) {
    if (isMpv() || mp.active) { const a = api(); if (a && a.mpvStop) a.mpvStop(); }
    engine = 'html5'; mp.active = false; mp.eof = false;
    loader.hidden = false;
    pendingStart = start || 0;
    video.muted = userMuted;
    video.src = item.url;
    video.playbackRate = clamp(speedRate, 0.25, 4);
    const p = video.play();
    if (p && p.catch) p.catch(err => {
      if (token !== loadToken) return;
      if (err && err.name === 'NotAllowedError') { bigPlay.hidden = false; updatePlayIcon(false); }
    });
    loadSidecarSubs(item, token);
  }
  let pendingStart = 0;

  async function startMpvItem(item, start, token) {
    const a = api();
    if (!a || !a.mpvPlayExternal) { startHtml5(item, start, token); return; }
    engine = 'mpv'; mp.active = false; mp.eof = false; mp.time = start || 0; mp.duration = 0; mp.paused = false; mp.tracks = [];
    video.pause();
    video.removeAttribute('src');
    video.load();
    loader.hidden = false;
    bigPlay.hidden = true;
    updatePlayIcon(true);
    played.style.width = '0%'; handle.style.left = '0%';
    currentTimeEl.textContent = formatTime(start || 0);
    durationEl.textContent = '0:00';
    if (typeof reportEmbedBounds === 'function') reportEmbedBounds();

    const common = { quality: getQuality(), embed: true, startPos: start || 0, volume: Math.round(volumeLevel * 100), mute: userMuted };
    let res;
    try {
      res = item.stream
        ? await a.mpvPlayUrl(item.url, common.quality, true, {
            startPos: common.startPos, volume: common.volume, mute: common.mute, cookies: lsGet('zephyr-ytCookies') || '',
            vo: lsGet('zephyr-settingVo') || 'gpu', hwdec: lsGet('zephyr-settingHwdec') || 'auto', perf: lsGet('zephyr-settingPerf') || 'smooth'
          })
        : await a.mpvPlayExternal(Object.assign({ files: [item.path],
            vo: lsGet('zephyr-settingVo') || 'gpu', hwdec: lsGet('zephyr-settingHwdec') || 'auto', perf: lsGet('zephyr-settingPerf') || 'smooth' }, common));
    } catch (e) { res = { ok: false, error: e && e.message }; }
    if (token !== loadToken) return;

    if (res && res.ok) {
      mpvMode = res.mode || 'off';
      mp.active = true;
      showOSD(res.embedded ? 'mpv · embedded' : 'mpv · separate window', 1400);
      loadSubsForMpv(item, token);
      return;
    }
    // mpv could not start: fall back to the browser engine when the file is local
    engine = 'html5';
    if (!item.stream && item.path && !item._htmlTried) {
      item._htmlTried = true;
      showOSD('mpv unavailable — using browser engine', 2000);
      startHtml5(item, start, token);
      return;
    }
    showPlayError((res && res.error) ? String(res.error) : 'mpv failed to start');
  }

  async function loadSubsForMpv(item, token) {
    if (item.subPath) { await mpvCmd('sub-add', item.subPath, 'select'); }
  }

  function fallbackToMpv(reason) {
    const item = playlist[currentIndex];
    if (!item || !item.path || item._triedMpv || !mpvReady) return false;
    item._triedMpv = true;
    showOSD(reason + ' — switching to mpv…', 2200);
    const t = video.currentTime || 0;
    startMpvItem(item, t > 5 ? t : getSavedPos(item), loadToken);
    return true;
  }

  function showPlayError(msg) {
    msg = String(msg || 'Playback error');
    loader.hidden = true;
    videoSubtitle.textContent = msg;
    const readTime = clamp(msg.length * 70, 3500, 9000);   // long, helpful messages stay readable
    showOSD(msg.slice(0, 220), readTime);
    errorStreak++;
    if (autoNext && playlist.length > 1 && errorStreak < playlist.length) {
      const token = loadToken;
      setTimeout(() => { if (token === loadToken) step(1); }, readTime + 400);
    }
  }

  function stopAll() {
    loadToken++;
    savePosition();
    const a = api();
    if (a && a.mpvStop && (isMpv() || mp.active)) a.mpvStop();
    video.pause();
    if (isMpv()) { engine = 'html5'; mp.active = false; updatePlayIcon(false); bigPlay.hidden = playlist.length === 0; }
  }

  // ------------------------------------------------------------- next / prev
  function pickNext(auto) {
    if (!playlist.length) return -1;
    if (shuffle && playlist.length > 1) {
      // "bag" shuffle: every item plays once per cycle (no immediate repeats, nothing starves)
      const cur = playlist[currentIndex];
      if (cur) playedSet.add(cur);
      let pool = playlist.filter(it => !playedSet.has(it) && !it.missing);
      if (!pool.length) {
        if (auto && repeatMode !== 1) return -1;        // finished the whole shuffled cycle
        playedSet.clear(); if (cur) playedSet.add(cur);
        pool = playlist.filter(it => it !== cur && !it.missing);
        if (!pool.length) return -1;
      }
      return playlist.indexOf(pool[Math.floor(Math.random() * pool.length)]);
    }
    let n = currentIndex + 1;
    while (n < playlist.length && playlist[n].missing) n++;
    if (n >= playlist.length) return repeatMode === 1 ? Math.max(0, playlist.findIndex(it => !it.missing)) : -1;
    return n;
  }

  function step(dir) {
    if (!playlist.length) return;
    if (dir < 0) {
      if (curTime() > 3) { seekTo(0); return; }
      while (history.length) {
        const it = history.pop();
        const idx = playlist.indexOf(it);
        if (idx >= 0 && idx !== currentIndex) { playIndex(idx, { noHistory: true }); return; }
      }
      if (currentIndex > 0) playIndex(currentIndex - 1, { noHistory: true });
      else seekTo(0);
      return;
    }
    const n = pickNext(false);
    if (n >= 0) playIndex(n);
    else showOSD('End of playlist');
  }

  function handleEnded() {
    const item = playlist[currentIndex];
    if (window.ZApp) window.ZApp.emit('itemend', item);
    if (item) { lsDel(posKey(item)); lsDel('zephyr-pos-' + item.fullName); }
    if (repeatMode === 2) {
      seekTo(0);
      if (isMpv()) mpvSet('pause', false); else video.play().catch(() => {});
      return;
    }
    if (autoNext || repeatMode === 1) {
      const n = pickNext(true);
      if (n >= 0) { playIndex(n); return; }
    }
    updatePlayIcon(false);
    if (!isMpv()) bigPlay.hidden = false;
  }

  // ---------------------------------------------------------------- transport
  function togglePlay() {
    if (isMpv()) {
      if (mp.eof) { mpvCmd('seek', 0, 'absolute'); mpvSet('pause', false); }
      else mpvCmd('cycle', 'pause');
      return;
    }
    if (!video.getAttribute('src')) {
      if (playlist.length) playIndex(Math.max(0, currentIndex));
      return;
    }
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }
  function pausePlayback() { if (isMpv()) mpvSet('pause', true); else video.pause(); }
  function updatePlayIcon(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    if (window.ZApp) window.ZApp.emit('playstate', !!playing);
  }

  let seekThrottle = 0;
  function seekTo(t) {
    if (!hasMedia()) return;
    const d = curDur();
    t = Math.max(0, d ? Math.min(d, t) : t);
    if (isMpv()) { mp.time = t; mpvCmd('seek', t, 'absolute'); }
    else video.currentTime = t;
  }
  function seekRelative(sec) {
    if (!hasMedia()) return;
    seekTo(curTime() + sec);
    showOSD((sec > 0 ? '+' : '') + sec + 's');
  }

  // ------------------------------------------------------------------ progress
  let lastReport = 0;
  function updateProgress() {
    const d = curDur(), t = curTime();
    if (!isSeeking && d) {
      const pct = clamp(t / d * 100, 0, 100);
      played.style.width = pct + '%';
      handle.style.left = pct + '%';
      currentTimeEl.textContent = formatTime(t);
      if (window.ZApp) window.ZApp.emit('progress', pct, t, d);
    }
    const now = performance.now();
    if (d && now - lastReport > 1000) {
      lastReport = now;
      if (api() && api().reportProgress) api().reportProgress(t / d);
    }
    if (!isMpv() && abLoop.active && abLoop.b !== null && t >= abLoop.b) video.currentTime = abLoop.a;
  }
  function updateBuffered() {
    if (isMpv() || !video.duration || !video.buffered.length) return;
    buffered.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100 + '%';
  }
  function seekFromEvent(e, final) {
    const d = curDur();
    if (!d) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    played.style.width = pct * 100 + '%';
    handle.style.left = pct * 100 + '%';
    currentTimeEl.textContent = formatTime(pct * d);
    if (isMpv()) {
      const now = performance.now();
      if (final || now - seekThrottle > 90) { seekThrottle = now; seekTo(pct * d); }
    } else {
      video.currentTime = pct * d;
    }
  }
  function updateABVisual() {
    const d = curDur();
    if (abLoop.a !== null && abLoop.b !== null && d) {
      abRange.hidden = false;
      abRange.style.left = (abLoop.a / d * 100) + '%';
      abRange.style.width = ((abLoop.b - abLoop.a) / d * 100) + '%';
    } else {
      abRange.hidden = true;
    }
  }

  // -------------------------------------------------------------------- volume
  function setBtnIcon(btn, name) {
    const z = btn && btn.querySelector('.zi');
    if (z && window.ZIcons) window.ZIcons.set(z, name);
  }
  function updateMuteIcon() {
    setBtnIcon(muteBtn, userMuted || volumeLevel === 0 ? 'volume-mute' : (volumeLevel < 0.5 ? 'volume-low' : 'volume-high'));
  }
  function setVolume(val, opts = {}) {
    val = clamp(Number(val) || 0, 0, 1.5);
    volumeLevel = val;
    video.volume = Math.min(1, val);
    volumeSlider.value = val;
    if (!opts.keepMute && val > 0) { userMuted = false; video.muted = false; if (isMpv() || opts.sync) mpvSet('mute', false); }
    if (isMpv() || opts.sync) mpvSet('volume', Math.round(val * 100));
    updateMuteIcon();
    lsSet('zephyr-volume', String(val));
    if (!opts.silent) showOSD('Volume ' + Math.round(val * 100) + '%' + (val > 1 && !isMpv() ? ' (boost needs mpv)' : ''), 900);
  }
  function toggleMute() {
    userMuted = !userMuted;
    video.muted = userMuted;
    if (isMpv()) mpvSet('mute', userMuted);
    updateMuteIcon();
    showOSD(userMuted ? 'Muted' : 'Volume ' + Math.round(volumeLevel * 100) + '%', 900);
  }

  // ----------------------------------------------------------- fullscreen / PiP
  function toggleFullscreen() {
    if (isMpv() && mpvMode === 'off') { mpvCmd('cycle', 'fullscreen'); return; } // mpv's own window
    if (!document.fullscreenElement) {
      const root = document.documentElement;
      const p = root.requestFullscreen ? root.requestFullscreen() : null;
      if (p && p.catch) p.catch(() => {});
    } else {
      const p = document.exitFullscreen ? document.exitFullscreen() : null;
      if (p && p.catch) p.catch(() => {});
    }
  }
  async function togglePiP() {
    if (isMpv()) { showOSD('Picture-in-picture needs the browser engine'); return; }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (e) { console.warn(e); }
  }

  // --------------------------------------------------------------------- speed
  function setSpeed(rate, opts) {
    rate = clamp(Math.round(rate * 100) / 100, 0.25, 4);
    if (window.ZApp && !(opts && opts.silentMem)) window.ZApp.emit('speed', rate);
    speedRate = rate;
    video.playbackRate = rate;
    if (isMpv()) mpvSet('speed', rate);
    speedLabel.textContent = rate + '×';
    speedMenu.querySelectorAll('button').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === rate));
    speedMenu.hidden = true;
    if (!(opts && opts.quiet)) showOSD(rate + '×');
  }

  // --------------------------------------------------------------------- A-B loop
  let abRaf = 0;
  function abTick() {
    abRaf = 0;
    if (!abLoop.active || isMpv()) return;
    if (!video.paused && abLoop.b !== null && video.currentTime >= abLoop.b) video.currentTime = abLoop.a;
    abRaf = requestAnimationFrame(abTick);
  }
  function handleABLoop() {
    if (!hasMedia()) return;
    const t = curTime();
    if (abLoop.a === null) {
      abLoop.a = t;
      abLoopBtn.classList.add('active');
      setABTag('A');
      if (isMpv()) mpvSet('ab-loop-a', t);
      showOSD('A point set');
    } else if (abLoop.b === null) {
      if (t <= abLoop.a) { showOSD('B must be after A'); return; }
      abLoop.b = t;
      abLoop.active = true;
      setABTag('A·B');
      updateABVisual();
      if (isMpv()) mpvSet('ab-loop-b', t); else if (!abRaf) abRaf = requestAnimationFrame(abTick);
      showOSD('A-B loop on');
    } else {
      resetAB();
      if (isMpv()) { mpvSet('ab-loop-a', 'no'); mpvSet('ab-loop-b', 'no'); }
      showOSD('A-B loop off');
    }
  }

  // ------------------------------------------------------------------ screenshot
  async function takeScreenshot() {
    if (!hasMedia()) return;
    if (isMpv()) {
      const r = await mpvCmd('screenshot');
      showOSD(r && r.ok ? 'Screenshot saved to Pictures\\ZephyrPlayer' : 'Screenshot failed', 1800);
      return;
    }
    if (!video.videoWidth) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((res, rej) => { try { canvas.toBlob(b => (b ? res(b) : rej(new Error('empty'))), 'image/png'); } catch (e) { rej(e); } });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zephyr-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      showOSD('Screenshot saved');
    } catch {
      // local files are cross-origin for canvas readback — capture the rendered window area instead
      const r = videoWrapper.getBoundingClientRect();
      const res = api() && api().capturePage ? await api().capturePage({ x: r.left, y: r.top, width: r.width, height: r.height }) : null;
      showOSD(res && res.ok ? 'Screenshot saved to Pictures\\ZephyrPlayer' : 'Screenshot failed', 1800);
    }
  }

  // ------------------------------------------------------------------- subtitles
  let subCues = [];
  function setSubCues(cues, label) {
    subCues = cues || [];
    subtitleDisplay.textContent = '';
    showOSD(subCues.length ? `Subtitles loaded${label ? ' · ' + label : ''} (${subCues.length})` : 'No subtitle cues found in file', 1800);
    if (typeof refreshHtml5Tracks === 'function') refreshHtml5Tracks();
    if (typeof cacheSubsForCurrent === 'function' && subCues.length) cacheSubsForCurrent();
  }
  function parseSubBytes(bytes) {
    const Z = window.ZSub;
    if (!Z) return [];
    return Z.parse(Z.decode(bytes));
  }
  async function loadSubFromPath(p, opts = {}) {
    if (isMpv()) {
      const r = await mpvCmd('sub-add', p, 'select');
      if (!opts.silent) showOSD(r && r.ok ? 'Subtitles loaded' : 'Could not load subtitles');
      return;
    }
    const a = api();
    if (!a || !a.readSubtitle) return;
    const r = await a.readSubtitle(p).catch(() => null);
    if (opts.token && opts.token !== loadToken) return;
    if (!r || !r.ok) { if (!opts.silent) showOSD('Could not read subtitles'); return; }
    const label = String(p).split(/[/\\]/).pop();
    if (opts.silent) { subCues = parseSubBytes(r.bytes); refreshHtml5Tracks(); if (subCues.length) showOSD('Subtitles: ' + label, 1500); }
    else setSubCues(parseSubBytes(r.bytes), label);
  }
  function loadExternalSub(file) {
    const a = api();
    const p = a && a.getPathForFile ? a.getPathForFile(file) : '';
    if (isMpv() && p) { loadSubFromPath(p); return; }
    const reader = new FileReader();
    reader.onload = () => setSubCues(parseSubBytes(new Uint8Array(reader.result)), file.name);
    reader.onerror = () => showOSD('Could not read subtitle file');
    reader.readAsArrayBuffer(file);
  }
  async function loadSidecarSubs(item, token) {
    const a = api();
    if (!a || !a.sidecarSubs || !item.path) { if (!subCues.length && typeof loadCachedSubs === 'function') loadCachedSubs(); return; }
    if (item.subPath) { await loadSubFromPath(item.subPath, { silent: true, token }); return; }
    const r = await a.sidecarSubs(item.path).catch(() => null);
    if (token !== loadToken) return;
    const subs = (r && r.subs) || [];
    if (!subs.length) { if (!subCues.length && typeof loadCachedSubs === 'function') loadCachedSubs(); return; }
    const pref = subs.find(s => /[._ -](en|eng|english)[._ -][^/\\]*$/i.test(s) || /[._ -](en|eng|english)\.(srt|vtt|ass|ssa)$/i.test(s)) || subs[0];
    await loadSubFromPath(pref, { silent: true, token });
  }
  let lastSubText = '';
  function updateSubtitles() {
    if (isMpv() || !subCues.length) {
      if (lastSubText) { subtitleDisplay.textContent = ''; lastSubText = ''; }
      return;
    }
    const t = video.currentTime - (typeof subDelaySec === 'number' ? subDelaySec : 0);
    let text = '';
    for (let i = 0; i < subCues.length; i++) {
      const c = subCues[i];
      if (t >= c.start && t <= c.end) text += (text ? '\n' : '') + c.text;
    }
    if (text !== lastSubText) { subtitleDisplay.textContent = text; lastSubText = text; }
  }

  // Repeat / Shuffle
  function paintRepeat() {
    const labels = ['Off', 'All', 'One'];
    setBtnIcon(repeatBtn, repeatMode === 2 ? 'repeat-one' : 'repeat');
    const l = repeatBtn.querySelector('.lbl'); if (l) l.textContent = labels[repeatMode];
    repeatBtn.title = 'Repeat: ' + labels[repeatMode];
    repeatBtn.classList.toggle('active', repeatMode > 0);
  }
  function cycleRepeat() {
    repeatMode = (repeatMode + 1) % 3;
    lsSet('zephyr-repeat', String(repeatMode));
    paintRepeat();
    showOSD('Repeat: ' + ['off', 'all', 'one'][repeatMode]);
  }
  function paintShuffle() {
    shuffleBtn.classList.toggle('active', shuffle);
    shuffleBtn.setAttribute('aria-pressed', String(shuffle));
  }
  function toggleShuffle() {
    shuffle = !shuffle;
    playedSet.clear();
    const cur = playlist[currentIndex];
    if (shuffle && cur) playedSet.add(cur);
    lsSet('zephyr-shuffle', shuffle ? '1' : '0');
    paintShuffle();
    showOSD(shuffle ? 'Shuffle on — every item plays once per round' : 'Shuffle off');
  }

  // Theme & Settings
  function toggleTheme() {
    if (window.ZApp && window.ZApp.toggleLightDark) { window.ZApp.toggleLightDark(); return; }
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
  }
  function openSettings() {
    settingsPanel.hidden = false;
    if (window.ZApp && window.ZApp.syncSettingsUI) window.ZApp.syncSettingsUI();
    $('settingVolume').value = volumeSlider.value;
    $('settingSeek').value = seekStep;
    $('settingAutoNext').checked = autoNext;
    $('settingRemember').checked = rememberPos;
  }
  function closeSettingsPanel() {
    if (settingsPanel) settingsPanel.hidden = true;
    { const v = parseFloat($('settingVolume').value); if (Math.abs(v - volumeLevel) > 0.001) setVolume(v, { silent: true }); }
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

  // Events (browser engine)
  let stallTimer = null;
  const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
  video.addEventListener('play', () => { updatePlayIcon(true); bigPlay.hidden = true; });
  video.addEventListener('pause', () => {
    if (isMpv()) return;
    updatePlayIcon(false);
    bigPlay.hidden = !(video.getAttribute('src') && !video.ended);
    clearStall();
  });
  video.addEventListener('playing', () => { loader.hidden = true; errorStreak = 0; clearStall(); });
  video.addEventListener('timeupdate', () => {
    if (isMpv()) return;
    updateProgress();
    updateSubtitles();
    const item = playlist[currentIndex];
    // Audio codec the browser can't decode (AC3/DTS/...): video plays silently -> hand over to mpv.
    if (item && !item._audioChecked && video.currentTime > 2.5 && !video.paused) {
      item._audioChecked = true;
      if (typeof video.webkitAudioDecodedByteCount === 'number' && video.webkitAudioDecodedByteCount === 0 &&
          !video.muted && video.volume > 0 && VIDEO_EXT.test(item.fullName || '')) {
        fallbackToMpv('Audio codec not supported by browser engine');
      }
    }
  });
  video.addEventListener('progress', updateBuffered);
  video.addEventListener('loadedmetadata', () => {
    if (isMpv()) return;
    durationEl.textContent = formatTime(video.duration);
    loader.hidden = true;
    const item = playlist[currentIndex];
    // Video track the browser can't decode (HEVC/AV1/...): audio-only playback -> hand over to mpv.
    if (item && video.videoWidth === 0 && VIDEO_EXT.test(item.fullName || '') && fallbackToMpv('Video codec not supported by browser engine')) return;
    if (pendingStart > 5 && pendingStart < video.duration - 5) video.currentTime = pendingStart;
    pendingStart = 0;
  });
  video.addEventListener('waiting', () => {
    if (!video.getAttribute('src')) return;
    loader.hidden = false;
    clearStall();
    stallTimer = setTimeout(() => {
      const item = playlist[currentIndex];
      if (!isMpv() && item && item.path && video.readyState < 3 && !video.paused) fallbackToMpv('Playback stalled');
    }, 15000);
  });
  video.addEventListener('canplay', () => { loader.hidden = true; clearStall(); });
  video.addEventListener('ended', () => { if (!isMpv()) handleEnded(); });
  video.addEventListener('error', () => {
    loader.hidden = true;
    clearStall();
    const item = playlist[currentIndex];
    if (isMpv() || !item || !video.getAttribute('src')) return;
    if (fallbackToMpv('Browser engine can\'t play this')) return;
    showPlayError(mpvReady ? 'Cannot play this file' : 'Cannot play this file — place mpv.exe next to the app for full format support');
  });
  video.addEventListener('click', togglePlay);
  video.addEventListener('dblclick', toggleFullscreen);

  playPauseBtn.addEventListener('click', togglePlay);
  bigPlay.addEventListener('click', () => {
    bigPlay.hidden = true;
    togglePlay();
  });
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  muteBtn.addEventListener('click', toggleMute);
  volumeSlider.addEventListener('input', e => setVolume(parseFloat(e.target.value)));
  rewindBtn.addEventListener('click', () => seekRelative(-seekStep));
  forwardBtn.addEventListener('click', () => seekRelative(seekStep));
  abLoopBtn.addEventListener('click', handleABLoop);
  screenshotBtn.addEventListener('click', takeScreenshot);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => setBtnIcon(fullscreenBtn, document.fullscreenElement ? 'fullscreen-exit' : 'fullscreen'));
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
    subCues = []; subtitleDisplay.textContent = ''; lastSubText = ''; subMenu.hidden = true;
    if (window.ZApp) window.ZApp.emit('trackchosen', { type: 'sub', off: true });
    if (isMpv()) { selectedSid = 'no'; mpvSet('sid', 'no'); }
    showOSD('Subtitles off');
  });
  subMenu.querySelector('[data-action="load"]').addEventListener('click', () => { subInput.click(); subMenu.hidden = true; });
  subInput.addEventListener('change', () => { if (subInput.files[0]) loadExternalSub(subInput.files[0]); subInput.value = ''; });

  audioBtn.addEventListener('click', e => {
    e.stopPropagation();
    refreshHtml5Tracks();
    subMenu.hidden = true;
    speedMenu.hidden = true;
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

  progressBar.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!curDur()) return;
    isSeeking = true;
    try { progressBar.setPointerCapture(e.pointerId); } catch {}
    seekFromEvent(e, false);
    const move = ev => seekFromEvent(ev, false);
    const up = ev => {
      seekFromEvent(ev, true);
      isSeeking = false;
      progressBar.removeEventListener('pointermove', move);
      progressBar.removeEventListener('pointerup', up);
      progressBar.removeEventListener('pointercancel', up);
      try { progressBar.releasePointerCapture(ev.pointerId); } catch {}
    };
    progressBar.addEventListener('pointermove', move);
    progressBar.addEventListener('pointerup', up);
    progressBar.addEventListener('pointercancel', up);
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
    window.electronAPI.onOpenFiles(paths => { if (paths?.length) addNativePaths(paths, { play: true }); });
  }

  // Keyboard (VLC / PotPlayer style) — ONE dispatcher; customizable keys are resolved here too.
  function typingTarget(t) {
    const tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
  }
  document.addEventListener('keydown', e => {
    if (typingTarget(e.target) || e.altKey) return;
    const hk = (typeof hotkeys === 'object' && hotkeys) || { play: ' ', full: 'f', mute: 'm', shot: 's', book: 'b' };
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'o') { e.preventDefault(); openFilesNative(); }
      return;
    }
    if (k === hk.play || k === 'k') { e.preventDefault(); togglePlay(); return; }
    if (k === hk.full) { e.preventDefault(); toggleFullscreen(); return; }
    if (k === hk.mute) { e.preventDefault(); toggleMute(); return; }
    if (k === hk.shot) { e.preventDefault(); takeScreenshot(); return; }
    if (k === hk.book) { e.preventDefault(); if (typeof addBookmarkBtn !== 'undefined' && addBookmarkBtn) addBookmarkBtn.click(); return; }
    switch (k) {
      case 'arrowleft': e.preventDefault(); seekRelative(e.shiftKey ? -30 : -seekStep); break;
      case 'arrowright': e.preventDefault(); seekRelative(e.shiftKey ? 30 : seekStep); break;
      case 'arrowup': e.preventDefault(); setVolume(volumeLevel + 0.05); break;
      case 'arrowdown': e.preventDefault(); setVolume(volumeLevel - 0.05); break;
      case 'p': if (e.shiftKey) step(-1); break;
      case 'n': if (e.shiftKey) step(1); break;
      case 'a': handleABLoop(); break;
      case 'r': cycleRepeat(); break;
      case '[': setSpeed(speedRate - 0.25); break;
      case ']': setSpeed(speedRate + 0.25); break;
      case 'pageup': if (isMpv()) { e.preventDefault(); mpvCmd('add', 'chapter', -1); } break;
      case 'pagedown': if (isMpv()) { e.preventDefault(); mpvCmd('add', 'chapter', 1); } break;
      case 'i': if (isMpv() && e.shiftKey) mpvCmd('script-binding', 'stats/display-stats-toggle'); break;
      case 'home': e.preventDefault(); seekTo(0); break;
      case 'end': e.preventDefault(); { const d = curDur(); if (d) seekTo(d - 0.5); } break;
      case 'escape': if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); break;
    }
  });

  // Init

  { const sv = parseFloat(lsGet('zephyr-volume')); setVolume(isFinite(sv) ? sv : 1, { silent: true }); }
  shuffle = lsGet('zephyr-shuffle') === '1';
  repeatMode = parseInt(lsGet('zephyr-repeat') || '0', 10) || 0;
  paintShuffle(); paintRepeat(); updateMuteIcon();
  renderPlaylist();
  restorePlaylist();

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

  // Play a local file with mpv: always through the playlist so the UI stays bound to it.
  async function playWithMpv(files) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    const p = list[0];
    if (!p) return false;
    let idx = playlist.findIndex(i => i.path === p);
    if (idx < 0) { await addNativePaths([p]); idx = playlist.findIndex(i => i.path === p); }
    if (idx < 0) return false;
    playlist[idx].forceMpv = true;
    playIndex(idx, { startPos: idx === currentIndex ? curTime() : undefined, noHistory: idx === currentIndex });
    return true;
  }

  const isPlaylistUrl = (u) => /[?&]list=/.test(u) && !/[?&]v=/.test(u) || /\/playlist\?|\/(channel|c|user|@[^/]+)(\/(videos|streams))?\/?$/i.test(u);
  async function playStream(url) {
    const u = String(url || '').trim();
    if (!u) { showOSD('Paste a URL first'); return; }
    if (!mpvReady) { showOSD('mpv (and yt-dlp for YouTube) must be next to the app for URLs', 3000); return; }
    if (isPlaylistUrl(u) && api() && api().ytdlpPlaylist) {
      showOSD('Reading playlist…', 4000);
      const r = await api().ytdlpPlaylist(u, lsGet('zephyr-ytCookies') || '').catch(() => null);
      if (r && r.ok && r.entries.length) {
        const first = playlist.length;
        r.entries.forEach(e => { if (!playlist.some(i => i.stream && i.url === e.url)) playlist.push(makeStreamItem(e.url, e.title, e.duration)); });
        renderPlaylist(); savePlaylistSoon();
        showOSD(r.entries.length + ' videos added' + (r.title ? ' from “' + r.title + '”' : ''), 2500);
        playIndex(Math.min(first, playlist.length - 1));
        return;
      }
      showOSD(r && r.error ? r.error : 'Could not read that playlist', 4000);
      return;
    }
    let idx = playlist.findIndex(i => i.stream && i.url === u);
    if (idx < 0) { playlist.push(makeStreamItem(u)); idx = playlist.length - 1; }
    renderPlaylist();
    showOSD('Opening…');
    playIndex(idx);
  }

  if (mpvPlayBtn) {
    mpvPlayBtn.addEventListener('click', async () => {
      if (!mpvReady) { showOSD('Place mpv.exe next to the app'); return; }
      const item = playlist[currentIndex];
      if (!item) { showOSD('Open a file first'); return; }
      if (isMpv()) { showOSD('Already playing with mpv'); return; }
      item.forceMpv = true;
      playIndex(currentIndex, { startPos: curTime(), noHistory: true });
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
        if (paths && paths.length) await playWithMpv(paths);
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
    playUrlBtn.addEventListener('click', () => {
      const url = (urlInput && urlInput.value || '').trim();
      closeUrl();
      playStream(url);
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
    if (!isMpv() && video.videoWidth) {
      text += 'Resolution: ' + video.videoWidth + '×' + video.videoHeight + '\n';
    }
    {
      const it = playlist[currentIndex];
      const i = it && it.info;
      if (i) {
        text += '\n--- File ---\n';
        if (i.container) text += 'Container: ' + i.container + '\n';
        if (i.hasVideo) text += 'Video: ' + i.width + '×' + i.height + ' ' + codecName(i.vcodec) + (i.vprofile ? ' (' + i.vprofile + ')' : '') + (i.fps ? ' @ ' + i.fps + ' fps' : '') + (i.bitDepth >= 10 ? ' · ' + i.bitDepth + '-bit' : '') + (i.hdr ? ' · ' + i.hdr : '') + '\n';
        if (i.acodec) text += 'Audio: ' + codecName(i.acodec) + (i.achannels ? ' · ' + i.achannels + ' ch' : '') + (i.asamplerate ? ' · ' + i.asamplerate + ' Hz' : '') + (i.audioLangs && i.audioLangs.length ? ' · ' + i.audioLangs.join('/') : '') + '\n';
        if (i.audioTracks > 1) text += 'Audio tracks: ' + i.audioTracks + '\n';
        if (i.subTracks) text += 'Subtitle tracks: ' + i.subTracks + (i.subLangs && i.subLangs.length ? ' (' + i.subLangs.join('/') + ')' : '') + '\n';
        if (i.chapters) text += 'Chapters: ' + i.chapters + '\n';
        if (i.bitrate) text += 'Bitrate: ' + Math.round(i.bitrate / 1000) + ' kbps\n';
        if (i.title) text += 'Title tag: ' + i.title + '\n';
        if (i.artist) text += 'Artist: ' + i.artist + (i.album ? ' · ' + i.album : '') + '\n';
        text += 'Browser engine: ' + (browserCanPlay(i) ? 'can play' : 'cannot decode this → mpv') + '\n';
      }
    }
    if (curDur()) text += 'Duration: ' + formatTime(curDur()) + '\n';
    if (window.electronAPI && window.electronAPI.mpvGetMediaInfo) {
      try {
        const res = await window.electronAPI.mpvGetMediaInfo();
        if (res && res.info) {
          text += '\n--- Engine ---\n';
          text += 'mpv: ' + (res.info.mpv || '—') + '\n';
          text += 'yt-dlp: ' + (res.info.ytdlp || '—') + '\n';
          text += 'Quality: ' + (res.info.quality || '—') + '\n';
          text += 'Window mode: ' + (res.info.embed ? 'embedded' : 'separate') + (res.info.level ? ' (safe mode ' + res.info.level + ')' : '') + '\n';
          const d = res.info.details;
          if (d) {
            text += '\n--- Playback (mpv) ---\n';
            const vp = d['video-params'] || {};
            if (vp.w) text += 'Video: ' + vp.w + '×' + vp.h + ' ' + (d['video-codec'] || '') + (d['container-fps'] ? ' @ ' + Number(d['container-fps']).toFixed(2) + ' fps' : '') + '\n';
            if (vp.pixelformat) text += 'Pixel format: ' + vp.pixelformat + (vp.colormatrix ? ' · ' + vp.colormatrix : '') + (vp.gamma ? ' · ' + vp.gamma : '') + '\n';
            if (d['audio-codec-name']) { const ap = d['audio-params'] || {}; text += 'Audio: ' + d['audio-codec-name'] + (ap.samplerate ? ' · ' + ap.samplerate + ' Hz' : '') + (ap['hr-channels'] ? ' · ' + ap['hr-channels'] : '') + '\n'; }
            if (d['file-format']) text += 'Container: ' + d['file-format'] + '\n';
            if (d['video-bitrate']) text += 'Video bitrate: ' + Math.round(d['video-bitrate'] / 1000) + ' kbps\n';
            if (d['hwdec-current']) text += 'Decoder: ' + d['hwdec-current'] + '\n';
            if (d['current-vo']) text += 'Renderer: ' + d['current-vo'] + '\n';
            if (d['frame-drop-count'] != null) text += 'Dropped frames: ' + d['frame-drop-count'] + '\n';
          }
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

  function trackLabel(t, n) {
    const bits = [];
    if (t.lang) bits.push(String(t.lang).toUpperCase());
    if (t.title) bits.push(t.title);
    if (t.codec) bits.push(t.codec);
    if (t.type === 'audio' && t['demux-channel-count']) bits.push(t['demux-channel-count'] + 'ch');
    if (t.external) bits.push('external');
    return (bits.length ? bits.join(' · ') : (t.type === 'audio' ? 'Audio ' : 'Subtitle ') + n);
  }

  function refreshHtml5Tracks() {
    const subTracksEl = document.getElementById('subTracks');
    const audioTracksEl = document.getElementById('audioTracks');
    const mkBtn = (label, active, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (active) b.classList.add('active');
      if (onClick) b.addEventListener('click', onClick); else b.disabled = true;
      return b;
    };

    if (isMpv()) {
      const subs = mp.tracks.filter(t => t.type === 'sub');
      const auds = mp.tracks.filter(t => t.type === 'audio');
      if (subTracksEl) {
        subTracksEl.textContent = '';
        if (!subs.length) subTracksEl.appendChild(mkBtn('No subtitle tracks', false, null));
        subs.forEach((t, i) => subTracksEl.appendChild(mkBtn(trackLabel(t, i + 1), t.selected, async () => {
          selectedSid = t.id; subMenu.hidden = true;
          if (window.ZApp) window.ZApp.emit('trackchosen', { type: 'sub', track: t });
          await mpvSet('sid', t.id);
          showOSD('Subtitle: ' + trackLabel(t, i + 1));
        })));
      }
      if (audioTracksEl) {
        audioTracksEl.textContent = '';
        if (!auds.length) audioTracksEl.appendChild(mkBtn('No audio tracks', false, null));
        auds.forEach((t, i) => audioTracksEl.appendChild(mkBtn(trackLabel(t, i + 1), t.selected, async () => {
          selectedAid = t.id; audioMenu.hidden = true;
          if (window.ZApp) window.ZApp.emit('trackchosen', { type: 'audio', track: t });
          await mpvSet('aid', t.id);
          showOSD('Audio: ' + trackLabel(t, i + 1));
        })));
      }
      return;
    }

    if (subTracksEl) {
      subTracksEl.textContent = '';
      const tracks = video.textTracks || [];
      let count = 0;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        count++;
        subTracksEl.appendChild(mkBtn(t.label || t.language || ('Track ' + count), t.mode === 'showing', () => {
          for (let j = 0; j < tracks.length; j++) tracks[j].mode = 'disabled';
          t.mode = 'showing';
          selectedSid = i;
          subMenu.hidden = true;
          showOSD('Subtitle: ' + (t.label || t.language || ('Track ' + count)));
          refreshHtml5Tracks();
        }));
      }
      if (subCues.length) subTracksEl.appendChild(mkBtn('External subtitles (' + subCues.length + ' cues)', true, null));
      else if (!count) subTracksEl.appendChild(mkBtn(mpvReady ? 'None — .mkv/.avi files open in mpv with all tracks' : 'No embedded subs', false, null));
    }
    if (audioTracksEl) {
      audioTracksEl.textContent = '';
      const at = video.audioTracks;
      if (at && at.length > 1) {
        for (let i = 0; i < at.length; i++) {
          const t = at[i];
          audioTracksEl.appendChild(mkBtn(t.label || t.language || ('Audio ' + (i + 1)), t.enabled, () => {
            for (let j = 0; j < at.length; j++) at[j].enabled = (j === i);
            audioMenu.hidden = true;
            showOSD('Audio: ' + (t.label || t.language || ('Audio ' + (i + 1))));
            refreshHtml5Tracks();
          }));
        }
      } else {
        audioTracksEl.appendChild(mkBtn('Default audio', true, null));
        if (mpvReady && playlist[currentIndex] && playlist[currentIndex].path) {
          audioTracksEl.appendChild(mkBtn('Switch to mpv for all audio tracks', false, () => {
            audioMenu.hidden = true;
            const it = playlist[currentIndex];
            it.forceMpv = true;
            playIndex(currentIndex, { startPos: curTime(), noHistory: true });
          }));
        }
      }
    }
  }

  // Refresh the track lists whenever the sub menu opens
  if (subBtn) subBtn.addEventListener('click', () => refreshHtml5Tracks());

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
      if (isMpv()) mpvSet('sub-pos', Math.round(100 - v * 0.9));
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
    list.sort((a, b) => a.time - b.time).forEach((bm) => {
      const li = document.createElement('li');
      const tm = document.createElement('span'); tm.className = 'bm-time'; tm.textContent = formatTime(bm.time);
      const lb = document.createElement('span'); lb.className = 'bm-label'; lb.textContent = bm.label || 'Bookmark'; lb.title = 'Double-click to rename';
      const del = document.createElement('button'); del.className = 'bm-del'; del.title = 'Delete'; del.textContent = '✕';
      li.append(tm, lb, del);
      li.addEventListener('click', (e) => {
        if (e.target.closest('.bm-del') || e.target.closest('input')) return;
        seekTo(bm.time);
        showOSD('Bookmark ' + formatTime(bm.time));
        bookmarkPanel.hidden = true;
      });
      lb.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.value = bm.label || ''; inp.style.width = '100%';
        lb.replaceWith(inp); inp.focus(); inp.select();
        const commit = () => {
          const all = loadBookmarks();
          const hit = all.find(b => Math.abs(b.time - bm.time) < 0.05 && b.label === bm.label);
          if (hit && inp.value.trim()) hit.label = inp.value.trim().slice(0, 80);
          saveBookmarks(all); renderBookmarks();
        };
        inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') renderBookmarks(); });
        inp.addEventListener('blur', commit);
      });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        saveBookmarks(loadBookmarks().filter(b => !(Math.abs(b.time - bm.time) < 0.05 && b.label === bm.label)));
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
      const tm = document.createElement('span'); tm.className = 'bm-time'; tm.textContent = formatTime(ch.time);
      const lb = document.createElement('span'); lb.className = 'bm-label'; lb.textContent = ch.title || 'Chapter';
      li.append(tm, lb);
      li.addEventListener('click', () => {
        seekTo(ch.time);
        showOSD(ch.title || formatTime(ch.time));
        chapterPanel.hidden = true;
      });
      chapterList.appendChild(li);
    });
  }

  function drawChapterAndBookmarkMarks() {
    const dur = curDur();
    if (!chapterMarks || !dur) return;
    chapterMarks.innerHTML = '';
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
    if (isMpv()) { renderChapters(); drawChapterAndBookmarkMarks(); return; }
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
    if (isMpv() || !video.duration || !progressBar || !seekPreview) return;
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
    if (!hasMedia() || !curDur()) {
      showOSD('Nothing playing');
      return;
    }
    // Electron has no window.prompt(); bookmarks get an automatic label (click the label in the list to rename)
    const t = curTime();
    const list = loadBookmarks();
    list.push({ time: t, label: 'Bookmark @ ' + formatTime(t) });
    saveBookmarks(list);
    renderBookmarks();
    drawChapterAndBookmarkMarks();
    showOSD('Bookmark saved');
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
      if (key === 'stop') stopAll();
      if (key === 'fullscreen') toggleFullscreen();
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
      if (isMpv() && window.electronAPI && window.electronAPI.mpvSetQuality) {
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
          stopAll();
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

  
  // ===== Batch 7: mpv embed surface =====
  const embedSelect = document.getElementById('embedSelect');

  function reportEmbedBounds() {
    const a = api();
    if (!a || !a.setEmbedBounds || !videoWrapper) return;
    const r = videoWrapper.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    a.setEmbedBounds({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  }
  let boundsTimer = null;
  function scheduleBounds() {
    if (boundsTimer) return;
    boundsTimer = setTimeout(() => { boundsTimer = null; reportEmbedBounds(); }, 40);
  }
  window.addEventListener('resize', scheduleBounds);
  document.addEventListener('fullscreenchange', () => {
    scheduleBounds();
    setTimeout(reportEmbedBounds, 250);
    // embedded mpv has no DOM controls in fullscreen -> let its own on-screen controller take over
    if (isMpv() && mpvMode === 'child') mpvCmd('script-message', 'osc-visibility', document.fullscreenElement ? 'auto' : 'never', 'no-osd');
  });
  if (typeof ResizeObserver !== 'undefined' && videoWrapper) new ResizeObserver(scheduleBounds).observe(videoWrapper);
  if (toggleSidebar) toggleSidebar.addEventListener('click', () => setTimeout(reportEmbedBounds, 320));
  if (closeSidebar) closeSidebar.addEventListener('click', () => setTimeout(reportEmbedBounds, 320));

  // Menus/panels are DOM; a native video window would cover them, so park it while any is open.
  let embedSuspended = false;
  function syncEmbedSuspension() {
    const a = api();
    if (!a || !a.setEmbedSuspended || !isMpv() || mpvMode !== 'child') return;
    const open = !!document.querySelector('.settings-panel:not([hidden]), .popup-menu:not([hidden]), .library-view:not([hidden])');
    if (open !== embedSuspended) { embedSuspended = open; a.setEmbedSuspended(open); }
  }
  new MutationObserver(syncEmbedSuspension).observe(document.body, { attributes: true, attributeFilter: ['hidden', 'class'], subtree: true });

  if (embedSelect) {
    // one-time migration: the old default ("Full window") hid the whole UI behind the video
    if (lsGet('zephyr-embed-v2') !== '1') {
      lsSet('zephyr-embed-v2', '1');
      const old = lsGet('zephyr-embed-mode');
      if (!old || old === 'wid' || old === 'sync') lsSet('zephyr-embed-mode', 'off');
    }
    let saved = lsGet('zephyr-embed-mode');
    if (saved === 'wid' || saved === 'sync') { saved = 'off'; lsSet('zephyr-embed-mode', 'off'); }
    if (saved && Array.from(embedSelect.options).some(o => o.value === saved)) embedSelect.value = saved;
    embedSelect.addEventListener('change', async () => {
      lsSet('zephyr-embed-mode', embedSelect.value);
      if (api() && api().setEmbedMode) await api().setEmbedMode(embedSelect.value);
      reportEmbedBounds();
      const item = playlist[currentIndex];
      if (isMpv() && item) {
        showOSD('Window mode: ' + embedSelect.options[embedSelect.selectedIndex].text + ' — reopening…', 2200);
        playIndex(currentIndex, { startPos: curTime(), noHistory: true });
      } else showOSD('Applies to the next mpv playback');
    });
    if (api() && api().setEmbedMode) api().setEmbedMode(embedSelect.value);
  }
  reportEmbedBounds();

  // ===== mpv -> UI synchronisation =====
  function onMpvState(b) {
    if (!isMpv() || !b) return;
    for (const k of Object.keys(b)) {
      const v = b[k];
      switch (k) {
        case 'time-pos':
          if (typeof v === 'number') { mp.time = v; mp.active = true; if (loader.hidden === false && v > 0.2) loader.hidden = true; updateProgress(); }
          break;
        case 'duration':
          mp.duration = (typeof v === 'number' && v > 0) ? v : 0;
          durationEl.textContent = formatTime(mp.duration);
          if (mp.duration) { onMediaMeta(); drawChapterAndBookmarkMarks(); }
          break;
        case 'pause':
          mp.paused = !!v;
          updatePlayIcon(!mp.paused);
          if (!mp.paused) errorStreak = 0;
          break;
        case 'volume':
          if (typeof v === 'number' && Math.abs(v / 100 - volumeLevel) > 0.005) {
            volumeLevel = clamp(v / 100, 0, 1.5);
            volumeSlider.value = volumeLevel;
            updateMuteIcon();
          }
          break;
        case 'mute':
          userMuted = !!v;
          updateMuteIcon();
          break;
        case 'speed':
          if (typeof v === 'number') { speedRate = v; speedLabel.textContent = (Math.round(v * 100) / 100) + '×'; }
          break;
        case 'eof-reached':
          if (v === true && !mp.eof) { mp.eof = true; handleEnded(); }
          else if (v !== true) mp.eof = false;
          break;
        case 'track-list':
          mp.tracks = Array.isArray(v) ? v : [];
          refreshHtml5Tracks();
          if (window.ZApp) window.ZApp.emit('tracks', mp.tracks);
          break;
        case 'chapter-list':
          chapters = (Array.isArray(v) ? v : []).map((c, i) => ({ time: c.time, title: c.title || ('Chapter ' + (i + 1)) }));
          renderChapters();
          drawChapterAndBookmarkMarks();
          break;
        case 'paused-for-cache':
          loader.hidden = !v;
          break;
        case 'media-title': {
          const it = playlist[currentIndex];
          // streams arrive with a URL as the name; replace it with the real title as soon as mpv/yt-dlp knows it
          if (it && it.stream && typeof v === 'string' && v && !/^https?:/i.test(v) && it.name !== v) {
            it.name = v; it._renamed = true; videoTitle.textContent = v; updateRow(it); savePlaylistSoon();
          }
          break;
        }
        case 'ab-loop-a':
          abLoop.a = typeof v === 'number' ? v : null;
          if (abLoop.a === null) resetAB();
          break;
        case 'ab-loop-b':
          if (typeof v === 'number') { abLoop.b = v; abLoop.active = abLoop.a !== null; updateABVisual(); } else abLoop.b = null;
          break;
      }
    }
  }

  function onMpvEvent(ev) {
    if (!ev) return;
    const item = playlist[currentIndex];
    switch (ev.type) {
      case 'file-loaded':
        mp.active = true;
        loader.hidden = true;
        errorStreak = 0;
        break;
      case 'file-error':
        if (!isMpv()) break;
        if (item && item.path && !item._htmlTried && !item.stream) {
          item._htmlTried = true;
          engine = 'html5';
          showOSD('mpv could not open this — trying browser engine', 2200);
          startHtml5(item, mp.time, loadToken);
        } else showPlayError(ev.error || 'Could not open this file');
        break;
      case 'recovering':
        if (!isMpv()) break;
        loader.hidden = false;
        showOSD((ev.reason && /video/i.test(ev.reason) ? 'Fixing video output' : 'Player hiccup — recovering') + (ev.level ? ' (compatibility level ' + ev.level + ')' : '') + '…', 2800);
        break;
      case 'perf':
        showOSD('Heavy video — switched to a lighter renderer for smooth playback', 3500);
        break;
      case 'failed':
        if (!isMpv()) break;
        if (item && item.path && !item._htmlTried && !item.stream) {
          item._htmlTried = true;
          engine = 'html5';
          showOSD('mpv failed — switching to browser engine', 2500);
          startHtml5(item, mp.time, loadToken);
        } else { engine = 'html5'; mp.active = false; updatePlayIcon(false); showPlayError('mpv failed: ' + String(ev.error || 'unknown error').slice(0, 160)); }
        break;
      case 'closed': // the user closed the mpv window
        if (!isMpv()) break;
        savePosition();
        engine = 'html5'; mp.active = false;
        updatePlayIcon(false);
        loader.hidden = true;
        videoSubtitle.textContent = 'Closed — press play to resume';
        bigPlay.hidden = false;
        break;
    }
  }

  if (api()) {
    if (api().onMpvState) api().onMpvState(onMpvState);
    if (api().onMpvEvent) api().onMpvEvent(onMpvEvent);
    if (api().onWindowState) api().onWindowState(() => scheduleBounds());
    if (api().onSubtitleProgress) api().onSubtitleProgress((p) => {
      const el = document.getElementById('subAiStatus');
      if (el && p && typeof p.percent === 'number') el.textContent = 'Generating subtitles… ' + p.percent + '%';
    });
  }

  // Last line of defence: nothing in the UI should ever die silently or take the player with it.
  window.addEventListener('error', (e) => { console.error('UI error:', e.message, e.filename, e.lineno); });
  window.addEventListener('unhandledrejection', (e) => { console.error('UI rejection:', e.reason); e.preventDefault(); });

  { const ck = document.getElementById('ytCookies');
    if (ck) { ck.value = lsGet('zephyr-ytCookies') || ''; ck.addEventListener('change', () => lsSet('zephyr-ytCookies', ck.value)); } }

  // right-click paste on the URL box (was an inline <script> in index.html; CSP now forbids those)
  { const ui = document.getElementById('urlInput'); if (ui) ui.addEventListener('contextmenu', e => e.stopPropagation()); }

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
    if (window.ZSub) return window.ZSub.toSrt(cues);
    return cues.map((c, i) => (i + 1) + '\n' + formatTime(c.start) + ' --> ' + formatTime(c.end) + '\n' + (c.text || '') + '\n').join('\n');
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
        '<td><input data-i="' + i + '" data-f="text" value="' + esc(c.text || '') + '" /></td>' +
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
        if (subCues[i]) seekTo(subCues[i].start);
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
        const cues = window.ZSub ? window.ZSub.parse(res.content) : [];
        if (isMpv() && res.srtPath) mpvCmd('sub-add', res.srtPath, 'select');
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
  function applySkin(name) { if (window.ZApp && window.ZApp.setTheme) window.ZApp.setTheme(name || 'zephyr'); }
  if (settingTheme) settingTheme.addEventListener('change', () => applySkin(settingTheme.value));

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
  function noteDuration() {
    const it = playlist[currentIndex];
    const d = curDur();
    if (it && d > 0 && Math.abs((it.duration || 0) - d) > 1 && !(it.info && it.info.duration)) { it.duration = d; updateRow(it); savePlaylistSoon(); }
  }
  function onMediaMeta() {
    noteDuration();
    if (currentIndex >= 0 && playlist[currentIndex]) {
      try {
        localStorage.setItem('zephyr-dur-' + playlist[currentIndex].fullName, String(curDur() || 0));
      } catch {}
      const item = playlist[currentIndex];
      if (item.path) {
        const meta = parseTv(item.fullName || item.name);
        pushRecent({
          path: item.path,
          name: item.fullName || item.name,
          title: meta.title,
          progress: watchedPctFor(item.path, curDur())
        });
        // update library progress
        const lib = loadLib();
        const ix = lib.findIndex(x => x.path === item.path);
        if (ix >= 0) {
          lib[ix].progress = watchedPctFor(item.path, curDur());
          saveLib(lib);
        }
      }
    }
  }
  video.addEventListener('loadedmetadata', onMediaMeta);

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
        ? '<img class="lib-poster" src="' + esc(item.poster) + '" alt="" />'
        : '<div class="lib-poster"></div>';
      let line2 = '';
      if (meta.isTv) line2 = 'S' + meta.season + 'E' + meta.episode + (item.year ? ' · ' + item.year : '');
      else line2 = (meta.year || '') + (item.size ? (meta.year ? ' · ' : '') + formatSize(item.size) : '');
      div.innerHTML = poster +
        '<div class="lib-info"><div class="lib-title">' + esc(item.title || meta.title || item.name) + '</div>' +
        '<div class="lib-meta">' + line2 + (pct ? ' · ' + pct + '%' : '') + '</div>' +
        '<div class="lib-progress"><span style="width:' + pct + '%"></span></div></div>';
      div.addEventListener('click', () => {
        if (item.path) addNativePaths([item.path], { play: true });
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
    const g = (id, d) => { const el = document.getElementById(id); return el && el.value !== '' ? el.value : d; };
    const scale = parseInt(g('assScale', 100), 10) / 100;
    if (window.electronAPI && window.electronAPI.mpvSetProps) {
      await window.electronAPI.mpvSetProps({
        'sub-scale': scale,
        'sub-color': g('assColor', '#FFFFFF'),
        'sub-border-color': g('assOutline', '#000000'),
        'sub-border-size': parseFloat(g('assOutlineW', 2)) || 0,
        'sub-shadow-offset': parseFloat(g('assShadow', 1)) || 0,
        'sub-back-color': (document.getElementById('assBack') || {}).checked ? '#99000000' : '#00000000',
        'sub-bold': !!(document.getElementById('assBold') || {}).checked,
        'sub-font': String(g('assFont', 'Sans')).slice(0, 60)
      });
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
    if (!window.electronAPI || !window.electronAPI.mpvSetProps) { showOSD('mpv required'); return; }
    const val = (id) => (document.getElementById(id) || {}).value;
    const chk = (id) => !!(document.getElementById(id) || {}).checked;
    const prefs = {
      replaygain: val('audReplayGain'), delay: val('audDelay'), channels: val('audChannels'),
      downmix: chk('audDownmix'), bitstream: chk('audBitstream'), vis: val('audVis')
    };
    lsSet('zephyr-audio-adv', JSON.stringify(prefs));
    const hasVideo = mp.tracks.some(t => t.type === 'video' && !t.albumart);
    const wantVis = prefs.vis && prefs.vis !== 'no';
    const props = {
      'replaygain': ['no', 'track', 'album'].includes(prefs.replaygain) ? prefs.replaygain : 'no',
      'audio-delay': clamp(parseFloat(prefs.delay) || 0, -5, 5),
      'audio-channels': prefs.downmix ? 'stereo' : (prefs.channels || 'auto'),
      'audio-spdif': prefs.bitstream ? 'ac3,eac3,dts,dts-hd,truehd' : ''
    };
    if (wantVis && !hasVideo && ['showcqt', 'avectorscope'].includes(prefs.vis)) props['lavfi-complex'] = '[aid1]asplit[ao][a];[a]' + prefs.vis + '[vo]';
    else props['lavfi-complex'] = '';
    if (!isMpv()) {
      showOSD('Saved — applies when a file plays in mpv');
      return;
    }
    const res = await window.electronAPI.mpvSetProps(props);
    showOSD(res && res.ok ? (wantVis && hasVideo ? 'Audio applied (visualizer is for audio-only files)' : 'Audio settings applied') : 'Some audio settings were rejected by mpv');
  });

  // Network open
  const networkOpenBtn = document.getElementById('networkOpenBtn');
  if (networkOpenBtn) networkOpenBtn.addEventListener('click', async () => {
    const pathVal = ((document.getElementById('networkPath') || {}).value || '').trim();
    if (!pathVal) { showOSD('Enter a path or URL'); return; }
    if (/^https?:|^rtsp:|^rtsps:|^rtmp:|^mms:|^udp:|^smb:/i.test(pathVal) && !/^smb:/i.test(pathVal)) {
      playStream(pathVal);
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


  // ===== bridge for features.js (themes, fullscreen UI, online info, tools, clips, memory...) =====
  (function () {
    const bus = {};
    window.ZApp = {
      api, esc, clamp, lsGet, lsSet, lsDel, formatTime, formatSize, posKey, pathToFileUrl,
      get playlist() { return playlist; },
      get currentIndex() { return currentIndex; },
      get item() { return playlist[currentIndex] || null; },
      get engine() { return engine; },
      get mpvMode() { return mpvMode; },
      get mpvReady() { return mpvReady; },
      get ab() { return abLoop; },
      get duration() { return curDur(); },
      get time() { return curTime(); },
      get seeking() { return isSeeking; },
      isMpv, showOSD, playIndex, seekTo, seekRelative, step, togglePlay, stopAll, setSpeed, setVolume, toggleFullscreen,
      addNativePaths, playStream, renderPlaylist, updateRow, savePlaylistSoon, probeItem, mpvCmd, mpvSet, itemDuration,
      itemsFor() { return playlist.slice(); },
      setMpvReady(v) {
        mpvReady = !!v;
        if (mpvStatus) { mpvStatus.textContent = mpvReady ? 'mpv ready' : 'mpv missing'; mpvStatus.style.color = mpvReady ? 'var(--accent)' : 'var(--text-muted)'; }
      },
      on(name, fn) { (bus[name] || (bus[name] = [])).push(fn); },
      emit(name, ...args) { (bus[name] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error('ZApp.' + name, e); } }); }
    };
  })();

})();

