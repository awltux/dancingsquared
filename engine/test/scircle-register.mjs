// DOES `register` DROP AN AUTHORING WHEN A TITLE IS REGISTERED IN TWO CALLS?
//
// `CallLibrary.register` keys on the TITLE alone and does `variants.set(...)` - SET, not merge:
//
//   register(name: string, xml: string): void {
//     const variants = this.loadVariants(xml);
//     if (variants.length) this.variants.set(canonicalName(name), variants);
//   }
//
// so a second registration for the same title REPLACES the first rather than adding to it. Nothing
// downstream can tell which authored `<tam>` a variant came from, and the format's identity for a
// setup is `(title, formation xor from)` - the part that `set` throws away.
//
// It is NOT hidden by the input either: one `register` call can carry several setups (that is what
// `loadVariants` returns, and what `sequencerCallsUpTo` pools a title's tams into), so the caller
// has to be relied on to send them all in ONE call. Two calls for one title lose the first.
//
// This harness registers the SAME title twice, with a DIFFERENT authored setup each time, and asks
// how many setups the library ends up holding. Both are kept is the only acceptable answer: the two
// setups are different `formation`s of the same call, and the app itself reaches `register` from two
// separate code paths (`sequencer-ui.ts:165` and `:392`) without clearing the library in between.
//
// Usage: node engine/test/scircle-register.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../dist/index.js';

const TITLE = 'Single Circle Left Full';
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// The two authored setups, from the app's own comment-stripped index list.
const circleXml = read('assets/ms/circle.xml');
const blocks = circleXml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
const tams = blocks.filter((b) => new RegExp(`title="${TITLE}"`).test(b));
const formOf = (x) => (x.match(/formation="([^"]*)"/) ?? [])[1];
console.log(`== the two authored setups of "${TITLE}" ==`);
tams.forEach((t, i) => console.log(`  [${i}] formation="${formOf(t)}"`));
check(tams.length === 2, `the corpus still authors it twice (found ${tams.length})`);
if (tams.length !== 2) { console.log('\n1 CHECK(S) FAILED'); process.exit(1); }

const seq = new Sequencer(read('assets/moves.xml'), read('assets/formations.xml'), []);
const asXml = (t) => `<calls>\n${t}\n</calls>`;

// TWO register CALLS, one authored setup each - the shape that loses data.
console.log(`\n== register("${TITLE}", ...) called TWICE, one setup each ==`);
seq.register(TITLE, asXml(tams[0]));
const afterFirst = seq.matchableVariants(TITLE).map((v) => v.formation);
console.log(`  after the FIRST call : [${afterFirst.join(', ')}]`);
seq.register(TITLE, asXml(tams[1]));
const afterBoth = seq.matchableVariants(TITLE).map((v) => v.formation);
console.log(`  after the SECOND call: [${afterBoth.join(', ')}]`);

check(afterFirst.length === 1, `the first registration is accepted (got ${afterFirst.length})`);
check(
  afterBoth.length === 2,
  `BOTH authored setups survive two registrations (got ${afterBoth.length}: ${afterBoth.join(', ') || 'none'})`,
);
check(
  afterBoth.includes('Facing Dancers Far') && afterBoth.includes('Facing Dancers'),
  'the kept setups are the Far one AND the plain one',
);

// ONE register call carrying both - the shape the app actually produces today.
console.log(`\n== register("${TITLE}", ...) called ONCE carrying both setups ==`);
const seq2 = new Sequencer(read('assets/moves.xml'), read('assets/formations.xml'), []);
seq2.register(TITLE, `<calls>\n${tams.join('\n')}\n</calls>`);
const both = seq2.matchableVariants(TITLE).map((v) => v.formation);
console.log(`  variants: [${both.join(', ')}]`);
check(both.length === 2, `one call carrying both keeps both (got ${both.length})`);

// Re-registering the SAME setup twice must not accumulate duplicates.
console.log(`\n== register called twice with the SAME setup ==`);
const seq3 = new Sequencer(read('assets/moves.xml'), read('assets/formations.xml'), []);
seq3.register(TITLE, asXml(tams[1]));
seq3.register(TITLE, asXml(tams[1]));
const dup = seq3.matchableVariants(TITLE);
console.log(`  variants: [${dup.map((v) => v.formation).join(', ')}]`);
check(dup.length === 1, `the identical setup is not stored twice (got ${dup.length})`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
