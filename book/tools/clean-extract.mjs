// Produce a CLEAN, READABLE copy of each CALLERLAB manual for authoring.
//
// mojibake-check:allow — class 1 below is written out as the literal sequence this tool repairs, so
// this file legitimately contains mojibake; see the gate in check-links.mjs.
//
// WHY THIS EXISTS. The book's content is the March-2026 Mainstream manual and the
// August-2026 Plus manual, and both are PDFs. The repo already has a dependency-free
// extractor for them (`engine/test/tools/extract-pdf-text.mjs`); this tool INVOKES it
// unchanged and then repairs the artefact classes its output carries, because the prose
// is going to be read closely:
//
//   1. UTF-8 read as latin1        `Â©` -> `©`,  `Â´` -> `´`
//   2. glyph runs shifted by +29   `+ D Q G V` -> `Hands`,  `7 K H` -> `The`
//      (a font the extractor does not decode, where every byte is offset and
//      space-interleaved)
//   3. spurious intra-word spaces  `D ance` -> `Dance`,  `C ouple` -> `Couple`
//
// Repairs 2 and 3 are heuristics, so this tool is built to REPORT rather than to smooth
// silently: every repair is counted, and anything left suspicious at the end is reported
// with its line number. An extract that looked clean and was not would be worse than one
// that visibly needs a PDF check.
//
// MEASURED on the 2026-03-29 and 2026-08-25 manuals: repair 1 hits a handful of lines
// (the `Â©` in the copyright line); repairs 2 and 3 hit nothing that is not already
// readable, because this extractor run reconstructs those regions correctly. The
// apparatus is kept because the same document extracted by an older build of the
// extractor DOES carry +29 runs (the repo-root `callerlab-ms.txt` carries one), and a
// reading copy that silently lost text would be the expensive failure.
//
// The output goes to `book/tools/.cache/`, NEVER to the extractor's default
// `callerlab-ms.txt` at the repo root: that file is another workstream's artefact and is
// gitignored as "not ours to redistribute by default".
//
//   node book/tools/clean-extract.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
const extractor = join(root, 'engine', 'test', 'tools', 'extract-pdf-text.mjs');

const SOURCES = [
  { key: 'mainstream', pdf: join(root, 'docs', 'New_Mainstream_Definitions_26-03-29.pdf') },
  { key: 'plus', pdf: join(root, 'docs', 'Plus-Definitions-26-08-25.pdf') },
];

mkdirSync(cache, { recursive: true });

/**
 * Repair 1: one line that is UTF-8 bytes read as latin1.
 *
 * Applied PER LINE, not to the whole document: a single undecodable sequence anywhere
 * would otherwise cause a whole-document re-decode to be rejected (or, worse, accepted
 * with U+FFFD scattered through it). A line is only re-decoded when it carries the
 * signature and survives without a replacement character.
 */
export function fixMojibakeLine(line) {
  if (!/[\u00c2\u00c3]/.test(line)) return line;
  const fixed = Buffer.from(line, 'latin1').toString('utf8');
  if (fixed.includes('\uFFFD')) return line;
  return fixed;
}

/**
 * Repair 2: a line that is UTF-16BE text whose every code unit sits 29 BELOW the intended
 * character.
 *
 * The signature is a NUL byte before every character: `\u0000$ \u0000G \u0000G \u0000H
 * \u0000G` decodes to code units 0x24 0x47 0x47 0x48 0x47, and adding 29 to each gives
 * "Added". The word spaces fall out of the same arithmetic -- 0x0003 + 29 is the space
 * character -- which is why this region has no interleaving to strip.
 *
 * Accepted only when every shifted unit lands on printable ASCII, so a genuinely corrupted
 * line is reported rather than silently mangled.
 */
export function decodeUtf16Shifted(line) {
  const miss = { text: line, decoded: false, approximate: 0 };
  if (!line.includes('\u0000') || line.length < 8 || line.length % 2 !== 0) return miss;

  // Require the UTF-16 SHAPE -- the great majority of even-index characters being NUL --
  // because hundreds of ordinary lines merely contain one stray NUL, and pairing those
  // from index 0 would produce confident garbage.
  const even = line.length / 2;
  let nulAtEven = 0;
  for (let i = 0; i < line.length; i += 2) if (line.charCodeAt(i) === 0) nulAtEven++;
  if (nulAtEven / even < 0.8) return miss;

  const units = [];
  for (let i = 0; i + 1 < line.length; i += 2) {
    units.push((line.charCodeAt(i) << 8) | line.charCodeAt(i + 1));
  }

  // Quote glyphs are NOT part of the +29 alphabet, so they are mapped explicitly; leaving
  // them out is what made the first version of this repair decode nothing at all.
  const QUOTES = new Map([
    [0x00b4, '"'],
    [0x00b5, '"'],
    [0x0091, "'"],
    [0x0092, "'"],
    [0x2018, "'"],
    [0x2019, "'"],
    [0x201c, '"'],
    [0x201d, '"'],
  ]);

  let approximate = 0;
  const chars = units.map((u) => {
    if (QUOTES.has(u)) return QUOTES.get(u);
    const c = u + 29;
    if (c >= 0x20 && c <= 0x7e) return String.fromCharCode(c);
    // A unit that is not in the +29 alphabet (0xB7 is the one measured) is KEPT rather than
    // dropped, and counted, so the line still reads and the imprecision is visible.
    approximate++;
    return u >= 0x20 && u <= 0xff ? String.fromCharCode(u) : '?';
  });

  const text = chars.join('').replace(/ {2,}/g, ' ');
  const printable = (text.match(/[\x20-\x7e]/g) ?? []).length;
  if (printable / Math.max(1, text.length) < 0.7) return miss;
  if (!/[A-Za-z]{3}/.test(text)) return miss;
  return { text: text.trim(), decoded: true, approximate };
}

/**
 * Repair 3: decode a run of space-interleaved single characters whose codes sit 29 BELOW
 * the intended character.
 *
 * The signature is a run of >= 4 single characters each followed by one space, e.g.
 * `+ D Q G V` = "Hands" and `$ U P V` = "Arms". Word boundaries survive as two or more
 * consecutive spaces. The curly-quote bytes come through as the two-character mojibake
 * `Â´` / `Âµ` and are restored to `"`.
 *
 * The run is only decoded when EVERY single-character token lands on printable ASCII after
 * the shift, and multi-character tokens abort the decode outright -- which is what leaves
 * genuine content such as a formation layout `54 8 3 7 2 6 1` or a dancer grid
 * `EE C C E E C C` exactly as it is.
 */
export function decodeShiftedRuns(line) {
  let decoded = 0;
  // Punctuation is not shifted, and it arrives ATTACHED to the character it follows
  // (`K.` for the "h." ending "crash."). Handling it per character rather than per token is
  // what makes those runs decodable at all -- treating `K.` as a two-character token
  // aborted the whole run.
  const KEEP_PUNCT = new Set(['"', "'", '.', ',', '!', '?', '(', ')', '-', ':', ';', '\u00b4', '\u00b5']);
  const mapChar = (c) => {
    if (c === '\u00b4' || c === '\u00b5') return '"';
    if (KEEP_PUNCT.has(c)) return c;
    const shifted = c.charCodeAt(0) + 29;
    return shifted >= 0x20 && shifted <= 0x7e ? String.fromCharCode(shifted) : null;
  };

  const out = line.replace(/(?<!\S)((?:\S{1,2} ){3,}\S{1,2})(?!\S)/g, (run) => {
    const tokens = run.trimEnd().split(/ {2,}/);
    let ok = true;
    const words = tokens.map((word) =>
      word
        .trim()
        .split(' ')
        .map((t) => {
          let out2 = '';
          for (const c of t) {
            const m = mapChar(c);
            if (m === null) {
              ok = false;
              return t;
            }
            out2 += m;
          }
          return out2;
        })
        .join(''),
    );
    if (!ok) return run;
    const text = words.join(' ');
    if (!/[A-Za-z]{3}/.test(text)) return run;
    decoded++;
    return text;
  });
  return { text: out, decoded };
}

/**
 * Repair 3: rejoin a word the extractor split after its first letter.
 *
 * Self-validating rather than dictionary-driven: `D ance` is only rejoined when `Dance`
 * already appears elsewhere in the document as one token. That is what stops a legitimate
 * `A couple` becoming `Acouple` -- the document never uses `Acouple`.
 */
export function rejoinSplitWords(lines) {
  const freq = tokenFrequency(lines);
  let joined = 0;
  const out = lines.map((line) =>
    line.replace(/\b([A-Z]) ([a-z]{2,})\b/g, (whole, head, tail) => {
      if ((freq.get(head + tail) ?? 0) < 1) return whole;
      joined++;
      return head + tail;
    }),
  );
  return { lines: out, joined, freq };
}

/**
 * Repair 4: a whole WORD whose characters are shifted by 29 with NO space interleaving,
 * e.g. `&DOOHUV` = "Callers" and `ZLOO` = "will". This is the same font problem as the
 * interleaved runs, in the places where the extractor did not interleave.
 *
 * Self-validating, and guarded twice: a token is only replaced when it is NOT itself a word
 * the document uses, when every shifted character lands on a letter, and when the result IS
 * a word the document uses elsewhere. A real word therefore cannot be rewritten into
 * another real word.
 */
export function decodeShiftedWords(lines, freq) {
  let decoded = 0;
  // Punctuation is NOT shifted by the font; it arrives as itself. These are the characters
  // that stay put, including the 0xB4/0xB5 quote bytes that `cosmetic` later turns into
  // straight quotes.
  const KEEP = new Set([
    '"', "'", '.', ',', '!', '?', '-', '(', ')', ';', ':', '\u00b4', '\u00b5',
  ]);
  const strip = (s) => s.replace(/["'.,!?()\-:;\u00b4\u00b5]/g, '');

  const out = lines.map((line) =>
    line.replace(/\S{3,}/g, (tok) => {
      if (freq.has(tok)) return tok;
      // The word separators inside a shifted run are the control character 0x03, which the
      // same +29 shift turns into an ordinary space.
      const shifted = [...tok]
        .map((c) => (KEEP.has(c) ? c : String.fromCharCode(c.charCodeAt(0) + 29)))
        .join('');
      const parts = shifted.split(' ').filter(Boolean).map(strip);
      if (!parts.length || !parts.every((p) => /^[A-Za-z]*$/.test(p))) return tok;
      if (!parts.some((p) => p.length >= 2 && freq.has(p))) return tok;
      decoded++;
      return shifted;
    }),
  );
  return { lines: out, decoded };
}

/**
 * Repair 5 (cosmetic): the extract sprinkles stray NUL characters through ordinary prose,
 * and the curly quotes of the PDF arrive as the Latin-1 bytes 0xB4/0xB5. Neither is
 * information, and both make the text unpleasant to read, so they are normalised away.
 */
export function cosmetic(line) {
  let out = line.replace(/\u0000/g, '');
  out = out.replace(/\u00b4([^\u00b4\u00b5]{0,120}?)\u00b5/g, '"$1"');
  out = out.replace(/[\u00b4\u00b5]/g, '"');
  return out;
}

function tokenFrequency(lines) {
  const freq = new Map();
  for (const line of lines) {
    for (const tok of line.match(/[A-Za-z]+/g) ?? []) freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  return freq;
}

/**
 * Anything still suspicious after the repairs: reported, never hidden.
 *
 * A split-word candidate is only reported when rejoining it WOULD have produced a token
 * the document uses -- the same test the repair itself applies -- so a perfectly ordinary
 * `A couple` is not reported as a possible defect.
 */
export function suspicious(line, freq) {
  const findings = [];
  if (line.includes('\u0000')) findings.push('undecoded UTF-16 region');
  const shifted = (line.match(/\b(?:[\x20-\x7e] ){4,}/g) ?? []).length;
  if (shifted) findings.push(`${shifted} possible shifted run(s)`);
  if (/[\u00c2\u00c3][\u0080-\u00bf]/.test(line)) findings.push('possible latin1/utf8 mojibake');
  const splits = (line.match(/\b([A-Z]) ([a-z]{2,})\b/g) ?? []).filter((m) => {
    const [head, tail] = m.split(' ');
    return (freq.get(head + tail) ?? 0) > 0;
  }).length;
  if (splits) findings.push(`${splits} possible split word(s)`);
  return findings;
}

let failed = false;

export function main() {
  failed = false;

  for (const { key, pdf } of SOURCES) {
    if (!existsSync(pdf)) {
      console.error(`SKIP ${key}: no PDF at ${pdf}`);
      console.error('     (docs/ is untracked; re-supply the manual and re-run)');
      failed = true;
      continue;
    }

    const raw = join(cache, `${key}.raw.txt`);
    execFileSync(process.execPath, [extractor, pdf, raw], { stdio: 'inherit' });

    const original = readFileSync(raw, 'utf8');

    let mojibake = 0;
    const lines = original.split('\n').map((line) => {
      const fixed = fixMojibakeLine(line);
      if (fixed !== line) mojibake++;
      return fixed;
    });

    let decoded = 0;
    const decodedLines = lines.map((line) => {
      const utf16 = decodeUtf16Shifted(line);
      if (utf16.decoded) decoded++;
      // NUL becomes a SPACE before the run decoder, because that is what it is: the
      // separator of the space-interleaved font regions. Normalising it here turns those
      // regions into exactly the `X X X X` run shape the next repair already understands.
      // (It must come after the UTF-16 repair, which needs the NULs.)
      const r = decodeShiftedRuns(utf16.text.replace(/\u0000/g, ' '));
      decoded += r.decoded;
      return r.text;
    });

    const rejoined = rejoinSplitWords(decodedLines);
    const words = decodeShiftedWords(rejoined.lines, rejoined.freq);
    rejoined.lines = words.lines.map(cosmetic);
    decoded += words.decoded;

    const report = [];    rejoined.lines.forEach((line, i) => {
      const findings = suspicious(line, rejoined.freq);
      if (findings.length) {
        report.push(`  line ${i + 1}: ${findings.join('; ')} | ${line.trim().slice(0, 90)}`);
      }
    });

    const cleaned = join(cache, `${key}.cleaned.txt`);
    writeFileSync(cleaned, rejoined.lines.join('\n'), 'utf8');

    const reportPath = join(cache, `${key}.report.txt`);
    writeFileSync(
      reportPath,
      [
        `${key}: ${pdf}`,
        `  characters             ${original.length}`,
        `  mojibake lines fixed   ${mojibake}`,
        `  shifted runs decoded   ${decoded}`,
        `  split words rejoined   ${rejoined.joined}`,
        `  still suspicious       ${report.length} line(s) reported below`,
        '',
        ...report,
        '',
      ].join('\n'),
      'utf8',
    );

    console.log(
      `${key}: ${original.length} chars -> ${cleaned}; ` +
        `${mojibake} mojibake line(s) fixed, ${decoded} shifted run(s) decoded, ` +
        `${rejoined.joined} split word(s) rejoined, ` +
        `${report.length} line(s) still suspicious (${reportPath})`,
    );
  }

  return failed ? 1 : 0;
}

// Only act when run directly: importing this module for its exported repairs must not
// re-extract the manuals or kill the importing process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
