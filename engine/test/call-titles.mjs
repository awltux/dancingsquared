// THE TITLE REGISTRY: every call title the corpus carries is a constant, and the corpus and the constants
// cannot drift apart in EITHER direction.
//
// WHY THIS IS A GATE AND NOT A LINE IN THE LOADER. The complaint it answers is "when loading XML calls, check
// that a constant has been defined for that call title". The check belongs here because a corpus that carries
// a title this module lacks must be reported ALL AT ONCE, with both lists, before anything is rebuilt - a
// loader that threw would take out the app on data it could still dance (`parseCallXml` is deliberately
// permissive), and the app's job is not to police the corpus. What the ENGINE gains is compile-time safety:
// `CALL_TITLE['Promenade Home']` is an error while the corpus spells it `Promenade`, so every consumer of a
// retitled call is a compile error rather than a name that resolves to nothing. MEASURED, and it is why this
// exists: `Promenade Home` went to zero tams in `e02b434` while 43 files still spelled it, and nothing failed
// except at runtime, in harnesses that had nothing to do with the change (AGENTS.md §11.2.6).
//
// THE THREE CHECKS, and they are not the same check three times:
//   1. the scan itself is live - a positive control that it found the corpus rather than nothing;
//   2. the CARRIED SET is exact in both directions: every corpus title has a constant (a retitle the module
//      never saw) and every constant is a corpus title (a title the corpus dropped);
//   3. the generated module is BYTE-IDENTICAL to a fresh render, which catches an edit made by hand to the
//      generated file that happens to keep the key set right (a changed value, a lost header, a reordering).
//      The runtime type guard is checked too, since a module that typechecks but guards wrongly is the exact
//      "compiles and lies" failure this repo keeps finding.
//
// Usage: node engine/test/call-titles.mjs   (engine must be built: it imports the guard from dist)
import fs from 'node:fs';
import { corpusCallTitles, renderCallTitles, MODULE } from '../../scripts/call-titles.mjs';
import { CALL_SYNONYMS, CALL_TITLE, isCallTitle, PERMISSION_RULES } from '../dist/index.js';

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) {
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`);
    failures++;
  } else console.log(`  ok   ${what}`);
};

console.log('call-titles: the corpus vocabulary, and the constants that name it\n');

// ---------------------------------------------------------------- 1. the scan is live
const built = corpusCallTitles();
console.log(`  ${built.titles.length} distinct titles across ${built.tams} tams in ${built.files} call files`);
check(built.titles.length > 1000, `the scan found the corpus (${built.titles.length} titles, ${built.tams} tams)`);
check(built.untitled === 0, 'every tam carries a title', `${built.untitled} do not`);

// ---------------------------------------------------------------- 2. the carried set, both directions
const keysOf = (text) => {
  const found = [];
  for (const m of text.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): /gm)) {
    try {
      found.push(JSON.parse(m[1]));
    } catch {
      found.push(`<unparseable key ${m[1]}>`);
    }
  }
  return found;
};
const committed = keysOf(fs.readFileSync(MODULE, 'utf8'));
const corpus = new Set(built.titles);
const fromDisk = new Set(committed);

const missing = built.titles.filter((t) => !fromDisk.has(t));
const stale = committed.filter((t) => !corpus.has(t));
const list = (xs) => xs.slice(0, 10).map((t) => JSON.stringify(t)).join(', ') + (xs.length > 10 ? `, … ${xs.length - 10} more` : '');

check(committed.length === new Set(committed).size, `no title is declared twice (${committed.length} declarations)`);
check(missing.length === 0, 'every corpus title has a constant — the reverse check the loader cannot do', missing.length ? list(missing) : '');
check(stale.length === 0, 'and every constant is a corpus title, so a dropped or retitled call cannot linger', stale.length ? list(stale) : '');
check(
  committed.length === built.titles.length && missing.length === 0 && stale.length === 0,
  `the module and the corpus are the same ${built.titles.length} titles`,
);

// ---------------------------------------------------------------- 3. the module is generated, not edited
const rendered = renderCallTitles(built);
// THE COMPARISON IS LINE-ENDING BLIND, and that is not sloppiness: `core.autocrlf=true` is set host-wide, so a
// checked-out copy of this file is CRLF while the render is LF, and a strict compare would report a difference
// that is only the checkout (§8 trap 2 — a multi-line literal that matches nothing after a `git checkout --`).
const onDisk = fs.readFileSync(MODULE, 'utf8').replace(/\r\n/g, '\n');
check(onDisk === rendered, 'the committed module is byte-identical to a fresh render (line endings aside)', onDisk === rendered ? '' : 'run `node scripts/call-titles.mjs --write`');

// ---------------------------------------------------------------- 4. the runtime guard agrees with the set
const unguarded = built.titles.filter((t) => !isCallTitle(t));
check(unguarded.length === 0, `isCallTitle() accepts all ${built.titles.length} titles`, list(unguarded));
// NEGATIVE CONTROLS. `in`/`hasOwnProperty` confusion is the plausible wrong rule, and a near-miss of a real
// title is what a typo looks like. Each must be refused by the guard and by the constant table.
check(isCallTitle('toString') === false, 'and refuses an inherited object name (`toString`), which `in` would allow');
check(isCallTitle('Promenade Hom') === false, 'and refuses a near-miss of a real title (`Promenade Hom`)');
check(isCallTitle('') === false, 'and refuses the empty string');
check(Object.keys(CALL_TITLE).length === built.titles.length, `the runtime table holds the same ${built.titles.length} keys`);
// The value is what an app passes to the engine, so it must BE the key, not a copy that could drift.
const mismatched = Object.entries(CALL_TITLE).filter(([k, v]) => k !== v);
check(mismatched.length === 0, 'every value is its own key, so an escaped title reads back as the XML carried it', list(mismatched.map(([k]) => k)));

// ---------------------------------------------------------------- 5. the engine's OWN tables, against the vocabulary
//
// THE SECOND HALF OF THE REVERSE CHECK. A title-keyed statement that resolves to nothing is silent: a
// permission rule naming a call the corpus dropped can never fire, and a synonym pointing at a dead name keeps
// mapping its spelling to itself. Both are asked at RUNTIME, and for the synonyms that is a measurement rather
// than laziness — `CALL_SYNONYMS` gains seven `Eight Chain N` entries from a loop, so `Record<string,
// CallTitle>` could not describe it without a cast: MEASURED, 7 of its 19 entries are computed. The compiled
// table is what ships; a type would only see the literal part of it.
//
// THE EMITTERS ARE NOT CHECKED HERE. `getout-conformance.mjs` already resolves every token value against the
// catalogue, the scoped-selection path and `KNOWN_CATALOGUE_GAPS`, and a second implementation of that rule
// would be a second answer to one question (§11.4.4).
const deadSynonyms = Object.entries(CALL_SYNONYMS).filter(([, target]) => !isCallTitle(target));
check(
  deadSynonyms.length === 0,
  `every one of the ${Object.keys(CALL_SYNONYMS).length} call synonyms points at a title`,
  list(deadSynonyms.map(([from, to]) => `${from} -> ${to}`)),
);
const ruleCalls = PERMISSION_RULES.flatMap((rule) => rule.call ?? []);
const deadRuleCalls = ruleCalls.filter((name) => !isCallTitle(name));
check(ruleCalls.length > 0, `the permission table was read (${PERMISSION_RULES.length} rules, ${ruleCalls.length} call names)`);
check(deadRuleCalls.length === 0, 'every permission-rule call name is a title — a rule naming a dropped call can never fire', list(deadRuleCalls));

console.log(`\ncall-titles: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
