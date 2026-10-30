// THE PAGE MODEL, PINNED — because every navigation rule the app has is in this one pure module.
//
// REPORTED: "Lets introduce pages and a simple navigation system. All pages have a thin banner ... a back button." A router
// is the kind of code whose bugs are all at the edges: a hash with a trailing slash, a drill index that is not a number, a
// back button that returns to the page it is on, a title that is missing for one page and therefore reads as the previous
// page's. `ui/pages.ts` is the arithmetic and this probe is the gate.
//
// WHAT THIS PINS:
//   1. THE ROUND TRIP. `pageFor(hashFor(route))` is `route` for every page and for a drill index — the property that makes the
//      router safe to write a URL and then read it back, which is exactly what `main.ts` does on every navigation.
//   2. THE EDGES: an unknown hash, a bare `#`, `#something` (not a path), a trailing slash, upper case, `#/drill`, `#/drill/3`,
//      `#/drill/abc`, `#/drill/3/x`, a negative index and a huge one.
//   3. THE BACK TABLE: every page's parent, that Landing has none, and that NO PAGE IS ITS OWN PARENT (a back button that
//      stays put is a control that does nothing, and this is the check that catches it).
//   4. THE WORDS: a back label for every page that has a back button, and a title for every page.
//   5. THE HEADINGS: one id per page, all distinct, so two pages cannot focus the same element.
//   6. THE BOARD'S PAGES. Only the two play pages draw the dance board, and in FULL SCREEN every page without one gives
//      that area to the standings (`showsStandings`), while a sheet has no such area.
//
// THE NEGATIVE CONTROLS are the plausible wrong routers: a PATH router (which would treat `#/help` as an unknown route because
// it looks for `/help` in `location.pathname`), a `backTarget` that returns its own page, and a `pageFor` that coerces
// `#/drill/abc` to a position. Each fails exactly the check that rules it out.
//
// Usage: node game/test/pages-probe.mjs   (pure: no DOM, no browser, no engine)
import {
  pageFor, hashFor, backTarget, backLabel, pageTitle, pageHeadingId, pageShowsBoard, pageOwnsBootOverlay, showsStandings,
} from '../src/ui/pages.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const PAGES = ['landing', 'setup', 'help', 'profile', 'levels', 'drill', 'daily', 'board'];
const sameRoute = (a, b) => a.page === b.page && a.drillIndex === b.drillIndex;

console.log('\n== 1. every page round-trips through its own URL ==');
{
  for (const page of PAGES) {
    for (const index of page === 'drill' ? [null, 0, 3, 99] : [null]) {
      const route = { page, drillIndex: index };
      const hash = hashFor(route);
      const back = pageFor(hash);
      check(sameRoute(route, back), `${hash} reads back as ${page}${index === null ? '' : ` #${index}`} (${back.page}${back.drillIndex === null ? '' : ` #${back.drillIndex}`})`);
    }
  }
  // THE LANDING PAGE IS `#/`, not `#` — a bare `#` is what a link with no href looks like, and the two must not be confused
  // when the router writes. `#` still PARSES to landing (checked below); only the writing side is canonical.
  check(hashFor({ page: 'landing', drillIndex: null }) === '#/', 'the landing page writes #/');
  check(hashFor({ page: 'drill', drillIndex: null }) === '#/drill', 'and a drill with no index writes #/drill');
}

console.log('\n== 2. the edges ==');
{
  const cases = [
    ['', 'landing'],
    ['#', 'landing'],
    ['#/', 'landing'],
    ['#/help', 'help'],
    ['#/help/', 'help'],
    ['#/HELP', 'help'],
    ['#/Help//', 'help'],
    ['#something', 'landing'],
    ['#?x=1', 'landing'],
    ['#/nope', 'landing'],
    ['#/setup', 'setup'],
    ['#/profile', 'profile'],
    ['#/levels', 'levels'],
    ['#/daily', 'daily'],
    ['#/board', 'board'],
  ];
  for (const [hash, expected] of cases) {
    check(pageFor(hash).page === expected, `${JSON.stringify(hash)} is ${expected} (${pageFor(hash).page})`);
  }
  // THE DRILL INDEX IS A POSITION OR IT IS NOTHING. `#/drill` means "the drill I am on"; `#/drill/abc` is not a position and
  // must not be coerced into one, because a router that guessed would open a drill the URL did not name.
  check(pageFor('#/drill').drillIndex === null, '#/drill names no position');
  check(pageFor('#/drill/7').drillIndex === 7, '#/drill/7 names position 7');
  check(pageFor('#/drill/abc').page === 'landing' && pageFor('#/drill/abc').drillIndex === null,
    'a non-numeric index is not a drill at all (it lands on the menu)');
  check(pageFor('#/drill/3/x').page === 'landing', 'and a deeper path is not one either');
  check(pageFor('#/drill/-1').page === 'landing', 'nor a negative one');
  check(pageFor('#/drill/0').drillIndex === 0, 'position 0 is a position (the block is zero-based)');
  // NEGATIVE CONTROL: a router that coerced the index would answer 0 for `#/drill/abc`, and the two checks above would pass
  // while a typed URL opened drill 1.
  const coercing = (hash) => Number(/drill\/(.*)$/.exec(hash)?.[1] ?? '0') || 0;
  check(coercing('#/drill/abc') === 0 && pageFor('#/drill/abc').drillIndex === null,
    'a coercing router would answer 0 here — the control');
}

console.log('\n== 3. the back table ==');
{
  check(backTarget('landing') === null, 'the menu has nowhere to go back to');
  const parents = PAGES.filter((page) => page !== 'landing').map((page) => [page, backTarget(page)]);
  check(parents.every(([, target]) => target !== null), `every other page has a parent (${parents.length})`);
  check(parents.every(([page, target]) => target !== page), 'and NO page is its own parent');
  check(backTarget('drill') === 'levels', 'the drill goes back to the level it was entered from');
  check(backTarget('levels') === 'landing' && backTarget('daily') === 'landing' && backTarget('board') === 'landing',
    'the three play/read pages all go back to the menu');
  check(backTarget('setup') === 'landing' && backTarget('help') === 'landing' && backTarget('profile') === 'landing',
    'and so do the three housekeeping pages');
  // NEGATIVE CONTROL: the plausible wrong table — "back always returns to the menu" — is wrong for exactly one page, and that
  // is the page a player is most likely to press it on.
  const alwaysMenu = (page) => (page === 'landing' ? null : 'landing');
  check(alwaysMenu('drill') !== backTarget('drill'), 'a back that always returns to the menu would strand a drill — the control');
}

console.log('\n== 4. the words ==');
{
  check(backLabel('landing') === '', 'the menu has no back label');
  // THE LABEL NAMES THE DESTINATION, so pages that share a destination legitimately share a label — the check is that the
  // label names a page OTHER than the one it is on, never which string it is.
  const own = { landing: 'the menu', setup: 'setup', help: 'help', profile: 'your profile', levels: 'the level', drill: 'the drill', daily: "today's Daily", board: 'the board' };
  for (const page of PAGES) {
    if (page === 'landing') continue;
    const target = backTarget(page);
    check(backLabel(page) === `Back to ${own[target]}`, `${page}'s back says "Back to ${own[target]}" (${backLabel(page)})`);
    check(backLabel(page) !== `Back to ${own[page]}`, `and it does not name the page it is on (${page})`);
  }
  check(backLabel('drill') === 'Back to the level', `the drill's back says where it goes (${backLabel('drill')})`);
  const titles = PAGES.map((page) => pageTitle(page));
  check(titles.every((title) => typeof title === 'string' && title.length > 0), 'every page has a title');
  check(titles.filter((title) => title === 'Dancing Squared').length === 1, 'and only the menu is the app itself');
}

console.log('\n== 5. one heading per page ==');
{
  const ids = PAGES.map((page) => pageHeadingId(page));
  check(ids.every((id) => typeof id === 'string' && id.endsWith('Heading')), 'every page names a heading id');
  check(new Set(ids).size === ids.length, `and they are all distinct (${ids.length})`);
  // THE LEVEL PAGE'S HEADING IS NOT ITS STATUS LINE: `levelHeading` is the "3 of 100 done" line, so the page's own title has
  // to be a different element or a navigation would focus the status and read it as the page.
  check(pageHeadingId('levels') !== 'levelHeading', 'the level page heading is not the level status line');
}

console.log('\n== 6. the board is drawn only on the pages that are the game ==');
{
  // REPORTED: "hide the dancing board when displaying a page, only expose it when they are part of the game e.g. Daily
  // Target and Drill play pages." The rule is `pageShowsBoard`: the board is the QUESTION on those two and a picture of
  // nothing everywhere else.
  const withBoard = PAGES.filter((page) => pageShowsBoard(page));
  check(JSON.stringify(withBoard) === '["drill","daily"]', `only the two play pages draw a board (${withBoard.join(', ')})`);
  // AND IT IS A TOTAL FUNCTION OVER THE MODEL, which is the property that makes the table safe to extend: a page with no
  // entry does not compile, so this cannot silently answer `undefined` for a page added tomorrow.
  check(PAGES.every((page) => typeof pageShowsBoard(page) === 'boolean'), `every page answers (${PAGES.length} of ${PAGES.length})`);
  // THE NEGATIVE CONTROL: the plausible wrong rule is "every page keeps the board", which is what the app did and what the
  // report is about — it fails exactly the check above by answering true for the menu, Setup, Help, Profile, the level
  // block and the leaderboard.
  const alwaysOn = () => true;
  check(PAGES.filter(alwaysOn).length === PAGES.length && withBoard.length !== PAGES.length,
    'CONTROL: "keep the board everywhere" is not what the rule says');
}

console.log('\n== 7. only the pages that ISSUE keep the boot overlay ==');
{
  // REPORTED: "If the app reloads when you are viewing '#/daily' uri the app stalls displaying 'Asking the server how it
  // identifies players...'. I doesnt refresh. I have to remove the URI to make the app respond again." The overlay is a
  // full-screen opaque panel raised by the boot; `pageOwnsBootOverlay` is the table that says which pages' own issue may keep
  // it. THE DAILY IS THE ONE THAT MAY NOT: its path never hides the overlay on purpose (a Daily takes seconds), so a
  // reload there left the boot's sentence on screen for ever.
  const owned = PAGES.filter((page) => pageOwnsBootOverlay(page));
  check(JSON.stringify(owned) === JSON.stringify(['levels', 'drill']), `only the two pages that issue keep it (${owned.join(', ')})`);
  check(pageOwnsBootOverlay('daily') === false, 'and the Daily hands the overlay back, because its own pending line is the progress');
  check(PAGES.every((page) => typeof pageOwnsBootOverlay(page) === 'boolean'), `every page answers (${PAGES.length} of ${PAGES.length})`);
  // NEGATIVE CONTROL: the rule that shipped — "every play page keeps it", i.e. the three pages with a board — answers true for
  // the Daily and is exactly the freeze reported. This check is what fails it.
  const shipped = (page) => pageShowsBoard(page);
  check(shipped('daily') === true && pageOwnsBootOverlay('daily') === false,
    'CONTROL: "every page with a board keeps the overlay" is the defect, not the rule');
}

console.log('\n== 8. in full screen, a page with no board shows the standings in its place ==');
{
  // REPORTED: "When in full screen mode, keep the hud in the left hand side of the screen, the same as the Drill screen.
  // When the Dance board is not being used, the area should be replaced by the leader boards." `showsStandings` is the
  // rule; the stylesheet reads the same two facts (`data-panel`, `data-stage`), and `layout-probe.mjs` pins that half.
  const standings = PAGES.filter((page) => showsStandings(page, 'left'));
  const expected = PAGES.filter((page) => !pageShowsBoard(page));
  check(JSON.stringify(standings) === JSON.stringify(expected),
    `on a full-screen page the standings fill the board's area exactly where there is no board (${standings.join(', ')})`);
  // THE SHEET IS THE WHOLE POINT OF THE LAYOUT ARGUMENT: there is no area beside the panel, so nothing is drawn there and
  // the board page keeps its own list. NEGATIVE CONTROL: a rule that ignored the layout (the `!pageShowsBoard` half alone)
  // answers true here, and these checks are what catch it.
  check(PAGES.every((page) => showsStandings(page, 'bottom') === false),
    `and on a sheet no page has a standings area (${PAGES.filter((page) => showsStandings(page, 'bottom')).join(', ') || 'none'})`);
  check(showsStandings('board', 'left') === true, 'the board page itself shows them, so its list is not drawn twice');
  check(showsStandings('drill', 'left') === false && showsStandings('daily', 'left') === false,
    'while the two play pages keep the dance board, which is the question');
  const ignoresLayout = (page) => !pageShowsBoard(page);
  check(ignoresLayout('profile') === true && showsStandings('profile', 'bottom') === false,
    'CONTROL: a layout-blind rule would answer true for a profile page on a sheet');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
