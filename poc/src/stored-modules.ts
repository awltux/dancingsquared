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
// This module has no imports but a type, so a probe can call it directly under node's type stripping.

import type { CallStep } from 'dancing-squared-engine';

/** A saved module as the sequencer persists it: the engine's `Module`, narrowed to what is read. */
export interface StoredModule {
  name: string;
  calls: (string | CallStep)[];
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
    // copying unknown fields through would make this the place a stale schema lives on.
    out.push({ name, calls: calls as (string | CallStep)[] });
  }
  return out;
}
