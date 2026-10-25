# SequenceSyntax — a sequence document

A **sequence document** is one JSON file that says where a set of eight dancers starts, which calls they dance in order,
and where they finish. It is the app's native way to move a sequence in or out: the sequencer's Library drawer exports
the sequence on the board as one of these and imports one back.

It is also written to be **read by a model**: hand this page to one, with a caller's list of calls, and it can produce a
document the app loads. Everything a document may contain is below, and every example marked `sequence` is executed by
`poc/tools/sequence-json-probe.mjs` against the real corpus — the measured outcome printed under each one is asserted, so
this page cannot drift from the code that reads it.

- The rule that decides what a document *means*: `poc/src/sequence-json.ts`.
- The code that applies one: `poc/src/sequencer-ui.ts` (`importSequence`, `loadSteps`).
- The corpus it draws its calls and formations from: `assets/`.

---

## 1. What the app does with a document

On **Import** the app:

1. parses and validates the document (§3–§6) — a malformed document is refused whole, and nothing on screen changes;
2. stands the **start board** up, by the same calls the Board drawer's Setup picker uses;
3. loads the **steps** in order and applies each call to the running board;
4. reports what happened — how many calls applied, which were refused, where the walk stops, and whether the declared
   **end** matches the board the sequence actually reaches (§7).

On **Export** it writes the sequence on the board back out in this format: the start board with its ids, every step with
the call-variant id the walk matched, and the end board. That is the form to keep, diff and re-import.

A sequence is always **eight dancers**. The sequencer's board is a whole set, and a document with any other number is
refused.

---

## 2. The four ids, and why a document has both ids and names

The tree identifies a formation by a chain of **stored tags**, written on the corpus's own definitions
(`assets/formations.xml`, each `<tam>`'s inline `<formation>`). They are not content addresses: correcting a shape's
geometry does not move them, so a reference to one stays true.

| id | what it names | shape | example |
|---|---|---|---|
| **FID** | the formation **definition** — the shape | `F3-…` | `F3-p3qjle85` |
| **AID** | that shape **plus the gender placement** — the arrangement | `A1-…` | `A1-m5hwmyc7` |
| **SID** | the arrangement **plus the order the dancers are listed in** — the setup | `S1-…` | `S1-aeklu2ag` |
| **VID** | a **call variant**: the level, the call title, and the `FID` of the definition it starts from | `V1-…` | `V1-t8xpq6sw` |

`SID` implies `AID` implies `FID`: one shape has several arrangements, and one arrangement has several orders. The order
matters because it is what says which two dancers are couple 1 — so a setup is the board, not just its picture.

**Write names; let the app write ids.** A person or a model writing a document needs no ids: `"formation": "Zero Box"`
and a call's title are enough. The exporter fills every id in, and an imported document that carries them is resolved by
id first — so a re-import does not depend on anyone's spelling, and a later retitle shows up as a reported disagreement
rather than as a silent substitution. A name beside an id is a **label**: if it disagrees with the id, the app says so
and follows the id.

---

## 3. The document

```json
{
  "format": "dancing-squared/sequence",
  "version": 1,
  "name": "zero box, three calls",
  "level": "Mainstream",
  "start": { "formation": "Zero Box" },
  "steps": [ "Right and Left Thru", "Veer Left", "Couples Hinge" ],
  "end": { "name": "Two-Faced Tidal Line RH" }
}
```

| field | required | meaning |
|---|---|---|
| `format` | yes | exactly `"dancing-squared/sequence"`. Anything else is refused. |
| `version` | yes | exactly `1`. A document from a newer app is refused, not guessed at. |
| `name` | no | a caption. Free text; the app shows it and never resolves it. |
| `level` | no | the programme the sequence was written for (`"Mainstream"`, `"Plus"`, …). **Informational**: the panel's own level decides which calls are registered. |
| `start` | yes | the start board — §4. |
| `steps` | yes | one or more steps, in order — §5. A non-empty array. |
| `end` | no | the end board, as a **check** — §6. |

---

## 4. `start` — the board the dancers stand on

One of four forms, all fields optional, at least one required:

```json
{ "sid": "S1-aeklu2ag", "aid": "A1-m5hwmyc7", "fid": "F3-p3qjle85", "name": "Zero Box" }
{ "formation": "Zero Box" }
{ "formation": "Normal Lines", "name": "the caller's opening line" }
{ "dancers": [ { "gender": "boy", "x": 3, "y": -1, "heading": 3.141592653589793 }, … eight poses … ] }
```

Resolution order — the first form present wins:

1. **`dancers`** — the exact board: eight `{ "gender", "x", "y", "heading" }` poses, in the order the couples are
   numbered, `heading` in **radians** (0 = +X, counter-clockwise). This is what the exporter writes for a board no
   catalogue row holds, and it is the only form that cannot be reinterpreted later. The app recomputes the board's
   identity from the poses itself.
2. **`sid`** — a setup id, looked up in the app's setup catalogue (the Board drawer's Setup list, 484 setups). The ids
   `aid` and `fid` beside it are checked against the catalogue row and reported when they disagree. A `sid` the
   catalogue does not hold is **refused**: an id is a digest and cannot be inverted, and dancing from a guessed board is
   worse than not loading.
3. **`formation`** — a name, resolved by the app's start-label bridge first (`"Static Square"`, `"Squared Set"`,
   `"Zero Line"`, `"Zero Box"`) and then by the engine's formation library (`"Normal Lines"`, `"Ocean Waves"`, …). These
   four labels carry an ARRANGEMENT as well as a shape — `"Zero Box"` is All8's `[B1c]` board, `"Zero Line"` its
   `[L1o]` — which is why they are preferred to a bare formation name for those documented setups.
4. **`name`** is only ever a caption. It never resolves anything.

Every one of these refusals is named, with the field, in the status line.

---

## 5. `steps` — the calls, in order

Three forms, all in one list:

```json
"Pass Thru"
{ "call": "Swing Thru", "selection": "Centers" }
{ "groups": [ { "selection": "Heads", "calls": [ "Pass Thru" ] },
              { "selection": "Sides", "calls": [ "Forward and Back" ] } ] }
```

- **A string** is one call, danced by the whole set (§5.1 rules the name).
- **`{ call, selection }`** is that call danced by a group. `selection` is the engine's own group name — `Heads`,
  `Sides`, `Centers`, `Outsides`, `Boys`, `Girls`, `Couple #2`, `All Except Girls`, … and a name the engine cannot
  resolve makes the step refuse, out loud.
- **`{ groups: [...] }`** is a **"while"**: each lane names a group and the calls that group dances, all at the same
  time. A lane's calls are sequential (lane 1's first call, then its second), and the lanes must be **disjoint** — a
  dancer in two lanes is refused.
- Any step may also carry **`"vid"`** (§2). When it is present it is authoritative: the step resolves to that variant's
  call, the `call` name beside it is checked, and a `vid` the app does not hold is reported (the name is then used, or
  the step refused if there is no name).
- A step's `vid` inside a lane is allowed and resolves to that call's title, but a lane call may **not** carry its own
  `selection`: the lane already names the group, so a second one would be a group within a group the engine has no
  meaning for. A lane's calls are sequential; the lanes themselves happen at the same time.

### 5.1 How a call's name is read

The name must be the **corpus's own title**, or a spelling the engine's synonym table bridges. Read exactly: case and
runs of spaces are folded, so `right and left thru` is `Right and Left Thru`; and these are the bridged spellings

| written as | the corpus's title |
|---|---|
| `Do Sa Do` | `Dosado` |
| `Touch 1/4` | `Touch a Quarter` |
| `Cast Off 3/4` | `Cast Off Three Quarters` |
| `1/2 Tag` | `Half Tag` |
| `Single Hinge` | `Hinge` |
| `Left Hand Hinge` | `Hinge` |

**Not bridged:** `Left Allemande` is not a title — write `Allemande Left`. A name the library does not hold refuses the
step, with the engine's own suggestions for what was meant.

**Direction-ambiguous names must be chosen, not guessed.** `Sweep a Quarter` is not a call in the corpus; it exists as
`Sweep a Quarter Left` and `Sweep a Quarter Right`. Some calls also carry the direction in the title
(`Veer Left`/`Veer Right`, `Circle Left`/`Circle Right`). A caller's "sweep a quarter" needs the direction from the
caller, or the figure will not resolve.

---

## 6. `end` — a check, not an instruction

`end` takes the same four forms as `start`. The app replays the sequence, computes the board it actually finishes on, and
compares:

- a declared `sid` that matches → `end check: ends on S1-…, as the document says`;
- a declared `sid` that does not → `end check: the document says S1-…, the sequence ends on S1-…`.

**A disagreement is reported, never obeyed.** The replay is the board; the declaration is a claim about it.

**A shorter `end` with only a `name` is a caption, not a check** — use `sid` to check.

---

## 7. What the app reports

The status line under the buttons, in the same words the examples below quote:

```
loaded 3 call(s), from Zero Box
loaded 8 call(s), from Zero Box, 3 refused, stops at "Diamond Circulate" - No setup in this call matches the current formation.
```

- `loaded N call(s)` — the steps after module expansion.
- `from X` — the start board's label.
- `N refused` — steps the engine would not apply. **They stay in the list**: a refused call is the caller's evidence, and
  dropping it would silently dance a different sequence.
- `stops at "…" - …` — the walk's own verdict: the first step the animation cannot walk past.
- `end check: …` — §6.

A refusal is not a bug in the document. It means the corpus's authored variants do not cover that call from that board —
the `Diamond Circulate` example in §9 is exactly that: the call exists, and it is not authored from a two-faced tidal
line.

---

## 8. Writing one from a caller's text (for a model)

Given text like

> Zero box: right and left thru, veer left, couples hinge, diamond circulate, flip the diamond, recycle and sweep a
> quarter, left allemande (zero box)

do this:

1. **Take the caller's start as `start.formation`.** "Zero box" → `"Zero Box"`; "from a static square"/"from home" →
   `"Static Square"`; "zero line" → `"Zero Line"`. Anything else: use the name the caller used, and expect a refusal if
   the app cannot stand it up; where a caller names a setup the app's Setup list holds, its `sid` is exact.
2. **One call per clause, in the caller's order.** Drop prose and parenthetical asides (`(zero box)`), keep every call.
   A clause joining two calls with "while"/"as" is a `groups` step; "and then"/"then"/commas are sequential steps.
3. **Use the corpus's titles** (§5.1). Prefer the simplest title the corpus carries; do not invent a call, and do not
   translate a direction the caller did not give — see `Sweep a Quarter`.
4. **Scope with `selection`** when the caller names who dances: "centers swing thru" → `{ "call": "Swing Thru",
   "selection": "Centers" }`. Keep the caller's words for the group; the engine resolves them.
5. **Write no ids.** They are the app's to stamp. If you have an exported document to copy them from, copying is fine;
   writing a plausible-looking one is not — an invented id is refused or reported.
6. **Report what you could not resolve** in your reply rather than inventing a call: a document that refuses one step is
   more useful than one that dances something else.

Two more rules that keep a document honest:

- A "while" needs **disjoint** groups and, in each lane, calls that are legal from the board the lane starts on.
- A sequence that stops partway is a real answer. Do not drop the calls after the stop to make the end look clean; the
  report says where it stopped, and the caller can see the board.

---

## 9. Examples, and what the app measured for each

### 9.1 A start label and plain calls — everything applies

```sequence
{
  "format": "dancing-squared/sequence",
  "version": 1,
  "name": "zero box, three calls",
  "start": { "formation": "Zero Box" },
  "steps": [ "Right and Left Thru", "Veer Left", "Couples Hinge" ]
}
```

> Measured: `loaded 3 call(s), from Zero Box`

It ends on the corpus's `Two-Faced Tidal Line RH` — which is what a real caller's "point to point diamonds" note is
describing, in this corpus's vocabulary.

### 9.2 A start label, and a sequence the engine cannot finish

The figure from the report, with the direction the caller left out made explicit (`Sweep a Quarter Left`):

```sequence
{
  "format": "dancing-squared/sequence",
  "version": 1,
  "name": "zero box, the reported figure",
  "start": { "formation": "Zero Box" },
  "steps": [
    "Right and Left Thru",
    "Veer Left",
    "Couples Hinge",
    "Diamond Circulate",
    "Flip the Diamond",
    "Recycle",
    "Sweep a Quarter Left",
    "Allemande Left"
  ]
}
```

> Measured: `loaded 8 call(s), from Zero Box, 3 refused, stops at "Diamond Circulate" - No setup in this call matches the current formation.`

Three calls are refused: `Diamond Circulate`, `Flip the Diamond` and `Allemande Left` — the engine's `Couples Hinge` ends
on a two-faced **tidal line**, and `Diamond Circulate` is not authored from one. The document is still the right
document: it says what the caller called, and the report says where this corpus stops.

### 9.3 A "while" — two groups, one step

```sequence
{
  "format": "dancing-squared/sequence",
  "version": 1,
  "name": "half the set passes thru while the other half steps back",
  "start": { "formation": "Static Square" },
  "steps": [
    {
      "groups": [
        { "selection": "Heads", "calls": [ "Pass Thru" ] },
        { "selection": "Sides", "calls": [ "Forward and Back" ] }
      ]
    }
  ]
}
```

> Measured: `loaded 1 call(s), from Static Square`

### 9.4 What an export looks like

The document the app writes for §9.1 once it has been loaded — ids on the start, each step, and the end. Its start is the
All8 `[B1c]` board, which no catalogue row holds, so the exporter writes the exact poses as well (that is the `dancers`
form of §4, and it wins on re-import):

```sequence
{
  "format": "dancing-squared/sequence",
  "version": 1,
  "name": "zero box three",
  "start": {
    "sid": "S1-aeklu2ag",
    "aid": "A1-m5hwmyc7",
    "fid": "F3-p3qjle85",
    "name": "Eight Chain Thru",
    "dancers": [
      { "gender": "boy", "x": 3, "y": -1, "heading": 3.141592653589793 },
      { "gender": "boy", "x": 1, "y": 1, "heading": 0 },
      { "gender": "boy", "x": -1, "y": -1, "heading": 3.141592653589793 },
      { "gender": "boy", "x": -3, "y": 1, "heading": 0 },
      { "gender": "girl", "x": 3, "y": 1, "heading": 3.141592653589793 },
      { "gender": "girl", "x": 1, "y": -1, "heading": 0 },
      { "gender": "girl", "x": -1, "y": 1, "heading": 3.141592653589793 },
      { "gender": "girl", "x": -3, "y": -1, "heading": 0 }
    ]
  },
  "steps": [
    { "call": "Right and Left Thru", "vid": "V1-t8xpq6sw" },
    { "call": "Veer Left", "vid": "V1-00a2hp92" },
    { "call": "Couples Hinge", "vid": "V1-3fnrrphn" }
  ],
  "end": {
    "sid": "S1-tfjmpawm",
    "aid": "A1-gdpspdjv",
    "fid": "F3-2mt6c2zt",
    "name": "Two-Faced Tidal Line RH"
  }
}
```

> Measured: `loaded 3 call(s), from Eight Chain Thru`

The `end` here is a caption plus its ids — a check, per §6: re-importing it reports whether the sequence really finishes
there.

---

## 10. Versioning and files

- `version` is the contract. This page documents `1`; a document from a future version is refused by the parser rather
  than half-understood.
- The document is file-ready: a `.json` file whose text is this object. The app's Import box takes the same text, so
  copy/paste and files are the same format.
- The exporter writes one fixed shape — key order, indentation, one step per line — so two exports of the same sequence
  diff cleanly, and `poc/tools/sequence-json-probe.mjs` round-trips every field through it.
