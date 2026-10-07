/* ZephyrPlayer settings centre: generated from the schema (js/settings-store.js).
 * Basic -> Advanced, hover descriptions, per-setting / per-section / full reset, search, export/import,
 * the shortcut editor, file associations and external-player controls. */
(function () {
  'use strict';
  const A = window.ZApp, S = window.ZSettings;
  if (!A || !S) { console.warn('settings-ui.js: missing ZApp/ZSettings'); return; }
  const api = () => A.api();
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const GROUPS = S.GROUPS;
  const root = $('settingsCenter');
  if (!root) return;

  const state = { group: 'general', query: '', advanced: A.lsGet('zephyr-show-advanced') === '1', confirm: null, confirmTimer: null, players: [], assoc: null };

  /* ------------------------------------------------------------------ tooltip (hover descriptions) */
  const tipEl = document.createElement('div');
  tipEl.id = 'ztip'; tipEl.setAttribute('role', 'tooltip'); tipEl.hidden = true;
  document.body.appendChild(tipEl);
  let tipTimer = null, tipTarget = null;
  function showTip(el) {
    const t = el.getAttribute('data-tip'); if (!t) return;
    tipEl.textContent = t; tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    let y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); tipTimer = null; tipTarget = null; tipEl.hidden = true; }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el === tipTarget) return;
    hideTip();
    if (!el) return;
    tipTarget = el;
    tipTimer = setTimeout(() => showTip(el), 320);
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && root.contains(el)) { hideTip(); tipTarget = el; showTip(el); } });
  ['mousedown', 'wheel', 'keydown', 'focusout'].forEach((ev) => document.addEventListener(ev, hideTip, true));
  A.hideTip = hideTip;

  /* ------------------------------------------------------------------ helpers */
  const visibleSettings = (gid) => S.SCHEMA.filter((s) => s.group === gid && (state.advanced || s.level === 'basic'));
  const showIfOk = (s) => !s.showIf || Object.keys(s.showIf).every((k) => String(S.get(k)) === String(s.showIf[k]));
  function matches(s, q) { return (s.label + ' ' + s.tip + ' ' + s.id).toLowerCase().includes(q); }
  function two(stepKey, label, onConfirm, btn) {      // two-click confirmation without window.confirm()
    if (state.confirm === stepKey) { clearTimeout(state.confirmTimer); state.confirm = null; onConfirm(); return; }
    state.confirm = stepKey; btn.textContent = 'Click again to confirm'; btn.classList.add('danger');
    clearTimeout(state.confirmTimer);
    state.confirmTimer = setTimeout(() => { state.confirm = null; btn.textContent = label; btn.classList.remove('danger'); }, 3500);
  }
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  function btn(label, tip, fn, cls) { const b = mk('button', 'btn btn-ghost ' + (cls || ''), label); b.type = 'button'; if (tip) b.setAttribute('data-tip', tip); b.addEventListener('click', fn); return b; }

  /* ------------------------------------------------------------------ one setting row */
  function controlFor(s) {
    const v = S.get(s.id);
    let c;
    switch (s.type) {
      case 'toggle': {
        const w = mk('label', 'switch'); c = mk('input'); c.type = 'checkbox'; c.checked = !!v; c.dataset.ctl = s.id;
        c.addEventListener('change', () => S.set(s.id, c.checked));
        w.append(c, mk('span', 'slider-ui')); return w;
      }
      case 'select': {
        c = mk('select'); c.dataset.ctl = s.id;
        let opts = s.options.slice();
        if (s.dynamic === 'externalPlayers') opts = [{ value: 'auto', label: 'First one found' }].concat(state.players.map((p) => ({ value: p.id, label: p.name + (p.klite ? ' (K-Lite)' : '') })));
        if (!opts.some((o) => String(o.value) === String(v))) opts.push({ value: v, label: String(v) });
        opts.forEach((o) => { const op = mk('option', '', o.label); op.value = o.value; c.appendChild(op); });
        c.value = String(v);
        c.addEventListener('change', () => S.set(s.id, c.value));
        return c;
      }
      case 'range': {
        const w = mk('div', 'range-wrap'); c = mk('input'); c.type = 'range'; c.min = s.min; c.max = s.max; c.step = s.step; c.value = v; c.dataset.ctl = s.id;
        const out = mk('span', 'range-val', v + (s.unit || ''));
        c.addEventListener('input', () => { const r = S.set(s.id, c.value); out.textContent = r.value + (s.unit || ''); });
        w.append(c, out); return w;
      }
      case 'color': {
        c = mk('input'); c.type = 'color'; c.value = v; c.dataset.ctl = s.id; c.addEventListener('input', () => S.set(s.id, c.value)); return c;
      }
      case 'text': {
        c = mk('input'); c.type = 'text'; c.value = v; c.placeholder = s.placeholder || ''; c.maxLength = s.max || 100; c.dataset.ctl = s.id;
        c.addEventListener('change', () => { const r = S.set(s.id, c.value); c.value = r.value; if (r.value !== c.value.trim()) c.classList.add('bad'); });
        return c;
      }
      case 'textarea': {
        c = mk('textarea'); c.rows = 4; c.value = v; c.placeholder = s.placeholder || ''; c.dataset.ctl = s.id; c.spellcheck = false;
        c.addEventListener('change', () => S.set(s.id, c.value)); return c;
      }
      default: return mk('span');
    }
  }

  function row(s) {
    const r = mk('div', 'srow'); r.dataset.setting = s.id;
    const label = mk('div', 'slabel');
    const name = mk('span', 'sname', s.label); name.setAttribute('data-tip', s.tip);
    const info = mk('span', 'sinfo', 'i'); info.setAttribute('data-tip', s.tip); info.tabIndex = 0;
    label.append(name, info);
    if (s.level === 'advanced') label.appendChild(mk('span', 'sbadge', 'advanced'));
    const ctl = controlFor(s); if (ctl.setAttribute) ctl.setAttribute('data-tip', s.tip);
    const rs = mk('button', 'sreset', '↺'); rs.type = 'button'; rs.title = ''; rs.setAttribute('data-tip', 'Reset to the default');
    rs.hidden = S.isDefault(s.id);
    rs.addEventListener('click', () => { S.reset(s.id); render(); });
    r.append(label, ctl, rs);
    return r;
  }

  /* ------------------------------------------------------------------ keyboard shortcut editor */
  function keymapEditor() {
    const C = A.controls, wrap = mk('div', 'keymap');
    if (!C) { wrap.textContent = 'Shortcut editor unavailable.'; return wrap; }
    const msg = mk('div', 'keymsg'); wrap.appendChild(msg);
    const groups = {};
    C.ACTIONS.forEach((a) => { (groups[a.group] = groups[a.group] || []).push(a); });
    let capturing = null;
    const stop = () => { A.capturingKey = false; capturing = null; };
    function startCapture(a, cell, addBtn) {
      if (capturing) stop();
      A.capturingKey = true; capturing = a.id;
      addBtn.textContent = 'Press a key…'; addBtn.classList.add('capturing');
      msg.textContent = 'Press the new key for "' + a.label + '" (Esc cancels).';
      const onKey = (e) => {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', onKey, true);
        if (e.key === 'Escape') { stop(); render(); return; }
        const combo = C.comboFromEvent(e);
        if (!combo) { document.addEventListener('keydown', onKey, true); return; }     // a lone modifier: keep waiting
        const r = C.addKey(a.id, combo);
        stop();
        state.keyMsg = r.ok ? (r.tookFrom ? '"' + C.prettyCombo(combo) + '" now belongs to "' + a.label + '" (it was used by "' + r.tookFrom + '").' : (r.unchanged ? 'That key is already set.' : 'Saved.')) : r.error;
        render();
      };
      document.addEventListener('keydown', onKey, true);
    }
    msg.textContent = state.keyMsg || 'Click + to add a key, ✕ to remove one. Esc is reserved.'; state.keyMsg = '';
    Object.keys(groups).forEach((g) => {
      wrap.appendChild(mk('div', 'keygroup', g));
      groups[g].forEach((a) => {
        const r = mk('div', 'keyrow'); r.dataset.action = a.id;
        r.appendChild(mk('span', 'keylabel', a.label));
        const cell = mk('span', 'keys');
        const keys = C.effectiveKeys(a.id);
        keys.forEach((k) => {
          const chip = mk('span', 'keychip', C.prettyCombo(k));
          const x = mk('button', 'keyx', '✕'); x.type = 'button'; x.setAttribute('data-tip', 'Remove this key');
          x.addEventListener('click', () => { C.removeKey(a.id, k); render(); });
          chip.appendChild(x); cell.appendChild(chip);
        });
        if (!keys.length) cell.appendChild(mk('span', 'muted', 'not set'));
        const add = mk('button', 'keyadd', '+'); add.type = 'button'; add.setAttribute('data-tip', 'Add another key for this action');
        add.addEventListener('click', () => startCapture(a, cell, add));
        cell.appendChild(add);
        r.appendChild(cell);
        const isDef = JSON.stringify(keys) === JSON.stringify(a.keys);
        const rs = mk('button', 'sreset', '↺'); rs.type = 'button'; rs.hidden = isDef; rs.setAttribute('data-tip', 'Reset this shortcut to the default');
        rs.addEventListener('click', () => { C.resetKeys(a.id); render(); });
        r.appendChild(rs);
        wrap.appendChild(r);
      });
    });
    return wrap;
  }

  /* ------------------------------------------------------------------ special blocks */
  function actionsBlock(buttons) { const d = mk('div', 'sactions'); buttons.forEach((b) => d.appendChild(b)); return d; }

  function assocBlock() {
    const box = mk('div', 'sblock');
    box.appendChild(mk('h4', '', 'Open files with ZephyrPlayer'));
    const note = mk('p', 'muted', 'Windows only lets you choose default apps yourself, so this adds ZephyrPlayer to "Open with" and to the Default apps list, then opens that list for you.');
    box.appendChild(note);
    const status = mk('div', 'assoc-status', state.assoc ? ('Registered for ' + state.assoc.registered + ' of ' + state.assoc.total + ' file types.') : 'Checking…');
    box.appendChild(status);
    const cats = mk('div', 'assoc-cats');
    const checks = {};
    [['video', 'Video files (mkv, mp4, avi…)'], ['audio', 'Audio files (mp3, flac…)'], ['playlist', 'Playlists (m3u, pls)']].forEach(([k, t]) => {
      const l = mk('label', 'inline-check'); const c = mk('input'); c.type = 'checkbox'; c.checked = true; checks[k] = c; l.append(c, document.createTextNode(' ' + t)); cats.appendChild(l);
    });
    box.appendChild(cats);
    box.appendChild(actionsBlock([
      btn('Register ZephyrPlayer', 'Adds ZephyrPlayer to the Open with menu and the Windows Default apps list for the selected file types. No admin rights needed.', async () => {
        if (!api() || !api().assocRegister) return;
        const r = await api().assocRegister({ video: checks.video.checked, audio: checks.audio.checked, playlist: checks.playlist.checked }).catch((e) => ({ ok: false, error: e && e.message }));
        A.showOSD(r && r.ok ? 'Registered. Now choose ZephyrPlayer in the Default apps window.' : ('Could not register: ' + ((r && r.error) || 'unknown')), 4000);
        if (r && r.ok && api().openDefaultApps) api().openDefaultApps();
        refreshAssoc();
      }),
      btn('Open Windows Default apps', 'Opens the Windows page where you pick which app opens each file type.', () => api() && api().openDefaultApps && api().openDefaultApps()),
      btn('Remove registration', 'Removes everything this app added to the registry (Open with entries and the Default apps entry).', async (e) => {
        if (!api() || !api().assocUnregister) return;
        const r = await api().assocUnregister(); A.showOSD(r && r.ok ? 'Registration removed' : 'Could not remove it', 2500); refreshAssoc();
      })
    ]));
    return box;
  }

  function playersBlock() {
    const box = mk('div', 'sblock');
    box.appendChild(mk('h4', '', 'Other players on this PC'));
    if (!state.players.length) box.appendChild(mk('p', 'muted', 'No other player found (looked for VLC, MPC-HC / K-Lite Codec Pack, MPC-BE, PotPlayer, KMPlayer). ZephyrPlayer’s own engines already play almost everything, so you do not need K-Lite.'));
    else {
      const ul = mk('ul', 'players');
      state.players.forEach((p) => {
        const li = mk('li');
        li.append(mk('b', '', p.name + (p.klite ? '  · K-Lite Codec Pack' : '')), mk('span', 'muted', ' ' + p.path));
        li.appendChild(btn('Play current file', 'Opens the file that is playing right now in this player, at the start.', () => {
          const it = A.item; if (!it || !it.path) { A.showOSD('Nothing local is playing'); return; }
          api().externalOpen({ id: p.id, file: it.path }).then((r) => A.showOSD(r && r.ok ? 'Opened in ' + p.name : 'Could not start ' + p.name, 2500));
        }));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    box.appendChild(mk('p', 'muted', 'K-Lite note: K-Lite works through DirectShow filters, which only DirectShow players use (MPC-HC from K-Lite does). mpv, which ZephyrPlayer uses, already includes its own decoders for the same formats and more.'));
    return box;
  }

  function advancedButtons() {
    const exportBtn = btn('Export settings…', 'Saves all your changed settings to a file you can back up or copy to another PC.', () => {
      const blob = new Blob([S.export()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'zephyrplayer-settings.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000); A.showOSD('Settings exported');
    });
    const importBtn = btn('Import settings…', 'Loads a settings file made with Export. Invalid or unknown entries are ignored safely.', () => $('settingsImportFile').click());
    const resetAll = btn('Reset ALL settings to default', 'Puts every setting and shortcut back to the factory default. Your playlist, history and files are not touched.', () => two('all', 'Reset ALL settings to default', () => { S.resetAll(); render(); A.showOSD('All settings reset to default'); }, resetAll), 'danger-outline');
    return actionsBlock([exportBtn, importBtn, btn('Open data folder', 'Opens the folder where ZephyrPlayer keeps its cache, logs and posters.', () => api() && api().openAppFolder && api().openAppFolder('data')),
      btn('Open log folder', 'Logs help when something goes wrong.', () => api() && api().openAppFolder && api().openAppFolder('logs')), btn('Developer tools', 'Opens the browser developer tools for the interface.', () => api() && api().toggleDevTools && api().toggleDevTools()), resetAll]);
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    hideTip();
    const nav = $('scNav'), body = $('scBody');
    nav.textContent = ''; body.textContent = '';
    const q = state.query.trim().toLowerCase();
    GROUPS.forEach((g) => {
      const list = visibleSettings(g.id);
      if (g.id === 'advanced' && !state.advanced && !q) return;
      const b = mk('button', 'scnav' + (g.id === state.group && !q ? ' on' : '')); b.type = 'button'; b.dataset.group = g.id;
      if (window.ZIcons) b.appendChild(window.ZIcons.make(g.icon));
      b.appendChild(mk('span', '', g.name));
      const ch = S.countChanged(g.id); if (ch) b.appendChild(mk('em', 'scbadge', String(ch)));
      b.addEventListener('click', () => { state.group = g.id; $('scSearch').value = ''; state.query = ''; render(); });
      nav.appendChild(b);
    });
    const head = mk('div', 'schead');
    const content = mk('div', 'scrows');
    if (q) {
      head.appendChild(mk('h3', '', 'Search results'));
      const found = S.SCHEMA.filter((s) => matches(s, q));
      if (!found.length) content.appendChild(mk('p', 'muted', 'No setting matches "' + state.query + '".'));
      GROUPS.forEach((g) => { const m = found.filter((s) => s.group === g.id && s.type !== 'keymap' && showIfOk(s)); if (!m.length) return; content.appendChild(mk('div', 'scgroup', g.name)); m.forEach((s) => content.appendChild(row(s))); });
      if (found.some((s) => s.type === 'keymap')) content.appendChild(mk('p', 'muted', 'Keyboard shortcuts are in Keys & mouse.'));
    } else {
      const g = GROUPS.find((x) => x.id === state.group) || GROUPS[0];
      const t = mk('div', 'schead-t'); t.append(mk('h3', '', g.name), mk('p', 'muted', g.desc)); head.appendChild(t);
      const rg = mk('button', 'btn btn-ghost sm', 'Reset this section'); rg.type = 'button'; rg.setAttribute('data-tip', 'Puts every setting in this section back to its default.'); rg.hidden = S.countChanged(g.id) === 0;
      rg.addEventListener('click', () => two('grp:' + g.id, 'Reset this section', () => { S.resetGroup(g.id); render(); A.showOSD(g.name + ' reset to default'); }, rg));
      head.appendChild(rg);
      const basics = visibleSettings(g.id).filter((s) => s.level === 'basic' && showIfOk(s));
      const advs = visibleSettings(g.id).filter((s) => s.level === 'advanced' && showIfOk(s));
      const emit = (s) => { if (s.type === 'keymap') content.appendChild(keymapEditor()); else content.appendChild(row(s)); };
      basics.forEach(emit);
      if (g.id === 'library') content.appendChild(actionsBlock([
        btn('Fetch info for the whole playlist', 'Looks up posters and info for every item, slowly, to respect the free services’ limits. Needs the online option above.', () => A.fetchAllInfo && A.fetchAllInfo()),
        btn('Clear poster cache', 'Deletes the downloaded posters and lookup results from this PC.', () => A.clearOnlineCache && A.clearOnlineCache()),
        btn('Clear watch history', 'Forgets resume positions and the Continue-watching shelf.', () => { const b = $('clearHistoryBtn'); if (b) b.click(); })]));
      if (g.id === 'controls') content.appendChild(actionsBlock([btn('Reset all shortcuts', 'Restores every keyboard shortcut to the default.', () => { S.reset('keymap'); render(); A.showOSD('Shortcuts reset'); })]));
      if (g.id === 'system') { content.appendChild(assocBlock()); content.appendChild(playersBlock()); }
      if (advs.length) {
        if (g.id !== 'advanced') content.appendChild(mk('div', 'scgroup', 'Advanced'));
        advs.forEach(emit);
      }
      if (g.id === 'advanced') content.appendChild(advancedButtons());
      if (g.id !== 'advanced' && !state.advanced && S.SCHEMA.some((s) => s.group === g.id && s.level === 'advanced')) content.appendChild(mk('p', 'muted', 'More options in this section are hidden. Turn on "Show advanced settings" above.'));
    }
    body.append(head, content);
    $('scAdvanced').checked = state.advanced;
    const total = S.countChanged();
    $('scChanged').textContent = total ? total + ' setting' + (total > 1 ? 's' : '') + ' changed from default' : 'All settings are at their defaults';
  }

  /* ------------------------------------------------------------------ data from the main process */
  async function refreshPlayers() { if (api() && api().externalList) { try { const r = await api().externalList(); state.players = (r && r.players) || []; A.externalPlayers = state.players; } catch {} } }
  async function refreshAssoc() { if (api() && api().assocStatus) { try { const r = await api().assocStatus(); state.assoc = r && r.ok ? r : null; } catch { state.assoc = null; } } if (!root.hidden) render(); }

  function open() {
    root.hidden = false;
    render();
    refreshPlayers().then(() => { if (!root.hidden) render(); });
    refreshAssoc();
    const sb = $('scSearch'); if (sb) sb.focus();
  }
  function close() { A.capturingKey = false; hideTip(); root.hidden = true; }
  A.openSettings = open;
  A.closeSettings = close;
  A.settingsUI = { render, open, close, state };

  $('scClose').addEventListener('click', close);
  $('scSearch').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('scAdvanced').addEventListener('change', (e) => { state.advanced = e.target.checked; A.lsSet('zephyr-show-advanced', state.advanced ? '1' : '0'); render(); });
  $('settingsImportFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 1024 * 1024) { A.showOSD('That file is too large to be a settings file'); return; }
    const r = S.import(await f.text());
    A.showOSD(r.ok ? 'Imported ' + r.applied + ' setting(s)' + (r.rejected ? ' (' + r.rejected + ' ignored)' : '') : r.error, 3500);
    render();
  });
  S.on(null, () => { if (!root.hidden && !A.capturingKey && !(document.activeElement && root.contains(document.activeElement) && document.activeElement.type === 'range')) { /* keep sliders smooth: only refresh badges */ const t = S.countChanged(); $('scChanged').textContent = t ? t + ' setting' + (t > 1 ? 's' : '') + ' changed from default' : 'All settings are at their defaults'; } });
  root.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('select, input[type=checkbox], input[type=text], textarea')) setTimeout(() => { if (!root.hidden && !A.capturingKey) render(); }, 0); });
  root.addEventListener('pointerup', (e) => { if (e.target.matches && e.target.matches('input[type=range]')) setTimeout(() => { if (!root.hidden) render(); }, 0); });
})();
