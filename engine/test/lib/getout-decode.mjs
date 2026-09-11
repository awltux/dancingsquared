// Decoding All8's abbreviated get-out lines into call names.
//
// Shared by getout-conformance.mjs (which measures vocabulary against the engine
// catalogue) and getout-behaviour.mjs (which actually runs the get-outs), so both
// use ONE abbreviation table and cannot drift apart.
//
// ALL8'S OWN NOTATION KEY IS AVAILABLE, AND IT CHANGED THE METHOD. This file used to say the table
// is "ours, not All8's" because "All8's own notation reference (help.cgi) returns HTTP 500". That is
// true of the CGI, but Rich Reel's notation page survives on the Internet Archive, and it is the key:
//
//   Call Name and Designator Abbreviations (14 Oct 2012):
//   https://web.archive.org/web/20160701101228/http://www.all8.com/sd/calling/abbrlist.htm
//
// It carries the call-name table AND the designator list AND the punctuation legend, which between
// them settle three things this file had been inferring or refusing:
//
//   - the expansions themselves, so an entry is now ALL8'S OWN reading rather than a guess at it.
//     The archived list contributed 31 tokens whose calls this engine implements, and confirmed
//     `SHing` = "Single Hinge" and `LA` = "Allemande Left" (NOT "Ladies Chain", which this file had
//     previously refused as too ambiguous to guess and which the membership rule alone would have
//     got wrong);
//   - the punctuation: `,` is "while", `;` is "then", `!` marks a difficult line, `-` after a call
//     is an "and"/"same ones" tie-in where "the active dancers keep working", and `(...)`/`"..."`/
//     `{...}` are asides. The tokenizer's joiner-dash and aside handling follow those, and
//     `abbrlist.htm` is why a trailing dash must be stripped rather than treated as part of a name;
//   - the designators, including the one genuine ambiguity: `H-` is "Heads or Sides (when H=Sides,
//     S=Heads)". So `GROUP`'s `H: 'Heads'` is the default reading, and the flip is a documented
//     caller convention rather than something we can resolve from the text.
//
// It is still deliberately conservative: a token is decoded only when its expansion is settled, and
// anything else is reported as UNDECODED rather than guessed, because a wrong expansion would
// silently turn a real engine gap into a phantom call name.
//
// PHASE 2 turned "conservative" from a stated intention into a PROCEDURE, because the risk it
// guards against was not actually being caught by anything:
//
//   1. A candidate expansion is admissible only when it is an exact member of
//      `implementedTitles(assets)` - the set of calls the engine can really perform - OR is
//      declared in `KNOWN_CATALOGUE_GAPS`. Two traps that rule catches and intuition did not:
//      `Sweep a Quarter` is in the engine's call INDEX with no <tam> anywhere, so it is not a call
//      (All8's key agrees the token is `Sweep` = "Sweep 1/4", which the index does not carry
//      either); and a name can be absent under every spelling the catalogue uses.
//   2. Where the key is silent AND the catalogue admits more than one reading, the token is left
//      undecoded. `LA` was the case in point until the key settled it.
//   3. `getout-conformance.mjs` ENFORCES rule 1: every token must expand either to an implemented
//      call or to a declared gap. Before that, a wrong expansion was invisible - it just moved a
//      line from one report bucket to another, and the phantom name was attributed to the ENGINE.
//
// With the key in hand the second half of that work is now the honest one: a token whose call the
// engine simply does not implement is DECODED and its gap DECLARED, which moves the line out of
// "our gap in reading All8" and into a correct engine-gap attribution.
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
  // ---- added from ALL8'S OWN ABBREVIATION LIST ----
  // Rich Reel's "Call Name and Designator Abbreviations" note (abbrlist.htm, 14 Oct 2012) is now
  // available from the Internet Archive, and it is the notation key this file has been saying it
  // could not get:
  //
  //   https://web.archive.org/web/20160701101228/http://www.all8.com/sd/calling/abbrlist.htm
  //
  // Every entry below is All8's OWN expansion, copied verbatim, not a reading of the published
  // lines - so these expansions are AUTHORITATIVE rather than inferred, and each was still checked
  // against `implementedTitles()` by the gate. 34 of the key's expansions are calls this engine
  // implements; these are the ones whose tokens the corpus actually uses.
  //
  // It also settles two tokens this table had refused as too ambiguous to guess. `LA` is "Left
  // Alamande (Alamande Left)" - NOT "Ladies Chain" - and `SHing` is "Single Hinge".
  LA: 'Allemande Left',
  ALIAS: 'Allemande Left in the Alamo Style',
  FYNbr: 'Follow Your Neighbor',
  'Cpl.C': 'Couples Circulate',
  'Cpl.H': 'Couples Hinge',
  'Cpl.T': 'Couples Trade',
  'SF.Pr': 'Single File Promenade',
  'D.Cir': 'Diamond Circulate',
  'Cut.D': 'Cut the Diamond',
  '8ChTh': 'Eight Chain Thru',
  GrSwT: 'Grand Swing Thru',
  ReDcy: 'Relay the Deucey',
  LTrnT: 'Left Turn Thru',
  ChDTL: 'Chain Down the Line',
  Coord: 'Coordinate',
  SpChG: 'Spin Chain the Gears',
  SpChX: 'Spin Chain and Exchange the Gears',
  PeelT: 'Peel the Top',
  Weave: 'Weave the Ring',
  XFire: 'Crossfire',
  Balnc: 'Balance',
  StepT: 'Step Thru',
  HSash: 'Half Sashay',
  LChas: 'Left Chase',
  LnCyc: 'Linear Cycle',
  PingP: 'Ping Pong Circulate',
  Shoot: 'Shoot the Star',
  Trak2: 'Track 2',
  WWThr: 'Wrong Way Thar',
  Cir2L: 'Circle to a Line',
  StrPr: 'Star Promenade',
  // All8 confirms the reading; the ENGINE has no `Single Hinge`, so this is declared a catalogue
  // gap below rather than left looking like a shorthand failure of ours.
  SHing: 'Single Hinge',
  // The remaining tokens whose reading All8's key settles and whose call the engine does NOT
  // implement. Decoding them is the point: it moves the line out of "our gap in reading All8" and
  // into an honest engine-gap attribution, which is what the declared list above is for. Leaving
  // them undecoded would keep accusing our abbreviation table of a gap that is really a missing
  // implementation.
  RStar: 'Right-hand Star',
  Sweep: 'Sweep 1/4',
  '1/2Tg': '1/2 Tag',
  LyIMS: 'Ladies In And The Men Sashay',
  XRun: 'Cross Run',
  SeSaw: 'See Saw',
  LHing: 'Left Hand Hinge',
};
for (let n = 1; n <= 5; n++) TOKENS[`8Chn${n}`] = `Eight Chain ${n}`;

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
  // Confirmed by All8's own abbreviation list, so the READING is not in doubt - the engine simply
  // does not implement the call. Declaring them here is what moves those corpus lines out of "our
  // gap in reading All8" and into a correct engine-gap attribution. `Single Hinge` alone is 11
  // lines, and the biggest single item left on the decoder ranking.
  'Single Hinge',
  'Left Hand Hinge',
  'Right-hand Star',
  'Sweep 1/4',
  '1/2 Tag',
  'Eight Chain 1',
  'Eight Chain 2',
  'Eight Chain 3',
  'Eight Chain 4',
  'Eight Chain 5',
  'Ladies In And The Men Sashay',
  'Cross Run',
  'See Saw',
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
    .map((t) => t.replace(/^[-\s!|]+/, '').replace(/[-\s!|,.;:]+$/, '').trim())
    .filter(Boolean)
    // All8's key defines the dash as a TIE-IN ("the active dancers keep working"), and `,` as
    // "while", so a leading comma on a token is punctuation rather than part of a name.
    .map((t) => t.replace(/^[,;]+/, '').trim())
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

