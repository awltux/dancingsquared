// Decoding All8's abbreviated get-out lines into call names.
//
// Shared by getout-conformance.mjs (which measures vocabulary against the engine
// catalogue) and getout-behaviour.mjs (which actually runs the get-outs), so both
// use ONE abbreviation table and cannot drift apart.
//
// The table is OURS, not All8's: All8's own notation reference (help.cgi) returns
// HTTP 500, so it is built from the published lines themselves. It is deliberately
// conservative - a token is decoded only when its expansion is unambiguous to us,
// and anything else is reported as UNDECODED rather than guessed, because a wrong
// expansion would silently turn a real engine gap into a phantom call name.
//
// PHASE 2 turned "conservative" from a stated intention into a PROCEDURE, because the risk it
// guards against was not actually being caught by anything:
//
//   1. A candidate expansion is admissible only when it is an exact member of
//      `implementedTitles(assets)` - the set of calls the engine can really perform. Two traps
//      that rule catches and intuition did not: `Sweep a Quarter` is in the engine's call INDEX
//      with no <tam> anywhere, so it is not a call; and `Single Hinge`, `1/2 Tag`, `Roll` and
//      `Right Star` are absent under every spelling attempted.
//   2. Where the catalogue admits MORE THAN ONE reading, the token is left undecoded. `LA` is
//      the case in point: `Ladies Chain` is implemented and `Left Allemande` is not, so the
//      membership rule alone would have passed a reading the abbreviation does not settle.
//   3. `getout-conformance.mjs` now ENFORCES rule 1: every token must expand either to an
//      implemented call or to a name declared in `KNOWN_CATALOGUE_GAPS`. Before that, a wrong
//      expansion was invisible - it just moved a line from one report bucket to another, and
//      the phantom name was attributed to the ENGINE.
//
// A wrong expansion still cannot be detected automatically once it names a real call: the
// remaining defence is the full before/after ranking diff, which is why `decodeStats` reports
// both rankings rather than a slice.

// Prefixes A-/B-/G-/C-/E-/H- are All/Boys/Girls/Centers/Ends/Heads, which is how All8 writes
// group-scoped calls (e.g. B-Run = Boys Run). `H-` is evidenced by the corpus ITSELF rather
// than assumed: `H-Trd` appears as a call, and the same fixture writes `{beau couple: H/S}`,
// which states in All8's own characters that H is Heads (and S Sides). `S-` is deliberately
// NOT added, because no `S-` token occurs - the fixture only ever uses `S` inside that aside.
export const GROUP = { A: 'All', B: 'Boys', G: 'Girls', C: 'Centers', E: 'Ends', H: 'Heads' };

export const TOKENS = {
  AL: 'Allemande Left',
  RLG: 'Right and Left Grand',
  WWGrd: 'Wrong Way Grand',
  Prom: 'Promenade',
  PromH: 'Promenade Home',
  PasTh: 'Pass Thru',
  SldTh: 'Slide Thru',
  BxGnt: 'Box the Gnat',
  RLT: 'Right and Left Thru',
  RollA: 'Rollaway',
  StrTh: 'Star Thru',
  CirL: 'Circle Left',
  CirR: 'Circle Right',
  JoinH: 'Join Hands',
  UTurn: 'U-Turn Back',
  'T1/4': 'Touch 1/4',
  A8Cir: 'All 8 Circulate',
  SwThr: 'Swing Thru',
  TrdBy: 'Trade By',
  TrdWv: 'Trade the Wave',
  Trd: 'Trade',
  DixiS: 'Dixie Style to a Wave',
  DixiG: 'Dixie Grand',
  SpTop: 'Spin the Top',
  FanTp: 'Fan the Top',
  Ext: 'Extend',
  Scoot: 'Scoot Back',
  DoSaD: 'Do Sa Do',
  DoPaso: 'Do Paso',
  TrnTh: 'Turn Thru',
  'R.PBy': 'Right Pull By',
  StepW: 'Step to a Wave',
  'Ca3/4': 'Cast Off 3/4',
  CtrIn: 'Centers In',
  PsOcn: 'Pass the Ocean',
  CalTw: 'California Twirl',
  ChasR: 'Chase Right',
  FwdBk: 'Forward and Back',
  LoadB: 'Load the Boat',
  'Col.C': 'Column Circulate',
  PeelO: 'Peel Off',
  SpltC: 'Split Circulate',
  '1/2.C': '1/2 Circulate',
  LHing: 'Left Hinge',
  Run: 'Run',
  Fold: 'Fold',
  BendL: 'Bend the Line',
  LSwTh: 'Left Swing Thru',
  Recyc: 'Recycle',
  Swing: 'Swing',
  DPT: 'Double Pass Thru',
  VeerR: 'Veer Right',
  VeerL: 'Veer Left',
  XFold: 'Cross Fold',
  Zoom: 'Zoom',
  Tag: 'Tag the Line',
  DoPaS: 'Do Paso',
  WhlDl: 'Wheel and Deal',
  RvFlt: 'Reverse Flutterwheel',
  Cir: 'Circulate',
  // ---- added in Phase 2, each verified against the implemented catalogue ----
  // Every entry below was checked to expand to an exact member of `implementedTitles()`
  // BEFORE being added, because a wrong expansion does not fail a gate: it reclassifies the
  // line from "our decoder gap" to "the engine has no such call", i.e. it accuses the engine
  // of a gap that is really our misreading. The procedure and the rejections are recorded in
  // the header; `getout-conformance.mjs` now enforces the membership rule.
  DivTh: 'Dive Thru',
  AcDcy: 'Acey Deucey',
  PtTrd: 'Partner Trade',
  'LT1/4': 'Left Touch 1/4',
  'Wk&Dg': 'Walk and Dodge',
  SCirW: 'Single Circle to a Wave',
  SpChT: 'Spin Chain Thru',
  Clovr: 'Cloverleaf',
  Feris: 'Ferris Wheel',
  PsTTC: 'Pass to the Center',
  FlipD: 'Flip the Diamond',
  WhlAr: 'Wheel Around',
  A8SpTop: 'All 8 Spin the Top',
  // `&` is All8's "and" (the reference normalizer does `.replaceAll('&','and')`), so `&Roll` is
  // the "and Roll" MODIFIER on the preceding call. It is decodable now because the engine finally
  // HAS `Roll`: it is a geometry-derived call (coded-moves.ts) that turns each dancer a quarter in
  // the direction they were already turning. Before that, `Roll` was absent from the catalogue
  // entirely - no tam, not even in the call index - so this entry would have been a phantom name
  // and the membership gate below would have rejected it.
  '&Roll': 'Roll',
};

/**
 * Names All8 uses that the catalogue genuinely does NOT implement.
 *
 * This list exists to make "this is a real catalogue gap" DIFFERENT from "we mis-expanded a
 * token", which are otherwise indistinguishable from the outside: before this, a mis-expansion
 * showed up as an absent name and was reported as an engine deficiency. Declaring each one is
 * what lets `getout-conformance.mjs` require every OTHER token to expand to a call the engine
 * actually has, and fail loudly if one does not.
 *
 * Measured (Phase 2): 59 of the table's 64 distinct names are implemented. These are the 5 that
 * are not, and they are genuine engine gaps, not decoding errors:
 *   Join Hands, 1/2 Circulate            - absent from the catalogue entirely
 *   Left Hinge                           - absent entirely (only bare `Hinge` exists)
 *   Fold, Cross Fold                     - in the index, with no <tam> anywhere
 */
export const KNOWN_CATALOGUE_GAPS = new Set([
  'Join Hands',
  '1/2 Circulate',
  'Left Hinge',
  'Fold',
  'Cross Fold',
]);

/**
 * Tokens deliberately left UNDECODED, with the reason. Recorded so that the next reader does
 * not "helpfully" add them, and so the ranking below can be read for what it is: most of the
 * remaining decoder gap is not a shorthand problem but a missing IMPLEMENTATION.
 *
 *   &Roll (41, the single largest token) - RESOLVED. `Roll` was absent from the catalogue
 *       entirely (tam, index and implemented all absent), and All8 writes it as a MODIFIER on the
 *       preceding call: "The sequencer calculates Roll based on the turning motion at the end of
 *       the previous call". It is now a geometry-derived call (coded-moves.ts) built on the
 *       remembered turn direction the engine already recorded, so the token decodes.
 *   Expl& (6)  - "Explode and <next call>", e.g. `--Expl& --LoadB` = Explode and Load the Boat.
 *       Still needs COMPOSITION of a modifier with the FOLLOWING token, and
 *       `Explode and Load the Boat` is not a title. Composition, not vocabulary.
 *   SHing (13) - "Single Hinge" is NOT implemented (`Split Hinge` neither); only bare `Hinge`
 *       is. Decoding it would book a real engine gap as a phantom name.
 *   1/2Tg      - "1/2 Tag" is NOT implemented; only `Tag the Line` is.
 *   Sweep      - "Sweep a Quarter" is in the INDEX with no <tam> anywhere. This is exactly the
 *       trap the header warns about: an indexed title is not an implemented call.
 *   FYNbr, RStar - "Face Your Neighbor" and "Right Star"/"Star Right" are absent from the
 *       catalogue under every spelling tried. Undecidable, so left alone.
 *   LA (14)    - "Ladies Chain" IS implemented and "Left Allemande" is not, but the corpus uses
 *       `LA` inside parenthetical commentary ("expecting LA") as well as as a token, so the
 *       reading is not unambiguous enough for this table.
 *   8Chn1/5, G-Cir2, B-Twice, Square Thru 1 - the engine implements Square Thru 2/3/4 only, and
 *       has no `Eight Chain N`, no `Girls Circulate 2` and no `Boys Twice`. Engine gaps.
 *   H-Trd      - "Heads Trade" is not a TITLE, but it does resolve: the engine reads a group
 *       prefix compositionally, so `Heads Trade` reaches the derived `Trade`. That is why the
 *       `H-` prefix is worth having even though no such title exists.
 */
// N-hand counts: All8's digit counts HANDS (e.g. --SqTh1 = Square Thru with one
// hand), which is not the standard call suffix, so only the counts that ARE real
// call names (2, 3, 4) are expanded. `--SqTh1`/`--SqTh5`/`--8Chn*` are therefore left
// undecoded rather than expanded into names the catalogue cannot have.
for (let n = 2; n <= 4; n++) TOKENS[`SqTh${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`SqT@${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`LSqT${n}`] = `Left Square Thru ${n}`;

/**
 * Split a published line into its tokens.
 *
 * Three things the first version of this got wrong, each MEASURED over the corpus rather than
 * guessed (Phase 2):
 *
 *  1. A `-` is All8's JOINER as well as its leading call marker, so a dash can TRAIL a token.
 *     24 occurrences across 18 distinct tokens ended in one, and several of them were tokens
 *     the table already knew: `C-SqT@3-`, `C-StepW-`, `C-SwThr-`, `C-T1/4-`, `C-VeerL-`,
 *     `C-PsOcn-`, `E-Trd-`, `DoSaD-`, `Clovr-`. Stripping only LEADING punctuation lost every
 *     one of those lines to a readable token.
 *  2. `{...}` is a third aside form. The corpus writes conditional asides in braces -
 *     `{beau couple: H/S}-WhlAr` - which the `()` and `""` passes left in place, gluing the
 *     aside to the call that followed it.
 *  3. All8 separates calls with wide gaps, but an aside can collapse that to a single space
 *     (`--CtrIn  B-Fold "behind your girl" --Prom`), so asides are removed FIRST, before the
 *     gap split.
 */
export function tokenize(line) {
  return line
    .replace(/\([^)]*\)/g, '  ')           // drop parenthetical asides
    .replace(/\{[^}]*\}/g, '  ')           // drop BRACED asides (conditional notes)
    .replace(/\[[^\]]*\]/g, '  ')          // drop BRACKETED alignment markers, e.g. `[B1c]`
    .replace(/"[^"]*"/g, '  ')             // drop quoted asides
    // All8 separates calls with wide gaps, but a call marker `--` ALWAYS starts a new call, so
    // split before one even when the gap collapsed to a single space - which is what happens
    // wherever an aside was removed from between two calls (`AL --PasTh` used to arrive as ONE
    // token, and the same glue produced the bare `C-` leftover).
    .split(/\s{2,}|\s+-\s+|\s+(?=--)/)
    .map((t) => t.trim())
    .filter(Boolean)
    // Leading marker/joiner punctuation AND a trailing joiner dash, plus sentence punctuation.
    // The group-prefix dash is INTERNAL (`B-Run`) and survives both.
    .map((t) => t.replace(/^[-\s!|]+/, '').replace(/[-\s!|,.;:]+$/, '').trim())
    .filter(Boolean)
    // An aside that was dropped from the MIDDLE of a token can leave a bare joiner behind.
    .filter((t) => !/^-+$/.test(t));
}

/** Decode a token to a call name, or null when we cannot read it. A group prefix is
 * decoded but flagged `scoped`, because the composed name ("Boys Run") is a reading
 * of All8's shorthand rather than a name All8 prints.
 *
 * The trailing-dash strip is repeated here because this function is also called directly
 * (not only through `tokenize`) with tokens taken from a line, and a joiner dash must not be
 * the difference between reading a token and not. */
export function decodeToken(token) {
  const t = token.replace(/^[-\s!|]+/, '').replace(/[-\s!|,.;:]+$/, '').trim();
  if (!t) return null;
  const g = /^([ABGCEH])-(.+)$/.exec(t);
  if (g) {
    const base = TOKENS[g[2]];
    return base ? { name: `${GROUP[g[1]]} ${base}`, scoped: true } : null;
  }
  const base = TOKENS[t];
  return base ? { name: base, scoped: false } : null;
}

/** Decode a whole published line. `undecoded` names the first token we could not
 * read, so a partial reading is never mistaken for a complete one. */
export function decodeLine(line) {
  const tokens = tokenize(line);
  const calls = [];
  for (const tk of tokens) {
    const d = decodeToken(tk);
    if (d === null) return { calls, undecoded: tk };
    calls.push(d);
  }
  return { calls };
}

/**
 * Both token rankings over a set of published lines.
 *
 * TWO rankings, because they answer different questions and this repo has previously quoted
 * one while naming the other's harness:
 *
 *   - `firstFail` counts each token once per line, at the FIRST unreadable position - which is
 *     what the runner actually stops on, so it measures how many lines a fix would unblock;
 *   - `allOcc` counts every occurrence anywhere in the line, including tokens sitting behind an
 *     earlier unknown, so it measures the true size of the vocabulary gap.
 *
 * They disagree materially (`&Roll` is 21 first-failure but 41 all-occurrence; `LA` is 6 vs 14),
 * so a work queue built from one of them is not the same queue as a queue built from the other.
 */
export function decodeStats(lines) {
  const firstFail = new Map();
  const allOcc = new Map();
  let decoded = 0;
  let undecoded = 0;
  for (const line of lines) {
    let failed = false;
    for (const tk of tokenize(line)) {
      if (decodeToken(tk) === null) {
        allOcc.set(tk, (allOcc.get(tk) ?? 0) + 1);
        if (!failed) { firstFail.set(tk, (firstFail.get(tk) ?? 0) + 1); failed = true; }
      }
    }
    if (failed) undecoded++; else decoded++;
  }
  return { total: lines.length, decoded, undecoded, firstFail, allOcc };
}

/** `token(count) token(count) …`, most frequent first, ties broken by token so a report is
 * stable between runs. */
export function formatRanking(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t, n]) => `${t}(${n})`)
    .join(' ');
}

