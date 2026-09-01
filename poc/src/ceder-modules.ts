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

/** The replayable ceder modules, as { name, steps } ready for registerModule. */
export function validCederModules(): { name: string; steps: (string | CallStep)[] }[] {
  const out: { name: string; steps: (string | CallStep)[] }[] = [];
  for (const value of Object.values(modules)) {
    if (!value || !Array.isArray(value.steps)) continue;
    if (value.success !== true) continue;
    if (value.steps.includes('ALLEMANDE_LEFT')) continue;
    out.push({ name: value.name || `ceder-${value.id}`, steps: value.steps });
  }
  // Stable ordering so the picker list is deterministic.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
