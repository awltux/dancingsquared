// WHICH MODULES DOES THE BODY GUARD REFUSE, AND ARE THEY VALID?
//
// The guard can only ever remove capability, so every module it refuses is a claim that the corpus asks
// for something the engine will not dance. That claim needs auditing: some are genuinely impossible
// motion, and some are more likely BAD DATA in the corpus — a call whose authoring or registration is
// wrong, which is exactly the "there could still be invalid calls in the database causing this" case.
//
// So this separates the two, because they need different responses:
//
//   BROKEN      the module does not walk EVEN WITH THE GUARD OFF. Nothing to do with contact rules;
//               this is a call the engine cannot apply at all.
//   GUARD-ONLY  the module walks when the guard is off and is refused when it is on. These are the
//               contact-rule exclusions, and each one is a claim that the tiling produced impossible
//               motion.
//
// Reading it: a module in the GUARD-ONLY set whose failing step is a plain call (`Pass Thru`,
// `Star Thru`, `Box the Gnat`) is far more likely to be an authoring/registration problem than two
// dancers really walking through each other, because those calls are danced constantly and safely.
// A module whose failing step is a call the engine TILES for the whole board is the reported class.
//
// Usage:
//   node engine/test/tools/guard-exclusions.mjs            # summary
//   node engine/test/tools/guard-exclusions.mjs --write    # also write the tables to poc/tools/
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = corpusRoot();
const s = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = s.boardForFormation(n); if (b) return b; }
  return null;
};
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Does the module walk end to end under one guard mode? THE ENGINE'S OWN WALK, not a re-implementation:
 *  `sequenceStop` runs `SequenceAnalyzer.replayWalk`, which is what the app and the beat total use. A
 *  hand-rolled step loop was tried first and reported 1419 "broken" modules against ~180 real stops -
 *  the number was the loop's, not the corpus's, which is why this defers to the engine. */
function walks(mod, mode) {
  const code = START[mod.startFormation?.trim().toLowerCase()];
  const start = code === null
    ? s.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  if (!start) return { ok: false, failedStep: null, reason: 'no start board for this startFormation' };
  const flat = s.flatten(mod.steps);
  s.setBodyCollisionMode(mode);
  try {
    const stop = s.sequenceStop(flat, start);
    if (stop) {
      return {
        ok: false,
        failedStep: typeof stop.call === 'string' ? stop.call : null,
        reason: stop.reason,
        boardBefore: stop.board,
        index: stop.index,
        path: flat.slice(0, stop.index).filter((x) => typeof x === 'string').join(' > '),
        startFormation: mod.startFormation ?? '',
      };
    }
    return { ok: true, beats: s.sequenceBeats(flat, start) };
  } finally {
    s.setBodyCollisionMode('report');
  }
}

/** The body measurement for a failing step, read in report mode from the board it failed on. */
function measure(boardBefore, failedStep) {
  if (!boardBefore || !failedStep) return { bodyGap: null, pair: null, parallel: false, reportLegal: false };
  const r = s.applyToBoard(boardBefore, failedStep);
  return {
    bodyGap: r.bodyCollision ? r.bodyCollision.gap : null,
    pair: r.bodyCollision ? `${r.bodyCollision.id1}+${r.bodyCollision.id2}` : null,
    parallel: !!r.parallel,
    reportLegal: r.legal,
  };
}

const files = walkJson(path.join(root, 'modules')).sort();
const broken = [];
const guardOnly = [];
let considered = 0;

for (const file of files) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  // THE APP'S OWN ADMISSION FILTER, copied from `poc/src/ceder-modules.ts` so this audit covers exactly
  // the corpus the sequencer offers. Without it the audit reports every module the translator could not
  // map (1579 "broken" against ~180 real stops) - a number about the raw corpus, not about the guard.
  if (mod.success !== true) continue;
  if (mod.steps.includes('ALLEMANDE_LEFT')) continue;
  considered++;
  const rel = path.relative(root, file).replace(/\\/g, '/');

  const report = walks(mod, 'report');
  if (report.ok) {
    const guard = walks(mod, 'guard');
    if (guard.ok) continue;                       // not excluded at all
    guardOnly.push({ rel, name: mod.name ?? '', ...guard, ...measure(guard.boardBefore, guard.failedStep) });
  } else {
    broken.push({ rel, name: mod.name ?? '', ...report, ...measure(report.boardBefore, report.failedStep) });
  }
}

const byCall = new Map();
for (const m of guardOnly) byCall.set(m.failedStep, (byCall.get(m.failedStep) ?? 0) + 1);
const byCallBroken = new Map();
for (const m of broken) byCallBroken.set(m.failedStep ?? '(start)', (byCallBroken.get(m.failedStep ?? '(start)') ?? 0) + 1);

console.log(`${files.length} module file(s), ${considered} the app offers (clean translation, no terminal marker)`);
console.log(`  BROKEN even with the guard OFF : ${broken.length}`);
console.log(`  refused only BY THE GUARD     : ${guardOnly.length}`);

console.log(`\n=== BROKEN with the guard off, by failing call (${broken.length}) ===`);
for (const [c, n] of [...byCallBroken.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${String(n).padStart(4)}  ${c}`);
}

console.log(`\n=== GUARD-ONLY exclusions, by failing call (${guardOnly.length}) ===`);
for (const [c, n] of [...byCall.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${c}`);
}

const md = (rows, title, note) => {
  const lines = [
    `# ${title}`, '', note, '',
    `${rows.length} module(s).`, '',
    '| module | start | failing call | body gap | pair | reason | path before failure |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows.sort((a, b) => (a.failedStep ?? '').localeCompare(b.failedStep ?? '') || a.rel.localeCompare(b.rel))) {
    const gap = r.bodyGap === null || r.bodyGap === undefined ? '' : r.bodyGap.toFixed(3);
    lines.push(`| \`${r.rel}\` | ${r.startFormation ?? ''} | ${r.failedStep ?? ''} | ${gap} | ${r.pair ?? ''} | ${(r.reason ?? '').replace(/\|/g, '/')} | ${r.path ?? ''} |`);
  }
  lines.push('', '```');
  for (const r of rows) {
    lines.push(`${r.rel}\t${r.failedStep ?? ''}\t${r.bodyGap === null || r.bodyGap === undefined ? '' : r.bodyGap.toFixed(3)}\t${r.reason ?? ''}`);
  }
  lines.push('```', '');
  return lines.join('\n');
};

if (process.argv.includes('--write')) {
  const out = path.join(root, 'poc', 'tools');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'guard-exclusions.md'), md(
    guardOnly, 'Modules the body guard refuses',
    'Every module here dances when the body guard is off and is refused when it is on. Each is a claim\nthat the tiling produced impossible motion. Check the failing call: a plain call (`Pass Thru`,\n`Star Thru`, `Box the Gnat`) is more likely a corpus authoring problem than a real collision.',
  ), 'utf8');
  writeFileSync(path.join(out, 'guard-exclusions-broken.md'), md(
    broken, 'Modules that do not walk even with the guard off',
    'These are unaffected by the contact rules: the engine cannot apply one of their calls at all.\nThis is where invalid calls in the corpus would show up.',
  ), 'utf8');
  console.log(`\nwritten: poc/tools/guard-exclusions.md, poc/tools/guard-exclusions-broken.md`);
}
