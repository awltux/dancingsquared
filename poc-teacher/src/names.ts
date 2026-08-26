// Creative module-name generation. The generated name is influenced by the calls
// in a tip (its dominant call family becomes the theme), while a seeded word bank
// keeps it varied and playful. The same tip always suggests the same name.

const MOD_FLAIR = [
  'Grand', 'Golden', 'Do-Sa', 'Right and Left', 'Swinging', 'Spinning', 'Twirling',
  'Smooth', 'Snappy', 'Weaving', 'Sliding', 'Rolling', 'Sassy', 'Jolly', 'Fancy',
  'Rambling',
];
const MOD_NOUN = [
  'Allemande', 'Promenade', 'Dosado', 'Swing', 'Star', 'Chain', 'Corner', 'Wheel',
  'Recycle', 'Weave', 'Circulate', 'Trade', 'Split', 'Bend', 'Slide', 'Roll', 'Tag',
  'Honor', 'Gypsy', 'Sashay',
];
// name = [flair] [theme] [noun] combinations, chosen per-tip for variety.
const MOD_STYLES: ((theme: string, flair: string, noun: string) => string)[] = [
  (t: string, f: string) => `${f} ${t}`,
  (t: string, _f: string, n: string) => `${t} ${n}`,
  (_t: string, f: string, n: string) => `The ${f} ${n}`,
  (t: string, f: string, n: string) => `${f} ${t} ${n}`,
  (t: string, f: string) => `${t} by ${f}`,
];

// Distinct square-dance figure words worth surfacing in a module name.
const FIGURE_WORDS = [
  'Allemande', 'Circle', 'Grand', 'Swing', 'Star', 'Chain', 'Promenade', 'Wheel',
  'Weave', 'Dosado', 'Corner', 'Turn', 'Pass', 'Thru', 'Bend', 'Split', 'Trade',
  'Circulate', 'Fold', 'Tag', 'Recycle', 'Forward', 'Back', 'Sashay', 'Sweep',
  'Scoot', 'Cast', 'Hinge', 'Extend', 'Run', 'Roll', 'Slide',
];

/** A short theme word drawn from a tip's most common call family. */
export function tipTheme(titles: string[], familyOf: (t: string) => string): string {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const fam = familyOf(t);
    if (fam && fam !== 'Other') counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let theme = '';
  let best = 0;
  for (const [f, n] of counts) if (n > best) { best = n; theme = f; }
  const core = theme.replace(/\s*Family$/i, '').trim(); // "Circle Family" -> "Circle"
  if (core) return core;
  const first = titles[0] ?? '';
  return first.replace(/^(Heads|Sides|All 4 Couples)\s*/i, '').trim() || 'Square';
}

/** Suggest a creative module name from the tip's calls (stable per tip). */
export function suggestModuleName(titles: string[], familyOf: (t: string) => string): string {
  const theme = tipTheme(titles, familyOf);
  const rawPool = [...new Set([theme, ...extractFigureWords(titles)])];
  const pool = rawPool.filter((w) => !rawPool.some((o) => o !== w && o.startsWith(w + ' ')));
  let seed = 0;
  for (const ch of titles.join('>')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const styleIdx = seed % 4;
  if (pool.length >= 2) {
    const a = pool[seed % pool.length];
    const b = pool[(seed + 1) % pool.length];
    switch (styleIdx) {
      case 0: return `${a} ${b}`;
      case 1: return `The ${a} ${b}`;
      case 2: return `${a} & ${b}`;
      default: return `${b} ${a}`;
    }
  }
  const single = pool[0];
  const flair = MOD_FLAIR[seed % MOD_FLAIR.length];
  const noun = MOD_NOUN[(seed >>> 3) % MOD_NOUN.length];
  const style = MOD_STYLES[styleIdx];
  return style(single, flair, noun);
}

/** Square-dance figure words found in the tip's call titles, in order of first
 * appearance, deduplicated. */
function extractFigureWords(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    for (const word of t.split(/[\s/,]+/)) {
      if (!word) continue;
      const match = FIGURE_WORDS.find((w) => w.toLowerCase() === word.toLowerCase());
      if (match && !seen.has(match)) {
        seen.add(match);
        out.push(match);
      }
    }
  }
  return out;
}

/** Whether two call sequences are identical (same calls, same order). */
export function sameSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
