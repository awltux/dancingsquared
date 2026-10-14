// THE PICKER'S PERMISSION LAYER, pinned.
//
// `permissions.ts` decides what the call chooser may OFFER. It is deliberately not a legality check: the
// engine still applies anything, and the tests below pin that separation, because collapsing the two is
// the easy mistake and it would change what the sequencer can do rather than what it suggests.
//
// What this pins:
//   (1) the reported case - all-8 `Dosado` from a `Static Square` is not offered at MS
//   (2) the exact-name match - `Left Dosado` (LEGAL, no coded rule) and `Dosado to a Wave` are untouched,
//       which is why the rule may not match on a prefix
//   (3) scoped forms survive - `Heads Dosado` / `Sides Dosado` are still offerable for their group
//   (4) LEVEL OVERRIDE - "a later level overrides an earlier one": an MS deny that PLUS contradicts is
//       lifted at PLUS and still in force at MS
//   (5) "never" is not a special category, just a rule no level overrides
//   (6) PICKER-ONLY - `applyToBoard` still applies the suppressed call
//   (7) the default is ALLOW, so a rule that matches nothing cannot empty the list
//   (8) all-8 `Lead Right` from a `Static Square` is not offered, while `Heads` / `Sides` still are
//   (9) a rule may name SEVERAL groups (`group: [...]`) and matches any of them; `[]` is rejected,
//       because "any group" is the ABSENT field and the two must not be confusable
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
} from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');

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
    { call: 'Dosado', group: ['All 8'], level: 'ms', decision: 'deny', reason: 'MS says no' },
    { call: 'Dosado', group: ['All 8'], level: 'plus', decision: 'allow', reason: 'PLUS introduces it' },
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
  const chain = [{ call: 'Frobnicate', level: 'ssd', decision: 'deny', reason: 'not a real call' }];
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

console.log('\n== (7) PICKER-ONLY: the engine still applies it ==');
// This is the separation the whole design rests on, and it is easy to break by routing the rule into
// the legality check instead of the picker.
seq.setActiveLevel('ms');
check(seq.mayOffer('Dosado', 'All 8').allowed === false, 'the picker does not offer it');
check(seq.applyToBoard(square, 'Dosado').legal === true, 'but applyToBoard still applies it');
check(seq.sequenceBeats(['Dosado'], square) > 0, 'and a hand-written sequence can still dance it');

console.log('\n== (8) the default is ALLOW ==');
{
  const none = evaluatePermissions([], { call: 'Anything', group: 'All 8', level: 'ms' });
  check(none.allowed === true, 'no rules at all allows the call');
  check(none.rule === null, 'and reports no deciding rule');
  const unrelated = evaluatePermissions(
    [{ call: 'SomeOtherCall', level: 'ms', decision: 'deny', reason: 'x' }],
    { call: 'Dosado', group: 'All 8', level: 'ms' },
  );
  check(unrelated.allowed === true, 'a rule for a different call does not suppress this one');
}

console.log('\n== (9) the shipped rules are well-formed ==');
for (const r of PERMISSION_RULES) {
  check(typeof r.level === 'string' && r.level.length > 0, `rule for ${r.call ?? '*'} names a level`);
  check(r.decision === 'deny' ? !!r.reason : true, `a deny rule (${r.call ?? '*'}) carries a reason`);
  check(PERMISSION_LEVELS.includes(r.level), `rule level "${r.level}" is a known programme`);
  // A GROUP LIST WITH NOTHING IN IT IS A RULE THAT CAN NEVER FIRE, and "any group" is still the ABSENT
  // field. Rejecting it here is what keeps the two from being confused for each other.
  check(r.group === undefined
    || (Array.isArray(r.group) && r.group.length > 0 && r.group.every((g) => typeof g === 'string' && g.trim() !== '')),
    `rule for ${r.call ?? '*'} names no empty group list (${JSON.stringify(r.group)})`);
}

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
  check(r.rule?.board === 'Static Square' && r.rule?.group?.includes('All 8'),
    `and it is the square-set rule that decided it (${r.rule?.call}/${r.rule?.group?.join('+')}/${r.rule?.board})`);
  check(!!r.reason && /heads or the sides/.test(r.reason), 'the reason names the two readings that ARE the call');
}
// THE DESIGNATED READINGS SURVIVE, which is the whole point of a group-scoped deny.
for (const g of ['Heads', 'Sides']) {
  check(seq.mayOffer('Lead Right', g, square).allowed === true, `${g} Lead Right is still offered from a square`);
}
// `mayOffer` keys on the BARE call, so the prefixed spelling must survive: `Heads Lead Right` is a
// selection, not a different call, and a rule that swallowed it would refuse the very reading it names.
check(seq.mayOffer('Heads Lead Right', 'Heads', square).allowed === true,
  'and the `Heads Lead Right` spelling is offered for Heads');
// THE NEGATIVE CONTROL FOR THE MATCH: a title that merely STARTS with the denied name. `matching` is exact
// on the normalised name, so this must survive; a prefix match would take it, and it is a different call.
check(seq.mayOffer('Lead Right from Lines', 'All 8', square).allowed === true,
  '`Lead Right from Lines` is untouched - the match is exact, not a prefix');
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
  check(!!r.parallel && r.parallel.groups.length === 4,
    `and it still tiles the square four ways (${r.parallel?.groups.length} group(s))`);
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
  const chain = [{ call: 'Two Groups', group: ['Alpha', 'Beta'], level: 'ms', decision: 'deny', reason: 'either' }];
  const ask = (group) => evaluatePermissions(chain, { call: 'Two Groups', group, level: 'ms' }).allowed;
  check(ask('Alpha') === false, 'the FIRST named group matches');
  check(ask('Beta') === false, 'and the SECOND does too');
  check(ask('Gamma') === true, 'a group not in the list does not match');
  check(ask(null) === true, 'and neither does a whole-board request, which is the empty group');
  const reversed = [{ call: 'Two Groups', group: ['Beta', 'Alpha'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(reversed, { call: 'Two Groups', group: 'Alpha', level: 'ms' }).allowed === false,
    'order within the list does not matter');
  // The normalisation is per name, so a rule may be written in the caller's own casing and spacing.
  const scruffy = [{ call: 'Two Groups', group: ['  aLpHa ', 'BETA'], level: 'ms', decision: 'deny', reason: 'either' }];
  check(evaluatePermissions(scruffy, { call: 'Two Groups', group: 'alpha', level: 'ms' }).allowed === false,
    'and each name is normalised the way a single name was');
  // THE EMPTY LIST IS THE FOOTGUN THIS PINS: `[]` matches nothing, which is a rule that can never fire.
  // "Any group" is still the ABSENT field, and section (9) refuses a rule that writes `[]` instead.
  const empty = [{ call: 'Two Groups', group: [], level: 'ms', decision: 'deny', reason: 'never' }];
  check(evaluatePermissions(empty, { call: 'Two Groups', group: 'Alpha', level: 'ms' }).allowed === true,
    'an empty list matches nothing - it is not a way to write "any group"');
}
// THE SHIPPED USE OF IT: the whole-square `Dosado` deny is ONE rule covering both genders, because the
// restriction and its reason are the same for the two. Splitting it back into near-duplicate entries would
// be silently allowed by the type, so the count is pinned rather than left to review.
{
  const squareDosado = PERMISSION_RULES.filter((r) => r.call === 'Dosado' && r.board === 'Static Square'
    && r.group?.some((g) => ['boys', 'girls'].includes(g.trim().toLowerCase())));
  check(squareDosado.length === 1, `ONE rule covers the Boys and Girls square-set Dosado (${squareDosado.length})`);
  check(JSON.stringify(squareDosado[0]?.group) === JSON.stringify(['Boys', 'Girls']),
    `and it names both (${JSON.stringify(squareDosado[0]?.group)})`);
}

console.log(failures === 0 ? '\npermissions: all green.' : `\npermissions: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
