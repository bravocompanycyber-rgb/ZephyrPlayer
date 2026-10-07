/* ZephyrPlayer controls: one registry of actions, fully rebindable keyboard shortcuts, configurable mouse wheel,
 * click / double-click / middle-click and the mouse side buttons. Everything reads the settings store, so changes
 * take effect immediately. Talks to the player only through window.ZApp. */
(function () {
  'use strict';
  const A = window.ZApp, S = window.ZSettings, L = window.ZSettingsLib;
  if (!A || !S || !L) { console.warn('controls.js: ZApp/ZSettings missing'); return; }
  const $ = (id) => document.getElementById(id);
  const click = (id) => { const b = $(id); if (b) b.click(); };

  /* ------------------------------------------------------------------ actions */
  const stepVol = (dir) => A.setVolume(Math.round((A.volume + dir * A.volumeStep) * 100) / 100);
  const needMpv = (what) => A.showOSD(what + ' needs the mpv engine (open the file with mpv)', 2200);

  const ACTIONS = [
    { id: 'playpause', group: 'Playback', label: 'Play / pause', keys: ['space', 'k'], run: () => A.togglePlay() },
    { id: 'stop', group: 'Playback', label: 'Stop', keys: ['ctrl+.'], run: () => A.stopAll() },
    { id: 'seekBack', group: 'Playback', label: 'Skip back', keys: ['left'], repeat: true, run: () => A.seekRelative(-A.seekStep) },
    { id: 'seekFwd', group: 'Playback', label: 'Skip forward', keys: ['right'], repeat: true, run: () => A.seekRelative(A.seekStep) },
    { id: 'seekBackBig', group: 'Playback', label: 'Big skip back', keys: ['shift+left'], repeat: true, run: () => A.seekRelative(-A.seekStepBig) },
    { id: 'seekFwdBig', group: 'Playback', label: 'Big skip forward', keys: ['shift+right'], repeat: true, run: () => A.seekRelative(A.seekStepBig) },
    { id: 'prev', group: 'Playback', label: 'Previous item', keys: ['shift+p'], run: () => A.step(-1) },
    { id: 'next', group: 'Playback', label: 'Next item', keys: ['shift+n'], run: () => A.step(1) },
    { id: 'chapterPrev', group: 'Playback', label: 'Previous chapter', keys: ['pageup'], run: () => { if (A.isMpv()) A.mpvCmd('add', 'chapter', -1); else needMpv('Chapters'); } },
    { id: 'chapterNext', group: 'Playback', label: 'Next chapter', keys: ['pagedown'], run: () => { if (A.isMpv()) A.mpvCmd('add', 'chapter', 1); else needMpv('Chapters'); } },
    { id: 'speedDown', group: 'Playback', label: 'Slower', keys: ['['], repeat: true, run: () => A.setSpeed(A.speed - 0.25) },
    { id: 'speedUp', group: 'Playback', label: 'Faster', keys: [']'], repeat: true, run: () => A.setSpeed(A.speed + 0.25) },
    { id: 'speedReset', group: 'Playback', label: 'Normal speed', keys: ['backspace'], run: () => A.setSpeed(1) },
    { id: 'frameBack', group: 'Playback', label: 'Step back one frame', keys: [','], repeat: true, run: () => click('frameBackBtn') },
    { id: 'frameFwd', group: 'Playback', label: 'Step forward one frame', keys: ['.'], repeat: true, run: () => click('frameFwdBtn') },
    { id: 'home', group: 'Playback', label: 'Jump to start', keys: ['home'], run: () => A.seekTo(0) },
    { id: 'end', group: 'Playback', label: 'Jump to end', keys: ['end'], run: () => { const d = A.duration; if (d) A.seekTo(d - 0.5); } },
    { id: 'abloop', group: 'Playback', label: 'Set A / B / clear loop', keys: ['a'], run: () => A.handleABLoop() },
    { id: 'repeat', group: 'Playback', label: 'Repeat: off / all / one', keys: ['r'], run: () => A.cycleRepeat() },
    { id: 'shuffle', group: 'Playback', label: 'Shuffle on / off', keys: ['ctrl+h'], run: () => A.toggleShuffle() },

    { id: 'volUp', group: 'Audio', label: 'Volume up', keys: ['up'], repeat: true, run: () => stepVol(1) },
    { id: 'volDown', group: 'Audio', label: 'Volume down', keys: ['down'], repeat: true, run: () => stepVol(-1) },
    { id: 'mute', group: 'Audio', label: 'Mute', keys: ['m'], run: () => A.toggleMute() },
    { id: 'audioTrack', group: 'Audio', label: 'Next audio track', keys: ['shift+a'], run: () => { if (A.isMpv()) { A.mpvCmd('cycle', 'aid'); A.showOSD('Next audio track'); } else needMpv('Switching audio tracks'); } },

    { id: 'fullscreen', group: 'Video', label: 'Fullscreen', keys: ['f'], run: () => A.toggleFullscreen() },
    { id: 'screenshot', group: 'Video', label: 'Screenshot', keys: ['s'], run: () => A.takeScreenshot() },
    { id: 'miniPlayer', group: 'Video', label: 'Mini player', keys: ['ctrl+shift+m'], run: () => click('miniModeBtn') },
    { id: 'pip', group: 'Video', label: 'Picture-in-picture', keys: ['ctrl+p'], run: () => click('pipBtn') },
    { id: 'alwaysOnTop', group: 'Video', label: 'Always on top', keys: ['ctrl+t'], run: () => click('alwaysOnTopBtn') },

    { id: 'subToggle', group: 'Subtitles', label: 'Subtitles on / off', keys: ['v'], run: () => { if (A.isMpv()) { A.mpvCmd('cycle', 'sub-visibility'); A.showOSD('Subtitles toggled'); } else { const d = $('subtitleDisplay'); if (d) { d.classList.toggle('sub-hidden'); A.showOSD(d.classList.contains('sub-hidden') ? 'Subtitles hidden' : 'Subtitles shown'); } } } },
    { id: 'subCycle', group: 'Subtitles', label: 'Next subtitle track', keys: ['shift+v'], run: () => { if (A.isMpv()) { A.mpvCmd('cycle', 'sid'); A.showOSD('Next subtitle track'); } else needMpv('Switching subtitle tracks'); } },
    { id: 'subEarlier', group: 'Subtitles', label: 'Subtitles earlier (-0.1 s)', keys: ['z'], repeat: true, run: () => subDelay(-0.1) },
    { id: 'subLater', group: 'Subtitles', label: 'Subtitles later (+0.1 s)', keys: ['x'], repeat: true, run: () => subDelay(0.1) },

    { id: 'bookmark', group: 'App', label: 'Add bookmark', keys: ['b'], run: () => click('addBookmarkBtn') },
    { id: 'details', group: 'App', label: 'Details & poster', keys: ['d'], run: () => A.openDetails && A.openDetails() },
    { id: 'playlist', group: 'App', label: 'Show / hide playlist', keys: ['l'], run: () => (A.playlistToggle ? A.playlistToggle() : click('toggleSidebar')) },
    { id: 'shortcuts', group: 'App', label: 'Keyboard shortcut list', keys: ['shift+/'], run: () => A.openShortcuts && A.openShortcuts() },
    { id: 'settings', group: 'App', label: 'Settings', keys: ['ctrl+,'], run: () => A.openSettings && A.openSettings() },
    { id: 'openFiles', group: 'App', label: 'Open files', keys: ['ctrl+o'], run: () => A.openFilesNative() },
    { id: 'openUrl', group: 'App', label: 'Open a link', keys: ['ctrl+u'], run: () => click('addUrlBtn') },
    { id: 'stats', group: 'App', label: 'Playback statistics (mpv)', keys: ['shift+i'], run: () => { if (A.isMpv()) A.mpvCmd('script-binding', 'stats/display-stats-toggle'); else needMpv('Statistics'); } }
  ];
  const BY_ID = Object.create(null); ACTIONS.forEach((a) => { BY_ID[a.id] = a; });

  function subDelay(delta) {
    const el = $('subDelay'); if (!el) return;
    let v = Math.max(-10, Math.min(10, (parseFloat(el.value) || 0) + delta));
    el.value = Math.round(v * 10) / 10;
    el.dispatchEvent(new Event('change'));
  }

  /* ------------------------------------------------------------------ key combos */
  const PUNCT = { Slash: '/', Period: '.', Comma: ',', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Quote: "'", Semicolon: ';', Backslash: '\\' };
  const NAMED = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'space', Spacebar: 'space', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end',
    Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Escape: 'escape' };
  function comboFromEvent(e) {
    const k = e.key;
    if (!k || k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead' || k === 'Unidentified') return '';
    let key = '';
    if (/^F([1-9]|1[0-2])$/.test(k)) key = k.toLowerCase();
    else if (NAMED[k]) key = NAMED[k];
    else if (e.code && /^Numpad[0-9]$/.test(e.code)) key = e.code.toLowerCase();
    else if (k.length === 1 && /[a-z0-9]/i.test(k)) key = k.toLowerCase();
    else if (e.code && PUNCT[e.code]) key = PUNCT[e.code];
    else return '';
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');
    return L.normalizeCombo(mods.concat([key]).join('+'));
  }
  const PRETTY = { space: 'Space', left: '←', right: '→', up: '↑', down: '↓', pageup: 'PgUp', pagedown: 'PgDn', escape: 'Esc', backspace: 'Backspace', enter: 'Enter', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win' };
  const prettyCombo = (c) => String(c).split('+').map((p) => PRETTY[p] || (p.length === 1 ? p.toUpperCase() : p.toUpperCase().replace('NUMPAD', 'Num '))).join(' + ');

  /* ------------------------------------------------------------------ keymap (defaults + user overrides) */
  let map = Object.create(null);
  function effectiveKeys(id) {
    const km = S.get('keymap') || {};
    return Object.prototype.hasOwnProperty.call(km, id) ? km[id] : (BY_ID[id] ? BY_ID[id].keys : []);
  }
  function rebuild() {
    map = Object.create(null);
    for (const a of ACTIONS) for (const k of effectiveKeys(a.id)) if (!map[k]) map[k] = a.id;
  }
  S.on('keymap', rebuild);
  rebuild();

  function conflictFor(combo, exceptId) {
    for (const a of ACTIONS) if (a.id !== exceptId && effectiveKeys(a.id).includes(combo)) return a;
    return null;
  }
  function setKeys(id, keys) {
    const km = S.get('keymap') || {};
    const def = BY_ID[id] ? BY_ID[id].keys : [];
    if (JSON.stringify(keys) === JSON.stringify(def)) delete km[id]; else km[id] = keys;
    S.set('keymap', km);
  }
  function addKey(id, combo) {
    combo = L.normalizeCombo(combo);
    if (!L.isCombo(combo)) return { ok: false, error: 'That key cannot be used.' };
    if (combo === 'escape') return { ok: false, error: 'Esc is reserved for leaving fullscreen and closing panels.' };
    const other = conflictFor(combo, id);
    const keys = effectiveKeys(id).slice();
    if (keys.includes(combo)) return { ok: true, unchanged: true };
    if (keys.length >= 4) return { ok: false, error: 'An action can have up to 4 keys.' };
    if (other) {                                                   // take the key from the other action (shown to the user first)
      setKeys(other.id, effectiveKeys(other.id).filter((k) => k !== combo));
    }
    keys.push(combo);
    setKeys(id, keys);
    return { ok: true, tookFrom: other ? other.label : null };
  }
  function removeKey(id, combo) { setKeys(id, effectiveKeys(id).filter((k) => k !== combo)); }
  function resetKeys(id) { const km = S.get('keymap') || {}; delete km[id]; S.set('keymap', km); }

  /* ------------------------------------------------------------------ keyboard dispatcher */
  A.handlesKeys = true;
  const typing = (t) => { const tag = t && t.tagName; return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable); };
  document.addEventListener('keydown', (e) => {
    if (A.capturingKey || typing(e.target)) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    if (combo === 'escape') { if (document.fullscreenElement) { const p = document.exitFullscreen && document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } return; }
    const id = map[combo];
    if (!id) return;
    const a = BY_ID[id];
    e.preventDefault();
    if (e.repeat && !a.repeat) return;
    const ae = document.activeElement;
    if (ae && ae.tagName === 'BUTTON' && (combo === 'space' || combo === 'enter')) ae.blur();   // never double-activate a focused button
    try { a.run(e); } catch (err) { console.error('action ' + id, err); }
  });

  /* ------------------------------------------------------------------ mouse */
  const MOUSE_TO_ACTION = { playpause: 'playpause', fullscreen: 'fullscreen', mute: 'mute', screenshot: 'screenshot', next: 'next', prev: 'prev', seekFwd: 'seekFwd', seekBack: 'seekBack', abloop: 'abloop', bookmark: 'bookmark', playlist: 'playlist', miniPlayer: 'miniPlayer' };
  function runMouse(settingId) {
    const v = S.get(settingId);
    const id = MOUSE_TO_ACTION[v];
    if (id && BY_ID[id]) { try { BY_ID[id].run(); } catch (e) { console.error(e); } }
  }

  const video = $('video'), audioArt = $('audioArt'), wrapper = $('videoWrapper');
  let clickTimer = null;
  function onVideoClick(e) {
    if (e.button !== 0) return;
    if (S.get('dblclick') === 'none') { runMouse('click'); return; }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => runMouse('click'), 230);          // wait to see whether it becomes a double-click
  }
  function onVideoDbl(e) { clearTimeout(clickTimer); clickTimer = null; runMouse('dblclick'); }
  function onAux(e) { if (e.button === 1) { e.preventDefault(); runMouse('middleClick'); } }
  [video, audioArt].forEach((el) => {
    if (!el) return;
    el.addEventListener('click', onVideoClick);
    el.addEventListener('dblclick', onVideoDbl);
    el.addEventListener('auxclick', onAux);
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll cursor
  });

  let lastTrackWheel = 0;
  function onWheel(e) {
    if (e.target.closest && e.target.closest('.controls, .sidebar, .popup-menu, .settings-panel')) return;
    const mode = S.get(e.ctrlKey ? 'wheelCtrl' : (e.shiftKey ? 'wheelShift' : 'wheel'));
    if (!mode || mode === 'none') return;
    const dir = e.deltaY < 0 ? 1 : (e.deltaY > 0 ? -1 : 0);
    if (!dir) return;
    e.preventDefault();
    if (mode === 'volume') stepVol(dir);
    else if (mode === 'seek') A.seekRelative(dir * A.seekStep);
    else if (mode === 'speed') A.setSpeed(A.speed + dir * 0.25);
    else if (mode === 'track') { const now = Date.now(); if (now - lastTrackWheel > 350) { lastTrackWheel = now; A.step(-dir); } }
  }
  if (wrapper) wrapper.addEventListener('wheel', onWheel, { passive: false });

  document.addEventListener('mouseup', (e) => {
    if (typing(e.target)) return;
    if (e.button === 3) { e.preventDefault(); runMouse('mouseBack'); }
    else if (e.button === 4) { e.preventDefault(); runMouse('mouseForward'); }
  });
  document.addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });

  /* ------------------------------------------------------------------ public API (used by the settings UI) */
  A.controls = { ACTIONS, BY_ID, effectiveKeys, addKey, removeKey, resetKeys, conflictFor, comboFromEvent, prettyCombo, rebuild, runMouse };
  A.actions = BY_ID;
})();
