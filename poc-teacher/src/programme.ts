// A Programme is the default curriculum: an ordered list of sessions, each with
// the calls assigned to it (by title). Importing/exporting a programme shares
// the default course structure; when a new course is created the teacher picks a
// programme and its sessions become the course's sessions.

import type { CallRef, ClassInstance, Student } from './teacher';

interface ProgrammeSession {
  name: string;
  calls: string[]; // call titles
}

export interface Programme {
  name: string;
  level: string;
  sessions: ProgrammeSession[];
}

/** The Mainstream 2026 teaching programme (19 sessions), built from the lesson
 * plan by matching each item to a call that resolves in the catalog.
 *
 * ONE FAMILY NOTE, because a reader will check it: the promenade family authors a RIGHT-WAY 1/4, 1/2, 3/4 and a full
 * turn, and a WRONG-WAY 1/2, 3/4 and a full turn - there is no wrong-way 1/4 anywhere in the corpus
 * (`ms/promenade.xml`), so the plan has no entry for one. The retired SSD programme named
 * `All 4 Couples Wrong Way Promenade 1/4`, which resolved to nothing; the entry went with it rather than being
 * retitled to a call the corpus does not carry.
 */
export function mainstream2026Programme(): Programme {
  return {
    name: 'Mainstream 2026',
    level: 'ms',
    sessions: [
      { name: 'Session 1', calls: ['Circle Left', 'Circle Left 1/4', 'Circle Left 1/2', 'Circle Left 3/4', 'Circle Right', 'Circle Right 1/4', 'Circle Right 1/2', 'Circle Right 3/4', 'Circle Four Left', 'Circle Four Right', 'Circle Four Left 1/4', 'Circle Four Right 1/4', 'Circle Four Left 1/2', 'Circle Four Right 1/2', 'Circle Four Left 3/4', 'Circle Four Right 3/4', 'Single Circle Left', 'Single Circle Right', 'Single Circle Left 1/4', 'Single Circle Right 1/4', 'Single Circle Left 1/2', 'Single Circle Right 1/2', 'Single Circle Left 3/4', 'Single Circle Right 3/4', 'Dosado', 'Promenade 1/4', 'Promenade 1/2', 'Promenade 3/4', 'Promenade', 'Single File Promenade', 'Wrong Way Promenade 1/2', 'Wrong Way Promenade 3/4', 'Wrong Way Promenade', 'Turn Partner by the Right', 'Turn Partner by the Left', 'Left Arm Turn 3/4', 'Centers Arm Turn 3/4', 'Allemande Left', 'Right Hand Star', 'Left Hand Star', 'Right-Hand Star 1/4', 'Right-Hand Star 1/2', 'Right-Hand Star 3/4', 'Right-Hand Star a Full Turn', 'Left-Hand Star 1/4', 'Left-Hand Star 1/2', 'Left-Hand Star 3/4', 'Left-Hand Star a Full Turn', 'Right and Left Grand', 'Weave the Ring', 'Wrong Way Grand', 'Pass Thru'] },
      { name: 'Session 2', calls: ['Wheel Around', 'Reverse Wheel Around', 'Courtesy Turn', 'Right and Left Thru', 'Swing Your Partner', 'Swing Your Corner', 'Ladies Chain', 'Head Ladies Chain', 'Side Ladies Chain', 'Four Ladies Chain', 'Four Ladies Chain 3/4'] },
      { name: 'Session 3', calls: ['Ladies In, Men Sashay', 'U-Turn Back', 'Girls Backtrack', 'Heads Separate', 'Sides Separate', 'Heads Pass Thru, Separate Around 1 to a Line', 'Heads Pass Thru, Separate Around 2 to a Line', 'Around One to a Line', 'Around Two to a Line', 'Heads Pass Thru, Separate Around 1 and Come Into the Middle', 'Heads Pass Thru, Separate Around 2 and Come Into the Middle', 'Around One and Come Into the Middle', 'Around Two and Come Into the Middle'] },
      { name: 'Session 4', calls: ['Lead Right', 'Lead Left', 'Veer Left', 'Veer Right', 'Chain Down the Line', 'Star Thru', 'Couples Circulate', 'Centers Circulate', 'Ends Circulate', 'Bend the Line'] },
      { name: 'Session 5', calls: ['Half Sashay', 'Square Thru 2', 'Square Thru 3', 'Square Thru 4', 'Centers Split the Outside Couple', 'Star Promenade', 'Rollaway'] },
      { name: 'Session 6', calls: ['Grand Square', 'Heads Face, Grand Square', 'Sides Face, Grand Square', 'Double Pass Thru', 'First Couple Go Left, Next Couple Go Right', 'First Couple Go Right, Next Couple Go Left', 'First Couple Go Left, Next Couple Go Left', 'First Couple Go Right, Next Couple Go Right', 'Wheel and Deal', 'California Twirl'] },
      { name: 'Session 7', calls: ['Slide Thru', 'Dive Thru', 'Box the Gnat'] },
      { name: 'Session 8', calls: ['Allemande Left in the Alamo Style', 'Balance', 'Step to a Wave', 'Dosado to a Wave', 'All 8 Circulate'] },
      { name: 'Session 9', calls: ['Couples Trade', 'Boys Trade', 'Girls Trade', 'Centers Trade', 'Ends Trade', 'Partner Trade'] },
      { name: 'Session 10', calls: ['Swing Thru', 'Boys Run', 'Girls Run', 'Centers Run', 'Ends Run', 'Pass the Ocean', 'Extend'] },
      { name: 'Session 11', calls: ['Flutterwheel', 'Reverse Flutterwheel', 'Trade By', 'Single Circle to a Wave'] },
      { name: 'Session 12', calls: ['Ferris Wheel', 'Zoom', 'Touch a Quarter', 'Hinge'] },
      { name: 'Session 13', calls: ['Couples Hinge', 'Column Circulate', 'Centers In'] },
      { name: 'Session 14', calls: ['Cast Off Three Quarters', 'Spin the Top', 'Box Circulate', 'Split Circulate'] },
      { name: 'Session 15', calls: ['Scoot Back', 'Boys Fold', 'Girls Fold', 'Ends Fold', 'Tag the Line'] },
      { name: 'Session 16', calls: ['Ends Cross Fold', 'Recycle'] },
      { name: 'Session 17', calls: ['Centers Cross Run', 'Ends Cross Run'] },
      { name: 'Session 18', calls: ['3/4 Tag the Line', 'Left 3/4 Tag the Line', 'Quarter Tag', 'Half Tag', 'Left Half Tag'] },
      { name: 'Session 19', calls: ['Left Swing Thru', 'Reverse Wheel Around'] }],
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
