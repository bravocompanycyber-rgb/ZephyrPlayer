// Cross-checks that the parts of the app agree with each other (what a missing wire would look like at run time).
const H = require('./helpers'); const fs = require('fs'); const path = require('path');
const R = (f) => fs.readFileSync(path.join(H.ROOT, f), 'utf8'); const issues = [];
const check = (name, bad) => { if (bad.length) issues.push(name + ': ' + bad.join(', ')); else console.log('ok  ' + name); };
const main = R('main.js'), preload = R('preload.js'), html = R('index.html'), css = R('css/style.css');
const jsNames = ['player', 'features', 'controls', 'settings-ui', 'settings-store', 'icons'];
const allJs = jsNames.map((f) => R('js/' + f + '.js')).join('\n');
// 1. IPC: preload -> main handlers, main -> preload events
const handled = new Set([...main.matchAll(/handle\(\s*'([^']+)'/g)].map((m) => m[1]));
check('preload invoke() channels all have a handler in main', [...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]).filter((c) => !handled.has(c)));
const sent = new Set([...main.matchAll(/safeSend\(\s*'([^']+)'/g)].map((m) => m[1]));
check('events the preload listens to are really sent by main', [...preload.matchAll(/\bon\('([^']+)'/g)].map((m) => m[1]).filter((c) => !sent.has(c) && c !== 'open-files-mpv'));
// 2. interface -> preload API names
const apiKeys = new Set([...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
check('every electronAPI.x the interface uses exists in the preload', [...new Set([...allJs.matchAll(/(?:api\(\)|electronAPI|A\.api\(\))\??\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].filter((k) => !apiKeys.has(k)));
check('player.js alias calls (a.xxx) exist in the preload', [...new Set([...R('js/player.js').matchAll(/\ba\.((?:mpv|probe|thumb|expand|sidecar|read|record|report|get|set|save|load|scan|list|start|stop|convert|extract|generate|detect|online|open|external|assoc|check)[A-Za-z0-9_]*)\(/g)].map((m) => m[1]))].filter((k) => !apiKeys.has(k)));
// 3. HTML <-> JS
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
check('every element id the JS looks up exists in index.html', [...new Set([...allJs.matchAll(/(?:\$\(|getElementById\()\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))].filter((i) => !ids.has(i) && !['osBtn', 'osPanel', 'ctxRecordBtn'].includes(i)));
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
check('every <script src> exists', scripts.filter((s) => !fs.existsSync(path.join(H.ROOT, s))));
const at = (a) => scripts.indexOf('js/' + a + '.js');
check('script order is right', [['settings-store', 'player'], ['player', 'features'], ['features', 'controls'], ['features', 'settings-ui'], ['icons-default', 'icons'], ['icons', 'player']].filter(([a, b]) => at(a) < 0 || at(b) < 0 || at(a) > at(b)).map((p) => p.join(' before ')));
check('stylesheets exist (favicon.svg is your own file)', [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u) && !/favicon\.svg$/.test(u) && !fs.existsSync(path.join(H.ROOT, u))));
// 4. icons used by the interface exist as files and as built-in fallbacks
const defaults = JSON.parse(R('js/icons-default.js').replace(/^[\s\S]*?window\.ZIconDefaults = /, '').replace(/;\s*$/, ''));
const used = new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]).concat([...allJs.matchAll(/(?:\.make\(|setBtnIcon\([^,]+,\s*)'([a-z0-9-]+)'/g)].map((m) => m[1]), [...R('js/settings-store.js').matchAll(/icon: '([a-z0-9-]+)'/g)].map((m) => m[1]), [...R('js/features.js').matchAll(/icon: '([a-z0-9-]+)'/g)].map((m) => m[1]), [...R('js/icons.js').matchAll(/\b[A-Za-z]+Btn: '([a-z0-9-]+)'/g)].map((m) => m[1])));
check('every icon the UI asks for has an svg file and a built-in fallback', [...used].filter((n) => !defaults[n] || !fs.existsSync(path.join(H.ROOT, 'assets/icons', n + '.svg'))));
// 5. CSS variables
const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
check('every CSS variable that is used is defined', [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]))].filter((v) => !defined.has(v) && !['--zi', '--zi-size'].includes(v)));
// 6. every setting in the schema is consumed by something
const Lib = require(path.join(H.ROOT, 'js/settings-store.js'));
const consumers = jsNames.filter((f) => f !== 'settings-store').map((f) => R('js/' + f + '.js')).join('\n') + main + R('engine-config.js') + R('mpv-session.js');
check('every setting in the schema is used by the app', Lib.SCHEMA.filter((s) => s.id !== 'keymap' && !new RegExp('\\b' + s.id + '\\b').test(consumers)).map((s) => s.id));
// 7. default shortcuts never collide
const keys = {}; const dup = [];
for (const m of R('js/controls.js').matchAll(/id: '([a-zA-Z]+)'[^\n]*?keys: \[([^\]]*)\]/g)) for (const k of m[2].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)) { if (keys[k]) dup.push(k + ' (' + keys[k] + ' / ' + m[1] + ')'); keys[k] = m[1]; }
check('default shortcuts are unique', dup);
// 8. themes are readable
const block = (sel) => { const re = new RegExp(sel.replace(/[[\]"]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g'); const o = {}; let m; while ((m = re.exec(css))) for (const d of m[1].split(';')) { const k = /^\s*(--[a-z-]+)\s*:\s*(.+?)\s*$/.exec(d); if (k) o[k[1]] = k[2]; } return o; };   // later rules win; the last declaration may have no semicolon
const full = (h) => { h = String(h || '').trim(); return /^#[0-9a-f]{3}$/i.test(h) ? '#' + h.slice(1).split('').map((x) => x + x).join('') : h; };
const lum = (h) => { const n = parseInt(full(h).replace('#', ''), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const base = block(':root'); const light = Object.assign({}, base, block('[data-theme="light"]')); const bad = [];
for (const t of Lib.SCHEMA.find((s) => s.id === 'theme').options.map((o) => o.value)) {
  const isLight = ['light', 'paper', 'sky'].includes(t); const v = Object.assign({}, isLight ? light : base, block('[data-skin="' + t + '"]'));
  const bg = full(v['--bg']), tx = full(v['--text']), mu = full(v['--text-muted']), ac = full(v['--accent']), on = full(v['--on-accent'] || (isLight ? '#ffffff' : '#0b0f14'));
  if (![bg, tx, ac].every((c) => /^#[0-9a-f]{6}$/i.test(c))) { bad.push(t + ' (not plain hex)'); continue; }
  const rt = ratio(tx, bg), ra = ratio(ac, bg), ro = ratio(on, ac), rm = /^#[0-9a-f]{6}$/i.test(mu) ? ratio(mu, bg) : null;
  console.log('    ' + t.padEnd(10) + ' text ' + rt.toFixed(1) + '  muted ' + (rm ? rm.toFixed(1) : '-') + '  accent ' + ra.toFixed(1) + '  on-accent ' + ro.toFixed(1));
  if (rt < 7) bad.push(t + ' text ' + rt.toFixed(1)); if (rm !== null && rm < 4.5) bad.push(t + ' muted ' + rm.toFixed(2)); if (ra < 3) bad.push(t + ' accent ' + ra.toFixed(1)); if (ro < 4.5) bad.push(t + ' on-accent ' + ro.toFixed(2));
}
check('all 15 themes are readable (WCAG: text 7, muted 4.5, accent 3, on-accent 4.5)', bad);
// 9. layering
const z = (sel) => { const m = new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\s*\\{[^}]*z-index:\\s*(\\d+)').exec(css); return m ? +m[1] : null; };
const zs = { tip: z('#ztip'), menu: z('.zctx'), settings: z('.settings-panel.settings-center'), banner: z('.health-banner') };
check('layering: tooltip > menus > banners and settings', zs.tip > zs.menu && zs.menu > Math.max(zs.settings, zs.banner || 0) ? [] : [JSON.stringify(zs)]);
if (issues.length) { console.error('\nPROBLEMS:\n - ' + issues.join('\n - ')); process.exit(1); }
console.log('integration OK');
