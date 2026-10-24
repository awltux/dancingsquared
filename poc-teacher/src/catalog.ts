// Catalog loader for the teacher PoC. Accepts a map of per-level XML files
// (keyed by e.g. "ms/pass_thru") and produces per-title call entries (each with
// its setups) plus a Sequencer pre-loaded with them. In the browser this is fed
// by Vite's import.meta.glob; in the node verify it is fed by reading files.

import { Sequencer } from 'dancing-squared-engine';

export interface CallSetup {
  label: string;
  from: string;
}

export interface CatalogCall {
  title: string;
  family: string; // the <tamination> title this call belongs to
  level: string;
  setups: CallSetup[];
  xml: string; // a <calls> wrapper containing only this title's <tam> blocks
}

function tamBlocks(xml: string): string[] {
  return xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
}

function attr(block: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  return (block.match(re) ?? [])[1] ?? '';
}

/** True if the <tam> itself (its opening tag) is hidden. We only inspect the
 * opening tag, not child <formation>/<path> attributes, because display="no" /
 * display="none" on a *formation* means that one start setup is hidden but the
 * call itself is legitimate (e.g. "Circulate"). Only a hidden <tam> is excluded. */
function isHiddenTam(block: string): boolean {
  const end = block.indexOf('>');
  const open = end >= 0 ? block.slice(0, end + 1) : block;
  return /display="(no|none)"/.test(open);
}

/** Parse every per-level XML file into one CatalogCall per distinct call title. */
export function buildCatalog(files: Record<string, string>): CatalogCall[] {
  const out: CatalogCall[] = [];
  for (const [path, xml] of Object.entries(files)) {
    const m = /([^/]+)\/[^/]+\.xml$/.exec(path);
    const level = m ? m[1] : '?';
    // The <tamination> title is the call FAMILY; each <tam> is a specific call in it.
    const family = (xml.match(/<tamination title="([^"]*)"/) || [])[1] ?? 'Other';
    const byTitle = new Map<string, string[]>();
    for (const b of tamBlocks(xml)) {
      // Skip hidden variants (display="no" / display="none"). They must never
      // appear in tips, modules or getouts.
      if (isHiddenTam(b)) continue;
      const t = attr(b, 'title') || '?';
      const arr = byTitle.get(t) ?? [];
      arr.push(b);
      byTitle.set(t, arr);
    }
    for (const [title, blocks] of byTitle) {
      out.push({
        title,
        family,
        level,
        setups: blocks.map((b) => ({
          label: attr(b, 'from') || attr(b, 'formation') || '(default)',
          from: attr(b, 'from'),
        })),
        xml: `<calls>\n${blocks.join('\n')}\n</calls>`,
      });
    }
  }
  return out;
}

/**
 * THE CATALOGUE'S MATCH MARGIN — how much slack the teacher's sequencer adds ON TOP of the engine's
 * `DEFAULT_MATCH_MAX`, so the effective tolerance is `DEFAULT_MATCH_MAX + CATALOG_MATCH_MARGIN` (1.5 + 1.5 = 3.0).
 *
 * WHY IT IS SMALL. A call is legal only when its start setup genuinely matches the board: ends are snap-clamped to
 * formation slots, so an exact match scores ~0 and a wrong-formation force-fit is rejected. It must likewise stay
 * under about 2.0, or e.g. a T-Bone start force-fits onto a Double Pass Thru board.
 *
 * IT IS A DIFFERENT FACT FROM THE ENGINE'S TOLERANCE, which is why it has its own name: both are `1.5`, and two
 * harnesses that reproduce this catalogue (`engine/test/reading-census.mjs`, `engine/test/tools/cell-census.mjs`)
 * used to write that `1.5` themselves — a margin and a tolerance spelled identically, one of them a copy.
 */
export const CATALOG_MATCH_MARGIN = 1.5;

/** A Sequencer loaded with the given catalog calls (keyed by title). */
export function makeSequencer(movesXml: string, formationsXml: string, calls: { title: string; xml: string }[], margin = CATALOG_MATCH_MARGIN): Sequencer {
  const seq = new Sequencer(movesXml, formationsXml, calls.map((c) => ({ name: c.title, xml: c.xml })));
  seq.setMatchMargin(margin);
  return seq;
}
