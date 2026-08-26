// Serialization / parsing of a class's saved modules for export/sharing.

import type { SavedModule } from './store';
import { sanitizeText } from './util';

/** Serialize a class's saved modules for export/sharing. */
export function serializeModules(modules: SavedModule[]): string {
  return JSON.stringify(
    {
      app: 'dancing-squared-teacher',
      kind: 'modules',
      version: 1,
      modules: modules.map((m) => ({ name: m.name, titles: m.titles })),
    },
    null,
    2,
  );
}

/** Parse exported module JSON; returns the valid modules or null if it isn't a
 * module export. Invalid entries are skipped. */
export function parseModules(text: string): SavedModule[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const arr =
    data && typeof data === 'object' && Array.isArray((data as { modules?: unknown }).modules)
      ? (data as { modules: unknown[] }).modules
      : Array.isArray(data)
        ? data
        : null;
  if (!arr) return null;
  const out: SavedModule[] = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    const o = m as { name?: unknown; titles?: unknown };
    if (typeof o.name !== 'string' || !Array.isArray(o.titles)) continue;
    const titles = o.titles.filter((t): t is string => typeof t === 'string');
    if (!titles.length) continue;
    out.push({ name: sanitizeText(o.name, 60), titles, createdAt: Date.now(), createdClass: '', createdSession: '' });
  }
  return out.length ? out : null;
}
