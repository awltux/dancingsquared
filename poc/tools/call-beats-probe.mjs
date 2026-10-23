// Probe: THE BEATS IN THE CALL PICKER - "16 - Promenade Full".
//
// Asked for as: "Sequencer: Display the beats for each call in the Call selection e.g. '16 - Call name'".
//
// WHAT MAKES THIS WORTH A GATE rather than a line of DOM: the number has to be the one the SEQUENCER will
// charge, which means it depends on two things the label could get wrong - the BOARD the call would run on
// (in parallel mode the remainder's lane, not the live board) and the NAME Apply will use (the chosen
// group's prefix included). And the option's VALUE must stay the bare call name, because Apply, the
// previous-pick restore and the parallel lane all read it back.
//
// The panel cannot be executed here (`sequencer-ui.ts` is TypeScript inside Vite), so the wiring is READ,
// like `escape-probe.mjs` and `parallel-lane-probe.mjs`. The ENGINE half - that `stepBeats` for the
// group-prefixed name is the number of beats the step is charged - is measured against the built engine.
//
// Run: node poc/tools/call-beats-probe.mjs   (from anywhere; build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

console.log('== the picker labels each option with its beats ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'sequencer-ui.ts'), 'utf8');
  const bodyOf = (header) => {
    const i = ui.indexOf(header);
    if (i < 0) return '';
    const j = ui.indexOf('\n  }', i);
    return ui.slice(i, j);
  };
  const picker = bodyOf('private refreshCallSelect()');
  check(/new Option\(display\(n\), n\)/.test(picker),
    'the option\'s LABEL is what `display` builds and its VALUE is the bare call name - readers of the list take `callSelect.value` as a call');
  check(/\$\{this\.seq\.stepBeats\(board, group \? `\$\{group\} \$\{n\}` : n\)\} - \$\{n\}/.test(picker),
    'the number is `stepBeats` on THE BOARD the offer is about, for THE NAME APPLY WILL USE - the chosen group\'s prefix included');
  check(/const board = this\.parallel \? this\.parallel\.board : this\.seq\.board;/.test(picker),
    'and that board is the parallel mode\'s lane board when the mode is on, which is where the next call would run');
  check(/addGroup\(`Subset: \$\{sel\}`, names, \(n\) => `\$\{this\.seq\.stepBeats\(board, n\)\} - \$\{n\}`\)/.test(picker),
    'a subset entry (offered only with no group chosen) shows its own full name\'s beats, which is the name Apply uses there');
  // THE FILTER IS A VIEW OVER THE SAME LISTS: it narrows the names that reach `addGroup`, and it can never
  // drop the call the control is showing (`filterNames` keeps it), so the beats a caller reads are still the
  // beats of the step Apply would charge.
  check(/const wholeShown = filterNames\(whole, query, keep\)/.test(picker)
    && /const modulesShown = filterNames\(modules, query, keep\)/.test(picker),
    'the Filter narrows the offered names with the shared rule, keeping the selected call in the list');
  check(/\$\{this\.seq\.sequenceBeats\(this\.seq\.flatten\(\[n\]\), this\.seq\.board\)\} - \$\{n\}/.test(picker),
    'a MODULE is offered with its whole sequence\'s beats (`sequenceBeats` of its flattened steps), not a call lookup that would read 0');
  // THE GROUP-LABEL FUNCTION IS THE ONLY PLACE OPTIONS ARE MADE, so no entry can bypass the label.
  check((picker.match(/new Option\(/g) ?? []).length === 2,
    `every option in the list is built in one of the two places that carry the label (${(picker.match(/new Option\(/g) ?? []).length} found: the placeholder and the group builder)`);
  check(/new Option\(group \? `— call for \$\{group\} —` : '— valid next call —', ''\)/.test(picker),
    'while the placeholder keeps its plain text and its empty value');
}

console.log('\n== and the number is the one the sequencer charges ==');
{
  // THE ENGINE HALF: `stepBeats` for a group-prefixed name is what the step costs, so the label cannot be
  // showing one thing and the scrub charging another. `Heads Promenade` is the report's own shape (16
  // beats) and `Heads Trade` its short partner (4). The report called it `Heads Promenade Full`; the
  // corpus renamed that tam to the CALLERLAB `Promenade` (the call ends in the Promenade formation,
  // and `Promenade Home` is the one that ends in the squared set), so the name here follows it.
  const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
  const { DOMParser } = await import('@xmldom/xmldom');
  const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
  engine.setParser(DOMParser);
  const assets = corpusRoot();
  const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
  const seq = new engine.Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(assets));
  const square = seq.boardForFormation('Static Square');
  for (const [name, want] of [['Heads Promenade', 16], ['Heads Trade', 4], ['Heads Touch a Quarter', 2]]) {
    const shown = seq.stepBeats(square, name);
    seq.setBoard(square);
    const charged = seq.sequenceBeats([name], square);
    console.log(`    "${want} - ${name}": stepBeats ${shown}, sequenceBeats ${charged}`);
    check(shown === want && charged === want,
      `the label for "${name}" is ${want} beats, which is what the step is CHARGED (${charged}) - not an estimate`);
  }
  // AND THE BARE AND GROUP READINGS ARE MEASURED TOGETHER, because the prefix is not a decoration and is not
  // always a difference in BEATS: for these witnesses the two agree, so what the prefix settles is which step
  // the number describes (and, elsewhere, whether the call is offered at all - `Trade` refuses its bare name).
  console.log(`    (the bare "Promenade" reads ${seq.stepBeats(square, 'Promenade')} from the same board, so the prefix does not change this one's number - it fixes WHICH step the number is about)`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
