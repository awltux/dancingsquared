// EVERY FORMATION DEFINITION CARRIES ITS `fid` AND `aid`, THE DUPLICATE TABLE IS CURRENT, AND EVERY CARRIED TAG IS
// ONE THAT WAS MINTED.
//
// WHY THIS GATE EXISTS. A formation id is a content address, so a geometry edit mints a new one - and a REFERENCE
// that has to survive such an edit cannot be the content address. The tree used to solve that with
// `assets/formation-roots.json` plus a hand-written alias file; the reference now lives ON the definition as a
// stored tag, which is authoritative by construction and needs nothing to alias. That makes the corpus's own bytes
// the reference set, so the checks that used to guard the ledger now guard the bytes: every definition tagged, every
// tag well formed, every carried tag recorded as minted, and the duplicate table equal to a fresh render.
//
// A TAG IS A UID, SO THIS GATE DOES NOT RE-DERIVE ONE. `scripts/tag-formations.mjs` used to re-compute every tag
// from the corpus's current geometry and refuse a tag no definition computed. That is the wrong test for a UID: it
// makes a legitimate correction a re-mint, and a re-mint moves every call-variant id hanging off the tag. The
// minting is recorded once in `assets/formation-tag-provenance.json`, and the check is that the record and the
// corpus agree in both directions, which is a NAMED SET (§11.2.8): it fails when a tag is carried but unrecorded
// (a typo, or a hand-written attribute) and when a tag is recorded but carried by nothing (a retired shape).
// MEASURED when this changed: shifting `Facing Dancers Close` by 0.2 - the ids quantise positions to 0.25, so a
// smaller nudge cannot move one - produced 2 problems under the old rule and 0 under this one.
//
// THE CHECKS, and the wrong rule each rules out (all of them are in `scripts/tag-formations.mjs`'s `tagProblems`,
// imported rather than restated):
//   - every definition tagged           (the wrong rule: tag `formations.xml` and forget the inline blocks)
//   - `isFormationId`/`isArrangementId` (the wrong rule: any twelve-character string is an "id")
//   - no duplicate `<formation name>`   (the wrong rule: let the parser's Map hide the second definition)
//   - a reconstituted half that does not put two dancers on one spot (the wrong rule: tag a geometry the engine
//     would never build)
//   - `aid` -> `fid` is single-valued   (the wrong rule: one arrangement belonging to two formations)
//   - carried == recorded, per tag      (the wrong rule: a tag nothing minted, or a record nothing carries)
//   - a recorded tag survives a geometry correction, which is the rule this gate changed to hold (see below)
//   - a tag is inherited only from the same SHAPE under the ids' own quotient, a rotation and never a reflection -
//     enforced at MINTING time by `assignTags`, which refuses a reflected target; the audit used to hold a second
//     copy that compared geometry, and that copy is the one that had to go (§11.4.4)
//
// AND IT IS NOT VACUOUS: the tag-removal control loads a COPY of the model with two tags removed and requires the
// same analysis to name both, so a gate that found nothing because nothing was looked at cannot pass.
//
// THE SAMPLE IS PRINTED because a census that cannot say how big its sample was is a census nobody can argue with:
// MEASURED at this commit, 292 named definitions + 636 inline blocks over 500 files.
//
// Run: node test/formation-tags.mjs   (from engine/; `dist` must be built)
import { loadFormations, loadTams, loadProvenance, tagProblems, problems, duplicateGroups, refactorPlan } from '../../scripts/tag-formations.mjs';

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
check(found.length === 0, 'no structural problem: formats, uniqueness, the reconstituted geometry, and every carried tag recorded as minted', found.slice(0, 3).join('; '));
check(problems().length === found.length, 'DuplicateFormations.md is byte-identical to a fresh render');

console.log('\n== the record is the reference: a tag is a UID, not a digest ==');
{
  const record = loadProvenance();
  check(record !== null, 'the record of mintings exists (assets/formation-tag-provenance.json)');
  const tags = all.flatMap((e) => [e.fid, e.aid]).filter(Boolean);
  check(tags.length > 0, `the sample is not empty: ${new Set(tags).size} distinct tag(s) over ${all.length} definition(s)`);

  // NEGATIVE CONTROL 1: a tag carried by the corpus and recorded nowhere is a typo or a hand-written attribute.
  const droppedFid = named[0].fid;
  const withoutRow = { fids: new Map(record.fids), aids: new Map(record.aids) };
  withoutRow.fids.delete(droppedFid);
  const unrecorded = tagProblems(formations, files, withoutRow).filter((p) => p.includes(droppedFid) && /no recorded minting/.test(p));
  check(unrecorded.length === 1, `a carried tag with no recorded minting is reported: ${droppedFid} (${named[0].name})`,
    unrecorded.join('; ') || 'nothing was reported');

  // NEGATIVE CONTROL 2: the other direction. A recorded tag nothing carries is a leftover, and a set that only
  // failed when it shrank would pass this one.
  const retired = { fids: new Map(record.fids), aids: new Map(record.aids) };
  retired.fids.set('F3-aaaaaaaa', 'a shape nothing carries');
  const leftover = tagProblems(formations, files, retired).filter((p) => p.includes('F3-aaaaaaaa') && /no definition carries/.test(p));
  check(leftover.length === 1, 'a recorded tag no definition carries is reported: a retired shape\'s row');

  // THE RULE THIS GATE CHANGED TO HOLD. A geometry correction must NOT red the audit, or the only repair is a
  // re-mint, which moves every variant id hanging off the tag the design exists to protect. The quantum is 0.25, so
  // 0.2 is the smallest step that can move a position's bucket and the check cannot pass by measuring nothing.
  const corrected = JSON.parse(JSON.stringify(formations, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  const target = corrected.defs.find((d) => d.name === named[0].name);
  const movedBefore = target.board.dancers[0].x;
  target.board.dancers[0].x += 0.2;
  const stillRooted = tagProblems(corrected, files).length;
  check(stillRooted === 0, `a 0.2 geometry correction does not red the audit (${stillRooted} problem(s); the moved dancer went ${movedBefore} -> ${target.board.dancers[0].x})`,
    stillRooted ? `${stillRooted} problem(s) - a correction is a re-mint again` : '');
}

// NO DUPLICATE IS LEFT THAT A TOOL COULD ABSORB. The table's `refactor` rows are the ones `refactorPlan` says a
// `<path>` permutation can express; the rest each carry the reason they cannot be absorbed and are a corpus
// decision, not outstanding work. This is the check that makes "the exercise is finished" mechanical.
{
  const rows = duplicateGroups(formations, files);
  const absorbable = rows.filter((r) => r.e.kind !== 'named' && refactorPlan(r).ok);
  check(absorbable.length === 0,
    `no duplicate is left that a path permutation can absorb (${absorbable.length} still can)`,
    absorbable.length ? `run \`node scripts/reorder-formation.mjs --absorb-duplicates --write\` - ${absorbable.slice(0, 5).map((r) => r.e.label).join('; ')}` : '');
  const kept = rows.filter((r) => r.e.kind === 'named' || !refactorPlan(r).ok);
  check(kept.length > 0, `and the corpus still carries duplicates that are a DECISION not a task (${kept.length} recorded with a reason)`);
  // THE OTHER HALF OF THAT CHECK, and why it is not vacuous: every real row is refused today, so a `refactorPlan`
  // that had stopped saying yes to anything would pass the check above while measuring nothing. These two synthetic
  // rows are the rule's own control - the identity case must be absorbable, and a written-size mismatch must be
  // refused FOR THAT REASON.
  const spots = [
    { x: -2, y: 1, heading: 0, gender: 'boy' },
    { x: -2, y: -1, heading: 0, gender: 'girl' },
    { x: 2, y: 1, heading: Math.PI, gender: 'boy' },
    { x: 2, y: -1, heading: Math.PI, gender: 'girl' },
  ];
  const synthetic = (written, paths) => {
    const board = spots.slice(0, written);
    return {
      e: { kind: 'inline', label: 'synthetic', written, writtenBoard: board, paths, actives: null, formationAttr: null, fid: 'F3-aaaaaaaa', newFid: 'F3-aaaaaaaa' },
      canonical: { kind: 'named', name: 'Synthetic', written, writtenBoard: board, fid: 'F3-aaaaaaaa', newFid: 'F3-aaaaaaaa' },
      tag: { fid: 'F3-aaaaaaaa' },
    };
  };
  check(refactorPlan(synthetic(4, 4)).ok, 'POSITIVE CONTROL: a block identical to its definition is absorbable');
  const twoWritten = synthetic(4, 4);
  twoWritten.canonical = { ...twoWritten.canonical, written: 2, writtenBoard: spots.slice(0, 2) };
  const mismatch = refactorPlan(twoWritten);
  check(!mismatch.ok && /writes 2 dancers and the block writes 4/.test(mismatch.reason),
    'NEGATIVE CONTROL: a written-size mismatch is refused, naming the two sizes', mismatch.ok ? 'it was accepted' : mismatch.reason);
}

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
