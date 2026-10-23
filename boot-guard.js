/* Loaded FIRST. If the interface cannot start (a script error, a missing file), say so on screen instead of showing a window
 * where nothing reacts. The details are also written to the log (File > Open log folder). */
(function () {
  'use strict';
  var shown = false;
  function show(msg) {
    if (shown || !document.body) return;
    shown = true;
    var d = document.createElement('div');
    d.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#7f1d1d;color:#fff;font:13px/1.45 Segoe UI,Arial,sans-serif;padding:12px 44px 12px 14px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.55);white-space:pre-wrap;word-break:break-word');
    d.textContent = 'ZephyrPlayer: the interface hit an error and may not respond.\n' + msg + '\nPlease send a photo of this message. Press F12 for the developer tools; File > Open log folder has the log.';
    var b = document.createElement('button');
    b.textContent = '\u2715';
    b.setAttribute('style', 'position:absolute;right:10px;top:8px;background:none;border:0;color:#fff;font-size:16px;cursor:pointer');
    b.onclick = function () { d.remove(); };
    d.appendChild(b);
    document.body.appendChild(d);
  }
  window.addEventListener('error', function (e) {
    var where = String(e.filename || '').split(/[\\/]/).slice(-2).join('/') + ':' + (e.lineno || '?');
    show((e.message || 'Script error') + '\n  at ' + where);
  });
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { if (!window.ZApp) show('The interface scripts did not finish loading (the player core is missing).'); }, 4000);
  });
})();
