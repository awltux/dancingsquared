// The client's STANDING rules, PINNED — what a run is worth to the server, and which sign-in a surface may offer.
//
// WHY THIS IS A GATE. DESIGN.md §11.2 makes a signed-out caller a DEMO: the server serves the puzzle, writes nothing,
// and answers every write `401` (A20). The app's half of that is two decisions — whether the run on screen can be
// ranked, and whether a sign-in form may be drawn — and both are invisible if they are wrong in the direction that
// matters: a client that believes a demo run is ranked submits it, is refused `401`, and (because A25's refusal tally
// is applied at the ROUTE TABLE) makes an honest player look like someone probing the API. So every check below has
// its negative control: the plausible wrong rule, named, and the check that is the only one it fails.
//
// `demo` IS THE INTERESTING FACT because it is the SERVER's, not the client's: `GET /drill/current` answers it for a
// caller it served without a Progress row, and a client that trusted its own session instead would rank a run the
// server has already refused to rank. Section 4 drives the rule from a REAL parsed answer rather than a literal, so a
// rename of the flag on the wire fails here rather than in a browser.
//
// Usage: node game/test/standing-probe.mjs
import { issueDrill } from '../src/net/api.ts';
import { mayWrite, signInOffered, standingOf } from '../src/net/standing.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Every fact the rule takes, with the boring ones defaulted so each check reads as the one thing it varies. */
const facts = (over = {}) => ({ configured: true, mode: 'emulate', signedIn: false, demo: false, ...over });

console.log('== 1. with no API configured there is no server to have an opinion ==');
{
  // NOTHING LEAVES THE DEVICE, so the standing is not "unranked" (which would promise a server that is recording
  // nothing) and not "ranked" (which would promise one that is). The offline game is its own case.
  check(standingOf(facts({ configured: false })) === 'offline', 'no base URL means offline, not ranked');
  check(standingOf(facts({ configured: false, mode: 'dev', signedIn: true, demo: true })) === 'offline', 'and nothing else can move it');
}

console.log('\n== 2. `dev` names the player by a verified header, so a signed-out caller is still that player ==');
{
  check(standingOf(facts({ mode: 'dev' })) === 'ranked', 'a dev server ranks a caller with no session');
  // NEGATIVE CONTROL: the over-eager rule "no session means unranked" reports a dev player's run as a demo, and THIS
  // is the only check that fails — sections 3 and 5 agree with it, which is why they cannot catch it.
  check(standingOf(facts({ mode: 'emulate' })) === 'unranked', 'NEGATIVE CONTROL: an emulated server does NOT (the no-session-means-demo rule fails exactly here)');
  check(standingOf(facts({ mode: 'cognito' })) === 'unranked', 'and neither does a deployed one');
}

console.log('\n== 3. a session is ranked, whichever token mode issued it ==');
{
  check(standingOf(facts({ signedIn: true })) === 'ranked', 'a session under emulate is ranked');
  check(standingOf(facts({ mode: 'cognito', signedIn: true })) === 'ranked', 'and under cognito too');
}

console.log('\n== 4. the server\'s own `demo` outranks everything the client believes ==');
{
  // THE SERVER SERVED A DEMO: no Progress row was written, so no submission can land. A client that disagreed would
  // be wrong about the one thing it cannot check for itself.
  check(standingOf(facts({ demo: true })) === 'unranked', 'a demo answer is unranked with no session');
  // NEGATIVE CONTROL, and the one that costs a player real work: "a session means ranked" ranks a run the server has
  // already called a demo. Sections 3, 5 and 6 all agree with the wrong rule; ONLY this check fails it.
  check(standingOf(facts({ signedIn: true, demo: true })) === 'unranked', 'NEGATIVE CONTROL: and it beats a session the app still holds (the session-means-ranked rule fails exactly here)');
  // `dev` IS AN IDENTITY, NOT AN EXEMPTION: if the server says demo, the header did not name anyone it would write for.
  check(standingOf(facts({ mode: 'dev', signedIn: true, demo: true })) === 'unranked', 'and it beats the dev header as well');
}

console.log('\n== 5. a mode this build could not learn is NOT treated as `dev` ==');
{
  // DISCOVERY IN FLIGHT OR FAILED. Guessing `dev` sends a header a deployment ignores; guessing `cognito` opens a
  // flow that does not exist. Unranked is the answer that promises nothing.
  check(standingOf(facts({ mode: null })) === 'unranked', 'an undiscovered mode ranks nothing');
  // NEGATIVE CONTROL: "null falls back to the default mode" is the plausible wrong rule (the app's own default is
  // requested as `save.levelIndex || 1` elsewhere), and it fails here and nowhere else.
  check(standingOf(facts({ mode: null, signedIn: true })) === 'ranked', 'NEGATIVE CONTROL: but a session still ranks it, so the fallback rule is caught by the line above and not this one');
}

console.log('\n== 6. a write is sent only where the server will take one ==');
{
  check(mayWrite('ranked') === true, 'a ranked run may write');
  check(mayWrite('unranked') === false, 'a demo may not (A20: every write is 401)');
  // OFFLINE IS NOT PERMISSION: there is no server to reach, and the local record is the whole record.
  check(mayWrite('offline') === false, 'and neither may the offline game, which has nothing to write TO');
  // THE THREE ARE EXHAUSTIVE, so a fourth standing added later cannot silently write.
  check(['offline', 'ranked', 'unranked'].filter((s) => mayWrite(s)).length === 1, 'exactly one standing may write');
}

console.log('\n== 7. the form is offered only where a sign-in is served, with one pinned exception ==');
{
  const routes = ['POST /auth/signup', 'POST /auth/signin'];
  check(signInOffered({ mode: 'dev', signin: [], pinned: false }) === false, 'a dev server has no account to offer');
  check(signInOffered({ mode: 'emulate', signin: routes, pinned: false }) === true, 'an emulated server that advertises its routes offers the form');
  check(signInOffered({ mode: 'cognito', signin: [], pinned: false }) === false, 'a deployed one offers nothing, because this build opens no hosted flow');
  // THE PINNED BUILD IS THE EXCEPTION AND THE REASON THE RULE IS NOT JUST `signin.length > 0`: a build pinned to
  // `emulate` asked nobody, so its route list is empty by construction (`game/test/auth-client-probe.mjs` pins the
  // fetch count) — and it is exactly the build deployed against the local emulator, so a form it never shows is a
  // dead feature.
  check(signInOffered({ mode: 'emulate', signin: [], pinned: true }) === true, 'a PINNED emulate build offers the form without being told');
  // NEGATIVE CONTROL: the plausible wrong rule, "emulate always offers a form", also offers it at an emulated server
  // that was ASKED and advertised nothing — which is a 404 waiting to happen. ONLY this check fails that rule;
  // section 7's second check agrees with it.
  check(signInOffered({ mode: 'emulate', signin: [], pinned: false }) === false, 'NEGATIVE CONTROL: but an UNPINNED one that was asked and advertised nothing does not (the emulate-always-offers rule fails exactly here)');
  check(signInOffered({ mode: 'dev', signin: [], pinned: true }) === false, 'and nothing pinned to dev offers one, because a dev server has no account at all');
  check(signInOffered({ mode: 'cognito', signin: [], pinned: true }) === false, 'nor a pinned cognito build, whose flow this app cannot open');
  check(signInOffered({ mode: null, signin: [], pinned: false }) === false, 'and a mode this build could not learn offers nothing');
}

console.log('\n== 8. the `demo` the rule reads is the one the WIRE carries ==');
{
  // THE WIRE, NOT A LITERAL. The body below is the shape `api/src/handlers/drill.ts` answers a signed-out caller
  // with (`{ drill, regime, demo: true }`, MEASURED against that handler's own `served(...)` spread), fed through the
  // module that parses it. A rename of the flag on either side fails HERE, which is the only place it would fail
  // before a browser did it for us.
  const body = {
    drill: { id: '1:0', index: 0, levelIndex: 1, seed: 42, poolVersion: 'ms-1', issuedAtMs: 1_700_000_000_000, optionLabels: null, resumed: false },
    regime: { finished: 0, length: 12 },
    demo: true,
  };
  const deps = {
    base: 'http://127.0.0.1:8090',
    fetch: async () => ({ ok: true, status: 200, json: async () => body }),
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    timeoutMs: 1000,
  };
  const answer = await issueDrill(1, deps);
  check(answer.ok === true && answer.value.demo === true, `the demo flag survives the parse (demo: ${answer.value?.demo})`);
  check(standingOf(facts({ signedIn: true, demo: answer.value.demo })) === 'unranked', 'and the standing built from the PARSED answer is unranked even for a signed-in client');

  // THE OTHER HALF OF THE SAME CHECK: a ranked answer must NOT be read as a demo, or the app would refuse to submit
  // every run it is entitled to submit. `demo` is absent for an identified caller, which is the default it must take.
  const ranked = { ...deps, fetch: async () => ({ ok: true, status: 200, json: async () => ({ ...body, demo: undefined }) }) };
  const identified = await issueDrill(1, ranked);
  check(identified.ok === true && identified.value.demo === false, `an identified answer with no flag is NOT a demo (demo: ${identified.value?.demo})`);
  check(standingOf(facts({ signedIn: true, demo: identified.value.demo })) === 'ranked', 'so a signed-in run is ranked, which is what stops the demo rule from refusing every honest submission');
}

console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures ? 1 : 0);
