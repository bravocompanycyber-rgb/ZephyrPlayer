'use strict';
// node tests/run-all.js   (or: npm test, see package.json snippet in README)
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['settings.test.js', 'media.test.js', 'sub.test.js', 'name.test.js', 'online.test.js', 'tools.test.js', 'probe.test.js', 'modules2.test.js', 'editions.test.js', 'osc.test.js', 'session.test.js', 'robust.test.js', 'dom.test.js'];
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 240000 });
  const last = String(r.stdout || '').trim().split(/\r?\n/).pop() || '';
  const ok = r.status === 0;
  console.log((ok ? 'PASS ' : 'FAIL ') + f.padEnd(18) + ' ' + last.slice(0, 90));
  if (!ok) { failed++; console.log(String(r.stderr || r.stdout).split(/\r?\n/).slice(-14).join('\n')); }
}
console.log(failed ? failed + ' test file(s) failed' : 'All tests passed');
process.exit(failed ? 1 : 0);
