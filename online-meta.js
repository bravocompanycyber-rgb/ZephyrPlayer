'use strict';
/**
 * Optional online posters + info. Free, keyless sources only:
 *   TV      -> TVmaze            (api.tvmaze.com)
 *   Movies  -> Apple iTunes      (itunes.apple.com)  then Wikipedia
 *   Music   -> Apple iTunes      then Deezer (api.deezer.com)
 *   YouTube -> i.ytimg.com thumbnails (no request needed for the lookup itself)
 * Only a cleaned title (never a path) is sent. Results (and misses) are cached on disk.
 * Every method resolves; failures return { ok:false }.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const https = require('https');
const http = require('http');
const { URL } = require('url');

/** Minimal fetch() built on Node's https. Used when neither Electron's net.fetch nor a global fetch exists
 *  (Electron 22 / Node 16 = the Windows 7 / 8 / 8.1 edition). Follows redirects, honours AbortSignal, never throws synchronously. */
function nodeFetch(url, opts = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'http:' ? http : https;
    const signal = opts.signal;
    if (signal && signal.aborted) { reject(new Error('aborted')); return; }
    const req = lib.request(u, { method: 'GET', headers: opts.headers || {}, timeout: 20000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && hops < 5) {
        res.resume();
        nodeFetch(new URL(res.headers.location, u).toString(), opts, hops + 1).then(resolve, reject);
        return;
      }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 12 * 1024 * 1024) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('error', reject);
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: code >= 200 && code < 300, status: code,
          headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return Array.isArray(v) ? v[0] : (v || null); } },
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          json: async () => JSON.parse(buf.toString('utf8')),
          text: async () => buf.toString('utf8')
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end();
  });
}

const UA = 'ZephyrPlayer/3 (desktop media player; local metadata lookup)';
const POS_TTL = 30 * 86400000;
const NEG_TTL = 3 * 86400000;

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
  const A = norm(a).split(' ').filter(Boolean), B = norm(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  const setB = new Set(B);
  const inter = A.filter((t) => setB.has(t)).length;
  const jaccard = inter / (new Set([...A, ...B]).size);
  const containment = inter / Math.min(A.length, B.length);
  return Math.max(jaccard, containment * 0.85);
}
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function yearOf(d) { const m = /^(\d{4})/.exec(String(d || '')); return m ? parseInt(m[1], 10) : null; }
function bigArt(u, size) { return u ? String(u).replace(/\/\d+x\d+(bb|-\d+)?\.(jpg|png)/i, '/' + size + 'x' + size + 'bb.$2') : null; }

function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(String(url || ''));
  return m ? m[1] : null;
}

/** Dominant "vibrant" colour of an RGBA/BGRA bitmap -> '#rrggbb' (used for the poster-driven accent). */
function accentFromBitmap(buf, bgra) {
  let best = null, bestScore = -1;
  const bins = new Map();
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const b = bgra ? buf[i] : buf[i + 2], g = buf[i + 1], r = bgra ? buf[i + 2] : buf[i], a = buf[i + 3];
    if (a < 200) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 510, sat = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
    if (l < 0.18 || l > 0.9) continue;                      // skip near-black / near-white
    const key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
    const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; e.sat += sat; bins.set(key, e);
  }
  for (const e of bins.values()) {
    const s = e.sat / e.n;
    const score = e.n * (0.25 + s * s * 2);                 // favour populous AND saturated bins
    if (score > bestScore) { bestScore = score; best = e; }
  }
  if (!best) return null;
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v / best.n))).toString(16).padStart(2, '0');
  return '#' + hex(best.r) + hex(best.g) + hex(best.b);
}

class OnlineMeta {
  constructor({ fetchImpl, cacheFile, posterDir, log, spacingMs = 350 } = {}) {
    this.fetch = fetchImpl || (typeof fetch === 'function' ? fetch : nodeFetch);
    this.cacheFile = cacheFile || null;
    this.posterDir = posterDir || null;
    this.log = typeof log === 'function' ? log : () => {};
    this.spacingMs = spacingMs;
    this.cache = new Map();
    this._chain = Promise.resolve();
    this._last = 0;
    this._saveTimer = null;
    try { if (this.cacheFile) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')))) this.cache.set(k, v); } catch {}
  }

  _save() {
    if (!this.cacheFile || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        let e = Array.from(this.cache.entries());
        if (e.length > 3000) e = e.slice(-2500);
        fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(e)));
      } catch {}
    }, 1200);
  }

  /** Serialised + spaced requests: stays far below every provider's rate limit. */
  _get(url, { json = true, bytes = false, timeoutMs = 9000 } = {}) {
    const run = async () => {
      const wait = this._last + this.spacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._last = Date.now();
      if (!this.fetch) return null;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await this.fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' }, redirect: 'follow' });
        if (!res || !res.ok) return null;
        if (bytes) return { type: String((res.headers && res.headers.get && res.headers.get('content-type')) || ''), buf: Buffer.from(await res.arrayBuffer()) };
        return json ? await res.json() : await res.text();
      } catch (e) { this.log('online fetch failed:', String(url).slice(0, 80), e && e.message); return null; }
      finally { clearTimeout(t); }
    };
    const p = this._chain.then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  async lookup(q) {
    try {
      q = q || {};
      const key = JSON.stringify([q.kind, norm(q.title), norm(q.artist), q.year || '', q.season || '', q.episode || '', q.url ? youtubeId(q.url) : '']);
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < (hit.result.ok ? POS_TTL : NEG_TTL)) return hit.result;
      let result = await this._lookup(q);
      if (!result) result = { ok: false, error: 'No confident match' };
      this.cache.set(key, { at: Date.now(), result });
      this._save();
      return result;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async _lookup(q) {
    const yt = q.url ? youtubeId(q.url) : null;
    if (yt) {
      return { ok: true, kind: 'video', source: 'YouTube', title: q.title || '',
        posters: ['https://i.ytimg.com/vi/' + yt + '/maxresdefault.jpg', 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg'] };
    }
    if (!q.title) return null;
    if (q.kind === 'tv') return (await this._tvmaze(q)) || (await this._wikipedia(q, ' TV series'));
    if (q.kind === 'music') return (await this._itunesMusic(q)) || (await this._deezer(q));
    return (await this._itunesMovie(q)) || (await this._wikipedia(q, ' film'));
  }

  async _tvmaze(q) {
    const list = await this._get('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q.title));
    if (!Array.isArray(list) || !list.length) return null;
    let best = null, bs = 0;
    list.forEach((r, i) => {
      if (!r || !r.show) return;
      let s = similarity(q.title, r.show.name) - i * 0.01;
      if (q.year && yearOf(r.show.premiered) && Math.abs(q.year - yearOf(r.show.premiered)) > 1) s -= 0.15;
      if (s > bs) { bs = s; best = r.show; }
    });
    if (!best || bs < 0.6) return null;
    const out = {
      ok: true, kind: 'tv', source: 'TVmaze', title: best.name, year: yearOf(best.premiered),
      genre: (best.genres || []).slice(0, 3).join(', '), rating: best.rating && best.rating.average ? best.rating.average : null,
      network: (best.network && best.network.name) || (best.webChannel && best.webChannel.name) || '',
      status: best.status || '', overview: stripHtml(best.summary),
      posters: [best.image && (best.image.original || best.image.medium)].filter(Boolean), url: best.url || ''
    };
    if (q.season && q.episode) {
      const ep = await this._get('https://api.tvmaze.com/shows/' + best.id + '/episodebynumber?season=' + q.season + '&number=' + q.episode);
      if (ep && ep.name) {
        out.episode = { season: ep.season, number: ep.number, title: ep.name, airdate: ep.airdate || '', runtime: ep.runtime || 0, overview: stripHtml(ep.summary), rating: ep.rating && ep.rating.average || null };
        if (ep.image && (ep.image.original || ep.image.medium)) out.stills = [ep.image.original || ep.image.medium];
        if (out.episode.overview) out.overview = out.episode.overview;
      }
    }
    return out;
  }

  async _itunesMovie(q) {
    const term = q.title + (q.year ? ' ' + q.year : '');
    const j = await this._get('https://itunes.apple.com/search?media=movie&entity=movie&limit=8&country=US&term=' + encodeURIComponent(term));
    const rs = j && Array.isArray(j.results) ? j.results : [];
    let best = null, bs = 0;
    for (const r of rs) {
      let s = similarity(q.title, r.trackName);
      const y = yearOf(r.releaseDate);
      if (q.year && y) s += Math.abs(q.year - y) <= 1 ? 0.08 : -0.3;
      if (s > bs) { bs = s; best = r; }
    }
    if (!best || bs < 0.6) return null;
    return {
      ok: true, kind: 'movie', source: 'Apple iTunes', title: best.trackName, year: yearOf(best.releaseDate),
      genre: best.primaryGenreName || '', rating: best.contentAdvisoryRating || null, director: best.artistName || '',
      runtime: best.trackTimeMillis ? Math.round(best.trackTimeMillis / 60000) : 0,
      overview: stripHtml(best.longDescription || best.shortDescription), posters: [bigArt(best.artworkUrl100, 600)].filter(Boolean), url: best.trackViewUrl || ''
    };
  }

  async _itunesMusic(q) {
    const term = ((q.artist ? q.artist + ' ' : '') + q.title).trim();
    const j = await this._get('https://itunes.apple.com/search?media=music&entity=song&limit=8&term=' + encodeURIComponent(term));
    const rs = j && Array.isArray(j.results) ? j.results : [];
    let best = null, bs = 0;
    for (const r of rs) {
      let s = similarity(q.title, r.trackName) * 0.7 + (q.artist ? similarity(q.artist, r.artistName) * 0.3 : 0.3 * similarity(q.title, r.trackName));
      if (s > bs) { bs = s; best = r; }
    }
    if (!best || bs < 0.62) return null;
    return {
      ok: true, kind: 'music', source: 'Apple iTunes', title: best.trackName, artist: best.artistName, album: best.collectionName || '',
      year: yearOf(best.releaseDate), genre: best.primaryGenreName || '', posters: [bigArt(best.artworkUrl100, 600)].filter(Boolean), url: best.trackViewUrl || ''
    };
  }

  async _deezer(q) {
    const query = q.artist ? 'artist:"' + q.artist + '" track:"' + q.title + '"' : q.title;
    const j = await this._get('https://api.deezer.com/search?limit=6&q=' + encodeURIComponent(query));
    const rs = j && Array.isArray(j.data) ? j.data : [];
    let best = null, bs = 0;
    for (const r of rs) {
      const s = similarity(q.title, r.title) * 0.7 + (q.artist ? similarity(q.artist, r.artist && r.artist.name) * 0.3 : 0.3);
      if (s > bs) { bs = s; best = r; }
    }
    if (!best || bs < 0.62) return null;
    const al = best.album || {};
    return {
      ok: true, kind: 'music', source: 'Deezer', title: best.title, artist: best.artist && best.artist.name || '', album: al.title || '',
      posters: [al.cover_xl, al.cover_big, al.cover_medium].filter(Boolean)
    };
  }

  async _wikipedia(q, suffix) {
    const term = q.title + (q.year ? ' ' + q.year : '') + suffix;
    const j = await this._get('https://en.wikipedia.org/w/rest.php/v1/search/page?limit=4&q=' + encodeURIComponent(term));
    const pages = j && Array.isArray(j.pages) ? j.pages : [];
    let best = null, bs = 0;
    for (const p of pages) {
      const clean = String(p.title || '').replace(/\s*\((?:\d{4}\s+)?(?:film|TV series|miniseries|television series|American TV series)[^)]*\)\s*$/i, '');
      const s = similarity(q.title, clean);
      if (s > bs) { bs = s; best = p; }
    }
    if (!best || bs < 0.7) return null;
    const sum = await this._get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(String(best.key || best.title).replace(/ /g, '_')));
    const img = sum && ((sum.originalimage && sum.originalimage.source) || (sum.thumbnail && sum.thumbnail.source));
    if (!sum || (!img && !sum.extract)) return null;
    return {
      ok: true, kind: q.kind === 'tv' ? 'tv' : 'movie', source: 'Wikipedia', title: sum.title || best.title, year: q.year || null,
      genre: sum.description || '', overview: stripHtml(sum.extract), posters: img ? [img] : [], url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || ''
    };
  }

  /** Downloads the first reachable candidate to the poster cache. Resolves to a local file path or null. */
  async poster(urls) {
    if (!this.posterDir) return null;
    for (const u of (Array.isArray(urls) ? urls : [urls]).filter((x) => /^https:\/\//i.test(String(x || '')))) {
      const id = crypto.createHash('sha1').update(u).digest('hex').slice(0, 24);
      for (const ext of ['jpg', 'png', 'webp']) {
        const f = path.join(this.posterDir, id + '.' + ext);
        try { if (fs.statSync(f).size > 1500) return f; } catch {}
      }
      const r = await this._get(u, { json: false, bytes: true, timeoutMs: 15000 });
      if (!r || !r.buf || r.buf.length < 1500 || r.buf.length > 6 * 1024 * 1024) continue;
      const type = r.type.toLowerCase();
      if (!/^image\//.test(type)) continue;
      const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
      // YouTube serves a 120x90 grey placeholder (a few KB) for videos without maxres: reject tiny YT images
      if (/ytimg\.com/.test(u) && r.buf.length < 4000) continue;
      try {
        fs.mkdirSync(this.posterDir, { recursive: true });
        const f = path.join(this.posterDir, id + '.' + ext);
        fs.writeFileSync(f, r.buf);
        return f;
      } catch (e) { this.log('poster save failed:', e.message); }
    }
    return null;
  }
}

module.exports = { OnlineMeta, nodeFetch, similarity, norm, youtubeId, accentFromBitmap, stripHtml };
