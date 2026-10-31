// WHICH CALL VARIANTS NO NAMED FORMATION NAMES AT EITHER END - the rule behind the Call editor's two filter buttons.
//
// REPORTED as: "Add two filter buttons after the free text Find field that filter for call variants with a) unmatched
// start setup and/or b) unmatched end setup. This is to help the editor fix incomplete call variants."
//
// THE QUESTION IS THE TWO PICKERS' OWN, asked of every variant in the catalogue: does any named formation of the call's
// own size satisfy `startsFromFormation` (the rule the Start setup row applies), and does `endFormationMatch` name the end
// (the End setup row's rule, turn included)? The lists come through `formationsOfSize`, which is the SAME callback the two
// pickers are filled from, so this cannot answer about a set of formations the caller cannot choose.
//
// A VARIANT THAT WILL NOT BUILD IS THE MOST INCOMPLETE KIND, so it counts as unmatched at BOTH ends rather than being
// skipped: the scan is a census of the catalogue, and a variant missing from it would read as healthy.
//
// A GENERATOR, NOT AN ASYNC FUNCTION, and that is the design. The scan is expensive - MEASURED 5,489 variants in 3.7 s on
// this machine since the end match went to eight turns (it was 3.2 s at four), against about 0.9 s for the ms level alone -
// so the caller has to be able to breathe: yielding a frame per file would add around eight seconds, and yielding for the
// whole scan would freeze the panel for the lot. The panel counts its own time between yields (see
// `Catalog.scanSetupMatches`) and the two buttons that start it say what it costs and warn that the glyph is red for a
// reason; a probe can drive the same generator with no event loop at all.
//
// NOT THE LIBRARY'S `listFormations`, and not a size heuristic: the picker's list is the corpus's formations COMPLETED for
// their own size, which is what `corpusFormationsOfSize` hands over, and a four-dancer call is asked about the 48 four-dancer
// arrangements rather than the 201 eight-dancer ones. `formationsOfSize` is memoised here by size, because the callback
// rebuilds its list on every call and this asks it once per variant.
import { buildCall, endFormationMatch, parseCallXml, parseFormations, parseMoves, startsFromFormation } from 'dancing-squared-engine';
import type { CallBundle, FormDancer } from 'dancing-squared-engine';

/** Whether the corpus names the setup a variant starts on and the one it finishes on. */
export interface SetupMatch {
  readonly start: boolean;
  readonly end: boolean;
}

/**
 * ONE CALL TITLE in the catalogue, with the file indices of the tams that author it - `CallInfo`'s own shape.
 *
 * NOT EXPORTED, and the same for `SetupScanProgress` and `SetupScanInput` below: they are the shape of THIS function's
 * argument and return value, and every caller builds the argument as an object literal, so the `export` keyword bought
 * nothing (AGENTS §4.5, and `engine/test/export-census.mjs` counted them as such).
 */
interface ScanCallEntry {
  readonly id: string;
  readonly file: string;
  readonly tamIndices: readonly number[];
}

/** Progress after one FILE, so the caller can show a count that moves. */
interface SetupScanProgress {
  readonly done: number;
  readonly total: number;
}

/** What the scan needs from the caller: the catalogue, the raw files, and the parsed corpus the build takes. */
interface SetupScanInput {
  /** The catalogue to scan: one entry per call title. */
  readonly catalogue: readonly ScanCallEntry[];
  /** Every level file's XML, by the corpus name `CallInfo.file` carries. */
  readonly files: ReadonlyMap<string, string>;
  /** The parsed corpus the build needs - `parseFormations` / `parseMoves` output, as the loader already holds. */
  readonly formations: ReturnType<typeof parseFormations>;
  readonly moves: ReturnType<typeof parseMoves>;
  /** The named formations the two pickers offer at a dancer count - the SAME list they are filled from. */
  readonly formationsOfSize: (dancers: number) => readonly { name: string; poses: FormDancer[] }[];
}

/** The key one variant is stored under: the call's id and the SETUP's index in that call, which is what the two selects
 *  carry. A call id contains `::` and file paths, so the separator has to be a character neither can hold. */
export function variantKey(callId: string, setupIdx: number): string {
  return `${callId}#${setupIdx}`;
}

/**
 * SCAN EVERY VARIANT ONCE, yielding after each file.
 *
 * The return value is the map `main.ts`/`editor-ui.ts` filters with; the yields carry the running count. A variant whose
 * tam is missing from its file's parse (a stale catalogue entry) is treated as unbuildable rather than skipped.
 */
export function* scanSetupMatches(input: SetupScanInput): Generator<SetupScanProgress, ReadonlyMap<string, SetupMatch>, void> {
  // THE LISTS ARE MEMOISED BY SIZE: `corpusFormationsOfSize` completes and dedupes its formations on every call, and this
  // loop asks it once per variant - 5,489 times over the catalogue.
  const lists = new Map<number, readonly { name: string; poses: FormDancer[] }[]>();
  const listFor = (dancers: number): readonly { name: string; poses: FormDancer[] }[] => {
    let list = lists.get(dancers);
    if (!list) {
      list = input.formationsOfSize(dancers);
      lists.set(dancers, list);
    }
    return list;
  };

  const byFile = new Map<string, ScanCallEntry[]>();
  let total = 0;
  for (const entry of input.catalogue) {
    total += entry.tamIndices.length;
    const group = byFile.get(entry.file);
    if (group) group.push(entry);
    else byFile.set(entry.file, [entry]);
  }

  const out = new Map<string, SetupMatch>();
  let done = 0;
  for (const [file, entries] of byFile) {
    // ONE PARSE PER FILE, not one per call: the catalogue re-parses a file for every call it loads, and doing that 5,489
    // times is what would make this too slow to offer at all.
    let tams: ReturnType<typeof parseCallXml> = [];
    const xml = input.files.get(file);
    if (xml !== undefined) {
      try {
        tams = parseCallXml(xml);
      } catch {
        tams = [];
      }
    }
    for (const entry of entries) {
      for (let setupIdx = 0; setupIdx < entry.tamIndices.length; setupIdx++) {
        const tam = tams[entry.tamIndices[setupIdx]];
        let match: SetupMatch = { start: false, end: false };
        if (tam) {
          try {
            const call: CallBundle = buildCall(tam, input.formations, input.moves, true);
            const list = listFor(call.dancers.length);
            match = {
              start: list.some((f) => startsFromFormation(call, f.poses)),
              end: endFormationMatch(call, list) !== null,
            };
          } catch {
            // NOT BUILDABLE: nothing names either end, and that is the report this filter exists for.
          }
        }
        out.set(variantKey(entry.id, setupIdx), match);
      }
      done += entry.tamIndices.length;
    }
    yield { done, total };
  }
  return out;
}
