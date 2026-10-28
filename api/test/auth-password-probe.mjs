// THE PASSWORD CHANGE, pinned — the one account operation that turns a leaked session into an account takeover if it is done
// wrongly, and the only one whose *other* half (revoking every other session) a player cannot see.
//
// WHY THIS IS A GATE. The route is the emulator's (`api/src/auth/emulator.ts`), and it is the provider the local app talks to;
// a real deployment's counterpart is Cognito's `ChangePassword`, pinned from the client side by `game/test/cognito-probe.mjs`.
// Between them the two probes cover the same six rules, and every one of them is an attempt rather than a reading:
//
//   1. THE CURRENT PASSWORD IS REQUIRED AND CHECKED. A wrong one is refused with the same code a wrong sign-in gives, and —
//      MEASURED by signing in afterwards — the OLD password still works, so a refused change changed nothing.
//   2. THE NEW PASSWORD IS HELD TO SIGNUP'S RULE, and a new password EQUAL to the current one is refused: "changed" when
//      nothing changed is a lie the player would only discover at the next sign-in.
//   3. A CHANGE SIGNS EVERY OTHER SESSION OUT. Two sign-ins are made, the change revokes both refresh tokens, and the check is
//      that the SECOND session's refresh is now refused — which is the property that makes a password change worth doing.
//   4. IT NEEDS A KNOWN, CONFIRMED ACCOUNT: an unknown address and an unconfirmed one are refused, and neither is a 500.
//
// Usage: node api/test/auth-password-probe.mjs   (in process: the emulator over a memory store, no socket, no seeding)
import { createEmulator } from '../src/auth/emulator.ts';
import { MemoryStore } from '../src/store/memory.ts';

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

const post = (path, body) => ({ method: 'POST', path, query: {}, body, headers: {} });
const CLOCK = 1_700_000_000_000;
const clock = { now: CLOCK, nowMs() { return this.now; } };
const emulator = createEmulator({ store: new MemoryStore(), clock, secret: Buffer.from('password-probe-secret'), requireConfirmation: false });
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another stable staple';

// ONE ACCOUNT, made through the same route a player uses.
await emulator.handle(post('/auth/signup', { email: 'dora@example.com', password: PASSWORD }));
/** How many sessions are live — counted, so "every other session" is measured rather than pinned to a number that drifts. */
let sessions = 0;
const signInAs = async (password) => {
  const answer = await emulator.handle(post('/auth/signin', { email: 'dora@example.com', password }));
  if (answer.status === 200) sessions++;
  return answer;
};
const first = await signInAs(PASSWORD);
const second = await signInAs(PASSWORD);
check(first.status === 200 && second.status === 200, 'two sessions are signed in, so "the others" is a real set');

console.log('\n== 1. the current password is required and is checked ==');
{
  const missing = await emulator.handle(post('/auth/password', { email: 'dora@example.com', newPassword: NEW_PASSWORD }));
  check(missing.status === 401 || missing.status === 400, `a change with no current password is refused (${missing.status})`);
  const wrong = await emulator.handle(post('/auth/password', { email: 'dora@example.com', currentPassword: 'not the password', newPassword: NEW_PASSWORD }));
  check(wrong.status === 401 && wrong.body.error.code === 'bad_credentials', `a wrong current password is bad_credentials (${wrong.status} ${wrong.body.error?.code})`);
  // THE MEASUREMENT THAT MAKES THE REFUSAL REAL: the old password still works, so nothing was written on the way out.
  const after = await signInAs(PASSWORD);
  check(after.status === 200, 'and the old password still signs in, so the refused change changed nothing');
}

console.log('\n== 2. the new password is held to signup\'s rule ==');
{
  const short = await emulator.handle(post('/auth/password', { email: 'dora@example.com', currentPassword: PASSWORD, newPassword: 'short' }));
  check(short.status === 400 && short.body.error.code === 'bad_password', `a short new password is refused (${short.status} ${short.body.error?.code})`);
  const same = await emulator.handle(post('/auth/password', { email: 'dora@example.com', currentPassword: PASSWORD, newPassword: PASSWORD }));
  check(same.status === 400 && same.body.error.code === 'same_password', `and the current password as the new one is refused (${same.status} ${same.body.error?.code})`);
  // AN UNKNOWN ADDRESS IS THE SAME ANSWER AS A WRONG PASSWORD, on purpose: a password route that distinguished them would be a
  // way to find out which addresses are registered (the rule `signin` follows, and the reason this is 401 rather than 404).
  const unknown = await emulator.handle(post('/auth/password', { email: 'nobody@example.com', currentPassword: PASSWORD, newPassword: NEW_PASSWORD }));
  check(unknown.status === 401 && unknown.body.error.code === 'bad_credentials',
    `an unknown address is the same answer as a wrong password (${unknown.status} ${unknown.body.error?.code})`);
}

console.log('\n== 3. a change signs every other session out ==');
{
  const changed = await emulator.handle(post('/auth/password', { email: 'dora@example.com', currentPassword: PASSWORD, newPassword: NEW_PASSWORD }));
  check(changed.status === 200 && changed.body.ok === true, `the change lands (${changed.status})`);
  check(changed.body.revoked === sessions, `and revokes every live session (${changed.body.revoked} of ${sessions})`);
  // THE POINT OF THE WHOLE OPERATION: the second session's refresh token must no longer work.
  const refresh = await emulator.handle(post('/auth/refresh', { refreshToken: second.body.refreshToken }));
  check(refresh.status === 401, `the other session's refresh is refused (${refresh.status})`);
  const oldPassword = await emulator.handle(post('/auth/signin', { email: 'dora@example.com', password: PASSWORD }));
  check(oldPassword.status === 401, `the old password no longer signs in (${oldPassword.status})`);
  const newPassword = await emulator.handle(post('/auth/signin', { email: 'dora@example.com', password: NEW_PASSWORD }));
  check(newPassword.status === 200, `and the new one does (${newPassword.status})`);
}

console.log('\n== 4. an unconfirmed account cannot change its password ==');
{
  const closed = createEmulator({ store: new MemoryStore(), clock, secret: Buffer.from('password-probe-secret-2'), requireConfirmation: true });
  const signed = await closed.handle(post('/auth/signup', { email: 'eve@example.com', password: PASSWORD }));
  const code = signed.body.confirmCode;
  check(typeof code === 'string' && code.length > 0, 'a confirming pool answers with the account unconfirmed');
  const change = await closed.handle(post('/auth/password', { email: 'eve@example.com', currentPassword: PASSWORD, newPassword: NEW_PASSWORD }));
  check(change.status === 403 && change.body.error.code === 'unconfirmed', `and a change before confirmation is refused (${change.status} ${change.body.error?.code})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
