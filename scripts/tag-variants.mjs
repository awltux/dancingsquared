// EVERY AUTHORED TAM CARRIES THE `vid` OF THE CALL VARIANT IT REALISES.
//
// A call variant is (level, call title, the formation definition it starts from) - `callVariantId` mints the id
// from those three - and this tool writes that id onto the tam as `vid`. It is the third stored tag, after `fid`
// and `aid` on the definitions, and it is the one that names a CALL rather than a shape.
//
// WHAT IT BUYS. A consumer can name the variant without re-deriving it: the book's `call-map.json`, every virtual
// instance's `parent_vid` and a person reading the XML all get the same string, and a reader can see which
// definition a call starts from in the file itself. MEASURED at the commit that introduced it: 1,731 distinct
// variants over ms+plus alone, and 5,487 of the corpus's 5,489 live authorings realising one.
//
// THE VALUE IS FULLY DETERMINED, AND THAT IS DELIBERATE. Unlike `fid` (a tag that may be inherited from a shape the
// corpus already has) a `vid` is a pure function of data in the tree:
//
//     fid = the tam's inline block's `fid`, when it authors one   (the block WINS at load time)
//           the named definition's `fid`, otherwise
//     vid = callVariantId(<the tam's level = its directory>, tam.title, fid)
//
// so a RETITLE or a LEVEL MOVE changes it. That is `call-variant-id.ts`'s documented rule - "a rename is a
// migration" - and this tool makes the migration visible: `--check` fails, naming the tams, rather than letting the
// corpus carry an id that no longer means what it says.
//
// TWO TAMS GET NO VID, AND THEY ARE NAMED. `Ferris Wheel` and `Couples Circulate` each name `T-Bone Couples`, a
// formation the corpus does not ship (only `T-Bone Couples 1` and `2`), so they have no start definition and no
// variant; `test/catalogue.mjs` pins the pair with the engine's own refusal, and this tool reports them rather than
// skipping them silently. A THIRD such tam is a failure, not a skip: `--write` refuses and names it.
//
// NOT TAGGED, ON PURPOSE: the 20 commented-out tams (`scripts/tam-blocks.mjs` masks them - text that is not a tam
// cannot carry a variant), and the 7 generated `*.virtual.xml` tams, which `filesOf` excludes from every census and
// which are rewritten from `book/tools/virtual-placements.json` on every build; their `parent_vid` already names
// the variant they were PLACED FROM.
//
// Run: node scripts/tag-variants.mjs             (verify; exit 1 on anything untagged or wrong)
//      node scripts/tag-variants.mjs --write     (add the vids)
//      node scripts/tag-variants.mjs --json      (the same analysis, machine-readable)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, parseFormationTags, callVariantId, isCallVariantId } from '../engine/dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';
import { walkTams } from './tag-formations.mjs';

setParser(DOMParser);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = corpusRoot();
/** The corpus directory relative to the repo root - what a git pathspec uses. DERIVED, never spelled: see
 *  `ASSETS_REL` in `scripts/tag-formations.mjs` and `engine/test/corpus-location.mjs`. */
const ASSETS_REL = path.relative(ROOT, ASSETS).split(path.sep).join('/');
const read = (p) => fs.readFileSync(path.join(ASSETS, p), 'utf8');

/** The two authorings with no start definition, named so a third cannot hide behind a count. */
export const KNOWN_UNRESOLVABLE = ['Ferris Wheel', 'Couples Circulate'];

/**
 * Every live authored tam with the `vid` it should carry, or the reason it cannot have one.
 *
 * THE RULE LIVES HERE ONCE: `fid` is the inline block's (the block WINS at load time) otherwise the named
 * definition's, and the id is `callVariantId(level, title, fid)`. The writer, the check and the gate all read this
 * one answer, so none of them can decide a tam is a different variant from another.
 */
export function analyse() {
  const tags = parseFormationTags(read('formations.xml'));
  const { files } = walkTams();
  const defs = files.flatMap((f) => f.entries);
  const out = [];
  const unresolvable = [];
  for (const e of defs) {
    // THE INLINE BLOCK'S fid WINS, because `buildCallImpl` gives the block priority over the attribute.
    const named = e.formationAttr ? tags.get(e.formationAttr)?.fid ?? null : null;
    const fid = e.written > 0 ? e.fid ?? null : named;
    if (!fid) {
      unresolvable.push({ label: `${e.level}/${e.file} - ${e.title || '(untitled)'} #${e.tamIndex}`, title: e.title, why: e.formationAttr ? `names formation="${e.formationAttr}", which the corpus does not define` : 'names no formation and authors no block' });
      continue;
    }
    out.push({ ...e, fid, want: callVariantId(e.level, e.title, fid), has: e.tam.vid });
  }
  return { tags, files, tams: out, unresolvable };
}

/** The edits that bring each file's tam tags up to date, applied from the end so offsets stay true. */
function editsFor(entries) {
  return entries
    .filter((e) => !e.has)
    .map((e) => ({ at: e.tagEnd - 1, text: ` vid="${e.want}"` }))
    .sort((a, b) => b.at - a.at);
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of edits) out = `${out.slice(0, e.at)}${e.text}${out.slice(e.at)}`;
  return out;
}

/** Everything that stops the corpus being well tagged, as a pure function of the analysed model. */
export function problemsOf({ tams, unresolvable }) {
  const out = [];
  for (const e of tams) {
    const label = `${e.level}/${e.file} - ${e.title || '(untitled)'} #${e.tamIndex}`;
    if (!e.has) { out.push(`${label}: untagged (run \`node scripts/tag-variants.mjs --write\`)`); continue; }
    if (!isCallVariantId(e.has)) { out.push(`${label}: vid "${e.has}" is not a call-variant id`); continue; }
    if (e.has !== e.want) out.push(`${label}: carries vid ${e.has} but (${e.level}, "${e.title}", ${e.fid}) mints ${e.want} - a retitle, a level move or a re-pointed formation is a migration, so re-tag it`);
  }
  const unknown = unresolvable.filter((u) => !KNOWN_UNRESOLVABLE.includes(u.title));
  if (unknown.length) for (const u of unknown) out.push(`${u.label}: no start definition (${u.why}) - a NEW unresolvable authoring, so name it here and in test/catalogue.mjs`);
  // A VID NAMES ONE VARIANT. Two tams of the same variant sharing an id is the design; an id landing on two
  // different (level, title, fid) triples would be a digest collision, and the gate must see it.
  const byVid = new Map();
  for (const e of tams) {
    if (!e.has) continue;
    const key = `${e.level}|${e.title}|${e.fid}`;
    const seen = byVid.get(e.has);
    if (seen && seen !== key) out.push(`vid ${e.has} names ${seen} and ${key}`);
    byVid.set(e.has, key);
  }
  return out;
}

/** The same checks over the corpus on disk. This is what `--check` runs. */
export function problems() {
  return problemsOf(analyse());
}

export function check() {
  const { tams, unresolvable, files } = analyse();
  const found = problems();
  const vids = new Set(tams.filter((e) => e.has).map((e) => e.has));
  const shared = new Map();
  for (const e of tams) if (e.has) shared.set(e.has, (shared.get(e.has) ?? 0) + 1);
  const multi = [...shared.values()].filter((n) => n > 1).length;
  const tagged = tams.filter((e) => e.has).length;
  console.log('== call-variant tags ==');
  console.log(`  live authored tams: ${tams.length + unresolvable.length} over ${files.length} file(s)`);
  console.log(`  tagged:             ${tagged}`);
  console.log(`  no start definition:${String(unresolvable.length).padStart(2)} (${unresolvable.map((u) => u.title).join(', ')})`);
  console.log(`  distinct variants:  ${vids.size} (${multi} authored more than once)`);
  for (const p of found) console.log(`  FAIL ${p}`);
  if (!found.length) console.log('  ok   every authored tam carries the vid its own level, title and fid mint');
  return found.length === 0 ? 0 : 1;
}

function modifiedPaths() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('??')).map((l) => l.slice(3).trim());
  } catch {
    return [];
  }
}

export function write() {
  const { files, tams, unresolvable } = analyse();
  const unknown = unresolvable.filter((u) => !KNOWN_UNRESOLVABLE.includes(u.title));
  if (unknown.length) {
    console.log('refusing to write: these authorings have no start definition and this tool does not skip them silently:');
    for (const u of unknown) console.log(`  ${u.label} - ${u.why}`);
    return 1;
  }
  const byFile = new Map();
  for (const e of tams) {
    const rel = `${e.level}/${e.file}`;
    const list = byFile.get(rel) ?? [];
    list.push(e);
    byFile.set(rel, list);
  }
  const owned = new Set([...byFile.keys()].map((r) => `${ASSETS_REL}/${r}`));
  const dirty = modifiedPaths().filter((p) => !owned.has(p));
  if (dirty.length) {
    console.log('refusing to write: the tree carries work this tool does not own. Modified:');
    for (const l of dirty) console.log(`  ${l}`);
    return 1;
  }
  let changed = 0;
  let added = 0;
  for (const [rel, entries] of byFile) {
    const text = read(rel);
    const edits = editsFor(entries);
    if (!edits.length) continue;
    fs.writeFileSync(path.join(ASSETS, rel), applyEdits(text, edits), 'utf8');
    changed++;
    added += edits.length;
  }
  console.log(`tag-variants: ${added} vid(s) added across ${changed} file(s), ${tams.length - added} already tagged; ` +
    `${unresolvable.length} authoring(s) have no start definition (${unresolvable.map((u) => u.title).join(', ')})`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--json')) {
    const { tams, unresolvable, files } = analyse();
    const vids = new Set(tams.filter((e) => e.has || e.want).map((e) => e.has ?? e.want));
    console.log(JSON.stringify({
      tams: tams.length + unresolvable.length,
      files: files.length,
      tagged: tams.filter((e) => e.has).length,
      distinct: vids.size,
      unresolvable,
      problems: problems(),
      // The whole mapping, for a caller that wants to cross-check it against another mint.
      map: Object.fromEntries(tams.map((e) => [`${e.level}/${e.file}#${e.tamIndex}`, { title: e.title, fid: e.fid, vid: e.has ?? e.want }])),
    }, null, 2));
    process.exit(0);
  }
  process.exit(process.argv.includes('--write') ? write() : check());
}
