// A tiny indexed-colour rasteriser: enough to draw the dance board into GIF frames.
//
// No anti-aliasing and no font engine -- GIF is an indexed format and this board is made of flat
// shapes, so crisp edges are what the format wants anyway. Text is limited to the dancer numbers
// 1-8, drawn from a hand-written 3x5 bitmap, which is all the board needs.
//
// The palette is NOT here: `board-style.mjs` owns the sixteen colours, the marker size and which colour a dancer
// is drawn in, because the page player draws the same board and the two must not drift. This module is the
// SURFACE - an indexed-colour canvas and a PNG writer - and knows nothing about dancers.
import zlib from 'node:zlib';


const GLYPHS = {
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  0: ['111', '101', '101', '101', '111'],
};

export class Canvas {
  constructor(width, height, background = 0) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height).fill(background);
  }

  set(x, y, colour) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = colour;
  }

  fillRect(x, y, w, h, colour) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx++) this.px[row + xx] = colour;
    }
  }

  fillCircle(cx, cy, r, colour) {
    const r2 = r * r;
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2) this.set(xx, yy, colour);
      }
    }
  }

  /**
   * The four corners of a square marker turned INTO THE DANCER'S FACING.
   *
   * The Boy's marker is a square, and a square is the only marker whose orientation can be seen --
   * a circle has none. Drawn axis-aligned it stays put while the dancer turns, so a Boy reads as
   * sliding sideways round the floor instead of travelling. A square at 90-degree steps looks the
   * same either way, so this shows when the facings are diagonal: a promenade, an Alamo, a 3/4 tag.
   *
   * Board +y is north and screen +y is down, so a heading `h` points at (cos h, -sin h) on screen.
   */
  static squareCorners(cx, cy, r, heading) {
    const ux = Math.cos(heading);
    const uy = -Math.sin(heading);
    return [
      [cx + ux * r - uy * r, cy + uy * r + ux * r],
      [cx + ux * r + uy * r, cy + uy * r - ux * r],
      [cx - ux * r + uy * r, cy - uy * r - ux * r],
      [cx - ux * r - uy * r, cy - uy * r + ux * r],
    ];
  }

  /** A filled square marker in the dancer's facing, and its outline. */
  orientedSquare(cx, cy, r, heading, { colour, outline = 0, width = 1 } = {}) {
    const corners = Canvas.squareCorners(cx, cy, r, heading);
    this.fillPolygon(corners, colour);
    if (!outline) return;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      this.strokeLine(a[0], a[1], b[0], b[1], width, outline);
    }
  }

  /** A filled polygon by even-odd scanline, which is all a facing nose or a marker needs. */
  fillPolygon(points, colour) {
    if (points.length < 3) return;
    const ys = points.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (a[1] === b[1]) continue;
        const lo = Math.min(a[1], b[1]);
        const hi = Math.max(a[1], b[1]);
        if (y < lo || y >= hi) continue;
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil(xs[i]));
        const to = Math.min(this.width - 1, Math.floor(xs[i + 1]));
        for (let x = from; x <= to; x++) this.set(x, y, colour);
      }
    }
  }

  /** A thick line: every pixel of the bounding box within half the width of the segment. */
  strokeLine(x1, y1, x2, y2, width, colour) {
    const half = Math.max(0.5, width / 2);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - half));
    const xx1 = Math.min(this.width - 1, Math.ceil(Math.max(x1, x2) + half));
    const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - half));
    const yy1 = Math.min(this.height - 1, Math.ceil(Math.max(y1, y2) + half));
    for (let y = y0; y <= yy1; y++) {
      for (let x = x0; x <= xx1; x++) {
        let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + t * dx;
        const py = y1 + t * dy;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (d2 <= half * half) this.set(x, y, colour);
      }
    }
  }

  strokePolyline(points, width, colour) {
    for (let i = 0; i + 1 < points.length; i++) {
      this.strokeLine(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width, colour);
    }
  }

  strokeCircle(cx, cy, r, width, colour) {
    const half = Math.max(0.5, width / 2);
    for (let y = Math.floor(cy - r - half); y <= Math.ceil(cy + r + half); y++) {
      for (let x = Math.floor(cx - r - half); x <= Math.ceil(cx + r + half); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (Math.abs(d - r) <= half) this.set(x, y, colour);
      }
    }
  }

  /** A dancer number, from the 3x5 bitmap, scaled up. */
  digit(n, x, y, scale, colour) {
    const glyph = GLYPHS[n];
    if (!glyph) return;
    for (let ry = 0; ry < glyph.length; ry++) {
      for (let rx = 0; rx < glyph[ry].length; rx++) {
        if (glyph[ry][rx] === '1') this.fillRect(x + rx * scale, y + ry * scale, scale, scale, colour);
      }
    }
  }
}

/**
 * Write a canvas as a PNG (truecolour, no alpha).
 *
 * This is a DEBUG aid, not part of the book: it exists so a frame of an animation can be looked at,
 * because a GIF encoder that runs without error is not the same as a board that renders correctly.
 */
export function writePng(canvas, palette) {
  const { width, height } = canvas;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const c = palette[canvas.px[y * width + x]] ?? [0, 0, 0];
      raw[o++] = c[0];
      raw[o++] = c[1];
      raw[o++] = c[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return out;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
