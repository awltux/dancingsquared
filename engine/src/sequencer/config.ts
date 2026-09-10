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

  /** Whether to collect `SearchStats`. Off by default: the counters sit on the hottest
   * path in the engine, and only a measurement wants them. */
  collectStats = false;

  /** Whether the getout search uses a collapsed-module fast-path (a module that
   * is rigid and self-inverse from home returns home in one step). */
  useCollapsedModules = true;

  /** Injectable random source for the probabilistic selection (tests). */
  rand: () => number = Math.random;
}

/**
 * What a search actually cost, in the terms that matter for its complexity.
 *
 * Exists because TIMING ALONE CANNOT TELL THE TWO COSTS APART. A getout node pays for one
 * catalogue scan (`candidateScans`) plus, with equivalents on, one MORE catalogue scan per
 * distinct end board it produced (`equivalentNameIterations`). Those are the C and the L x C
 * terms; a change that halves L and a change that removes the C factor look identical in a
 * stopwatch and completely different here. The numbers below are what identified the fix.
 *
 * Collected only when `collectStats` is on, since the counters sit on the hottest path in the
 * engine.
 */
export interface SearchStats {
  /** Nodes the DFS expanded. */
  nodes: number;
  /** `searchLegalCalls` calls - each is ONE scan of the whole catalogue. */
  candidateScans: number;
  /** `equivalentCalls` calls. Each re-scanned the whole catalogue, so this is the L in L x C. */
  equivalentScans: number;
  /** Catalogue names visited inside equivalents - the L x C term itself. */
  equivalentNameIterations: number;
  /** Calls that survived the tight prefilter, summed over nodes. */
  candidateCalls: number;
  /** Distinct end boards per node, summed over nodes. */
  distinctEndBoards: number;
  /** Wall-clock for the whole search. */
  elapsedMs: number;
}

export function emptySearchStats(): SearchStats {
  return {
    nodes: 0,
    candidateScans: 0,
    equivalentScans: 0,
    equivalentNameIterations: 0,
    candidateCalls: 0,
    distinctEndBoards: 0,
    elapsedMs: 0,
  };
}
