// The account row: the sign-in form, the signed-in line, and the sentence that says a run is unranked.
//
// WHAT THIS FILE DOES NOT DO, the split both other screens make: it owns no network and no rule. `net/auth.ts`
// runs the flow and `net/standing.ts` decides what a run is worth; this turns clicks into callbacks and one view
// into DOM. That is what keeps the DECISION probe-loadable while the pixels are not (AGENTS.md §1).
//
// THE FORM IS OFFERED ONLY WHEN THE SERVER ADVERTISES SIGN-IN ROUTES, and which cases that covers is decided by
// `signInOffered` in `net/standing.ts` rather than here — `/health` names the routes (§11.2), so the list is the
// server saying which flows it actually serves. A form that asked for a password at a server answering `404` to
// `/auth/signin` is the failure this reads the list to avoid, and the one case the list cannot answer (a build that
// PINNED its mode, and so asked nobody) is decided in the same probeable place.
//
// THE CODE FIELD IS REVEALED BY A SIGNUP THAT CAME BACK UNCONFIRMED, and in the local emulator it is PREFILLED from
// the answer: there is no mail sender locally, so the emulator returns the code it would have emailed
// (`api/src/auth/emulator.ts`). The field is still shown and still required, so the local flow is the real flow
// rather than a second one — only the typing is spared.
//
// A PASSWORD FIELD IS NEVER READ BACK INTO THE DOM, and nothing here interpolates text into markup: every string
// goes in through `textContent` (AGENTS.md §6), which matters because an email address is typed input.
import type { AuthMode, SignedIn } from '../net/auth.ts';
import type { Standing } from '../net/standing.ts';
import { el } from './dom.ts';

export interface AccountCallbacks {
  signIn: (email: string, password: string) => void;
  signUp: (email: string, password: string) => void;
  confirm: (email: string, code: string) => void;
  signOut: () => void;
}

/** Everything the row draws from, all of it already decided elsewhere. */
export interface AccountView {
  readonly standing: Standing;
  readonly mode: AuthMode | null;
  readonly player: SignedIn | null;
  /** Whether this build may offer a sign-in form (`signInOffered`, which is where the rule lives). */
  readonly offersForm: boolean;
}

interface El {
  row: HTMLElement;
  status: HTMLElement;
  form: HTMLFormElement;
  email: HTMLInputElement;
  password: HTMLInputElement;
  signIn: HTMLButtonElement;
  signUp: HTMLButtonElement;
  code: HTMLInputElement;
  confirm: HTMLButtonElement;
  signOut: HTMLButtonElement;
}

export class AccountScreen {
  private readonly els: El;
  private busy = false;

  constructor(private readonly on: AccountCallbacks) {
    this.els = {
      row: el('account'),
      status: el('accountStatus'),
      form: el<HTMLFormElement>('accountForm'),
      email: el<HTMLInputElement>('accountEmail'),
      password: el<HTMLInputElement>('accountPassword'),
      signIn: el<HTMLButtonElement>('accountSignIn'),
      signUp: el<HTMLButtonElement>('accountSignUp'),
      code: el<HTMLInputElement>('accountCode'),
      confirm: el<HTMLButtonElement>('accountConfirm'),
      signOut: el<HTMLButtonElement>('accountSignOut'),
    };
    this.els.form.addEventListener('submit', (event) => {
      // THE PAGE MUST NOT RELOAD: a form's default submit would rebuild the app and lose the run in flight.
      event.preventDefault();
      const email = this.els.email.value.trim();
      const password = this.els.password.value;
      if (email === '' || password === '') {
        this.say('Enter an email address and a password.', 'bad');
        return;
      }
      this.on.signIn(email, password);
    });
    this.els.signUp.addEventListener('click', () => {
      const email = this.els.email.value.trim();
      const password = this.els.password.value;
      if (email === '' || password === '') {
        this.say('Enter an email address and a password to create an account.', 'bad');
        return;
      }
      this.on.signUp(email, password);
    });
    this.els.confirm.addEventListener('click', () => {
      const code = this.els.code.value.trim();
      if (code === '') {
        this.say('Enter the confirmation code.', 'bad');
        return;
      }
      this.on.confirm(this.els.email.value.trim(), code);
    });
    this.els.signOut.addEventListener('click', () => this.on.signOut());
  }

  /**
   * Draw the row from the standing and the session.
   *
   * THE ROW IS HIDDEN WHEN IT HAS NOTHING TO SAY, which is both the offline game and `dev`: there is no account to
   * offer and nothing a player could do about it, and a permanent "sign in" line above the board would be an
   * advertisement for a feature the build does not have.
   */
  show(view: AccountView): void {
    const offersForm = view.offersForm;
    const showRow = view.player !== null || (view.standing === 'unranked' && view.mode !== 'dev');
    this.els.row.hidden = !showRow;
    if (!showRow) return;

    this.els.form.hidden = view.player !== null || !offersForm;
    this.els.signOut.hidden = view.player === null;
    this.els.status.textContent = view.player ? `Signed in as ${view.player.email}.` : unrankedNote(view, offersForm);
    this.els.status.dataset['kind'] = view.player ? 'ok' : 'info';
    this.setBusy(this.busy);
  }

  /** A line for the player, in the row's own status slot. The sign-in form's refusals are shown here. */
  say(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    this.els.status.textContent = text;
    this.els.status.dataset['kind'] = kind;
  }

  /**
   * Reveal the confirm step, prefilled with the code the emulator returned.
   *
   * `emailedCode` IS NULL FOR A REAL PROVIDER, which is why the field is required and the value merely offered:
   * the confirm step has to work when nothing hands the code back.
   */
  askForCode(emailedCode: string | null): void {
    this.els.code.hidden = false;
    this.els.confirm.hidden = false;
    if (emailedCode !== null) this.els.code.value = emailedCode;
  }

  /** Disable every control while a request is in flight, so a double press cannot race the first. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    for (const control of [this.els.email, this.els.password, this.els.code, this.els.signIn, this.els.signUp, this.els.confirm, this.els.signOut]) {
      control.disabled = busy;
    }
  }
}

/**
 * Why nothing played here is ranked, said in terms of what the SERVER is doing rather than what the app wants.
 *
 * THE THREE SENTENCES ARE THREE DIFFERENT FACTS and they are not interchangeable: a server that advertises a form
 * can be signed in to, a hosted deployment has no form in this build, and a server that did not name its mode is one
 * this app cannot ask at all. Collapsing them into "please sign in" would offer a form that answers `404`.
 */
function unrankedNote(view: AccountView, offersForm: boolean): string {
  if (offersForm) return 'Not signed in — you can play, and the server records nothing: no score, no board, no hints. Sign in to be counted.';
  if (view.mode === 'cognito') return 'Not signed in — this build has no sign-in form for a hosted deployment yet, so nothing you play here is ranked.';
  return 'Not signed in — the server did not say how it identifies players, so nothing you play here is ranked.';
}
