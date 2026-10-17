// Sequencer data structures.

import type { Gender } from '../types.js';
// A VALUE IMPORT, and it is safe: `selection.ts` imports nothing, so the pair cannot cycle.
import { splitSelection } from './selection.js';

/** A dancer in the sequencer's board, carrying identity. */
export interface SeqDancer {
  id: number; // 1..8 identity
  couple: number; // 1..4 (home couple)
  gender: Gender;
  x: number;
  y: number;
  heading: number; // radians
  // Direction the dancer last turned during the most recent call that rotated
  // them. Non-compositional calls may depend on this remembered direction rather
  // than inferring it from geometry. undefined until a rotating call is applied.
  lastTurnDir?: 'left' | 'right';
  // Ghost (phantom) dancer: a non-physical reference point used to complete
  // phantom/fractional setups. Does not occupy collision space; provides
  // geometric reference for calls defined around a larger matrix.
  isGhost?: boolean;
  ghostAnchor?: number; // id of the physical dancer or virtual axis it is tethered to
}

export interface Board {
  dancers: SeqDancer[]; // 8
  /**
   * CALLERLAB's IMPLICIT ADJUSTMENT, owed to the NEXT call. `Fold` and `Cross Fold` "can create
   * formations that are very unusual at Mainstream", and CALLERLAB's own comment on Fold says
   * callers "generally use implicit adjustments to normalize the formation" — *"Double Pass Thru
   * implicitly tells dancers that they should be in the starting formation for that call (facing
   * Tandems). The Double Pass Thru is danced as if the Tandems were facing, ending normally. This
   * type of implicit adjustment is generally accepted at Mainstream, particularly following Fold or
   * Cross Fold."*
   *
   * The flag is the SCOPE: `foldRule` is its only setter, and any apply result is a freshly built
   * board, so it can only ever authorise the single call that follows a Fold/Cross Fold — which is
   * exactly the scope CALLERLAB gives the convention. It is a permission, not a behaviour: the next
   * call is still matched strictly FIRST, so nothing that works today changes.
   */
  adjustToNextSetup?: boolean;
}

export interface RecognizedFormation {
  name: string | null; // matched named formation, or null if unrecognized
  error: number; // total offset of the best match
  symmetric: boolean;
}

export interface SeqStep {
  call: string;
  legal: boolean;
  reason?: string;
  board: Board;
  formation: RecognizedFormation;
  /**
   * Set for a "while" step that applied: one run per group, carrying the boards each group's calls passed
   * through (`boards[0]` is the step's own start board). A UI that builds a lane needs the board its NEXT
   * call starts on, and this is the apply's own answer rather than a second application of the same calls.
   */
  lanes?: LaneRun[];
}

/**
 * ONE GROUP'S RUN through a "while" step: the dancers it claims, the calls they dance back to back, and the
 * boards between them.
 *
 * `boards.length === calls.length + 1`; `boards[0]` is the step's own start board. A DEFERRED call's lane has
 * two boards beyond the start - the forward half and the resolved one - because that call IS two moves.
 */
export interface LaneRun {
  selection: string;
  ids: number[];
  calls: string[];
  boards: Board[];
}

/** Per-dancer FASR relationship info (by dancer id). */
export interface FasrRelations {
  partner: number | null;
  corner: number | null;
}

export interface Fasr {
  formation: string | null;
  arrangement: string; // e.g. "8 dancers, 4 couples" + gender note
  sequence: 'in' | 'out' | 'unknown'; // in/out of sequence parity
  relationship: Record<number, FasrRelations>;
}

/** A single call step in a sequence/module, optionally with a dancer selection.
 * When `selection` is present it names which dancers act (e.g. "Centers", "Heads",
 * "Boys", "All"); the base `call` then applies to that subset. Absent selection
 * means the call applies to the whole board. */
export interface CallStep {
  selection?: string;
  call: string;
}

/**
 * A step performed by SEVERAL GROUPS AT ONCE - CALLERLAB's "Centers Square Thru while Outsides
 * Trade".
 *
 * WHY IT IS A STEP AND NOT A SEQUENCE. The construct is SIMULTANEOUS, so it cannot be expressed as
 * one call (the engine would have to hand-author every combination as a `<tam>`'s per-dancer paths,
 * which is what the catalogue does today and why the structure is invisible) and it cannot be
 * expressed as a list (a list is sequential). It is one step whose groups each dance their own calls.
 *
 * THE RULES, decided rather than discovered:
 *   - groups must be pairwise DISJOINT; an overlap is refused with a reason, because one dancer cannot
 *     be in two places in one step;
 *   - the union need NOT cover the board; a dancer in no group stands, which mirrors
 *     `partitionPartial`'s reading of "a call acts on everyone it applies to";
 *   - the step is ATOMIC: if any group's call is illegal, the whole step refuses with that group's
 *     reason. A partially-danced "while" is not a thing a caller can call;
 *   - a lane names CALLS, not a module (see below).
 *
 * A GROUP IS A LANE: the calls it dances BACK TO BACK, from the step's start. Asked for as: "how
 * difficult would it be to allow multiple calls in a parallel set. If heads take 16 beats to do one
 * call, the sides could do two 4-beat calls."
 *
 * AND THAT IS THE SYNCHRONISATION RULE, which this construct used to refuse outright - its comment
 * said "two composite routines of different lengths have no defined alignment, so allowing them would
 * invent a synchronisation rule the art does not have." The rule the art does have is this one:
 *
 *   - every lane starts at beat 0, so the lanes are simultaneous;
 *   - a lane's calls run consecutively, each starting where the one before it left the group;
 *   - the step costs the LONGEST lane, and a lane that finishes early STANDS at its own end pose until
 *     the step is over - the same reading `stepBeats` and `evaluateGroupAt` already give a group
 *     inside a longer "while";
 *   - there are NO synchronisation points BETWEEN lanes. Nothing can make one lane's call start at
 *     beat 6 of another lane's call, and nothing can make the lanes' totals agree: the engine reports
 *     the difference, it does not remove it. A caller who wants a call to land at a particular moment
 *     has to express that as beats, not as an alignment.
 *
 * A LANE STILL NAMES CALLS AND NOT A MODULE, which is the half of the old rule that survives: a module
 * is a second kind of sequence object with its own expansion, its own cycle guard and its own start
 * formation, and a lane would need all three again. A lane can say everything a module would say about
 * this step by listing the calls.
 */
export interface GroupLane {
  selection: string;
  /** The calls this group dances, in order. A lane of one is the ordinary "while" group. */
  calls: string[];
}

/** A group's lane as it was stored before lanes existed (and as a caller's saved module may still hold). */
export interface LegacyGroupLane {
  selection: string;
  call: string;
}

export interface GroupStep {
  groups: (GroupLane | LegacyGroupLane)[];
}

/**
 * THE CALLS A LANE NAMES, in order - reading the LEGACY single-`call` lane as a one-call lane.
 *
 * WHY THE LEGACY FORM IS READ AT ALL, and not migrated away: a "while" step can be SAVED as a module
 * (`sequencer-ui.saveModule` stores the raw history in localStorage), so `{selection, call}` lanes are
 * already in callers' browsers. One reader for both shapes is cheaper and safer than a migration, and
 * the canonical writer never produces the old form again.
 */
export function groupCalls(lane: GroupLane | LegacyGroupLane): string[] {
  return 'calls' in lane ? lane.calls : [lane.call];
}

/** The canonical shape of a lane: one place the legacy form is upgraded, so nothing downstream sees it. */
export function normalizeGroupLane(lane: GroupLane | LegacyGroupLane): GroupLane {
  return { selection: lane.selection, calls: groupCalls(lane) };
}

export type ModuleStep = string | CallStep | GroupStep;

/** Whether a step is the simultaneous-group form. */
export function isGroupStep(step: ModuleStep): step is GroupStep {
  return typeof step !== 'string' && 'groups' in step;
}

/** The call a step names, or null for a grouped step (which names several). */
export function stepCall(step: ModuleStep): string | null {
  return typeof step === 'string' ? step : isGroupStep(step) ? null : step.call;
}

/** The selection a step carries, or null. */
export function stepSelection(step: ModuleStep): string | null {
  return typeof step === 'string' ? null : isGroupStep(step) ? null : step.selection ?? null;
}

/** A stable label for a step - for replay keys, stop reports and error messages.
 *
 *  A LANE'S CALLS COMBINE WITH "+", GROUPS WITH "||", AND A GROUP'S SCOPE IS BRACKETED. Asked for in as
 *  many words: "Display the parallel lines of the calls list using symbols '||' for parallel, '+' for
 *  sequential combine, brackets to indicate scope e.g. `call 1 || ( call 2 + call 3 ) || (call 4 + call 5)`".
 *  So a group of one call is written bare (`Sides Trade`) and a group of several is bracketed
 *  (`Sides ( Trade + Pass Thru )`), which is what makes the SCOPE of the brackets visible: they wrap
 *  exactly the calls that run one after another, and everything between two `||` happens at the same time.
 *  The group's own selection stays in front of its bracket, so the grammar says WHO as well as WHEN:
 *
 *    `Heads Promenade Full || Sides ( Trade + Touch a Quarter )`
 *
 *  THE SELECTION IS STATED ONCE PER GROUP, which is the rule the previous "then"/"while" wording kept
 *  ("Sides Trade then Pass Thru"), and the words were replaced rather than added to: a label that spells
 *  the same thing two ways is one more thing for the pane to disagree about. Every consumer of this
 *  function treats it as opaque text (a message, or a replay cache key joined on NUL), so the punctuation
 *  is free to change. */
export function stepLabel(step: ModuleStep): string {
  if (typeof step === 'string') return step;
  if (!isGroupStep(step)) return `${step.selection ? step.selection + ' ' : ''}${step.call}`;
  return step.groups
    .map((g) => {
      const calls = groupCalls(g);
      const body = calls.length > 1 ? `( ${calls.join(' + ')} )` : calls[0] ?? '(no call)';
      return `${g.selection} ${body}`;
    })
    .join(' || ');
}

/**
 * The STEP a label names — the inverse of `stepLabel`, for a caller that carries a step as text.
 *
 * WHY THIS EXISTS. A step can already be applied as a `ModuleStep` (`Sequencer.applyToBoard` takes one), but the only
 * way to WRITE one down was `stepLabel`, which produced text nothing read back. The game's Daily needs the inverse: its
 * line is a list of strings (that is what the wire carries and what the server replays), so a parallel step — two
 * groups dancing different calls at once — has to survive as text. `game/src/engine/applier.ts` is the first caller.
 *
 * IT IS DELIBERATELY PARTIAL, and it says so by returning null rather than guessing:
 *   * a label with NO ` || ` is returned as a plain step string — the applicator reads a selection out of a call name
 *     itself, so `Heads Dosado` needs no decomposition here;
 *   * a part of the form `Selection ( A + B )` becomes a lane of two calls, and a part of the form `Selection A` a lane
 *     of one;
 *   * a part with an unbalanced bracket, an empty selection or an empty call is null, because a label that cannot be
 *     read back is a caller's bug and a silent fallback would turn it into a wrong dance.
 *
 * ROUND TRIP IS THE CONTRACT THIS SHARES WITH `stepLabel`: `stepLabel(parseStep(x))` must equal `x` for every label
 * `stepLabel` produces. `engine/test/step-parse.mjs` measures it, and also that the PARSED step applies to the same
 * board as the original.
 */
export function parseStep(label: string): ModuleStep | null {
  const text = label.trim();
  if (text === '') return null;
  const parts = text.split(' || ');
  if (parts.length === 1) return text;
  const groups: GroupLane[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (part === '') return null;
    const bracketed = /^(.+?)\s+\(\s*(.+?)\s*\)$/.exec(part);
    if (bracketed) {
      const selection = bracketed[1].trim();
      const calls = bracketed[2].split(' + ').map((call) => call.trim());
      if (selection === '' || calls.length < 2 || calls.some((call) => call === '')) return null;
      groups.push({ selection, calls });
      continue;
    }
    // THE BARE FORM: the selection is the longest group prefix that leaves a call behind — `splitSelection`'s rule,
    // which is why this calls it rather than splitting on the first space (`Head Boys Dosado` is a two-word selection
    // and a one-word call, and the naive split would read it backwards).
    const spec = splitSelection(part);
    if (!spec.selection || spec.call === '') return null;
    // A CALL THAT STARTS WITH A BRACKET IS A LANE WHOSE BRACKET DID NOT CLOSE. The bracket form is matched above; a part
    // that reaches here still carrying one is malformed, and reading it as a call name would hand the applicator
    // `"( Trade"` as a call.
    if (spec.call.startsWith('(') || spec.call.endsWith(')')) return null;
    groups.push({ selection: spec.selection, calls: [spec.call] });
  }
  return { groups };
}

/** A user-defined module: a named sequence of calls used as a fix/getout. Each
 * call may carry an optional dancer selection. */
export interface Module {  name: string;
  calls: ModuleStep[];
  level?: string;
  tags?: string[];
  notes?: string;
}

/** A matched call variant plus the rigid transform (rotation/reflection + both
 * centers) that overlays its canonical setup onto the board. */
export interface VariantMatch {
  variant: import('../types.js').CallBundle;
  mapping: number[];
  error: number;
  rot: number;
  reflect: boolean;
  cSrc: { x: number; y: number };
  cTgt: { x: number; y: number };
}
