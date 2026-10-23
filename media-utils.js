'use strict';
/** Filesystem / playlist helpers for the main process. Pure Node, no Electron imports. */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MEDIA_EXT = new Set((
  'mp4 m4v mkv webm avi mov wmv flv f4v ts m2ts mts mpg mpeg m2v vob 3gp 3g2 ogv ogm asf rm rmvb divx mxf ' +
  'mp3 flac wav ogg oga aac m4a m4b opus wma ape wv mka aiff aif ac3 eac3 dts amr mpc tta'
).split(' ').map(e => '.' + e));
const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa']);

const PLAYLIST_EXT = new Set(['.m3u', '.m3u8', '.pls']);
const isPlaylist = (p) => PLAYLIST_EXT.has(path.extname(String(p || '')).toLowerCase());
const isMedia = (p) => MEDIA_EXT.has(path.extname(String(p || '')).toLowerCase());
const isSub = (p) => SUB_EXT.has(path.extname(String(p || '')).toLowerCase());
const isUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(s || '')) && !/^file:\/\//i.test(String(s));
const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Expand a mixed list of files/folders into media + subtitle paths.
 * Never throws; unreadable entries are skipped.
 */
async function expandPaths(inputs, { maxFiles = 5000, maxDepth = 8 } = {}) {
  const media = [];
  const subs = [];
  const streams = [];
  const seen = new Set();

  async function walk(dir, depth) {
    if (depth > maxDepth || media.length >= maxFiles) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => naturalCompare(a.name, b.name));
    for (const ent of entries) {
      if (media.length >= maxFiles) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, depth + 1);
      else if (ent.isFile() || ent.isSymbolicLink()) await addFile(full, false);
    }
  }

  async function addFile(full, explicit) {
    const key = full.toLowerCase();
    if (seen.has(key)) return;
    if (isSub(full)) { seen.add(key); subs.push(full); return; }
    if (isPlaylist(full)) { seen.add(key); await addPlaylist(full); return; }
    if (!explicit && !isMedia(full)) return;
    let size = 0;
    try { const st = await fs.promises.stat(full); if (!st.isFile()) return; size = st.size; } catch { return; }
    seen.add(key);
    media.push({ path: full, name: path.basename(full), size });
  }

  async function addPlaylist(file) {
    let text = '';
    try { const st = await fs.promises.stat(file); if (st.size > 4 * 1024 * 1024) return; text = await fs.promises.readFile(file, 'utf8'); } catch { return; }
    const entries = /\.pls$/i.test(file) ? parsePls(text, path.dirname(file)) : parseM3u(text, path.dirname(file));
    for (const e of entries.slice(0, maxFiles)) {
      if (isUrl(e.path)) streams.push({ url: e.path, title: e.title });
      else await addFile(e.path, true);
    }
  }

  for (const raw of Array.isArray(inputs) ? inputs : []) {
    if (typeof raw !== 'string' || !raw) continue;
    if (isUrl(raw)) { streams.push({ url: raw, title: raw }); continue; }
    let st;
    try { st = await fs.promises.stat(raw); } catch { continue; }
    if (st.isDirectory()) await walk(raw, 0);
    else if (st.isFile()) await addFile(raw, true);
  }
  return { media, subs, streams };
}

/** Subtitle files next to a media file: "movie.srt", "movie.en.srt", "movie.English.ass" ... */
async function findSidecarSubs(mediaPath) {
  try {
    const dir = path.dirname(mediaPath);
    const base = path.basename(mediaPath, path.extname(mediaPath)).toLowerCase();
    const names = await fs.promises.readdir(dir);
    return names
      .filter(n => isSub(n) && path.basename(n, path.extname(n)).toLowerCase().startsWith(base))
      .sort(naturalCompare)
      .map(n => path.join(dir, n));
  } catch { return []; }
}

/** Parse .m3u/.m3u8 text. Relative entries are resolved against the playlist's folder. */
function parseM3u(text, baseDir) {
  const out = [];
  let title = null;
  for (let line of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || /^#EXTM3U/i.test(line)) continue;
    if (/^#EXTINF:/i.test(line)) { const c = line.indexOf(','); title = c >= 0 ? line.slice(c + 1).trim() : null; continue; }
    if (line.startsWith('#')) continue;
    let p = line;
    if (/^file:\/\//i.test(p)) { try { p = fileURLToPath(p); } catch { /* keep */ } }
    else if (!isUrl(p) && baseDir && !path.isAbsolute(p) && !/^\\\\/.test(p)) p = path.resolve(baseDir, p);
    out.push({ path: p, title: title || (isUrl(p) ? p : path.basename(p)) });
    title = null;
  }
  return out;
}

function parsePls(text, baseDir) {
  const files = {}, titles = {};
  for (const line of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = /^(File|Title)(\d+)\s*=\s*(.+)$/i.exec(line.trim());
    if (!m) continue;
    (m[1].toLowerCase() === 'file' ? files : titles)[m[2]] = m[3].trim();
  }
  return Object.keys(files).sort((a, b) => a - b).map((k) => {
    let p = files[k];
    if (/^file:\/\//i.test(p)) { try { p = fileURLToPath(p); } catch {} }
    else if (!isUrl(p) && baseDir && !path.isAbsolute(p)) p = path.resolve(baseDir, p);
    return { path: p, title: titles[k] || (isUrl(p) ? p : path.basename(p)) };
  });
}

function buildM3u(entries) {
  const lines = ['#EXTM3U'];
  for (const e of entries || []) {
    const v = e && (e.path || e.url);
    if (!v) continue;
    if (e.title) lines.push('#EXTINF:-1,' + String(e.title).replace(/\r?\n/g, ' '));
    lines.push(String(v));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Every existing file/folder in argv that is not the app/exe/flag. Supports multi-select "Open with". */
function argvPaths(argv, { appDir } = {}) {
  const out = [];
  for (let i = 1; i < (argv || []).length; i++) {
    const a = argv[i];
    if (!a || typeof a !== 'string' || a.startsWith('-')) continue;
    if (appDir && path.resolve(a) === path.resolve(appDir)) continue;
    if (/^\.?$/.test(a)) continue;
    try { if (fs.existsSync(a)) out.push(a); } catch {}
  }
  return out;
}

module.exports = { MEDIA_EXT, SUB_EXT, PLAYLIST_EXT, isPlaylist, parsePls, isMedia, isSub, isUrl, naturalCompare, expandPaths, findSidecarSubs, parseM3u, buildM3u, argvPaths };
