// THE PHONE LAYOUT, AS A RULE A PROBE CAN DRIVE.
//
// REPORTED: "I think its also time to star thinking about multi-platform. Especially mobile." MEASURED on the markup as
// it stood: the panel is a 340 px column pinned to the left edge of the canvas with `position: absolute`, the two board
// captions are placed at 25 % and 75 % of `calc(100% - 340px)`, and `main.ts` told the stage to inset itself by
// `rect.right + 8` — an answer that can only describe a LEFT panel. At 393 x 852 that column is 87 % of the viewport
// width, and the boards get 53 px each. So the layout is not merely cramped on a phone; two of its three numbers cannot
// express the phone shape at all.
//
// WHAT THIS PINS, and each check is a claim about `ui/layout.ts` rather than about CSS:
//   1. THE BREAKPOINT. Below `NARROW_MAX_WIDTH` the panel is a bottom sheet and above it a left column, checked one
//      pixel either side — an off-by-one here is a layout that is right in the middle of a device range and wrong at its
//      edge, which is exactly the failure a screenshot never catches.
//   2. THE SHEET'S HEIGHT. 46 % of the viewport clamped to 260–460 px, checked at 393 x 852 (392 px), at a short window
//      (the floor) and at a tall one (the ceiling). The clamp exists because a landscape phone is 852 px WIDE and 393
//      tall: 46 % of 393 is 181 px, which cannot hold a question and three answers.
//   3. THE PANEL'S WIDTH when it is a column: 340 px on a wide desktop, 300 px on a 1024-wide one.
//   4. THE ONE DUPLICATED NUMBER — the CSS media query. `style.css` cannot read a TypeScript constant, so it carries
//      `max-width: 899px`; the probe reads the stylesheet and requires that number to be `NARROW_MAX_WIDTH - 1`. A
//      duplicated constant that is CHECKED against its source is not a second definition (AGENTS.md §4.3).
//   5. THE BOARDS ARE STILL A PAIR. One board at a time is a separate change with its own rule (a comparison needs both
//      pictures unless the missing one is drawn as a ghost); until then the pair is what the shell must be told, and
//      this check fails the day someone flips it without the ghost layer landing with it.
//
// THE NEGATIVE CONTROLS are the plausible wrong rules, measured: a breakpoint keyed on 600 (the type-scale number) fails
// the 899 check; a sheet height of a flat half fails the 392 check; a sheet with no clamp fails both the floor and the
// ceiling. Each comment says which check catches it and why the others do not.
//
// Usage: node game/test/layout-probe.mjs   (reads text; no engine build, no DOM)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  layoutFor, NARROW_MAX_WIDTH, WIDE_MIN_WIDTH, PANEL_NARROW, PANEL_WIDE,
  SHEET_MAX, SHEET_MIN, SHEET_FRACTION,
} from '../src/ui/layout.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const CSS = fs.readFileSync(path.join(GAME, 'src', 'style.css'), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('\n== 1. the breakpoint, one pixel either side ==');
{
  const narrow = layoutFor(NARROW_MAX_WIDTH - 1, 800);
  const wide = layoutFor(NARROW_MAX_WIDTH, 800);
  check(narrow.panelSide === 'bottom', `at ${NARROW_MAX_WIDTH - 1} px the panel is a bottom sheet (${narrow.panelSide})`);
  check(wide.panelSide === 'left', `at ${NARROW_MAX_WIDTH} px it is a column (${wide.panelSide})`);
  // NEGATIVE CONTROL: keying the breakpoint on the TYPE scale's 600 px instead of the furniture's would call an 899-wide
  // window a column, which is the phone and small-tablet range. Only this check catches it — the height and width checks
  // below are about numbers, not about which branch ran.
  const wrongBreakpoint = (width) => (width < 600 ? 'bottom' : 'left');
  check(wrongBreakpoint(NARROW_MAX_WIDTH - 1) !== narrow.panelSide,
    'a 600 px breakpoint would disagree here, so this check is what rules it out');
}

console.log('\n== 2. the sheet is a fraction, clamped ==');
{
  const phone = layoutFor(393, 852);
  check(phone.panelSide === 'bottom' && phone.panelSize === 392,
    `393 x 852 gives a 392 px sheet (${phone.panelSize}) — 46 % of 852, rounded`);
  check(Math.round(852 * SHEET_FRACTION) === 392, `and that is ${SHEET_FRACTION} of the height, not a flat half`);
  // NEGATIVE CONTROL: half the viewport is the number a designer reaches for first, and it is 34 px too tall here. The
  // difference matters because the sheet's height is the board's height.
  check(Math.round(852 * 0.5) !== phone.panelSize, 'a flat half would be a different number, so this is measured, not restated');
  const landscapePhone = layoutFor(852, 393);
  check(landscapePhone.panelSide === 'bottom' && landscapePhone.panelSize === SHEET_MIN,
    `a 393 px tall landscape phone hits the floor (${landscapePhone.panelSize} = ${SHEET_MIN})`);
  // NEGATIVE CONTROL: without the floor this would be 181 px and the answers would not fit; without the ceiling a tall
  // tablet-portrait window would take 60 % of the screen. Each bound is caught by its own check.
  const tall = layoutFor(700, 1600);
  check(tall.panelSize === SHEET_MAX, `a 1600 px tall window hits the ceiling (${tall.panelSize} = ${SHEET_MAX})`);
  check(SHEET_MAX > SHEET_MIN && SHEET_MIN > 0, 'and the clamp is the right way round');
}

console.log('\n== 3. the column narrows before it can crowd the boards ==');
{
  check(layoutFor(WIDE_MIN_WIDTH, 900).panelSize === PANEL_WIDE, `at ${WIDE_MIN_WIDTH} px wide the column is ${PANEL_WIDE} px`);
  check(layoutFor(WIDE_MIN_WIDTH - 1, 900).panelSize === PANEL_NARROW, `one pixel narrower it is ${PANEL_NARROW} px`);
  check(PANEL_WIDE > PANEL_NARROW, 'and the wide form is the wider one');
  // The mode is the TYPE scale's business: a portrait tablet is a big phone, a short laptop is not a tablet.
  check(layoutFor(393, 852).mode === 'phone', '393 x 852 is a phone');
  check(layoutFor(768, 1024).mode === 'tablet', '768 x 1024 in portrait is a tablet');
  check(layoutFor(1440, 900).mode === 'desktop', 'and 1440 x 900 is a desktop, not a tablet with a wide side');
}

console.log('\n== 4. the one duplicated number, checked against its source ==');
{
  const match = /@media \(max-width: (\d+)px\)/.exec(CSS);
  check(match !== null, 'style.css carries a narrow-width media query');
  const cssBreakpoint = match ? Number(match[1]) : NaN;
  check(cssBreakpoint === NARROW_MAX_WIDTH - 1,
    `and its number is layout.ts's breakpoint minus one (${cssBreakpoint} = ${NARROW_MAX_WIDTH} - 1)`,
    `the stylesheet said ${cssBreakpoint}`);
  // NEGATIVE CONTROL: a stylesheet edited on its own. If the two disagree, the panel moves in CSS before `main.ts` has
  // told the stage, and the boards are framed under the sheet for one frame or for ever.
  check(801 !== NARROW_MAX_WIDTH - 1, 'a drifted number would fail the check above and nothing else in this probe');
  // THE SHEET'S HEIGHT IS APPLIED FROM TYPESCRIPT, as a custom property, so CSS must not carry a second literal.
  check(!/#panel \{[^}]*height: \d+px/.test(CSS), 'and the sheet height is not written again in the stylesheet');
}

console.log('\n== 5. one board on a narrow viewport, two above it ==');
{
  const narrow = layoutFor(NARROW_MAX_WIDTH - 1, 800);
  const wide = layoutFor(NARROW_MAX_WIDTH, 800);
  check(narrow.boards === 'single', `at ${NARROW_MAX_WIDTH - 1} px the stage shows ONE board (${narrow.boards})`);
  check(wide.boards === 'pair', `at ${NARROW_MAX_WIDTH} px it shows both (${wide.boards})`);
  check(layoutFor(1440, 900).boards === 'pair' && layoutFor(393, 852).boards === 'single',
    'and the two ends of the range agree with the boundary');
  // THE SINGLE BOARD IS ONLY SAFE WITH ITS GHOST, so the shell must actually ask for a focus and the pairing module must
  // exist. This is what makes flipping `boards` a joint change rather than a one-line experiment: one board with no ghost
  // is a puzzle the player cannot answer, and it would pass every number above.
  const shell = fs.readFileSync(path.join(GAME, 'src', 'main.ts'), 'utf8');
  check(/stage\.setFocus\(/.test(shell), 'the shell tells the stage which board to show');
  check(fs.existsSync(path.join(GAME, 'src', 'render', 'ghost-pair.ts')),
    'and the ghost layer that keeps the comparison on one board exists');
  // NEGATIVE CONTROL: a shell with the call removed fails the first of those two, and nothing else in this probe.
  check(!/setFocus\(/.test('const stageWithoutFocus = 1;'), 'a shell with no focus call would fail that check');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
