// THE ORDER A CALL LIST IS SHOWN IN - `<name> <fraction>[ <end>]`, and not alphabetical.
//
// ReportED as: "Add a better sorting algorithm to the lists of calls, currently its alphanumeric, but this results in
// ordering that doesnt make sense. This mainly revolves around the naming conventions and use of fractions in the
// titles", with the wanted order given exactly:
//
//     Circle Left, Circle Left 3/4, Circle Left 1/2, Circle Left 1/4,
//     Circle Left Home, Circle Left 3/4 Home, Circle Left 1/2 Home, Circle Left 1/4 Home
//
// WHAT IS MEASURED, and the alternative each check rules out:
//   1. the wish list above, reproduced from a SHUFFLED input, title for title (the alternative - the alphabetical
//      order the app had - is measured to fail it, and is printed so the difference is visible rather than asserted);
//   2. the real corpus, all 2197 titles: sorted with the comparator the list is a PERMUTATION of the input (nothing
//      lost or duplicated), every ADJACENT pair is in order by the comparator's own answer, and that answer is a
//      TOTAL order - `sign(a<b) === -sign(b<a)` and transitivity over a sample - because a comparator that returns
//      0 or NaN inconsistently makes Array.prototype.sort depend on the array's length, silently;
//   3. the corpus's own CIRCLE families come out in the wish order, and the PROMENADE family - the other family with
//      `Home` authorings - reads the same way, so the rule is a rule rather than a list of eight names;
//   4. WHAT IS LEFT ALONE: a trailing INTEGER is a count, not a turn, so `Square Thru 2 / 2 1/2 / 3 / 4` keeps its
//      natural ascending reading instead of being run backwards like the fractions;
//   5. the parse itself: `Home` is stripped BEFORE the fraction (a title like `Circle Left 3/4 Home` ends with
//      `Home`), the fraction must be a PROPER part of a turn, and a trailing word that is part of the call's name
//      (`1/2 Recycle`) is NOT treated as an end.
//
// Run: node tools/call-order-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { compareCallTitles, parseCallTitle } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'call-order.ts')).href);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};

// ---------------------------------------------------------------- 1. the reported wish list
console.log('\n== 1. the order the report asked for ==');
const WANTED = [
  'Circle Left',
  'Circle Left 3/4',
  'Circle Left 1/2',
  'Circle Left 1/4',
  'Circle Left Home',
  'Circle Left 3/4 Home',
  'Circle Left 1/2 Home',
  'Circle Left 1/4 Home',
];
{
  // Shuffled deterministically, so the check is a SORT and not a re-statement of the input's own order.
  const shuffled = [WANTED[4], WANTED[0], WANTED[7], WANTED[3], WANTED[6], WANTED[1], WANTED[5], WANTED[2]];
  check(JSON.stringify(shuffled) !== JSON.stringify(WANTED), 'the witness really is shuffled, so the check below is a sort');
  const sorted = [...shuffled].sort(compareCallTitles);
  check(JSON.stringify(sorted) === JSON.stringify(WANTED), `the eight Circle Left authorings sort exactly as reported`, JSON.stringify(sorted));
  const alpha = [...shuffled].sort((a, b) => a.localeCompare(b));
  check(JSON.stringify(alpha) !== JSON.stringify(WANTED), `NEGATIVE CONTROL: alphabetical order does not, and it is what the app did (${alpha.join(' | ')})`);
  // The two specific defects alphabetical has: the fractions are neither ascending nor descending, and `Home` is
  // interleaved between two of them.
  const circle = [...shuffled].sort((a, b) => a.localeCompare(b));
  check(circle.indexOf('Circle Left 1/2') < circle.indexOf('Circle Left 3/4') && circle.indexOf('Circle Left 1/4') < circle.indexOf('Circle Left 3/4'),
    'and its fractions read 1/2, 1/4, 3/4 - the character order, not a turn order');
  check(circle.indexOf('Circle Left 1/2 Home') < circle.indexOf('Circle Left 1/4'),
    'while it files `... 1/2 Home` BETWEEN `... 1/2` and `... 1/4`, so the eight authorings interleave instead of reading as two groups of four - which is what the wish list fixes');
}

// ---------------------------------------------------------------- 2 & 3. the real corpus
console.log('\n== 2. the corpus: a total order over every title the app lists ==');
const titles = new Set();
for (const level of fs.readdirSync(path.join(ROOT, 'assets'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'src')
  .map((d) => d.name)) {
  for (const f of fs.readdirSync(path.join(ROOT, 'assets', level)).filter((x) => x.endsWith('.xml'))) {
    let tams;
    try {
      tams = engine.parseCallXml(fs.readFileSync(path.join(ROOT, 'assets', level, f), 'utf8'));
    } catch {
      continue;
    }
    for (const tam of tams) if (tam.title) titles.add(tam.title);
  }
}
const all = [...titles];
console.log(`    ${all.length} distinct call titles over every level the corpus has`);
const input = [...all];
const sorted = [...all].sort(compareCallTitles);

check(sorted.length === input.length && JSON.stringify([...sorted].sort()) === JSON.stringify([...input].sort()),
  `the sorted list is the same ${sorted.length} titles - a permutation, nothing dropped or duplicated`);
const outOfOrder = sorted.filter((t, i) => i > 0 && compareCallTitles(sorted[i - 1], t) > 0);
check(outOfOrder.length === 0, `and every adjacent pair is in order by the comparator itself (${outOfOrder.length} out of place)`,
  outOfOrder.slice(0, 3).join(' , '));
// ANTISYMMETRY, over a stride through the sorted list plus every adjacent pair: `sign(a,b)` must be `-sign(b,a)`. A
// comparator that answers 0 one way and -1 the other makes the sort's result depend on the array's length and the
// engine's insertion-sort threshold, which is a bug that survives every small test.
{
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 53) for (let j = 0; j < sorted.length; j += 47) pairs.push([sorted[i], sorted[j]]);
  for (let i = 1; i < sorted.length; i++) pairs.push([sorted[i - 1], sorted[i]]);
  const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
  const wrong = pairs.filter(([a, b]) => sign(compareCallTitles(a, b)) !== -sign(compareCallTitles(b, a)));
  check(wrong.length === 0, `the comparator is ANTISYMMETRIC over ${pairs.length} pairs, so the sort cannot oscillate`,
    wrong.slice(0, 3).map(([a, b]) => `${a} / ${b}`).join(' | '));
}

// TRANSITIVITY over every pair of a sample, which is the property a comparator has to have for a sort to be defined at
// all. Taken over the titles that share a base with another title - the families the rule is about - plus a stride
// through the rest, because comparing all 2197^2 would be 5M localeCompare calls.
{
  const families = new Map();
  for (const t of sorted) {
    const base = parseCallTitle(t).base;
    if (!families.has(base)) families.set(base, []);
    families.get(base).push(t);
  }
  const sample = [...[...families.values()].filter((g) => g.length > 1).flat()];
  for (let i = 0; i < sorted.length; i += 37) sample.push(sorted[i]);
  let tested = 0;
  let violations = 0;
  for (let i = 0; i < sample.length; i += 1) {
    for (let j = i + 1; j < sample.length; j += 7) {
      for (const pivot of sample.slice(0, 6)) {
        tested++;
        const ab = compareCallTitles(sample[i], sample[j]);
        const ap = compareCallTitles(sample[i], pivot);
        const pb = compareCallTitles(pivot, sample[j]);
        // a < b, and a >= p, p >= b would be a cycle.
        if (ab < 0 && ap >= 0 && pb >= 0) violations++;
      }
    }
  }
  check(violations === 0, `and it is TRANSITIVE over ${tested} sampled triples (${violations} cycles) - a comparator that is not makes V8's sort answer differently for different array lengths`);
}

// ---------------------------------------------------------------- 4. the families
console.log('\n== 3. the corpus families read the way the report asked ==');
{
  const family = (re) => sorted.filter((t) => re.test(t));
  const circleLeft = family(/^Circle Left( |$)/);
  check(JSON.stringify(circleLeft) === JSON.stringify(WANTED), 'the corpus\'s own Circle Left family sorts into the reported order, from the whole corpus rather than a fixture', JSON.stringify(circleLeft));
  const promenade = family(/^Promenade( |$)/);
  const promenadeWant = [
    'Promenade',
    'Promenade 3/4',
    'Promenade 1/2',
    'Promenade 1/4',
    'Promenade Home',
    'Promenade 3/4 Home',
    'Promenade 1/2 Home',
    'Promenade 1/4 Home',
  ].filter((t) => promenade.includes(t));
  check(promenadeWant.length >= 6 && JSON.stringify(promenade) === JSON.stringify(promenadeWant),
    `and so does Promenade, the other family with Home authorings (${promenade.length} titles)`, JSON.stringify(promenade));
  check(promenade.includes('Promenade 3/4 Home') && promenade.indexOf('Promenade Home') < promenade.indexOf('Promenade 3/4 Home'),
    'with the plain Home before the fractioned Home, which is the second half of the reported rule');
}

// ---------------------------------------------------------------- 5. what is deliberately left alone
console.log('\n== 4. a trailing INTEGER is a count, not a turn ==');
{
  const sq = sorted.filter((t) => /^Square Thru( |$)/.test(t));
  const hands = sq.filter((t) => /\b(2|3|4)\b/.test(t) || /1 1\/2/.test(t));
  const order = hands.map((t) => t.replace(/^Square Thru /, ''));
  check(hands.indexOf('Square Thru 2') < hands.indexOf('Square Thru 3') && hands.indexOf('Square Thru 3') < hands.indexOf('Square Thru 4'),
  `Square Thru 2 / 3 / 4 stay in ASCENDING hand order, where the fraction rule would have run them backwards (${order.join(' | ')})`);
  check(hands.indexOf('Square Thru 2') < hands.indexOf('Square Thru 2 1/2') && hands.indexOf('Square Thru 2 1/2') < hands.indexOf('Square Thru 3'),
    'and a fraction refines the count it belongs to: 2, then 2 1/2, then 3');
}

// ---------------------------------------------------------------- 6. the parse
console.log('\n== 5. the parts the order is built from ==');
{
  const cases = [
    ['Circle Left 3/4 Home', { base: 'Circle Left', end: 'Home', fraction: 0.75 }],
    ['Circle Left 3/4', { base: 'Circle Left', end: '', fraction: 0.75 }],
    ['Circle Left Home', { base: 'Circle Left', end: 'Home', fraction: null }],
    ['Circle Left', { base: 'Circle Left', end: '', fraction: null }],
    ['Square Thru 2 1/2', { base: 'Square Thru 2', end: '', fraction: 0.5 }],
    ['Square Thru 2', { base: 'Square Thru 2', end: '', fraction: null }],
    ['Recycle 1/2', { base: 'Recycle', end: '', fraction: 0.5 }],
  ];
  for (const [title, want] of cases) {
    const got = parseCallTitle(title);
    check(JSON.stringify(got) === JSON.stringify(want), `"${title}" is ${JSON.stringify(want)}`, JSON.stringify(got));
  }
  // The end word is stripped FIRST because it is the outermost part; if the fraction went first, `… 3/4 Home` would
  // keep `3/4` in its base and sort away from its own family. That is measured here by the family check above, but the
  // direct statement is cheap.
  check(parseCallTitle('Circle Left 3/4 Home').base === 'Circle Left', 'the END is stripped before the fraction, so `… 3/4 Home` keeps the family name as its base');
  // A trailing word that is part of the call's own name is NOT an end: 9 corpus titles put a fraction in front of
  // `Mix`, 10 in front of `Recycle`, and those are one call name rather than `<fraction> + end`.
  check(parseCallTitle('Half Mix').base === 'Half Mix' && parseCallTitle('Recycle 1/2').end === '',
    'a word after the fraction that is part of the call\'s name is not treated as an end');
  // An IMPROPER or compound fraction is not a turn: `2/1` would be a count.
  check(parseCallTitle('Something 2/1').fraction === null, 'an improper fraction (`2/1`) is left in the base - it is not a part of a turn');
  check(parseCallTitle('Something 1 1/2').base === 'Something 1' && parseCallTitle('Something 1 1/2').fraction === 0.5,
    'a compound `1 1/2` is read as the count `1` refined by `1/2`, which keeps it beside its own family');
}

// ---------------------------------------------------------------- 7. the wiring
console.log('\n== 6. the lists that use it ==');
{
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const data = read('poc/src/data.ts');
  const seq = read('poc/src/sequencer-ui.ts');
  check(/return l !== 0 \? l : compareCallTitles\(a\.title, b\.title\);/.test(data),
    'the catalog - which every list in the app is built from (browse, Call editor) - sorts titles with the comparator');
  check(/legalNext\(\)\.sort\(compareCallTitles\)/.test(seq) && /sort\(compareCallTitles\)/.test(seq),
    'and the sequencer\'s next-call list and its write-while list do too, rather than each spelling out a comparison');
  check(!/title\.localeCompare\(/.test(data), 'the alphabetical title comparison is gone from the catalog rather than left beside the new one');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
