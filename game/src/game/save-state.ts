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
//   1. ONE SUCCESS PER ISSUED DRILL. `markFinished` records the position and reports at most once for it, because
//      `persist` may be told about a position the player has already finished (DESIGN.md 8 locks a drill when it
//      is issued, and a reload re-issues it). NO SCORE OR HINT IS CREDITED HERE, and there is no balance here at
//      all: the server is the one point of truth for both (REPORTED: "The hint bank should be stored on the server,
//      not locally"), so the shell holds the balance it was told in its own memory and this module holds none.
//   2. THE DRILL MUTATION MUST NOT DISCARD THE DAILY'S RECORD. `persist` keeps the stored Daily when the caller
//      has none in flight, because the tab opens on the Drill and the Daily is resumed lazily — MEASURED in
//      the browser: booting, solving a drill and reloading showed today's Daily back at 0:00 with an empty
//      line, because the first `persist()` of the session wrote `daily: null` over it.
//   3. THE WRITE IS ONE PLACE, AND ITS ANSWER IS THE FLAG. `saving` says whether the LAST write worked, which
//      is what the footer reads; nothing else in the app asks the storage anything.
//
// THE GRID'S SETS ARE MEMORY ONLY NOW, and that is the "temporary data only on the client" rule (REPORTED): `finished`
// and `passed` used to be persisted, mirroring the server's Progress row in a file the player can edit. They are the
// SHELL's drawing state, they are rebuilt from the server's `regime` whenever there is a server, and they are gone when
// the page is — which is exactly what a practice grid is worth after a reload.
//
// IT TAKES THE STORAGE AS AN ARGUMENT rather than reaching for `window.localStorage`, so the browser seam
// (including a blocked origin, which throws on the PROPERTY) stays in `main.ts` and this stays probeable.

import {
  clearGame,
  emptySave,
  loadGame,
  saveGame,
  SAVE_VERSION,
  type DailySaved,
  type DrillSaved,
  type SavedGame,
  type StorageLike,
} from './store.ts';

/** What the caller knows that the state does not: the issued drill, the Daily in flight, and the clock. */
interface PersistParts {
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
  /** The grid's finished/passed sets — MEMORY ONLY, see the header. */
  private finished: number[] = [];
  private passed: number[] = [];

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
   * the key and left the old record here would put the run in flight back on the very next `persist` — a control that
   * appears to work and then undoes itself, which is worse than not having one.
   *
   * IT REPORTS WHETHER THE DEVICE LET GO, and returns false without touching the record when it did not: the caller
   * shows the refusal instead of a fresh board that is not there.
   */
  clear(): boolean {
    if (!clearGame(this.storage)) return false;
    this.record = emptySave(this.poolVersion, 1, 0);
    this.finished = [];
    this.passed = [];
    return true;
  }

  get saving(): boolean {
    return this.writing;
  }

  /** The issued drill's position, which is where a boot resumes. */
  get position(): number {
    return this.record.drillPosition;
  }

  /**
   * The positions this shell has finished, and which of them it PASSED.
   *
   * THE GRID'S ONLY INPUT FROM THIS MODULE, and it is MEMORY, not the record: the server's Progress row is the fact a
   * signed-in player's grid draws (`main.ts`'s `serverRegime`), and this is the offline practice grid for the tab that
   * is open. Sorted copies, because a caller renders them and must not be able to reorder the sets.
   */
  get finishedPositions(): readonly number[] {
    return [...this.finished].sort((a, b) => a - b);
  }

  get passedPositions(): readonly number[] {
    return [...this.passed].sort((a, b) => a - b);
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

  /**
   * Mark a drill position FINISHED, and PASSED when it was solved unaided, and report whether it was new.
   *
   * NO SCORE AND NO HINT IS CREDITED, and that is the change the server-only score made: this is the PRACTICE record
   * (and the resume copy). The server's Progress row and hint balance are the truth, and neither is mirrored here — this
   * module holds no balance at all, so a signed-out page has none to draw (REPORTED: "When logged out, the hints bank
   * still shows my hints, it should be empty").
   *
   * THE GUARD IS STILL A RULE: a position already in the finished set answers `firstTime: false`, because a reload
   * re-issues it and a caller may persist the same position again. What it no longer does is decide a currency.
   *
   * A REVEALED DRILL FINISHES WITHOUT PASSING — the player did answer it, and the drill does not come back, but the pass
   * is the unaided result and the grid draws the difference.
   */
  markFinished(position: number, opts: { revealed?: boolean } = {}): { firstTime: boolean } {
    return { firstTime: this.noteFinish(position, opts.revealed !== true) };
  }

  /**
   * Put `position` in the finished set, and in the PASSED set when it was solved unaided.
   *
   * THE ONE WRITER OF BOTH SETS, so the ways a position can be finished cannot come to mean different things by
   * accident: they differ in what they CREDIT and in whether the drill was PASSED, which is what the level grid draws.
   * A revealed solve finishes without passing.
   *
   * A SKIP WAS A THIRD WAY IN AND ITS WRITER IS GONE WITH THE CONTROL: REPORTED as "Remove the "Skip this drill" button,
   * it shouldnt be required in a three choice quiestion." The server can still close a position without a pass
   * (`POST /drill/advance` records an abandonment), so `passed` remains a set that is not `finished` — and a position
   * closed on the server is drawn from the server's own answer, not from a local writer there is no longer a button for.
   *
   * A PASS IS MONOTONE: once a position is passed, nothing here takes it back, because a position cannot be served
   * again after it is finished (`drill-regime.ts` keeps it in the set once).
   */
  private noteFinish(position: number, passed: boolean): boolean {
    const firstTime = !this.finished.includes(position);
    if (firstTime) this.finished = [...this.finished, position];
    if (passed && !this.passed.includes(position)) this.passed = [...this.passed, position];
    return firstTime;
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
