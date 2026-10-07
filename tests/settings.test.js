const L = require(require('path').resolve(__dirname, '..', 'js', 'settings-store.js')); const assert = require('assert');
const mkStorage = (init) => { const m = Object.assign({}, init); return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
// defaults + schema sanity
let st = mkStorage(); let S = L.createStore({ storage: st });
const ids = new Set(); for (const s of L.SCHEMA) { assert(!ids.has(s.id), 'dup ' + s.id); ids.add(s.id); assert(L.GROUPS.some(g => g.id === s.group), 'group ' + s.id); assert(s.tip && s.tip.length > 20 && s.label, 'tooltip+label for ' + s.id); assert(['basic', 'advanced'].includes(s.level)); assert.deepStrictEqual(L.coerce(s, s.def), s.def, 'default round-trips ' + s.id); }
console.log(L.SCHEMA.length + ' settings, every one has a label + tooltip; basic:', L.SCHEMA.filter(s => s.level === 'basic').length, 'advanced:', L.SCHEMA.filter(s => s.level === 'advanced').length);
// validation & clamping
assert.strictEqual(S.set('seekStep', 9999).value, 60); assert.strictEqual(S.set('seekStep', -5).value, 1); assert.strictEqual(S.set('seekStep', 'abc').value, 10); assert.strictEqual(S.set('seekStep', 7.4).value, 7);
assert.strictEqual(S.set('volumeMax', 200).value, 200); assert.strictEqual(S.set('volumeMax', 999).value, 200, 'invalid select -> default'); assert.strictEqual(S.set('volumeMax', '300').value, 300, 'numeric option from string');
assert.strictEqual(S.set('theme', 'nope').value, 'zephyr'); assert.strictEqual(S.set('theme', 'nord').value, 'nord');
assert.strictEqual(S.set('accentColor', 'red').value, '#38bdf8'); assert.strictEqual(S.set('accentColor', '#FF8800').value, '#ff8800');
assert.strictEqual(S.set('slang', 'en,eng;<script>').value, 'en,eng', 'unsafe text rejected -> default'); assert.strictEqual(S.set('slang', ' fr , de ').value, 'fr , de');
assert.strictEqual(S.set('autoNext', 'false').value, false); assert.strictEqual(S.set('autoNext', 1).value, true);
assert.deepStrictEqual(S.set('keymap', { playpause: ['Shift+Ctrl+P', 'bogus!!', 'space', 'space'], 'bad key': ['a'] }).value, { playpause: ['ctrl+shift+p', 'space'] });
assert(L.isCombo('ctrl+shift+left') && L.isCombo('f11') && L.isCombo('?') === false && L.isCombo('question') && !L.isCombo('ctrl+') && !L.isCombo('hello'));
assert.strictEqual(S.set('nonexistent', 1).ok, false);
// persistence only stores differences, mirrors legacy keys, survives reload
S.set('online', true); S.set('fsLine', false); S.set('vo', 'gpu-next'); S.set('perf', 'low');
assert.strictEqual(st.m['zephyr-online'], '1'); assert.strictEqual(st.m['zephyr-fsline'], '0'); assert.strictEqual(st.m['zephyr-settingVo'], 'gpu-next'); assert.strictEqual(st.m['zephyr-skin'], 'nord');
const stored = JSON.parse(st.m['zephyr-settings-v2']); assert(stored.values.online === true && !('splash' in stored.values), 'only non-default values are stored'); assert.strictEqual(stored.v, 2);
const S2 = L.createStore({ storage: st }); assert.strictEqual(S2.get('theme'), 'nord'); assert.strictEqual(S2.get('seekStep'), 7); assert.strictEqual(S2.get('online'), true); assert.deepStrictEqual(S2.get('keymap'), { playpause: ['ctrl+shift+p', 'space'] });
// reset: single / group / all, and "changed" counting
assert(S2.countChanged() >= 8 && !S2.isDefault('theme')); S2.reset('theme'); assert.strictEqual(S2.get('theme'), 'zephyr'); assert(S2.isDefault('theme'));
S2.resetGroup('audio'); assert.strictEqual(S2.get('volumeMax'), 200); assert(S2.countChanged('audio') === 0);
S2.resetAll(); assert.strictEqual(S2.countChanged(), 0); assert.strictEqual(st.m['zephyr-skin'], 'zephyr'); assert.deepStrictEqual(S2.get('keymap'), {}); assert.strictEqual(JSON.parse(st.m['zephyr-settings-v2']).values.online, undefined);
// change events (and quiet writes don't fire)
const seen = []; S2.on('seekStep', (v) => seen.push(v)); S2.on(null, (v, id) => seen.push(id)); S2.set('seekStep', 20); S2.set('seekStep', 20); S2.set('seekStep', 25, { quiet: true }); assert.deepStrictEqual(seen, [20, 'seekStep']);
// corrupted store: backed up, defaults used, no crash
const bad = mkStorage({ 'zephyr-settings-v2': '{not json!!' }); const S3 = L.createStore({ storage: bad }); assert.strictEqual(S3.get('seekStep'), 10); assert(bad.m['zephyr-settings-v2-corrupt'].includes('not json'));
const evil = mkStorage({ 'zephyr-settings-v2': JSON.stringify({ v: 2, values: { seekStep: 'x', theme: { a: 1 }, accentColor: '<img>', keymap: 7, volumeMax: -1, extraneous: 1 } }) }); const S4 = L.createStore({ storage: evil }); assert.strictEqual(S4.get('seekStep'), 10); assert.strictEqual(S4.get('theme'), 'zephyr'); assert.strictEqual(S4.get('accentColor'), '#38bdf8'); assert.deepStrictEqual(S4.get('keymap'), {}); assert.strictEqual(S4.get('volumeMax'), 200);
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } }; const S5 = L.createStore({ storage: throwing }); assert.strictEqual(S5.set('seekStep', 30).value, 30); assert.strictEqual(S5.get('seekStep'), 30);
// migration of the old scattered keys + old hotkeys
const old = mkStorage({ 'zephyr-skin': 'dark', 'zephyr-online': '1', 'zephyr-art': 'poster', 'zephyr-settingVo': 'direct3d', 'zephyr-settingHwdec': 'dxva2', 'zephyr-fsline': '0', 'zephyr-accent-mode': 'custom', 'zephyr-accent': '#00ff00', 'zephyr-hotkeys': JSON.stringify({ play: ' ', full: 'g' }) });
const S6 = L.createStore({ storage: old }); assert.strictEqual(S6.get('theme'), 'zephyr'); assert.strictEqual(S6.get('online'), true); assert.strictEqual(S6.get('artMode'), 'poster'); assert.strictEqual(S6.get('vo'), 'gpu', 'retired value "direct3d" falls back'); assert.strictEqual(S6.get('hwdec'), 'dxva2'); assert.strictEqual(S6.get('fsLine'), false); assert.strictEqual(S6.get('accentColor'), '#00ff00'); assert.deepStrictEqual(S6.get('keymap'), { playpause: ['space'], fullscreen: ['g'] });
// export / import
S6.set('seekStep', 15); const ex = S6.export(); const S7 = L.createStore({ storage: mkStorage() }); const im = S7.import(ex); assert(im.ok && im.applied >= 3); assert.strictEqual(S7.get('seekStep'), 15);
assert.strictEqual(S7.import('garbage').ok, false); assert.strictEqual(S7.import('{"a":1}').ok, false); assert.deepStrictEqual(S7.import('{"values":{"seekStep":9999,"zzz":1}}'), { ok: true, applied: 1, rejected: 1 }); assert.strictEqual(S7.get('seekStep'), 60);
console.log('settings-store OK');
