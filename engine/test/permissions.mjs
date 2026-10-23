// THE PICKER'S PERMISSION LAYER, pinned.
//
// `permissions.ts` decides what the call chooser may OFFER. It is deliberately not a legality check: the
// engine still applies anything, and the tests below pin that separation, because collapsing the two is
// the easy mistake and it would change what the sequencer can do rather than what it suggests.
//
// What this pins:
//   (1) the reported case - all-8 `Dosado` from a `Static Square` is not offered at MS
//   (2) the match is EXACT - `Left Dosado` (LEGAL, no coded rule) and `Dosado to a Wave` are untouched,
//       which is why the rule may not match on a prefix
//   (3) the SCOPED forms survive - `Heads Dosado` / `Sides Dosado` are still offerable for their group
//   (4) LEVEL OVERRIDE - "a later level overrides an earlier one": an MS deny that PLUS contradicts is
//       lifted at PLUS and still in force at MS
//   (5) "never" is not a special category, just a rule no level overrides
//   (6) a rule ABOVE the active level is not consulted
//   (7) PICKER-ONLY - `applyToBoard` still applies the suppressed call
//   (8) the default is ALLOW, so a rule that matches nothing cannot empty the list
//   (9) the shipped rules are well-formed, an empty group list included
//  (10) Boys/Girls Dosado are never offered from a Static Square
//  (11) a rule keyed on a board does not follow the call to other boards
//  (12) a board-less request cannot trip a formation rule
//  (13) all-8 `Lead Right` is not offered from a Static Square, while `Heads` / `Sides` still are
//  (14) one rule may name SEVERAL groups (`group: [...]`) and matches any of them
//  (15) and the refusal REMOVES THE OVERLAP: every reading still offered is a WHOLE COUPLE, moves at most
//       two couples and never closes within 1.0 of another dancer, while the refused reading moves all
//       eight onto one spot
//  (16) the rules do not outgrow the corpus: every `<call> - <variant>` authoring of a GOVERNED call is
//       governed too, and a numbered couple can still dance each of them
//  (17) one rule may name SEVERAL CALLS - the authoring family of one call - and matches any of them
//  (18) a FOUR-DANCER call is offered only to four dancers (the `Circle Four` white list)
//  (19) the Single Circle white list, and the reason it gives
//  (20) a rule may name a board by its FORMATION ID, for the boards no name reaches - and the name fallback
//       this layer gained beside it (a board the curated namer cannot name now still has a keyable name)
//
// Usage: node engine/test/permissions.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  evaluatePermissions,
  levelRank,
  PERMISSION_LEVELS,
  PERMISSION_RULES,
  GROUP_NAMES,
} from '../dist/index.js';
import { callsByTitle, catalogueTitles, implementedTitles } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();

/** Every name the corpus can actually PERFORM: the `<tam>` titles plus the coded-move aliases. The list a
 *  shipped rule's `call` has to be in, and the reason it cannot be a hand-kept array like `GROUP_NAMES`. */
const implemented = implementedTitles(assets);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const square = seq.boardForFormation('Static Square');

console.log('== the level order is the programme order ==');
check(levelRank('discovered') < levelRank('ssd'), 'discovered sorts before ssd');
check(levelRank('ssd') < levelRank('ms'), 'ssd sorts before ms');
check(levelRank('ms') < levelRank('plus'), 'ms sorts before plus');
check(levelRank('plus') < levelRank('a1'), 'plus sorts before a1');
check(PERMISSION_LEVELS.length === 10, `10 levels are ordered (got ${PERMISSION_LEVELS.length})`);
check(PERMISSION_LEVELS.join(',') === 'discovered,ssd,ms,plus,a1,a2,c1,c2,c3a,c3b',
  `b1 and b2 are gone from the order (${PERMISSION_LEVELS.join(',')})`);
check(levelRank('nonsense') === PERMISSION_LEVELS.length,
  'an unknown level sorts LAST, so a rule naming one is specific rather than ignored');

console.log('\n== (1) the reported case is suppressed AT MS ==');
seq.setActiveLevel('ms');
check(seq.mayOffer('Dosado', 'All 8').allowed === false, 'all-8 Dosado is NOT offered at MS');
{
  const r = seq.mayOffer('Dosado', 'All 8');
  check(!!r.reason && r.reason.length > 30, 'the refusal carries a real reason, not a bare "no"');
  check(r.rule?.level === 'ms', `the deciding rule is the MS one (got ${r.rule?.level})`);
}
// `legalNext` is the PRE-GROUP list, so it must still carry `Dosado`: the picker narrows it by the
// chosen group, and dropping it here removes `Dosado` from `Head Boys` too - which is the symptom
// `group-calls.mjs` pins. The suppression belongs to the whole-board reading, not to the name.
check(seq.legalNext().includes('Dosado') === true,
  'the pre-group list still carries Dosado, so a GROUP can choose it');
check(seq.permissionReason('Dosado', 'All 8') !== null, 'the whole-board reading has a refusal reason');

console.log('\n== (2) the match is EXACT, so its neighbours are untouched ==');
// Left Dosado is legal from a square set and has no coded rule; Dosado to a Wave is a different call.
for (const other of ['Left Dosado', 'Dosado to a Wave']) {
  check(seq.mayOffer(other, 'All 8').allowed, `${other} is still offered`);
}
check(seq.legalNext().includes('Left Dosado'), '...and Left Dosado is in the offered list');

console.log('\n== (3) the SCOPED forms survive ==');
// The rule names `All 8`, so a chosen group is a different request and is not caught by it.
for (const g of ['Heads', 'Sides']) {
  check(seq.mayOffer('Dosado', g).allowed, `${g} Dosado is still offerable for ${g}`);
}
// And the picker's own group gate agrees, because it consults the same layer.
check(seq.groupCanPerform(square, 'Heads', 'Dosado'), 'groupCanPerform(Heads, Dosado) is true');
check(seq.groupCanPerform(square, 'All 8', 'Dosado') === false, 'groupCanPerform(All 8, Dosado) is false');

console.log('\n== (4) LEVEL OVERRIDE: a later level lifts an earlier deny ==');
{
  // The shape the provider described: "if never in MS, it might be overridden in PLUS".
  const chain = [
    { call: ['Dosado'], group: ['All 8'], level: 'ms', decision: 'deny', reason: 'MS says no' },
    { call: ['Dosado'], group: ['All 8'], level: 'plus', decision: 'allow', reason: 'PLUS introduces it' },
  ];
  const atMs = evaluatePermissions(chain, { call: 'Dosado', group: 'All 8', level: 'ms' });
  const atPlus = evaluatePermissions(chain, { call: 'Dosado', group: 'All 8', level: 'plus' });
  check(atMs.allowed === false, 'at MS the deny is in force');
  check(atMs.rule?.level === 'ms', 'and the MS rule decided it');
  check(atPlus.allowed === true, 'at PLUS the override is in force');
  check(atPlus.rule?.level === 'plus', 'and the PLUS rule decided it');
}

console.log('\n== (5) "never" is just a rule no level overrides ==');
{
  // Identical machinery, no special case: a lone deny is simply never contradicted.
  const chain = [{ call: ['Frobnicate'], level: 'ssd', decision: 'deny', reason: 'not a real call' }];
  for (const lv of ['ssd', 'ms', 'plus', 'c3b']) {
    check(evaluatePermissions(chain, { call: 'Frobnicate', level: lv }).allowed === false,
      `a lone deny holds at ${lv} - there is no level that lifts it`);
  }
}

console.log('\n== (6) a rule ABOVE the active level is not consulted ==');
{
  // The app registers only calls up to the chosen level, so a rule from a later one cannot apply:
  // honouring it would let an unloaded programme forbid a call the loaded one allows.
  check(seq.mayOffer('Dosado', 'All 8').allowed === false, 'at MS the built-in MS rule applies');
  seq.setActiveLevel('ssd');
  check(seq.mayOffer('Dosado', 'All 8').allowed === true,
    'at SSD the MS rule is not yet introduced, so nothing forbids it');
  seq.setActiveLevel('ms');
}

console.log('\n== (7) PICKER-ONLY BY DEFAULT: the engine still applies it ==');
// This is the separation the whole design rests on, and it is easy to break by routing the rule into
// the legality check instead of the picker.
//
// AND IT IS NOW A MODE, not an absolute: `permissionMode` defaults to `'offer-only'`, so this section pins the DEFAULT
// and the line below pins the other side of it. The distinction matters — a future change that flips the default would
// otherwise read as an engine regression here rather than as the decision it is.
seq.setActiveLevel('ms');
check(seq.mayOffer('Dosado', 'All 8').allowed === false, 'the picker does not offer it');
check(seq.applyToBoard(square, 'Dosado').legal === true, 'but applyToBoard still applies it');
check(seq.sequenceBeats(['Dosado'], square) > 0, 'and a hand-written sequence can still dance it');
seq.setPermissionMode('consistent');
check(seq.applyToBoard(square, 'Dosado').legal === false, 'WHILE `consistent` refuses the same apply — the mode, not the layer, decides this');
// MEASURED COST OF THAT MODE, which is why it is not the default: with the gate on, `figure-census` reads 3 of 188 figures
// (116 with it off), the get-out corpus is unchanged, and the generated FSM loses 332 of its 3958 edges.
seq.setPermissionMode('offer-only');
check(seq.applyToBoard(square, 'Dosado').legal === true, 'and switching back restores it, so the default is a setting rather than a rewrite');

console.log('\n== (8) the default is ALLOW ==');
{
  const none = evaluatePermissions([], { call: 'Anything', group: 'All 8', level: 'ms' });
  check(none.allowed === true, 'no rules at all allows the call');
  check(none.rule === null, 'and reports no deciding rule');
  const unrelated = evaluatePermissions(
    [{ call: ['SomeOtherCall'], level: 'ms', decision: 'deny', reason: 'x' }],
    { call: 'Dosado', group: 'All 8', level: 'ms' },
  );
  check(unrelated.allowed === true, 'a rule for a different call does not suppress this one');
}

console.log('\n== (9) the shipped rules are well-formed ==');
/** THE PREDICATE THE LOOP BELOW USES, named so the control can exercise the real one rather than a copy of
 *  it: a control that restates the rule measures the restatement (AGENTS.md 5). EVERY name in the list has
 *  to be performable, because a rule naming three calls and one typo is a rule that partly never fires. */
const ruleCallIsPerformable = (r) => r.call === undefined || r.call.every((c) => implemented.has(c));
/** One label for the messages, so an array rule is named by all its calls rather than by "a,b". */
const ruleLabel = (r) => (r.call ? r.call.join(' / ') : '*');
for (const r of PERMISSION_RULES) {
  check(typeof r.level === 'string' && r.level.length > 0, `rule for ${ruleLabel(r)} names a level`);
  check(r.decision === 'deny' ? !!r.reason : true, `a deny rule (${ruleLabel(r)}) carries a reason`);
  check(PERMISSION_LEVELS.includes(r.level), `rule level "${r.level}" is a known programme`);
  // A CALL THE CORPUS CANNOT PERFORM IS THE SAME FAILURE AS A GROUP TYPO WITH A WORSE FAILURE MODE, and it
  // is the one this section was missing. `GROUP_NAMES` is a fixed list, so a group typo is answerable from
  // the file; a CALL name comes from the corpus, and THE CORPUS RENAMES. The answer when a rule stops
  // matching is not "no rule" - it is the DEFAULT, which section 8 pins as ALLOW.
  // MEASURED, and it is not hypothetical: `4d40da5` renamed the `Lead Left` authorings to
  // `Lead Left - Normal` / `- Far` while the rules for them were being written by hand, and the two
  // `Lead Right from *` subjects section 15 used to ask about no longer exist in the corpus at all - so both
  // the rule and the check that named them had quietly become no-ops.
  // `implementedTitles` is the corpus's own list plus the coded aliases: the widest true answer, rather than
  // a second hand-kept list to drift against (AGENTS.md 4.3).
  if (r.call !== undefined) {
    check(ruleCallIsPerformable(r), `rule for ${ruleLabel(r)} names calls the catalogue can perform`);
    // A CALL LIST WITH NOTHING IN IT IS A RULE THAT CAN NEVER FIRE, the same footgun the group list below is
    // rejected for. "Any call" is still the ABSENT field.
    check(Array.isArray(r.call) && r.call.length > 0
      && r.call.every((c) => typeof c === 'string' && c.trim() !== ''),
      `rule for ${ruleLabel(r)} names no empty call list (${JSON.stringify(r.call)})`);
  }
  // A GROUP NAME THE PICKER CANNOT PRODUCE IS A RULE THAT CANNOT FIRE, so a typo in a shipped rule is a
  // rule that quietly does nothing. `GROUP_NAMES` is the one list of names the picker can offer, and the
  // eight gender spellings are exactly the thing that used to be hand-typed into a rule.
  for (const g of r.group ?? []) {
    check(GROUP_NAMES.includes(g), `rule for ${ruleLabel(r)} names a group the picker offers ("${g}")`);
  }
  // A GROUP LIST WITH NOTHING IN IT IS A RULE THAT CAN NEVER FIRE, and "any group" is still the ABSENT
  // field. Rejecting it here is what keeps the two from being confused for each other.
  check(r.group === undefined
    || (Array.isArray(r.group) && r.group.length > 0 && r.group.every((g) => typeof g === 'string' && g.trim() !== '')),
    `rule for ${ruleLabel(r)} names no empty group list (${JSON.stringify(r.group)})`);
}

// THE NEGATIVE CONTROL for the call check above, and it is the case that actually happened. It runs the SAME
// predicate the loop ran, against the exact strings that moved: "every rule's call is in the catalogue" is
// satisfied trivially by a list that contains everything, so what makes the check real is that it REJECTS the
// pre-rename spellings. Had a rule been written against any of these, the loop above is what goes red, and
// nothing else here would: sections 13-15 name titles directly and would themselves be asking about a call
// that does not exist - which is exactly how section 15 came to be failing before this change.
const STALE_TITLES = ['Lead Left Normal', 'Lead Left Far', 'Lead Right from Lines', 'Lead Right from Close Couples'];
const acceptedStale = STALE_TITLES.filter((call) => ruleCallIsPerformable({ call: [call], level: 'ms', decision: 'allow' }));
check(acceptedStale.length === 0,
  `the call check REJECTS the pre-rename spellings (${acceptedStale.length} of ${STALE_TITLES.length} accepted: ${acceptedStale.join(', ') || 'none'})`);

console.log('\n== (10) BOYS / GIRLS DOSADO ARE NEVER OFFERED FROM A STATIC SQUARE ==');
// "They conflict in the middle of the square." Measured: every boy faces his partner and every girl
// faces hers, so BOTH pairs dance a Dosado at once, and from a square the two pairs are opposite each
// other - worst body gap -0.200 with FOUR pairs inside each other simultaneously.
//
// This one is a NEVER: declared at MS, the earliest programme the app registers a real corpus for, so
// no later level can be contradicted from below and it holds at every level at or above it.
for (const lv of ['ms', 'plus', 'a1', 'c3b']) {
  seq.setActiveLevel(lv);
  for (const g of ['Boys', 'Girls']) {
    check(seq.mayOffer('Dosado', g, square).allowed === false,
      `${g} Dosado is NOT offered from a Static Square at ${lv.toUpperCase()}`);
  }
}
seq.setActiveLevel('ms');
{
  const r = seq.mayOffer('Dosado', 'Girls', square);
  check(r.rule?.level === 'ms', `the deciding rule is the never-level ms (got ${r.rule?.level})`);
  check(!!r.reason && /middle/.test(r.reason), 'the reason says why: they meet in the middle');
}
// The per-couple forms are the answer offered instead, and must survive.
for (const g of ['Heads', 'Sides']) {
  check(seq.mayOffer('Dosado', g, square).allowed === true, `${g} Dosado is still offered from a square`);
}
// And a group with no rule at all is untouched.
check(seq.mayOffer('Trade', 'Boys', square).allowed === true, 'Boys Trade is unaffected by the rule');

console.log('\n== (11) the rule is FORMATION-SCOPED, not global ==');
// A rule keyed on the board must not follow the call to other formations, where it is an ordinary call.
for (const bn of ['Normal Lines', 'Ocean Waves', 'Eight Chain Thru', 'Double Pass Thru']) {
  const b = seq.boardForFormation(bn);
  if (!b) continue;
  check(seq.mayOffer('Dosado', 'Boys', b).allowed === true,
    `Boys Dosado is still offered from ${bn}`);
  check(seq.mayOffer('Dosado', 'Girls', b).allowed === true,
    `Girls Dosado is still offered from ${bn}`);
}
// The all-8 rule is square-only too: broader boards are the call working as authored.
{
  const lines = seq.boardForFormation('Normal Lines');
  check(seq.mayOffer('Dosado', 'All 8', lines).allowed === true,
    'all-8 Dosado is still offered from Normal Lines');
  check(seq.mayOffer('Dosado', 'All 8', square).allowed === false,
    '...and still refused from a Static Square');
}

console.log('\n== (12) a board-less request cannot trip a formation rule ==');
// The safe direction: a request that names no board must not be treated as if it were the one the rule
// is about, or an unnamed board would silently lose calls.
{
  const noBoard = evaluatePermissions(PERMISSION_RULES, { call: 'Dosado', group: 'Boys', level: 'ms' });
  check(noBoard.allowed === true, 'with no board the formation-scoped deny does not match');
  const named = evaluatePermissions(PERMISSION_RULES, { call: 'Dosado', group: 'Boys', board: 'Static Square', level: 'ms' });
  check(named.allowed === false, 'and naming the board makes it match');
}

console.log('\n== (13) ALL-8 `Lead Right` FROM A STATIC SQUARE ==');
// ASKED FOR: "how would I exclude All 8 from Lead Right when in Static Square", with the caller's own
// scope: "it is valid from heads and sides". The rule is the square-set reading only - see the rule's
// comment in permissions.ts for the measurement that made it a rule rather than a tiling fix.
{
  const r = seq.mayOffer('Lead Right', 'All 8', square);
  check(r.allowed === false, 'all-8 Lead Right is NOT offered from a Static Square');
  // THE DECIDING RULE MOVED WHEN THE WHITELIST DID, so this check follows it rather than the old shape.
  // `a476a4f` replaced the square-set deny with a catch-all deny on the call plus ALLOW rows for the readings
  // that survive, so an all-8 refusal is now decided by a rule that carries neither a board nor a group. What
  // the check is FOR is unchanged - the refusal is a RULE and not the default - so it asserts that, by name
  // and decision, instead of pinning a board/group pair the new rule does not have.
  check(r.rule?.call?.includes('Lead Right') && r.rule?.decision === 'deny',
    `and a rule decided it, not the default (${ruleLabel(r.rule ?? {})}/${r.rule?.group?.join('+') ?? '*'}/${r.rule?.board ?? '*'})`);
  // THE REASON IS THE DECIDING RULE'S OWN. The old sentence ("heads or the sides") belongs to the ALLOW rows
  // now, so asserting that text here would pin the wrong rule's wording; what matters to a caller is that a
  // refusal always carries the reason its own rule gave.
  check(!!r.reason && r.reason === r.rule?.reason,
    `the refusal carries its own rule's reason ("${r.reason}")`);
}
// THE DESIGNATED READINGS SURVIVE, which is the whole point of a group-scoped deny.
for (const g of ['Heads', 'Sides']) {
  check(seq.mayOffer('Lead Right', g, square).allowed === true, `${g} Lead Right is still offered from a square`);
}
// `mayOffer` keys on the BARE call, so the prefixed spelling must survive: `Heads Lead Right` is a
// selection, not a different call, and a rule that swallowed it would refuse the very reading it names.
check(seq.mayOffer('Heads Lead Right', 'Heads', square).allowed === true,
  'and the `Heads Lead Right` spelling is offered for Heads');
// THE NEGATIVE CONTROL FOR THE MATCH: a title that merely CONTAINS the denied name. `matching` is exact
// on the normalised name, so this must survive; a substring or prefix match would take it.
//
// THE WITNESS MOVED TWICE, and the second move is the one that matters. It was `Lead Right from Lines` until
// that title was denied in its own right; then it was this call and the two prefixed authorings were asserted
// refused in section 15. Both of those authorings have since been RETIRED by the corpus (`a476a4f` /
// `4d40da5`), so section 15 now asserts the refusal against the titles the corpus actually publishes - and
// this control keeps its job either way, because it is about the MATCH and not about the corpus.
check(seq.mayOffer('Heads Lead Right and Roll', 'All 8', square).allowed === true,
  '`Heads Lead Right and Roll` is untouched - the match is exact, not a prefix or a substring');
// FORMATION-SCOPED, not global: an eight-dancer `Lead Right` authoring exists from `Normal Lines`, where
// the whole-board reading is the call working as authored.
{
  const lines = seq.boardForFormation('Normal Lines');
  check(seq.mayOffer('Lead Right', 'All 8', lines).allowed === true,
    'all-8 Lead Right is still offered from Normal Lines');
}
// PICKER-ONLY, observed as the separation the layer rests on: the capability is untouched.
{
  const r = seq.applyToBoard(square, 'Lead Right');
  check(r.legal === true, 'applyToBoard still applies all-8 Lead Right - the layer decides what is SUGGESTED');
  // THE TILING IS TWO GROUPS OF FOUR AT THIS REVISION, and it was FOUR GROUPS OF TWO when this check was
  // written. The cause is the corpus, not the rules (the layer cannot affect `applyToBoard`): `a476a4f`
  // rewrote `lead_right.xml` and promoted the 2-dancer `Adjacent Dancers` bodies to their own titles, so the
  // bare name now matches the 4-DANCER `Facing Couples` authoring instead. Pinned as the measured shape,
  // with its cause, so the next move is a reading rather than a surprise.
  check(!!r.parallel && r.parallel.groups.length === 2,
    `and it tiles the square as two groups of four (${r.parallel?.groups.map((g) => g.length).join('+')})`);
  // MEASURED AND RECORDED RATHER THAN PINNED, because it is a defect and not an expectation: that 4-dancer
  // reading puts two dancers on ONE SPOT on a Static Square (worst 0.000, the same overlap section 15's
  // control measures), while the 2-dancer SIBLING titles are clean on the same board (`- Close` 1.048,
  // `- Normal` 1.087). So the refusal above is HIDING a body/matching defect rather than fixing it, which
  // AGENTS.md 4.1 calls out - "a fix that trades a visible defect for a hidden one is not a fix". Recorded in
  // `TODO.md` P0.4 as the corpus work it is.
}
// AND THE LIMIT OF THIS LAYER, MEASURED, because a consumer that offers `legalNext()` verbatim still hands
// the player this call: `legalNext` keeps a call whose OWN reading was refused when some GROUP can perform
// it, which is deliberate (it is what keeps `Head Boys Dosado` offerable). So the deny is authoritative for
// `mayOffer`, and a picker must ask `mayOffer(call, 'All 8', board)` for its no-group reading.
{
  seq.setActiveLevel('ms');
  seq.setBoard(square);
  const legal = seq.legalNext();
  check(legal.includes('Lead Right'), 'legalNext still lists Lead Right - it is "offerable in SOME reading"');
  check(legal.includes('Dosado'), 'and still lists the already-denied all-8 Dosado, for the same reason');
}

console.log('\n== (14) ONE RULE CAN NAME SEVERAL GROUPS, AND MATCHES ANY OF THEM ==');
// THE ITERATION ITSELF, on a synthetic chain so the shape is pinned independently of the shipped rules.
// ANY-OF, NOT ALL-OF: a request is about ONE reading, so a rule naming two groups applies to a request for
// either - matching only a request that is somehow both would make the field useless.
{
  const chain = [{ call: ['Two Groups'], group: ['Alpha', 'Beta'], level: 'ms', decision: 'deny', reason: 'either' }];
  const ask = (group) => evaluatePermissions(chain, { call: 'Two Groups', group, level: 'ms' }).allowed;
  check(ask('Alpha') === false, 'the FIRST named group matches');
  check(ask('Beta') === false, 'and the SECOND does too');
  check(ask('Gamma') === true, 'a group not in the list does not match');
  check(ask(null) === true, 'and neither does a whole-board request, which is the empty group');
  const reversed = [{ call: ['Two Groups'], group: ['Beta', 'Alpha'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(reversed, { call: 'Two Groups', group: 'Alpha', level: 'ms' }).allowed === false,
    'order within the list does not matter');
  // The normalisation is per name, so a rule may be written in the caller's own casing and spacing.
  const scruffy = [{ call: ['Two Groups'], group: ['  aLpHa ', 'BETA'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(scruffy, { call: 'Two Groups', group: 'alpha', level: 'ms' }).allowed === false,
    'and each name is normalised the way a single name was');
  // THE EMPTY LIST IS THE FOOTGUN THIS PINS: `[]` matches nothing, which is a rule that can never fire.
  // "Any group" is still the ABSENT field, and section (9) refuses a rule that writes `[]` instead.
  const empty = [{ call: ['Two Groups'], group: [], level: 'ms', decision: 'deny', reason: 'never' }];
  check(evaluatePermissions(empty, { call: 'Two Groups', group: 'Alpha', level: 'ms' }).allowed === true,
    'an empty list matches nothing - it is not a way to write "any group"');
}
// THE SHIPPED USE OF IT: the whole-square `Dosado` deny is ONE rule covering both genders, because the
// restriction and its reason are the same for the two. Splitting it back into near-duplicate entries would
// be silently allowed by the type, so the count is pinned rather than left to review.
{
  const squareDosado = PERMISSION_RULES.filter((r) => r.call?.includes('Dosado') && r.board === 'Static Square'
    && r.group?.some((g) => ['boys', 'girls'].includes(g.trim().toLowerCase())));
  check(squareDosado.length === 1, `ONE rule covers the Boys and Girls square-set Dosado (${squareDosado.length})`);
  check(JSON.stringify(squareDosado[0]?.group) === JSON.stringify(['Boys', 'Girls']),
    `and it names both (${JSON.stringify(squareDosado[0]?.group)})`);
}

console.log('\n== (15) THE ALL-8 `Lead Right` REFUSAL REMOVES THE OVERLAP ==');
// ASKED FOR: "The rules prevent 'All 8' being used on a static square, so only Heads and Sides can be
// applied. This means only two couples can execute the call, removing the overlap."
//
// MEASURED PER READING rather than asserted in the abstract: for every group the board's own selector
// offers, ask the layer, apply the reading, count the dancers it actually MOVES, and sample the call to
// find the closest any two dancers ever come. The refused all-8 reading is the control - it moves all
// eight and closes to 0.000, which is the overlap the rule exists to prevent, and it is measured through
// `applyToBoard`, which the layer deliberately does not gate (section 7).
const closestOn = (board) => {
  const ds = board.dancers;
  let m = Infinity;
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};
const reading = (title, group) => {
  const name = group === 'All 8' ? title : `${group} ${title}`;
  const offered = seq.mayOffer(title, group, square).allowed;
  const r = seq.applyToBoard(square, name);
  let worst = Infinity;
  if (r.legal) {
    const total = seq.sequenceBeats([name], square);
    for (let k = 0; k <= 24; k++) worst = Math.min(worst, closestOn(seq.evaluateSequence([name], (total * k) / 24, square).board));
  }
  const moved = r.legal
    ? square.dancers.filter((d) => {
      const a = r.board.dancers.find((x) => x.id === d.id);
      return a && (Math.hypot(a.x - d.x, a.y - d.y) > 1e-6 || Math.abs(a.heading - d.heading) > 1e-6);
    }).length
    : 0;
  return { group, offered, legal: r.legal, moved, worst };
};
{
  // THE REFUSAL COVERS EVERY AUTHORING THE CORPUS PUBLISHES, and the list IS the corpus rather than three
  // hand-typed names. Two of the three the old loop named (`Lead Right from Lines`,
  // `Lead Right from Close Couples`) were retired by `a476a4f` / `4d40da5`, so it was asking about calls that
  // do not exist and reading the layer's DEFAULT - which section 8 pins as ALLOW - as a refusal that then
  // failed. `catalogueTitles` is the same "the list is the data" rule the probe runner uses: a new authoring
  // cannot be forgotten here, and a retired one cannot linger.
  //
  // THE FIVE THAT DID NOT REFUSE ARE REFUSED NOW, and the set is still pinned - empty - so it cannot move
  // silently in either direction. The corpus publishes `Lead Right - Close` / `- Normal` / `- Far` and
  // `Lead Left - Normal` / `- Far` as separate TITLES; the match is exact (section 2 pins that), so a rule
  // keyed on the BARE call cannot see an authoring published BESIDE it and the siblings fell through to the
  // default - which section 8 pins as ALLOW - and were offered for the whole square. MEASURED before the rows
  // landed: each was offered on all 138 named formations x 45 group names, against 20 of 6,210 requests for
  // the bare names. `5096c63` closed it with the second of the two ways out this comment used to name - a
  // deny/allow pair per sibling; the first, folding the sibling tams onto their base call, is still blocked
  // on a deterministic tiling (PLAN.md 3). Pinning an EMPTY set is not a weakening: the check below fails if
  // a title STOPS being refused as well as if a new one appears, which is stricter than the per-title loop
  // it replaces. Section 16 is the other direction of the same question.
  const KNOWN_UNREFUSED_ALL8 = [];
  const familyTitles = [...catalogueTitles(assets)].filter((t) => /^Lead (Right|Left)/.test(t)).sort();
  check(familyTitles.length >= 5,
    `the corpus publishes more than one authoring of these couple calls (${familyTitles.length}: ${familyTitles.join(', ')})`);
  const unrefused = familyTitles.filter((t) => seq.mayOffer(t, 'All 8', square).allowed);
  check(JSON.stringify(unrefused) === JSON.stringify(KNOWN_UNREFUSED_ALL8),
    `every authoring refuses all-8 from a Static Square (${unrefused.length} do not: ${unrefused.join(', ') || 'none'})`);
  const vocabulary = ['All 8', ...seq.subsetGroups(square), ...seq.combinedGroups(square)];
  const readings = vocabulary.map((g) => reading('Lead Right', g));
  const offered = readings.filter((x) => x.offered && x.legal);
  // COVERAGE FIRST: a layer that refused everything would satisfy the two checks below while offering
  // nothing at all, which is the empty-picker failure the layer's own default exists to avoid.
  check(offered.length > 0, `coverage: ${offered.length} of ${vocabulary.length} reading(s) are still offered AND legal`);
  const mostMoved = Math.max(...offered.map((x) => x.moved));
  check(mostMoved <= 4, `no offered reading moves more than TWO COUPLES (most: ${mostMoved} dancers)`);
  const nearest = Math.min(...offered.map((x) => x.worst));
  check(nearest >= 1.0, `and none of them ever comes within 1.0 of another dancer (worst ${nearest.toFixed(3)})`);
  const all8 = readings.find((x) => x.group === 'All 8');
  check(all8.moved === 8 && all8.worst < 0.001,
    `CONTROL: the refused all-8 reading moves all ${all8.moved} and closes to ${all8.worst.toFixed(3)} - the overlap is real`);
  // WHAT IS LEFT, MEASURED AND PINNED TO NOTHING ELSE. The rule names the whole-set gender readings AND the
  // combinations (`...SINGLES_GROUP_NAMES, ...COMBINED_GROUP_NAMES`), so the readings that survive are
  // exactly the whole-couple ones - and a reading that is NOT a whole couple is now a red rather than a
  // residue. A reading is COUPLE-SCOPED when every dancer it names belongs to a couple all of whose members
  // it also names.
  const coupleIds = ['Couple #1', 'Couple #2', 'Couple #3', 'Couple #4']
    .map((c) => seq.selectionIds(square, c))
    .filter((ids) => !!ids);
  const coupleScoped = (g) => {
    const ids = seq.selectionIds(square, g);
    if (!ids || ids.length === 0) return false;
    return ids.every((id) => coupleIds.some((c) => c.includes(id) && c.every((x) => ids.includes(x))));
  };
  const notCouples = offered.filter((x) => !coupleScoped(x.group));
  check(notCouples.length === 0,
    `every offered reading is a WHOLE COUPLE (${notCouples.length} were not: ${notCouples.map((x) => x.group).join(', ') || 'none'})`);
  console.log(`    offered here: ${offered.map((x) => `${x.group}(${x.moved} dancers)`).sort().join(', ')}`);
}

console.log('\n== (16) A GOVERNED CALL\'S AUTHORING VARIANTS ARE GOVERNED TOO ==');
{
  // SECTION 15 PINS THE BEHAVIOUR FOR ONE FAMILY; THIS PINS THE RULE SET AGAINST THE WHOLE CORPUS, because
  // that is the direction the gap actually opened in. The rules match a call EXACTLY (section 2 pins that,
  // and `Dosado to a Wave` is its negative control) and the corpus spells an AUTHORING variant of a call
  // `<call> - <variant>`, so a variant of ANY governed call is ungoverned by construction and falls through
  // to the default. MEASURED as this check's negative control: substituting the rule set that was on master
  // BEFORE `5096c63` (`git show d54b867:engine/src/sequencer/permissions.ts`: `Dosado`, `Lead Left`,
  // `Lead Right`) for the shipped set makes this predicate name exactly the five siblings section 15 used to
  // list, so it is the check that would have caught the gap on the commit that opened it rather than on the
  // one that closed it.
  //
  // THE SEPARATOR IS PART OF THE RULE RATHER THAN A CONVENIENCE. A looser measure on `<call> <anything>` was
  // tried and it demands `Dosado to a Wave`, `Dosado your Corner` and `Dosado your Partner` be governed too
  // - three DIFFERENT calls, which section 2 leaves alone on purpose. The eight `Circle * Home` titles are not
  // asked for either, and under this rule they are not VARIANTS of anything at all: the corpus spells the
  // home-ending siblings with no ` - ` separator, so `variantBase` returns null and the sweep never sees them.
  // (They were `Circle * - Stop at Home` when this note was written, which is what made the point concrete -
  // a dashed sibling whose base is not governed.) This asks that a family not outgrow its rules, not that
  // every sibling title be ruled on.
  const governed = new Set(PERMISSION_RULES.flatMap((r) => r.call ?? []));
  const variantBase = (t) => (t.includes(' - ') ? t.slice(0, t.indexOf(' - ')) : null);
  const variants = [...catalogueTitles(assets)].filter((t) => {
    const base = variantBase(t);
    return base !== null && governed.has(base);
  }).sort();
  const ungovernedVariants = variants.filter((t) => !governed.has(t));
  check(ungovernedVariants.length === 0,
    `every authoring variant of a governed call is governed too (${ungovernedVariants.length} not: ${ungovernedVariants.join(', ') || 'none'})`);
  // AND THE DENY DID NOT EAT THE CALL IT PROTECTS. A rule pair with a deny and no allow row for the numbered
  // couples would satisfy every check above while making the variants undanceable - the failure mode a
  // per-title pair has and the bare-call rule it replaced did not - so this is the negative control for the
  // rows themselves, not a restatement of the check above.
  const refused = variants.filter((t) => !seq.mayOffer(t, 'Couple #1', square).allowed);
  check(refused.length === 0,
    `and a numbered couple may still dance each of them (${variants.length - refused.length} of ${variants.length}: ${refused.join(', ') || 'none'} refused)`);
}

console.log('\n== (17) ONE RULE CAN NAME SEVERAL CALLS, AND MATCHES ANY OF THEM ==');
// THE ITERATION ITSELF, on a synthetic chain so the shape is pinned independently of the shipped rules - the
// mirror of section (14) for the field that moved second. ANY-OF, NOT ALL-OF: a request names ONE call, so a
// rule listing several applies to a request for any of them.
{
  const chain = [{ call: ['Alpha Call', 'Beta Call'], level: 'ms', decision: 'deny', reason: 'either' }];
  const ask = (call) => evaluatePermissions(chain, { call, level: 'ms' }).allowed;
  check(ask('Alpha Call') === false, 'the FIRST named call matches');
  check(ask('Beta Call') === false, 'and the SECOND does too');
  check(ask('Gamma Call') === true, 'a call not in the list does not match');
  const reversed = [{ call: ['Beta Call', 'Alpha Call'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(reversed, { call: 'Alpha Call', level: 'ms' }).allowed === false,
    'order within the list does not matter');
  // The normalisation is per name, so a rule may be written in the caller's own casing and spacing.
  const scruffy = [{ call: ['  aLpHa  CALL ', 'BETA CALL'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(scruffy, { call: 'beta call', level: 'ms' }).allowed === false,
    'and each name is normalised the way a single name was');
  // THE EMPTY LIST IS THE FOOTGUN THIS PINS: `[]` matches nothing, which is a rule that can never fire.
  // "Any call" is still the ABSENT field, and section (9) refuses a rule that writes `[]` instead.
  const empty = [{ call: [], level: 'ms', decision: 'deny', reason: 'never' }];
  check(evaluatePermissions(empty, { call: 'Alpha Call', level: 'ms' }).allowed === true,
    'an empty list matches nothing - it is not a way to write "any call"');
  // AND THE LIST DOES NOT WEAKEN EXACTNESS, which section 2 pins for a single name: a listed name still does
  // not cover a LONGER call that merely contains it.
  check(ask('Alpha Call to a Wave') === true, 'a listed name does not cover a longer call that contains it');
}
// THE SHIPPED USE OF IT: the `Lead Right` sibling family is ONE deny and ONE allow naming all three setups,
// because they are one call at three authored spacings. Splitting it back into per-sibling pairs would be
// silently allowed by the type, so the count is pinned rather than left to review.
{
  const lrSiblings = PERMISSION_RULES.filter((r) => r.call?.includes('Lead Right - Close'));
  check(lrSiblings.length === 2,
    `the Lead Right sibling family is ONE deny and ONE allow (${lrSiblings.length} rules)`);
  const deny = lrSiblings.find((r) => r.decision === 'deny');
  check(JSON.stringify(deny?.call)
    === JSON.stringify(['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far']),
  `and the deny names all three setups (${JSON.stringify(deny?.call)})`);
  // EVERY NAME IN THE LIST MUST STILL DECIDE. A family rule that matched only its FIRST name would leave the
  // other two undanceable and unrefused, so each sibling is asked separately - the negative control for the
  // collapse rather than a restatement of the count above.
  for (const t of ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far']) {
    check(evaluatePermissions(PERMISSION_RULES, { call: t, group: 'Couple #1', level: 'ms' }).allowed === true,
      `${t}: a numbered couple may dance it`);
    check(evaluatePermissions(PERMISSION_RULES, { call: t, group: 'All 8', level: 'ms' }).allowed === false,
      `${t}: and the whole square may not`);
  }
}

console.log('\n== (18) A FOUR-DANCER CALL IS OFFERED ONLY TO FOUR DANCERS ==');
// THE SHIPPED WHITE LIST FOR `Circle Four`, pinned per READING rather than by rule shape, because the rule is
// a policy and the policy is what must not drift. The call is authoritative as a four-dancer action:
// `callerlab-ms.txt`'s "b. Circle of 4 Left/Right (1/4, 1/2, 3/4, Full) / Starting formation: Facing Couples".
// On a squared set exactly two readings are facing couples of four - the heads and the sides - so those may
// dance it and the two readings that are the wrong SIZE may not.
{
  const CIRCLE_FOUR = [
    'Circle Four Left', 'Circle Four Left 1/4', 'Circle Four Left 1/2', 'Circle Four Left 3/4',
    'Circle Four Right', 'Circle Four Right 1/4', 'Circle Four Right 1/2', 'Circle Four Right 3/4',
  ];
  const ask = (call, group) => evaluatePermissions(PERMISSION_RULES, { call, group, level: 'ms' }).allowed;
  const offeredAll8 = CIRCLE_FOUR.filter((c) => ask(c, 'All 8'));
  check(offeredAll8.length === 0,
    `no authoring is offered to the whole square - eight dancers cannot circle four (${offeredAll8.join(', ') || 'none'} were)`);
  const offeredCouple = CIRCLE_FOUR.filter((c) => ask(c, 'Couple #1'));
  check(offeredCouple.length === 0,
    `and none to a numbered couple - one couple is half the four (${offeredCouple.join(', ') || 'none'} were)`);
  const refusedFour = CIRCLE_FOUR.filter((c) => !ask(c, 'Heads') || !ask(c, 'Sides'));
  check(refusedFour.length === 0,
    `while Heads and Sides may dance every one (${refusedFour.length} not: ${refusedFour.join(', ') || 'none'})`);
  // THE NEGATIVE CONTROL IS THE READING ONE STEP TOO WIDE, and it checks the REFUSAL'S OWNER rather than only
  // its verdict: a default allow would satisfy "not offered" for a call the engine does not know, so the
  // deciding rule must be the white list's deny.
  const all8 = evaluatePermissions(PERMISSION_RULES, { call: 'Circle Four Left', group: 'All 8', level: 'ms' });
  check(all8.rule?.decision === 'deny' && all8.rule?.call?.includes('Circle Four Left'),
    `and the refusal is the white list's own deny, not the default (${all8.rule?.decision ?? 'default'})`);
  check(!!all8.reason && all8.reason === all8.rule?.reason,
    `whose reason is shown verbatim ("${all8.reason}")`);
}

//  (19) THE SINGLE CIRCLE WHITE LIST says WHY, and the reason is a sentence a caller can read
//
console.log('\n== (19) THE SINGLE CIRCLE WHITE LIST, AND ITS REASON ==');
// A `deny` carries the sentence the app SHOWS. This one was committed as `START A WHITE LIST`, which is a
// note-to-self and not an explanation, so the reason is checked for the SHAPE of a sentence rather than pinned
// word for word: the wording is meant to change as exceptions are curated, and pinning the exact string would
// make the next honest rewording a red gate (AGENTS §4.2: pin the relationship, not the count that drifts).
{
  const SINGLE_CIRCLE = [
    'Single Circle Left', 'Single Circle Left 1/4', 'Single Circle Left 1/2', 'Single Circle Left 3/4',
    'Single Circle Right', 'Single Circle Right 1/4', 'Single Circle Right 1/2', 'Single Circle Right 3/4',
  ];
  const ask = (call, level) => evaluatePermissions(PERMISSION_RULES, { call, level });
  const deniedMs = SINGLE_CIRCLE.filter((c) => !ask(c, 'ms').allowed);
  check(deniedMs.length === SINGLE_CIRCLE.length,
    `all ${SINGLE_CIRCLE.length} Single Circle titles are withheld at Mainstream (${deniedMs.length} were)`);
  // "NEVER" SEMANTICS, MEASURED: a deny at MS that no later level contradicts holds at every later level, so a
  // caller cannot reach the family by switching programme.
  const leaked = SINGLE_CIRCLE.filter((c) => PERMISSION_LEVELS.slice(PERMISSION_LEVELS.indexOf('ms')).some((l) => ask(c, l).allowed));
  check(leaked.length === 0, `and no later programme lifts it (${leaked.join(', ') || 'none'} did)`);
  // THE CONTROL: the rule is specific to the family, so a neighbouring ring call is still offered.
  check(ask('Circle Left', 'ms').allowed, 'while `Circle Left` is still offered - the rule is the family, not the ring');
  // THE REASON ITSELF. A placeholder is ALL CAPS and short; a sentence has lower-case prose and ends in a full
  // stop. Both halves are needed: `START A WHITE LIST` fails the first, and a one-word lower-case stub would
  // fail the second.
  const decided = ask('Single Circle Left', 'ms');
  const reason = String(decided.reason ?? '');
  check(reason === (decided.rule?.reason ?? null), `the refusal shows the rule's own reason ("${reason}")`);
  check(reason.length >= 40 && reason !== reason.toUpperCase() && /\.$/.test(reason.trim()),
    'and that reason is a SENTENCE a caller can act on, not a note-to-self: lower case, long enough, and closed with a full stop');
}

console.log('\n== (20) A RULE MAY NAME A BOARD BY ITS FORMATION ID ==');
// WHY THIS EXISTS. `board` is matched against `recognize`'s name, and that namer is a curated caption:
// MEASURED, it names 16 of the corpus's 138 eight-dancer formations, and nothing names the setups an embedded
// `<tam>` carries. `boardId` is the key for those - computed from the board, so it always exists.
{
  seq.setActiveLevel('ms');
  seq.setPermissionRules([]);
  const diamonds = seq.boardForFormation('Diamonds');
  const waves = seq.boardForFormation('Ocean Waves');
  const id = seq.boardIdentity(diamonds).id;

  // THE ID IS THE BOARD'S, and it survives a rotation - so the rule follows the board round the floor, which
  // is what a name already does and what a rule written for one orientation would get wrong.
  const turned = { dancers: diamonds.dancers.map((d) => ({ ...d, x: -d.y, y: d.x, heading: d.heading + Math.PI / 2 })) };
  check(seq.boardIdentity(turned).id === id, `a rotation of the board reports the same id (${id})`);

  const rule = { call: ['Dosado'], group: ['All 8'], boardId: id, level: 'ms', decision: 'deny', reason: 'not from this shape' };
  const ask = (boardId) => evaluatePermissions([rule], { call: 'Dosado', group: 'All 8', boardId, level: 'ms' });
  check(ask(id).allowed === false && ask(id).rule === rule, 'an id-keyed deny refuses the board it names, and says which rule did it');
  check(ask(seq.boardIdentity(waves).id).allowed === true, 'and does not refuse another formation (the control: the id is a key, not a wildcard)');
  // THE SAFE DIRECTION, the same one a name-keyed rule has (section 12): an ask that carries NO id cannot be
  // governed by an id-keyed rule, because nothing said which board it was about.
  check(ask(null).allowed === true && ask(undefined).allowed === true,
    'and an ask with no id is not governed by it, rather than being treated as every board');

  // THE WIRING, which is what makes the field reachable at all: the Sequencer's own ask supplies `boardId`.
  // Without it this check is the one that goes red, and every engine-level check above would still pass.
  seq.setPermissionRules([rule]);
  check(seq.mayOffer('Dosado', 'All 8', diamonds).allowed === false,
    'and `mayOffer` refuses it, so the id is filled into the request the picker makes');
  check(seq.mayOffer('Dosado', 'All 8', waves).allowed === true, 'while the other formation is still offered');
  seq.setPermissionRules([]);

  // THE NAME FALLBACK, which is the other half of "a key for the boards no name reaches": `Diamonds` is one of
  // the 122 boards the curated namer declines, and it still gets the corpus's own name.
  check(seq.recognize(diamonds).name === null && seq.boardIdentity(diamonds).name === 'Diamonds',
    'the curated namer declines `Diamonds`, and the corpus\'s own name is used instead');
  const byName = { call: ['Dosado'], group: ['All 8'], board: 'Diamonds', level: 'ms', decision: 'deny', reason: 'not from this shape' };
  seq.setPermissionRules([byName]);
  check(seq.mayOffer('Dosado', 'All 8', diamonds).allowed === false,
    'so a rule keyed on that name reaches the board too - it could not before the fallback existed');
  check(seq.boardIdentity(square).name === 'Static Square',
    'and a board the curated namer DOES name keeps its own name, so the fallback cannot re-point a shipped rule');
  seq.setPermissionRules([]);

  // THE SHIPPED TABLE IS UNTOUCHED by this: not one entry names an id, so every refusal measured above still
  // reads the rule it read before.
  const withIds = PERMISSION_RULES.filter((r) => r.boardId !== undefined);
  check(withIds.length === 0, `no shipped rule names a board id (${withIds.length} do), so nothing was re-pointed`);
}

console.log(failures === 0 ? '\npermissions: all green.' : `\npermissions: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
