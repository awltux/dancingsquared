# dancing-squared-engine

A **standalone, renderer-agnostic square-dance engine** — the pure core for the
Dancing Squared project. It parses taminations XML into a normalized call
bundle and evaluates dancer **poses** (position + facing + hands) and **hand
holds**, with no rendering or framework dependencies.

It is the extracted, packaged version of the engine proven in `poc/`.

## What it provides

- **`convert`** — taminations XML → normalized `CallBundle` (moves/formations
  resolution, full-square mirror duplication).
- **`core`** — pure pose evaluation: `poseFor(dancer, beat)` → `{x, y, heading,
  hands}` from cubic Bézier paths; facing via the rotation Bézier or the travel
  tangent.
- **`handholds`** — hand-hold derivation from poses (codified rules: one partner
  per hand, mutual reach, side adjacency; static line/ring vs active grip).

## Install

```bash
npm install dancing-squared-engine
```

## Quick start (browser)

DOMParser is global in the browser, so:

```ts
import { Engine } from 'dancing-squared-engine';

const engine = new Engine(movesXml, formationsXml); // pass the two XML strings
const call = engine.loadCall(callXml, 0 /*tam index*/, true /*mirror*/);
const poses = engine.poses(call, 3.5);          // every dancer at beat 3.5
const holds = engine.handholds(poses, 'active'); // hand holds at that moment
```

## Node

Node has no `DOMParser`; provide one before use:

```ts
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Engine } from 'dancing-squared-engine';

setParser(DOMParser);
const engine = new Engine(movesXml, formationsXml);
```

## Sequencer / FASR

`Sequencer` runs a board of identity-tracked dancers (4 couple-slots, boy/girl)
through calls from the taminations data, checking legality, advancing the board,
recognizing the resulting formation, and analyzing FASR.

```ts
import { setParser, Sequencer } from 'dancing-squared-engine';
setParser(DOMParser);

const seq = new Sequencer(movesXml, formationsXml, [
  { name: 'Allemande Left', xml: allemandeXml },
  { name: 'Swing Thru', xml: swingThruXml },
]);

seq.apply('Allemande Left');          // advances the board; result is legal/illegal
seq.fasr();                            // { formation, arrangement, sequence, relationship }
seq.legalNext();                       // calls legal from the current board
seq.recognize(seq.board);              // best matching standard formation
seq.isAt('Static Square');             // is the board a squared set?
seq.getout({ target: 'Static Square' }); // bounded search for a home-returning sequence
seq.fixIt();                           // legal next calls that keep a getout alive

// User-defined modules (fixes / getouts) behave like single calls.
seq.registerModule('Circle Getout', ['Circle Left']); // name + ordered calls
seq.apply('Circle Getout');             // replays its calls; legal only if all are legal
seq.listModules();                       // registered module names
```

A call is applied by matching the current board to one of its `<tam>` start
setups (tolerant, rotation/reflection-invariant) and transferring that setup's
relative movement onto the dancers. Recognition uses a curated list of standard
Mainstream formations. `matchFormations` is exported for reuse. The
`test/mainstream.mjs` registers the full ~62-call Mainstream subset and verifies
apply / legality / legalNext / getout / fixIt headlessly.


## Build & test

```bash
npm install          # dev deps: typescript + @xmldom/xmldom
npm run build        # tsc -> dist/ (ESM + types)
npm run verify       # build + run the Node smoke test (loads real taminations data)
```

## Public API

| Symbol | Kind | Purpose |
|--------|------|---------|
| `Engine` | class | `new Engine(movesXml, formationsXml)`; `loadCall`, `callMeta`, `poses`, `handholds` |
| `loadCallFromXml(callXml, movesXml, formationsXml, tamIndex?, mirror?)` | fn | one-shot load |
| `parseMoves` / `parseFormations` / `parseCallXml` / `buildCall` / `callMeta` | fn | lower-level converter pieces |
| `setParser` | fn | inject a DOMParser for Node |
| `poseFor(dancer, beat, headingMode?)` | fn | single-dancer pose |
| `allPoses(call, beat, headingMode?)` | fn | all-dancer poses |
| `sampleTrail(dancer, steps?)` | fn | path trail samples |
| `computeHandholds(poses, mode?)` | fn | hand holds (`'active'`/`'static'`) |
| `Sequencer` | class | board state + apply/legality/recognize/FASR/legalNext/getout/fixIt/isAt + modules (`registerModule`/`listModules`/`getModules`) |
| `matchFormations` | fn | tolerant formation matching (rotation/reflection-invariant) |
| Types | `type` | `CallBundle`, `DancerSpec`, `Pose`, `Seg`, `BezierData`, `Hands`, `HoldEdge`, `HoldMode`, `HeadingMode`, `Board`, `Fasr`, `SeqStep`, … |

All pose output is 2D `(x, y, heading)` in the dance grid; a renderer maps it to
its own world space (see `poc/src/scene.ts` for the Three.js 2D→3D mapping and
its chirality caveat).

## License

AGPL-3.0. The source taminations data is GPL/AGPL-licensed; preserve license
headers in any copied data.
