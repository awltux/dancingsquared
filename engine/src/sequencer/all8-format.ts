// All8 sequence IMPORT / EXPORT.
//
// All8 (Rich Reel, all8.com) publishes choreography in its own notation, and this module is the
// codec for it. Two shapes of input are supported, because All8 publishes both:
//
//   1. PLAIN TEXT with COLUMN LAYOUT - the <pre> block on fig_m.htm ("Mainstream Singing Call
//      Figures"). Layout is load-bearing here, not decoration: All8's call sharing is expressed by
//      indentation. See the rule below.
//   2. TABLES with real CELLS - the worked example on abbrev.htm. There, sharing is literal: an
//      empty cell is inherited from the row above at the same index.
//
// ---------------------------------------------------------------------------------------------
// CALL SHARING, which is the reason this is not a one-line parser
// ---------------------------------------------------------------------------------------------
// abbrev.htm: "When a line of choreography has calls that are exactly the same as a line
// immediately above it, those calls on the lower line are omitted, leaving only blank space ...
// Call sharing is usually only done at the beginning (left hand side) of the line." And fig_m.htm:
// "When a line appears indented, calls are shared in common with a line above it. Use the first
// call(s) from the nearest line(s) above it that have calls starting from the left hand side."
//
// The number of shared leading calls is read from the INDENT, and that works because All8's
// abbreviations are a documented uniform width (abbrev.htm: "An important feature of the 2+5 format
// of the abbreviations is uniform width. This allows calls to be lined up vertically (in columns)").
// A cell is 7 characters (2 designator + 5 call name) plus a separator, so the column pitch is 8
// and the share count is exactly (indent - base) / 8. Measured on fig_m.htm the division is exact
// for every row.
//
// The rule was validated against All8's OWN worked example rather than assumed: abbrev.htm prints
// the expected reading of one highlighted row in full, and resolving that table's empty cells
// reproduces it verbatim (see test/all8-format.mjs, which gates exactly that).

import { TOKENS, MULTI_TOKENS, GROUP, normalizeToken, decodeTokenAll } from './all8-notation.js';

/** All8's uniform cell pitch: 7 characters (2 designator + 5 call name) plus one separator. */
export const ALL8_PITCH = 8;

/** The column All8 starts a left-most figure at, on the pages transcribed so far. Used on export
 * only; import derives its own base from the block it is reading. */
export const ALL8_BASE_COLUMN = 2;

/** One All8 call token, with the engine name(s) it expands to. `names` is EMPTY when we cannot read
 * the token - an empty array rather than a fallback string, so a caller can never mistake an
 * unread token for a call that happens to be named after the abbreviation. */
export interface All8Call {
  token: string;
  names: string[];
  /** True when All8 published the call in parentheses, e.g. `(DoSaD)`. All8's key says
   * "calls in parentheses may be omitted", so this is a call the figure does not require -
   * kept in the list (dropping it would silently lose choreography) but flagged so a reader
   * can choose. */
  optional?: boolean;
}

/**
 * A `( ... )` group on a figure line that points at All8's page of common get-outs.
 *
 * All8 prints these as `(3)`, `(12)`, `(1*)` or `(*)` and links each one to `fig_go.htm`.
 * The number is the get-out's index on that page, so the marker is a *reference to a
 * continuation from this exact position in this figure* - which is why it is kept with the
 * call index it sits after rather than thrown away as punctuation.
 *
 * All8's own preamble explains the two special labels:
 *   `(3)`  - get-outs to AL, RLG, or Prom
 *   `(*)`  - "I haven't worked the resolve yet"
 */
export interface All8GetoutLink {
  /** The label exactly as published inside the brackets: `1`, `12`, `1*`, `*`. */
  label: string;
  /** How many calls of the RESOLVED figure precede the marker. `-1` would mean it precedes them
   * all, which the page never does. */
  afterCall: number;
}

/** One figure: a complete sequence of calls, optionally preceded by a FASR setup code. */
export interface All8Figure {
  calls: All8Call[];
  /** A leading setup code from square brackets, e.g. `L1p` in `[L1p] --AL`. All8's FASR notation. */
  setup?: string;
  /** How many leading calls were inherited from the line above (0 for a left-most line). */
  shared: number;
  /** Get-out markers on this line, in the order they appear. See `All8GetoutLink`. */
  links?: All8GetoutLink[];
  /** 0-based line number within the input, for diagnostics. */
  sourceLine?: number;
  /** The line carried QUOTED DELIVERY text ("Roll HIM away"), i.e. words the caller says rather
   * than calls. Some of these lines are breaks or codas rather than complete figures, so they are
   * not required to end at a resolve. */
  spoken?: boolean;
}

/** A token All8 uses as a CALL. All8 flags rows with a leading `!` or `?`, and abbreviations may
 * begin with a digit (`--1/2Tg`, `4LChn`), so neither is disqualifying.
 *
 * Prose is rejected by requiring an uppercase letter or digit after the first character: that is
 * what separates `Get-outs` / `practice` / `anyone` (page text) from `SqTh4` / `--DoSaD` /
 * `--1/2Tg` (calls). A regex cannot tell them apart by shape alone, and this one is chosen so the
 * failure mode is a skipped line rather than a phantom call. */
export function looksLikeAll8Call(tok: string): boolean {
  const s = tok.replace(/^[!?]+/, '').replace(/,+$/, '');
  if (!/^[-/\]]?-?[A-Za-z0-9]/.test(s)) return false;
  if (!/[a-z]/.test(s)) return true;
  return /[A-Z0-9]/.test(s.slice(1));
}

/** Split a line into whitespace-separated tokens WITH their start columns, so indentation survives. */
export function tokensWithColumns(line: string): { col: number; tok: string }[] {
  const out: { col: number; tok: string }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ col: m.index, tok: m[0] });
  return out;
}

/** Blank out quoted spans, PRESERVING LENGTH so every remaining token keeps its column.
 *
 * All8's key defines quotes as literal words the caller says, so a quoted span is speech, not
 * calls. This is not cosmetic: `--"Roll HIM away"` otherwise yields a token `--"Roll` (rejected,
 * fine) and a bare `HIM` (NOT fine - all-caps, so it passes every shape test a real abbreviation
 * like `AL` or `RLG` passes, and it was being imported as a call). The get-out tokenizer in
 * all8-notation.ts blanks quotes for the same reason. */
function blankQuoted(line: string): string {
  return line.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));
}

/** All8's row flags (`!`, `?`) sit in their own column to the left of the calls. Blanking them out
 * rather than trimming keeps every call's column intact, which is what the share count is read
 * from. */
function blankRowFlag(line: string): string {
  return line.replace(/^(\s*)[!?]\s+/, (m, sp: string) => sp + ' '.repeat(m.length - sp.length));
}

/** Decode one All8 call token to engine name(s). `names` is empty when unreadable. */
export function decodeAll8Call(token: string): All8Call {
  const all = decodeTokenAll(token);
  return { token, names: all ? all.map((d) => d.name) : [] };
}

/** One `( ... )` group found on a figure line, classified by what All8 means by it. */
interface ParenSpan {
  start: number;
  end: number;
  kind: 'link' | 'optional' | 'note';
  /** For a link, the label (`3`, `1*`, `*`); for an optional call, the bare abbreviation. */
  label: string;
}

/**
 * Classify every `( ... )` group on a line. All8 uses the same brackets for three different
 * things, so the three have to be told apart by content:
 *
 *   get-out link   `(3)` `(12)` `(1*)` `(*)` - digits and/or a star, nothing else
 *   optional call  `(DoSaD)` `(Scoot)`       - the text decodes to a call in our table
 *   caller note    `(clap)` `(in your wave)` `(fixes the optional BxGnt)` - everything else
 *
 * The test for an optional call is deliberately "does our own decoder read it" rather than a
 * shape regex: `Scoot` is all-lowercase after the first letter, exactly like the page prose
 * `practice`/`anyone`, so shape alone cannot separate them and a shape rule would silently
 * demote a real call to a note.
 */
function scanParens(line: string): ParenSpan[] {
  const out: ParenSpan[] = [];
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const raw = m[1].trim();
    const bare = raw.replace(/\\/g, '').trim();
    const span = { start: m.index, end: m.index + m[0].length };
    if (/^(?:\*|\d+\*?|\*\d*)$/.test(bare)) {
      out.push({ ...span, kind: 'link', label: bare });
    } else if (!/\s/.test(bare) && (decodeTokenAll(bare) || decodeTokenAll(`--${bare}`))) {
      out.push({ ...span, kind: 'optional', label: bare });
    } else {
      out.push({ ...span, kind: 'note', label: raw });
    }
  }
  return out;
}

/** Blank a span, PRESERVING LENGTH, so every other token keeps its column. */
const blankSpan = (line: string, s: { start: number; end: number }) =>
  line.slice(0, s.start) + ' '.repeat(s.end - s.start) + line.slice(s.end);

/**
 * Parse a plain-text block of All8 figures (the fig_m.htm shape), resolving call sharing.
 *
 * Lines that are not figures - the page preamble, section notes - are returned in `skipped` rather
 * than silently dropped, so an import can report exactly what it ignored.
 */
export function parseAll8Figures(text: string): { figures: All8Figure[]; skipped: string[] } {
  const rows: All8Figure[] = [];
  const skipped: string[] = [];
  let pending: (All8Row | null)[] = [];

  const flush = () => {
    if (!pending.length) return;
    parseBlock(pending.filter((r): r is All8Row => r !== null), rows);
    pending = [];
  };

  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') {
      // A blank line ENDS a sharing block. That is not cosmetic: the share counts are read from
      // indentation relative to the block's own left-most column, so a page-text line at column 0
      // would otherwise become the base and shift every subsequent share count negative.
      flush();
      return;
    }
    const marked = blankQuoted(blankRowFlag(line));
    const parens = scanParens(marked);
    // Build the line the token reader sees: links and caller notes are blanked away (they are not
    // calls), while an optional CALL is put back in place of its own brackets so it survives as a
    // call. Every replacement is length-preserving, so the share count - which is read from
    // columns - is unaffected.
    let scan = marked;
    for (const p of parens) {
      if (p.kind === 'optional') {
        const text = p.label.padEnd(p.end - p.start, ' ');
        scan = scan.slice(0, p.start) + text + scan.slice(p.end);
      } else {
        scan = blankSpan(scan, p);
      }
    }
    const tk = tokensWithColumns(scan);
    const first = tk[0];
    const optionalSpans = parens.filter((p) => p.kind === 'optional');
    const calls = tk
      .filter((t) => looksLikeAll8Call(t.tok))
      .map((t) => {
        const call = decodeAll8Call(t.tok);
        if (optionalSpans.some((p) => t.col >= p.start && t.col < p.end)) call.optional = true;
        return call;
      });
    if (!first || !looksLikeAll8Call(first.tok) || calls.length === 0) {
      flush();
      skipped.push(line);
      return;
    }
    const { setup } = splitSetup(line);
    // A get-out marker's position is "how many calls are to its left", so it survives the share
    // resolution below as an index into the figure's own call list.
    const links: All8GetoutLink[] = parens
      .filter((p) => p.kind === 'link')
      .map((p) => ({ label: p.label, afterCall: tk.filter((t) => t.col < p.start && looksLikeAll8Call(t.tok)).length }));
    pending.push({ indent: first.col, own: calls, links, setup, sourceLine: i, spoken: /"/.test(line) });
  });
  flush();
  return { figures: rows, skipped };
}

/** Pull a leading `[FASR]` setup code off a line. Returns no setup when there is none. */
export function splitSetup(line: string): { setup?: string; rest: string } {
  const m = /^(\s*)\[([^\]]+)\]\s*(.*)$/.exec(line);
  if (!m) return { rest: line };
  // Keep the columns of the remaining text by padding the bracket out, since a call's column is
  // read from the line and the setup code is not a call.
  const pad = ' '.repeat(m[1].length + m[2].length + 3);
  return { setup: m[2].trim(), rest: pad + m[3] };
}

/** One raw line of a sharing block, before the shared prefix is resolved. */
interface All8Row {
  indent: number;
  own: All8Call[];
  links: All8GetoutLink[];
  setup?: string;
  sourceLine: number;
  spoken?: boolean;
}

/** Resolve one contiguous block: the share count of a row is its indent in CELLS, and its shared
 * prefix is the first N calls of the nearest row above that has at least N calls. */
function parseBlock(block: All8Row[], out: All8Figure[]): void {
  const base = Math.min(...block.map((r) => r.indent));
  const resolved: All8Call[][] = [];
  for (const r of block) {
    let shared = Math.max(0, Math.round((r.indent - base) / ALL8_PITCH));
    let prefix: All8Call[] = [];
    if (shared > 0) {
      for (let j = resolved.length - 1; j >= 0; j--) {
        if (resolved[j].length >= shared) { prefix = resolved[j].slice(0, shared); break; }
      }
      // Nothing above covers this many cells: treat the row as unshared rather than invent calls.
      if (prefix.length < shared) { shared = 0; prefix = []; }
    }
    const calls = [...prefix, ...r.own];
    resolved.push(calls);
    // A marker's own-line index is relative to the row's VISIBLE cells; the shared prefix is
    // inherited from the line above and sits to the left of all of them, so the index into the
    // resolved figure is simply shifted by the share count.
    const links = r.links.map((l) => ({ ...l, afterCall: l.afterCall + shared }));
    out.push({ calls, setup: r.setup, shared, links, sourceLine: r.sourceLine, spoken: r.spoken });
  }
}

/**
 * Parse a table of figures whose cells are already explicit (the abbrev.htm shape). An EMPTY cell
 * is shared: it is inherited from the row above at the same index. This is All8's own literal
 * statement of the sharing rule, and it needs no column arithmetic, so it is both the simplest
 * reader and the one used to validate the indent reader.
 */
export function parseAll8CellRows(rows: string[][]): All8Figure[] {
  // Resolved by COLUMN, not by a flattened list: a cell's share reference is "the row above at the
  // same index", so the column index has to survive resolution.
  const resolved: (string | null)[][] = [];
  return rows.map((row, i) => {
    const cells: string[] = [];
    const here: (string | null)[] = [];
    for (let c = 0; c < row.length; c++) {
      const raw = (row[c] ?? '').trim();
      const call = raw ? tokenizeAll8Line(raw)[0] ?? null : null;
      let tok: string | null = call;
      if (!tok) {
        for (let r = i - 1; r >= 0; r--) {
          if (resolved[r][c]) { tok = resolved[r][c]; break; }
        }
      }
      here.push(tok);
      if (tok) cells.push(tok);
    }
    resolved.push(here);
    const firstFilled = row.findIndex((x) => (x ?? '').trim() !== '');
    return {
      calls: cells.map((t) => decodeAll8Call(t)),
      shared: firstFilled <= 0 ? 0 : firstFilled,
      sourceLine: i,
    };
  });
}

/** The call tokens of one already-split line, used when a cell holds more than one token. */
function tokenizeAll8Line(line: string): string[] {
  return tokensWithColumns(line).map((t) => t.tok).filter(looksLikeAll8Call);
}

// ---------------------------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------------------------

/** Engine call name -> All8 abbreviation. Built from `TOKENS`, inverted. When two abbreviations
 * name the same call the FIRST declaration wins, and `TOKENS` is written so the canonical All8
 * spelling comes first (`DoPaso` before `DoPaS`/`DoPas`). */
export const ENGINE_TO_TOKEN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [tok, name] of Object.entries(TOKENS)) {
    if (!tok.startsWith('&') && !(name in m)) m[name] = tok;
  }
  for (const [tok, names] of Object.entries(MULTI_TOKENS)) {
    // A multi-call token exports as its first call; the compound is All8's own shorthand and is
    // re-expanded on import, so round-tripping is lossless even though one token became two calls.
    if (!(names[0] in m)) m[names[0]] = tok;
  }
  return m;
})();

const GROUP_BY_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(GROUP).map(([k, v]) => [v.toLowerCase(), k]),
);

/**
 * Format one engine call name as an All8 token. A group-scoped reading ("Girls Hinge") becomes the
 * 2+5 `G-Hing` form; a whole-set call becomes `--Call`. Returns null when the name has no
 * abbreviation, because inventing one would produce a token All8 never prints and nobody could read
 * back.
 */
export function formatAll8Call(name: string): string | null {
  const direct = ENGINE_TO_TOKEN[name];
  if (direct) return `--${direct}`;
  const sp = name.indexOf(' ');
  if (sp > 0) {
    const g = GROUP_BY_WORD[name.slice(0, sp).toLowerCase()];
    const base = ENGINE_TO_TOKEN[name.slice(sp + 1)];
    if (g && base) return `${g}-${base}`;
  }
  return null;
}

/** Pad a token into All8's uniform cell width so columns line up and sharing is readable. */
const cell = (tok: string): string => tok.padEnd(ALL8_PITCH - 1, ' ');

/**
 * Format figures back into All8 plain text, applying CALL SHARING: a figure whose leading calls match
 * the previous figure's omits them and is indented by that many cells.
 *
 * `names` is the engine call list per figure; a call with no All8 abbreviation is exported in
 * `[square brackets]` rather than dropped, so the round trip is honest about what it could not
 * express in All8's vocabulary.
 */
export function formatAll8Figures(figures: string[][], opts: { share?: boolean; setup?: (string | undefined)[] } = {}): string {
  const share = opts.share ?? true;
  const lines: string[] = [];
  let prev: string[] = [];
  figures.forEach((names, i) => {
    const toks = names.map((n) => formatAll8Call(n) ?? `[${n}]`);
    let shared = 0;
    if (share && i > 0) {
      while (shared < toks.length && shared < prev.length && toks[shared] === prev[shared]) shared++;
    }
    const setup = opts.setup?.[i];
    const indent = ' '.repeat(ALL8_BASE_COLUMN + shared * ALL8_PITCH);
    const head = setup ? `[${setup}] ` : '';
    lines.push(indent + head + toks.slice(shared).map(cell).join(' ').trimEnd());
    prev = toks;
  });
  return lines.join('\n');
}
