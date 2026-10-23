// THE WHOLE-SET INSTANCES OF CALLS THE CORPUS ONLY AUTHORS AS SUBSET UNITS.
//
// WHY THIS EXISTS. `make-animations.mjs` plays whole-set instances only (its `WHOLE_SET` note carries the
// measurement: 48 of 75 cards used to play a 2- or 4-dancer authoring). Eight calls have NO eight-dancer
// authoring in the corpus, so their cards have no picture. The engine's answer to a subwhole authoring is the
// VIRTUAL call (`engine/src/sequencer/virtual-call.ts`): place the written unit on a whole board and keep the
// placement only if it STARTS and ENDS on a formation the namer recognises. This tool materialises the chosen
// placement as a `<tam>`, so the player can fetch it by `(file, tamIndex)` like any other authoring.
//
// THE SEARCH IS NOT IN THE BUILD, AND THAT IS THE POINT. `virtual-call.ts` keeps "no cache and no ambient
// state", so a placement is a SEARCH over boards. Running that search over every call and every formation is
// exactly the explosion the owner warned about - a call as unconstrained as `Dancer Turn Right` places on very
// many setups, and a map keyed by call title would either store a combinatorial set of records or pin whichever
// placement it happened to find first (the silent-choice defect `e199c42` removed from the bindings). So the
// boards are DECLARED, one per card, in `virtual-placements.json`; this tool VALIDATES each claim and refuses
// it when the engine disagrees. `--discover=<title>` is a person's aid for writing a row, and nothing else runs
// it.
//
// THE FOUR REFUSALS, and each is a different mistake:
//   - the declared board does not stand up (`boardForFormation` returns null);
//   - the placement is illegal for that call (the source does not fit the board at all);
//   - the placement is AMBIGUOUS (`chooseVirtual` refuses: equally good placements, or one placement reaching
//     two different named ends - "nothing in the geometry chooses between them");
//   - the serialised `<tam>` does not reproduce the placed bundle when read back. That last one is the check
//     that makes the artefact trustworthy: the player loads the TEXT, so a text that plays differently from the
//     placement it claims is worse than no animation.
//
// AND ONE MORE, in `--check` only: a row whose card has since gained an eight-dancer CORPUS authoring is dead
// weight - the catalogue prefers the corpus - so it must be deleted rather than left shipping a tam nothing
// plays.
//
// THE OUTPUT IS TWO TRACKED FILES, both generated:
//   assets/virtual/tams.xml    the `<tam>` elements, one per row, in card order
//   assets/virtual/index.json  card id -> {file, tamIndex, title, board, kind, start, end, why}
// `assets/` is where the player's `assets/calls/<file>` copy comes from, and `virtual/` is not a corpus level,
// so `catalogue()` and the variant census never see these tams.
//
// Run: node book/tools/make-virtual.mjs            (regenerate)
//      node book/tools/make-virtual.mjs --check    (verify the committed artefact)
//      node book/tools/make-virtual.mjs --discover=Dosado
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, tamsOf } from 'dancing-squared-corpus';

import { loadEngine, readAsset, root, toolsDir } from './lib/load.mjs';

const PLACEMENTS = join(toolsDir, 'virtual-placements.json');
const OUT_XML = join(corpusRoot(), 'virtual', 'tams.xml');
const OUT_INDEX = join(corpusRoot(), 'virtual', 'index.json');

/** The levels an authoring may come from; the same two the book draws on. */
const LEVELS = ['ms', 'plus'];

/** The tolerance the XML's own rounding admits - four decimals on every coordinate (`callToXml`), and the
 *  engine's `startsFromFormation` uses the same 1e-3 for the same reason. */
const ROUND_TRIP_TOL = 1e-3;

/** Boards `--discover` tries. A REPORT's input, bounded on purpose: this list is not a search the build runs. */
const DISCOVER_BOARDS = [
  'Static Square', 'Squared Set', 'Normal Lines', 'Facing Lines', 'Ocean Waves', 'Right-Hand Waves',
  'Two-Faced Lines', 'Eight Chain Thru', 'Double Pass Thru', 'Completed Double Pass Thru', 'Columns',
];

/** Every `<tam>` in ms+plus, by title, as XML - the source the placements are built from. */
function tamsByTitle() {
  const byTitle = new Map();
  for (const level of LEVELS) {
    for (const file of filesOf(level)) {
      for (const tam of tamsOf(level, file)) {
        if (!tam.title) continue;
        if (!byTitle.has(tam.title)) byTitle.set(tam.title, []);
        byTitle.get(tam.title).push(tam.xml);
      }
    }
  }
  return byTitle;
}

/**
 * Place `title` on `board`, or explain why it cannot be. Returns the engine's chosen candidate - which is a
 * whole-board `CallBundle` plus the placement it came from - or a sentence naming the refusal.
 */
function place(eng, byTitle, title, boardName) {
  const written = byTitle.get(title) ?? [];
  if (!written.length) return { error: `no corpus authoring carries the title "${title}"` };
  let seq;
  try {
    seq = new eng.Sequencer(readAsset('moves.xml'), readAsset('formations.xml'), [
      { name: title, xml: `<calls>\n${written.join('\n')}\n</calls>` },
    ]);
  } catch (err) {
    return { error: `the engine could not load those tams: ${String(err.message ?? err)}` };
  }
  const board = seq.boardForFormation(boardName);
  if (!board) return { error: `the engine stands up no board for "${boardName}"` };
  const outcome = seq.virtualCall(board, title);
  if (!outcome.legal) return { error: outcome.reason };
  const pick = eng.chooseVirtual(outcome.candidates);
  if (!pick.chosen) return { error: pick.reason };
  return { chosen: pick.chosen, candidates: outcome.candidates.length };
}

/** Every sampled pose of a bundle, row for row - the shape the round-trip comparison walks. */
function posesOf(eng, bundle) {
  const out = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = (bundle.beats * i) / steps;
    out.push({ t, poses: eng.allPoses(bundle, t) });
  }
  return out;
}

/** How far two bundles' sampled poses differ, as the worst single coordinate over the whole walk.
 *
 *  HEADINGS ARE COMPARED AS ANGLES, NOT NUMBERS. MEASURED: the first run reported a drift of 6.28 on `Swing Your
 *  Partner` - exactly one turn - because the same facing came back as 0 and as 2*pi. A raw subtraction would
 *  refuse a correct artefact, and normalising to (-pi, pi] is what the engine does everywhere it reads a facing. */
function poseDrift(eng, a, b) {
  if (a.dancers.length !== b.dancers.length) return Infinity;
  const pa = posesOf(eng, a);
  const pb = posesOf(eng, b);
  const turn = (d) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  let worst = 0;
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pa[i].poses.length; j++) {
      const x = pa[i].poses[j];
      const y = pb[i].poses[j];
      worst = Math.max(worst, Math.abs(x.x - y.x), Math.abs(x.y - y.y), turn(x.heading - y.heading));
    }
  }
  return worst;
}

/**
 * The whole render, in memory: the file text, the index object, and every refusal. Pure apart from the engine,
 * so `--check` and a writing run compare the same thing.
 */
export function render() {
  const placements = JSON.parse(readFileSync(PLACEMENTS, 'utf8'));
  const eng = loadEngine();
  const byTitle = tamsByTitle();
  const tams = [];
  const index = {};
  const problems = [];

  for (const id of Object.keys(placements).filter((k) => !k.startsWith('$')).sort()) {
    const row = placements[id];
    const placed = place(eng, byTitle, row.title, row.board);
    if (placed.error) {
      problems.push(`${id}: ${placed.error}`);
      continue;
    }
    const { chosen } = placed;
    const tamIndex = tams.length;
    const xml = eng.callToXml(chosen.bundle);
    tams.push(xml);
    index[id] = {
      file: 'virtual/tams.xml',
      tamIndex,
      title: chosen.bundle.title,
      board: chosen.startFormation,
      kind: chosen.kind,
      startFormation: chosen.startFormation,
      endFormation: chosen.endFormation,
      why: row.why,
    };
  }

  const file =
    '<?xml version="1.0"?>\n' +
    '<!-- GENERATED by book/tools/make-virtual.mjs from virtual-placements.json - do not edit by hand. -->\n' +
    '<taminations>\n' +
    tams.join('\n') +
    '\n</taminations>\n';

  // THE ROUND TRIP, against the file that will actually ship. A tam's paths are paired with the formation's
  // dancers BY INDEX, so a text that re-reads to a different set of poses is a wrong picture, not a format
  // nuance - and the tolerance is the XML's own rounding, not a fudge factor.
  for (const id of Object.keys(index).sort()) {
    const entry = index[id];
    let back;
    try {
      back = eng.loadCallFromXml(file, readAsset('moves.xml'), readAsset('formations.xml'), entry.tamIndex, true);
    } catch (err) {
      problems.push(`${id}: the generated tam does not re-read: ${String(err.message ?? err)}`);
      continue;
    }
    if (!back || back.dancers.length !== 8) {
      problems.push(`${id}: the generated tam re-reads as ${back?.dancers?.length ?? 0} dancers, not 8`);
      continue;
    }
    const placed = place(loadEngine(), byTitle, entry.title, entry.board).chosen;
    const drift = placed ? poseDrift(eng, placed.bundle, back) : Infinity;
    if (!(drift <= ROUND_TRIP_TOL)) {
      problems.push(`${id}: the generated tam plays differently from the placement it claims (worst pose drift ${drift.toExponential(2)}, tolerance ${ROUND_TRIP_TOL})`);
    }
  }

  return { file, index, problems, placements };
}

/** Cards that still have no eight-dancer corpus authoring, so a row is still needed (or one is dead). */
function rowsStillNeeded() {
  const placements = JSON.parse(readFileSync(PLACEMENTS, 'utf8'));
  const map = JSON.parse(readFileSync(join(toolsDir, 'call-map.json'), 'utf8'));
  const eng = loadEngine();
  const byTitle = tamsByTitle();
  const dead = [];
  for (const id of Object.keys(placements).filter((k) => !k.startsWith('$'))) {
    const row = placements[id];
    let anyEight = false;
    for (const xml of byTitle.get(row.title) ?? []) {
      try {
        const b = eng.loadCallFromXml(
          `<?xml version="1.0"?><taminations>${xml}</taminations>`,
          readAsset('moves.xml'), readAsset('formations.xml'), 0, true,
        );
        if (b.dancers.length === 8) anyEight = true;
      } catch { /* an authoring that does not build is not an eight-dancer one */ }
    }
    if (anyEight) dead.push(`${id}: "${row.title}" now has an eight-dancer corpus authoring, so this row is dead - delete it`);
  }
  void map;
  return dead;
}

export function main() {
  const check = process.argv.includes('--check');
  const discover = process.argv.find((a) => a.startsWith('--discover'));

  if (discover) {
    const title = discover.includes('=') ? discover.split('=')[1] : '';
    const eng = loadEngine();
    const byTitle = tamsByTitle();
    if (!byTitle.has(title)) {
      console.error(`no corpus authoring carries the title "${title}"`);
      return 1;
    }
    for (const board of DISCOVER_BOARDS) {
      const placed = place(eng, byTitle, title, board);
      console.log(`${board}: ${placed.error ? `REFUSED (${placed.error})` : `PLACES ${placed.chosen.startFormation} to ${placed.chosen.endFormation} (${placed.chosen.kind}, ${placed.candidates} candidate(s))`}`);
    }
    return 0;
  }

  const { file, index, problems } = render();
  problems.push(...rowsStillNeeded());

  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\n${problems.length} placement problem(s); nothing written.`);
    return 1;
  }

  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  if (check) {
    const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    let drift = 0;
    if (!existsSync(OUT_XML) || !sameText(readFileSync(OUT_XML, 'utf8'), file)) {
      console.error('DRIFT assets/virtual/tams.xml');
      drift++;
    }
    if (!existsSync(OUT_INDEX) || !sameText(readFileSync(OUT_INDEX, 'utf8'), indexText)) {
      console.error('DRIFT assets/virtual/index.json');
      drift++;
    }
    if (drift) {
      console.error(`\n${drift} file(s) differ. Re-run without --check.`);
      return 1;
    }
    console.log(`${Object.keys(index).length} virtual placement(s) reproduce exactly.`);
    return 0;
  }

  mkdirSync(dirname(OUT_XML), { recursive: true });
  writeFileSync(OUT_XML, file, 'utf8');
  writeFileSync(OUT_INDEX, indexText, 'utf8');
  for (const id of Object.keys(index).sort()) {
    const e = index[id];
    console.log(`  ${id}  ${e.title}  from ${e.board}  (${e.kind}, ends on ${e.endFormation})  -> ${e.file}#${e.tamIndex}`);
  }
  console.log(`${Object.keys(index).length} virtual placement(s) -> ${OUT_XML}`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
