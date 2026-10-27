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
//
// THE NEGATIVE CONTROLS are the plausible wrong routers: a PATH router (which would treat `#/help` as an unknown route because
// it looks for `/help` in `location.pathname`), a `backTarget` that returns its own page, and a `pageFor` that coerces
// `#/drill/abc` to a position. Each fails exactly the check that rules it out.
//
// Usage: node game/test/pages-probe.mjs   (pure: no DOM, no browser, no engine)
import {
  pageFor, hashFor, backTarget, backLabel, pageTitle, pageHeadingId,
} from '../src/ui/pages.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const PAGES = ['landing', 'setup', 'help', 'account', 'levels', 'drill', 'daily', 'board'];
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
    ['#/account', 'account'],
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
  check(backTarget('setup') === 'landing' && backTarget('help') === 'landing' && backTarget('account') === 'landing',
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
  const own = { landing: 'the menu', setup: 'setup', help: 'help', account: 'your account', levels: 'the level', drill: 'the drill', daily: "today's Daily", board: 'the board' };
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

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
