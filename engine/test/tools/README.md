# `engine/test/tools/` — the instruments, not a tier

This directory is the **measurement archive**: the probes and audits that produced the numbers PLAN.md,
TODO.md and the harness headers cite. Most of them answered a question once; that is why they are here and not
in a tier.

Nothing here is run by `engine/test/verify-suite.mjs` unless it is in the registry (see below). `engine/test/tools/`
is **flat** (a subdirectory would be a layout change the gate reports) and every file is CRLF.

## THE RULE — a file here is one of exactly two things

1. **A gate.** It is registered in `engine/test/suite.mjs` (`{ h: '<name>', sub: 'tools', … }`) and carries **no
   stamp**. `engine/test/verify-suite.mjs` runs it; a non-`light` entry must carry a `why` saying what it costs.
2. **A one-shot diagnostic.** Line 1 says so, and says where its answer is recorded:

   ```
   // TIER: none — one-shot diagnostic; nothing runs it. Recorded: <path>.
   ```

   `<path>` is a tracked file that **names this probe** — a document that records the answer, or this README's
   table below when no document does.

`engine/test/harness-registry.mjs` (light tier, `engine/test/suite.mjs`) enforces the rule: every harness under
`engine/test/` is registered XOR stamped; the registry and the filesystem agree in **both** directions (no
dangling entry, no duplicate); every non-light entry has a `why`; every stamp's `Recorded:` path exists and
mentions the probe. A new file that is neither registered nor stamped turns that gate red, which is the point:
§5 of AGENTS.md — "a probe nobody runs is already stale".

**What the gate cannot check**, and says so in its header: that the `Recorded:` path really answers the probe's
question. That is a review matter, like the `why` on a non-light entry.

## HOW TO RUN ONE

```bash
node engine/test/tools/<name>.mjs      # from the repo root; the engine must be built (`npm run build --prefix engine`)
```

A tool that prints `ok`/`FAIL` lines and exits non-zero is a candidate to be **registered**; one that prints a
report and exits 0 is a diagnostic and stays one.

## THE UNRECORDED SET — 23 instruments with no recorded answer

These probes are named by no document: the question each asks is real, and the probe is the only instrument that
asked it. They are kept (deleting the instrument of an unrecorded answer loses the measurement), stamped with
`Recorded: engine/test/tools/README.md`, and **counted** — `engine/test/harness-registry.mjs` pins the set at 23,
so a new one is a decision and a removal updates the pin in the same commit.

| probe | the question it answers |
|---|---|
| `7046-start-probe` | is ceder-7046 valid from its own start formation, and only broken from home? |
| `ceder-7046-probe` | two reported ceder-7046 defects, reproduced headlessly |
| `handoff-2dancer` | how a 2-dancer call is mapped onto eight dancers (`Single Circle Right Full`) |
| `handoff-facing-pairs` | the facing-pair half of the same handoff measurement |
| `last-frame-branch-probe` | which branch each side took, where the animator and the applicator disagree on the last-frame jump |
| `parallel-probe` | why the parallel path sends two groups through the same point |
| `rlt-context-probe` | is `Right and Left Thru` from `3 and 1 lines #1` a real combination? |
| `rlt-probe` | diagnose `Right and Left Thru` from a Static Square |
| `scircle-paths` | the two authored paths of `Single Circle Left Full`, as data |
| `scircle-shift-probe` | did the pre-`afaae4a` index shift cause the reported wrong instance? |
| `seek-beats-probe` | the sequencer list's SEEK arithmetic |
| `sequence-dancer-order-probe` | does the last frame's board have a different `dancers` array order? |
| `sequence-frame-jump-probe` | ceder-7046 frame by frame: where a dancer moves further in one frame than the frame's own motion |
| `sequence-live-vs-walk-probe` | the last frame is drawn twice, from two different boards |
| `sequence-promenade-flip-probe` | the last frame flips the dancers when a promenade is applied to the end of a module |
| `sixteen-states-raw-probe` | do All8's 16-state pages carry a couple-numbered grid, or only labels? |
| `squared-set-construction-probe` | does [S] work through `boardsForAlignment` / `boardForAlignment`? |
| `squared-set-pattern-order-probe` | the engine's arrangement patterns for a squared set, and their order |
| `squared-set-sequence-probe` | why the (arrangement, sequence, relationship) filter returns nothing for [S] |
| `squared-set-source-probe` | what All8's [S] arrangement table says, column by column |
| `squared-set-table-probe` | the [S] table in the module, cell for cell against the home square and the source columns |
| `start-formation-resolve-probe` | does the app's label → board path resolve every start formation it claims? |
| `zero-line-boards-probe` | what does `L1o` actually stand up? (ceder-7046's start) |

## WHAT THE R2 TRIAGE CHANGED HERE

- **Registered** (`engine/test/suite.mjs`, `sub: 'tools'`, non-light): `setup-registry-probe` — the one
  unregistered gate that both passes and is not covered by a registered harness (the setup registry checked
  against All8's own diagrams, the zero-line property and an identity round-trip; ~32 s).
- **Moved** to `poc/tools/modules-using-probe.mjs`: its subject is the browse view, and the POC's registry is its
  directory (`poc/tools/verify-probes.mjs` runs every `*-probe.mjs`).
- **Deleted**, their answer already recorded: `fasr-code-canonical-probe` (superseded by the registered
  `all8-format.mjs`, which pins the same board AND the couple assignment), `promenade-direction-probe` (no
  header; the general measurement is `promenade-rotation-probe` / `promenade-pair-probe`), `zero-line-raw-probe`
  (no header; `zero-line-probe` answers it).
- **Stamped**: the remaining 99 files here plus `engine/test/map-tips.mjs`, the generator PLAN.md describes.
- **Two rotted instruments were found here and are now GATES** (TODO item 41's decision, made in favour of `fix`):
  `setup-path-probe` (30 s) and `swing-thru-rule` (4 s) are registered non-light, with a pin that holds today:
  `setup-path-probe` pins the FIVE formations the anonymous setup path can identify — a property of geometry —
  instead of the raw anonymous count (129), which went red when the library grew four formations rather than when
  the rule changed, and `swing-thru-rule` pins the eight distinct spots today's engine produces where it used to
  pin the opposite (two dancers stacked, which is what refuted that Facing-Couples candidate; the header says what
  that removal leaves open).
