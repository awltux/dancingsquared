// Probe: THE APP SHOWS THE BOARD'S FORMATION ID, where a name does not reach.
//
// The engine has an identity for every board (`formation-id.ts`, `Sequencer.boardIdentity`); this pins that the
// APP uses it rather than leaving it as a value only a probe can see. The reported gap it answers is the mirror
// of the one the id was built for: a caller looking at an unnamed board had nothing to quote, and a permission
// rule for that board could not be written down at all.
//
// WHAT IS CHECKED, AND WHAT THAT COSTS. The engine half calls `boardIdentity` and `formationId` - the real
// functions - over a named board, an unnamed one and an embedded authoring setup. The PANEL half is WIRING,
// pinned by reading the sources, because `sequencer-ui.ts` and `browser.ts` import `three` and touch the DOM and
// cannot be loaded here. That is the same trade `offer-permission-probe.mjs` makes and states: a wiring check
// catches the id being dropped or shown from a second computation, and it does NOT catch a rendered line being
// wrong.
//
// Run: node poc/tools/formation-id-ui-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg + (detail ? '\n        ' + detail : '')); }
};

const assets = corpusRoot();
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const { callsByTitle } = await import('../../engine/test/lib/engine-calls.mjs');
const seq = new engine.Sequencer(asset('moves.xml'), asset('formations.xml'), callsByTitle(assets));
seq.setActiveLevel('ms');

const ID = /^F3-[0-9a-z]{8}$/;

/** An authored `<tam>`'s START board - the setups `formations.xml` does not carry. */
const authoringStart = (title, from) => {
  const v = (seq.matchableVariants(title) ?? []).find((x) => (x.from || x.formation) === from);
  if (!v) return null;
  return {
    dancers: v.dancers.map((d, i) => {
      const p = engine.poseFor(d, 0);
      return { id: i + 1, couple: 0, gender: d.gender ?? 'boy', x: p.x, y: p.y, heading: p.heading };
    }),
  };
};

console.log('== 1. the value the panel shows is the engine\'s own ==');
{
  const square = seq.boardForFormation('Static Square');
  const keys = seq.boardIdentity(square);
  check(keys.id === engine.formationId(square), `a named board: boardIdentity.id IS formationId(board) (${keys.id})`);
  check(keys.name === 'Static Square', `and it still carries the name (${JSON.stringify(keys.name)})`);
  check(ID.test(keys.id), 'and the id is the "F3-" eight-character shape the panel will print');
}

console.log('\n== 2. the case the id exists for: a board with no name ==');
{
  const wave = authoringStart('Swing Thru', 'Right-Hand Wave');
  check(!!wave, 'a `Right-Hand Wave` authoring setup is on the board (a missing starter is a FAILURE, not a skip)');
  if (wave) {
    const keys = seq.boardIdentity(wave);
    check(keys.name === null, `no namer names it (name ${JSON.stringify(keys.name)})`);
    check(ID.test(keys.id), `and it still has an identity to show and to key on (${keys.id})`);
    // THE POINT OF THE READOUT: `boardIdentity` for this board has nothing to name, so the ONLY non-empty
    // thing the panel can say about what shape it is, is the id.
    check(keys.name === null && keys.id.length > 0, 'so the id is the only identity the readout can show');
  }
}

console.log('\n== 3. the wiring: the panel reads it from boardIdentity and renders it ==');
{
  const ui = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8').replace(/\r\n/g, '\n');
  const browser = fs.readFileSync(path.join(POC, 'src', 'browser.ts'), 'utf8').replace(/\r\n/g, '\n');
  check(/export interface BoardRead \{[\s\S]*?\bname: string \| null;[\s\S]*?\bid: string;/.test(ui),
    '`BoardRead` declares the id, so a caller can read it off the same read as the name');
  check(/readBoard\(board: Board\): BoardRead \{[\s\S]*?id: this\.seq\.boardIdentity\(board\)\.id,/.test(ui),
    'and `readBoard` fills it from `boardIdentity` - the ONE call the permission layer makes, not a second computation');
  // BOTH BRANCHES OF THE END-FORMATION LINE: a named board shows the id beside the name, and an unnamed one
  // shows it in place of a name. The second is what the id was built for, and it is a separate line of code,
  // so it is a separate check.
  check(/bits\.push\(`<code>\$\{esc\(read\.id\)\}<\/code>`\);/.test(browser),
    'the end-formation readout prints the id for a NAME and for an UNNAMED board alike');
  check(/not named[\s\S]{0,400}bits\.push\(`<code>\$\{esc\(read\.id\)\}<\/code>`\);/.test(browser),
    '…including the unnamed case, where it is the only identity on the line');
  // IT IS ESCAPED. An id is generated from a hex-like alphabet, so this is defence in depth rather than a live
  // hole - but the rule for every authored value on that line is one rule, and a bare interpolation here would
  // be the second convention.
  check(!/\$\{read\.id\}/.test(browser), 'and every rendering of it goes through `esc`');
  check(/const id = this\.seq\.boardIdentity\(from\)\.id;[\s\S]{0,200}esc\(id\)/.test(ui),
    'the sequencer board chip shows the START board\'s id too, read from the same call');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
