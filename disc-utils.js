'use strict';
/** DVD / Blu-ray discs: folders (VIDEO_TS / BDMV) and disc images (.iso / .img). mpv plays them through dvdnav:// (with menus) and bd:// (main movie + titles). */
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.iso', '.img']);
const isDiscImageExt = (f) => IMAGE_EXT.has(path.extname(String(f || '')).toLowerCase());

/** A folder that IS a disc, or a disc's VIDEO_TS / BDMV folder: { type:'dvd'|'bd', root } (root = the folder that contains VIDEO_TS / BDMV). */
async function detectDiscFolder(dir) {
  let names;
  try { names = (await fs.promises.readdir(dir)).map((n) => n.toLowerCase()); } catch { return null; }
  const base = path.basename(dir).toLowerCase();
  if (base === 'video_ts') return { type: 'dvd', root: path.dirname(dir) };
  if (base === 'bdmv') return { type: 'bd', root: path.dirname(dir) };
  if (names.includes('bdmv')) return { type: 'bd', root: dir };
  if (names.includes('video_ts')) return { type: 'dvd', root: dir };
  return null;
}

async function readPart(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}
const has = (buf, text) => buf.includes(Buffer.from(text, 'latin1')) || buf.includes(Buffer.from(text, 'utf16le')) || buf.includes(Buffer.from(Array.from(text).flatMap((c) => [0, c.charCodeAt(0)])));

/** Looks inside the image for the directory names that identify the disc type (ISO9660 + UDF store them as plain names). */
async function detectDiscImage(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    if (size < 64 * 1024) return null;
    const parts = [await readPart(fh, 0, Math.min(size, 6 * 1024 * 1024))];
    if (size > 8 * 1024 * 1024) parts.push(await readPart(fh, Math.max(0, size - 2 * 1024 * 1024), 2 * 1024 * 1024));
    let dvd = false, bd = false;
    for (const b of parts) { if (has(b, 'BDMV')) bd = true; if (has(b, 'VIDEO_TS')) dvd = true; }
    return bd ? 'bd' : (dvd ? 'dvd' : null);
  } catch { return null; } finally { try { if (fh) await fh.close(); } catch { /* ignore */ } }
}

/** What to hand to mpv for a disc. The path goes in as ONE argument; nothing is interpreted by a shell. */
function discPlay(type, p) {
  const s = String(p || '');
  if ((type !== 'dvd' && type !== 'bd') || !s || /[\r\n\0]/.test(s) || s.startsWith('-')) return null;
  const dev = /^[A-Za-z]:[\\/]?$/.test(s) ? s.slice(0, 2) : s;        // a drive root like D:\ is given to mpv as D:
  return type === 'dvd' ? { input: 'dvdnav://', args: ['--dvd-device=' + dev] } : { input: 'bd://', args: ['--bluray-device=' + dev] };
}

module.exports = { isDiscImageExt, detectDiscFolder, detectDiscImage, discPlay };
