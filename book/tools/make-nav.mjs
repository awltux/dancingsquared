// Put a navigation bar at the head of every page, and keep it correct.
//
// WHAT THE BUTTONS ARE
//   * page by page    -- previous / next page in the book's reading order;
//   * section by section -- previous / next SECTION, where a section is one of the numbered
//     chapters (01-start, 02-language, ... 08-reference). The book was specified as "one
//     Markdown file per section", so a page is a section and a chapter is the grouping above
//     it; both steps are offered because both are useful and neither is a substitute for the
//     other.
//   * plus an in-page list of the page's own `##` sections, which is what "section by section"
//     means inside a call page carrying several call cards.
//
// THE ORDER IS DECLARED HERE, not derived from the filesystem. Sorting would put
// `arrangements-and-gender` before `formations` and `concepts-and-modifiers` before
// `directions`, which is not the order anyone reads them in. Call pages sort by unit number;
// everything else is listed explicitly, and a page that is missing from the lists is an error
// rather than a silent omission.
//
// IDEMPOTENT: the block is delimited by `<!-- nav:start -->` / `<!-- nav:end -->` and replaced
// wholesale, so running it twice cannot stack two navigation bars. `check-links.mjs` fails if
// a page has no block, which is what catches a re-run of `make-reference.mjs` having wiped it.
//
//   node book/tools/make-nav.mjs
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { toolsDir } from './lib/load.mjs';

const BOOK = join(toolsDir, '..');
const START = '<!-- nav:start -->';
const END = '<!-- nav:end -->';

/**
 * Files that are deliberately outside the reading flow: the plan document and the build README.
 * Both are written for whoever maintains the book, not for a dancer, and neither is reachable
 * from the reading order.
 */
const EXCLUDED = new Set(['HANDOVER.md', 'README.md']);

/**
 * The reading order, chapter by chapter. `front` is the material before the numbered chapters.
 */
const ORDER = {
  front: ['index.md', 'conventions.md'],
  '01-start': [
    'what-is-square-dancing.md',
    'the-square.md',
    'your-first-call.md',
    'how-a-call-works.md',
    'timing-and-music.md',
    'tips-and-figures.md',
    'zeroes-getouts-and-modules.md',
    'how-this-book-is-organised.md',
  ],
  '02-language': [
    'naming-the-dancers.md',
    'couples-and-positions.md',
    'directions.md',
    'formations.md',
    'arrangements-and-gender.md',
    'sequence-and-relationship.md',
    'hands-and-holds.md',
    'fractions.md',
    'concepts-and-modifiers.md',
  ],
  '03-rules': [
    'passing-rule.md',
    'same-position-rule.md',
    'facing-couples-rule.md',
    'ocean-wave-rule.md',
    'squared-set-convention.md',
    'circle-rule.md',
    'proper-versus-improper.md',
    'mainstream-restrictions.md',
  ],
  '04-calls': null, // numeric by unit number, discovered from the directory
  '05-course': [
    'course-overview.md',
    'class-01.md',
    'class-02.md',
    'class-03.md',
    'class-04.md',
    'class-05.md',
    'class-06.md',
    'class-07.md',
    'class-08.md',
    'class-09.md',
    'class-10.md',
    'class-11.md',
    'class-12.md',
    'teaching-a-class.md',
  ],
  '06-practice': ['how-to-practise.md', 'drills.md', 'dancing-a-tip.md', 'caller-and-teacher-notes.md'],
  '07-plus': ['where-mainstream-leads.md', 'plus-programme.md', 'plus-call-index.md'],
  '08-reference': [
    'glossary.md',
    'call-index.md',
    'formation-index.md',
    'animations-index.md',
    'watching-the-animations.md',
    'programme-membership.md',
    'moved-and-renamed.md',
    'sources-and-attribution.md',
  ],
};

const LABEL = {
  front: 'Front matter',
  '01-start': 'Start here',
  '02-language': 'The language',
  '03-rules': 'The rules',
  '04-calls': 'The calls',
  '05-course': 'The course',
  '06-practice': 'Practice',
  '07-plus': 'Beyond Mainstream',
  '08-reference': 'Reference',
};

const ARROW = { first: '⏮', prev: '◀', next: '▶', last: '⏭' };

function titleOf(text, fallback) {
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  if (!m) return fallback;
  return m[1].replace(/[*`]/g, '').trim();
}

/** GitHub's heading anchor, matching check-links.mjs. */
function anchor(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function sectionsOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1].replace(/[*`]/g, '').trim());
  }
  return out;
}

function short(s, n = 46) {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

export function buildOrder() {
  const pages = [];
  for (const [chapter, listed] of Object.entries(ORDER)) {
    let names = listed;
    if (names === null) {
      const dir = join(BOOK, chapter);
      names = readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort((a, b) => Number(/^m(\d\d)/.exec(a)?.[1]) - Number(/^m(\d\d)/.exec(b)?.[1]));
    }
    for (const name of names) {
      const path = chapter === 'front' ? name : `${chapter}/${name}`;
      const abs = join(BOOK, path);
      if (!existsSync(abs)) throw new Error(`declared page is missing: ${path}`);
      const text = readFileSync(abs, 'utf8');
      pages.push({ path, chapter, label: LABEL[chapter], title: titleOf(text, name), text });
    }
  }

  // Every navigable page must be declared, or it would silently have no navigation at all.
  const declared = new Set(pages.map((p) => p.path.split('\\').join('/')));
  const onDisk = [];
  for (const dir of readdirSync(BOOK)) {
    const p = join(BOOK, dir);
    if (!statSync(p).isDirectory() || dir === 'tools' || dir === 'figures') continue;
    for (const f of readdirSync(p)) if (f.endsWith('.md')) onDisk.push(`${dir}/${f}`);
  }
  for (const f of ['README.md', 'HANDOVER.md', 'index.md', 'conventions.md']) onDisk.push(f);
  for (const f of onDisk) {
    if (!declared.has(f) && !EXCLUDED.has(f)) throw new Error(`page exists but is not in the reading order: ${f}`);
  }
  return pages;
}

function firstOfChapter(pages, chapter) {
  return pages.find((p) => p.chapter === chapter);
}

function navBlock(page, index, pages) {
  const dir = dirname(page.path.split('/').join('\\'));
  const link = (target) => {
    const rel = relative(dir === '.' ? BOOK : join(BOOK, dir), join(BOOK, target.split('/').join('\\')));
    return rel.split('\\').join('/');
  };
  const chapters = [...new Set(pages.map((p) => p.chapter))];
  const ci = chapters.indexOf(page.chapter);
  const prevChapterPage = ci > 0 ? firstOfChapter(pages, chapters[ci - 1]) : null;
  const nextChapterPage = ci < chapters.length - 1 ? firstOfChapter(pages, chapters[ci + 1]) : null;
  const prev = index > 0 ? pages[index - 1] : null;
  const next = index < pages.length - 1 ? pages[index + 1] : null;

  // ICONS ONLY. Where each one goes is carried as a link TITLE, which a renderer shows on
  // hover (and a screen reader may read), so the bar stays a single clean line without
  // becoming a row of unlabelled glyphs.
  const icon = (glyph, target, title) => `[${glyph}](${target} "${title}")`;
  // A dead end is a struck-through glyph with NO link at all -- not an empty link, which some
  // renderers turn into a stray `[⏮]("...")` rather than a greyed-out button.
  const off = (glyph) => `~~${glyph}~~`;

  const bits = [
    prevChapterPage ? icon(ARROW.first, link(prevChapterPage.path), `Previous section: ${prevChapterPage.label}`) : off(ARROW.first),
    prev ? icon(ARROW.prev, link(prev.path), `Previous page: ${prev.title}`) : off(ARROW.prev),
    icon('☰', link('index.md'), 'Contents'),
    next ? icon(ARROW.next, link(next.path), `Next page: ${next.title}`) : off(ARROW.next),
    nextChapterPage ? icon(ARROW.last, link(nextChapterPage.path), `Next section: ${nextChapterPage.label}`) : off(ARROW.last),
  ];

  return `${START}\n**${bits.join(' ')}**\n${END}\n`;
}

export function main() {
  const pages = buildOrder();
  let written = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const abs = join(BOOK, page.path.split('/').join('\\'));
    // Replace any existing block wholesale, so running twice cannot stack two nav bars.
    const stripped = page.text
      .replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), '')
      .replace(/^\s+/, '');
    const withNav = `${navBlock({ ...page, text: stripped }, i, pages)}\n${stripped}`;
    if (withNav !== page.text) {
      writeFileSync(abs, withNav, 'utf8');
      written++;
    }
  }
  console.log(`${written} page(s) given a navigation bar (${pages.length} pages in the reading order).`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}
