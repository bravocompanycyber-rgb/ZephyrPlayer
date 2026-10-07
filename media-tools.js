'use strict';
/** ffmpeg clip export + tool/version probing + diagnostics text. Pure Node (no Electron). */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const fmtSec = (s) => Math.max(0, Number(s) || 0).toFixed(3);

function clipName(srcPath, start, end, mode, hasVideo) {
  const base = path.basename(String(srcPath || 'clip'), path.extname(String(srcPath || '')))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || 'clip';
  const t = (x) => { x = Math.floor(x); return String(Math.floor(x / 60)).padStart(2, '0') + 'm' + String(x % 60).padStart(2, '0') + 's'; };
  const ext = mode === 'gif' ? 'gif' : (!hasVideo ? (mode === 'copy' ? path.extname(srcPath).slice(1) || 'mka' : 'm4a') : (mode === 'copy' ? (path.extname(srcPath).slice(1) || 'mkv') : 'mp4'));
  return `${base} [${t(start)}-${t(end)}].${ext}`;
}

function buildClipArgs({ input, start, end, mode, out, hasVideo = true }) {
  const dur = end - start;
  if (!(dur > 0.2)) throw new Error('The B point must be after the A point');
  if (dur > 3 * 3600) throw new Error('Clip is longer than 3 hours');
  if (start < 0) throw new Error('Bad start time');
  const head = ['-v', 'error', '-y', '-nostdin'];
  if (mode === 'gif') {
    if (!hasVideo) throw new Error('GIF needs a video file');
    return [...head, '-ss', fmtSec(start), '-t', fmtSec(dur), '-i', input,
      '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop', '0', out];
  }
  if (mode === 'copy') {
    // instant, lossless; the cut snaps to the nearest keyframe
    return [...head, '-ss', fmtSec(start), '-i', input, '-t', fmtSec(dur), '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', out];
  }
  if (!hasVideo) return [...head, '-ss', fmtSec(start), '-i', input, '-t', fmtSec(dur), '-vn', '-c:a', 'aac', '-b:a', '192k', out];
  // precise: re-encode to widely playable H.264 + AAC
  return [...head, '-ss', fmtSec(start), '-i', input, '-t', fmtSec(dur), '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
}

/** Time of the last video keyframe at or before t (looks back 90 s), or null when unknown. */
function findPrevKeyframe(ffprobePath, input, t) {
  return new Promise((resolve) => {
    if (!ffprobePath) { resolve(null); return; }
    const from = Math.max(0, t - 90);
    execFile(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0',
      '-read_intervals', from.toFixed(3) + '%' + (t + 0.05).toFixed(3), '-i', input],
    { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, so) => {
      const times = String(so || '').split(/\r?\n/).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x) && x <= t + 0.05);
      resolve(err && !times.length ? null : (times.length ? Math.max(...times) : null));
    });
  });
}

async function exportClip(ffmpegPath, opts) {
  let mode = opts.mode, switched = false, args;
  try {
    if (!ffmpegPath) throw new Error('ffmpeg not found (run setup-tools)');
    if (!opts.input || !fs.existsSync(opts.input)) throw new Error('Source file not found (clips need a local file)');
    buildClipArgs(opts); // validate first
    // "Fast copy" can only cut on keyframes: if the previous keyframe is far before A the clip would
    // start seconds early, so quietly switch to the precise re-encode instead.
    if (mode === 'copy' && opts.hasVideo !== false) {
      const key = await findPrevKeyframe(opts.ffprobePath, opts.input, opts.start);
      if (key === null || opts.start - key > 1.5) { mode = 'precise'; switched = true; }
    }
    args = buildClipArgs(Object.assign({}, opts, { mode }));
  } catch (e) { return { ok: false, error: e.message }; }
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout: 15 * 60 * 1000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, _so, se) => {
      let size = 0;
      try { size = fs.statSync(opts.out).size; } catch {}
      if (err || size < 500) { resolve({ ok: false, error: String(se || (err && err.message) || 'ffmpeg produced no output').trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300) }); return; }
      resolve({ ok: true, path: opts.out, size, mode, switched });
    });
  });
}

function getVersion(exe, args) {
  return new Promise((resolve) => {
    if (!exe) { resolve(null); return; }
    try {
      execFile(exe, args || ['--version'], { timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, so, se) => {
        const line = String(so || se || '').split(/\r?\n/).find((l) => l.trim());
        resolve(err && !line ? null : (line || '').trim().slice(0, 140));
      });
    } catch { resolve(null); }
  });
}

function buildDiagnostics(d) {
  const L = [];
  L.push('ZephyrPlayer diagnostics', '========================');
  L.push(`App: ${d.version}   Electron: ${d.electron}   Chromium: ${d.chrome}   Node: ${d.node}`);
  L.push(`OS: ${d.os}   CPU: ${d.cpu}   RAM: ${d.ram}`);
  if (d.gpu) L.push(`GPU: ${d.gpu}`);
  L.push('', 'Tools:');
  for (const t of d.tools) L.push(`  ${t.name.padEnd(9)} ${t.path ? 'OK' : 'MISSING'}  ${t.version || ''}  ${t.path || ''}`);
  if (d.jsRuntime) L.push(`  js runtime for yt-dlp: ${d.jsRuntime}`);
  if (d.settings) L.push('', 'Settings: ' + JSON.stringify(d.settings));
  if (d.log) L.push('', 'Last log lines:', ...String(d.log).split(/\r?\n/).slice(-60));
  return L.join('\n');
}

/* ---- codec support report (from the ffmpeg build) ---- */
const CODEC_LIST = {
  video: [['h264', 'H.264 / AVC'], ['hevc', 'HEVC / H.265 / x265'], ['av1', 'AV1'], ['vp9', 'VP9'], ['vp8', 'VP8'], ['mpeg2video', 'MPEG-2 (DVD, TV)'], ['mpeg4', 'MPEG-4 / DivX / Xvid'],
    ['vc1', 'VC-1 (Blu-ray)'], ['wmv3', 'Windows Media Video'], ['prores', 'Apple ProRes'], ['dnxhd', 'DNxHD / DNxHR'], ['theora', 'Theora'], ['mjpeg', 'Motion JPEG'], ['rv40', 'RealVideo'], ['flv', 'Flash Video'], ['cfhd', 'CineForm'], ['ffv1', 'FFV1'], ['hap', 'HAP']],
  audio: [['aac', 'AAC'], ['mp3', 'MP3'], ['ac3', 'Dolby Digital (AC-3)'], ['eac3', 'Dolby Digital Plus'], ['truehd', 'Dolby TrueHD'], ['dts', 'DTS / DTS-HD'], ['flac', 'FLAC'], ['opus', 'Opus'], ['vorbis', 'Vorbis'],
    ['alac', 'Apple Lossless'], ['wmav2', 'Windows Media Audio'], ['wavpack', 'WavPack'], ['ape', "Monkey's Audio"], ['pcm_s16le', 'PCM / WAV'], ['amr_nb', 'AMR'], ['cook', 'RealAudio']],
  subtitles: [['subrip', 'SubRip (.srt)'], ['ass', 'ASS / SSA'], ['webvtt', 'WebVTT'], ['dvd_subtitle', 'DVD subtitles'], ['hdmv_pgs_subtitle', 'Blu-ray PGS subtitles'], ['mov_text', 'MP4 text']]
};
function parseDecoders(text) {
  const names = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s([VAS][A-Z.]{5})\s+(\S+)\s/.exec(line);
    if (m) names.add(m[2]);
  }
  return names;
}
async function codecReport(ffmpegPath) {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg not found' };
  const run = (args) => new Promise((resolve) => execFile(ffmpegPath, args, { timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, so, se) => resolve(String(so || '') + '\n' + String(se || ''))));
  const dec = parseDecoders(await run(['-hide_banner', '-decoders']));
  if (!dec.size) return { ok: false, error: 'Could not read the decoder list' };
  const hw = String(await run(['-hide_banner', '-hwaccels'])).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[a-z0-9_]+$/.test(l) && l !== 'Hardware');
  const section = (list) => list.map(([id, name]) => ({ id, name, ok: dec.has(id) }));
  const rep = { ok: true, total: dec.size, video: section(CODEC_LIST.video), audio: section(CODEC_LIST.audio), subtitles: section(CODEC_LIST.subtitles), hwaccels: hw };
  rep.supported = rep.video.concat(rep.audio, rep.subtitles).filter((c) => c.ok).length;
  rep.listed = rep.video.length + rep.audio.length + rep.subtitles.length;
  return rep;
}

module.exports = { codecReport, parseDecoders, CODEC_LIST, buildClipArgs, exportClip, findPrevKeyframe, clipName, getVersion, buildDiagnostics };
