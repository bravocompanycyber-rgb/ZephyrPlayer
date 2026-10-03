/* ZephyrPlayer subtitle utilities (browser + Node). SRT / WebVTT / ASS-SSA parsing, encoding detection, SRT export. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZSub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    // UTF-16 without BOM: lots of NUL bytes
    let nul = 0; const probe = Math.min(u8.length, 512);
    for (let i = 0; i < probe; i++) if (u8[i] === 0) nul++;
    if (probe && nul / probe > 0.3) return new TextDecoder(u8[0] === 0 ? 'utf-16be' : 'utf-16le').decode(u8);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch { return new TextDecoder('windows-1252').decode(u8); }
  }

  function decodeEntities(s) {
    return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  function cleanText(s) {
    return decodeEntities(String(s)
      .replace(/\{\\[^}]*\}/g, '')      // {\an8} / ASS overrides
      .replace(/<\/?[a-zA-Z][^>]*>/g, '') // <i> <b> <font ...> <c.colorXXXX>
      .replace(/\r/g, ''))
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  const TS = /((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})/;

  function parseTime(t) {
    const p = String(t).trim().replace(',', '.').split(':').map(parseFloat);
    if (p.some(isNaN)) return 0;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return p[0] || 0;
  }

  function parseSrtVtt(text) {
    const cues = [];
    const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n');
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue;
      const ti = lines.findIndex(l => TS.test(l));
      if (ti < 0) continue;
      const m = lines[ti].match(TS);
      const body = cleanText(lines.slice(ti + 1).join('\n'));
      if (!body) continue;
      cues.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: body });
    }
    return cues;
  }

  function parseAss(text) {
    const cues = [];
    let inEvents = false;
    let fmt = null;
    for (const raw of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim();
      if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(line)) { fmt = line.slice(line.indexOf(':') + 1).split(',').map(s => s.trim().toLowerCase()); continue; }
      if (!/^dialogue\s*:/i.test(line)) continue;
      const f = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const body = line.slice(line.indexOf(':') + 1).replace(/^\s/, '');
      const parts = [];
      let rest = body;
      for (let i = 0; i < f.length - 1; i++) {
        const c = rest.indexOf(',');
        if (c < 0) { parts.push(rest); rest = ''; } else { parts.push(rest.slice(0, c)); rest = rest.slice(c + 1); }
      }
      parts.push(rest);
      const si = f.indexOf('start'), ei = f.indexOf('end'), xi = f.indexOf('text');
      if (si < 0 || ei < 0 || xi < 0) continue;
      const txt = cleanText(String(parts[xi]).replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' '));
      if (!txt) continue;
      cues.push({ start: parseTime(parts[si]), end: parseTime(parts[ei]), text: txt });
    }
    return cues;
  }

  function parse(text) {
    text = String(text || '');
    let cues;
    if (/^\s*\[Script Info\]/i.test(text) || /^\s*Dialogue\s*:/im.test(text)) cues = parseAss(text);
    else cues = parseSrtVtt(text);
    cues = cues.filter(c => isFinite(c.start) && isFinite(c.end) && c.end >= c.start);
    cues.sort((a, b) => a.start - b.start || a.end - b.end);
    return cues;
  }

  function fmtTs(sec) {
    let ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); ms -= s * 1000;
    const p = (n, w) => String(n).padStart(w, '0');
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms, 3);
  }

  function toSrt(cues) {
    return cues.map((c, i) => (i + 1) + '\n' + fmtTs(c.start) + ' --> ' + fmtTs(c.end) + '\n' + (c.text || '') + '\n').join('\n');
  }

  /** Text of all cues active at time t (supports overlapping cues). `cues` must be sorted by start. */
  function at(cues, t) {
    if (!cues.length) return '';
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    const out = [];
    for (let i = idx, n = 0; i >= 0 && n < 24; i--, n++) if (cues[i].end >= t) out.unshift(cues[i].text);
    return out.join('\n');
  }

  return { decode, parse, parseSrtVtt, parseAss, parseTime, toSrt, at, fmtTs };
});
