/* ZephyrPlayer features layer: themes, immersive fullscreen, online posters/info, details, tools & health,
 * A-B clip export, shortcuts, welcome, continue-watching, per-file memory, media session.
 * Talks to the player core only through window.ZApp. */
(function () {
  'use strict';
  const A = window.ZApp;
  if (!A) { console.warn('features.js: ZApp missing'); return; }
  const $ = (id) => document.getElementById(id);
  const api = () => A.api();
  const esc = A.esc;
  const root = document.documentElement;
  const body = document.body;
  const ls = (k, v) => (v === undefined ? A.lsGet(k) : A.lsSet(k, v));
  const S = window.ZSettings;
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
  const open = (id) => { const p = $(id); if (p) p.hidden = false; };
  const close = (id) => { const p = $(id); if (p) p.hidden = true; };

  /* ===================================================================== themes + accent */
  const THEMES = [
    { id: 'zephyr', name: 'Zephyr', bg: '#0b0f14', ac: '#38bdf8' },
    { id: 'midnight', name: 'Midnight', bg: '#070b16', ac: '#818cf8' },
    { id: 'amoled', name: 'AMOLED', bg: '#000000', ac: '#22d3ee' },
    { id: 'ocean', name: 'Ocean', bg: '#06141f', ac: '#2dd4bf' },
    { id: 'forest', name: 'Forest', bg: '#0b140e', ac: '#4ade80' },
    { id: 'sunset', name: 'Sunset', bg: '#170d0d', ac: '#fb923c' },
    { id: 'rose', name: 'Rosé', bg: '#170b12', ac: '#fb7185' },
    { id: 'nord', name: 'Nord', bg: '#2e3440', ac: '#88c0d0' },
    { id: 'dracula', name: 'Dracula', bg: '#282a36', ac: '#bd93f9' },
    { id: 'mocha', name: 'Mocha', bg: '#17110d', ac: '#d4a373' },
    { id: 'mono', name: 'Mono', bg: '#101010', ac: '#e5e5e5' },
    { id: 'contrast', name: 'Contrast', bg: '#000000', ac: '#ffd60a' },
    { id: 'light', name: 'Light', bg: '#f1f5f9', ac: '#0284c7', light: true },
    { id: 'paper', name: 'Paper', bg: '#f6f0e6', ac: '#b45309', light: true },
    { id: 'sky', name: 'Sky', bg: '#e8f1fb', ac: '#2563eb', light: true }
  ];
  const THEME_MAP = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const LEGACY = { dark: 'zephyr' };

  function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mixHex = (h, w, t) => { const a = hexToRgb(h), b = hexToRgb(w); return a && b ? toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t) : h; };
  const lum = (h) => { const c = hexToRgb(h); if (!c) return 0; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };

  function applyAccent() {
    const mode = S.get('accentMode');
    let hex = null;
    if (mode === 'custom') hex = S.get('accentColor');
    else if (mode === 'poster') { const it = A.item; hex = it && it.accent; }
    const st = root.style;
    if (!hexToRgb(hex)) { ['--accent', '--accent-hover', '--accent-soft', '--on-accent'].forEach((v) => st.removeProperty(v)); return; }
    const light = root.getAttribute('data-theme') === 'light';
    if (!light && lum(hex) < 0.2) hex = mixHex(hex, '#ffffff', 0.35);      // keep it readable on dark themes
    if (light && lum(hex) > 0.6) hex = mixHex(hex, '#000000', 0.3);
    const rgb = hexToRgb(hex);
    st.setProperty('--accent', hex);
    st.setProperty('--accent-hover', mixHex(hex, light ? '#000000' : '#ffffff', 0.22));
    st.setProperty('--accent-soft', 'rgba(' + rgb.join(',') + ',0.16)');
    st.setProperty('--on-accent', lum(hex) > 0.45 ? '#0b0f14' : '#ffffff');
  }

  function setTheme(name) {
    name = LEGACY[name] || name;
    if (!THEME_MAP[name]) name = 'zephyr';
    const t = THEME_MAP[name];
    root.setAttribute('data-skin', name);
    root.setAttribute('data-theme', t.light ? 'light' : 'dark');
    ls(t.light ? 'zephyr-skin-light' : 'zephyr-skin-dark', name);
    if (S) S.set('theme', name, { quiet: true });
    document.querySelectorAll('#welcomeSwatches .swatch').forEach((b) => b.classList.toggle('on', b.dataset.id === name));
    applyAccent();
  }
  function toggleLightDark() {
    const cur = THEME_MAP[root.getAttribute('data-skin')] || THEME_MAP.zephyr;
    setTheme(cur.light ? (ls('zephyr-skin-dark') || 'zephyr') : (ls('zephyr-skin-light') || 'light'));
  }
  A.setTheme = setTheme; A.toggleLightDark = toggleLightDark;

  /* ===================================================================== art / online posters */
  const online = () => S.get('online') === true;
  const fileUrl = (p) => A.pathToFileUrl(p);
  const YT = /(?:youtube\.com|youtu\.be)\//i;

  A.artFor = function (item) {
    const mode = S.get('artMode');
    return mode === 'poster' ? (item.poster || item.thumb || null) : (item.thumb || item.poster || null);
  };

  function buildQuery(item) {
    const Z = window.ZName;
    if (!Z) return null;
    if (item.stream) {
      if (YT.test(item.url || '')) return { kind: 'video', title: item.name || '', url: item.url };
      return null;                                           // other sites: yt-dlp already gives a real title; nothing to look up
    }
    const info = item.info || {};
    const audio = !!item.info && !info.hasVideo;
    const p = Z.parse(item.fullName || item.name || '', { audio: audio ? true : undefined, artist: info.artist, title: info.title });
    if (!p.title) return null;
    return { kind: p.kind, title: p.title, artist: p.artist || '', year: p.year, season: p.season, episode: p.episode };
  }

  function stampLibraryPoster(item) {
    if (!item.path || !item.poster) return;
    for (const key of ['zephyr-library-v1', 'zephyr-recent-v1']) {
      try {
        const list = JSON.parse(ls(key) || '[]');
        let changed = false;
        for (const e of list) if (e && e.path === item.path && e.poster !== item.poster) { e.poster = item.poster; changed = true; }
        if (changed) ls(key, JSON.stringify(list));
      } catch {}
    }
  }

  async function lookup(item, force) {
    if (!item || !online() || !api() || !api().onlineLookup) return null;
    if (item.meta && !force) return item.meta;
    if (item._lookingUp) return item._lookingUp;
    const q = buildQuery(item);
    if (!q) return null;
    q.allow = true;
    item._lookingUp = (async () => {
      let r = null;
      try { r = await api().onlineLookup(q); } catch {}
      item._lookingUp = null;
      if (r && r.ok) {
        item.meta = r;
        if (r.posterPath) item.poster = fileUrl(r.posterPath);
        if (r.stillPath) item.still = fileUrl(r.stillPath);
        if (r.accent) item.accent = r.accent;
        if (r.kind === 'music' && r.title && !item._renamed && !(item.info && item.info.title)) { item.name = (r.artist ? r.artist + ' – ' : '') + r.title; item._renamed = true; }
        if (r.kind === 'tv' && r.episode && !item._renamed) { item.epLabel = 'S' + String(r.episode.season).padStart(2, '0') + 'E' + String(r.episode.number).padStart(2, '0') + ' · ' + r.episode.title; }
        A.updateRow(item);
        stampLibraryPoster(item);
        A.savePlaylistSoon();
        if (A.item === item) { onCurrentMeta(item); }
        renderDetails();
      } else { item.metaMiss = true; renderDetails(); }
      return item.meta || null;
    })();
    return item._lookingUp;
  }

  function onCurrentMeta(item) {
    applyAccent();
    updateAudioArt(item);
    updateMediaSession(item);
    if (item.epLabel) A.showOSD(item.meta.title + ' · ' + item.epLabel, 3500);
  }

  /* ----- audio-only art (browser engine) */
  function updateAudioArt(item) {
    const box = $('audioArt'); if (!box) return;
    const audioOnly = item && item.info && !item.info.hasVideo && !A.isMpv();
    if (!audioOnly) { box.hidden = true; return; }
    const art = item.poster || item.thumb;
    const img = $('audioArtImg');
    img.style.backgroundImage = art ? 'url("' + art + '")' : '';
    img.classList.toggle('noart', !art);
    $('audioArtTitle').textContent = (item.meta && item.meta.title) || item.name || '';
    $('audioArtSub').textContent = [item.info.artist || (item.meta && item.meta.artist), item.info.album || (item.meta && item.meta.album)].filter(Boolean).join(' · ');
    box.hidden = false;
  }

  /* ----- OS media overlay (browser engine) */
  let msBound = false;
  function updateMediaSession(item) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !item) return;
    try {
      const art = item.poster || item.thumb;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: (item.meta && item.meta.episode && item.meta.episode.title) || (item.meta && item.meta.title) || item.name || 'ZephyrPlayer',
        artist: (item.info && item.info.artist) || (item.meta && (item.meta.artist || item.meta.title)) || '',
        album: (item.info && item.info.album) || (item.meta && item.meta.album) || '',
        artwork: art ? [{ src: art, sizes: '512x512' }] : []
      });
      if (!msBound) {
        msBound = true;
        const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
        set('play', () => A.togglePlay()); set('pause', () => A.togglePlay());
        set('previoustrack', () => A.step(-1)); set('nexttrack', () => A.step(1));
        set('seekbackward', () => A.seekRelative(-10)); set('seekforward', () => A.seekRelative(10));
        set('seekto', (d) => { if (d && typeof d.seekTime === 'number') A.seekTo(d.seekTime); });
        set('stop', () => A.stopAll());
      }
    } catch {}
  }
  A.on('playstate', (playing) => { try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {} });

  /* ----- fetch info for the whole playlist (slowly, politely) */
  let bulkRunning = false;
  async function fetchAll() {
    if (!online()) { A.showOSD('Turn on "Fetch posters & info" first'); return; }
    if (bulkRunning) { A.showOSD('Already running…'); return; }
    bulkRunning = true;
    const items = A.itemsFor().filter((i) => !i.meta && !i.metaMiss);
    let done = 0, found = 0;
    for (const it of items) {
      if (!online()) break;
      const r = await lookup(it, false);
      done++; if (r) found++;
      if (done % 3 === 0 || done === items.length) A.showOSD('Posters & info: ' + done + '/' + items.length + ' (' + found + ' found)', 1500);
    }
    bulkRunning = false;
    A.showOSD('Done — found info for ' + found + ' of ' + items.length, 2500);
  }

  /* ===================================================================== details panel */
  function chip(t) { return '<span class="chip">' + esc(t) + '</span>'; }
  let detailsItem = null;
  function renderDetails() {
    const panel = $('detailsPanel'); if (!panel || panel.hidden) return;
    const it = detailsItem || A.item;
    const m = it && it.meta;
    $('detailsTitle').textContent = !it ? 'Nothing playing' : ((m && m.title) || it.name);
    const line = [];
    if (m) { if (m.episode) line.push('S' + String(m.episode.season).padStart(2, '0') + 'E' + String(m.episode.number).padStart(2, '0') + ' · ' + m.episode.title); if (m.artist) line.push(m.artist); if (m.album) line.push(m.album); if (m.year) line.push(m.year); if (m.genre) line.push(m.genre); if (m.rating) line.push('★ ' + m.rating); if (m.runtime) line.push(m.runtime + ' min'); if (m.network) line.push(m.network); if (m.director) line.push('Dir. ' + m.director); }
    $('detailsLine').textContent = line.join('  ·  ');
    const chips = [];
    const i = it && it.info;
    if (i) { if (i.hasVideo) chips.push((i.width || '?') + '×' + (i.height || '?')); if (i.vcodec) chips.push(i.vcodec.toUpperCase()); if (i.bitDepth >= 10) chips.push(i.bitDepth + '-bit'); if (i.hdr) chips.push(i.hdr); if (i.acodec) chips.push(i.acodec.toUpperCase() + (i.achannels ? ' ' + i.achannels + 'ch' : '')); if (i.audioTracks > 1) chips.push(i.audioTracks + ' audio'); if (i.subTracks) chips.push(i.subTracks + ' subs'); if (it.size) chips.push(A.formatSize(it.size)); if (A.itemDuration(it)) chips.push(A.formatTime(A.itemDuration(it))); }
    $('detailsChips').innerHTML = chips.map(chip).join('');
    $('detailsOverview').textContent = (m && m.overview) || '';
    const art = it && (it.poster || it.thumb);
    const pbox = $('detailsPoster');
    pbox.style.backgroundImage = art ? 'url("' + art + '")' : '';
    pbox.classList.toggle('noart', !art);
    $('detailsSource').textContent = m && m.source ? 'Info from ' + m.source : '';
    const openBtn = $('detailsOpen'); openBtn.hidden = !(m && /^https:\/\//.test(m.url || ''));
    const hint = $('detailsHint'); const btn = $('detailsRefresh');
    if (!online()) { hint.textContent = 'Online info is off. Turn it on to fetch the poster, plot and cast info for what you play (only the title is sent).'; btn.textContent = 'Turn on online info'; }
    else if (it && it.metaMiss && !m) { hint.textContent = 'No confident match was found online for this file name. Renaming it like "Movie Name (2019).mkv" or "Show.S01E02.mkv" helps.'; btn.textContent = 'Look up again'; }
    else { hint.textContent = ''; btn.textContent = 'Look up again'; }
  }
  function openDetails(item) { detailsItem = item && item.fullName ? item : null; const it = detailsItem || A.item; open('detailsPanel'); renderDetails(); if (it && online() && !it.meta) lookup(it, false); }
  A.openDetails = openDetails;
  on($('detailsBtn'), 'click', () => { close('moreMenu'); openDetails(); });
  on($('closeDetails'), 'click', () => { detailsItem = null; close('detailsPanel'); });
  on($('detailsRefresh'), 'click', async () => {
    if (!online()) { setOnline(true); }
    const it = detailsItem || A.item; if (!it) return;
    it.meta = null; it.metaMiss = false; await lookup(it, true); renderDetails();
  });
  on($('detailsOpen'), 'click', () => { const it = A.item; if (it && it.meta && it.meta.url && api()) api().openExternal(it.meta.url); });

  function setOnline(v) {
    S.set('online', !!v);
    const w = $('welcomeOnline'); if (w) w.checked = !!v;
  }

  /* ===================================================================== settings -> behaviour */
  function pushAudioPrefs() {
    if (api() && api().mpvApplyAudioPrefs) api().mpvApplyAudioPrefs({ limiter: S.get('softLimiter'), normalize: S.get('normalize'), night: S.get('nightMode') }).catch(() => {});
  }
  function applySetting(id, v) {
    switch (id) {
      case 'theme': setTheme(v); break;
      case 'accentMode': case 'accentColor': applyAccent(); break;
      case 'fsLine': body.classList.toggle('fs-line-off', !v); break;
      case 'splash': if (api() && api().setSetting) api().setSetting('splash', !!v); break;
      case 'online': { const w = $('welcomeOnline'); if (w) w.checked = !!v; if (v && A.item) lookup(A.item, false); break; }
      case 'artMode': A.renderPlaylist(); break;
      case 'seekStep': case 'seekStepBig': case 'autoNext': case 'rememberPos': case 'skipBad': case 'volumeMax': case 'volumeStep': A.setPref(id, v); break;
      case 'softLimiter': case 'normalize': case 'nightMode': pushAudioPrefs(); break;
      case 'deinterlace': case 'smoothMotion': pushVideoPrefs(); break;
      case 'quality': { const q = $('qualitySelect'); if (q && q.value !== v) { q.value = v; if (A.isMpv()) q.dispatchEvent(new Event('change')); } break; }
      default: break;
    }
  }
  function pushVideoPrefs() {
    if (api() && api().mpvSetProps) api().mpvSetProps({ deinterlace: !!S.get('deinterlace'), interpolation: !!S.get('smoothMotion'), 'video-sync': S.get('smoothMotion') ? 'display-resample' : 'audio' }).catch(() => {});
  }
  S.on(null, (v, id) => applySetting(id, v));
  A.applySetting = applySetting;
  body.classList.toggle('fs-line-off', !S.get('fsLine'));
  { const q = $('qualitySelect'); if (q) q.value = S.get('quality'); }
  pushAudioPrefs();
  if (S.get('deinterlace') || S.get('smoothMotion')) pushVideoPrefs();
  if (api() && api().setSetting) api().getSetting('splash').then((r) => { if (r && r.ok && typeof r.value === 'boolean' && r.value !== S.get('splash')) S.set('splash', r.value, { quiet: true }); }).catch(() => {});
  on($('fetchAllInfoBtn'), 'click', fetchAll);
  A.fetchAllInfo = fetchAll;
  A.clearOnlineCache = async () => {
    if (!api() || !api().onlineClearCache) return;
    const r = await api().onlineClearCache();
    A.itemsFor().forEach((i) => { i.meta = null; i.metaMiss = false; i.poster = null; i.accent = null; });
    A.renderPlaylist();
    A.showOSD('Poster cache cleared (' + ((r && r.removed) || 0) + ' files)');
  };

  // pause when minimised / hidden, resume on return (opt-in)
  let pausedByHide = false;
  document.addEventListener('visibilitychange', () => {
    if (!S.get('pauseOnMinimize')) return;
    if (document.hidden) { if (A.isPlaying()) { pausedByHide = true; A.pausePlayback(); } }
    else if (pausedByHide) { pausedByHide = false; A.resumePlayback(); }
  });

  /* ===================================================================== immersive fullscreen */
  const FS = { x: -1, y: -1, last: 0, moveUntil: 0, hide: { top: 0, bottom: 0, side: 0 }, pinSide: false, handleUntil: 0, timer: null };
  const inFs = () => !!document.fullscreenElement;
  function over(el, pad) {
    if (!el || FS.x < 0) return false;
    const r = el.getBoundingClientRect();
    return FS.x >= r.left - pad && FS.x <= r.right + pad && FS.y >= r.top - pad && FS.y <= r.bottom + pad;
  }
  const uiBusy = () => !!document.querySelector('.popup-menu:not([hidden]), .settings-panel:not([hidden]), .zctx') || A.seeking;

  function evaluate() {
    if (!inFs()) return;
    const now = Date.now();
    const w = window.innerWidth, h = window.innerHeight;
    const busy = uiBusy();
    const moved = S.get('fsReveal') === 'move' && now < FS.moveUntil;          // any mouse movement shows the controls for a moment
    const want = {
      bottom: busy || moved || FS.y > h - 150 || over($('controls'), 8),
      top: moved || FS.y >= 0 && FS.y < 90 || over(document.querySelector('.top-bar'), 8),
      side: FS.pinSide || FS.x > w - 28 || over($('sidebar'), 8)
    };
    let anyShown = false;
    for (const z of ['top', 'bottom', 'side']) {
      const cls = 'fs-' + z;
      if (want[z]) { body.classList.add(cls); FS.hide[z] = 0; }
      else if (body.classList.contains(cls)) {
        if (!FS.hide[z]) FS.hide[z] = now + 650;               // small grace period so it never flickers
        else if (now >= FS.hide[z]) { body.classList.remove(cls); FS.hide[z] = 0; }
      }
      if (body.classList.contains(cls)) anyShown = true;
    }
    body.classList.toggle('fs-handle', now < FS.handleUntil && !body.classList.contains('fs-side'));
    const idle = now - FS.last > (S.get('cursorHide') || 2) * 1000;
    body.classList.toggle('fs-nocursor', idle && !anyShown && !busy);
  }
  function onMove(e) {
    if (!inFs()) return;
    const moved = FS.x < 0 || Math.abs(e.clientX - FS.x) + Math.abs(e.clientY - FS.y) >= 2;
    FS.x = e.clientX; FS.y = e.clientY; FS.last = Date.now(); FS.handleUntil = FS.last + 1800;
    if (moved) FS.moveUntil = FS.last + 2600;
    evaluate();
  }
  function enterFs() {
    body.classList.add('is-fs');
    FS.last = Date.now(); FS.x = -1; FS.y = -1; FS.pinSide = false; FS.moveUntil = 0;
    clearInterval(FS.timer); FS.timer = setInterval(evaluate, 180);
    A.showOSD('Move the mouse for the controls, to the right edge for the playlist', 2800);
  }
  function leaveFs() {
    clearInterval(FS.timer); FS.timer = null;
    body.classList.remove('is-fs', 'fs-top', 'fs-bottom', 'fs-side', 'fs-handle', 'fs-nocursor');
    FS.pinSide = false;
  }
  document.addEventListener('fullscreenchange', () => { if (inFs()) enterFs(); else leaveFs(); });
  document.addEventListener('mousemove', onMove, { passive: true });
  on($('fsSideHandle'), 'click', () => { FS.pinSide = !FS.pinSide; evaluate(); });
  A.on('progress', (pct) => { const f = $('fsLineFill'); if (f) f.style.width = pct + '%'; });

  /* ===================================================================== tools & health */
  const ONLY_ID = { mpv: 'mpv', 'yt-dlp': 'ytdlp', ytdlp: 'ytdlp', deno: 'js', quickjs: 'js', ffmpeg: 'ffmpeg', ffprobe: 'ffmpeg', whisper: 'whisper' };
  const UPD_ID = { mpv: 'mpv', 'yt-dlp': 'ytdlp', deno: 'deno', quickjs: 'quickjs', ffmpeg: 'ffmpeg', whisper: 'whisper' };
  let updInfo = {};                                   // id -> { status, installed, latest }
  async function refreshTools() {
    const rows = $('toolsRows'); if (!rows || !api() || !api().toolsStatus) return;
    rows.innerHTML = '<tr><td colspan="3" class="muted">Checking…</td></tr>';
    const r = await api().toolsStatus().catch(() => null);
    if (!r || !r.tools) { rows.innerHTML = '<tr><td colspan="3" class="muted">Could not check tools.</td></tr>'; return null; }
    rows.innerHTML = '';
    for (const t of r.tools) {
      const tr = document.createElement('tr');
      const ok = !!t.path;
      tr.innerHTML = '<td><b>' + esc(t.name) + '</b><div class="muted">' + esc(t.role) + '</div></td>' +
        '<td class="' + (ok ? 'ok' : (t.required ? 'bad' : 'warn')) + '">' + (ok ? '✓ ' + esc((t.version || 'found').slice(0, 42)) : (t.required ? '✗ Missing' : '– Optional, not installed')) + '</td>' +
        '<td class="muted tpath" title="' + esc(t.path || '') + '">' + esc((t.path || '').split(/[/\\]/).slice(-2).join('/')) + '</td>';
      // per-tool button: Download when missing, Update when a newer release exists
      const act = document.createElement('td'); act.className = 'tact';
      const upd = updInfo[UPD_ID[t.name]];
      if (!ok || (upd && upd.status === 'update')) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost sm';
        b.textContent = ok ? 'Update' + (upd && upd.latest ? ' to ' + String(upd.latest).replace(/^v/, '').slice(0, 14) : '') : 'Download';
        b.addEventListener('click', () => runToolsJob({ only: [ONLY_ID[t.name]], whisper: t.name === 'whisper' }, (ok ? 'Updating ' : 'Downloading ') + t.name + '…', t.name + (ok ? ' updated' : ' downloaded')));
        act.appendChild(b);
      } else if (upd && upd.status === 'current') act.textContent = 'up to date';
      tr.appendChild(act);
      rows.appendChild(tr);
    }
    for (const id of ['toolsInstall', 'toolsTest']) { const btn = $(id); if (btn) { btn.disabled = !r.canInstall; btn.title = r.canInstall ? (id === 'toolsTest' ? 'Encodes, decodes, plays and transcribes real test data' : '') : 'Needs Windows and setup-tools.ps1 next to the app'; } }
    const note = $('toolsNote'); if (note) note.textContent = r.jsRuntime === 'electron-node' ? 'No deno.exe found: YouTube uses the built-in fallback runtime. Installing deno makes it more reliable.' : (r.canInstall ? '' : 'Automatic install is not available here. See TOOLS.md for the download list.');
    return r;
  }
  async function renderCodecs() {
    const box = $('codecReport'); if (!box || !api() || !api().codecReport) return;
    box.textContent = 'Reading the codec list…';
    const r = await api().codecReport().catch(() => null);
    if (!r || !r.ok) { box.textContent = 'Codec report unavailable' + (r && r.error ? ': ' + r.error : '') + ' (needs ffmpeg).'; return; }
    const sec = (title, list) => '<h4>' + esc(title) + '</h4><div class="codec-grid">' + list.map((c) => '<span class="codec ' + (c.ok ? 'ok' : 'no') + '" title="' + esc(c.id) + '">' + (c.ok ? '✓ ' : '✗ ') + esc(c.name) + '</span>').join('') + '</div>';
    box.innerHTML = '<p class="muted">' + r.total + ' decoders available. Hardware acceleration: ' + esc((r.hwaccels || []).join(', ') || 'none found') + '. This is the ffmpeg build; mpv uses the same codec families.</p>' + sec('Video', r.video) + sec('Audio', r.audio) + sec('Subtitles', r.subtitles);
  }
  on($('codecBtn'), 'click', renderCodecs);
  function updateIdsToOnly(ids) { return Array.from(new Set(ids.map((i) => ONLY_ID[i]).filter(Boolean))); }
  async function checkUpdates(manual) {
    if (!api() || !api().checkToolUpdates) return null;
    const sum = $('updateSummary'); if (manual && sum) sum.textContent = 'Checking the release pages…';
    const r = await api().checkToolUpdates().catch(() => null);
    A.lsSet('zephyr-tool-check', String(Date.now()));
    if (!r || !r.list) { if (sum) sum.textContent = 'Could not check (offline?).'; return null; }
    updInfo = {}; r.list.forEach((x) => { updInfo[x.id] = x; });
    const ups = r.list.filter((x) => x.status === 'update'), unk = r.list.filter((x) => x.status === 'unknown');
    if (sum) sum.textContent = ups.length ? 'Newer versions: ' + ups.map((x) => x.name + ' ' + String(x.installed || '?') + ' → ' + String(x.latest).replace(/^v/, '')).join(' · ') : (r.list.every((x) => x.status === 'offline') ? 'Could not reach the release pages (offline?).' : 'Everything is up to date.' + (unk.length ? ' (' + unk.map((x) => x.name).join(', ') + ': version unknown, use Update to refresh)' : ''));
    if (!$('toolsPanel').hidden) refreshTools();
    return r;
  }
  on($('toolsUpdates'), 'click', () => checkUpdates(true));
  async function backgroundUpdateCheck() {
    const mode = S.get('toolUpdates');
    if (mode === 'off' || !api() || !api().checkToolUpdates) return;
    if (Date.now() - (parseInt(A.lsGet('zephyr-tool-check') || '0', 10) || 0) < 20 * 3600 * 1000) return;      // once a day
    const r = await checkUpdates(false);
    if (!r || !r.updates.length) return;
    const only = updateIdsToOnly(r.updates);
    if (mode === 'auto') {
      A.showOSD('Updating ' + r.updates.length + ' tool' + (r.updates.length > 1 ? 's' : '') + ' in the background…', 3000);
      const res = await api().toolsInstall({ only, whisper: only.includes('whisper'), force: true }).catch(() => null);
      A.showOSD(res && res.ok ? 'Tools updated' : 'Some tool updates failed (see Tools & health)', 3500);
      return;
    }
    const names = r.list.filter((x) => x.status === 'update').map((x) => x.name);
    $('updateText').textContent = 'Updates available: ' + names.join(', ');
    $('updateBanner').dataset.only = only.join(','); $('updateBanner').hidden = false;
  }
  on($('updateNow'), 'click', async () => { const b = $('updateBanner'); b.hidden = true; await openTools(); runToolsJob({ only: (b.dataset.only || '').split(',').filter(Boolean), whisper: (b.dataset.only || '').includes('whisper') }, 'Updating…', 'Tools updated'); });
  on($('updateLater'), 'click', () => { $('updateBanner').hidden = true; });
  setTimeout(backgroundUpdateCheck, 9000);
  async function openTools() { open('toolsPanel'); if (api() && api().getEdition) api().getEdition().then((e) => { const el = $('editionLabel'); if (el && e && e.label) el.textContent = e.label; }).catch(() => {}); return refreshTools(); }
  on($('toolsBtn'), 'click', () => { close('moreMenu'); openTools(); });
  on($('closeTools'), 'click', () => close('toolsPanel'));
  on($('toolsRefresh'), 'click', refreshTools);
  on($('toolsDocs'), 'click', () => api() && api().openDocs && api().openDocs('tools'));
  async function copyDiag() { if (!api() || !api().collectDiagnostics) return; const r = await api().collectDiagnostics().catch(() => null); A.showOSD(r && r.ok ? 'Diagnostics copied — paste them into your bug report' : 'Could not collect diagnostics', 3000); }
  on($('toolsDiag'), 'click', copyDiag);
  let installing = false;
  async function runToolsJob(opts, startLabel, doneLabel) {
    if (installing || !api() || !api().toolsInstall) return;
    installing = true;
    const bi = $('toolsInstall'), bt = $('toolsTest'), log = $('toolsLog');
    const labelI = bi.textContent, labelT = bt ? bt.textContent : '';
    bi.disabled = true; if (bt) bt.disabled = true;
    (opts.testOnly ? bt : bi).textContent = startLabel;
    log.hidden = false; log.textContent = '';
    const r = await api().toolsInstall(opts).catch((e) => ({ ok: false, error: e && e.message }));
    installing = false; bi.textContent = labelI; if (bt) { bt.textContent = labelT; bt.disabled = false; }
    log.textContent += '\n' + (r && r.ok ? 'Finished: everything passed.' : 'Finished with problems (see the FAIL / WARN lines above).' + ((r && r.error) ? ' ' + r.error : '')) + '\n';
    log.scrollTop = log.scrollHeight;
    const st = await refreshTools();
    if (st) { const mpv = st.tools.find((t) => t.name === 'mpv'); A.setMpvReady(!!(mpv && mpv.path)); bi.disabled = !st.canInstall; if (bt) bt.disabled = !st.canInstall; }
    A.showOSD(r && r.ok ? doneLabel : 'Finished with problems — see the log', 3500);
  }
  on($('toolsInstall'), 'click', () => runToolsJob({ whisper: !!($('toolsWhisper') || {}).checked }, 'Installing… (a few minutes)', 'Tools installed and verified'));
  on($('toolsTest'), 'click', () => runToolsJob({ testOnly: true, whisper: true }, 'Testing… (about a minute)', 'All tools passed the self-test'));
  if (api() && api().onToolsProgress) api().onToolsProgress((p) => { const log = $('toolsLog'); if (log && p && p.line) { log.hidden = false; log.textContent += p.line + '\n'; log.scrollTop = log.scrollHeight; } });

  // one gentle heads-up per session when something essential is missing
  async function healthCheck() {
    if (!api() || !api().toolsStatus) return;
    const r = await api().toolsStatus().catch(() => null);
    if (!r || !r.tools) return;
    const missing = r.tools.filter((t) => t.required && !t.path).map((t) => t.name);
    if (!missing.length) return;
    const need = { mpv: 'mkv / HEVC / everything', 'yt-dlp': 'YouTube & links', deno: 'YouTube & links', quickjs: 'YouTube & links' };
    $('healthText').textContent = 'Missing: ' + missing.map((m) => m + ' (' + (need[m] || 'needed') + ')').join(', ') + '.';
    $('healthBanner').dataset.only = updateIdsToOnly(missing).join(',');
    $('healthBanner').hidden = false;
  }
  on($('healthFix'), 'click', async () => { const b = $('healthBanner'); b.hidden = true; await openTools(); runToolsJob({ only: (b.dataset.only || '').split(',').filter(Boolean) }, 'Downloading…', 'Missing tools downloaded'); });
  on($('healthClose'), 'click', () => { $('healthBanner').hidden = true; });

  /* ===================================================================== clear watch history */
  // History = resume positions, the Continue-watching shelf, the recent-files lists and the progress on library cards.
  // The playlist, your files and your settings are not touched.
  function clearHistory() {
    let removed = 0;
    try {
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach((k) => { if (/^zephyr-(pos2?-|dur-)/.test(k) || k === 'zephyr-continue-v1' || k === 'zephyr-recent-v1') { localStorage.removeItem(k); removed++; } });
      const lib = JSON.parse(localStorage.getItem('zephyr-library-v1') || '[]'); if (Array.isArray(lib)) { lib.forEach((e) => { if (e) e.progress = 0; }); localStorage.setItem('zephyr-library-v1', JSON.stringify(lib)); }
    } catch { /* storage unavailable */ }
    if (api() && api().clearHistory) api().clearHistory().catch(() => {});
    A.renderPlaylist();
    renderShelf();
    A.showOSD('Watch history cleared' + (removed ? ' (' + removed + ' entries)' : ''), 2500);
  }
  A.clearHistory = clearHistory;
  A.confirmClearHistory = () => offer('Clear your watch history? That forgets where you stopped in each file, the "Continue watching" shelf and the recent-files lists. Your playlist and files are not touched.', [
    { label: 'Clear history', primary: true, run: clearHistory }, { label: 'Cancel', run: () => {} }]);

  /* ===================================================================== when nothing can play it: other players */
  let failBannerFor = null;
  async function onPlayFail(item, msg) {
    const mode = S.get('failAction');
    if (!item || !item.path || mode === 'never' || !api() || !api().externalList) return;
    const r = await api().externalList().catch(() => null);
    const players = (r && r.players) || [];
    if (!players.length) return;
    const pref = S.get('externalPlayer');
    const chosen = players.find((p) => p.id === pref) || players[0];
    if (mode === 'auto') {
      const o = await api().externalOpen({ id: chosen.id, file: item.path }).catch(() => null);
      A.showOSD(o && o.ok ? 'Opened in ' + chosen.name : 'Could not open ' + chosen.name, 3000);
      return;
    }
    failBannerFor = item;
    const box = $('failBanner'); if (!box) return;
    $('failText').textContent = 'ZephyrPlayer could not play “' + item.name.slice(0, 50) + '”.';
    const wrap = $('failPlayers'); wrap.textContent = '';
    players.slice(0, 4).forEach((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = 'Open in ' + p.name + (p.klite ? ' (K-Lite)' : '');
      b.addEventListener('click', async () => { const o = await api().externalOpen({ id: p.id, file: failBannerFor.path }).catch(() => null); A.showOSD(o && o.ok ? 'Opened in ' + p.name : 'Could not open ' + p.name, 2500); box.hidden = true; });
      wrap.appendChild(b);
    });
    box.hidden = false;
  }
  A.holdOnFail = false;
  A.on('playfail', (item, msg) => { A.holdOnFail = S.get('failAction') === 'ask'; onPlayFail(item, msg); });
  on($('failClose'), 'click', () => { const b = $('failBanner'); if (b) b.hidden = true; });
  A.on('itemstart', () => { const b = $('failBanner'); if (b) b.hidden = true; });

  /* ===================================================================== no sound / no picture: clear, one-click ways out */
  // Shared banner (the same one used when a file cannot be played at all).
  function offer(text, buttons) {
    const box = $('failBanner'); if (!box) return;
    $('failText').textContent = text;
    const wrap = $('failPlayers'); wrap.textContent = '';
    buttons.forEach((b) => {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'btn ' + (b.primary ? 'btn-primary' : 'btn-ghost'); el.textContent = b.label;
      el.addEventListener('click', () => { box.hidden = true; b.run(); });
      wrap.appendChild(el);
    });
    box.hidden = false;
  }
  A.offer = offer;
  const CODEC_LABEL = { ac3: 'Dolby Digital (AC-3)', eac3: 'Dolby Digital Plus', dts: 'DTS', truehd: 'Dolby TrueHD', hevc: 'HEVC / H.265', mpeg2video: 'MPEG-2', vc1: 'VC-1', wmv3: 'WMV', wmav2: 'WMA' };
  const codecLabel = (c) => CODEC_LABEL[c] || String(c || 'unknown').toUpperCase();
  function mpvNote() {
    if (A.mpvBroken || (A.mpvReady && A.lastMpvError)) return 'mpv is installed but could not play it on this PC' + (A.lastMpvError ? ' (it said: ' + A.lastMpvError.split(/\r?\n/).filter(Boolean).slice(-1)[0].slice(0, 110) + ')' : '') + '.';
    return A.mpvReady ? '' : 'mpv, which plays it, is not available here.';
  }
  const BROWSER_VIDEO = ['h264', 'vp8', 'vp9', 'av1', 'theora'];

  async function downloadMpv(item) {
    if (!api() || !api().toolsInstall) return;
    const off = api().onToolsProgress ? api().onToolsProgress((p) => { if (p && p.line && /downloading|extract|installed|==/i.test(p.line)) A.showOSD('mpv: ' + String(p.line).replace(/^\s*==\s*/, '').slice(0, 70), 2500); }) : null;
    A.showOSD('Downloading mpv (free, about 35 MB)…', 6000);
    const r = await api().toolsInstall({ only: ['mpv'], force: true }).catch(() => null);
    if (typeof off === 'function') off();
    const st = await (api().mpvAvailable ? api().mpvAvailable() : Promise.resolve(null)).catch(() => null);
    A.setMpvReady(!!(st && st.available));
    if (st && st.available) {
      A.showOSD('mpv is ready', 2500);
      if (item) { item._htmlTried = false; item._triedMpv = false; item.forceMpv = true; A.playIndex(A.playlist.indexOf(item), { startPos: A.time, noHistory: true }); }
    } else A.showOSD('Could not download mpv' + (r && r.error ? ': ' + r.error : '') + '. Tools & health can retry.', 6000);
  }

  async function fixSound(item) {
    if (!item || !item.path || !api() || !api().fixAudio) return;
    const off = api().onFixProgress ? api().onFixProgress((p) => { if (p) A.showOSD('Fixing the sound… ' + p.percent + '%  (the video is not touched)', 1600); }) : null;
    A.showOSD('Fixing the sound: the video is copied as it is, only the audio is converted. This takes a minute or two…', 5000);
    const t = A.time;
    const r = await api().fixAudio(item.path).catch(() => null);
    if (typeof off === 'function') off();
    if (r && r.ok) {
      item.altUrl = fileUrl(r.path);
      A.showOSD(r.cached ? 'Sound fixed (used the saved copy)' : 'Sound fixed', 2200);
      A.playIndex(A.playlist.indexOf(item), { startPos: t, noHistory: true });
    } else A.showOSD('Could not fix the sound: ' + ((r && r.error) || 'unknown error'), 6000);
  }
  A.fixSound = fixSound; A.downloadMpv = downloadMpv;

  A.on('nocodec', async (item, kind) => {
    if (!item || item._offered || item.altUrl) return;
    item._offered = true;
    const info = item.info || {};
    const audioOnlyProblem = info.hasVideo === false ? false : (BROWSER_VIDEO.includes(info.vcodec) && !(info.bitDepth > 8));
    const buttons = [];
    if (item.path && audioOnlyProblem) buttons.push({ label: 'Fix sound (keeps the video)', primary: true, run: () => fixSound(item) });
    if (!A.mpvReady && !A.mpvBroken) buttons.push({ label: 'Download mpv (free)', primary: !buttons.length, run: () => downloadMpv(item) });
    let players = [];
    if (api() && api().externalList) players = ((await api().externalList().catch(() => null)) || {}).players || [];
    players.slice(0, 3).forEach((pl) => buttons.push({ label: 'Open in ' + pl.name + (pl.klite ? ' (K-Lite)' : ''), run: () => api().externalOpen({ id: pl.id, file: item.path }).then((o) => A.showOSD(o && o.ok ? 'Opened in ' + pl.name : 'Could not open ' + pl.name, 2500)) }));
    if (!buttons.length) return;
    const text = audioOnlyProblem
      ? 'No sound: the built-in player cannot play this file\'s audio (' + codecLabel(info.acodec) + ', common on Blu-ray rips). ' + mpvNote()
      : 'The built-in player cannot decode this file (' + codecLabel(info.vcodec !== undefined && !BROWSER_VIDEO.includes(info.vcodec) ? info.vcodec : info.acodec) + '). ' + mpvNote();
    offer(text, buttons);
  });
  A.on('needmpv', () => {
    offer('Extra volume (above 100%) needs mpv, which is not available on this PC.', [
      { label: 'Download mpv (free)', primary: true, run: () => downloadMpv(A.item) },
      { label: 'Not now', run: () => {} }
    ]);
  });

  /* ===================================================================== clip export */
  let lastClip = null;
  function openClip() {
    const it = A.item;
    if (!it || it.stream || !it.path) { A.showOSD('Clips need a local file'); return; }
    const ab = A.ab;
    if (ab.a === null || ab.b === null) { A.showOSD('Set the A and B points first (A key / A-B button)', 3000); return; }
    $('clipRange').textContent = 'A ' + A.formatTime(ab.a) + '  →  B ' + A.formatTime(ab.b) + '   (' + Math.round(ab.b - ab.a) + ' s)';
    $('clipStatus').textContent = ''; $('clipShow').hidden = true; lastClip = null;
    document.querySelectorAll('#clipPanel [data-clip]').forEach((b) => { b.disabled = false; });
    open('clipPanel');
  }
  on($('clipBtn'), 'click', () => { close('moreMenu'); openClip(); });
  on($('closeClip'), 'click', () => close('clipPanel'));
  document.querySelectorAll('#clipPanel [data-clip]').forEach((b) => on(b, 'click', async () => {
    const it = A.item, ab = A.ab; if (!it || !api() || !api().exportClip) return;
    const btns = document.querySelectorAll('#clipPanel [data-clip]'); btns.forEach((x) => { x.disabled = true; });
    $('clipStatus').textContent = 'Working…';
    const r = await api().exportClip({ path: it.path, start: ab.a, end: ab.b, mode: b.dataset.clip, hasVideo: !(it.info && !it.info.hasVideo) }).catch((e) => ({ ok: false, error: e && e.message }));
    btns.forEach((x) => { x.disabled = false; });
    if (r && r.cancelled) { $('clipStatus').textContent = ''; return; }
    if (r && r.ok) {
      lastClip = r.path;
      $('clipStatus').textContent = 'Saved ' + (r.size / 1048576).toFixed(1) + ' MB' + (r.switched ? '. Fast copy would have started seconds early, so an exact MP4 cut was made instead.' : '.');
      $('clipShow').hidden = false;
      A.showOSD('Clip saved', 2500);
    } else $('clipStatus').textContent = 'Failed: ' + ((r && r.error) || 'unknown error');
  }));
  on($('clipShow'), 'click', () => { if (lastClip && api() && api().showItem) api().showItem(lastClip); });

  /* ===================================================================== shortcuts */
  const MOUSE_LABELS = { none: 'nothing', volume: 'volume', seek: 'skip', speed: 'speed', track: 'previous / next item' };
  function renderShortcuts() {
    const b = $('shortcutsBody'); if (!b) return;
    const C = A.controls;
    const groups = {};
    if (C) C.ACTIONS.forEach((a) => { (groups[a.group] = groups[a.group] || []).push(a); });
    let html = '';
    for (const g of Object.keys(groups)) {
      html += '<h4>' + esc(g) + '</h4><table>' + groups[g].map((a) => {
        const keys = C.effectiveKeys(a.id);
        return '<tr><td>' + (keys.length ? keys.map((k) => '<kbd>' + esc(C.prettyCombo(k)) + '</kbd>').join(' ') : '<span class="muted">not set</span>') + '</td><td>' + esc(a.label) + '</td></tr>';
      }).join('') + '</table>';
    }
    const w = (id) => MOUSE_LABELS[S.get(id)] || S.get(id);
    html += '<h4>Mouse</h4><table>' +
      '<tr><td>Wheel</td><td>' + esc(w('wheel')) + '</td></tr><tr><td>Shift + wheel</td><td>' + esc(w('wheelShift')) + '</td></tr><tr><td>Ctrl + wheel</td><td>' + esc(w('wheelCtrl')) + '</td></tr>' +
      '<tr><td>Esc</td><td>Leave fullscreen / close panels</td></tr></table>' +
      '<h4>In fullscreen</h4><table><tr><td>Mouse to the bottom</td><td>Seek bar and buttons</td></tr><tr><td>Mouse to the right edge</td><td>Playlist</td></tr><tr><td>Mouse to the top</td><td>Title bar</td></tr></table>' +
      '<h4>In the mpv window</h4><table><tr><td><kbd>&lt;</kbd> <kbd>&gt;</kbd></td><td>Previous / next item in your playlist</td></tr><tr><td><kbd>F8</kbd></td><td>Show what is up next</td></tr></table>' +
      '<p class="settings-note">Change any of these in Settings &gt; Keys &amp; mouse.</p>';
    b.innerHTML = html;
  }
  function openShortcuts() { renderShortcuts(); open('shortcutsPanel'); }
  A.openShortcuts = openShortcuts;
  on($('shortcutsBtn'), 'click', () => { close('moreMenu'); openShortcuts(); });
  on($('closeShortcuts'), 'click', () => close('shortcutsPanel'));
  on($('guideBtn'), 'click', () => { close('moreMenu'); if (api() && api().openDocs) api().openDocs('guide').then((r) => { if (r && !r.ok) A.showOSD('User guide not found next to the app'); }); });

  /* ===================================================================== welcome (first run) */
  function buildSwatches() {
    const box = $('welcomeSwatches'); if (!box || box.dataset.done) return;
    box.dataset.done = '1';
    THEMES.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.id = t.id; b.title = t.name;
      b.style.background = 'linear-gradient(135deg,' + t.bg + ' 55%,' + t.ac + ' 55%)';
      b.innerHTML = '<span>' + esc(t.name) + '</span>';
      b.addEventListener('click', () => S.set('theme', t.id));
      box.appendChild(b);
    });
    box.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.id === root.getAttribute('data-skin')));
  }
  function maybeWelcome() {
    if (ls('zephyr-welcomed') === '1') return;
    buildSwatches();
    $('welcomeOnline').checked = online();
    open('welcomePanel');
  }
  on($('welcomeOnline'), 'change', (e) => setOnline(e.target.checked));
  on($('welcomeGo'), 'click', () => { ls('zephyr-welcomed', '1'); close('welcomePanel'); });
  on($('welcomeTools'), 'click', () => { ls('zephyr-welcomed', '1'); close('welcomePanel'); openTools(); });

  /* ===================================================================== continue watching */
  const CW = 'zephyr-continue-v1';
  const cwLoad = () => { try { return JSON.parse(ls(CW) || '[]'); } catch { return []; } };
  const cwSave = (l) => ls(CW, JSON.stringify(l.slice(0, 12)));
  A.on('position', (item, t, d) => {
    if (!item || !d || t < 10) return;
    let list = cwLoad().filter((e) => e.k !== A.posKey(item));
    if (t < d * 0.92) list.unshift({ k: A.posKey(item), path: item.path || null, url: item.stream ? item.url : null, name: item.name, art: (A.artFor(item) || null), pos: Math.floor(t), dur: Math.floor(d), at: Date.now() });
    cwSave(list);
  });
  A.on('itemend', (item) => { if (item) cwSave(cwLoad().filter((e) => e.k !== A.posKey(item))); renderShelf(); });
  function renderShelf() {
    const shelf = $('continueShelf'); if (!shelf) return;
    const list = cwLoad().filter((e) => e.dur > 0 && e.pos / e.dur > 0.02 && e.pos / e.dur < 0.92).slice(0, 6);
    if (!list.length) { shelf.hidden = true; shelf.innerHTML = ''; return; }
    shelf.hidden = false;
    shelf.innerHTML = '<h3>Continue watching</h3><div class="cw-row"></div>';
    const row = shelf.querySelector('.cw-row');
    list.forEach((e) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cw-card'; b.title = e.name;
      const art = document.createElement('div'); art.className = 'cw-art';
      if (e.art) art.style.backgroundImage = 'url("' + e.art + '")'; else art.appendChild(window.ZIcons ? window.ZIcons.make('film') : document.createTextNode(''));
      const bar = document.createElement('i'); bar.style.width = Math.min(100, e.pos / e.dur * 100) + '%'; art.appendChild(bar);
      const nm = document.createElement('div'); nm.className = 'cw-name'; nm.textContent = e.name;
      const sub = document.createElement('div'); sub.className = 'cw-sub'; sub.textContent = 'Resume at ' + A.formatTime(e.pos);
      b.append(art, nm, sub);
      b.addEventListener('click', () => { if (e.path) A.addNativePaths([e.path], { play: true }); else if (e.url) A.playStream(e.url); });
      row.appendChild(b);
    });
  }
  A.on('idle', renderShelf);

  /* ===================================================================== per-file memory */
  const FM = 'zephyr-filemem-v1';
  const fmLoad = () => { try { return JSON.parse(ls(FM) || '{}'); } catch { return {}; } };
  function fmUpdate(item, patch) {
    if (!item) return;
    const all = fmLoad(); const k = A.posKey(item);
    all[k] = Object.assign({}, all[k], patch, { at: Date.now() });
    const keys = Object.keys(all);
    if (keys.length > 500) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - 450).forEach((x) => delete all[x]);
    ls(FM, JSON.stringify(all));
  }
  A.on('trackchosen', (e) => {
    const it = A.item; if (!it || !e) return;
    if (e.type === 'audio' && e.track) fmUpdate(it, { audio: { lang: e.track.lang || '', title: e.track.title || '', id: e.track.id } });
    if (e.type === 'sub') fmUpdate(it, { sub: e.off ? { off: true } : { lang: (e.track && e.track.lang) || '', title: (e.track && e.track.title) || '', id: e.track && e.track.id, external: !!(e.track && e.track.external) } });
  });
  A.on('speed', (r) => { const it = A.item; if (it && it._started) fmUpdate(it, { speed: r }); });
  function pickTrack(tracks, type, saved) {
    const list = tracks.filter((t) => t.type === type);
    if (!saved || !list.length) return null;
    return list.find((t) => saved.lang && t.lang === saved.lang && (saved.title || '') === (t.title || ''))
      || list.find((t) => saved.lang && t.lang === saved.lang)
      || list.find((t) => saved.id != null && t.id === saved.id) || null;
  }
  A.on('tracks', (tracks) => {
    const it = A.item; if (!it || it._memApplied) return;
    const m = fmLoad()[A.posKey(it)];
    it._memApplied = true;
    if (!m) return;
    const aud = pickTrack(tracks, 'audio', m.audio);
    if (aud && !aud.selected) { A.mpvSet('aid', aud.id); A.showOSD('Audio: ' + (aud.lang || aud.title || 'track ' + aud.id).toString().toUpperCase() + ' (remembered)', 1800); }
    if (m.sub && m.sub.off) A.mpvSet('sid', 'no');
    else { const sub = pickTrack(tracks, 'sub', m.sub); if (sub && !sub.selected) A.mpvSet('sid', sub.id); }
  });
  A.on('itemstart', (item) => {
    item._memApplied = false; item._started = false;
    const m = fmLoad()[A.posKey(item)];
    if (m && m.speed && m.speed !== 1) A.setSpeed(m.speed, { silentMem: true, quiet: true });
    setTimeout(() => { item._started = true; }, 1500);
  });

  /* ===================================================================== item lifecycle hooks */
  A.on('itemstart', (item) => {
    applyAccent();
    updateAudioArt(item);
    updateMediaSession(item);
    if (online()) lookup(item, false);
  });
  A.on('idle', () => { updateAudioArt(null); applyAccent(); });
  A.on('tracks', () => updateAudioArt(A.item));

  /* ===================================================================== hotkeys (menu + keyboard) */
  function showQueue() {
    const list = A.playlist, cur = A.currentIndex;
    if (!list.length) return;
    const lines = ['Up next:'];
    for (let i = cur + 1, n = 0; i < list.length && n < 8; i++, n++) lines.push((n + 1) + '. ' + list[i].name.slice(0, 70));
    if (lines.length === 1) lines.push('(end of playlist)');
    if (A.isMpv()) A.mpvCmd('show-text', lines.join('\n').replace(/\$/g, '$$$$'), 7000); else A.showOSD(lines.join('\n'), 5000);
  }
  if (api() && api().onHotkey) api().onHotkey((key) => {
    if (key === 'shortcuts') openShortcuts();
    else if (key === 'tools') openTools();
    else if (key === 'diagnostics') copyDiag();
    else if (key === 'guide' && api().openDocs) api().openDocs('guide');
    else if (key === 'queue') showQueue();
    else if (key === 'clearhistory') A.confirmClearHistory();
  });
  A.playlistToggle = function () {
    if (inFs()) { FS.pinSide = !FS.pinSide; evaluate(); }
    else { const b = $('toggleSidebar'); if (b) b.click(); }
  };

  /* ===================================================================== context menus (video + playlist) */
  A.customContext = true;     // the old fixed menu lived inside the controls bar, which fullscreen slides off screen
  let ctxEl = null, ctxCleanup = null;
  function closeCtx() { if (ctxCleanup) ctxCleanup(); ctxCleanup = null; if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  function showCtx(x, y, items) {
    closeCtx();
    A.hideTip && A.hideTip();
    const menu = document.createElement('div'); menu.className = 'zctx'; menu.setAttribute('role', 'menu');
    const buttons = [];
    items.forEach((it) => {
      if (it.sep) { menu.appendChild(Object.assign(document.createElement('div'), { className: 'zsep' })); return; }
      if (it.header) { menu.appendChild(Object.assign(document.createElement('div'), { className: 'zhead', textContent: it.header })); return; }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'zitem' + (it.danger ? ' danger' : ''); b.disabled = !!it.disabled; b.setAttribute('role', 'menuitem');
      if (window.ZIcons && it.icon) b.appendChild(window.ZIcons.make(it.icon)); else b.appendChild(Object.assign(document.createElement('span'), { className: 'zi-blank' }));
      const lab = document.createElement('span'); lab.className = 'zlabel'; lab.textContent = it.label; b.appendChild(lab);
      if (it.hint) b.appendChild(Object.assign(document.createElement('span'), { className: 'zhint', textContent: it.hint }));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.confirm && !b.dataset.armed) { b.dataset.armed = '1'; lab.textContent = it.confirm; b.classList.add('armed'); return; }   // dangerous actions need a second click
        closeCtx();
        try { it.run && it.run(); } catch (err) { console.error(err); }
      });
      menu.appendChild(b); if (!it.disabled) buttons.push(b);
    });
    document.body.appendChild(menu); ctxEl = menu;
    const pad = 8, w = menu.offsetWidth || 240, h = menu.offsetHeight || 300;
    menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - w - pad)) + 'px';
    menu.style.top = Math.max(pad, Math.min(y, window.innerHeight - h - pad)) + 'px';
    let idx = -1;
    const onDown = (e) => { if (!menu.contains(e.target)) closeCtx(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCtx(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[idx] && buttons[idx].focus(); }
      else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) { e.preventDefault(); e.stopPropagation(); buttons[idx].click(); }
    };
    const onOther = () => closeCtx();
    document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onOther); window.addEventListener('resize', onOther); document.addEventListener('wheel', onOther, { passive: true, capture: true }); document.addEventListener('fullscreenchange', onOther);
    ctxCleanup = () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', onOther); window.removeEventListener('resize', onOther); document.removeEventListener('wheel', onOther, true); document.removeEventListener('fullscreenchange', onOther); };
  }
  A.showContextMenu = showCtx; A.closeContextMenu = closeCtx;

  const normKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
  const AUDIO_NAME = /\.(mp3|flac|wav|aac|m4a|m4b|opus|ogg|oga|wma|ape|wv|mka|aiff?|ac3|eac3|dts|amr|mpc|tta)$/i;
  function similarityKey(name, path, isAudio) {
    const p = window.ZName ? window.ZName.parse(name, { audio: isAudio ? true : undefined }) : { kind: 'movie', title: name };
    if (p.kind === 'tv' && p.title) return 'tv:' + normKey(p.title);             // same show
    if (p.kind === 'music' && p.artist) return 'artist:' + normKey(p.artist);      // same artist
    return 'dir:' + normKey(dirOf(path));                                          // otherwise: same folder
  }
  const natural = (a, b) => String(a.fullName).localeCompare(String(b.fullName), undefined, { numeric: true, sensitivity: 'base' });

  // "Play similar": same show / same artist / same folder. They are queued right after this item, in order, and playback starts here.
  async function playSimilar(item) {
    if (!item) return;
    const isAud = (it) => (it.info && !it.info.hasVideo) || AUDIO_NAME.test(it.fullName || '');
    const key = similarityKey(item.fullName, item.path, isAud(item));
    if (item.path && api() && api().siblings) {
      const r = await api().siblings(item.path).catch(() => null);
      const fresh = ((r && r.media) || []).filter((m) => !A.playlist.some((i) => i.path === m.path) && similarityKey(m.name, m.path, AUDIO_NAME.test(m.name)) === key);
      if (fresh.length) await A.addNativePaths(fresh.map((m) => m.path));
    }
    const group = A.playlist.filter((it) => it.path && similarityKey(it.fullName, it.path, isAud(it)) === key).sort(natural);
    if (group.length < 2) { A.showOSD('No similar items found next to this one', 2500); return; }
    const at = group.indexOf(item);
    const ordered = group.slice(at).concat(group.slice(0, at));
    A.queueNext(ordered.filter((it) => it !== A.item));
    A.playIndex(A.playlist.indexOf(item));
    A.showOSD('Playing ' + group.length + ' similar items in order', 2500);
  }
  A.playSimilar = playSimilar;

  async function deleteFiles(items) {
    const local = items.filter((i) => i.path);
    if (!local.length || !api() || !api().trashFiles) return;
    const paths = local.map((i) => i.path);
    A.removeItems(items);                         // also releases the file if it was playing (Windows will not delete a file that is open)
    await new Promise((r) => setTimeout(r, 650));
    const r = await api().trashFiles(paths).catch(() => null);
    const res = (r && r.results) || [];
    const ok = res.filter((x) => x.ok).length, bad = res.filter((x) => !x.ok);
    A.showOSD(ok + ' file' + (ok === 1 ? '' : 's') + ' moved to the Recycle Bin' + (bad.length ? ' · ' + bad.length + ' could not be deleted (still in use?)' : ''), 3500);
  }

  A.on('plctx', (x, y, items) => {
    if (!items || !items.length) return;
    const n = items.length, one = n === 1 ? items[0] : null, local = items.filter((i) => i.path);
    const rt = A.runtimeLabel(items);
    showCtx(x, y, [
      { header: n + (n === 1 ? ' item' : ' items') + (rt ? ' · ' + rt : '') },
      { label: n > 1 ? 'Play (first selected)' : 'Play', icon: 'play', run: () => { A.clearSelection(true); A.playIndex(A.playlist.indexOf(items[0])); } },
      { label: 'Play next', icon: 'next', hint: 'after this one', run: () => { const k = A.queueNext(items); A.showOSD(k + ' item' + (k === 1 ? '' : 's') + ' will play next', 2000); } },
      { label: 'Play similar', icon: 'playlist', hint: 'same show / artist / folder', disabled: !one || !one.path, run: () => playSimilar(one) },
      { sep: true },
      { label: 'Open file location', icon: 'folder-open', disabled: !one || !one.path, run: () => api() && api().showItem && api().showItem(one.path) },
      { label: one && one.stream ? 'Copy link' : 'Copy file path', icon: 'copy', disabled: !one, run: () => { const t = one.stream ? one.url : one.path; try { navigator.clipboard.writeText(t); A.showOSD('Copied', 1200); } catch { A.showOSD('Could not copy', 1500); } } },
      { label: 'Details & poster…', icon: 'info', disabled: !one, run: () => openDetails(one) },
      { label: 'Look up poster & info', icon: 'image', hint: online() ? '' : 'turn on online info first', disabled: !online(), run: async () => { A.showOSD('Looking up…', 1500); for (const it of items) { it.meta = null; it.metaMiss = false; await lookup(it, true); } A.showOSD('Done', 1200); } },
      { sep: true },
      { label: 'Remove from playlist', icon: 'close', hint: 'Del', run: () => { A.removeItems(items); A.showOSD('Removed from the playlist (files untouched)', 1800); } },
      { label: n > 1 ? 'Delete ' + n + ' files…' : 'Delete file…', icon: 'trash', danger: true, hint: 'Recycle Bin', confirm: 'Click again to move to the Recycle Bin', disabled: !local.length, run: () => deleteFiles(items) },
      { sep: true },
      { label: 'Select all', run: () => A.selectAll() }
    ]);
  });

  // right-click on the picture (works in fullscreen too: the menu is attached to the page, not to the controls bar)
  function videoMenu(x, y) {
    const it = A.item, act = (id) => () => A.actions[id] && A.actions[id].run();
    showCtx(x, y, [
      { label: 'Play / pause', icon: 'play', hint: 'Space', run: act('playpause') },
      { label: 'Previous', icon: 'prev', run: act('prev') }, { label: 'Next', icon: 'next', run: act('next') },
      { sep: true },
      { label: document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen', icon: document.fullscreenElement ? 'fullscreen-exit' : 'fullscreen', hint: 'F', run: act('fullscreen') },
      { label: 'Take a screenshot', icon: 'screenshot', hint: 'S', run: act('screenshot') },
      { label: 'Add bookmark', icon: 'bookmark-add', hint: 'B', run: act('bookmark') },
      { label: 'Set A-B loop point', icon: 'ab-loop', hint: 'A', run: act('abloop') },
      { label: 'Jump to time…', icon: 'clock', hint: 'Ctrl+G', run: () => openJump() },
      { label: 'Mute', icon: 'volume-mute', hint: 'M', run: act('mute') },
      { sep: true },
      { label: 'Subtitles on / off', icon: 'subtitles', hint: 'V', run: act('subToggle') },
      { label: 'Next audio track', icon: 'audio-track', hint: 'Shift+A', disabled: !A.isMpv(), run: act('audioTrack') },
      { sep: true },
      { label: 'Details & poster…', icon: 'info', disabled: !it, run: () => openDetails() },
      { label: 'Open file location', icon: 'folder-open', disabled: !(it && it.path), run: () => api() && api().showItem && api().showItem(it.path) },
      { label: 'Settings…', icon: 'settings', hint: 'Ctrl+,', run: () => A.openSettings && A.openSettings() }
    ]);
  }
  [$('videoWrapper'), $('audioArt')].forEach((el) => on(el, 'contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.controls, .sidebar, .popup-menu, .settings-panel')) return;
    e.preventDefault(); videoMenu(e.clientX, e.clientY);
  }));

  /* ===================================================================== jump to time (Ctrl+G) */
  function parseClock(t) {
    t = String(t).trim().toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
    let m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
    if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    m = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s?)?$/.exec(t);
    if (m && (m[1] || m[2] || m[3])) return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + parseFloat(m[3] || 0);
    return null;
  }
  function parseTimeSpec(text, cur, dur) {
    text = String(text || '').trim();
    if (!text) return null;
    let t = null, m;
    if ((m = /^(\d+(?:\.\d+)?)\s*%$/.exec(text))) { if (!(dur > 0)) return null; t = dur * parseFloat(m[1]) / 100; }
    else if ((m = /^([+-])\s*(.+)$/.exec(text))) { const d = parseClock(m[2]); if (d === null) return null; t = (cur || 0) + (m[1] === '-' ? -d : d); }
    else t = parseClock(text);
    if (t === null || !isFinite(t)) return null;
    t = Math.max(0, t);
    if (dur > 0) t = Math.min(t, Math.max(0, dur - 0.5));
    return t;
  }
  A.parseTimeSpec = parseTimeSpec;
  function openJump() {
    if (!A.item) { A.showOSD('Nothing is playing'); return; }
    const inp = $('jumpInput'); $('jumpHint').textContent = 'Current: ' + A.formatTime(A.time) + ' of ' + A.formatTime(A.duration);
    open('jumpPanel'); inp.value = ''; setTimeout(() => inp.focus(), 0);
  }
  A.openJump = openJump;
  function doJump() {
    const t = parseTimeSpec($('jumpInput').value, A.time, A.duration);
    if (t === null) { $('jumpHint').textContent = 'Type a time like 1:23:45, 90, +30, -10 or 50%'; return; }
    close('jumpPanel'); A.seekTo(t); A.showOSD('Jumped to ' + A.formatTime(t), 1500);
  }
  on($('jumpInput'), 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJump(); } else if (e.key === 'Escape') { e.stopPropagation(); close('jumpPanel'); } });
  on($('jumpGo'), 'click', doJump);
  on($('closeJump'), 'click', () => close('jumpPanel'));

  /* ===================================================================== paste / drop a link */
  const LINK_RE = /^(?:https?|rtsp|rtmp|mms|udp):\/\/\S+$/i;
  A.pasteLink = async function () {
    let t = '';
    try { t = String(await navigator.clipboard.readText()).trim().split(/\r?\n/)[0]; } catch { /* no permission */ }
    if (LINK_RE.test(t)) { A.showOSD('Opening the link from your clipboard…', 1800); A.playStream(t); } else A.showOSD('There is no link in the clipboard', 2000);
  };
  document.addEventListener('dragover', (e) => { const dt = e.dataTransfer; if (dt && dt.types && (dt.types.includes('text/uri-list') || dt.types.includes('text/plain')) && !(dt.files && dt.files.length)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt || (dt.files && dt.files.length)) return;
    const t = String(dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim().split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    if (t && LINK_RE.test(t)) { e.preventDefault(); A.showOSD('Opening the dropped link…', 1800); A.playStream(t); }
  });

  /* ===================================================================== boot */
  (function boot() {
    setTheme(S.get('theme'));
    renderShelf();
    setTimeout(healthCheck, 2500);
    setTimeout(maybeWelcome, 900);
    if (A.item) { onCurrentMeta(A.item); }
  })();
})();
