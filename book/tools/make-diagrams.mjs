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
import { toolsDir, readAsset, loadEngine } from './lib/load.mjs';
// THE MARKER'S SIZE IS `board-style.mjs`'s, not this file's: it is the body the contact rules measure, the same one
// the animations are drawn with, and this tool carried a second declaration of it (R8's census,
// `engine/test/tolerances.mjs`). One owner, imported.
import { MARKER_UNITS } from './lib/board-style.mjs';
import { couples, completeSet } from './lib/squared-set.mjs';

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
  // The same two "nobody in particular" colours the formation diagrams use: in a box there are no
  // couples, so a dancer is drawn by gender and nothing else.
  plain: { boy: '#1f6f8b', girl: '#8a3f6b' },
};

const W = 420;
const H = 390;
const SCALE = 36; // pixels per board unit
const OX = W / 2;
const OY = 180;
/** The same marker width the animations and the player use: one grid square of the floor. */

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
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const cs = couples();
  const people = all(cs);
  const files = new Map();
  const index = { drawn: [] };

  // ---------------------------------------------------------------- the four couple numbers
  const coupleBody = [
    dancerLayer(people, { fillOf: (p) => COLOUR.couple[p.couple] }),
    ...cs.map((c) => OUTWARD[c.side](`COUPLE ${c.couple}`)),
    caller(W / 2, py(-3) + 66, 'CALLER'),
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
    caller(W / 2, py(-3) + 66, 'CALLER'),
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

  // ---------------------------------------------------------------- the four identifiers
  //
  // The manual, "The Four Identifiers around the Square": "Within a Squared Set, the four Women as
  // viewed from a Man's perspective looking CLOCKWISE around the square are: his Corner, his Opposite,
  // his Right-Hand Lady, and his Partner."
  //
  // So the four are not picked out by name here: they are the four Women in clockwise order, and the
  // manual's list is then ASSERTED against the geometry rather than trusted -- the walk must end on his
  // own partner, and the second of the four must be the Girl of the couple facing him. Those are the two
  // relations the names actually claim, and if the library ever moved a couple the build fails.
  //
  // The walk: the angle of each Woman around the centre is subtracted from the picked Boy's, and the
  // positive remainder is how far clockwise she lies from him. Sorting by that gives the order the
  // manual describes -- nearest clockwise is the Corner, nearest counter-clockwise is the Partner.
  const mine = cs.find((c) => c.couple === 1);
  const you = mine.boy;
  const angle = (d) => Math.atan2(d.y, d.x);
  const clockwiseFrom = (d) => ((angle(you) - angle(d)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const ranked = cs.map((c) => c.girl).sort((a, b) => clockwiseFrom(a) - clockwiseFrom(b));
  const [corner, oppositeLady, rightHandLady, partner] = ranked;

  if (ranked.length !== 4 || new Set(ranked.map((d) => d.number)).size !== 4) {
    throw new Error('the four identifiers are not four distinct dancers');
  }
  if (partner.couple !== you.couple) {
    throw new Error('walking clockwise from the Boy did not end on his own Partner');
  }
  const facing = (you.couple + 1) % 4 + 1; // the couple two sides away, which faces his
  if (oppositeLady.couple !== facing) {
    throw new Error(`the second identifier is in couple ${oppositeLady.couple}, not the facing couple ${facing}`);
  }
  if (corner.couple === you.couple || rightHandLady.couple === you.couple) {
    throw new Error('a Corner or Right-Hand Lady landed in the Boy\'s own couple');
  }

  const four = [corner, oppositeLady, rightHandLady, partner];
  const link = (from, to) => {
    const x1 = px(from.x);
    const y1 = py(from.y);
    const x2 = px(to.x);
    const y2 = py(to.y);
    const a = Math.atan2(y2 - y1, x2 - x1);
    const hx = x1 + (x2 - x1) * 0.62;
    const hy = y1 + (y2 - y1) * 0.62;
    const s = 6;
    const head = [
      [hx + Math.cos(a) * s, hy + Math.sin(a) * s],
      [hx + Math.cos(a + 2.5) * s, hy + Math.sin(a + 2.5) * s],
      [hx + Math.cos(a - 2.5) * s, hy + Math.sin(a - 2.5) * s],
    ]
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return (
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
      `stroke="${COLOUR.axis}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.8"/>` +
      `<polygon points="${head}" fill="${COLOUR.axis}"/>`
    );
  };

  const relationBody = [
    // Arrows between the four, so the clockwise order is visible rather than just stated.
    four.map((d, i) => link(d, four[(i + 1) % 4])).join('\n'),
    dancerLayer(people, {
      fillOf: (p) => (p === you ? COLOUR.ink : four.includes(p) ? COLOUR.couple[p.couple] : COLOUR.muted),
    }),
    // The four labels sit outside the side their dancer stands on, which is the only place they can go.
    label(px(-3) - 18, OY + 5, 'CORNER', { size: 12, anchor: 'end' }),
    label(W / 2, py(3) - 42, 'OPPOSITE LADY', { size: 12 }),
    label(px(3) + 18, OY - 6, 'RIGHT-HAND', { size: 11, anchor: 'start' }),
    label(px(3) + 18, OY + 9, 'LADY', { size: 11, anchor: 'start' }),
    label(px(1) + 34, py(-3) + 34, 'PARTNER', { size: 12, anchor: 'start' }),
    label(px(you.x) - 20, py(you.y) + 4, 'YOU', { size: 12, anchor: 'end' }),
    caller(W / 2, py(-3) + 66, 'CALLER'),
  ].join('\n');
  files.set(
    'four-identifiers.svg',
    svg(
      'The four identifiers around the square',
      'A squared set with the number 1 Boy picked out in black. The four Women are in their couple colours, and arrows run between them clockwise: his Corner, his Opposite Lady, his Right-Hand Lady, and his Partner beside him.',
      relationBody,
    ),
  );
  index.drawn.push({
    slug: 'four-identifiers',
    title: 'The four identifiers around the square',
    from: `#${you.number} Boy`,
    clockwise: four.map((d) => `#${d.number}`).join(' -> '),
  });

  // ---------------------------------------------------------------- the phrase, in 2/4 and in 4/4
  files.set('phrase-bars.svg', phraseBarsSvg());
  index.drawn.push({
    slug: 'phrase-bars',
    title: 'The phrase in 2/4 and in 4/4',
    beats: 8,
    bars: '2/4 -> 4 bars, 4/4 -> 2 bars',
  });

  // ---------------------------------------------------------------- Leaders and Trailers
  //
  // The manual, "Leaders and Trailers": "In any box-type formation ... those facing out of the Box are
  // Leaders and those facing into the Box are Trailers." And, usefully for a diagram: "the dancers
  // marked 'L' are Leaders and the dancers marked 'T' are Trailers".
  //
  // A Box is drawn from the library, and the classification is not asserted from the side a dancer is
  // standing on but computed -- each dancer's facing is dotted with the vector outwards from the
  // formation's own centre. The count is checked as well: a box that did not come out as two of each
  // would mean the rule and the geometry disagree, and the picture would be teaching the disagreement.
  const boxWritten = lib.get('Box RH');
  if (!boxWritten) throw new Error('formations.xml has no "Box RH"');
  const box = completeSet(boxWritten).dancers;
  const boxCentre = {
    x: box.reduce((s, d) => s + d.x, 0) / box.length,
    y: box.reduce((s, d) => s + d.y, 0) / box.length,
  };
  const outward = (d) => {
    const h = ((d.angleDeg ?? 0) * Math.PI) / 180;
    const face = { x: Math.cos(h), y: Math.sin(h) };
    const out = { x: d.x - boxCentre.x, y: d.y - boxCentre.y };
    return face.x * out.x + face.y * out.y;
  };
  const leaders = box.filter((d) => outward(d) > 0.1);
  const trailers = box.filter((d) => outward(d) < -0.1);
  if (leaders.length !== 2 || trailers.length !== 2 || leaders.length + trailers.length !== box.length) {
    throw new Error(`the Box gave ${leaders.length} Leaders and ${trailers.length} Trailers, expected 2 and 2`);
  }

  // Each label goes on the outside of the pair it belongs to, on the side that dancer is standing. The
  // gap has to clear the marker, which is MARKER_UNITS * SCALE = 17px across at this scale: at 16px the
  // text overlapped the body it was naming.
  const LABEL_GAP = 28;
  const sideLabel = (d, text) => {
    const west = d.x < boxCentre.x;
    return label(west ? px(d.x) - LABEL_GAP : px(d.x) + LABEL_GAP, py(d.y) + 4, text, {
      size: 12,
      anchor: west ? 'end' : 'start',
      fill: COLOUR.ink,
    });
  };
  const boxBody = [
    dancerLayer(box, { fillOf: (d) => COLOUR.plain[d.gender] ?? COLOUR.muted }),
    ...[...leaders, ...trailers].map((d) => sideLabel(d, outward(d) > 0 ? 'LEADER' : 'TRAILER')),
  ].join('\n');
  files.set(
    'leaders-and-trailers.svg',
    svg(
      'Leaders and Trailers in a box',
      'Four dancers in a Box, seen from above, each with a wedge showing which way they face. The two facing out of the box are the Leaders and the two facing into it are the Trailers.',
      boxBody,
    ),
  );
  index.drawn.push({
    slug: 'leaders-and-trailers',
    title: 'Leaders and Trailers in a box',
    leaders: leaders.map((d) => `${d.gender} at (${d.x},${d.y})`).join(', '),
    trailers: trailers.map((d) => `${d.gender} at (${d.x},${d.y})`).join(', '),
  });

  // ---------------------------------------------------------------- Centers and Ends
  //
  // The manual, "Centers and Ends": "Dancers near the center of the square (or formation) are called
  // Centers. Dancers on the outside of the square (or formation) are called Ends. The identification of
  // Centers or Ends is independent of facing direction." Its own diagrams mark them "C" and "E", which
  // is what this follows.
  //
  // Drawn on "Normal Lines" -- two lines of four facing each other -- because that is the case the page
  // calls ambiguous: each line has its own centre pair, which is why the caller has to say "Each Side,
  // Centers". The classification is by distance from the formation's own centre, and the build asserts
  // the four nearest are strictly nearer than the four furthest: if the two groups ran together,
  // "Centers" would be a guess rather than a reading.
  const linesWritten = lib.get('Normal Lines');
  if (!linesWritten) throw new Error('formations.xml has no "Normal Lines"');
  const lines = completeSet(linesWritten).dancers;
  if (lines.length !== 8) throw new Error(`Normal Lines has ${lines.length} dancers, expected 8`);
  const lineCentre = {
    x: lines.reduce((s, d) => s + d.x, 0) / lines.length,
    y: lines.reduce((s, d) => s + d.y, 0) / lines.length,
  };
  const distance = (d) => Math.hypot(d.x - lineCentre.x, d.y - lineCentre.y);
  const byDistance = [...lines].sort((a, b) => distance(a) - distance(b));
  const centres = byDistance.slice(0, 4);
  const ends = byDistance.slice(4);
  if (Math.max(...centres.map(distance)) >= Math.min(...ends.map(distance))) {
    throw new Error('the Centers and the Ends do not separate by distance from the centre');
  }

  const letter = (d) => {
    const west = d.x < lineCentre.x;
    return label(west ? px(d.x) - 26 : px(d.x) + 26, py(d.y) + 4, centres.includes(d) ? 'C' : 'E', {
      size: 14,
      anchor: west ? 'end' : 'start',
      fill: COLOUR.ink,
    });
  };
  const centresBody = [
    dancerLayer(lines, { fillOf: (d) => COLOUR.plain[d.gender] ?? COLOUR.muted }),
    ...lines.map(letter),
  ].join('\n');
  files.set(
    'centers-and-ends.svg',
    svg(
      'Centers and Ends in two facing lines',
      'Eight dancers in two lines of four facing each other, seen from above. The four dancers nearest the middle of the whole formation are marked C for Centers, and the four on the outside E for Ends -- whichever way any of them is facing.',
      centresBody,
    ),
  );
  index.drawn.push({
    slug: 'centers-and-ends',
    title: 'Centers and Ends in two facing lines',
    centres: centres.map((d) => `${d.gender} at (${d.x},${d.y})`).join(', '),
    ends: ends.map((d) => `${d.gender} at (${d.x},${d.y})`).join(', '),
  });

  return { files, index };
}

export function main() {
  const check = process.argv.includes('--check');
  const { files, index } = build();

  if (check) {
    // TEXT, NOT LINE ENDINGS: `core.autocrlf=true` checks these SVGs out as CRLF while the writer
    // produces LF, so comparing raw strings reported DRIFT for 5 of the 6 on a tree whose content was
    // byte-identical (MEASURED: same line multiset, 0 lines in a different position). The same defect
    // is fixed in `make-animations.mjs`, which an `animations-index.json` DRIFT had been hiding - a
    // gate that is red on every Windows clone is a gate nobody reads (AGENTS.md §3).
    const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    let drift = 0;
    for (const [name, text] of files) {
      const p = join(OUT_DIR, name);
      if (!existsSync(p) || !sameText(readFileSync(p, 'utf8'), text)) {
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
