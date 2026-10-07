'use strict';
/** Pure helpers for the mpv engine settings: validation of what the UI sends, user mpv options, and the audio filter chain. */
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

const WHEEL_KINDS = new Set(['none', 'volume', 'seek', 'speed', 'track']);
const CLICK_KINDS = new Set(['none', 'playpause', 'fullscreen', 'mute', 'screenshot', 'next', 'prev', 'seekFwd', 'seekBack', 'abloop', 'bookmark', 'playlist', 'miniPlayer']);
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };

function cleanCfg(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const m = c.mouse && typeof c.mouse === 'object' ? c.mouse : {};
  const pick = (v, set, d) => (set.has(v) ? v : d);
  const out = {
    volumeMax: int(c.volumeMax, 100, 300, 200), cacheMb: int(c.cacheMb, 50, 2000, 200), hrSeek: c.hrSeek !== false, compat: int(c.compat, 0, 2, 0),
    streamReload: c.streamReload !== false,
    mouse: {
      wheel: pick(m.wheel, WHEEL_KINDS, 'volume'), wheelShift: pick(m.wheelShift, WHEEL_KINDS, 'seek'), wheelCtrl: pick(m.wheelCtrl, WHEEL_KINDS, 'speed'),
      click: pick(m.click, CLICK_KINDS, 'playpause'), dblclick: pick(m.dblclick, CLICK_KINDS, 'fullscreen'), middleClick: pick(m.middleClick, CLICK_KINDS, 'mute'),
      mouseBack: pick(m.mouseBack, CLICK_KINDS, 'prev'), mouseForward: pick(m.mouseForward, CLICK_KINDS, 'next')
    },
    steps: { volume: int(c.steps && c.steps.volume, 1, 20, 5), seek: int(c.steps && c.steps.seek, 1, 300, 10) }
  };
  if (typeof c.slang === 'string') out.slang = c.slang.slice(0, 40);
  if (typeof c.alang === 'string') out.alang = c.alang.slice(0, 40);
  return out;
}

// Extra mpv options typed by the user: one per line, validated; anything that could run code or break the app is dropped.
const BLOCKED_OPT = /^(script|scripts|script-opts.*|script-binding|include|input-.*|load-.*|run|config.*|profile.*|log-file|ytdl.*|wid|ipc.*|keep-open.*|idle|force-window|external-file.*|sub-file.*|audio-file.*|volume-max|start|title|screenshot-directory|watch-later.*|save-position-on-quit|cover-art-files|opengl-.*dll|vo-.*|lavfi-complex|reset-on-next-file|player-operation-mode|terminal|msg-level|really-quiet|quiet|use-filedir-conf)$/;
function parseUserMpvOptions(text) {
  const accepted = [], rejected = [];
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 60)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^--/, '');
    const m = /^([a-z][a-z0-9-]*)(?:=(.{0,200}))?$/.exec(line);
    if (!m || BLOCKED_OPT.test(m[1]) || /[\r\n\0]/.test(m[2] || '')) { rejected.push(raw.trim().slice(0, 60)); continue; }
    accepted.push('--' + m[1] + (m[2] !== undefined ? '=' + m[2] : ''));
  }
  return { accepted, rejected };
}

/* ---- audio: volume boost limiter, loudness, night mode and the equalizer are ONE filter chain ---- */
function composeAudioFilter(st) {
  const f = [];
  const eq = st.eq || {};
  if (st.normalize || eq.normalize) f.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (st.night) f.push('acompressor=threshold=0.089:ratio=4:attack=20:release=250:makeup=2');
  const bass = clampNum(eq.bass, -15, 15), mid = clampNum(eq.mid, -15, 15), treble = clampNum(eq.treble, -15, 15);
  if (bass || mid || treble) {
    f.push('equalizer=f=100:width_type=o:width=2:g=' + bass);
    f.push('equalizer=f=1000:width_type=o:width=2:g=' + mid);
    f.push('equalizer=f=8000:width_type=o:width=2:g=' + treble);
  }
  const gain = clampNum(eq.gain, 0, 20);
  if (gain) f.push('volume=' + gain + 'dB');
  if (st.limiter) f.push('alimiter=limit=0.95:level=disabled');      // last in the chain: catches peaks from boost + EQ + gain
  return f.length ? 'lavfi=[' + f.join(',') + ']' : '';
}

module.exports = { cleanCfg, parseUserMpvOptions, composeAudioFilter, BLOCKED_OPT };
