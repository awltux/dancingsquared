// Build-time FSM transition table: a concrete adjacency store mapping each
// normalised formation STATE to its outgoing EDGES (calls/modules). Built once
// at build time, with user amendments merged in afterwards.
//
// This makes the state machine a real, held data structure (not derived on every
// call) that can be queried and exported.

import type { FsmAmendment } from './fsm-store.js';
import type { FsmExport } from './fsm-export.js';
import { buildFsmExport } from './fsm-export.js';

/**
 * HOW MUCH OF THE BOARD the application actually moved.
 *
 * A call applied to eight dancers is not always performed by everyone. `parallelApply` can tile the
 * board into copies of a variant SMALLER than a board - four copies of a two-dancer pair, two copies
 * of a four-dancer box - and when only some boxes match it falls back to `partitionPartial` and leaves
 * the rest STANDING. So every legal application has a reading, and they are not equivalent:
 *
 *   whole        the whole board matched one variant (the ordinary case)
 *   full-tiling  EVERY dancer is in a copy (the call was done by all eight through k-dancer boxes)
 *   partial      SOME boxes matched and the rest of the board stood still
 *
 * THE FSM STORED NONE OF IT until schema 2, and the cost was concrete: an edge's identity is the CALL
 * alone (one edge per (state, call), which `FsmTable.build`'s dedupe, `FsmStore`'s `${formation}|${call}`
 * key and `fsm-view`'s `(call, endFormation)` dedupe all assume), so a PARTIAL reading was stored as
 * though the whole board did the call. MEASURED at ms: 349 of 1885 legal applications are partial, over
 * 23 boards, and 386 are sub-eight readings that covered ALL EIGHT dancers - the opposite failure, a
 * call performed by everyone and stored as though it were a whole-board call of a different shape.
 *
 * `undefined` means NOT MEASURED, which is the honest value for an amendment edge: `FsmAmendment` is a
 * person asserting a transition, and no applicator result is consulted when the edge is merged in.
 */
export type FsmReading = 'whole' | 'full-tiling' | 'partial';

/**
 * WHERE THE EDGE LANDS, and - when `endFormation` is null - WHY it has no target.
 *
 * This is the axis Stage 0b created and nothing could see. Before the level scope, a null end meant one
 * thing: the end board is not a formation the engine knows. After it, there are two, and they call for
 * opposite responses:
 *
 *   state         the end IS a state of this table (`endFormation` is set)
 *   out-of-scope  the corpus NAMES this formation, but this table does not model it as a state,
 *                 because the level scope removed it (Stage 0b). A LATER LEVEL COULD MAKE IT A NODE.
 *   novel         nothing in the corpus declares this geometry - the end is a board the vocabulary has
 *                 no name for at all. `test/tools/cell-census.mjs` measures these as the 55% of
 *                 applications that end off the declared lattice.
 *
 * `endKind !== 'state'` is what the plan calls a TRANSIENT: an edge that leaves the modelled cell graph.
 * Stage 3 absorbs these with module edges whose start and end are both cells, which is what keeps a
 * transient from ever becoming a node - and the `out-of-scope` count is the number of those that a
 * level bump would close instead.
 */
export type FsmEndKind = 'state' | 'out-of-scope' | 'novel';

export interface FsmTableEdge {
  call: string;
  endFormation: string | null;
  /** How much of the board the application moved. Absent on amendment edges - not measured. */
  reading?: FsmReading;
  /** Where the end is, and why there is none. See `FsmEndKind`. */
  endKind: FsmEndKind;
  /** Net orientation change in eighth-turn (45-degree) steps; positive = CCW. */
  orientationDelta: number;
  source: 'build' | 'amendment';
  amendedAt?: string;
}

/**
 * Version of the persisted table format. Bump when the shape changes.
 *
 * 2 adds `reading` and `endKind` to every edge. `load` accepts ONLY the current version, so a stored v1
 * asset is refused rather than read with the new fields silently absent - the same rule as before, and
 * the reason `poc/src/assets/fsm-ms.json` is regenerated in the same change.
 */
export const FSM_TABLE_SCHEMA_VERSION = 2;

/** The persisted (serialised) form of an FsmTable. */
export interface FsmTableData {
  schemaVersion: number;
  states: string[];
  edges: Record<string, FsmTableEdge[]>;
  amendments: FsmAmendment[];
  builtAt: string;
}

/**
 * The build-time transition table. Holds `state -> edges[]`. States are the
 * unique normalised formations; build-time edges are enumerated once; user
 * amendments are merged in (and re-mergable after more amendments are added).
 */
export class FsmTable {
  private constructor(
    private readonly stateOrder: string[],
    private readonly amendments: Map<string, FsmAmendment>,
    private readonly adjacency: Map<string, FsmTableEdge[]>,
  ) {}

  /** Build the table from a full enumeration of build-time edges. */
  static build(
    states: string[],
    enumerate: (state: string) => Omit<FsmTableEdge, 'source'>[],
    amendments: FsmAmendment[] = [],
  ): FsmTable {
    const table = new FsmTable(states, new Map(amendments.map((a) => [`${a.formation}|${a.call}`, a])), new Map());
    for (const state of states) {
      const build = enumerate(state);
      const amends = amendments.filter((a) => a.formation === state);
      table.adjacency.set(
        state,
        [
          ...build.map((e) => ({ ...e, source: 'build' as const })),
          ...amends.map((a): FsmTableEdge => ({
            call: a.call,
            endFormation: a.endFormation,
            // NO `reading`: an amendment is a person asserting a transition, and no applicator result is
            // consulted here. `FsmStore.amend` DOES apply the call before accepting, but the reading is
            // not carried on `FsmAmendment` - recording `'whole'` would be inventing a measurement.
            //
            // `'state'` because the amendment path refuses an end that `knownFormation` cannot name, so
            // the end IS a formation - whether it is a state of THIS table is what the dangling check in
            // `test/behaviour-audit.mjs` asserts.
            endKind: 'state',
            orientationDelta: 0,
            source: 'amendment',
            amendedAt: a.at,
          })),
        ].filter((e, i, arr) => arr.findIndex((x) => x.call === e.call) === i), // dedupe by call
      );
    }
    return table;
  }

  /** Reconstruct a table from previously-serialised data. Returns null when the
   * data is malformed or has an unsupported schema version. */
  static load(data: FsmTableData | string): FsmTable | null {
    let d: FsmTableData;
    try {
      d = typeof data === 'string' ? (JSON.parse(data) as FsmTableData) : data;
    } catch {
      return null;
    }
    if (!d || d.schemaVersion !== FSM_TABLE_SCHEMA_VERSION || !Array.isArray(d.states)) return null;
    const adjacency = new Map<string, FsmTableEdge[]>();
    for (const s of d.states) adjacency.set(s, (d.edges?.[s] ?? []).map((e) => ({ ...e })));
    const amendments = new Map<string, FsmAmendment>();
    for (const a of d.amendments ?? []) amendments.set(`${a.formation}|${a.call}`, a);
    return new FsmTable([...d.states], amendments, adjacency);
  }

  /** The persisted (serialised) form of this table. */
  serialize(): FsmTableData {
    const edges: Record<string, FsmTableEdge[]> = {};
    for (const [state, list] of this.adjacency) edges[state] = list.map((e) => ({ ...e }));
    return {
      schemaVersion: FSM_TABLE_SCHEMA_VERSION,
      states: [...this.stateOrder],
      edges,
      amendments: [...this.amendments.values()],
      builtAt: new Date().toISOString(),
    };
  }

  /** Convenience: serialise to a JSON string. */
  toJSON(): string {
    return JSON.stringify(this.serialize());
  }

  /** Merge additional amendments in, deduping by (state, call). */
  merge(amendments: FsmAmendment[]): void {
    for (const a of amendments) {
      this.amendments.set(`${a.formation}|${a.call}`, a);
      const list = this.adjacency.get(a.formation);
      if (!list) continue;
      const existing = list.find((e) => e.call === a.call);
      if (existing) {
        existing.source = 'amendment';
        existing.endFormation = a.endFormation;
        // `reading` is KEPT by design: it is a measurement of applying the call from that state, and it
        // is still true of that application. What the amendment changes is the END the edge is recorded
        // as reaching, not whether the call moved the whole board.
        existing.endKind = 'state';
        existing.amendedAt = a.at;
      } else {
        list.push({ call: a.call, endFormation: a.endFormation, endKind: 'state', orientationDelta: 0, source: 'amendment', amendedAt: a.at });
      }
    }
  }

  /** All states in the table. */
  states(): string[] {
    return this.stateOrder;
  }

  /** The outgoing edges for a state (build-time + merged amendments). */
  edgesFor(state: string): FsmTableEdge[] {
    return this.adjacency.get(state) ?? [];
  }

  /** Whether `call` is an outgoing edge from `state`. */
  hasTransition(state: string, call: string): boolean {
    return (this.adjacency.get(state) ?? []).some((e) => e.call === call);
  }

  /** Total number of states. */
  stateCount(): number {
    return this.stateOrder.length;
  }

  /** Total number of edges across all states. */
  edgeCount(): number {
    let n = 0;
    for (const list of this.adjacency.values()) n += list.length;
    return n;
  }

  /** Export the table as a snapshot + delta ledger. */
  exportFsm(): FsmExport {
    const buildEdges = (state: string) =>
      this.edgesFor(state)
        .filter((e) => e.source === 'build')
        .map((e) => ({ call: e.call, endFormation: e.endFormation }));
    return buildFsmExport(this.stateOrder, buildEdges, [...this.amendments.values()]);
  }
}
