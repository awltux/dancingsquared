// Extract the text of a PDF, dependency-free, so an authoritative external document can be
// analysed with the same care as a fixture.
//
// WHY THIS EXISTS. `docs/New_Mainstream_Definitions_26-03-29.pdf` is CALLERLAB's Mainstream
// definitions, and it is the authority for the calls this engine derives in code (a derived call's
// rule is a transcription of it, not a re-derivation - see PLAN.md Phase 9e-2). It is a PDF, so it
// needs reading; the online copy sits behind a Cloudflare challenge (HTTP 403 from the harness
// fetcher and from Node), which is why the local file is the source.
//
//   node test/tools/extract-pdf-text.mjs [path/to/file.pdf] [out.txt]
//
// It scans for `stream ... endstream`, inflates each payload, and reconstructs text by tracking the
// TEXT POSITION (Td / TD / Tm / T*) and the font size (Tf): a y change bigger than a line height is
// a new LINE, a same-line x jump is a SPACE, and anything smaller is a glyph-run split and must be
// concatenated. That last distinction is not cosmetic - the first version broke a line at every Td
// and produced one word per line, because some pages open a fresh BT/ET for every word.
//
// CALLERLAB's notice, as the document requires it to travel with the work:
//   © 1994, 2000-2026 by CALLERLAB Inc., The International Association of Square Dance Callers.
//   Permission to reprint, republish, and create derivative works without royalty is hereby
//   granted, provided this notice appears.
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const pdfPath = process.argv[2] ?? 'docs/New_Mainstream_Definitions_26-03-29.pdf';
const outPath = process.argv[3] ?? 'callerlab-ms.txt';

const buf = readFileSync(pdfPath);
const raw = buf.toString('latin1');

/** Every `stream ... endstream` payload, inflated when it is zlib or raw-deflate. */
function streams() {
  const out = [];
  let i = 0;
  for (;;) {
    const s = raw.indexOf('stream', i);
    if (s < 0) break;
    let start = s + 6;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    const e = raw.indexOf('endstream', start);
    if (e < 0) break;
    const chunk = buf.subarray(start, e);
    i = e + 9;
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync, (b) => b]) {
      try { out.push(fn(chunk)); break; } catch { /* try the next */ }
    }
  }
  return out;
}

/** Decode the body of a PDF literal string (escapes and octal). */
function unescape(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += ' ';
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n ?? '';
  }
  return out;
}

const TOKEN = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\/[^\s/<>[\]()]+|[-+]?[0-9]*\.?[0-9]+|\bTd\b|\bTD\b|\bTm\b|\bT\*\b|\bTf\b|\bTJ\b|\bTj\b|\bBT\b|\bET\b/g;

/** The lines of one content stream. */
function textOf(content) {
  const src = content.toString('latin1');
  const stack = [];
  let x = 0, y = 0, size = 10;
  let lastY = null, lastXEnd = null;
  let line = '';
  const lines = [];
  const flush = () => { if (line.trim()) lines.push(line); line = ''; };
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    const t = m[0];
    if (t === 'Tf') {
      const sz = stack[stack.length - 1];
      if (typeof sz === 'number' && sz > 0) size = sz;
      stack.length = 0;
    } else if (t === 'Td' || t === 'TD') {
      const ty = stack[stack.length - 1], tx = stack[stack.length - 2];
      if (typeof tx === 'number') x += tx;
      if (typeof ty === 'number') y += ty;
      stack.length = 0;
    } else if (t === 'Tm') {
      const f = stack[stack.length - 1], e = stack[stack.length - 2];
      if (typeof e === 'number') x = e;
      if (typeof f === 'number') y = f;
      stack.length = 0;
    } else if (t === 'T*') {
      y -= size * 1.2;
      stack.length = 0;
    } else if (t === 'BT' || t === 'ET') {
      // Deliberately no position reset and no flush: some pages open a fresh BT/ET per word.
      stack.length = 0;
    } else if (t === 'Tj' || t === 'TJ') {
      let text = '';
      for (const op of stack) {
        if (typeof op === 'string') text += op;
        else if (typeof op === 'number' && op < -120) text += ' '; // kerning wide enough to be a space
      }
      if (text) {
        const lineJump = Math.max(4, size * 0.6);
        if (lastY === null) { lastY = y; lastXEnd = x; }
        else if (Math.abs(y - lastY) > lineJump) { flush(); lastY = y; lastXEnd = x; }
        else if (x - (lastXEnd ?? x) > size * 0.22 && !line.endsWith(' ') && !text.startsWith(' ')) line += ' ';
        line += text;
        lastXEnd = x + text.length * size * 0.5;
      }
      stack.length = 0;
    } else if (t.startsWith('(')) {
      stack.push(unescape(t.slice(1, -1)));
    } else if (t.startsWith('<') && t.length > 2) {
      const hex = t.slice(1, -1).replace(/\s+/g, '');
      if (/^[0-9A-Fa-f]+$/.test(hex) && hex.length % 2 === 0) {
        let s = '';
        for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        stack.push(s);
      }
    } else if (t.startsWith('/')) {
      stack.push({ name: t });
    } else if (/^[-+]?[0-9]/.test(t)) {
      stack.push(parseFloat(t));
    }
  }
  flush();
  return lines;
}

const pages = [];
for (const s of streams()) {
  const lines = textOf(s);
  if (lines.some((l) => l.trim())) pages.push(lines.join('\n'));
}
const text = pages.join('\n')
  .replace(/\r/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n');
writeFileSync(outPath, text, 'utf8');
console.log(`${pdfPath}: ${streams().length} streams, ${pages.length} text sections, ${text.length} chars -> ${outPath}`);
