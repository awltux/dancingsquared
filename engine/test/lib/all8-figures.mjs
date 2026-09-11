// A RE-USABLE reader for All8's published singing-call figures (fig_m.htm).
//
// WHY THIS IS A LIBRARY AND NOT PART OF A HARNESS. These 188 figures are going to become
// reference sequences - a named sequence with a known start and a list of calls - so the
// reading of the page has to be shared rather than re-implemented per consumer. The parser
// itself already lives in the engine (`all8-format.ts`: `parseAll8Figures`); this module is
// the thin, stable front door that adds the two things a fixture needs and the parser
// deliberately does not: the verbatim source line, and a stable id.
//
// THE LAYOUT, because nothing here is guessable from the text alone:
//
//   * A line going across IS a complete 64-beat singing-call figure.
//   * An INDENTED line shares its leading calls with a line above it. The indent is in
//     columns and the column pitch is 8 (2 designator + 5 call + 1 separator), so the share
//     count is `indent / 8` cells, inherited from the nearest line above that is long enough.
//   * `(3)` `(12)` `(1*)` `(*)` are LINKS to All8's page of common get-outs (`fig_go.htm`).
//     The number is that get-out's index on the page, so a marker means "from this exact
//     position in this figure you can resolve with get-out N". `(*)` is All8's own note that
//     he had not worked the resolve. These are kept with the call index they follow.
//   * `(DoSaD)` in parentheses is an OPTIONAL call ("calls in parentheses may be omitted").
//   * `(clap)` / `(in your wave)` are CALLER NOTES, not calls.
//   * `"quoted words"` are literal speech. They are NOT calls, and this matters: without
//     blanking quotes, `--"Roll HIM away"` imports a call named `HIM`.
//
// Note that fig_m.htm carries NO `[FASR]` setup codes at all (measured: zero `[` in the whole
// page). A singing-call figure starts from the squared set, which is why the suite built on
// this reader starts every figure from Static Square rather than from a parsed setup.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAll8Figures } from '../../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fixture, as fetched verbatim by `test/tools/fetch-all8-figures.mjs`. */
export const ALL8_FIGURE_FIXTURE = path.resolve(here, '..', 'fixtures', 'all8-figures.json');

/** The formation every figure on this page starts from: there are no setup codes on the page. */
export const ALL8_FIGURE_START = 'Static Square';

/**
 * Read fig_m.htm into figures a consumer can use.
 *
 * @param {{ fixturePath?: string }} [opts]
 * @returns {{ source: string, attribution: string, figures: All8FigureRead[], meta: object }}
 */
export function loadAll8Figures(opts = {}) {
  const fixturePath = opts.fixturePath ?? ALL8_FIGURE_FIXTURE;
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const lines = fixture.figuresText.split('\n');
  const { figures, skipped } = parseAll8Figures(fixture.figuresText);

  return {
    source: fixture.source,
    attribution: fixture.attribution,
    meta: {
      notationReference: fixture.notationReference,
      archivedNotationKey: fixture.archivedNotationKey,
      fetched: fixture.fetched,
      skippedPreambleLines: skipped.length,
    },
    figures: figures.map((f) => ({
      // Stable and human-checkable: the source line number in the fixture's own text, so a
      // reader can go straight to the page and find it. Line numbers are 0-based in the text;
      // the id is 1-based to match how the page reads.
      id: `figm${(f.sourceLine ?? 0) + 1}`,
      sourceLine: f.sourceLine,
      raw: lines[f.sourceLine ?? -1] ?? '',
      shared: f.shared,
      setup: f.setup,
      spoken: !!f.spoken,
      calls: f.calls.map((c) => ({ ...c })),
      links: (f.links ?? []).map((l) => ({ ...l })),
    })),
  };
}

/**
 * The engine call names of a figure, in order, as ONE flat list.
 *
 * Flattened rather than one-per-cell because a single All8 cell is not always one call:
 * `TagI` is "Tag the Line" then "Face In", and `Sw&Pr` is "Swing" then "Promenade". A
 * consumer that wants cell boundaries should read `figure.calls` instead.
 *
 * @param {All8FigureRead} figure
 * @param {{ includeOptional?: boolean }} [opts] optional calls are EXCLUDED by default, because
 *   All8's key says they may be omitted - so the required sequence is the one to test first.
 */
export function figureEngineCalls(figure, opts = {}) {
  const { includeOptional = false } = opts;
  return figure.calls
    .filter((c) => includeOptional || !c.optional)
    .flatMap((c) => c.names);
}

/** Every cell we could not read, as `{ figureId, token, sourceLine }`. */
export function unreadCells(data) {
  const out = [];
  for (const f of data.figures) {
    for (const c of f.calls) {
      if (c.names.length === 0) out.push({ figureId: f.id, token: c.token, sourceLine: f.sourceLine });
    }
  }
  return out;
}

/**
 * The shape a REFERENCE SEQUENCE will want, so a future feature does not have to re-derive it.
 * `start` is Static Square for every figure on this page (see the module note).
 *
 * @param {All8FigureRead} figure
 */
export function toReferenceSequence(figure, opts = {}) {
  return {
    id: figure.id,
    source: 'all8.com fig_m.htm',
    start: ALL8_FIGURE_START,
    setup: figure.setup,
    calls: figureEngineCalls(figure, opts),
    links: figure.links,
  };
}
