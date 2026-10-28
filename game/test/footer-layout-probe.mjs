// THE FOOTER'S SHEET LAYOUT: TWO COLUMNS, WITH THE ACTION SPANNING THEM — EXCEPT BESIDE "PLAY".
//
// REPORTED: "Put the 'Play' button next to the 'Next drill' button on the drill correct page." Both are footer buttons
// (`#replayMine`, `#next`), and on a sheet the footer is a two-column grid whose primary action spans both columns. That
// is right while the action stands alone — it is the one a thumb reaches for — and wrong on a solved drill, where it
// pushes Play onto a row of its own. The rule that fixes it is CSS, so nothing in this tree had a gate on it: `layout-probe`
// pins the sheet's breakpoint and height, and the footer's own arrangement was measured once (the 250 px of four stacked
// rows) and then trusted. This probe is that gate.
//
// WHAT IT PINS:
//   1. THE TWO CONTROLS ARE FOOTER SIBLINGS, and Play precedes the action in the DOM, so "beside" is one row of one grid.
//   2. THE SHEET IS THE TWO-COLUMN GRID the measurement chose, and the action spans BOTH columns there when it is alone.
//   3. THE PAIR RULE EXISTS: a `:has(#replayMine:not([hidden]))` condition on `#foot` reduces `#next` to one column.
//   4. IT IS INSIDE THE SHEET MEDIA QUERY, so the desktop column is untouched — the desktop panel is 300–340 px wide and
//      two controls side by side there would each be ~140 px, which is narrower than the strings they carry.
//   5. THE CONDITION IS THE DOM'S OWN: `#replayMine`'s `hidden` attribute is set by `paintView` from `panelLine()`, so the
//      layout reads one fact rather than a second flag the shell would have to keep in step.
//
// THE NEGATIVE CONTROLS are the plausible wrong rules, run through the same readers: a sheet with the pair rule deleted
// (the defect the report describes) and the pair rule moved OUTSIDE the media query (which would squeeze the desktop
// column). Each fails exactly one check, named in its comment.
//
// Usage: node game/test/footer-layout-probe.mjs   (reads text; no engine build, no DOM)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NARROW_MAX_WIDTH } from '../src/ui/layout.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const CSS = fs.readFileSync(path.join(GAME, 'src', 'style.css'), 'utf8');
const HTML = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(GAME, 'src', 'main.ts'), 'utf8');

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

/** Comments are documentation, not rules: the stylesheet QUOTES the reports that asked for a control's removal. */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripCssComments(CSS);

/** One brace-balanced block starting at `opener` (which must include its opening brace). */
const blockFrom = (text, opener) => {
  const at = text.indexOf(opener);
  if (at === -1) return '';
  let depth = 0;
  for (let i = at + opener.length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return '';
};

/** The rules of a block with no nested braces, as `{ selector, body }`. */
const rulesIn = (block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

/** The declaration block for one exact selector, or '' when the rule is absent. */
const ruleFor = (rules, selector) => rules.filter((rule) => rule.selector === selector).map((rule) => rule.body).join(';');

/**
 * THE PAIR RULE, read by its condition rather than by its spelling: a `#foot` rule that tests `#replayMine`'s `hidden`
 * attribute and targets `#next`.
 */
const pairRules = (rules) => rules.filter((rule) => /#foot:has\(#replayMine:not\(\[hidden\]\)\)/.test(rule.selector) && /#next\b/.test(rule.selector));

const SHEET_OPENER = `@media (max-width: ${NARROW_MAX_WIDTH - 1}px) {`;
const sheet = blockFrom(css, SHEET_OPENER);
const sheetRules = rulesIn(sheet);
const base = css.slice(0, css.indexOf(SHEET_OPENER));

console.log('\n== 1. the two controls are footer siblings, Play before the action ==');
{
  const foot = HTML.slice(HTML.indexOf('<footer id="foot">'), HTML.indexOf('</footer>'));
  const ids = [...foot.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  check(ids.includes('replayMine') && ids.includes('next'),
    `both the Play button and the action are in #foot (${ids.join(', ')})`, ids.join(', '));
  check(ids.indexOf('replayMine') < ids.indexOf('next'),
    `and Play precedes the action, so the sheet grid puts them left and right in that order (${ids.indexOf('replayMine')} < ${ids.indexOf('next')})`);
  // THE CONDITION HAS TO BE A FACT SOMETHING SETS. `paintView` is the one place that shows Play, and it shows it exactly
  // when the panel has a line — so `:has()` reads the same `hidden` attribute the shell writes, not a second state.
  check(/els\.replayMine\.hidden = line === null;/.test(MAIN),
    'paintView shows Play exactly when panelLine() has a line, so `hidden` IS the pair condition');
}

console.log('\n== 2. the sheet is a two-column grid, and the action spans it when alone ==');
{
  check(sheet.startsWith(SHEET_OPENER), `style.css carries the sheet media query at ${NARROW_MAX_WIDTH - 1} px (${SHEET_OPENER})`);
  const foot = ruleFor(sheetRules, '#foot');
  check(/display:\s*grid/.test(foot) && /grid-template-columns:\s*1fr\s+1fr/.test(foot),
    `#foot is the two-column grid the measurement chose (${foot.replace(/\s+/g, ' ').trim()})`, foot);
  const next = ruleFor(sheetRules, '#foot #next');
  check(/grid-column:\s*span\s+2/.test(next),
    `and the action spans both columns while it stands alone (${next.replace(/\s+/g, ' ').trim()})`, next);
}

console.log('\n== 3. the pair rule gives the action one column beside Play ==');
{
  const found = pairRules(sheetRules);
  check(found.length === 1, `one :has(#replayMine:not([hidden])) rule targets #next in the sheet (${found.length} found)`,
    found.map((r) => `${r.selector} { ${r.body.trim()} }`).join(' | '));
  const body = found.map((r) => r.body).join(';');
  check(/grid-column:\s*span\s+1/.test(body),
    `and it puts the action on ONE column, sharing the row with Play (${body.replace(/\s+/g, ' ').trim()})`, body);
  // THE CONDITION IS THE VISIBILITY FLAG, not a modifier class: `not([hidden])` is what makes the rule fire on a solved
  // drill and stop firing on the next question, and a class written by the shell would be the second state AGENTS §4.3
  // rules out. The check above already matches the selector; this one names the half that matters.
  check(found.length > 0 && found.every((rule) => rule.selector.includes(':not([hidden])')),
    'the rule reads the DOM\'s `hidden` attribute rather than a second class or data attribute');
}

console.log('\n== 4. the pair is a SHEET rule; the desktop column is untouched ==');
{
  // THE BASE FOOTER IS A COLUMN, and the pair rule must NOT appear before the media query: at 300–340 px a desktop panel
  // would give each of two controls ~140 px, which is narrower than "Sign in for the next drill". The report's own mechanic
  // is the sheet grid's span, so that is where the change lives.
  const baseFoot = ruleFor(rulesIn(base), '#foot');
  check(/flex-direction:\s*column/.test(baseFoot), `the base #foot is still a column (${baseFoot.replace(/\s+/g, ' ').trim()})`, baseFoot);
  check(pairRules(rulesIn(base)).length === 0, 'and no pair rule exists outside the sheet media query');
  // NEGATIVE CONTROL, run through the same reader: the pair rule hoisted out of the media query is found in `base`, so this
  // check fails on it and nothing else in the probe does.
  const hoisted = `#foot:has(#replayMine:not([hidden])) #next { grid-column: span 1; }`;
  check(pairRules(rulesIn(hoisted)).length === 1, 'the reader FINDS the rule when it is hoisted, which is what makes the check above meaningful');
}

console.log('\n== 5. the readers fail on the defect this probe was written for ==');
{
  // A SHEET WITH THE PAIR RULE DELETED is exactly the stylesheet before this change: the action spans both columns and
  // Play sits above it. The reader must report no pair rule, and the `span 2` fallback must still be found.
  const withoutPair = sheet.replace(/#foot:has\(#replayMine:not\(\[hidden\]\)\) #next\s*\{[^}]*\}/, '');
  check(withoutPair !== sheet, 'the control: removing the pair rule changes the sheet');
  check(pairRules(rulesIn(withoutPair)).length === 0, 'and the reader then finds no pair rule, so a revert goes red here');
  check(/grid-column:\s*span\s+2/.test(ruleFor(rulesIn(withoutPair), '#foot #next')),
    'while the action is still full width — the two facts the pair rule separates');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
