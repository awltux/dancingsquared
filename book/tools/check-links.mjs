// The gate that keeps a cross-referenced book honest.
//
// WHAT IT CHECKS
//   1. every relative link in every Markdown file resolves to a file that exists;
//   2. every `#fragment` resolves to a heading in the target file;
//   3. a link that NAMES a formation on the Formations page lands on that formation's heading,
//      not on the top of the page;
//   4. every teaching unit M1..M50 has a call page;
//   5. no call page exists for a call that is NOT in the 2026 programme;
//   6. every figure is referenced by some page, and every referenced figure exists.
//   7. no file has been corrupted by a single-byte encoding round-trip;
//   8. no reader-facing page speaks in the tools' language.
//
// A book whose whole design is "define it once and link to it" fails quietly when a link
// rots: the reader gets a dead end and no way to tell whether the page or the anchor is
// wrong. So this is a gate, not a report.
//
//   node book/tools/check-links.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { toolsDir } from './lib/load.mjs';
import { buildOrder } from './make-nav.mjs';

const BOOK = join(toolsDir, '..');
const problems = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '.cache' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** GitHub's heading anchor: lower-case, punctuation dropped, spaces to hyphens. */
function anchors(text) {
  const set = new Set();
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    set.add(
      m[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-'),
    );
  }
  return set;
}

const files = walk(BOOK).filter((f) => f.endsWith('.md'));
const markdown = new Map();
const anchorCache = new Map();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  markdown.set(f, text);
  anchorCache.set(f, anchors(text));
}

const referencedDiagrams = new Set();
/** The formations the Formations page defines, spelled the way a link names them. A link carrying
 *  one of these names must carry that formation's fragment: `[Ocean Wave](formations.md)` drops the
 *  reader at the top of a long page and leaves them to hunt, which is the failure this gate exists
 *  for. Generic links (`[Formations]`, `[formation diagrams]`) are not in the set and stay on the
 *  page top, which is where they belong. */
const FORMATION_NAMES = new Set(
  [
    'Squared Set',
    'Static Square',
    'Circle',
    'Infacing Circle of 8',
    'Promenade',
    'Facing Dancers',
    'Facing Couples',
    'facing couple',
    'Eight Chain Thru',
    'Couple',
    'Tandem',
    'Tandem Couple',
    'Tandem Couples',
    'Facing Tandems',
    'facing tandem',
    'Back-to-Back Tandems',
    'Back-to-Back Couples',
    'back-to-back',
    'Lines',
    'line',
    'General Line',
    'Facing Lines',
    'Tidal Line',
    'One-Faced Line',
    'Two-Faced Line',
    'Two-Faced Lines',
    'One-Faced or Two-Faced Line',
    'Wave',
    'Waves',
    'Ocean Wave',
    'Mini-Wave',
    'Columns',
    'Column',
    'Box',
    'Box Circulate',
    'Diamond',
    'Alamo Style',
    'Alamo Ring',
    'Thar',
    'Tag formations',
    'tagging formations',
    'Double Pass Thru',
    'Completed Double Pass Thru',
  ].map((s) => s.toLowerCase()),
);
/** How many calls the site can play, for the summary line. Filled by the animation check below. */
let playableCalls = 0;
/** Always compare with FORWARD slashes: `path.relative` returns backslashes on Windows, and
 *  the orphan check silently reported every figure as unreferenced because of it. */
const slashed = (p) => p.split('\\').join('/');

// ---- no mojibake: a UTF-8 file must never be round-tripped through a single-byte encoding
//
// Every other check in this file passes on a file that has been read as windows-1252 and written back
// as UTF-8: the links still resolve, the headings still anchor, the page still builds. Only the
// READER can see the damage, and what they see is rubbish -- an em dash becomes "a-hat euro
// right-quote", a right arrow "a-hat dagger apostrophe". It happens in one careless step (PowerShell
// 5.1's `Get-Content`/`Set-Content` is the usual culprit), and the character moves so silently that
// fourteen em dashes shipped to a built page before anyone noticed. The sequences below cannot occur
// in honest text: a stray `A-tilde` or `A-circumflex` followed by a control-range character is always
// the ghost of a UTF-8 character that was misunderstood.
//
// A file whose SUBJECT is this corruption has to be able to write it down -- `clean-extract.mjs`
// repairs it, `HANDOVER.md` documents it -- so those files, and only those, opt out with the sentinel
// below. The opt-out is a visible line in the file, not a name hidden in a list here.
const MOJIBAKE_ALLOW = 'mojibake-check:allow';
const MOJIBAKE = /\u00e2\u20ac|\u00e2\u2020|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]/;
const TEXT_FILE = /\.(md|mjs|js|json|css|html|txt)$/;
for (const f of walk(BOOK).filter((f) => TEXT_FILE.test(f))) {
  const rel = slashed(relative(BOOK, f));
  if (rel.startsWith('dancingsquared_book/')) continue; // generated from the sources checked here
  const text = markdown.get(f) ?? readFileSync(f, 'utf8');
  if (text.includes(MOJIBAKE_ALLOW)) continue;
  for (const m of text.matchAll(new RegExp(MOJIBAKE, 'g'))) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(
      `${rel}:${line}: mojibake (${JSON.stringify(m[0])}) — the file was round-tripped through a single-byte encoding`,
    );
  }
}

// ---- a page is read by dancers, so it must not speak in the tools' language
//
// The rule is §7's, and it is older than this check: `book/*.md` is read by dancers, so no page may
// describe how the book is made. What makes it worth a gate is how the words get in -- they are the
// words whoever built the page was looking at. "If the board does not meet its precondition the call
// refuses rather than guessing" is the engine's own account of a geometry call, and to a dancer it is
// nonsense; the hand-over asked for it to be said from the caller's side instead. Four such sentences
// were found by hand in one afternoon (three of them the word "board", one a picture-axis "+y"), which
// is the argument for a list rather than an eye.
//
// Every word here has no honest reader-facing use in this book. "engine" is deliberately NOT in the
// list: the Introduction tells the reader, in so many words, that an experimental engine draws the
// animations, so the word has a legitimate place. Nor is `README.md` or `HANDOVER.md` checked -- those
// two are workspace files, and they are supposed to talk about corpora and toolchains.
const JARGON =
  /\b(boards?|preconditions?|corpus|corpora|sequencers?|rasterisers?|rasterizers?|metadata|authorings?|XML|JSON)\b|\+y\b/;
for (const [file, text] of markdown) {
  const rel = slashed(relative(BOOK, file));
  if (rel === 'README.md' || rel === 'HANDOVER.md') continue;
  for (const m of text.matchAll(new RegExp(JARGON, 'g'))) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(
      `${rel}:${line}: tools' language in a reader-facing page (${JSON.stringify(m[0])}) — say it from the dancer's or caller's side`,
    );
  }
}

for (const [file, text] of markdown) {
  const rel = relative(BOOK, file);
  // Markdown links and images. Ignore absolute URLs, mailto and bare anchors on the same page.
  const re = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(text))) {
    const [, bang, label, target] = m;
    if (/^(https?:|mailto:)/.test(target)) continue;
    // A bare `#anchor` points into THIS page -- the "on this page" section links. They are
    // checked too, because an anchor the generator computed wrongly is exactly the kind of
    // dead end a reader cannot diagnose.
    if (target.startsWith('#')) {
      const frag = decodeURIComponent(target.slice(1)).toLowerCase();
      if (frag && !(anchorCache.get(file) ?? anchors(text)).has(frag)) {
        problems.push(`${rel}: dead in-page anchor -> ${target}`);
      }
      continue;
    }
    const [pathPart, frag] = target.split('#');
    const abs = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : file;
    if (!existsSync(abs)) {
      problems.push(`${rel}: dead link -> ${target}`);
      continue;
    }
    if (pathPart.endsWith('.png') && slashed(relative(BOOK, abs)).startsWith('formations/')) {
      referencedDiagrams.add(slashed(relative(BOOK, abs)));
    }
    if (frag && abs.endsWith('.md')) {
      const set = anchorCache.get(abs) ?? anchors(readFileSync(abs, 'utf8'));
      anchorCache.set(abs, set);
      if (!set.has(decodeURIComponent(frag).toLowerCase())) {
        problems.push(`${rel}: dead anchor -> ${target}`);
      }
    }
    // A link that names a formation must reach that formation's heading.
    if (/formations\.md$/.test(pathPart) && !frag && FORMATION_NAMES.has(label.trim().replace(/\s+/g, ' ').toLowerCase())) {
      problems.push(`${rel}: "…${label.trim()}…" links to the Formations page top, not its heading -> ${target}`);
    }
    void bang;
  }
}

// ---- coverage: every teaching unit has a page, and no non-member has one
const mapPath = join(toolsDir, 'call-map.json');
let expected = 0;
if (existsSync(mapPath)) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const callDir = join(BOOK, '04-calls');
  const present = new Set(existsSync(callDir) ? readdirSync(callDir).filter((f) => f.endsWith('.md')) : []);
  for (const u of map.units) {
    expected++;
    const nn = String(u.n).padStart(2, '0');
    const hit = [...present].some((f) => f.startsWith(`m${nn}-`));
    if (!hit) problems.push(`04-calls: no page for unit M${u.n} (${u.title})`);
  }
  const strays = [...present].filter((f) => {
    const n = Number(/^m(\d\d)/.exec(f)?.[1]);
    return !Number.isFinite(n) || n < 1 || n > map.units.length;
  });
  for (const s of strays) problems.push(`04-calls: ${s} does not correspond to a teaching unit`);
}

// ---- formation diagrams: nothing orphaned, nothing missing
const formDir = join(BOOK, 'formations');
if (existsSync(formDir)) {
  const onDisk = new Set(readdirSync(formDir).filter((f) => f.endsWith('.png')).map((f) => `formations/${f}`));
  for (const f of onDisk) {
    if (!referencedDiagrams.has(f)) problems.push(`formations: ${f} is never referenced by any page`);
  }
  for (const f of referencedDiagrams) {
    if (!onDisk.has(f)) problems.push(`formations: ${f} is referenced but does not exist`);
  }
}

// ---- the animations, matched to the call cards they belong to
//
// The book carries ONE animation per call: the interactive player, which the site builder injects
// under the page's `### Animation` heading. So there is no per-call image to orphan-check any more --
// what can go wrong instead is the PAIRING. The builder gives each call card a slot in teaching
// order and fills it with that card's animation or a null, which means the page must carry exactly
// one `### Animation` heading per card or every later player slides onto the wrong call. That is a
// silent, plausible-looking failure, so it is a gate.
const animIndex = join(toolsDir, 'animations-index.json');
if (existsSync(mapPath) && existsSync(animIndex)) {
  const units = JSON.parse(readFileSync(mapPath, 'utf8')).units;
  const playable = new Set(JSON.parse(readFileSync(animIndex, 'utf8')).figures.map((f) => f.id));
  playableCalls = playable.size;
  const callDir = join(BOOK, '04-calls');
  const present = existsSync(callDir) ? readdirSync(callDir).filter((f) => f.endsWith('.md')) : [];
  const placed = new Set();

  for (const u of units) {
    const nn = String(u.n).padStart(2, '0');
    const file = present.find((f) => f.startsWith(`m${nn}-`));
    if (!file) continue; // the coverage check above already reported the missing page
    const text = readFileSync(join(callDir, file), 'utf8');
    const headings = (text.match(/^###\s+(Animation|Figure)\s*$/gim) ?? []).length;
    if (headings !== u.entries.length) {
      problems.push(
        `04-calls/${file}: ${headings} animation heading(s) for ${u.entries.length} call card(s) — ` +
          'a player would be injected under the wrong call',
      );
    }
    for (const e of u.entries) {
      const id = `m${nn}${e.letter ?? ''}`;
      if (playable.has(id)) placed.add(id);
    }
  }
  for (const id of playable) {
    if (!placed.has(id)) problems.push(`animations-index: ${id} is playable but sits on no call card`);
  }
}

// ---- every navigable page carries its navigation bar
// This is not decoration: `make-reference.mjs` rewrites its pages from scratch, so a nav bar
// it did not write is destroyed by it. Requiring the sentinel here turns that into a failed
// gate instead of pages that quietly lose their navigation.
for (const [file, text] of markdown) {
  const rel = slashed(relative(BOOK, file));
  if (rel === 'HANDOVER.md' || rel === 'README.md') continue;
  if (!text.includes('<!-- nav:start -->')) {
    problems.push(`${rel}: no navigation bar (run book/tools/make-nav.mjs)`);
  }
}

// ---- generated reference pages must not be edited by hand
for (const f of ['call-index', 'formation-index', 'animations-index', 'programme-membership', 'moved-and-renamed']) {
  const p = join(BOOK, '08-reference', `${f}.md`);
  if (!existsSync(p)) {
    problems.push(`08-reference: ${f}.md is missing (run book/tools/make-reference.mjs)`);
    continue;
  }
  if (!readFileSync(p, 'utf8').includes('GENERATED by book/tools/make-reference.mjs')) {
    problems.push(`08-reference: ${f}.md is missing its generated header`);
  }
}

// ---- the contents page must link to every page in the book
//
// THE CONTENTS IS THE MAP, and a page the map does not name is a page a reader cannot find. The list
// is hand-written and grows stale the moment a page is added, which is a silent failure -- the site
// still builds, the page is still published, and nothing points at it. The reading order itself is
// the authority (it is what the navigation bars are built from), so it is what this compares against.
//
// The contents names itself in its own table ("Contents -- this page"), but that row is not a link,
// so it is exempt: a page cannot link to itself.
const contentsPath = join(BOOK, 'contents.md');
if (!existsSync(contentsPath)) {
  problems.push('contents.md (the contents page) is missing');
} else {
  const contents = readFileSync(contentsPath, 'utf8');
  const targets = new Set(
    [...contents.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1].split(/[?#]/)[0]).filter(Boolean),
  );
  for (const page of buildOrder()) {
    if (page.path === 'contents.md') continue;
    if (!targets.has(page.path)) problems.push(`contents.md: no link to ${page.path}`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(
  `${files.length} pages, ${expected} teaching units, ${playableCalls} playable calls; all links, anchors and coverage checks pass.`,
);
