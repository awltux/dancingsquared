// THE PHONE LAYOUT, AS A RULE A PROBE CAN DRIVE.
//
// REPORTED: "I think its also time to star thinking about multi-platform. Especially mobile." MEASURED on the markup as
// it stood: the panel is a 340 px column pinned to the left edge of the canvas with `position: absolute`, the two board
// captions are placed at 25 % and 75 % of `calc(100% - 340px)`, and `main.ts` told the stage to inset itself by
// `rect.right + 8` — an answer that can only describe a LEFT panel. At 393 x 852 that column is 87 % of the viewport
// width, and the boards get 53 px each. So the layout is not merely cramped on a phone; two of its three numbers cannot
// express the phone shape at all.
//
// WHAT THIS PINS, and each check is a claim about `ui/layout.ts` (or, in sections 5b and 6, about the stylesheet that
// mirrors it) rather than about a screenshot:
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
//   5b. THE PAGING ZONES. Invisible quarters of the canvas edges, with the middle half inert, and the keyboard reaching
//      them through a focus outline. It reads declarations because the geometry is CSS; a browser is what would prove
//      the box, and this probe records that it did not.
//   6. THE FULL-SCREEN PAGE. A page with no dance board keeps the HUD in the panel's left column and gives the board's
//      area to the two standings (`pages.ts`'s `showsStandings`, keyed on `data-panel` + `data-stage`); a sheet keeps the
//      centred page and draws no standings. This section reads the stylesheet and the markup, because the failure it
//      guards is a layout one — the page centred with the right-hand area empty.
//
// THE NEGATIVE CONTROLS are the plausible wrong rules, measured: a breakpoint keyed on 600 (the type-scale number) fails
// the 899 check; a sheet height of a flat half fails the 392 check; a sheet with no clamp fails both the floor and the
// ceiling; a `display:block` base on the standings would draw them on a phone. Each comment says which check catches it
// and why the others do not.
//
// Usage: node game/test/layout-probe.mjs   (reads the stylesheet and the model; no engine build, no DOM)
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
const HTML = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(GAME, 'src', 'main.ts'), 'utf8');

/** The stylesheet without its comments, and the declarations of one exact selector — a rule, not a mention of one. */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const escapeSelector = (selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruleOf = (selector) => {
  // THE ANCHOR MATTERS: `#sideBoard {` also appears inside `html[data-panel="left"]… #sideBoard {`, so an unanchored
  // search would report the full-screen rule as the base one (or the reverse). A selector starts a rule only after `}` or
  // at the top of the sheet.
  const match = new RegExp(`(?:^|\\})\\s*${escapeSelector(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return match ? match[1] : '';
};

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

console.log('\n== 5b. the paging controls are invisible quarters of the canvas edges ==');
{
  // REPORTED: "make the waypoint navigation buttons invisible and take up quarter of the canvas edges. So tapping the left
  // side of the canvea scrubs left and the right side of the canvas scrubs right. This will give more canval area for the
  // board to use and make it easier to interpret the board", then "this removes the need for the extra margin you just
  // added." So the rule is a QUARTER of the canvas per zone with nothing visible in it, and the old gutter is gone: a
  // board may be drawn under a zone, because a zone is clear and a board's own middle half is still inert.
  //
  // THIS SECTION CANNOT LOAD THE RULE, so it reads the stylesheet and the shell — and it says which half is which. The
  // geometry is CSS (`position: absolute` inside `#app`, whose `#stage` canvas is `inset: 0`), so the check is on the
  // declarations, not on a computed box: a probe that could not open a browser would otherwise pin nothing.
  const nav = ruleOf('.wp-nav');
  check(/width:\s*25%/.test(nav), `each zone is a quarter of the canvas wide (${nav.replace(/\s+/g, ' ').trim()})`, nav);
  // NEGATIVE CONTROL: a gutter'd arrow is what this replaced. A width in pixels, or a height clamp, fails this one check
  // and no other — the two `left`/`right` checks below would still pass for an arrow 64 px wide.
  check(!/--arrow-width/.test(nav) && !/width:\s*\d+px/.test(nav) && !/clamp\(/.test(nav),
    'and its size is a fraction, not the arrow width or height the gutter needed', nav);
  check(/top:\s*0/.test(nav) && /bottom:\s*0/.test(nav), 'the zone spans the canvas from top to bottom');
  check(/color:\s*transparent/.test(nav) && /background:\s*none/.test(nav) && /border:\s*0/.test(nav),
    'with no glyph and no fill drawn — it is a tap target, not a control', nav);
  // A KEYBOARD VISITOR MUST STILL SEE WHERE IT IS: an invisible control a keyboard can reach and nobody can see is the
  // failure the zone would otherwise introduce. All three signals are required, because each one alone is one cue — the
  // glyph appears, the zone fills, and an outline insets its edge by enough to clear the arrow's own body.
  const focused = ruleOf('.wp-nav:focus-visible');
  check(/color:\s*var\(--accent\)/.test(focused) && /background:\s*var\(--accent-ghost\)/.test(focused)
    && /outline:\s*3px solid var\(--accent\)/.test(focused),
    'and keyboard focus is the one state that draws: glyph, ghost fill and outline', focused);
  // THE LEFT ZONE STEPS OVER THE PANEL AND THE RIGHT ONE DOES NOT: on a wide layout the panel is a column over the canvas's
  // left edge, so a zone at `left: 0` would be under it. On a sheet the panel is at the bottom and the zone starts at 0.
  check(/left:\s*var\(--panel-size\)/.test(ruleOf('.wp-prev')), 'the left zone starts at the panel column\'s edge', ruleOf('.wp-prev'));
  check(/right:\s*0/.test(ruleOf('.wp-next')), 'and the right zone at the canvas\'s own right edge', ruleOf('.wp-next'));
  check(/\.wp-prev \{\s*left: 0/.test(css), 'while a sheet puts it at the canvas\'s own left edge');
  // THE OLD GUTTER MUST NOT SURVIVE IN THE SHELL: `ui/layout.ts` has no arrow fields any more, and `main.ts` publishes no
  // arrow width or board frame to CSS. A leftover write would be a second definition of a number nothing reads.
  check(!/--arrow-width|--board-top|--board-bottom/.test(MAIN), 'and nothing publishes an arrow width or a board frame');
  // THE MIDDLE HALF IS INERT: two 25 % zones leave the centre free, so tapping a dancer cannot scrub the route. This is
  // arithmetic on the check above, stated so that widening a zone to 50 % reads as the deliberate change it is.
  check(2 * 25 < 100, 'which leaves the middle half of the canvas inert');
}

console.log('\n== 5c. the canvas overlay is ONE layer, and the panel outranks it ==');
{
  // REPORTED: "currently the canvas seems to take up the whole screen, but all the other html elements are applied at the
  // same level and I assume floated into place. Could the html elements be put in a hud div that manages the html elements
  // that are over the canvas?", then "Can the main panel also be inside the div hud?" — with the defect that made it
  // urgent: "buttons and sliders in the hud are not clickable because the waypoint navigation is overlaid on top of them."
  // The overlays and the panel were siblings of each other and of the canvas, so a tap went to whichever carried the
  // larger `z-index`: the zone carried 2, the panel carried none, and the outer quarter of every answer button was dead.
  // The rule is one box, two numbers and four opt-ins, and this is the section that pins them.
  const hud = ruleOf('#hud');
  check(/position:\s*absolute/.test(hud) && /inset:\s*0/.test(hud),
    `the overlay is one box over the canvas (${hud.replace(/\s+/g, ' ').trim()})`, hud);
  // THE DEFAULT IS INERT: whatever a HUD child is, it takes no pointer event until it asks.
  check(/pointer-events:\s*none/.test(hud), 'and it is inert by default', hud);
  const hudZ = /z-index:\s*(-?\d+)/.exec(hud);
  const panelZ = /z-index:\s*(-?\d+)/.exec(ruleOf('#panel'));
  check(hudZ !== null && panelZ !== null && Number(panelZ[1]) > Number(hudZ[1]),
    `while the panel outranks it (panel ${panelZ && panelZ[1]}, HUD ${hudZ && hudZ[1]}) — a bigger z-index inside the HUD cannot reach the panel`);
  // THE CONTROLS OPT BACK IN, and both are needed: a zone that inherited the inertness would be an invisible button that
  // cannot be pressed, and a switcher that did would be drawn but not pressable. This is the other negative control — the
  // panel's number above would be unchanged by either omission.
  check(/pointer-events:\s*auto/.test(ruleOf('.wp-nav')), 'the paging zone opts back into pointer events');
  check(/pointer-events:\s*auto/.test(ruleOf('#boardTabs')), 'and so does the board switcher');
  // THE TWO INTERACTIVE SURFACES OPT BACK IN TOO, since "Can the main panel also be inside the div hud?" put them inside
  // the inert box: without this the whole panel would be a picture. Nothing above catches it — the z-index ordering is
  // satisfied by a panel that cannot be clicked.
  check(/pointer-events:\s*auto/.test(ruleOf('#panel')), 'the panel opts back into pointer events');
  check(/pointer-events:\s*auto/.test(ruleOf('#sideBoard')), 'and so do the standings');
  // THE MARKUP IS THE HALF CSS CANNOT CHECK: the box has to be in the document, hold the five overlays AND the panel AND the
  // standings, and NOT hold the canvas or the loading line — a HUD that swallowed the canvas would be a transparent wall
  // over the whole screen.
  const hudAt = HTML.indexOf('<div id="hud">');
  check(hudAt !== -1 && hudAt > HTML.indexOf('id="stage"'), 'the HUD box is in the markup, after the canvas');
  // THE BOX'S EDGE IS COUNTED, not guessed: a plain `indexOf('</div>')` after `#hud` would end it at the first nested close
  // and report the panel as outside the box, which is a silent false pass for the two `inside` checks below.
  const hudEnd = (() => {
    let depth = 0;
    const re = /<div\b|<\/div>/g;
    re.lastIndex = hudAt;
    for (let m = re.exec(HTML); m !== null; m = re.exec(HTML)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) return m.index;
    }
    return -1;
  })();
  const inHud = (id) => {
    const at = HTML.indexOf(`id="${id}"`);
    return at > hudAt && hudEnd !== -1 && at < hudEnd;
  };
  const chrome = ['labelHere', 'labelGoal', 'waypointPrev', 'waypointNext', 'boardTabs'];
  const inside = [...chrome, 'panel', 'sideBoard'].filter(inHud);
  check(inside.length === chrome.length + 2,
    `and it holds the five canvas overlays, the panel and the standings (${inside.join(', ') || 'none'})`);
  check(!inHud('stage') && !inHud('loading'), 'while the canvas and the loading line stay outside it');
  // AND THE STANDINGS, the page-level layer that replaces the board area, outrank the HUD for the same reason the panel
  // does: a paging zone over a board that is not on screen is a control for something invisible.
  const sideZ = /z-index:\s*(-?\d+)/.exec(ruleOf('#sideBoard'));
  check(sideZ !== null && hudZ !== null && Number(sideZ[1]) > Number(hudZ[1]), 'and the standings outrank it too');
}

console.log('\n== 6. a full-screen page keeps the HUD left and gives the board area to the standings ==');
{
  // REPORTED: "When in full screen mode, keep the hud in the left hand side of the screen, the same as the Drill
  // screen. When the Dance board is not being used, the area should be replaced by the leader boards." The rule is
  // `ui/pages.ts`'s `showsStandings` (pinned by `pages-probe.mjs`); this is the stylesheet half, keyed on the same two
  // flags the shell writes — `data-panel` (layout.ts's panelSide) and `data-stage` (pageShowsBoard).
  const fullPage = 'html[data-panel="left"][data-stage="page"]';
  const panel = ruleOf(`${fullPage} #panel`);
  check(/left:\s*0/.test(panel) && /width:\s*var\(--panel-size\)/.test(panel) && /transform:\s*none/.test(panel),
    `in full screen the page's panel is the play pages' left column (${panel.replace(/\s+/g, ' ').trim()})`, panel);
  // NEGATIVE CONTROL: the centred page is what this replaces and it is still the SHEET's answer. Both rules exist, and the
  // layout flag is what tells them apart — a page centred on a full screen would leave the dance board's area empty, which
  // is the defect the report names.
  const centred = ruleOf('html[data-stage="page"] #panel');
  check(/left:\s*50%/.test(centred) && /translateX\(-50%\)/.test(centred),
    'while a sheet keeps the centred page it had (the layout flag chooses between them)');

  const dock = ruleOf(`${fullPage} #sideBoard`);
  check(/display:\s*block/.test(dock) && /left:\s*var\(--panel-size\)/.test(dock) && /right:\s*0/.test(dock),
    `and the dance board's area is the standings, from the panel's edge to the window's (${dock.replace(/\s+/g, ' ').trim()})`, dock);
  // NO STANDINGS ANYWHERE ELSE: a sheet has no area beside the panel, and a play page's board is the question. The base
  // rule is what says so — the negative control for a `display:block` that would draw them on every screen.
  check(/display:\s*none/.test(ruleOf('#sideBoard')), 'with no standings drawn on a sheet or a play page (the base rule hides them)');

  // THE BOARD PAGE'S OWN READ IS NOT DRAWN TWICE: its list, caption, status and mode switch go in that state, leaving the
  // page's heading and reload — the reload re-reads both standings.
  const hideAt = css.indexOf(`${fullPage} #boardMode`);
  const hideBlock = hideAt === -1 ? '' : css.slice(hideAt, css.indexOf('}', hideAt) + 1);
  const hidden = ['#boardMode', '#boardCaption', '#boardStatus', '#boardList']
    .filter((id) => hideBlock.includes(`${fullPage} ${id}`));
  check(hidden.length === 4 && /display:\s*none/.test(hideBlock),
    `and the board page's in-panel list and switch are hidden there (${hidden.join(', ') || 'none'})`, hideBlock);

  // IT ADDS NO BREAKPOINT: the full-screen half reads the shell's own two facts, so it must not spell a width again. A
  // `min-width` media query here would be the second definition `layout.ts` exists to prevent.
  check(!/@media\s*\(\s*min-width/.test(css), 'the full-screen layout is keyed on data-panel, not a second width query');

  // THE MARKUP AND THE SHELL: the area exists outside the panel, holds BOTH boards, and the shell fills it through the
  // one rule. These are the wiring checks a CSS-only reading cannot make.
  const asideAt = HTML.indexOf('id="sideBoard"');
  check(asideAt > HTML.indexOf('</main>'), 'the standings are a sibling of the panel, not part of the page content');
  check(HTML.slice(asideAt).includes('id="sideDrillList"') && HTML.slice(asideAt).includes('id="sideDailyList"'),
    'and carry both boards — the Drill and the Daily — rather than one chosen by a switch');
  check(MAIN.includes('showsStandings(page, layout.panelSide)') && MAIN.includes('loadDockBoards'),
    'the shell reads the same rule and has a loader for both standings');
  check(MAIN.includes('refreshBoards();'), 'and refreshes them when the page or the layout changes');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
