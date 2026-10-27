'use strict';
/** electron-builder "afterPack" hook: refuses to finish a build whose package is missing files the app needs.
 *  (Better to fail here than to ship an installer that crashes on first start.) */
const fs = require('fs');
const path = require('path');

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out); else out.add(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

module.exports = async function afterPack(context) {
  let required;
  try { required = JSON.parse(fs.readFileSync(path.join(__dirname, 'required-files.json'), 'utf8')).files; }
  catch { console.warn('[zephyr] editions/required-files.json not found: run "node editions/fix-build-files.js" once. Skipping the completeness check.'); return; }
  const res = path.join(context.appOutDir, 'resources');
  const asar = path.join(res, 'app.asar');
  let listing = null;
  if (fs.existsSync(asar)) {
    let A = null;
    try { A = require('@electron/asar'); } catch { try { A = require('asar'); } catch { A = null; } }
    if (A) { try { if (A.uncache) A.uncache(asar); if (A.uncacheAll) A.uncacheAll(); } catch { /* old versions have no cache */ } }   // always read the archive as it is NOW
    if (A) listing = new Set(A.listPackage(asar).map((p) => String(p).replace(/\\/g, '/').replace(/^\//, '')));
  } else if (fs.existsSync(path.join(res, 'app'))) listing = walk(path.join(res, 'app'), path.join(res, 'app'), new Set());
  if (!listing) { console.warn('[zephyr] could not inspect the finished package (add @electron/asar to devDependencies to enable the check).'); return; }
  const missing = required.filter((f) => {
  if (listing.has(f)) return false;

  // These files are deliberately copied beside the executable by extraFiles.
  if (
    ['README.md', 'setup-tools.ps1'].includes(f) &&
    fs.existsSync(path.join(context.appOutDir, f))
  ) {
    return false;
  }

  return true;
});
  if (missing.length) {
    throw new Error('The package is MISSING ' + missing.length + ' file(s) the app needs:\n  ' + missing.join('\n  ') + '\nRun "node editions/fix-build-files.js" and build again. (Build stopped so a broken installer is not produced.)');
  }
  console.log('[zephyr] package check passed: all ' + required.length + ' required files are inside.');
};
