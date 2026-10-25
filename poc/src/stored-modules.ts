// What the caller's saved modules look like AS DATA, and the ONE place the stored form is validated.
//
// TWO MODULES READ THE SAME localStorage KEY and only one of them checked what it found. The browse view's
// `savedModules` (`modules.ts`) rejected an entry that had no `name` or no `calls` array; the sequencer's
// `loadModules` cast whatever it parsed straight to `Module[]`. And `refreshModulesList` then calls
// `this.modules.map(...)` and `m.calls.map(...)` - FROM THE CONSTRUCTOR, which `main.ts` awaits at top level -
// so a stored `{"a":1}` (not an array at all) or a single `{}` entry threw during startup and took the whole
// app down, while the browse view went on showing its list as if nothing were wrong.
//
// The shape check is not paranoia: the value is localStorage, which the caller, another tab, or an interrupted
// write can all change. A bad entry is DROPPED rather than repaired, because there is nothing to repair it
// FROM - and the rest of the list still loads, which is the half that matters.
//
// A SAVED MODULE IS A SEQUENCE DOCUMENT, not just a list of calls: it carries the board it was RECORDED on
// (`start`) and the board its replay ENDED on (`end`), in the same board-reference shape a sequence document
// writes. That is what lets the sequencer stand a module up where it was written instead of at home - the same
// distinction that made 168 of 294 corpus modules replay wrongly from a square set - and the `end` is what a
// later question ("what may follow this module?") is answered from. A module saved before these fields existed
// carries neither and still loads, from home, exactly as it did.
//
// WHAT IS CHECKED HERE IS KEEP-OR-DROP, NOT WHAT A BOARD IS. A board reference is checked for SHAPE - an object,
// at least one of `sid`/`formation`/`dancers`, every present field of the right type, exactly eight poses if
// poses - because this parser's question is only whether to list the module. WHICH board an `sid` names is
// `sequence-json.ts`'s question (`resolveSetupRef`), answered with the catalogue in hand and REFUSED BY NAME
// when the catalogue does not hold it; asking it here would make a localStorage parser depend on the app it is
// loaded into, and a module naming an unknown `sid` would vanish from the drawer instead of saying why.
//
// A "WHILE" STEP IS STORED WITH ITS LANES, and a lane may be in the LEGACY single-`call` form: the sequencer
// saves the raw history, so any group step ever saved by a caller is `{groups:[{selection, call}]}` in their
// browser. The canonical write is `{selection, calls:[...]}` (see `GroupLane`), and the upgrade happens HERE,
// in the one parser both readers share, so nothing downstream has to know the old shape exists. A lane whose
// calls cannot be read drops the whole MODULE rather than the step: a module missing one of its steps dances a
// different sequence, which is worse than not offering it at all - and the same rule drops a module whose
// START cannot be read, for the same reason.
//
// This module's only imports are TYPES, so a probe can load it directly under node's type stripping.

import type { CallStep, GroupLane, GroupStep, ModuleStep } from 'dancing-squared-engine';
import type { SequenceDancer, SetupRefJson } from './sequence-json';

/** A saved module as the sequencer persists it: the engine's `Module`, plus the two boards as a document writes them. */
export interface StoredModule {
  name: string;
  calls: ModuleStep[];
  /** The board the module was RECORDED on. Absent means "from home" - what every module saved before this field existed means. */
  start?: SetupRefJson;
  /** The board its replay ENDED on, which is what says what may follow the module. Absent means the store cannot say. */
  end?: SetupRefJson;
}

const BOARDS = ['sid', 'aid', 'fid', 'formation', 'name'] as const;
const GENDERS = new Set(['boy', 'girl', 'phantom']);

/**
 * A board reference as this store writes it, or null when it is not one - which drops the module holding it.
 *
 * The eight-pose form is accepted because the exporter writes it for a board no catalogue row carries, so a
 * saved module's start can be exactly that. A pose that is not a finite number is refused rather than coerced:
 * a `NaN` heading would stand the dancers up facing nowhere and the module would read as a broken call.
 */
function readBoardRef(raw: unknown): SetupRefJson | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const ref: SetupRefJson = {};
  for (const key of BOARDS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') return null;
    ref[key] = value;
  }
  if (fields.dancers !== undefined) {
    if (!Array.isArray(fields.dancers) || fields.dancers.length !== 8) return null;
    const dancers: SequenceDancer[] = [];
    for (const pose of fields.dancers) {
      if (!pose || typeof pose !== 'object') return null;
      const { gender, x, y, heading } = pose as Record<string, unknown>;
      if (typeof gender !== 'string' || !GENDERS.has(gender)) return null;
      if (typeof x !== 'number' || typeof y !== 'number' || typeof heading !== 'number') return null;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(heading)) return null;
      dancers.push({ gender: gender as SequenceDancer['gender'], x, y, heading });
    }
    ref.dancers = dancers;
  }
  // AT LEAST ONE FORM, and the same three `sequence-json.ts` resolves: an empty `{}` names no board and would
  // read as "start from nowhere" rather than "this module did not record one" (which is the ABSENT field).
  return ref.sid !== undefined || ref.formation !== undefined || ref.dancers !== undefined ? ref : null;
}

/**
 * A grouped step as it was stored, in either the canonical lane form (`calls`) or the legacy one (`call`).
 * Null when it cannot be read, which drops the module that holds it.
 */
function readGroupStep(raw: object): GroupStep | null {
  const groups = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return null;
  const lanes: GroupLane[] = [];
  for (const g of groups) {
    if (!g || typeof g !== 'object') return null;
    const { selection, calls, call } = g as { selection?: unknown; calls?: unknown; call?: unknown };
    if (typeof selection !== 'string') return null;
    const list = Array.isArray(calls) ? calls : typeof call === 'string' ? [call] : null;
    if (!list || list.length === 0 || list.some((c) => typeof c !== 'string')) return null;
    lanes.push({ selection, calls: list as string[] });
  }
  return lanes.length > 0 ? { groups: lanes } : null;
}

/** The saved modules in `raw`, with every entry that is not one of them dropped. */
export function parseStoredModules(raw: string | null): StoredModule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StoredModule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, calls, start, end } = entry as { name?: unknown; calls?: unknown; start?: unknown; end?: unknown };
    if (typeof name !== 'string' || !Array.isArray(calls)) continue;
    // ONLY THE FIELDS THAT ARE USED: a stored `level`/`tags`/`notes` is not the sequencer's business, and
    // copying unknown fields through would make this the place a stale schema lives on. The steps themselves
    // are carried as they are, except that a grouped step's lanes are canonicalised - one place, both readers.
    let bad = false;
    const steps: ModuleStep[] = [];
    for (const step of calls as unknown[]) {
      if (step && typeof step === 'object' && 'groups' in step) {
        const group = readGroupStep(step);
        if (!group) { bad = true; break; }
        steps.push(group);
        continue;
      }
      steps.push(step as string | CallStep);
    }
    if (bad) continue;
    const module: StoredModule = { name, calls: steps };
    // A `start` THAT IS PRESENT BUT UNREADABLE DROPS THE MODULE, the same rule as a broken lane: replaying it
    // from home would dance different calls, and a module that cannot say where it starts is not the module
    // that was saved. A malformed `end` is NOT fatal - nothing about loading depends on it - so it is dropped
    // and the module keeps its place in the list.
    if (start !== undefined) {
      const ref = readBoardRef(start);
      if (!ref) continue;
      module.start = ref;
    }
    if (end !== undefined) {
      const ref = readBoardRef(end);
      if (ref) module.end = ref;
    }
    out.push(module);
  }
  return out;
}
