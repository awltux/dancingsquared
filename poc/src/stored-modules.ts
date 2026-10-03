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
// A "WHILE" STEP IS STORED WITH ITS LANES, and a lane may be in the LEGACY single-`call` form: the sequencer
// saves the raw history, so any group step ever saved by a caller is `{groups:[{selection, call}]}` in their
// browser. The canonical write is `{selection, calls:[...]}` (see `GroupLane`), and the upgrade happens HERE,
// in the one parser both readers share, so nothing downstream has to know the old shape exists. A lane whose
// calls cannot be read drops the whole MODULE rather than the step: a module missing one of its steps dances a
// different sequence, which is worse than not offering it at all.
//
// This module has no imports but a type, so a probe can call it directly under node's type stripping.

import type { CallStep, GroupLane, GroupStep, ModuleStep } from 'dancing-squared-engine';

/** A saved module as the sequencer persists it: the engine's `Module`, narrowed to what is read. */
export interface StoredModule {
  name: string;
  calls: ModuleStep[];
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
    const { name, calls } = entry as { name?: unknown; calls?: unknown };
    if (typeof name !== 'string' || !Array.isArray(calls)) continue;
    // ONLY THE TWO FIELDS THAT ARE USED: a stored `level`/`tags`/`notes` is not the sequencer's business, and
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
    out.push({ name, calls: steps });
  }
  return out;
}
