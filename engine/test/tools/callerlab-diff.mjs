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
  // PARENTHESISED ASIDES ARE REMOVED BEFORE THE LIST IS SPLIT, and the order is the whole fix. The
  // source writes "Facing Dancers (Man and Woman)" and the text has the PDF's split words, so
  // splitting FIRST on `\s+and\s+(?=[A-Z])` produced "Facing Dancers (M an" and "W oman)" - two
  // fragments, neither of which has a matched paren for the strip below to remove, and neither of
  // which is a formation. Measured: this pair was 2 of the (C) entries. Stripping first leaves
  // "Facing Dancers", which is the real name.
  const formations = listRaw
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*,\s*|\s+or\s+|\s+and\s+(?=[A-Z])/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
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
const tamFrom = new Map(); // title -> Set(label the engine can start this call from)
for (const { name, xml } of callsByTitle(assets)) {
  const froms = new Set();
  // PER TAM, AND WITH THE ENGINE'S OWN FALLBACK, which is the third instrument bug in this file. The
  // `from` attribute was read alone, so a tam that declares only `formation="..."` looked like a call
  // with NO setups at all: `Dive Thru` is authored as `formation="Pass Thru"` with no `from`, and the
  // report said "engine setups: [none]" for the very pair it was flagging. The engine has always done
  // the opposite - convert.ts:414 - `label: t.from || t.formationAttr || '(default)'`, and
  // convert.ts:324 builds the setup from `formationAttr` when the tam has no inline dancers. So the
  // label the engine can START the call from is `from`, else `formation`, and that is what is read.
  for (const block of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
    const from = (block.match(/\bfrom="([^"]*)"/) ?? [])[1] ?? '';
    const formation = (block.match(/\bformation="([^"]*)"/) ?? [])[1] ?? '';
    const label = from || formation;
    if (label) froms.add(label);
  }
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

/**
 * THE ENGINE'S FORMATION VOCABULARY IS BIGGER THAN `formations.xml`, and counting only that file
 * reported a PHANTOM GAP (corrected round 24). A `<tam>` may author its setup INLINE and name it only
 * in its `from=` attribute — `from="Facing Couples"`, `from="Right-Hand Wave"`, `from="Mini-Wave"` —
 * which is a formation the engine can start that call from just as much as a catalog template is. The
 * (C) check below used to ask only `formations.xml`, so every such name was reported as "a formation
 * NAME the engine has no formation for", and that number (24) is quoted in PLAN.md and in the CALLERLAB
 * row of the scoreboard as the real gap. It is not: a name used as some tam's `from` is part of the
 * vocabulary, and the question that actually matters for a given call — does THIS call have a setup
 * for THIS formation — is what (B) already answers.
 *
 * `STANDARD_FORMATIONS` is already folded in above for the same reason; this is the other half of it.
 */
const tamFromNames = new Set([...tamFrom.values()].flatMap((s) => [...s].map(norm)));
const formationIsKnown = (n) => knownFormations.has(n) || tamFromNames.has(n);

/**
 * WHAT THIS DOES *NOT* TRY TO BRIDGE, and why the attempt was dropped (round 24). CALLERLAB's formation
 * names are COARSER than the engine's setups: it says "Ocean Wave" where the engine says
 * `Right-Hand Wave`, and "Facing Dancers" where the engine's cheapest setup is a four-dancer `Facing
 * Couples`. A map of spelling bridges for those was written and measured — it moved three names out of
 * (C) and straight into (B), turning "the engine has no formation for Ocean Wave" into "Spin the Top
 * has no setup for Ocean Wave", which is just as false (it has a dozen wave setups). Neither category
 * can express "the call HAS a setup that is a member of this formation's FAMILY, in another
 * arrangement", which is the real relationship and is what `setup-coverage.mjs` reports. So the counting
 * is left honest and literal: (C) means the engine's own vocabulary has no entry under that NAME, and
 * (B) means it has a formation for it but this call authors no setup from it.
 */

const unknownFormation = new Map(); // NORMALISED formation name -> { raw, calls }
const notASetup = [];                // (call, formation) with no matching from= anywhere
let pairs = 0, matched = 0, prose = 0, callNotFormation = 0;
const PROSEISH = /\.\s|\.$|\b(are|is|the two|which|while|when|that|their|they|usually|generally|more)\b|\bonly\b|\bin general\b|^\s*a\s|\brestricted\b/i;
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
      // A CALL name can land in a formation list - `Box Circulate` is documented as the starting
      // formation for `Split Circulate`, and it is a call the catalogue HAS. Counting it as "a
      // formation the engine has no formation for" is the same class of error as counting prose:
      // the engine certainly cannot be asked for a formation by that name, because it is not one.
      if (catalogue.has(fm) || implemented.has(fm)) { callNotFormation++; continue; }
      if (!formationIsKnown(n)) {
        matched += 0;
        // KEYED ON THE NORMALISED NAME, and that is an instrument fix, not tidying. This map used to
        // be keyed on the RAW string while the lookup above used `norm(fm)`, so ONE name could be
        // counted twice whenever the extractor put a space in it: `One -Faced Line` normalises to the
        // same `one faced line` as `One-Faced Line`, and `Mini- Wave` to the same `mini wave` as
        // `Mini-Wave`. Both pairs were reported as two missing formations each. The raw spellings are
        // kept on the entry so a genuine spelling difference is still visible.
        if (!unknownFormation.has(n)) unknownFormation.set(n, { raw: new Set(), calls: new Set() });
        const uf = unknownFormation.get(n);
        uf.raw.add(fm);
        uf.calls.add(call);
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
console.log(`  ${callNotFormation} entries are CALL names the extractor put in a formation list (excluded)`);
console.log(`\n=== (B) documented start formations with NO matching tam setup (${notASetup.length}) ===`);
for (const r of notASetup.slice(0, 30)) {
  console.log(`  ${r.call.padEnd(24)} documented "${r.documented}"   engine setups: [${r.actual.join(', ') || 'none'}]`);
}
if (notASetup.length > 30) console.log(`  ... and ${notASetup.length - 30} more`);

console.log(`\n=== (C) documented formation NAMES the engine has no formation for (${unknownFormation.size}) ===`);
for (const [n, uf] of [...unknownFormation.entries()].sort((a, b) => b[1].calls.size - a[1].calls.size).slice(0, 30)) {
  const spellings = uf.raw.size > 1 ? `   [raw spellings: ${[...uf.raw].join(' | ')}]` : `   "${[...uf.raw][0]}"`;
  console.log(`  ${n.padEnd(40)} asked for by ${uf.calls.size}: ${[...uf.calls].slice(0, 5).join(', ')}${spellings}`);
}
if (unknownFormation.size > 30) console.log(`  ... and ${unknownFormation.size - 30} more`);

console.log(`\n=== the calls the FIGURES use that the definitions do not list ===`);
const docNames = new Set([...pdfCalls.keys()]);
const extra = [...figFreq.keys()].filter((c) => !docNames.has(engineNameFor(c))).sort((a, b) => (figFreq.get(b) ?? 0) - (figFreq.get(a) ?? 0));
console.log(`  ${extra.length} names (module names, selections, and All8 spellings included)`);
for (const c of extra.slice(0, 25)) console.log(`      ${String(figFreq.get(c)).padStart(3)}  ${c}`);

// ---------------------------------------------------------------------------------------------
// THE GATE. Phase F's own closure requires "`callerlab-diff.mjs` becomes a harness so it cannot
// drift", and this is that half of it. The numbers are PINNED, not target-checked: a change in EITHER
// direction fails, because the point is that a future round sees the movement and re-pins it
// deliberately with its reason - the same shape as `catalogue.mjs`'s KNOWN_SKIPS, and the same lesson
// as `getout-convention`'s [P4p] negative, which stayed red for rounds because nothing ran it.
//
// PINNED AS OF ROUND 39. This check has had THREE instrument bugs, all now fixed: round 24's (it asked
// a formation name against `formations.xml` alone, so every INLINE `from=` was reported missing - 24
// names became 20); rounds 37-38's (the map was keyed on the raw string while the lookup normalised, so
// one name with a stray space counted twice, and the list was split on " and " BEFORE parenthesised
// asides were stripped); and round 39's (only the `from` attribute was read, so a tam declaring only
// `formation=` looked like a call with NO setups - `Dive Thru` reported "engine setups: [none]" for the
// very pair being flagged, while convert.ts:414 has always fallen back to `formationAttr`).
//
// With all three fixed: (C) is NINE names, of which one is a residual split-word artefact (`one m an
// and one w oman`), leaving EIGHT genuine - Couple, Mini-Wave, Ocean Wave, One-Faced Line, Facing
// Tandems, Single 1/4 Tag, Tandem facing a Couple, Tandem Couples - and two of those are CALLERLAB's
// spelling of a formation the engine already has. (B) is ELEVEN pairs, and MOST of them are
// GRANULARITY rather than absence: `Facing Dancers` is a two-dancer formation (Box the Gnat, Dosado,
// Pass Thru, Slide Thru, Star Thru, Swing) while the engine's cheapest authorings are four-dancer
// `Facing Couples`. It is pinned so a movement in either direction is re-pinned deliberately.
const PINNED = { matched: 11, notASetup: 11, unknown: 9, prose: 11, callNotFormation: 3 };
console.log('\n=== the pinned numbers (Phase F\'s anti-drift gate) ===');
let gateFailures = 0;
const pin = (label, got, want) => {
  if (got === want) { console.log(`  ok   ${label}: ${got}`); return; }
  console.log(`  FAIL ${label}: measured ${got}, pinned ${want}`);
  console.log(`       re-pin DELIBERATELY: state what moved and why, then update PINNED in this file.`);
  gateFailures++;
};
pin('(B/C) pairs matching a setup', matched, PINNED.matched);
pin('(B) formation the engine HAS, no setup for that call', notASetup.length, PINNED.notASetup);
pin('(C) formation NAMES the engine has no formation for', unknownFormation.size, PINNED.unknown);
pin('prose entries excluded as noise', prose, PINNED.prose);
pin('call names excluded from formation lists', callNotFormation, PINNED.callNotFormation);
if (gateFailures) {
  console.log(`\nCALLERLAB DIFF FAILED: ${gateFailures} pinned number(s) moved.`);
  process.exit(1);
}
console.log('\nCALLERLAB DIFF PASSED: all five pinned numbers hold.');


