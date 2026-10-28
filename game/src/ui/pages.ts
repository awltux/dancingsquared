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

/**
 * Whether the PAGE needs the dance board drawn behind it.
 *
 * REPORTED: "hide the dancing board when displaying a page, only expose it when they are part of the game e.g. Daily
 * Target and Drill play pages." The board is the QUESTION on those two — the pair a drill compares, the waypoints a Daily
 * walks — and on every other page it was a picture of nothing: on a phone it took the top two thirds of the window off a
 * Setup or Profile page and pushed the panel into a sheet, which is exactly the screen real estate the owner has been
 * reclaiming all session.
 *
 * IT IS A TABLE OF PAGES AND NOT A LIST OF EXCEPTIONS, for the reason `backTarget` is one: a page added to the model
 * cannot appear without an answer, because `Record<Page, boolean>` does not compile without one.
 */
export function pageShowsBoard(page: Page): boolean {
  const shown: Record<Page, boolean> = {
    landing: false,
    setup: false,
    help: false,
    profile: false,
    levels: false,
    drill: true,
    daily: true,
    board: false,
  };
  return shown[page];
}

/**
 * Whether a page's DANCE-BOARD AREA holds the STANDINGS instead.
 *
 * REPORTED: "When in full screen mode, keep the hud in the left hand side of the screen, the same as the Drill screen.
 * When the Dance board is not being used, the area should be replaced by the leader boards." FULL SCREEN IS THE SHELL'S
 * `panelSide: 'left'` (`ui/layout.ts`), not a viewport number spelled again here: on a sheet the page IS the panel, so
 * there is no area to fill and the board page keeps its own in-panel list.
 *
 * IT IS THE SAME TWO FACTS THE STYLESHEET READS — `data-panel` and `data-stage`, both written by `paintPages`/`applyLayout`
 * — so the rule and the layout cannot disagree about which pages show a board. `layout-probe.mjs` pins the CSS half and
 * `pages-probe.mjs` this one.
 */
export function showsStandings(page: Page, panelSide: 'left' | 'bottom'): boolean {
  return panelSide === 'left' && !pageShowsBoard(page);
}

/** What the back button says, for the banner's own label and for its accessible name.
 *
 * AND IT IS THE ONLY THING THE BUTTON SAYS NOW. A breadcrumb second row was derived from this same table (`breadcrumbFor`,
 * `crumbLabel`) when the report asked for one — "The Back button feels inappropriate for the top banner. A secondary banner
 * could have a breadcrumb (minimalist) and the back button" — and the next report withdrew it: "Change the back button to just
 * an square back arrow and move it up to the top left of the header. Delete the breadcrumb. This makes more screen real
 * estate." Both functions are gone rather than left unused: the visible word "Back" went with the row, so the destination is
 * carried by this label alone, as the arrow's accessible name and hover title.
 */
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
