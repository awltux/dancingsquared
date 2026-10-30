// THE SETUPS A START BOARD CAN BE CHOSEN FROM, built from the corpus's own `<formation>` elements.
//
// WHAT WAS WRONG WITH THE OLD PICKER. The sequencer's Board drawer filled `#seqFormation` from
// `CallLibrary.getUniqueFormations()`, whose key is geometry up to CONGRUENCE (`matchFormations` at 0.5) and which
// keeps one representative NAME per shape. So every setup that shares an `fid` with a listed name was hidden:
// `Normal Lines` and `Sashayed Lines` are one shape and two arrangements; `Columns` and `Column RH GBGB` are one
// shape and two arrangements; and the 274 setups that exist only as a call's embedded `<formation>` block were not
// in the library's name list at all. Reported as "this hides the other formation elements with the same FID ... it
// should select a start setup, i.e. a unique SID".
//
// THE POPULATION IS THE CORPUS, DEDUPED BY `sid`. Every named definition in `formations.xml` and every inline
// `<formation>` block in an authored tam, completed to the whole set, filtered to the size the sequencer's board is
// (eight dancers), then deduped by `sid` - the id that says the arrangement AND the order the dancers are listed in
// (`setup-id.ts`), which is what a start setup is. MEASURED over the shipped corpus: 218 named eight-dancer
// definitions and 489 inline eight-dancer blocks = 707 ELEMENTS, which are **484 SETUPS over 295 shape ids**, 82 of
// those shapes carrying more than one setup. The library offers 138 names, and all 138 are in that 484.
//
// THE LABEL IS `[shape name] setup name`, the shape name FIRST so the list orders by it. "shape name" is the common
// name of the `fid`: the corpus names the shape only through the names of the definitions standing on it, so it is
// DERIVED - the longest WORD PREFIX every name in the group contains as a word, at least three characters, a tie on
// length preferring the LATER word (the head noun) - with the corpus's own name as the fallback when the group has
// one named setup or no shared word. MEASURED: `Normal Lines` + `Sashayed Lines` => `Lines`, `Columns` + `Column RH
// GBGB` => `Column`, `Ocean Waves` + `Ocean Waves RH BGGB` => `Waves`, `Two-Faced Lines` + `Two-Faced Lines RH` =>
// `Lines` (not `Faced`, which is the tie the position breaks), and a single-setup shape or one whose shape name is
// its own name is UNBRACKETED (303 of the 484 rows). The setup name is the corpus's own: a named definition's
// `name`, or an inline block's `setupLabel` (the engine's precedence), or the tam title when both are empty.
//
// A NAME THAT REPEATS gets its `sid` appended - MEASURED: 73 rows, from several inline blocks that name their setup
// the same way as their named definition (`Lines Facing Out`) to two different setups sharing one name (`As Couples
// Slide Thru`) - so every option reads differently and the sid is visible exactly where it is needed.
//
// WHY COMPUTED IDS RATHER THAN THE STORED TAGS. A row's `sid` must be the id of the BOARD the picker sets, or the
// select cannot show the current board after `Set`; so the row's ids come from the same engine functions the board
// will be identified with (`formationId`/`arrangementId`/`setupId`). The corpus's stored `fid`/`aid`/`sid` are the
// CROSS-CHECK - `poc/tools/setup-picker-probe.mjs` asserts stored equals computed for every element today. `sid` is
// the one tag a reorder can drift (`scripts/tag-formations.mjs` says why it does not follow), and if it ever does
// the probe is the instrument that says so rather than the picker quietly trusting a stale value.
//
// THE COMPLETION RULE IS THE CORPUS'S, not this file's. A definition writes half a set unless it DECLARES itself
// whole - `asymmetric="true"` on a named `<formation>`, or `symmetry="1"` on a `<tam>` - and the rule is the engine's
// `completedFormation` (`formation-order.ts`), pinned by `engine/test/formation-order.mjs` and by
// `poc/tools/formation-shape-probe.mjs`. MEASURED at eight
// dancers: 0 named definitions declare `asymmetric` (the 11 that do are all two-dancer) and 0 inline blocks declare
// `symmetry="1"`, so the declaration branch is inert on today's corpus and is here because it is the rule.
//
// WHAT IS DELIBERATELY NOT HERE: no DOM, no `?raw` import, no filesystem - the inputs are TEXTS and parsed tams, so
// a probe can build the same catalogue from the real corpus. No filtering of the corpus by level or by call: this is
// what the corpus carries, not what a programme's call set reaches.
import {
  arrangementId,
  completedFormation,
  formationId,
  parseFormations,
  setupId,
  setupLabel,
  UNKNOWN_COUPLE,
} from 'dancing-squared-engine';
import type { Board, FormDancer, Matchable } from 'dancing-squared-engine';
// LOADED AS SOURCE BY A PROBE (`poc/tools/setup-picker-probe.mjs`), which is why this module has no relative import
// at all: anything it needed would have to be extension-explicit for node's type stripping. The half-set rule used
// to be one of those (`./half-set.ts`); it is the engine's `completedFormation` now, which needs no such trade.

const DEG = Math.PI / 180;

/** The board size the sequencer stands up: the setup population is the corpus's eight-dancer elements. */
export const SETUP_PICKER_SIZE = 8;

/** The shortest word a shape name may be derived from, so `RH`/`GBGB` and a two-letter accident are not names. */
const SHAPE_WORD_MIN = 3;

/** One `<formation>` element of the corpus, as the catalogue reads it. */
interface SetupElement {
  kind: 'named' | 'inline' | 'user';
  name: string;
  /** Where it came from, for the option's tooltip: a formation name, `file - title #index`, or a user label. */
  source: string;
  /** The written element completed to the whole set, in the element's own ORDER. */
  dancers: FormDancer[];
  sid: string;
  fid: string;
  aid: string;
}

/** One SETUP: the elements that share its `sid` collapse into one row. */
export interface SetupRow {
  sid: string;
  fid: string;
  aid: string;
  /** The setup's own name: the representative element's name. */
  name: string;
  kind: 'named' | 'inline' | 'user';
  source: string;
  /** Every other name carried by an element with this `sid` (`Static Square`/`Squared Set`, ...). */
  aliases: string[];
  dancers: FormDancer[];
  /** The shape's derived common name: the `[bracket]` in `display`. */
  shape: string;
  /** What the picker shows: `[shape] name`, `name` when the two agree, plus `(sid)` where it would collide. */
  display: string;
}

interface SetupGroup {
  fid: string;
  shape: string;
  rows: SetupRow[];
}

export interface SetupCatalogue {
  rows: SetupRow[];
  groups: SetupGroup[];
  /** The element counts the rows were built from, so a census can state its denominator. */
  elements: { named: number; inline: number; user: number; total: number };
}

/** A source file's parsed tams: what `data.ts` already holds after its catalogue parse. */
export interface SetupSourceFile {
  /** Corpus-relative `level/base`, e.g. `ms/circle`. */
  file: string;
  tams: { index: number; tam: SetupTam }[];
}

/** The parts of a parsed `<tam>` the catalogue reads. Structural, so a probe can hand in `parseCallXml` output. */
export interface SetupTam {
  title: string;
  from: string;
  formationAttr: string | null;
  symmetry: number;
  dancers: { gender?: string; x: number; y: number; angleDeg: number }[];
}

interface SetupCatalogueInput {
  formationsXml: string;
  files: Iterable<SetupSourceFile>;
  userFormations?: { name: string; dancers: readonly (Matchable & { gender?: string })[] }[];
}

/**
 * THE LONGEST WORD PREFIX EVERY NAME SHARES AS A WORD, or null.
 *
 * A WORD IS THE UNIT, and the match is a prefix of a word, which is what makes `Columns` and `Column RH GBGB`
 * share `Column` (a word of one is a prefix of a word of the other). A mid-word match is not a match -
 * `Cab`/`Scab` share nothing, because `cab` does not START a word of `Scab`. `SHAPE_WORD_MIN` keeps `RH`, `LH`
 * and `BGGB`-style tokens out of the vocabulary.
 *
 * THE TIE GOES TO THE LATER WORD, because a family's head noun is the last word: `Two-Faced Lines` and
 * `Two-Faced Lines RH` share `Two` (3), `Faced` (5) and `Lines` (5), and `Lines` is the name a caller would use.
 */
export function sharedShapeName(names: readonly string[]): string | null {
  const distinct = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ''))];
  if (distinct.length < 2) return null;
  const words = (s: string): string[] => s.match(/[A-Za-z0-9]+/g) ?? [];
  const tokenised = distinct.map(words);
  let best: { len: number; pos: number; label: string } | null = null;
  for (const ws of tokenised) {
    for (let wi = 0; wi < ws.length; wi++) {
      const w = ws[wi];
      for (let len = w.length; len >= SHAPE_WORD_MIN; len--) {
        const prefix = w.slice(0, len);
        const lower = prefix.toLowerCase();
        if (!tokenised.every((other) => other.some((x) => x.toLowerCase().startsWith(lower)))) continue;
        if (best === null || lower.length > best.len || (lower.length === best.len && wi > best.pos)) {
          best = { len: lower.length, pos: wi, label: prefix };
        }
        break; // the longest prefix of THIS word that every name shares
      }
    }
  }
  return best === null ? null : best.label;
}

/** The shape's common name for a group of rows: the derivation above, with the corpus's own names as the fallback. */
function shapeNameOf(rows: readonly SetupRow[]): string {
  if (rows.length === 1) return rows[0].name;
  const named = rows.filter((r) => r.kind === 'named');
  if (named.length >= 2) return sharedShapeName(named.map((r) => r.name)) ?? named[0].name;
  if (named.length === 1) return named[0].name;
  return sharedShapeName(rows.map((r) => r.name)) ?? rows[0].name;
}

/** The board the ids are taken over: the poses plus placeholder identity, which every id here ignores. */
function boardOf(dancers: readonly FormDancer[]): Board {
  return {
    dancers: dancers.map((p, i) => ({
      id: i + 1,
      couple: UNKNOWN_COUPLE,
      gender: (p.gender ?? 'phantom') as 'boy' | 'girl' | 'phantom',
      x: p.x,
      y: p.y,
      heading: p.heading,
    })),
  };
}

/** Every named `<formation>` that declares itself the whole set: the corpus's own `asymmetric` statement. */
function declaredWhole(formationsXml: string): Set<string> {
  const out = new Set<string>();
  for (const m of formationsXml.matchAll(/<formation\b[^>]*>/g)) {
    const open = m[0];
    if (!/\basymmetric="true"/.test(open)) continue;
    const name = /\bname="([^"]*)"/.exec(open)?.[1];
    if (name) out.add(name);
  }
  return out;
}

/**
 * THE CATALOGUE. Named definitions and inline blocks are completed, filtered to the picker's size, given computed
 * ids, deduped by `sid`, grouped by `fid`, labelled `[shape] name`, and sorted shape-first.
 */
export function buildSetupCatalogue(input: SetupCatalogueInput): SetupCatalogue {
  const elements: SetupElement[] = [];
  const whole = declaredWhole(input.formationsXml);

  for (const [name, written] of parseFormations(input.formationsXml)) {
    const poses = written.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
    const dancers = whole.has(name) ? poses : completedFormation(poses);
    if (dancers.length !== SETUP_PICKER_SIZE) continue;
    const id = idsOf(dancers);
    if (!id) continue;
    elements.push({ kind: 'named', name, source: `formations.xml - ${name}`, dancers, ...id });
  }

  for (const file of input.files) {
    for (const { index, tam } of file.tams) {
      if (tam.dancers.length === 0) continue;
      const poses = tam.dancers.map((d) => ({
        x: d.x,
        y: d.y,
        heading: d.angleDeg * DEG,
        gender: (d.gender ?? 'boy') as 'boy' | 'girl' | 'phantom',
      }));
      const dancers = tam.symmetry === 1 ? poses : completedFormation(poses);
      if (dancers.length !== SETUP_PICKER_SIZE) continue;
      const id = idsOf(dancers);
      if (!id) continue;
      const label = setupLabel(tam.formationAttr, tam.from);
      const name = label === '(default)' ? tam.title : label;
      elements.push({ kind: 'inline', name, source: `${file.file} - ${tam.title || '(untitled)'} #${index}`, dancers, ...id });
    }
  }

  // THE USER'S OWN LABELLED SHAPES are elements too. They are whole boards already (the editor saved the board it
  // labelled), so they are NOT completed; an unrecognised shape simply joins or forms a group.
  for (const f of input.userFormations ?? []) {
    const dancers = f.dancers.map((d) => ({
      x: d.x,
      y: d.y,
      heading: d.heading,
      gender: (d.gender ?? 'phantom') as 'boy' | 'girl' | 'phantom',
    }));
    const id = idsOf(dancers);
    if (!id) continue;
    elements.push({ kind: 'user', name: f.name, source: `user formation - ${f.name}`, dancers, ...id });
  }

  // ONE ROW PER SETUP, and the representative is the corpus's own name for it where there is one.
  const bySid = new Map<string, SetupRow>();
  const prefer = { named: 3, user: 2, inline: 1 } as const;
  for (const e of elements) {
    const found = bySid.get(e.sid);
    if (!found) {
      bySid.set(e.sid, {
        sid: e.sid, fid: e.fid, aid: e.aid, name: e.name, kind: e.kind, source: e.source,
        aliases: [], dancers: e.dancers, shape: '', display: '',
      });
      continue;
    }
    if (e.name !== found.name && !found.aliases.includes(e.name)) found.aliases.push(e.name);
    if (prefer[e.kind] > prefer[found.kind]) {
      found.name = e.name;
      found.kind = e.kind;
      found.source = e.source;
      found.dancers = e.dancers;
    }
  }

  const grouped = new Map<string, SetupRow[]>();
  for (const row of bySid.values()) {
    const list = grouped.get(row.fid) ?? [];
    list.push(row);
    grouped.set(row.fid, list);
  }
  const groups: SetupGroup[] = [];
  for (const [fid, rows] of grouped) {
    const shape = shapeNameOf(rows);
    for (const r of rows) {
      r.shape = shape;
      r.display = shape.toLowerCase() === r.name.toLowerCase() ? r.name : `[${shape}] ${r.name}`;
    }
    groups.push({ fid, shape, rows });
  }

  // TWO SETUPS CAN CARRY ONE NAME (MEASURED: `As Couples Slide Thru` twice under `Lines`, `All 4 Couples Slide
  // Thru` twice under `Static Square`), and two options that read the same are one option to a caller. The `sid` is
  // appended only where it is needed, so the common case stays the label the request asked for.
  const counts = new Map<string, number>();
  for (const row of bySid.values()) counts.set(row.display, (counts.get(row.display) ?? 0) + 1);
  for (const row of bySid.values()) if ((counts.get(row.display) ?? 0) > 1) row.display = `${row.display} (${row.sid})`;

  const rows = [...bySid.values()].sort(
    (a, b) => a.shape.localeCompare(b.shape) || a.display.localeCompare(b.display),
  );
  groups.sort((a, b) => a.shape.localeCompare(b.shape));

  return {
    rows,
    groups,
    elements: {
      named: elements.filter((e) => e.kind === 'named').length,
      inline: elements.filter((e) => e.kind === 'inline').length,
      user: elements.filter((e) => e.kind === 'user').length,
      total: elements.length,
    },
  };
}

/**
 * THE CORPUS FORMATIONS WHOSE IDS CARRY THESE TAGS, by name - the question the Call editor's End setup row asks about an
 * unnamed end ("which formations are this SHAPE? which are this ARRANGEMENT?"). `shapes` holds the names whose `fid` is
 * the one asked for, i.e. the same spots and facings whatever the rotation; `arrangements` holds the names whose `aid`
 * is, i.e. the same board including which dancer sits where.
 *
 * THE LIST IS THE CALLER'S OWN SIZE, NOT THE BOARD PICKER'S CATALOGUE. `buildSetupCatalogue` is filtered to
 * `SETUP_PICKER_SIZE` (eight dancers), so answering this from its rows made EVERY shorter end report "no corpus formation
 * carries this shape" while `formations.xml` held that exact id. MEASURED on `Circle Four Left 3/4` from `Facing
 * Couples`: the end board's `fid F3-nlnlii69` and `aid A1-6r10ge6d` are `Facing Couples`' own, and the captions said
 * nothing carried either. The caller therefore passes `corpusFormationsOfSize(call.dancers.length)`, which is also the
 * list the picker beside the caption offers - a caption that named a formation the caller could not select would be a
 * dead end.
 *
 * Asked for as: "If the unknown 'end setup' matches a formation or arrangement, list the fid and aid at the top of the
 * list of setups."
 */
export function formationsCarrying(
  formations: readonly { name: string; poses: readonly FormDancer[] }[],
  ids: { fid: string | null; aid: string | null },
): { shapes: string[]; arrangements: string[] } {
  const shapes: string[] = [];
  const arrangements: string[] = [];
  for (const formation of formations) {
    const board = boardOf(formation.poses);
    if (ids.fid !== null && formationId(board) === ids.fid) shapes.push(formation.name);
    if (ids.aid !== null && arrangementId(board) === ids.aid) arrangements.push(formation.name);
  }
  return { shapes, arrangements };
}

/** The three computed ids of a completed setup, or null when it has no physical dancers to name. */
function idsOf(dancers: readonly FormDancer[]): { sid: string; fid: string; aid: string } | null {
  const board = boardOf(dancers);
  const sid = setupId(board);
  if (sid === null) return null;
  return { sid, fid: formationId(board), aid: arrangementId(board) };
}
