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

// Prefixes A-/B-/G-/C-/E- are All/Boys/Girls/Centers/Ends, which is how All8 writes
// group-scoped calls (e.g. B-Run = Boys Run).
export const GROUP = { A: 'All', B: 'Boys', G: 'Girls', C: 'Centers', E: 'Ends' };

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
};
// N-hand counts: All8's digit counts HANDS (e.g. --SqTh1 = Square Thru with one
// hand), which is not the standard call suffix, so only the counts that ARE real
// call names (2, 3, 4) are expanded. `--SqTh1`/`--SqTh5`/`--8Chn*` are therefore left
// undecoded rather than expanded into names the catalogue cannot have.
for (let n = 2; n <= 4; n++) TOKENS[`SqTh${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`SqT@${n}`] = `Square Thru ${n}`;
for (let n = 3; n <= 4; n++) TOKENS[`LSqT${n}`] = `Left Square Thru ${n}`;

/** Split a published line into its tokens. All8 separates calls with wide gaps, but
 * an aside can collapse that to a single space (`--CtrIn  B-Fold "behind your girl"
 * --Prom`), so asides are removed first. */
export function tokenize(line) {
  return line
    .replace(/\([^)]*\)/g, '  ')           // drop parenthetical asides
    .replace(/"[^"]*"/g, '  ')             // drop quoted asides
    .split(/\s{2,}|\s+-\s+/)               // All8 separates calls with wide gaps
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/^[-\s!|]+/, '').replace(/[,.;:]+$/, '').trim())
    .filter(Boolean);
}

/** Decode a token to a call name, or null when we cannot read it. A group prefix is
 * decoded but flagged `scoped`, because the composed name ("Boys Run") is a reading
 * of All8's shorthand rather than a name All8 prints. */
export function decodeToken(token) {
  const t = token.replace(/^[-\s!|]+/, '').trim();
  const g = /^([ABGCE])-(.+)$/.exec(t);
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
