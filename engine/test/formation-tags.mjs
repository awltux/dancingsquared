// EVERY FORMATION DEFINITION CARRIES ITS `fid` AND `aid`, AND THE DUPLICATE TABLE IS CURRENT.
//
// WHY THIS GATE EXISTS. A formation id is a content address, so a geometry edit mints a new one - and a REFERENCE
// that has to survive such an edit cannot be the content address. The tree used to solve that with
// `assets/formation-roots.json` plus a hand-written alias file; the reference now lives ON the definition as a
// stored tag, which is authoritative by construction and needs nothing to alias. That makes the corpus's own bytes
// the reference set, so the checks that used to guard the ledger now guard the bytes: every definition tagged, every
// tag well formed, every tag something the corpus actually roots, and the duplicate table equal to a fresh render.
//
// THE CHECKS, and the wrong rule each rules out (all of them are in `scripts/tag-formations.mjs`'s
// `tagProblems`, imported rather than restated):
//   - every definition tagged           (the wrong rule: tag `formations.xml` and forget the 773 inline blocks)
//   - `isFormationId`/`isArrangementId` (the wrong rule: any twelve-character string is an "id")
//   - no duplicate `<formation name>`   (the wrong rule: let the parser's Map hide the second definition)
//   - a reconstituted half that does not put two dancers on one spot (the wrong rule: tag a geometry the engine
//     would never build)
//   - `aid` -> `fid` is single-valued   (the wrong rule: one arrangement belonging to two formations)
//   - every stored `fid`/`aid` is ROOTED by some definition's computed id (the wrong rule: a tag nothing computes,
//     which is a typo or a leftover from an older scheme)
//   - an inherited tag matches the rooting definition under the ids' own quotient, which is a ROTATION (the wrong
//     rule: accept a reflected match, which would tag `Wave LH` with `Wave RH`'s id)
//
// AND IT IS NOT VACUOUS: the last check loads a COPY of the model with two tags removed and requires the same
// analysis to name both, so a gate that found nothing because nothing was looked at cannot pass.
//
// THE SAMPLE IS PRINTED because a census that cannot say how big its sample was is a census nobody can argue with:
// MEASURED at the commit that introduced the tags, 292 named definitions + 773 inline blocks over 500 files.
//
// Run: node test/formation-tags.mjs   (from engine/; `dist` must be built)
import { loadFormations, loadTams, tagProblems, problems } from '../../scripts/tag-formations.mjs';

let failures = 0;
const check = (cond, msg, detail) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) { failures++; if (detail) console.log(`         ${detail}`); }
};

const formations = loadFormations();
const { files, refs } = loadTams();
const named = formations.defs;
const inline = files.flatMap((f) => f.entries);
const all = [...named, ...inline];

console.log('== the tags are present ==');
check(named.length > 0 && inline.length > 0,
  `the sample is not empty: ${named.length} named definition(s) + ${inline.length} inline block(s) over ${files.length} file(s)`);
check(refs.size > 0, `${refs.size} named formation(s) are referenced by at least one tam`);
const untagged = all.filter((e) => !e.fid || !e.aid);
check(untagged.length === 0, `every definition carries both tags (${all.length - untagged.length} of ${all.length})`,
  untagged.slice(0, 5).map((e) => e.label).join('; '));

console.log('\n== the tags hold together ==');
const found = tagProblems(formations, files);
// Print them all, not just the first: a gate that reports one problem per run makes a corpus edit take as many runs
// as it has mistakes.
for (const p of found) console.log(`  FAIL ${p}`);
check(found.length === 0, 'no structural problem: formats, uniqueness, the reconstituted geometry, and every tag rooted', found.slice(0, 3).join('; '));
check(problems().length === found.length, 'DuplicateFormations.md is byte-identical to a fresh render');

console.log('\n== NOT VACUOUS: a tag removed is a tag reported ==');
{
  // TWO DEFECTS IN A COPY, one named and one inline, so the check is exercised on both definition sites. Nothing is
  // written: the model is in memory and `tagProblems` only reads it.
  const doctor = { ...formations, defs: formations.defs.map((d, i) => (i === 0 ? { ...d, fid: null } : d)) };
  const filesDoctor = files.map((f) => ({
    ...f,
    entries: f.entries.map((e, i) => (f === files.find((x) => x.entries.length > 0) && i === 0 ? { ...e, aid: null } : e)),
  }));
  const complaints = tagProblems(doctor, filesDoctor);
  const aboutNamed = complaints.filter((p) => p.includes(named[0].label) && /untagged/.test(p));
  const firstInline = files.find((x) => x.entries.length > 0)?.entries[0];
  const aboutInline = complaints.filter((p) => firstInline && p.includes(firstInline.label) && /untagged/.test(p));
  check(aboutNamed.length === 1, `the named definition with its fid removed is reported: ${named[0].name}`);
  check(aboutInline.length === 1, `the inline block with its aid removed is reported: ${firstInline?.title ?? '(none)'}`);
  check(complaints.length === 2, `and NOTHING ELSE is reported for that copy (${complaints.length} complaint(s))`, complaints.join('; '));
}

console.log('\n=================');
if (failures === 0) console.log('FORMATION TAGS: all checks passed.');
else {
  console.log(`FORMATION TAGS: ${failures} check(s) FAILED.`);
  process.exitCode = 1;
}
