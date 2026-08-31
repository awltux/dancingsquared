// Build-time FSM transition table: a concrete adjacency store mapping each
// normalised formation STATE to its outgoing EDGES (calls/modules). Built once
// at build time, with user amendments merged in afterwards.
//
// This makes the state machine a real, held data structure (not derived on every
// call) that can be queried and exported.

import type { FsmAmendment } from './fsm-store.js';
import type { FsmExport } from './fsm-export.js';
import { buildFsmExport } from './fsm-export.js';

export interface FsmTableEdge {
  call: string;
  endFormation: string | null;
  /** Net orientation change in eighth-turn (45-degree) steps; positive = CCW. */
  orientationDelta: number;
  source: 'build' | 'amendment';
  amendedAt?: string;
}

/** Version of the persisted table format. Bump when the shape changes. */
export const FSM_TABLE_SCHEMA_VERSION = 1;

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
        existing.amendedAt = a.at;
      } else {
        list.push({ call: a.call, endFormation: a.endFormation, orientationDelta: 0, source: 'amendment', amendedAt: a.at });
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
