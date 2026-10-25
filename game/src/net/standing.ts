// The client's half of the identity decision: what a run is worth to the server, and which sign-in the surface may
// offer. Two rules, one concern, and both are pure functions of facts the app already has.
//
// WHY THIS IS A MODULE AND NOT A CONDITION IN `main.ts`. DESIGN.md §11.2 turns the game into a funnel a signed-out
// player can try READ-ONLY: the server serves the puzzle, writes nothing at all, and answers every write `401`
// (A20). Four separate facts decide whether that is the case — whether an API is configured at all, which identity
// mode the server was started in, whether this app holds a session, and what the server said about the puzzle it
// just issued — and the shell that reads them (`main.ts`) is the layer that is NOT probe-loadable (AGENTS.md §1).
// A rule that only exists there cannot be measured, so it lives here, where a probe drives every combination.
//
// THE SERVER'S OWN WORD OUTRANKS THE CLIENT'S INFERENCE, and that ordering is the whole point of the `demo` field.
// `GET /drill/current` answers `demo: true` for a caller it served without writing a Progress row
// (`api/src/handlers/drill.ts`), which is the server saying "this run cannot be ranked". A client whose own state
// disagrees — a session it still holds, a mode it read before the store was restarted — must believe the server,
// because the server is the one that will refuse the submission. MEASURED by the negative control in
// `game/test/standing-probe.mjs`: the plausible wrong rule, "a session means ranked", ranks a run the server has
// just called a demo, and the submission is then answered `401 unauthenticated` for a reason the player cannot see.
import type { AuthMode } from './auth.ts';

/** How the server will treat the run this app is playing. */
export type Standing =
  /** No API is configured: nothing leaves the device, and the local ledger is the whole record (DESIGN.md §11). */
  | 'offline'
  /** The server will issue, score and record this run against a verified identity. */
  | 'ranked'
  /** The server serves the puzzle and writes NOTHING: a demo, and every write is `401` (DESIGN.md §11.2). */
  | 'unranked';

/** The four facts the rule is a function of, each read from somewhere that already knows it. */
interface StandingFacts {
  /** Whether `VITE_API_BASE` is set — the one switch every caller asks before reaching for the network. */
  readonly configured: boolean;
  /** The mode `/health` reported, or null while discovery has not answered or has failed. */
  readonly mode: AuthMode | null;
  /** Whether this app holds a session. That the app holds one is not evidence the server will honour it. */
  readonly signedIn: boolean;
  /** What the server said about the puzzle it issued, when it said anything at all (the Drill does, the Daily does not). */
  readonly demo: boolean;
  /**
   * Whether the drill on screen is this DEVICE'S OWN FIXTURE rather than one the server issued (`main.ts`'s
   * practice offer, DESIGN.md §15 Q20).
   *
   * IT IS A FACT OF ITS OWN AND NOT PART OF `demo`, because the two mean opposite things about the SERVER: `demo` is
   * the server saying "I served this and will not rank it", where `practice` is the app saying "the server was never
   * asked". They share one answer — the run cannot be ranked — which is why they are checked in the same place.
   */
  readonly practice: boolean;
}

/**
 * THE RULE, in the order the answers outrank each other.
 *
 * `demo` AND `practice` ARE CHECKED BEFORE THE SESSION, and `dev` is checked after both: a token mode with no
 * session is a demo, while `dev` names the player by a verified header (`api/src/auth/`), so a signed-out caller
 * under it is still the identity it claims — which is why `dev` shows no sign-in UI at all (§11.2). PRACTICE is
 * checked before `dev` too, and that is the check that makes the offer honest: under `dev` a signed-out caller IS
 * ranked, so without this a drill played from the local fixture would be marked ranked while the app knew it was
 * not the season's. A mode that is still `null` (discovery in flight, or a server that did not name one) is
 * deliberately NOT treated as `dev`: guessing an identity mode is how a build sends a header a deployment ignores,
 * or opens a sign-in form no server serves.
 */
export function standingOf(facts: StandingFacts): Standing {
  if (!facts.configured) return 'offline';
  if (facts.demo || facts.practice) return 'unranked';
  if (facts.signedIn) return 'ranked';
  return facts.mode === 'dev' ? 'ranked' : 'unranked';
}

/**
 * Whether a WRITE may be sent at all.
 *
 * READS ARE SERVED TO EVERYONE AND WRITES ARE NOT (A20), so this is the guard on exactly the calls that would
 * otherwise be answered `401`: `POST /runs`, `POST /me/hints`, `POST /drill/advance`. It is false for `offline` as
 * well, because "there is no server to write to" and "the server will refuse the write" are the same instruction to
 * the caller: keep the run local and say so.
 */
export function mayWrite(standing: Standing): boolean {
  return standing === 'ranked';
}

/** The facts the offer of a sign-in form is a function of. */
interface SignInOfferFacts {
  readonly mode: AuthMode | null;
  /** The routes `/health` advertised: empty in `dev`, the emulator's five in `emulate`, and empty for a PINNED build. */
  readonly signin: readonly string[];
  /** Whether this build pinned its mode (`VITE_AUTH_MODE`), read from the same dependency `auth.ts` reads it from. */
  readonly pinned: boolean;
}

/**
 * Whether the sign-in FORM may be drawn at all.
 *
 * THE ADVERTISED ROUTES ARE THE ANSWER WHENEVER THE SERVER WAS ASKED, because the list is the server saying which
 * flows it actually serves — so a `dev` server (none) gets no form, and neither does a `cognito` deployment, whose
 * hosted flow this build does not open yet. A form that asked for a password at a server answering `404` to
 * `/auth/signin` is the failure that reading the list avoids (§11.2).
 *
 * A PINNED `emulate` BUILD IS THE ONE CASE THE LIST CANNOT ANSWER, and it must still offer the form. `discoverAuth`
 * returns `[]` for a pinned mode rather than inventing routes — deliberately, and MEASURED in
 * `game/test/auth-client-probe.mjs` by a fetch count, because "it did not ask" is otherwise invisible — yet a build
 * pinned to `emulate` is exactly the build that was deployed against the local emulator, and a probe's own answer
 * to "which flows does this build offer" would then be "none", which is wrong rather than conservative. `dev` is
 * excluded because it has no account to sign in to: its header already names the player.
 */
export function signInOffered(facts: SignInOfferFacts): boolean {
  if (facts.signin.length > 0) return true;
  return facts.pinned && facts.mode === 'emulate';
}
