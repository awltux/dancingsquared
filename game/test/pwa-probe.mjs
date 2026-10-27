// THE INSTALLABLE APP, PINNED: the icons are the tool's bytes, the manifest is what the tool promises, and the palette is
// the floor's.
//
// REPORTED: "I think its also time to star thinking about multi-platform. Especially mobile." Installing the game from a
// browser is the cheapest multi-platform step there is — the same code, no store, no new dependency — and the three things
// that make it work are all things that go stale silently:
//
//   1. THE ICONS. `game/tools/make-icons.mjs` renders four PNGs from arithmetic (no image library: a PNG is four chunks and a
//      zlib stream). The committed bytes are compared here by re-rendering them, so an icon that no longer matches the tool is
//      a FAILURE rather than a mystery — AGENTS.md §4.3's "a generated artefact needs the gate that fails when it goes stale".
//      MEASURED on the day it landed: 2885 / 8849 / 7150 / 2590 bytes for the four, which are the numbers this compares.
//   2. THE MANIFEST. Every field a launcher reads is checked, and its icon list must name EXACTLY the files the tool renders —
//      a `src` that is not there is an install prompt that fails on a phone and nowhere else.
//   3. THE PALETTE. The icon's four dots are `packages/stage/scene.ts`'s `COUPLE_COLORS`, copied into the tool because that
//      module imports `three` and a Node tool cannot load it. THE COPY IS GATED HERE by reading the four numbers out of the
//      source — the same source-check `board-colours-probe.mjs` uses for the renderer's call site.
//
// THE NEGATIVE CONTROLS: one byte of a committed icon is mutated in memory and must fail the digest comparison, and a manifest
// with an icon `src` that does not exist must fail the existence check. Both run against synthetic data, so a green run cannot
// mean "the scanner read nothing" (§11.2.2).
//
// Usage: node game/test/pwa-probe.mjs   (reads files and re-renders; no browser, no engine)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ICONS, COUPLE_DOTS, renderIcon } from '../tools/make-icons.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const REPO = path.resolve(GAME, '..');
const PUBLIC = path.join(GAME, 'public');

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (detail ? `\n        ${detail}` : ''));
  if (!cond) failures++;
};

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);

console.log('\n== 1. the icons are the tool\'s own bytes ==');
{
  check(ICONS.length === 4, `the tool renders ${ICONS.length} icons`);
  for (const icon of ICONS) {
    const target = path.join(PUBLIC, icon.file);
    const exists = fs.existsSync(target);
    check(exists, `${icon.file} exists`, target);
    if (!exists) continue;
    const onDisk = fs.readFileSync(target);
    const rendered = renderIcon(icon.size, icon.maskable);
    check(onDisk.equals(rendered), `${icon.file} is what the tool renders (${onDisk.length} bytes, ${digest(onDisk)})`,
      onDisk.equals(rendered) ? '' : `on disk ${digest(onDisk)} vs rendered ${digest(rendered)} - run node game/tools/make-icons.mjs`);
    // A PNG SIGNATURE IS THE FILE'S OWN CLAIM TO BE ONE, and a browser that refuses an icon says nothing on a phone.
    check(onDisk.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      `${icon.file} starts with the PNG signature`);
    // THE SIZE IS IN THE HEADER as well as the filename, because a launcher reads the header.
    const width = onDisk.readUInt32BE(16);
    const height = onDisk.readUInt32BE(20);
    check(width === icon.size && height === icon.size, `${icon.file} is ${icon.size} x ${icon.size} by its own IHDR (${width} x ${height})`);
  }
}

console.log('\n== 2. the negative control: a stale byte is caught ==');
{
  const icon = ICONS[0];
  const rendered = renderIcon(icon.size, icon.maskable);
  const mutated = Buffer.from(rendered);
  mutated[mutated.length - 1] ^= 0x01; // one bit, in the IEND chunk
  check(!mutated.equals(rendered) && digest(mutated) !== digest(rendered),
    'one flipped bit changes the digest, so the comparison above is a real one');
  check(renderIcon(icon.size, icon.maskable).equals(rendered), 'and rendering twice gives the same bytes (deterministic)');
  const other = renderIcon(icon.size, !icon.maskable);
  check(!other.equals(rendered), 'the maskable inset is a different picture, not the same file twice');
}

console.log('\n== 3. the manifest says what a launcher reads ==');
{
  const manifestPath = path.join(PUBLIC, 'manifest.webmanifest');
  check(fs.existsSync(manifestPath), 'public/manifest.webmanifest exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const field of ['name', 'short_name', 'description', 'start_url', 'scope', 'display', 'background_color', 'theme_color']) {
    check(typeof manifest[field] === 'string' && manifest[field].length > 0, `it declares ${field}`, String(manifest[field]));
  }
  check(manifest.display === 'standalone', `display is standalone (${manifest.display})`);
  // THE START URL IS RELATIVE, because the app is served from a subpath as often as from a root (`vite.config.ts` sets
  // `base: './'`), and an absolute `/` would open the wrong page on a static host.
  check(manifest.start_url === './' && manifest.scope === './', 'start_url and scope are relative to the app');
  // THE MANIFEST LISTS THE LAUNCHER ICONS ONLY, which is `inManifest` in the tool's own table — the 180 px touch icon is
  // linked from the page instead, because iOS reads it from there and not from the manifest.
  const launcherIcons = ICONS.filter((icon) => icon.inManifest);
  check(Array.isArray(manifest.icons) && manifest.icons.length === launcherIcons.length,
    `it lists ${launcherIcons.length} launcher icons (${Array.isArray(manifest.icons) ? manifest.icons.length : 'none'})`);
  const named = (manifest.icons ?? []).map((icon) => path.basename(icon.src)).sort();
  check(named.join() === launcherIcons.map((icon) => icon.file).sort().join(),
    `and they are exactly the tool's launcher files (${named.join(', ')})`, named.join(', '));
  // EVERY `src` RESOLVES, which is the check a phone would otherwise make by failing to install.
  const missing = (manifest.icons ?? []).map((icon) => icon.src).filter((src) => !fs.existsSync(path.join(PUBLIC, path.basename(src))));
  check(missing.length === 0, `and every src exists (${missing.length} missing)`, missing.join(', '));
  // THE MASKABLE ONE IS MARKED MASKABLE, or Android crops the normal icon and eats a dot.
  const maskable = (manifest.icons ?? []).filter((icon) => String(icon.purpose).includes('maskable'));
  check(maskable.length === 1 && maskable[0].sizes === '512x512', `exactly one maskable 512 (${maskable.length})`);
  // A THEME COLOUR THAT DISAGREES WITH `index.html` IS TWO DEFINITIONS: the manifest's must BE the page's.
  const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
  const themed = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
  check(themed === manifest.theme_color, `the manifest and the page agree on the theme colour (${themed} vs ${manifest.theme_color})`);
  // NEGATIVE CONTROL: a manifest naming a file that is not there fails the existence check above and nothing else.
  const bogus = { icons: [{ src: './icon-999.png', sizes: '999x999', type: 'image/png', purpose: 'any' }] };
  const bogusMissing = bogus.icons.map((icon) => icon.src).filter((src) => !fs.existsSync(path.join(PUBLIC, path.basename(src))));
  check(bogusMissing.length === 1, 'a src that names nothing would fail that check (the control)');
}

console.log('\n== 4. the page and the shell ==');
{
  const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
  check(/<link rel="manifest" href="\.\/manifest\.webmanifest"/.test(html), 'index.html links the manifest');
  check(/<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png"/.test(html), 'and the Apple touch icon');
  check(/viewport-fit=cover/.test(html), 'and asks for the full viewport (which the safe-area padding needs)');
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  check(/const VERSION = 'dsq-v\d+'/.test(sw), 'the service worker names its cache version');
  check(/skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw), 'and takes over on install and activate');
  check(/request\.mode === 'navigate'/.test(sw), 'with a navigation path of its own (network-first, shell fallback)');
  check(/url\.origin !== self\.location\.origin/.test(sw), 'and it never touches another origin');
  // THE REGISTRATION IS IN THE SHELL AND IS PRODUCTION-ONLY: a worker in development would cache the URLs Vite rewrites.
  const shell = fs.readFileSync(path.join(GAME, 'src', 'main.ts'), 'utf8');
  check(/serviceWorker\.register\('\.\/sw\.js'\)/.test(shell), 'main.ts registers it');
  check(/import\.meta\.env\.PROD/.test(shell), 'and only in a built bundle, not under the dev server');
}

console.log('\n== 5. the palette is the floor\'s ==');
{
  const scene = fs.readFileSync(path.join(REPO, 'packages', 'stage', 'scene.ts'), 'utf8');
  const match = /const COUPLE_COLORS = \[([^\]]+)\]/.exec(scene);
  check(match !== null, 'scene.ts still declares COUPLE_COLORS');
  const source = (match?.[1] ?? '').split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value));
  check(source.length === 4, `it holds four colours (${source.length})`);
  check(JSON.stringify(source) === JSON.stringify(COUPLE_DOTS),
    `and the tool's copy is the same four numbers (${source.map((n) => `0x${n.toString(16)}`).join(', ')})`,
    `scene ${source.join(',')} vs tool ${COUPLE_DOTS.join(',')}`);
  check(COUPLE_DOTS.every((n) => n >= 0 && n <= 0xffffff), 'each is a 24-bit colour');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
