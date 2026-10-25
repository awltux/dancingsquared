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

// THE TWO RULES, IMPORTED RATHER THAN RESTATED. The sections below pin each rule's exact output, so this probe
// never re-implements an escaper (a copy of the rule would measure the copy — §5). The engine's XML rule is
// reached through what it PRODUCES (`formationToXml`), because `esc` is deliberately not part of the engine's
// public surface.
import { esc as htmlEsc } from '../src/dom.ts';
import { formationToXml } from 'dancing-squared-engine';
import { escapeHtml, escapeXml } from '../../book/tools/lib/escape.mjs';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg + (detail ? '\n        ' + detail : '')); }
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
check(/<b>\$\{esc\(m\.name\)\}<\/b>/.test(seq) && /\$\{esc\(m\.calls\.map\(stepLabel\)\.join\(/.test(seq),
  'the module list escapes the name the caller typed and the call names in it');
// AND THE TWO BOARD LABELS the row shows: a formation's name is authored data like any other, and it arrives
// from the catalogue or from a hand-written store, not from this module.
check(/\$\{esc\(m\.start\.name \?\? /.test(seq) && /\$\{esc\(m\.end\?\.name \?\? /.test(seq),
  'and the two board labels it now shows, which come from the catalogue rather than from this code');
check(/<span class="seq-name">\$\{esc\(stepLabel\(step\)\)\}<\/span>/.test(seq), 'and so does the timeline row for every step in the saved history');
check(/\$\{esc\(title\)\}/.test(seq), 'including the row\'s tooltip, which carries the engine\'s own refusal reason');
check(/Formation: <b>\$\{esc\(fasr\.formation/.test(seq), 'and the FASR readout, whose formation can be one the caller defined');

// ---------------------------------------------------------------- the RULES, not just their use
//
// The audit above is about WHERE `esc` is applied. This part is about WHAT it does, because the tree had NINE
// implementations of "authored data cannot become markup" in three different character sets: the engine's two
// byte-identical `& < "` lambdas, the POC's `& < > "`, the teacher's `& < > " '` copy, a fourth in the teacher's
// `fsm-visual.mjs`, three in the book's tools and one in its browser player. Two of them were the same file
// twice; two disagreed about `'`; and the sitemap spelled it `&apos;` where nothing else did.
//
// THE ANSWER IS TWO RULES, ONE PER TARGET, and the difference is the point:
//   XML  `& < "`      — the engine's exporter (double-quoted attributes, `>` legal raw) and the book's sitemap
//   HTML `& < > " '`  — everything interpolated into `innerHTML`, attributes included
// The last check in this file requires that the two DIFFER, so "unify the escapers" fails here instead of
// shipping a rule that is wrong for one of the two targets.
console.log('\n== the escape rules themselves ==');
{
  const HTML = [
    ['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;'],
    // DOUBLE-ESCAPING IS THE RULE, not a bug: a caller that passes already-escaped text gets `&amp;amp;`. Pinned
    // so the behaviour is a decision rather than a surprise, and so `esc` is never applied to text that has
    // already been through it (or to a `textContent`, which the audit above also forbids).
    ['&amp;', '&amp;amp;'],
  ];
  const wrong = HTML.filter(([input, want]) => htmlEsc(input) !== want).map(([i]) => JSON.stringify(i));
  check(wrong.length === 0, `the POC's HTML rule escapes & < > " ' to their entities${wrong.length ? ': ' + wrong.join(', ') : ''}`);
  const bookDiff = HTML.filter(([input, want]) => escapeHtml(input) !== want).map(([i]) => JSON.stringify(i));
  check(bookDiff.length === 0, `and the book's \`escapeHtml\` gives the same bytes${bookDiff.length ? ': ' + bookDiff.join(', ') : ''}`);

  // THE HTML RULE IS SAFE ON A HOSTILE STRING: no character that can open a tag, close a string or start an
  // entity survives. This is the invariant, stated as an output property rather than as an input list.
  const HOSTILE = `</script><img src=x onerror="alert('x')">&amp;`;
  for (const [name, fn] of [['esc', htmlEsc], ['escapeHtml', escapeHtml]]) {
    const out = fn(HOSTILE);
    check(!/[<>"']/.test(out), `${name}() leaves no < > " ' in a hostile string (${JSON.stringify(out)})`);
  }

  // THE XML RULE, judged through the exporter's own OUTPUT — `formationToXml` writes the formation's `name`
  // attribute through the engine's `esc`, so this is the rule as a caller observes it.
  const nasty = `a&b<c>"d'e`;
  const xml = formationToXml(nasty, []);
  const attr = /name="([^"]*)"/.exec(xml)?.[1] ?? '';
  check(attr === 'a&amp;b&lt;c>&quot;d\'e',
    `the engine's XML rule escapes & < " and leaves > and ' RAW — it is NOT the HTML rule (got ${JSON.stringify(attr)})`);
  check(escapeXml(nasty) === attr,
    'and the book\'s `escapeXml` produces the SAME attribute text from the same input (one rule, two modules)');
  check(escapeXml('&') === '&amp;' && escapeXml('<') === '&lt;' && escapeXml('"') === '&quot;',
    'with & < " pinned one by one');
  // THE NEGATIVE CONTROL for the pair above: if someone merges the two rules, one of these fails.
  check(htmlEsc('>') === '&gt;' && attr.includes('>'),
    'so the two rules DIFFER on `>`: the HTML one escapes it and the XML one does not — which is why they are two');

  // THE ONE COPY THAT CANNOT BE IMPORTED is the book's browser player: it is copied verbatim into the published
  // site, so its source is the only thing a gate can read. It must carry the SAME five-character class.
  const player = fs.readFileSync(path.join(POC, '..', 'book', 'assets', 'player.js'), 'utf8');
  check(/replace\(\/\[&<>"'\]\/g/.test(player), 'the book\'s shipped player.js carries the same five-character HTML class');
  check(/'&#39;'/.test(player), 'and maps \' to &#39; rather than &apos;, like the shared module');

  // THE TEACHER IMPORTS THE POC'S RULE and applies it at the one site that was bare.
  const teacherUtil = fs.readFileSync(path.join(POC, '..', 'poc-teacher', 'src', 'util.ts'), 'utf8');
  const teacherPreview = fs.readFileSync(path.join(POC, '..', 'poc-teacher', 'src', 'preview.ts'), 'utf8');
  const teacherScript = fs.readFileSync(path.join(POC, '..', 'poc-teacher', 'scripts', 'fsm-visual.mjs'), 'utf8');
  check(/export \{ esc \} from '\.\.\/\.\.\/poc\/src\/dom\.ts'/.test(teacherUtil),
    'the teacher re-exports the POC\'s esc rather than defining one');
  check(/esc\(this\.callAt\(/.test(teacherPreview),
    'and its preview escapes the call name, which it used to interpolate into innerHTML raw');
  check(/import \{ esc \} from '\.\.\/\.\.\/poc\/src\/dom\.ts'/.test(teacherScript),
    'and its FSM visual script imports the same rule instead of its own five-character copy');

  // THE INVENTORY, AS A NAMED SET. An escaper is a line that maps a character TO `&amp;`; the files that contain
  // one must be exactly these four, so a tenth copy fails this check by name. Comments are not stripped here
  // because the pattern is a quoted entity, which neither prose nor a decoder produces.
  const ROOTS = ['engine/src', 'poc/src', 'poc-teacher/src', 'poc-teacher/scripts', 'book/tools', 'book/assets', 'packages', 'game/src', 'api/src'];
  const seen = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|dist/.test(e.name)) walk(p); continue; }
      if (!/\.(ts|mjs|js|cjs)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (/['"]&amp;['"]/.test(text)) seen.push(path.relative(path.join(POC, '..'), p).split(path.sep).join('/'));
    }
  };
  for (const r of ROOTS) { const dir = path.join(POC, '..', r); if (fs.existsSync(dir)) walk(dir); }
  const EXPECTED = ['book/assets/player.js', 'book/tools/lib/escape.mjs', 'engine/src/convert.ts', 'poc/src/dom.ts'];
  check(seen.length > 0, `the inventory walk found escaping definitions (${seen.length} file(s)), so it is looking at the real tree`);
  check(JSON.stringify([...seen].sort()) === JSON.stringify(EXPECTED),
    `and there are exactly four files with an escaper in them: ${EXPECTED.join(', ')}`,
    `found: ${[...seen].sort().join(', ')}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
