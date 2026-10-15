// Copy the corpus into the game, and check the copy has not gone stale.
//
//   node game/tools/sync-corpus.mjs           # copy
//   node game/tools/sync-corpus.mjs --check   # fail (exit 1) if the copy differs
//
// ============================================================================================
// WHY A COPY EXISTS AT ALL, SINCE AGENTS.md §1 SAYS THE CORPUS LIVES IN `poc/src/assets`.
//
// IT IS NOT A CHOICE. `import.meta.glob` CANNOT REACH OUTSIDE THE PROJECT ROOT: it is a compile-time
// transform that only matches files under Vite's `root`, and `server.fs.allow` governs what may be
// SERVED, not what may be GLOBBED. MEASURED: with the game's `root` at `game/` and globs written as
// `../../poc/src/assets/...`, Vite compiled every one of the three globs to an EMPTY OBJECT —
//
//     const MOVES = /* #__PURE__ */ Object.assign({});
//
// — and the app then sat on "Loading the corpus…" forever, because `only()` threw on zero matches and
// nothing on the page surfaces a boot error. So the options were: duplicate the bytes into the package,
// or root the whole app at the repository (which would drag `index.html`, the dev server's file
// denylist and the build output to the repo root for this one reason).
//
// THE COPY IS THEREFORE A BUILD INPUT AND THE ORIGINAL REMAINS THE SOURCE OF TRUTH. To stop that being a
// silent fork — which is the failure mode AGENTS.md §1 warns about — this file also CHECKS: `--check`
// compares every copied file against its original by content and exits non-zero on any difference, and
// `game/tools/verify-probes.mjs` runs that check before the probes, so the game's gate fails when the
// corpus moves. A duplicated file with a gate is a build artefact; one without is a fork.
// ============================================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(here, '..');
const SOURCE = path.join(GAME, '..', 'poc', 'src', 'assets');
const TARGET = path.join(GAME, 'src', 'assets');

const check = process.argv.includes('--check');

/** `moves.xml`, `formations.xml`, and every call file under `ms/` — the three things the app globs. */
function files() {
  const out = [
    { from: path.join(SOURCE, 'moves.xml'), to: path.join(TARGET, 'moves.xml') },
    { from: path.join(SOURCE, 'formations.xml'), to: path.join(TARGET, 'formations.xml') },
  ];
  const msDir = path.join(SOURCE, 'ms');
  for (const name of fs.readdirSync(msDir).filter((f) => f.endsWith('.xml')).sort()) {
    out.push({ from: path.join(msDir, name), to: path.join(TARGET, 'ms', name) });
  }
  return out;
}

if (!fs.existsSync(SOURCE)) {
  console.error(`sync-corpus: the corpus is not at ${SOURCE}`);
  process.exit(1);
}

let copied = 0;
let same = 0;
const drift = [];

for (const { from, to } of files()) {
  const src = fs.readFileSync(from);
  if (fs.existsSync(to)) {
    const dst = fs.readFileSync(to);
    // BY CONTENT, NOT BY MTIME. A timestamp comparison reports a difference after any checkout that
    // rewrites the file, which is exactly when a false alarm trains people to skip the gate.
    if (src.equals(dst)) {
      same++;
      continue;
    }
    drift.push(path.relative(GAME, to));
  } else {
    drift.push(`${path.relative(GAME, to)} (missing)`);
  }
  if (!check) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, src);
    copied++;
  }
}

if (check) {
  if (drift.length) {
    console.error(`sync-corpus: ${drift.length} file(s) differ from poc/src/assets — run \`node game/tools/sync-corpus.mjs\`:`);
    for (const d of drift.slice(0, 10)) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`sync-corpus: ${same} file(s) identical to poc/src/assets`);
  process.exit(0);
}

console.log(`sync-corpus: ${copied} copied, ${same} already current (source: poc/src/assets)`);
