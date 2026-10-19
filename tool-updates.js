'use strict';
/** Is a newer version of mpv / yt-dlp / deno / QuickJS / ffmpeg / whisper available? Free sources only (GitHub releases, gyan.dev).
 *  Pure + injectable fetch so it can be tested without a network. */
const SOURCES = {
  ytdlp: { name: 'yt-dlp', repo: 'yt-dlp/yt-dlp' },
  deno: { name: 'deno', repo: 'denoland/deno', group: 'js' },
  quickjs: { name: 'quickjs', repo: 'quickjs-ng/quickjs', group: 'js' },
  mpv: { name: 'mpv', repo: 'shinchiro/mpv-winbuild-cmake' },
  whisper: { name: 'whisper', repo: 'ggml-org/whisper.cpp' },
  ffmpeg: { name: 'ffmpeg', gyan: 'https://www.gyan.dev/ffmpeg/builds/release-version' }
};

const nums = (v) => (String(v || '').replace(/^[^\d]*/, '').match(/\d+/g) || []).map(Number);
function compareVersions(a, b) {
  const x = nums(a), y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

/** Version number out of the text a tool prints (null when it cannot be told). */
function parseInstalled(id, text) {
  const t = String(text || '');
  let m;
  switch (id) {
    case 'ytdlp': m = /(\d{4}\.\d{1,2}\.\d{1,2})/.exec(t); break;
    case 'deno': m = /deno\s+(\d+\.\d+\.\d+)/i.exec(t); break;
    case 'ffmpeg': m = /ffmpeg version\s+n?(\d+(?:\.\d+)*)/i.exec(t); break;
    case 'quickjs': m = /(\d+\.\d+\.\d+)/.exec(t); break;
    default: m = null;
  }
  return m ? m[1] : null;
}

async function latestVersion(id, fetchImpl) {
  const src = SOURCES[id];
  if (!src || !fetchImpl) return null;
  const headers = { 'User-Agent': 'ZephyrPlayer-update-check', Accept: 'application/vnd.github+json' };
  try {
    if (src.gyan) { const r = await fetchImpl(src.gyan, { headers }); return r && r.ok ? String(await r.text()).trim() : null; }
    const r = await fetchImpl('https://api.github.com/repos/' + src.repo + '/releases/latest', { headers });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && j.tag_name ? String(j.tag_name) : null;
  } catch { return null; }
}

/**
 * installed: { id: { path, versionText } }   recorded: { id: tag } (written by setup-tools.ps1 when it installs)
 * Returns [{ id, name, status: 'update'|'current'|'unknown'|'missing'|'offline', installed, latest }]
 */
async function checkUpdates({ installed, recorded, fetchImpl, ids }) {
  const out = [];
  const list = ids || Object.keys(SOURCES);
  const latest = await Promise.all(list.map((id) => latestVersion(id, fetchImpl)));
  list.forEach((id, i) => {
    const info = (installed || {})[id];
    const row = { id, name: SOURCES[id].name, installed: null, latest: latest[i] };
    if (!info || !info.path) { row.status = 'missing'; out.push(row); return; }
    const have = parseInstalled(id, info.versionText) || (recorded && recorded[id]) || null;
    row.installed = have;
    if (!latest[i]) row.status = 'offline';
    else if (!have) row.status = 'unknown';                    // installed by hand: version cannot be told, offer a refresh
    else row.status = compareVersions(have, latest[i]) < 0 ? 'update' : 'current';
    out.push(row);
  });
  return out;
}

module.exports = { SOURCES, compareVersions, parseInstalled, latestVersion, checkUpdates };
