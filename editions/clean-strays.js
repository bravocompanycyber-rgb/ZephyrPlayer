#!/usr/bin/env node
'use strict';
/**
 * Removes stray copies of files that were saved into the project ROOT by mistake
 * (for example features.js, player.js, settings-ui.js, *.test.js, fix-build-files.js) when the same file belongs in js/, tests/ or editions/.
 * The app only loads js/*.js; a stale js/player.js next to a newer root player.js is a classic reason for buttons that do nothing.
 *
 *   node editions/clean-strays.js           show what would be removed (nothing is changed)
 *   node editions/clean-strays.js --fix     remove them (use "git status" afterwards, then commit)
 *
 * Run it AFTER copying the zip over the project, so js/ and tests/ hold the latest files.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fix = process.argv.includes('--fix');
const strays = [];
for (const f of fs.readdirSync(root)) {
  if (!/\.js$/.test(f) || !fs.statSync(path.join(root, f)).isFile()) continue;
  for (const dir of ['js', 'tests', 'editions']) {
    const proper = path.join(root, dir, f);
    if (fs.existsSync(proper)) {
      const a = fs.readFileSync(path.join(root, f)), b = fs.readFileSync(proper);
      strays.push({ file: f, dir, same: a.equals(b), rootNewer: fs.statSync(path.join(root, f)).mtimeMs > fs.statSync(proper).mtimeMs });
    }
  }
}
const leftovers = [];
for (const f of fs.readdirSync(root)) if (/\.bak-before-fix$|\.edition-backup$|^mpv-version\.txt$|^REMOVE_ONLINE_LEFTOVERS\.cmd$|^v[0-9.]+-source\.patch$|^PATCH-NOTES-v[0-9.]+\.md$/.test(f)) leftovers.push(f);
try { for (const f of fs.readdirSync(path.join(root, 'assets', 'icons'))) if (/^shot-.*\.png$/i.test(f)) leftovers.push('assets/icons/' + f); } catch { /* no icons folder */ }
if (leftovers.length) console.log('Leftover files that do not belong in the project (backups, screenshots):\n  ' + leftovers.join('\n  ') + '\n');
if (!strays.length && !leftovers.length) { console.log('No stray copies found: the project layout is clean.'); process.exit(0); }
if (!strays.length && !fix) { console.log('Run with --fix to delete the leftovers.'); process.exit(0); }
console.log(strays.length + ' stray file(s) in the project root that also exist in js/ or tests/:\n');
for (const s of strays) console.log('  ' + s.file.padEnd(24) + ' -> ' + s.dir + '/' + s.file + (s.same ? '   (identical)' : (s.rootNewer ? '   (ROOT copy is NEWER: copy it over the folder one first!)' : '   (folder copy is newer or equal)')));
const newer = strays.filter((s) => !s.same && s.rootNewer);
if (!fix) { console.log('\nNothing changed. Run with --fix to delete the root copies' + (newer.length ? ' (the ones marked NEWER will be copied into the folder first)' : '') + '.'); process.exit(0); }
for (const l of leftovers) { try { fs.unlinkSync(path.join(root, l)); } catch { /* already gone */ } }
for (const s of strays) {
  if (!s.same && s.rootNewer) fs.copyFileSync(path.join(root, s.file), path.join(root, s.dir, s.file));
  fs.unlinkSync(path.join(root, s.file));
}
// keep generated / local-only files out of git
const gi = path.join(root, '.gitignore'); let t = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
const add = ['*.bak-before-fix', '*.edition-backup', 'package.json.bak-before-fix', 'package.json.edition-backup', 'tools-versions.json', 'mpv-version.txt', 'build/tools-*/', 'dist/'].filter((l) => !t.split(/\r?\n/).includes(l));
if (add.length) { fs.appendFileSync(gi, (t.endsWith('\n') || !t ? '' : '\n') + '# generated / local-only\n' + add.join('\n') + '\n'); console.log('.gitignore: added ' + add.join(', ')); }
console.log('\nRemoved ' + strays.length + ' stray file(s) and ' + leftovers.length + ' leftover(s). Now run these two commands, one after the other:\n   git add -A\n   git commit -m "clean project layout"');
