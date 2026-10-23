'use strict';
/** electron-builder "afterPack" hook: refuses to finish a build whose package is missing files the app needs.
 *  (Better to fail here than to ship an installer that crashes on first start.)
 *  Accepts files that are inside app.asar OR next to the exe (extraFiles). */
const fs = require('fs');
const path = require('path');

function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.add(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

module.exports = async function afterPack(context) {
  let required;
  try {
    required = JSON.parse(fs.readFileSync(path.join(__dirname, 'required-files.json'), 'utf8')).files;
  } catch {
    console.warn('[zephyr] editions/required-files.json not found: run "node editions/fix-build-files.js" once. Skipping the completeness check.');
    return;
  }

  const appOutDir = context.appOutDir;                 // e.g. dist/modern/win-unpacked
  const res = path.join(appOutDir, 'resources');
  const asar = path.join(res, 'app.asar');
  const listing = new Set();

  // 1) files inside asar
  if (fs.existsSync(asar)) {
    let A = null;
    try { A = require('@electron/asar'); } catch { try { A = require('asar'); } catch { A = null; } }
    if (A) {
      try { if (A.uncache) A.uncache(asar); if (A.uncacheAll) A.uncacheAll(); } catch { /* old versions */ }
      A.listPackage(asar).forEach((p) => listing.add(String(p).replace(/\\/g, '/').replace(/^\//, '')));
    }
  } else if (fs.existsSync(path.join(res, 'app'))) {
    walk(path.join(res, 'app'), path.join(res, 'app'), listing);
  }

  // 2) files next to the exe (extraFiles) — these are also valid
  walk(appOutDir, appOutDir, listing);

  if (listing.size === 0) {
    console.warn('[zephyr] could not inspect the finished package (add @electron/asar to devDependencies to enable the check).');
    return;
  }

  const missing = required.filter((f) => !listing.has(f));
  if (missing.length) {
    throw new Error(
      'The package is MISSING ' + missing.length + ' file(s) the app needs:\n  ' +
      missing.join('\n  ') +
      '\nRun "node editions/fix-build-files.js" and build again. (Build stopped so a broken installer is not produced.)'
    );
  }
  console.log('[zephyr] package check passed: all ' + required.length + ' required files are inside (asar + extraFiles).');
};