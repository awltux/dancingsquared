# Taminations — reference notes

Durable notes on the upstream **Taminations** Flutter app (`taminations-flutter/`), kept because this
repo consults it constantly and re-deriving the same facts is expensive.

> **Reference only — never port code.** Upstream is GPL-3.0 / AGPL-3.0 (`LICENSE`; see §2). We read it
> to learn *intent and correct behaviour*, and we cite it when a decision needs an authority. We do
> not copy its code, and our engine is an independent implementation.
>
> House rule for everything below: **measured, not reasoned.** Every claim carries a `path:line`.
> Anything unverified is marked *unverified* rather than smoothed over.

---

## 1. What the repo and the app are

A **call animation browser and player**, not a caller-authoring tool. It shows square-dance calls by
program level, animates them from a start formation, plays a per-call pronunciation audio clip, and
renders the call definition from markdown.

Measured shape:

| | |
|---|---|
| Dart files in `lib/` | 910 |
| Lines in `lib/` | ~129,000 |
| `lib/calls/<level>/` | 65 ms, 50 plus, 39 a1, 26 a2, 90 c1, 74 c2, 84 c3a, 74 c3b |
| `lib/sequencer/calls/<level>/` | 51 ms, 29 plus, 23 a1, 20 a2, 71 c1, 46 c2, 32 c3a, 9 c3b, 64 common |

**The two call trees are not two implementations of the same thing** — see §4. `lib/calls/` is
generated animation data; `lib/sequencer/calls/` is hand-written sequencer logic.

The app's headline surprise: **there is no get-out search, no resolve solver, and no FASR anywhere in
it.** See §6.4. Everything this repo does around FASR, alignment and get-outs is *our* contribution,
not a port.

---

## 2. Licensing and provenance — read this before copying anything

| File | Licence header |
|---|---|
| `taminations-flutter/LICENSE` | **GNU GPL v3** |
| `taminations-flutter/lib/**.dart` | mostly GPL v3 ("Copyright (C) 2026 Brad Christie") |
| `taminations-flutter/util/xml_to_code.dart` | **AGPL-3.0** |
| `taminations-flutter/assets/src/calls.dtd` | **AGPL-3.0** ("Copyright 2023 Brad Christie") |
| `taminations-flutter/assets/src/calls.xml` | **AGPL-3.0** |

So the repo is **mixed GPL-3.0 / AGPL-3.0**: the bulk of `lib/` is GPL, while the generator and the
source data under `assets/src/` are AGPL. Measured: of 910 Dart files, 312 carry an AGPL header.

**This repo copies the animation XML verbatim.** `poc/src/assets/<level>/*.xml` is a byte-for-byte
copy for the eight shared levels — measured file counts match exactly (ms 66/66, plus 50/50, a1 36/36,
a2 26/26, c1 87/87, c2 79/79, c3a 84/84, c3b 66/66), and `moves.xml` is **byte-identical** to
`assets/src/moves.xml` (same MD5). The XML we ship therefore carries upstream's licence, which is a
**licensing consideration for this repo** — flagged here as a measured fact, not as legal advice.

Two deliberate divergences from upstream data:

- **`formations.xml` is MODIFIED.** 262 bytes differ from `assets/src/formations.xml`. Upstream's
  `Static Square` places dancers at `x="-3" y="1" angle="0"`; ours has `x="-1" y="-3" angle="90"` —
  a 90° rotation. Our own commit `d244996` ("Fix all Heads/Sides calls from Static Square/Squared
  Set") is what changed it. **Do not "restore" it from upstream** without re-running the gates.
- **We ADD levels upstream's `assets/` does not have**: `b1`, `b2`, `discovered`.

---

## 3. Asset inventory: what we copied, and what we left on the table

Measured across the whole tree:

| Extension | upstream `assets/` | our `poc/src/assets/` |
|---|---|---|
| `.png` | 1139 | 0 |
| `.md` | 777 | 0 |
| `.xml` | 498 | 557 |
| `.mp3` | 194 | 0 |
| `.dtd` | 2 | 0 |

Total: **13.7 MB upstream vs 5.0 MB here.** We took the XML and nothing else. What we are leaving
behind, per level (ms as the sample): 247 `.md`, 75 `.mp3`, 42 `.png`.

**Per-call documentation.** `assets/<level>/<call>.md` is a real call definition with a consistent
section structure — `# Pass Thru`, `### Starting formation`, `### Command examples`, `### Dance
action`, `### Ending formation` (`assets/ms/pass_thru.md`). Each call also has localised siblings
`<call>.lang-de.md`, `.lang-it.md`, `.lang-ja.md`, and a pronunciation `<call>.mp3`. **This is a
large, structured, already-written body of call definitions that our repo does not use at all** —
the obvious source for call help text, teaching notes, and per-call metadata.

**`assets/info/*.md` (25 files)** is the app's own manual, and several are directly useful to us:
`abbreviations.md`, `designators.md`, `special_calls.md`, `special_commands.md`, `entering_calls.md`,
`how_it_works.md`, `copy_and_paste.md`, `embed.md`, and `sequencer-<level>.md` for each level.

`assets/info/abbreviations.md` documents a feature worth noting: the app ships a built-in
abbreviation table that the **user can edit**, persists between sessions, and can copy/paste as
tab-separated text. Our All8 decoder table is a fixed table; upstream made theirs user-extensible.

---

## 4. The data pipeline — and the one place it does NOT hold

Read this before treating upstream Dart as a second implementation of anything.

**Calls ARE generated from XML.** `lib/calls/<level>/*.dart` is generated code, not hand-written.
Each file is a `final List<AnimatedCall>` literal:

```dart
// lib/calls/ms/circulate.dart:26+
final List<AnimatedCall> Circulate = [
  AnimatedCall('Box Circulate',
    formation:Formation('Box RH Compact'),
    from:'Right-Hand Box',fractions:'2',difficulty: 1,notForSequencer: true,
    paths:[ Forward_3.changeBeats(4), RunRight.changeBeats(4) ]),
```

The generator is `util/xml_to_code.dart` (16.6 KB, AGPL), with the reverse direction in
`util/code_to_xml.dart`, plus `util/list_animations.dart` and `util/markdown_to_html.dart`. Pipeline:
`assets/src/*.xml` (+ `<level>/*.xml`) → `xml_to_code.dart` → `lib/calls/<level>/*.dart` →
registered in `lib/call_index.dart` → indexed at runtime by `Words.init` (`sequencer/words.dart:54-64`).
**The sequencer never parses XML.**

**But MOVES are NOT generated — `lib/moves.dart` is a hand transcription.** It declares **109**
`final Path` constants (`lib/moves.dart:24-229`; array `AllMoves` at `:231`) plus two generators
`CounterRotateLeft(x,y)`/`CounterRotateRight(x,y)` (`:117-163`). Verified two ways: 109 constants
exist in the Dart, and a grep for `moves.xml|offsetX|scaleX` across `lib/` finds **no XML `<move>`
parsing at all** — the only `scaleX` hits are local variables inside two sequencer call files
(`sequencer/calls/ms/cross_run.dart:77`, `sequencer/calls/ms/trade.dart:77`).

`assets/src/moves.xml` has **156** `<path>` entries; `poc/src/assets/ms/moves.xml` has 140. Both are
legacy as far as the Flutter app is concerned. **So:**

- Our `convert.ts` is the **only** implementation of XML `<move>` semantics in either codebase.
  Flutter can never be used to validate it. The authority is `moves.xml`'s own header comment
  (`moves.xml:22-43`).
- The two can drift silently, because they are a hand transcription and a data file, not a generated
  pair. Where they disagree, **the XML wins for us**, but a disagreement is worth investigating
  rather than assuming we are right.
- 156 = the 109 Dart names **+ 47 `Counter Rotate {Left|Right} X Y` paths**, which are the only XML
  names with no Dart constant. Every Dart constant's name matches an XML name exactly.

**Consequence of the XML passing through a generator for calls:** a change we make to a call XML has
an upstream counterpart only as a regenerated Dart file, and `notForSequencer: true` in the generated
Dart is the flag our variant filtering wants (§5.2).

---

## 5. The XML schema

### 5.1 The call index — `assets/src/calls.dtd` + `calls.xml`

`calls.dtd` is short and complete. It describes the **call index**, not the animations:

```dtd
<!ELEMENT calls (call+)>
<!ELEMENT call EMPTY>
<!ATTLIST call text CDATA #IMPLIED
               norm CDATA #IMPLIED
               level CDATA #IMPLIED
               sublevel CDATA #IMPLIED
               link CDATA #IMPLIED
               title CDATA #IMPLIED
               languages CDATA #IMPLIED
               audio CDATA #IMPLIED
               anim CDATA #IMPLIED >
```

`assets/src/calls.xml` is 743 lines of `<call>` rows, sorted by title, and is the **master call
list**: `title` is the display name, `link` is `<level>/<file>` optionally with a `?animname=`
fragment selecting a specific `<tam>` inside that file:

```xml
<call link="c3a/1_4_wheel_the_ocean" title="1/4 Wheel the Ocean"/>
<call link="c3a/1_4_wheel_the_ocean?animname=14WheeltheSeafromLeftHandTwoFacedLine"
      title="1/4 Wheel the Sea"/>
```

**The `?animname=` fragment is how several call titles share one file** — "1/4 Wheel the Ocean" and
"1/4 Wheel the Sea" are two `<tam>`s in the same XML file, disambiguated by the animation's name.
This is worth knowing when a corpus call title seems to map to the wrong motion.

### 5.2 The animation files — `<tam>` / `<path>` / `<move>`

Attributes on `<tam>`, as consumed by `AnimatedCall` (`lib/animated_call.dart:141-176`, used at
`lib/sequencer/xml_call.dart:187-211`):

| attribute | values / meaning |
|---|---|
| `title` | animation name; the `?animname=` target |
| `from` | human-readable starting position ("Right-Hand Box") |
| `formation` | engine formation name (`Formation('Box RH Compact')`) |
| `group` | grouping in the variant list |
| `parts` | number of parts, for part-stepping |
| `fractions` | beat fraction hint |
| `difficulty` | 0 NONE, 1 COMMON, 2 HARDER, 3 EXPERT (`pages/anim_list_page.dart:34-39`) |
| `sequencer` | **`perimeter` \| `exact` \| `gender-specific` \| `no`** |
| `actives` | `Heads` \| `Sides` \| `Centers` \| `Ends` \| `All` |
| `asymmetric` | disables the formation-matching symmetry shortcut |

**Verified independently: the `sequencer` attribute takes exactly those four values**
(`grep sequencer="..." assets/*/*.xml` → `exact gender-specific no perimeter`). This confirms our
`convert.ts`'s reading of the attribute, and `no` is what our `sequencer="no"` filtering keys on.

`sequencer="no"` means *the animation is a demonstration, not something the sequencer can call* —
`Words.init` skips indexing it (`sequencer/words.dart:58`), and `xml_call.dart:57-59` guards it. Our
attempt to filter on it regressed the corpus (PLAN.md records the refutation); note that upstream does
not merely *prefer* eligible variants, it **excludes** `no` from the index entirely, so the flag is
stronger upstream than the filtering we tried.

### 5.3 `<move>` modifiers

`offsetX`, `offsetY`, `scaleX`, `scaleY`, `beats`, `hands`, `reflect` (`moves.xml:37-42`) are
**implemented only on our side** — Flutter never reads them (§4). They are therefore a place where
our XML reader is the sole authority and where a mistake has no upstream cross-check.

---

## 6. The sequencer core — `lib/sequencer/`

Eleven files. Almost all semantics live in one of them.

| File | What it is |
|---|---|
| `call_context.dart` (1764 lines) | **the whole engine**: dancers, actives, formation matching, call interpretation and dispatch, sub-contexts, relationship analysis |
| `sequencer_model.dart` | top-level sequence state: call list, interpretation per line, undo/reset, apply back to the animation |
| `normalize_call.dart` | `normalizeCall()` — the name canonicaliser |
| `words.dart` | builds `Words.normalizedCallIndex` and the set of legal call words |
| `call_error.dart` | `CallError` / `CallNotFoundError` / `FormationNotFoundError` |
| `sequence_frame.dart`, `sequencer_animation_frame.dart`, `sequencer_page.dart`, `sequencer_calls_page.dart` | UI |
| `abbreviations_model.dart`, `abbreviations_frame.dart` | user abbreviation table (SharedPreferences) + editor |

### 6.1 Dancer state

Per-dancer sequencer state is `DancerData`: `active, beau, belle, leader, trailer, center,
verycenter, end, partner` (`lib/dancer.dart:68-78`). `actives` = dancers with `data.active`
(`call_context.dart:232-246`).

### 6.2 Interpretation and dispatch

Text is interpreted by **greedily chopping suffixes** and, for each candidate, trying
XML snapshot match → coded-call regex match → fuzzy XML match (`call_context.dart:457-516`).
Dispatch order is **XML first, coded second** (`xml_call.dart:119-147`).

If XML is found but the formation does not match, `XMLCall.performCall` **silently falls back** to
`applyCodedCall`, and then to an implied `"Do Your Part <call>"` when only some dancers are active
(`xml_call.dart:129-147`). This is a deliberate answer to a problem we have: an authored variant that
does not quite fit is not a hard failure upstream, it degrades.

### 6.3 Formation matching

`matchFormations` is a DFS over dancer permutations with an efficiency hack: unless the call is
`asymmetric`, dancer `i+1` is forced to map to `mapping[i]^1` — the **diagonally opposite** dancer —
(`call_context.dart:663-707`). Relational tests use an angle bin, 0/2/4/6 for cardinal and 1/3/5/7
for quadrants (`call_context.dart:603-634, 741-799`).

### 6.4 What does NOT exist upstream

**No get-out search, no resolve solver, no "who can resolve", and no FASR.** Verified independently:
zero matches for `getout|get_out|whoCanResolve|resolveCall` across all 910 Dart files in `lib/`.

The only resolution notion is `checkResolution`, invoked for exactly three calls — `Allemande Left`,
`Dixie Grand`, `Right and Left Grand` — comparing `numberCouple` parity (`xml_call.dart:122-128`); it
sets a warning string and nothing else (`sequencer_model.dart:439-440`). `Promenade Home` refuses
when unresolved (`sequencer/calls/common/promenade_home.dart:89`).

**So our FASR / alignment / get-out workstream is not reimplementing Taminations.** Upstream solves a
different problem (animate a called sequence), and the corpus we test against is All8's, not
Taminations'.

### 6.5 Selectors and scoping — the closest analogue to our `selection.ts`

- `subContext(subset, block)` builds a `CallContext` from a subset, runs the block, then
  `appendToSource` merges the cloned paths back (`call_context.dart:271-339`). `activesContext` runs
  in place when everyone is active (`:325-330`); `selectContext` temporarily re-selects actives
  (`:333-339`). This is the same shape as our `CallStep.selection` / `applySelected`.
- Selectors derive from `FilterActives` and **only clear `active` on dancers who were already
  active**, with an implied-"While" fallback if the result would be empty
  (`sequencer/calls/common/fliter_actives.dart:38-58`).
- The full selector vocabulary is a regex map; `specifier` at `sequencer/calls/coded_call.dart:364-369`
  enumerates it. **Worth diffing against `selection.ts` + `grouping.ts` for aliases we lack.**
- `CodedCall.fromName` is an **ordered** regex map (`normCallMap`, then `normCallMap2`), first match
  wins, returning null for text containing `Individually`/`While` mid-call
  (`coded_call.dart:371-386, 788-817`).

### 6.6 Relationship analysis — `analyze()`

`analyze()` assigns beau/belle/partner, leader/trailer, center/end/verycenter from left/right/front/
back counts and radius ordering (`call_context.dart:1638-1762`). Two things to know:

- `groups` are **radius shells**, not semantic subsets (`:1711-1721`).
- It is a cheap, concrete rule set for deriving the relationships we derive in `fasr.ts`/`identity.ts`
  — useful as an **independent cross-check** of our own derivation.

### 6.7 Snapping — upstream fudges, deliberately

`matchStandardFormation` / `matchFormationList` snap the board to a standard formation so the *next*
call will work (`call_context.dart:904-963`); likewise `checkCenters` (`:843-899`) and
`repairFormation` (`:965-981`). The sequencer applies squared-set convention and formation snapping
by default unless the line is a single coded call or `DebugSwitch.nosnap` is set
(`sequencer_model.dart:418-430`).

**This is not physics and must not be mistaken for a matching contract.** Our engine matches strictly
and reports refusal; upstream snaps and continues. Both are defensible, but a "matching bug" here and
a "snapping decision" there are different things.

---

## 7. Move primitives and geometry

### 7.1 The two move universes

| | Flutter | this repo |
|---|---|---|
| Roster | `lib/moves.dart`, **109** `final Path` constants, hand-written | `poc/src/assets/moves.xml`, **156** `<path>` entries |
| XML read at runtime? | **No** (verified: no `<move>` parsing in `lib/`) | Yes, `convert.ts` → `parseMoves` |
| Modifiers (`scaleX`, `offsetX`, …) | **not implemented** | implemented |
| Authority | n/a | `moves.xml:22-43` (its own header comment) |

156 = 109 Dart names + 47 `Counter Rotate {Left|Right} X Y` generated paths. Every Dart constant name
matches an XML name exactly. `poc/src/assets/ms/moves.xml` (140 paths) carries one extra legacy move,
`H16th` (`ms/moves.xml:592`), equivalent to src's `Hinge Left 1/4` and referenced nowhere.

### 7.2 The coordinate frame — get this wrong and every path is mirrored

From `moves.xml:28-29` itself: *"The position is (0,0) and the dancer is looking in the positive X
direction. The positive Y direction is to the left."*

- The frame is **dancer-local**. **+y is the dancer's own left**, not stage left and not the
  viewer's left.
- Positive angle = **counter-clockwise = the dancer's left**: `Bezier.angle(t) = atan2(dy,dx)`
  (`math/bezier.dart:71-74`), `Matrix.getRotation(a) = [[cos,-sin],[sin,cos]]` (`math/matrix.dart:65-66`).
- Consequently every `X Right` move is literally `X Left.scale(1,-1)` (`lib/moves.dart:40,46,61`).
  Right is the exact mirror, not an independent definition.

### 7.3 How a movement is encoded

Each movement is **one or two cubic Béziers** plus beats and hands (`math/movement.dart:55-69`):

- translation: `(0,0), (cx1,cy1), (cx2,cy2), (x2,y2)`
- facing: `(0,0), (cx3,0), (cx4,cy4), (x4,y4)` — `cy3` is implicitly 0; if `cx3` is absent the facing
  follows the translation tangent.

The **end tangent `p2 − cp2` encodes the net turn**: `Lead Left` and `Quarter Left` both end at
`cp2=(1,0.45), p2=(1,1)` → +90° (`moves.dart:56-57,80-81`); `Sxtnth Left` → 22.48°.

Composition `+` concatenates movement lists (`math/path.dart:96-106`), and per movement the
accumulated transform is `tx = tx * translate * rotate` (`path.dart:63-70`) — **rotate about the
movement's start, then translate**. Our `engine/src/core.ts:105-107` matches this order, which is why
our posed output agrees with upstream.

### 7.4 The path algebra, and the two scaling traps

- **`changeBeats(n)`** multiplies every movement's beats by `n/beats` (`math/path.dart:133-136`) —
  it **retimes, shape unchanged**. It is *not* the same as scaling length. Compare
  `Forward.changeBeats(2)` ("Slow Forward", same distance) with
  `Forward_2 = Forward.changeBeats(2).scale(2,1)` (`moves.dart:196,202`).
- **`scale(x,y)`** scales all control points **and, when `y` is negative, swaps the hand bits L↔R**
  (`math/movement.dart:141-150`); `reflect()` is exactly `scale(1,-1)` (`:179`). **Mirroring is
  geometry and handedness in a single operation** — a pure geometric mirror is not available.
- Three different skews, which are easy to conflate: `skew(x,y)` shifts only the **last** movement's
  `cp2` and endpoint (`math/bezier.dart:100-105`); `skewFromEnd(x,y)` rotates the offset into that
  movement's **end** frame (`movement.dart:173-177`); `skewFirst(x,y,angle)` skews the first movement
  then twists its facing (`math/path.dart:196-205`). `twist(adif)` rewrites `cp2` from a recomputed
  angle (`movement.dart:159-171`).
- **Interpolation is linear in beats**, with no arc-length reparameterisation:
  `Path.animate(b)` applies completed movements' cached transforms then the in-progress movement with
  `t/beats` (`path.dart:212-232`, `movement.dart:118-129`). So **speed varies along the curve** — a
  dancer moving through a Bézier does not travel at constant speed in stage space.
- Path beats = Σ movement beats (`path.dart:131`). Lead-in and lead-out are hard-coded **2.0 / 2.0**
  (`dance_model.dart:424-425`); `_beats = max(d.beats + leadout)`, `totalBeats = leadin + _beats`.
  Our `convert.ts:343-344` matches that.

### 7.5 Hands is a bitmask, and we discarded it

`math/hands.dart:22-33`: `NONE 0`, `LEFT 1`, `RIGHT 2`, `BOTH 3`, `ANYGRIP 4`, `GRIPLEFT 5`,
`GRIPRIGHT 6`, `GRIPBOTH 7` — **grip is the value-4 bit**. Our `Hands` is a string union
(`convert.ts:46-63`, `types.ts`), so the bitmask is gone; anything that needs "is this a grip?" must
re-derive it. Also, `Hands.getHands` **silently returns 0** for an unknown string (`hands.dart:46`),
and `Movement.scale` swaps hands only for `LEFT/RIGHT/GRIPLEFT/GRIPRIGHT` — `BOTH` and `NONE` pass
through unchanged (`movement.dart:141-150`).

### 7.6 Roll is metadata, inferred from the geometry

`Rolling.{LEFT,RIGHT,NONE,ANY}` (`path.dart:29-34`), default `ANY`, resolved from the **rotate-Bézier
end tangent** of the last movement with a ±0.1 threshold and a 180° special case that reads the
halfway tangent (`call_context.dart:1527-1537`, `bezier.dart:79-88`). Only movements with `fromCall`
set are considered, which is how sequencer-generated motion is excluded (`call_context.dart:1529-1531`).

Relevant to us: our coded `Roll` is a geometry-derived call, and this is upstream's independent
statement of the same rule — the direction is *read off the turning motion*, not stored.

### 7.7 Two divergences worth knowing about

- **LATENT, in our reader.** `engine/src/convert.ts:206` applies `offsetX/offsetY` **inside the
  per-segment loop**, so a multi-movement `select` gets the offset applied to every segment; the
  reference's equivalent (`Path.skew`) touches only the **last** movement (`path.dart:171-181`).
  Measured: only three move definitions are multi-movement (`Pass Thru`, `Pull By`, `Cast Left`), and
  **no asset anywhere applies an offset to any of them** (250 offset sites, zero on those three). So
  it is latent, not a live bug — but it is the kind of thing that becomes a live bug the first time
  someone authors such a variant. Worth an assert or a comment rather than a silent assumption.
  (`scale`/`beats` applied to every segment is *correct* — the reference does that too.)
- **In the reference, not us.** `lib/geometry.dart`'s formation rotation factor is **not uniform**:
  `pi*rotnum` for Square (`geometry.dart:102-103`) versus `pi*rotnum/2` for Hashtag (`:149-150`), with
  custom remaps for Hexagon/Bigon (`:120-133`, `:76-86`). "Rotate the formation by `rotnum`" is not a
  single rule, so `geometry.dart` should not be used as a model for a uniform rotation API.

---

## 8. The application layer

### 8.1 Feature inventory (measured)

Level browsing; per-level call list with **substring search on title only**; per-call animation
variant list grouped by starting position with difficulty colouring; playback with play/pause,
±0.1-beat stepping, part stepping, scrub slider, tap-to-toggle per-dancer paths; per-call markdown
definitions with current-part highlighting; pronunciation audio; copy-canvas-to-clipboard; a
**Practice** mode (random call from a level, user drives one dancer, scored against the computed
path); a 4-lesson **Tutorial** on the same frame; the **Sequencer** (type call names line by line,
interpret/animate/chain, undo/reset, copy/paste, special commands, voice input `en_US`); and an
**Embed** mode for hosting an animation in a web page.

Absent: singing-call sectioning, a get-out library, and any visual choreography editor.

### 8.2 Levels

`LevelData(name, dir, selectorString)` (`pages/level_data.dart:31-42`):

| Name | dir | selector |
|---|---|---|
| Mainstream | `ms` | |
| Plus | `plus` | |
| Advanced | `adv` | `a` |
| A-1 / A-2 | `a1` / `a2` | |
| Challenge | `cha` | `c` |
| C-1 / C-2 / C-3A / C-3B | `c1` / `c2` / `c3a` / `c3b` | |
| Index of All Calls | `all` | `[^s]` |
| (none) | `x` | |

`selector(t)` is `t.startsWith(selector)` used as a regex (`level_data.dart:29`), so **Advanced
selects A-1 + A-2, and Challenge selects C-1 … C-3B** (`pages/calls_page.dart:102`). Total order is
the `_data` index order, with NONE first and INDEX last (`level_data.dart:44-57, 74-76`). Note there
are **no `adv`/`cha`/`all` call rows** — those levels exist only as selectors.

### 8.3 The call index

`callIndex` is a hand-written constant of **631 `CallEntry(title, level, link, calls, [audio])` rows**
(`lib/call_entry.dart:23-31`; `lib/call_index.dart:504-1175`). Independently counted: 631. Both
`level` and `link` are level-tagged (`'c3a'` / `'c3a/1_4_mix'`).

- **Aliases are duplicate rows** pointing at the same link/module — e.g. `Backtrack` → `ms/turn_back`
  (`call_index.dart:549`), `Delete` → `c1/replace` (`:655`), and `Recycle` present at ms, a2 and c1
  (`:892-894`). There is **no alias/fuzzy handling in search** (`calls_page.dart:104-106`); typo
  tolerance exists only in the sequencer's `normalizeCall`.
- **Display titles differ from index titles**: `titleIndex` maps `link` → canonical display name
  (`call_index.dart:1177-1678`), used by list pages, while `CallsPage` shows `CallEntry.title`.
- Placeholder titles are real, searchable rows: `<anything> Chain Thru`, `Take {n}`,
  `<any tagging call> Your Neighbor` (`call_index.dart:532-545, 1083`).
- **`firstWhere(link)` means duplicate links share one animation list.** `c1/recycle` has 6
  `CallEntry` rows, so `pages/animation_page.dart:49` and `pages/anim_list_page.dart:286` all resolve
  to the *first*, and "2/3 Recycle" opens the same list as the others.

### 8.4 Playback and drawing

- **Beat clock, wall-clock driven**: `_beat += elapsedMs / _speed` (`lib/beat_notifier.dart:47-57`).
  Speeds are **milliseconds per beat**: Slow 1500, Moderate 1000, Normal 500, Fast 200, Ludicrous 10
  (`lib/dance_model.dart:32-44`).
- **Hard-coded 2-beat lead-in and lead-out**; total = max dancer beats + leadout
  (`dance_model.dart:424-430`), assumed again by the tick painter (`pages/animation_page.dart:619-624`).
- **Strictly 2D**: Flutter `CustomPainter`, floor rect, `scale(min(w,h)/13)`, flip Y, `rotate(pi/2)`
  (`lib/dance_painter.dart:243-250`); boy = square, girl = circle, phantom = rounded square
  (`:33-36, 446-461`); paths sampled every **0.1 beat** (`:105-118`); handholds recomputed pairwise
  per frame with greedy best-score assignment (`:155-222`).

There is no 3D anywhere, so our Three.js POC is a genuine departure — but the **13-unit floor scale**
and **0.1-beat sampling** are the conventions worth keeping engine-side, independent of projection.

### 8.5 Settings (the shape of a teaching app's config)

`Settings` keys and defaults (`lib/settings.dart:100-275`) include `Dancer Speed`, `Loop`, `Grid`,
`Axes`, `Paths`, `Numbers`, six couple colours, `Phantoms`, `Special Geometry`, `Language for
Definitions`, `PracticeGender`, `PracticeSpeed`, `PrimaryControl`, `Practice Specific`,
`Starting Formation`, `Dancer Shapes`, `Dancer Identification`, `Dancer Colors`, `Join Calls With`.
Notable option sets: geometry `None|Hexagon|Bi-Gon|Hashtag`; languages `System|English|German|Italian|
Japanese`; starting formations `Facing Couples, Squared Set, Normal Lines, Zero Box, Double Pass Thru,
Ocean Waves, Two-Faced Lines, Diamonds, Quarter Tag, Columns, Tidal Wave, Blocks, Random Lines`
(`pages/settings_page.dart:493-507`). The "starting formation" list is a ready-made vocabulary for a
teacher-facing formation picker.

### 8.6 Oddities worth knowing before reading the UI code

- **Dead "new calls" toggle**: `newCalls` is hard-coded (`pages/calls_page.dart:49-66`) and permanently
  repaints those rows, but its toggle UI is commented out (`:131-152`).
- **`isSmallDevice` is cached process-wide** from the first call (`lib/pages/page.dart:73-82`), and
  web is always treated as non-small.
- **Layout is orientation-switched** (`lib/main.dart:205-293`); Practice and Sequencer force landscape
  on phones (`:191-203`).
- **`TamUtils.linkSSD` remaps `(ssd|m26|p26)` paths to `b1`/`b2` directories that are not declared in
  `pubspec.yaml`** (`lib/tam_utils.dart:225-233`) — legacy and evidently dead.
- **Voice input is hard-coded `en_US`** and validates words against a static `Words.words` list
  (`sequencer/sequence_frame.dart:200-234`).
- Notable packages (`pubspec.yaml:13-34`): `provider`, `shared_preferences`, `just_audio`,
  `speech_to_text`, `flutter_markdown_plus`, `markdown`, `xml`, `super_clipboard`, `window_manager`,
  `vector_math`, `scidart`, `bezier`, `tuple`, `google_fonts`.

---

## 9. Things that would be wrong to assume

1. **That the sequencer parses XML at runtime.** It does not for calls (generated) *or* moves
   (hand-transcribed) — §4.
2. **That upstream Dart can validate our XML semantics.** It implements a *different* representation;
   `convert.ts` is the only reader of the XML `<move>` modifiers in either codebase (§4, §7.1).
3. **That Taminations has FASR, get-outs or a resolve solver.** It has none (§6.4). Our FASR work is
   original, and its authority is Callerlab/All8, not this app.
4. **That `isLines()` / `isWaves()` / `isThar()` are reliable formation detectors.** They are
   tolerance-based whole-context heuristics: `isLines()` is also true for a *single* line of 4
   (`call_context.dart:1404-1408`), and `isThar()` just means any 2×4 with four dancers per axis
   (`:1460-1462`). Our `match.ts` is a different, stricter mechanism.
5. **That "Advanced" and "Challenge" are single level codes.** They are selectors that include their
   sub-levels (§8.2).
6. **That search supports aliases or typos.** It is a lowercase substring test on the title.
7. **That a formation mismatch means the call fails.** Upstream falls back to a coded call and then to
   an implied "Do Your Part" (`xml_call.dart:129-147`), and snaps formations to keep going.
8. **That `resolutionError` is FASR sequence parity.** It is a three-call couple-order check on the
   round-of-grand calls only.
9. **That "Left"/"Right" in move names mean stage or viewer left.** They are the **dancer's own**
   left/right (§7.2).
10. **That `changeBeats` and `scale` are interchangeable.** One retimes, the other changes length
    (§7.4).
11. **That `scale(1,-1)` is a pure geometric mirror.** It also swaps hand bits (§7.4).
12. **That call audio is speech synthesis.** It is 194 pre-recorded per-call `.mp3` assets.
13. **That the localised definitions are generated.** They are hand-written files selected by filename
    suffix (`.lang-de`, `.lang-it`, `.lang-ja`) with a base fallback, and they are **bundled assets,
    not network fetches** (`lib/tam_utils.dart:236-238`).
14. **That our `formations.xml` is upstream's.** It is not — we changed Static Square's orientation
    (§2).

---

## 10. Transferable artifacts — the highest-value things to mine

Ranked by how directly they help this repo:

1. **`sequencer/normalize_call.dart:28-146` — the alias and typo pipeline.** A battle-tested list of
   accepted variants (`allamande?`→Allemande, `centres?`→Center, `forth`→fourth, `throu?g?h?`→Thru,
   fractions→`12/34/14/23`, the 6-2 Acey Deucey forms, "lead couples"→"leads"). **Diff it against our
   `CALL_SYNONYMS` and the All8 table** — it is the cheapest source of names we are missing.
2. **`coded_call.dart:364-369` — the full selector vocabulary.** Diff against `selection.ts` /
   `grouping.ts`.
3. **`call_context.dart:1638-1762` (`analyze()`) — relationship derivation rules.** An independent
   cross-check for `fasr.ts` / `identity.ts`.
4. **`assets/<level>/<call>.md` — 777 written call definitions** with a consistent
   Starting formation / Dance action / Ending formation structure, plus `<call>.mp3`. Unused here;
   directly usable as call help and teaching notes (mind the licence, §2).
5. **`assets/src/calls.xml` (743 lines) + `calls.dtd` — a master call list** with titles, levels and
   `?animname=` variant links. A ready-made cross-check for our call-title vocabulary and level
   tagging.
6. **`assets/info/special_commands.md`** — the sequencer's command syntax (`color`, `id`, `speed`,
   `axes`, `grid`, `path`, `help`, `random`), a good model if we add a text command surface.
7. **`pages/level_data.dart` + `call_entry.dart` — the level/index schema** (§8.2–8.3), including the
   hierarchical selector semantics, a good model for a teacher-app call picker.
8. **`math/hands.dart` bitmask + `handhold.dart` scoring** (`handhold.dart:48-55`) — if we ever want
   grip-aware handhold rendering, the value-4 grip bit is the piece our string union dropped (§7.5).

---

## 11. Traps already encountered here

- **`assets/src/formations.xml` and `poc/src/assets/formations.xml` are the same byte length and show
  no differing *lines* under a naive line-diff, yet they are not identical.** A check that only
  compares hashes, or only compares lines, gives a misleading answer in one direction each. Byte-compare
  when it matters: this was found by exactly that contradiction — `Compare-Object` reported 0 differing
  lines while the MD5s differed, and a byte scan then found 262 differing bytes.
- **`Select-String -Recurse` is not a valid parameter**, so that command fails rather than searches —
  and a failed search prints nothing, which is indistinguishable from "no matches". Pipe
  `Get-ChildItem -Recurse` into `Select-String` instead.
- **Negatives are what a broken command fakes most convincingly.** The "upstream has no get-out code"
  result (§6.4) is a *negative*, so it was checked twice by two different methods before being written
  down — and the first attempt at it failed silently for the reason above.
- **`lib/` has no `lib/calls/` counterpart for moves.** Anyone looking for "the Dart equivalent of
  `moves.xml`" will find `lib/moves.dart` and reasonably assume it is generated from the XML. It is
  not (§4), and the two rosters (109 vs 156) differ.
