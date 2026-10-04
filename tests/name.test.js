const H = require('./helpers');
const Z = require(H.ROOT + '/js/media-name.js'); const assert = require('assert');
const cases = [
  ['The.Mandalorian.S02E03.1080p.WEB-DL.DDP5.1.x265-GRP.mkv', { kind: 'tv', title: 'The Mandalorian', season: 2, episode: 3 }],
  ['Breaking Bad - S05E14 - Ozymandias.mkv', { kind: 'tv', title: 'Breaking Bad', season: 5, episode: 14 }],
  ['friends.1x08.the.one.with.the.pothole.avi', { kind: 'tv', title: 'friends', season: 1, episode: 8 }],
  ['Game of Thrones (2011) S01E01 720p.mp4', { kind: 'tv', title: 'Game of Thrones', season: 1, episode: 1 }],
  ['Show Name Season 2 Episode 10.mp4', { kind: 'tv', title: 'Show Name', season: 2, episode: 10 }],
  ['Inception (2010) [1080p] BluRay.mp4', { kind: 'movie', title: 'Inception', year: 2010 }],
  ['Mad.Max.Fury.Road.2015.2160p.UHD.BluRay.x265.10bit.HDR.mkv', { kind: 'movie', title: 'Mad Max Fury Road', year: 2015 }],
  ['1917.2019.1080p.BluRay.x264.mkv', { kind: 'movie', title: '1917', year: 2019 }],
  ['2012 (2009) 720p BRRip.mp4', { kind: 'movie', title: '2012', year: 2009 }],
  ['Blade Runner 2049 2017 1080p WEB-DL.mkv', { kind: 'movie', title: 'Blade Runner 2049', year: 2017 }],
  ['Some Home Video.mp4', { kind: 'movie', title: 'Some Home Video', year: null }],
  ['Interstellar.mkv', { kind: 'movie', title: 'Interstellar', year: null }],
  ['03 - Daft Punk - Get Lucky.mp3', { kind: 'music', title: 'Get Lucky', artist: 'Daft Punk' }],
  ['Adele - Hello.flac', { kind: 'music', title: 'Hello', artist: 'Adele' }],
  ['01. Bohemian Rhapsody.m4a', { kind: 'music', title: 'Bohemian Rhapsody', artist: '' }],
];
for (const [name, want] of cases) { const got = Z.parse(name); for (const k of Object.keys(want)) assert.strictEqual(got[k], want[k], name + ' -> ' + k + ': ' + JSON.stringify(got)); }
const t = Z.parse('track.mp3', { artist: 'Tag Artist', title: 'Tag Title' }); assert(t.artist === 'Tag Artist' && t.title === 'Tag Title');
assert.strictEqual(Z.parse('Dune.Part.Two.2024.1080p.mkv').title, 'Dune Part Two');
console.log('media-name OK (' + cases.length + ' cases)');
