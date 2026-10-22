// HOW A CALL GOES: the derived label, and that a body the RULES refuse is never a candidate.
//
// WHY THIS IS A GATE. `Lead Right - Close`, `- Normal` and `- Far` start from an IDENTICAL setup (measured: two dancers at
// (+-1, 0), heading 90deg, every one of them), so nothing about a board selects between them — they differ only in the
// motion. That makes the label the ONLY thing a rule can key on, and it means the failure mode is silent: with the tams
// pooled under one title, the body that runs is whichever sits first in the document, and MEASURED, reversing that order
// changes the winning body (trailing path 2.000 -> 4.123) and lands FOUR pairs of dancers on shared spots.
//
// So this pins three things: the label's derivation (and its control, `Promenade - Keep Walking`), that the shipped
// corpus derives it for exactly the authorings that declare it, and that a `going`-keyed rule REMOVES a body from the
// candidate set — including the all-refused case, which must refuse with the rule's own sentence rather than the
// geometric "No setup in this call matches".
//
// Usage: node engine/test/going.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { DEG, GOING_VALUES, Sequencer, goingOfTitle, parseFormations, setParser } from '../dist/index.js';
import { CORPUS } from '../../vite.corpus.ts';

setParser(DOMParser);
const read = (p) => fs.readFileSync(path.join(CORPUS, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. the derivation, and the control that keeps it closed ==');
{
  check(goingOfTitle('Lead Right - Close') === 'close', '"- Close" -> close');
  check(goingOfTitle('Lead Right - Normal') === 'normal', '"- Normal" -> normal');
  check(goingOfTitle('Lead Right - Far') === 'far', '"- Far" -> far');
  check(goingOfTitle('Lead Right') === null, 'no suffix -> null');
  // THE CONTROL. A dash suffix alone is not a going, and this is a real shipped title — `- Keep Walking` is
  // the promenade's own convention and is deliberately NOT one of the three (`- Close`/`- Normal`/`- Far`),
  // which is what makes it the strongest instance of the closed list: an authoring suffix the vocabulary
  // REFUSES rather than one it has never seen. It used to be `Circle Left - Stop at Home`, which stopped
  // naming anything when the corpus renamed it to `Circle Left Home` — a control whose subject is a string
  // that matches no title cannot show that the list is closed, only that the function is not a no-op.
  check(goingOfTitle('Promenade - Keep Walking') === null, 'CONTROL: "Promenade - Keep Walking" is NOT a going, so the list is closed');
  check(goingOfTitle('Circle Left Home') === null, 'and a title with no suffix at all is not one either');
  check(goingOfTitle('  lead right  -  far ') === 'far', 'tolerates case and spacing');
  check(goingOfTitle('Far') === null, 'a bare word is not a suffix');
  check(GOING_VALUES.length === 3, 'the value set is the three the corpus publishes');
}

console.log('\n== 2. the shipped corpus derives it for exactly the authorings that declare it ==');
const FORMATIONS = parseFormations(read('formations.xml'));
const seq = new Sequencer(read('moves.xml'), read('formations.xml'));
const FAMILY = ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far', 'Lead Right', 'Lead Left - Normal', 'Lead Left - Far', 'Lead Left'];
for (const t of FAMILY) seq.registerByTitle(t, read('ms/lead_right.xml'));
{
  let mismatched = 0;
  let withGoing = 0;
  let total = 0;
  for (const t of FAMILY) {
    for (const v of seq.matchableVariants(t)) {
      total++;
      if (v.going !== null) withGoing++;
      if (v.going !== goingOfTitle(v.title)) mismatched++;
    }
  }
  console.log(`       ${FAMILY.length} titles, ${total} variant(s), ${withGoing} carrying a going`);
  check(total > 0, 'the family registered');
  check(mismatched === 0, `every variant's going is its title's (${mismatched} disagreed)`);
  check(seq.matchableVariants('Lead Right').every((v) => v.going === null), 'the plain `Lead Right` carries none — nothing declares one');
  check(seq.matchableVariants('Lead Right - Far').every((v) => v.going === 'far'), 'and every `- Far` variant carries `far`');
}

console.log('\n== 3. a body the rules REFUSE is not a candidate ==');
{
  // THE POOLED CASE IS WHY THE LABEL EXISTS (bodies sharing one setup, distinguished only by the motion), and it is
  // measured in the session record rather than here: `registerByTitle` merges the five authorings onto one title whose
  // setups are IDENTICAL, and the merge keeps one body per (title, setup), so a pooled title cannot be built by
  // registering the shipped file twice. What this section pins is the FILTER, on the titles the corpus actually ships.
  const far = 'Lead Right - Far';
  const s = new Sequencer(read('moves.xml'), read('formations.xml'));
  for (const t of FAMILY) s.registerByTitle(t, read('ms/lead_right.xml'));
  s.setPermissionMode('consistent');

  // A 2-DANCER BOARD, because these authorings are written for one: measured, NO sibling title has a whole-board fit on
  // any 8-dancer formation — they apply by tiling — so a squared set would make every `findMatchingVariant` check here
  // pass for the wrong reason (null already).
  const pair = { dancers: FORMATIONS.get('Adjacent Dancers Close').map((d, i) => ({ id: i + 1, couple: 1, gender: d.gender, x: d.x, y: d.y, heading: d.angleDeg * DEG })) };
  check(pair.dancers.length === 2, 'the witness board is the two dancers these authorings are written for');

  // THE SHIPPED RULES ALREADY DENY THESE TITLES' whole-board reading (`START A WHITE LIST FOR LEAD RIGHT`), so the
  // harness first RE-ALLOWS the two authorings it talks about — a later rule at the same level wins — and then the only
  // question left is which BODY is admitted.
  const allowBoth = [
    { call: [far], level: 'ms', decision: 'allow', reason: 'allowed for this harness' },
    { call: ['Lead Right - Normal'], level: 'ms', decision: 'allow', reason: 'allowed for this harness' },
  ];
  s.setPermissionRules(allowBoth);

  // NEGATIVE CONTROL: with no body rule, the body matches and applies.
  check(s.findMatchingVariant(pair, far, 1.5) !== null, 'with no body rule the body matches — the control');
  check(s.applyToBoard(pair, far).legal, 'and applies');

  // A RULE ON THE BODY removes it from the candidate set…
  s.setPermissionRules([...allowBoth, { call: [far], going: 'far', level: 'ms', decision: 'deny', reason: 'no far lead at ms' }]);
  check(s.findMatchingVariant(pair, far, 1.5) === null, 'a `going`-keyed rule removes the body from the candidate set');
  const refused = s.applyToBoard(pair, far);
  check(refused.legal === false, 'so the call is refused');
  check((refused.reason ?? '').includes('no far lead at ms'), `with the RULE's sentence ("${refused.reason}")`);
  check(!/No setup in this call matches/.test(refused.reason ?? ''), 'not the geometric "No setup" message, which would hide that a rule said no');

  // …AND A BODY-LESS ASK IS NOT DECIDED BY IT. At the reading boundary `going` is null, so the same rule does not refuse
  // the reading — which is exactly why a body rule and a reading rule are different instruments.
  check(s.mayOffer(far, null, pair).allowed === true, 'while the READING is still allowed: a body-keyed rule cannot decide a body-less ask');

  // …AND IT DOES NOT LEAK TO ANOTHER BODY.
  check(s.applyToBoard(pair, 'Lead Right - Normal').legal, 'and the `normal` authoring still applies — the rule is about a BODY');
  check(s.findMatchingVariant(pair, 'Lead Right - Normal', 1.5) !== null, 'its body is still a candidate');
  s.setPermissionRules([]);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
