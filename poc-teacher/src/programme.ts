// A Programme is the default curriculum: an ordered list of sessions, each with
// the calls assigned to it (by title). Importing/exporting a programme shares
// the default course structure; when a new course is created the teacher picks a
// programme and its sessions become the course's sessions.

import type { CallRef, ClassInstance, Student } from './teacher';

export interface ProgrammeSession {
  name: string;
  calls: string[]; // call titles
}

export interface Programme {
  name: string;
  level: string;
  sessions: ProgrammeSession[];
}

/** The built-in default programme that ships with the app. */
export function defaultProgramme(): Programme {
  return {
    name: 'Beginner Mainstream',
    level: 'ms',
    sessions: [
      { name: 'Session 1', calls: ['Circle Left', 'Forward and Back', 'Allemande Left', 'Courtesy Turn', 'Flutterwheel'] },
      { name: 'Session 2', calls: ['Ladies Chain', 'Right and Left Thru', 'Sides Face, Grand Square', 'Sides Face, Grand Spin', 'Heads Promenade 1/2'] },
      { name: 'Session 3', calls: ['Right and Left Grand', 'Pass Thru', 'Spin the Top', 'Swing Thru', 'Grand Square'] },
    ],
  };
}

/** Serialise a programme to a shareable JSON string. */
export function serializeProgramme(p: Programme): string {
  return JSON.stringify({ kind: 'dancingsquared-programme', version: 1, ...p }, null, 2);
}

/** Parse + validate a programme from JSON text. Returns null if invalid. */
export function parseProgramme(text: string): Programme | null {
  try {
    const o = JSON.parse(text);
    if (typeof o !== 'object' || o === null) return null;
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null;
    const level = typeof o.level === 'string' ? o.level.trim().toLowerCase() || 'ms' : 'ms';
    const sessions = Array.isArray(o.sessions)
      ? o.sessions
          .map((s: unknown, i: number): ProgrammeSession | null => {
            if (typeof s !== 'object' || s === null) return null;
            const ss = s as Record<string, unknown>;
            const calls = Array.isArray(ss.calls)
              ? ss.calls.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim())
              : [];
            const sname = typeof ss.name === 'string' && ss.name.trim() ? ss.name.trim() : `Session ${i + 1}`;
            return { name: sname, calls };
          })
          .filter((s: ProgrammeSession | null): s is ProgrammeSession => s !== null)
      : [];
    if (!name || sessions.length === 0) return null;
    return { name, level, sessions };
  } catch {
    return null;
  }
}

/**
 * Build a fresh ClassInstance from a programme. `resolve` maps a call title to a
 * CallRef (or null if the call isn't in the loaded catalog — unknown calls are
 * dropped). Sessions start with the programme's calls as their plan and nothing
 * taught.
 */
export function buildClassFromProgramme(
  id: string,
  name: string,
  p: Programme,
  students: string[],
  resolve: (title: string) => CallRef | null,
): ClassInstance {
  const studentObjs: Student[] = students.map((n, i) => ({ id: String(i + 1), name: n.trim() })).filter((s) => s.name);
  return {
    id,
    name,
    level: p.level,
    students: studentObjs,
    sessions: p.sessions.map((s, i) => ({
      id: `${id}-s${i + 1}`,
      name: s.name,
      level: p.level,
      planned: (() => {
        // Build the plan, dropping duplicate call-positions within a session.
        const seen = new Set<string>();
        const out: CallRef[] = [];
        for (const c of s.calls.map(resolve).filter((r): r is CallRef => r != null)) {
          const k = `${c.title}#${c.setupIdx}`;
          if (!seen.has(k)) {
            seen.add(k);
            out.push(c);
          }
        }
        return out;
      })(),
      taught: [],
      attendance: {},
      problems: [],
    })),
  };
}
