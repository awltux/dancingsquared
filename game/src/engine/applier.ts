// The engine-backed `GameApplier` — the seam between the pure core and the engine's mutable sequencer, and
// the only place in `src/` where a SEQUENCER or a legislative call is reached. It is deliberately not
// reachable from the puzzle barrel (`src/puzzle/index.ts`), so a probe can drive the whole core with a stub.
//
// THE "ONLY FILE THAT IMPORTS AN ENGINE VALUE" CLAIM THAT USED TO BE HERE WAS FALSE and is corrected rather
// than repeated: `puzzle/session.ts`, `puzzle/generator.ts`, `game/drill.ts` and `data/assets.ts` all import
// engine values, because those are the engine's own PURE RULES (`boardSig`, `sameBoardById`,
// `makeSquaredSet`, `callMeta`) and importing them is what keeps the game from owning a second
// implementation of a rule the engine already has (AGENTS.md 5). What this file alone holds is the
// sequencer: the SINGLE MUTABLE object, which every method below receives its board explicitly rather than
// reading from `this.board`.
//
// IT HOLDS A MUTABLE SEQUENCER AND NEVER USES ITS BOARD. `Sequencer.setBoard` exists and several of its
// methods read `this.board`, which is a hazard this file avoids by construction: every call below passes
// the board explicitly (`offered(board)`, `applyToBoard(board, call)`, `evaluateSequence(flat, beat,
// board)`), so two appliers can interleave and neither can see the other's state. That is not caution for
// its own sake — the generator explores a tree, so it asks about many boards per step, and a version that
// ping-ponged `setBoard` would be one missing call away from a silently wrong answer (AGENTS.md trap 13 is
// that exact failure in the solver).
//
// DETERMINISM: `setSnapMaxError(0)` is load-bearing. The interactive apply path snaps an arrival onto a
// formation's canonical slots within `snapMaxError` (1.0 by default), which would make the goal board
// depend on the snapping rather than on the call — so two runs could agree on the FORMATION and differ
// in the pose, and `sameBoardById` would then disagree with the engine's own recogniser about whether
// the player arrived. Turning it off makes the goal exactly what the calls produce.
import { Sequencer, parseStep, sameBoardById, type Board } from 'dancing-squared-engine';
import { poseKey } from '../puzzle/pose-key.ts';
import type { GameApplier, Move, MoveReading, Refusal, SequenceMotion } from '../puzzle/types.ts';

interface ApplierOptions {
  movesXml: string;
  formationsXml: string;
  /** The calls this level registers, by TITLE. */
  calls: { name: string; xml: string }[];
}

/**
 * How many boards' reading lists one applier keeps.
 *
 * THE CACHE IS WHY THE DAILY'S PICKER IS A CLICK. `readings` is `legalCalls × subsetGroups` applicator runs —
 * MEASURED, 1754 ms on a squared set at 322 titles and 22 ms one call in — and the Daily asks for it again after
 * every move AND every undo.
 *
 * THE KEY IS THE FULL POSE AND IDENTITY, NOT `boardSig`, and that is a correction rather than caution: `boardSig` is
 * positions-only (AGENTS.md §8 trap 11), and MEASURED while this cached on it, a call that changes FACING alone
 * returned the previous board's list — same signature, different question. Legality reads headings (the matcher
 * matches them) and the group list reads couple identity, so the key carries both. It is deliberately
 * OVER-sensitive: two boards that are genuinely the same pose in different arrays would be two cache entries, which
 * costs one recomputation, while an UNDER-sensitive key serves a wrong list, which costs a wrong puzzle.
 *
 * THE BOUND IS BLUNT, for the reason `api/src/levels.ts` gives about its own caches: the working set is the boards a
 * player walks in one run, and a clear costs one recomputation rather than leaving an unbounded map in a tab.
 */
const READINGS_CACHE_BOARDS = 32;

/**
 * How many boards' OFFERED lists one applier keeps.
 *
 * `offered` IS ONE `applyToBoard` PER REGISTERED TITLE, and it is the GENERATOR's hot loop rather than only the
 * picker's: a depth-3 Daily asks it for the start, for every frontier board, and again for each candidate's boards.
 * MEASURED at the shipped level-1 pool (57 titles) it costs 75 ms a board, and a depth-3 generation 5.7 s, where a
 * 20-title pool generates the same shape in 0.5 s. `readings` beside it has been cached since it was written; this
 * list was not, and the asymmetry was invisible because the picker's 1.7 s made the smaller list look cheap.
 *
 * THE SAME KEY AND THE SAME TRAP AS `readings`: `poseKey`, never `boardSig` — `boardSig` is positions-only
 * (AGENTS.md §8 trap 11), and a call that changes FACING alone returns the same signature and a different list.
 *
 * THE BOUND IS BLUNT AND BIGGER THAN `readings`', because a generator's working set is a whole frontier where the
 * picker's is one line's boards; a clear costs one recomputation rather than an unbounded map in a tab.
 */
const OFFERED_CACHE_BOARDS = 64;

// THE KEY IS `poseKey` FROM `puzzle/pose-key.ts` AND NOT A LOCAL COPY, because the generator needs the same identity:
// a second spelling of "the full pose" is how two files come to disagree about whether two boards are the same one.

export function createEngineApplier(opts: ApplierOptions): GameApplier {
  // A CALL IS ITS TITLE, AND ITS VARIANTS ARE THE TAMS THAT CARRY IT. The constructor registers each pair as a
  // WHOLE DOCUMENT, which would give every title every tam of its file -- `trade.xml` under one name means
  // `Boys Trade` also matches `Partner Trade`'s authorings. `registerByTitle` takes only the tams carrying the
  // name, which is the engine's variant model applied at its own grain.
  const seq = new Sequencer(opts.movesXml, opts.formationsXml);
  for (const call of opts.calls) seq.registerByTitle(call.name, call.xml);
  seq.setSnapMaxError(0);
  const names = opts.calls.map((c) => c.name);
  const readingCache = new Map<string, MoveReading[]>();
  const offeredCache = new Map<string, Move[]>();
  /**
   * The start-board set, built once.
   *
   * IT IS A PURE FUNCTION OF THE REGISTRATION: the titles are fixed for this applier's life, so the set of
   * formations they declare cannot change and the built boards cannot either. The generator asks for it on
   * every puzzle it generates (a level's block is 100 drills), so building it per call would re-run
   * `boardForSetup` — the FASR enumeration — a hundred times for one answer.
   */
  let startCache: Board[] | null = null;

  /**
   * Apply one LINE ELEMENT, which is either a call name or a PARALLEL STEP written the way `stepLabel` writes one
   * (`Sides Trade || Heads Dosado`).
   *
   * WHY THE SPLIT IS HERE AND NOT AT EVERY CALLER. The game's line is a list of strings — that is what the wire records
   * and what the server replays — so a parallel step has to survive as text, and exactly one place should know that a
   * string can describe two groups. `parseStep` is the engine's inverse of `stepLabel`; a string it cannot read is a
   * REFUSAL with its own sentence rather than an "unknown call", because the two are different mistakes.
   */
  const apply = (board: Board, call: string) => {
    if (!call.includes(' || ')) return seq.applyToBoard(board, call);
    const step = parseStep(call);
    if (!step) return { legal: false, board, reason: `${JSON.stringify(call)} names a parallel step this app cannot read` };
    return seq.applyToBoard(board, step);
  };

  return {
    offered(board: Board): Move[] {
      // THE LIST IS A FUNCTION OF THE POSE ALONE — the registered titles are fixed for this applier's life — so
      // the same board must not pay for it twice. Callers treat the result as read-only (every one of them maps,
      // finds or copies it), which is what makes sharing the array safe.
      const key = poseKey(board);
      const cached = offeredCache.get(key);
      if (cached) return cached;
      const out: Move[] = [];
      for (const name of names) {
        // THE PERMISSION TABLE COMES FIRST, and it is asked at the WHOLE-BOARD reading (`null`, which `permissionFor`
        // normalises to `All 8`). Permissions are a different claim from legality - "the app will not
        // suggest this" versus "the engine refuses this" - so legality alone cannot express them, and until this
        // asked, `PERMISSION_RULES` had no effect on a drill at all: MEASURED, `legalCalls` answers 40 of the 57
        // level-1 titles at a squared set with and without the table installed, because it is a geometric question
        // that never consults a rule. The generator takes its options from this list, so that is where a table the
        // engine owns has to bite.
        //
        // THE BOARD IS PASSED EXPLICITLY, not left to the sequencer: this file never calls `setBoard` (see the
        // header), so the default would be whatever board the sequencer was constructed with, and a rule that names
        // a formation would then be checked against the wrong one.
        //
        // ASKED BEFORE THE APPLY, because a denied call costs one rule match and a legal one costs a full applicator
        // run - the order `groupCanPerform` already uses.
        if (!seq.mayOffer(name, null, board).allowed) continue;
        const r = seq.applyToBoard(board, name);
        if (r.legal) out.push({ call: name, board: r.board });
      }
      if (offeredCache.size >= OFFERED_CACHE_BOARDS) offeredCache.clear();
      offeredCache.set(key, out);
      return out;
    },

    candidateCalls(): string[] {
      return [...names];
    },

    /**
     * ONE BOARD PER FORMATION THE LEVEL'S CALLS DECLARE, and one per PICTURE — two formations the engine's own
     * board equality calls equal are one start.
     *
     * THE DECLARATION IS THE DATA, and it is the variant's `formation` rather than its `from`: `from` is free
     * text the corpus's author wrote for a human (`"Lines"`, `"Box"`) and `buildCallImpl` never reads it, while
     * `formation` is the name resolved against `formations.xml` and is `null` when the tam carried its setup
     * inline. An inline setup has no name, so it has no formation to stand up from a name — those are skipped
     * and the level loses nothing, because a formation the corpus does not name is one `recognize` would not
     * caption either.
     *
     * `boardForSetup` RATHER THAN `boardForFormation`, and the difference is the whole point for a board a
     * player is shown: plain geometry plus declared genders comes back with NO home couple for 129 of the 134
     * offered formations (its own header carries that measurement), which is a board whose groups cannot be
     * enumerated. `boardForSetup` puts the canonical couple assignment on top where the registry covers the
     * name, so the four formations a level asks most questions from (Static Square, Normal Lines, Eight Chain
     * Thru, Ocean Waves) arrive with real couples.
     *
     * TWENTY-TWO OF LEVEL 1'S SIXTY-SEVEN DECLARED FORMATIONS RETURN `null` HERE AND THAT IS NOT A GAP. They
     * are the half-set authorings — `Facing Couples`, `Wave RH`, `Box RH`, `Diamond LH`, `Two-Faced Line RH`,
     * `Single Double Pass Thru`, `Opposite Boy`, … — every one authored as TWO dancers, and the engine's
     * completion rule (`library.ts`'s `toWholeSet`) doubles four to eight and deliberately does not double two,
     * because two dancers represent a FOUR-dancer setup ("2 dancers in xml is displayed as 4 dancers"). A drill
     * board is eight dancers, so there is no board to stand up: doubling those four through the origin lands
     * back on the same four. Measured by class over both shipped pools: all 22 at level 1 and all 34 at level 9
     * are two-dancer authorings.
     *
     * THE RETURNED ARRAY IS SHARED AND CALLERS TREAT IT AS READ-ONLY, exactly as `offered`'s is: the generator
     * copies it before shuffling, and nothing else writes to it.
     */
    startBoards(): Board[] {
      if (startCache) return startCache;
      const formations = new Set<string>();
      for (const name of names) {
        for (const variant of seq.getVariants(name) ?? []) {
          if (variant.formation) formations.add(variant.formation);
        }
      }
      // SORTED, so the set does not depend on the order the pool happened to hand its titles over in — the
      // generator shuffles this, and a shuffled list is only reproducible if the list it shuffled is.
      const out: Board[] = [];
      for (const formation of [...formations].sort()) {
        const board = seq.boardForSetup(formation);
        if (!board) continue;
        // DEDUPED WITH THE ENGINE'S OWN BOARD EQUALITY, not with `poseKey`. The two keys differ on purpose: the
        // caches above must be OVER-sensitive (a heading-only difference changes what is legal, so a shared entry
        // would serve a wrong list), while this set must not hold two boards that `sameBoardById` calls equal —
        // those are one picture, and keeping both is a silent double-weighting of that formation in the shuffle.
        // MEASURED over levels 1, 2, 3, 6, 9 and 12: 1-2 such pairs each (two `Ocean Waves` authorings that differ
        // only in their declared genders), and in EVERY one of them the two boards offer the same calls — so this
        // drops a duplicate rather than a variant.
        if (out.some((kept) => sameBoardById(kept, board))) continue;
        out.push(board);
      }
      startCache = out;
      return out;
    },

    /**
     * Every reading of every legal call from `board`, whole board and per group, from the engine's own enumeration
     * (`Sequencer.applicableMoves`) and cached by board signature.
     *
     * THE ENGINE OWNS THE GROUP RULE, which is why this is a delegation rather than a loop over `subsetGroups` and
     * `groupCanPerform` here: the deciding is exactly "can THIS group perform the call from THIS board", which is
     * `groupCanPerform`'s question, and a copy of that walk in the game would be the second implementation AGENTS.md
     * §5 forbids.
     */
    readings(board: Board): MoveReading[] {
      const key = poseKey(board);
      const cached = readingCache.get(key);
      if (cached) return cached;
      const out = seq.applicableMoves(board);
      if (readingCache.size >= READINGS_CACHE_BOARDS) readingCache.clear();
      readingCache.set(key, out);
      return out;
    },

    seedReadings(board: Board, readings: readonly MoveReading[]): void {
      // COPIED, because the caller's array came off a response that is also still holding the puzzle: a later reader
      // that mutated the seed would otherwise edit the wire's own list.
      const key = poseKey(board);
      if (readingCache.size >= READINGS_CACHE_BOARDS) readingCache.clear();
      readingCache.set(key, [...readings]);
    },

    refusalOf(board: Board, call: string): Refusal | null {
      const r = apply(board, call);
      if (r.legal) return null;
      return { call, reason: r.reason ?? `the engine refused ${call} without a reason` };
    },

    apply(board: Board, call: string): Board {
      const r = apply(board, call);
      // THE APPLY PATH IS ONLY REACHED WHEN `refusalOf` SAID YES, so a refusal here means the two
      // answers disagree — which would be a caller using `apply` as a legality test. Rather than
      // returning the unchanged board (a silent "nothing happened", which reads as a no-op call), this
      // throws: the failure mode of a four-valued API is worth a loud one.
      if (!r.legal) throw new Error(`apply(${call}) was refused after refusalOf said it applies: ${r.reason ?? 'no reason'}`);
      return r.board;
    },

    /** The engine's own goal test, passed through — no local tolerance, no second opinion. */
    boardsMatch: sameBoardById,

    nameOf(board: Board): string | null {
      return seq.recognize(board).name;
    },

    /**
     * The engine's own walk of `calls` from `board`: how long it takes, where it stops, and the board at any
     * beat in between.
     *
     * WHY `sequenceBeats` AND `sequenceStop` ARE ASKED ONCE, AT CONSTRUCTION, rather than per frame: they
     * replay the whole list, and a frame loop that asked them 60 times a second would be walking the dance
     * 60 times to ask a question whose answer cannot change — the list and the start board are fixed for the
     * life of this object. `evaluateSequence` is the per-frame call, and the engine memoises its walk by
     * content for exactly that reason.
     *
     * `at()` CLAMPS AND THE ZERO-BEAT CASE IS THE START BOARD. A list whose first call cannot be walked is
     * charged zero beats, so there is nothing to interpolate and the picture must be the board the player is
     * standing on — which is the state DESIGN.md 4.3 asks for: the point it stopped at, plus the engine's
     * own reason from `stop`.
     */
    motion(calls: readonly string[], from: Board): SequenceMotion {
      // A WHOLE-BOARD CALL STEP, which is what a level's titles are: `applyToBoard(board, name)` above reads
      // the same whole-board way, so the drawn motion and the applied board are the same reading of the same
      // call. A SCOPED call ("Heads Lead Right") is not a title in a level's pool, so it cannot arrive here.
      const flat = calls.map((call) => ({ call }));
      const beats = seq.sequenceBeats(flat, from);
      const stop = seq.sequenceStop(flat, from);
      return {
        beats,
        stop,
        at(beat: number): Board {
          if (beats <= 0) return from;
          const clamped = Math.min(Math.max(beat, 0), beats);
          return seq.evaluateSequence(flat, clamped, from).board;
        },
      };
    },
  };
}
