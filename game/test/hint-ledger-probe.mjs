// THE HINT LEDGER, pinned: the tenth success grants, the ninth does not, the cap is on the BALANCE rather
// than on the earning, and nothing here mutates the record it was given.
//
// WHY THIS IS A GATE AND NOT A NOTE. The balance is a currency: DESIGN.md 10 makes a hint worth a minute of
// the player's own time, and DESIGN.md 11 makes the server the authority on it precisely because a client
// that could mint hints by reporting successes it did not have would have a free run of the Daily. So the
// arithmetic the server will re-run is arithmetic that has to be pinned here first — and the two checks that
// matter most (grant at 10, ignore successes at the cap) are each one `>=` away from being wrong.
//
// THE NEGATIVE CONTROLS ARE NAMED PER CHECK, and three of them were MEASURED by breaking the rule on
// purpose: granting on the 11th, accumulating behind the cap, and mutating the input record.
//
// Usage: node game/test/hint-ledger-probe.mjs
import { EMPTY_LEDGER, earningProgress, recordSuccess, spendHint } from '../src/puzzle/hints.ts';
import { HINT_CAP, HINT_SUCCESS_STEP } from '../src/puzzle/config.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Record `n` successes from a fresh ledger, returning the last result. */
const successes = (n) => {
  let ledger = EMPTY_LEDGER;
  let granted = false;
  for (let i = 0; i < n; i++) {
    const r = recordSuccess(ledger);
    ledger = r.ledger;
    granted = r.granted;
  }
  return { ledger, granted };
};

console.log('== 1. the shipped numbers are the design\'s ==');
{
  check(HINT_SUCCESS_STEP === 10, `one hint per ten successes (${HINT_SUCCESS_STEP})`);
  check(HINT_CAP === 3, `and at most three held (${HINT_CAP})`);
  check(EMPTY_LEDGER.hints === 0 && EMPTY_LEDGER.successes === 0, 'a new player holds none and has earned nothing');
}

console.log('\n== 2. the grant lands on the TENTH success and not the ninth ==');
{
  const nine = successes(9);
  check(nine.ledger.successes === 9, `nine successes are counted as nine (${nine.ledger.successes})`);
  check(nine.ledger.hints === 0, 'and no hint has been granted');
  check(nine.granted === false, 'and no grant was reported on the way');
  const ten = successes(10);
  check(ten.ledger.hints === 1, `the tenth grants one hint (${ten.ledger.hints})`);
  check(ten.ledger.successes === 0, `and resets the count to zero (${ten.ledger.successes})`);
  check(ten.granted === true, 'and reports the grant, so the screen can announce it exactly once');
  // The count is what it says: the 11th success starts the next one rather than granting again.
  const eleven = successes(11);
  check(eleven.ledger.hints === 1 && eleven.ledger.successes === 1, `the eleventh starts the next hint (${eleven.ledger.hints} held, ${eleven.ledger.successes} counted)`);
  // NEGATIVE CONTROL, MEASURED: changing `successes >= HINT_SUCCESS_STEP` to `>` reddens FIFTEEN checks,
  // because every section after this one builds its ledger by recording successes and is therefore one
  // success off. The two checks above are the ones that isolate the boundary itself.
}

console.log('\n== 3. the cap is on the BALANCE, so a full ledger ignores successes ==');
{
  // Thirty successes would be three hints and then nothing: the cap is reached at the thirtieth, and the
  // thirty-first must not bank progress for a fourth.
  const full = successes(3 * HINT_SUCCESS_STEP);
  check(full.ledger.hints === HINT_CAP, `thirty successes hold the cap of ${HINT_CAP} (${full.ledger.hints})`);
  const beyond = successes(3 * HINT_SUCCESS_STEP + 1);
  check(beyond.ledger.hints === HINT_CAP, 'and a success beyond the cap does not grant a fourth');
  check(beyond.ledger.successes === 0, 'nor does it accumulate progress behind the cap');
  // NEGATIVE CONTROL, MEASURED: counting successes even at the cap (returning `{...ledger, successes}`)
  // reddens the "nor does it accumulate" check and nothing else — a banked count would pay out a hint the
  // moment one was spent, which is the whole thing the cap exists to prevent.
}

console.log('\n== 4. spending is not earning ==');
{
  const held = successes(10).ledger;
  const p = earningProgress(held);
  check(p.successes === 0 && p.needed === HINT_SUCCESS_STEP, `a spent-in hint reports 0 of ${p.needed} counted (${p.successes})`);
  check(p.full === false, 'and the ledger is not full');
  const spent = spendHint(held);
  check(spent.spent === true && spent.ledger.hints === 0, `spending takes one hint (${spent.ledger.hints} left)`);
  check(spent.ledger.successes === 0, 'and leaves the progress towards the next one alone — they are different counters');
  // After spending, the cap is no longer binding, so earning resumes.
  const resumed = recordSuccess(spent.ledger);
  check(resumed.ledger.successes === 1, `so a success counts again once there is room (${resumed.ledger.successes})`);
  const full = successes(3 * HINT_SUCCESS_STEP).ledger;
  check(earningProgress(full).full === true, 'and a full ledger says so, because its progress has stopped advancing');
}

console.log('\n== 5. spending with no balance is a refusal, not an error ==');
{
  const empty = spendHint(EMPTY_LEDGER);
  check(empty.spent === false, 'spending nothing reports that nothing was spent');
  check(empty.ledger.hints === 0 && empty.ledger.successes === 0, 'and changes nothing');
  // A refusal must not consume progress either: the alternative would let a click on a disabled button
  // reset the count.
  const partial = { hints: 0, successes: 7 };
  const refused = spendHint(partial);
  check(refused.ledger.successes === 7, `a refused spend leaves the progress intact (${refused.ledger.successes})`);
}

console.log('\n== 6. every transition returns a NEW record ==');
{
  const before = { hints: 1, successes: 4 };
  const after = recordSuccess(before);
  check(after.ledger !== before, 'recordSuccess builds a new ledger');
  check(before.hints === 1 && before.successes === 4, `and the record it was given is untouched (${before.hints} held, ${before.successes} counted)`);
  const spent = spendHint(before);
  check(spent.ledger !== before && before.hints === 1, 'spendHint does too, and does not decrement its input');
  // NEGATIVE CONTROL, MEASURED: an in-place implementation (`ledger.successes++`) reddens THIRTEEN checks,
  // because the probe reuses a ledger across sections and every later reading then sees the mutated record.
  // The two identity checks here are the ones that isolate the rule; the rest is the blast radius, and it
  // would also break the screen's "announce the grant once", which needs the balance BEFORE the answer.
}

console.log('\n== 7. the ledger survives a full round trip of the rule ==');
{
  // Ten successes, a spend, then nine more: the design's sentence "one hint per 10 successes, at most 3
  // held" read as a whole. MEASURED here as a number rather than argued about.
  let ledger = EMPTY_LEDGER;
  for (let i = 0; i < 10; i++) ledger = recordSuccess(ledger).ledger;
  check(ledger.hints === 1 && ledger.successes === 0, 'after ten successes a player holds one hint and has counted nothing');
  ledger = spendHint(ledger).ledger;
  check(ledger.hints === 0, 'spending it leaves none');
  for (let i = 0; i < 9; i++) ledger = recordSuccess(ledger).ledger;
  check(ledger.hints === 0 && ledger.successes === 9, `nine more successes are one short of the next hint (${ledger.successes} counted)`);
  ledger = recordSuccess(ledger).ledger;
  check(ledger.hints === 1 && ledger.successes === 0, 'and the tenth earns another, which is the whole loop of the mode');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
