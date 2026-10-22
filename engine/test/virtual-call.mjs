// THE VIRTUAL CALL: a subwhole-set authoring placed on a whole-set board, and the constraint that decides it.
//
// WHAT IS BEING GATED, and why the constraint is the gate. TODO item 39 asks for a resolver, a chooser and a
// cache. The resolver turns a 2- or 4-dancer authoring into a whole-board `CallBundle`; the OWNER'S constraint is
// that every such variant must START and END on a formation the engine NAMES. This file judges that with the
// ENGINE'S OWN NAMER called from here - `seq.knownFormation` - rather than with anything the resolver reports
// about itself, because a judge that is a second call into the thing under test passes for as long as the defect
// does (AGENTS §11.2.3).
//
// THE POPULATION IS MEASURED, NOT ASSUMED. The corpus authors ~1000 subwhole-set tams (`shape-census`: 947
// two-dancer units, 62 two-dancer shapes, 74 non-8 shapes). The sweep below prints how many (formation, title)
// pairs it tried, how many resolved to a CHOICE, how many resolved but are ambiguous, and how many refused —
// with the refusal reasons — so `0 of 0` can never read as a pass (§11.2.2).
//
// TIER. The default run samples the named formations (every 7th, printed); `--all` sweeps all of them. That is a
// cost decision, not a coverage claim: the sampled run does NOT see the same population and the two are never
// compared as like-for-like (§11.2.10).
//
// Usage: node engine/test/virtual-call.mjs [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, chooseVirtual, resolveVirtual } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'assets');
const read = (p) => fs.readFileSync(p, 'utf8');

setParser(DOMParser);
const seq = new Sequencer(read(path.join(assets, 'moves.xml')), read(path.join(assets, 'formations.xml')), callsByTitle(assets));

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
};
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- the population
// The library has no title list of its own; the pooled catalogue does, and it is the same set the sequencer was
// registered with (`callsByTitle` is what `Sequencer` reads).
const allTitles = [...new Set(callsByTitle(assets).map((c) => c.name))].sort();

// A title qualifies when at least one of its variants BUILDS to fewer dancers than a board. That is the
// population this feature exists for, and it is measured rather than guessed.
const subsetTitles = [];
const sizeHistogram = new Map();
for (const title of allTitles) {
  const sizes = seq.library.matchableVariants(title).map((v) => v.dancers.length);
  if (sizes.length === 0) continue;
  const k = Math.min(...sizes);
  if (k >= 8) continue;
  subsetTitles.push(title);
  sizeHistogram.set(k, (sizeHistogram.get(k) ?? 0) + 1);
}
console.log('== The population ==');
console.log(`    ${allTitles.length} catalogue titles; ${subsetTitles.length} of them have a variant that builds to fewer than eight dancers`);
console.log(`    smallest built size, counts: ${[...sizeHistogram].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join('  ')}`);

const formations = seq.listFormations();
const ALL = process.argv.includes('--all');
const sample = ALL ? formations : formations.filter((_, i) => i % 7 === 0);
console.log(`    ${formations.length} named formations; sweeping ${sample.length}${ALL ? ' (--all)' : ' (default sample: every 7th)'}`);

// ---------------------------------------------------------------- 1. the sweep
console.log('\n== 1. Every (formation, subset title) pair the board admits ==');
{
  let pairs = 0;
  let chosen = 0;
  let ambiguous = 0;
  const refusals = new Map();
  const unnamed = [];
  // The reasons come back as one `tried` sentence with per-reason counts; aggregate by the REASON so the
  // histogram is a histogram rather than one key per count.
  const note = (why) => refusals.set(why, (refusals.get(why) ?? 0) + 1);
  const noteTried = (tried) => {
    for (const part of tried.split('; ')) note(part.replace(/ \(\d+\)$/, ''));
  };
  const started = Date.now();

  for (const name of sample) {
    const board = seq.boardForFormation(name);
    if (!board || board.dancers.length !== 8) continue;
    for (const title of subsetTitles) {
      pairs++;
      const r = seq.virtualCall(board, title);
      if (!r.legal) {
        if (r.reason === `Unknown call: ${title}`) note('the catalogue publishes no buildable variant');
        else noteTried(r.tried);
        continue;
      }
      const pick = chooseVirtual(r.candidates);
      if (pick.chosen) chosen++;
      else {
        ambiguous++;
        note('resolved, but no single answer');
      }
      // THE JUDGE, CALLED HERE: every candidate's start and end must be named by the namer, independently of
      // whatever the resolver recorded.
      for (const c of r.candidates) {
        if (seq.knownFormation(board) === null || seq.knownFormation(c.end) === null) unnamed.push(`${name} / ${title}`);
        if (c.startFormation !== seq.knownFormation(board)) unnamed.push(`${name} / ${title} (start name disagrees)`);
        if (c.endFormation !== seq.knownFormation(c.end)) unnamed.push(`${name} / ${title} (end name disagrees)`);
      }
    }
  }
  const seconds = (Date.now() - started) / 1000;
  console.log(`    ${pairs} pairs in ${seconds.toFixed(1)}s`);
  console.log(`    ${chosen} resolved to a choice, ${ambiguous} resolved but ambiguous, ${pairs - chosen - ambiguous} refused`);
  console.log(`    refusal reasons:`);
  for (const [why, n] of [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      ${n.toString().padStart(6)}  ${why}`);
  check(pairs > 0, `the sweep has a population (${pairs} pairs, not 0 of 0)`);
  check(chosen > 0, `at least one pair resolves to a single virtual call (${chosen})`);
  check(unnamed.length === 0, `every accepted candidate starts AND ends on a formation the ENGINE'S NAMER names (${unnamed.length} disagree: ${unnamed.slice(0, 3).join('; ')})`);
}

// ---------------------------------------------------------------- 2. the placement arithmetic
console.log('\n== 2. The placement: the board is where it starts, and the track is the source\'s ==');
{
  const board = seq.boardForFormation('Static Square');
  const r = seq.virtualCall(board, 'Promenade 1/2');
  check(r.legal, '`Promenade 1/2` resolves from a Static Square (the book\'s m03a card, item 8)');
  if (r.legal) {
    const c = r.candidates.find((x) => x.kind === 'tiled') ?? r.candidates[0];
    const b = c.bundle;
    // START: pose for pose the board it was placed on, which is what makes it that board's variant.
    let worstStart = 0;
    b.dancers.forEach((d, i) => {
      const p = board.dancers[i];
      worstStart = Math.max(worstStart, Math.hypot(d.x - p.x, d.y - p.y), Math.abs(norm((d.angleDeg * Math.PI) / 180 - p.heading)));
    });
    check(worstStart < 1e-9, `every dancer starts exactly where the board has them (worst ${worstStart.toExponential(1)})`);
    // IDENTITY: the array order is the renderer's binding, and a rebuilt board must come back in order.
    const sameIdentity = b.dancers.every((d, i) => d.id === board.dancers[i].id && d.couple === board.dancers[i].couple && d.gender === board.dancers[i].gender);
    check(sameIdentity, 'and every dancer keeps the board\'s own id, couple and gender, in the board\'s own order');
    // THE TRACK IS THE SOURCE'S, verbatim: the placement is a rotation plus translation, so the dancer-local path
    // does not change. Measured by comparing the placed paths to the source's, dancer for dancer.
    const source = seq.library.matchableVariants('Promenade 1/2').find((v) => v.dancers.length === 4);
    const placedPaths = b.dancers.filter((d) => d.path.length !== 1 || d.path[0].translate.x2 !== 0 || d.path[0].translate.y2 !== 0);
    check(placedPaths.length > 0, `the moving dancers carry a real path (${placedPaths.length} of ${b.dancers.length})`);
    if (source) {
      const moved = placedPaths[0].path;
      const src = source.dancers[0].path;
      check(
        moved.length === src.length && moved.every((s, i) => JSON.stringify(s) === JSON.stringify(src[i])),
        `a placed path is the source path VERBATIM (${moved.length} moves) — a rotation-plus-translation placement changes nothing in the dancer's own frame`,
      );
    }
    // THE HOLD: a dancer the call does not use keeps its spot, for the call's own length.
    const held = b.dancers.filter((d) => d.path.length === 1 && d.path[0].translate.x2 === 0 && d.path[0].translate.y2 === 0);
    if (c.kind === 'partial') {
      check(held.length === b.dancers.length - 4, `the dancers the call does not use HOLD: ${held.length} zero-travel moves of ${b.beats} beats`);
    } else {
      check(held.length === 0, `a tiled placement moves every dancer (${b.dancers.length} of them), so nothing holds`);
    }
    check(b.virtual !== undefined, `the bundle is MARKED as synthesised (source "${b.virtual?.sourceTitle}", ${b.virtual?.sourceSize} dancers)`);
  }
}

// ---------------------------------------------------------------- 3. the chooser's two refusals
console.log('\n== 3. What the chooser refuses, and why that is the honest answer ==');
{
  const square = seq.boardForFormation('Static Square');
  const bodies = seq.virtualCall(square, 'Promenade');
  check(bodies.legal, '`Promenade` has virtual candidates from a Static Square');
  if (bodies.legal) {
    const pick = chooseVirtual(bodies.candidates);
    check(!pick.chosen && /two bodies/.test(pick.reason), `and the chooser REFUSES them as two bodies: ${pick.reason}`);
    const ends = [...new Set(bodies.candidates.map((c) => c.endFormation))].sort();
    check(ends.length > 1, `because the authorings reach different NAMED ends (${ends.join(', ')}) — nothing in the geometry chooses`);
  }
  const which = seq.virtualCall(square, 'Single File Promenade');
  if (which.legal) {
    const pick = chooseVirtual(which.candidates);
    check(!pick.chosen && /say which dancers/.test(pick.reason), `a symmetric call refuses two equal placements: ${pick.reason}`);
    // AND THE CALLER'S OWN PREFERENCE SETTLES IT, which is what `preferGroup` is for.
    const boys = seq.virtualCall(square, 'Single File Promenade', { preferGroup: 'boys' });
    const settled = boys.legal ? chooseVirtual(boys.candidates, { preferPlacement: boys.candidates[0].placement.flat().filter((i) => square.dancers[i].gender === 'boy') }) : null;
    check(!!settled?.chosen, `naming the dancers settles it (${settled?.reason ?? 'no'})`);
  }
}

// ---------------------------------------------------------------- 4. the controls
console.log('\n== 4. The controls: each rule removed, and the check that notices ==');
{
  const square = seq.boardForFormation('Static Square');
  // (a) THE END-NAMED FILTER IS LOAD-BEARING. A namer that names the BOARD but nothing else must turn the same
  // call into a refusal, and it must never return a candidate — that is what "refuse rather than return an
  // unnamed end" means. (A namer that names nothing at all refuses earlier, at the start, which is check (b).)
  const endBlind = resolveVirtual(square, seq.library.matchableVariants('Promenade 1/2'), (b) =>
    b === square ? 'Static Square' : null,
  );
  check(
    !endBlind.legal && /ends on a board the engine does not name/.test(endBlind.reason),
    `a namer that names the board but no end REFUSES: ${endBlind.legal ? 'RETURNED CANDIDATES' : endBlind.reason}`,
  );
  // (b) THE START NAMED. The same call on a board the namer cannot name is refused before any placement work,
  // because the start is half the constraint.
  const unnamedStart = resolveVirtual(square, seq.library.matchableVariants('Promenade 1/2'), () => null);
  check(
    !unnamedStart.legal && /has no start to declare/.test(unnamedStart.reason),
    `and a board the engine cannot name has no virtual call at all: ${unnamedStart.legal ? 'RETURNED CANDIDATES' : unnamedStart.reason}`,
  );
  // (c) DETERMINISM: the same question twice gives the same bytes, so no Map iteration order can decide.
  const a = seq.virtualCall(square, 'Dosado');
  const b = seq.virtualCall(square, 'Dosado');
  const sig = (r) => (r.legal ? r.candidates.map((c) => `${c.kind}|${c.placement.map((x) => x.join('+')).join('/')}|${c.endFormation}`).join(';') : r.reason);
  check(sig(a) === sig(b), `the same board and call twice give the same candidates (${sig(a).slice(0, 60)}...)`);
  // (d) THE MARKER CANNOT REACH A CENSUS: nothing the resolver produces is registered, so the library's answer
  // for the title is unchanged.
  const before = seq.library.matchableVariants('Promenade 1/2').length;
  seq.virtualCall(square, 'Promenade 1/2');
  check(seq.library.matchableVariants('Promenade 1/2').length === before, `resolving registers nothing (still ${before} variants of that title)`);
}

// ---------------------------------------------------------------- 5. what this did NOT measure
console.log('\n== 5. What this run does not cover ==');
{
  console.log('    - the book consumer (`make-animations.mjs`) is not exercised here: it reads the engine through');
  console.log('      `book/tools/lib/load.mjs`, and `npm run check:book` is its gate.');
  console.log('    - applying a virtual call to a sequencing path is NOT built: the picker, `legalNext` and the FSM');
  console.log('      asset are untouched by this feature on purpose (TODO item 39).');
  if (!ALL) console.log(`    - ${formations.length - sample.length} of ${formations.length} named formations were NOT swept; re-run with --all.`);
}

console.log('\n=================');
if (failures === 0) console.log('VIRTUAL CALL TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
