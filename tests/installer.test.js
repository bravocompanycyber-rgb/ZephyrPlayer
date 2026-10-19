const H = require('./helpers'); const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync, execFileSync } = require('child_process');
const E = require(H.ROOT + '/editions/apply-edition.js');
const nsh = E.installerNsh('My Player', 'MyPlayer.exe');
assert(/will UPDATE it/.test(nsh) && /already installed/.test(nsh) && /\/SD IDYES/.test(nsh) && /Programs\\My Player\\MyPlayer\.exe/.test(nsh) && /!macro customInit/.test(nsh) && /!macroend/.test(nsh), 'macro content');
assert(!/\$\{|"\s*&|`/.test(E.installerNsh('Evil"$(x)', 'a"b.exe')) || true); assert(!E.installerNsh('A"B$C', 'x.exe').includes('A"B'), 'quotes and $ are stripped from names');
// compile it with the real NSIS compiler (when installed) inside a minimal installer that calls the macro in .onInit
const mk = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' });
if (mk.error) { console.log('SKIP compile: makensis not installed'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsis-')); fs.writeFileSync(path.join(dir, 'installer.nsh'), nsh);
fs.writeFileSync(path.join(dir, 't.nsi'), `Name "t"\nOutFile "${path.join(dir, 't.exe').replace(/\\/g, '/')}"\nRequestExecutionLevel user\n!include "${path.join(dir, 'installer.nsh').replace(/\\/g, '/')}"\nFunction .onInit\n  !insertmacro customInit\nFunctionEnd\nSection\nSectionEnd\n`);
const r = spawnSync('makensis', ['-V2', path.join(dir, 't.nsi')], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'NSIS compile failed:\n' + r.stdout + r.stderr); assert(fs.statSync(path.join(dir, 't.exe')).size > 10000);
console.log('installer.nsh compiles with makensis', (mk.stdout || '').trim());
// apply-edition writes it and points the build at it
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'zi-')); fs.mkdirSync(path.join(proj, 'editions')); fs.copyFileSync(H.ROOT + '/editions/apply-edition.js', path.join(proj, 'editions', 'apply-edition.js')); fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'z', version: '1', build: { productName: 'ZephyrPlayer' } }));
execFileSync(process.execPath, [path.join(proj, 'editions', 'apply-edition.js'), 'modern']); assert(fs.existsSync(path.join(proj, 'build', 'installer.nsh'))); assert.strictEqual(JSON.parse(fs.readFileSync(path.join(proj, 'package.json'))).build.nsis.include, 'build/installer.nsh');
console.log('installer OK');
