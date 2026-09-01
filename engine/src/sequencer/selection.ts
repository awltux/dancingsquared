// Dancer-selection resolution. A subset call may be prefixed by a selection that
// names which dancers act (Heads, All, Centers, Boys, Girls, Ends, Couples, Men,
// Women, Leaders, Same 4, Head Position, Couple #N, "N Boys Have Girl On Right",
// etc.). This module parses a selection string into a group key usable by
// Grouping.subsetOf, and a "base call" with the selection removed.

// Map a normalized selection string to a Grouping.subsetOf group key, or null if
// not a recognized single-group selection.
const SELECTION_GROUP: Record<string, string> = {
  'heads': 'heads', 'sides': 'sides', 'boys': 'boys', 'girls': 'girls',
  'men': 'men', 'women': 'women', 'ladies': 'girls', 'centers': 'centers',
  'ends': 'ends', 'couples': 'couples', 'all': 'all', 'everybody': 'all',
  'everyone': 'all', 'leaders': 'leaders', 'trailers': 'trailers',
  'beaus': 'beaus', 'belles': 'belles', 'partner': 'partners',
};

// Multi-word selectors recognized as a fixed phrase -> (groupKey | special).
const PHRASE_SELECTION: Record<string, string> = {
  'same 4': 'same4', 'same four': 'same4',
  'head position': 'headposition', 'side position': 'sideposition',
  'head ladies': 'heads', 'side ladies': 'sides', 'head couples': 'heads',
  'side couples': 'sides', 'very centers': 'verycenters',
  'outside 6': 'outside6', 'outer 6': 'outside6',
  'four ladies': 'girls', 'all 4 couples': 'all', 'all four couples': 'all',
};

// Regexes for parametric selectors. Each returns {group, ...} or null.
const COUPLE_RE = /^couple #(\d+)$/;
const THOSE_COUPLE_RE = /^those in couple #(\d+) spot$/;
const HEAD_LADIES_N_RE = /^(\d+) ladies chain$/;
const N_BOYS_GIRL_RIGHT_RE = /^(one|two|three|four) (boy|girl)s? have (girl|boy) on (right|left)$/;
const N_SELECTION_RE = /^(one|two|three|four) (boys|girls|men|women|ladies)$/;
const N_COUPLE_RE = /^couple #(\d+) and #(\d+)$/;

/** Normalize a selection phrase for lookup. */
export function normalizeSelection(s: string): string {
  return s.trim().toLowerCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a selection string to a group key for Grouping.subsetOf, or a special
 * token. Returns null when unrecognized.
 */
export function selectionGroup(sel: string): string | null {
  const n = normalizeSelection(sel);
  if (!n) return null;
  if (SELECTION_GROUP[n]) return SELECTION_GROUP[n];
  if (PHRASE_SELECTION[n]) return PHRASE_SELECTION[n];
  if (COUPLE_RE.test(n)) return 'couples'; // specific couple handled by resolver
  if (THOSE_COUPLE_RE.test(n)) return 'couples';
  if (N_BOYS_GIRL_RIGHT_RE.test(n)) return 'boys-girl-right';
  if (N_SELECTION_RE.test(n)) return 'gender-count';
  if (HEAD_LADIES_N_RE.test(n)) return 'girls';
  if (N_COUPLE_RE.test(n)) return 'couples';
  return null;
}

/**
 * Split a raw call string like "Centers Pass Thru" or "Same 4 Star Thru" into a
 * selection (or null) and the base call. Returns { selection, call }.
 */
export function splitSelection(raw: string): { selection?: string; call: string } {
  const s = raw.trim();
  if (!s) return { call: s };
  const words = s.split(/\s+/);
  // Try progressively longer leading selection phrases (up to 6 words), longest first.
  const max = Math.min(6, words.length);
  for (let len = max; len >= 1; len--) {
    const sel = words.slice(0, len).join(' ');
    if (selectionGroup(sel) !== null) {
      const rest = words.slice(len).join(' ');
      if (rest) return { selection: sel, call: rest };
    }
  }
  return { call: s };
}
