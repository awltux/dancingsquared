// Translate ceder.net sequence modules into sequencer-compatible module JSON.
//
// Each source sequences/<start>/<end>/<id>.json -> sequences/<start>/<end>/<id>.module.json
// with id, name, level, startFormation, endFormation, steps, success, note.
//
// Directory: sequences/<start>/<end> where static_set->"Static Square",
// zero_line->"Zero Line", zero_box->"Zero Box", resolve->"Static Square".
//
// Run: `node scripts/translate-sequences.mjs` from repo root.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setParser } from 'dancing-squared-engine';
import { DOMParser } from '@xmldom/xmldom';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const seqRoot = path.join(root, 'sequences');

// ---------------------------------------------------------------------------
// Known engine call titles (validated target set).
// ---------------------------------------------------------------------------
function loadCatalogTitles() {
  const tamBlocks = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
  const attr = (b, n) => (b.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';
  const isHidden = (b) => /display="(no|none)"/.test(b.slice(0, b.indexOf('>') + 1));
  const titles = [];
  const seen = new Set();
  for (const level of ['ms', 'b1', 'b2', 'a1', 'a2', 'plus']) {
    const dir = path.join(root, `poc/src/assets/${level}`);
    let fs = [];
    try { fs = readdirSync(dir).filter((f) => f.endsWith('.xml')); } catch { continue; }
    for (const f of fs) {
      const xml = readFileSync(path.join(dir, f), 'utf8');
      for (const b of tamBlocks(xml)) {
        if (isHidden(b)) continue;
        const t = attr(b, 'title') || '';
        if (t && !seen.has(t)) { seen.add(t); titles.push(t); }
      }
    }
  }
  return titles;
}
const TITLES = loadCatalogTitles();
const TITLE_NORM = new Map(TITLES.map((t) => [normKey(t), t]));

function normKey(s) {
  return s.toLowerCase().replace(/&nbsp;/g, ' ').replace(/[.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Abbreviations -> engine call title.
const ABBREV = {
  'L.A': 'Left Allemande', 'LA': 'Left Allemande',
  'R.L.G': 'Right and Left Grand', 'R&L.G': 'Right and Left Grand',
  'RLG': 'Right and Left Grand', 'R.L.T': 'Right and Left Thru',
  'RLT': 'Right and Left Thru', 'DPT': 'Double Pass Thru',
  'CDP': 'Double Pass Thru', 'LFO': 'Lines Facing Out',
  'TdBy': 'Trade By', 'TDBY': 'Trade By', '8ChT': 'Eight Chain Thru',
  '8CHT': 'Eight Chain Thru', 'EC': 'Eight Chain Thru',
  'S': 'Sides', 'H': 'Heads', 'G': 'Girls', 'B': 'Boys',
};

// Curated phrase -> engine title for frequent non-exact phrasings.
const PHRASE = {
  'Promenade': 'All 4 Couples Promenade',
  'Promenade Home': 'All 4 Couples Promenade Full',
  'All 4 Couples Promenade': 'All 4 Couples Promenade Full',
  'You\'re Home': 'Static Square',
  'Square Your Set': 'Static Square',
  'Touch 1/4': 'Touch a Quarter',
  'Touch a Quarter': 'Touch a Quarter',
  '1/2 Tag': 'Half Tag',
  '1/2 Tag the Line': 'Half Tag',
  '3/4 Tag': '3/4 Tag the Line',
  '3/4 Tag the Line': '3/4 Tag the Line',
  'Dosado To A Wave': 'Dosado to a Wave',
  'Right & Left Grand': 'Right and Left Grand',
  'Right and Left Grand': 'Right and Left Grand',
  'Right & Left Thru': 'Right and Left Thru',
  'Forward & Back': 'Forward and Back',
  'Wheel & Deal': 'Wheel and Deal',
  'Flutter Wheel': 'Flutterwheel',
  'Reverse Flutter Wheel': 'Reverse Flutterwheel',
  'Single Circle To A Wave': 'Single Circle to a Wave',
  'Step To A Wave': 'Step to a Wave',
  'Step To An Ocean Wave': 'Step to a Wave',
  'Box The Gnat': 'Box the Gnat',
  'Cast Off 3/4': 'Cast Off Three Quarters',
  'Cast Off Three Quarters': 'Cast Off Three Quarters',
  'Square Thru': 'Square Thru 4',
  'Square Thru 3/4': 'Square Thru 3 1/2', // best-effort
  'Veer Left': 'Veer Left', 'Veer Right': 'Veer Right',
  'All 8 Circulate': 'All 8 Circulate',
  'Tag The Line': 'Tag the Line',
  'Tag The Line In': 'Tag the Line',
  'Tag The Line Right': 'Tag the Line',
  'Sweep 1/4': 'Sweep a Quarter',
  'Recycle': 'Recycle', 'Zoom': 'Zoom', 'Extend': 'Extend',
  'Dive Thru': 'Dive Thru', 'Trade By': 'Trade By',
  'Circulate': 'Circulate', 'Face In': 'Face In', 'Face Right': 'Face Right',
  'Face Left': 'Face Left', 'Face Out': 'Face Out',
  'Single Hinge': 'Hinge',
  'Head Ladies Chain': 'Head Ladies Chain',
  'Side Ladies Chain': 'Side Ladies Chain',
  'Four Ladies Chain': 'Four Ladies Chain',
  'Ends Cross Fold': 'Ends Cross Fold',
  'Centers In': 'Centers In',
  'Centers Circulate': 'Centers Circulate',
  'Ends Circulate': 'Ends Circulate',
  'Split Circulate': 'Split Circulate',
  'All 8 Box Circulate': 'All 8 Box Circulate',
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Split a raw element into candidate call tokens. Prefer NOT to split "&" when
// the whole is a known call (e.g. "Right & Left Grand", "Wheel & Deal",
// "Forward & Back", "Circulate 1 & 1/2").
function tokenize(el) {
  const raw = el.trim();
  const withAnd = raw.replace(/\s*&\s*/g, ' & ').trim();
  // If the whole (with & as "and") matches, keep as one.
  const asAnd = raw.replace(/\s*&\s*/g, ' and ');
  if (mapOne(asAnd)) return [asAnd];
  // Split on " & " only if the pieces are individually meaningful and not numeric fractions.
  const parts = raw.split(/\s*&\s*/).map((p) => p.trim()).filter(Boolean);
  const looksFractional = parts.length >= 2 && parts.every((p) => /^[\d\/\. ]+$/.test(p));
  if (looksFractional) {
    // "1 & 1/2" -> "1 1/2"
    return [parts.join(' ')];
  }
  // If both pieces map individually, split; else keep whole.
  if (parts.length === 2 && mapOne(parts[0]) && mapOne(parts[1])) return parts;
  return [raw];
}

function mapOne(token) {
  const t0 = token.replace(/,$/, '').trim();
  const t = t0.replace(/&nbsp;/g, ' ').trim();
  if (!t) return null;
  // normalized exact
  const nk = normKey(t);
  if (TITLE_NORM.has(nk)) return TITLE_NORM.get(nk);
  // strip parenthetical / trailing formation notes
  const bare = t.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const bnk = normKey(bare);
  if (TITLE_NORM.has(bnk)) return TITLE_NORM.get(bnk);
  // abbreviation
  const upper = t.replace(/[.,]/g, '').toUpperCase();
  if (ABBREV[upper]) return ABBREV[upper];
  // curated phrase (case-insensitive)
  for (const [k, v] of Object.entries(PHRASE)) {
    if (normKey(t) === normKey(k) || normKey(t).startsWith(normKey(k))) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const FORMATION_FOR_DIR = { static_set: 'Static Square', zero_line: 'Zero Line', zero_box: 'Zero Box', resolve: 'Static Square' };
let converted = 0, failed = 0, skipped = 0;

function walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.json') || e.name.endsWith('.module.json')) continue;
    translateFile(p);
  }
}

function translateFile(file) {
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { skipped++; return; }
  if (!Array.isArray(j.sequence) || !j.sequence.length) { skipped++; return; }

  const rel = path.relative(seqRoot, file).split(path.sep);
  const startFormation = FORMATION_FOR_DIR[rel[0]] ?? rel[0];
  const endFormation = FORMATION_FOR_DIR[rel[1]] ?? rel[1];

  const notes = [];
  const steps = [];

  for (const raw of j.sequence) {
    let s = raw.trim().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    // strip leading/trailing formation labels and lesson/set markers
    s = s.replace(/^\((Zero (Line|Box)|Static Square|Squared Set|Lesson \d+|Square Your Set)\)\s*/i, '');
    s = s.replace(/\s*\((Zero (Line|Box)|Static Square|Squared Set|Lesson \d+|Square Your Set)\)\s*$/i, '');
    if (!s) continue;
    if (/^(Zero (Line|Box)|Static Square|Squared Set|Lesson \d+|Square Your Set)$/i.test(s)) continue;
    if (/^(You're Home|Home|Promenade Home|Square Your Set|Squared Set)$/i.test(s)) {
      steps.push('ALLEMANDE_LEFT'); // terminal action; not a real call
      continue;
    }
    for (const tok of tokenize(s)) {
      const title = mapOne(tok);
      if (title) steps.push(title);
      else { steps.push(tok.replace(/,$/, '').trim()); notes.push('Untranslatable: "' + s + '"'); }
    }
  }

  const allKnown = steps.length > 0 && steps.every((s) => TITLE_NORM.has(normKey(s)) || s === 'ALLEMANDE_LEFT');
  const success = allKnown && steps.length > 0;
  const mappedCount = steps.filter((s) => TITLE_NORM.has(normKey(s)) || s === 'ALLEMANDE_LEFT').length;
  if (!success) failed++;

  const out = {
    id: j.id, name: `ceder-${j.id}`, level: j.level ?? 'Mainstream',
    startFormation, endFormation, success, stepCount: steps.length, mappedCount,
    steps,
    ...(notes.length ? { note: notes.join('; ') } : {}),
    source: j.source ?? 'ceder.net/choreodb',
  };
  writeFileSync(file.replace(/\.json$/, '.module.json'), JSON.stringify(out, null, 2));
  converted++;
}

walk(seqRoot);
console.log(`converted ${converted}, partial/failed ${failed}, skipped ${skipped}`);
console.log('wrote .module.json files.');
