// Probe: the SAVED MODULES are read through one validating parser, by both readers.
//
// Two modules read the same localStorage key and only one checked what it found. The browse view's
// `savedModules` rejected an entry with no `name` or no `calls` array; the sequencer's `loadModules` cast
// whatever it parsed straight to `Module[]`. `refreshModulesList` then maps over the result FROM THE
// CONSTRUCTOR, which `main.ts` awaits at top level - so a stored `{"a":1}` (not an array) or a single `{}`
// threw during startup and took the whole app down, while the browse view carried on as if nothing were wrong.
//
// The parser is pure and has no imports but a type, so this calls it directly under node's type stripping
// rather than reading its text.
//
// Run: node poc/tools/stored-modules-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const { parseStoredModules } = await import('./../src/stored-modules.ts');

console.log('== what a corrupt store yields ==');
const cases = [
  ['a JSON object instead of an array', '{"a":1}', 0],
  ['the literal null', 'null', 0],
  ['a number', '42', 0],
  ['truncated JSON', '[{"name":"x","calls":', 0],
  ['nothing stored at all', null, 0],
  ['an empty string', '', 0],
  ['an entry that is not an object', '[null,7,"x"]', 0],
  ['an entry with no calls', '[{"name":"x"}]', 0],
  ['an entry with no name', '[{"calls":["Pass Thru"]}]', 0],
  ['an entry whose calls is a string', '[{"name":"x","calls":"Pass Thru"}]', 0],
];
for (const [what, raw, expect] of cases) {
  const got = parseStoredModules(raw);
  check(got.length === expect, `${what} yields ${expect} module(s) rather than throwing`);
}

console.log('\n== what a good store yields ==');
const good = parseStoredModules('[{"name":"a","calls":["Pass Thru"]},{"name":"b","calls":[{"call":"Swing Thru","selection":"Heads"}]}]');
check(good.length === 2, 'two well-formed entries both survive');
check(good[0].name === 'a' && good[0].calls[0] === 'Pass Thru', 'the first keeps its name and its steps');
check(good[1].calls[0].call === 'Swing Thru' && good[1].calls[0].selection === 'Heads', 'and a scoped step keeps its selection, which is what tells two calls apart');
const mixed = parseStoredModules('[{"name":"good","calls":[]},{},{"name":"also good","calls":[]}]');
check(mixed.length === 2 && mixed[0].name === 'good' && mixed[1].name === 'also good',
  'A BAD ENTRY IN THE MIDDLE LOSES ITSELF, NOT THE LIST - the others still load');
const extra = parseStoredModules('[{"name":"a","calls":[],"level":"ms","tags":["x"]}]');
check(extra.length === 1 && !('level' in extra[0]) && !('tags' in extra[0]),
  'unknown fields are dropped rather than carried forward as a schema this module would then own');

console.log('\n== and both readers are the same reader ==');
const seq = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8');
const mods = fs.readFileSync(path.join(POC, 'src', 'modules.ts'), 'utf8');
check(/this\.modules = parseStoredModules\(localStorage\.getItem\(MODULES_STORAGE_KEY\)\)/.test(seq),
  'the sequencer parses the stored list through it');
check(seq.includes("import { parseStoredModules } from './stored-modules';"), 'and imports it rather than copying it');
check(/return parseStoredModules\(localStorage\.getItem\(MODULES_STORAGE_KEY\)\)/.test(mods),
  'the browse view reads the same key through the same function');
check(!/JSON\.parse\(localStorage\.getItem\(MODULES_STORAGE_KEY\)/.test(seq + mods),
  'and the unvalidated parse is GONE from both, not left beside it');
check(/catch \{\s*return \[\];/.test(fs.readFileSync(path.join(POC, 'src', 'stored-modules.ts'), 'utf8')),
  'the one parser is the one that swallows a corrupt store');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
