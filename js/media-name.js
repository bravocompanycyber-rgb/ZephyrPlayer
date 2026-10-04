'use strict';
/**
 * Turns messy file names into something searchable.
 *   "The.Mandalorian.S02E03.1080p.WEB-DL.x265-GRP.mkv" -> { kind:'tv', title:'The Mandalorian', season:2, episode:3 }
 *   "Inception (2010) [1080p] BluRay.mp4"               -> { kind:'movie', title:'Inception', year:2010 }
 *   "03 - Daft Punk - Get Lucky.mp3"                    -> { kind:'music', artist:'Daft Punk', title:'Get Lucky' }
 * Pure functions, no I/O (works in Node and the browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZName = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAGS = new RegExp('\\b(' + [
    '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'hdr10\\+?', 'hdr', 'dv', 'dolby[ ._-]?vision', 'bluray', 'blu[ ._-]?ray', 'bdrip', 'brrip', 'bdremux', 'remux',
    'web[ ._-]?dl', 'webrip', 'web', 'hdtv', 'pdtv', 'dvdrip', 'dvdscr', 'dvd', 'hdrip', 'hdcam', 'cam', 'telesync', 'ts', 'x264', 'x265', 'h[ ._-]?264', 'h[ ._-]?265', 'hevc', 'avc', 'xvid', 'divx', 'av1', 'vp9',
    '10[ ._-]?bit', '8[ ._-]?bit', 'aac(?:[ ._-]?\\d(?:[ ._-]\\d)?)?', 'ac3', 'eac3', 'dd[p+]?(?:[ ._-]?\\d(?:[ ._-]\\d)?)?', 'dts(?:[ ._-]?hd)?', 'truehd', 'atmos', 'flac', 'mp3',
    'proper', 'repack', 'extended', 'unrated', 'uncut', 'remastered', 'directors?[ ._-]cut', 'imax', 'multi', 'dual[ ._-]?audio', 'subbed', 'dubbed', 'subs?', 'esubs?', 'internal', 'limited', 'complete', 'nf', 'amzn', 'dsnp', 'hmax', 'atvp', 'hulu'
  ].join('|') + ')\\b', 'i');

  const AUDIO_EXT = /\.(mp3|flac|wav|aac|m4a|m4b|opus|ogg|oga|wma|ape|wv|mka|aiff?|ac3|eac3|dts|amr|mpc|tta)$/i;
  const SEP = /[._]+/g;

  function stripExt(name) { return String(name || '').replace(/\.[A-Za-z0-9]{2,4}$/, ''); }
  function tidy(s) {
    return String(s || '').replace(SEP, ' ').replace(/\s*[-–—]\s*$/g, '').replace(/^\s*[-–—]\s*/g, '').replace(/\s+/g, ' ').replace(/^[\s\-:,]+|[\s\-:,]+$/g, '').trim();
  }
  function stripBrackets(s) {
    return s.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\((?!\s*(19|20)\d{2}\s*\))[^)]*\)/g, ' ');
  }
  function cutAtTags(s) {
    const m = TAGS.exec(s);
    return m ? s.slice(0, m.index) : s;
  }
  function pickYear(s) {
    // the last plausible year that is not the very first token (titles like "2012" or "1917")
    const re = /(?:^|[\s.(_\-\[])((?:19|20)\d{2})(?=$|[\s.)_\-\]])/g;
    let m, last = null;
    while ((m = re.exec(s))) { if (m.index > 0 || last === null) last = { year: parseInt(m[1], 10), index: m.index + (m[0].length - m[1].length) }; }
    return last;
  }

  function parse(fileName, opts) {
    opts = opts || {};
    const raw = stripExt(fileName);
    const isAudio = opts.audio === true || (opts.audio !== false && AUDIO_EXT.test(String(fileName || '')));

    if (isAudio) {
      let s = tidy(stripBrackets(raw.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')));
      let artist = opts.artist || '';
      let title = opts.title || s;
      if (!opts.title) {
        const parts = s.split(/\s+[-–—]\s+/);
        if (parts.length >= 2) { artist = artist || parts[0]; title = parts.slice(1).join(' - '); }
      }
      return { kind: 'music', title: tidy(title), artist: tidy(artist), year: null, season: null, episode: null };
    }

    let s = stripBrackets(raw);

    // ---- TV: S01E02 / 1x02 / Season 1 Episode 2
    let m = /(?:^|[\s._\-])s(\d{1,2})[\s._\-]?e(\d{1,3})(?:[\s._\-]?e\d{1,3})*(?=$|[\s._\-])/i.exec(s);
    if (!m) m = /(?:^|[\s._\-])(\d{1,2})x(\d{2,3})(?=$|[\s._\-])/i.exec(s);
    if (!m) m = /season[\s._\-]*(\d{1,2})[\s._\-,]*(?:episode|ep)[\s._\-]*(\d{1,3})/i.exec(s);
    if (m) {
      const show = tidy(cutAtTags(s.slice(0, m.index)).replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').replace(/\s+(?:19|20)\d{2}\s*$/, ''));
      const after = tidy(cutAtTags(s.slice(m.index + m[0].length)));
      return {
        kind: 'tv', title: show || tidy(s), season: parseInt(m[1], 10), episode: parseInt(m[2], 10),
        year: null, episodeHint: after && after.length < 80 ? after : ''
      };
    }

    // ---- movie
    const y = pickYear(s);
    let head = y ? s.slice(0, y.index) : s;
    head = cutAtTags(head);
    let title = tidy(head.replace(/[(\[]\s*$/, ''));
    if (!title) title = tidy(cutAtTags(s)) || tidy(raw);
    return { kind: 'movie', title, year: y ? y.year : null, season: null, episode: null };
  }

  return { parse, AUDIO_EXT };
});
