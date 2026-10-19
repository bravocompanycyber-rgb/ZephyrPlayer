const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const F = require(H.ROOT + '/editions/fix-build-files.js'); const AP = require(H.ROOT + '/editions/after-pack-check.js');
// ---- the required list is derived from the real code
const req = F.requiredFiles(H.ROOT);
for (const f of ['main.js', 'preload.js', 'mpv-session.js', 'mpv-ipc.js', 'engine-config.js', 'edition.js', 'js/features.js', 'js/controls.js', 'js/settings-ui.js', 'js/settings-store.js', 'index.html', 'css/style.css', 'splash.html']) assert(req.includes(f), 'required: ' + f);
assert(!req.some((f) => /^tests\//.test(f) || /^editions\//.test(f)), 'tests/tools are not packed');
// ---- glob semantics the way electron-builder lists use them
assert(F.isIncluded(['*.js'], 'main.js') && !F.isIncluded(['*.js'], 'js/player.js') && F.isIncluded(['js/**/*'], 'js/player.js') && F.isIncluded(['js'], 'js/player.js') && F.isIncluded(['**/*', '!**/*.map'], 'a/b.js') && !F.isIncluded(['**/*', '!**/*.map'], 'a/b.map'));
assert(F.isIncluded(['main.js', 'preload.js', 'mpv-controller.js'], 'preload.js') && !F.isIncluded(['main.js', 'preload.js', 'mpv-controller.js'], 'mpv-session.js'), 'the exact situation of the crash: explicit list without the new modules');
assert(F.isIncluded(['{main,preload}.js'], 'preload.js'));
// ---- fixing an "old style" explicit list (what the failing installer was built with)
const old = { name: 'z', build: { appId: 'x', files: ['main.js', 'preload.js', 'mpv-controller.js', 'index.html', 'css/**/*', 'js/player.js', 'assets/**/*', '!**/*.map'] } };
const r = F.fixPackage(old, req); assert(r.added.includes('mpv-session.js') && r.added.includes('js/features.js') && r.added.includes('splash.html')); assert(!r.added.includes('main.js') && !r.added.includes('css/style.css'), 'only what is missing is added');
assert.deepStrictEqual(r.pkg.build.files.slice(0, 8), old.build.files.slice(0, 8), 'your own entries stay first, untouched'); assert.strictEqual(r.pkg.build.afterPack, 'editions/after-pack-check.js'); assert(req.every((f) => F.isIncluded(r.pkg.build.files, f)), 'after the fix everything is included');
assert.strictEqual(F.fixPackage(r.pkg, req).added.length, 0, 'idempotent'); assert(F.fixPackage({ build: { files: ['**/*'], afterPack: 'mine.js' } }, req).notes.some((n) => /already have an afterPack/.test(n)));
assert(/nothing to add/.test(F.fixPackage({ name: 'z' }, req).notes[0]), 'no list = electron-builder default packs everything');
// ---- the build-time guard really stops a broken package (real asar files)
(async () => {
  let asar; try { asar = require('@electron/asar'); } catch { try { asar = require('asar'); } catch {} }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-')); const app = path.join(tmp, 'app'); const resDir = path.join(tmp, 'out', 'resources'); fs.mkdirSync(resDir, { recursive: true });
  for (const f of req) { const t = path.join(app, f); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(path.join(H.ROOT, f), t); }
  fs.writeFileSync(path.join(H.ROOT, 'editions', 'required-files.json'), JSON.stringify({ files: req }));
  if (!asar) { console.log('SKIP asar part: @electron/asar not installed'); process.exit(0); }
  await asar.createPackage(app, path.join(resDir, 'app.asar')); await AP({ appOutDir: path.join(tmp, 'out') }); console.log('complete package passes the guard');
  fs.unlinkSync(path.join(app, 'mpv-session.js')); fs.rmSync(path.join(resDir, 'app.asar')); await asar.createPackage(app, path.join(resDir, 'app.asar'));
  await assert.rejects(() => AP({ appOutDir: path.join(tmp, 'out') }), /MISSING 1 file.*mpv-session\.js.*fix-build-files/s); console.log('package missing mpv-session.js is REJECTED at build time');
  // the CLI on a copy of a project (explicit old list, like yours)
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'zcli-')); for (const f of req.concat(['editions/fix-build-files.js'])) { const t = path.join(proj, f); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(path.join(H.ROOT, f), t); }
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify(old, null, 2)); const run = (...a) => { try { return execFileSync(process.execPath, [path.join(proj, 'editions', 'fix-build-files.js'), ...a], { encoding: 'utf8' }); } catch (e) { return 'EXIT' + e.status + e.stdout; } };
  assert(/EXIT1/.test(run('--check')) && /mpv-session\.js/.test(run('--check')), '--check reports and fails'); assert.strictEqual(JSON.parse(fs.readFileSync(path.join(proj, 'package.json'))).build.files.length, old.build.files.length, '--check changes nothing');
  run(); const fixed = JSON.parse(fs.readFileSync(path.join(proj, 'package.json'))); assert(fixed.build.files.includes('mpv-session.js') && fs.existsSync(path.join(proj, 'package.json.bak-before-fix'))); assert(/already complete/.test(run('--check')), 'after the fix the check is clean');
  fs.writeFileSync(path.join(H.ROOT, 'editions', 'required-files.json'), JSON.stringify({ files: req }, null, 2) + '\n');
  console.log('buildfiles OK');
})().catch((e) => { console.error(e); process.exit(1); });
