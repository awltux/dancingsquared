// THE IDENTITY RULES, pinned: what a token proves, what a header does NOT, and what a signed-out caller gets.
//
// WHY THIS IS A GATE. DESIGN.md §11.1's A20 and §11.2 are the security boundary of this API — "every write needs a
// verified subject, and a header is never an identity" — and AGENTS.md §6 says to prove it by TRYING TO LIE rather
// than by reading the code. So every check here is an attempt:
//
//   * a token signed with the wrong key, an expired one, one with the wrong issuer or audience, and an unsigned
//     one (`alg: none`) are all refused — each with the SAME token accepted as its own negative control, because a
//     verifier that refused everything would pass the forged cases;
//   * `x-dev-player: <the signed-in player>` in a token mode is refused on a write. MEASURED, this is the bug the
//     whole change exists for: the dev adapter once returned `dev:<name>` for exactly that header IN EVERY MODE, so
//     possession of a header was possession of an account (AGENTS.md §8 trap 23);
//   * an anonymous READ writes nothing at all — no Progress row, no attempt row — and the instrument that says so
//     is measured on an identified read, which DOES write, so "no writes" is a measurement rather than a blind
//     spot.
//
// THE VERIFIER IS THE DEPLOYMENT'S. Both key sources run through `verifyToken`: the emulator's HMAC secret and an
// RSA JWKS generated in this file, which is the shape Cognito's pool publishes. That is what makes "test the
// sign-in flow with the emulator, not by trusting a header" (§6) a measurable claim: the emulator's token is
// checked by the same function that checks a Cognito-shaped one.
//
// Usage: node api/test/auth-probe.mjs
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { createEmulator, EMULATOR_AUDIENCE, EMULATOR_ISSUER } from '../src/auth/emulator.ts';
import { devIdentityOf, tokenIdentityOf } from '../src/auth/identity.ts';
import { hmacKeys, hmacSignature, jwksKeys, verifyToken } from '../src/auth/verify.ts';
import { authRefusal, configFromEnv } from '../src/config.ts';
import { startDevServer } from '../src/dev-server.ts';
import { progressKey } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { utcDay } from 'dancing-squared-game';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const CLOCK = 1_700_000_000_000;
const LEVEL = 1;

/** A mutable clock, because one of these checks is about EXPIRY and cannot be made with a frozen one. */
const clockFrom = (nowMs = CLOCK) => ({
  now: nowMs,
  nowMs() {
    return this.now;
  },
  advance(seconds) {
    this.now += seconds * 1000;
  },
});

/** A POST to one of the emulator's routes, in the shape the adapter hands its handlers. */
const post = (path, body, headers = {}) => ({ method: 'POST', path, query: {}, body, headers });

/** A store that counts the writes that reach it, so "nothing was written" is measured rather than assumed. */
function spy(inner) {
  const state = { puts: 0, transactions: 0, writes: 0 };
  return {
    state,
    store: {
      get: (key) => inner.get(key),
      put: async (key, value, expectedRev) => {
        state.puts++;
        const written = await inner.put(key, value, expectedRev);
        if (written) state.writes++;
        return written;
      },
      transact: async (writes) => {
        state.transactions++;
        const written = await inner.transact(writes);
        if (written) state.writes += writes.length;
        return written;
      },
      size: inner.size,
    },
  };
}

// =============================================================================================================
console.log('== 1. a token is verified, and only a real one ==');
{
  // AN RSA PAIR, because that is the algorithm a pool publishes and the one this file cannot fake with HMAC. The
  // public half is exported as a JWK with a `kid`, which is exactly what a JWKS document holds.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks = { keys: [publicJwk] };
  const nowMs = () => CLOCK;
  const verifier = (token) => verifyToken(token, { issuer: 'https://pool.example', audience: 'client-1', keys: jwksKeys(jwks), nowMs });

  const claims = {
    sub: 'cognito-sub-1',
    iss: 'https://pool.example',
    aud: 'client-1',
    exp: Math.floor(CLOCK / 1000) + 3600,
    token_use: 'access',
  };
  const sign = (body, header = { alg: 'RS256', kid: 'k1' }, key = privateKey) => {
    const head = b64(header);
    const payload = b64(body);
    return `${head}.${payload}.${rsaSign('RSA-SHA256', Buffer.from(`${head}.${payload}`), key).toString('base64url')}`;
  };

  const good = sign(claims);
  check(verifier(good)?.sub === 'cognito-sub-1', 'a token from the pool key verifies and names its subject');

  // EVERY REFUSAL BELOW IS MEASURED AGAINST `good`, WHICH THE SAME CALL ACCEPTS. A verifier that answered null to
  // everything would pass every "refused" check in this section and is ruled out by the line above.
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  check(verifier(sign(claims, { alg: 'RS256', kid: 'k1' }, other.privateKey)) === null, 'NEGATIVE CONTROL: a token signed by ANOTHER key is refused (possession of a plausible token is not identity)');
  check(verifier(sign(claims, { alg: 'RS256', kid: 'k2' })) === null, 'and one whose `kid` names a key the pool does not have is refused');
  check(verifier(sign({ ...claims, exp: Math.floor(CLOCK / 1000) - 1 })) === null, 'and an EXPIRED token is refused');
  check(verifier(sign({ ...claims, iss: 'https://evil.example' })) === null, 'and one from another issuer is refused');
  check(verifier(sign({ ...claims, aud: 'another-client' })) === null, 'and one minted for another audience is refused');
  check(verifier(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`) === null, 'and an UNSIGNED token (`alg: none`) is refused — no key source offers a key for it');
  // THE PAYLOAD IS SIGNED, NOT MERELY CARRIED: swapping in a different subject invalidates the signature.
  const [head, , signature] = good.split('.');
  check(verifier(`${head}.${b64({ ...claims, sub: 'someone-else' })}.${signature}`) === null, 'and a tampered `sub` under a valid signature is refused');

  // THE ACCESS TOKEN SPELLING: Cognito's access tokens carry `client_id` where an ID token carries `aud`, so the
  // verifier accepts either. Untestable against real Cognito here — this pins only the rule the verifier applies.
  const { aud, ...withoutAud } = claims;
  check(verifier(sign({ ...withoutAud, client_id: 'client-1' }))?.sub === 'cognito-sub-1', 'and `client_id` is accepted where `aud` is, which is the access-token spelling');
}

// =============================================================================================================
console.log('\n== 2. the emulator: accounts, codes, sessions and expiry ==');
{
  const store = new MemoryStore();
  const clock = clockFrom();
  const announced = [];
  const emulator = createEmulator({
    store,
    clock,
    secret: Buffer.from('probe-secret-not-a-real-one', 'utf8'),
    requireConfirmation: true,
    announce: (message) => announced.push(message),
  });
  const signup = await emulator.handle(post('/auth/signup', { email: 'Alice@Example.com', password: 'correct horse' }));
  check(signup.status === 200 && signup.body.confirmed === false, `signup creates an unconfirmed account (${signup.status})`);
  const code = signup.body.confirmCode;
  check(typeof code === 'string' && code.length === 6, `and returns the confirmation code, because there is no mail sender (${code})`);
  check(announced.some((line) => line.includes(code)), 'and announces it too, for a developer watching the console');

  // THE PASSWORD IS NOT RECOVERABLE FROM THE ROW, and the negative control is the check's own shape: it searches
  // the stored JSON for the plaintext it was given.
  const account = await store.get({ pk: 'auth#alice@example.com', sk: 'account' });
  check(account !== null, 'the account is one item in the same store the game writes, keyed by the normalised email');
  check(account && account.value.email === 'alice@example.com', 'so a sign-up in mixed case lands on the lower-case handle');
  check(account && typeof account.value.salt === 'string' && typeof account.value.hash === 'string', 'with a salt and a hash');
  check(account && !JSON.stringify(account.value).includes('correct horse'), 'NEGATIVE CONTROL: and NOT the password itself (its absence is searched for, not assumed)');
  check(account && account.value.playerId.startsWith('emu:'), `and a player id in the emulator's own namespace (${account.value.playerId})`);

  const wrongCode = await emulator.handle(post('/auth/confirm', { email: 'alice@example.com', code: '000000' }));
  check(wrongCode.status === 401 && wrongCode.body.error.code === 'bad_code', `a wrong confirmation code is refused (${wrongCode.status} ${wrongCode.body.error?.code})`);
  const early = await emulator.handle(post('/auth/signin', { email: 'alice@example.com', password: 'correct horse' }));
  check(early.status === 403 && early.body.error.code === 'unconfirmed', `and signing in before confirming is refused (${early.status} ${early.body.error?.code})`);

  const confirmed = await emulator.handle(post('/auth/confirm', { email: 'Alice@example.com', code }));
  check(confirmed.status === 200 && confirmed.body.confirmed === true, `the right code confirms (${confirmed.status})`);

  const wrongPassword = await emulator.handle(post('/auth/signin', { email: 'alice@example.com', password: 'wrong horse' }));
  const noSuchAccount = await emulator.handle(post('/auth/signin', { email: 'nobody@example.com', password: 'wrong horse' }));
  check(wrongPassword.status === 401 && noSuchAccount.status === 401, 'a wrong password and an unknown address are both 401');
  // ONE CODE FOR BOTH, which is the check that matters: differing codes (or messages) turn sign-in into a way to
  // discover which addresses have accounts.
  check(wrongPassword.body.error.code === noSuchAccount.body.error.code && wrongPassword.body.error.code === 'bad_credentials', `with the SAME code, so the answer is not an oracle (${wrongPassword.body.error.code})`);

  const signin = await emulator.handle(post('/auth/signin', { email: 'alice@example.com', password: 'correct horse' }));
  check(signin.status === 200 && typeof signin.body.accessToken === 'string', `signing in issues an access token (${signin.status})`);
  check(signin.body.playerId === account?.value.playerId, 'for the account the signup created, not a new one');
  check(emulator.verify(signin.body.accessToken)?.sub === account?.value.playerId, 'and the token VERIFIES, through the same verifier the deployment uses');
  check(emulator.verify(`${signin.body.accessToken}x`) === null, 'NEGATIVE CONTROL: with a byte appended it does not');

  // A TOKEN SIGNED WITH A DIFFERENT SECRET IS NOT A SESSION, even with identical claims: the signature is the
  // whole of the proof, and this is the check that says a guest cannot mint one for themselves.
  const [head, payload] = signin.body.accessToken.split('.');
  const forged = Buffer.from('someone-elses-secret', 'utf8');
  const forgedToken = `${head}.${payload}.${hmacSignature(forged, `${head}.${payload}`).toString('base64url')}`;
  check(emulator.verify(forgedToken) === null, 'and a token signed with ANOTHER secret is refused, though its claims are identical');

  // EXPIRY, MEASURED BY MOVING THE CLOCK. One hour is the emulator's access-token life.
  const fresh = emulator.verify(signin.body.accessToken);
  clock.advance(3599);
  check(emulator.verify(signin.body.accessToken) !== null, 'the token is still good one second before its expiry');
  clock.advance(2);
  check(emulator.verify(signin.body.accessToken) === null, `and refused one second after it (${fresh?.expiresAtSeconds - Math.floor(clock.now / 1000)}s)`);

  // ROTATION: the refresh token works once. This is the session-revocation story, measured.
  const refreshed = await emulator.handle(post('/auth/refresh', { refreshToken: signin.body.refreshToken }));
  check(refreshed.status === 200 && refreshed.body.refreshToken !== signin.body.refreshToken, `refreshing issues a NEW refresh token (${refreshed.status})`);
  const replayed = await emulator.handle(post('/auth/refresh', { refreshToken: signin.body.refreshToken }));
  check(replayed.status === 401 && replayed.body.error.code === 'bad_refresh_token', `and the OLD one is refused afterwards (${replayed.status} ${replayed.body.error?.code}) — a stolen token is good once`);
  check(emulator.verify(refreshed.body.accessToken)?.sub === account?.value.playerId, 'and the refreshed access token verifies');

  const out = await emulator.handle(post('/auth/signout', { refreshToken: refreshed.body.refreshToken }));
  check(out.status === 200 && out.body.revoked === true, `signing out revokes the live token (${JSON.stringify(out.body)})`);
  const afterOut = await emulator.handle(post('/auth/refresh', { refreshToken: refreshed.body.refreshToken }));
  check(afterOut.status === 401, `and it cannot be refreshed afterwards (${afterOut.status})`);
  const twice = await emulator.handle(post('/auth/signout', { refreshToken: refreshed.body.refreshToken }));
  check(twice.status === 200 && twice.body.revoked === false, 'and signing out twice is not an error — it is idempotent');

  const taken = await emulator.handle(post('/auth/signup', { email: 'alice@example.com', password: 'another one' }));
  check(taken.status === 409 && taken.body.error.code === 'email_taken', `signing up twice is a 409 (${taken.status} ${taken.body.error?.code})`);

  // THE SHORTEST PATH IS ONE CALL when confirmation is off, which is the default the dev server uses.
  const openStore = new MemoryStore();
  const open = createEmulator({ store: openStore, clock: clockFrom(), secret: Buffer.from('another-probe-secret'), requireConfirmation: false });
  const instant = await open.handle(post('/auth/signup', { email: 'bob@example.com', password: 'correct horse' }));
  check(instant.status === 200 && instant.body.confirmed === true && instant.body.confirmCode === null, 'and with confirmation off, signup is usable immediately — no code, one call');
  check((await open.handle(post('/auth/signin', { email: 'bob@example.com', password: 'correct horse' }))).status === 200, 'so a sign-in follows straight after it');

  const weak = await open.handle(post('/auth/signup', { email: 'bob@example.com', password: 'short' }));
  check(weak.status === 400 && weak.body.error.code === 'bad_password', `and a password under the minimum length is refused (${weak.status} ${weak.body.error?.code})`);
  const badEmail = await open.handle(post('/auth/signup', { email: 'not-an-address', password: 'correct horse' }));
  check(badEmail.status === 400 && badEmail.body.error.code === 'bad_email', `and a malformed email is refused (${badEmail.body.error?.code})`);
  check((await open.handle(post('/auth/anything', {}))) === null, 'and a path the emulator does not serve answers null, so the adapter can 404 it rather than inventing a route');
}

// =============================================================================================================
console.log('\n== 3. the modes are not interchangeable: in a token mode a header names NOBODY ==');
{
  // CONFIRMATION IS REQUIRED HERE, because that is Cognito's own default and the flow a real sign-up takes: the
  // one-call shortcut is the dev server's default and is pinned in section 2 instead.
  const server = await startDevServer({ port: 0, auth: 'emulate', seed: true, requireConfirmation: true });
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, options);
    return { status: response.status, body: await response.json() };
  };
  const json = (headers) => ({ 'content-type': 'application/json', ...headers });
  try {
    const health = await call('/health');
    check(health.body.auth?.mode === 'emulate', `health names the mode the process built (${health.body.auth?.mode})`);
    check(health.body.auth.signin.includes('POST /auth/signin'), 'and the emulator\'s routes, separately from the API\'s own endpoints');
    check(!health.body.endpoints.includes('POST /auth/signin'), 'so the count of DESIGN.md 11 endpoints is not inflated by them');

    const signed = await call('/auth/signup', { method: 'POST', headers: json(), body: JSON.stringify({ email: 'eve@example.com', password: 'correct horse' }) });
    check(signed.body.confirmed === false, `signup leaves the account unconfirmed when the mode says so (${signed.status})`);
    const unconfirmed = await call('/auth/signin', { method: 'POST', headers: json(), body: JSON.stringify({ email: 'eve@example.com', password: 'correct horse' }) });
    check(unconfirmed.status === 403 && unconfirmed.body.error.code === 'unconfirmed', `and signing in before confirming is a 403 (${unconfirmed.status} ${unconfirmed.body.error?.code})`);
    const confirmed = await call('/auth/confirm', { method: 'POST', headers: json(), body: JSON.stringify({ email: 'eve@example.com', code: signed.body.confirmCode }) });
    check(confirmed.status === 200, `the confirmed code lands (${confirmed.status})`);
    const session = await call('/auth/signin', { method: 'POST', headers: json(), body: JSON.stringify({ email: 'eve@example.com', password: 'correct horse' }) });
    check(session.status === 200, `a sign-in over HTTP works with no provider (${session.status})`);
    const token = session.body.accessToken;
    const playerId = session.body.playerId;

    const read = await call(`/drill/current?level=${LEVEL}`, { headers: { authorization: `Bearer ${token}` } });
    check(read.status === 200 && read.body.demo === undefined, `and the token serves a STORED drill (${read.status})`);
    check((await server.store.get(progressKey(playerId, LEVEL)))?.value.issued.id === read.body.drill.id, 'keyed on the token\'s `sub`, which is the Progress row the design names');
    const advanced = await call('/drill/advance', { method: 'POST', headers: json({ authorization: `Bearer ${token}` }), body: JSON.stringify({ drillId: read.body.drill.id }) });
    check(advanced.status === 200, `so a write with the token lands (${advanced.status})`);

    // THE CHECK THIS WHOLE FILE EXISTS FOR. The header below is exactly what the `dev` mode trusts, naming a
    // player that exists — and in this mode it is simply not an identity.
    const headerWrite = await call('/drill/advance', { method: 'POST', headers: json({ 'x-dev-player': 'eve@example.com' }), body: JSON.stringify({ drillId: read.body.drill.id }) });
    check(headerWrite.status === 401, `and the SAME write with x-dev-player instead of a token is a 401 (${headerWrite.status} ${headerWrite.body.error?.code ?? ''})`);
    const headerRead = await call(`/drill/current?level=${LEVEL}`, { headers: { 'x-dev-player': 'eve@example.com' } });
    check(headerRead.body.demo === true, 'and a read with that header is the ANONYMOUS demo, so the header did not resolve to that player');
    check(headerRead.body.drill.id === read.body.drill.id, 'NEGATIVE CONTROL: it is nevertheless the same drill, because the demo serves the unchanged regime rather than an error');

    const forgedHeader = await call('/drill/advance', { method: 'POST', headers: json({ authorization: 'Bearer dev:eve@example.com' }), body: JSON.stringify({ drillId: read.body.drill.id }) });
    check(forgedHeader.status === 401, `and the dev adapter's OTHER spelling (Bearer dev:<name>) is a 401 too (${forgedHeader.status})`);
  } finally {
    await server.close();
  }
}

// =============================================================================================================
console.log('\n== 4. in `dev` mode the emulator is not there at all ==');
{
  const server = await startDevServer({ port: 0, auth: 'dev' });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    check(health.auth.mode === 'dev' && health.auth.signin.length === 0, `health says dev and names no sign-in routes (${JSON.stringify(health.auth.signin)})`);
    const signup = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'anyone@example.com', password: 'correct horse' }),
    });
    check(signup.status === 404, `and /auth/signup is unrouted, exactly as any unknown path is (${signup.status})`);
    // AND THE ALLOWED HEADERS FOLLOW THE MODE: a token mode must not advertise a header that no longer means
    // anything, or a client keeps sending it.
    const preflight = await fetch(`${base}/drill/current`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8089', 'access-control-request-headers': 'x-dev-player' } });
    check((preflight.headers.get('access-control-allow-headers') ?? '').includes('x-dev-player'), `while dev still allows the header a browser test needs (${preflight.headers.get('access-control-allow-headers')})`);
  } finally {
    await server.close();
  }

  const tokenMode = await startDevServer({ port: 0, auth: 'emulate' });
  try {
    const preflight = await fetch(`http://127.0.0.1:${tokenMode.port}/drill/current`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8089', 'access-control-request-headers': 'x-dev-player' } });
    check(!(preflight.headers.get('access-control-allow-headers') ?? '').includes('x-dev-player'), `NEGATIVE CONTROL: and a token mode does NOT advertise it (${preflight.headers.get('access-control-allow-headers')})`);
  } finally {
    await tokenMode.close();
  }
}

// =============================================================================================================
console.log('\n== 5. a signed-out read writes NOTHING ==');
{
  const inner = new MemoryStore();
  const counted = spy(inner);
  const server = await startDevServer({ port: 0, auth: 'dev', opened: { store: counted.store, label: 'spy' } });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const before = { writes: counted.state.writes, size: inner.size };
    // TODAY, because the dev server publishes today's challenge at boot; a fixed date would 404 and "wrote
    // nothing" would then be a statement about a refused request rather than about a served one.
    const today = utcDay(new Date());
    const drill = await fetch(`${base}/drill/current?level=${LEVEL}`);
    const puzzle = await fetch(`${base}/puzzle?mode=daily&level=${LEVEL}&date=${today}`);
    check(drill.status === 200 && puzzle.status === 200, `both reads are served anonymously (drill ${drill.status}, puzzle ${puzzle.status}, ${today})`);
    const drillBody = await drill.json();
    check(drillBody.demo === true, 'and the drill says it is a demo, which is what the client marks the run unranked with');
    check(counted.state.writes === before.writes && inner.size === before.size, `and neither wrote anything (${counted.state.writes - before.writes} writes, size ${before.size} -> ${inner.size})`);

    // THE INSTRUMENT IS MEASURED, which is the point of the whole section: the same server, the same reads, with
    // an identity — and now the writes appear. An instrument that saw no writes either way would prove nothing.
    const first = await fetch(`${base}/drill/current?level=${LEVEL}`, { headers: { 'x-dev-player': 'someone' } });
    check(first.status === 200 && counted.state.writes > before.writes, `NEGATIVE CONTROL: an IDENTIFIED read does write, so the count above is a measurement (${counted.state.writes - before.writes} writes)`);
  } finally {
    await server.close();
  }
}

// =============================================================================================================
console.log('\n== 6. the configuration refuses the modes that must not ship ==');
{
  const production = configFromEnv({ DSQ_AUTH: 'dev', DSQ_ENV: 'production' });
  check(configFromEnv({ DSQ_AUTH: 'dev' }).auth === 'dev' && authRefusal(configFromEnv({ DSQ_AUTH: 'dev' })) === null, 'a plain local run in dev mode is allowed (that is the requirement that produced the emulator)');
  check(production.auth === 'dev' && production.environment === 'production', 'and the same mode with DSQ_ENV=production is read as production');
  check(authRefusal(production) !== null, `where it is REFUSED, not warned about (${authRefusal(production)?.slice(0, 60)}…)`);

  const realAws = configFromEnv({ DSQ_AUTH: 'dev', DSQ_STORE: 'dynamodb' });
  check(authRefusal(realAws) !== null, 'and refused against the real AWS service with no endpoint, for the same reason trap 21 gives');
  check(authRefusal(configFromEnv({ DSQ_AUTH: 'dev', DSQ_STORE: 'dynamodb', DSQ_DDB_ENDPOINT: 'http://127.0.0.1:8000' })) === null, 'NEGATIVE CONTROL: while DynamoDB Local is fine, because the store is local rather than the identity');

  const noPool = configFromEnv({ DSQ_AUTH: 'cognito' });
  check(authRefusal(noPool) !== null, `cognito mode without a pool is refused, not started (${authRefusal(noPool)?.slice(0, 60)}…)`);
  check(authRefusal(configFromEnv({ DSQ_AUTH: 'cognito', DSQ_COGNITO_ISSUER: 'https://pool.example', DSQ_COGNITO_AUDIENCE: 'client-1' })) === null, 'and allowed once the issuer and audience are named');
  check(authRefusal(configFromEnv({ DSQ_AUTH: 'emulate' })) === null, 'and emulate needs no configuration at all, which is the whole point of it');

  check(configFromEnv({ DSQ_AUTH_CONFIRM: '1' }).confirmAccounts === true && configFromEnv({}).confirmAccounts === false, 'and confirmation is on only when asked for — by default signup is usable in one call');
}

// =============================================================================================================
console.log('\n== 7. the two adapters, side by side ==');
{
  const secret = Buffer.from('an-identity-probe-secret', 'utf8');
  const emulator = createEmulator({ store: new MemoryStore(), clock: clockFrom(), secret, requireConfirmation: false });
  const asToken = tokenIdentityOf({ source: 'emulator', verify: emulator.verify });
  const signin = await emulator.handle(post('/auth/signup', { email: 'carol@example.com', password: 'correct horse' }));
  const token = (await emulator.handle(post('/auth/signin', { email: 'carol@example.com', password: 'correct horse' }))).body.accessToken;

  const dev = devIdentityOf({ headers: { 'x-dev-player': 'carol@example.com' }, method: 'GET', path: '/', query: {}, body: null });
  check(dev?.source === 'dev' && dev.playerId === 'dev:carol@example.com', `the dev adapter reports its source and prefixes the id (${dev?.playerId})`);
  const tokenised = asToken({ headers: { authorization: `Bearer ${token}` }, method: 'GET', path: '/', query: {}, body: null });
  check(tokenised?.source === 'emulator' && tokenised.playerId === signin.body.playerId, `and the token adapter reports ITS source and the token's own subject (${tokenised?.playerId}, ${tokenised?.source})`);
  check(tokenised?.playerId !== dev?.playerId, 'THE TWO NAMESPACES CANNOT COLLIDE, so a development row can never be a signed-in player\'s row');
  check(asToken({ headers: { 'x-dev-player': 'carol@example.com' }, method: 'GET', path: '/', query: {}, body: null }) === null, 'and the token adapter reads NO header: this exact request is the one the dev adapter accepts');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
