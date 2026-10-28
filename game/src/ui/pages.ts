// THE APP'S PAGES, AS A PURE FUNCTION OF THE URL — the one place that knows what a page is.
//
// WHY A ROUTER AT ALL. Until this module the app had one screen with a mode TAB on it (`#modes`: "The Drill" / "Today's
// Daily") and four sections shown and hidden by hand: the level block, the drill, the Daily and the board. That worked while
// there were two places to be, and it stops working the moment there are seven — the browser's back button did nothing, a
// reload forgot where the player was, and a link to a page could not exist. REPORTED as "Lets introduce pages and a simple
// navigation system ... a back button" — a back BUTTON without URLs is a button that leaves the browser's own navigation
// broken, which on an installed app is the difference between a page and a panel.
//
// HASH, NOT PATH. The app is served from a subpath as often as from a root (`vite.config.ts` sets `base: './'`), it installs
// as a PWA whose service worker caches ONE document, and there is no server-side history fallback to configure. A `#/…` URL
// is answered by the same document under every one of those, so a deep link works from a static host, a file:// build and
// the cached shell alike.
//
// THIS MODULE KNOWS NOTHING BUT THE ROUTE. Which page a hash names, what that page's URL is, where its back button goes and
// what it is called — all arithmetic. `main.ts` owns the browser (`location.hash`, `hashchange`) and each screen owns its
// own DOM, which is what lets `pages-probe.mjs` drive every navigation rule without a browser (AGENTS.md §4.3).

/** A place in the app. Order is the order the landing page offers them. */
export type Page = 'landing' | 'setup' | 'help' | 'profile' | 'levels' | 'drill' | 'daily' | 'board';

/** A parsed route: the page, and the drill position a deep link names (null for every other page). */
export interface Route {
  readonly page: Page;
  readonly drillIndex: number | null;
}

/** The page a URL names, and the drill index when the URL names one. */
export function pageFor(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  // A HASH THAT IS NOT A PATH IS NOT A PAGE. `#something`, `?x=1` and a bare `#` all land on the landing page rather than
  // being coerced into one — a router that guesses is a router whose 404 is invisible.
  if (!raw.startsWith('/')) return { page: 'landing', drillIndex: null };
  // One trailing slash is the same page as without it (`#/help/` === `#/help`), and the route table keys are
  // case-insensitive so a hand-typed or upper-cased URL still lands.
  const path = (raw.length > 1 ? raw.replace(/\/+$/, '') : raw).toLowerCase();
  const drill = /^\/drill(?:\/(\d+))?$/.exec(path);
  if (drill) {
    // `#/drill` with no index means "the drill this player is on", which is what the back button from a deep link
    // reaches; `#/drill/3` names a position, and the SHELL decides whether that position may be opened (a URL must never
    // be able to advance a season — see `main.ts`'s `applyPage`).
    return { page: 'drill', drillIndex: drill[1] === undefined ? null : Number(drill[1]) };
  }
  const table: Record<string, Page> = {
    '': 'landing',
    '/': 'landing',
    '/setup': 'setup',
    '/help': 'help',
    '/profile': 'profile',
    '/levels': 'levels',
    '/daily': 'daily',
    '/board': 'board',
  };
  return { page: table[path] ?? 'landing', drillIndex: null };
}

/** The URL for a route — the exact inverse of `pageFor`, which `pages-probe.mjs` pins by round-trip. */
export function hashFor(route: Route): string {
  if (route.page === 'drill') return route.drillIndex === null ? '#/drill' : `#/drill/${route.drillIndex}`;
  if (route.page === 'landing') return '#/';
  return `#/${route.page}`;
}

/**
 * Where a page's back button goes, or null when there is nowhere to go.
 *
 * A BACK BUTTON IS A PLACE, NOT A HISTORY STEP. An in-app back that popped history would follow the player's wandering
 * (Help → Profile → Help → back → Profile), which is not what a back arrow in a game means; a page's parent is a fact about
 * the PAGES, so it is a table here and the probe checks that no page is its own parent.
 */
export function backTarget(page: Page): Page | null {
  switch (page) {
    case 'landing':
      return null;
    case 'levels':
    case 'daily':
    case 'board':
    case 'setup':
    case 'help':
    case 'profile':
      return 'landing';
    case 'drill':
      return 'levels';
  }
}

/** What the back button says, for the banner's own label and for its accessible name. */
export function backLabel(page: Page): string {
  const target = backTarget(page);
  if (target === null) return '';
  const name: Record<Page, string> = {
    landing: 'the menu',
    setup: 'setup',
    help: 'help',
    profile: 'your profile',
    levels: 'the level',
    drill: 'the drill',
    daily: "today's Daily",
    board: 'the board',
  };
  return `Back to ${name[target]}`;
}

/**
 * The path to a page, oldest first and ending on the page itself — a breadcrumb, as arithmetic.
 *
 * REPORTED: "The Back button feels inappropriate for the top banner. A secondary banner could have a breadcrumb (minimalist) and
 * the back button." So the path is a SECOND row under the first, and it is derived from the same table the back button uses: the
 * parent chain, walked up and reversed. A breadcrumb kept as its own literal list would be a second statement of the page graph,
 * and the first one to be edited alone would be wrong (`backTarget` is the authority).
 *
 * IT INCLUDES THE PAGE ITSELF, because a breadcrumb's last crumb is where you are. The landing page's path is one crumb, and the
 * shell draws no breadcrumb row at all for it: a path of one is a label, not a path.
 */
export function breadcrumbFor(page: Page): Page[] {
  const path: Page[] = [];
  // A BOUNDED WALK, because a table with a cycle in it would otherwise hang the shell: `backTarget` is six lines of arithmetic
  // today, and a walk that cannot terminate is the one failure a path function must not have.
  for (let step: Page | null = page; step !== null && path.length <= 8; step = backTarget(step)) path.push(step);
  return path.reverse();
}

/**
 * The word a breadcrumb uses for a page — SHORTER THAN THE TITLE, because a path has to fit in a 340 px panel.
 *
 * `pageTitle` is a document title and a page heading ("The drill level", "Dancing Squared"); a crumb is a signpost, and three
 * of those titles in a row overflow the row that carries them (MEASURED on the first version at 1280 x 800: "Dancing Squar… /
 * The drill le… / D…"). The menu's crumb is "Menu" rather than the app's name, which is the conventional root and the only one
 * whose title is not about where you are.
 */
export function crumbLabel(page: Page): string {
  const label: Record<Page, string> = {
    landing: 'Menu',
    setup: 'Setup',
    help: 'Help',
    profile: 'Profile',
    levels: 'Drill level',
    drill: 'Drill',
    daily: "Today's Daily",
    board: 'Board',
  };
  return label[page];
}

/** The page's own name, as the document title and as the `<h2>` a screen reader lands on. */
export function pageTitle(page: Page): string {
  const title: Record<Page, string> = {
    landing: 'Dancing Squared',
    setup: 'Setup',
    help: 'How to play',
    profile: 'Your profile',
    levels: 'The drill level',
    drill: 'Drill',
    daily: "Today's Daily",
    board: 'The board',
  };
  return title[page];
}

/**
 * The `<h2>` each page focuses after a navigation, so a page change is announced and the tab order starts at the top of the
 * page rather than wherever the link that opened it happened to be.
 */
export function pageHeadingId(page: Page): string {
  const id: Record<Page, string> = {
    landing: 'landingHeading',
    setup: 'setupHeading',
    help: 'helpHeading',
    profile: 'profileHeading',
    levels: 'levelsHeading',
    drill: 'drillHeading',
    daily: 'dailyHeading',
    board: 'boardHeading',
  };
  return id[page];
}
