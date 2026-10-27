// THE APP'S ICONS: GENERATED, NOT DRAWN BY HAND, AND GENERATED FROM THE THEME'S OWN COLOURS.
//
// WHY A GENERATOR. An icon is a binary, and this repository does not commit binaries it cannot re-derive: AGENTS.md §4.3
// says a generated artefact needs the gate that fails when it goes stale, and §4.5 says no hand-made asset where a rule can
// produce it. So the four PNGs under `game/public/` are rendered here from arithmetic — a mark of four couple-coloured
// dancers on the night-blue field — and `game/test/pwa-probe.mjs` re-renders them and compares DIGESTS, so an icon that no
// longer matches this file is a gate failure rather than a mystery.
//
// NO IMAGE LIBRARY, NO DEPENDENCY. A PNG is four chunks and a zlib stream, and `node:zlib` is in the runtime: the encoder
// below is about forty lines of IHDR/IDAT/IEND with a CRC table (`makePng`). That is the whole reason this is possible
// without adding a package — and the reason it is worth doing, because "install a native image library to draw four dots"
// is exactly the trade AGENTS.md §4.5 asks about.
//
// THE COLOURS COME FROM THE APP. The field is `ui/theme.ts`'s `COLOR.bg` and the four dots are `packages/stage`'s
// `coupleColor` — the red, yellow, green and blue a player already sees on the floor — so the icon cannot drift from the
// product it launches. MEASURED against the maskable safe zone: the artwork is inset to the inner 80 % for the masked icon,
// because Android crops a maskable icon to whatever shape the launcher uses and a dot on the edge disappears.
//
//   node game/tools/make-icons.mjs            write the four PNGs
//   node game/tools/make-icons.mjs --check    compare what is on disk with what this file renders, and exit 1 if stale
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { COLOR } from '../src/ui/theme.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');

/**
 * `packages/stage/scene.ts`'s `COUPLE_COLORS`, in order: the red, yellow, green and blue a player already sees on the floor.
 *
 * COPIED RATHER THAN IMPORTED, and the copy is GATED rather than trusted: that module imports `three` and an extensionless
 * internal path, so a Node tool cannot load it — and `game/test/pwa-probe.mjs` reads the four numbers out of that source and
 * fails if these ever differ (the same source-check `game/test/board-colours-probe.mjs` uses for the renderer's call site).
 */
export const COUPLE_DOTS = [0xe33b3b, 0xe8c23a, 0x3fbf6f, 0x3b7ee8];

// ------------------------------------------------------------------------------------------------ the PNG encoder

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** One PNG chunk: length, type, data, CRC over type+data. */
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

/** An RGBA PNG from a raw pixel buffer, 8 bits per channel, no interlacing. */
function makePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------------------------------------ the mark

const rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`icons: ${hex} is not a #rrggbb colour`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The four dots, in the couple colours a player already knows, as a square set. */
const DOTS = COUPLE_DOTS.map((n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255]);

/**
 * Render one icon at `size`, `maskable` insetting the artwork to the launch-icon safe zone.
 *
 * THE SHAPE IS DRAWN BY DISTANCE, not by a graphics call: a dot is "within radius of this centre", the field is a rounded
 * square, and every pixel is a test. That is enough for a mark of five circles and keeps the tool dependency-free.
 */
export function renderIcon(size, maskable = false) {
  const field = rgb(COLOR.bg);
  const px = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.62 : 0.74; // the safe-zone inset for a masked launcher icon
  const centre = size / 2;
  const radius = size * 0.11 * (maskable ? 0.82 : 1);
  const spread = size * 0.22 * (maskable ? 0.82 : 1);
  const corner = size * 0.16;
  /** Coverage of a pixel, 0..1, for the anti-aliased edges of the field. */
  const fieldAt = (x, y) => {
    const dx = Math.max(Math.abs(x - centre) - (size / 2 - corner), 0);
    const dy = Math.max(Math.abs(y - centre) - (size / 2 - corner), 0);
    const d = Math.hypot(dx, dy) - corner;
    return Math.min(1, Math.max(0, 0.5 - d));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      // THE FIELD: the app's own night blue, in a rounded square so the icon does not look like a screenshot.
      const a = fieldAt(x + 0.5, y + 0.5);
      let r = field[0];
      let g = field[1];
      let b = field[2];
      let alpha = Math.round(255 * a);
      // THE FOUR DOTS: at the corners of a square, one per couple.
      const dots = [
        [centre - spread, centre - spread, 0],
        [centre + spread, centre - spread, 1],
        [centre - spread, centre + spread, 2],
        [centre + spread, centre + spread, 3],
      ];
      for (const [cx, cy, i] of dots) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius * scale;
        const cover = Math.min(1, Math.max(0, 0.5 - d));
        if (cover > 0) {
          const dot = DOTS[i];
          r = r * (1 - cover) + dot[0] * cover;
          g = g * (1 - cover) + dot[1] * cover;
          b = b * (1 - cover) + dot[2] * cover;
          alpha = Math.max(alpha, Math.round(255 * a * cover + alpha * (1 - cover)));
        }
      }
      px[at] = Math.round(r);
      px[at + 1] = Math.round(g);
      px[at + 2] = Math.round(b);
      px[at + 3] = alpha;
    }
  }
  return makePng(size, size, px);
}

/** Every PNG this tool renders, what it is for, and whether the MANIFEST lists it (the touch icon is linked from the page). */
export const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false, purpose: 'any', inManifest: true },
  { file: 'icon-512.png', size: 512, maskable: false, purpose: 'any', inManifest: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, purpose: 'maskable', inManifest: true },
  // A launcher that asks for `apple-touch-icon` wants 180 px and draws it on its own square, so this one is the plain mark
  // and it is LINKED FROM THE PAGE rather than listed in the manifest — different consumers, and a manifest that listed it
  // would offer iOS an icon it does not read from there.
  { file: 'apple-touch-icon.png', size: 180, maskable: false, purpose: 'any', inManifest: false },
];

const main = () => {
  const check = process.argv.includes('--check');
  fs.mkdirSync(PUBLIC, { recursive: true });
  let stale = 0;
  for (const icon of ICONS) {
    const target = path.join(PUBLIC, icon.file);
    const bytes = renderIcon(icon.size, icon.maskable);
    if (check) {
      const onDisk = fs.existsSync(target) ? fs.readFileSync(target) : null;
      if (onDisk === null || !onDisk.equals(bytes)) {
        stale++;
        console.error(`icons: ${icon.file} is ${onDisk === null ? 'missing' : 'STALE'} - run node game/tools/make-icons.mjs`);
      }
      continue;
    }
    fs.writeFileSync(target, bytes);
    console.log(`icons: wrote ${icon.file} (${bytes.length} bytes)`);
  }
  if (check) {
    if (stale > 0) process.exit(1);
    console.log(`icons: all ${ICONS.length} PNGs match what this tool renders`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
