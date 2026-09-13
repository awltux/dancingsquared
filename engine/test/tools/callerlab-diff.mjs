// PHASE C ANALYSIS TOOL (not a harness): the CALLERLAB Mainstream definitions against the engine.
//
// The PDF is the AUTHORITY on which calls are Mainstream and what each one may start from
// (`docs/New_Mainstream_Definitions_26-03-29.pdf`, read with test/tools/extract-pdf-text.mjs). This
// compares three things:
//
//   (A) CALLS the definitions list that the engine cannot perform at all.
//   (B) for calls it CAN perform, documented starting formations that appear in NONE of that call's
//       `<tam from="...">` setups.
//   (C) documented starting-formation NAMES the engine has no formation for.
//
// (A) is exact, because call names are names. (B) and (C) are only as good as the NAME MAPPING
// between CALLERLAB's vocabulary and the engine's formation names, so they are reported as raw
// material for adjudication rather than as verdicts - that adjudication is Phase 16.
//
//   node test/tools/extract-pdf-text.mjs docs/New_Mainstream_Definitions_26-03-29.pdf callerlab-ms.txt
//   node test/tools/callerlab-diff.mjs
//
// The extracted text is NOT checked in - it is CALLERLAB's document, regenerated on demand, and it
// must travel with CALLERLAB's notice when it does.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { STANDARD_FORMATIONS } from '../../dist/sequencer/constants.js';
import { callsByTitle, implementedTitles, catalogueTitles, engineNameFor } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.resolve(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// ------------------------------------------------------------------ read the definitions
const raw = readFileSync(path.join(root, 'callerlab-ms.txt'), 'utf8')
  .replace(/\u00AD/g, '')      // soft hyphens the extractor leaves inside words
  .replace(/\u00A0/g, ' ')     // nbsp
  .replace(/Ã‚Â´|Ã‚Âµ|Ã¢â‚¬â„¢/g, "'") // mojibake for the extraction's apostrophes
  .replace(/Ã‚Â©/g, '(c)');
const lines = raw.split('\n').map((l) => l.replace(/\s+$/, ''));

const FIELD = /^(Dance action|Timing|Command examples?|Ending formations?|Comment|Styling|Teaching|Calling|Note|General|Introduction|History|Scope|Approach)\b/i;
const CALLNAME = /^[A-Z][A-Za-z0-9'â€™/&.,\- ]{1,58}$/;
const isPageNo = (s) => /^\s*\d{1,3}\s*$/.test(s);
const isCaseLabel = (s) => /^[a-z](\.[a-z])?\.\s/.test(s) || /^Case\s/i.test(s);
/** "b.y. Allemande Left Case 2 (4 dancers)" -> "Allemande Left"; also flags the doc's family headings. */
function callNameOf(s) {
  const c = s
    .replace(/^[a-z](\.[a-z])?\.\s*/, '')
    .replace(/^Case\s+\d+:\s*/i, '')
    .replace(/\s+Case\s+\d+.*$/i, '')
    .replace(/\s*\(\s*\d+\s*dancers?\s*\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { name: c, family: /\bFamily\b/i.test(c) || /^(The )?(Arm Turn|Circle|Hinge|Trade|Star|Turn Back|Tag the Line|Right and Left Grand|Fold)\b/i.test(c) && /Family/i.test(s) };
}

const entries = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*Starting formations?:\s*(.*)$/);
  if (!m) continue;
  // the call name is the nearest preceding line that reads like a title, once the doc's
  // case-label prefixes are stripped
  let call = null; let caseLabel = null; let family = null;
  for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
    const s = lines[j].trim();
    if (!s || isPageNo(s)) continue;
    if (/^Starting formations?:/i.test(s)) continue;
    const { name, family: isFam } = callNameOf(s);
    if (caseLabel === null && (isCaseLabel(s) || /^\d+\.\s/.test(s))) { caseLabel = name; continue; }
    if (FIELD.test(s)) break;
    if (isFam) { family = name; break; }
    if (s.endsWith('.') || s.endsWith(',')) continue;
    if (CALLNAME.test(name) && /[A-Za-z]/.test(name)) { call = name; break; }
    break;
  }
  // the formation list runs on until the next field label
  const parts = [m[1]];
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    const s = lines[j].trim();
    if (!s || FIELD.test(s) || isPageNo(s)) break;
    parts.push(s);
  }
  const listRaw = parts.join(' ').replace(/\s+/g, ' ').trim();
  const formations = listRaw
    .split(/\s*,\s*|\s+or\s+|\s+and\s+(?=[A-Z])/)
    .map((f) => f.replace(/\([^)]*\)/g, '').trim())
    .filter((f) => f.length > 1 && f.length < 60);
  entries.push({ call, caseLabel, family, listRaw, formations, line: i + 1 });
}

console.log(`=== parsed ${entries.length} "Starting formation" sections from ${path.basename('callerlab-ms.txt')} ===`);
const unnamed = entries.filter((e) => !e.call);
console.log(`  ${unnamed.length} could not be attributed to a call name; first few: ${unnamed.slice(0, 5).map((e) => `line ${e.line}`).join(', ')}`);

// ------------------------------------------------------------------ (A) calls the engine lacks
const implemented = implementedTitles(assets);
const catalogue = catalogueTitles(assets);
const pdfCalls = new Map(); // engine-canonical call name -> entries
const families = new Set();
for (const e of entries) {
  if (!e.call && e.family) { families.add(e.family); continue; }
  if (!e.call) continue;
  // "Swing Thru / Left Swing Thru" is the doc naming two calls in one heading
  for (const one of e.call.split(/\s*\/\s*/)) {
    const engineName = engineNameFor(one);
    if (!pdfCalls.has(engineName)) pdfCalls.set(engineName, []);
    pdfCalls.get(engineName).push(e);
  }
}
console.log(`  ${families.size} family headings (the doc's own grouping), e.g. ${[...families].slice(0, 4).join(' | ')}`);
const missing = [...pdfCalls.keys()].filter((c) => !implemented.has(c)).sort();
console.log(`\n=== (A) documented calls the engine cannot perform at all: ${missing.length} of ${pdfCalls.size} ===`);
const figFreq = new Map();
{
  const data = loadAll8Figures();
  for (const f of data.figures) for (const c of figureEngineCalls(f)) figFreq.set(c, (figFreq.get(c) ?? 0) + 1);
}
for (const c of missing) {
  const indexed = catalogue.has(c) ? 'IN THE INDEX, no implementation' : 'not even indexed';
  const used = figFreq.get(c) ?? 0;
  console.log(`  ${c.padEnd(30)} ${indexed.padEnd(34)} figures using it: ${used}`);
}

// ------------------------------------------------------------------ (B)+(C) starting formations
const tamFrom = new Map(); // title -> Set(from)
for (const { name, xml } of callsByTitle(assets)) {
  const froms = new Set();
  for (const m of xml.matchAll(/\bfrom="([^"]*)"/g)) froms.add(m[1]);
  tamFrom.set(name, froms);
}
const norm = (s) => s.toLowerCase().replace(/[-â€“]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const knownFormations = new Set();
for (const lv of ['ms', 'plus', 'b1', 'b2', 'ssd', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b', 'src']) {
  const p = path.join(assets, lv);
  try {
    for (const m of readFileSync(path.join(p, '..', 'formations.xml'), 'utf8').matchAll(/<formation\b[^>]*\bname="([^"]*)"/g)) knownFormations.add(norm(m[1]));
    break;
  } catch { /* formations.xml lives at the asset root */ }
}
for (const m of readFileSync(path.join(assets, 'formations.xml'), 'utf8').matchAll(/<formation\b[^>]*\bname="([^"]*)"/g)) knownFormations.add(norm(m[1]));
for (const f of STANDARD_FORMATIONS) knownFormations.add(norm(f));

const unknownFormation = new Map(); // documented formation name -> calls asking for it
const notASetup = [];                // (call, formation) with no matching from= anywhere
let pairs = 0, matched = 0, prose = 0;
const PROSEISH = /\.\s|\.$|\b(are|is|the two|which|while|when|that|their|they|usually|generally|more)\b/i;
for (const [call, es] of pdfCalls) {
  if (!implemented.has(call)) continue;
  const froms = tamFrom.get(call) ?? new Set();
  const fromsN = new Set([...froms].map(norm));
  for (const e of es) {
    for (const fm of e.formations) {
      const n = norm(fm);
      if (!n) continue;
      pairs++;
      // the extractor leaves sentences inside the list; counting them as "unknown formations"
      // would inflate the gap, so they are separated out and reported as noise instead
      if (PROSEISH.test(fm)) { prose++; continue; }
      if (!knownFormations.has(n)) {
        matched += 0;
        if (!unknownFormation.has(fm)) unknownFormation.set(fm, new Set());
        unknownFormation.get(fm).add(call);
        continue;
      }
      const hit = [...fromsN].some((f) => f === n || f.includes(n) || n.includes(f));
      if (hit) matched++;
      else notASetup.push({ call, documented: fm, actual: [...froms] });
    }
  }
}
console.log(`\n=== (B/C) summary: ${pairs} documented (call, start) pairs over ${[...pdfCalls.keys()].filter((c) => implemented.has(c)).length} implemented calls ===`);
console.log(`  ${matched} match one of the call's own tam setups`);
console.log(`  ${notASetup.length} are a formation the engine HAS but that call has no setup for`);
console.log(`  ${unknownFormation.size} distinct formation NAMES the engine has no formation for`);
console.log(`  ${prose} entries are sentences the extractor merged into the list (noise, excluded)`);
console.log(`\n=== (B) documented start formations with NO matching tam setup (${notASetup.length}) ===`);
for (const r of notASetup.slice(0, 30)) {
  console.log(`  ${r.call.padEnd(24)} documented "${r.documented}"   engine setups: [${r.actual.join(', ') || 'none'}]`);
}
if (notASetup.length > 30) console.log(`  ... and ${notASetup.length - 30} more`);

console.log(`\n=== (C) documented formation NAMES the engine has no formation for (${unknownFormation.size}) ===`);
for (const [fm, calls] of [...unknownFormation.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30)) {
  console.log(`  ${fm.padEnd(40)} asked for by ${calls.size}: ${[...calls].slice(0, 5).join(', ')}`);
}
if (unknownFormation.size > 30) console.log(`  ... and ${unknownFormation.size - 30} more`);

console.log(`\n=== the calls the FIGURES use that the definitions do not list ===`);
const docNames = new Set([...pdfCalls.keys()]);
const extra = [...figFreq.keys()].filter((c) => !docNames.has(engineNameFor(c))).sort((a, b) => (figFreq.get(b) ?? 0) - (figFreq.get(a) ?? 0));
console.log(`  ${extra.length} names (module names, selections, and All8 spellings included)`);
for (const c of extra.slice(0, 25)) console.log(`      ${String(figFreq.get(c)).padStart(3)}  ${c}`);


