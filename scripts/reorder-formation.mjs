// TWO DIRECTIONS ON THE SAME RULE, one file because they are the same permutation, the same block rewriter and the
// same proof:
//
//   --formation <Name>     a DEFINITION's dancer order changed, so follow every call that names it;
//   --absorb-duplicates    a CALL carries its own copy of a definition's spots, so replace the copy with a
//                          reference to the definition. The duplicates and their feasibility come from
//                          `scripts/tag-formations.mjs` (`duplicateGroups`, `refactorPlan`), so what a duplicate IS
//                          is defined once and the report and the tool cannot disagree.
//
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
//   - an inline formation is a COPY that a named-formation REORDER does not reach, and an alias name (a
//     formation with the same spots under another name) is not a dependent at all. The copy is what
//     `--absorb-duplicates` is for, and it is the same permutation applied the other way: the definition's order
//     is fixed and the CALL's paths move onto it.
// So the permutation is derived by the engine's rule (`formationReorderPermutation`) and the result is
// PROVED by rebuilding every dependent before and after: a dancer may be re-ordered, never moved.
//
// WHAT IT REFUSES, and each refusal is reported rather than worked around:
//   - a dirty tree: anything modified besides `assets/formations.xml` is someone else's in-flight work
//     (AGENTS.md §8 trap 16), so nothing is written (the absorb mode refuses ANY modified tracked file);
//   - a block whose spot set is not the old one, or whose dancers cannot be matched up to a half turn;
//   - a tam whose path count is neither the written count nor twice it, or that carries `actives`, or
//     that carries an inline formation (the reorder mode cannot reach its copy - `--absorb-duplicates` can);
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
// THE DUPLICATE ROWS AND THE FEASIBILITY RULE COME FROM THE TAGGER, not from a second analysis here. What a
// duplicate IS, and whether it can be absorbed, are one rule (`refactorPlan`); this file owns only "how to absorb
// one". `scripts/tag-formations.mjs` is imported for its functions, so its CLI guard does not run.
import { loadFormations, loadTams, duplicateGroups, refactorPlan } from './tag-formations.mjs';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const USAGE = `usage: node scripts/reorder-formation.mjs --formation <Name> [--write] [--json] [--check]
       node scripts/reorder-formation.mjs --absorb-duplicates [--write] [--json] [--only=<level>] [--limit=N]

  --formation <Name>  reorder ONE named formation (its NEW block must already be in assets/formations.xml)
  --absorb-duplicates absorb every duplicate inline <formation> into the definition it duplicates
  --only=<level>      (absorb only) restrict to one level directory, e.g. --only=ms
  --limit=N           (absorb only) stop after N tams, for a staged run
  --write             apply the plan (default: report it and write nothing)
  --check             (--formation only) exit 0 when the working block matches HEAD
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
const absorb = argv.includes('--absorb-duplicates');
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? null;
const limitArg = (argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] ?? null;
const limit = limitArg ? Number(limitArg) : Infinity;
const write = argv.includes('--write');
const check = argv.includes('--check');
const json = argv.includes('--json');
if (!formation && !absorb) {
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
if (!absorb) {
  const stray = dirty.filter((line) => !/^[AM ]?M\s+assets\/formations\.xml$/.test(line));
  if (stray.length) {
    die(
      `the tree is dirty outside assets/formations.xml, so this is not safe to run:\n    ${stray.join('\n    ')}\n` +
        '  Commit or stash that work first (AGENTS.md §8 trap 16). Nothing was written.',
    );
  }
}

// ---- the duplicate-absorbing mode: every inline block that duplicates a definition becomes a reference to it
if (absorb) process.exit(await absorbDuplicates(dirty));

/**
 * Replace each absorbable duplicate's inline `<formation>` with a `formation="Name"` reference on its `<tam>`,
 * permuting that tam's `<path>` blocks so every dancer keeps its own track.
 *
 * THE ROWS AND THE RULE COME FROM `scripts/tag-formations.mjs`; this function only decides HOW. Every tam is
 * PROVED before anything is written - the call is built from the corpus, then built again from the converted tam
 * against the named definition, and `compareGeometry` requires every sampled pose to agree to 1e-6. A rotated
 * copy, a size mismatch, an `actives` subset and an unprovable pairing were already refused by `refactorPlan`, so
 * a proof failure here is a defect in this transform, not a corpus refusal: nothing is written.
 *
 * WHAT IS REMOVED IS ONLY THE BLOCK. Everything else in the tam - its attributes, its `from`, the comments around
 * it, the <path> bytes - is untouched, and the write is re-read and re-verified before it stands (the restore-on-
 * failure rule the reorder mode uses).
 */
async function absorbDuplicates(dirtyTree) {
  if (dirtyTree.length) {
    return refuse(
      `the tree is dirty, so this is not safe to run:\n    ${dirtyTree.join('\n    ')}\n` +
        '  Commit or stash that work first (AGENTS.md §8 trap 16). Nothing was written.',
    );
  }
  const formations = loadFormations();
  const { files: tamFiles } = loadTams();
  const rows = duplicateGroups(formations, tamFiles);
  const planned = [];
  const refused = [];
  for (const row of rows) {
    const plan = refactorPlan(row);
    if (!plan.ok) { refused.push({ label: row.e.label, why: plan.reason }); continue; }
    if (only && row.e.level !== only) continue;
    planned.push({ row, plan });
  }
  const batch = planned.slice(0, Number.isFinite(limit) ? limit : planned.length);
  if (!batch.length) {
    if (json) console.log(JSON.stringify({ ok: true, absorbed: 0, refused }, null, 1));
    else console.log('absorb-duplicates: no absorbable duplicate in this selection');
    return 0;
  }

  const assets = corpusRoot();
  const formationsXml = readText(path.join(assets, 'formations.xml'));
  const formationsMap = engine.parseFormations(formationsXml);
  const moves = engine.parseMoves(readText(path.join(assets, 'moves.xml')));
  const fileText = new Map();
  const tamCache = new Map();
  const parsedOf = (rel) => {
    if (!tamCache.has(rel)) tamCache.set(rel, engine.parseCallXml(textOf(rel)));
    return tamCache.get(rel);
  };
  const textOf = (rel) => {
    if (!fileText.has(rel)) fileText.set(rel, readText(path.join(assets, rel)));
    return fileText.get(rel);
  };

  // ---- plan and PROVE every tam before a byte is written
  const results = [];
  const failures = [];
  let worst = 0;
  let worstWhere = '';
  let noChange = 0;
  for (const { row, plan } of batch) {
    const e = row.e;
    const rel = `${e.level}/${e.file}`;
    // A NAME WITH AN XML-SPECIAL CHARACTER IS REFUSED RATHER THAN ESCAPED: the tree has exactly four escaper
    // implementations and a gate that counts them (`poc/tools/escape-probe.mjs`), so a fifth here would be the
    // wrong fix. MEASURED: no formation name in the corpus carries `&`, `<`, `>` or `"`.
    if (/[&<>"]/.test(plan.name)) { failures.push(`${e.label}: the name "${plan.name}" needs XML escaping, which this tool does not do`); continue; }
    const tams = parsedOf(rel);
    const tam = tams[e.tamIndex];
    if (!tam || tam.title !== e.title) { failures.push(`${e.label}: the parsed tam at that position is not this one`); continue; }
    const blocks = liveTamBlocks(textOf(rel));
    if (!blocks[e.tamIndex] || !titlePattern(e.title).test(blocks[e.tamIndex].text)) {
      failures.push(`${e.label}: the live block at that position does not carry this title`);
      continue;
    }
    const raw = blocks[e.tamIndex].text;
    const masked = raw.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
    const tag = /^<tam\b[^>]*>/.exec(masked);
    if (!tag) { failures.push(`${e.label}: the block does not open with a <tam> tag`); continue; }
    if (/\bformation=/.test(tag[0])) { failures.push(`${e.label}: the tam already carries a formation attribute`); continue; }
    const inline = /<formation\b[^>]*>[\s\S]*?<\/formation>/.exec(masked);
    if (!inline) { failures.push(`${e.label}: no inline <formation> block found in the tam`); continue; }
    const pathMatches = [...masked.matchAll(/<path\b[\s\S]*?<\/path>/g)].map((m) => ({ at: m.index, end: m.index + m[0].length, text: raw.slice(m.index, m.index + m[0].length) }));
    if (pathMatches.length !== tam.paths.length) {
      failures.push(`${e.label}: ${pathMatches.length} <path> blocks in the text but ${tam.paths.length} parsed`);
      continue;
    }
    const permuted = engine.permuteBy(tam.paths, plan.plan.permutation);
    const permutedXml = engine.permuteBy(pathMatches.map((p) => p.text), plan.plan.permutation);
    const changes = JSON.stringify(permuted.map((p) => p.length)) !== JSON.stringify(tam.paths.map((p) => p.length))
      || permutedXml.some((x, i) => x !== pathMatches[i].text);
    if (!changes) noChange++;

    // THE CONVERTED TAM, proved against the corpus as it stands.
    const after = { ...tam, dancers: [], formationAttr: plan.name, paths: permuted };
    let beforeCall;
    let afterCall;
    try {
      beforeCall = engine.buildCall(tam, formationsMap, moves, true);
      afterCall = engine.buildCall(after, formationsMap, moves, true);
    } catch (err) {
      failures.push(`${e.label}: ${err.message}`);
      continue;
    }
    const cmp = engine.compareGeometry(beforeCall, afterCall, { tol: 1e-6 });
    if (!cmp.ok) {
      failures.push(`${e.label}: the conversion moves a dancer (worst ${cmp.worst.toExponential(2)} at dancer ${cmp.worstDancer}, ${cmp.unmatched} unmatched)`);
      continue;
    }
    if (cmp.worst >= worst) { worst = cmp.worst; worstWhere = e.label; }

    // ---- the block's new text: the tam tag gains the attribute, the inline block goes, the paths permute
    const edits = [];
    edits.push({ at: tag[0].length - 1, end: tag[0].length - 1, text: ` formation="${plan.name}"` });
    // Sweep the whitespace before the block back to the previous non-space, and swallow it only when it holds a
    // newline - so a block on its own lines leaves no blank line, and a block sharing a line with the tag keeps
    // the gap that was there.
    let removeFrom = inline.index;
    let back = removeFrom - 1;
    while (back >= 0 && /[\s]/.test(raw[back])) back--;
    if (raw.slice(back + 1, removeFrom).includes('\n')) removeFrom = back + 1;
    edits.push({ at: removeFrom, end: inline.index + inline[0].length, text: '' });
    pathMatches.forEach((p, i) => edits.push({ at: p.at, end: p.end, text: permutedXml[i] }));
    edits.sort((a, b) => b.at - a.at || b.end - a.end);
    let next = raw;
    for (const edit of edits) next = `${next.slice(0, edit.at)}${edit.text}${next.slice(edit.end)}`;
    if (engine.parseCallXml(`<calls>${next}</calls>`).length !== 1) {
      failures.push(`${e.label}: the rewritten block does not parse as one tam`);
      continue;
    }
    results.push({ row, plan, rel, tamIndex: e.tamIndex, title: e.title, raw, next, changes });
  }
  if (failures.length) {
    return refuse(`the transform does not hold for every tam, so NOTHING was written:\n    ${failures.join('\n    ')}`);
  }

  // ---- one pass per file, keyed by the live block's ordinal
  const perFile = new Map();
  for (const r of results) {
    const entry = perFile.get(r.rel) ?? { text: textOf(r.rel), blocks: liveTamBlocks(textOf(r.rel)), replacements: new Map() };
    entry.replacements.set(r.tamIndex, r.next);
    perFile.set(r.rel, entry);
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
    for (const [rel, edit] of edits) if (edit.next !== edit.text) fs.writeFileSync(path.join(assets, rel), edit.next, 'utf8');
    // VERIFY WHAT WAS WRITTEN: re-read, re-parse, rebuild, re-compare - and restore every file on any failure.
    const broke = [];
    for (const r of results) {
      const text = readText(path.join(assets, r.rel));
      const tam = engine.parseCallXml(text)[r.tamIndex];
      if (!tam || tam.title !== r.title || tam.dancers.length !== 0 || tam.formationAttr !== r.plan.name) {
        broke.push(`${r.rel} "${r.title}": the written file no longer parses that tam as a reference to ${r.plan.name}`);
        continue;
      }
      const cmp = engine.compareGeometry(
        engine.buildCall(parsedOf(r.rel)[r.tamIndex], formationsMap, moves, true),
        engine.buildCall(tam, formationsMap, moves, true),
        { tol: 1e-6 },
      );
      if (!cmp.ok) broke.push(`${r.rel} "${r.title}": after writing, geometry moves (worst ${cmp.worst.toExponential(2)})`);
    }
    if (broke.length) {
      for (const [rel, edit] of edits) fs.writeFileSync(path.join(assets, rel), edit.text, 'utf8');
      return refuse(`the written files failed their own check and were RESTORED:\n    ${broke.join('\n    ')}`);
    }
  }

  const byFile = new Map();
  for (const r of results) byFile.set(r.rel, (byFile.get(r.rel) ?? 0) + 1);
  const report = {
    ok: true,
    written: write,
    absorbed: results.length,
    files: byFile.size,
    pathChanged: results.filter((r) => r.changes).length,
    pathUnchanged: noChange,
    worst,
    worstWhere,
    refused,
  };
  if (json) {
    console.log(JSON.stringify({ ...report, tams: results.map((r) => ({ rel: r.rel, title: r.title, formation: r.plan.name, mode: r.plan.mode, pathChanged: r.changes })) }, null, 1));
  } else {
    console.log(`absorb-duplicates: ${results.length} tam(s) in ${byFile.size} file(s); ${report.pathChanged} need a different path order and ${noChange} already read the same under it`);
    console.log(`verification: every tam built before and after, worst sampled position difference ${worst.toExponential(2)} (limit 1e-6)${worstWhere ? ` at ${worstWhere}` : ''}`);
    console.log(`refused by the rule: ${refused.length} (reasons in DuplicateFormations.md)`);
    console.log(write ? 'WRITTEN' : 'dry run - nothing written (pass --write to apply)');
  }
  return 0;
}

/** Refuse with the mode's own voice: JSON when asked, a marked line otherwise, exit 1. */
function refuse(message) {
  if (json) console.log(JSON.stringify({ ok: false, reason: message }, null, 1));
  else console.error(`✗ ${message}`);
  return 1;
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
  for (const file of filesOf(dir).filter((f) => f.endsWith('.xml'))) {
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
