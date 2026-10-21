// ONE PLACE THAT READS A CALL NAME: every branch of the search order, pinned with a case and a negative control.
//
// WHY A GATE AND NOT A COMMENT. The resolver's steps are ordered for reasons that only a measurement can hold
// (the header of `engine/src/sequencer/call-name.ts` states them). A gate that pins a case per step is what
// makes a reordering fail loudly instead of silently moving a name from "title" to "alias" — and the two
// failure modes this repo keeps paying for are exactly that: a name that resolves to something nobody authored,
// and an answer that says more than it measured. So every check here names the STEP it pins, and the
// `tried` list is asserted rather than tested for truthiness: a refusal that does not say what it tried is a
// refusal nobody can act on.
//
// Usage: node engine/test/call-names.mjs   (engine must be built: it imports the resolver from dist)
import { CALL_ALIAS, CALL_SYNONYMS, CALL_TITLE, isCallTitle, readCallName } from '../dist/index.js';

let failures = 0;
const check = (ok, what, detail = '') => {
  if (!ok) {
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`);
    failures++;
  } else console.log(`  ok   ${what}`);
};

console.log('call-names: reading a raw call string, one branch at a time\n');

// ---------------------------------------------------------------- 1. the tables the resolver reads
console.log('== 1. the dictionaries are disjoint from the titles ==');
const titles = Object.keys(CALL_TITLE);
// A KEY THAT IS ALSO A TITLE IS DEAD WEIGHT: the title step answers first, so the alias never fires and the
// entry reads as if it were doing something. This is also the check that makes the promenade alias removable
// when that family's spelling changes — it will start failing the day the corpus authors `Promenade Home`.
const aliasKeyIsTitle = Object.keys(CALL_ALIAS).filter((k) => isCallTitle(k));
const synonymKeyIsTitle = Object.keys(CALL_SYNONYMS).filter((k) => isCallTitle(k));
check(aliasKeyIsTitle.length === 0, `${Object.keys(CALL_ALIAS).length} alias key(s), none of them already a title`, aliasKeyIsTitle.join(', '));
check(synonymKeyIsTitle.length === 0, `${Object.keys(CALL_SYNONYMS).length} synonym key(s), none of them already a title`, synonymKeyIsTitle.join(', '));
const deadTargets = [...Object.entries(CALL_ALIAS), ...Object.entries(CALL_SYNONYMS)].filter(([, to]) => !isCallTitle(to));
check(deadTargets.length === 0, 'every alias and synonym points at a title', deadTargets.map(([f, t]) => `${f} -> ${t}`).join(', '));

// ---------------------------------------------------------------- 2. every title reads back as itself
console.log('\n== 2. no step shadows a title ==');
// THE POSITIVE CONTROL FOR THE WHOLE ORDER: 2190 titles, each read back. A suffix rule or an alias that stole
// one would show up here as a different title, and a step added ahead of the title step would break it.
const stolen = titles.filter((t) => readCallName(t).title !== t);
check(titles.length > 1000 && stolen.length === 0, `all ${titles.length} titles read back as themselves`, stolen.slice(0, 5).join(', '));

// ---------------------------------------------------------------- 3. one case per branch
console.log('\n== 3. the branches, each with the step it must report ==');
const cases = [
  // [input, expected title, expected selection, expected How]
  ['Promenade', 'Promenade', null, 'title'],
  ['  PROMENADE  ', 'Promenade', null, 'title'], // folded: case and runs of whitespace
  ['"O" Cross and Turn', '"O" Cross and Turn', null, 'title'], // punctuation is part of the title
  ['all around the corner, see saw your partner', 'All Around the Corner, See Saw Your Partner', null, 'title'], // ... a comma
  ['(from offset columns) "z" walk and dodge', '(From offset columns) "Z" Walk and Dodge', null, 'title'], // ... and brackets plus a quote in one name
  ['Promenade Home', 'Promenade', null, 'alias'], // the CALLERLAB description, mapped onto this corpus
  ['Promenade to Home', 'Promenade', null, 'alias'],
  ['Do Sa Do', 'Dosado', null, 'synonym'],
  ['do sa do', 'Dosado', null, 'synonym'],
  ['Heads Dosado', 'Dosado', 'Heads', 'selection'],
  ['Heads Promenade to Home', 'Promenade', 'Heads', 'selection'], // selection AND the alias, in one string
  ['Circle Left to Home', 'Circle Left Home', null, 'suffix'], // the circle family's ` Home` title suffix
  ['Promenade Keep Walking', 'Promenade - Keep Walking', null, 'suffix'], // the promenade family's
  ['--AL', 'Allemande Left', null, 'all8'],
  ['SqTh4', 'Square Thru 4', null, 'all8'],
  ['H-Pr1/2', 'Promenade 1/2', 'Heads', 'all8'], // a decoded name that is itself a SELECTION over a title
];
for (const [input, title, selection, how] of cases) {
  const r = readCallName(input);
  check(r.ok && r.title === title && r.selection === selection && r.how === how,
    `${JSON.stringify(input)} -> ${JSON.stringify(title)}${selection ? ` under ${JSON.stringify(selection)}` : ''} via ${how}`,
    JSON.stringify({ ok: r.ok, title: r.title, selection: r.selection, how: r.how }));
}

// ---------------------------------------------------------------- 4. the negatives, one per plausible wrong rule
console.log('\n== 4. the negatives: what must NOT resolve, and why ==');
// A PUBLISHED NAME THAT BEGINS WITH A SELECTION WORD stays a name. This is the one ordering mistake that
// silently rereads a corpus title as somebody's authored selection.
const all4 = readCallName('All 4 Couples Square Thru 2 to a Wave');
check(all4.ok && all4.title === 'All 4 Couples Square Thru 2 to a Wave' && all4.selection === null,
  'a title that STARTS with a selection phrase stays a title, not a reading', JSON.stringify(all4));

// A FIGURE OF TWO CALLS IS NOT A NAME. `Sw&Pr` is `Swing Your Partner; Promenade` — both titles — and calling
// the figure "Swing Your Partner" is the mis-attribution `getout-conformance` exists to prevent.
const figure = readCallName('Sw&Pr');
check(!figure.ok && figure.tried.some((t) => /decoded 2 calls/.test(t)),
  'a two-call figure refuses, and says it decoded two calls', JSON.stringify(figure.tried.slice(-1)));

// A NAME THE CORPUS LACKS IS A REFUSAL EVEN WHEN ANOTHER NOTATION DECODES IT. `SqTh5` decodes to
// `Square Thru 5`, which `KNOWN_CATALOGUE_GAPS` declares undanceable; the refusal must SAY the decoded name
// rather than pretend it did not decode.
const gap = readCallName('SqTh5');
check(!gap.ok && gap.tried.some((t) => /Square Thru 5/.test(t)),
  '`SqTh5` decodes to `Square Thru 5` and refuses, naming the name it decoded', JSON.stringify(gap.tried.slice(-2)));

// A NEAR MISS REFUSES AND SUGGESTS, naming titles rather than guessing one.
const near = readCallName('Headz Promenade');
check(!near.ok && near.suggestions.length > 0 && near.suggestions.every((s) => isCallTitle(s)),
  `a near miss refuses with ${near.suggestions.length} real title(s) as suggestions`, JSON.stringify(near.suggestions));

check(!readCallName('').ok && !readCallName('zzz').ok, 'the empty string and nonsense both refuse');

// ---------------------------------------------------------------- 5. the refusals say what they tried
console.log('\n== 5. a refusal names its own search ==');
const refusals = ['Headz Promenade', 'zzz', 'SqTh5'].map((s) => readCallName(s));
check(refusals.every((r) => r.tried.length >= 2), 'every refusal listed at least two steps it tried', refusals.map((r) => r.tried.length).join(', '));
check(refusals.every((r) => r.tried[0].startsWith('title ')), 'and every one of them began with the title step', refusals[0].tried[0]);

console.log(`\ncall-names: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
