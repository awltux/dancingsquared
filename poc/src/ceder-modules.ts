// Ceder-translated sequence modules: statically import the `modules/**/*.json`
// corpus (translated from ceder.net choreodb) and expose the ones that are
// genuinely replayable, so the poc sequencer can offer them as modules.
//
// A module is considered "valid" for the sequencer when it translated cleanly
// (success === true) and every step is a real call (i.e. it does not carry the
// ALMANDE_LEFT terminal marker the translator emits for "You're Home" etc.).
// Modules that reference calls not registered at the current level simply won't
// be legal from a given board; the picker filters them out.

import type { CallStep } from 'dancing-squared-engine';

interface CederModule {
  id: number | string;
  name: string;
  level?: string;
  startFormation?: string;
  endFormation?: string;
  success?: boolean;
  stepCount?: number;
  mappedCount?: number;
  steps: (string | CallStep)[];
  source?: string;
}

// Static, build-time import of the whole corpus (eager JSON).
const modules: Record<string, CederModule> = import.meta.glob<CederModule>(
  '../../modules/**/*.json',
  { eager: true, import: 'default' },
);

/** The replayable ceder modules, ready for registerModule. */
export function validCederModules(): CederModuleRef[] {
  const out: CederModuleRef[] = [];
  for (const value of Object.values(modules)) {
    if (!value || !Array.isArray(value.steps)) continue;
    if (value.success !== true) continue;
    if (value.steps.includes('ALLEMANDE_LEFT')) continue;
    // `startFormation` is carried through rather than dropped: 168 of the 294 corpus modules the app
    // offers were written for a Zero Line or a Zero Box, and replaying one from the home square is a
    // different dance. See `NamedSequence.startFormation` for what that costs.
    out.push({
      name: value.name || `ceder-${value.id}`,
      steps: value.steps,
      startFormation: value.startFormation,
      endFormation: value.endFormation,
    });
  }
  // Stable ordering so the picker list is deterministic.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** What `validCederModules` hands the app: the steps plus the corpus's own formation labels. */
interface CederModuleRef {
  name: string;
  steps: (string | CallStep)[];
  startFormation?: string;
  endFormation?: string;
}
