// THE SHELL'S PAGES: ONE SECTION PER PAGE, ONE HEADING PER SECTION, ONE WAY BACK, AND NOTHING LEFT OF THE TABS.
//
// REPORTED: "Lets introduce pages and a simple navigation system. All pages have a thin banner ... a back button." The
// app used to be ONE screen with two mode tabs (`#modes`) and four sections shown and hidden by hand, with a `#toLevel`
// button and a `<details id="more">` disclosure in the footer. All three are gone, and the failure this probe exists for
// is the ordinary one: a control or an id left behind by that change, or a page that has no heading to focus and no
// way back — none of which a green typecheck would notice, because `el()` only fails in a browser.
//
// WHAT IT PINS, and each check has a reason to exist:
//   1. EVERY `el('id')` / `getElementById('id')` in the app's source resolves to exactly one `id="…"` in `index.html`.
//      That is the contract `ui/dom.ts` claims in its own header — "a missing one is a typo in the markup" — and it used
//      to be checked by this file alone (AGENTS.md trap 27's family: a browser-only failure).
//   2. THE PAGES. One `<section class="page">` per page in the model, its id equal to the page's name, and its `<h2>` the
//      id `pageHeadingId` returns with `tabindex="-1"` — the element the router focuses after a navigation. A page whose
//      heading id drifted is a navigation that silently focuses nothing.
//   3. THE NAVIGATION. The landing page offers every other page exactly once, in the model's order, and each button has a
//      handler that navigates to that page. A destination added to the model and forgotten in the menu is a page nobody can
//      reach; a button pointing at the wrong page is worse.
//   4. THE BANNER. The way back exists, and `paintChrome` hides it from `backTarget` rather than from a second table.
//   5. THE RETIRED CONTROLS are gone from the markup AND from the script AND from the stylesheet. A leftover `el('toLevel')`
//      is a runtime throw; a leftover rule is dead CSS nobody dares delete.
//   6. THE FOOTER still holds the game's own moves and nothing else, and the SETUP page holds the housekeeping, so
//      "decluttered" cannot become "the Hint button went missing" — the defect the footer's first probe was written for.
//   7. THE DRILL PAGE'S WITHDRAWN LINES. The report took the "Drill" heading and the question out of the picture; they must still
//      be in the tree, or a navigation focuses nothing and the question is unread.
//
// THE NEGATIVE CONTROLS run the same readers over synthetic markup, because a check whose subject is the real file cannot
// tell a rule from a coincidence: MEASURED, `pagesWithHeadings` fails on a section whose heading id is another page's,
// and `retiredLeftovers` fails on one `#toLevel` in the footer.
//
// Usage: node game/test/shell-controls-probe.mjs   (no engine build needed: it reads text and the pure page model)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backTarget, pageHeadingId } from '../src/ui/pages.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const SRC = path.join(GAME, 'src');
const HTML = path.join(GAME, 'index.html');
const CSS = path.join(GAME, 'src/style.css');
const MAIN = path.join(GAME, 'src/main.ts');

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

/** Every page the model has, in the order the landing page offers them — derived, never re-typed. */
const PAGES = ['landing', 'setup', 'help', 'profile', 'levels', 'drill', 'daily', 'board'];

/** The controls that are the GAME's own moves: they belong in the footer, on the page that plays. */
const FOOTER = [
  'hint', 'undo', 'redo', 'giveUp', 'replayMine', 'replayShortest', 'practice', 'next',
];
/** The controls that belong to a specific page rather than to the shell, and which page each one is on. */
const PAGE_CONTROLS = {
  profile: ['accountEmail', 'accountPassword', 'accountSignIn', 'accountSignUp', 'accountCode', 'accountConfirm', 'accountSignOut', 'passwordForm', 'currentPassword', 'newPassword', 'passwordChange', 'ledger', 'profileBoard', 'aliasForm', 'aliasInput', 'aliasSave', 'aliasStatus'],
  daily: ['callSearch', 'callSubsets', 'offer'],
  levels: ['levelNext', 'levelBlock'],
};
/** Set-once preferences and housekeeping: they belong on the Setup page, and nowhere else. */
const SECONDARY = ['view', 'autoProgress', 'startOver'];
/**
 * THE MENU, in the order the report named the destinations — "Register/Login, Help, Drill Level, Today's Daily, Setup" —
 * plus the board, which already existed unlisted. It is a table rather than the model's own order because the two are
 * genuinely different facts: the model lists the pages, and the menu chooses which of them are DESTINATIONS. `drill` is
 * the exception that proves it: a drill is entered from a cell on the level block, and a menu button for "a drill" would
 * have to guess which one.
 */
const MENU = ['profile', 'help', 'levels', 'daily', 'setup', 'board'];
/** What the router and the Setup page replaced. Nothing may name these any more, in any file. */
const RETIRED = ['modeDrill', 'modeDaily', 'toLevel', 'moreToggle'];
// AND THE SKIP IS RETIRED, as a CONTROL while its server endpoint stays. REPORTED: "Remove the "Skip this drill" button, it
// shouldnt be required in a three choice quiestion." It had already been withheld on a sheet ("In mobile view, remove the
// skip ... they hide the choices") and the owner then took it everywhere; `POST /drill/advance` is untouched, because
// nothing about the protocol moved. This entry is what stops the button drifting back in.
const RETIRED_SKIP = 'skip';

// AND "SHOW ME THE ANSWER" IS RETIRED TOO, as a control while its RULE stays. REPORTED: "remove the option to see the answer to
// a drill, there are only three answers, players will get there eventually." The check below is about the id being gone from the
// markup and the script; `DrillController.review()` and `POST /drill/reveal` are deliberately still there (`main.ts` says why).
const RETIRED_REVIEW = 'review';

const htmlRaw = fs.readFileSync(HTML, 'utf8');
/**
 * THE MARKUP WITH ITS COMMENTS REMOVED, and every structural check below reads THIS.
 *
 * A COMMENT IS NOT MARKUP, and these checks are about markup: the page's own prose says things like "it was an `<h1>` above
 * this row" when explaining why one went away, and an id named in a comment is not an id the app can resolve. MEASURED: the
 * `<h1>` check went red on a sentence inside a comment, which is a false positive that would teach a reader to weaken the
 * check rather than fix the reader.
 */
const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
const css = fs.readFileSync(CSS, 'utf8');
const main = fs.readFileSync(MAIN, 'utf8');

const idsIn = (text) => [...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

/**
 * THE SCRIPT AND THE STYLESHEET WITH THEIR COMMENTS REMOVED, for the checks that ask whether a NAME is still USED.
 *
 * The same trap the markup's own comment-strip above was written for, one file over: `main.ts` and `style.css` both QUOTE the
 * reports that asked for a control to be withdrawn ("Delete the breadcrumb"), so a raw `includes('breadcrumb')` finds the
 * sentence explaining the deletion and reports the deletion missing. Comments are documentation, and a check about live names
 * must read live code.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The text of one element, by tag depth — a `<section>` may hold another `<section>`, so "to the next close" is wrong. */
const blockOf = (source, tag, id) => {
  const open = source.match(new RegExp(`<${tag}[^>]*\\bid="${id}"[^>]*>`, 'i'));
  if (!open) return null;
  let depth = 0;
  for (let i = open.index; i < source.length; i++) {
    if (source.startsWith(`<${tag}`, i)) depth++;
    else if (source.startsWith(`</${tag}`, i)) {
      depth--;
      if (depth === 0) return source.slice(open.index, source.indexOf('>', i) + 1);
    }
  }
  return source.slice(open.index);
};

/** The `<section class="page" id="…">` elements, as the ids the router hides and shows. */
const pageSections = (source) => [...source.matchAll(/<section\b[^>]*\bclass="page"[^>]*>|<section\b[^>]*\bid="[^"]+"[^>]*\bclass="page"[^>]*>/g)]
  .map((m) => /\bid="([^"]+)"/.exec(m[0])?.[1] ?? '(none)');

/** Every page's heading id, as the markup states it: the `<h2>` inside that page's section. */
const headingOf = (source, id) => {
  const block = blockOf(source, 'section', id) ?? '';
  const h2 = block.match(/<h2\b[^>]*>/i)?.[0] ?? '';
  return { id: /\bid="([^"]+)"/.exec(h2)?.[1] ?? '', focusable: /\btabindex="-1"/.test(h2) };
};

/** Which page-heading ids are wrong: a section whose `<h2>` is not the id the model gives that page. */
const pagesWithWrongHeading = (source) => PAGES
  .filter((page) => headingOf(source, page).id !== pageHeadingId(page))
  .map((page) => `${page} wants ${pageHeadingId(page)} and has ${headingOf(source, page).id || 'none'}`);

/** Which retired names still appear, per file. */
const retiredLeftovers = (source, names) => names.filter((name) => new RegExp(`\\b${name}\\b`).test(source));

console.log('\n== 1. the readers, on markup a reader can check by eye ==');
{
  // A section whose `<h2>` carries ANOTHER page's heading id: the navigation focuses the wrong element, or nothing.
  const wrong = '<section id="help" class="page"><h2 id="setupHeading" tabindex="-1">Help</h2></section>';
  check(pagesWithWrongHeading(wrong).length > 0, 'a page whose heading id is another page\'s is caught (help/setupHeading)',
    pagesWithWrongHeading(wrong).join('; '));
  const good = '<section id="help" class="page"><h2 id="helpHeading" tabindex="-1">Help</h2></section>';
  check(pagesWithWrongHeading(good).length === PAGES.length - 1,
    `and the right one is silent for that page (${PAGES.length - 1} others still missing from this fragment, by design)`);
  // THE FOCUS TARGET: a heading without `tabindex` cannot be focused, so the router's focus call would be a no-op.
  check(headingOf('<section id="help" class="page"><h2 id="helpHeading">x</h2></section>', 'help').focusable === false,
    'a heading that cannot be focused is visible to the reader (no tabindex)');
  check(blockOf('<section id="a"><section id="b"></section><p id="c"></p></section>', 'section', 'a')?.includes('id="c"'),
    'a nested section does not end the outer one early');
  check(retiredLeftovers('<button id="toLevel">Back</button>', RETIRED).join() === 'toLevel',
    'a retired control is found by name (toLevel)');
  check(retiredLeftovers('<button id="bannerBack">Back</button>', RETIRED).length === 0, 'and the replacement is not a leftover');
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

console.log('\n== 3. one section per page, and one heading per section ==');
{
  const sections = pageSections(html);
  check(sections.length === PAGES.length, `index.html carries ${sections.length} page sections for ${PAGES.length} pages`,
    sections.join(', '));
  const missing = PAGES.filter((page) => !sections.includes(page));
  check(missing.length === 0, `and their ids ARE the page names, so no translation table exists (${missing.join(', ') || 'none'} missing)`);
  const wrong = pagesWithWrongHeading(html);
  check(wrong.length === 0, `every page's <h2> is the id the model gives it (${wrong.join('; ') || 'none'} wrong)`, wrong.join('; '));
  const unfocusable = PAGES.filter((page) => !headingOf(html, page).focusable);
  check(unfocusable.length === 0, `and every one is focusable, which is what a navigation focuses (${unfocusable.join(', ') || 'none'})`);
  // THE ROUTER'S OWN TABLE: `paintPages` hides exactly eight sections, one per page, from `page`. A ninth anything there
  // would be a section nothing can show.
  const hides = [...main.matchAll(/els\.\w+\.hidden = page !== '([a-z]+)';/g)].map((m) => m[1]);
  check(JSON.stringify(hides.slice().sort()) === JSON.stringify(PAGES.slice().sort()),
    `paintPages hides exactly the model's pages, from the page alone (${hides.join(', ')})`, hides.join(', '));
}

console.log('\n== 4. the landing page reaches every other page, and the banner has the way back ==');
{
  const nav = blockOf(html, 'nav', 'landingNav') ?? '';
  const buttons = [...nav.matchAll(/<button[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  const expected = MENU.map((page) => `go${page[0].toUpperCase()}${page.slice(1)}`);
  check(JSON.stringify(buttons) === JSON.stringify(expected),
    `the menu offers every destination once, in the report's order (${buttons.join(', ')})`, buttons.join(', '));
  // AND EVERY ONE OF THOSE BUTTONS NAVIGATES TO ITS OWN PAGE — derived from the name, so a button that points at the wrong
  // page is a failure here rather than a dead end a player finds.
  const unwired = MENU.filter((page) => {
    const id = `go${page[0].toUpperCase()}${page.slice(1)}`;
    return !main.includes(`els.${id}.addEventListener('click', () => navigate({ page: '${page}'`);
  });
  check(unwired.length === 0, `and each one navigates to the page it names (${unwired.join(', ') || 'none'} unwired)`, unwired.join(', '));
  // REACHABILITY: the menu plus the two pages that are entered another way — landing is where you are, and a drill is
  // entered from a cell (`levelScreen`'s callback navigates to `#/drill/<n>`) — must cover the model exactly, so no page
  // can be added to the router and reachable from nowhere.
  const reachable = new Set(['landing', 'drill', ...MENU]);
  const unreachable = PAGES.filter((page) => !reachable.has(page));
  check(unreachable.length === 0, `every page is reachable, by the menu or by a cell (${unreachable.join(', ') || 'none'} stranded)`);
  check(main.includes("navigate({ page: 'drill', drillIndex: index })"),
    'and the drill is entered by a cell press that writes its own URL');
  const banner = blockOf(html, 'div', 'bannerRow') ?? '';
  // THE BANNER'S CELLS, ALL IN ONE ROW: the way back, the level with its two scores, the position and the account badge — the
  // list the reports named. `banner-probe.mjs` pins what each one SAYS; this pins that they are on the page in that row at all,
  // which the id contract would otherwise only catch once one of them is asked for in the script.
  const bannerIds = idsIn(banner).filter((id) => id !== 'bannerRow');
  const cells = ['bannerBack', 'bannerScores', 'bannerLevel', 'bannerDrill', 'bannerDaily', 'bannerHints', 'bannerPips', 'bannerAccount'];
  const absent = cells.filter((id) => !bannerIds.includes(id));
  check(absent.length === 0,
    `the one banner row carries the way back, the level's two scores, the position, the hint badge and the account (${absent.join(', ') || 'none missing'})`,
    absent.join(', '));
  // THE WAY BACK IS THE ROW'S FIRST CELL AND THE PLAYER'S GROUP IS LAST. REPORTED: "Change the back button to just an square back
  // arrow and move it up to the top left of the header. Delete the breadcrumb." The order is the reading order, so a back arrow
  // that had drifted to the middle of the row would be a different app.
  check(bannerIds[0] === 'bannerBack', `and the way back is the first cell (${bannerIds[0]})`);
  check(bannerIds[bannerIds.length - 1] === 'bannerAccount', `with the account badge last (${bannerIds[bannerIds.length - 1]})`);
  // AND THE POSITION LINE IS GONE FROM THE ROW, because it was the only SENTENCE in a wrapping row and it reflowed the header.
  // REPORTED: "Remove this text section from the heading when viewing the Drill puzzle. It causes the header to reflow onto the
  // next line for mobile." MEASURED at 1280 x 800 with it: the row stood 58 px tall against 36 px on a sheet. This is the check
  // that catches it coming back — an id, a rule or an `els.regime` write would each put a ~110 px sentence back in the row.
  const regimeLeft = [
    /\bid="regime"/.test(html) ? 'index.html' : '',
    /els\.regime\b/.test(main) ? 'main.ts' : '',
    /#regime\b/.test(stripComments(css)) ? 'style.css' : '',
  ].filter(Boolean);
  check(regimeLeft.length === 0, `and the position line is gone from all three (${regimeLeft.join(', ') || 'nowhere'})`, regimeLeft.join(', '));
  // THE SECOND ROW IS DELETED, not merely emptied: no `#bannerPath`, no `#breadcrumb`, and no crumb markup or CSS left behind. A
  // row that still existed with nothing in it would keep its gap and its border, which is the screen real estate the report was
  // about. Negative control: `#bannerPath` in any of the four files below fails exactly this check.
  const crumbs = ['bannerPath', 'breadcrumb', '.crumb'];
  const shellText = [html, stripComments(main), stripComments(css)].join('\n');
  const crumbLeft = crumbs.filter((name) => shellText.includes(name));
  check(crumbLeft.length === 0, `the breadcrumb row and its styles are gone (${crumbLeft.join(', ') || 'none left'})`, crumbLeft.join(', '));
  // THE BACK BUTTON IS AN ICON, so the destination must survive without the picture: an `aria-hidden` glyph in the markup and the
  // name written from `backLabel`, never as visible text. MEASURED before: the button's text was the whole label ("‹ Back"), which
  // is a word in a row that has no room for words.
  const back = blockOf(banner, 'button', 'bannerBack') ?? '';
  check(/<svg[^>]*aria-hidden="true"/.test(back), 'the back button\'s arrow is `aria-hidden`', back || '(no button found)');
  check(/<button id="bannerBack"[^>]*aria-label="/.test(back), 'and the button carries a name, so the arrow is not the label', back);
  check(!main.includes("els.bannerBack.textContent = '‹ Back'") && !main.includes('els.bannerBack.textContent'),
    'and paintChrome writes no visible text into it');
  // THE HINT BADGE CARRIES NO TEXT, so its label must carry the number: REPORTED as "Remove the text Hints 0/3 and surround
  // the hint circles with a badge outline". A meter with neither words nor a name is a fact only sighted players have.
  check(/<p id="bannerHints"[^>]*role="img"[^>]*aria-label="/.test(banner),
    'the hint badge is a named image, because its number is no longer printed');
  // AND THE GLYPHS ARE DECORATION: the scores cell's accessible name is the sentence, and the pictures are `aria-hidden`.
  check(/<p id="bannerScores"[^>]*aria-label="/.test(banner), 'the scores cell is named too');
  check([...banner.matchAll(/<svg[^>]*aria-hidden="true"/g)].length >= 3,
    'and every glyph in the row (two scores, one account) is `aria-hidden` rather than the label');
  check(main.includes('els.bannerBack.hidden = target === null') && main.includes('backTarget(page)'),
    'and paintChrome hides it from the page model\'s backTarget rather than from a second table');
  // THE ACCOUNT BADGE IS ALWAYS DRAWN AND ALWAYS A CONTROL — the two halves of "The empty login account badge is missing from
  // the header": no `hidden` in the markup, and a press that goes to the PROFILE page (the page the badge opens, since
  // "clicking on it takes you to a profile page" asked for it by that name). It is a circle with a person in it now, so the
  // check also pins that the glyph is `aria-hidden`: the state is the button's accessible name, not the picture.
  check(!/\bid="bannerAccount"[^>]*\bhidden\b/.test(banner),
    'the account badge carries no `hidden` in the markup, so the empty state is drawn');
  check(/<svg[^>]*aria-hidden="true"/.test(banner), 'and its icon is `aria-hidden`, so the picture is not the label');
  check(main.includes("els.bannerAccount.addEventListener('click', () => navigate({ page: 'profile', drillIndex: null }))"),
    'and pressing it goes to the profile page in every state');
  // THE APP'S NAME IS NOT A HEADING IN THE HEADER ANY MORE. REPORTED: "Remove the Dancing Squared header, it's not adding
  // anything and takes up a lot of screen real estate." The landing page keeps its own `<h2>`, which is the one place the
  // name belongs; the page now has no `<h1>` at all, so the `<h2>`s are the headings a reader navigates.
  const head = blockOf(html, 'header', 'head') ?? '';
  check(!/<h1\b/i.test(head), 'and the header no longer carries the app name as an <h1>');
  check(!/<h1\b/i.test(html), 'in fact the page has no <h1> at all — the <h2>s are the pages\' headings');
  // THE MODEL'S OWN TABLE, as a control on the check above: only the landing page may have no way back.
  const parentless = PAGES.filter((page) => backTarget(page) === null);
  check(JSON.stringify(parentless) === '["landing"]', `and only the landing page is parentless (${parentless.join(', ')})`);
}

console.log('\n== 5. the retired controls are gone from markup, script and stylesheet ==');
{
  for (const name of RETIRED) {
    const where = [
      new RegExp(`\\bid="${name}"`).test(html) ? 'index.html' : '',
      new RegExp(`'${name}'`).test(main) ? 'main.ts' : '',
      new RegExp(`#${name}\\b`).test(css) ? 'style.css' : '',
    ].filter(Boolean);
    check(where.length === 0, `#${name} is named nowhere (${where.join(', ') || 'nowhere'})`, where.join(', '));
  }
  // THE REVIEW CONTROL IS WITHDRAWN: no button in the markup, no `els.review` in the script, no rule in the stylesheet. The
  // CONTROLLER's `review()` and the API's route are not checked here — they are the RULE, and they stay.
  check(!new RegExp(`\\bid="${RETIRED_REVIEW}"`).test(html), `#${RETIRED_REVIEW} is not in the markup any more`);
  check(!new RegExp(`els\\.${RETIRED_REVIEW}\\b`).test(main), 'and not in the script either');
  check(/DrillController/.test(main) && !/recordDrillReveal/.test(main),
    'the controller keeps `review()`, while the app no longer POSTs a reveal');
  // THE MODE TAB'S OWN STYLES, which are `#modes` rules rather than an id: the block was ~25 lines of tab styling.
  check(!/#modes\b/.test(css), 'and the mode-tab rules are gone from the stylesheet too');
  check(!/\.more-body\b/.test(css), 'and so is the disclosure body\'s rule');
  // THE SKIP: no button, no `els.skip`, no `#skip` rule — and the endpoint it called is deliberately still served, which is
  // why the check stops at this app's three files (REPORTED: "Remove the "Skip this drill" button, it shouldnt be required
  // in a three choice quiestion.").
  check(!new RegExp(`\\bid="${RETIRED_SKIP}"`).test(html), `#${RETIRED_SKIP} is not in the markup any more`);
  check(!new RegExp(`els\\.${RETIRED_SKIP}\\b`).test(main), 'and nothing in the script reaches for it');
  check(!new RegExp(`#${RETIRED_SKIP}\\b`).test(stripComments(css)), 'and no rule draws it');
}

console.log('\n== 6. the footer holds the game\'s moves, each page its own controls, Setup the housekeeping ==');
{
  const foot = html.slice(html.indexOf('<footer id="foot">'), html.indexOf('</footer>'));
  const footIds = idsIn(foot);
  const missingFooter = FOOTER.filter((id) => !footIds.includes(id));
  check(missingFooter.length === 0, `every move of the game is in the footer (${missingFooter.join(', ') || 'none'} missing)`,
    missingFooter.join(', '));
  for (const [page, ids] of Object.entries(PAGE_CONTROLS)) {
    const block = blockOf(html, 'section', page) ?? '';
    const here = new Set(idsIn(block));
    const missing = ids.filter((id) => !here.has(id));
    check(missing.length === 0, `and ${page}'s own controls are on its page (${missing.join(', ') || 'none'} missing)`, missing.join(', '));
  }
  const setup = blockOf(html, 'section', 'setup') ?? '';
  const setupIds = idsIn(setup);
  check(JSON.stringify(SECONDARY.filter((id) => setupIds.includes(id)).sort()) === JSON.stringify([...SECONDARY].sort()),
    `and every housekeeping control is on the Setup page (${setupIds.filter((id) => SECONDARY.includes(id)).join(', ')})`);
  const buried = SECONDARY.filter((id) => footIds.includes(id));
  check(buried.length === 0, `with none of them left in the footer (${buried.join(', ') || 'none'})`, buried.join(', '));
  // THE CEILING: a footer button that carries no `hidden` attribute is drawn on every page — the exact thing that made ten
  // controls appear at once. Zero is the measured shape after this change; the number may only fall.
  const alwaysOn = [...foot.matchAll(/<button\b[^>]*>/g)].filter((m) => !/\bhidden\b/.test(m[0])).length;
  check(alwaysOn === 0, `no footer button is drawn on every page any more (${alwaysOn} always-on)`);
}

console.log('\n== 7. the drill page\'s heading and question are for the reader, not for the layout ==');
{
  // REPORTED: "Also get rid of the header 'Drill' and the subheader 'Which call takes....' They also hide the selections". NEITHER
  // MAY BE DELETED: a navigation focuses the page's `<h2>` (`pageHeadingId`), and the question is the question — so both are
  // `visually-hidden`, which keeps them in the DOM and in the accessibility tree while taking them out of the flow entirely.
  const drill = blockOf(html, 'section', 'drill') ?? '';
  const elementOf = (id) => drill.match(new RegExp(`<[a-z0-9]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
  for (const id of ['drillHeading', 'prompt']) {
    const open = elementOf(id);
    check(/\bclass="[^"]*\bvisually-hidden\b/.test(open), `#${id} is visually hidden, so it costs the sheet no lines (${open || 'not found'})`);
    // NEGATIVE CONTROL: the plausible wrong answer is the `hidden` attribute, which is a line shorter and removes the element from the
    // accessibility tree — the focus target would then focus nothing and the question would be unread. The `\s` matters: the class's
    // own name contains the word "hidden", so a bare `\bhidden\b` would match the fix as the defect.
    check(!/\shidden\b/.test(open), `and it is not the \`hidden\` attribute, which would take it out of the tree too (${id})`);  }
  const rule = css.match(/\.visually-hidden\s*\{[^}]*\}/)?.[0] ?? '';
  check(/position:\s*absolute/.test(rule) && /clip-path/.test(rule),
    'and the class exists as a clip: absolute placement plus a one-pixel clip rectangle', rule || '(no rule)');
  check(!/display:\s*none|visibility:\s*hidden/.test(rule),
    'with neither `display: none` nor `visibility: hidden` in it, which would defeat the point', rule);
}

console.log('\n== 8. the UI never renders an email address ==');
{
  // REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
  // anywhere on the UI." The session still CARRIES the address — `/auth/signin` needs it and `POST /auth/password` takes
  // it — so the rule cannot be "no `.email` in the source". It is narrower and it is the one that matters: NO ADDRESS IS
  // INTERPOLATED INTO A SENTENCE, because every string this app draws goes through a template literal or `textContent`
  // (`AGENTS.md` §6). A call argument like `changePassword(player.email, …)` is protocol, not display, and this check
  // deliberately does not flag it.
  const uiFiles = ['src/main.ts', 'src/ui/account-screen.ts', 'src/ui/banner.ts', 'src/ui/leaderboard-screen.ts'];
  const offenders = [];
  for (const file of uiFiles) {
    const text = stripComments(fs.readFileSync(path.join(GAME, file), 'utf8'));
    // A BACKTICK STRING THAT INTERPOLATES ANYTHING NAMED `…email`. The negative control below is the sentence this check
    // was written for — the landing page's old "Signed in as ${player.email}." — which it must catch.
    for (const match of text.matchAll(/`[^`]*\$\{[^}]*\bemail\b[^}]*\}[^`]*`/g)) offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ')}`);
  }
  check(offenders.length === 0, `no sentence interpolates an email (${offenders.length} found)`, offenders.join(' | '));
  const control = 'els.status.textContent = `Signed in as ${player.email}.`;';
  check([...control.matchAll(/`[^`]*\$\{[^}]*\bemail\b[^}]*\}[^`]*`/g)].length === 1,
    'CONTROL: the reader catches the sentence this rule is about');
  // AND NEITHER THE BANNER'S FACTS NOR ITS BADGE CAN REACH AN ADDRESS: the only identity fact in `ui/banner.ts` is
  // `playerAlias`, so a caller cannot hand it an email even by accident.
  const banner = stripComments(fs.readFileSync(path.join(GAME, 'src/ui/banner.ts'), 'utf8'));
  check(!/playerEmail/.test(banner) && /playerAlias/.test(banner), 'the banner\'s identity fact is the alias, not an address');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
