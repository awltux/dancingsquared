// Teacher Session Tracker (PRD item 15) — pure, headless-testable core.
//
// Models a class instance with ordered sessions, per-session attendance, and
// problem call-setup notes; derives which calls each student knows/missed; rolls
// untaught calls forward (and pulls calls forward when there is time); and
// generates / edits practice tips (as reusable modules) that only use calls from
// the current and previous sessions, prioritising the current session's calls
// and any problem setups. Tip legality and the "which calls fit before / replace
// / after this call" suggestions are computed with the engine's Sequencer.

import { Sequencer } from 'dancing-squared-engine';

// ---------------------------------------------------------------- model

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

// ---------------------------------------------------------------- helpers

export const refKey = (r: { title: string; setupIdx: number }): string => `${r.title}#${r.setupIdx}`;

/** All distinct call titles taught in sessions 0..sessionIdx (current + previous). */
export function availableTitles(cls: ClassInstance, sessionIdx: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i <= sessionIdx; i++) {
    for (const ref of cls.sessions[i].taught) set.add(ref.title);
  }
  return set;
}

/**
 * Move every planned call of `sessionIdx` into the next session's plan (clearing
 * the current plan). If there is no next session, one is created to hold them.
 */
export function rollUntaughtForward(cls: ClassInstance, sessionIdx: number): void {
  const s = cls.sessions[sessionIdx];
  if (!s) return;
  let next = cls.sessions[sessionIdx + 1];
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
  // Move the plan across, then drop any call-positions duplicated within the
  // next session's plan (duplicates across sessions are allowed).
  next.planned = dedupeCallRefs([...next.planned, ...s.planned]);
  s.planned = [];
}

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

/** Pull `count` planned calls from the next session's plan into THIS session's plan,
 * skipping any that would duplicate a call-position already in this session. */
export function pullForward(cls: ClassInstance, sessionIdx: number, count: number): void {
  const s = cls.sessions[sessionIdx];
  const next = cls.sessions[sessionIdx + 1];
  if (!s || !next || count <= 0) return;
  const taken: CallRef[] = [];
  const kept: CallRef[] = [];
  for (const r of next.planned) {
    if (taken.length < count && !hasCallPosition(s, r)) taken.push(r);
    else kept.push(r);
  }
  next.planned = kept;
  s.planned.push(...taken);
}

/** Add a student to the class and to the register of every session (absent by default). */
export function addStudent(cls: ClassInstance, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const nextId = cls.students.length ? Math.max(...cls.students.map((s) => Number(s.id))) + 1 : 1;
  cls.students.push({ id: String(nextId), name: trimmed });
  for (const sess of cls.sessions) sess.attendance[String(nextId)] = false;
}

/** Remove a student from the class and from every session's register. */
export function removeStudent(cls: ClassInstance, studentId: string): void {
  cls.students = cls.students.filter((s) => s.id !== studentId);
  for (const sess of cls.sessions) delete sess.attendance[studentId];
}

/** Rename a student. */
export function renameStudent(cls: ClassInstance, studentId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const s = cls.students.find((x) => x.id === studentId);
  if (s) s.name = trimmed;
}

/** Move the planned call at `plannedIdx` into this session's taught list. */
export function teachCall(cls: ClassInstance, sessionIdx: number, plannedIdx: number): void {
  const s = cls.sessions[sessionIdx];
  if (!s || plannedIdx < 0 || plannedIdx >= s.planned.length) return;
  const [call] = s.planned.splice(plannedIdx, 1);
  s.taught.push(call);
}

/** Move the taught call at `taughtIdx` back into this session's plan. */
export function unteachCall(cls: ClassInstance, sessionIdx: number, taughtIdx: number): void {
  const s = cls.sessions[sessionIdx];
  if (!s || taughtIdx < 0 || taughtIdx >= s.taught.length) return;
  const [call] = s.taught.splice(taughtIdx, 1);
  s.planned.push(call);
}

/**
 * Which call titles a student knows (taught in a session they attended) and which
 * they have missed (taught in a session they missed, and not known from before).
 */
export function studentKnowledge(cls: ClassInstance, studentId: string): { known: string[]; missed: string[] } {
  const known = new Set<string>();
  const absentTaught = new Set<string>();
  for (const s of cls.sessions) {
    const present = !!s.attendance[studentId];
    for (const ref of s.taught) {
      if (present) known.add(ref.title);
      else absentTaught.add(ref.title);
    }
  }
  const missed = [...absentTaught].filter((t) => !known.has(t)).sort();
  return { known: [...known].sort(), missed };
}

/** Priority weight per call title for the given session: current taught + problem setups (all sessions so far). */
export function priorityWeights(cls: ClassInstance, sessionIdx: number): Map<string, number> {
  const map = new Map<string, number>();
  const s = cls.sessions[sessionIdx];
  if (s) for (const ref of s.taught) map.set(ref.title, (map.get(ref.title) ?? 0) + 2);
  for (let i = 0; i <= sessionIdx; i++) {
    for (const p of cls.sessions[i].problems) {
      map.set(p.title, (map.get(p.title) ?? 0) + p.priority);
    }
  }
  return map;
}

// ---------------------------------------------------------------- tip generation

/** Teacher-tunable probabilities for tip generation (0..1). */
export interface TipConfig {
  /** 0..1 — chance a call already in the tip may be repeated. */
  repeatProb: number;
  /** 0..1 — chance a priority (current/problem) call is preferred over others. */
  priorityProb: number;
  /** 0..1 — chance a call newly taught THIS session is preferred. */
  currentProb: number;
  /** 0..1 — chance a call from PREVIOUS sessions is preferred. */
  prevProb: number;
}

export const DEFAULT_TIP_CONFIG: TipConfig = { repeatProb: 0.2, priorityProb: 0.7, currentProb: 0.6, prevProb: 0.4 };

export interface TipGenOpts {
  minLen?: number;
  maxLen?: number;
  count?: number;
  /** Max getout calls used to bring the tip back to the squared set (default 6). */
  getoutMax?: number;
  /** Probabilities controlling repetition and priority preference. */
  config?: TipConfig;
  /** Call titles taught in the current (latest) session, for the current/prev mix. */
  current?: Set<string>;
  /** Per-call weight 0..1 used to bias the pick (higher = more likely). Default 1 for all. */
  callProb?: (title: string) => number;
  /** Injectable RNG for deterministic testing (default Math.random). */
  rand?: () => number;
}

// Weighted random pick: higher `prob` -> more likely. Calls with prob 0 are
// never picked; if every candidate has weight ~0 it falls back to uniform.
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

// Deterministic pick: prefer legal available calls, scored by priority weight,
// then not-yet-used-in-this-tip, then not-yet-used-in-any-tip.
// Applicable titles from `available` at the given board (via apply/re-base, not
// the stricter legalNext pure-motion check — a call is usable if it can be
// applied, even if it doesn't end in a catalog formation).
function applicableFrom(seq: Sequencer, board: import('dancing-squared-engine').Board, available: Set<string>): string[] {
  const out: string[] = [];
  for (const name of available) {
    if (seq.applyToBoard(board, name).legal) out.push(name);
  }
  return out;
}

/**
 * Generate `count` practice tips from `seq` (a Sequencer pre-loaded with ONLY the
 * available calls) that start and finish in the squared set. Each tip uses only
 * the available calls, prioritises the highest `priority` calls first and
 * prefers calls that keep the tip going, then closes back to the squared set via
 * a getout (so every tip is a zero). Tips that cannot be brought home are
 * dropped. `seq` should be registered with the available calls so the getout
 * only uses calls the class knows.
 */
export function generateTips(
  seq: Sequencer,
  available: Set<string>,
  priority: Map<string, number>,
  opts: TipGenOpts = {},
): string[][] {
  const minLen = opts.minLen ?? 4;
  const maxLen = opts.maxLen ?? 8;
  const count = opts.count ?? 3;
  const getoutMax = opts.getoutMax ?? 6;
  const config = { ...DEFAULT_TIP_CONFIG, ...(opts.config ?? {}) };
  const rand = opts.rand ?? Math.random;
  const callProb = opts.callProb ?? (() => 1);
  const tips: string[][] = [];
  const usedAny = new Set<string>();
  for (let t = 0; t < count; t++) {
    seq.reset(); // start in the squared set
    const tip: string[] = [];
    const usedHere = new Set<string>();
    let guard = 0;
    while (tip.length < maxLen && guard++ < 300) {
      const snapshot = seq.startBoard();
      const candidates = applicableFrom(seq, snapshot, available);
      if (!candidates.length) break;
      // Prefer an available call that keeps the tip going (at least one more
      // available call is applicable afterwards), so we don't dead-end on an
      // isolated call. Fall back only if nothing continues.
      const withCont = candidates.filter((name) => {
        const probe = seq.applyToBoard(snapshot, name);
        return probe.legal && applicableFrom(seq, probe.board, available).length > 0;
      });
      let pool = withCont.length ? withCont : candidates;
      // Repeat control: unless the repeat roll allows it, prefer calls not yet
      // used in this tip.
      if (rand() >= config.repeatProb) {
        const fresh = pool.filter((n) => !usedHere.has(n));
        if (fresh.length) pool = fresh;
      }
      // Priority control: on a priority roll, restrict to prioritised calls.
      if (rand() < config.priorityProb) {
        const prio = pool.filter((n) => (priority.get(n) ?? 0) > 0);
        if (prio.length) pool = prio;
      }
      // Current/previous mix: bias toward calls taught this session vs earlier.
      const current = opts.current;
      if (current && rand() < config.currentProb) {
        const cur = pool.filter((n) => current.has(n));
        if (cur.length) pool = cur;
      }
      if (current && rand() < config.prevProb) {
        const prv = pool.filter((n) => !current.has(n));
        if (prv.length) pool = prv;
      }
      // Final pick weighted by each call's per-call probability.
      const pick = weightedPick(pool, callProb, rand);
      const step = seq.apply(pick);
      if (!step.legal) break;
      tip.push(pick);
      usedHere.add(pick);
    }
    // Close the tip back to the squared set (finish in square). If no getout is
    // found within the bound, discard this tip.
    const getout = seq.getout({ target: 'Static Square', maxCalls: getoutMax });
    if (!getout || !getout.length) continue;
    tip.push(...getout);
    if (tip.length >= minLen) {
      tips.push(tip);
      for (const c of tip) usedAny.add(c);
    }
  }
  return tips;
}

/**
 * Given an existing tip and a selected index, report the applicable calls (from
 * `available`) that could fit BEFORE it (including replacing it) and AFTER it,
 * based on the board state reached by walking the tip from home.
 */
export function fitsAround(
  seq: Sequencer,
  available: Set<string>,
  tipTitles: string[],
  index: number,
): { before: string[]; after: string[] } {
  seq.reset();
  for (let i = 0; i < index && i < tipTitles.length; i++) seq.apply(tipTitles[i]);
  const before = applicableFrom(seq, seq.startBoard(), available).sort();
  if (index < tipTitles.length) seq.apply(tipTitles[index]);
  const after = applicableFrom(seq, seq.startBoard(), available).sort();
  return { before, after };
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
