// REORDER A NAMED FORMATION'S DANCER ORDER, AND PERMUTE EVERY CALL THAT NAMES IT.
//
//   node scripts/reorder-formation.mjs --formation Circle            # plan only, writes nothing
//   node scripts/reorder-formation.mjs --formation Circle --write    # apply
//   node scripts/reorder-formation.mjs --formation Circle --json     # the same plan, machine-readable
//   node scripts/reorder-formation.mjs --formation Circle --check    # 0 when the block matches HEAD
//
// WHY A TOOL RATHER THAN A HAND EDIT. A formation's `<dancer>` order is DATA every caller depends on: a
// `<tam>`'s `<path>` list is paired with it BY INDEX, so moving one dancer in the list silently gives a
// track to the wrong dancer in every call that names the formation. Reported as: "I have discovered that
// the Circle formation is out of order." The fix is two halves that must move together - the formation's
// block and every dependent tam's paths - and the second half is 22 edits across 4 files, which is exactly
// the kind of edit a human should not be making by hand.
//
// THE INPUT IS THE NEW BLOCK, ALREADY IN THE WORKING TREE. The order itself is the caller's decision (the
// Call editor's `Export <formation>` produces a block for any order the table can be put in), so this tool
// never imposes one. It compares the working tree's block with `git show HEAD:assets/formations.xml`,
// derives the permutation from the two spot lists, and refuses when the change is not a reorder at all.
//
// WHY THE DIFF ALONE IS NOT ENOUGH, which is the question this tool was written to answer. A diff of
// `formations.xml` says which spots moved; it does not say what any tam must do about it, because:
//   - a half-set tam writes ONE path per written dancer and the mirrored half reuses those local paths, so
//     the correct permutation can move a path between ANTIPODAL dancers (the `Circle` case is `[2,3,0,1]`,
//     not the `[3,2,1,0]` a couple-order reading suggests - measured, and the wrong one moves dancers by
//     up to 3.68 units);
//   - a whole-set tam writes one path per completed dancer, where the antipode's path is NOT
//     interchangeable;
//   - an inline formation is a COPY that a named-formation change does not reach, and an alias name (a
//     formation with the same spots under another name) is not a dependent at all.
// So the permutation is derived by the engine's rule (`formationReorderPermutation`) and the result is
// PROVED by rebuilding every dependent before and after: a dancer may be re-ordered, never moved.
//
// WHAT IT REFUSES, and each refusal is reported rather than worked around:
//   - a dirty tree: anything modified besides `assets/formations.xml` is someone else's in-flight work
//     (AGENTS.md §8 trap 16), so nothing is written;
//   - a block whose spot set is not the old one, or whose dancers cannot be matched up to a half turn;
//   - a tam whose path count is neither the written count nor twice it, or that carries `actives`, or
//     that carries an inline formation (its own copy would need the same treatment);
//   - any change that moves a dancer by more than the tolerance, in which case NOTHING is written.
//
// DETERMINISM. Only the `<path>` blocks move: the tool rewrites each dependent tam's path sequence in
// place, leaving attributes, comments, indentation and every other byte alone, so `git diff` shows the
// permutation and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// THE BLOCK RULE IS IMPORTED, NOT RESTATED - see `tam-blocks.mjs`. A commented-out tam is not a tam, and
// addressing a tam by position without that rule edits the wrong call.
import { liveTamBlocks, titlePattern } from './tam-blocks.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

const USAGE = `usage: node scripts/reorder-formation.mjs --formation <Name> [--write] [--json] [--check]

  --formation <Name>  the formation to reorder (its NEW block must already be in assets/formations.xml)
  --write             apply the plan (default: report it and write nothing)
  --check             exit 0 when the working block matches HEAD, 1 when there is a reorder pending
  --json              print the plan as JSON
  --help              this text`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const arg = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : null;
};
const formation = arg('--formation');
const write = argv.includes('--write');
const check = argv.includes('--check');
const json = argv.includes('--json');
if (!formation) {
  console.error(USAGE);
  process.exit(2);
}

const die = (message, code = 1) => {
  if (json) console.log(JSON.stringify({ ok: false, reason: message }, null, 1));
  else console.error(`✗ ${message}`);
  process.exit(code);
};

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const engine = await import(pathToFileURL(path.join(root, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const FORMATIONS = path.join(corpusRoot(), 'formations.xml');
const readText = (file) => fs.readFileSync(file, 'utf8');
const DEG = Math.PI / 180;

/** The authored dancers of a name in a parsed formation map, as poses. */
const authoredPoses = (map, name) => {
  const dancers = map.get(name);
  if (!dancers) return null;
  return dancers.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
};

const poseList = (poses) => poses.map((p) => [p.x, p.y, p.heading, p.gender]);
const samePoseList = (a, b) =>
  a.length === b.length &&
  a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-9 && Math.abs(p.y - b[i].y) < 1e-9 && p.heading === b[i].heading && p.gender === b[i].gender);

// ---- the tree must be clean apart from the formation block itself
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trimEnd())
  .filter(Boolean);
const stray = dirty.filter((line) => !/^[AM ]?M\s+assets\/formations\.xml$/.test(line));
if (stray.length) {
  die(
    `the tree is dirty outside assets/formations.xml, so this is not safe to run:\n    ${stray.join('\n    ')}\n` +
      '  Commit or stash that work first (AGENTS.md §8 trap 16). Nothing was written.',
  );
}

// ---- the old block comes from HEAD, the new one from the working tree
let oldFormationsXml;
try {
  oldFormationsXml = execFileSync('git', ['show', 'HEAD:assets/formations.xml'], { cwd: root, encoding: 'utf8' });
} catch {
  die('cannot read assets/formations.xml from HEAD (a shallow clone?); the OLD order is the input to the permutation');
}
const newFormationsXml = readText(FORMATIONS);
const oldMap = engine.parseFormations(oldFormationsXml);
const newMap = engine.parseFormations(newFormationsXml);
const oldAuthored = authoredPoses(oldMap, formation);
const newAuthored = authoredPoses(newMap, formation);
if (!oldAuthored) die(`HEAD's assets/formations.xml has no formation named "${formation}"`);
if (!newAuthored) die(`assets/formations.xml has no formation named "${formation}" - the new block must be there first`);

const oldLetters = (() => {
  const order = engine.formationCompassOrder(engine.completedFormation(oldAuthored));
  return order ? engine.compassLetters(order.order) : null;
})();
const newLetters = (() => {
  const order = engine.formationCompassOrder(engine.completedFormation(newAuthored));
  return order ? engine.compassLetters(order.order) : null;
})();

if (samePoseList(oldAuthored, newAuthored)) {
  if (check) process.exit(0);
  if (json) console.log(JSON.stringify({ ok: true, formation, changed: false, dependents: 0 }, null, 1));
  else console.log(`${formation}: the working block already matches HEAD (${oldLetters ?? 'no compass order'}) - nothing to do`);
  process.exit(0);
}
if (check) {
  die(`${formation} is reordered in the working tree but its dependents may not be; run without --check to see the plan`);
}

// ---- the permutation the formation change asks for, in the mode each tam is written in
const halfPlan = engine.formationReorderPermutation(oldAuthored, newAuthored, { halfTurn: true });
if (!halfPlan.ok) {
  die(
    `the new block is not a reorder of the old one: ${halfPlan.reason} at dancer ${halfPlan.index}. ` +
      'A reorder keeps the same spots; a different shape is a different formation.',
  );
}
const wholePlan = engine.formationReorderPermutation(
  engine.completedFormation(oldAuthored),
  engine.completedFormation(newAuthored),
  { halfTurn: false },
);

// ---- every tam that names the formation
const assets = corpusRoot();
const wanted = engine.canonicalName(formation);
const movesXml = readText(path.join(assets, 'moves.xml'));
const moves = engine.parseMoves(movesXml);
const dependents = [];
const reported = [];
for (const dir of fs.readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  for (const file of fs.readdirSync(path.join(assets, dir)).filter((f) => f.endsWith('.xml'))) {
    const rel = `${dir}/${file}`;
    const text = readText(path.join(assets, rel));
    let tams;
    try {
      tams = engine.parseCallXml(text);
    } catch {
      continue;
    }
    for (const [tamIndex, tam] of tams.entries()) {
      if (!tam.formationAttr || engine.canonicalName(tam.formationAttr) !== wanted) continue;
      const entry = { rel, text, tam, tamIndex, title: tam.title, paths: tam.paths.length, symmetry: tam.symmetry };
      if (tam.actives) {
        reported.push(`${rel} "${tam.title}": carries actives="${tam.actives}" - a subset's paths pair by a different rule, so this tool will not touch it`);
        continue;
      }
      if (tam.dancers.length > 0) {
        reported.push(`${rel} "${tam.title}": carries an INLINE <formation> copy, which this change does not reach - re-author it separately`);
        continue;
      }
      if (tam.paths.length === oldAuthored.length) {
        entry.plan = halfPlan;
        entry.mode = 'half-set';
      } else if (tam.paths.length === 2 * oldAuthored.length) {
        if (!wholePlan.ok) {
          reported.push(`${rel} "${tam.title}": writes ${tam.paths.length} paths (a whole set) and the whole-set permutation is refused (${wholePlan.reason})`);
          continue;
        }
        entry.plan = wholePlan;
        entry.mode = 'whole-set';
      } else {
        reported.push(`${rel} "${tam.title}": writes ${tam.paths.length} paths against a formation that authors ${oldAuthored.length} - neither the half set nor the whole set, so the pairing is not this tool's to decide`);
        continue;
      }
      dependents.push(entry);
    }
  }
}

// ---- prove it before writing anything: the same dancers, the same tracks
const results = [];
let worst = 0;
let worstWhere = '';
const failures = [];
for (const entry of dependents) {
  const permuted = engine.permuteBy(entry.tam.paths, entry.plan.permutation);
  let before;
  let after;
  try {
    before = engine.buildCall(entry.tam, oldMap, moves, true);
    after = engine.buildCall({ ...entry.tam, paths: permuted }, newMap, moves, true);
  } catch (err) {
    failures.push(`${entry.rel} "${entry.title}": ${err.message}`);
    continue;
  }
  const cmp = engine.compareGeometry(before, after, { tol: 1e-6 });
  if (!cmp.ok) {
    failures.push(`${entry.rel} "${entry.title}": geometry moves (worst ${cmp.worst.toExponential(2)} at dancer ${cmp.worstDancer}, ${cmp.unmatched} unmatched)`);
    continue;
  }
  results.push({ entry, permuted, cmp });
  if (cmp.worst >= worst) {
    worst = cmp.worst;
    worstWhere = `${entry.rel} "${entry.title}"`;
  }
}
if (failures.length) {
  die(`the permutation does not preserve every call, so NOTHING was written:\n    ${failures.join('\n    ')}`);
}

// ---- rewrite each dependent file's path blocks in place
//
// ONE PASS PER FILE, not one pass per tam: a file holds many dependents (`ms/circle.xml` holds 16), and
// building each file's text from the ORIGINAL for each tam would leave only the last tam's edit standing -
// which is exactly the bug this loop had, caught by the write-then-verify step below (16 of the 22 tams
// came back stale).
const perFile = new Map();
for (const { entry } of results) {
  const { text, tam, plan } = entry;
  // The tam's raw block, matched in document order and cross-checked against the parsed tam, so a regex that
  // slips cannot edit the wrong call. The INDEX is the one this file's own `parseCallXml` gave - the two lists
  // agree because `liveTamBlocks` masks the commented-out tams the parser skips - and the title in the raw text
  // is what confirms it, because a position alone is not an identity (AGENTS.md §8 trap 7). If they ever
  // disagree the title is the fallback, and only when it names ONE block: `ms/sashay.xml` carries two
  // `Ladies In, Men Sashay` tams, so a title alone is not an identity either.
  const blocks = liveTamBlocks(text);
  const pattern = titlePattern(tam.title);
  let k = entry.tamIndex;
  if (!blocks[k] || !pattern.test(blocks[k].text)) {
    const named = blocks.filter((b) => pattern.test(b.text));
    if (named.length !== 1) {
      die(
        `${entry.rel} "${entry.title}": the parsed tams and the file's ${blocks.length} live blocks disagree ` +
          `(parsed index ${entry.tamIndex}, ${named.length} blocks carry that title) - refusing to edit`,
      );
    }
    k = blocks.indexOf(named[0]);
  }
  // `raw` IS THE ORIGINAL BLOCK'S BYTES, comments included - `liveTamBlocks` slices them from the real text
  // precisely so that writing the block back cannot eat a comment (the mask it matches on is not writable).
  const raw = blocks[k].text;
  const pathBlocks = [...raw.matchAll(/<path\b[\s\S]*?<\/path>/g)].map((m) => m[0]);
  if (pathBlocks.length !== tam.paths.length) {
    die(`${entry.rel} "${entry.title}": ${pathBlocks.length} <path> blocks in the text but ${tam.paths.length} parsed - refusing to edit`);
  }
  const permutedXml = engine.permuteBy(pathBlocks, plan.permutation);
  const parts = [];
  let last = 0;
  let next = 0;
  for (const m of raw.matchAll(/<path\b[\s\S]*?<\/path>/g)) {
    parts.push(raw.slice(last, m.index));
    parts.push(permutedXml[next++]);
    last = m.index + m[0].length;
  }
  parts.push(raw.slice(last));
  const plan2 = perFile.get(entry.rel) ?? { text, blocks };
  plan2.replacements ??= new Map();
  // KEYED BY THE BLOCK'S ORDINAL, which is what the edit loop below walks - not by the parsed index, which
  // was the same number only while no block was masked out.
  plan2.replacements.set(k, parts.join(''));
  perFile.set(entry.rel, plan2);
}

const edits = new Map();
for (const [rel, { text, blocks, replacements }] of perFile) {
  const parts = [];
  let last = 0;
  for (const [k, block] of blocks.entries()) {
    parts.push(text.slice(last, block.index));
    parts.push(replacements.get(k) ?? block.text);
    last = block.index + block.text.length;
  }
  parts.push(text.slice(last));
  edits.set(rel, { text, next: parts.join('') });
}

if (write) {
  // ONLY THE FILES THAT ACTUALLY CHANGE. An identity permutation (which is a real answer - see the skill) edits
  // nothing, and writing every dependent file back from its own bytes would still be a pointless write that a
  // reader has to diff to find out was pointless.
  const rewrite = [...edits].filter(([, edit]) => edit.next !== edit.text);
  for (const [rel, edit] of rewrite) fs.writeFileSync(path.join(assets, rel), edit.next);
  // VERIFY WHAT WAS WRITTEN, not what was planned: re-read every file and rebuild. The tam is located by the
  // SAME index the edit used, and its title is re-checked, because a title alone is not unique in this corpus
  // (`ms/sashay.xml` carries two `Ladies In, Men Sashay` tams, both from Circle).
  const reread = new Map();
  for (const rel of edits.keys()) reread.set(rel, readText(path.join(assets, rel)));
  const broke = [];
  // THE RE-PARSE CANNOT SEE A COMMENT, and that was MEASURED the hard way: a mask leak rewrote
  // `<!--  Scoot and Little  -->` to spaces in four files and every geometry check stayed green. A reorder may
  // touch the `<path>` blocks and nothing else, so the text OUTSIDE them is compared too - the one check that
  // fails on damage the parser is blind to.
  const outsidePaths = (text) => text.replace(/<path\b[\s\S]*?<\/path>/g, '\u0000');
  for (const [rel, edit] of edits) {
    if (outsidePaths(edit.text) !== outsidePaths(edit.next)) {
      broke.push(`${rel}: the reorder changed text outside the <path> blocks`);
    }
  }
  for (const { entry } of results) {
    const text = reread.get(entry.rel);
    const tams = engine.parseCallXml(text);
    const tam = tams[entry.tamIndex];
    if (!tam || tam.title !== entry.title || engine.canonicalName(tam.formationAttr ?? '') !== wanted) {
      broke.push(`${entry.rel} "${entry.title}": the written file no longer parses that tam at its own position`);
      continue;
    }
    let after;
    try {
      after = engine.buildCall(tam, newMap, moves, true);
    } catch (err) {
      broke.push(`${entry.rel} "${entry.title}": ${err.message}`);
      continue;
    }
    const cmp = engine.compareGeometry(engine.buildCall(entry.tam, oldMap, moves, true), after, { tol: 1e-6 });
    if (!cmp.ok) broke.push(`${entry.rel} "${entry.title}": after writing, geometry moves (worst ${cmp.worst.toExponential(2)})`);
  }
  if (broke.length) {
    for (const [rel, edit] of rewrite) fs.writeFileSync(path.join(assets, rel), edit.text);
    die(`the written files failed their own check and were RESTORED:\n    ${broke.join('\n    ')}`);
  }
}

// ---- the report
//
// HOW MANY DEPENDENTS ACTUALLY CHANGE is worth saying: a half-set tam whose four written paths repeat the
// written pair (`[P0,P1,P0,P1]`, which most of this corpus's symmetric calls are) reads the same under the
// permutation and needs no edit at all. On the `Circle` conversion **1 of the 22** changes and 21 are
// already invariant - which is the measured answer to "will this break many calls".
const noOp = dependents.filter(({ tam, plan }) => JSON.stringify(engine.permuteBy(tam.paths, plan.permutation)) === JSON.stringify(tam.paths)).length;
const byFile = new Map();
for (const { entry } of results) byFile.set(entry.rel, (byFile.get(entry.rel) ?? 0) + 1);
const report = {
  ok: true,
  formation,
  changed: true,
  written: write,
  oldOrder: oldLetters,
  newOrder: newLetters,
  oldAuthored: poseList(oldAuthored),
  newAuthored: poseList(newAuthored),
  permutation: halfPlan.permutation,
  halfSet: dependents.filter((d) => d.mode === 'half-set').length,
  wholeSet: dependents.filter((d) => d.mode === 'whole-set').length,
  dependents: [...byFile.entries()].map(([file, count]) => ({ file, count })),
  pathed: dependents.length - noOp,
  alreadyInvariant: noOp,
  worst,
  worstWhere,
  refused: reported,
};
if (json) {
  console.log(JSON.stringify(report, null, 1));
} else {
  // A LINE HAS ENDS, NOT QUARTERS, so a formation off the compass has no letters to print - and
  // "not on the compass -> not on the compass" would read as if the reorder did nothing, when what changed
  // is the ORDER of a board the compass cannot name.
  const orderText =
    oldLetters && newLetters
      ? `${oldLetters} -> ${newLetters}`
      : 'order changed (not on the compass, so the completed spot list is the order)';
  console.log(`${formation}: ${orderText}  (${oldAuthored.length} written dancers)`);
  console.log(`path permutation (new index -> old path): [${halfPlan.permutation.join(',')}]  (half-set tams ${report.halfSet}, whole-set ${report.wholeSet})`);
  console.log(`dependents: ${results.length} tams in ${byFile.size} files; ${report.pathed} change and ${noOp} already read the same under this permutation`);
  for (const [file, count] of [...byFile.entries()]) console.log(`  ${file}  ${count}`);
  console.log(`verification: ${results.length}/${results.length} tams, worst sampled position difference ${worst.toExponential(2)} (limit 1e-6)`);
  if (worstWhere) console.log(`  the worst is ${worstWhere}`);
  for (const line of reported) console.log(`  REFUSED ${line}`);
  console.log(write ? 'WRITTEN' : 'dry run - nothing written (pass --write to apply)');
}
process.exit(0);
