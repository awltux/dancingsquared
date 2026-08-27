// FSM snapshot + delta ledger export. Produces a machine-readable submission for
// integration with a master copy: a full snapshot of the current FSM states and
// edges, plus a delta ledger of every user change (amendments) since baseline.
//
// The snapshot distinguishes build-time-default edges from user-authored
// amendments so a reviewer can see exactly what changed.

import type { FsmAmendment } from './fsm-store.js';

export interface FsmSnapshotEdge {
  call: string;
  endFormation: string | null;
  source: 'build' | 'amendment';
  amendedAt?: string;
}

export interface FsmSnapshotState {
  formation: string;
  edges: FsmSnapshotEdge[];
}

export interface FsmLedgerEntry {
  id: number;
  kind: 'amend' | 'remove' | 'add-formation';
  formation: string;
  call?: string;
  before?: string | null;
  after?: string | null;
  reason: string;
  at: string;
}

export interface FsmExport {
  snapshot: FsmSnapshotState[];
  ledger: FsmLedgerEntry[];
  meta: {
    exportedAt: string;
    stateCount: number;
    edgeCount: number;
    changeCount: number;
  };
}

/**
 * Build the FSM export. `states` is the ordered list of normalised formation
 * names; `buildEdges(formation)` returns the build-time legal edges for that
 * formation; `amendments` are the user changes. Returns a serialisable export.
 */
export function buildFsmExport(
  states: string[],
  buildEdges: (formation: string) => { call: string; endFormation: string | null }[],
  amendments: FsmAmendment[],
  removed: { formation: string; call: string; at: string; reason: string }[] = [],
): FsmExport {
  const snapshot: FsmSnapshotState[] = states.map((formation) => {
    const build = buildEdges(formation);
    const amends = amendments.filter((a) => a.formation === formation);
    const edges: FsmSnapshotEdge[] = [
      ...build.map((e) => ({ call: e.call, endFormation: e.endFormation, source: 'build' as const })),
      ...amends.map((a) => ({
        call: a.call,
        endFormation: a.endFormation,
        source: 'amendment' as const,
        amendedAt: a.at,
      })),
    ];
    return { formation, edges };
  });

  let id = 0;
  const ledger: FsmLedgerEntry[] = [
    ...amendments.map((a): FsmLedgerEntry => ({
      id: ++id,
      kind: 'amend',
      formation: a.formation,
      call: a.call,
      before: null,
      after: a.endFormation,
      reason: a.reason,
      at: a.at,
    })),
    ...removed.map((r): FsmLedgerEntry => ({
      id: ++id,
      kind: 'remove',
      formation: r.formation,
      call: r.call,
      before: r.formation,
      after: null,
      reason: r.reason,
      at: r.at,
    })),
  ];

  const edgeCount = snapshot.reduce((s, st) => s + st.edges.length, 0);
  return {
    snapshot,
    ledger,
    meta: {
      exportedAt: new Date().toISOString(),
      stateCount: snapshot.length,
      edgeCount,
      changeCount: ledger.length,
    },
  };
}
