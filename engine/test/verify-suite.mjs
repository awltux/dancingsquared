// The verify suite: ONE list of harnesses, two tiers.
//
//   node test/verify-suite.mjs light   - the fast subset, for general testing
//   node test/verify-suite.mjs all     - every harness, the pre-commit gate
//
// WHY TWO TIERS. The full suite is ~9 minutes and the time is very lopsided: measured on this
// machine, the four corpus-scale harnesses (alignment-boards 128s, behaviour-audit 102s, selection
// 60s, getout-convention 52s) plus three more (all8-format 44s, getout-behaviour 44s,
// getout-conformance 39s) are 91% of it, while the remaining harnesses finish
// in about 49 seconds together. Running all nine minutes to check that a small edit did not break
// basic loading is the wrong trade, so `light` runs the cheap ones and `all` runs everything.
//
// `promenade` USED TO BE IN THIS LIST and is gone with its subject: it gated the geometry-derived
// `Promenade` family, which is no longer derived (see `coded-moves.ts`). Six of its checks could only
// fail, because they called the call by name.
//
// WHY ONE LIST. The tiers are a FIELD on each entry rather than two lists, because two lists is how
// a harness gets added to one and forgotten in the other — the repo has been bitten by exactly that
// shape of drift (a second copy of a table) more than once. To add a harness, add one entry here;
// there is nowhere else to update. `why` records the reason a harness is not in `light`, so the
// banner can say what is being skipped rather than leaving the reader to diff the lists.
//
// STDOUT IS INHERITED, deliberately: under the file sandbox a Node child spawned with piped stdio
// fails with EPERM, so the runner must not capture its children's output. `stdio: 'inherit'` keeps
// each harness's report visible exactly as the old `&&` chain did, and `spawnSync` still returns the
// exit code.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITE = [
  { h: 'gender-audit', light: true },
  { h: 'catalogue', light: true },
  // The authoring convention for a shape smaller than the set, measured over all 5963 shipped tams and
  // pinned, plus what the formation registry keeps (210 of 273 declared shapes). In `light` because it
  // is one pass over the assets, and it is the harness that makes "what does a shape of four dancers
  // mean" a fact rather than a geometric guess.
  { h: 'shape-census', light: true },
  // WHAT THE EDITOR'S START/END SETUP PICKERS OFFER, which is NOT the library's formation list. The
  // library's key is geometry up to congruence, so keyed on it the picker folded `Columns`, `Columns LH`
  // and `Column RH GBGB` - same spots, but `Columns LH` is the 180-degree rotation - onto one entry, and
  // did the same to the four `Tidal 3 and 1 Line #5-#8` and `Promenade 2` against `Promenade`. This pins
  // the positional key's counts (201 arrangements at eight dancers, 176 under the congruence key), that
  // every entry has the size the picker asked for, and that the editor accepts all 201. One pass over
  // `formations.xml`, ~1s.
  { h: 'arrangement-picker', light: true },
  { h: 'verify', light: true },
  { h: 'sequencer', light: true },
  // `Circle Four` IS A CATALOGUE CALL, and this is the negative control against the engine DERIVING it again.
  // The family's ring turn was derived (`circleFourDef` in coded-moves.ts) until the owner asked for it
  // removed and began authoring explicit tams for the eight titles. The harness pins that none of them is a
  // coded move, that all eight still apply from the boards where a tam matches, and CALLERLAB's 2N beats from
  // a squared set; it REPORTS rather than asserts the one thing the removal costs (the reported 2x2-ring
  // slot's circle lane no longer moves, the gap the authored tams still have to close). ~2s, one sequencer.
  { h: 'circle-four', light: true },
  // The CURRENT partner relation, which is not the home couple on `SeqDancer.couple`. Pins that a
  // couple's number follows the dancers as they change partners (`Square Thru 2` from a squared set
  // is the witness), that an unpaired dancer keeps its home couple, and that no number is invented
  // from an array index. ~1s, corpus-driven, and the only coverage of the relation at all.
  { h: 'couples', light: true },
  // A DANCER IS NOT A ROUND POINT. `bodies.ts` replaces centre distance with an oriented box (1.0
  // side-to-side by 0.5 front-to-back), and this pins the values the spec fixes by hand (partners at
  // the standard 2.0 width have exactly 1.000 of air), the orientation cases a centre-distance test
  // cannot separate, and that the four-axis separating-axis answer is exact rather than an axis-aligned
  // approximation (which overstates clearance by 0.596 in the case pinned). Pure arithmetic, ~0s.
  { h: 'bodies', light: true },
  // ARE THESE TWO BOARDS THE SAME BOARD? `sameBoardById` compares by dancer IDENTITY with a position
  // and heading tolerance, and it is the engine's only facing-aware equality: `boardSig` is
  // positions-only by design and `reorderLike` fixes an order rather than testing one. The harness
  // pins the difference that matters — a board whose dancers all face the wrong way is NOT the same
  // board, and `boardSig` accepts it, so a goal test built on the signature would score a wrong
  // arrival as correct. Also pins the id:0 refusal (`boardAtBeat`'s unknown-identity board), the
  // wrapped heading comparison, and MEASURED that replaying a call twice is bit-identical (worst
  // difference 0), which is why the tolerance has no population near it. Pure arithmetic plus one
  // ordinary call: ~2s.
  { h: 'board-identity', light: true },
  // THE ROTATION SET, AND WHICH ALIGNMENT WINS A TIE. `match.ts` tries eight rotations (quarter turns AND
  // diagonals) x direct/reflected and keeps the best by summed error. This pins the premise that makes that
  // safe for a square-lattice board: an already-aligned shape is never RE-ORIENTED and never read as a
  // REFLECTION (138 unique shapes, both tolerances), while controls prove rotation and the diagonals are
  // genuinely reachable -- a quarter-turned target reports -90, a 45-degree one reports -45 -- and that the
  // heading-stripped square, whose eight dancers sit at 45-degree spacing, has an EXACT diagonal tie
  // (error 8.9e-16) that only the tie-break keeps out. Corpus-driven but geometry only: ~2s.
  { h: 'rotation-tiebreak', light: true },
  // THE PATH GUARD. Pins that the reported squared-set `Dosado` is DETECTED as an interpenetration
  // (-0.390 on 1+4) while its ENDPOINT stays clean at 2.000 — which is why no endpoint threshold could
  // have caught it — that a legitimate two-dancer `Dosado` is NOT flagged, and that the three modes
  // (report/guard/off) behave. Corpus-driven but one board: ~2s.
  { h: 'body-collision', light: true },
  // A SCOPED STEP MOVES ONLY THE DANCERS IT SELECTS. `Heads Dosado` and `Sides Dosado` moved all eight,
  // because a 4-dancer subset finds no catalogue variant and execution fell through to the whole-board
  // animator - while `Head Boys Dosado` (a 2-dancer subset, which DOES match `Opposite Boy`) was right.
  // Pins that only the selected move, that the call is still applied rather than silently refused, that
  // the already-correct scopes do not regress, and that the last frame still converges. ~2s.
  { h: 'scoped-dosado', light: true },
  // THE PICKER'S PERMISSION LAYER. `permissions.ts` decides what the call chooser may OFFER, level-scoped
  // so a later programme overrides an earlier one. Pins the reported case (all-8 `Dosado` from a square is
  // not offered at MS), that the match is exact so `Left Dosado` is untouched, that scoped forms survive,
  // that an MS deny PLUS contradicts is lifted at PLUS, and that this is PICKER-ONLY - `applyToBoard`
  // still applies the suppressed call. Pure logic plus one board: <1s.
  { h: 'permissions', light: true },
  // PARALLEL CALLS FOR THE REMAINING DANCERS. The `GroupStep` construct already existed and `modules.mjs`
  // pins its rules; this pins what was missing for the reported case ("Sides Promenade Home" with the
  // heads in the path): that the remainder is NAMEABLE (`remainingSelection` derives `All Except X` from
  // the resolved ids, because a complement often has no vocabulary entry), that a composed step moves
  // BOTH groups (with a witness where both demonstrably move - the `modules.mjs` witness would not catch
  // a dropped group, since `Star Thru` closes and reads as a no-op to a position-only check), that it is
  // ONE undo, and that it still converges. ~2s.
  { h: 'parallel-calls', light: true },
  // `STEP FORWARD` AND THE DEPENDENT "while" GROUP. The one shape a composed step could not express: a group
  // whose result depends on what the OTHER groups did, because its dancers step forward and then each decides
  // whether the spot it left is free. Pins the call (2 units along the dancer's own facing, nobody else
  // moving), both outcomes on named witnesses (four girls stay on a Double Pass Thru, four heads return on a
  // squared set), that the decision is PER DANCER, that the step costs the PARTNER's beats rather than its own,
  // the two refusals a dependency needs, and - as the negative control - that the plain independent merge is
  // the board a collision-free rule must differ from exactly where a spot was taken. ~1s.
  { h: 'step-forward', light: true },
  // Combined dancer groups — `Head Boys`, `Center Girls`, `Head Boys and Side Girls`, `All Except X`.
  // The grammar is the reference's (tokens intersect within a side, sides union, a negator subtracts),
  // and this is the only coverage of it. It also pins that a call TITLE beginning with a group word
  // (`Boys Trade`) still reaches the whole-board reading, which is the collision the splitter could
  // introduce. ~1s, corpus-driven.
  { h: 'combined-groups', light: true },
  // What a CHOSEN GROUP can actually perform, which is the question the Sequencer's call picker has.
  // Pins the two measured defects: the picker showing "no calls, just Modules" (every whole-set call
  // dropped by a bad guard) and its list offering `Promenade`/`Swing Your Partner` to `Head Boys`,
  // which the group cannot do. ~1s.
  { h: 'group-calls', light: true },
  // A SCOPED call must charge its beats AND move. `Head Boys Dosado` used to be applied, charged zero
  // beats, and animate nothing - the walk could not find a variant for a scoped step, and the authored
  // motion (`Opposite Boy`, a closing circular path) was never followed. ~1s.
  { h: 'scoped-animation', light: true },
  // EVERY SCOPED CODED STEP x the six whole-set selections, and it is the gate for the SENTENCE the entry
  // above states. It was written with the `Do Sa Do` fix and then registered NOWHERE - which is the hole
  // that let the next defect in the same class hide for a whole session: its metric took the MAX over every
  // sampled beat, and the last sample IS the applied board, so a step that stands still for its whole
  // duration and snaps on the final frame scored exactly like one that dances. MEASURED after the metric was
  // repaired: 20 of the 51 steps that apply with non-zero beats moved NOTHING before the final frame - the
  // whole scoped `Face *` family, reported from use as "Heads Face right has a single transition between
  // frame 0.9 and 1.0". ~8s, 138 applies plus 33 samples each, so it is in `light`.
  { h: 'scoped-coded-animation-probe', sub: 'tools', light: true },
  // A title authored TWICE, with the WRONG stance first in the file - `Single Circle Left Full` in
  // `ms/circle.xml`. `parallelApply` used to return on the first setup that tiled and discard its
  // error, so document order decided which of two readings of the same call was danced. In `light`
  // because it is one call on one board: ~1s, and it is the only coverage of the variant-selection
  // order at all.
  { h: 'scircle-instance', light: true },
  // `CallLibrary.register` used to `set` the title's variant list, so a SECOND registration for one
  // title silently replaced the first instead of adding to it - and the format's identity for a setup
  // is `(title, formation xor from)`, which a title-only key discards. This pins that two authorings
  // survive two `register` calls, that one call carrying both still keeps both, and that
  // re-registering the identical setup does not inflate the list. ~1s, corpus-driven.
  { h: 'scircle-register', light: true },
  // The module model and the "while" step (`GroupStep`): CALLERLAB's "Centers Square Thru while
  // Outsides Trade", which the catalogue could previously only express by hand-authoring every
  // dancer's path inside one `<tam>`. Pins the four rules the step promises (disjoint, atomic,
  // calls-only, simultaneous), that a grouped result IS the per-group solo results merged by id, that
  // the animation lands exactly on the applied board, and that `collapseModule` composes a matrix
  // across it. Fast: one board, a handful of applies.
  { h: 'modules', light: true },
  { h: 'mainstream', light: true },
  { h: 'matrix', light: true },
  { h: 'matrix-getout', light: true },
  { h: 'editor', light: true },
  { h: 'features', light: true },
  { h: 'bind-audit', light: true },
  { h: 'alignment', light: true },
  // NOT in `light`, despite being the most valuable harness here: it replays every corpus call on
  // every named board and measures 110s, which would more than double the tier that exists to be
  // quick. The animation is the ONE consumer of the analyzer that can be wrong while every stored
  // board is right, so no other harness can see this class at all - the silent coded call, the
  // parallel grouping the animator re-derived differently from the applicator, and the final-frame
  // jump were all found here.
  { h: 'anim-convergence', light: false, why: 'replays every corpus call on every named board' },
  // Applies every ms call to every named FSM state (about 30s) to measure which READING each
  // application got - whole board, every dancer through k-dancer boxes, or only some boxes with the
  // rest standing - and how many applications end on a board the namer refuses, which the FSM now
  // records as an edge with a null end rather than dropping. There are 42 named states since Stage 0b
  // scoped the state set to the formations ms calls are used from (it was 133). Since schema 2 it also
  // CROSS-CHECKS the reading the asset stores against a fresh application of the same edge, dispatching
  // the way the table does - several coded moves are also catalogue titles and the two authorings differ.
  { h: 'reading-census', light: false, why: 'applies every ms call to all 42 named FSM states' },
  // The gate the FSM asset never had. `assets/fsm-ms.json` is generated by
  // `poc/scripts/build-fsm-asset.mjs`, which was wired into no npm script and no harness - so the
  // asset sat at 1961 edges while the engine produced 2205, and nothing could have noticed. This
  // rebuilds the table the generator's way (importing `buildCatalog`, so the gate cannot drift from
  // the thing it guards) and fails when disk disagrees, in EITHER direction, comparing the WHOLE edge
  // (call, end, reading, endKind) rather than just the end - a rebuild that lost schema 2's new facts
  // would pass a narrower check. ~30s, all of it the table build, so it is not in `light`.
  { h: 'fsm-asset', light: false, why: 'rebuilds the whole transition table to compare against the stored asset' },
  // Stage 0 of the modules/FSM plan: the declared CELL vocabulary and the reachable-vs-declared split.
  // It reports the two vocabularies Stage 0b separated - the DECLARED lattice (155 geometries) and the
  // engine's level-scoped STATE SET (70 at the lattice's finer key, 65 states in the asset) - and that
  // 55% of legal applications end on a geometry nothing declares, which is why the node set is bounded
  // by DECLARATION and not by reachability. Lives in `tools/` and is reached through `sub`, like the
  // determinism audit. ~25s, all of it the sweep.
  { h: 'cell-census', sub: 'tools', light: false, why: 'sweeps every legal application to classify its end against the lattice' },
  // THE APPLY FAULTS, PINNED. Every (formation, call) application whose END board already has two dancers
  // on one spot - which no animation can repair - with the split that says whose fault each is. It was a
  // bare survey before this and the count went 22 -> 50 with no gate noticing. ~40s, all of it the sweep.
  // Its pins are a CEILING and a "no non-congruent admission", both improvement-safe: fewer faults passes.
  { h: 'apply-fault-gate', sub: 'tools', light: false, why: 'sweeps every named formation against the corpus calls to pin the apply faults and classify them' },
  // Stage 0b, and the gate for the LEVEL dimension: which formations a programme's calls may be used
  // from. It measures that the state set is the named formations the registered calls declare plus
  // their start setups, and it keeps the STRICT-vs-PERMISSIVE decision as a measurement - the
  // permissive closure at ms reaches 78 declared geometries, 34 of which only a level ABOVE Mainstream
  // names, so "reachable" would admit formations no ms call is authored from. ~35s: it builds the ms
  // sequencer and runs the closure, which is the expensive half.
  { h: 'level-census', sub: 'tools', light: false, why: 'runs the permissive closure over the ms call set to re-decide strict-vs-permissive' },
  // The gate for CANONICAL IDENTITY, and it exists because the setup registry was built, gated and
  // then wired to NOTHING while the app used a different path that only agreed with it on 3 of its 10
  // keys. It pins the two paths apart (`boardForSetup` stands `Normal Lines` up reading `0L1p`, the
  // registry's zero line is `0L1o`), pins the primitive that closes the gap, and pins how much
  // legality identity buys each named formation - which is the size of the FSM edge movement when the
  // state boards get their identity. ~20s, all of it building the sequencer.
  { h: 'canonical-identity-probe', sub: 'tools', light: false, why: 'measures both setup paths against the registry and pins the identity the primitive stamps' },
  // "CAN THE SEQUENCER DO X" IS A MEASUREMENT, NOT A MEMORY. Asked whether it handles what a caller
  // says as "girls center, boys sashay" - authored here as `Ladies In, Men Sashay`, and written
  // `Ladies Center & Men Sashay` by the corpus. It does: legal from a Circle, an EXACT variant match,
  // landing back on a Circle, and the FSM carries it as a self-loop. What it does NOT do is pinned
  // beside it - the two authored directions differ only in `from` ("Circle Left"/"Circle Right"), which
  // is not a formation the engine builds, so the first match always wins; and the Circle it stands up
  // is anonymous. ~20s, all of it building the sequencer.
  { h: 'ladies-sashay-probe', sub: 'tools', light: false, why: 'pins whether the Ladies In, Men Sashay figure can be danced, and what it cannot do' },
  { h: 'all8-formation-map', light: true },
  { h: 'getout-conformance', light: false, why: 'decodes all 553 published lines' },
  { h: 'all8-format', light: false, why: 'imports all 188 figures and derives all 29 alignments' },
  { h: 'getout-behaviour', light: false, why: 'runs the 412-line corpus' },
  { h: 'getout-convention', light: false, why: 'searches get-outs over the corpus alignments' },
  { h: 'selection', light: false, why: 'builds boards across formations and calls' },
  { h: 'behaviour-audit', light: false, why: '143 assertions, many over every formation' },
  { h: 'alignment-boards', light: false, why: 'the heaviest: arrangement tables over the corpus' },
  // Phase 10's done-when, now met: the walk procedures all agree (round 33 measured 7 of 7 procedures
  // at 116 figures with ZERO differences, and the baseline repeating identically), so the audit that
  // established the divergence becomes the gate that keeps it from coming back. It lives in `tools/`
  // as an analysis tool and is reached through `sub`.
  { h: 'determinism-audit', sub: 'tools', light: false, why: 'runs the corpus once per walk procedure' },
  // Phase F's closure requires the CALLERLAB diff to be a harness "so it cannot drift". It pins four
  // measured numbers exactly; a movement in EITHER direction fails, so an improvement is re-pinned
  // deliberately rather than absorbed silently.
  { h: 'callerlab-diff', sub: 'tools', light: false, why: 'parses the definitions PDF text and walks the catalogue' },
  // NOT a tier above: a TARGET. `all8-figures` states the finish line ("every one of All8's 188
  // published Mainstream figures is recognised") and is red until the remaining edge cases are
  // fixed, so it is excluded from BOTH tiers - a permanently-failing entry in the pre-commit gate
  // trains everyone to ignore the gate. Run it on its own to see how far off the finish line is.
  { h: 'all8-figures', future: true, why: 'the target suite: red until every published figure is recognised' },
];

const mode = process.argv[2] === 'light' ? 'light' : process.argv[2] === 'figures' ? 'figures' : 'all';
const run = SUITE.filter((e) => (mode === 'figures' ? e.future : mode === 'all' ? !e.future : e.light));
const skipped = SUITE.filter((e) => !run.includes(e));

const MODE_LABEL = { light: 'LIGHT (fast subset)', all: 'FULL (pre-commit gate)', figures: 'TARGET (not a gate)' };
console.log(`verify-suite: ${MODE_LABEL[mode]} - ${run.length} of ${SUITE.length} harnesses`);
if (mode === 'light') {
  console.log('  SKIPPING the corpus-scale harnesses. This tier is for quick iteration; run the full');
  console.log('  suite (`npm run verify`) before committing, because everything below is NOT checked:');
  for (const e of skipped) console.log(`    ${e.h.padEnd(20)} ${e.why}`);
}

// THE CORPUS REVISION THESE NUMBERS BELONG TO, printed before anything is run. A red gate is undecidable
// without it: the verdict moves with `assets`, and a run on a mid-edit corpus cannot tell a
// regression from corpus churn (TODO.md P1.5). GIT PRINTS THE ANSWER ITSELF, with `stdio: 'inherit'`, because
// a PIPED child fails with EPERM under the file sandbox - the same reason every harness below is spawned
// that way (AGENTS.md trap 3), and why this reads no output of its own. An empty file list means the corpus
// is the committed tree; a list means these numbers belong to an uncommitted state.
const repoRoot = path.resolve(here, '..', '..');
console.log('verify-suite: corpus revision (git prints it; a file list means assets is DIRTY, so the');
console.log('  numbers below belong to that uncommitted state and must not be compared with a committed run):');
spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { stdio: 'inherit' });
spawnSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', 'assets'], { stdio: 'inherit' });

const results = [];
let failed = null;
for (const e of run) {
  const started = Date.now();
  // `sub` is for a harness that lives in `test/` but not directly in it - currently only the
  // determinism audit, which is an analysis tool in `test/tools/` that Phase 10's done-when promotes
  // into this suite. Keeping the entry HERE preserves the file's own rule that a harness is added in
  // exactly one place; the alternative (a second copy of the tool under `test/`) is the duplication
  // this suite was written to avoid.
  const file = path.join(here, ...(e.sub ? [e.sub] : []), `${e.h}.mjs`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  const seconds = (Date.now() - started) / 1000;
  results.push({ h: e.h, seconds });
  // WHICH HARNESS THOSE CHECK LINES BELONG TO. Every harness is spawned with `stdio: 'inherit'` (trap 3), so
  // the suite cannot capture one's output and the log is a single undivided stream: without this line a run
  // names only the FIRST failing harness, and every later red has to be attributed by reading its message.
  // That is the difference between a measurement and a log, so it is printed as each harness settles.
  console.log(`\nverify-suite: ${r.status === 0 ? 'ok    ' : 'FAILED'} ${e.h} (${seconds.toFixed(1)}s)`);
  if (r.status !== 0 && failed === null) failed = { h: e.h, status: r.status };
}

const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\nverify-suite: ${run.length} harness(es) in ${total.toFixed(1)}s`);
for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 5)) {
  console.log(`  slowest: ${r.h.padEnd(20)} ${r.seconds.toFixed(1)}s`);
}
if (failed) {
  console.log(`\nverify-suite: FAILED at ${failed.h} (exit ${failed.status})`);
  process.exit(failed.status ?? 1);
}
console.log('verify-suite: all green.');
