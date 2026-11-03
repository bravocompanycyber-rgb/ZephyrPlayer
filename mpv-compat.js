'use strict';
/**
 * Finds an mpv build that actually RUNS on this PC.
 *
 * Why: newer Windows-10-only mpv builds exit at once with 0xC0000139 ("entry point not found") on Windows 7 / 8 / 8.1. Settings cannot fix that:
 * the program itself cannot start. So we test real builds on THIS machine: download one, run it, and binary-search the release history
 * (newest first) for the newest build that starts. Everything comes from the official build page (github.com/shinchiro/mpv-winbuild-cmake).
 * All the I/O is injectable, so the search logic is tested without a network.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const REPO = 'shinchiro/mpv-winbuild-cmake';
const ARCH_RE = { x64: /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$/, ia32: /^mpv-i686-\d{8}-git-[0-9a-f]+\.7z$/ };
const KEEP_FILES = ['mpv.exe', 'mpv.com', 'd3dcompiler_43.dll', 'vulkan-1.dll', 'libmpv-2.dll'];

/** Release assets for this CPU, newest first. */
async function listCandidates({ fetchImpl, arch = 'x64', maxPages = 12 }) {
  const out = [];
  const re = ARCH_RE[arch] || ARCH_RE.x64;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchImpl('https://api.github.com/repos/' + REPO + '/releases?per_page=100&page=' + page, { headers: { 'User-Agent': 'ZephyrPlayer-compat', Accept: 'application/vnd.github+json' } });
    if (!r || !r.ok) break;
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) break;
    for (const rel of list) {
      const a = (rel.assets || []).find((x) => re.test(x.name));
      if (a) out.push({ tag: rel.tag_name, name: a.name, url: a.browser_download_url, size: a.size || 0 });
    }
    if (list.length < 100) break;
  }
  return out;
}

/** Binary search for the NEWEST candidate that passes probe(). Assumes "older = more compatible" (true once a build starts needing newer Windows). */
async function searchCompatible(cands, probe, opts = {}) {
  const max = opts.maxProbes || 12;
  const step = opts.onStep || (() => {});
  const tried = [];
  let n = 0;
  const test = async (i) => { n++; const ok = !!(await probe(cands[i], i)); tried.push({ tag: cands[i].tag, ok }); step({ step: n, candidate: cands[i], ok }); return ok; };
  if (!cands.length) return { found: null, tried };
  if (await test(0)) return { found: cands[0], index: 0, tried };            // the newest one already works: done
  let lo = 0, hi = cands.length - 1;
  if (hi === 0) return { found: null, tried };
  if (!(await test(hi))) return { found: null, tried };                       // not even the oldest build starts: no build in this list can run here
  while (hi - lo > 1 && n < max) { const mid = (lo + hi) >> 1; if (await test(mid)) hi = mid; else lo = mid; }
  return { found: cands[hi], index: hi, tried };
}

/** Streaming download with progress and redirects (release assets are large: never buffer them in memory). */
function downloadFile(url, dest, { onProgress, hops = 0, signal } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'http:' ? http : https;
    if (signal && signal.aborted) { reject(new Error('cancelled')); return; }
    const req = lib.get(u, { headers: { 'User-Agent': 'ZephyrPlayer-compat' }, timeout: 30000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && hops < 6) { res.resume(); downloadFile(new URL(res.headers.location, u).toString(), dest, { onProgress, hops: hops + 1, signal }).then(resolve, reject); return; }
      if (code !== 200) { res.resume(); reject(new Error('download failed: HTTP ' + code)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10); let got = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(Math.round(got / total * 100)); });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ size: got })));
      file.on('error', reject); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('download timed out')));
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('cancelled')), { once: true });
  });
}

function runCapture(exe, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child; let out = '';
    try { child = spawn(exe, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
    const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve({ code: -2, out: 'timeout' }); }, timeoutMs);
    child.stdout && child.stdout.on('data', (d) => { out += d; });
    child.stderr && child.stderr.on('data', (d) => { out += d; });
    child.once('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
    child.once('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

/** Does this mpv.exe start on THIS Windows? (Exit code 0 for --version. A missing system function fails before anything else runs.) */
async function runsHere(mpvExe, run = runCapture) {
  const r = await run(mpvExe, ['--version'], 20000);
  return { ok: r.code === 0, code: r.code, out: String(r.out || '').slice(0, 200) };
}

function findFile(dir, name) {
  let hit = null;
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase() === name.toLowerCase() && !hit) hit = p; } })(dir);
  return hit;
}

/**
 * Finds and installs a working mpv into toolsDir. deps (all optional) let tests run without Windows or a network.
 */
async function installCompatible({ toolsDir, arch = 'x64', fetchImpl, onProgress, signal, deps = {} }) {
  const say = (m) => { try { onProgress && onProgress(m); } catch { /* ignore */ } };
  const download = deps.download || downloadFile;
  const extract = deps.extract || (async (archive, out) => {
    const z = path.join(toolsDir, '_7zr.exe');
    if (!fs.existsSync(z)) { say('Fetching the 7-Zip extractor…'); await download('https://www.7-zip.org/a/7zr.exe', z, { signal }); }
    const r = await runCapture(z, ['x', archive, '-o' + out, '-y'], 5 * 60 * 1000);
    if (r.code !== 0) throw new Error('could not unpack the download (7-Zip exit ' + r.code + ')');
  });
  const runs = deps.runs || runsHere;
  fs.mkdirSync(toolsDir, { recursive: true });
  say('Looking at the available mpv builds…');
  const cands = await listCandidates({ fetchImpl, arch });
  if (!cands.length) return { ok: false, error: 'Could not read the list of mpv builds (offline?)' };
  const work = fs.mkdtempSync(path.join(toolsDir, '_probe-'));
  const keep = new Map();                                                       // index -> extracted folder of a build that works
  try {
    const probe = async (c, i) => {
      const arc = path.join(work, 'a' + i + '.7z'); const out = path.join(work, 'x' + i);
      say('Testing mpv ' + c.tag + ' on this PC…');
      await download(c.url, arc, { signal, onProgress: (p) => say('Downloading mpv ' + c.tag + ' … ' + p + '%') });
      await extract(arc, out);
      try { fs.unlinkSync(arc); } catch { /* ignore */ }
      const exe = findFile(out, 'mpv.exe');
      if (!exe) return false;
      const r = await runs(exe);
      if (r.ok) keep.set(i, path.dirname(exe));
      return r.ok;
    };
    const res = await searchCompatible(cands, probe, { maxProbes: 12, onStep: (s) => say((s.ok ? 'Works: ' : 'Does not run here: ') + s.candidate.tag) });
    if (!res.found) return { ok: false, error: 'No mpv build in the release history starts on this PC. Use VLC / PotPlayer for those files.', tried: res.tried };
    const dir = keep.get(res.index);
    for (const f of KEEP_FILES) { const src = path.join(dir, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(toolsDir, f)); }
    fs.writeFileSync(path.join(toolsDir, 'mpv-compat.json'), JSON.stringify({ pinned: true, tag: res.found.tag, name: res.found.name, at: Date.now() }));
    say('Installed mpv ' + res.found.tag + ' (the newest build that runs on this PC).');
    return { ok: true, tag: res.found.tag, tried: res.tried };
  } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }
}

const readPinned = (toolsDir) => { try { const j = JSON.parse(fs.readFileSync(path.join(toolsDir, 'mpv-compat.json'), 'utf8')); return j && j.pinned ? j : null; } catch { return null; } };

module.exports = { listCandidates, searchCompatible, downloadFile, runsHere, installCompatible, readPinned, findFile, KEEP_FILES };
