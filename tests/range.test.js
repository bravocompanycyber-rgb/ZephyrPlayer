const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const R = require(H.ROOT + '/media-range.js');
const read = async (s) => { const c = []; if (!s) return Buffer.alloc(0); for await (const x of s) c.push(x); return Buffer.concat(c); };
(async () => {
  assert.deepStrictEqual(R.parseRange('bytes=0-99', 1000), { start: 0, end: 99 }); assert.deepStrictEqual(R.parseRange('bytes=900-', 1000), { start: 900, end: 999 }); assert.deepStrictEqual(R.parseRange('bytes=-100', 1000), { start: 900, end: 999 }); assert.deepStrictEqual(R.parseRange('bytes=5-99999', 1000), { start: 5, end: 999 });
  for (const bad of ['bytes=2000-', 'bytes=5-2', 'bytes=-', 'items=1-2', 'bytes=-0', 'garbage']) assert.strictEqual(R.parseRange(bad, 1000), 'invalid', bad); assert.strictEqual(R.parseRange(undefined, 10), null);
  const p = path.join(os.tmpdir(), 'zr 中.mp4'); const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)); fs.writeFileSync(p, data);
  const url = R.urlFromPath(p); assert(/^zmedia:\/\/local\//.test(url)); assert.strictEqual(R.pathFromUrl(url), p, 'path survives spaces and non-ASCII'); assert.strictEqual(R.pathFromUrl('file:///etc/passwd'), null); assert.strictEqual(R.pathFromUrl('zmedia://local/relative/path.mp4'), null);
  let r = await R.serveFile(p, null); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers['Content-Length'], '5000'); assert.strictEqual(r.headers['Access-Control-Allow-Origin'], '*'); assert.strictEqual(r.headers['Accept-Ranges'], 'bytes'); assert.strictEqual(r.headers['Content-Type'], 'video/mp4'); assert((await read(r.stream)).equals(data));
  r = await R.serveFile(p, 'bytes=1000-1999'); assert.strictEqual(r.status, 206); assert.strictEqual(r.headers['Content-Range'], 'bytes 1000-1999/5000'); assert.strictEqual(r.headers['Content-Length'], '1000'); assert((await read(r.stream)).equals(data.subarray(1000, 2000)), 'exact bytes for seeking');
  r = await R.serveFile(p, 'bytes=4990-'); assert.strictEqual(r.status, 206); assert.strictEqual((await read(r.stream)).length, 10);
  r = await R.serveFile(p, 'bytes=9000-'); assert.strictEqual(r.status, 416); assert.strictEqual(r.headers['Content-Range'], 'bytes */5000'); assert.strictEqual((await R.serveFile('/nope/x.mp4')).status, 404); assert.strictEqual((await R.serveFile(os.tmpdir())).status, 404, 'directories are never served');
  assert.strictEqual((await R.serveFile(p, null, () => false)).status, 403, 'the allow-list is enforced'); assert.strictEqual((await R.serveFile(null)).status, 403);
  // both Electron API generations
  if (typeof Headers === 'undefined' || typeof Response === 'undefined') console.log('(Node without fetch globals: the protocol.handle branch is skipped; Electron 22 uses registerStreamProtocol)');
  else { let used = null; const fakeNew = { handle: (s, h) => { used = ['handle', s, h]; } }; assert.strictEqual(R.registerMediaProtocol(fakeNew, () => true), 'handle'); const resp = await used[2]({ url, headers: new Headers({ range: 'bytes=0-9' }) });
  assert.strictEqual(resp.status, 206); assert.strictEqual(resp.headers.get('content-range'), 'bytes 0-9/5000'); assert.strictEqual(resp.headers.get('access-control-allow-origin'), '*'); assert.strictEqual(Buffer.from(await resp.arrayBuffer()).length, 10);
  }
  let cb = null; const fakeOld = { registerStreamProtocol: (s, h) => { cb = h; } }; assert.strictEqual(R.registerMediaProtocol(fakeOld, () => true), 'registerStreamProtocol'); const out = await new Promise((res) => cb({ url, headers: { Range: 'bytes=10-19' } }, res));
  assert.strictEqual(out.statusCode, 206); assert.strictEqual(out.headers['Content-Range'], 'bytes 10-19/5000'); assert((await read(out.data)).equals(data.subarray(10, 20)));
  fs.unlinkSync(p); console.log('media-range OK (Range, 416/404/403, both Electron APIs)');
})().catch((e) => { console.error(e); process.exit(1); });
