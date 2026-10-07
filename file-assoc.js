'use strict';
/** Windows file associations without admin rights (HKCU only). Windows 8+ does not let apps silently become the
 *  default, so we register ZephyrPlayer properly (Open with + Default apps list) and then open that Windows page. */
const { execFile } = require('child_process');

const EXTS = {
  video: 'mp4 m4v mkv webm avi mov wmv flv f4v ts m2ts mts mpg mpeg m2v vob 3gp 3g2 ogv ogm asf rm rmvb divx mxf'.split(' '),
  audio: 'mp3 flac wav ogg oga aac m4a m4b opus wma ape wv mka aiff aif ac3 eac3 dts amr mpc tta'.split(' '),
  playlist: ['m3u', 'm3u8', 'pls']
};
const PROGID = 'ZephyrPlayer.Media';
const APP_KEY = 'Software\\ZephyrPlayer';

function selectedExts(sel) {
  const s = sel || { video: true, audio: true, playlist: true };
  return [].concat(s.video ? EXTS.video : [], s.audio ? EXTS.audio : [], s.playlist ? EXTS.playlist : []);
}

/** Command line Windows runs for a double-click. Dev mode needs the app folder as an argument. */
function openCommand({ exe, appDir, packaged }) {
  return packaged ? '"' + exe + '" "%1"' : '"' + exe + '" "' + appDir + '" "%1"';
}

/** Pure: the list of `reg` argument arrays that register everything. */
function buildRegCommands({ exe, appDir, packaged, exts }) {
  const cmd = openCommand({ exe, appDir, packaged });
  const exeName = String(exe).split(/[\\/]/).pop();
  const C = 'HKCU\\Software\\Classes\\';
  const add = (key, name, type, data) => {
    const a = ['add', key];
    if (name === null) a.push('/ve'); else a.push('/v', name);
    a.push('/t', type);
    if (data !== undefined) a.push('/d', data);
    a.push('/f');
    return a;
  };
  const cmds = [
    add(C + PROGID, null, 'REG_SZ', 'ZephyrPlayer media file'),
    add(C + PROGID + '\\DefaultIcon', null, 'REG_SZ', '"' + exe + '",0'),
    add(C + PROGID + '\\shell\\open', null, 'REG_SZ', 'Play with ZephyrPlayer'),
    add(C + PROGID + '\\shell\\open\\command', null, 'REG_SZ', cmd),
    add(C + 'Applications\\' + exeName + '\\shell\\open\\command', null, 'REG_SZ', cmd),
    add('HKCU\\' + APP_KEY + '\\Capabilities', 'ApplicationName', 'REG_SZ', 'ZephyrPlayer'),
    add('HKCU\\' + APP_KEY + '\\Capabilities', 'ApplicationDescription', 'REG_SZ', 'Free media player for video, audio and online links'),
    add('HKCU\\Software\\RegisteredApplications', 'ZephyrPlayer', 'REG_SZ', APP_KEY + '\\Capabilities')
  ];
  for (const e of exts) {
    cmds.push(add(C + '.' + e + '\\OpenWithProgids', PROGID, 'REG_NONE'));
    cmds.push(add('HKCU\\' + APP_KEY + '\\Capabilities\\FileAssociations', '.' + e, 'REG_SZ', PROGID));
  }
  return cmds;
}

function buildRemoveCommands({ exe, exts }) {
  const exeName = String(exe).split(/[\\/]/).pop();
  const C = 'HKCU\\Software\\Classes\\';
  const cmds = exts.map((e) => ['delete', C + '.' + e + '\\OpenWithProgids', '/v', PROGID, '/f']);
  cmds.push(['delete', C + PROGID, '/f'], ['delete', C + 'Applications\\' + exeName, '/f'], ['delete', 'HKCU\\' + APP_KEY, '/f'],
    ['delete', 'HKCU\\Software\\RegisteredApplications', '/v', 'ZephyrPlayer', '/f']);
  return cmds;
}

function runReg(args, runner) {
  return new Promise((resolve) => {
    (runner || execFile)('reg.exe', args, { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
  });
}

async function register(ctx, runner) {
  const exts = selectedExts(ctx.select);
  let failed = 0;
  for (const a of buildRegCommands(Object.assign({}, ctx, { exts }))) { const r = await runReg(a, runner); if (!r.ok) failed++; }
  return { ok: failed === 0, failed, total: exts.length, error: failed ? failed + ' registry write(s) failed' : null };
}

async function unregister(ctx, runner) {
  const all = EXTS.video.concat(EXTS.audio, EXTS.playlist);
  let failed = 0;
  for (const a of buildRemoveCommands({ exe: ctx.exe, exts: all })) { const r = await runReg(a, runner); if (!r.ok && !/unable to find|cannot find/i.test(r.out)) failed++; }
  return { ok: true, failed };
}

async function status(runner) {
  const all = EXTS.video.concat(EXTS.audio, EXTS.playlist);
  let registered = 0;
  for (const e of all) {
    const r = await runReg(['query', 'HKCU\\Software\\Classes\\.' + e + '\\OpenWithProgids', '/v', PROGID], runner);
    if (r.ok) registered++;
  }
  return { ok: true, registered, total: all.length };
}

module.exports = { EXTS, PROGID, selectedExts, openCommand, buildRegCommands, buildRemoveCommands, register, unregister, status };
