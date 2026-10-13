// Probe: THE PANEL'S TEXT SIZE AND ITS RESIZE HANDLE.
//
// Asked for as: "Add a button at the top of the HUD to increase text size for the sight-impaired. This will
// likely require a larger HUD, so add a resize grab handle to the hud area."
//
// THE RULES ARE IMPORTED, THE WIRING IS READ. `poc/src/hud-size.ts` is pure and DOM-free, so the ladder, the
// clamps and the stored-value parser are called here with the real inputs; the button, the drag and the
// stylesheet's multiplier are wiring, and a probe can only read their source.
//
// WHY THE CLAMPS ARE THE INTERESTING PART. The panel is `position: absolute` on top of the board, so a size
// is the one preference a reader can set that can put the app out of reach: a panel wider than the window has
// no grab handle to drag it back with, and one shorter than a row has no controls to see. Every clamp below
// is therefore asserted as a RELATIONSHIP - the floor rises with the text scale, the ceiling follows the
// viewport - rather than as a number, because a number would be a copy of the constant.
//
// Run: node poc/tools/hud-size-probe.mjs   (from anywhere; no build needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');

const size = await import(pathToFileURL(path.join(POC_DIR, 'src', 'hud-size.ts')).href);
const html = read('index.html');
const chrome = read('src/hud-chrome.ts');
const css = read('src/style.css');
const main = read('src/main.ts');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

console.log('== 1. the ladder: one button reaches every size, and 100% is on it ==');
{
  check(size.TEXT_SCALES.includes(1), `the app's own size (100%) is on the ladder, so the button can always get back to it`);
  check(size.TEXT_SCALES.length >= 3, `there is more than "bigger" to offer (${size.TEXT_SCALES.length} steps)`);
  check(size.TEXT_SCALES.every((s, i) => i === 0 || s > size.TEXT_SCALES[i - 1]), 'and the steps ascend, so a click always enlarges');

  // CYCLING IS A CYCLE, not a one-way trip: from the top step the next is the bottom one.
  let seen = [];
  let s = size.TEXT_SCALES[0];
  for (let i = 0; i < size.TEXT_SCALES.length; i++) { seen.push(s); s = size.nextTextScale(s); }
  check(JSON.stringify(seen) === JSON.stringify(size.TEXT_SCALES), `clicking through the ladder visits every step once, in order (${seen.join(', ')})`);
  check(s === size.TEXT_SCALES[0], 'and the click after the largest size is the smallest, so the button never becomes a dead end');

  // THE NEGATIVE CONTROL for the cycle: the plausible wrong rule is "always go up", which stops at the top
  // and leaves a reader who overshot with no way back. That rule fails exactly the check above.
  check(size.nextTextScale(1) !== 1, 'and 100% is not a fixed point, which is the plausible wrong rule ("if it is already the smallest, do nothing")');

  const labels = size.TEXT_SCALES.map(size.textScalePercent);
  check(new Set(labels).size === labels.length, `every step has its own label (${labels.join(', ')})`);
  check(size.textScalePercent(1.25) === '125%', `and the label is the multiplier as a percentage (${size.textScalePercent(1.25)})`);
}

console.log('\n== 2. the clamps, as relationships ==');
{
  const small = { width: 800, height: 600 };
  const big = { width: 2400, height: 1400 };

  const tiny = size.clampHudSize(10, 10, small);
  check(tiny.width >= size.HUD_MIN_WIDTH && tiny.height >= size.HUD_MIN_HEIGHT,
    `a panel dragged to nothing comes back to a usable floor (${tiny.width}x${tiny.height})`);

  const huge = size.clampHudSize(99999, 99999, small);
  check(huge.width <= small.width - size.HUD_EDGE_GAP && huge.height <= small.height - size.HUD_EDGE_GAP,
    `a panel dragged past the edge stops inside the window, so the grab handle stays reachable (${huge.width}x${huge.height} of ${small.width}x${small.height})`);
  check(huge.width < 99999 && huge.height < 99999, 'which the unclamped rule ("return what the drag asked for") fails');

  // THE SAME DRAG ON A BIGGER SCREEN IS A BIGGER PANEL - the ceiling is the viewport, not a constant.
  const hugeBig = size.clampHudSize(99999, 99999, big);
  check(hugeBig.width > huge.width, `and the ceiling follows the window (${huge.width} on 800px wide against ${hugeBig.width} on 2400px)`);

  // THE FLOOR RISES WITH THE TEXT: the same 320px holds about half the characters at 200%.
  const floor200 = size.clampHudSize(1, 1, small, 2);
  check(floor200.width > tiny.width && floor200.height > tiny.height,
    `the floor rises with the text scale, so a panel cannot be left narrower than its own contents (${tiny.width}x${tiny.height} at 100% against ${floor200.width}x${floor200.height} at 200%)`);

  const nan = size.clampHudSize(Number.NaN, Number.POSITIVE_INFINITY, small);
  check(Number.isFinite(nan.width) && Number.isFinite(nan.height), `a non-finite drag (a pointer event with no coordinates) lands on the floor rather than poisoning the style (${nan.width}x${nan.height})`);

  // THE FLOOR IS NOT OVERRIDDEN BY THE CEILING on a window smaller than the floor: a 200x200 window must
  // still give a panel the floor, not a negative size.
  const tinyWindow = size.clampHudSize(400, 400, { width: 200, height: 200 });
  check(tinyWindow.width >= size.HUD_MIN_WIDTH && tinyWindow.height >= size.HUD_MIN_HEIGHT,
    `and on a window smaller than the floor the floor wins, because a zero-width panel has no handle to grow it back (${tinyWindow.width}x${tinyWindow.height})`);
}

console.log('\n== 3. what is in storage is parsed, not trusted ==');
{
  const d = size.DEFAULT_HUD_PREFS;
  check(size.parseHudPrefs(null).scale === d.scale, 'nothing stored opens on the default');
  check(size.parseHudPrefs('not json').scale === d.scale, 'a corrupt blob opens on the default rather than throwing during startup');
  check(size.parseHudPrefs('{"scale":1.1}').scale === 1,
    'a scale that is not on the ladder is DROPPED, because it is not a size this app ever offered');
  check(size.parseHudPrefs('{"scale":"150%"}').scale === 1, 'and so is one of the wrong type');
  check(size.parseHudPrefs('{"width":-40,"height":"big"}').width === null && size.parseHudPrefs('{"width":-40,"height":"big"}').height === null,
    'a nonsense size becomes "no stored size", so the mode keeps its own CSS');
  const round = size.parseHudPrefs(size.serialiseHudPrefs({ scale: 1.5, width: 520, height: 400 }));
  check(round.scale === 1.5 && round.width === 520 && round.height === 400, `a real preference round-trips (${JSON.stringify(round)})`);
  check(size.serialiseHudPrefs(d) === size.serialiseHudPrefs(size.parseHudPrefs(null)), 'and the default serialises to the default, so a first run stores nothing surprising');
}

console.log('\n== 4. the wiring: the button is at the top, the handle is at the corner ==');
{
  const hudOpen = html.indexOf('id="hud"');
  const button = html.indexOf('id="hudTextSize"');
  const mode = html.indexOf('id="modeSelect"');
  const handle = html.indexOf('id="hudResize"');
  check(hudOpen >= 0 && button > hudOpen, 'the Text button is inside the HUD');
  check(button > 0 && button < mode,
    'and ABOVE the mode picker, which is the request: the one control a reader who cannot read the others has to be able to find');
  check(handle > button && handle > html.indexOf('id="edXml"'),
    'the grab handle is the panel\'s last element, so it lands in the bottom-right corner');
  check(/role="separator"/.test(html.slice(handle - 200, handle + 400)) && /tabindex="0"/.test(html.slice(handle - 200, handle + 400)),
    'and it is reachable by keyboard, because the reader this is for may not hold a drag steady');
  check(/aria-label="Resize the panel"/.test(html), 'and it is labelled, so it is not an unlabelled corner to a screen reader');

  check(/hud\.style\.setProperty\('--hud-text'/.test(chrome), 'the scale is applied as a CSS variable on the panel itself, not per mode');
  check(/HUD_PREFS_KEY/.test(chrome) && /localStorage\.setItem\(HUD_PREFS_KEY/.test(chrome), 'and the preference is persisted under the module\'s own key');
  check(/catch/.test(chrome), 'with the storage read AND write guarded, because a browser with storage off must still get the button');
  check(/setPointerCapture/.test(chrome), 'the drag captures the pointer, so a fast drag that leaves the 18px handle keeps resizing');
  check(/try \{\s*handle\.setPointerCapture/.test(chrome), 'and the capture is guarded, because it throws when the pointer is no longer active - losing capture must not lose the drag');
  check(/setSize\(drag\.width \+ \(e\.clientX - drag\.x\)/.test(chrome),
    'the drag moves the panel by the pointer\'s own delta, so it does not jump to centre on the handle on the first move');
  // BOTH KEY STEPS ARE WIRED, and the larger one is the one Shift selects. A handler that ignored
  // `shiftKey` would still resize, so the check names the choice rather than the existence of a key handler.
  check(/const step = e\.shiftKey \? KEY_STEP_LARGE : KEY_STEP;/.test(chrome), 'the arrow keys resize by the small step, and by the large one with Shift held');
  check(/KEY_STEP = 10;/.test(chrome) && /KEY_STEP_LARGE = 50;/.test(chrome), 'and both steps are named constants rather than literals at the call site');
  check(/ArrowRight|ArrowLeft|ArrowDown|ArrowUp/.test(chrome), 'and all four arrows resize it');
  check(/initHudChrome\(\);/.test(main), 'the bootstrap calls it');

  // THE MULTIPLIER IS ONE VARIABLE, which is the whole reason the feature is not a per-mode edit.
  const scaled = [...css.matchAll(/font-size:\s*calc\([0-9.]+px \* var\(--hud-text\)\)/g)].length;
  check(scaled >= 30, `the stylesheet multiplies its own sizes by the variable in one pass (${scaled} declarations)`);
  check(/#hud \{[^}]*--hud-text: 1;/.test(css), 'the variable defaults to 1 on the panel, so the app is unchanged until the button is pressed');
  check(/max-width: calc\(420px \* var\(--hud-text\)\)/.test(css), 'and the panel\'s own width limit rises with the text, so 200% is not squeezed into the 100% box');
  check(!/\.fsm-toolbar[^{]*\{[^}]*--hud-text/.test(css) && !/font-size: calc\([^)]*var\(--hud-text\)[^)]*\)[^}]*\.fsm/.test(css),
    'the FSM view keeps its own sizes: it is a full-area panel of its own, not the HUD');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
