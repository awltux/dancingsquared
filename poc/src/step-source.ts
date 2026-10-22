// WHERE A CALL IN A SEQUENCE COMES FROM: a rule in the engine, or an authored catalogue tam.
//
// Asked for as: "add a small marker to indicate if a call used in a sequence is a CodedMove or from the
// catalogue."
//
// THE ANSWER IS THREE-WAY RATHER THAN TWO-WAY, and that is a fact about the registry rather than a taste in
// presentation. MEASURED over the shipped catalogue (`poc/tools/step-source-probe.mjs` pins all three counts):
// of the 21 coded moves, **10 also have catalogue authorings** and **5 declare `catalogueFallback`** - those
// five are `Do Sa Do`, `Swing Thru`, `Left Swing Thru`, `Fan the Top` and `Forward and Back`, and they are the
// whole list. `CodedMove.catalogueFallback` is the engine's own word for the difference: for those five the
// derived rule is tried first and DECLINES to the catalogue on a board it cannot read (`catalogueFallback`'s
// contract is stated in `sequencer.ts`). The other five overlapped names (the four `Face *` pivots and
// `Trade`) keep their authorings in the corpus but the engine never consults them for a
// step's reading, because the coded rule decides. So:
//
//   derived            a coded rule computes it; the catalogue is never consulted for the step's reading
//   derived+catalogue  the rule is tried first and declines to the catalogue where it cannot read the board
//   catalogue          an authored tam
//   mixed              a "while" step whose lanes do not agree - the row is several calls, not one
//   module             a stored module: a SEQUENCE of calls, which has no single source at all
//
// A MODULE IS ITS OWN ANSWER RATHER THAN `catalogue`, and that is the one thing this rule must not get wrong:
// a module name is not a catalogue call, and `findCodedMove` answering `undefined` for it is not evidence that
// some tam authored it.
//
// Pure and DOM-free, so `poc/tools/step-source-probe.mjs` runs it over the REAL registry rather than reading
// the panel's source (§4.3: the rule lives in a module small enough to import).
import { findCodedMove, groupCalls, isGroupStep, splitSelection } from 'dancing-squared-engine';
import type { ModuleStep } from 'dancing-squared-engine';

export type CallSource = 'derived' | 'derived+catalogue' | 'catalogue' | 'mixed' | 'module';

/** One call and the source that claimed it - what a `mixed` row needs to be answerable. */
export interface SourcedCall {
  call: string;
  source: CallSource;
}

/**
 * The source of ONE call name. `name` may carry its own selection - `Heads Forward and Back` - and the
 * selection is stripped, because the registry is keyed on the BASE call and the two spellings are the same
 * rule (`splitSelection` is the engine's own splitter, so the marker cannot disagree with the walk about what
 * the call is).
 */
export function callSource(name: string): CallSource {
  const coded = findCodedMove(splitSelection(name).call);
  if (!coded) return 'catalogue';
  return coded.catalogueFallback ? 'derived+catalogue' : 'derived';
}

/**
 * The source of a whole STEP, plus the calls it turned out to be.
 *
 * `isModule` is PASSED IN rather than imported because only the Sequencer knows what it registered - the same
 * reason `Sequencer.isModule` exists. A module inside a lane is impossible by construction (a `GroupLane`
 * names calls, not modules; see `GroupStep`'s own doc), but a lane's call still goes through the same
 * predicate so the two branches cannot disagree.
 */
/** What the WALK recorded for a step: the source that actually animated it. */
export type WalkedSource = 'derived' | 'catalogue' | 'mixed';

export function stepSource(
  step: ModuleStep,
  isModule: (name: string) => boolean,
  walked?: WalkedSource | null,
): { source: CallSource; calls: SourcedCall[] } {
  const one = (name: string): CallSource => (isModule(name) ? 'module' : callSource(name));
  const names = isGroupStep(step)
    ? step.groups.flatMap((lane) => groupCalls(lane))
    : [typeof step === 'string' ? step : step.call];
  const calls = names.map((call) => ({ call, source: one(call) }));
  // THE MOTION WINS, because that is what the marker is asked. `walked` comes from the engine's own replay walk
  // (`Sequencer.stepSources`), which is the once place that knows, per board, whether the coded rule or the
  // authored tam served the step - the name alone cannot say: since `apply-source.ts` a call WITH a coded rule
  // is danced from its tam wherever the two agree. Rows PAST the walk's stop have no record, which is why the
  // name-level reading below is kept as the fallback rather than deleted.
  if (walked) {
    const all = names.map((call) => ({ call, source: walked }));
    return walked === 'mixed' ? { source: 'mixed', calls } : { source: walked, calls: all };
  }
  const distinct = new Set(calls.map((c) => c.source));
  // A "while" whose lanes agree is that source; one that does not is `mixed`, and a step with no calls at all
  // is `mixed` too rather than an invented answer.
  return { source: distinct.size === 1 ? calls[0].source : 'mixed', calls };
}

/**
 * THE WALK'S PER-STEP SOURCES, ATTRIBUTED TO THE ROWS THE PANEL SHOWS.
 *
 * The panel's rows are the HISTORY (calls, figures and the occasional module name), while the walk records one
 * entry per FLAT step, so the two lists are not the same length: a module row expands to several steps and a
 * figure row is one. `flatCount` is how many flat steps one row becomes (`seq.flatten([row]).length`), supplied
 * rather than assumed so this stays a pure rule the probe can drive.
 *
 * A ROW THAT EXPANDS TO SEVERAL STEPS WITH DIFFERENT SOURCES IS `mixed`, for the same reason a "while" step is:
 * no one badge describes it. A row the walk never reached (the sequence stopped before it) is `null`, and the
 * caller falls back to the name-level reading, because those rows have no motion to report.
 */
export function rowSources(
  history: readonly ModuleStep[],
  flatCount: (step: ModuleStep) => number,
  walked: readonly WalkedSource[],
): (WalkedSource | null)[] {
  const out: (WalkedSource | null)[] = [];
  let at = 0;
  for (const step of history) {
    const n = Math.max(0, flatCount(step));
    const slice = walked.slice(at, at + n);
    at += n;
    if (slice.length === 0) { out.push(null); continue; }
    const distinct = new Set(slice);
    out.push(distinct.size === 1 ? (slice[0] as WalkedSource) : 'mixed');
  }
  return out;
}