// The client's SIGN-IN contract, PINNED — with a fake fetch and a fake storage, so no server and no browser.
//
// WHY THIS IS A GATE. The server side of the identity is pinned by `api/test/auth-probe.mjs`, and it proves that a
// token is the only thing that names a player. This probe proves the other half: that the APP can obtain one, keep
// it, use it, refresh it exactly once when it is due, and lose it when it should — because every one of those is a
// way for the two sides to be individually right and jointly wrong. A client that refreshed on every call would
// burn the session it was keeping (the emulator rotates the refresh token, §11.2); one that kept a dead token
// would have every later request answered `401` for a reason the player cannot see; one that signed out only when
// the server said so would leave a session on a shared machine.
//
// Usage: node game/test/auth-client-probe.mjs
import { confirmAccount, currentPlayer, discoverAuth, refreshIfExpired, signIn, signOut, signUp } from '../src/net/auth.ts';
import { issueDrill } from '../src/net/api.ts';
import { SESSION_KEY, SESSION_SKEW_MS } from '../src/net/session.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A storage the probe owns, with the keys written and the keys removed. */
const storage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  const writes = [];
  const removals = [];
  return {
    map,
    writes,
    removals,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value);
      writes.push(key);
    },
    removeItem: (key) => {
      map.delete(key);
      removals.push(key);
    },
  };
};

/** A fetch scripted BY PATH, so a check does not depend on the order of unrelated calls. */
const fetching = (routes) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, path: new URL(url).pathname, body: init?.body ? JSON.parse(init.body) : null });
    const scripted = routes[new URL(url).pathname];
    // AN UNSCRIPTED PATH IS AN ERROR RATHER THAN A SILENT 404: a probe that forgot to script the request it is
    // asserting on would otherwise read a refusal it invented as the app's own behaviour.
    if (!scripted) throw new Error(`the probe did not script ${new URL(url).pathname}`);
    if (scripted instanceof Error) throw scripted;
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => {
        if (scripted.body === undefined) throw new SyntaxError('not json');
        return scripted.body;
      },
    };
  };
  return { calls, impl };
};

const wired = (routes, initial) => {
  const store = storage(initial);
  const fetch = fetching(routes);
  return {
    store,
    fetch,
    api: {
      base: 'http://127.0.0.1:8090',
      fetch: fetch.impl,
      getItem: store.getItem,
      setItem: store.setItem,
      removeItem: store.removeItem,
      timeoutMs: 1000,
    },
  };
};

const SESSION_BODY = (access, refresh, playerId = 'emu:1', seconds = 3600) => ({
  accessToken: access,
  refreshToken: refresh,
  playerId,
  email: 'eve@example.com',
  expiresInSeconds: seconds,
});
const NOW = 1_700_000_000_000;
const sessionItem = (store) => {
  const raw = store.map.get(SESSION_KEY);
  return raw === undefined ? null : JSON.parse(raw);
};

console.log('== 1. the mode is discovered from /health, and a pinned build does not ask ==');
{
  const health = { status: 200, body: { ok: true, store: 'memory', auth: { mode: 'emulate', signin: ['POST /auth/signup', 'POST /auth/signin'] } } };
  const wiredUp = wired({ '/health': health });
  const found = await discoverAuth(wiredUp.api);
  check(found.ok === true && found.value.mode === 'emulate', `the mode comes from the server (${found.value?.mode})`);
  check(found.value.signin.includes('POST /auth/signin'), `and so do the sign-in routes it actually serves (${found.value.signin.join(', ')})`);
  check(wiredUp.fetch.calls[0].path === '/health' && wiredUp.fetch.calls[0].init.method === 'GET', 'read as an anonymous GET, which is what /health is');

  // A PINNED BUILD MUST NOT BE TOLD A DIFFERENT MODE BY WHATEVER ANSWERS THE BASE URL, so the override is applied
  // BEFORE the call — measured as a fetch count, because "it did not ask" is otherwise invisible.
  const pinned = wired({ '/health': health }, undefined);
  pinned.api.modeOverride = 'dev';
  const overridden = await discoverAuth(pinned.api);
  check(overridden.ok === true && overridden.value.mode === 'dev', `VITE_AUTH_MODE wins (${overridden.value?.mode})`);
  check(pinned.fetch.calls.length === 0, `NEGATIVE CONTROL: and nothing was asked (fetch called ${pinned.fetch.calls.length} times)`);
  check(overridden.value.signin.length === 0, 'with no sign-in routes, because a pinned mode was not told any');

  const silent = wired({ '/health': { status: 200, body: { ok: true, store: 'memory' } } });
  const unnamed = await discoverAuth(silent.api);
  check(unnamed.ok === false && unnamed.failure.code === 'bad_response', `a server that does not name its mode is refused rather than assumed (${unnamed.failure?.code})`);
  const nonsense = wired({ '/health': { status: 200, body: { ok: true, auth: { mode: 'superuser', signin: [] } } } });
  const bad = await discoverAuth(nonsense.api);
  check(bad.ok === false && bad.failure.code === 'bad_response', `and so is a mode this build does not know (${bad.failure?.code})`);
}

console.log('\n== 2. signup, confirm, signin — and ONE stored session ==');
{
  const routes = {
    '/auth/signup': { status: 200, body: { ok: true, email: 'eve@example.com', playerId: 'emu:1', confirmed: false, confirmCode: '123456' } },
    '/auth/confirm': { status: 200, body: { ok: true, confirmed: true } },
    '/auth/signin': { status: 200, body: SESSION_BODY('access-1', 'refresh-1') },
  };
  const w = wired(routes);
  const created = await signUp('eve@example.com', 'correct horse', w.api);
  check(created.ok === true && created.value.confirmed === false && created.value.confirmCode === '123456', `signup returns the account and the code it printed (${created.value?.confirmCode})`);
  check(w.fetch.calls[0].init.method === 'POST' && w.fetch.calls[0].body.email === 'eve@example.com', 'posted to the endpoint with the address the player typed');

  const confirmed = await confirmAccount('eve@example.com', '123456', w.api);
  check(confirmed.ok === true && confirmed.value.confirmed === true, `the code confirms (${confirmed.value?.confirmed})`);

  const signed = await signIn('eve@example.com', 'correct horse', w.api, NOW);
  check(signed.ok === true && signed.value.playerId === 'emu:1' && signed.value.email === 'eve@example.com', `signing in reports who it is (${signed.value?.playerId})`);
  const stored = sessionItem(w.store);
  check(stored !== null && stored.accessToken === 'access-1' && stored.refreshToken === 'refresh-1' && stored.playerId === 'emu:1', 'and stores ONE session item, complete');
  // THE SKEW IS PINNED AS ARITHMETIC: an expiry written from the answer's `expiresInSeconds` minus the skew, so a
  // request is not sent with a token that dies in flight. A probe that only checked "a number" would pass a
  // client that treated the token as good for an hour past its death.
  check(stored.expiresAtMs === NOW + 3600 * 1000 - SESSION_SKEW_MS, `with the expiry moved back by the skew (${stored.expiresAtMs - NOW} ms from now)`);
  check(w.store.writes.length === 1 && w.store.writes[0] === SESSION_KEY, `and exactly one key was written (${w.store.writes.join(', ')})`);

  // A REFUSAL LEAVES STORAGE ALONE. The negative control is the check above: a successful sign-in writes, this one
  // must not — a client that wrote a session before checking the answer would "sign in" with nothing.
  const refused = wired({ '/auth/signin': { status: 401, body: { error: { code: 'bad_credentials', message: 'email or password is wrong' } } } });
  const denied = await signIn('eve@example.com', 'wrong horse', refused.api, NOW);
  check(denied.ok === false && denied.failure.code === 'bad_credentials' && denied.failure.message === 'email or password is wrong', 'a refusal arrives with the server’s own code and sentence');
  check(refused.store.map.size === 0, 'and nothing was written, so the app is not half signed in');

  const partial = wired({ '/auth/signin': { status: 200, body: { accessToken: 'access-1' } } });
  const unreadable = await signIn('eve@example.com', 'correct horse', partial.api, NOW);
  check(unreadable.ok === false && unreadable.failure.code === 'bad_response' && partial.store.map.size === 0, 'and a session this build cannot read is refused rather than half-stored');

  const nameless = wired({ '/auth/signup': { status: 200, body: { ok: true, email: 'eve@example.com', confirmed: true } } });
  const noId = await signUp('eve@example.com', 'correct horse', nameless.api);
  check(noId.ok === false && noId.failure.code === 'bad_response', `a signup without a player id is refused (${noId.failure?.code})`);
}

console.log('\n== 3. the stored token is what the NEXT api call sends ==');
{
  const signedIn = { [SESSION_KEY]: JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', playerId: 'emu:1', email: 'eve@example.com', expiresAtMs: NOW + 3600_000 }) };
  const w = wired({ '/drill/current': { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1, seed: 7, issuedAtMs: NOW, resumed: false }, regime: { finished: 0, length: 4 } } } }, signedIn);
  await issueDrill(1, w.api);
  const headers = w.fetch.calls[0].init.headers;
  check(headers.authorization === 'Bearer access-1', `a signed-in player's request carries the token (${headers.authorization})`);
  // THE NEGATIVE CONTROL IS THE ABSENCE: sending BOTH would let a server that prefers the header answer as one
  // player while the token says another, which is the confusion §11.1's A20 exists to remove.
  check(headers['x-dev-player'] === undefined, 'and NOT the device id, so there is one identity on the request and not two');
  check(currentPlayer(w.api)?.playerId === 'emu:1', 'and the app reports the signed-in player');

  const anonymous = wired({ '/drill/current': { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1, seed: 7, issuedAtMs: NOW, resumed: false }, regime: { finished: 0, length: 4 } } } });
  await issueDrill(1, anonymous.api);
  const anonHeaders = anonymous.fetch.calls[0].init.headers;
  // SIGNED OUT, AND A MODE THIS PROBE DID NOT LEARN: NO identity header at all. The device id is a `dev`-only
  // identity (`api.ts`'s `identityHeaders`), because a token mode refuses to advertise that header in CORS — a
  // browser showed what sending it costs: the preflight fails and the demo read the server DOES serve arrives as
  // `TypeError — the server could not be reached` (MEASURED at `http://localhost:8089`, `DSQ_AUTH=emulate`).
  check(anonHeaders['x-dev-player'] === undefined && anonHeaders.authorization === undefined, 'NEGATIVE CONTROL: signed out, the same call claims to be nobody rather than naming a device');
  check(anonymous.store.map.get('dsq.game.device') === undefined, 'and no device id was minted, because nothing needed one');
  check(currentPlayer(anonymous.api) === null, 'and the app reports nobody signed in');

  // THE `dev` PATH IS THE ONE THAT WANTS THE DEVICE ID — the mode whose server advertises the header — and it must
  // still mint exactly one, on first use.
  const dev = wired({ '/drill/current': { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1, seed: 7, issuedAtMs: NOW, resumed: false }, regime: { finished: 0, length: 4 } } } });
  dev.api.modeOverride = 'dev';
  await issueDrill(1, dev.api);
  const devHeaders = dev.fetch.calls[0].init.headers;
  check(typeof devHeaders['x-dev-player'] === 'string', `under dev the device id names the player (${devHeaders['x-dev-player']})`);
  check(dev.store.map.get('dsq.game.device') === devHeaders['x-dev-player'], 'and it was minted into storage on first use');
}

console.log('\n== 4. the refresh happens on the CLOCK, once, and a dead session is dropped ==');
{
  const session = (expiresAtMs, access = 'access-1', refresh = 'refresh-1') => ({
    [SESSION_KEY]: JSON.stringify({ accessToken: access, refreshToken: refresh, playerId: 'emu:1', email: 'eve@example.com', expiresAtMs }),
  });
  const routes = {
    '/auth/refresh': { status: 200, body: SESSION_BODY('access-2', 'refresh-2') },
    '/drill/current': { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1, seed: 7, issuedAtMs: NOW, resumed: false }, regime: { finished: 0, length: 4 } } },
  };

  const fresh = wired(routes, session(NOW + 60_000));
  const untouched = await refreshIfExpired(fresh.api, NOW);
  check(untouched.kind === 'still_fresh', `a live session is used as it is (${untouched.kind})`);
  // MEASURED, AND THIS IS THE CHECK THAT MATTERS: a refresh token is good once, so a client that refreshed when
  // it did not need to would end its own session. The count is the only way to see it from outside.
  check(fresh.fetch.calls.length === 0, `NEGATIVE CONTROL: and the server was NOT asked (${fresh.fetch.calls.length} fetches)`);
  check(sessionItem(fresh.store).accessToken === 'access-1', 'with the stored token untouched');

  const stale = wired(routes, session(NOW - 1));
  const refreshed = await refreshIfExpired(stale.api, NOW);
  check(refreshed.kind === 'refreshed' && refreshed.session.accessToken === 'access-2', `an expired one is refreshed (${refreshed.kind}, ${refreshed.session?.accessToken})`);
  check(stale.fetch.calls.length === 1 && stale.fetch.calls[0].path === '/auth/refresh', 'with exactly one call, to the refresh endpoint');
  check(stale.fetch.calls[0].body.refreshToken === 'refresh-1', 'carrying the refresh token that was stored');
  check(sessionItem(stale.store).refreshToken === 'refresh-2', 'and the ROTATED token replaces it, so the next refresh uses the new one');
  await issueDrill(1, stale.api);
  check(stale.fetch.calls[1].init.headers.authorization === 'Bearer access-2', `and the next api call uses the NEW access token (${stale.fetch.calls[1].init.headers.authorization})`);

  const empty = wired(routes);
  check((await refreshIfExpired(empty.api, NOW)).kind === 'no_session' && empty.fetch.calls.length === 0, 'with no session, nothing is asked and the answer says so');

  // A REFUSED REFRESH ENDS THE SESSION, LOCALLY TOO. Leaving the dead token in storage is the failure this check
  // exists for: every later request would be answered 401 for a reason the player cannot see, and the UI would
  // keep showing them as signed in.
  const dead = wired({ '/auth/refresh': { status: 401, body: { error: { code: 'bad_refresh_token', message: 'that refresh token is no longer live' } } } }, session(NOW - 1));
  const ended = await refreshIfExpired(dead.api, NOW);
  check(ended.kind === 'signed_out', `a refresh the server refuses signs the player out (${ended.kind})`);
  check(dead.store.map.has(SESSION_KEY) === false, 'and the dead session is GONE from storage');
  check(currentPlayer(dead.api) === null, 'so the app stops reporting them as signed in');

  const corrupt = wired(routes, { [SESSION_KEY]: '{"accessToken":"access-1"}' });
  check((await refreshIfExpired(corrupt.api, NOW)).kind === 'no_session', 'and a session this build cannot read is not a session');
  check(corrupt.fetch.calls.length === 0, 'so it is not sent anywhere either');
}

console.log('\n== 5. signing out is LOCAL-FIRST ==');
{
  const session = { [SESSION_KEY]: JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', playerId: 'emu:1', email: 'eve@example.com', expiresAtMs: NOW + 3600_000 }) };
  const good = wired({ '/auth/signout': { status: 200, body: { ok: true, revoked: true } } }, session);
  const out = await signOut(good.api);
  check(out.ok === true && out.value.revoked === true, `the server revoked the session (${JSON.stringify(out.value)})`);
  check(good.fetch.calls[0].body.refreshToken === 'refresh-1', 'having been given the refresh token to revoke');
  check(good.store.map.has(SESSION_KEY) === false, 'and the local session is gone');

  // THE SERVER CANNOT BE REACHED, AND THE PLAYER IS STILL SIGNED OUT HERE. This is the check that keeps a shared
  // machine shared: the alternative — "the network was down, so you are still signed in" — is what this prevents.
  const broken = wired({ '/auth/signout': { status: 500, body: { error: { code: 'internal', message: 'nope' } } } }, session);
  const reported = await signOut(broken.api);
  check(reported.ok === false && broken.store.map.has(SESSION_KEY) === false, `a failed revocation still clears the local session (${reported.failure?.code})`);
  const offline = wired({ '/auth/signout': new Error('network down') }, session);
  const unreachable = await signOut(offline.api);
  check(unreachable.ok === false && unreachable.failure.code === 'unreachable' && offline.store.map.has(SESSION_KEY) === false, `and an unreachable server does too (${unreachable.failure?.code})`);

  const nothing = wired({});
  const idle = await signOut(nothing.api);
  check(idle.ok === true && idle.value.revoked === false && nothing.fetch.calls.length === 0, 'signing out with no session is a no-op rather than a request');
  check(nothing.store.removals.length === 1, 'which still clears storage, because clearing what is not there is the state the caller wanted');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
