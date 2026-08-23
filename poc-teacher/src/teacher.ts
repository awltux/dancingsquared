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
  next.planned.push(...s.planned);
  s.planned = [];
}

/** Pull `count` planned calls from the next session's plan into THIS session's plan. */
export function pullForward(cls: ClassInstance, sessionIdx: number, count: number): void {
  const s = cls.sessions[sessionIdx];
  const next = cls.sessions[sessionIdx + 1];
  if (!s || !next || count <= 0) return;
  const pulled = next.planned.splice(0, count);
  for (const r of pulled) s.planned.push(r);
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

export interface TipGenOpts {
  minLen?: number;
  maxLen?: number;
  count?: number;
}

// Deterministic pick: prefer legal available calls, scored by priority weight,
// then not-yet-used-in-this-tip, then not-yet-used-in-any-tip.
function pickScore(name: string, priority: Map<string, number>, usedHere: Set<string>, usedAny: Set<string>): number {
  return (priority.get(name) ?? 0) * 100 + (usedHere.has(name) ? 0 : 10) + (usedAny.has(name) ? 0 : 1);
}

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
 * Generate `count` practice tips from `seq` (a Sequencer pre-loaded with the
 * available calls) that only use calls in `available`, prioritising the highest
 * `priority` calls first and preferring calls that keep the tip going. Each tip
 * is a list of call titles.
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
  const tips: string[][] = [];
  const usedAny = new Set<string>();
  for (let t = 0; t < count; t++) {
    seq.reset();
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
      const pool = withCont.length ? withCont : candidates;
      const pick = [...pool].sort(
        (a, b) => pickScore(b, priority, usedHere, usedAny) - pickScore(a, priority, usedHere, usedAny),
      )[0];
      const step = seq.apply(pick);
      if (!step.legal) break;
      tip.push(pick);
      usedHere.add(pick);
      if (tip.length >= minLen) break; // a complete practice tip
    }
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
