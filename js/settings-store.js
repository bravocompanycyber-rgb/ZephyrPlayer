/* ZephyrPlayer settings: one schema (what each setting is, how it is validated, what its tooltip says) + a robust store.
 * - every value is validated/clamped; a corrupted store is backed up and replaced by defaults, never a crash
 * - versioned, migrates the old scattered localStorage keys once
 * - per-setting / per-group / full reset, JSON export + import
 * UMD: works in the browser (window.ZSettings) and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZSettingsLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 2;
  const KEY = 'zephyr-settings-v2';

  const GROUPS = [
    { id: 'general', name: 'General', icon: 'settings', desc: 'Look and everyday behaviour.' },
    { id: 'playback', name: 'Playback', icon: 'play', desc: 'What happens when files start, end or fail.' },
    { id: 'audio', name: 'Audio & volume', icon: 'volume-high', desc: 'Loudness, extra volume and sound clean-up.' },
    { id: 'video', name: 'Video & performance', icon: 'film', desc: 'Picture quality and how hard your PC works.' },
    { id: 'subtitles', name: 'Subtitles', icon: 'subtitles', desc: 'Automatic subtitle loading.' },
    { id: 'controls', name: 'Keys & mouse', icon: 'keyboard', desc: 'Every shortcut, the mouse wheel and the mouse buttons.' },
    { id: 'library', name: 'Library & online', icon: 'library', desc: 'Playlist memory, posters and info from the internet.' },
    { id: 'system', name: 'File types & players', icon: 'folder-open', desc: 'Open files with ZephyrPlayer, and what to do when a file will not play.' },
    { id: 'advanced', name: 'Advanced', icon: 'equalizer', desc: 'For power users. The defaults are already good.' }
  ];

  const THEME_IDS = ['zephyr', 'midnight', 'amoled', 'ocean', 'forest', 'sunset', 'rose', 'nord', 'dracula', 'mocha', 'mono', 'contrast', 'light', 'paper', 'sky'];
  const THEME_NAMES = ['Zephyr (default dark)', 'Midnight indigo', 'AMOLED black', 'Ocean', 'Forest', 'Sunset', 'Rosé', 'Nord', 'Dracula', 'Mocha', 'Monochrome', 'High contrast', 'Light', 'Paper (warm light)', 'Sky (blue light)'];

  const opt = (pairs) => pairs.map((p) => ({ value: p[0], label: p[1] }));
  const WHEEL = opt([['none', 'Do nothing'], ['volume', 'Change volume'], ['seek', 'Seek forward / back'], ['speed', 'Change speed'], ['track', 'Previous / next item']]);
  const CLICK = opt([['none', 'Do nothing'], ['playpause', 'Play / pause'], ['fullscreen', 'Toggle fullscreen'], ['mute', 'Mute'], ['screenshot', 'Take a screenshot'],
    ['next', 'Next item'], ['prev', 'Previous item'], ['seekFwd', 'Skip forward'], ['seekBack', 'Skip back'], ['abloop', 'Set A-B loop'], ['bookmark', 'Add bookmark'], ['playlist', 'Show / hide playlist'], ['miniPlayer', 'Mini player']]);

  // level: 'basic' | 'advanced'. legacy: the old localStorage key kept in sync so older code keeps working.
  const SCHEMA = [
    /* ---------------- general */
    { id: 'theme', group: 'general', level: 'basic', type: 'select', def: 'zephyr', options: opt(THEME_IDS.map((v, i) => [v, THEME_NAMES[i]])), legacy: 'zephyr-skin',
      label: 'Theme', tip: 'The colour scheme of the whole app. Light themes are for bright rooms, AMOLED black saves power on OLED screens.' },
    { id: 'accentMode', group: 'general', level: 'basic', type: 'select', def: 'theme', legacy: 'zephyr-accent-mode', options: opt([['theme', 'From the theme'], ['poster', 'Follow the poster / cover'], ['custom', 'Custom colour']]),
      label: 'Accent colour', tip: 'The highlight colour for buttons and progress bars. "Follow the poster" picks it from the artwork of what is playing (needs online info).' },
    { id: 'accentColor', group: 'general', level: 'basic', type: 'color', def: '#38bdf8', legacy: 'zephyr-accent', showIf: { accentMode: 'custom' },
      label: 'Custom accent colour', tip: 'Pick any colour. Very dark or very light colours are adjusted automatically so text stays readable.' },
    { id: 'splash', group: 'general', level: 'basic', type: 'toggle', def: true, main: true,
      label: 'Show the splash screen at start', tip: 'A short logo screen while the app starts. Turn off for the fastest possible start.' },
    { id: 'restorePlaylist', group: 'general', level: 'basic', type: 'toggle', def: true,
      label: 'Restore my playlist at start', tip: 'Brings back the playlist you had last time. Files are not played until you press play.' },
    { id: 'pauseOnMinimize', group: 'general', level: 'basic', type: 'toggle', def: false,
      label: 'Pause when the window is minimised', tip: 'Pauses automatically when you minimise or switch away, and resumes when you return.' },

    /* ---------------- playback */
    { id: 'autoNext', group: 'playback', level: 'basic', type: 'toggle', def: true,
      label: 'Play the next item automatically', tip: 'When a file ends, start the next one in the playlist. With this off, playback stops at the end of each file.' },
    { id: 'rememberPos', group: 'playback', level: 'basic', type: 'toggle', def: true,
      label: 'Remember where I stopped', tip: 'Resumes each file from where you left off, and fills the "Continue watching" shelf.' },
    { id: 'seekStep', group: 'playback', level: 'basic', type: 'range', def: 10, min: 1, max: 60, step: 1, unit: 's',
      label: 'Skip step', tip: 'How far the left / right arrow keys and the skip buttons jump.' },
    { id: 'seekStepBig', group: 'playback', level: 'basic', type: 'range', def: 30, min: 5, max: 300, step: 5, unit: 's',
      label: 'Big skip step', tip: 'How far Shift + arrow keys jump.' },
    { id: 'skipBad', group: 'playback', level: 'basic', type: 'toggle', def: true,
      label: 'Skip files that cannot be played', tip: 'If a file fails in every built-in engine, move on to the next item instead of stopping.' },
    { id: 'streamReload', group: 'playback', level: 'advanced', type: 'toggle', def: true,
      label: 'Reconnect stalled streams', tip: 'If an online stream freezes while buffering for more than about 30 seconds, reload it from the same position.' },

    /* ---------------- audio */
    { id: 'startVolume', group: 'audio', level: 'basic', type: 'range', def: 100, min: 0, max: 300, step: 5, unit: '%',
      label: 'Starting volume', tip: 'The volume used when the app starts. Values above 100% need the extra-volume limit below.' },
    { id: 'rememberVolume', group: 'audio', level: 'basic', type: 'toggle', def: true,
      label: 'Remember my last volume', tip: 'Start at the volume you used last time. Turn off to always start at the starting volume above.' },
    { id: 'volumeMax', group: 'audio', level: 'basic', type: 'select', def: 200, number: true, options: opt([[100, '100% (no boost)'], [150, '150%'], [200, '200% (recommended)'], [300, '300% (very loud)']]),
      label: 'Maximum volume (extra volume)', tip: 'Lets you go above 100% for quiet videos. Boost above 100% is handled by mpv (the app switches automatically when needed). Keep the limiter on to avoid distortion.' },
    { id: 'volumeStep', group: 'audio', level: 'basic', type: 'range', def: 5, min: 1, max: 20, step: 1, unit: '%',
      label: 'Volume step', tip: 'How much one key press or one mouse-wheel notch changes the volume.' },
    { id: 'softLimiter', group: 'audio', level: 'basic', type: 'toggle', def: true,
      label: 'Soft limiter (clean extra volume)', tip: 'Stops loud peaks from clipping when the volume is above 100%, so boosted audio does not crackle.' },
    { id: 'normalize', group: 'audio', level: 'basic', type: 'toggle', def: false,
      label: 'Even out loudness', tip: 'Makes quiet and loud videos about the same volume (EBU R128 normalisation). Slightly delays audio start.' },
    { id: 'nightMode', group: 'audio', level: 'basic', type: 'toggle', def: false,
      label: 'Night mode', tip: 'Compresses the dynamic range: explosions get quieter, whispers get louder. Good for late-night watching.' },
    { id: 'alang', group: 'audio', level: 'advanced', type: 'text', def: '', max: 40, placeholder: 'e.g. eng,jpn',
      label: 'Preferred audio languages', tip: 'Comma-separated language codes. When a file has several audio tracks, the first match is chosen automatically.' },

    /* ---------------- video */
    { id: 'quality', group: 'video', level: 'basic', type: 'select', def: 'high', options: opt([['fast', 'Fast (480p, weak PC)'], ['high', 'High (balanced, recommended)'], ['sharpen', 'Sharpen'], ['anime', 'Anime'], ['anime4k', 'Anime4K'], ['hdr', 'HDR']]),
      label: 'Video quality preset', tip: 'Picture-processing profile used by mpv. "High" runs on almost any PC; Sharpen/Anime/Anime4K need a good GPU. For online videos it also limits the resolution.' },
    { id: 'perf', group: 'video', level: 'basic', type: 'select', def: 'smooth', legacy: 'zephyr-settingPerf', options: opt([['smooth', 'Balanced'], ['low', 'Low CPU / GPU use'], ['quality', 'Best quality']]),
      label: 'Performance', tip: '"Low" uses simpler processing for old or battery-powered PCs. The player also lowers quality by itself if frames start dropping.' },
    { id: 'fsLine', group: 'video', level: 'basic', type: 'toggle', def: true, legacy: 'zephyr-fsline', legacyBool: true,
      label: 'Thin progress line in fullscreen', tip: 'Keeps a slim progress bar at the bottom edge while the controls are hidden in fullscreen.' },
    { id: 'vo', group: 'video', level: 'advanced', type: 'select', def: 'gpu', legacy: 'zephyr-settingVo', options: opt([['gpu', 'GPU (standard)'], ['gpu-next', 'GPU-next (newer, better HDR)']]),
      label: 'Video output', tip: 'The mpv renderer. "gpu-next" has better HDR and scaling but can be less stable on old drivers.' },
    { id: 'hwdec', group: 'video', level: 'advanced', type: 'select', def: 'auto', legacy: 'zephyr-settingHwdec', options: opt([['auto', 'Automatic (recommended)'], ['d3d11va', 'D3D11VA'], ['dxva2', 'DXVA2 (older PCs)'], ['nvdec', 'NVIDIA NVDEC'], ['no', 'Off (software only)']]),
      label: 'Hardware decoding', tip: 'Uses your graphics card to decode video: much less CPU and heat, especially for 4K and HEVC. Turn off only if you see green or garbled video.' },
    { id: 'compat', group: 'video', level: 'advanced', type: 'select', def: 0, number: true, options: opt([[0, 'Normal'], [1, 'Compatible'], [2, 'Safest (software decode)']]),
      label: 'Rendering safety level', tip: 'Start mpv with safer settings from the beginning. Use "Compatible" or "Safest" if videos are blank or crash on your PC. The app also falls back by itself.' },

    /* ---------------- subtitles */
    { id: 'subAuto', group: 'subtitles', level: 'basic', type: 'toggle', def: true,
      label: 'Load subtitle files automatically', tip: 'Uses .srt/.vtt/.ass files that sit next to the video and have a similar name.' },
    { id: 'slang', group: 'subtitles', level: 'basic', type: 'text', def: 'en,eng', max: 40, placeholder: 'e.g. en,eng,fr',
      label: 'Preferred subtitle languages', tip: 'Comma-separated language codes. Embedded subtitle tracks in these languages are selected automatically.' },

    /* ---------------- controls */
    { id: 'wheel', group: 'controls', level: 'basic', type: 'select', def: 'volume', options: WHEEL,
      label: 'Mouse wheel on the video', tip: 'What scrolling the wheel does while the pointer is over the video.' },
    { id: 'wheelShift', group: 'controls', level: 'basic', type: 'select', def: 'seek', options: WHEEL,
      label: 'Shift + mouse wheel', tip: 'What scrolling does while holding Shift.' },
    { id: 'wheelCtrl', group: 'controls', level: 'basic', type: 'select', def: 'speed', options: WHEEL,
      label: 'Ctrl + mouse wheel', tip: 'What scrolling does while holding Ctrl.' },
    { id: 'click', group: 'controls', level: 'basic', type: 'select', def: 'playpause', options: CLICK,
      label: 'Click on the video', tip: 'Action for a single left click on the picture.' },
    { id: 'dblclick', group: 'controls', level: 'basic', type: 'select', def: 'fullscreen', options: CLICK,
      label: 'Double-click on the video', tip: 'Action for a double click on the picture.' },
    { id: 'middleClick', group: 'controls', level: 'basic', type: 'select', def: 'mute', options: CLICK,
      label: 'Middle mouse button', tip: 'Action for pressing the wheel / middle button on the picture.' },
    { id: 'mouseBack', group: 'controls', level: 'basic', type: 'select', def: 'prev', options: CLICK,
      label: 'Mouse "Back" side button', tip: 'Action for the thumb button on gaming/office mice that normally goes back in a browser.' },
    { id: 'mouseForward', group: 'controls', level: 'basic', type: 'select', def: 'next', options: CLICK,
      label: 'Mouse "Forward" side button', tip: 'Action for the forward thumb button.' },
    { id: 'cursorHide', group: 'controls', level: 'advanced', type: 'range', def: 2, min: 1, max: 10, step: 1, unit: 's',
      label: 'Hide the cursor after', tip: 'In fullscreen, how long the mouse must be still before the pointer disappears.' },
    { id: 'keymap', group: 'controls', level: 'basic', type: 'keymap', def: {},
      label: 'Keyboard shortcuts', tip: 'Click a shortcut to change it. Each action can have several keys. Conflicts are shown before you save.' },

    /* ---------------- library & online */
    { id: 'online', group: 'library', level: 'basic', type: 'toggle', def: false, legacy: 'zephyr-online', legacyBool: true,
      label: 'Fetch posters, covers & info online', tip: 'Looks up artwork and plot info for what you play, from free services (TVmaze, Apple iTunes, Wikipedia, Deezer). Only a cleaned title is sent, never file paths.' },
    { id: 'artMode', group: 'library', level: 'basic', type: 'select', def: 'frame', legacy: 'zephyr-art', options: opt([['frame', 'Video frame (default)'], ['poster', 'Online poster when found']]),
      label: 'Playlist artwork', tip: 'Choose whether playlist rows show a picture from the video itself or the official poster.' },

    /* ---------------- system */
    { id: 'failAction', group: 'system', level: 'basic', type: 'select', def: 'ask', options: opt([['ask', 'Offer other players'], ['auto', 'Open in another player automatically'], ['never', 'Just show a message']]),
      label: 'When a file will not play', tip: 'If both built-in engines fail, ZephyrPlayer can hand the file to VLC, MPC-HC (the K-Lite Codec Pack player), PotPlayer or another installed player.' },
    { id: 'externalPlayer', group: 'system', level: 'basic', type: 'select', def: 'auto', dynamic: 'externalPlayers', options: opt([['auto', 'First one found']]),
      label: 'Preferred other player', tip: 'Which installed player is used for "Play with…" and for automatic hand-over.' },

    /* ---------------- advanced */
    { id: 'cacheMb', group: 'advanced', level: 'advanced', type: 'range', def: 200, min: 50, max: 2000, step: 50, unit: 'MB',
      label: 'Buffer size (mpv)', tip: 'How much of the file or stream mpv reads ahead. Bigger = fewer stalls on slow disks or networks, but more memory.' },
    { id: 'hrSeek', group: 'advanced', level: 'advanced', type: 'toggle', def: true,
      label: 'Exact seeking', tip: 'Seeks land exactly where you click instead of the nearest keyframe. Slightly slower on huge files.' },
    { id: 'mpvExtra', group: 'advanced', level: 'advanced', type: 'textarea', def: '', max: 1500, placeholder: 'one option per line, e.g.\nsub-font-size=45\ndeband=yes',
      label: 'Extra mpv options', tip: 'For experts: one mpv option per line (without the leading --). Options that run scripts or programs are blocked. Takes effect on the next file.' }
  ];

  const BY_ID = Object.create(null);
  SCHEMA.forEach((s) => { BY_ID[s.id] = s; });

  /* ----------------------------------------------------------------- key combos + keymap validation */
  const COMBO_RE = /^(?:(?:ctrl|alt|shift|meta)\+){0,3}[a-z0-9.,;'\[\]\/\\`=\-]$|^(?:(?:ctrl|alt|shift|meta)\+){0,3}(?:space|left|right|up|down|pageup|pagedown|home|end|enter|tab|backspace|delete|insert|escape|f(?:[1-9]|1[0-2])|numpad[0-9]|plus|minus|period|comma|slash|question)$/;
  const MODS = ['ctrl', 'alt', 'shift', 'meta'];
  function normalizeCombo(c) {
    const parts = String(c || '').toLowerCase().split('+').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return '';
    const key = parts.pop();
    const mods = MODS.filter((m) => parts.includes(m));
    return mods.concat([key]).join('+');
  }
  const isCombo = (c) => COMBO_RE.test(normalizeCombo(c));

  function cleanKeymap(v) {
    const out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    let n = 0;
    for (const a of Object.keys(v)) {
      if (n++ > 80 || !/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(a)) continue;
      const list = Array.isArray(v[a]) ? v[a] : [];
      const combos = [];
      for (const c of list.slice(0, 4)) { const nc = normalizeCombo(c); if (nc && isCombo(nc) && !combos.includes(nc)) combos.push(nc); }
      out[a] = combos;                       // an empty array means "unbound on purpose"
    }
    return out;
  }

  /* ----------------------------------------------------------------- coercion */
  function coerce(def, v) {
    const d = def.def;
    switch (def.type) {
      case 'toggle':
        if (typeof v === 'boolean') return v;
        if (v === 1 || v === '1' || v === 'true') return true;
        if (v === 0 || v === '0' || v === 'false') return false;
        return d;
      case 'select': {
        const ok = (def.options || []).some((o) => String(o.value) === String(v));
        if (!ok) return def.dynamic ? (typeof v === 'string' && /^[a-z0-9-]{1,30}$/i.test(v) ? v : d) : d;
        const hit = def.options.find((o) => String(o.value) === String(v));
        return hit.value;
      }
      case 'range': case 'number': {
        let n = Number(v);
        if (!Number.isFinite(n)) return d;
        n = Math.max(def.min, Math.min(def.max, n));
        const step = def.step || 1;
        n = Math.round(n / step) * step;
        return Math.max(def.min, Math.min(def.max, Math.round(n * 1000) / 1000));
      }
      case 'text': {
        if (typeof v !== 'string') return d;
        const t = v.replace(/[\r\n\t]/g, ' ').trim().slice(0, def.max || 100);
        return /^[A-Za-z0-9,;_. -]*$/.test(t) ? t : d;
      }
      case 'textarea':
        return typeof v === 'string' ? v.replace(/\r/g, '').slice(0, def.max || 2000) : d;
      case 'color':
        return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d;
      case 'keymap':
        return cleanKeymap(v);
      default:
        return d;
    }
  }

  /* ----------------------------------------------------------------- store */
  function createStore({ storage, onChange } = {}) {
    const mem = {};
    const store = storage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const listeners = [];
    const values = {};
    SCHEMA.forEach((s) => { values[s.id] = s.type === 'keymap' ? {} : s.def; });

    const safeGet = (k) => { try { return store.getItem(k); } catch { return null; } };
    const safeSet = (k, v) => { try { store.setItem(k, v); return true; } catch { return false; } };
    const safeDel = (k) => { try { store.removeItem(k); } catch {} };

    function legacyEncode(def, v) { return def.legacyBool ? (v ? '1' : '0') : String(v); }
    function mirror(def) {
      if (!def.legacy) return;
      const v = values[def.id];
      if (def.id === 'accentColor' || def.id === 'theme' || def.id === 'accentMode') { safeSet(def.legacy, String(v)); return; }
      safeSet(def.legacy, legacyEncode(def, v));
    }
    function persist() {
      const diff = {};
      for (const s of SCHEMA) if (!equal(values[s.id], s.type === 'keymap' ? {} : s.def)) diff[s.id] = values[s.id];
      return safeSet(KEY, JSON.stringify({ v: VERSION, values: diff }));
    }
    function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    function load() {
      const raw = safeGet(KEY);
      let parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch { safeSet(KEY + '-corrupt', String(raw).slice(0, 20000)); safeDel(KEY); parsed = null; }
      }
      if (parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object') {
        for (const s of SCHEMA) if (Object.prototype.hasOwnProperty.call(parsed.values, s.id)) values[s.id] = coerce(s, parsed.values[s.id]);
        return;
      }
      // first run of v2: pick up the old scattered keys once
      for (const s of SCHEMA) {
        if (!s.legacy) continue;
        const lv = safeGet(s.legacy);
        if (lv === null || lv === undefined) continue;
        let v = lv;
        if (s.id === 'theme' && lv === 'dark') v = 'zephyr';
        values[s.id] = coerce(s, s.legacyBool ? lv === '1' : v);
      }
      const hk = safeGet('zephyr-hotkeys');
      if (hk) { try { const h = JSON.parse(hk); const map = { play: 'playpause', full: 'fullscreen', mute: 'mute', shot: 'screenshot', book: 'bookmark' }; const km = {}; for (const k of Object.keys(map)) if (h[k]) km[map[k]] = [h[k] === ' ' ? 'space' : String(h[k]).toLowerCase()]; values.keymap = cleanKeymap(km); } catch {} }
      persist();
    }

    function emit(id, value, source) {
      if (typeof onChange === 'function') { try { onChange(id, value, source); } catch {} }
      for (const l of listeners.slice()) { try { if (!l.id || l.id === id) l.fn(value, id, source); } catch {} }
    }

    const api = {
      GROUPS, SCHEMA, KEY,
      def: (id) => BY_ID[id],
      get(id) { const s = BY_ID[id]; if (!s) return undefined; return s.type === 'keymap' ? JSON.parse(JSON.stringify(values[id])) : values[id]; },
      set(id, v, opts) {
        const s = BY_ID[id]; if (!s) return { ok: false, error: 'unknown setting' };
        const nv = coerce(s, v);
        const changed = !equal(nv, values[id]);
        values[id] = nv;
        if (changed || (opts && opts.force)) { persist(); mirror(s); if (!(opts && opts.quiet)) emit(id, nv, 'set'); }
        return { ok: true, value: nv, changed };
      },
      isDefault(id) { const s = BY_ID[id]; return !s || equal(values[id], s.type === 'keymap' ? {} : s.def); },
      reset(id) { return api.set(id, BY_ID[id] && (BY_ID[id].type === 'keymap' ? {} : BY_ID[id].def), { force: true }); },
      resetGroup(gid) { SCHEMA.filter((s) => s.group === gid).forEach((s) => api.reset(s.id)); },
      resetAll() { SCHEMA.forEach((s) => api.reset(s.id)); },
      countChanged(gid) { return SCHEMA.filter((s) => (!gid || s.group === gid) && !api.isDefault(s.id)).length; },
      export() { const diff = {}; SCHEMA.forEach((s) => { if (!api.isDefault(s.id)) diff[s.id] = values[s.id]; }); return JSON.stringify({ app: 'ZephyrPlayer', v: VERSION, exportedAt: new Date().toISOString(), values: diff }, null, 2); },
      import(text) {
        let j; try { j = JSON.parse(String(text)); } catch { return { ok: false, error: 'This is not a valid settings file.' }; }
        if (!j || typeof j !== 'object' || !j.values || typeof j.values !== 'object') return { ok: false, error: 'This file has no settings in it.' };
        let applied = 0, rejected = 0;
        for (const k of Object.keys(j.values)) { if (!BY_ID[k]) { rejected++; continue; } api.set(k, j.values[k], { force: true }); applied++; }
        return { ok: true, applied, rejected };
      },
      on(id, fn) { listeners.push({ id: id || null, fn }); },
      allKeymapCombos() { return values.keymap; },
      mirrorAll() { SCHEMA.forEach(mirror); }
    };
    load();
    api.mirrorAll();
    return api;
  }

  return { createStore, SCHEMA, GROUPS, KEY, VERSION, coerce, normalizeCombo, isCombo, cleanKeymap, THEME_IDS };
});

if (typeof window !== 'undefined' && window.ZSettingsLib && !window.ZSettings) {
  try { window.ZSettings = window.ZSettingsLib.createStore({ storage: window.localStorage }); } catch (e) { console.error('settings store failed, using defaults', e); window.ZSettings = window.ZSettingsLib.createStore({}); }
}
