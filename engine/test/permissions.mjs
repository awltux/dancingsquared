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
    { call: 'Dosado', group: 'All 8', level: 'ms', decision: 'deny', reason: 'MS says no' },
    { call: 'Dosado', group: 'All 8', level: 'plus', decision: 'allow', reason: 'PLUS introduces it' },
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

console.log(failures === 0 ? '\npermissions: all green.' : `\npermissions: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
