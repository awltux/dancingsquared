// Probe: AUTHORED DATA DOES NOT BECOME MARKUP.
//
// `poc/src/dom.ts` says what `esc` is for: "`esc` is the rule that authored data (a call's `from` label, a
// user-defined formation's name, a module name) cannot become markup in an `innerHTML`". The rule was already
// broken in five places when it was written down - a call's title, its taminator and its `from` in the browse
// legend, the requested call id and an error message in the same field, and (in the sequencer) a module name
// the CALLER typed plus the saved history's call names. Four of those five sites imported `esc` and used it
// three lines away.
//
// SO THIS GATE IS ABOUT THE CLASS, NOT THE FIVE. It reads every `innerHTML = ...` template literal in `poc/src`
// and fails when one of them interpolates a value that comes from outside the app - the corpus, the caller's
// own typing, or a thrown error - without routing it through `esc`. Values the app itself produced (an index,
// an enum, a number) are not listed and are not the rule's business.
//
// Run: node poc/tools/escape-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/**
 * The values that are NOT the app's own, by the name they carry at the point of interpolation.
 *
 * `stepLabel(...)` is here because it returns a call name a caller can have authored into a saved module.
 * `(err as Error).message` is here because an engine error can quote the data that caused it.
 */
const UNTRUSTED = [
  /(?:^|[^\w.])call\.title\b/,
  /(?:^|[^\w.])call\.taminator\b/,
  /(?:^|[^\w.])call\.from\b/,
  /(?:^|[^\w.])m\.name\b/,
  /(?:^|[^\w.])f\.name\b/,
  /(?:^|[^\w.])s\.name\b/,
  /(?:^|[^\w.])fasr\.formation\b/,
  /(?:^|[^\w.])stepLabel\(/,
  /\(err as Error\)\.message\b/,
];

const files = fs.readdirSync(path.join(POC, 'src')).filter((f) => f.endsWith('.ts'));

/**
 * The full statement after an `innerHTML` assignment, whatever shape it is.
 *
 * A regex over ``innerHTML = `...`;`` matched only 20 of the ~50 sites, and the ones it MISSED were the chained
 * ones (`` `...`.join('') ``) and the `+=` appends - i.e. the scan's silence would have been read as a pass
 * over half the surface. So the statement is walked to its own terminating `;`, tracking backticks, brackets
 * and quotes, and the caller asserts that every assignment found was parsed.
 */
function statementAt(text, from) {
  let i = from;
  let depth = 0;
  let tick = false;
  let quote = '';
  for (; i < text.length; i++) {
    const ch = text[i];
    if (tick) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') tick = false;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '`') { tick = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

const offenders = [];
const unreadable = [];
let assignments = 0;
let parsed = 0;
let templates = 0;
let interpolations = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(POC, 'src', f), 'utf8');
  for (const m of text.matchAll(/innerHTML\s*\+?=/g)) {
    assignments++;
    const stmt = statementAt(text, m.index);
    const line = text.slice(0, m.index).split('\n').length;
    const bodies = [...stmt.matchAll(/`([\s\S]*?)`/g)].map((b) => b[1]);
    if (bodies.length === 0) {
      // A VARIABLE, not markup written here - `innerHTML = bits.join('')`, `innerHTML = ''`. Nothing is
      // interpolated AT THIS LINE, so there is nothing here to escape; if it interpolates anything at all the
      // scan cannot see it and says so rather than passing.
      if (stmt.includes('${')) offenders.push(`${f}:${line}  (interpolates in a statement this scan cannot read)`);
      else unreadable.push(`${f}:${line}`);
      continue;
    }
    parsed++;
    for (const body of bodies) {
      templates++;
      for (const e of body.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
        interpolations++;
        const expr = e[1];
        for (const bad of UNTRUSTED) {
          if (!bad.test(expr)) continue;
          // Escaped anywhere in the SAME expression is enough: `esc(a) + esc(b)` and `esc(a ? b : c)` both hold.
          if (/\besc\(/.test(expr)) continue;
          offenders.push(`${f}:${line}  ${'${' + expr + '}'}`);
        }
      }
    }
  }
}
console.log(`== every innerHTML assignment in poc/src (${assignments} assignments; ${parsed} write markup inline, in ${templates} template literals with ${interpolations} interpolations) ==`);
console.log(`   counted ${offenders.length} interpolation(s) of authored data with no esc(`);
check(assignments > 40, 'the scan found the app\'s markup, so it is looking at the real surface');
check(parsed + unreadable.length === assignments, `and accounted for every one of them (${parsed} written here, ${unreadable.length} assigned from a variable)`);
check(parsed > 20, 'the sites that write markup inline are read, not skipped');
console.log(`   ${unreadable.length} assignments build their markup in a variable first (${unreadable.slice(0, 4).join(', ')}${unreadable.length > 4 ? ', …' : ''}) - this probe cannot vouch for those, and does not pretend to`);
check(interpolations > 40, 'with the interpolations inside them, so a clean result is not a scan that matched nothing');
check(offenders.length === 0, `no authored value reaches innerHTML unescaped${offenders.length ? ':\n      ' + offenders.join('\n      ') : ''}`);

// THE SAME RULE, WHERE IT IS EASY TO GET WRONG THE OTHER WAY: `esc` must NOT be applied to `textContent`, where
// the browser is already doing the escaping and `&amp;` would be shown to the caller as text.
console.log('\n== and esc is not applied where the browser escapes for us ==');
const wrongly = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(POC, 'src', f), 'utf8');
  for (const m of text.matchAll(/textContent\s*=\s*`?[^;]*\$\{esc\(([^)]*)\)\}/g)) {
    wrongly.push(`${f}:${text.slice(0, m.index).split('\n').length}`);
  }
}
check(wrongly.length === 0, `no esc() inside a textContent${wrongly.length ? ': ' + wrongly.join(', ') : ''}`);

// AND THE FIVE SITES THAT WERE WRONG, pinned one by one, so a later refactor cannot quietly undo them.
console.log('\n== the sites that were broken ==');
const browser = fs.readFileSync(path.join(POC, 'src', 'browser.ts'), 'utf8');
const seq = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
check(/innerHTML = `<b>\$\{esc\(call\.title\)\}<\/b>[^`]*\$\{esc\(call\.taminator\)\}/.test(browser), 'the legend escapes the call title and its taminator');
check(/innerHTML = `<b>\$\{esc\(call\.title\)\}<\/b><br>from \$\{esc\(call\.from/.test(browser), "and the `from` label the corpus authored");
check(/failed to load: \$\{esc\(\(err as Error\)\.message\)\}/.test(browser), 'and the message of a load that threw');
check(/textContent = `end formation unavailable: \$\{\(err as Error\)\.message\}`/.test(browser), 'while the SAME expression in a textContent is left alone, where escaping would print &amp; to the caller');
// THE TIMELINE is the saved history list now, one row per step, and it is where a MODULE's name and every
// call name reach markup. Both are escaped; the row's own numbers are not text at all.
check(/<b>\$\{esc\(m\.name\)\}<\/b><\/span>: \$\{esc\(m\.calls\.map\(stepLabel\)\.join\(/.test(seq), 'the module list escapes the name the caller typed and the call names in it');
check(/<span class="seq-name">\$\{esc\(stepLabel\(step\)\)\}<\/span>/.test(seq), 'and so does the timeline row for every step in the saved history');
check(/\$\{esc\(title\)\}/.test(seq), 'including the row\'s tooltip, which carries the engine\'s own refusal reason');
check(/Formation: <b>\$\{esc\(fasr\.formation/.test(seq), 'and the FASR readout, whose formation can be one the caller defined');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
