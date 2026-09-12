// All8's call notation: the abbreviation table, the tokenizer and the line decoder.
//
// THIS IS PRODUCTION CODE, not a harness helper. It began life as `engine/test/lib/getout-decode.mjs`
// and moved into the engine when the All8 sequence IMPORT/EXPORT feature needed it (all8-format.ts):
// a production codec cannot reach into `test/`, and a second copy of a 130-entry abbreviation table
// is exactly how the two would drift. `engine/test/lib/getout-decode.mjs` is now a re-export shim,
// so the conformance and behaviour harnesses keep importing the same names from the same path.
//
// Consumers:
//   engine/src/sequencer/all8-format.ts  - the sequence codec (import/export)
//   engine/test/getout-conformance.mjs   - measures vocabulary against the engine catalogue
//   engine/test/getout-behaviour.mjs     - actually runs the get-outs
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

// Prefixes A-/B-/G-/C-/E-/H-/S- are All/Boys/Girls/Centers/Ends/Heads/Sides, which is how All8
// writes group-scoped calls (e.g. B-Run = Boys Run). `H-` is evidenced by the corpus ITSELF rather
// than assumed: `H-Trd` appears as a call, and the same fixture writes `{beau couple: H/S}`,
// which states in All8's own characters that H is Heads (and S Sides).
//
// `S-` USED TO BE DELIBERATELY ABSENT, on the grounds that "no `S-` token occurs - the fixture only
// ever uses `S` inside that aside". That was true of the GET-OUT corpus and false of All8's
// SINGING-CALL FIGURES, which is the corpus the sequence importer reads: `S-SqTh4`, `S-RLT`,
// `S-PasTh`, `S-PsOcn`, `S-T1/4`, `S-Wk&Dg`, `S-LeadR` all occur there. The `{beau couple: H/S}`
// aside had already said what `S` means; the get-out corpus simply had not used it yet.
export const GROUP: Record<string, string> = { A: 'All', B: 'Boys', G: 'Girls', C: 'Centers', E: 'Ends', H: 'Heads', S: 'Sides',
  // `O-` is in All8's designator list as "Others -or- Outsides the context should make it clear
  // which". Confirmed by the project owner that `O-SqTh3` reads as Outsides, so it is mapped; note
  // that this is the only ambiguous designator in the list, and the engine's selection resolver is
  // what decides whether `Outsiders ...` can actually be danced.
  O: 'Outsiders' };

export const TOKENS: Record<string, string> = {
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
  // ---------------------------------------------------------------------------------------------
  // READ FROM THE AUTHORITATIVE KEY (abbrlist.htm, fetched in round 36). Everything below is a
  // literal entry in All8's own call-name list, which is why the expansions are not guesses. They
  // were missing because the decoder table was built from the GET-OUT corpus, and these forms
  // simply do not occur there - they are figure-page vocabulary.
  // ---------------------------------------------------------------------------------------------

  // PROMENADE FRACTIONS. All8: `Pr1/2` = "Promenade Half Way Around", `Pr3/4` = "Promenade 3/4",
  // `Pr4/4` = "Promenade All The Way Around". The designator supplies who, so `H-Pr1/2` expands
  // through the group handler to "Heads Promenade 1/2" - which IS the catalogue's own title (as
  // are the Sides, 3/4 and Full forms). This one pattern is 41 of the 109 unread fig_m cells.
  'Pr1/2': 'Promenade 1/2',
  'Pr3/4': 'Promenade 3/4',
  'Pr4/4': 'Promenade Full',

  // `Lr` is All8's Leaders/Lead Couple designator, and it sits in the CALL positions in these two
  // (`LrTrd`, `LrUTurn`), so the group handler cannot reach them - it only knows whole-group
  // designators. 6 occurrences of `LrTrd` makes it the second-biggest fig_m gap.
  LrTrd: 'Leaders Trade',
  LrUTurn: 'Leaders U-Turn Back',

  // Hand-count chains. All8's key gives `4LChn` and `4LCh3`; the engine's title spells the number
  // out ("Four Ladies Chain"), which is exactly the kind of All8-name/engine-name mismatch that
  // must be BRIDGED here rather than counted as a gap.
  '4LChn': 'Four Ladies Chain',
  '4LCh3': 'Four Ladies Chain 3/4',

  // Direct entries from the key. (`LeadR` already exists above, in the fourth pass.)
  CtsyT: 'Courtesy Turn',
  LStar: 'Left Hand Star',
  StarL: 'Left Hand Star',
  StarR: 'Right Hand Star',
  ChgHn: 'Change Hands',
  FullT: 'A Full Turn',
  SepA1: 'Separate Around One',
  SepA2: 'Separate Around Two',
  Sp2A1: 'Split the Outside Couple',
  WalkA: 'Walk Across',
  YelRk: 'Yellow Rock',
  'BW.GD': 'Boys Walk, Girls Dodge',
  SFGrSqr: 'Sides Face, Grand Square',
  SlipC: 'Slip the Clutch',
  ALTAT: 'Allemande Left to an Allemande Thar',
  // All8's key: "Pass One (Pass by 1, Pass 1 by, Skip 1)". Decoded because the READING is not in
  // doubt; the engine has no such call, so the name is declared a gap below.
  Pass1: 'Pass One',
  // CONFIRMED BY THE PROJECT OWNER: `PtrTr` is the same call as `--PtTrd`, Partner Trade. It is
  // NOT in All8's published key at all, so it could not be settled from the data - which is exactly
  // why it was left unread rather than guessed at.
  PtrTr: 'Partner Trade',
  // ...and `ScooG` is `C-Scoot`: "Centers - Scoot".
  ScooG: 'Scoot Back',
  // ...and `to-BxGnt` carries prose in the call column ("to formation Box the Gnat"); the call is
  // Box the Gnat.
  'to-BxGnt': 'Box the Gnat',
  // ALL8'S ACTIVE-DANCER NOTATION, and the one entry here that is an APPROXIMATION. All8's `-B` is
  // "that Boy / same Boy(s) of dancers who were active on last call", so `-BRun` is not "the boys
  // run" - it is "the boys AMONG THE ACTIVE DANCERS run". The engine has no active-set tracking, so
  // the nearest engine call is `Boys Run`; where the active set is not all four boys (e.g. after
  // `S-T1/4`, where the actives are the Sides) this OVER-SPECIFIES. Recorded rather than hidden.
  BRun: 'Boys Run',

  // SOURCE MISSPELLINGS in fig_m.htm. Each of these appears once or twice on the page next to many
  // correct spellings of the same token, so they are typos in the published data rather than a
  // second abbreviation. Kept as explicit aliases (not by fuzzy matching) so they stay visible.
  LaedR: 'Lead Right', // `H-LeadR` is spelled correctly twice; `H-LaedR` once
  PsOan: 'Pass the Ocean', // for `PsOcn`
  ChDLT: 'Chain Down the Line', // for `ChDTL`
  Clov: 'Cloverleaf', // for `Clovr`
  SpnTp: 'Spin the Top', // for `SpTop`
  UTrun: 'U-Turn Back', // for `UTurn`; fig_m writes `B-UTrun` where the key says `UTurn`

  // The remaining three FACINGS. `FaceI` was already here; the key lists `FaceL`/`FaceR`/`FaceO`
  // beside it, and the engine implements all four as coded pivots. Missing them cost the
  // get-out corpus `FaceR` and `G-FaceR`, and broke the FIGURES round trip, because a figure
  // containing `Tag.R` expands to "Face Right" and the exporter could not spell it back.
  FaceL: 'Face Left',
  FaceR: 'Face Right',
  FaceO: 'Face Out',
  CalTw: 'California Twirl',
  ChasR: 'Chase Right',
  FwdBk: 'Forward and Back',
  LoadB: 'Load the Boat',
  'Col.C': 'Column Circulate',
  PeelO: 'Peel Off',
  SpltC: 'Split Circulate',
  '1/2.C': '1/2 Circulate',
  // NOTE: `LHing` is declared ONCE, further down, as `Left Hand Hinge`. It used to appear here too
  // as `Left Hinge`, which is both the wrong expansion and a duplicate key - invisible while this
  // was a .mjs file (last one wins), but a hard error now that it is TypeScript. All8's key says
  // `LHing` is "Hinge by the Left", i.e. Left HAND Hinge, and Phase 6 bridged that to the engine's
  // `Hinge`; the stale `Left Hinge` entry was the one being shadowed.
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
  // ---- second pass over the SAME key (abbrlist.htm) ----
  // These base tokens were missing even though the calls they name ARE implemented, so each one
  // is a pure reading gain: the group-scoped forms (`G-Hing`, `C-Roll`) compose through the
  // `X-` prefix rule and needed only the base entry to exist.
  Hing: 'Hinge',        // `G-Hing` = "Girls Hinge"  (bare `Hinge` is implemented; `Hing` was absent)
  Roll: 'Roll',         // `C-Roll` = "Centers Roll" (`&Roll` was the only Roll spelling in the table)
  DoPas: 'Do Paso',     // `DoPaso`/`DoPaS` were already here; the key also writes `DoPas`
  // ---- third pass: what the SINGING-CALL FIGURES use, which the get-out corpus never did ----
  // The figure corpus is a different vocabulary sample from the get-out corpus, and reading it
  // exposed four base tokens whose calls the engine already implements - so each is a pure reading
  // gain with no gap to declare, exactly like the `Hing`/`Roll` group above.
  FlutW: 'Flutterwheel', // `FlutW` was missing while `RvFlt` (Reverse Flutterwheel) was present
  LeadR: 'Lead Right',   // `H-LeadR` = Heads Lead Right, `--LeadR` = Lead Right
  '2LChn': 'Ladies Chain', // All8 writes the MS call "Ladies Chain" as "2 Ladies Chain"
  FaceI: 'Face In',      // `--FaceI`, `G-FaceI`; the other half of the `TagI` compound
  // ---- fourth pass: the remaining gaps reported from All8's own pages ----
  // `GW.BD` is ONE call, not two. "Girls Walk, Boys Dodge" DESCRIBES who does which half of
  // `Walk and Dodge` (the leaders walk, the trailers dodge), so the whole-set reading is the same
  // motion - and neither "Girls Walk" nor "Boys Dodge" is a call title, so splitting it into two
  // names would invent vocabulary the catalogue does not have.
  'GW.BD': 'Walk and Dodge',
  BakUp: 'Back Up',      // `E-BakUp` = "Ends Back Up". No `Back Up` title - declared as a gap.
  // `4LRollA` = "4 Ladies Roll Away"; All8 also writes the dashed form `4L-RollA`. The catalogue's
  // `Rollaway` is the WHOLE-SET call (verified legal from Static Square, so it is all four couples
  // rolling away), which is exactly what the compound describes. "Four Ladies Rollaway" is NOT a
  // title, so mapping the parts separately would produce a phantom name.
  '4LRollA': 'Rollaway',
  SqTh5: 'Square Thru 5', // digit = HANDS; catalogue has 1 1/2, 2, 2 1/2, 3, 3 1/2, 4 but no 5.
  TrdR: 'Trade Right',    // `B-TrdR` = "Boys Trade Right". No `Trade Right` title - a gap.
  // `C` is the one token with TWO readings in All8's key, disambiguated by the dash: `C` alone is
  // "Circulate", `C-` is the "Centers -" designator. `tokenize` now reattaches a stranded
  // designator before the dash is stripped, so by the time a token reaches this table a bare `C`
  // really is the call. (Before that fix the corpus's only three bare `C` tokens were designator
  // remnants from `C-"reverse"-WhlAr`, and adding this entry would have mis-decoded them.)
  C: 'Circulate',
  // The rest are All8's readings of tokens the ENGINE cannot perform. Decoding them is still the
  // point: it moves the line out of "our gap in reading All8" into an honest engine-gap
  // attribution, which is what the declared list below is for.
  SqTh1: 'Square Thru 1', // `C-SqTh1` = "Centers Square Thru 1". The catalogue has Square Thru
                          // 1 1/2, 2, 3 and 4 but NOT 1, so the bare name is a real gap.
  Cir2: 'Circle 2',       // `G-Cir2` = "Girls - Circle 2". NOTE: this CORRECTS a comment further
                          // down that read `G-Cir2` as "Girls Circulate 2" - All8's key says
                          // Circle, and the corpus context fits it. No `Circle 2` title exists.
  RunL: 'Run Left',       // `G-RunL` = "Girls - Run Left"  } direction-specified runs: the engine
  RunR: 'Run Right',      // `B-RunR` = "Boys - Run Right"  } has no `Run Left`/`Run Right` title,
                          //                                  though `Girls Run` itself applies.
  // ---- fifth pass: key entries the GET-OUT corpus needed but that were never added ----
  // Each of these is a literal entry in All8's own key (abbrlist.htm) that the table was missing
  // outright - not a new mechanism and not an inference. They were found by ranking the corpus's
  // remaining first-failure tokens and checking each against the key, which is the procedure the
  // file header prescribes (check `implementedTitles()` first, then add the key's own reading).
  BxCir: 'Box Circulate', // key: "{designated} Box Circulate". The corpus writes `-BxCir-`, whose
                          // leading `-` is the "same Boy(s) / active" designator - dropped here
                          // exactly as `-BRun` drops it, because the engine has no active-set
                          // tracking. The CALL is not in doubt; only its scoping is approximated.
  // `1L.2R` and friends are All8's older "First Couple Go ... Next Go ..." notation, and `FLNR` is
  // his own note that it is an OLD SPELLING of `1L.2R`. Both spellings expand to catalogue TITLES
  // (`b2/first_couple_go.xml` ships all four), so these are pure reading gains with no gap.
  '1L.2R': 'First Couple Go Left, Next Couple Go Right',
  '1L.2L': 'First Couple Go Left, Next Couple Go Left',
  '1R.2L': 'First Couple Go Right, Next Couple Go Left',
  '1R.2R': 'First Couple Go Right, Next Couple Go Right',
  FLNR: 'First Couple Go Left, Next Couple Go Right', // "(old notation - see 1L.2R)"
};

/** Tokens All8's key expands to MORE THAN ONE call. `TagI` is published as "Tag The Line - Face
 * In", which is a compound of two calls rather than one call carrying a modifier - and BOTH
 * halves are engine-implemented names (`Tag the Line`, `Face In`), so this is a reading gain with
 * no gap to declare. Kept out of `TOKENS` because that map is one-name-per-token and the
 * conformance gate reads it directly. */
export const MULTI_TOKENS: Record<string, string[]> = {
  TagI: ['Tag the Line', 'Face In'],
  // `Sw&Pr` is the SINGING-CALL ending, and by far the most common token on All8's figure pages -
  // 170 of them, more than every other undecoded token combined. All8's key defines `&` as "and",
  // so it is "Swing and Promenade": two calls, both engine-implemented. It went unnoticed until the
  // sequence importer read the FIGURES, because the get-out corpus ends at `--RLG`/`--AL`/`--Prom`
  // almost exclusively and uses this form once.
  'Sw&Pr': ['Swing', 'Promenade'],
  // `RolPr` = "Roll, then Promenade" - two calls, both implemented.
  'RolPr': ['Roll', 'Promenade'],
  // `Tag_I` is All8's same compound spelled with an underscore.
  'Tag_I': ['Tag the Line', 'Face In'],
  // ...and fig_m.htm spells it with a PERIOD. All8's punctuation table says "." in a call name has
  // no special meaning, so `Tag.I` is the same token as `TagI`; it just never appeared in the
  // get-out lists, which is why the period form went unnoticed until the FIGURES were read.
  'Tag.I': ['Tag the Line', 'Face In'],
  'Tag.R': ['Tag the Line', 'Face Right'],
  // The key gives the whole Tag family: `TagL`/`TagM`/`TagO`/`TagR` beside `TagI`. `TagR` and
  // `TagL` were both showing up unread in the get-out corpus.
  TagR: ['Tag the Line', 'Face Right'],
  TagL: ['Tag the Line', 'Face Left'],
};

/** Tokens that MODIFY the preceding call instead of naming one.
 *
 * All8 documents `ToWav` as "To Wave (to Formation, not call)", so `DoSaD ToWav` is ONE call -
 * "Do Sa Do to a Wave" - not two. The suffix is appended to the previous call's name and the result
 * then resolves through the engine's synonym table, which is what turns "Do Sa Do to a Wave" into
 * the catalogue's `Dosado to a Wave`. Appending to the raw name would leave a phantom: the catalogue
 * spells the title `Dosado`, not `Do Sa Do`, so the composed name needs the synonym bridge. */
export const SUFFIX_TOKENS: Record<string, string> = { ToWav: ' to a Wave', '1-1/2': ' 1 1/2' };

/**
 * Tokens that MODIFY the FOLLOWING call instead of naming one - the mirror of the suffix above.
 *
 * All8's key: `1/2of-` = "do one-half of the following call". Like `1-1/2` this is COMPOSITION
 * rather than vocabulary: the composed name is what All8's notation means, and whether the engine
 * HAS such a call is a separate question that `KNOWN_CATALOGUE_GAPS` answers. The composed spelling
 * is not invented either - it is the one All8's key already uses for the same shape, `1/2.C` =
 * "1/2 (All 8) Circulate", which this table has spelled `1/2 Circulate` from the start.
 *
 * A designator can ride on the modifier itself (`A-1/2of-` = "All ... 1/2 of ..."), so
 * `prefixModifier` returns the designator separately rather than dropping it.
 */
export const PREFIX_TOKENS: Record<string, string> = { '1/2of': '1/2 ' };

/** The prefix a token applies to the FOLLOWING call, with the designator group that scoped it. */
export function prefixModifier(token: string): { group?: string; prefix: string } | null {
  const t = normalizeToken(token);
  for (const [key, prefix] of Object.entries(PREFIX_TOKENS)) {
    if (t === key) return { prefix };
    const esc = key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const m = new RegExp(`^([${Object.keys(GROUP).join('')}])-${esc}$`).exec(t);
    if (m) return { group: GROUP[m[1]], prefix };
  }
  return null;
}

/** Whether a token is a cross-token MODIFIER: not notation we failed to read, but naming no call on
 * its own. A modifier with nothing to modify is NOT a reading - which is what keeps a leading
 * `--1-1/2` (two published corpus lines, `! --1-1/2 --PasTh --AL`) an honest unreadable token
 * rather than a silent no-op. */
export function isModifierToken(token: string): boolean {
  return !!(SUFFIX_TOKENS[normalizeToken(token)] || prefixModifier(token));
}

/**
 * Fold All8's cross-token modifiers over a decoded cell sequence.
 *
 * A suffix (`1-1/2`, "do previous call once and a half") rewrites the PREVIOUS cell's names and
 * consumes the modifier cell; a prefix (`1/2of`) rewrites the NEXT cell's names and consumes
 * itself. A modifier whose neighbour is missing or unreadable is left where it is, with no names,
 * so the caller can report the token rather than silently dropping a call.
 *
 * This is the ONE definition of what composes, shared by `decodeLine` (the get-out corpus, which
 * tokenizes a whole line) and `parseAll8Figures` (the figure page, whose cells are whitespace
 * separated and may overflow their column, so it is read per token instead).
 */
export function composeModifiers<T extends { token: string; names: string[] }>(cells: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const suffix = SUFFIX_TOKENS[normalizeToken(cell.token)];
    if (suffix) {
      if (out.length === 0) { out.push(cell); continue; }
      const prev = out[out.length - 1];
      out[out.length - 1] = { ...prev, names: prev.names.map((n) => `${n}${suffix}`) };
      continue;
    }
    const pre = prefixModifier(cell.token);
    if (pre) {
      const next = cells[i + 1];
      if (!next || next.names.length === 0) { out.push(cell); continue; }
      out.push({ ...next, names: next.names.map((n) => `${pre.group ? `${pre.group} ` : ''}${pre.prefix}${n}`) });
      i++;
      continue;
    }
    out.push(cell);
  }
  return out;
}
for (let n = 1; n <= 7; n++) TOKENS[`8Chn${n}`] = `Eight Chain ${n}`;
// All8 abbreviates the `Eight Chain` family with a DIGIT; the catalogue titles them with the number
// SPELLED OUT (see CALL_SYNONYMS). Both spellings are kept here - the decoder emits All8's literal
// reading, and the synonym table bridges it - so the token table stays a faithful record of what
// All8 prints rather than a second place the engine's naming has to be maintained.

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
  // `Single Hinge` and `Left Hand Hinge` are NOT here any more: Phase 6 bridged both to the
  // engine's `Hinge` in CALL_SYNONYMS, which is where All8's own key puts them ("Hinge
  // {designated} Hinge (prefer SHing if designating all)"; "LHing ... Hinge by the Left"). The
  // gate's stale-gap check is what caught each of them in turn.
  // `Right-hand Star` and `1/2 Tag` are NOT here any more: Phase 9b bridged both in
  // CALL_SYNONYMS, because normalising them against `implementedTitles()` showed they are the SAME
  // CALL under another spelling (`Right Hand Star`; `Half Tag`) rather than gaps. The stale-gap
  // check demanded their removal the moment the bridge existed, which is the gate doing its job -
  // the same way it caught `Single Hinge` and `Left Hand Hinge` in Phase 6 and the `Eight Chain N`
  // family before that.
  'Sweep 1/4',
  // `Eight Chain 1` .. `Eight Chain 5` USED TO BE HERE, and they were WRONG. The catalogue does
  // implement them - it spells the number out (`Eight Chain One` .. `Eight Chain Seven`) while All8
  // writes the digit - and the bridge is the digit-to-text loop in CALL_SYNONYMS. This copy of the
  // list was a STALE DUPLICATE of the harness's, which had already dropped them; the two had drifted
  // to 30 names vs 16 sharing 13. There is now one list (this one) and the harness re-exports it.
  'Ladies In And The Men Sashay',
  'Cross Run',
  'See Saw',
  // Second pass over All8's key. Each READING is authoritative (copied from the key, not inferred)
  // and each was checked against `implementedTitles()`: the engine really has no such call. In
  // particular `Square Thru 1` is a surprising gap - the catalogue ships Square Thru 1 1/2, 2, 3
  // and 4, so the ONE-hand version is the odd one missing, and All8 uses it (`--SqTh1 --AL`).
  'Square Thru 1',
  'Circle 2',
  // `Run Left` and `Run Right` USED TO BE HERE too, wrong for the same reason: the engine DOES
  // perform them. They are the derived `Run` with the side constrained, registered in
  // coded-moves.ts (runRule takes an optional direction), so the corpus's "Run Left is not legal
  // for selected dancers" was a missing REGISTRATION rather than a missing call.
  // Third pass: the FIGURE page's vocabulary (fig_m.htm), read against the authoritative key. All
  // of these are declared because the engine genuinely has no such call - NOT because the reading
  // is uncertain; every expansion in TOKENS above is a literal entry in All8's key.
  //
  // The three Promenade fractions are the interesting case: the BARE name is not a title, but the
  // designator forms ARE (`Heads Promenade 1/2`, `Sides Promenade 3/4`, `Heads Promenade Full` are
  // all real catalogue titles), so `H-Pr1/2` dances fine while this table entry - which exists only
  // so the designator handler has something to prefix - is correctly called a gap.
  'Promenade 1/2',
  'Promenade 3/4',
  'Promenade Full',
  'Change Hands',
  'A Full Turn',
  'Separate Around One',
  'Separate Around Two',
  'Split the Outside Couple',
  'Walk Across',
  'Yellow Rock',
  // These three were the ONLY entries in the harness's separate copy of this list that the engine's
  // copy did not have. The two lists had drifted (30 names vs 16, sharing 13), so `getout-decode.mjs`
  // now re-exports this one instead of defining its own - the same two-lists mistake the verify-suite
  // header warns about, caught by a gate failing when the engine's list grew.
  'Back Up',
  'Square Thru 5',
  'Trade Right',
  'Pass One', // `Pass1`; All8's key "Pass One (Pass by 1, Pass 1 by, Skip 1)"
  // ---- composed by the cross-token modifiers (`1-1/2`, `1/2of`) ----
  // These names exist ONLY as readings of All8's notation: `1/2of-` is "do one-half of the following
  // call", so the corpus's `1/2of- -UTurn` reads as "1/2 U-Turn Back". The READING is not in doubt
  // (the key defines it); the engine simply has no such call. Declared for the same reason every
  // other entry here is: it moves the line out of "our gap in reading All8" and into an honest
  // engine-gap attribution. Note `Split Circulate 1 1/2` is deliberately NOT here - the catalogue
  // ships that title, so the same `1-1/2` modifier is a pure reading gain there, which is the
  // evidence that the composed spelling is right.
  '1/2 Rollaway',        // `1/2of- -RollA`
  '1/2 U-Turn Back',     // `1/2of- -UTurn`
  'All 1/2 Wheel Around', // `A-1/2of- -WhlAr` - the `A-` designator rides on the modifier
  // The same modifier on the FIGURE page. `--SpltC --1-1/2` reads as "Split Circulate 1 1/2", which
  // IS a catalogue title - that one is a pure reading gain and is the evidence the composed spelling
  // is right. These two are the same reading on calls the catalogue does not have.
  'Partner Trade 1 1/2',   // `--PtTrd --1-1/2`
  'All 8 Circulate 1 1/2', // `--A8Cir --1-1/2`
  // Found by the figures suite's new "declared vs undeclared" split, which is what that split is
  // for. `O-SqTh3` composes through the `O-` designator to "Outsiders Square Thru 3" (the reading
  // the project owner supplied in round 38), and the BASE is implemented - but `Outsiders` is not a
  // selection the engine knows, so the composed call cannot be performed. That makes it an engine
  // gap rather than a mis-reading, and an UNDECLARED one until now.
  'Outsiders Square Thru 3',
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
 *   8Chn1/5, B-Twice - the engine has no `Eight Chain N` and no `Boys Twice`. Engine gaps.
 *      (`G-Cir2` and `Square Thru 1` were listed here too; both are now DECODED with their gaps
 *       declared below. `G-Cir2` is "Girls - Circle 2", NOT "Girls Circulate 2" - see the
 *       correction where the token is defined.)
 *   H-Trd      - "Heads Trade" is not a TITLE, but it does resolve: the engine reads a group
 *       prefix compositionally, so `Heads Trade` reaches the derived `Trade`. That is why the
 *       `H-` prefix is worth having even though no such title exists.
 *   bare `C`   - RESOLVED, and it needed a TOKENIZER fix rather than a table entry. All8's key
 *       gives `C` = "Circulate" alone but `C-` = the "Centers -" DESIGNATOR for the next call: the
 *       trailing dash is the whole difference. The corpus's only three bare `C` tokens
 *       (`C-"Sashay nose to nose"  --Prom`, `C-"reverse"-WhlAr`, `C-"RIGHT"-WhlAr`) were designator
 *       remnants left when a quoted aside between designator and call was dropped, so adding `C`
 *       then would have decoded three `Centers Wheel Around` lines as `Circulate`. `tokenize` now
 *       reattaches the designator while the dash is still visible, which both reads those three
 *       lines correctly AND lets `C` be added as Circulate.
 *
 *   ---- the tokens that were still unread on the FIGURE page (fig_m.htm). Most are now RESOLVED
 *   by a mapping supplied by the project owner, which settled every case the published key could
 *   not (All8's key has no `PtrTr`, no `ScooG`, no `to-BxGnt`, and no unambiguous `O-`). What
 *   remains is genuinely notation-shaped or malformed:
 *
 *   RESOLVED by that mapping: `--PtrTr` = Partner Trade (2), `C-ScooG` = Centers Scoot Back (1),
 *       `to-BxGnt` = Box the Gnat (1), `O-SqTh3` = Outsiders Square Thru 3 (1), and `-BRun` (2),
 *       which is All8's ACTIVE-dancer notation and maps to `Boys Run` only as an approximation.
 *
 *   RESOLVED since (this is the "different kind of problem" this note used to end on, and each
 *   one turned out to have a mechanism rather than needing a new table entry):
 *
 *   `--1-1/2` (3 cells) - a MODIFIER on the PRECEDING call, exactly as the key defines it ("do
 *       previous call once and a half - for SwThr say '3 hands'"). It is now a `SUFFIX_TOKENS`
 *       entry, so `--SpltC --1-1/2` reads as **Split Circulate 1 1/2** - and that IS a catalogue
 *       title, which is the independent evidence that the composed spelling is what All8 means.
 *       Where the composed call does not exist (`Partner Trade 1 1/2`) the gap is DECLARED rather
 *       than hidden, which is the whole point of declaring gaps.
 *   `1/2of-` (corpus, 4 lines) - the mirror case, a PREFIX on the FOLLOWING call ("do one-half of
 *       the following call"), now `PREFIX_TOKENS`. The composed spelling follows the one the key
 *       already uses for the same shape, `1/2.C` = "1/2 (All 8) Circulate", which this table has
 *       spelled `1/2 Circulate` from the start.
 *   `/-SqTh4` (3 cells) - the designator is literally `/`, which appears in NO designator list in
 *       the key (`--`, `-`, `?-`, `A-`, `B-`, `C-`, `E-`, `G-`, `H-`, `Lr`, `O-`, `S-`, `P-`, `VC`,
 *       `VE`, `4L`, `4B`, `4G`, `C4`, `C6`, `CB`, `CG`, `HB`, `HG`, `IF`, `OF`, `OB`, `OG`, `O6`,
 *       `Tr`, `6-`, `A8`, `-B`, `-G`). RESOLVED as an UNMODELLED LEADING DESIGNATOR: it occurs
 *       exactly twice in the whole archive, both times on this one cell, so its scoping cannot be
 *       learned from any other context; `normalizeToken` drops it and the cell's call reads as
 *       "Square Thru 4". That is a deliberate, recorded loss of scoping (the same trade `-BRun`
 *       makes), not a reading of what `/` means - there is no evidence for what it means.
 *   `G-UTurn,B-Trd` (1 cell) - a COMMA-join. The key's punctuation table gives `,` = "while", so
 *       this is "Girls U-Turn Back while Boys Trade" - TWO calls. Both readers now split on the
 *       comma; decoding it as one name was wrong.
 *
 *   STILL UNREAD, and deliberately not guessed at (4 cells, all malformed SOURCE data rather than
 *   missing notation):
 *   `--1/2` (1) - not in the key. The key's only call whose name starts `1/2` is `1/2.C` = "1/2
 *       (All 8) Circulate", and the page's cell carries no `C`, and the key's own punctuation rule
 *       ("." in a call name has no special meaning) means `1/2` and `1/2.C` are not the same token.
 *       Two readings fit the line equally well (`1/2 Circulate` vs the `1/2of` prefix), so the
 *       ambiguity wins and it stays unread.
 *   `--Keep` (1) - not in the key. Reads as prose in its line (`--Keep  --Prom`).
 *   `H-meet-T1/4` (1) - prose leaked into a call column ("meet"); the real content is Touch 1/4.
 *   `S-` (1) - an ORPHANED DESIGNATOR: the line is `S-"reverse!" H-SqTh3`, and blanking the
 *       quoted aside leaves the `S-` with no call to attach to. Not a call at all.
 */
// N-hand counts: All8's digit counts HANDS, so `--SqTh1` is Square Thru on one hand. All8's own key
// writes that expansion as the literal name `Square Thru 1`, which makes it a call name rather than
// a private shorthand - but the catalogue has no such title, so it is decoded and its gap DECLARED.
// That is the honest attribution: the line stops looking like a failure of our abbreviation table.
// (The old comment here claimed `--8Chn*` was left undecoded too; it is not - `8Chn1`..`8Chn5` have
// been expanded to `Eight Chain 1`..`5` since the key arrived, with those names declared as gaps.)
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
export function tokenize(line: string): string[] {
  const raw = line
    .replace(/\([^)]*\)/g, '  ')           // drop parenthetical asides
    .replace(/\{[^}]*\}/g, '  ')           // drop BRACED asides (conditional notes)
    .replace(/\[[^\]]*\]/g, '  ')          // drop BRACKETED alignment markers, e.g. `[B1c]`
    .replace(/"[^"]*"/g, '  ')             // drop quoted asides
    // All8 separates calls with wide gaps, but a call marker `--` ALWAYS starts a new call, so
    // split before one even when the gap collapsed to a single space - which is what happens
    // wherever an aside was removed from between two calls (`AL --PasTh` used to arrive as ONE
    // token, and the same glue produced the bare `C-` leftover).
    .split(/\s{2,}|\s+-\s+|\s+(?=--)/)
    .map((t: string) => t.trim())
    .filter(Boolean);

  // REATTACH A DANGLING GROUP DESIGNATOR, before the punctuation strip below can destroy the
  // evidence. All8's key gives BOTH readings of `C`, and they are told apart by the dash alone:
  // `C` on its own is "Circulate", while `C-` is the "Centers -" DESIGNATOR for the call that
  // follows. Dropping a quoted aside from between the two leaves the designator stranded
  // (`C-"reverse"-WhlAr` -> `C-`, `-WhlAr`), and stripping the trailing dash at that point turns
  // it into a bare `C` that is then indistinguishable from the call. So the merge happens HERE,
  // while the dash is still present: the designator moves onto the call it actually scopes.
  // The test tolerates leading marker punctuation (`!`, `--`, spaces) because this pass runs
  // BEFORE the strip below: All8's lines begin `! C-"Sashay nose to nose"`, which arrives here as
  // the single raw token `! C-`, and a strict `/^([ABGCEH])-$/` would miss it and let the strip
  // turn it into a bare `C` after all.
  for (let i = 0; i < raw.length - 1; i++) {
    const m = /^[-\s!|]*([ABGCEH])-$/.exec(raw[i]);
    if (!m) continue;
    raw[i + 1] = `${m[1]}-${raw[i + 1].replace(/^[-\s!|]+/, '')}`;
    raw.splice(i, 1);
    i--;
  }

  // `,` = "while": All8's punctuation table gives `B-Cir, G-Trd` as "B-Cir WHILE G-Trd", so a
  // comma SEPARATES two calls rather than joining them into one. It has to be split here rather
  // than stripped, or the two calls run together into one unreadable token - which is exactly what
  // `G-UTurn,B-Trd` and `C-SwThr, E-Trd` were doing (7 tokens across the two published archives,
  // including one where All8 wrote a space AFTER the comma, so a whitespace-only split cannot see
  // the boundary). NOTE it is split on the RAW text, so a comma inside a table VALUE (the catalogue
  // has titles like "Ladies In, Men Sashay") is untouched: those are decoded names, not tokens.
  const split = raw.flatMap((t: string) => t.split(','));

  return split
    // Leading marker/joiner punctuation AND a trailing joiner dash, plus sentence punctuation.
    // `normalizeToken` is the single definition of this so the two cannot drift, which is the same
    // "one source of truth" rule the designator regex above follows.
    .map((t: string) => normalizeToken(t))
    .filter(Boolean)
    // All8's key defines the dash as a TIE-IN ("the active dancers keep working"), and `,` as
    // "while", so a leading comma on a token is punctuation rather than part of a name.
    .map((t: string) => t.replace(/^[,;]+/, '').trim())
    .filter(Boolean)
    // An aside that was dropped from the MIDDLE of a token can leave a bare joiner behind.
    .filter((t: string) => !/^-+$/.test(t));
}

/** Tokens that repeat the PREVIOUS call rather than naming one. All8's key defines `Twice` as
 * "repeat the previous call again", so it is not vocabulary and cannot live in `TOKENS`: it is
 * resolved against what has already been read in the line. `SpltC Twice RLG` is two calls
 * (Split Circulate, Split Circulate) followed by a third, and one corpus line contains two of
 * them (`SHing Twice A8Cir Twice RLG`). */
export const REPEAT_TOKENS = new Set(['Twice']);

/** The punctuation contract for a single token, factored out because three callers need it:
 * `tokenize`, `decodeTokenAll`, and `decodeStats`. Strips leading marker/joiner punctuation and a
 * trailing joiner dash / sentence punctuation.
 *
 * `/` is in the leading set because it is an UNMODELLED DESIGNATOR rather than a call. Measured
 * across both published archives it occurs exactly TWICE, both times as the same `/-SqTh4` cell,
 * and `/` appears in NO designator list in All8's key - so its scoping cannot be learned from any
 * other context. Dropping it reads the cell's call (`SqTh4` -> `Square Thru 4`) while losing the
 * scoping, which is the same trade `-BRun` already makes for All8's active-dancer designators and
 * is recorded here rather than hidden. Leaving `/` in would keep three figure cells unreadable on
 * the strength of one character that no part of All8's documentation defines. */
export function normalizeToken(token: string): string {
  return token.replace(/^[-\s!|/]+/, '').replace(/[-\s!|,.;:]+$/, '').trim();
}

/** Decode a token to a call name, or null when we cannot read it. A group prefix is
 * decoded but flagged `scoped`, because the composed name ("Boys Run") is a reading
 * of All8's shorthand rather than a name All8 prints.
 *
 * The trailing-dash strip is repeated here because this function is also called directly
 * (not only through `tokenize`) with tokens taken from a line, and a joiner dash must not be
 * the difference between reading a token and not. */
export function decodeTokenAll(token: string): { name: string; scoped: boolean }[] | null {
  const t = normalizeToken(token);
  if (!t) return null;
  // The designator letters are read FROM `GROUP` rather than hardcoded here. They were hardcoded,
  // so adding `O` to GROUP above had no effect at all: `O-SqTh3` stayed unread and the table looked
  // wrong when it was the regex that was stale. One source of truth, so the two cannot disagree.
  const g = new RegExp(`^([${Object.keys(GROUP).join('')}])-(.+)$`).exec(t);
  if (g) {
    const base = TOKENS[g[2]];
    return base ? [{ name: `${GROUP[g[1]]} ${base}`, scoped: true }] : null;
  }
  const multi = MULTI_TOKENS[t];
  if (multi) return multi.map((name: string) => ({ name, scoped: false }));
  const base = TOKENS[t];
  return base ? [{ name: base, scoped: false }] : null;
}

export function decodeToken(token: string): { name: string; scoped: boolean } | null {
  const all = decodeTokenAll(token);
  return all ? all[0] : null;
}

/** Decode a whole published line. `undecoded` names the first token we could not
 * read, so a partial reading is never mistaken for a complete one. */
export function decodeLine(line: string): { calls: { name: string; scoped: boolean }[]; undecoded?: string } {
  const tokens = tokenize(line);
  // Cells carry a names ARRAY because one token can be several calls (`TagI`, a comma join) and
  // because the cross-token modifiers below rewrite a neighbour rather than naming a call.
  const cells: { token: string; names: string[]; scoped: boolean[] }[] = [];
  const flatten = (cs: typeof cells) => cs.flatMap((c) => c.names.map((name, i) => ({ name, scoped: c.scoped[i] })));
  for (const tk of tokens) {
    // `Twice` repeats what has already been read, so it is resolved HERE rather than in the token
    // table - and with nothing behind it there is nothing to repeat, which is a genuine unreadable
    // token rather than a silent no-op.
    if (REPEAT_TOKENS.has(normalizeToken(tk))) {
      if (cells.length === 0) return { calls: flatten(cells), undecoded: tk };
      const prev = cells[cells.length - 1];
      cells.push({ token: tk, names: [...prev.names], scoped: [...prev.scoped] });
      continue;
    }
    // A cross-token modifier (`1-1/2`, `1/2of`) names no call of its own. It is admitted as an
    // empty cell and applied by `composeModifiers` below; a modifier with nothing to modify keeps
    // its empty names and is reported as unreadable.
    if (isModifierToken(tk)) {
      cells.push({ token: tk, names: [], scoped: [] });
      continue;
    }
    const all = decodeTokenAll(tk);
    if (all === null) return { calls: flatten(cells), undecoded: tk };
    cells.push({ token: tk, names: all.map((d) => d.name), scoped: all.map((d) => d.scoped) });
  }
  const composed = composeModifiers(cells);
  // A modifier the fold could not apply (its neighbour is missing or unreadable) is a token we
  // cannot read. `calls` is truncated to what came BEFORE it, so a partial reading is never handed
  // back as a complete one - the same contract the early returns above keep.
  const stuckAt = composed.findIndex((c) => c.names.length === 0);
  if (stuckAt >= 0) return { calls: flatten(composed.slice(0, stuckAt)), undecoded: composed[stuckAt].token };
  return { calls: flatten(composed) };
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
/**
 * Whether the token at `i` is READABLE in the context of its line.
 *
 * This is the same rule `decodeLine` applies, and it must be the same rule: `decodeStats` COUNTING a
 * line as decoded while `decodeLine` refuses it (or the reverse) is how one ranking starts
 * disagreeing with the other. A repeat needs something behind it; a cross-token modifier needs the
 * neighbour it modifies; everything else is readable iff the table knows it.
 */
function tokenReadable(tokens: string[], i: number): boolean {
  const t = normalizeToken(tokens[i]);
  if (REPEAT_TOKENS.has(t)) return i > 0;
  if (SUFFIX_TOKENS[t]) return i > 0;
  if (prefixModifier(tokens[i])) return i + 1 < tokens.length && decodeToken(tokens[i + 1]) !== null;
  return decodeToken(tokens[i]) !== null;
}

export function decodeStats(lines: string[]) {
  const firstFail = new Map();
  const allOcc = new Map();
  let decoded = 0;
  let undecoded = 0;
  for (const line of lines) {
    const tokens = tokenize(line);
    let failed = false;
    tokens.forEach((tk, i) => {
      if (tokenReadable(tokens, i)) return;
      allOcc.set(tk, (allOcc.get(tk) ?? 0) + 1);
      if (!failed) { firstFail.set(tk, (firstFail.get(tk) ?? 0) + 1); failed = true; }
    });
    if (failed) undecoded++; else decoded++;
  }
  return { total: lines.length, decoded, undecoded, firstFail, allOcc };
}

/** `token(count) token(count) …`, most frequent first, ties broken by token so a report is
 * stable between runs. */
export function formatRanking(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t, n]) => `${t}(${n})`)
    .join(' ');
}

