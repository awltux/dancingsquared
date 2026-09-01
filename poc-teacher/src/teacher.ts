// Teacher Session Tracker (PRD item 15) — pure, headless-testable core.
//
// The domain logic lives in two classes:
//   - TeacherModel: operations on a single ClassInstance (sessions, attendance,
//     problems, students, teaching progress).
//   - TipGenerator: generates / edits practice tips using the engine Sequencer.
// The module-level functions below are thin facades kept for backward
// compatibility (used by main.ts, view.ts and the verify script); each
// delegates to the class.

import { Sequencer } from 'dancing-squared-engine';

// ---------------------------------------------------------------- model types

export interface Student {
  id: string;
  name: string;
}

/** A call at a specific setup (the position it is practised from). */
export interface CallRef {
  title: string; // call name as registered in the sequencer
  level: string;
  setupIdx: number; // 0..setups.length-1
  setup: string; // display label of the setup (e.g. "Static Square")
}

export interface Attendance {
  [studentId: string]: boolean; // true = present
}

/** A call-setup a student/class struggles with. Higher priority = practise more. */
export interface Problem {
  title: string;
  setupIdx: number;
  priority: number; // >=1
  note?: string;
}

export interface SessionPlan {
  id: string;
  name: string;
  level: string;
  planned: CallRef[]; // calls planned for this session
  taught: CallRef[]; // calls actually taught
  attendance: Attendance;
  problems: Problem[];
  /** Removed prioritisations kept for reference, keyed by `title#setupIdx`. */
  prioritisedArchive?: Record<string, { priority: number; note?: string }>;
  completed?: boolean; // teacher marked this session complete
  /** Snapshot of taught/planned call-positions captured on first completion. */
  capturedTaught?: CallRef[];
  capturedPlanned?: CallRef[];
  capturedAt?: number;
}

export interface ClassInstance {
  id: string;
  name: string;
  level: string;
  students: Student[];
  sessions: SessionPlan[]; // ordered
}

export interface Tip {
  name: string;
  sourceSessionId: string;
  titles: string[]; // the call sequence
}

export const refKey = (r: { title: string; setupIdx: number }): string => `${r.title}#${r.setupIdx}`;

/** Whether a call-position is already present (planned or taught) in a session. */
function hasCallPosition(s: SessionPlan, r: { title: string; setupIdx: number }): boolean {
  const k = refKey(r);
  return s.planned.some((x) => refKey(x) === k) || s.taught.some((x) => refKey(x) === k);
}

/** Remove duplicate call-positions from a list, keeping the first occurrence. */
export function dedupeCallRefs<T extends { title: string; setupIdx: number }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const k = refKey(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function nextSessionFor(cls: ClassInstance, s: SessionPlan): SessionPlan {
  let next = cls.sessions[cls.sessions.indexOf(s) + 1];
  if (!next) {
    next = {
      id: `${s.id}-n${cls.sessions.length + 1}`,
      name: `Session ${cls.sessions.length + 1}`,
      level: s.level,
      planned: [],
      taught: [],
      attendance: {},
      problems: [],
    };
    cls.sessions.push(next);
  }
  return next;
}

// ---------------------------------------------------------------- TeacherModel

/** Domain operations over a single ClassInstance. */
export class TeacherModel {
  private readonly cls: ClassInstance;

  constructor(cls: ClassInstance) {
    this.cls = cls;
  }

  /** All distinct call titles taught in sessions 0..sessionIdx (current + previous). */
  availableTitles(sessionIdx: number): Set<string> {
    const set = new Set<string>();
    for (let i = 0; i <= sessionIdx; i++) {
      for (const ref of this.cls.sessions[i].taught) set.add(ref.title);
    }
    return set;
  }

  /** Move every planned call of `sessionIdx` into the next session's plan. */
  rollUntaughtForward(sessionIdx: number): void {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return;
    const next = nextSessionFor(this.cls, s);
    next.planned = dedupeCallRefs([...next.planned, ...s.planned]);
    s.planned = [];
  }

  /** Carry every prioritised (starred) call-position of `sessionIdx` into the next
   * session's plan, keeping its priority/note. Returns the number carried. */
  rollPrioritisedForward(sessionIdx: number): number {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return 0;
    const pool = [...s.planned, ...s.taught];
    const prioCalls = s.problems
      .map((p) => ({ p, ref: pool.find((r) => r.title === p.title && r.setupIdx === p.setupIdx) }))
      .filter((x): x is { p: Problem; ref: CallRef } => !!x.ref);
    if (!prioCalls.length) return 0;
    const next = nextSessionFor(this.cls, s);
    let moved = 0;
    for (const { p, ref } of prioCalls) {
      if (hasCallPosition(next, ref)) continue;
      next.planned.push(ref);
      const idx = next.problems.findIndex((q) => q.title === p.title && q.setupIdx === p.setupIdx);
      if (idx === -1) next.problems.push({ title: p.title, setupIdx: p.setupIdx, priority: p.priority, note: p.note });
      else next.problems[idx].priority = Math.max(next.problems[idx].priority, p.priority);
      moved++;
    }
    return moved;
  }

  /** For a call-position taught by `sessionIdx`, build the missed note grouped by session. */
  missedNote(sessionIdx: number, ref: CallRef): string {
    const lines: string[] = [];
    for (let j = 0; j <= sessionIdx; j++) {
      const s = this.cls.sessions[j];
      if (!s.taught.some((r) => refKey(r) === refKey(ref))) continue;
      const names = this.cls.students.filter((st) => !s.attendance[st.id]).map((st) => st.name);
      if (names.length) lines.push(`${s.name}: Missed by ${names.join(', ')}`);
    }
    return lines.join('\n');
  }

  /** Complete a session: move the plan forward and carry missed/starred calls as
   * priorities. Returns counts. */
  completeSession(sessionIdx: number): { movedPlanned: number; carried: number } {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return { movedPlanned: 0, carried: 0 };
    if (!s.capturedAt) {
      s.capturedTaught = [...s.taught];
      s.capturedPlanned = [...s.planned];
      s.capturedAt = Date.now();
    }
    const next = nextSessionFor(this.cls, s);
    const plannedRefs = [...s.planned];
    const taughtRefs = [...s.taught];

    next.planned = dedupeCallRefs([...next.planned, ...plannedRefs]);
    s.planned = [];

    const toCarry = new Map<string, { ref: CallRef; note: string; priority: number }>();
    const add = (ref: CallRef, note: string, priority: number) => {
      const k = refKey(ref);
      const ex = toCarry.get(k);
      if (!ex) toCarry.set(k, { ref, note, priority });
      else {
        ex.priority = Math.max(ex.priority, priority);
        if (note) ex.note = ex.note ? `${ex.note}\n${note}` : note;
      }
    };
    for (const p of s.problems) {
      const ref = [...plannedRefs, ...taughtRefs].find((r) => r.title === p.title && r.setupIdx === p.setupIdx);
      if (ref) add(ref, p.note ?? '', p.priority);
    }
    for (const t of taughtRefs) {
      const note = this.missedNote(sessionIdx, t);
      if (note) add(t, note, 3);
    }

    let carried = 0;
    for (const { ref, note, priority } of toCarry.values()) {
      if (hasCallPosition(next, ref)) continue;
      next.planned.push(ref);
      const idx = next.problems.findIndex((q) => q.title === ref.title && q.setupIdx === ref.setupIdx);
      if (idx === -1) next.problems.push({ title: ref.title, setupIdx: ref.setupIdx, priority, note });
      else {
        next.problems[idx].priority = Math.max(next.problems[idx].priority, priority);
        if (note) next.problems[idx].note = next.problems[idx].note ? `${next.problems[idx].note}\n${note}` : note;
      }
      carried++;
    }
    return { movedPlanned: plannedRefs.length, carried };
  }

  /** If one or more students were absent from `sessionIdx`, carry the calls taught
   * that session into the next session's plan, tagged with a missed note. */
  rollMissedCallsForward(sessionIdx: number): number {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return 0;
    const next = nextSessionFor(this.cls, s);
    let moved = 0;
    for (const r of s.taught) {
      const note = this.missedNote(sessionIdx, r);
      if (!note) continue;
      if (hasCallPosition(next, r)) continue;
      next.planned.push(r);
      const idx = next.problems.findIndex((p) => p.title === r.title && p.setupIdx === r.setupIdx);
      if (idx === -1) next.problems.push({ title: r.title, setupIdx: r.setupIdx, priority: 3, note });
      else if (note) next.problems[idx].note = next.problems[idx].note ? `${next.problems[idx].note}\n${note}` : note;
      moved++;
    }
    return moved;
  }

  /** Pull `count` planned calls from the next session's plan into THIS session's plan. */
  pullForward(sessionIdx: number, count: number): void {
    const s = this.cls.sessions[sessionIdx];
    const next = this.cls.sessions[sessionIdx + 1];
    if (!s || !next || count <= 0) return;
    const isPrio = (r: CallRef) =>
      next.problems.some((p) => p.title === r.title && p.setupIdx === r.setupIdx);
    const prio = next.planned.filter(isPrio);
    const normal = next.planned.filter((r) => !isPrio(r));
    const taken: CallRef[] = [];
    for (const r of [...prio, ...normal]) {
      if (taken.length >= count) break;
      if (!hasCallPosition(s, r)) taken.push(r);
    }
    const takenKeys = new Set(taken.map(refKey));
    next.planned = next.planned.filter((r) => !takenKeys.has(refKey(r)));
    for (const r of taken) {
      const pi = next.problems.findIndex((q) => q.title === r.title && q.setupIdx === r.setupIdx);
      if (pi === -1) continue;
      const p = next.problems[pi];
      next.problems.splice(pi, 1);
      const si = s.problems.findIndex((q) => q.title === r.title && q.setupIdx === r.setupIdx);
      if (si === -1) s.problems.push({ title: r.title, setupIdx: r.setupIdx, priority: p.priority, note: p.note });
      else {
        s.problems[si].priority = Math.max(s.problems[si].priority, p.priority);
        if (p.note) s.problems[si].note = p.note;
      }
    }
    s.planned.push(...taken);
  }

  /** Set (or clear) a call-setup as prioritised (problem) practice. */
  setProblem(sessionIdx: number, title: string, setupIdx: number, priority: number, note: string, on: boolean): void {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return;
    const key = refKey({ title, setupIdx });
    const idx = s.problems.findIndex((p) => p.title === title && p.setupIdx === setupIdx);
    if (on) {
      if (idx === -1) s.problems.push({ title, setupIdx, priority, note });
      else {
        s.problems[idx].priority = priority;
        s.problems[idx].note = note;
      }
    } else if (idx !== -1) {
      s.prioritisedArchive ??= {};
      s.prioritisedArchive[key] = { priority: s.problems[idx].priority, note: s.problems[idx].note };
      s.problems.splice(idx, 1);
    }
  }

  /** The archived note (if any) for a call-setup previously prioritised. */
  archivedNote(sessionIdx: number, title: string, setupIdx: number): string | undefined {
    return this.cls.sessions[sessionIdx]?.prioritisedArchive?.[refKey({ title, setupIdx })]?.note;
  }

  /** Add a student to the class and to every session's register (absent by default). */
  addStudent(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextId = this.cls.students.length ? Math.max(...this.cls.students.map((s) => Number(s.id))) + 1 : 1;
    this.cls.students.push({ id: String(nextId), name: trimmed });
    for (const sess of this.cls.sessions) sess.attendance[String(nextId)] = false;
  }

  /** Remove a student from the class and from every session's register. */
  removeStudent(studentId: string): void {
    this.cls.students = this.cls.students.filter((s) => s.id !== studentId);
    for (const sess of this.cls.sessions) delete sess.attendance[studentId];
  }

  /** Rename a student. */
  renameStudent(studentId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = this.cls.students.find((x) => x.id === studentId);
    if (s) s.name = trimmed;
  }

  /** Move the planned call at `plannedIdx` into this session's taught list. */
  teachCall(sessionIdx: number, plannedIdx: number): void {
    const s = this.cls.sessions[sessionIdx];
    if (!s || plannedIdx < 0 || plannedIdx >= s.planned.length) return;
    const [call] = s.planned.splice(plannedIdx, 1);
    s.taught.push(call);
  }

  /** Move all planned calls of a session into its taught list. */
  teachAll(sessionIdx: number): void {
    const s = this.cls.sessions[sessionIdx];
    if (!s) return;
    s.taught.push(...s.planned);
    s.planned = [];
  }

  /** Move the taught call at `taughtIdx` back into this session's plan. */
  unteachCall(sessionIdx: number, taughtIdx: number): void {
    const s = this.cls.sessions[sessionIdx];
    if (!s || taughtIdx < 0 || taughtIdx >= s.taught.length) return;
    const [call] = s.taught.splice(taughtIdx, 1);
    s.planned.push(call);
  }

  /** Which call titles a student knows and which they have missed. */
  studentKnowledge(studentId: string): { known: string[]; missed: string[] } {
    const known = new Set<string>();
    const absentTaught = new Set<string>();
    for (const s of this.cls.sessions) {
      const present = !!s.attendance[studentId];
      for (const ref of s.taught) {
        if (present) known.add(ref.title);
        else absentTaught.add(ref.title);
      }
    }
    const missed = [...absentTaught].filter((t) => !known.has(t)).sort();
    return { known: [...known].sort(), missed };
  }

  /** Priority weight per call title for the given session. */
  priorityWeights(sessionIdx: number): Map<string, number> {
    const map = new Map<string, number>();
    const s = this.cls.sessions[sessionIdx];
    if (s) for (const ref of s.taught) map.set(ref.title, (map.get(ref.title) ?? 0) + 2);
    for (let i = 0; i <= sessionIdx; i++) {
      for (const p of this.cls.sessions[i].problems) {
        map.set(p.title, (map.get(p.title) ?? 0) + p.priority);
      }
    }
    return map;
  }
}

// ---------------------------------------------------------------- tip generation

/** Teacher-tunable probabilities for tip generation (0..1). */
export interface TipConfig {
  repeatProb: number;
  priorityProb: number;
  currentProb: number;
  prevProb: number;
}

export const DEFAULT_TIP_CONFIG: TipConfig = { repeatProb: 0.2, priorityProb: 0.7, currentProb: 0.6, prevProb: 0.4 };

export interface TipGenOpts {
  minLen?: number;
  maxLen?: number;
  count?: number;
  /** Max getout calls used to bring the tip back to the squared set (default 5). */
  getoutMax?: number;
  /** Search budget (nodes) for the closing getout search (default 200). */
  getoutBudget?: number;
  config?: TipConfig;
  current?: Set<string>;
  callProb?: (title: string) => number;
  family?: (title: string) => string;
  rand?: () => number;
  onProgress?: (attempts: number, made: number, total: number) => void;
}

// Weighted random pick: higher `prob` -> more likely.
function weightedPick(pool: string[], prob: (title: string) => number, rand: () => number): string {
  const weights = pool.map((n) => Math.max(0, prob(n)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return pool[Math.floor(rand() * pool.length)];
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Applicable titles from `available` at the given board.
function applicableFrom(seq: Sequencer, board: import('dancing-squared-engine').Board, available: Set<string>): string[] {
  const out: string[] = [];
  for (const name of available) {
    if (seq.applyToBoard(board, name).legal) out.push(name);
  }
  return out;
}

// Cheap "is ANY available call legal from this board".
function hasApplicable(seq: Sequencer, board: import('dancing-squared-engine').Board, available: Set<string>): boolean {
  for (const name of available) {
    if (seq.applyToBoard(board, name).legal) return true;
  }
  return false;
}

/** Generates / edits practice tips for a class using the engine Sequencer. */
export class TipGenerator {
  private readonly seq: Sequencer;
  private readonly available: Set<string>;
  private readonly priority: Map<string, number>;
  private readonly opts: TipGenOpts;

  constructor(seq: Sequencer, available: Set<string>, priority: Map<string, number>, opts: TipGenOpts = {}) {
    this.seq = seq;
    this.available = available;
    this.priority = priority;
    this.opts = opts;
  }

  /** Generate `count` practice tips that start and finish in the squared set. */
  async generate(): Promise<string[][]> {
    const seq = this.seq;
    const available = this.available;
    const priority = this.priority;
    const opts = this.opts;
    const minLen = opts.minLen ?? 4;
    const maxLen = opts.maxLen ?? 8;
    const count = opts.count ?? 3;
    const getoutMax = opts.getoutMax ?? 5;
    const getoutBudget = opts.getoutBudget ?? 200;
    const config = { ...DEFAULT_TIP_CONFIG, ...(opts.config ?? {}) };
    const rand = opts.rand ?? Math.random;
    const callProb = opts.callProb ?? (() => 1);
    const family = opts.family ?? (() => '');
    const hasFamily = opts.family != null;
    const onProgress = opts.onProgress ?? (() => {});
    let topCalls: string[] = [];
    {
      let maxP = 0;
      const entries: { n: string; p: number }[] = [];
      for (const n of available) {
        const p = callProb(n);
        if (p > 0.001) {
          entries.push({ n, p });
          if (p > maxP) maxP = p;
        }
      }
      topCalls = entries.filter((x) => x.p >= maxP - 0.05).map((x) => x.n);
    }
    const tips: string[][] = [];
    const usedAny = new Set<string>();
    const attempts = count * 8;
    let made = 0;
    for (let t = 0; t < attempts && made < count; t++) {
      seq.reset();
      const tip: string[] = [];
      const usedHere = new Set<string>();
      const usedFamilies = new Set<string>();
      let guard = 0;
      let bodyReason = '';
      while (tip.length < maxLen && guard++ < 300) {
        const snapshot = seq.startBoard();
        const candidates = applicableFrom(seq, snapshot, available);
        if (!candidates.length) { bodyReason = 'no candidates from board'; break; }
        const withCont = candidates.filter((name) => {
          const probe = seq.applyToBoard(snapshot, name);
          return probe.legal && hasApplicable(seq, probe.board, available);
        });
        let pool = withCont.length ? withCont : candidates;
        const applicableTop = topCalls.filter((n) => candidates.includes(n));
        if (applicableTop.length) {
          pool = [...new Set([...pool, ...applicableTop])];
        } else if (topCalls.length) {
          const setup = candidates.filter((n) => {
            const r = seq.applyToBoard(snapshot, n);
            return r.legal && topCalls.some((hp) => seq.applyToBoard(r.board, hp).legal);
          });
          if (setup.length) pool = [...new Set([...pool, ...setup])];
        }
        if (rand() < config.priorityProb) {
          const prio = pool.filter((n) => (priority.get(n) ?? 0) > 0);
          if (prio.length) pool = prio;
        }
        const current = opts.current;
        if (current && rand() < config.currentProb) {
          const cur = pool.filter((n) => current.has(n));
          if (cur.length) pool = cur;
        }
        if (current && rand() < config.prevProb) {
          const prv = pool.filter((n) => !current.has(n));
          if (prv.length) pool = prv;
        }
        if (hasFamily) {
          const freshFam = pool.filter((n) => !usedFamilies.has(family(n)));
          if (freshFam.length) pool = freshFam;
        }
        const closeWeight = new Map<string, number>();
        const setupBonus = new Map<string, number>();
        const needsSetup = topCalls.length > 0 && !pool.some((n) => topCalls.includes(n));
        for (const n of pool) {
          const r = seq.applyToBoard(snapshot, n);
          closeWeight.set(n, r.legal ? seq.closenessToHome(r.board) : -Infinity);
          if (needsSetup && r.legal) {
            for (const hp of topCalls) {
              if (seq.applyToBoard(r.board, hp).legal) {
                setupBonus.set(n, 1);
                break;
              }
            }
          }
        }
        const combinedProb = (n: string) => {
          const prob = callProb(n);
          if (prob <= 0.001) return 0;
          let s = prob * 8;
          if (!usedHere.has(n)) s += 1;
          if (!usedAny.has(n)) s += 0.4;
          if ((priority.get(n) ?? 0) > 0) s += 0.3;
          if (setupBonus.get(n)) s += 3;
          const cl = closeWeight.get(n) ?? 0;
          if (cl > -Infinity) s += cl * 0.005;
          return s;
        };
        const pick = weightedPick(pool, combinedProb, rand);
        const step = seq.apply(pick);
        if (!step.legal) { bodyReason = `picked '${pick}' not legal`; break; }
        tip.push(pick);
        usedHere.add(pick);
        if (hasFamily) usedFamilies.add(family(pick));
      }
      const getout = seq.getout({ target: 'Static Square', maxCalls: getoutMax, budget: getoutBudget });
      const gotGetout = !!getout && getout.length > 0;
      const full = gotGetout ? [...tip, ...getout] : tip;
      console.log(
        `[tip:attempt ${t + 1}/${attempts}] body=[${tip.join(' > ')}]` +
        (bodyReason ? ` bodyStop=(${bodyReason})` : '') +
        ` getout=${gotGetout ? getout.join(' > ') : 'NONE'} full=[${full.join(' > ')}]` +
        ` accepted=${gotGetout && full.length >= minLen} (minLen=${minLen})`,
      );
      if (gotGetout) {
        tip.push(...getout);
        if (tip.length >= minLen) {
          tips.push(tip);
          made++;
          for (const c of tip) usedAny.add(c);
        }
      }
      await onProgress(t + 1, made, count);
    }
    console.log(`[tip] done: ${made}/${count} tips from ${attempts} attempts`);
    return tips;
  }

  /** Given an existing tip and a selected index, report the calls that could fit
   * BEFORE it (including replacing it) and AFTER it. */
  fitsAround(tipTitles: string[], index: number): { before: string[]; after: string[] } {
    const seq = this.seq;
    seq.reset();
    for (let i = 0; i < index && i < tipTitles.length; i++) seq.apply(tipTitles[i]);
    const before = applicableFrom(seq, seq.startBoard(), this.available).sort();
    if (index < tipTitles.length) seq.apply(tipTitles[index]);
    const after = applicableFrom(seq, seq.startBoard(), this.available).sort();
    return { before, after };
  }
}

/** Insert a title into a tip at `index` (before = replace/insert). */
export function insertInto(tip: string[], index: number, title: string): string[] {
  const out = [...tip];
  out.splice(index, 0, title);
  return out;
}

/** Remove the call at `index`. */
export function removeAt(tip: string[], index: number): string[] {
  return tip.filter((_, i) => i !== index);
}

/** Replace the call at `index`. */
export function replaceAt(tip: string[], index: number, title: string): string[] {
  const out = [...tip];
  if (index < out.length) out[index] = title;
  return out;
}

// ---------------------------------------------------------------- facades (backward-compatible)

export function availableTitles(cls: ClassInstance, sessionIdx: number): Set<string> {
  return new TeacherModel(cls).availableTitles(sessionIdx);
}
export function rollUntaughtForward(cls: ClassInstance, sessionIdx: number): void {
  new TeacherModel(cls).rollUntaughtForward(sessionIdx);
}
export function rollPrioritisedForward(cls: ClassInstance, sessionIdx: number): number {
  return new TeacherModel(cls).rollPrioritisedForward(sessionIdx);
}
export function missedNote(cls: ClassInstance, sessionIdx: number, ref: CallRef): string {
  return new TeacherModel(cls).missedNote(sessionIdx, ref);
}
export function completeSession(cls: ClassInstance, sessionIdx: number): { movedPlanned: number; carried: number } {
  return new TeacherModel(cls).completeSession(sessionIdx);
}
export function rollMissedCallsForward(cls: ClassInstance, sessionIdx: number): number {
  return new TeacherModel(cls).rollMissedCallsForward(sessionIdx);
}
export function pullForward(cls: ClassInstance, sessionIdx: number, count: number): void {
  new TeacherModel(cls).pullForward(sessionIdx, count);
}
export function setProblem(
  cls: ClassInstance, sessionIdx: number, title: string, setupIdx: number, priority: number, note: string, on: boolean,
): void {
  new TeacherModel(cls).setProblem(sessionIdx, title, setupIdx, priority, note, on);
}
export function archivedNote(cls: ClassInstance, sessionIdx: number, title: string, setupIdx: number): string | undefined {
  return new TeacherModel(cls).archivedNote(sessionIdx, title, setupIdx);
}
export function addStudent(cls: ClassInstance, name: string): void {
  new TeacherModel(cls).addStudent(name);
}
export function removeStudent(cls: ClassInstance, studentId: string): void {
  new TeacherModel(cls).removeStudent(studentId);
}
export function renameStudent(cls: ClassInstance, studentId: string, name: string): void {
  new TeacherModel(cls).renameStudent(studentId, name);
}
export function teachCall(cls: ClassInstance, sessionIdx: number, plannedIdx: number): void {
  new TeacherModel(cls).teachCall(sessionIdx, plannedIdx);
}
export function teachAll(cls: ClassInstance, sessionIdx: number): void {
  new TeacherModel(cls).teachAll(sessionIdx);
}
export function unteachCall(cls: ClassInstance, sessionIdx: number, taughtIdx: number): void {
  new TeacherModel(cls).unteachCall(sessionIdx, taughtIdx);
}
export function studentKnowledge(cls: ClassInstance, studentId: string): { known: string[]; missed: string[] } {
  return new TeacherModel(cls).studentKnowledge(studentId);
}
export function priorityWeights(cls: ClassInstance, sessionIdx: number): Map<string, number> {
  return new TeacherModel(cls).priorityWeights(sessionIdx);
}
export async function generateTips(
  seq: Sequencer, available: Set<string>, priority: Map<string, number>, opts: TipGenOpts = {},
): Promise<string[][]> {
  return new TipGenerator(seq, available, priority, opts).generate();
}
export function fitsAround(
  seq: Sequencer, available: Set<string>, tipTitles: string[], index: number,
): { before: string[]; after: string[] } {
  return new TipGenerator(seq, available, new Map()).fitsAround(tipTitles, index);
}
