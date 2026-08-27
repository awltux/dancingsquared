// Shared mutable configuration for the sequencer and its collaborators. The
// Sequencer's public setters write to a single instance that is read by the
// matcher / applicator / solvers, so tuning values flow to every collaborator
// without passing them through each call.

export class SequencerConfig {
  /** Extra matching tolerance (position units) added to the default when
   * matching a board against a next call's start setup and when checking whether
   * a result lands in a known formation. */
  matchMargin = 0;

  /** How much of the difference between the board's current position and the
   * call's canonical start is absorbed when the call is applied (0..1). */
  rebaseFactor = 1;

  /** How far (position units) a computed end board may be from a recognized
   * formation before it is snapped onto that formation's canonical slots. */
  snapMaxError = 1.0;

  /** How the INTERACTIVE apply path chooses among viable interpretations when
   * more than one matches a call. */
  selectionMode: 'best' | 'probabilistic' = 'best';

  /** Whether the getout/getin/fixIt SEARCH also considers calls that are
   * equivalent to each candidate (same end formation), widening the search. */
  useEquivalents = true;

  /** Whether the getout search uses a collapsed-module fast-path (a module that
   * is rigid and self-inverse from home returns home in one step). */
  useCollapsedModules = true;

  /** Injectable random source for the probabilistic selection (tests). */
  rand: () => number = Math.random;
}
