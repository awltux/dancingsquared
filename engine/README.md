# dancing-squared-engine

A **standalone, renderer-agnostic square-dance engine** — the pure core for the
Dancing Squared project. It parses taminations XML into a normalized call
bundle, evaluates dancer **poses** (position + facing + hands) and **hand
holds**, and runs a board of dancers through calls. No rendering, no framework, no I/O.

It is the extracted, packaged version of the engine proven in `poc/`.

## Start here: which entry do I want?

The package publishes **seven specifiers**. `dancing-squared-engine` is the whole
surface (380 exported names, 331 of them runtime values, over 59 modules); the six
**entries** are views of it, each named for the job. Import the tier you need — a
drawing tool should not evaluate the sequencer tower.

| Import | Job | Names | Modules loaded |
|---|---|---|---|
| `dancing-squared-engine/core` | the dance model: pose, hands, angles, matrices | 70 | **8 of 59** |
| `dancing-squared-engine/document` | taminations XML ⇄ model (parse, build, write) | 23 | 4 |
| `dancing-squared-engine/ids` | the identity schemes (`formationId`, `arrangementId`, `setupId`, `callVariantId`), the board, `UNKNOWN_COUPLE` | 47 | 18 |
| `dancing-squared-engine/authoring` | build a call, edit a call's instance, re-order a formation | 90 | 16 |
| `dancing-squared-engine/sequencer` | run a board: apply, legality, permissions, modules-as-calls, FASR, FSM, solve | 138 | 54 |
| `dancing-squared-engine/all8` | All8's published choreography notation, decoded and encoded | 23 | 2 |
| `dancing-squared-engine` | everything | 380 | 59 |

The numbers are measured and pinned by `engine/test/entry-tiers.mjs`, which also
fails if an entry adds a name the barrel withholds, drops a public name from the
modules it claims, or grows past its module closure.

## The two tiers of the API

**1. Document → poses.** `Engine` is the small facade: parse the two registry files
once, then load any call and read a pose.

```ts
import { Engine } from 'dancing-squared-engine/document';

const engine = new Engine(movesXml, formationsXml); // pass the two XML strings
const call = engine.loadCall(callXml, 0 /*tam index*/, true /*mirror*/);
const poses = engine.poses(call, 3.5);            // every dancer at beat 3.5
const holds = engine.handholds(poses, 'active');  // hand holds at that moment
```

**2. Board → session.** `Sequencer` runs identity-tracked dancers through calls:
legality, advancing the board, recognizing the result, FASR, and a bounded search
for home. It is the engine's composition root — it builds the library, matcher,
applicator, grouping, legality checker, analyzer, solver and FSM store and wires
the picker's permission rules into all of them — which is why its entry loads
**54 of 59** modules: asking for the sequencer IS asking for the engine.

## Node: the parser seam

Node has no `DOMParser`; provide one before use. This is the one ambient global
in an otherwise injected library:

```ts
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine/document';

setParser(DOMParser);
```

## The Sequencer

```ts
import { setParser, Sequencer } from 'dancing-squared-engine/sequencer';

setParser(DOMParser);
const seq = new Sequencer(movesXml, formationsXml);   // no calls yet
seq.registerByTitle('Allemande Left', allemandeXml);  // one title per call
seq.registerByTitle('Swing Thru', swingThruXml);

seq.setBoard(board);                   // the SESSION style: methods read this board
seq.apply('Allemande Left');           // advances it; the result is legal/illegal
seq.fasr();                            // { formation, arrangement, sequence, relationship }
seq.legalNext();                       // calls legal from the current board
seq.getout({ target: 'Static Square' }); // bounded search for a home-returning sequence
seq.fixIt();                           // legal next calls that keep a getout alive

// The STATELESS style: every call takes the board, so two appliers can interleave.
const r = seq.applyToBoard(board, 'Swing Thru');       // { board, legal, reason? }
seq.evaluateSequence(['Swing Thru'], 2, board);        // the board at beat 2
seq.legalCalls(board);                                 // the same question, explicitly
```

**Two registration modes, and the difference is measured.** `register(name, xml)`
registers *every* tam in the document under `name` — right when the document IS
the call (the POC's pooled per-title blocks). `registerByTitle(name, xml)` takes
only the tams whose `title` is `name` — right for a catalogue, where a document
is a FAMILY of calls. MEASURED: registering `circle.xml` under one name gave that
name **124 tams**, so `Boys Trade` matched `Partner Trade`'s authorings. When in
doubt, use `registerByTitle`.

**A module is ONE call.** `registerModule(name, steps, { start, end })` records a
named sequence; `seq.moduleCall(board, name)` composes it into a single whole-set
bundle, offered and applied like any call (`moduleStart`/`moduleEnd` report the
boards it dances between).

**A partner or corner call needs a board that carries couples.** The rule is
exported (`relationNamedBy`, `carriesCouples`, `relationRefusal`), so a census can
measure the refusal rather than restate it.

## Public API

The complete surface is the barrel's, and the entries above are its subsets — no
entry exists that is not in `"."`. The main shapes:

| Symbol | Kind | Where |
|--------|------|-------|
| `Engine` | class | `document` — `loadCall`, `loadCallVariants`, `callMeta`, `poses`, `handholds` |
| `setParser`, `parseMoves`, `parseFormations`, `parseCallXml`, `buildCall`, `callMeta`, `callToXml`, `formationToXml` | fn | `document` |
| `poseFor`, `allPoses`, `dancerBeats`, `sampleTrail`, `DEG`, `normAngle`, `bezierPoint` | fn/const | `core` |
| `computeHandholds` | fn | `core` |
| `formationId`, `arrangementId`, `setupId`, `callVariantId`, `boardSig`, `sameBoardById`, `UNKNOWN_COUPLE` | fn/const | `ids` |
| `Sequencer`, `parseStep`, `CALL_TITLE`, `evaluatePermissions`, `matchFormations`, `geometryKey`, `congruentWithin` | class/fn | `sequencer` |
| `composeModuleCall`, `relationNamedBy`, `alignmentOf`, `boardForFasrCode`, `decodeLine`, `parseAll8Figures` | fn | `sequencer` / `all8` |

All pose output is 2D `(x, y, heading)` in the dance grid; a renderer maps it to
its own world space (see `packages/stage/scene.ts` for the Three.js 2D→3D mapping and
its chirality caveat).

## Build & test

```bash
npm install          # dev deps: typescript + @xmldom/xmldom
npm run build        # tsc -> dist/ (ESM + types)
npm run verify:light # build + the fast harness tier (the full suite: npm run verify)
```

## License

AGPL-3.0. The source taminations data is GPL/AGPL-licensed; preserve license
headers in any copied data.
