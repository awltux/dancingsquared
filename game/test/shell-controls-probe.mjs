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
  'hint', 'review', 'skip', 'undo', 'redo', 'giveUp', 'replayMine', 'replayShortest', 'practice', 'next',
];
/** The controls that belong to a specific page rather than to the shell, and which page each one is on. */
const PAGE_CONTROLS = {
  profile: ['accountEmail', 'accountPassword', 'accountSignIn', 'accountSignUp', 'accountCode', 'accountConfirm', 'accountSignOut', 'passwordForm', 'currentPassword', 'newPassword', 'passwordChange', 'ledger', 'profileBoard'],
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
  // THE BANNER'S CELLS: the hint badge, the level with its two scores, the position and the account badge — the list the reports
  // named. `banner-probe.mjs` pins what each one SAYS; this pins that they are on the page in that row at all, which the id
  // contract would otherwise only catch once one of them is asked for in the script.
  const bannerIds = idsIn(banner);
  const cells = ['bannerHints', 'bannerPips', 'bannerScores', 'bannerLevel', 'bannerDrill', 'bannerDaily', 'bannerAccount'];
  const absent = cells.filter((id) => !bannerIds.includes(id));
  check(absent.length === 0,
    `the banner carries the hint badge, the level's two scores and the account badge (${absent.join(', ') || 'none missing'})`,
    absent.join(', '));
  // THE WAY BACK, THE PATH AND THE POSITION ARE THE SECOND ROW. REPORTED: "The Back button feels inappropriate for the top
  // banner. A secondary banner could have a breadcrumb (minimalist) and the back button." So this pins that none of the three is
  // in the top row any more, and that all three are in the row that was added for them.
  check(!bannerIds.includes('bannerBack') && !bannerIds.includes('regime'),
    'the top banner no longer holds the back button or the position line');
  const path = blockOf(html, 'div', 'bannerPath') ?? '';
  const pathIds = idsIn(path);
  check(['bannerBack', 'breadcrumb', 'regime'].every((id) => pathIds.includes(id)),
    `the secondary banner holds the way back, the breadcrumb and the position (${pathIds.join(', ')})`);
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
  // THE MODE TAB'S OWN STYLES, which are `#modes` rules rather than an id: the block was ~25 lines of tab styling.
  check(!/#modes\b/.test(css), 'and the mode-tab rules are gone from the stylesheet too');
  check(!/\.more-body\b/.test(css), 'and so is the disclosure body\'s rule');
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

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
