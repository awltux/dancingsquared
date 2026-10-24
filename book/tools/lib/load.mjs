// Load the engine (read-only) and the committed tamination assets for figure generation.
//
// THE ENGINE IS NOT REBUILT HERE. `engine/dist` is consumed exactly as it stands: another
// workstream owns it, and rebuilding it under a running verify suite is a documented trap.
// The export surface IS asserted, because that same workstream can move it -- a missing
// symbol fails loudly and by name rather than producing a figure with silently wrong
// geometry.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { corpusRoot, filesOf, tamsOf } from 'dancing-squared-corpus';

export const here = dirname(fileURLToPath(import.meta.url)); // .../book/tools/lib
export const toolsDir = join(here, '..'); // .../book/tools
export const root = join(here, '..', '..', '..'); // the repo root

/** The engine API the figures actually use. Asserted on load. */
const REQUIRED = [
  'setParser',
  'Engine',
  'loadCallFromXml',
  'callMeta',
  'poseFor',
  'allPoses',
  'sampleTrail',
  'dancerBeats',
  'computeHandholds',
  'assignHomeIdentity',
  // The degrees-per-radian factor `make-formations.mjs` draws every angle with. The engine owns the unit
  // (`core.ts`), and this tool cannot `import` the CJS `dist` directly, so it binds `loadEngine().DEG` — asserted
  // here so a missing export is a named failure instead of `NaN` in a PNG.
  'DEG',
  // The XML round trip's tolerance, which `make-virtual.mjs` compares a replayed instance against. It used to be a copy
  // of the engine's 1e-3 with a comment saying so; it is the engine's constant now (`tolerances.ts`), asserted here for
  // the same reason as `DEG` — a missing export must be a named failure, not a comparison against `undefined`.
  'XML_ROUND_TRIP_TOL',
  // The family a corpus file files itself under — read off the root `<tamination title="…">` by
  // `make-virtual.mjs`, so a generated instance carries the same root element and family as the file it sits
  // beside rather than a second convention.
  'parseTaminationTitle',
  // The squared-set arrangement figure is drawn from the engine's own arrangement table, so
  // that the six patterns are the ones the engine classifies boards into rather than a
  // transcription of them. The sequence figure goes further and asks the engine to STAND THE
  // BOARDS UP: the Sequencer builds the template, boardsForAlignment enumerates what is in each
  // sequence state, and sequenceFor/arrangementFor read the answer back so the figure can check
  // it drew what it claims.
  'ARRANGEMENT_TABLES',
  'ARRANGEMENT_NUMBER_ORDER',
  'EMPTY_CELL',
  'Sequencer',
  'boardsForAlignment',
  'sequenceFor',
  'arrangementFor',
];

export function loadEngine() {
  // Resolve from the POC's package so `@xmldom/xmldom` is found the way poc/verify.cjs
  // finds it, without adding a dependency of our own.
  const requireFromPoc = createRequire(join(root, 'poc', 'package.json'));
  const { DOMParser } = requireFromPoc('@xmldom/xmldom');
  const eng = requireFromPoc(join(root, 'engine', 'dist', 'index.js'));

  const missing = REQUIRED.filter((k) => eng[k] === undefined);
  if (missing.length) {
    throw new Error(
      `engine/dist is missing required export(s): ${missing.join(', ')}.\n` +
        'The engine is owned by another workstream; do not rebuild it here to make this pass.',
    );
  }
  if (typeof eng.setParser !== 'function') throw new Error('engine setParser is not callable');
  eng.setParser(DOMParser);
  return eng;
}

export function assetPath(...parts) {
  const p = join(corpusRoot(), ...parts);
  if (!existsSync(p)) throw new Error(`missing asset: ${p}`);
  return p;
}

export function readAsset(...parts) {
  return readFileSync(assetPath(...parts), 'utf8');
}

/**
 * The levels a figure may be drawn from.
 *
 * The corpus's LEVEL IS NOT MEMBERSHIP -- the manual decides what is taught. It only decides
 * where animation data may be found, and a call that moved into Mainstream from Basic may
 * have its only authoring under `b1/`, so all of these are searched.
 */
export const SOURCE_LEVELS = ['ms', 'plus'];

/** Load `moves.xml` + `formations.xml` once and build an Engine. */
export function makeEngine(eng) {
  return new eng.Engine(readAsset('moves.xml'), readAsset('formations.xml'));
}

/**
 * Every call title the corpus exposes, mapped to the (file, tamIndex) sites that define it.
 *
 * EVERY `<tam>` IS ENUMERATED, not just the file's first title. `callMeta` returns one
 * title per file, and a corpus file routinely holds several calls -- `circle.xml` carries
 * Circle Left, Circle of 4 and Single Circle -- so a title-per-file catalogue silently
 * under-counts what can be drawn.
 *
 * The corpus's level is NOT membership: it only says where animation data may be found,
 * and a call that moved into Mainstream from Basic may have its only authoring under `b1/`.
 *
 * THE READING COMES FROM `packages/corpus` since the consolidation: the same walk the engine's 134 harnesses do,
 * with the corpus's comments stripped, so a `tamIndex` here addresses the same `<tam>` that `loadCallFromXml`
 * builds. Before that, the book scanned `<tam>` with a raw regex and paired the resulting index with a DOM parse,
 * and in the four files that carry a commented-out tam those two disagreed. `eng` is gone from the signature with
 * that change: the reader needs no engine, and the two call sites pass levels instead.
 */
export function catalogue(levels = SOURCE_LEVELS) {
  const byTitle = new Map();
  for (const level of levels) {
    for (const file of filesOf(level)) {
      for (const site of tamsOf(level, file)) {
        if (!site.title) continue;
        if (!byTitle.has(site.title)) byTitle.set(site.title, []);
        byTitle.get(site.title).push({ file: `${level}/${file}`, tamIndex: site.index });
      }
    }
  }
  return byTitle;
}

/** Build a call bundle from a corpus site, mirroring the half-set authorings. */
export function loadCall(eng, site) {
  const xml = readFileSync(join(corpusRoot(), site.file), 'utf8');
  return eng.loadCallFromXml(xml, readAsset('moves.xml'), readAsset('formations.xml'), site.tamIndex, true);
}
