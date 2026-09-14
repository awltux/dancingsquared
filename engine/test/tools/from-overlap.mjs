// PHASE J ANALYSIS TOOL (not a harness): which multi-level titles author the SAME `from` twice,
// and disagree about the motion?
//
// WHY THIS EXISTS. The catalogue defines many call titles at MORE THAN ONE level, and the engine
// pools every authoring, highest level first, because the tie-break in `findMatchingVariant` is
// "first registered wins" on an equal error (see `lib/engine-calls.mjs`). That order is load-bearing:
// `Circle Left` is authored at `b1` as `Forward .59` + 8x `cl` (the dancer never steps back out of the
// circle) and at `ms` as the full round trip, and the choice between them measured 88 vs 90 of 188
// figures.
//
// PLAN.md's Phase J records that the `from`-overlap question "has been swept for ONE multi-level
// title; the other 231 are unswept". This is that sweep. It answers the cheap half first, which is
// the half that can be answered without running 232 censuses:
//
//   for every title defined at more than one level, group its tams by their `from` attribute, and
//   ask whether the authorings that SHARE a `from` also share their MOTION.
//
// A shared `from` with IDENTICAL motion is harmless - the tie-break picks one of two copies. A shared
// `from` with DIFFERENT motion is a genuine conflict: the same board can be danced two ways, and the
// level order silently decides. Those are the rows worth judging, and there are far fewer of them.
//
// Usage: node engine/test/tools/from-overlap.mjs [--verbose]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, poseFor, dancerBeats } from '../../dist/index.js';
import { ASSET_LEVELS, callXmlFiles, callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const VERBOSE = process.argv.includes('--verbose');
setParser(DOMParser);

// THE KEY IS THE `formation` ATTRIBUTE, NOT `from`, and getting that wrong is the first thing this
// probe did. `from` is a coarse LABEL: `Square Thru 3` is authored at `b1` from
// `formation="Facing Couples"` and at `ms` from `formation="Facing Couples Compact"` - two setups at
// different SEPARATIONS, which the engine pools deliberately (the separation law) and which can never
// both match one board. Grouping by `from` counted those as a conflict. `formation` names the setup,
// so it is the attribute that decides whether two authorings are really competing for one board.
//
// `CallBundle` does NOT carry `formation`, so the grouping is done from the XML here rather than from
// the engine's view - and `from`/`formation` are read per tam block below.
const attr = (block, name) => (block.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1] ?? '';
/** The authored MOTION, whitespace-normalised: every `<path>` body, in order. */
const motion = (block) => (block.match(/<path\b[\s\S]*?<\/path>/g) ?? [])
  .map((p) => p.replace(/\s+/g, ' ').trim())
  .join(' | ');
/** The level a tam came from is the folder it was read from. */
const levelOf = (file) => path.basename(path.dirname(file));

// Every tam, with its level and file, walked ASCENDING so the report can show the order the engine
// actually pools in reversed (highest wins).
const byTitle = new Map();
for (const file of callXmlFiles(assets, ASSET_LEVELS)) {
  const xml = readFileSync(file, 'utf8');
  for (const block of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
    const title = attr(block, 'title');
    if (!title) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push({ level: levelOf(file), from: attr(block, 'from'), formation: attr(block, 'formation'), motion: motion(block), file, block });
  }
}

const multiLevel = [...byTitle].filter(([, tams]) => new Set(tams.map((t) => t.level)).size > 1);
const overlapTitles = [];
const conflictTitles = [];
for (const [title, tams] of multiLevel) {
  const byFormation = new Map();
  for (const t of tams) {
    if (!byFormation.has(t.formation)) byFormation.set(t.formation, []);
    byFormation.get(t.formation).push(t);
  }
  const shared = [...byFormation].filter(([, ts]) => ts.length > 1);
  if (!shared.length) continue;
  overlapTitles.push(title);
  const differing = shared.filter(([, ts]) => new Set(ts.map((t) => t.motion)).size > 1);
  if (differing.length) conflictTitles.push({ title, shared, differing });
}

console.log(`=== ${byTitle.size} titles, ${multiLevel.length} defined at more than one LEVEL ===`);
console.log(`    ${overlapTitles.length} of those author the same \`formation\` twice`);
console.log(`    ${conflictTitles.length} of those write a DIFFERENT MOTION on a shared \`formation\``);
console.log('');

// A different motion is not yet a different CALL: two authorings can spell the same dance with
// different beats, or in different canonical frames. What decides whether the tie-break matters is
// whether they END THE SAME, so the end pose is compared - SHAPE and FACINGS only, so a rotated or
// reflected authoring of the same dance is not counted as a conflict. `poseFor`/`dancerBeats` are the
// engine's own path evaluation, so this is the engine's opinion rather than a re-reading of the XML.
//
// THE POSE IS TAKEN FROM A ONE-TAM SEQUENCER, which is the only way to get it for a NAMED tam: the
// engine's CallBundle does not carry `formation`, so bundles cannot be tied back to a specific block
// once they are pooled. Building a library per block is affordable because this runs only over the
// conflicting groups, not over all 2211 titles.
const endShape = (bundle) => {
  const ends = bundle.dancers.map((d) => poseFor(d, dancerBeats(d)));
  const gaps = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      gaps.push(Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y).toFixed(2));
    }
  }
  const facings = ends.map((p) => (((Math.round((p.heading * 180) / Math.PI) % 360) + 360) % 360)).sort((a, b) => a - b);
  return `${gaps.sort().join(',')}|${facings.join(',')}`;
};

const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formsXml = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const oneTam = (title, block) => {
  const s = new Sequencer(movesXml, formsXml, [{ name: title, xml: `<calls>${block}</calls>` }]);
  const v = s.sequencerVariants(title)[0];
  return v ? endShape(v) : null;
};

let endDiffers = 0;
const endConflicts = [];
const noFormation = [];
for (const title of overlapTitles) {
  const tams = byTitle.get(title);
  const groups = new Map();
  for (const t of tams) {
    // A tam with NO `formation` attribute authors its dancers inline, so the empty string is not a
    // setup name and grouping on it CONFLATES unrelated tams - `Star Thru` and `Allemande Left` both
    // showed up as single rows with a dozen distinct endings for that reason. Skipped, and counted
    // separately below, rather than reported as a conflict.
    if (!t.formation) { noFormation.push(t); continue; }
    if (!groups.has(t.formation)) groups.set(t.formation, []);
    groups.get(t.formation).push(t);
  }
  const differing = [];
  for (const [formation, ts] of groups) {
    if (ts.length < 2) continue;
    const shapes = ts.map((t) => oneTam(title, t.block));
    if (new Set(shapes).size < 2) continue;
    differing.push({ formation, ts, shapes });
  }
  if (!differing.length) continue;
  endDiffers++;
  endConflicts.push({ title, differing });
}

console.log(`=== of those, ${endDiffers} END DIFFERENTLY on a shared \`formation\` - the tie-break decides ===`);
console.log(`    (${noFormation.length} tam(s) carry no \`formation\` and are excluded: inline-dancer authorings)`);
console.log('');

for (const { title, differing } of endConflicts) {
  console.log(`  ${title}`);
  for (const { formation, ts, shapes } of differing) {
    const levels = ts.map((t) => t.level).join(', ');
    console.log(`      formation="${formation}"  authored at: ${levels}  (${new Set(shapes).size} distinct ending(s))`);
    if (VERBOSE) ts.forEach((t, i) => console.log(`        [${t.level}] ${[...new Set(shapes)][i]?.slice(0, 100) ?? '?'}`));
  }
}

// WHICH OF THE 17 CAN ACTUALLY COST A FIGURE. A tie-break can only matter where the call is USED, so
// each conflicting title is cross-referenced against the published corpus: the figures whose chains
// contain it, and whether those figures run end-to-end today. A title used only by figures that
// already pass (or that already pass despite it) cannot be where a figure is being lost, and that
// screen costs one corpus walk instead of one full census PER TITLE, which is what judging all 17
// head-to-head would cost (17 x ~60 s).
const corpus = loadAll8Figures();
const seqForCorpus = new Sequencer(movesXml, formsXml, callsByTitle(assets));
const startBoard = seqForCorpus.boardForFormation(ALL8_FIGURE_START);
const figureStatus = new Map();
for (const f of corpus.figures) {
  const calls = figureEngineCalls(f);
  let b = startBoard;
  let stop = null;
  for (const c of calls) {
    const r = seqForCorpus.applyToBoard(b, c);
    if (!r.legal) { stop = c; break; }
    b = r.board;
  }
  figureStatus.set(f.id, { stop, calls });
}
// The engine's name for a corpus call, so `Box Circulate` matches `Centers Box Circulate` too.
const baseOf = (name) => {
  const m = /^(Heads|Sides|Centers|Ends|Boys|Girls|Leads|Trailers|Outsides|Insides|All|All 8)\s+(.*)$/.exec(name);
  return m ? m[2] : name;
};
console.log('');
console.log('=== of the 17, which are USED BY A BLOCKED FIGURE (the only ones that can cost a figure) ===');
let useful = 0;
for (const { title } of endConflicts) {
  const users = [...figureStatus].filter(([, s]) => s.calls.some((c) => baseOf(c) === title));
  const blocked = users.filter(([, s]) => s.stop !== null);
  if (blocked.length) useful++;
  console.log(
    `  ${title.padEnd(24)} used by ${String(users.length).padStart(2)} figure(s), ` +
      `${String(blocked.length).padStart(2)} of them BLOCKED` +
      (blocked.length ? `  -> ${blocked.slice(0, 6).map(([id, s]) => `${id}(${s.stop})`).join(' ')}` : ''),
  );
}
console.log(`\n  ${useful} of ${endConflicts.length} are used by a blocked figure - judge THOSE first.`);

// THE DECISIVE TEST, one title at a time: `--flip <Title>` rebuilds the catalogue with THAT title's
// tam blocks in the opposite order and re-runs the corpus. The pool is highest-level-first and the
// tie-break is "first registered wins", so reversing a title hands every equal-error tie in it to the
// LOWEST level - exactly the experiment that found `Circle Left` was worth 2 figures (88 vs 90).
//
// One title per run, because the question is per-title and a full-corpus walk is ~60 s.
const flipIdx = process.argv.indexOf('--flip');
if (flipIdx >= 0 && process.argv[flipIdx + 1]) {
  const title = process.argv[flipIdx + 1];
  const blocksOf = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  const flipped = callsByTitle(assets).map(({ name, xml }) =>
    name === title ? { name, xml: `<calls>${blocksOf(xml).reverse().join('\n')}</calls>` } : { name, xml });
  const seqFlip = new Sequencer(movesXml, formsXml, flipped);
  const walk = (s) => {
    const out = new Map();
    for (const [id, { calls }] of figureStatus) {
      let b = s.boardForFormation(ALL8_FIGURE_START);
      let stop = null;
      for (const c of calls) {
        const r = s.applyToBoard(b, c);
        if (!r.legal) { stop = c; break; }
        b = r.board;
      }
      out.set(id, stop);
    }
    return out;
  };
  const before = new Map([...figureStatus].map(([id, s]) => [id, s.stop]));
  const after = walk(seqFlip);
  const gained = [], lost = [], moved = [];
  for (const [id, was] of before) {
    const now = after.get(id);
    if (was === null && now !== null) lost.push(`${id}(${now})`);
    else if (was !== null && now === null) gained.push(id);
    else if (was !== now) moved.push(`${id}: ${was} -> ${now}`);
  }
  const ranBefore = [...before.values()].filter((v) => v === null).length;
  const ranAfter = [...after.values()].filter((v) => v === null).length;
  console.log(`\n=== --flip "${title}": level order reversed for that title alone ===`);
  console.log(`  figures running: ${ranBefore} -> ${ranAfter}`);
  if (gained.length) console.log(`  GAINED (${gained.length}): ${gained.join(' ')}`);
  if (lost.length) console.log(`  LOST (${lost.length}): ${lost.join(' ')}`);
  if (moved.length) console.log(`  stopped elsewhere (${moved.length}): ${moved.slice(0, 8).join(' ; ')}`);
  if (!gained.length && !lost.length && !moved.length) console.log('  no figure changed at all');
}

