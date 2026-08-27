// FSM user amendment store. Lets a user mark a call as valid from a particular
// formation when the build-time enumerator did not list it. Amendments are gated
// by the same validity checks the build uses: applying the call must land in a
// recognised formation, a getout must still exist from that end, and the dancers
// must not collide. An amendment that fails those checks is rejected.

import type { Board } from './types.js';
import type { CallApplicator } from './applicator.js';
import type { FormationMatcher } from './matcher.js';
import type { HomeSolver } from './solver.js';

export interface FsmAmendment {
  formation: string; // normalised formation name
  call: string; // call name
  endFormation: string | null; // formation the call lands in (after apply)
  reason: string;
  at: string; // ISO timestamp
}

export class FsmStore {
  private readonly amendments = new Map<string, FsmAmendment>();

  constructor(
    private readonly applicator: CallApplicator,
    private readonly matcher: FormationMatcher,
    private readonly solver: HomeSolver,
  ) {}

  key(formation: string, call: string): string {
    return `${formation}|${call}`;
  }

  /** Try to add a user amendment: apply `call` from a synthetic board at
   * `formation` and validate the result. Returns ok=false with a reason when the
   * amendment is invalid (unrecognised end, no getout, or a collision). */
  amend(formation: string, call: string, syntheticBoard: Board): { ok: boolean; reason?: string; amendment?: FsmAmendment } {
    const k = this.key(formation, call);
    if (this.amendments.has(k)) {
      return { ok: true, amendment: this.amendments.get(k) };
    }
    const res = this.applicator.applyToBoard(syntheticBoard, call);
    if (!res.legal) {
      return { ok: false, reason: `"${call}" is not applicable from ${formation}.` };
    }
    const end = this.matcher.knownFormation(res.board);
    if (end === null) {
      return { ok: false, reason: `"${call}" from ${formation} does not land in a recognised formation.` };
    }
    if (this.solver.getout(res.board, { maxCalls: 4 }) === null) {
      return { ok: false, reason: `"${call}" from ${formation} ends in a formation with no getout.` };
    }
    // Collision check on physical dancers.
    const collides = this.anyCollision(res.board);
    if (collides) {
      return { ok: false, reason: `"${call}" from ${formation} would collide dancers.` };
    }
    const amendment: FsmAmendment = {
      formation,
      call,
      endFormation: end,
      reason: 'user amendment',
      at: new Date().toISOString(),
    };
    this.amendments.set(k, amendment);
    return { ok: true, amendment };
  }

  isAmended(formation: string, call: string): boolean {
    return this.amendments.has(this.key(formation, call));
  }

  get(formation: string, call: string): FsmAmendment | undefined {
    return this.amendments.get(this.key(formation, call));
  }

  all(): FsmAmendment[] {
    return [...this.amendments.values()];
  }

  remove(formation: string, call: string): boolean {
    return this.amendments.delete(this.key(formation, call));
  }

  clear(): void {
    this.amendments.clear();
  }

  private anyCollision(board: Board): boolean {
    const ds = board.dancers.filter((d) => !d.isGhost);
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++)
        if (Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y) < 1e-3) return true;
    return false;
  }
}
