const H = require('./helpers');
const Z = require(H.ROOT + '/js/subtitle-parser.js'); const assert = require('assert');
// VTT without hours (broke the old parser), with cue settings, NOTE, tags, entities
const vtt = 'WEBVTT\n\nNOTE hi\n\n1\n00:01.000 --> 00:03.500 line:90% align:center\n<i>Hello</i> &amp; <c.yellow>world</c>\n\n01:00:00.000 --> 01:00:02.000\nLate';
let c = Z.parse(vtt); assert.strictEqual(c.length, 2); assert.strictEqual(c[0].text, 'Hello & world'); assert.strictEqual(c[0].end, 3.5); assert.strictEqual(c[1].start, 3600);
// SRT with overlapping cues + {\an8}
const srt = '1\r\n00:00:01,000 --> 00:00:05,000\r\n{\\an8}Top\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nSecond\r\n';
c = Z.parse(srt); assert.strictEqual(Z.at(c, 2.5), 'Top\nSecond'); assert.strictEqual(Z.at(c, 4), 'Top'); assert.strictEqual(Z.at(c, 6), ''); assert.strictEqual(Z.at(c, 0.5), '');
// ASS: commas in text, overrides, \N
const ass = '[Script Info]\nTitle: x\n[V4+ Styles]\nFormat: Name\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:04.00,Default,,0,0,0,,{\\i1}Well, hello{\\i0}\\Nthere, friend\nComment: 0,0:00:01.50,0:00:04.00,Default,,0,0,0,,ignored';
c = Z.parse(ass); assert.strictEqual(c.length, 1); assert.strictEqual(c[0].text, 'Well, hello\nthere, friend'); assert.strictEqual(c[0].start, 1.5);
// encoding: windows-1252 bytes (é = 0xE9) must not become U+FFFD; UTF-16LE with BOM
assert.strictEqual(Z.decode(Uint8Array.from([0x63, 0x61, 0x66, 0xE9])), 'café');
assert.strictEqual(Z.decode(Uint8Array.from([0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00])), 'hi');
assert.strictEqual(Z.decode(new TextEncoder().encode('日本語')), '日本語');
// SRT round trip with ms rounding
const out = Z.toSrt([{ start: 1.9996, end: 3, text: 'a' }]); assert(out.includes('00:00:02,000 --> 00:00:03,000'), out);
assert.strictEqual(Z.parse(Z.toSrt(c))[0].text, 'Well, hello\nthere, friend');
console.log('subtitle-parser OK');
