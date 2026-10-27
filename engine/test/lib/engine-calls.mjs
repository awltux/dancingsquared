// Loading the engine's call catalogue for the tests that RUN published choreography.
//
// Three things here are easy to get wrong, and all three were got wrong first:
//
//  1. Calls are registered by TITLE, not by file basename. Registering by basename
//     (as some harnesses do) leaves `Pass Thru` unregistered because its file is
//     pass_thru.xml, so every get-out appears to fail at its first call.
//
//  2. `assets/src/calls.xml` is an INDEX, not a set of implementations: it is
//     a list of `<call link="c3a/1_4_mix" title="1/4 Mix"/>` entries pointing at call
//     files. A title in it with no implementation anywhere is a call the engine NAME
//     knows and cannot perform - `Cross Fold` and `1/2 Circulate` are the ones left.
//     So the implemented catalogue is a separate, useful signal from the index, and
//     it is NOT just the `<tam>` titles: the engine also performs the GEOMETRY-DERIVED
//     calls it computes from the board rather than from a setup (the coded pivots
//     `Face Left`/`Face Right`/`U-Turn Back`/`Face In`/`Face Out`, and the whole-set
//     resolve `Promenade`). `catalogueTitles` below is the `<tam>` half only;
//     `implementedTitles` is the union, which is what a coverage comparison wants.
//
//  3. A call the engine implements under a different name is not a missing call.
//     All8 writes `Touch 1/4` and `Cast Off 3/4`; the engine implements them as
//     `Touch a Quarter` and `Cast Off Three Quarters`. Counting those as gaps would
//     aim the work at the wrong thing.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CODED_MOVES, CALL_SYNONYMS, PERMISSION_LEVELS } from '../../dist/index.js';
// THE READING IS NOT DONE HERE ANY MORE. `packages/corpus` owns the walk, the parser and the block slicing, so
// the harnesses, the book, the teacher and the game cannot come to disagree about what the corpus holds (AGENTS
// §11.2.12). What stays in THIS module is the engine-facing policy: which levels a harness walks, the
// highest-first pooling order below, and the title algebra that needs engine values (`CODED_MOVES` aliases,
// the `<call>` index).
import { corpusRoot, filesOf, levelPath, pooledXmlOfTitle, titlesOf } from 'dancing-squared-corpus';

/**
 * The levels a harness walks: THE ENGINE'S OWN PROGRAMME ORDER, not a copy of it.
 *
 * This used to be a hand-kept list of the same names in the same order, and so did four harnesses and a script -
 * MEASURED when it was consolidated, `git grep -n "'discovered'"` found SEVEN copies of the sequence. Two failures
 * came with the copies, both silent: a level added to the engine's ladder (or to the corpus) would leave every gate
 * that walks a copy blind, and a retired level could outlive its directory inside a list nobody re-reads (`ssd` was
 * such an entry: synthesized by the POC, never an asset directory, retired with the 2026 CALLERLAB replacement).
 *
 * The engine owns the ORDER because a permission rule's scope IS the programme order (`levelRank`), and a corpus
 * walk needs the same order for the pooling rule `callsByTitle` documents. So this derives.
 *
 * WHAT DERIVING DOES NOT BUY, and `corpus-inventory.mjs` checks: that every folder the corpus HAS is named here.
 * `levelsAvailable()` is the reader's answer to "which levels exist"; the ladder is the engine's answer to "which
 * levels are known"; they can disagree in the direction that hides a programme's calls from every gate.
 */
export const ASSET_LEVELS = PERMISSION_LEVELS;

/**
 * The corpus root a caller hands in must be THE corpus root. Every harness passes `assets` today, and the one
 * declaration of where the corpus lives is `vite.corpus.ts` (read by `packages/corpus`); a caller passing some
 * other directory used to read that other directory silently, which is the failure mode this guard removes.
 */
function assertCorpusRoot(assets) {
  if (path.resolve(assets) !== path.resolve(corpusRoot())) {
    throw new Error(`engine-calls: ${assets} is not the corpus (it lives at ${corpusRoot()}, declared in vite.corpus.ts)`);
  }
}

/**
 * Every call XML file under the assets tree: the level folders plus assets/src, in the order given by `levels`.
 *
 * The order is a parameter because it is LOAD-BEARING, not cosmetic: the same call title is often defined at
 * several levels, and the engine's tie-break is "first registered wins" (see `FormationMatcher.findMatchingVariant`).
 * See `callsByTitle`.
 */
export function callXmlFiles(assets, levels = ASSET_LEVELS) {
  assertCorpusRoot(assets);
  const files = [];
  for (const lv of [...levels, 'src']) {
    for (const f of filesOf(lv)) files.push(path.join(levelPath(lv), f));
  }
  return files;
}

/** The call TITLES the engine can actually perform: every `<tam>` definition. */
export function catalogueTitles(assets) {
  assertCorpusRoot(assets);
  return titlesOf([...ASSET_LEVELS, 'src']);
}

/**
 * The titles the engine's own index lists, whether or not there is an implementation.
 * `catalogueTitles` minus this is a name the engine has never heard of; this minus
 * `catalogueTitles` is a name it knows and cannot perform.
 */
export function indexedTitles(assets) {
  const titles = new Set();
  for (const file of callXmlFiles(assets)) {
    const xml = readFileSync(file, 'utf8');
    for (const m of xml.matchAll(/<call\b[^>]*\btitle="([^"]*)"/g)) titles.add(m[1]);
  }
  return titles;
}

/** Every name the engine can actually PERFORM: the `<tam>` titles plus every alias
 * of the geometry-derived calls it computes from the board instead of a setup. */
export function implementedTitles(assets) {
  const titles = catalogueTitles(assets);
  for (const move of CODED_MOVES) for (const alias of move.aliases) titles.add(alias);
  return titles;
}

/**
 * title -> all of its `<tam>` blocks pooled, in the form `Sequencer` expects.
 * Pooling matters: a call with several setups registered under one title can be
 * matched from any of them, which is how the engine already works internally.
 *
 * LEVELS ARE WALKED HIGHEST FIRST, and that is a measurement, not a preference.
 *
 * A title defined at two levels contributes TWO authorings of the same call, and
 * `FormationMatcher.findMatchingVariant` resolves an EQUAL error by array order
 * (`findMatchingVariant`'s `better` test: only a strict improvement beyond
 * `FormationMatcher.REFLECT_TIE_EPS`, or a reflect/non-reflect tie, changes the
 * winner). So the order of the pool decides which authoring runs whenever both match the
 * same board, and walking `ASSET_LEVELS` ascending handed every such tie to the LOWEST
 * level.
 *
 * THE WITNESS THAT ESTABLISHED THE RULE HAS BEEN RETIRED, AND THE RULE OUTLIVED IT. It was
 * `Circle Left`: `b1/circle.xml` authored `Forward .59` + 8x `cl` and stopped - the dancer
 * never steps back out of the circle - while `ms/circle.xml` authored the round trip
 * (`... Back .59`). Measured on All8's published figures, the two walks differed in 88 vs 90
 * of 188 end-to-end, and NOTHING is lost by pooling in the other order (the variant SET is
 * identical; only the tie-break changes). **`b1` is not a level any more** - it is absent
 * from `ASSET_LEVELS` above and from `assets` - so that comparison cannot be re-run,
 * and of the 31 titles STILL defined at two or more levels, none is order-sensitive today:
 * all 31 applied from all 138 named formations give the same board under both walks, for
 * 4278 applications identical to the digit. The order is therefore pinned STRUCTURALLY in
 * `engine/test/catalogue.mjs` - the HIGHER level's `<tam>` block must come first in the
 * pooled XML - which fails when the walk is reversed (measured: ascending puts `ms` at 7 and
 * `c1` at 2768; shipped is `c1` at 7 and `ms` at 2528) and does not depend on a corpus
 * coincidence existing.
 *
 * Pooling at all - rather than keeping only the highest level that defines a title, which is
 * what `poc/src/data.ts` `sequencerCallsUpTo` used to do - matters just as much and was
 * measured the same way: higher levels add setups, they do not replace them (`c1/circulate.xml`
 * adds `Thar` and `Wrong Way Thar` and does NOT carry Mainstream's wave setups), so
 * highest-level-only drops 39 of the 188 figures. Pool, highest first.
 */
export function callsByTitle(assets) {
  assertCorpusRoot(assets);
  const levels = [...ASSET_LEVELS].reverse().concat('src');
  // The ORDER of this array is the first-seen title order of the walk, which is what the previous
  // implementation produced and what `catalogue.mjs`'s offsets are measured against.
  return [...titlesOf(levels)].map((name) => ({ name, xml: pooledXmlOfTitle(name, levels) }));
}

/**
 * All8's published name -> the engine's title for the same call.
 *
 * PHASE 6 MOVED THE BRIDGE INTO THE ENGINE. This used to be the only copy, which meant only this
 * test harness could read published choreography: any real consumer had to re-implement the
 * mapping. It now lives in `engine/src/sequencer/constants.ts` as CALL_SYNONYMS, where
 * `canonicalName()` already applied it, and this re-export keeps every existing caller working
 * while making the engine the single definition.
 *
 * These are NOT missing calls: the call exists under another name, and counting it as a catalogue
 * gap would point the work at the wrong thing.
 *
 * Deliberately NOT bridged: `Promenade Home` and bare `Promenade`. They are not two names for a
 * call the engine spells differently - they are ONE call, and the engine USED to resolve both aliases
 * itself in `src/sequencer/promenade.ts`. That module is deleted (the family is hand-authored from
 * tams now) and both names are declared catalogue gaps, so there is still nothing to bridge: the day a
 * tam authors them they are catalogue calls, and until then they are gaps.
 */
export const ALL8_TO_ENGINE = CALL_SYNONYMS;

/** The engine's title for a name decoded from All8's notation. */
export function engineNameFor(name) {
  return ALL8_TO_ENGINE[name] ?? name;
}
