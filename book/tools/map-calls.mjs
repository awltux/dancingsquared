// Parse the CALLERLAB 2026 Mainstream Suggested Teaching Order out of the cleaned manual,
// and resolve each unit to the corpus site(s) that can animate it.
//
// TWO DIFFERENT QUESTIONS, kept apart on purpose:
//   * MEMBERSHIP  -- is this call in the 2026 program? The MANUAL answers that, and the
//                    corpus's own level tag is ignored where it disagrees.
//   * ANIMATION   -- which corpus file can draw it? That is a data question, and the answer
//                    may live at ANY level, because a call that moved into Mainstream from
//                    a call taught at several levels may be authored under any of them.
//
// MATCHING IS EXACT (plus a hand-written alias table), never fuzzy. A fuzzy match was tried
// and produced WRONG answers -- "(Named Dancers) Circulate" resolved to "Ping Pong
// Circulate" -- and a wrong call name under a right picture is exactly the defect a book
// must not ship. Anything unresolved is reported as unresolved and gets no figure.
//
//   node book/tools/map-calls.mjs           # write call-map.json and print the mapping
//   node book/tools/map-calls.mjs --titles  # print every corpus title and its sites
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { toolsDir, loadEngine, catalogue } from './lib/load.mjs';

const CLEANED = join(toolsDir, '.cache', 'mainstream.cleaned.txt');
const OUT = join(toolsDir, 'call-map.json');

/** Normalise a call name: drop parentheticals, families, fractions and punctuation. */
export function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bfamily\b/g, ' ')
    .replace(/\bpage\b.*$/, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\b(quarter|half|three[- ]quarters|full)\b/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Exact bridges between the manual's name and the corpus's title, each one VERIFIED against
 * the corpus's own title list rather than guessed. A name difference only -- geometry is
 * settled by the reconciliation step, never here.
 */
export const TITLE_ALIASES = {
  circleleftright: 'Circle Left',
  circleof4leftright: 'Circle Four Left Full',
  singlecircleleftright: 'Single Circle Left Full',
  couplespromenade: 'All 4 Couples Promenade Full',
  singlefilepromenade: 'Single File Promenade',
  starpromenade: 'Star Promenade',
  wrongwaypromenade: 'All 4 Couples Wrong Way Promenade Full',
  allemandeleftright: 'Allemande Left',
  starrightleft: 'Right Hand Star',
  weavethering: 'Weave the Ring',
  wrongwaygrand: 'Wrong Way Grand',
  wheelaroundreversewheelar: 'Wheel Around',
  swing: 'Swing Your Partner',
  fourladieschain: 'Four Ladies Chain',
  tagline: 'Tag the Line',
  chaindownline: 'Chain Down the Line',
  rollaway: 'Rollaway',
  ladiesinmensashay: 'Ladies In, Men Sashay',
  separate: 'Heads Separate',
  separatearound1or2toaline: 'Around One to a Line',
  separatearound1or2intomiddle: 'Around One and Come Into the Middle',
  leadrightleadleft: 'Lead Right',
  veerleftveerright: 'Veer Left',
  circulate: 'Circulate',
  alleightcirculate: 'All 8 Circulate',
  singlefilecirculate: 'Column Circulate',
  boxsplitcirculate: 'Box Circulate',
  squarethruleftsquarethru: 'Square Thru 4',
  grandsquare: 'Grand Square',
  firstcouplegoleftrightnextcouplegorightleft: 'First Couple Go Left, Next Couple Go Right',
  alamostyle: 'Allemande Left in the Alamo Style',
  trade: 'Boys Trade',
  swingthruleftswingthru: 'Swing Thru',
  runcrossrun: 'Boys Run',
  flutterwheelreverseflutterwheel: 'Flutterwheel',
  sweepa: 'Sweep a Quarter Right',
  singlehinge: 'Hinge',
  foldcrossfold: 'Boys Fold',
  fractiontag: 'Half Tag',
};

/** Pre-split lines holding more than one "M n." unit, and repair the "M OO." OCR damage. */
function preSplit(lines) {
  return lines
    .flatMap((l) => l.replace(/\bM\s*OO\s*\./g, 'M 22. ').split(/(?=\bM\s*\d+\s*\.)/).filter(Boolean));
}

const TRIM_NOTE = /\s*(until later in the teaching sequence.*|It is suggested.*|See details.*)$/i;

/** Parse the "M n." unit blocks and their "a."/"b." parts. */
export function parseTeachingOrder(text) {
  const lines = preSplit(text.split('\n'));
  const start = lines.findIndex((l) => /Suggested Teaching Order/i.test(l) && !/Added the/.test(l));
  if (start < 0) throw new Error('teaching order heading not found in the cleaned manual');

  const units = [];
  let current = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^Alphabetical Index/.test(line)) break;

    // Tolerate the extract's spacing damage: "M1 2." is unit 12.
    const merged = /^M\s*(\d+)\s*\.?\s*(\d+)?\.?\s+(.+)$/.exec(line);
    if (merged) {
      const n = Number(`${merged[1]}${merged[2] ?? ''}`);
      const title = merged[3].replace(/\s+page:?\s*\d+.*$/i, '').replace(TRIM_NOTE, '').replace(/\s+\d+\s*$/, '').trim();
      current = { n, title, parts: [] };
      units.push(current);
      continue;
    }
    const part = /^([a-e])\.\s*(.+)$/.exec(line);
    if (part && current) {
      current.parts.push({ letter: part[1], title: part[2].replace(TRIM_NOTE, '').replace(/\s+\d+\s*$/, '').trim() });
      continue;
    }
    if (current && !current.parts.length && /^[A-Za-z]/.test(line) && line.length < 60) {
      current.title = `${current.title} ${line}`.replace(TRIM_NOTE, '').trim();
    }
  }

  // De-duplicate (the teaching order appears twice: in the TOC and in the body).
  const seen = new Set();
  return units.filter((u) => {
    if (!Number.isFinite(u.n) || u.n < 1 || u.n > 50 || seen.has(u.n)) return false;
    seen.add(u.n);
    return true;
  });
}

export function main() {
  const text = readFileSync(CLEANED, 'utf8');
  const units = parseTeachingOrder(text);
  const eng = loadEngine();
  const byTitle = catalogue();

  if (process.argv.includes('--titles')) {
    for (const t of [...byTitle.keys()].sort()) console.log(`${t}\t${byTitle.get(t).map((s) => s.file).join(', ')}`);
    return 0;
  }

  // TWO-TIER LOOKUP. An exact title match is tried FIRST, because normalisation strips
  // fraction words and that COLLIDES: normalise("Tag the Line") and normalise("3/4 Tag the
  // Line") are both "tagline", so a normalised-only index matched Tag the Line to 3/4 Tag
  // the Line. A normalised key claimed by more than one title is ambiguous and is refused
  // rather than resolved by whichever happened to be inserted first.
  const exact = new Map();
  for (const t of byTitle.keys()) {
    const k = t.toLowerCase().trim();
    if (!exact.has(k)) exact.set(k, t);
  }
  const index = new Map();
  const collisions = new Set();
  for (const t of byTitle.keys()) {
    const k = normalise(t);
    if (!k) continue;
    if (index.has(k) && index.get(k) !== t) collisions.add(k);
    else index.set(k, t);
  }
  for (const k of collisions) index.delete(k);

  const report = [];
  const out = { source: 'docs/New_Mainstream_Definitions_26-03-29.pdf', units: [] };

  for (const u of units) {
    const entries = u.parts.length
      ? u.parts.map((p) => ({ letter: p.letter, title: p.title }))
      : [{ letter: null, title: u.title }];

    const resolved = entries.map((e) => {
      const key = normalise(e.title);
      const viaAlias = TITLE_ALIASES[key];
      let corpusTitle = null;
      let how = 'unresolved';
      if (exact.has(e.title.toLowerCase().trim())) {
        corpusTitle = exact.get(e.title.toLowerCase().trim());
        how = 'exact';
      } else if (viaAlias && byTitle.has(viaAlias)) {
        corpusTitle = viaAlias;
        how = 'alias';
      } else if (index.has(key)) {
        corpusTitle = index.get(key);
        how = 'normalised';
      } else if (viaAlias) {
        how = `alias-missing(${viaAlias})`;
      }
      return { ...e, corpusTitle, how, sites: corpusTitle ? byTitle.get(corpusTitle) ?? [] : [] };
    });

    out.units.push({ n: u.n, title: u.title, entries: resolved });
    for (const r of resolved) {
      report.push(
        `M${String(u.n).padStart(2)}${r.letter ?? ' '}  ${r.sites.length ? 'OK ' : '-- '} ${r.title}` +
          `${r.corpusTitle && r.corpusTitle !== r.title ? `  -> ${r.corpusTitle}` : ''}` +
          `${r.sites.length ? `  [${r.sites.map((s) => s.file).join(', ')}]` : ''}  (${r.how})`,
      );
    }
  }

  // Guard against the alias table rotting: an alias naming a title the corpus does not have
  // is a silent gap, so it is reported rather than ignored.
  for (const [k, t] of Object.entries(TITLE_ALIASES)) {
    if (!byTitle.has(t)) report.push(`!! alias "${k}" -> "${t}" but the corpus has no such title`);
    void k;
  }

  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(report.join('\n'));

  const total = out.units.reduce((a, u) => a + u.entries.length, 0);
  const mapped = out.units.reduce((a, u) => a + u.entries.filter((e) => e.sites.length).length, 0);
  const unresolved = total - mapped;
  console.log(`\n${out.units.length} units, ${total} entries, ${mapped} with corpus data, ${unresolved} with none`);
  console.log(`-> ${OUT}`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}
