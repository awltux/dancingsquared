// Load the engine (read-only) and the committed tamination assets for figure generation.
//
// THE ENGINE IS NOT REBUILT HERE. `engine/dist` is consumed exactly as it stands: another
// workstream owns it, and rebuilding it under a running verify suite is a documented trap.
// The export surface IS asserted, because that same workstream can move it -- a missing
// symbol fails loudly and by name rather than producing a figure with silently wrong
// geometry.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url)); // .../book/tools/lib
export const toolsDir = join(here, '..'); // .../book/tools
export const root = join(here, '..', '..', '..'); // the repo root

/** The engine API the figures actually use. Asserted on load. */
const REQUIRED = [
  'setParser',
  'Engine',
  'loadCallFromXml',
  'callMeta',
  'poseFor',
  'allPoses',
  'sampleTrail',
  'dancerBeats',
  'computeHandholds',
  'assignHomeIdentity',
];

export function loadEngine() {
  // Resolve from the POC's package so `@xmldom/xmldom` is found the way poc/verify.cjs
  // finds it, without adding a dependency of our own.
  const requireFromPoc = createRequire(join(root, 'poc', 'package.json'));
  const { DOMParser } = requireFromPoc('@xmldom/xmldom');
  const eng = requireFromPoc(join(root, 'engine', 'dist', 'index.js'));

  const missing = REQUIRED.filter((k) => eng[k] === undefined);
  if (missing.length) {
    throw new Error(
      `engine/dist is missing required export(s): ${missing.join(', ')}.\n` +
        'The engine is owned by another workstream; do not rebuild it here to make this pass.',
    );
  }
  if (typeof eng.setParser !== 'function') throw new Error('engine setParser is not callable');
  eng.setParser(DOMParser);
  return eng;
}

export function assetPath(...parts) {
  const p = join(root, 'poc', 'src', 'assets', ...parts);
  if (!existsSync(p)) throw new Error(`missing asset: ${p}`);
  return p;
}

export function readAsset(...parts) {
  return readFileSync(assetPath(...parts), 'utf8');
}

/**
 * The levels a figure may be drawn from.
 *
 * The corpus's LEVEL IS NOT MEMBERSHIP -- the manual decides what is taught. It only decides
 * where animation data may be found, and a call that moved into Mainstream from Basic may
 * have its only authoring under `b1/`, so all of these are searched.
 */
export const SOURCE_LEVELS = ['ms', 'b1', 'b2', 'plus'];

/** Load `moves.xml` + `formations.xml` once and build an Engine. */
export function makeEngine(eng) {
  return new eng.Engine(readAsset('moves.xml'), readAsset('formations.xml'));
}

/**
 * Every call title the corpus exposes, mapped to the (file, tamIndex) sites that define it.
 *
 * EVERY `<tam>` IS ENUMERATED, not just the file's first title. `callMeta` returns one
 * title per file, and a corpus file routinely holds several calls -- `circle.xml` carries
 * Circle Left, Circle of 4 and Single Circle -- so a title-per-file catalogue silently
 * under-counts what can be drawn.
 *
 * The corpus's level is NOT membership: it only says where animation data may be found,
 * and a call that moved into Mainstream from Basic may have its only authoring under `b1/`.
 */
export function catalogue(eng, levels = SOURCE_LEVELS) {
  const byTitle = new Map();
  for (const level of levels) {
    const dir = join(root, 'poc', 'src', 'assets', level);
    if (!existsSync(dir)) continue;
    for (const f of readdirXml(dir)) {
      const rel = `${level}/${f}`;
      let tams;
      try {
        tams = eng.parseCallXml(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue; // a file that does not parse is not a call
      }
      tams.forEach((t, i) => {
        if (!t?.title) return;
        if (!byTitle.has(t.title)) byTitle.set(t.title, []);
        const sites = byTitle.get(t.title);
        if (!sites.some((s) => s.file === rel && s.tamIndex === i)) sites.push({ file: rel, tamIndex: i });
      });
    }
  }
  return byTitle;
}

function readdirXml(dir) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = createRequire(import.meta.url)('node:fs');
  return readdirSync(dir).filter((f) => f.endsWith('.xml'));
}

/** Build a call bundle from a corpus site, mirroring the half-set authorings. */
export function loadCall(eng, site) {
  const xml = readFileSync(join(root, 'poc', 'src', 'assets', site.file), 'utf8');
  return eng.loadCallFromXml(xml, readAsset('moves.xml'), readAsset('formations.xml'), site.tamIndex, true);
}
