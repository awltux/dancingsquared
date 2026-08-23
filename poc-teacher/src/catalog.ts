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
        setups: blocks.map((b) => ({ label: attr(b, 'from') || '(default)', from: attr(b, 'from') })),
        xml: `<calls>\n${blocks.join('\n')}\n</calls>`,
      });
    }
  }
  return out;
}

/** A Sequencer loaded with the given catalog calls (keyed by title). */
export function makeSequencer(movesXml: string, formationsXml: string, calls: { title: string; xml: string }[], margin = 4): Sequencer {
  const seq = new Sequencer(movesXml, formationsXml, calls.map((c) => ({ name: c.title, xml: c.xml })));
  // A little match tolerance so legal-next accepts setups that are fractionally
  // off the canonical start (mirrors the main poc sequencer's default margin).
  seq.setMatchMargin(margin);
  return seq;
}
