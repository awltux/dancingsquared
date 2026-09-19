// Probe: IS THERE ONE PLACE THAT DECIDES HOW AN EXPORTED `<tam>` NAMES ITS START FORMATION?
//
// The request: "in the Browse Calls, allow the created end formations to be added to the corpus, so that
// created calls that start from it export xml with a formation reference rather than an embedded" one.
// The engine half is measured headlessly (`engine/test/editor.mjs` 20: the reference export, the
// reference resolving against a registered formation, and the three ways the decision falls back to the
// block). What is left is the WIRING, and wiring cannot be measured by an engine harness because it is
// browser code: four places write a `<tam>` (the editor's saved instance, its copy-xml button, its
// generated setup, and the catalogue's sequencer registration) and they must all reach the SAME decision,
// or one panel exports a reference while the sequencer registers an embedded copy of the same call.
//
// So this is a check on the SOURCE, in the same shape as `stage-sync-probe.mjs`, and labelled as what it
// is rather than as a measurement of behaviour.
//
// Run: node tools/formation-ref-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC_DIR, 'src', p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** The rules, applied to a file's text, so the same analysis can be run over a deliberately broken copy. */
function wiring(src) {
  const tamXml = src['tam-xml.ts'];
  return {
    // Every `<tam>` in the app is written by the one helper.
    directCalls: Object.entries(src)
      .filter(([file]) => file !== 'tam-xml.ts')
      .flatMap(([file, text]) => [...text.matchAll(/callToXml\s*\(/g)].map(() => `${file} calls callToXml directly`)),
    // The helper asks the corpus, and asks the store ONLY for a formation the caller added to it.
    asksCorpus: /parseFormations\(formationsXmlText\)/.test(tamXml),
    gatesOnCorpusFlag: /inCorpus/.test(tamXml),
    // The engine makes the decision, so there is one definition of "the reference is faithful".
    usesEngineDecision: /callToXmlNamed\(/.test(tamXml),
    // Formations are registered BEFORE the calls that may name them, at both construction sites.
    orderInConstructor: /this\.registerUserFormations\(\);\s*\n\s*for \(const c of sequencerCallsUpTo\('ms'\)\) this\.seq\.register/.test(src['sequencer-ui.ts']),
    orderOnRebuild: /this\.registerUserFormations\(\);\s*\n\s*for \(const c of sequencerCallsUpTo\(this\.levelSelect\.value\)\) this\.seq\.register/.test(src['sequencer-ui.ts']),
  };
}

const files = ['tam-xml.ts', 'editor-ui.ts', 'data.ts', 'sequencer-ui.ts', 'browser.ts'];
const src = Object.fromEntries(files.map((f) => [f, read(f)]));
const good = wiring(src);
console.log('== the wiring, as it is ==');
check(good.directCalls.length === 0, `every \`<tam>\` in the app goes through the one helper (${good.directCalls.join('; ') || 'no direct callToXml anywhere'})`);
check(good.asksCorpus, 'and the helper resolves a name against the CORPUS');
check(good.gatesOnCorpusFlag, 'and against a user formation only once the caller has ADDED IT TO THE CORPUS, which is what the Browse panel sets');
check(good.usesEngineDecision, 'and leaves the decision to the engine, so "the reference is faithful" has one definition');
check(good.orderInConstructor, 'the app registers the user formations BEFORE the calls, at startup: a call is built when it is registered, so a reference to a formation that is not in yet is a failure rather than a retry');
check(good.orderOnRebuild, 'and again on a level change, which rebuilds the library from scratch');

// SHOWN TO FAIL, or it is decoration. Two of the faults this exists for, put back into a copy: a direct
// export that re-embeds the block, and the constructor registering calls before the formations.
console.log('\n== the check fails on the bugs it was written for ==');
{
  const direct = wiring({ ...src, 'data.ts': src['data.ts'].replace('callTamXml(call)', 'callToXml(call)') });
  check(direct.directCalls.length === 1, 'a direct `callToXml` call in the catalogue is caught (in the string it replaced, the sequencer would register an embedded copy while the panel exported a reference)');
  const backwards = wiring({ ...src, 'sequencer-ui.ts': src['sequencer-ui.ts'].replace(/this\.registerUserFormations\(\);\n(\s*)for \(const c of sequencerCallsUpTo\('ms'\)\)/, "$1for (const c of sequencerCallsUpTo('ms')) this.seq.register(c.name, c.xml);\nthis.registerUserFormations();") });
  check(!backwards.orderInConstructor, 'and so is registering the calls before the formations, which makes every saved call that names its start formation fail to build');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
