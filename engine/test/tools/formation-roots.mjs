// THE FORMATION-ROOTS LEDGER, AND THE CENSUS THAT KEEPS IT HONEST.
//
// WHY A LEDGER EXISTS. A formation id is a content address, so a geometry correction mints a new one. The call
// variant id is a REFERENCE - it has to survive that correction - so it is keyed on a formation's ROOT: the id
// the shape was first known by. `assets/formation-roots.json` is that mapping, and it is APPEND-ONLY: a line is
// never removed, because removing one is exactly the silent re-pointing this file exists to prevent.
//
// THE TWO HALVES, AND WHY THEY ARE SEPARATE FILES. `formation-roots.json` is GENERATED - every shape the corpus
// authors, read through the engine's own `formationId`, so it cannot disagree with the id scheme. The
// DECISIONS about what a new id succeeds are not generated and never can be: a generator sees an id vanish and
// another appear, and cannot know whether that is a correction of one shape or one shape replaced by another.
// So `formation-aliases.json` is HAND-WRITTEN (`{"F2-new": "F2-old"}`), usually empty, and it is what a corpus
// edit adds when it corrects a formation.
//
// WHAT `--check` REFUSES, and each is a different failure:
//   - a generated file that is not byte-identical to a fresh render (a shape added or removed without
//     regenerating - the ordinary staleness every generated artefact here is gated for);
//   - a shape with no root (a new formation, which needs a regenerated ledger);
//   - a line dropped from the committed ledger (the append-only rule);
//   - an alias whose target does not exist, or whose target is itself (a typo, or a cycle).
//
// AND THE CENSUS: every distinct formation id the corpus's authoring starts produce gets a root, so a variant id
// can always be minted. The counts are printed, because a census that cannot say how big its sample was is a
// census nobody can argue with.
//
// Run: node test/tools/formation-roots.mjs           (verify the ledger; exit 1 on any refusal below)
//      node test/tools/formation-roots.mjs --write   (regenerate it)
//
// VERIFYING IS THE DEFAULT AND REGENERATING IS THE FLAG, deliberately: this file is the history a variant id
// delegates its stability to, and a tool that rewrites it when invoked plainly is a tool that will one day
// rewrite it while the shapes it encodes are being adjudicated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { loadCallFromXml, setParser, formationId, formationRootOf, allPoses } from '../../dist/index.js';
import { filesOf, tamsOf } from 'dancing-squared-corpus';

const here = path.dirname(fileURLToPath(import.meta.url));
// engine/test/tools -> repo root -> assets
const assets = path.resolve(here, '..', '..', '..', 'assets');
const ROOTS = path.join(assets, 'formation-roots.json');
const ALIASES = path.join(assets, 'formation-aliases.json');

/** The levels the ledger is generated over. Stated, because a ledger that silently covers less than the corpus
 *  is a ledger that fails later, at a call site far from here. */
export const ROOT_LEVELS = ['ms', 'plus'];

const readAsset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');

/** Every start shape the corpus authors, as formation ids. */
export function startShapes(levels = ROOT_LEVELS) {
  setParser(DOMParser);
  const movesXml = readAsset('moves.xml');
  const formationsXml = readAsset('formations.xml');
  const shapes = new Map(); // id -> one example "level/file#index title"
  let built = 0;
  let failed = 0;
  for (const level of levels) {
    for (const file of filesOf(level)) {
      const xml = readAsset(`${level}/${file}`);
      for (const site of tamsOf(level, file)) {
        try {
          const bundle = loadCallFromXml(xml, movesXml, formationsXml, site.index, true);
          const board = { dancers: allPoses(bundle, 0).map((p, i) => ({ ...p, gender: bundle.dancers[i].gender })) };
          const id = formationId(board);
          built++;
          if (!shapes.has(id)) shapes.set(id, `${level}/${file}#${site.index} ${bundle.title}`);
        } catch {
          failed++;
        }
      }
    }
  }
  return { shapes, built, failed };
}

/** The ledger as a fresh render would write it: every current shape's id, resolved through the hand-written
 *  aliases, appended to the committed one. Existing lines are never dropped. */
export function renderLedger(committed, aliases, shapes) {
  const roots = { ...(committed?.roots ?? {}) };
  for (const [id] of shapes) {
    if (roots[id] !== undefined) continue;
    const alias = aliases[id];
    roots[id] = alias !== undefined ? formationRootOf(alias, roots) : id;
  }
  return { version: 1, roots };
}

const sameJson = (a, b) => JSON.stringify(a, null, 2) === JSON.stringify(b, null, 2);

export function check() {
  const problems = [];
  const committed = fs.existsSync(ROOTS) ? JSON.parse(fs.readFileSync(ROOTS, 'utf8')) : null;
  const aliases = fs.existsSync(ALIASES) ? JSON.parse(fs.readFileSync(ALIASES, 'utf8')) : {};
  const { shapes, built, failed } = startShapes();

  if (!committed) problems.push(`${path.basename(ROOTS)} is missing; run this tool without --check`);
  if (built === 0) problems.push('the sweep measured no authoring starts at all');

  const fresh = renderLedger(committed, aliases, shapes);
  if (committed && !sameJson(fresh, committed)) {
    const added = Object.keys(fresh.roots).filter((k) => committed.roots[k] === undefined);
    const dropped = Object.keys(committed.roots).filter((k) => fresh.roots[k] === undefined);
    problems.push(`the ledger is stale: ${added.length} unrecorded shape(s), ${dropped.length} dropped line(s)`
      + (added.length ? `\n        new: ${added.slice(0, 5).join(', ')}` : '')
      + (dropped.length ? `\n        dropped: ${dropped.slice(0, 5).join(', ')}` : '')
      + '\n        run this tool without --check, and declare any genuine rename in formation-aliases.json');
  }

  for (const [id, root] of Object.entries(committed?.roots ?? {})) {
    if (root === id) continue;
    if (committed.roots[root] === undefined) problems.push(`root ${root} of ${id} is not in the ledger`);
    if (root === id && aliases[id] !== undefined) problems.push(`alias ${id} -> ${aliases[id]} did not resolve`);
  }
  for (const [from, to] of Object.entries(aliases)) {
    // A key beginning with `_` is a note to the reader, not an alias: JSON has no comments and this file is
    // hand-written, so the note has to live somewhere and must not be validated as a pair of ids.
    if (from.startsWith('_')) continue;
    if (from === to) problems.push(`alias ${from} points at itself`);
    if (!/^F2-[0-9a-z]{6}$/i.test(from) || !/^F2-[0-9a-z]{6}$/i.test(to)) problems.push(`alias ${from} -> ${to} is not a pair of formation ids`);
  }

  console.log(`== the ledger ==`);
  console.log(`  authoring starts built: ${built} (${failed} failed to build, and are not part of any census)`);
  console.log(`  distinct start shapes:  ${shapes.size}`);
  console.log(`  ledger lines:           ${Object.keys(fresh.roots).length}`);
  console.log(`  hand-written aliases:   ${Object.keys(aliases).filter((k) => !k.startsWith('_')).length}`);
  for (const p of problems) console.log(`  FAIL ${p}`);
  if (!problems.length) console.log('  ok   the ledger is current, append-only and every root resolves');
  return problems.length;
}

export function write() {
  const committed = fs.existsSync(ROOTS) ? JSON.parse(fs.readFileSync(ROOTS, 'utf8')) : null;
  const aliases = fs.existsSync(ALIASES) ? JSON.parse(fs.readFileSync(ALIASES, 'utf8')) : {};
  const { shapes, built, failed } = startShapes();
  const fresh = renderLedger(committed, aliases, shapes);
  fs.writeFileSync(ROOTS, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
  console.log(`formation-roots: ${Object.keys(fresh.roots).length} line(s) over ${shapes.size} start shapes `
    + `(${built} authoring starts, ${failed} failed to build)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--write') ? write() : (check() ? 1 : 0));
}
