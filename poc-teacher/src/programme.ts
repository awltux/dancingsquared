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

/** The SSD (Standard Square Dance) teaching programme, 12 sessions. */
export function ssdProgramme(): Programme {
  return {
    name: 'SSD Teaching Programme',
    level: 'ssd',
    sessions: [
      { name: 'Session 1', calls: ['Circle Left', 'Circle Left 1/4', 'Circle Left 1/2', 'Circle Left 3/4', 'Circle Right', 'Circle Right 1/4', 'Circle Right 1/2', 'Circle Right 3/4', 'Forward and Back', 'Heads Forward and Back', 'Sides Forward and Back', 'Dosado', 'Dosado to a Wave', 'Swing Your Partner', 'Swing Your Corner', 'All 4 Couples Promenade 1/4', 'All 4 Couples Promenade 1/2', 'All 4 Couples Promenade 3/4', 'All 4 Couples Promenade Full', 'Single File Promenade', 'All 4 Couples Wrong Way Promenade 1/4', 'All 4 Couples Wrong Way Promenade 1/2', 'All 4 Couples Wrong Way Promenade 3/4', 'All 4 Couples Wrong Way Promenade Full', 'Star Promenade', 'Allemande Left', 'Allemande Left in the Alamo Style', 'Turn Partner by the Right', 'Turn Partner by the Left', 'Left Arm Turn 3/4', 'Centers Arm Turn 3/4', 'Right and Left Grand', 'Weave the Ring', 'Wrong Way Grand', 'Left Hand Star', 'Right Hand Star', 'Right-Hand Star 1/4', 'Right-Hand Star 1/2', 'Right-Hand Star 3/4', 'Right-Hand Star a Full Turn', 'Left-Hand Star 1/4', 'Left-Hand Star 1/2', 'Left-Hand Star 3/4', 'Left-Hand Star a Full Turn', 'Courtesy Turn', 'Courtesy Turn and a Quarter More', 'Ladies Chain', 'Head Ladies Chain', 'Side Ladies Chain', 'Four Ladies Chain', 'Pass Thru', 'Wheel Around', 'Reverse Wheel Around', 'Heads Wheel Around'] },
      { name: 'Session 2', calls: ['Star Thru', 'Heads Star Thru', 'Slide Thru', 'Half Sashay', 'Heads Half Sashay', 'Sides Half Sashay', 'Rollaway', 'Ladies In, Men Sashay'] },
      { name: 'Session 3', calls: ['California Twirl', 'Bend the Line', 'Line of 8, Bend the Line', 'U-Turn Back', 'Boys Turn Back', 'Girls Turn Back', 'Girls Backtrack', 'Dive Thru'] },
      { name: 'Session 4', calls: ['Square Thru 2', 'Square Thru 3', 'Square Thru 4', 'Square Thru 1 1/2', 'Square Thru 2 1/2', 'Square Thru 3 1/2', 'Grand Square', 'Heads Face, Grand Square', 'Sides Face, Grand Square', 'Boys Face your Partner, Grand Square', 'Girls Face your Partner, Grand Square'] },
      { name: 'Session 5', calls: ['Lead Right', 'Lead Left', 'Heads Lead Right', 'Heads Lead Left', 'Sides Lead Right', 'Sides Lead Left', 'Veer Left', 'Veer Right', 'Circulate', 'Couples Circulate', 'Centers Circulate', 'Ends Circulate', 'All 8 Circulate', 'Box Circulate', 'Column Circulate', 'Split Circulate', 'Outer 6 Circulate', 'Trade', 'Couples Trade', 'Boys Trade', 'Girls Trade', 'Centers Trade', 'Ends Trade', 'Chain Down the Line'] },
      { name: 'Session 6', calls: ['Right and Left Thru', 'Heads Right and Left Thru and Back Away', 'Sides Right and Left Thru and Back Away', 'Right and Left Thru and a Quarter More', 'Flutterwheel', 'Reverse Flutterwheel', 'All 4 Women Lead Flutterwheel', 'All 4 Men Lead Reverse Flutterwheel', 'Sweep a Quarter Left', 'Sweep a Quarter Right', 'Flutterwheel and Sweep a Quarter', 'Reverse Flutterwheel and Sweep a Quarter', 'Recycle and Sweep a Quarter'] },
      { name: 'Session 7', calls: ['Heads Pass Thru, Separate Around 1 to a Line', 'Heads Pass Thru, Separate Around 1 and Come Into the Middle', 'Heads Pass Thru, Separate Around 2 to a Line', 'Heads Pass Thru, Separate Around 2 and Come Into the Middle', 'Centers Split Two', 'Centers Split the Outside Couple', 'Wheel and Deal', 'Left Wheel and Deal', 'Double Pass Thru', 'Left Double Pass Thru', 'First Couple Go Left, Next Couple Go Left', 'First Couple Go Left, Next Couple Go Right', 'First Couple Go Right, Next Couple Go Left', 'First Couple Go Right, Next Couple Go Right'] },
      { name: 'Session 8', calls: ['Step to a Wave', 'Heads Step to a Wave', 'Sides Step to a Wave', 'Step to a Left-Hand Wave', 'Dosado to a Wave', 'Allemande Left in the Alamo Style', 'Balance', 'Trade', 'Couples Trade', 'Boys Trade', 'Girls Trade', 'Centers Trade', 'Ends Trade', 'Swing Thru', 'Left Swing Thru', 'Boys Run', 'Girls Run', 'Centers Run', 'Ends Run', 'Centers Cross Run', 'Ends Cross Run'] },
      { name: 'Session 9', calls: ['Pass the Ocean', 'Heads Pass the Ocean', 'Sides Pass the Ocean', 'Extend', 'Zoom', 'Centers Zoom', 'Ends Zoom'] },
      { name: 'Session 10', calls: ['Centers In', 'Cast Off Three Quarters', 'Centers Cast Off Three Quarters', 'Very Centers Cast Off Three Quarters', 'Ferris Wheel', 'Partner Trade', 'Trade By'] },
      { name: 'Session 11', calls: ['Box the Gnat', 'Hinge', 'Centers Hinge', 'Couples Hinge', 'Very Centers Hinge', 'Touch a Quarter', 'Left Touch a Quarter', 'Touch a Half', 'All 8 Circulate', 'Circulate', 'Column Circulate', 'Centers Circulate', 'Ends Circulate', 'Tag the Line', '3/4 Tag the Line', 'Quarter Tag', 'Half Tag', 'Left Half Tag'] },
      { name: 'Session 12', calls: ['Split Circulate', 'Box Circulate', 'Boys Fold', 'Girls Fold', 'Ends Fold', 'Ends Cross Fold', 'Scoot Back', 'Recycle'] },
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
