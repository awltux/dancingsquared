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

import { allPoses, callVariantId, formationId, isCallVariantId, Sequencer, setParser, chooseVirtual, resolveVirtual } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
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
    // THE SOURCE'S OWN START IS PRICED, and it is TWO FACTS, which is why there are two fields: `sourceStart` is
    // the CONTENT ADDRESS of the board the authoring starts from, and `sourceFid` is the STORED TAG the variant id
    // is minted from — `callVariantId(level, sourceTitle, <that fid>)`, the same third input `book/tools/
    // make-virtual.mjs` resolves and `identity-census.mjs`'s `fidOf` derives. `sourceStart` is kept for
    // DIAGNOSTICS: a geometry correction moves it, which is the whole reason `7980688` stopped minting ids from it.
    // NOTHING CAN DERIVE EITHER AFTER THE PLACEMENT: the placed bundle's own start is the BOARD it was placed on,
    // and that is a different board (`Promenade 1/2` is authored from Facing Couples Far and placed here on a square).
    if (source) {
      const expected = formationId({ dancers: allPoses(source, 0) });
      check(b.virtual?.sourceStart === expected,
        `sourceStart is the formation id of the AUTHORING's start board (${b.virtual?.sourceStart} = ${expected})`);
      check(b.virtual?.sourceStart !== formationId(board),
        'and it is NOT the board it was placed on — that is the variant the instance IS, not the one it came from');
      // THE INLINE CASE ONLY, and the denominator says which case this witness is: a source that NAMES a formation
      // carries no inline tag (the definitions table holds it), so `null` here is the expected answer rather than a
      // gap. `sourceFid` is read off `formationTag`, which the corpus's inline `<formation>` block supplies.
      const tag = source.formationTag?.fid ?? null;
      check(b.virtual?.sourceFid === tag,
        `sourceFid is the tag STORED on the source definition (${b.virtual?.sourceFid} = ${tag}; the source ${tag === null ? 'NAMES a formation, so the caller resolves that definition\'s tag' : 'authors its own setup inline'})`);
      if (tag !== null) {
        check(isCallVariantId(callVariantId('ms', b.virtual.sourceTitle, tag)),
          'and that fid is what the call-variant id takes, so the parent id is derivable without rebuilding the authoring');
      }
    }
  }
}

// ------------------------------------------- 2b. the NAMED source was the easy half; here is the inline one
console.log('\n== 2b. A source that authors its formation INLINE — the tag rides on the bundle ==');
{
  // WHY THIS SECOND WITNESS EXISTS. The block above walks `Promenade 1/2`, whose source NAMES its formation, so
  // `sourceFid` is null there and the `tag !== null` branch above never runs — a check that cannot run is not a
  // check. The inline case is the one `formationTag` on the bundle is FOR: an inline `<formation>` block has no name
  // to look a definition up by, and the placement is the last place the block itself is in hand.
  //
  // ONE BOARD IS NOT A SAMPLE, and this cost a red gate to learn: `e872f1e` absorbed the 137 inline blocks that
  // duplicated a `formations.xml` definition, and from a STATIC SQUARE the inline case then measured **0 of 47** —
  // the check failed correctly and taught nothing except that the witness had been too narrow. MEASURED over the four
  // whole-set boards the library names: 233 legal virtual calls, **14 inline-tagged sources**, all of them from
  // `Ocean Waves` (9) / `Normal Lines` (2) / `Two-Faced Lines` (3) and NONE from a Static Square. So the sweep walks
  // boards, and prints the split per board.
  const boards = ['Static Square', 'Ocean Waves', 'Normal Lines', 'Two-Faced Lines']
    .map((n) => [n, seq.boardForFormation(n)])
    .filter(([, b]) => b !== null && b !== undefined);
  check(boards.length === 4, `all four whole-set boards resolve (${boards.map(([n]) => n).join(', ')})`);
  const inline = [];
  const perBoard = [];
  let legal = 0;
  let named = 0;
  for (const [boardName, board] of boards) {
    let onThis = 0;
    for (const title of seq.library.callNames()) {
      let r;
      try {
        r = seq.virtualCall(board, title);
      } catch {
        continue;
      }
      if (!r.legal) continue;
      legal++;
      onThis++;
      const info = (r.candidates.find((x) => x.kind === 'tiled') ?? r.candidates[0]).bundle.virtual;
      if (info?.sourceFid) inline.push([boardName, title, info]);
      else named++;
    }
    perBoard.push(`${boardName} ${onThis}`);
  }
  console.log(`     ${legal} legal virtual calls over ${boards.length} boards (${perBoard.join(', ')})`);
  check(inline.length > 0 && named > 0,
    `the sweep finds BOTH kinds of source (${inline.length} inline-tagged, ${named} named, of ${legal} legal virtual calls) — a 0 in either column would measure nothing`);
  for (const [boardName, title, info] of inline) {
    // THE SOURCE IS IDENTIFIED BY ITS CONTENT ADDRESS, which is the one thing that says which authoring was placed
    // without trusting the field under test; the TAG that same block carries must then be the fid the id is minted
    // from. A title can have several inline authorings (`Box the Gnat` carries both `F3-rj0qnzj7` and `F3-xud0oaar`),
    // so the address is how the right one is picked.
    const src = seq.library.matchableVariants(title).find((v) => v.formation === null && formationId({ dancers: allPoses(v, 0) }) === info.sourceStart);
    const fid = src?.formationTag?.fid ?? null;
    check(src !== undefined && info.sourceFid === fid,
      `${boardName} / ${title}: sourceFid is the fid STORED on the inline block it was placed from (${info.sourceFid} = ${fid}), not the block's own address`);
    check(info.sourceFid !== null && isCallVariantId(callVariantId('ms', title, info.sourceFid)),
      `${boardName} / ${title}: and that fid is what the call-variant id takes, so the parent id is derivable without the source board`);
  }
  // THE TWO FIELDS ARE RECORDED AS EQUAL HERE, because they are: a tag minted from a CURRENT geometry IS that
  // geometry's content address, and they part company only when a correction re-mints the address (which is why the
  // id is minted from the tag). Printing it keeps the next reader from "simplifying" the pair into one field — the
  // witness that would show them differing is a corrected formation, and this corpus has none.
  const same = inline.filter(([, , info]) => info.sourceFid === info.sourceStart).length;
  console.log(`     ${same} of ${inline.length} inline witnesses carry a tag EQUAL to their content address — the difference appears only after a geometry correction`);
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

// ---------------------------------------------------------------- 5. the cache
console.log('\n== 5. The cache: keyed on the pose set, refusals included ==');
{
  const square = seq.boardForFormation('Static Square');
  seq.virtualCall(square, 'Dosado'); // warm the formation scan itself, so the counts below are about THIS cache
  const before = seq.virtualCacheStats();
  const one = seq.virtualCall(square, 'Dosado');
  const twice = seq.virtualCall(square, 'Dosado');
  const after = seq.virtualCacheStats();
  check(after.hits > before.hits && after.misses === before.misses, `a second identical question is a HIT (hits ${before.hits} -> ${after.hits}, misses ${after.misses})`);
  check(JSON.stringify(one) === JSON.stringify(twice), 'and the cached answer is the same answer, byte for byte');

  // A REFUSAL IS CACHED, because a miss costs as much as a hit: `Allemande Left` has no sub-eight-dancer
  // authoring, so it refuses — and the second refusal must not re-sweep.
  const refused = seq.virtualCall(square, 'Allemande Left');
  const m1 = seq.virtualCacheStats().misses;
  seq.virtualCall(square, 'Allemande Left');
  const m2 = seq.virtualCacheStats().misses;
  check(!refused.legal && m2 === m1, `a REFUSAL is cached too: ${refused.legal ? 'it resolved' : 'refused once'} and a second ask cost ${m2 - m1} miss(es)`);

  // THE KEY IS THE POSE SET, NOT THE FORMATION'S NAME — the first thing item 39 says would make this wrong. A
  // square turned 90 degrees is STILL named `Static Square` by the engine, so a name-keyed cache would answer it
  // with the unturned board's result and nobody could tell. The MISS is the observable: the two boards have
  // different pose sets, so they are different questions.
  //
  // AND THE PLACEMENT IS EXPECTED TO COME OUT THE SAME, which is why it is not the control. `placement` is a set of
  // DANCER INDICES, and a rotation of the whole board carries every dancer's geometry round with them — the pair
  // `{2,6}` is still the pair whose members happen to be at the rotated spots. MEASURED when this was first
  // written as "the placements must differ": they do not, on any rotation of a square, and the assertion was the
  // check-whose-subject-does-not-exist mistake. What must hold on the turned board is that the answers are still
  // valid, judged by the namer here.
  const turned = { dancers: square.dancers.map((d) => {
    const c = Math.cos(Math.PI / 2);
    const s = Math.sin(Math.PI / 2);
    return { ...d, x: d.x * c - d.y * s, y: d.x * s + d.y * c, heading: norm(d.heading + Math.PI / 2) };
  }) };
  check(seq.knownFormation(turned) === 'Static Square', `a square turned 90 degrees is still named Static Square (${seq.knownFormation(turned)})`);
  const miss0 = seq.virtualCacheStats().misses;
  const turnedResult = seq.virtualCall(turned, 'Single File Promenade');
  check(seq.virtualCacheStats().misses === miss0 + 1, 'and asking about it is a MISS, not a stale hit on the pose set it shares a NAME with');
  check(
    turnedResult.legal && turnedResult.candidates.every((c) => c.startFormation === 'Static Square' && seq.knownFormation(c.end) === c.endFormation),
    `and its answer is computed for THIS board: ${turnedResult.legal ? `${turnedResult.candidates.length} candidate(s), every end named` : turnedResult.reason}`,
  );

  // AND THE CACHE IS CLEARED WHERE THE OTHER TWO ARE, so a new formation or a user-defined one cannot read a stale
  // answer.
  seq.registerFormation('Virtual call probe formation', square.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple })));
  check(seq.virtualCacheStats().size === 0, `registering a formation clears it (size ${seq.virtualCacheStats().size})`);
}

// ---------------------------------------------------------------- 6. what this did NOT measure
console.log('\n== 6. What this run does not cover ==');
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
