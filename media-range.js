'use strict';
/** Serves local media files to the page through the private "zmedia://" scheme, with proper Range (seeking) support and CORS headers.
 *  Why: the browser engine cannot raise the volume above 100% on a file:// video (Web Audio needs a CORS-clean source).
 *  Safety: only existing, regular media files are served; no directories, no other file types; the scheme is private to the app. */
const fs = require('fs');
const path = require('path');

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.weba': 'audio/webm' };
const mimeFor = (f) => MIME[path.extname(String(f)).toLowerCase()] || 'application/octet-stream';

/** "bytes=0-99" | "bytes=100-" | "bytes=-500"  ->  {start,end} (inclusive), null when absent, 'invalid' when unsatisfiable */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start, end;
  if (m[1] === '') { const n = parseInt(m[2], 10); if (!(n > 0)) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (!(start <= end) || start >= size) return 'invalid';
  return { start, end };
}

/** zmedia://local/<encodeURIComponent(absolute path)>  ->  absolute path (or null) */
function pathFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'zmedia:') return null;
    const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return path.isAbsolute(p) ? p : null;
  } catch { return null; }
}
const urlFromPath = (p) => 'zmedia://local/' + encodeURIComponent(p);

async function serveFile(file, rangeHeader, isAllowed) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', 'Cache-Control': 'no-store' };
  if (!file || (isAllowed && !isAllowed(file))) return { status: 403, headers: cors, stream: null };
  let st;
  try { st = await fs.promises.stat(file); } catch { return { status: 404, headers: cors, stream: null }; }
  if (!st.isFile()) return { status: 404, headers: cors, stream: null };
  const size = st.size;
  const r = parseRange(rangeHeader, size);
  const base = Object.assign({}, cors, { 'Content-Type': mimeFor(file), 'Accept-Ranges': 'bytes' });
  if (r === 'invalid') return { status: 416, headers: Object.assign({}, base, { 'Content-Range': 'bytes */' + size }), stream: null };
  if (!r) return { status: 200, headers: Object.assign({}, base, { 'Content-Length': String(size) }), stream: size ? fs.createReadStream(file) : null, size };
  return { status: 206, headers: Object.assign({}, base, { 'Content-Length': String(r.end - r.start + 1), 'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + size }), stream: fs.createReadStream(file, { start: r.start, end: r.end }), size };
}

/** Registers the scheme handler with whichever Electron API exists (protocol.handle since Electron 25, registerStreamProtocol before). */
function registerMediaProtocol(protocol, isAllowed, log) {
  const get = (url, range) => serveFile(pathFromUrl(url), range, isAllowed);
  if (typeof protocol.handle === 'function') {
    const { Readable } = require('stream');
    protocol.handle('zmedia', async (request) => {
      const r = await get(request.url, request.headers.get('range'));
      const body = r.stream ? Readable.toWeb(r.stream) : null;
      return new Response(body, { status: r.status, headers: r.headers });
    });
    return 'handle';
  }
  protocol.registerStreamProtocol('zmedia', async (request, callback) => {
    const hdr = request.headers || {};
    const r = await get(request.url, hdr.Range || hdr.range);
    callback({ statusCode: r.status, headers: r.headers, data: r.stream || undefined });
  });
  return 'registerStreamProtocol';
}

module.exports = { parseRange, pathFromUrl, urlFromPath, serveFile, registerMediaProtocol, mimeFor };
