'use strict';
/**
 * Media probing + poster frames for the playlist.
 *  - ffprobe (best: fast, rich) -> mpv (always bundled) as fallback
 *  - results cached on disk by path + size + mtime, so re-adding a folder is instant
 *  - bounded concurrency; never throws; every call resolves
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HDR_TRC = { smpte2084: 'HDR10', 'arib-std-b67': 'HLG' };

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fpsOf(s) {
  const r = String(s || '0/1').split('/');
  const f = r.length === 2 ? num(r[0]) / (num(r[1]) || 1) : num(r[0]);
  return f > 0 && f < 1000 ? Math.round(f * 100) / 100 : 0;
}
function tag(t, key) {
  if (!t) return '';
  for (const k of Object.keys(t)) if (k.toLowerCase() === key) return String(t[k]);
  return '';
}

function parseFfprobe(json, stat) {
  const streams = Array.isArray(json.streams) ? json.streams : [];
  const fmt = json.format || {};
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  const hasCover = streams.some((s) => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic);
  let rotation = 0;
  if (v && Array.isArray(v.side_data_list)) {
    const r = v.side_data_list.find((x) => x.rotation !== undefined);
    if (r) rotation = Math.abs(Math.round(num(r.rotation))) % 360;
  }
  const sideDV = v && Array.isArray(v.side_data_list) && v.side_data_list.some((x) => /dovi/i.test(x.side_data_type || ''));
  let width = v ? v.width || 0 : 0, height = v ? v.height || 0 : 0;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const bits = v ? (parseInt(v.bits_per_raw_sample, 10) || (/10(le|be)?$/.test(v.pix_fmt || '') ? 10 : /12(le|be)?$/.test(v.pix_fmt || '') ? 12 : 8)) : 0;
  const langs = Array.from(new Set(audios.map((s) => tag(s.tags, 'language')).filter((x) => x && x !== 'und')));
  const subLangs = Array.from(new Set(subs.map((s) => tag(s.tags, 'language')).filter((x) => x && x !== 'und')));
  const t = fmt.tags || {};
  return {
    ok: true, source: 'ffprobe',
    duration: num(fmt.duration) || (v ? num(v.duration) : 0) || (a ? num(a.duration) : 0),
    size: stat ? stat.size : num(fmt.size),
    container: String(fmt.format_name || '').split(',')[0],
    bitrate: Math.round(num(fmt.bit_rate)),
    title: tag(t, 'title'), artist: tag(t, 'artist') || tag(t, 'album_artist'), album: tag(t, 'album'),
    hasVideo: !!v, hasCover,
    width, height, fps: v ? fpsOf(v.avg_frame_rate || v.r_frame_rate) : 0,
    vcodec: v ? v.codec_name || '' : '', vprofile: v ? v.profile || '' : '', pixfmt: v ? v.pix_fmt || '' : '', bitDepth: bits,
    hdr: v ? (sideDV ? 'Dolby Vision' : HDR_TRC[v.color_transfer] || '') : '',
    acodec: a ? a.codec_name || '' : '', achannels: a ? a.channels || 0 : 0, asamplerate: a ? parseInt(a.sample_rate, 10) || 0 : 0,
    audioTracks: audios.length, subTracks: subs.length, chapters: Array.isArray(json.chapters) ? json.chapters.length : 0,
    audioLangs: langs, subLangs
  };
}

function parseMpvLine(line, stat) {
  const p = line.split('|');
  const clean = (s) => (s && s !== '(error)' ? s : '');
  const w = parseInt(p[2], 10) || 0, h = parseInt(p[3], 10) || 0;
  return {
    ok: true, source: 'mpv',
    duration: num(p[1]), size: stat ? stat.size : 0, container: clean(p[7]).split(',')[0],
    bitrate: 0, title: clean(p[12]), artist: clean(p[13]), album: '',
    hasVideo: w > 0 && h > 0, hasCover: false, width: w, height: h, fps: Math.round(num(p[6]) * 100) / 100,
    vcodec: clean(p[4]), vprofile: '', pixfmt: clean(p[10]), bitDepth: /10/.test(clean(p[10])) ? 10 : (w ? 8 : 0), hdr: '',
    acodec: clean(p[5]), achannels: parseInt(p[8], 10) || 0, asamplerate: parseInt(p[9], 10) || 0,
    audioTracks: clean(p[5]) ? 1 : 0, subTracks: 0, chapters: 0, audioLangs: [], subLangs: []
  };
}

class MediaProbe {
  constructor({ ffprobePath, ffmpegPath, mpvPath, cacheFile, thumbDir, log, concurrency = 3 } = {}) {
    this.ffprobePath = ffprobePath || null;
    this.ffmpegPath = ffmpegPath || null;
    this.mpvPath = mpvPath || null;
    this.cacheFile = cacheFile || null;
    this.thumbDir = thumbDir || null;
    this.log = typeof log === 'function' ? log : () => {};
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
    this.inflight = new Map();
    this.cache = new Map();
    this._saveTimer = null;
    this._load();
  }

  setTools({ ffprobePath, ffmpegPath, mpvPath }) {
    if (ffprobePath !== undefined) this.ffprobePath = ffprobePath;
    if (ffmpegPath !== undefined) this.ffmpegPath = ffmpegPath;
    if (mpvPath !== undefined) this.mpvPath = mpvPath;
  }

  _load() {
    try {
      if (!this.cacheFile) return;
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      for (const [k, v] of Object.entries(raw)) this.cache.set(k, v);
    } catch { /* first run */ }
  }

  _scheduleSave() {
    if (!this.cacheFile || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        let entries = Array.from(this.cache.entries());
        if (entries.length > 6000) entries = entries.slice(entries.length - 5000);
        fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(entries)));
      } catch (e) { this.log('probe cache save failed:', e.message); }
    }, 1500);
  }

  _run(task) {
    return new Promise((resolve) => {
      const go = () => {
        this.active++;
        task().catch(() => null).then((r) => { this.active--; resolve(r); const n = this.queue.shift(); if (n) n(); });
      };
      if (this.active < this.concurrency) go(); else this.queue.push(go);
    });
  }

  async probe(file) {
    if (typeof file !== 'string' || !file) return { ok: false, error: 'bad path' };
    let st;
    try { st = await fs.promises.stat(file); } catch { return { ok: false, error: 'missing' }; }
    if (!st.isFile()) return { ok: false, error: 'not a file' };
    const key = file + '|' + st.size + '|' + Math.round(st.mtimeMs);
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);

    const p = this._run(async () => {
      let info = null;
      if (this.ffprobePath) info = await this._ffprobe(file, st);
      if (!info && this.mpvPath) info = await this._mpvProbe(file, st);
      return info || { ok: false, error: 'unreadable', size: st.size };
    }).then((info) => {
      this.inflight.delete(key);
      if (info && info.ok) { this.cache.set(key, info); this._scheduleSave(); }
      return info;
    });
    this.inflight.set(key, p);
    return p;
  }

  _ffprobe(file, st) {
    return new Promise((resolve) => {
      execFile(this.ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', '-i', file],
        { timeout: 25000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
          if (err && !stdout) { resolve(null); return; }
          try {
            const info = parseFfprobe(JSON.parse(String(stdout)), st);
            resolve(info.duration || info.hasVideo || info.acodec ? info : null);
          } catch { resolve(null); }
        });
    });
  }

  _mpvProbe(file, st) {
    return new Promise((resolve) => {
      const msg = 'ZP|${=duration}|${=video-params/w}|${=video-params/h}|${video-format}|${audio-codec-name}|${=container-fps}|${file-format}|' +
        '${=audio-params/channel-count}|${=audio-params/samplerate}|${video-params/pixelformat}|${=video-bitrate}|${metadata/by-key/title}|${metadata/by-key/artist}';
      execFile(this.mpvPath, ['--no-config', '--vo=null', '--ao=null', '--frames=1', '--no-sub', '--msg-level=all=info', '--term-playing-msg=' + msg, '--', file],
        { timeout: 25000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
          const line = String(stdout || '').split(/\r?\n/).find((l) => l.startsWith('ZP|'));
          if (!line) { resolve(null); return; }
          const info = parseMpvLine(line, st);
          resolve(info.duration || info.hasVideo ? info : null);
        });
    });
  }

  /** One JPEG poster frame (cached). Resolves to a file path or null. */
  async thumb(file, duration) {
    if (!this.ffmpegPath || !this.thumbDir || typeof file !== 'string') return null;
    let st;
    try { st = await fs.promises.stat(file); } catch { return null; }
    const id = crypto.createHash('sha1').update(file + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex').slice(0, 20);
    const out = path.join(this.thumbDir, id + '.jpg');
    try { if ((await fs.promises.stat(out)).size > 200) return out; } catch {}
    try { await fs.promises.mkdir(this.thumbDir, { recursive: true }); } catch {}
    const at = Math.max(1, Math.min(Math.floor((Number(duration) || 20) * 0.12), 90));
    return this._run(async () => new Promise((resolve) => {
      execFile(this.ffmpegPath, ['-v', 'error', '-y', '-nostdin', '-ss', String(at), '-i', file, '-frames:v', '1',
        '-vf', 'scale=320:-2:flags=bilinear', '-q:v', '5', out],
      { timeout: 25000, windowsHide: true }, () => {
        fs.promises.stat(out).then((s) => resolve(s.size > 200 ? out : null)).catch(() => resolve(null));
      });
    }));
  }
}

module.exports = { MediaProbe, parseFfprobe, parseMpvLine };
