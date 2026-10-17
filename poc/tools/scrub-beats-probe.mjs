// THE CALL EDITOR'S SCRUB: the call's own beats, with the dead intro and outro taken off.
//
// Reported: "Currently, the call edit scrub progress bar has a 2 second intro and outro that dont actually
// exist in the call Moves. Can these fictitious dead beats be removed."
//
// THEY ARE REAL AND THEY ARE IN THE DATA, and that is the first thing to be exact about. A `<tam>` declares a
// `leadin` and a `leadout` - two beats each across the whole corpus - and the engine carries them on the
// bundle as `leadin`, `beats` and `leadout`, with `totalBeats = leadin + beats + leadout`. THE MOVES DO NOT
// USE THEM: `moveBeatRange(dancer, k)` measures from ZERO on the call's own clock, so the first move starts at
// beat 0 and the last one ends at `beats`, whatever the lead-in says. A bar drawn over `totalBeats` therefore
// spends its first `leadin` beats and its last `leadout` beats on time in which nothing happens.
//
// The player has both clocks: `player.ts` keeps `beat` starting at `-leadin`, and `seekAbsolute` takes a beat
// where 0 is the start of the lead-in. So the panel's playhead has to be in the call's own beats and `+ leadin`
// is applied at the two places the stage is told where to stand - which is what section 2 pins.
//
// Run: node tools/scrub-beats-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, '../assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const LEVELS = fs.readdirSync(path.join(POC_DIR, '../assets')).filter((d) => !d.includes('.') && d !== 'src');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ---------------------------------------------------------------- 1. the two clocks, measured
console.log("== 1. the moves run on the call's own clock, and the lead-in and lead-out are outside them ==");
{
  let calls = 0;
  let withDead = 0;
  let badTotal = 0;
  let badStart = 0;
  let badEnd = 0;
  let deadBeats = 0;
  let worstStart = 0;
  let worstEnd = 0;
  let worstAt = '';
  let callsThatReachTheEnd = 0;
  for (const level of LEVELS) for (const f of fs.readdirSync(path.join(POC_DIR, '../assets', level)).filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(POC_DIR, '../assets', level, f), 'utf8'), movesXml, formationsXml, 0));
    } catch { continue; }
    calls++;
    if (call.leadin || call.leadout) { withDead++; deadBeats += call.leadin + call.leadout; }
    if (call.totalBeats !== call.leadin + call.beats + call.leadout) badTotal++;
    // EVERY dancer's moves run from 0, and none of them goes past `beats`. `beats` is the LONGEST dancer's own
    // total (`instanceBeats` takes the max), so a shorter dancer simply stops when it is done - the bar's end is
    // where the CALL ends, and at least one dancer has to reach it or the call is longer than its own moves.
    let reaches = false;
    for (const d of call.dancers) {
      if (d.path.length === 0) continue;
      const first = engine.moveBeatRange(d, 0).from;
      const last = engine.moveBeatRange(d, d.path.length - 1).to;
      if (Math.abs(first) > 1e-12) badStart++;
      if (last > call.beats + 1e-9) { badEnd++; if (last - call.beats > worstEnd) { worstEnd = last - call.beats; worstAt = `${level}/${f}`; } }
      if (Math.abs(last - call.beats) <= 1e-9) reaches = true;
      worstStart = Math.max(worstStart, Math.abs(first));
    }
    if (reaches) callsThatReachTheEnd++;
  }
  console.log(`    ${calls} calls loaded; ${withDead} of them declare a lead-in or a lead-out, ${deadBeats} dead beats between them`);
  check(calls > 400, `the sweep is not trivial (${calls} calls)`);
  check(badTotal === 0, `totalBeats is exactly leadin + beats + leadout on every one (${badTotal} exceptions)`);
  check(withDead > calls * 0.9 && deadBeats > 0,
    `and the lead-in and lead-out are REAL and non-zero, so a bar over totalBeats really does show dead time (${withDead} of ${calls} calls)`);
  check(badStart === 0 && worstStart < 1e-12,
    `THE MOVES START AT 0 ON THE CALL'S OWN CLOCK, never at the lead-in (worst ${worstStart.toExponential(2)})`);
  check(badEnd === 0,
    `and no dancer's moves run PAST \`beats\`, which is where the call stops and the lead-out begins (worst overshoot ${worstEnd.toExponential(2)} at ${worstAt})`);
  check(callsThatReachTheEnd === calls,
    `and every call has a dancer whose last move ENDS at \`beats\`, so the bar's end is the end of the call (${callsThatReachTheEnd} of ${calls})`);
}

// ---------------------------------------------------------------- 2. the panel, read from the source
console.log("\n== 2. the editor's bar spans the call, and the stage is told in timeline beats ==");
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const browser = fs.readFileSync(path.join(POC_DIR, 'src', 'browser.ts'), 'utf8');
  const scrub = ui.slice(ui.indexOf('private renderScrub(call: CallBundle | null) {'));

  check(/const total = call\.beats \|\| 1;/.test(ui) && /this\.scrubEl\.max = String\(total\);/.test(ui),
    "the bar's maximum is the CALL's own `beats`, not `totalBeats`");
  check(!/private renderScrub[\s\S]{0,900}?call\.totalBeats/.test(ui),
    'and nothing in the bar reaches for the timeline total, which is what the dead beats came from');
  check(/beat \$\{b\.toFixed\(2\)\} \/ \$\{total\.toFixed\(2\)\}/.test(ui),
    'the readout is in the same units, so "beat 0.00" is the first move and not two beats of nothing');
  check(/const b = Math\.max\(0, Math\.min\(total, this\.editBeat\)\);/.test(ui),
    'and the value is clamped to that span rather than to the timeline');

  // THE OTHER CLOCK. The panel's playhead is in call beats, and the stage is told in timeline beats.
  check(/private absoluteEditBeat\(call: CallBundle \| null\): number \{\s*\n\s*return this\.editBeat \+ \(call\?\.leadin \?\? 0\);/.test(ui),
    'the conversion to the timeline lives in ONE place, `absoluteEditBeat`');
  check(/this\.showAt\(call, this\.editBeat \+ call\.leadin\);/.test(ui),
    'a re-show places the playhead at the call beat plus the lead-in');
  check((ui.match(/this\.host\.setPlayhead\(this\.absoluteEditBeat\(this\.instance\)\);/g) ?? []).length === 2,
    'and both playhead moves - the parked one after an edit, and the manual scrub - go through it');
  check(/beatReadoutEl\.textContent/.test(scrub) && !/callBeat = b - call\.leadin/.test(ui),
    'the part index is read straight off the call beat now, because that subtraction is no longer needed');

  // THE BROWSE VIEW IS DELIBERATELY LEFT ALONE: it shows the whole timeline the player runs, which is a
  // different question from the one that was asked about the editor's bar.
  check(/this\.scrub\.max = String\(call\.totalBeats \|\| 1\);/.test(browser),
    'and the BROWSE scrub still spans the whole timeline, which was not what was asked about');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
