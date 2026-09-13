// ANALYSIS TOOL (not a harness): what does `Spin the Top` actually produce?
//
// Round 25 root-caused a defect here to "the catalogue authors an 8-dancer Spin the Top that merges
// the two facing waves", and manifest as half spacing. The claim needs to be re-measured on the
// CANONICAL boards rather than on a figure's mid-chain board, and split by call, because
// `Spin the Top`, `Fan the Top` and `Swing` are three different authored things and only one of them
// may be wrong.
//
// WHY ONLY 8-DANCER BOARDS ARE USED. The tempting test -- apply `Fan the Top` to a bare 4-dancer wave
// and check the 4-dancer tam in isolation -- is NOT reachable through the public API: `library.ts`
// keeps only 8-dancer named formations and MIRRORS every 4-dancer one up to 8 (`namedFormations`), so
// `boardForFormation('Wave RH GBBG')` does not yield a wave of four, and on the doubled board the
// matcher picks the 8-dancer demonstration tam anyway. The two canonical boards below are therefore the
// smallest honest witness.
//
// Usage: node engine/test/tools/spin-the-top-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const pose = (board) =>
  board.dancers
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((d) => `#${d.id}${d.gender ? d.gender[0].toUpperCase() : '?'}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${Math.round(((d.heading ?? 0) * 180) / Math.PI)}`)
    .join(' ');

/** The distinct inter-dancer spacings on a board, which is what "half scale" means concretely. */
const spacings = (board) => {
  const ds = board.dancers.slice().sort((a, b) => a.id - b.id);
  const out = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const g = Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y);
      if (g > 0.01 && g < 3.5) out.push(g);
    }
  }
  const uniq = [...new Set(out.map((g) => g.toFixed(2)))].sort((a, b) => Number(a) - Number(b));
  return uniq.join(', ');
};

for (const start of ['Ocean Waves', 'Tidal Wave']) {
  const board = seq.boardForFormation(start);
  if (!board) { console.log(`\n${start}: NOT A KNOWN FORMATION`); continue; }
  console.log(`\n=== ${start} ===`);
  console.log(`  start     [${seq.knownFormation(board)}] ${pose(board)}`);
  console.log(`            gaps under 3.5: ${spacings(board)}`);
  for (const call of ['Swing', 'Fan the Top', 'Spin the Top']) {
    // WHICH variant does the matcher pick, and at what error? A 4-dancer tam matched against an
    // 8-dancer board is exactly the tiling question, so the answer has to be on the record.
    const m = seq.findMatchingVariant(board, call, 6.0);
    console.log(
      `  ${call.padEnd(13)} matches: ` +
        (m
          ? `"${m.variant.title ?? '?'}" from="${m.variant.formation ?? '?'}" ` +
            `${m.variant.dancers?.length ?? '?'} dancer(s), error ${m.error.toFixed(3)}, reflect=${m.reflect}`
          : 'NONE'),
    );
    const r = seq.applyToBoard(board, call);
    if (!r.legal) {
      console.log(`  ${call.padEnd(13)} REFUSED: ${r.reason}`);
      continue;
    }
    console.log(`  ${call.padEnd(13)} [${seq.knownFormation(r.board)}] ${pose(r.board)}`);
    console.log(`            gaps under 3.5: ${spacings(r.board)}`);
  }

  // THE PER-HALF READING, FORCED. `parallelApply` is private, but `selectInterpretation` chooses
  // between the whole-board and parallel readings with `config.rand()`, so probabilistic mode plus a
  // fixed high random source pins the parallel branch. This is the reference's SplitCall route: the
  // catalogue's 4-dancer wave tam applied to each half. It is ALSO the reading `parallelApply` can only
  // reach today as a FALLBACK, i.e. never on these boards, whose whole-board match succeeds at 0.000.
  seq.setSelectionMode('probabilistic');
  seq.setRandomSource(() => 0.999);
  for (const call of ['Fan the Top', 'Spin the Top']) {
    const r = seq.applyToBoard(board, call);
    console.log(
      r.legal
        ? `  ${call.padEnd(13)} [PARALLEL] [${seq.knownFormation(r.board)}] ${pose(r.board)}\n` +
          `            gaps under 3.5: ${spacings(r.board)}`
        : `  ${call.padEnd(13)} [PARALLEL] REFUSED: ${r.reason}`,
    );
  }
  seq.setSelectionMode('best');
}

// WHAT SETUPS EXIST AT ALL. `parallelApply` skips any setup of size >= the board, so which sizes a
// call HAS decides which of them the per-half route can even reach. A 2-dancer setup on an 8-dancer
// board tiles into four groups of two, which is NOT the reference's SplitCall (halves of four).
for (const call of ['Fan the Top', 'Spin the Top']) {
  const variants = seq.matchableVariants(call);
  const bySize = new Map();
  for (const v of variants) bySize.set(v.dancers.length, (bySize.get(v.dancers.length) ?? 0) + 1);
  const sizes = [...bySize].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${n}x${k}-dancer`).join(', ');
  console.log(`\n${call}: ${variants.length} matchable variant(s) - ${sizes || 'none'}`);
}
