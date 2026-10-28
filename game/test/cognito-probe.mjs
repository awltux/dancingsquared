// THE COGNITO PROVIDER'S WIRE SHAPE, PINNED — because "compatible with the AWS Cognito API" is a claim about the request
// bodies and the error names, and none of that is visible from the UI.
//
// REPORTED: "account management must be compatible with the AWS Cognito API." The client had one provider — the local API's
// `/auth/*` routes, which only the emulator serves — so this probe exists to pin the second one: with a pool configured,
// every account operation must go to the pool's endpoint with the pool's operation name, its field names, and its errors
// mapped to the sentences the UI shows.
//
// WHAT IS PINNED, and each check has a failure it is aimed at:
//   1. THE ENDPOINT AND THE OPERATION HEADER. `https://cognito-idp.<region>.amazonaws.com/` and
//      `x-amz-target: AWSCognitoIdentityProviderService.<Operation>`. A wrong host or a wrong target is a `400` from AWS that
//      reads like a bad password to a player.
//   2. THE FIELD NAMES ARE THE PROVIDER'S (`Username`, `Password`, `ConfirmationCode`, `AuthParameters.USERNAME`,
//      `PreviousPassword`, `ProposedPassword`, `AccessToken`) — the emulator's own names (`email`, `currentPassword`) are
//      NOT sent, and the negative control below proves that substituting them is caught.
//   3. THE ERROR NAMES: `NotAuthorizedException` is a bad password, `UserNotConfirmedException` is an unconfirmed account (a
//      different sentence and a different next step), `UsernameExistsException` is a taken address, `InvalidPasswordException`
//      is the pool's policy. A mapping that collapsed them all into "refused" would pass a test that only checks `ok:false`.
//   4. THE SESSION SHAPE: `AuthenticationResult`'s `AccessToken`/`IdToken`/`ExpiresIn` become the store's lowercase fields, and
//      the player's id and address come from the ID token's claims (`sub`, `email`). A refresh answers with NO new refresh
//      token, so the one held is carried through.
//   5. THE DISPATCH: a build with a pool sends the account calls to the pool and never to `/auth/*`; a build without one still
//      uses the API's routes. Both are measured by counting the fetches, which is the only way the difference shows.
//
// Usage: node game/test/cognito-probe.mjs   (pure: a fake fetch, no network, no DOM, no engine)
import { COGNITO_ROUTES, claimsOf, cognitoCall, cognitoConfigFrom, sessionShapeOf } from '../src/net/cognito.ts';
import { discoverAuth, signIn, signUp } from '../src/net/auth.ts';

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

const POOL = { region: 'eu-west-2', clientId: 'abc123client' };
const DEPS = (respond = () => ({ status: 200, body: {} })) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const answer = await respond(url, init, calls.length);
    return {
      ok: answer.status < 400,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  return {
    deps: {
      base: 'http://127.0.0.1:8090',
      fetch,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      timeoutMs: 1000,
      cognito: POOL,
    },
    calls,
  };
};
/** A JWT-shaped token whose payload is `claims` — unsigned, because nothing here verifies (the API does). */
const tokenWith = (claims) => `h.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.s`;
const authResult = (over = {}) => ({
  AccessToken: 'access-token',
  IdToken: tokenWith({ sub: 'emu-sub-1', email: 'ada@example.com', token_use: 'id' }),
  RefreshToken: 'refresh-token',
  ExpiresIn: 3600,
  TokenType: 'Bearer',
  ...over,
});

console.log('\n== 1. the endpoint, the operation header and the content type ==');
{
  const { deps, calls } = DEPS(() => ({ status: 200, body: { UserSub: 'sub-1', UserConfirmed: false } }));
  await cognitoCall(deps, POOL, 'POST /auth/signup', { ClientId: POOL.clientId, Username: 'ada@example.com', Password: 'Sup3rSecret!1' });
  const call = calls[0];
  check(call.url === 'https://cognito-idp.eu-west-2.amazonaws.com/', `the request goes to the pool's endpoint (${call.url})`);
  check(call.init.headers['x-amz-target'] === 'AWSCognitoIdentityProviderService.SignUp',
    `and names the operation in the header (${call.init.headers['x-amz-target']})`);
  check(call.init.headers['content-type'] === 'application/x-amz-json-1.1', 'with the JSON 1.1 content type the service speaks');
  check(call.init.method === 'POST', 'and it is a POST');
  // THE REGION IS IN THE HOST, so a config with a different region must move the URL — the negative control for reading the
  // region but not using it.
  const other = DEPS(() => ({ status: 200, body: {} }));
  await cognitoCall(other.deps, { region: 'us-east-1', clientId: 'x' }, 'POST /auth/signup', {});
  check(other.calls[0].url === 'https://cognito-idp.us-east-1.amazonaws.com/', `a different region is a different host (${other.calls[0].url})`);
}

console.log('\n== 2. the field names are the provider\'s, for every operation ==');
{
  const bodyOf = async (route, body) => {
    const { deps, calls } = DEPS((url, init) => {
      const target = init.headers['x-amz-target'];
      if (target.endsWith('InitiateAuth')) return { status: 200, body: { AuthenticationResult: authResult() } };
      if (target.endsWith('SignUp')) return { status: 200, body: { UserSub: 'sub-1', UserConfirmed: true } };
      return { status: 200, body: {} };
    });
    const answer = await (route === 'POST /auth/signup'
      ? signUp('ada@example.com', 'Sup3rSecret!1', { ...deps, cognito: POOL })
      : cognitoCall(deps, POOL, route, body));
    return { answer, sent: calls[0]?.init.body, target: calls[0]?.init.headers['x-amz-target'] };
  };
  const signup = await bodyOf('POST /auth/signup', {});
  check(signup.answer.ok === true && JSON.parse(signup.sent).Username === 'ada@example.com',
    'SignUp sends Username, not email');
  check(JSON.parse(signup.sent).ClientId === POOL.clientId, 'and the app client id');
  check(!('email' in JSON.parse(signup.sent)) && !('playerId' in JSON.parse(signup.sent)),
    'and nothing named the way the local API names it');

  const confirm = await bodyOf('POST /auth/confirm', { ClientId: POOL.clientId, Username: 'ada@example.com', ConfirmationCode: '123456' });
  check(JSON.parse(confirm.sent).ConfirmationCode === '123456' && confirm.target.endsWith('ConfirmSignUp'),
    'ConfirmSignUp sends ConfirmationCode');

  const change = await bodyOf('POST /auth/password', { AccessToken: 'a', PreviousPassword: 'old', ProposedPassword: 'new' });
  check(JSON.parse(change.sent).PreviousPassword === 'old' && JSON.parse(change.sent).ProposedPassword === 'new',
    'ChangePassword sends PreviousPassword and ProposedPassword');
  check(JSON.parse(change.sent).AccessToken === 'a', 'and the access token, not an email');

  const signout = await bodyOf('POST /auth/signout', { AccessToken: 'a' });
  check(signout.target.endsWith('GlobalSignOut'), 'Sign out is GlobalSignOut');
}

console.log('\n== 3. the two sign-in flows ==');
{
  const { deps, calls } = DEPS(() => ({ status: 200, body: { AuthenticationResult: authResult() } }));
  const answer = await signIn('ada@example.com', 'Sup3rSecret!1', deps);
  const sent = JSON.parse(calls[0].init.body);
  check(calls[0].init.headers['x-amz-target'].endsWith('InitiateAuth'), 'sign-in is InitiateAuth');
  check(sent.AuthFlow === 'USER_PASSWORD_AUTH', `with USER_PASSWORD_AUTH (${sent.AuthFlow})`);
  check(sent.AuthParameters.USERNAME === 'ada@example.com' && sent.AuthParameters.PASSWORD === 'Sup3rSecret!1',
    'and the credentials under AuthParameters');
  check(answer.ok === true && answer.value.email === 'ada@example.com' && answer.value.playerId === 'emu-sub-1',
    'the session carries the ID token\'s claims, not the typed address');
}

console.log('\n== 4. the error names are not all one answer ==');
{
  const refusal = (type, status = 400) => {
    const { deps } = DEPS(() => ({ status, body: { __type: type, message: 'a sentence from the pool' } }));
    return deps;
  };
  const codeOf = async (type) => {
    const answer = await signIn('a@b.c', 'x', refusal(type));
    return answer.ok ? 'ok' : answer.failure.code;
  };
  check(await codeOf('NotAuthorizedException') === 'bad_credentials', 'a wrong password is bad_credentials');
  check(await codeOf('UserNotConfirmedException') === 'unconfirmed', 'an unconfirmed account is its own code');
  check(await codeOf('UsernameExistsException') === 'email_taken', 'a taken address is email_taken');
  check(await codeOf('InvalidPasswordException') === 'bad_password', 'a policy rejection is bad_password');
  check(await codeOf('CodeMismatchException') === 'bad_code', 'a wrong code is bad_code');
  // THE NEGATIVE CONTROL: the mapping is by NAME, so the plausible shortcut — one code for every refusal — is caught by the
  // four checks above disagreeing with each other, and by this one showing that an unknown name still says something.
  const unknown = await signIn('a@b.c', 'x', refusal('SomethingNewException'));
  check(!unknown.ok && unknown.failure.code === 'provider_refused' && unknown.failure.message === 'a sentence from the pool',
    'CONTROL: an unmapped name keeps the provider\'s own sentence rather than inventing one');
  // AND THE FULLY-QUALIFIED SPELLING, which is the other shape the service uses.
  const qualified = await signIn('a@b.c', 'x', refusal('com.amazonaws.cognito.identityprovider.model.NotAuthorizedException'));
  check(!qualified.ok && qualified.failure.code === 'bad_credentials', 'a fully-qualified __type is read by its last segment');
}

console.log('\n== 5. the session shape and the claims ==');
{
  const shaped = sessionShapeOf(authResult(), 'refresh-token');
  check(shaped.accessToken === 'access-token' && shaped.refreshToken === 'refresh-token', 'the tokens are carried');
  check(shaped.playerId === 'emu-sub-1' && shaped.email === 'ada@example.com', 'and the identity comes from the ID token');
  check(shaped.expiresInSeconds === 3600, 'and the lifetime is the provider\'s ExpiresIn');
  // A REFRESH ANSWERS WITHOUT A REFRESH TOKEN: the shape must take the one it is given.
  check(sessionShapeOf(authResult({ RefreshToken: undefined }), 'kept-refresh')?.refreshToken === 'kept-refresh',
    'a refresh that answers no new refresh token keeps the one held');
  check(sessionShapeOf(authResult({ IdToken: 'not-a-jwt' }), 'r') === null, 'an unreadable ID token is refused, not guessed at');
  check(claimsOf(tokenWith({ sub: 's', email: 'e@x' }))?.email === 'e@x', 'the claims reader returns email and sub');
  check(claimsOf('a.b.c') === null, 'and refuses a payload that is not JSON');
}

console.log('\n== 6. the dispatch: a pool build never calls /auth/*, and a local build never calls the pool ==');
{
  const pool = DEPS(() => ({ status: 200, body: { AuthenticationResult: authResult() } }));
  await signIn('a@b.c', 'x', pool.deps);
  check(pool.calls.every((call) => call.url.startsWith('https://cognito-idp.')), 'a pool build calls only the pool');
  check(pool.calls.length === 1, `and calls it once (${pool.calls.length})`);

  const local = DEPS(() => ({ status: 200, body: { accessToken: 'a', refreshToken: 'r', playerId: 'p', email: 'e@x', expiresInSeconds: 60 } }));
  const localDeps = { ...local.deps, cognito: undefined };
  await signIn('a@b.c', 'x', localDeps);
  check(local.calls[0].url === 'http://127.0.0.1:8090/auth/signin', `a local build still calls the API's route (${local.calls[0].url})`);
  check(local.calls.length === 1, 'and does not touch the pool');

  // THE DISCOVERY IS THE THIRD HALF: a pool build KNOWS its mode and offers the six operations without asking `/health`.
  const discover = DEPS(() => ({ status: 200, body: {} }));
  const found = await discoverAuth({ ...discover.deps, cognito: POOL });
  check(found.ok && found.value.mode === 'cognito', 'a pool build discovers cognito');
  check(found.ok && found.value.signin.length === COGNITO_ROUTES.length, `and offers the ${COGNITO_ROUTES.length} pool operations`);
  check(discover.calls.length === 0, 'without asking the server anything');
  const known = cognitoConfigFrom({ VITE_COGNITO_REGION: 'eu-west-2', VITE_COGNITO_CLIENT_ID: 'abc' });
  check(known !== null && known.region === 'eu-west-2', 'the pool is read from the two environment values');
  check(cognitoConfigFrom({ VITE_COGNITO_REGION: 'eu-west-2' }) === null, 'and a build with only one of them has no provider');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
