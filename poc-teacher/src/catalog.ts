// Catalog loader for the teacher PoC. Accepts a map of per-level XML files
// (keyed by e.g. "ms/pass_thru") and produces per-title call entries (each with
// its setups) plus a Sequencer pre-loaded with them. In the browser this is fed
// by Vite's import.meta.glob; in the node verify it is fed by reading files.
//
// THE BLOCK READ IS THE CORPUS PACKAGE'S, and that is a defect fix rather than a tidy-up. This file used to slice
// `<tam>` with its own regex and NO comment-strip, so the catalogue it built contained authorings that exist only
// inside `<!-- -->`: MEASURED (`engine/test/tam-readers.mjs`), 1068 pooled setups against the corpus's 1060, because
// the eight `Left/Right-Hand Star {1/4, 1/2, 3/4, a Full Turn}` titles have a commented-out namesake in
// `ms/star.xml`, and the engine therefore offered 2 matchable variants where there is 1. It is not a small corner:
// this catalogue is what the app teaches from and what `scripts/build-fsm-asset.mjs` turns into `assets/fsm-ms.json`.
// The reader it now uses is `dancing-squared-corpus/blocks` - the fs-free entry, so the BROWSER can import it; the
// package's Node entry would pull `node:fs` into this bundle.
//
// WHAT IS STILL THIS FILE'S: the hidden-tam rule (the corpus package deliberately does not own `display="no"`
// filtering), the FAMILY label, and the per-file grouping - a title authored in two files stays two entries here,
// which is what the picker shows.

import { Sequencer } from 'dancing-squared-engine';
import { taminationTitle, tamSitesOf } from 'dancing-squared-corpus/blocks';
import type { TamSite } from 'dancing-squared-corpus/blocks';

interface CallSetup {
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

/** True if the <tam> itself (its opening tag) is hidden. We only inspect the
 * opening tag, not child <formation>/<path> attributes, because display="no" /
 * display="none" on a *formation* means that one start setup is hidden but the
 * call itself is legitimate (e.g. "Circulate"). Only a hidden <tam> is excluded. */
function isHiddenTam(attrs: Readonly<Record<string, string>>): boolean {
  return /^(no|none)$/.test(attrs.display ?? '');
}

/** Parse every per-level XML file into one CatalogCall per distinct call title. */
export function buildCatalog(files: Record<string, string>): CatalogCall[] {
  const out: CatalogCall[] = [];
  for (const [path, xml] of Object.entries(files)) {
    const m = /([^/]+)\/([^/]+\.xml)$/.exec(path);
    const level = m ? m[1] : '?';
    const file = m ? m[2] : path;
    // The <tamination> title is the call FAMILY; each <tam> is a specific call in it. Read through the corpus package,
    // which strips comments first - a family that has been commented out is not this file's family.
    const family = taminationTitle(xml) ?? 'Other';
    const byTitle = new Map<string, TamSite[]>();
    // THE ONE READER: comments stripped, so a block that lives inside `<!-- -->` is not a call. The index it returns is
    // the position `parseCallXml`/`loadCallFromXml` address, which matters because a commented block shifts every
    // later one.
    for (const site of tamSitesOf(level, file, xml)) {
      // Skip hidden variants (display="no" / display="none"). They must never
      // appear in tips, modules or getouts.
      if (isHiddenTam(site.attrs)) continue;
      const t = site.title || '?';
      const arr = byTitle.get(t) ?? [];
      arr.push(site);
      byTitle.set(t, arr);
    }
    for (const [title, sites] of byTitle) {
      out.push({
        title,
        family,
        level,
        setups: sites.map((s) => ({
          label: s.attrs.from || s.attrs.formation || '(default)',
          from: s.attrs.from ?? '',
        })),
        xml: `<calls>\n${sites.map((s) => s.xml).join('\n')}\n</calls>`,
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
