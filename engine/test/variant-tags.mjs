// EVERY AUTHORED TAM CARRIES THE `vid` OF THE VARIANT IT REALISES, AND IT IS THE ID ITS OWN INPUTS MINT.
//
// WHY THIS GATE EXISTS. `vid` is the third stored tag: `fid`/`aid` name a FORMATION DEFINITION, and `vid` names a
// CALL VARIANT - (level, call title, the definition it starts from). The corpus writes it so a reader or a consumer
// can name the variant without re-deriving it, and the id is FULLY DETERMINED by data in the tree (unlike `fid`,
// which may be inherited from a shape the corpus already has). So this gate can assert equality rather than
// consistency: every stored `vid` must be what `callVariantId(level, title, fid)` mints today. A retitle, a level
// move or a re-pointed formation therefore fails here and forces a re-tag - the documented "a rename is a
// migration" rule of `call-variant-id.ts`, made mechanical instead of hoped for.
//
// THE CHECKS, and the wrong rule each rules out (all in `scripts/tag-variants.mjs`'s `problemsOf`, imported rather
// than restated):
//   - the sample is not empty          (the wrong rule: a walk that found nothing passes every count below)
//   - every tam tagged                 (the wrong rule: tag the tams that author a block and forget the rest)
//   - `isCallVariantId`                (the wrong rule: any twelve-character string is a "vid")
//   - stored == minted                 (the wrong rule: freeze a stale id through a retitle)
//   - `vid -> (level, title, fid)` is single-valued (the wrong rule: a digest collision, which only a whole-corpus
//     check can see)
//   - the two unresolvable tams are NAMED, not counted (the wrong rule: a third one hides behind "2")
//
// AND IT IS NOT VACUOUS: the same analysis runs over a COPY of the model with one vid cleared and one vid replaced
// by an id minted from a different title, and requires both to be named and nothing else. A run that reported zero
// because nothing was looked at therefore cannot pass.
//
// THE COUNTS ARE FACT PINS, re-measured in the commit that moves them: 5,489 live authored tams, 5,487 tagged, 5,388
// distinct variants (91 authored more than once), and `Ferris Wheel` / `Couples Circulate` with no start definition.
//
// Run: node test/variant-tags.mjs   (from engine/; the engine must be built)
import { analyse, problems, problemsOf, KNOWN_UNRESOLVABLE } from '../../scripts/tag-variants.mjs';

let failures = 0;
const check = (cond, msg, detail) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) { failures++; if (detail) console.log(`         ${detail}`); }
};

const model = analyse();
const { tams, unresolvable, files } = model;

console.log('== the sample ==');
check(tams.length + unresolvable.length > 0,
  `the walk found the corpus: ${tams.length + unresolvable.length} live authored tam(s) over ${files.length} file(s)`);
check(tams.length === 5487 && unresolvable.length === 2,
  `and the population is the pinned one: ${tams.length} with a start definition + ${unresolvable.length} without (pinned 5,487 + 2)`);
check(files.length === 500, `over the pinned 500 call file(s) (${files.length})`);

console.log('\n== the unresolvable pair is NAMED, not counted ==');
{
  const titles = unresolvable.map((u) => u.title).sort();
  check(JSON.stringify(titles) === JSON.stringify([...KNOWN_UNRESOLVABLE].sort()),
    `the two tams with no start definition are the catalogue's own pair: ${titles.join(', ')}`,
    titles.join(', '));
  // EVERY ONE OF THEM NAMES A FORMATION - a tam that names nothing at all would be a different defect, and this is
  // the check that tells the two apart.
  const silent = unresolvable.filter((u) => !/^names formation="/.test(u.why));
  check(silent.length === 0, `and each names a formation the corpus does not define (${silent.length} name nothing at all)`);
}

console.log('\n== the tags are present and true ==');
{
  const tagged = tams.filter((e) => e.has).length;
  check(tagged === 5487, `every tam with a start definition carries a vid (${tagged} of ${tams.length})`);
  const found = problems();
  for (const p of found) console.log(`  FAIL ${p}`);
  check(found.length === 0, 'and each one is a well-formed id that its own level, title and fid mint', found.slice(0, 3).join('; '));
  const vids = new Set(tams.map((e) => e.has ?? e.want));
  check(vids.size === 5388, `the corpus realises 5,388 distinct variants (${vids.size})`);
  const counts = new Map();
  for (const e of tams) counts.set(e.has ?? e.want, (counts.get(e.has ?? e.want) ?? 0) + 1);
  const multi = [...counts.values()].filter((n) => n > 1).length;
  check(multi === 91, `91 variants are authored more than once (${multi}) - a property, not a collision`);
}

console.log('\n== NOT VACUOUS: a wrong vid and a missing vid are both reported ==');
{
  const first = tams.find((e) => e.has);
  const second = tams.filter((e) => e.has)[1] ?? first;
  const doctor = {
    ...model,
    tams: tams.map((e) => {
      if (e === first) return { ...e, has: null };
      if (e === second) return { ...e, has: e.want.slice(0, -1) + (e.want.endsWith('0') ? '1' : '0') };
      return e;
    }),
  };
  const complaints = problemsOf(doctor);
  const missing = complaints.filter((p) => /untagged/.test(p) && p.includes(`#${first.tamIndex}`));
  const wrong = complaints.filter((p) => /mints .* - a retitle/.test(p));
  check(missing.length === 1, `the tam with its vid removed is reported: ${first.title} #${first.tamIndex}`);
  check(wrong.length === 1, `and a vid that is not the one its inputs mint is reported: ${second.title} #${second.tamIndex}`);
  check(complaints.length === 2, `and NOTHING ELSE is reported for that copy (${complaints.length} complaint(s))`, complaints.join('; '));
}

console.log('\n=================');
if (failures === 0) console.log('VARIANT TAGS: all checks passed.');
else {
  console.log(`VARIANT TAGS: ${failures} check(s) FAILED.`);
  process.exitCode = 1;
}
