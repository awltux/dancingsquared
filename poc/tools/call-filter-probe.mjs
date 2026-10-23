// Probe: THE BROWSE TAB'S CALL FILTER narrows the Call list without changing what is loaded.
//
// Asked for: "in browse call, add a call filter text box above the Call element that filters the contents of the
// Call select element."
//
// The rule is a pure function (`poc/src/call-filter.ts`), so this runs it over the REAL catalogue rather than
// reading the panel's source: what it has to prove is that a filter is a VIEW - it narrows what is offered and
// never decides what is on the board - and that the panel cannot end up naming one call while showing another.
//
// Run: node poc/tools/call-filter-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const { filterCalls, matchCount, filterNames } = await import('./../src/call-filter.ts');
const assets = corpusRoot();
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');

console.log('== the rule ==');
const calls = [
  { id: 'ms/circle::Circle Left', title: 'Circle Left', level: 'ms' },
  { id: 'ms/circle::Circle Right', title: 'Circle Right', level: 'ms' },
  { id: 'ms/swing::Swing Thru', title: 'Swing Thru', level: 'ms' },
  { id: 'ssd/pass::Pass Thru', title: 'Pass Thru', level: 'ssd' },
];
check(filterCalls(calls, '', 'ms/swing::Swing Thru').length === 4, 'an empty filter offers every call');
check(filterCalls(calls, 'circle', '').length === 2, 'a query matches on a case-insensitive substring of the title');
check(filterCalls(calls, 'CIRCLE', '').length === 2, 'and the case does not matter');
check(filterCalls(calls, 'thru', '').length === 2, 'a query can match the middle of a name');
check(JSON.stringify(filterCalls(calls, 'circle', '').map((c) => c.id)) === JSON.stringify([calls[0].id, calls[1].id]),
  'and the catalogue order is kept, so the list reads the same filtered or not');
check(filterCalls(calls, 'zzz', '').length === 0, 'a query matching nothing offers nothing - when nothing is selected');
// THE RULE THAT KEEPS THE PANEL HONEST.
const kept = filterCalls(calls, 'zzz', 'ms/swing::Swing Thru');
check(kept.length === 1 && kept[0].id === 'ms/swing::Swing Thru',
  'but the call that is LOADED is always in the list, so the dropdown cannot move off the call on the board');
const mid = filterCalls(calls, 'circle', 'ms/swing::Swing Thru');
check(mid.length === 3 && mid.filter((c) => c.id === 'ms/swing::Swing Thru').length === 1,
  'and it stays in the list when a query matches something else');
// WHERE it sits is the point: appending the kept call would put it at the end every time, so the list would
// read in a different order depending on which call happened to be loaded.
const interleaved = [
  { id: 'a', title: 'Circle Left', level: 'ms' },
  { id: 'b', title: 'Swing Thru', level: 'ms' },
  { id: 'c', title: 'Circle Right', level: 'ms' },
];
check(JSON.stringify(filterCalls(interleaved, 'circle', 'b').map((c) => c.id)) === JSON.stringify(['a', 'b', 'c']),
  'and it keeps its own place in the catalogue order rather than being pushed to the end');
check(calls.length === 4 && filterCalls(calls, 'circle', '').length === 2, 'the input list is not mutated');
check(matchCount(calls, 'circle') === 2 && matchCount(calls, 'zzz') === 0 && matchCount(calls, '') === 4,
  'the count the box reports is the number of real matches, not the size of the list it keeps');

console.log('\n== the same rule over plain call NAMES, which is what the sequencer\'s picker holds ==');
// The sequencer offers bare names (no id/title/level), so it filters with `filterNames` - and the two pickers
// must narrow the same way, or the panel has two answers to "what does typing do".
const names = ['Circle Left', 'Circle Right', 'Swing Thru', 'Pass Thru', "Heads Promenade Full"];
check(JSON.stringify(filterNames(names, '', 'X')) === JSON.stringify(names), 'an empty query offers every name');
check(JSON.stringify(filterNames(names, 'circle', 'X')) === JSON.stringify(['Circle Left', 'Circle Right']),
  'a query matches a case-insensitive substring of the name');
check(JSON.stringify(filterNames(names, 'CIRCLE', 'X')) === JSON.stringify(['Circle Left', 'Circle Right']),
  'and the case does not matter');
check(JSON.stringify(filterNames(names, 'zzz', 'Swing Thru')) === JSON.stringify(['Swing Thru']),
  'but the name the picker is SHOWING is always kept, so the control cannot leave the call the board has');
check(JSON.stringify(filterNames(names, 'zzz', 'not in the list')) === JSON.stringify([]),
  'and a query matching nothing offers nothing when nothing needs keeping');
check(names.length === 5 && filterNames(names, 'circle', '').length === 2, 'the input list is not mutated');
// THE ORDER IS THE ENGINE'S, which is what makes the beats label beside each name readable: a filter that
// re-sorted would move every entry the caller had just learned the position of.
check(JSON.stringify(filterNames(names, 'thru', '')) === JSON.stringify(['Swing Thru', 'Pass Thru']),
  'and the order is preserved, so the list reads the same filtered or not');

console.log('\n== against the real catalogue ==');
// The same walk `data.ts` does, so the sample is the catalogue rather than four invented rows.
const real = [];
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  let tams;
  try { tams = engine.parseCallXml(asset(`ms/${f}`)); } catch { continue; }
  for (const t of tams) {
    const title = t.title || `ms/${f}`;
    const id = `ms/${f}::${title}`;
    if (!real.some((c) => c.id === id)) real.push({ id, title, level: 'ms' });
  }
}
const selected = real.find((c) => c.title === 'Swing Thru') ?? real[0];
let narrowed = 0;
const seen = new Set();
for (const c of real) {
  const one = filterCalls(real, c.title, selected.id);
  if (one.some((x) => x.id === selected.id)) narrowed++;
  seen.add(one.length);
}
console.log(`    ${real.length} calls, one query per call: ${narrowed} kept the loaded call in the list`);
check(real.length > 200, 'the sample is the catalogue, not a witness');
check(narrowed === real.length, 'EVERY query, including ones that match nothing, keeps the loaded call - which is the invariant, not a spot check');
check(seen.size > 1, 'and the list does get shorter for some queries, so this is a filter and not a no-op');
const swung = filterCalls(real, 'swing', selected.id);
console.log(`    "swing" offers ${swung.length} of ${real.length} calls (first: ${swung[0]?.title})`);
check(swung.length > 0 && swung.length < real.length, 'a real query narrows a real catalogue');
check(filterCalls(real, 'pass thru', selected.id).every((c) => c.title.toLowerCase().includes('pass thru') || c.id === selected.id),
  'and what is offered is exactly the matches (plus the loaded call)');

console.log('\n== the wiring ==');
const html = fs.readFileSync(path.join(POC, 'index.html'), 'utf8');
const browser = fs.readFileSync(path.join(POC, 'src', 'browser.ts'), 'utf8');
check(/<div class="row">\s*<label for="callFilter"[\s\S]{0,400}<input id="callFilter"/.test(html), 'the filter box is in the panel');
check(html.indexOf('id="callFilter"') < html.indexOf('id="callSelect"'), 'and it is ABOVE the Call element, which is where it was asked for');
check(/this\.callFilter\.addEventListener\('input', \(\) => this\.renderCallOptions\(\)\);/.test(browser),
  'typing re-renders the options and nothing else - the filter is a view, not a load');
check(!/callFilter\.addEventListener\('input'[\s\S]{0,120}(loadCurrent|onCallChange)\(/.test(browser),
  'and it does NOT reload the call, which is what would throw away the caller\'s place on every keystroke');
check(/const shown = filterCalls\(this\.levelCalls, this\.callFilter\.value, this\.callSelect\.value \|\| keepFile \|\| ''\);/.test(browser),
  'the options come from the one filtered list, with the loaded call passed in as the one to keep');
check(/private levelCalls: CallInfo\[\] = \[\];/.test(browser) && /this\.levelCalls = level \? this\.catalog\.filter/.test(browser),
  'the LEVEL\'s calls are held once, so the filter narrows the level rather than re-deriving the catalogue');
check(/this\.callSelect\.value = shown\[0\]\.id;/.test(browser),
  'and when the loaded call is not in the list at all the first match is selected, rather than the select keeping a value no option carries');
// THE SEQUENCER'S OWN FILTER, on the same rule. Its box sits above its Call element for the same reason, and
// typing re-renders the options and touches nothing else - the picker is the only thing a filter may change.
const seq = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
check(html.indexOf('id="seqCallFilter"') > 0 && html.indexOf('id="seqCallFilter"') < html.indexOf('id="seqCallSelect"'),
  'the sequencer has a filter box too, ABOVE its Call element');
check(/this\.callFilterInput\.addEventListener\('input', \(\) => this\.refreshCallSelect\(\)\);/.test(seq),
  'and typing rebuilds the picker and nothing else');
check(/const wholeShown = filterNames\(whole, query, keep\);/.test(seq)
  && /filterNames\(bySel\.get\(k\)!, query, keep\)/.test(seq)
  && /const modulesShown = filterNames\(modules, query, keep\);/.test(seq),
  'every list the picker offers is narrowed by the one shared rule, including the kept selection');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
