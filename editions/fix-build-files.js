#!/usr/bin/env node
'use strict';
/**
 * Repairs the installer file list in YOUR package.json / package-legacy.json.
 *
 * Problem it solves: electron-builder only packs the files named in build.files. When new files are added to the app
 * and the list is not updated, the installed app crashes with "Cannot find module './mpv-session'".
 *
 *   node editions/fix-build-files.js            fix package.json (and package-legacy.json if it exists)
 *   node editions/fix-build-files.js --check    only report, change nothing (exit code 1 when something would be missing)
 *   node editions/fix-build-files.js --file other.json
 *
 * It (1) works out which files the app really needs by following every require('./...') from main.js and preload.js
 * and every script/stylesheet in index.html, (2) adds whatever your list is missing (your own entries are kept),
 * (3) switches on a build-time check that FAILS the build if the finished package is missing anything.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '');

function readIf(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function resolveRequire(fromDir, spec, root) {
  const base = path.join(fromDir, spec);
  for (const c of [base, base + '.js', base + '.json', path.join(base, 'index.js')]) {
    try { if (fs.statSync(c).isFile()) return norm(path.relative(root, c)); } catch { /* next */ }
  }
  return null;
}

/** Every file the app needs, found by reading the code (not by guessing). */
function requiredFiles(root) {
  root = root || ROOT;
  const files = new Set();
  const queue = ['main.js', 'preload.js'].filter((f) => fs.existsSync(path.join(root, f)));
  const seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f); files.add(f);
    const src = readIf(path.join(root, f));
    const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) { const r = resolveRequire(path.dirname(path.join(root, f)), m[1], root); if (r) queue.push(r); }
  }
  const html = ['index.html', 'splash.html'].filter((f) => fs.existsSync(path.join(root, f)));
  for (const h of html) {
    files.add(h);
    const src = readIf(path.join(root, h));
    const re = /(?:src|href)\s*=\s*"([^"#?]+)"/g;
    let m;
    while ((m = re.exec(src))) { const u = m[1]; if (/^(https?:|data:|file:|\/\/)/i.test(u)) continue; if (fs.existsSync(path.join(root, u))) files.add(norm(u)); }
  }
  // the icon files the app loads by name, the installer script the in-app tool installer runs, and the docs it opens
  for (const f of ['assets/icons/play.svg', 'assets/icons/zephyrplayer.ico', 'setup-tools.ps1', 'README.md']) if (fs.existsSync(path.join(root, f))) files.add(f);
  return Array.from(files).sort();
}

/* ---- tiny glob matcher with electron-builder style ordering ("!" removes again) ---- */
function globToRegex(g) {
  let s = '', i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { if (g[i + 2] === '/') { s += '(?:.*/)?'; i += 3; } else { s += '.*'; i += 2; } }
      else { s += '[^/]*'; i++; }
    } else if (c === '?') { s += '[^/]'; i++; }
    else if (c === '{') { const j = g.indexOf('}', i); if (j < 0) { s += '\\{'; i++; } else { s += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j + 1; } }
    else { s += c.replace(/[.+^$()|[\]\\]/g, '\\$&'); i++; }
  }
  return new RegExp('^' + s + '$');
}
function isIncluded(patterns, file) {
  const f = norm(file);
  let inc = false;
  for (const raw of patterns) {
    let p = norm(raw);
    const neg = p.startsWith('!');
    if (neg) p = p.slice(1);
    const hit = globToRegex(p).test(f) || globToRegex(p.replace(/\/$/, '') + '/**').test(f);   // "js" or "js/" also means everything inside
    if (hit) inc = !neg;
  }
  return inc;
}

function fixPackage(pkg, req) {
  const out = JSON.parse(JSON.stringify(pkg));
  const notes = [];
  out.build = out.build || {};
  const added = [];
  if (Array.isArray(out.build.files) && out.build.files.length) {
    for (const f of req) {
      if (!isIncluded(out.build.files, f)) { out.build.files.push(f); added.push(f); }
    }
    // a final negation in the user's list could still exclude something we just added: verify
    const still = req.filter((f) => !isIncluded(out.build.files, f));
    if (still.length) notes.push('Still excluded by a pattern in your list: ' + still.join(', '));
  } else {
    notes.push('build.files is not set, so electron-builder packs everything by default (nothing to add).');
  }
  if (!out.build.afterPack) { out.build.afterPack = 'editions/after-pack-check.js'; notes.push('Turned on the build-time completeness check (afterPack).'); }
  else if (out.build.afterPack !== 'editions/after-pack-check.js') notes.push('You already have an afterPack hook (' + out.build.afterPack + '); the completeness check was not added to it.');
  return { pkg: out, added, notes };
}

function main(argv) {
  const check = argv.includes('--check');
  const fileArgs = [];
  for (let i = 2; i < argv.length; i++) if (argv[i] === '--file' && argv[i + 1]) fileArgs.push(argv[++i]);
  const targets = fileArgs.length ? fileArgs : ['package.json', 'package-legacy.json'].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const req = requiredFiles(ROOT);
  let problems = 0;
  for (const t of targets) {
    const file = path.join(ROOT, t);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(t + ': cannot read (' + e.message + ')'); problems++; continue; }
    const r = fixPackage(pkg, req);
    if (r.added.length) problems++;
    console.log('\n' + t + ': ' + (r.added.length ? r.added.length + ' file(s) were missing from build.files' : 'build.files already complete'));
    r.added.forEach((f) => console.log('   + ' + f));
    r.notes.forEach((n) => console.log('   ' + n));
    if (!check && (r.added.length || JSON.stringify(r.pkg) !== JSON.stringify(pkg))) {
      const bak = file + '.bak-before-fix';
      if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
      fs.writeFileSync(file, JSON.stringify(r.pkg, null, 2) + '\n');
      console.log('   saved (backup: ' + path.basename(bak) + ')');
    }
  }
  if (!check) fs.writeFileSync(path.join(__dirname, 'required-files.json'), JSON.stringify({ files: req }, null, 2) + '\n');
  console.log('\nThe app needs ' + req.length + ' files. ' + (check ? (problems ? 'Run without --check to fix.' : 'All good.') : 'Now build the installer again.'));
  return check && problems ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { requiredFiles, isIncluded, globToRegex, fixPackage };
