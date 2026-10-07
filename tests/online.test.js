const H = require('./helpers');
const { OnlineMeta, similarity, youtubeId, accentFromBitmap } = require(H.ROOT + '/online-meta.js'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
// Fixtures follow each provider's documented response shape (the sandbox cannot reach these hosts).
const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(5000, 7)]);
const routes = [
  [/api\.tvmaze\.com\/search\/shows/, (u) => /mandalorian/i.test(u) ? [{ score: 1, show: { id: 38963, name: 'The Mandalorian', premiered: '2019-11-12', genres: ['Action', 'Adventure'], rating: { average: 8.4 }, network: null, webChannel: { name: 'Disney+' }, status: 'Running', summary: '<p>After the fall of the <b>Empire</b>…</p>', image: { medium: 'https://static.tvmaze.com/m.jpg', original: 'https://static.tvmaze.com/o.jpg' }, url: 'https://www.tvmaze.com/shows/38963' } }, { score: .5, show: { id: 1, name: 'Mandalorian Cooking', premiered: '2021-01-01' } }] : []],
  [/api\.tvmaze\.com\/shows\/38963\/episodebynumber\?season=2&number=3/, () => ({ season: 2, number: 3, name: 'Chapter 11: The Heiress', airdate: '2020-11-06', runtime: 40, rating: { average: 8.9 }, summary: '<p>Mando seeks out other Mandalorians.</p>', image: { medium: 'https://static.tvmaze.com/ep.jpg' } })],
  [/itunes\.apple\.com\/search\?media=movie/, () => ({ resultCount: 2, results: [{ trackName: 'Inception', artistName: 'Christopher Nolan', releaseDate: '2010-07-16T07:00:00Z', primaryGenreName: 'Sci-Fi & Fantasy', contentAdvisoryRating: 'PG-13', trackTimeMillis: 8880000, longDescription: 'A thief who steals secrets through dreams.', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Video/abc/source/100x100bb.jpg', trackViewUrl: 'https://itunes.apple.com/x' }, { trackName: 'Inception: The Cobol Job', releaseDate: '2010-12-07T08:00:00Z' }] })],
  [/itunes\.apple\.com\/search\?media=music/, (u) => /hello/i.test(u) ? { results: [{ trackName: 'Hello', artistName: 'Adele', collectionName: '25', releaseDate: '2015-11-20T08:00:00Z', primaryGenreName: 'Pop', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg' }] } : { results: [] }],
  [/api\.deezer\.com\/search/, () => ({ data: [{ title: 'Obscure Song', artist: { name: 'Indie Band' }, album: { title: 'Debut', cover_xl: 'https://cdn.deezer/xl.jpg', cover_big: 'https://cdn.deezer/b.jpg' } }] })],
  [/en\.wikipedia\.org\/w\/rest\.php\/v1\/search\/page/, () => ({ pages: [{ id: 1, key: 'Tenet_(film)', title: 'Tenet (film)', description: '2020 film' }] })],
  [/en\.wikipedia\.org\/api\/rest_v1\/page\/summary/, () => ({ title: 'Tenet', description: '2020 film by Christopher Nolan', extract: 'Tenet is a 2020 spy film.', originalimage: { source: 'https://upload.wikimedia.org/tenet.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tenet_(film)' } } })],
];
const seen = [];
const fakeFetch = async (url) => {
  seen.push(url);
  if (/\.(jpg|png)$/.test(url) && /static\.tvmaze|mzstatic|upload\.wikimedia|cdn\.deezer|ytimg/.test(url)) {
    if (/maxresdefault/.test(url)) return { ok: false };                       // YouTube without maxres -> falls back to hqdefault
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg };
  }
  for (const [re, fn] of routes) if (re.test(url)) return { ok: true, json: async () => fn(url) };
  return { ok: false };
};
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zo-'));
  const om = new OnlineMeta({ fetchImpl: fakeFetch, cacheFile: path.join(dir, 'c.json'), posterDir: path.join(dir, 'p'), spacingMs: 1 });
  // TV with episode
  let r = await om.lookup({ kind: 'tv', title: 'The Mandalorian', season: 2, episode: 3 });
  assert(r.ok && r.title === 'The Mandalorian' && r.year === 2019 && r.episode.title === 'Chapter 11: The Heiress' && /Mandalorians/.test(r.overview) && r.network === 'Disney+' && r.rating === 8.4 && r.stills.length === 1, JSON.stringify(r));
  assert(!/<p>/.test(r.overview), 'html stripped');
  // Movie (iTunes), exact title beats "Inception: The Cobol Job"
  r = await om.lookup({ kind: 'movie', title: 'Inception', year: 2010 });
  assert(r.ok && r.title === 'Inception' && r.director === 'Christopher Nolan' && r.runtime === 148 && /600x600bb/.test(r.posters[0]) && r.genre === 'Sci-Fi & Fantasy', JSON.stringify(r));
  // Movie fallback to Wikipedia
  r = await om.lookup({ kind: 'movie', title: 'Tenet', year: 2020 }); assert(r.ok && r.source === 'Wikipedia' && r.posters[0].includes('tenet.jpg'), JSON.stringify(r));
  // Music iTunes, then Deezer fallback
  r = await om.lookup({ kind: 'music', title: 'Hello', artist: 'Adele' }); assert(r.ok && r.album === '25' && /600x600bb/.test(r.posters[0]));
  r = await om.lookup({ kind: 'music', title: 'Obscure Song', artist: 'Indie Band' }); assert(r.ok && r.source === 'Deezer' && r.posters[0].includes('xl.jpg'));
  // low-confidence match is rejected, never a wrong poster
  r = await om.lookup({ kind: 'movie', title: 'Completely Unrelated Home Video' }); assert.strictEqual(r.ok, false);
  r = await om.lookup({ kind: 'tv', title: 'zzzz nothing' }); assert.strictEqual(r.ok, false);
  // YouTube: no API call needed; poster falls back maxres -> hq
  seen.length = 0; r = await om.lookup({ kind: 'video', title: 'Cool video', url: 'https://www.youtube.com/watch?v=GnTkwOKa2Pg&t=447s' });
  assert(r.ok && r.source === 'YouTube' && seen.length === 0 && /GnTkwOKa2Pg/.test(r.posters[0]));
  const p = await om.poster(r.posters); assert(p && fs.existsSync(p) && /\.jpg$/.test(p), 'poster downloaded via fallback'); assert(seen.some(u => /maxres/.test(u)) && seen.some(u => /hqdefault/.test(u)));
  assert.strictEqual(await om.poster(['http://insecure.example/x.jpg']), null, 'http (non-https) refused');
  // cache: repeating a lookup makes no new network calls (hits AND misses)
  seen.length = 0; await om.lookup({ kind: 'movie', title: 'Inception', year: 2010 }); await om.lookup({ kind: 'movie', title: 'Completely Unrelated Home Video' }); assert.strictEqual(seen.length, 0, 'served from cache');
  await new Promise(r => setTimeout(r, 1500)); const om2 = new OnlineMeta({ cacheFile: path.join(dir, 'c.json'), fetchImpl: async () => { throw new Error('offline'); } });
  assert((await om2.lookup({ kind: 'movie', title: 'Inception', year: 2010 })).ok, 'cache persists across restarts and works offline');
  // offline / failing network never throws
  const off = new OnlineMeta({ fetchImpl: async () => { throw new Error('ENOTFOUND'); }, spacingMs: 1 }); assert.strictEqual((await off.lookup({ kind: 'movie', title: 'Anything' })).ok, false);
  // helpers
  assert(similarity('The Mandalorian', 'Mandalorian') > 0.8 && similarity('Inception', 'Interstellar') < 0.3); assert.strictEqual(youtubeId('https://youtu.be/GnTkwOKa2Pg'), 'GnTkwOKa2Pg'); assert.strictEqual(youtubeId('https://example.com/v=1'), null);
  // accent colour: mostly-red poster with black borders -> red-ish vibrant accent
  const px = Buffer.alloc(24 * 24 * 4); for (let i = 0; i < 24 * 24; i++) { const edge = i % 24 < 3 || i % 24 > 20; const o = i * 4; if (edge) { px[o] = 5; px[o + 1] = 5; px[o + 2] = 5; } else { px[o] = 30; px[o + 1] = 40; px[o + 2] = 220; } px[o + 3] = 255; } // BGRA: strong red
  const hex = accentFromBitmap(px, true); console.log('accent', hex); assert(parseInt(hex.slice(1, 3), 16) > 180 && parseInt(hex.slice(5, 7), 16) < 90);
  console.log('online-meta OK');
})().catch(e => { console.error(e); process.exit(1); });

// ---- nodeFetch fallback (Electron 22 / Node 16 has no fetch): real local server, redirects, size cap, abort, errors
(async () => {
  const http = require('http'); const { nodeFetch } = require(H.ROOT + '/online-meta.js'); const assert = require('assert');
  const srv = http.createServer((req, res) => {
    if (req.url === '/json') { res.setHeader('content-type', 'application/json'); res.end('{"a":1}'); }
    else if (req.url === '/redir') { res.statusCode = 302; res.setHeader('location', '/json'); res.end(); }
    else if (req.url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); res.end(); }
    else if (req.url === '/img') { res.setHeader('content-type', 'image/jpeg'); res.end(Buffer.alloc(3000, 1)); }
    else if (req.url === '/slow') { setTimeout(() => res.end('late'), 3000); }
    else { res.statusCode = 404; res.end('no'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let r = await nodeFetch(base + '/json'); assert(r.ok && (await r.json()).a === 1 && r.headers.get('Content-Type') === 'application/json');
  r = await nodeFetch(base + '/redir'); assert(r.ok && (await r.json()).a === 1, 'follows redirects');
  r = await nodeFetch(base + '/img'); assert(r.headers.get('content-type') === 'image/jpeg' && Buffer.from(await r.arrayBuffer()).length === 3000);
  assert.strictEqual((await nodeFetch(base + '/missing')).ok, false);
  assert.strictEqual((await nodeFetch(base + '/loop')).ok, false, 'redirect loops end after 5 hops instead of spinning');
  const ctl = new AbortController(); const p = nodeFetch(base + '/slow', { signal: ctl.signal }); setTimeout(() => ctl.abort(), 150); await assert.rejects(p, /abort/);
  await assert.rejects(() => nodeFetch('not a url'), undefined); await assert.rejects(() => nodeFetch('http://127.0.0.1:1/x'));
  // and OnlineMeta uses it by itself when no fetch is injected and none is global
  const saved = global.fetch; delete global.fetch; const { OnlineMeta } = require(H.ROOT + '/online-meta.js'); const om = new OnlineMeta({ spacingMs: 1 }); global.fetch = saved;
  assert.strictEqual(typeof om.fetch, 'function'); const got = await om._get(base + '/json'); assert.strictEqual(got.a, 1);
  srv.close(); console.log('nodeFetch fallback OK');
})().catch((e) => { console.error(e); process.exit(1); });
