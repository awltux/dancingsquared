// ANALYSIS TOOL (not a harness): what does `Spin the Top` actually produce?
//
// Round 25 root-caused a defect here to "the catalogue authors an 8-dancer Spin the Top that merges
// the two facing waves", and manifest as half spacing. The claim needs to be re-measured on the
// CANONICAL boards rather than on a figure's mid-chain board, and split by call, because
// `Spin the Top`, `Fan the Top` and `Swing` are three different authored things and only one of them
// may be wrong.
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
}
