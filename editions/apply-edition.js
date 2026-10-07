#!/usr/bin/env node
'use strict';
/**
 * Applies the build settings of one ZephyrPlayer edition to YOUR package.json (it never replaces the file, it merges).
 *
 *   node editions/apply-edition.js modern     Windows 10 / 11   (keeps the Electron version you already use)
 *   node editions/apply-edition.js legacy     Windows 7 / 8 / 8.1 (pins Electron 22.3.27, the last release that runs there)
 *   node editions/apply-edition.js --restore  put your original package.json back
 *
 * A backup (package.json.edition-backup) is written first. build-edition.bat wraps all of this.
 */
const fs = require('fs');
const path = require('path');

const LEGACY_ELECTRON = '22.3.27';        // last Electron 22 release (Chromium 108, Node 16.17): the final line that supports Windows 7 / 8 / 8.1
const LEGACY_BUILDER = '^24.13.3';        // electron-builder line known to package Electron 22

const EXT = {
  video: 'mp4 m4v mkv webm avi mov wmv flv f4v ts m2ts mts mpg mpeg m2v vob 3gp 3g2 ogv ogm asf rm rmvb divx mxf'.split(' '),
  audio: 'mp3 flac wav ogg oga aac m4a m4b opus wma ape wv mka aiff aif ac3 eac3 dts amr mpc tta'.split(' '),
  playlist: ['m3u', 'm3u8', 'pls']
};

function deepMerge(base, add) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(add)) {
    if (add[k] && typeof add[k] === 'object' && !Array.isArray(add[k]) && base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])) out[k] = deepMerge(base[k], add[k]);
    else out[k] = add[k];
  }
  return out;
}

function buildSection(edition, existing) {
  const legacy = edition === 'legacy';
  const e = existing || {};
  return {
    appId: e.appId || 'com.bravocompany.zephyrplayer',
    productName: e.productName || 'ZephyrPlayer',
    asar: true,
    directories: { output: 'dist/' + edition },
    // everything the app needs; tests, caches and big tool folders are not packed into the archive
    files: ['*.js', 'js/**', 'css/**', 'assets/**', 'index.html', 'splash.html', 'package.json', '!tests/**', '!editions/**', '!dist/**', '!releases/**', '!node_modules/**/{test,tests,__tests__,docs,example,examples}/**'],
    // tools are copied NEXT TO the exe (that is where the app looks for them). Only files that exist at build time are included.
    extraFiles: [
      { from: '.', to: '.', filter: ['mpv.exe', 'mpv.com', 'yt-dlp.exe', 'deno.exe', 'qjs.exe', 'whisper-cli.exe', '*.dll', 'ffmpeg/**', 'models/**', 'shaders/**', 'setup-tools.ps1', 'setup-tools.bat', 'README.md', 'TOOLS.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'] }
    ],
    fileAssociations: [
      { ext: EXT.video, name: 'Video file', description: 'Video file', role: 'Viewer' },
      { ext: EXT.audio, name: 'Audio file', description: 'Audio file', role: 'Viewer' },
      { ext: EXT.playlist, name: 'Playlist', description: 'Playlist', role: 'Viewer' }
    ],
    win: {
      target: [{ target: 'nsis', arch: legacy ? ['ia32', 'x64'] : ['x64'] }, { target: 'portable', arch: ['x64'] }],
      artifactName: 'ZephyrPlayer-${version}-' + edition + '-${arch}.${ext}'
    },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, shortcutName: 'ZephyrPlayer' }
  };
}

function applyEdition(pkg, edition) {
  if (edition !== 'modern' && edition !== 'legacy') throw new Error('edition must be "modern" or "legacy"');
  const out = JSON.parse(JSON.stringify(pkg));
  out.main = out.main || 'main.js';
  out.scripts = Object.assign({ start: 'electron .', test: 'node tests/run-all.js' }, out.scripts || {});
  out.scripts['dist:modern'] = 'node editions/apply-edition.js modern && electron-builder --win';
  out.scripts['dist:legacy'] = 'node editions/apply-edition.js legacy && electron-builder --win';
  out.devDependencies = Object.assign({}, out.devDependencies || {});
  if (edition === 'legacy') {
    out.devDependencies.electron = LEGACY_ELECTRON;                  // exact pin: ^ would pull a version that does not run on Windows 8.1
    out.devDependencies['electron-builder'] = LEGACY_BUILDER;
    if (out.dependencies && out.dependencies['electron-updater']) out.dependencies['electron-updater'] = '^5.3.0';   // 6.x needs a newer Electron
  }
  out.build = deepMerge(out.build || {}, buildSection(edition, out.build));
  out.build.directories = Object.assign({}, out.build.directories, { output: 'dist/' + edition });
  out.zephyrEdition = edition;
  return out;
}

function main(argv) {
  const root = path.resolve(__dirname, '..');
  const pkgPath = path.join(root, 'package.json');
  const bak = pkgPath + '.edition-backup';
  const arg = argv[2];
  if (arg === '--restore') {
    if (!fs.existsSync(bak)) { console.log('Nothing to restore.'); return 0; }
    fs.copyFileSync(bak, pkgPath); fs.unlinkSync(bak); console.log('package.json restored.'); return 0;
  }
  if (arg !== 'modern' && arg !== 'legacy') { console.error('Usage: node editions/apply-edition.js modern|legacy|--restore'); return 2; }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!fs.existsSync(bak)) fs.copyFileSync(pkgPath, bak);
  fs.writeFileSync(pkgPath, JSON.stringify(applyEdition(JSON.parse(fs.readFileSync(bak, 'utf8')), arg), null, 2) + '\n');
  console.log('package.json prepared for the ' + arg.toUpperCase() + ' edition' + (arg === 'legacy' ? ' (Electron ' + LEGACY_ELECTRON + ')' : '') + '. Backup: package.json.edition-backup');
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { applyEdition, buildSection, deepMerge, LEGACY_ELECTRON, EXT };
