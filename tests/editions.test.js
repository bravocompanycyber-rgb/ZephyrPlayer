const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const E = require(H.ROOT + '/editions/apply-edition.js');
const mine = { name: 'zephyrplayer', version: '2.5.0', main: 'main.js', scripts: { start: 'electron .', build: 'x' }, devDependencies: { electron: '^33.0.0', 'electron-builder': '^25.0.0' }, dependencies: { 'electron-updater': '^6.1.0' }, build: { appId: 'com.mine.player', productName: 'My Player', win: { icon: 'assets/icons/zephyrplayer.ico' }, publish: [{ provider: 'github' }] } };
const before = JSON.stringify(mine);
const mod = E.applyEdition(mine, 'modern'), leg = E.applyEdition(mine, 'legacy');
assert.strictEqual(JSON.stringify(mine), before, 'input is never mutated');
assert.strictEqual(mod.devDependencies.electron, '^33.0.0', 'modern keeps YOUR Electron version'); assert.strictEqual(leg.devDependencies.electron, '22.3.27', 'legacy pins the last Electron that runs on Windows 8.1 (exact, no caret)'); assert.strictEqual(leg.devDependencies['electron-builder'], '^24.13.3'); assert.strictEqual(leg.dependencies['electron-updater'], '^5.3.0');
for (const o of [mod, leg]) {
  assert.strictEqual(o.build.appId, 'com.mine.player', 'your appId survives'); assert.strictEqual(o.build.productName, 'My Player'); assert.strictEqual(o.build.win.icon, 'assets/icons/zephyrplayer.ico', 'your icon survives'); assert.deepStrictEqual(o.build.publish, [{ provider: 'github' }], 'your publish settings survive');
  const ext = o.build.fileAssociations.flatMap((f) => f.ext); for (const e of ['mkv', 'mp4', 'avi', 'ts', 'mp3', 'flac', 'm3u8', 'pls']) assert(ext.includes(e), 'association for .' + e);
  assert(o.build.files.includes('js/**') && o.build.files.includes('!tests/**') && o.build.files.includes('splash.html')); const f = o.build.extraFiles[0].filter; for (const t of ['mpv.exe', 'yt-dlp.exe', 'qjs.exe', 'deno.exe', 'ffmpeg/**', 'setup-tools.ps1']) assert(f.includes(t), 'ships ' + t);
  assert.strictEqual(o.scripts.start, 'electron .'); assert.strictEqual(o.scripts.build, 'x', 'your scripts survive'); assert(o.scripts['dist:legacy'] && o.scripts.test);
}
assert.deepStrictEqual(leg.build.win.target[0].arch, ['ia32', 'x64'], 'legacy also builds 32-bit'); assert.deepStrictEqual(mod.build.win.target[0].arch, ['x64']); assert.strictEqual(leg.build.directories.output, 'dist/legacy'); assert(/legacy/.test(leg.build.win.artifactName) && /modern/.test(mod.build.win.artifactName), 'artifacts never overwrite each other');
assert.deepStrictEqual(E.applyEdition(leg, 'legacy').build.files, leg.build.files, 'idempotent'); assert.throws(() => E.applyEdition(mine, 'x'));
// the real CLI on a throw-away copy of a project: backup, apply, restore
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zed-')); fs.mkdirSync(path.join(dir, 'editions')); fs.copyFileSync(H.ROOT + '/editions/apply-edition.js', path.join(dir, 'editions', 'apply-edition.js')); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(mine, null, 2));
const run = (a) => execFileSync(process.execPath, [path.join(dir, 'editions', 'apply-edition.js'), a], { encoding: 'utf8' });
run('legacy'); assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).devDependencies.electron, '22.3.27'); run('modern'); assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).devDependencies.electron, '^33.0.0', 'switching editions starts from the ORIGINAL file, not the previous edition');
run('--restore'); assert.strictEqual(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), JSON.stringify(mine, null, 2), 'restore is byte-exact'); assert(!fs.existsSync(path.join(dir, 'package.json.edition-backup')));
console.log('editions OK');
