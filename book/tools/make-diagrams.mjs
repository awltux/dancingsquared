// Annotated diagrams for the book's prose pages: the squared-set pictures the language pages use, and
// the phrase diagram that explains how long a phrase is.
//
//   node book/tools/make-diagrams.mjs [--check]
//
// WHY SVG HERE, WHEN THE FORMATION DIAGRAMS ARE PNG. These pictures carry words -- "Couple 1",
// "Heads", "Partner", "Corner", "Opposite", and the labels on the phrase diagram -- and the rasteriser
// has no font engine beyond a hand-written 3x5 bitmap for the digits 1-8. Inventing a 26-glyph alphabet
// at 3x5 would be both ugly and a liability; SVG text uses the reader's own font, stays crisp at any
// size (including the larger text setting), and the file is a few kilobytes of deterministic markup.
// The FORMATION diagrams stay PNG because they are pure geometry and share the animation's rasteriser.
//
// THE DIRECTORY IS `diagrams/`, NOT `positions/`. It was `positions/` while every picture in it was a
// position; the phrase diagram is not one, and a folder whose name no longer describes its contents
// makes the inventory wrong for whoever reads it next.
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
import { toolsDir } from './lib/load.mjs';
import { couples } from './lib/squared-set.mjs';

const OUT_DIR = join(toolsDir, '..', 'diagrams');
const INDEX = join(toolsDir, 'diagrams-index.json');

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

/** The phrase diagram's own canvas: wide and short, and with no floor grid, because it is not a floor. */
function phraseSvg(title, describe, body, w, h) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `role="img" aria-label="${describe}">\n` +
    `<title>${title}</title>\n` +
    `<rect width="${w}" height="${h}" fill="${COLOUR.floor}"/>\n` +
    `${body}\n</svg>\n`
  );
}

/**
 * The phrase, counted two ways.
 *
 * The two rows are the SAME eight beats, numbered once at the top because both rows share them. What
 * changes is where the bars fall: 2/4 puts a bar line every two beats -- the boom-chuck the bulk of
 * square dance music is written in -- and 4/4 every four, the march music CALLERLAB also names. The
 * reader can count the beat ticks in either row and see four bars against two.
 *
 * Beats 1 and 5 are drawn larger and darker: CALLERLAB's timing material gives them as the primary
 * anchors, which is why a call usually starts on one of them.
 */
function phraseBarsSvg() {
  const FW = 460;
  const FH = 148;
  const LEFT = 96;
  const RIGHT = 20;
  const TOP = 36;
  const ROW_H = 38;
  const GAP = 16;
  const BEATS = 8;
  const x0 = LEFT;
  const span = FW - RIGHT - x0;
  const beat = span / BEATS;
  const parts = [];

  parts.push(label(16, 24, 'BEATS', { size: 11, anchor: 'start', fill: COLOUR.axis }));
  for (let b = 1; b <= BEATS; b++) {
    const anchor = b === 1 || b === 5;
    parts.push(
      label(x0 + (b - 0.5) * beat, 24, String(b), {
        size: anchor ? 16 : 13,
        fill: anchor ? COLOUR.ink : COLOUR.axis,
      }),
    );
  }

  const rows = [
    { time: '2/4', note: '2 beats a bar', per: 2 },
    { time: '4/4', note: '4 beats a bar', per: 4 },
  ];
  rows.forEach((row, i) => {
    const y = TOP + i * (ROW_H + GAP);
    const bars = BEATS / row.per;
    const barW = span / bars;

    parts.push(label(16, y + ROW_H / 2 + 2, row.time, { size: 22, weight: 700, anchor: 'start' }));
    parts.push(label(16, y + ROW_H / 2 + 20, row.note, { size: 11.5, anchor: 'start', fill: COLOUR.axis }));

    for (let bar = 0; bar < bars; bar++) {
      const bx = x0 + bar * barW;
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${ROW_H}" ` +
          `fill="${bar % 2 ? COLOUR.gridMinor : COLOUR.white}" stroke="${COLOUR.ink}" stroke-width="1.2"/>`,
      );
      parts.push(label(bx + barW / 2, y + ROW_H / 2 + 6, `bar ${bar + 1}`, { size: 13 }));
      // Beat ticks inside the bar only: the bar lines are the rects' own edges, so the two can never
      // be mistaken for each other.
      for (let t = 1; t < row.per; t++) {
        const tx = bx + t * beat;
        parts.push(
          `<line x1="${tx.toFixed(1)}" y1="${y}" x2="${tx.toFixed(1)}" y2="${y + 9}" ` +
            `stroke="${COLOUR.axis}" stroke-width="1.2"/>`,
        );
      }
    }
  });

  return phraseSvg(
    'How long a phrase is',
    'Eight beats counted two ways. In the top row the music is 2/4, so a bar is two beats and the phrase is four bars. In the bottom row it is 4/4, so a bar is four beats and the same eight beats are two bars. Beats 1 and 5 are the strong ones.',
    parts.join('\n'),
    FW,
    FH,
  );
}

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

  // ---------------------------------------------------------------- the phrase, in 2/4 and in 4/4
  files.set('phrase-bars.svg', phraseBarsSvg());
  index.drawn.push({
    slug: 'phrase-bars',
    title: 'The phrase in 2/4 and in 4/4',
    beats: 8,
    bars: '2/4 -> 4 bars, 4/4 -> 2 bars',
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
      console.error(`\n${drift} diagram(s) differ. Re-run without --check.`);
      return 1;
    }
    console.log(`${files.size} diagram(s) reproduce exactly.`);
    return 0;
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of [...files.entries()].sort()) writeFileSync(join(OUT_DIR, name), text);
  writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');
  console.log(`${files.size} diagram(s) -> ${OUT_DIR}`);
  for (const d of index.drawn) console.log(`  ${d.slug}: ${d.title}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
