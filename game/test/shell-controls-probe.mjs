// THE SHELL'S CONTROLS: WHICH ARE PRIMARY, WHICH LIVE UNDER "MORE", AND THAT EVERY ID THE SCRIPT ASKS FOR EXISTS.
//
// REPORTED: "Some of the current buttons seem like overkill for the kind of game it's supposed to be. Perhaps some can
// be retired." MEASURED in the markup at the time: the footer drew THREE controls that are never hidden (`#view`,
// `#boardToggle`, `#startOver`) on top of up to seven mode-dependent ones, so the Daily showed ten at once and Next —
// the one action that matters — was the smallest thing on screen. Four moved into a `<details id="more">` disclosure:
// the 2D/3D switch, the leaderboard read, the auto-progress toggle and the device reset. NOTHING was deleted, so this
// probe is about PLACEMENT, and it is the only thing standing between "decluttered" and "the Hint button went missing".
//
// WHAT IT PINS, and each check has a reason to exist:
//   1. EVERY `el('id')` / `getElementById('id')` in the app's source resolves to exactly one `id="…"` in `index.html`.
//      That is the contract `ui/dom.ts` claims in its own header — "a missing one is a typo in the markup" — and until
//      now nothing checked it: `el` throws at the first property read, which is a browser-only failure (AGENTS.md
//      trap 27's family). A duplicate id is worse than a missing one, because `getElementById` silently returns the
//      first and the second copy is inert markup that still passes every screenshot.
//   2. THE CLASSIFICATION. Every PRIMARY id is outside the disclosure and every SECONDARY id is inside it. Burying the
//      Hint button and unburying the 3D switch are both failures here rather than judgement calls later.
//   3. NOTHING ELSE IS BURIED. The disclosure's `button`s are exactly the four named secondaries, so a future control
//      cannot be parked there without this list being edited in the same commit.
//
// THE NEGATIVE CONTROLS run the same two rules on synthetic markup (`whichPrimaryAreBuried`, `whichSecondaryAreLoose`),
// because a check whose subject is the real file cannot tell a rule from a coincidence: MEASURED, the parser below is
// what fails on `hint` inside the disclosure, while every real-file check stays green.
//
// Usage: node game/test/shell-controls-probe.mjs   (no engine build needed: it reads text)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const SRC = path.join(GAME, 'src');
const HTML = path.join(GAME, 'index.html');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Controls that must stay on the main surface: the moves of the game, and the way back. */
const PRIMARY = [
  'hint', 'review', 'skip', 'undo', 'redo', 'giveUp', 'replayMine', 'replayShortest', 'practice', 'next',
  'modeDrill', 'modeDaily', 'toLevel', 'levelNext', 'waypointPrev', 'waypointNext',
  'accountSignIn', 'accountSignUp', 'accountConfirm', 'accountSignOut', 'callSearch',
];
/** Controls that are set-once preferences or housekeeping, and why each one moved (also stated beside it in the markup). */
const SECONDARY = ['view', 'boardToggle', 'autoProgress', 'startOver'];

const html = fs.readFileSync(HTML, 'utf8');

/** The disclosure's text, by tag nesting depth — `<details>` may nest, so a regex to the next `</details>` is wrong. */
const blockOf = (source, id) => {
  const open = source.match(new RegExp(`<details[^>]*id="${id}"[^>]*>`, 'i'));
  if (!open) return null;
  let depth = 0;
  let i = open.index;
  for (; i < source.length; i++) {
    if (source.startsWith('<details', i)) depth++;
    else if (source.startsWith('</details', i)) {
      depth--;
      if (depth === 0) return source.slice(open.index, source.indexOf('>', i) + 1);
    }
  }
  return source.slice(open.index);
};

const more = blockOf(html, 'more');
const idsIn = (text) => [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

/** Which PRIMARY controls the disclosure has swallowed — the reported mistake, as a rule. */
const whichPrimaryAreBuried = (markup) => {
  const block = blockOf(markup, 'more');
  if (!block) return [];
  const inside = new Set(idsIn(block));
  return PRIMARY.filter((id) => inside.has(id));
};
/** Which SECONDARY controls are still loose on the main surface. */
const whichSecondaryAreLoose = (markup) => {
  const block = blockOf(markup, 'more') ?? '';
  const inside = new Set(idsIn(block));
  return SECONDARY.filter((id) => !inside.has(id));
};

console.log('\n== 1. the checks, on markup a reader can check by eye ==');
{
  const buried = `<footer><details id="more"><summary>More</summary><button id="hint">Hint</button></details><button id="next">Next</button></footer>`;
  check(whichPrimaryAreBuried(buried).join() === 'hint', 'a PRIMARY control inside the disclosure is caught (hint)');
  check(whichSecondaryAreLoose(buried).length === SECONDARY.length, 'and a SECONDARY control left outside it is caught too');
  // THE CORRECT SHAPE, built from the lists themselves so a control added to either one is exercised here too: all four
  // secondaries inside the disclosure, a primary outside it, and both rules silent.
  const good = `<footer><details id="more"><summary>More</summary>${SECONDARY.map((id) => `<button id="${id}"></button>`).join('')}</details><button id="hint">Hint</button></footer>`;
  check(whichPrimaryAreBuried(good).length === 0 && whichSecondaryAreLoose(good).length === 0, 'the right shape passes both rules');
  // A NESTED DETAILS must not fool the block reader into cutting at the inner `</details>`, or a primary control placed
  // after it reads as buried.
  const nested = `<details id="more"><summary>More</summary><details><summary>inner</summary></details><div id="startOver"></div></details><button id="hint"></button>`;
  check(whichPrimaryAreBuried(nested).length === 0, 'a nested disclosure does not end the outer one early');
  check(idsIn(blockOf(nested, 'more') ?? '').includes('startOver'), 'and the outer block still holds what follows the inner one');
}

console.log('\n== 2. every id the script asks for is in the page, exactly once ==');
{
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) sources.push(full);
    }
  };
  walk(SRC);
  const wanted = new Map();
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bel(?:<[^>]*>)?\('([^']+)'\)/g)) {
      if (!wanted.has(m[1])) wanted.set(m[1], path.relative(GAME, file).split(path.sep).join('/'));
    }
    for (const m of text.matchAll(/document\.getElementById\('([^']+)'\)/g)) {
      if (!wanted.has(m[1])) wanted.set(m[1], path.relative(GAME, file).split(path.sep).join('/'));
    }
  }
  const pageIds = idsIn(html);
  const duplicates = pageIds.filter((id, i) => pageIds.indexOf(id) !== i);
  check(wanted.size >= 60, `the walk found ${wanted.size} ids the app asks for (a zero here is a FAILURE, not a pass)`);
  check(duplicates.length === 0, `and no id appears twice in the page (${duplicates.join(', ') || 'none'})`);
  const missing = [...wanted].filter(([id]) => !pageIds.includes(id)).map(([id, from]) => `${id} (${from})`);
  check(missing.length === 0, `and every one of them exists in index.html (${missing.length} missing)`, missing.join('; '));
}

console.log('\n== 3. the real classification ==');
{
  check(more !== null, 'index.html carries the "more" disclosure');
  const buried = whichPrimaryAreBuried(html);
  check(buried.length === 0, `no PRIMARY control is inside it (${buried.join(', ') || 'none'})`, buried.join(', '));
  const loose = whichSecondaryAreLoose(html);
  check(loose.length === 0, `and every SECONDARY control is inside it (${loose.join(', ') || 'none'} loose)`, loose.join(', '));
  // THE MEMBERSHIP PIN: the disclosure holds exactly the four secondaries, so parking a fifth control in it is an edit to
  // this list in the same commit. A NAMED SET fails when it shrinks AND grows (AGENTS.md 11.2.8).
  const inBlock = idsIn(more ?? '');
  const buttonsInBlock = [...(more ?? '').matchAll(/<button[^>]*id="([^"]+)"/g)].map((m) => m[1]).sort();
  check(JSON.stringify(buttonsInBlock) === JSON.stringify([...SECONDARY].sort()),
    `the disclosure's buttons are exactly the four secondaries (${buttonsInBlock.join(', ')})`, inBlock.join(', '));
  check(idsIn(more ?? '').includes('moreToggle'), 'and it is opened by a real summary the keyboard can reach');
}

console.log('\n== 4. the clutter the report was about has actually gone ==');
{
  // THE CEILING: a footer button outside the disclosure that carries no `hidden` attribute is drawn in EVERY mode — the
  // exact thing that made ten controls appear at once. Zero is the measured shape after this change; the number may only
  // fall, and a deliberate new always-on control has to be re-pinned here.
  const foot = html.slice(html.indexOf('<footer id="foot">'), html.indexOf('</footer>'));
  const outsideMore = foot.replace(blockOf(html, 'more') ?? '', '');
  const alwaysOn = [...outsideMore.matchAll(/<button\b[^>]*>/g)].filter((m) => !/\bhidden\b/.test(m[0])).length;
  check(alwaysOn === 0, `no footer button is drawn in every mode any more (${alwaysOn} always-on)`);
  check(SECONDARY.length === 4, `and four controls moved behind one tap (${SECONDARY.length})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
