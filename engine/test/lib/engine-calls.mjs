// Loading the engine's call catalogue for the tests that RUN published choreography.
//
// Three things here are easy to get wrong, and all three were got wrong first:
//
//  1. Calls are registered by TITLE, not by file basename. Registering by basename
//     (as some harnesses do) leaves `Pass Thru` unregistered because its file is
//     pass_thru.xml, so every get-out appears to fail at its first call.
//
//  2. `poc/src/assets/src/calls.xml` is an INDEX, not a set of implementations: it is
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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { CODED_MOVES } from '../../dist/index.js';

export const ASSET_LEVELS = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];

/** Every call XML under the assets tree: the level folders plus assets/src. */
export function callXmlFiles(assets) {
  const files = [];
  for (const lv of ASSET_LEVELS) {
    const dir = path.join(assets, lv);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) files.push(path.join(dir, f));
  }
  const src = path.join(assets, 'src');
  if (existsSync(src)) {
    for (const f of readdirSync(src).filter((x) => x.endsWith('.xml'))) files.push(path.join(src, f));
  }
  return files;
}

/** The call TITLES the engine can actually perform: every `<tam>` definition. */
export function catalogueTitles(assets) {
  const titles = new Set();
  for (const file of callXmlFiles(assets)) {
    const xml = readFileSync(file, 'utf8');
    for (const m of xml.matchAll(/<tam\b[^>]*\btitle="([^"]*)"/g)) titles.add(m[1]);
  }
  return titles;
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
 */
export function callsByTitle(assets) {
  const byTitle = new Map();
  for (const file of callXmlFiles(assets)) {
    const xml = readFileSync(file, 'utf8');
    for (const block of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
      const title = (block.match(/title="([^"]*)"/) ?? [])[1];
      if (!title) continue;
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(block);
    }
  }
  return [...byTitle.entries()].map(([name, blocks]) => ({ name, xml: `<calls>${blocks.join('\n')}</calls>` }));
}

/**
 * All8's published name -> the engine's title for the same call.
 *
 * These are NOT missing calls: the call exists, under another name, and counting it
 * as a catalogue gap would point the work at the wrong thing. The engine's
 * CALL_SYNONYMS map exists for exactly this and is currently empty, so the bridge
 * lives here, at the boundary where a published corpus meets the engine; moving it
 * into the engine is an open item in the docs.
 *
 * Deliberately NOT aliased: `Promenade Home` and bare `Promenade`. Mapping one to
 * the other would hide a real gap - the engine implements only qualified promenades.
 */
export const ALL8_TO_ENGINE = {
  'Touch 1/4': 'Touch a Quarter',
  'Cast Off 3/4': 'Cast Off Three Quarters',
  'Do Sa Do': 'Dosado',
};

/** The engine's title for a name decoded from All8's notation. */
export function engineNameFor(name) {
  return ALL8_TO_ENGINE[name] ?? name;
}
