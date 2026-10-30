// THE THEME: ONE TABLE, AND THE STYLESHEET MAY NOT INVENT A VALUE OF ITS OWN.
//
// REPORTED: "I think its time to make the UI more gamified, attractive and captivating." A palette that lives in two
// places is the first thing that stops an interface being tunable: MEASURED before `ui/theme.ts` existed, the three
// waypoint-border colours were defined in `render/stage-view.ts` as numbers for `THREE.Color` and COPIED into
// `style.css` as the `--wp-*` custom properties - one fact, two definitions, and the copy was the one a player saw in
// the legend. The stylesheet also carried 18 distinct hex literals and 6 near-identical white alphas for its edges.
//
// WHAT THIS PINS:
//   1. NO COLOUR LITERAL SURVIVES IN THE STYLESHEET. `#hex` and `rgb()`/`rgba()` are the palette; if one appears in
//      `style.css` the table has been bypassed. MEASURED after the tokenisation: 0.
//   2. EVERY CUSTOM PROPERTY THE STYLESHEET ASKS FOR IS DEFINED. The tokens are injected at boot, so a typo in a `var()`
//      name is otherwise a silent transparent colour - the class of failure AGENTS.md trap 26 describes for a glob.
//   3. THE STAGE'S OUTLINE COLOURS ARE THREE OF THE TOKENS. `OUTLINE_COLOR` is what a WebGL material paints; `--wp-*` is
//      what the legend's keys are; both come from `COLOR.ok`/`COLOR.next`/`COLOR.bad`, checked digit for digit.
//   4. EVERY TEXT/UI PAIR CLEARS WCAG AA. Computed here from the table, with the panel's alpha composited over the page
//      first - a ratio against `rgba(8,13,19,0.92)` alone is not a ratio against what the player sees.
//   5. THE CELEBRATION DURATION IS THE ONE `render/celebrate.ts` OWNS. `MOTION.celebrate` and `CELEBRATE_MS` are the same
//      number or the three-flashes-a-second bound in that module's header is decoration.
//
// THE NEGATIVE CONTROLS run rules 1 and 2 on synthetic stylesheets, because a check whose subject is the real file
// cannot tell a rule from a coincidence: MEASURED, a `#ff0000` in the fixture and an undefined `var(--nope)` are both
// caught by the same code that reports the real file clean.
//
// Usage: node game/test/theme-probe.mjs   (no engine build: it reads text and imports two pure modules)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOR, CSS_VARS, OUTLINE_COLOR, RADIUS, MOTION, SPACE, TYPE, applyTheme } from '../src/ui/theme.ts';
import { CELEBRATE_MS } from '../src/render/celebrate.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const CSS = fs.readFileSync(path.join(GAME, 'src', 'style.css'), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// --------------------------------------------------------------------------------------------------- colour maths

/** `#rrggbb` as [r, g, b] 0..255, or null. */
const rgbOf = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

/** `rgba(r, g, b, a)` / `#rrggbb` as {r,g,b,a}, or null. */
const parseColour = (value) => {
  const hex = rgbOf(value);
  if (hex) return { r: hex[0], g: hex[1], b: hex[2], a: 1 };
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
};

/** Composite `fg` over `bg` (alpha blend), so a translucent panel is judged by what the eye receives. */
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

/** WCAG relative luminance. */
const luminance = (c) => {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
};

/** WCAG contrast ratio of two already-opaque colours. */
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// --------------------------------------------------------------------------------------------------- the rules

/** Every `var(--name)` a stylesheet asks for, and every `--name:` it defines. */
const varsOf = (css) => ({
  used: [...new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]))].sort(),
  defined: [...new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]))].sort(),
});

/** Colour literals: the palette is the table's, so a stylesheet may not spell one. */
const literalsOf = (css) => css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];

console.log('\n== 1. the rules, on a stylesheet a reader can check by eye ==');
{
  const good = `:root { --panel: 340px; }\n#x { color: var(--ink); background: var(--bg); }`;
  const bad = `#x { color: #ff0000; }`;
  const undefinedVar = `#x { color: var(--nope); }`;
  check(literalsOf(good).length === 0, 'a tokenised stylesheet passes the literal rule');
  check(literalsOf(bad).length === 1, 'a hex literal is caught (the negative control for rule 1)');
  check(literalsOf(undefinedVar).length === 0, 'and an undefined var is NOT a literal - it is what rule 2 is for');
  const defined = new Set(Object.keys(CSS_VARS));
  const missing = varsOf(undefinedVar).used.filter((v) => !defined.has(v) && !varsOf(undefinedVar).defined.includes(v));
  check(missing.join() === '--nope', `rule 2 catches an undefined var and names it (${missing.join() || 'none'})`);
  check(rgbOf('#7fe3a1').join() === '127,227,161', 'the hex reader is exact');
  check(Math.abs(ratio(parseColour('#ffffff'), parseColour('#000000')) - 21) < 0.01, 'contrast maths: white on black is 21:1');
  check(Math.abs(ratio(parseColour('#000000'), parseColour('#000000')) - 1) < 1e-9, 'and a colour against itself is 1:1');
}

console.log('\n== 2. the real stylesheet ==');
{
  const literals = literalsOf(CSS);
  check(CSS.length > 20000, `the stylesheet was read (${CSS.length} bytes; a zero here is a FAILURE, not a pass)`);
  check(literals.length === 0, `no colour literal in it (${literals.length} found)`, literals.join(', '));
  const { used, defined } = varsOf(CSS);
  check(used.length > 20, `it asks for ${used.length} custom properties`);
  const provided = new Set([...Object.keys(CSS_VARS), ...defined]);
  // THE TWO PROPERTIES THE STYLESHEET READS THAT THIS TABLE DOES NOT OWN, both written by the shell because a stylesheet
  // cannot call a function: the panel's size (`ui/layout.ts`) and the level path's column count (`ui/level-map.ts`).
  // Exempt BY NAME rather than by pattern, and each exemption carries its own rule below — a value the script provides must
  // have a CSS default, or the first paint before the script runs has a sheet of zero height or a path of ten columns.
  const PROVIDED_ELSEWHERE = new Set(['--panel-size', '--level-columns']);
  const missing = used.filter((name) => !provided.has(name) && !PROVIDED_ELSEWHERE.has(name));
  check(missing.length === 0, `and every one of them is defined (${missing.length} missing)`, missing.join(', '));
  check([...PROVIDED_ELSEWHERE].every((name) => used.includes(name)),
    `and the ${PROVIDED_ELSEWHERE.size} propert(y|ies) the shell provides are read here (${[...PROVIDED_ELSEWHERE].join(', ')})`);
  const noDefault = [...PROVIDED_ELSEWHERE].filter((name) => !defined.includes(name)
    && !new RegExp(`var\\(${name},\\s*[^)]+\\)`).test(CSS));
  check(noDefault.length === 0, `and each carries a pre-script default (${noDefault.join(', ') || 'none missing'})`,
    noDefault.join(', '));
  // THE OTHER DIRECTION: a token nothing reads is dead weight, and AGENTS.md 4.5 has no room for it. The motion numbers are
  // read by TypeScript rather than CSS, so they are exempt BY NAME. (The three waypoint colours were here until the border
  // legend was removed — they existed for its swatches, and nothing else read them.)
  const readElsewhere = new Set(['--t-slide', '--t-celebrate', '--t-enter']);
  const unused = Object.keys(CSS_VARS).filter((name) => !used.includes(name) && !readElsewhere.has(name));
  check(unused.length === 0, `and no token is unread (${unused.length} unused)`, unused.join(', '));
}

console.log('\n== 3. one fact, one definition: the stage\'s three outline colours ==');
{
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  check(hex(OUTLINE_COLOR.solved) === COLOR.ok, `solved is --ok (${hex(OUTLINE_COLOR.solved)})`);
  check(hex(OUTLINE_COLOR.next) === COLOR.next, `next is --next (${hex(OUTLINE_COLOR.next)})`);
  check(hex(OUTLINE_COLOR.locked) === COLOR.bad, `locked is --bad (${hex(OUTLINE_COLOR.locked)})`);

  // THE INJECTION WRITES EVERY TOKEN: a stub stands in for `document.documentElement`, which is what makes this a probe.
  const written = new Map();
  applyTheme({ style: { setProperty: (name, value) => written.set(name, value) } });
  check(written.size === Object.keys(CSS_VARS).length && written.size >= 38, `applyTheme writes all ${written.size} tokens`);
  check([...written].every(([name, value]) => typeof name === 'string' && typeof value === 'string' && value.length > 0),
    'and every one of them is a non-empty string');
  check(Object.keys(RADIUS).every((key) => CSS_VARS[`--r-${key}`] === RADIUS[key]), 'the radii travel as tokens');
  check(Object.keys(MOTION).filter((k) => k !== 'ease').every((key) => CSS_VARS[`--t-${key}`] === MOTION[key]),
    'and so do the durations');
}

console.log('\n== 4. WCAG AA, computed from the table ==');
{
  const bg = parseColour(COLOR.bg);
  const panel = over(parseColour(COLOR.panel), bg);
  const surface = parseColour(COLOR.surface);
  const control = parseColour(COLOR.control);
  const raised = parseColour(COLOR.raised);
  const field = parseColour(COLOR.field);
  /** [what, foreground, background, minimum, why] */
  const PAIRS = [
    ['body text on the page', COLOR.ink, bg, 4.5, 'the default reading colour'],
    ['body text on the panel', COLOR.ink, panel, 4.5, 'every caption and control label'],
    ['body text on a control', COLOR.ink, control, 4.5, 'a button label'],
    ['body text on a raised control', COLOR.ink, raised, 4.5, 'the footer and the More summary'],
    ['body text on a field', COLOR.ink, field, 4.5, 'the search box and the account form'],
    ['dim text on the panel', COLOR.dim, panel, 4.5, 'the scores cell, the readout, the counters'],
    ['dim text on the page', COLOR.dim, bg, 4.5, 'the level heading beside the board'],
    ['success on the panel', COLOR.ok, panel, 4.5, 'a solved verdict'],
    ['danger on the panel', COLOR.bad, panel, 4.5, 'a refusal, which must be as readable as a success'],
    ['attention on the panel', COLOR.accent, panel, 4.5, 'an info line and the pressed mode tab'],
    ['attention on its own ghost', COLOR.accent, over(parseColour(COLOR.accentGhost), bg), 4.5, 'the waypoint arrow glyph'],
    ['next on the panel', COLOR.next, panel, 4.5, 'the legend key beside a pending waypoint'],
    ['a cell number on a done drill', COLOR.ink, parseColour(COLOR.donePassed), 4.5, 'the level block\'s passed cells'],
    ['a cell number on a skipped drill', COLOR.ink, parseColour(COLOR.doneSkipped), 4.5, 'and its skipped ones'],
    ['a faint caption on a surface', COLOR.inkFaint, surface, 4.5, 'a cell that is published but not handed out'],
    ['a soft caption on a surface', COLOR.inkSoft, surface, 4.5, 'the dimmed number on a finished cell'],
    ['a panel edge', COLOR.line, panel, 3, 'a border is UI, not text'],
    ['a control edge', COLOR.line, control, 3, 'every button outline'],
    ['a strong edge', COLOR.lineStrong, control, 3, 'the focused and armed outline'],
    ['the action\'s label on the accent fill', COLOR.onAccent, parseColour(COLOR.accent), 4.5, 'the Next button is the one filled control'],
  ];
  for (const [what, fg, b, min, why] of PAIRS) {
    // A TRANSLUCENT FOREGROUND IS COMPOSITED OVER ITS BACKGROUND FIRST. A ratio taken against `rgba(255,255,255,0.4)`
    // as if it were white would report 17:1 for a caption a player can barely see — MEASURED, that is exactly what the
    // first version of this check did, and it passed a 0.4-alpha caption at 4.5:1. What the eye receives is the blend.
    const value = ratio(over(parseColour(fg), b), b);
    check(value >= min, `${what} is ${value.toFixed(2)}:1 against ${min}:1 — ${why}`);
  }
}

console.log('\n== 5. the celebration duration is the module that owns it ==');
{
  check(MOTION.celebrate === `${CELEBRATE_MS}ms`, `MOTION.celebrate is celebrate.ts's ${CELEBRATE_MS} ms`);
  const flashesPerSecond = 1000 / CELEBRATE_MS;
  check(flashesPerSecond < 3, `which is ${flashesPerSecond.toFixed(1)} flashes/s, under the three-per-second bound`);
}

console.log('\n== 6. the type and space scales, and the ceiling on the first ==');
{
  // THE BASE SIZE IS NOT A STEP: `:root`'s `font-size` is what every `rem` in the ladder is relative to, so it is the one
  // declaration exempt from "a font size is a token" — and it is exempt by CONTEXT (inside `:root`), not by value.
  const body = CSS.replace(/:root\s*\{[\s\S]*?\}/, '');
  const sizes = [...body.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  check(sizes.length > 5, `the stylesheet sets ${sizes.length} font sizes (a zero here is a FAILURE, not a pass)`);
  const literalSizes = sizes.filter((v) => !/^var\(--fs-[a-z]+\)$/.test(v));
  check(literalSizes.length === 0, `every one of them is a scale step (${literalSizes.length} literal)`, literalSizes.join(', '));
  const usedSteps = new Set(sizes.map((v) => /^var\(--fs-([a-z]+)\)$/.exec(v)?.[1]).filter(Boolean));
  const knownSteps = new Set(Object.keys(TYPE));
  const unknown = [...usedSteps].filter((step) => !knownSteps.has(step));
  check(unknown.length === 0, `and every step is one TYPE defines (${unknown.join(', ') || 'none'} unknown)`);
  // THE CEILING, NOT AN EQUALITY: the ladder may only SHRINK (AGENTS.md §11.2.8's ceiling pin). It was seven steps and is
  // six after the level block's numbers became marks; MEASURED before this pass the stylesheet asked for THIRTEEN distinct
  // sizes, six of them within 0.05 rem of a neighbour — a rattle, not a hierarchy.
  check(Object.keys(TYPE).length <= 7, `the ladder has ${Object.keys(TYPE).length} steps, against a ceiling of 7`);
  check(usedSteps.size <= Object.keys(TYPE).length,
    `and the stylesheet uses ${usedSteps.size} of them, so no size exists that nothing reads`);
  const ladder = Object.keys(TYPE);
  check(sizes.includes(`var(--fs-${ladder[0]})`) && sizes.includes(`var(--fs-${ladder[ladder.length - 1]})`),
    `and it reaches both ends of it (${ladder[0]} and ${ladder[ladder.length - 1]}) — a ladder nothing uses is a ladder nobody needed`);
  // NEGATIVE CONTROL: an in-between size is exactly what the pass removed, and it fails the literal rule above and only
  // that rule — the ceiling check would pass, because 0.93 rem would still be one more VALUE but the same step count.
  const sneaky = `#x { font-size: 0.93rem; }`;
  check([...sneaky.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]).some((v) => !/^var\(--fs-/.test(v)),
    'an in-between size fails the literal rule (the negative control)');

  // THE SPACE SCALE: every edge of a gap or padding is a step or an explicit zero. Read as TOKENS rather than as whole
  // strings, because a composite is a list: `padding: 0 var(--space-sm)` is a zero with a step beside it, which the rule
  // always meant to allow — the pattern list this replaces spelled out one, two, three and four steps and so rejected the
  // zero-plus-one form the header's hint badge needs (a cell with no vertical padding and a scale step on its sides).
  const spaces = [...body.matchAll(/\b(?:gap|padding):\s*([^;]+);/g)].map((m) => m[1].trim());
  check(spaces.length > 10, `and it sets ${spaces.length} gaps or paddings`);
  const step = new RegExp(`^var\\(--space-(${Object.keys(SPACE).join('|')})\\)$`);
  const straySpaces = spaces.filter((v) => {
    // the sheet's safe-area padding is geometry, not a scale step: it must follow the device's inset
    if (/^calc\(var\(--space-[a-z]+\) \+ env\(safe-area-inset-bottom\)\)$/.test(v)) return false;
    return !v.split(/\s+/).every((token) => token === '0' || step.test(token));
  });
  check(straySpaces.length === 0, `and every one is a space step or a zero (${straySpaces.length} stray)`, straySpaces.join(' | '));
  // NEGATIVE CONTROL, MEASURED: the same reader must still reject a LITERAL beside a zero — `0 3px` — which is the case the
  // token rule exists for. A rule that accepted any composite would pass the check above while accepting this.
  check(!'0 3px'.split(/\s+/).every((token) => token === '0' || step.test(token)),
    'CONTROL: a zero with a literal beside it is still stray, so the token rule is not a blanket pass');
  const usedSpace = new Set(spaces.flatMap((v) => [...v.matchAll(/var\(--space-([a-z]+)\)/g)].map((m) => m[1])));
  check(usedSpace.size === Object.keys(SPACE).length, `and all ${Object.keys(SPACE).length} space steps are in use (${usedSpace.size})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
