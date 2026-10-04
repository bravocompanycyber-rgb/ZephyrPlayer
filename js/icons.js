/* ZephyrPlayer icon system.
 * Any element with data-icon="name" becomes a CSS-masked icon that follows the text colour.
 * Source order: your files in assets/icons/<name>.svg|png  ->  built-in defaults (icons-default.js).
 * Drop a file in, alt-tab back to the app, and it updates live. */
(function () {
  'use strict';
  const defaults = window.ZIconDefaults || {};
  const custom = {};
  let signature = '';

  const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(String(svg).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, ''));

  function urlFor(name) {
    const c = custom[name];
    if (c) return c.type === 'svg' ? svgUri(c.data) : 'data:image/png;base64,' + c.data;
    return defaults[name] ? svgUri(defaults[name]) : '';
  }

  function set(el, name) {
    if (!el) return;
    el.dataset.icon = name;
    const u = urlFor(name);
    if (u) el.style.setProperty('--zi', 'url("' + u + '")');
  }

  function make(name, cls) {
    const s = document.createElement('span');
    s.className = 'zi' + (cls ? ' ' + cls : '');
    set(s, name);
    return s;
  }

  // Icons that live inside generated/plain-text controls are decorated here so the HTML stays readable.
  const MENU_ICONS = {
    frameBackBtn: 'frame-back', frameFwdBtn: 'frame-forward', videoAdjBtn: 'video-adjust', geomBtn: 'aspect', eqBtn: 'equalizer',
    infoBtn: 'info', bookmarkBtn: 'bookmark', chapterBtn: 'chapters', sleepBtn: 'sleep', networkBtn: 'network',
    assStyleBtn: 'subtitles', audioAdvBtn: 'headphones', aboutBtn: 'info', assocBtn: 'film',
    detailsBtn: 'image', clipBtn: 'scissors', toolsBtn: 'engine', shortcutsBtn: 'keyboard', guideBtn: 'info'
  };
  const TAB_ICONS = { queue: 'playlist', library: 'library', recent: 'recent' };

  function decorate() {
    Object.keys(MENU_ICONS).forEach((id) => {
      const b = document.getElementById(id);
      if (b && !b.querySelector('.zi')) b.prepend(make(MENU_ICONS[id], 'menu-ico'));
    });
    document.querySelectorAll('.side-tab').forEach((b) => {
      const ic = TAB_ICONS[b.dataset.tab];
      if (ic && !b.querySelector('.zi')) b.prepend(make(ic));
    });
    document.querySelectorAll('.menu-close, .panel-close').forEach((b) => {
      if (!b.querySelector('.zi') && /^[✕×x]$/i.test(b.textContent.trim())) { b.textContent = ''; b.appendChild(make('close')); }
    });
  }

  function apply(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => set(el, el.dataset.icon));
  }

  async function refresh() {
    const api = window.electronAPI;
    if (!api || !api.getIcons) return;
    let r;
    try { r = await api.getIcons(); } catch { return; }
    if (!r || !r.icons) return;
    const sig = Object.keys(r.icons).sort().map((k) => k + ':' + r.icons[k].data.length + ':' + r.icons[k].data.slice(0, 48)).join('|');
    if (sig === signature) return;
    signature = sig;
    Object.keys(custom).forEach((k) => delete custom[k]);
    Object.assign(custom, r.icons);
    apply();
  }

  window.ZIcons = { set, make, apply, refresh, decorate, urlFor };
  decorate();
  apply();
  refresh();
  window.addEventListener('focus', refresh);
})();
