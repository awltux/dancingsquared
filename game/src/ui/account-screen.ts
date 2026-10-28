// The account row and the password form: the sign-in form, the signed-in line, the sentence that says a run is unranked, and
// the one control a signed-in player has over their own account.
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
// THE PASSWORD FORM READS THE SAME LIST, for the same reason and one step further: a server that serves sign-in but not
// `/auth/password` (the `cognito` half of this build, whose hosted flow owns passwords) must not be offered a form that
// cannot work. So the caller decides `offersPassword` from the advertised routes, and this file only draws.
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

interface AccountCallbacks {
  signIn: (email: string, password: string) => void;
  signUp: (email: string, password: string) => void;
  confirm: (email: string, code: string) => void;
  signOut: () => void;
  /** Change the password of the signed-in account, given the current one. */
  changePassword: (current: string, next: string) => void;
}

/** Everything the row draws from, all of it already decided elsewhere. */
interface AccountView {
  readonly standing: Standing;
  readonly mode: AuthMode | null;
  readonly player: SignedIn | null;
  /** Whether this build may offer a sign-in form (`signInOffered`, which is where the rule lives). */
  readonly offersForm: boolean;
  /** Whether the server serves `/auth/password`, from the same advertised list. */
  readonly offersPassword: boolean;
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
  passwordForm: HTMLFormElement;
  currentPassword: HTMLInputElement;
  newPassword: HTMLInputElement;
  changePassword: HTMLButtonElement;
  passwordStatus: HTMLElement;
}

export class AccountScreen {
  private readonly els: El;
  private busy = false;

  constructor(private readonly on: AccountCallbacks) {
    this.els = {
      row: el('accountRow'),
      status: el('accountStatus'),
      form: el<HTMLFormElement>('accountForm'),
      email: el<HTMLInputElement>('accountEmail'),
      password: el<HTMLInputElement>('accountPassword'),
      signIn: el<HTMLButtonElement>('accountSignIn'),
      signUp: el<HTMLButtonElement>('accountSignUp'),
      code: el<HTMLInputElement>('accountCode'),
      confirm: el<HTMLButtonElement>('accountConfirm'),
      signOut: el<HTMLButtonElement>('accountSignOut'),
      passwordForm: el<HTMLFormElement>('passwordForm'),
      currentPassword: el<HTMLInputElement>('currentPassword'),
      newPassword: el<HTMLInputElement>('newPassword'),
      changePassword: el<HTMLButtonElement>('passwordChange'),
      passwordStatus: el('passwordStatus'),
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
    // THE PASSWORD FORM IS ITS OWN FORM, so a submit in it cannot be mistaken for a sign-in by the handler above, and a
    // change does not depend on the sign-in fields still holding the password.
    this.els.passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const current = this.els.currentPassword.value;
      const next = this.els.newPassword.value;
      if (current === '' || next === '') {
        this.sayPassword('Enter the current password and the new one.', 'bad');
        return;
      }
      this.on.changePassword(current, next);
    });
  }


  /**
   * Draw the row from the standing and the session.
   *
   * THE ROW IS HIDDEN WHEN IT HAS NOTHING TO SAY, which is both the offline game and `dev`: there is no account to
   * offer and nothing a player could do about it, and a permanent "sign in" line above the board would be an
   * advertisement for a feature the build does not have.
   *
   * THE PASSWORD FORM APPEARS ONLY FOR A SIGNED-IN PLAYER ON A SERVER THAT SERVES THE ROUTE, and it is the only place that
   * decision is made (from `offersPassword`, which the shell derives from the advertised list). Its status line is separate
   * from the row's: a password change's refusal must not overwrite the sentence that says what signing in does.
   */
  show(view: AccountView): void {
    const offersForm = view.offersForm;
    const showRow = view.player !== null || (view.standing === 'unranked' && view.mode !== 'dev');
    this.els.row.hidden = !showRow;
    this.els.passwordForm.hidden = view.player === null || !view.offersPassword;
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

  /** The password form's own line, and the reason it is not the row's: see `show`. */
  sayPassword(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    this.els.passwordStatus.textContent = text;
    this.els.passwordStatus.dataset['kind'] = kind;
  }

  /**
   * Forget what was typed into the password form, after a change landed or the session ended.
   *
   * A PASSWORD LEFT IN A FIELD IS A PASSWORD ON THE SCREEN: the form is cleared on every successful change, and the fields
   * are emptied rather than merely masked.
   */
  clearPassword(): void {
    this.els.currentPassword.value = ''; 
    this.els.newPassword.value = '';
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
    for (const control of [
      this.els.email, this.els.password, this.els.code, this.els.signIn, this.els.signUp, this.els.confirm, this.els.signOut,
      this.els.currentPassword, this.els.newPassword, this.els.changePassword,
    ]) {
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
