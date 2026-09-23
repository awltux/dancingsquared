// Repair cross-chapter links that point at the wrong filename or the wrong class.
//
// WHY THIS EXISTS. The chapters were written in parallel, and a sibling link has to be
// GUESSED before the sibling exists: three different groupings of the 50 units into classes
// were assumed, and several call-page filenames came out longer than the slug their siblings
// guessed (m16-lead-right-lead-right vs m16-lead-right-lead-left.md). A link that points at
// the wrong name is a dead end for the reader, so rather than hand-fixing them once and
// having them drift again, the repair is a tool.
//
// It rewrites ONLY links that do not resolve, and only when the intended target is
// unambiguous, so it can never invent a link to a page that does not exist.
//
//   node book/tools/fix-links.mjs
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { toolsDir } from './lib/load.mjs';

const BOOK = join(toolsDir, '..');
const CALLS = join(BOOK, '04-calls');

/** Unit number -> the actual call-page filename, discovered from the directory. */
function callFiles() {
  const m = new Map();
  if (!existsSync(CALLS)) return m;
  for (const f of readdirSync(CALLS)) {
    if (!f.endsWith('.md')) continue;
    const n = Number(/^m(\d\d)-/.exec(f)?.[1]);
    if (Number.isFinite(n)) {
      if (m.has(n)) throw new Error(`two call pages for unit ${n}: ${m.get(n)} and ${f}`);
      m.set(n, f);
    }
  }
  return m;
}

/** The class a unit belongs to, matching 05-course/course-overview.md. */
export function classForUnit(n) {
  if (n <= 4) return 1;
  if (n <= 8) return 2;
  if (n <= 12) return 3;
  if (n <= 16) return 4;
  if (n <= 20) return 5;
  if (n <= 24) return 6;
  if (n <= 28) return 7;
  if (n <= 32) return 8;
  if (n <= 36) return 9;
  if (n <= 40) return 10;
  if (n <= 45) return 11;
  return 12;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.cache' || name === 'node_modules' || name === 'figures') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

export function main() {
  const calls = callFiles();
  const srcUnit = (file) => Number(/^m(\d\d)-/.exec(file)?.[1]);
  let repaired = 0;
  const notes = [];

  for (const file of walk(BOOK)) {
    const text = readFileSync(file, 'utf8');
    const selfUnit = srcUnit(join(file).split(/[\\/]/).pop());
    let changed = false;

    const out = text.replace(/(!?\[[^\]]*\]\()([^)\s#]+\.md)(#[^)]*)?\)/g, (whole, lead, target, frag) => {
      const abs = resolve(dirname(file), target);
      if (existsSync(abs)) return whole;
      const base = target.split(/[\\/]/).pop();

      // A sibling call page: resolve by unit number, not by the guessed slug.
      const m = /^m(\d\d)-/.exec(base);
      if (m) {
        const n = Number(m[1]);
        if (calls.has(n)) {
          const replacement = `${lead}${target.replace(/[^\\/]+$/, calls.get(n))}${frag ?? ''})`;
          notes.push(`${file.split(/[\\/]/).slice(-2).join('/')}: ${base} -> ${calls.get(n)}`);
          changed = true;
          return replacement;
        }
      }

      // A class link inside a call page: the class is a function of the unit, so a guessed
      // grouping is simply recomputed rather than trusted.
      if (/^class-\d\d\.md$/.test(base) && Number.isFinite(selfUnit)) {
        const want = `class-${String(classForUnit(selfUnit)).padStart(2, '0')}.md`;
        if (want !== base && existsSync(resolve(dirname(file), want))) {
          const replacement = `${lead}${target.replace(/[^\\/]+$/, want)}${frag ?? ''})`;
          notes.push(`${file.split(/[\\/]/).slice(-2).join('/')}: ${base} -> ${want}`);
          changed = true;
          return replacement;
        }
      }
      return whole;
    });

    if (changed) {
      writeFileSync(file, out, 'utf8');
      repaired++;
    }
  }

  for (const n of notes) console.log(`  ${n}`);
  console.log(`${repaired} file(s) repaired, ${notes.length} link(s) rewritten.`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}
