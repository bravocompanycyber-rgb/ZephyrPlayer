const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const C = require(H.ROOT + '/mpv-compat.js');
(async () => {
  // fake release history: 250 builds newest first; builds with index >= 137 are old enough to run on the "old Windows"
  const mkReleases = (n) => Array.from({ length: n }, (_, i) => ({ tag_name: String(20261001 - i), assets: [{ name: 'mpv-x86_64-' + (20261001 - i) + '-git-abc123.7z', browser_download_url: 'http://x/' + i, size: 5 }, { name: 'mpv-x86_64-v3-' + (20261001 - i) + '-git-abc123.7z', browser_download_url: 'http://x/v3' + i }, { name: 'mpv-dev-x86_64-' + i + '.7z', browser_download_url: 'x' }] }));
  const all = mkReleases(250); const fetchImpl = async (url) => { const pg = +/[?&]page=(\d+)/.exec(url)[1]; return { ok: true, json: async () => all.slice((pg - 1) * 100, pg * 100) }; };
  const cands = await C.listCandidates({ fetchImpl }); assert.strictEqual(cands.length, 250); assert(cands.every((c) => /^mpv-x86_64-\d{8}-git/.test(c.name)), 'only the plain x64 build (not v3 / dev)'); assert.strictEqual(cands[0].tag, '20261001');
  assert.strictEqual((await C.listCandidates({ fetchImpl: async () => ({ ok: false }) })).length, 0); assert.strictEqual((await C.listCandidates({ fetchImpl, arch: 'ia32' })).length, 0, 'no i686 assets in this fake list');
  // binary search: finds EXACTLY the newest compatible build with few probes
  for (const firstOk of [0, 1, 2, 60, 137, 248, 249]) {
    const calls = []; const r = await C.searchCompatible(cands, async (c, i) => { calls.push(i); return i >= firstOk; });
    assert(r.found && r.index === firstOk, 'firstOk=' + firstOk + ' got ' + (r.found && r.index)); assert(calls.length <= 12, 'probes: ' + calls.length + ' for firstOk=' + firstOk);
  }
  let r = await C.searchCompatible(cands, async () => false); assert.strictEqual(r.found, null, 'nothing runs here'); assert.strictEqual(r.tried.length, 2, 'gives up after testing newest and oldest'); assert.strictEqual((await C.searchCompatible([], async () => true)).found, null);
  r = await C.searchCompatible(cands.slice(0, 1), async () => false); assert.strictEqual(r.found, null);
  // streaming download: progress, redirect, big-ish body, errors
  const body = Buffer.alloc(3e6, 7); const srv = http.createServer((q, s) => { if (q.url === '/r') { s.statusCode = 302; s.setHeader('location', '/f'); s.end(); } else if (q.url === '/f') { s.setHeader('content-length', body.length); s.end(body); } else { s.statusCode = 404; s.end(); } });
  await new Promise((r2) => srv.listen(0, '127.0.0.1', r2)); const base = 'http://127.0.0.1:' + srv.address().port; const dest = path.join(os.tmpdir(), 'zdl.bin'); const pct = [];
  const d = await C.downloadFile(base + '/r', dest, { onProgress: (p) => pct.push(p) }); assert.strictEqual(d.size, 3e6); assert.strictEqual(fs.statSync(dest).size, 3e6); assert(pct.length && pct[pct.length - 1] === 100 && pct.every((x, i) => i === 0 || x >= pct[i - 1]), 'progress rises to 100');
  await assert.rejects(() => C.downloadFile(base + '/missing', dest), /HTTP 404/); const ac = new AbortController(); ac.abort(); await assert.rejects(() => C.downloadFile(base + '/f', dest, { signal: ac.signal }), /cancel/); srv.close();
  // a program that cannot start is reported as such (exit code is what matters)
  const ok1 = await C.runsHere('x', async () => ({ code: 0, out: 'mpv 0.40' })); const bad = await C.runsHere('x', async () => ({ code: 3221225785, out: '' })); assert(ok1.ok && !bad.ok && bad.code === 3221225785);
  // the whole install flow with injected I/O: finds the right build, copies files, pins it
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-')); const steps = [];
  const deps = { download: async (url, dest2) => { fs.writeFileSync(dest2, 'x'); }, extract: async (arc, out) => { const m = /a(\d+)\.7z$/.exec(arc)[1]; fs.mkdirSync(path.join(out, 'sub'), { recursive: true }); fs.writeFileSync(path.join(out, 'sub', 'mpv.exe'), 'BUILD' + m); fs.writeFileSync(path.join(out, 'sub', 'mpv.com'), 'COM' + m); }, runs: async (exe) => ({ ok: +/BUILD(\d+)/.exec(fs.readFileSync(exe, 'utf8'))[1] >= 100 }) };
  const res = await C.installCompatible({ toolsDir: tools, fetchImpl, onProgress: (m) => steps.push(m), deps });
  assert(res.ok && res.tag === String(20261001 - 100), JSON.stringify(res)); assert.strictEqual(fs.readFileSync(path.join(tools, 'mpv.exe'), 'utf8'), 'BUILD100', 'the newest working build was installed'); assert.strictEqual(fs.readFileSync(path.join(tools, 'mpv.com'), 'utf8'), 'COM100');
  assert.strictEqual(C.readPinned(tools).tag, String(20261001 - 100), 'pinned, so a later "update" never swaps in a build that cannot run'); assert(steps.some((s) => /Works: /.test(s)) && steps.some((s) => /Does not run here/.test(s)), 'progress messages'); assert(!fs.readdirSync(tools).some((f) => f.startsWith('_probe-')), 'temporary downloads cleaned up');
  const none = await C.installCompatible({ toolsDir: tools, fetchImpl, deps: Object.assign({}, deps, { runs: async () => ({ ok: false }) }) }); assert(!none.ok && /No mpv build/.test(none.error)); const off = await C.installCompatible({ toolsDir: tools, fetchImpl: async () => ({ ok: false }), deps }); assert(!off.ok && /offline/.test(off.error));
  console.log('mpv-compat OK: finds the newest mpv that runs on this PC in', 'log(n) probes, pins it, cleans up');
})().catch((e) => { console.error(e); process.exit(1); });
