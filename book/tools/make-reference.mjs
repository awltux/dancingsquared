// Generate the reference pages that must not be maintained by hand.
//
// Everything here is DERIVED from the data: the teaching order, the corpus, the figure index
// and the Plus manual's own contents list. A table like this kept by hand goes stale silently
// -- which is the failure this repository has already been bitten by once -- so it is
// generated and `check-links.mjs` re-runs this tool's `--check` mode.
//
// THE THREE-WAY CLASSIFICATION is a MEASUREMENT, not an inference: a corpus entry is
// "Mainstream" only if the manual's teaching order names it, "Plus" only if the Plus manual's
// contents list names it, and otherwise "outside both" -- because inferring "not Mainstream
// therefore Plus" was checked and found FALSE for calls that are in neither manual.
//
//   node book/tools/make-reference.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toolsDir, loadEngine, catalogue } from './lib/load.mjs';

const REF = join(toolsDir, '..', '08-reference');
const CACHE = join(toolsDir, '.cache');

/**
 * Corpus files that are NOT calls, each with the reason, established by reading them:
 *   running_bear  a singing-call ROUTINE -- one tam that plays Ladies Chain, Rollaway, Star
 *                 Thru, Dive Thru... as raw moves, with the call names only in comments
 *   grand_spin    opens "FIGURE OF GRAND SPIN AS FOLLOWS..." -- a figure, not a call
 *   moves         the move registry itself
 * plus the rule/style/terminology files and the generated `discovered` authorings.
 */
const NOT_A_CALL = new Map([
  ['Running Bear', 'routine (a singing-call routine, not a call definition)'],
  ['Sides Face, Grand Spin', 'routine (a figure, not a call definition)'],
]);
const RULE_OR_TERM = new Set([
  'Face Left',
  'Right Pull By',
  'Step Thru',
  'Forward and Back',
  'Circulate 1 1/2',
  'Allemande Left to an Alamo Ring',
]);
const RULE_FILE = /(_rule|_style)\.xml$/;
const REGISTRY_FILE = /(^|\/)moves\.xml$/;
const ARTEFACT_FILE = /^discovered\//;

/** The Plus program's call names, straight out of the Plus manual's own contents list. */
export function plusProgramme() {
  const p = join(CACHE, 'plus.cleaned.txt');
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^PLUS PROGRAM DEFINITIONS/.test(l.trim()));
  const end = lines.findIndex((l) => /^HISTORY OF DOCUMENT/.test(l.trim()));
  if (start < 0 || end < 0) return [];
  const names = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = /^(.+?)\s*\.{3,}\s*\d+\s*$/.exec(line.trim());
    if (m) names.push(m[1].trim());
  }
  return names;
}

function normalise(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mainstreamCallSet(map) {
  const s = new Set();
  for (const u of map.units) for (const e of u.entries) for (const site of e.sites) s.add(site.file);
  return s;
}

/**
 * Which heading on the Formations page defines a formation the engine names.
 *
 * The engine's names carry a handedness and a position that the Formations page groups under one
 * heading -- "Right-Hand Two-Faced Lines", "Right-Hand Waves", "Right-Hand Box" are all the family
 * the page defines once -- so this is a mapping, not a slug. FIRST MATCH WINS, so the specific
 * patterns come before the general ones ("Facing Couples" before "Couple").
 *
 * Names that are NOT on that page -- Butterfly, Grand Circle, Couples Facing Out, Trade By -- are
 * deliberately absent: they get the page, not a wrong anchor.
 */
const FORMATION_ANCHORS = [
  [/^(static square|squared set)\b/i, 'squared-set-and-static-square'],
  [/^facing dancers$/i, 'facing-dancers'],
  [/^facing couples$/i, 'facing-couples'],
  [/^eight chain thru/i, 'eight-chain-thru'],
  [/double pass thru/i, 'double-pass-thru'],
  [/two-faced lines?\b/i, 'lines'],
  [/^lines? facing out$/i, 'lines'],
  [/^one-faced lines?$/i, 'lines'],
  [/^lines?$/i, 'lines'],
  [/wave/i, 'waves'],
  [/columns?\b/i, 'columns'],
  [/box/i, 'box'],
  [/diamond/i, 'diamond'],
  [/alamo|thar/i, 'alamo-and-thar'],
  [/tag/i, 'tag-formations'],
  [/^circle left$/i, 'circle'],
  [/^tandem/i, 'tandem'],
  [/^couple$/i, 'couple'],
  [/^back-to-back couples?$/i, 'back-to-back-couples'],
];

/**
 * The anchors the Formations page ACTUALLY defines, using the same slug rule as the Markdown
 * renderer and `check-links.mjs`. Read rather than assumed, so renaming a heading on that page
 * degrades these links to the page instead of turning them into dead anchors.
 */
function formationAnchors() {
  const p = join(toolsDir, '..', '02-language', 'formations.md');
  if (!existsSync(p)) return new Set();
  const set = new Set();
  for (const m of readFileSync(p, 'utf8').matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    set.add(m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  return set;
}

/**
 * Two decimals at most. The animation index carries float noise -- "Ladies In, Men Sashay" is
 * 4.199999999999999 -- and a column of timings should not show it. ROUNDED, not cut: the noise is
 * the artefact, so cutting gives 4.19, which is not the timing the manual gives.
 */
function beatsOf(b) {
  if (typeof b === 'number') return Number(b.toFixed(2));
  return b ?? '—';
}

export function build() {
  const map = JSON.parse(readFileSync(join(toolsDir, 'call-map.json'), 'utf8'));
  const anims = JSON.parse(readFileSync(join(toolsDir, 'animations-index.json'), 'utf8'));
  const eng = loadEngine();
  const byTitle = catalogue(eng);
  const plus = plusProgramme();
  const plusKeys = new Set(plus.map(normalise));
  const mainstreamFiles = mainstreamCallSet(map);
  const mainstreamTitles = new Set(
    map.units.flatMap((u) => u.entries.flatMap((e) => (e.corpusTitle ? [e.corpusTitle] : []))),
  );

  const out = {};

  // ---------------------------------------------------------------- call index
  // Links are resolved to the ACTUAL call-page filenames rather than a slug derived from the
  // title: deriving it produced five dead links, because the page filenames were chosen by
  // hand and a title-derived slug only sometimes agrees with them.
  const actualCallFile = new Map();
  const callDir = join(toolsDir, '..', '04-calls');
  if (existsSync(callDir)) {
    for (const f of readdirSync(callDir)) {
      const m = /^m(\d\d)-/.exec(f);
      if (m) actualCallFile.set(Number(m[1]), f);
    }
  }
  const rows = [];
  const anchors = formationAnchors();
  /** The `Starts from` cell: the formation's own heading when the Formations page has one. */
  const formationCell = (name) => {
    const label = String(name ?? '').trim();
    if (!label) return '—';
    const hit = FORMATION_ANCHORS.find(([re]) => re.test(label));
    const slug = hit && anchors.has(hit[1]) ? `#${hit[1]}` : '';
    return `[${label}](../02-language/formations.md${slug})`;
  };
  /**
   * A call's name, linked to that call's own page. The page is found from the unit NUMBER in the
   * animation id (`m32d` -> unit 32), because a call part has no page of its own: the lettered parts
   * of a family all live on the family's page. Used by every table on this page set that names a
   * call, so none of them can disagree about where a call lives.
   */
  const callPageCell = (id, name) => {
    const file = actualCallFile.get(Number(String(id).slice(1, 3)));
    return file ? `[${name}](../04-calls/${file})` : name;
  };
  for (const u of map.units) {
    for (const e of u.entries) {
      const f = anims.figures.find((x) => x.id === `m${String(u.n).padStart(2, '0')}${e.letter ?? ''}`);
      rows.push({
        unit: `M${u.n}${e.letter ?? ''}`,
        call: e.title,
        from: formationCell(f?.from),
        to: f?.to ?? '—',
        beats: beatsOf(f?.beats),
        page: actualCallFile.has(u.n) ? `../04-calls/${actualCallFile.get(u.n)}` : null,
      });
    }
  }
  out['call-index.md'] = md(
    'Call index',
    'Every call in the 2026 Mainstream program, in the order this book teaches them, with the ' +
      'formation each starts from and its timing. The call name links to its own page.\n\n' +
      '**Only the starting formation is listed, and that is not an omission.** The formation a call ' +
      'FINISHES in is part of its definition and is given on each call page\'s *At a glance* table, ' +
      'which is the place to look. A dash in the beats column means this call has no animation yet — ' +
      'see [animations index](animations-index.md).',
    `| Unit | Call | Starts from | Beats |\n|---|---|---|---|\n` +
      rows
        .map((r) => `| ${r.unit} | ${r.page ? `[${r.call}](${r.page})` : r.call} | ${r.from} | ${r.beats} |`)
        .join('\n'),
  );

  // ---------------------------------------------------------------- formation index
  // The formation a call starts from, from the animation index, which is where the starting
  // formation is recorded. The call's id is carried along with its name so each one can be linked.
  const byFormation = new Map();
  for (const f of anims.figures) {
    if (!f.from) continue;
    if (!byFormation.has(f.from)) byFormation.set(f.from, []);
    byFormation.get(f.from).push({ id: f.id, call: f.call });
  }
  out['formation-index.md'] = md(
    'Formation index',
    'Which calls start from each formation. Only calls that have an animation are listed; a call ' +
      'with no animation yet is absent, and [animations index](animations-index.md) names those.\n\n' +
      'The formation a call *finishes in* is not listed — it belongs to the call\'s definition and is ' +
      'given on its own page.',
    [...byFormation.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, calls]) => {
        const links = [...calls]
          .sort((a, b) => a.call.localeCompare(b.call))
          .map((c) => callPageCell(c.id, c.call))
          .join(', ');
        return `### ${name}\n\n${links}\n`;
      })
      .join('\n'),
  );

  // ---------------------------------------------------------------- animations index
  const noAnim = anims.noAnimation;
  out['animations-index.md'] = md(
    'Animations index',
    'Every call in this book that moves, and the few that do not move yet. Each one is an ' +
      'interactive player: play, pause, step a quarter of a beat, or drag anywhere in the call. ' +
      '[Watching the animations](watching-the-animations.md) explains the controls.',
    `## Calls you can watch move\n\n${anims.figures.length} calls, each with a player on its own ` +
      `call page. The call name links to it.\n\n` +
      `| Unit | Call |\n|---|---|\n` +
      anims.figures.map((f) => `| ${f.id.toUpperCase()} | ${callPageCell(f.id, f.call)} |`).join('\n') +
      `\n\n## Calls with no animation yet\n\n` +
      `These are taught from the definition alone. A blank space would tell you nothing about whether ` +
      `the animation was missing or you were, so each of these says so.\n\n` +
      `| Unit | Call |\n|---|---|\n` +
      noAnim.map((n) => `| ${n.id.toUpperCase()} | ${callPageCell(n.id, n.call)} |`).join('\n'),
  );

  // ---------------------------------------------------------------- the three-way classification
  // Kept as DATA because the moved/renamed page needs it, but no longer published as a table of
  // corpus files: which file holds which animation is a maintainer's question, not a dancer's.
  const cls = { mainstream: [], plusOnly: [], outside: [], notACall: [] };
  for (const [title, sites] of [...byTitle.entries()].sort()) {
    const file = sites[0].file;
    if (NOT_A_CALL.has(title)) {
      cls.notACall.push([title, file, NOT_A_CALL.get(title)]);
    } else if (RULE_FILE.test(file)) {
      cls.notACall.push([title, file, 'rule/style file — taught as a rule, not a call']);
    } else if (REGISTRY_FILE.test(file)) {
      cls.notACall.push([title, file, 'the move registry, not a call']);
    } else if (ARTEFACT_FILE.test(file)) {
      cls.notACall.push([title, file, 'generated `discovered` authoring, not a call level']);
    } else if (RULE_OR_TERM.has(title)) {
      cls.notACall.push([title, file, 'descriptive terminology — taught as language, not as a call']);
    } else if (mainstreamTitles.has(title) || [...mainstreamFiles].some((f) => sites.some((s) => s.file === f))) {
      cls.mainstream.push([title, file, 'in the 2026 Mainstream teaching order']);
    } else if (plusKeys.has(normalise(title))) {
      cls.plusOnly.push([title, file, 'in the 2026 Plus program — moved out of Mainstream']);
    } else {
      cls.outside.push([title, file, 'in neither 2026 manual under this name — no longer in either taught program']);
    }
  }

  // ---------------------------------------------------------------- the programme
  out['programme-membership.md'] = md(
    'About this programme',
    'What this book is teaching, and where that list of calls comes from.',
    `## The 2026 Mainstream program\n\n` +
      `In 2025 CALLERLAB's members voted to replace the previous Basic, Mainstream and SSD programs ` +
      `with a single **Mainstream Dance Program** of 50 calls and call families. It took effect on ` +
      `**1 September 2026**.\n\n` +
      `This book follows that program: the ${map.units.length} teaching units below are the CALLERLAB ` +
      `(New) Mainstream Suggested Teaching Order, and the definitions, timings and styling on every ` +
      `call page are the ones in the *Mainstream Dance Program Definitions*, revised 29 March 2026.\n\n` +
      `| | |\n|---|---|\n` +
      `| Teaching units | ${map.units.length} |\n` +
      `| Calls (units plus their lettered parts) | ${map.units.reduce((a, u) => a + u.entries.length, 0)} |\n` +
      `| Taught with an animation | ${map.units.reduce((a, u) => a + u.entries.filter((e) => e.sites.length).length, 0)} |\n` +
      `| Taught from the definition alone | ${map.units.reduce((a, u) => a + u.entries.filter((e) => !e.sites.length).length, 0)} |\n\n` +
      `## The few calls with no animation yet\n\n` +
      `These are taught in full from the manual; there is simply nothing to watch. ` +
      `[Animations index](animations-index.md) lists them too.\n\n` +
      `| Unit | Call |\n|---|---|\n` +
      map.units
        .flatMap((u) => u.entries.filter((e) => !e.sites.length).map((e) => `| M${u.n}${e.letter ?? ''} | ${e.title} |`))
        .join('\n') +
      `\n\n## If you learned before 2026\n\n` +
      `Some calls you know are no longer in the programme, and some names changed. ` +
      `[Moved and renamed](moved-and-renamed.md) lists both.\n`,
  );

  // ---------------------------------------------------------------- moved and renamed
  const renamed = [];
  for (const u of map.units) {
    for (const e of u.entries) {
      if (e.corpusTitle && normalise(e.corpusTitle) !== normalise(e.title)) {
        renamed.push([`M${u.n}${e.letter ?? ''}`, e.title, e.corpusTitle]);
      }
    }
  }
  out['moved-and-renamed.md'] = md(
    'Moved and renamed',
    'For anyone who learned to dance before 2026, or who hears a call in a hall that this book does ' +
      'not contain.',
    `## Calls that moved to the Plus program\n\n` +
      `These are still danced — one program up. See [Where Mainstream leads](../07-plus/where-mainstream-leads.md).\n\n` +
      cls.plusOnly.map((r) => `- ${r[0]}`).join('\n') +
      `\n\n## Calls no longer in either taught program\n\n` +
      `These are **not taught in this book** and are not Plus calls either. They may appear at A1 or ` +
      `A2, or not at all.\n\n` +
      cls.outside.map((r) => `- ${r[0]}`).join('\n') +
      `\n\n## Renamed in 2026\n\n` +
      `Where the name this book teaches differs from an older name you may know. This book uses the ` +
      `2026 name.\n\n` +
      `| Unit | 2026 name (taught here) | Older name |\n|---|---|---|\n` +
      renamed.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n') +
      `\n`,
  );

  return out;
}

/**
 * The manual's own "Timing:" line for each call, keyed by normalised call name.
 *
 * Retained although nothing publishes it: it is the reading aid that the call pages were written
 * from, and `manualTimings` is cheaper to keep than to re-derive.
 */
function manualTimings(byTitle) {
  const p = join(CACHE, 'mainstream.cleaned.txt');
  if (!existsSync(p)) return new Map();
  const wanted = new Map();
  for (const t of byTitle.keys()) wanted.set(t.trim().toLowerCase(), t);
  const out = new Map();
  let current = null;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const k = line.trim().toLowerCase();
    if (wanted.has(k)) current = normalise(wanted.get(k));
    const m = /^Timing:?\s*(.+)$/.exec(line.trim());
    if (m && current && !out.has(current)) out.set(current, m[1].trim());
  }
  return out;
}

function slugOf(map, unit) {
  const t = unit.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return t.slice(0, 40).replace(/-$/, '');
}

function table(rows) {
  if (!rows.length) return '_None._\n';
  return `| Title | Corpus file | Why |\n|---|---|---|\n${rows.map((r) => `| ${r[0]} | \`${r[1]}\` | ${r[2]} |`).join('\n')}\n`;
}

function md(title, intro, body) {
  return (
    `# ${title}\n\n` +
    `<!-- GENERATED by book/tools/make-reference.mjs — do not edit by hand. -->\n\n` +
    `${intro}\n\n${body}\n`
  );
}

export function main() {
  mkdirSync(REF, { recursive: true });
  const pages = build();
  for (const [name, text] of Object.entries(pages)) {
    writeFileSync(join(REF, name), text, 'utf8');
    console.log(`${name} (${text.length} chars)`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}
