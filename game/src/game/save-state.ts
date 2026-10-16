// The saved game as the SHELL uses it: the record, the rules that change it, and the one write.
//
// WHY THIS IS A MODULE AND NOT FOUR VARIABLES IN `main.ts`. It was four module-level variables there — the
// record, the run ledger, the finished set and the balance — each written from wherever it happened to be
// needed, and the rules over them were therefore reachable only from a browser, because `main.ts` builds DOM
// the moment it is imported. `store.ts` owns the FILE: its schema, its loader, the clamping and the bound.
// This owns the LIVE state over that file, and it is driveable by a probe with a fake storage and no page.
//
// THE RULES IT OWNS, each of which had been a line in a handler:
//
//   1. ONE SUCCESS PER ISSUED DRILL. `countSuccess` records the position and grants at most once for it,
//      because `SaveState.persist` may be told about a position the player has already finished (DESIGN.md 8
//      locks a drill when it is issued, and a reload re-issues it). The BOARD cannot be farmed (§6 keeps the
//      player's best), but the BALANCE could be, and a hint is a currency (§10). DESIGN.md 11's Progress row
//      keeps "the set of finished ones" for exactly this.
//   2. ONE ENTRY PER `runId`. `addRun` reports how many entries it ADDED, so a caller that repaints can write
//      only when something changed — and the dedupe itself is `store.recordRun`'s, keyed on the id that
//      Phase 5's claim is idempotent on.
//   3. A DRILL MUTATION MUST NOT DISCARD THE DAILY'S RECORD. `persist` keeps the stored Daily when the caller
//      has none in flight, because the tab opens on the Drill and the Daily is resumed lazily — MEASURED in
//      the browser: booting, solving a drill and reloading showed today's Daily back at 0:00 with an empty
//      line, because the first `persist()` of the session wrote `daily: null` over it.
//   4. THE WRITE IS ONE PLACE, AND ITS ANSWER IS THE FLAG. `saving` says whether the LAST write worked, which
//      is what the footer reads; nothing else in the app asks the storage anything.
//
// IT TAKES THE STORAGE AS AN ARGUMENT rather than reaching for `window.localStorage`, so the browser seam
// (including a blocked origin, which throws on the PROPERTY) stays in `main.ts` and this stays probeable.

import { SCORE_VERSION } from '../puzzle/config.ts';
import { recordSuccess, spendHint, type HintLedger } from '../puzzle/hints.ts';
import {
  bestScore,
  clearGame,
  emptySave,
  loadGame,
  recordRun as appendRun,
  saveGame,
  SAVE_VERSION,
  type DailySaved,
  type DrillSaved,
  type RunRecord,
  type SavedGame,
  type StorageLike,
} from './store.ts';

/** What the caller knows that the state does not: the issued drill, the Daily in flight, and the clock. */
export interface PersistParts {
  levelIndex: number;
  /** The ISSUED-drill id. */
  position: number;
  /** The drill in flight, or null when there is nothing to resume. */
  drill: DrillSaved | null;
  /**
   * The Daily in flight, or null — and NULL MEANS "KEEP WHAT IS STORED", not "clear it". See rule 3 above.
   */
  daily: DailySaved | null;
  /** The wall clock, for the resume gap the loader will charge against `savedAtMs`. */
  wallNowMs: number;
}

export class SaveState {
  private readonly storage: StorageLike;
  private readonly poolVersion: string;
  private record: SavedGame;
  private writing: boolean;

  private constructor(storage: StorageLike, poolVersion: string, record: SavedGame, writing: boolean) {
    this.storage = storage;
    this.poolVersion = poolVersion;
    this.record = record;
    this.writing = writing;
  }

  /**
   * Read what is there and adopt it, or start fresh.
   *
   * EVERYTHING THE LOADER DECIDES IS ITS OWN (`store.loadGame`): an absent record, unreadable text, an older
   * schema, a moved pool, a field out of range. What comes back here is a state that can be played, plus the
   * count of records the loader had to DROP — reported by the caller rather than swallowed, because a
   * loader's silence about bad data is itself a bug (AGENTS.md 4.1).
   *
   * A FRESH RECORD CARRIES NO STAMP, so `resumed` is false and the shell does not greet a first-time player
   * with a warning about the level the save is on. It takes no clock for that reason: an earlier version
   * stamped the fresh record with `wallNowMs`, and `resumed` — which is `savedAtMs > 0` — then said a brand
   * new game had been resumed, which the probe's "a device with nothing stored opens a fresh game" check
   * caught. The stamp a WRITE puts on the record is `persist`'s, and it is the real one.
   */
  static open(storage: StorageLike, poolVersion: string): { state: SaveState; dropped: number } {
    const loaded = loadGame(storage, poolVersion);
    const record = loaded.state ?? emptySave(poolVersion, 1, 0);
    return { state: new SaveState(storage, poolVersion, record, loaded.saving), dropped: loaded.dropped };
  }

  /**
   * Forget this device's game and become a fresh one (DESIGN.md §15 Q18).
   *
   * THE IN-MEMORY RECORD IS REPLACED, not merely the storage. The shell holds THIS object, so a reset that cleared
   * the key and left the old record here would put the balance and the ledger back on the very next `persist` —
   * a control that appears to work and then undoes itself, which is worse than not having one.
   *
   * IT REPORTS WHETHER THE DEVICE LET GO, and returns false without touching the record when it did not: the caller
   * shows the refusal instead of a fresh board that is not there.
   */
  clear(): boolean {
    if (!clearGame(this.storage)) return false;
    this.record = emptySave(this.poolVersion, 1, 0);
    return true;
  }

  get saving(): boolean {
    return this.writing;
  }

  get hints(): HintLedger {
    return this.record.hints;
  }

  get runs(): readonly RunRecord[] {
    return this.record.runs;
  }

  /** The issued drill's position, which is where a boot resumes. */
  get position(): number {
    return this.record.drillPosition;
  }

  /**
   * The drill that was in flight when the record was written, or null.
   *
   * IT IS A CANDIDATE, NOT AN ANSWER: the caller resumes it only when its position is the drill it just
   * issued (`drillPosition`), which is what stops a half-played drill being carried onto a different question.
   */
  get drillRun(): DrillSaved | null {
    return this.record.drillRun;
  }

  /**
   * The Daily record as stored, or null.
   *
   * IT IS WHAT LAZILY RESUMES THE DAILY: the tab opens on the Drill, so the run is not built until the player
   * switches — and what it is built FROM is this, which rule 3 above keeps alive across drill mutations.
   */
  get daily(): DailySaved | null {
    return this.record.daily;
  }

  get levelIndex(): number {
    return this.record.levelIndex;
  }

  /** Whether this came from a stored record — for a caller that has something to say about a resumed game. */
  get resumed(): boolean {
    return this.record.savedAtMs > 0;
  }

  /** The best score among the runs THIS build's weights scored, or null when there are none. */
  get best(): number | null {
    return bestScore(this.record.runs, SCORE_VERSION);
  }

  /**
   * Record a solved drill at `position`, and report what it earned.
   *
   * THE GUARD IS THE RULE: a position already in the finished set grants nothing and adds nothing, however
   * many times it is solved. See rule 1 in the module header.
   *
   * THE TWO ANSWERS ARE TWO QUESTIONS, and they are not redundant: `granted` is false for a FULL balance as
   * well as for a repeat, so only `firstTime` says "this position was not counted before". That is the answer
   * the probe rules the farming out with, and the reason it is reported rather than folded into `granted`.
   */
  countSuccess(position: number): { firstTime: boolean; granted: boolean } {
    if (this.record.finished.includes(position)) return { firstTime: false, granted: false };
    const granted = recordSuccess(this.record.hints);
    this.record = { ...this.record, finished: [...this.record.finished, position], hints: granted.ledger };
    return { firstTime: true, granted: granted.granted };
  }

  /**
   * Spend one hint. False when the balance is empty, and then NOTHING changes — which is a state a caller can
   * be in (the Daily's button and the balance are read at different moments), and the answer the probe pins.
   */
  spendHint(): boolean {
    const spent = spendHint(this.record.hints);
    if (!spent.spent) return false;
    this.record = { ...this.record, hints: spent.ledger };
    return true;
  }

  /** Append a completed run; returns how many entries were added (0 when the id is already recorded). */
  addRun(run: RunRecord): number {
    const before = this.record.runs.length;
    this.record = appendRun(this.record, run);
    return this.record.runs.length - before;
  }

  /**
   * Adopt a balance the SERVER stated.
   *
   * THE SERVER OWNS THE LEDGER (DESIGN.md 10, 11: "server-owned state that the client displays and requests
   * against"), so once a run has been submitted, the number it answers with is the truth and this record becomes a
   * CACHE of it — including the earning progress, which the server counts from its own record of finished drills.
   * `countSuccess` is untouched and still holds offline, where there is no server to ask.
   */
  adoptHints(ledger: HintLedger): void {
    this.record = { ...this.record, hints: ledger };
  }

  /** Write the live state. Returns whether the storage kept it, and remembers that as `saving`. */
  persist(parts: PersistParts): boolean {
    this.record = {
      ...this.record,
      version: SAVE_VERSION,
      poolVersion: this.poolVersion,
      levelIndex: parts.levelIndex,
      drillPosition: parts.position,
      drillRun: parts.drill,
      daily: parts.daily ?? this.record.daily,
      savedAtMs: parts.wallNowMs,
    };
    this.writing = saveGame(this.storage, this.record);
    return this.writing;
  }
}
