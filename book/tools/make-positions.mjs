// Annotated position diagrams for the book's language pages, drawn from the engine's own squared set.
//
//   node book/tools/make-positions.mjs [--check]
//
// WHY SVG HERE, WHEN THE FORMATION DIAGRAMS ARE PNG. These pictures carry words -- "Couple 1",
// "Heads", "Partner", "Corner", "Opposite" -- and the rasteriser has no font engine beyond a
// hand-written 3x5 bitmap for the digits 1-8. Inventing a 26-glyph alphabet at 3x5 would be both
// ugly and a liability; SVG text uses the reader's own font, stays crisp at any size, and the file
// is a few kilobytes of deterministic markup. The FORMATION diagrams stay PNG because they are pure
// geometry and share the animation's rasteriser.
//
// WHERE THE NUMBERS COME FROM. Not invented here. The manual, "Couple #1, #2, #3, #4":
//
//   "From a Squared Set, at the start of the tip, the Couple whose back is to the caller is
//    Couple #1. The Couple to their right is Couple #2, and so on."
//
// The square is drawn with the caller at the SOUTH, which is the convention every other picture in
// this book uses, so Couple 1 is the south couple and the numbering runs south, east, north, west.
// The tool ASSERTS that against the engine's own data rather than trusting this comment:
//
//   * the four sides are found from the geometry;
//   * the Boy of a couple is found as the dancer on the LEFT of the couple's own facing -- which is
//     the manual's rule ("the dancer who squared up on the left is a Boy") -- and that is then
//     checked against the gender the formation library records. If they ever disagree, this fails.
//
// The dancer numbers 1-8 follow the same scheme the players and animations use, so a number means
// the same thing here as it does mid-call.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolsDir, readAsset, loadEngine } from './lib/load.mjs';
import { completeSet } from './make-formations.mjs';

const OUT_DIR = join(toolsDir, '..', 'positions');
const INDEX = join(toolsDir, 'positions-index.json');

const COLOUR = {
  floor: '#f7f9fa',
  gridMinor: '#e4e9ec',
  gridMajor: '#cdd6db',
  axis: '#9fadb5',
  ink: '#22303a',
  white: '#ffffff',
  muted: '#c3ccd2',
  couple: { 1: '#b2182b', 2: '#2166ac', 3: '#1b7837', 4: '#8c6d1f' },
};

const W = 420;
const H = 390;
const SCALE = 36; // pixels per board unit
const OX = W / 2;
const OY = 180;
/** The same marker width the animations and the player use: one grid square of the floor. */
const MARKER_UNITS = 0.48;

const px = (x) => OX + x * SCALE;
const py = (y) => OY - y * SCALE;

/** Which side of the square a position stands on. */
function sideOf(x, y) {
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 'north' : 'south';
  return x > 0 ? 'east' : 'west';
}

/**
 * The squared set, as couples carrying the manual's numbers.
 *
 * The side-to-number map is the manual's rule with the caller at the south; the Boy of each couple
 * is derived from the couple's own facing and then checked against the library's gender.
 */
function couples() {
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const written = lib.get('Squared Set');
  if (!written || !written.length) throw new Error('formations.xml has no "Squared Set"');

  const { dancers } = completeSet(written);
  if (dancers.length !== 8) throw new Error(`Squared Set has ${dancers.length} dancers, expected 8`);

  const NUMBER_OF_SIDE = { south: 1, east: 2, north: 3, west: 4 };
  const grouped = new Map();
  for (const d of dancers) {
    const side = sideOf(d.x, d.y);
    if (!grouped.has(side)) grouped.set(side, []);
    grouped.get(side).push({ ...d, side });
  }
  if (grouped.size !== 4) throw new Error(`found ${grouped.size} sides, expected 4`);

  const out = [];
  for (const [side, pair] of grouped) {
    if (pair.length !== 2) throw new Error(`${side} has ${pair.length} dancers, expected 2`);
    const couple = NUMBER_OF_SIDE[side];
    const [a, b] = pair;
    if (a.angleDeg !== b.angleDeg) throw new Error(`${side}: the couple does not share a facing`);

    // LEFT of the couple's facing. Board +y is north, so a heading h faces (cos h, sin h) and left is
    // that turned a quarter turn anticlockwise, (-sin h, cos h).
    const h = ((a.angleDeg ?? 0) * Math.PI) / 180;
    const left = { x: -Math.sin(h), y: Math.cos(h) };
    const score = (d) => (d.x - a.x) * left.x + (d.y - a.y) * left.y;
    const boy = score(a) > score(b) ? a : b;
    const girl = boy === a ? b : a;

    // The rule and the data must agree, or the picture would be drawing a fiction.
    if (boy.gender !== 'boy' || girl.gender !== 'girl') {
      throw new Error(
        `${side}: the dancer on the couple's left is recorded as ${boy.gender}, not a Boy — ` +
          'the "Boy on the left" rule and the formation library disagree',
      );
    }
    const number = (d) => (couple - 1) * 2 + (d === boy ? 1 : 2);
    out.push({
      couple,
      side,
      facing: a.angleDeg,
      boy: { ...boy, couple, number: number(boy) },
      girl: { ...girl, couple, number: number(girl) },
    });
  }
  out.sort((a, b) => a.couple - b.couple);
  return out;
}

function grid() {
  const out = [];
  const nx = Math.ceil(W / 2 / SCALE) + 1;
  const ny = Math.ceil(H / 2 / SCALE) + 1;
  for (let i = -nx; i <= nx; i++) {
    if (i === 0) continue;
    const x = px(i);
    if (x < 0 || x > W) continue;
    out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${i % 2 === 0 ? COLOUR.gridMajor : COLOUR.gridMinor}" stroke-width="1"/>`);
  }
  for (let i = -ny; i <= ny; i++) {
    if (i === 0) continue;
    const y = py(i);
    if (y < 0 || y > H) continue;
    out.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${i % 2 === 0 ? COLOUR.gridMajor : COLOUR.gridMinor}" stroke-width="1"/>`);
  }
  out.push(`<line x1="${px(0)}" y1="0" x2="${px(0)}" y2="${H}" stroke="${COLOUR.axis}" stroke-width="1.5"/>`);
  out.push(`<line x1="0" y1="${py(0)}" x2="${W}" y2="${py(0)}" stroke="${COLOUR.axis}" stroke-width="1.5"/>`);
  return out.join('\n');
}

/**
 * The dancers. Every facing nose first, then every body, then every number -- the same order the
 * player and the animations use, so a nose can never be drawn over a neighbouring body.
 */
function dancerLayer(people, { fillOf, numberFill = COLOUR.white } = {}) {
  const r = MARKER_UNITS * SCALE;
  const noses = [];
  const bodies = [];
  const numbers = [];

  for (const p of people) {
    const cx = px(p.x);
    const cy = py(p.y);
    const h = ((p.angleDeg ?? 0) * Math.PI) / 180;
    const nx = Math.cos(h);
    const ny = -Math.sin(h); // screen y grows downward
    const fill = fillOf(p);

    noses.push(
      `<polygon points="${[
        [cx + nx * r * 1.6, cy + ny * r * 1.6],
        [cx + nx * r * 0.85 - ny * r * 0.5, cy + ny * r * 0.85 + nx * r * 0.5],
        [cx + nx * r * 0.85 + ny * r * 0.5, cy + ny * r * 0.85 - nx * r * 0.5],
      ]
        .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
        .join(' ')}" fill="${COLOUR.ink}"/>`,
    );

    if (p.gender === 'girl') {
      bodies.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${COLOUR.ink}" stroke-width="1.4"/>`);
    } else {
      // The square turns with the dancer. SVG's rotate() is clockwise and the screen's y grows
      // downward, so the board heading (which faces (cos h, sin h)) is -h in degrees.
      const deg = (-(p.angleDeg ?? 0)).toFixed(1);
      bodies.push(
        `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" ` +
          `height="${(2 * r).toFixed(1)}" transform="rotate(${deg} ${cx.toFixed(1)} ${cy.toFixed(1)})" ` +
          `fill="${fill}" stroke="${COLOUR.ink}" stroke-width="1.4"/>`,
      );
    }
    if (p.number) {
      numbers.push(
        `<text x="${cx}" y="${(cy + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="${numberFill}">${p.number}</text>`,
      );
    }
  }
  return [...noses, ...bodies, ...numbers].join('\n');
}

function label(x, y, text, { anchor = 'middle', size = 14, fill = COLOUR.ink, weight = 600 } = {}) {
  return (
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="system-ui, sans-serif" ` +
    `font-size="${size}" font-weight="${weight}" letter-spacing="0.6" fill="${fill}">${text}</text>`
  );
}

/** The caller, outside the south side, with a marker pointing at the square. */
function caller(cx, y, text) {
  return [
    `<polygon points="${cx - 9},${y + 12} ${cx + 9},${y + 12} ${cx},${y}" fill="${COLOUR.ink}"/>`,
    label(cx, y + 31, text, { size: 14 }),
  ].join('\n');
}

const all = (cs) => cs.flatMap((c) => [c.boy, c.girl]);

function svg(title, describe, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `role="img" aria-label="${describe}">\n` +
    `<title>${title}</title>\n` +
    `<rect width="${W}" height="${H}" fill="${COLOUR.floor}"/>\n` +
    `${grid()}\n${body}\n</svg>\n`
  );
}

/** Where a side's outward label goes, and how it is anchored. */
const OUTWARD = {
  south: (t) => label(W / 2, py(-3) + 57, t),
  north: (t) => label(W / 2, py(3) - 40, t),
  west: (t) => label(px(-3) - 45, OY + 5, t, { size: 13 }),
  east: (t) => label(px(3) + 45, OY + 5, t, { size: 13 }),
};

export function build() {
  const cs = couples();
  const people = all(cs);
  const files = new Map();
  const index = { drawn: [] };

  // ---------------------------------------------------------------- the four couple numbers
  const coupleBody = [
    dancerLayer(people, { fillOf: (p) => COLOUR.couple[p.couple] }),
    ...cs.map((c) => OUTWARD[c.side](`COUPLE ${c.couple}`)),
    caller(W / 2, py(-3) + 116, 'CALLER'),
  ].join('\n');
  files.set(
    'couple-numbers.svg',
    svg(
      'The four couple positions',
      'A squared set seen from above, with the caller at the south. Each couple is numbered 1 to 4 and coloured red, blue, green and gold.',
      coupleBody,
    ),
  );
  index.drawn.push({
    slug: 'couple-numbers',
    title: 'Couple numbers at home',
    couples: cs.map((c) => `${c.couple}=${c.side}`).join(' '),
  });

  // ---------------------------------------------------------------- Heads and Sides
  const isHead = (c) => c.couple === 1 || c.couple === 3;
  const headsBody = [
    dancerLayer(people, { fillOf: (p) => (isHead(p) ? COLOUR.couple[p.couple] : COLOUR.muted) }),
    ...cs.map((c) => OUTWARD[c.side](isHead(c) ? 'HEADS' : 'SIDES')),
    caller(W / 2, py(-3) + 116, 'CALLER'),
  ].join('\n');
  files.set(
    'heads-and-sides.svg',
    svg(
      'Heads and Sides',
      'The same squared set with the caller at the south. Couples 1 and 3 face toward and away from the caller and are the Heads; couples 2 and 4 stand perpendicular to the caller and are the Sides.',
      headsBody,
    ),
  );
  index.drawn.push({ slug: 'heads-and-sides', title: 'Heads and Sides', couples: 'Heads 1,3  Sides 2,4' });

  // ---------------------------------------------------------------- Partner, Corner, Opposite
  //
  // The manual, "Opposite": "When squared up at home, a dancer's Diagonal Opposite is the dancer
  // across the square of the same gender." And "Partner and Corner": "each dancer's Partner is the
  // adjacent dancer, and each dancer's Corner is the next dancer 'around the nearest corner of the
  // square' from them."
  //
  // Worked on the #1 Boy, at the south-west of the south couple: his Partner is the adjacent dancer
  // in his own couple; the nearest corner of the square is the south-west one, so his Corner is the
  // next dancer round it; and his Opposite is the same-gender dancer straight across.
  const mine = cs.find((c) => c.couple === 1);
  const you = mine.boy;
  const relative = (fn, why) => {
    const p = people.find(fn);
    if (!p) throw new Error(`no dancer found for ${why}`);
    return p;
  };
  const partner = relative((p) => p.couple === 1 && p !== you, 'the #1 Boy partner');
  const corner = relative((p) => p.gender === 'girl' && p.side === 'west', 'the #1 Boy corner');
  const opposite = relative((p) => p.gender === 'girl' && p.side === 'north', 'the #1 Boy opposite');

  const line = (to) =>
    `<line x1="${px(you.x)}" y1="${py(you.y)}" x2="${px(to.x)}" y2="${py(to.y)}" ` +
    `stroke="${COLOUR.ink}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.75"/>`;

  const relatives = new Set([partner, corner, opposite]);
  const relationBody = [
    [line(corner), line(opposite), line(partner)].join('\n'),
    dancerLayer(people, {
      fillOf: (p) => (p === you ? COLOUR.ink : relatives.has(p) ? COLOUR.couple[1] : COLOUR.muted),
    }),
    label(px(-3) - 45, OY + 5, 'CORNER', { size: 13 }),
    label(W / 2, py(3) - 40, 'OPPOSITE'),
    label(px(1) + 46, py(-3) + 57, 'PARTNER', { size: 13, anchor: 'start' }),
    label(px(-1), py(-3) + 57, 'YOU', { size: 13 }),
    caller(W / 2, py(-3) + 116, 'CALLER'),
  ].join('\n');
  files.set(
    'partner-corner-opposite.svg',
    svg(
      'Partner, Corner and Opposite',
      'A squared set with the number 1 Boy picked out. Dashed lines lead from him to his Partner beside him, his Corner round the nearest corner of the square, and his Opposite across the square.',
      relationBody,
    ),
  );
  index.drawn.push({
    slug: 'partner-corner-opposite',
    title: 'Partner, Corner and Opposite',
    from: `#${you.number} Boy`,
    partner: `#${partner.number}`,
    corner: `#${corner.number}`,
    opposite: `#${opposite.number}`,
  });

  return { files, index };
}

export function main() {
  const check = process.argv.includes('--check');
  const { files, index } = build();

  if (check) {
    let drift = 0;
    for (const [name, text] of files) {
      const p = join(OUT_DIR, name);
      if (!existsSync(p) || readFileSync(p, 'utf8') !== text) {
        console.error(`DRIFT ${name}`);
        drift++;
      }
    }
    if (drift) {
      console.error(`\n${drift} position diagram(s) differ. Re-run without --check.`);
      return 1;
    }
    console.log(`${files.size} position diagrams reproduce exactly.`);
    return 0;
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of [...files.entries()].sort()) writeFileSync(join(OUT_DIR, name), text);
  writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');
  console.log(`${files.size} position diagrams -> ${OUT_DIR}`);
  for (const d of index.drawn) console.log(`  ${d.slug}: ${d.title}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
