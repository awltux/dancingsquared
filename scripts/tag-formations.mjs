// DIRECT TAGS ON FORMATION DEFINITIONS: `fid` (formation id) and `aid` (arrangement id).
//
// THE RULE, which is the user's and replaces the root ledger:
//   * a formation definition writes HALF the set; the whole is `reconstituteWholeSet(written)` - the written
//     dancers plus the same dancers rotated 180 degrees about the origin, skipped when the written shape already
//     contains its own antipodes. Both ids are taken over THAT geometry, never over the written half;
//   * an untagged definition is matched against the definitions that already carry tags. A FORMATION match
//     (shape, gender ignored) inherits the `fid` and keeps its own computed `aid`; an ARRANGEMENT match (shape
//     AND genders) is a DUPLICATE and inherits both. The alignment must be a ROTATION - a reflected match is a
//     different id, because `canonicalOf` never mirrors;
//   * a duplicate inside a call's embedded formation is recorded in `DuplicateFormations.md` so the call can be
//     refactored to name the `formations.xml` definition (`scripts/reorder-formation.mjs`);
//   * no match means the definition is new, and its tags are the computed ids.
//
// WHY TAGS AND NOT A LEDGER. `fid`/`aid` are stored on the definition, so they are authoritative by construction:
// a geometry edit cannot re-key a reference, and there is nothing to alias. That is the whole of the simplification
// - `assets/formation-roots.json` needed a generated mapping and a hand-written alias file for the same stability.
//
// WHY THE ORDER OF THE MATCH IS EXACT-FIRST. `formationId` already quotients out rotation and translation, so two
// definitions of one shape share an id EXACTLY, and the nine `Ocean Waves` names (one geometry, nine gender
// layouts) are nine `aid`s under one `fid`. The tolerance scan therefore only ever decides the NEAR-duplicates,
// and running it over the whole corpus for every definition would be 500 x 500 matcher calls to answer a question
// a dictionary answers for all but a handful.
//
// THE TOLERANCE IS THE ENGINE'S OWN, not a new number: `DEFAULT_MATCH_MAX` (1.5), the threshold `corpusFormation`
// uses for "is this board a formation the corpus defines" (its `matchMargin` default is 0). Importing it means a
// moved tolerance moves this tool with the engine instead of leaving it measuring with a stale ruler.
//
// Run: node scripts/tag-formations.mjs             (verify; exit 1 on anything untagged or stale)
//      node scripts/tag-formations.mjs --write     (add the tags and rewrite DuplicateFormations.md)
//      node scripts/tag-formations.mjs --json      (the same analysis, machine-readable)
//
// VERIFYING IS THE DEFAULT AND WRITING IS THE FLAG, deliberately: this tool rewrites the corpus, and a tool that
// rewrites the corpus when invoked plainly is a tool that will one day rewrite it while the shapes it encodes are
// being adjudicated (the same rule `scripts/reorder-formation.mjs` and `test/tools/formation-roots.mjs` follow).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  setParser,
  parseFormations,
  parseFormationTags,
  parseCallXml,
  reconstituteWholeSet,
  formationId,
  arrangementId,
  isFormationId,
  isArrangementId,
  matchFormations,
  DEFAULT_MATCH_MAX,
} from '../engine/dist/index.js';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';
import { liveTamBlocks } from './tam-blocks.mjs';

setParser(DOMParser);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = corpusRoot();
const REPORT = path.join(ROOT, 'DuplicateFormations.md');
const DEG = Math.PI / 180;

/** Every level whose call files carry tams. `src/` holds the engine's own fixtures; `corpus-inventory` reads both. */
export const TAG_LEVELS = ['discovered', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b', 'src'];

const read = (p) => fs.readFileSync(path.join(ASSETS, p), 'utf8');

/** Blank out comments without moving a single byte, so an offset survives the mask (`scripts/tam-blocks.mjs`). */
const maskComments = (text) => text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));

/** The `<tag …>` open tags of a file, with their offsets in the ORIGINAL text. */
function openTags(text, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  return [...maskComments(text).matchAll(re)].map((m) => ({ at: m.index, end: m.index + m[0].length, raw: m[0] }));
}

/**
 * The geometry a definition denotes: the reconstituted whole set, as the matcher and the ids read it.
 *
 * `symmetry` is the definition's own declaration where it has one. A named `<formation>` carries no reader for
 * `asymmetric` - `parseFormations` reads the name and the dancers only - so a named definition is always
 * reconstituted. An inline block is gated by its `<tam asymmetric="…">`, which is exactly what `buildCallImpl`
 * does before it pairs paths.
 */
function geometryOf(dancers, symmetry = 2) {
  const full = symmetry === 2 ? reconstituteWholeSet(dancers) : [...dancers];
  return { dancers: full.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })) };
}

/** Whether two spots in a geometry coincide - a malformed half, reported rather than tagged as if it were fine. */
function coincident(board) {
  const ds = board.dancers;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      if (Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y) < 0.01) return [i, j];
    }
  }
  return null;
}

/** Every named definition in `formations.xml`, with the offset of the open tag that carries its attributes. */
export function loadFormations() {
  const text = read('formations.xml');
  const parsed = parseFormations(text);
  const tags = parseFormationTags(text);
  const opens = openTags(text, 'formation');
  const named = [...parsed.keys()];
  const problems = [];
  if (opens.length !== named.length) {
    problems.push(`formations.xml has ${opens.length} <formation> open tag(s) but ${named.length} named definition(s) - a duplicate name would be hidden by the parser's Map`);
  }
  const defs = named.map((name, i) => {
    const dancers = parsed.get(name) ?? [];
    // A DEFINITION MAY DECLARE ITSELF WHOLE. `asymmetric="true"` on a `<formation>` is the corpus's own statement
    // that the written dancers are the whole set, and 11 two-dancer definitions carry it. Nothing in
    // `parseFormations` reads it (the tamination reader takes the name and the dancers only), but the tag has to
    // agree with the board the engine builds - and `buildCallImpl` honours the REFERENCING tam's declaration, so a
    // definition that declares itself whole and is referenced by an `asymmetric="true"` tam builds at its written
    // size. MEASURED: without this, `Corner Dancers Far` (2 dancers, declared) was tagged with the id of a
    // 4-dancer set no board has.
    const declared = /<formation\b[^>]*\basymmetric="true"/.test(opens[i]?.raw ?? '');
    const board = geometryOf(dancers, declared ? 1 : 2);
    return {
      name,
      kind: 'named',
      label: `formations.xml - ${name}`,
      written: dancers.length,
      size: board.dancers.length,
      board,
      declaredAsymmetric: declared,
      fid: tags.get(name)?.fid ?? null,
      aid: tags.get(name)?.aid ?? null,
      at: opens[i]?.at ?? -1,
      end: opens[i]?.end ?? -1,
    };
  });
  return { text, defs, problems };
}

/** Every inline `<formation>` in every live `<tam>`, with its offset, plus the symmetry each NAMED reference declares. */
export function loadTams() {
  const out = [];
  /** formation name -> the `asymmetric` values of the tams that name it. A definition's completion is declared at
   *  the reference site, so a disagreement here is a corpus fact worth reporting rather than a tag decision. */
  const refs = new Map();
  for (const level of TAG_LEVELS) {
    for (const file of filesOf(level)) {
      const text = read(`${level}/${file}`);
      const tams = parseCallXml(text);
      const blocks = liveTamBlocks(text);
      for (const tam of tams) {
        if (!tam.formationAttr) continue;
        const list = refs.get(tam.formationAttr) ?? [];
        list.push({ level, file, title: tam.title, symmetry: tam.symmetry });
        refs.set(tam.formationAttr, list);
      }
      if (blocks.length !== tams.length) {
        out.push({ level, file, text, entries: [], problems: [`${level}/${file}: ${blocks.length} live <tam> block(s) but the parser returned ${tams.length}`] });
        continue;
      }
      const entries = [];
      const problems = [];
      for (let i = 0; i < tams.length; i++) {
        const tam = tams[i];
        if (tam.dancers.length === 0) continue; // no inline block: the tam names a definition, which carries the tags
        const masked = maskComments(blocks[i].text);
        const m = /<formation\b[^>]*>/.exec(masked);
        if (!m) { problems.push(`${level}/${file}#${tam.title}: the parser read ${tam.dancers.length} inline dancer(s) but no <formation> open tag was found`); continue; }
        const at = blocks[i].index + m.index;
        const board = geometryOf(tam.dancers, tam.symmetry);
        entries.push({
          kind: 'inline',
          level,
          file,
          title: tam.title,
          // THE ORDINAL IS PART OF THE LABEL. A title is not an identity - `ms/allemande.xml` carries several
          // `Allemande Left` tams, one per setup - so a report row addressed only by title names a call, not the
          // definition the row is about. The index is the position in the live tam list, which `liveTamBlocks`
          // and `parseCallXml` agree on (that is what `scripts/tam-blocks.mjs` exists to guarantee).
          label: `${level}/${file} - ${tam.title || '(untitled)'} #${i}`,
          written: tam.dancers.length,
          size: board.dancers.length,
          board,
          fid: tam.formationTag.fid,
          aid: tam.formationTag.aid,
          at,
          end: at + m[0].length,
        });
      }
      out.push({ level, file, text, entries, problems });
    }
  }
  return { files: out, refs };
}

/**
 * Assign tags to every definition, in one deterministic pass.
 *
 * THE POOL IS SEEDED WITH WHAT IS ALREADY TAGGED, so re-running the tool is idempotent and never re-mints an id:
 * an already-tagged definition is authoritative, and an untagged one searches the tagged set. Within one run the
 * newly tagged definitions join the pool, so a shape's SECOND occurrence inherits the FIRST one's `fid` in file
 * order - the same order the earlier census used, which is what keeps the ids the ledger already holds.
 *
 * NAMED DEFINITIONS ARE SEARCHED BEFORE INLINE ONES at every step, because a duplicate should point at the
 * `formations.xml` definition a call can be refactored to name, not at another anonymous block.
 */
export function assignTags(formations, tamFiles) {
  const pool = { named: [], inline: [] };
  const byFid = { named: new Map(), inline: new Map() };
  const add = (entry) => {
    pool[entry.kind].push(entry);
    const map = byFid[entry.kind];
    const list = map.get(entry.fid) ?? [];
    list.push(entry);
    map.set(entry.fid, list);
  };

  const untaggedNamed = [];
  for (const d of formations.defs) {
    if (d.fid && d.aid) add(d);
    else untaggedNamed.push(d);
  }
  // Everything an inline block can inherit from: every named definition (tagged now, or tagged in this pass) plus
  // the inline blocks already carrying tags.
  for (const f of tamFiles) for (const e of f.entries) if (e.fid && e.aid) add(e);

  /**
   * WHETHER AN ENTRY MINTS ITS OWN ID, i.e. its tags are the ids its geometry computes. Only a ROOTED entry may be
   * the target of a TOLERANCE match: an inherited entry's tags were borrowed at some error, so chaining through one
   * compounds that error into an id whose rooting definition may be far outside the tolerance - and then the id
   * names a geometry nothing in the corpus actually is (MEASURED: four `a2/box_counter_rotate.xml` inline blocks
   * inherited through an inherited twin at error 0.785 and their rooting definition was out of reach, which the
   * audit in `problems()` caught).
   *
   * AN EXACT MATCH MAY USE ANY ENTRY, because there the ids are equal by construction - `formationId` is a function
   * of the geometry, so an entry that computes this fid IS this shape whatever it inherited.
   */
  const rooted = (e) => e.fid === formationId(e.board) && e.aid === arrangementId(e.board);

  const notes = [];
  const resolve = (entry) => {
    const fid = formationId(entry.board);
    const aid = arrangementId(entry.board);
    const shapeOf = (kind) => byFid[kind].get(fid) ?? [];
    const exactNamed = shapeOf('named');
    const exactInline = shapeOf('inline');
    const exact = exactNamed.length ? exactNamed : exactInline;
    if (exact.length) {
      const twin = exact.find((e) => e.aid === aid);
      const target = twin ?? exact[0];
      return twin
        ? { fid: target.fid, aid: target.aid, match: { kind: 'duplicate', target } }
        : { fid: target.fid, aid, match: { kind: 'shape', target } };
    }
    // No exact shape: the near-duplicates. An ARRANGEMENT match is the stronger finding and is checked first,
    // because inheriting a shape's fid while keeping a computed aid would leave a duplicate looking distinct.
    //
    // A REFLECTED ALIGNMENT IS NOT A MATCH. `matchFormations` tries the eight rotations AND a reflection, which is
    // the right group for "is this board this formation" and the WRONG one for an id: `canonicalOf` takes the
    // smallest of four QUARTER TURNS and never a mirror, so a mirror image is a different fid (MEASURED: `Wave LH`
    // is `F3-ogn0v1rs` and `Wave RH` is `F3-9vxgr91a`). Accepting a reflected match would tag one of them with the
    // other's id - the ids would stop being a partition of the corpus's shapes.
    const near = (requireGender) => {
      let best = null;
      let second = Infinity;
      for (const kind of ['named', 'inline']) {
        for (const e of pool[kind]) {
          if (!rooted(e)) continue;
          if (e.board.dancers.length !== entry.board.dancers.length) continue;
          const m = matchFormations(entry.board.dancers, e.board.dancers, DEFAULT_MATCH_MAX, requireGender);
          if (!m || m.reflect) continue;
          if (best === null || m.error < best.error) {
            if (best !== null) second = Math.min(second, best.error);
            best = { error: m.error, target: e };
          } else {
            second = Math.min(second, m.error);
          }
        }
      }
      return best === null ? null : { ...best, tied: best.error === second };
    };
    const arr = near(true);
    if (arr) {
      if (arr.tied) notes.push(`${entry.label}: two arrangements match at error ${arr.error.toFixed(3)}; took ${arr.target.label} (named and inline searched in order)`);
      return { fid: arr.target.fid, aid: arr.target.aid, match: { kind: 'duplicate', target: arr.target, tolerance: arr.error } };
    }
    const shape = near(false);
    if (shape) {
      if (shape.tied) notes.push(`${entry.label}: two shapes match at error ${shape.error.toFixed(3)}; took ${shape.target.label}`);
      return { fid: shape.target.fid, aid, match: { kind: 'shape', target: shape.target, tolerance: shape.error } };
    }
    return { fid, aid, match: { kind: 'fresh' } };
  };

  const tag = (entry) => {
    if (entry.fid && entry.aid) {
      // ALREADY TAGGED IS AUTHORITATIVE. Re-resolving would make a verification run re-classify a definition
      // against a pool that now contains definitions the first run had not reached yet, so the report would move
      // without the corpus moving. `problems()` audits what was stored instead.
      entry.newFid = entry.fid;
      entry.newAid = entry.aid;
      return entry;
    }
    const r = resolve(entry);
    entry.newFid = r.fid;
    entry.newAid = r.aid;
    entry.match = r.match;
    add({ ...entry, fid: r.fid, aid: r.aid });
    return entry;
  };

  for (const d of untaggedNamed) tag(d);
  for (const f of tamFiles) for (const e of f.entries) tag(e);

  return { notes };
}

/**
 * THE DUPLICATES, DERIVED FROM THE TAGS THE CORPUS NOW CARRIES - not from the order the tags were assigned in.
 *
 * One arrangement belongs to one definition; a second definition carrying the same `aid` is the same setup under
 * another spelling. This is a pure function of the tag set, so a verification run and a write run agree, and a
 * refactor that removes a duplicate removes its row by itself.
 *
 * THE CANONICAL MEMBER OF A GROUP IS THE FIRST NAMED DEFINITION in `formations.xml` order, else the first inline
 * definition in document order - named first so a duplicate always points at the definition a call can be
 * refactored to name.
 */
export function duplicateGroups(formations, tamFiles) {
  const all = [...formations.defs.map((d) => ({ e: d, tag: d.fid && d.aid ? { fid: d.fid, aid: d.aid } : { fid: d.newFid, aid: d.newAid } })),
    ...tamFiles.flatMap((f) => f.entries.map((e) => ({ e, tag: e.fid && e.aid ? { fid: e.fid, aid: e.aid } : { fid: e.newFid, aid: e.newAid } })))];
  const groups = new Map();
  for (const m of all) {
    const list = groups.get(m.tag.aid) ?? [];
    list.push(m);
    groups.set(m.tag.aid, list);
  }
  const rows = [];
  for (const [aid, list] of groups) {
    if (list.length < 2) continue;
    const canonical = list.find((m) => m.e.kind === 'named') ?? list[0];
    for (const m of list) if (m !== canonical) rows.push({ e: m.e, tag: m.tag, canonical: canonical.e, aid });
  }
  return rows;
}

/** How a duplicate should be closed. A named definition can only be merged by hand; an inline one can be replaced. */
function outcomeOf(row) {
  if (row.e.kind === 'named') return { action: 'keep-named', why: 'two named definitions share an arrangement; merging them is a corpus decision, not a replacement' };
  if (row.canonical.kind === 'named') return { action: 'refactor', why: `replace the inline block with formation="${row.canonical.name}" (scripts/reorder-formation.mjs)` };
  return { action: 'keep-embedded', why: 'its duplicate is another inline block, so there is no named definition to reference' };
}

/**
 * `DuplicateFormations.md`, rendered from the tags.
 *
 * A GENERATED FILE, so the gate compares it byte for byte: a duplicate that is closed by a refactor and left in
 * this table is a claim nobody can check, and a new one that is not recorded here is a duplicate nobody will.
 */
export function renderReport(formations, tamFiles, rows, notes, refs) {
  const named = formations.defs;
  const inline = tamFiles.flatMap((f) => f.entries);
  const all = [...named, ...inline];
  const fids = new Set(all.map((e) => e.fid ?? e.newFid));
  const aids = new Set(all.map((e) => e.aid ?? e.newAid));
  const inherited = all.filter((e) => (e.fid ?? e.newFid) !== formationId(e.board));
  // A DEFINITION IS COMPLETED BY THE REFERENCE SITE'S DECLARATION, so a name whose tams disagree has no single
  // board: one tam dances it as written and another doubles it. Reported, because the tag has to pick one and the
  // corpus is what should decide.
  const disagreeing = [...refs.entries()]
    .map(([name, list]) => {
      const bySym = new Map();
      for (const r of list) bySym.set(r.symmetry, [...(bySym.get(r.symmetry) ?? []), `${r.level}/${r.file} - ${r.title}`]);
      return { name, bySym, syms: [...bySym.keys()].sort() };
    })
    .filter((r) => r.syms.length > 1 && named.some((d) => d.name === r.name));
  const sorted = rows
    .map((r) => ({ r, out: outcomeOf(r) }))
    .sort((a, b) => (a.out.action === b.out.action ? a.r.e.label.localeCompare(b.r.e.label) : a.out.action.localeCompare(b.out.action)));
  const lines = [];
  lines.push('# Duplicate formation definitions');
  lines.push('');
  lines.push('GENERATED by `scripts/tag-formations.mjs --write`; do not edit. Regenerated and compared byte for byte');
  lines.push('by `engine/test/formation-tags.mjs`.');
  lines.push('');
  lines.push('A duplicate is a definition whose **arrangement** (shape AND where the genders stand) is already carried');
  lines.push('by another definition, so it is the same setup under a second spelling. The ids come from the geometry');
  lines.push('(`reconstituteWholeSet` of the written half), and a `refactor` row is closed by making the call name the');
  lines.push('`formations.xml` definition instead of carrying its own copy of the geometry.');
  lines.push('');
  lines.push(`- named definitions: ${named.length}`);
  lines.push(`- inline definitions: ${inline.length}`);
  lines.push(`- distinct formation ids: ${fids.size}`);
  lines.push(`- distinct arrangement ids: ${aids.size}`);
  lines.push(`- duplicates: ${rows.length} (${sorted.filter((r) => r.out.action === 'refactor').length} to refactor, ${sorted.filter((r) => r.out.action === 'keep-embedded').length} kept embedded, ${sorted.filter((r) => r.out.action === 'keep-named').length} named pairs)`);
  lines.push('');
  if (!sorted.length) {
    lines.push('No duplicate definitions.');
  } else {
    lines.push('| definition | dancers | duplicate of | fid | aid | outcome |');
    lines.push('|---|---|---|---|---|---|');
    for (const { r, out } of sorted) {
      const where = r.e.kind === 'named' ? `named - ${r.e.name}` : r.e.label;
      lines.push(`| ${where} | ${r.e.written} written / ${r.e.size} whole | ${r.canonical.label} | ${r.tag.fid} | ${r.tag.aid} | ${out.action}: ${out.why} |`);
    }
  }
  if (notes.length) {
    lines.push('');
    lines.push('## Ambiguities');
    lines.push('');
    for (const n of notes) lines.push(`- ${n}`);
  }
  lines.push('');
  lines.push('## Inherited ids');
  lines.push('');
  lines.push('A definition whose tag is not the content address of its own geometry. That is deliberate: the tag is a');
  lines.push('REFERENCE, and an inherited one points at the definition the corpus already has for this setup.');
  lines.push('');
  if (!inherited.length) lines.push('None: every tag is the id its own geometry computes.');
  else {
    for (const e of inherited) lines.push(`- ${e.kind === 'named' ? `named - ${e.name}` : e.label} carries ${e.fid ?? e.newFid}; its geometry computes ${formationId(e.board)}`);
  }
  lines.push('');
  lines.push('## Reference disagreements');
  lines.push('');
  lines.push('A named definition completed by tams that declare DIFFERENT `asymmetric` values has no single board, so');
  lines.push('its tag follows the definition\'s own `asymmetric` (absent = half a set). Named, not fixed: the corpus');
  lines.push('should say which it is.');
  lines.push('');
  if (!disagreeing.length) lines.push('None.');
  else {
    for (const d of disagreeing) {
      const parts = d.syms.map((s) => `${d.bySym.get(s).length} declare ${s} (e.g. ${d.bySym.get(s)[0]})`);
      lines.push(`- ${d.name}: ${parts.join('; ')}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

/** Modified TRACKED paths, relative to the repo root. An untracked `??` entry is a new file, not a modification. */
function modifiedPaths() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    return out
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('??'))
      .map((l) => l.slice(3).trim());
  } catch {
    return [];
  }
}

function analyse() {
  const formations = loadFormations();
  const { files: tamFiles, refs } = loadTams();
  const { notes } = assignTags(formations, tamFiles);
  const rows = duplicateGroups(formations, tamFiles);
  const report = renderReport(formations, tamFiles, rows, notes, refs);
  return { formations, tamFiles, refs, rows, notes, report };
}

/** Insert the missing attributes into one open tag, at the offset that closes it. */
function insert(tagEnd, addFid, addAid) {
  const attrs = [addFid ? `fid="${addFid}"` : null, addAid ? `aid="${addAid}"` : null].filter(Boolean).join(' ');
  return { at: tagEnd - 1, text: ` ${attrs}` };
}

/** The edits that bring one file's definitions up to date, applied from the end so offsets stay true. */
function editsFor(entries) {
  const edits = [];
  for (const e of entries) {
    if (e.at < 0) continue;
    const addFid = !e.fid ? e.newFid : null;
    const addAid = !e.aid ? e.newAid : null;
    if (!addFid && !addAid) continue;
    // An id is never invented here: it is the computed one or an inherited one, and `problems()` refuses anything
    // that is not a well-formed id before this runs.
    edits.push(insert(e.end, addFid, addAid));
  }
  return edits.sort((a, b) => b.at - a.at);
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of edits) out = `${out.slice(0, e.at)}${e.text}${out.slice(e.at)}`;
  return out;
}

/**
 * Everything that stops the corpus being well tagged, as a pure function of the loaded model.
 *
 * EXPORTED SO THE GATE CAN DRIVE IT WITH A DOCTORED MODEL. `test/formation-tags.mjs` runs it on the corpus and then
 * on a copy with two tags removed, which is what proves the check is not vacuous - a gate that only ever sees a
 * correct corpus cannot tell "no failures" from "nothing looked".
 */
export function tagProblems(formations, tamFiles) {
  const out = [...formations.problems];
  const all = [...formations.defs, ...tamFiles.flatMap((f) => f.entries)];
  const seenName = new Set();
  for (const d of formations.defs) {
    if (d.written === 0) out.push(`${d.label}: no <dancer> children were parsed, so its geometry is the empty board (a tag on it would name nothing)`);
    if (seenName.has(d.name)) out.push(`${d.label}: the name appears twice in formations.xml`);
    seenName.add(d.name);
    const where = coincident(d.board);
    if (where) out.push(`${d.label}: the reconstituted set puts two dancers on one spot (${where.join(', ')}), so it is not a valid half set`);
  }
  for (const f of tamFiles) out.push(...f.problems);
  for (const e of all) {
    if (e.written === 0 && e.kind === 'inline') out.push(`${e.label}: the inline block has no <dancer> children`);
    if (!e.fid || !e.aid) {
      out.push(`${e.label}: untagged (run \`node scripts/tag-formations.mjs --write\`)`);
      continue;
    }
    if (!isFormationId(e.fid)) out.push(`${e.label}: fid "${e.fid}" is not a formation id`);
    if (!isArrangementId(e.aid)) out.push(`${e.label}: aid "${e.aid}" is not an arrangement id`);
    const where = e.kind === 'inline' ? coincident(e.board) : null;
    if (where) out.push(`${e.label}: the reconstituted set puts two dancers on one spot (${where.join(', ')})`);
  }
  if (out.some((p) => /untagged|no <dancer>/.test(p))) return out; // the audits below need every tag present

  // ONE ARRANGEMENT BELONGS TO ONE FORMATION: a stored aid that names two different fids is a mistyped attribute.
  const aidToFid = new Map();
  for (const e of all) {
    const seen = aidToFid.get(e.aid);
    if (seen && seen !== e.fid) out.push(`aid ${e.aid} names fid ${seen} on one definition and fid ${e.fid} on ${e.label}`);
    aidToFid.set(e.aid, e.fid);
  }

  // EVERY STORED fid IS ROOTED BY A REAL GEOMETRY. A tag that equals no definition's computed id is a typo or a
  // leftover from an older scheme, and every variant that hangs off it would resolve to nothing.
  const byFid = new Map();
  const byAid = new Map();
  for (const e of all) {
    byFid.set(e.fid, [...(byFid.get(e.fid) ?? []), e]);
    byAid.set(e.aid, [...(byAid.get(e.aid) ?? []), e]);
  }
  const rooted = new Map(); // fid -> the definitions whose computed id it is
  const rootedAid = new Map(); // aid -> the definitions whose computed arrangement it is
  for (const e of all) {
    const cf = formationId(e.board);
    const ca = arrangementId(e.board);
    rooted.set(cf, [...(rooted.get(cf) ?? []), e]);
    rootedAid.set(ca, [...(rootedAid.get(ca) ?? []), e]);
  }
  for (const [fid, members] of byFid) {
    if (!rooted.has(fid)) {
      out.push(`fid ${fid} is carried by ${members.length} definition(s) but is no definition's computed id (${members[0].label})`);
      continue;
    }
    // AN INHERITED fid IS JUSTIFIED BY A MATCH, not by the assignment order: the rooting definition must be the
    // same shape under the ids' own quotient - a rotation, never a reflection.
    const roots = rooted.get(fid) ?? [];
    for (const e of members) {
      if (formationId(e.board) === fid) continue;
      const ok = roots.some((r) => r.board.dancers.length === e.board.dancers.length
        && (() => { const m = matchFormations(e.board.dancers, r.board.dancers, DEFAULT_MATCH_MAX, false); return m !== null && !m.reflect; })());
      if (!ok) out.push(`${e.label}: carries fid ${fid} but its geometry neither computes it nor matches the definition that does (${roots[0].label})`);
    }
  }
  for (const [aid, members] of byAid) {
    if (!rootedAid.has(aid)) {
      out.push(`aid ${aid} is carried by ${members.length} definition(s) but is no definition's computed arrangement (${members[0].label})`);
      continue;
    }
    const roots = rootedAid.get(aid) ?? [];
    for (const e of members) {
      if (arrangementId(e.board) === aid) continue;
      const ok = roots.some((r) => r.board.dancers.length === e.board.dancers.length
        && (() => { const m = matchFormations(e.board.dancers, r.board.dancers, DEFAULT_MATCH_MAX, true); return m !== null && !m.reflect; })());
      if (!ok) out.push(`${e.label}: carries aid ${aid} but its geometry neither computes it nor matches the definition that does (${roots[0].label})`);
    }
  }

  return out;
}

/** The same checks over the corpus on disk, plus the report's freshness. This is what `--check` runs. */
export function problems() {
  const { formations, tamFiles, rows, report } = analyse();
  const out = tagProblems(formations, tamFiles);
  // LINE ENDINGS ARE NOT PART OF THE RENDER. `core.autocrlf=true` is host-wide, so the committed report is checked
  // out as CRLF while this renders LF - comparing the bytes directly made a fresh commit fail its own gate the
  // moment it was rebased, which is trap 2's shape. The comparison is "(line endings aside)", as `call-titles.mjs`
  // does for the same reason.
  const committed = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8').replace(/\r\n/g, '\n') : null;
  if (committed !== report) out.push('DuplicateFormations.md is not what a fresh render would write (run `node scripts/tag-formations.mjs --write`)');
  if (rows.length === 0 && !committed?.includes('No duplicate definitions')) out.push('the report has no duplicate rows but the analysis found none to record - re-render it');
  return out;
}

export function check() {
  const { formations, tamFiles, rows, notes } = analyse();
  const named = formations.defs.length;
  const inline = tamFiles.reduce((n, f) => n + f.entries.length, 0);
  const found = problems();
  const refactors = rows.filter((r) => outcomeOf(r).action === 'refactor').length;
  console.log('== formation tags ==');
  console.log(`  named definitions:  ${named}`);
  console.log(`  inline definitions: ${inline} (${tamFiles.length} file(s) read)`);
  console.log(`  duplicates:         ${rows.length} (${refactors} still to refactor - recorded in DuplicateFormations.md)`);
  for (const n of notes) console.log(`  note  ${n}`);
  for (const p of found) console.log(`  FAIL ${p}`);
  if (!found.length) console.log('  ok   every definition carries a well-formed fid and aid, and the duplicate table is current');
  return found.length === 0 ? 0 : 1;
}

export function write() {
  const { formations, tamFiles, report } = analyse();
  const files = [{ rel: 'formations.xml', text: formations.text, entries: formations.defs }];
  for (const f of tamFiles) files.push({ rel: `${f.level}/${f.file}`, text: f.text, entries: f.entries });
  // THE TOOL OWNS EXACTLY THE FILES IT IS ABOUT TO WRITE. Anything else modified is work in progress that this tool
  // did not do and must not sweep into a corpus change (AGENTS.md §8 trap 16). The corpus files ARE the change, so
  // re-running after a partial write is legitimate - which is what makes this generator idempotent.
  const owned = new Set([...files.map((f) => `assets/${f.rel}`), 'DuplicateFormations.md']);
  const dirty = modifiedPaths().filter((p) => !owned.has(p));
  if (dirty.length) {
    console.log('refusing to write: the tree carries work this tool does not own. Modified:');
    for (const l of dirty) console.log(`  ${l}`);
    return 1;
  }
  let changed = 0;
  let added = 0;
  for (const f of files) {
    const edits = editsFor(f.entries);
    if (!edits.length) continue;
    const next = applyEdits(f.text, edits);
    fs.writeFileSync(path.join(ASSETS, f.rel), next, 'utf8');
    changed++;
    added += edits.length;
  }
  fs.writeFileSync(REPORT, report, 'utf8');
  console.log(`tag-formations: ${added} tag pair(s) added across ${changed} file(s); DuplicateFormations.md rendered`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--json')) {
    const { formations, tamFiles, rows, notes } = analyse();
    console.log(JSON.stringify({
      named: formations.defs.length,
      inline: tamFiles.reduce((n, f) => n + f.entries.length, 0),
      duplicates: rows.map((r) => ({ label: r.e.label, canonical: r.canonical.label, fid: r.tag.fid, aid: r.tag.aid, ...outcomeOf(r) })),
      notes,
      problems: problems(),
    }, null, 2));
    process.exit(0);
  }
  process.exit(process.argv.includes('--write') ? write() : check());
}
