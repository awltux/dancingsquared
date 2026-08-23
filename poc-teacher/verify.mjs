// Headless check of the Teacher Session Tracker core (PRD item 15) against the
// real Mainstream catalog + engine Sequencer. Run with `npm run verify` (Node 26
// runs the .ts sources directly via type stripping).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';

import { buildCatalog, makeSequencer } from './src/catalog.ts';
import { defaultProgramme, parseProgramme, serializeProgramme, buildClassFromProgramme } from './src/programme.ts';
import {
  availableTitles,
  fitsAround,
  generateTips,
  priorityWeights,
  pullForward,
  rollUntaughtForward,
  studentKnowledge,
  teachCall,
  unteachCall,
  addStudent,
  removeStudent,
  renameStudent,
  insertInto,
  removeAt,
  replaceAt,
} from './src/teacher.ts';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assets = path.join(root, 'poc/src/assets');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const movesXml = read('poc/src/assets/moves.xml');
const formationsXml = read('poc/src/assets/formations.xml');

const files = {};
for (const f of readdirSync(path.join(assets, 'ms')).filter((f) => f.endsWith('.xml'))) {
  files[`ms/${f}`] = read(`poc/src/assets/ms/${f}`);
}
const catalog = buildCatalog(files);
const seq = makeSequencer(movesXml, formationsXml, catalog);
const titles = catalog.map((c) => c.title);

console.log(`== Catalog: ${catalog.length} distinct titles, ${titles.length} total ==`);
check(catalog.length >= 60, `catalog has >= 60 ms calls (${catalog.length})`);
check(titles.includes('Circle Left') && titles.includes('Allemande Left'), 'catalog includes Circle Left + Allemande Left');

console.log('\n== Class / sessions ==');
// A realistic MS curriculum; sessions teach overlapping subsets so tips can chain.
const CORE = [
  'Circle Left',
  'Forward and Back',
  'Allemande Left',
  'Courtesy Turn',
  'Flutterwheel',
  'Ladies Chain',
  'Right and Left Thru',
  'Sides Face, Grand Square',
  'Sides Face, Grand Spin',
  'Heads Promenade 1/2',
  'Right and Left Grand',
  'Pass Thru',
  'Square Thru',
  'Swing Thru',
  'Grand Square',
  'All 4 Couples Promenade',
];
const toRef = (title) => {
  const c = catalog.find((x) => x.title === title);
  return c ? { title: c.title, level: 'ms', setupIdx: 0, setup: c.setups[0].label } : null;
};
const taught = CORE.map(toRef).filter(Boolean);
check(taught.length >= 8, `curriculum resolved ${taught.length} calls`);
const s1Calls = taught.slice(0, 6);
const s2Calls = taught.slice(6, 11);
const s3Calls = taught.slice(11);

const cls = {
  id: 'c1',
  name: 'Beginner MS',
  level: 'ms',
  students: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Carol' },
  ],
  sessions: [
    {
      id: 's1',
      name: 'Session 1',
      level: 'ms',
      planned: s1Calls,
      taught: s1Calls.slice(0, 4), // taught 4 of 6 planned
      attendance: { a: true, b: true, c: false },
      problems: [{ title: s1Calls[3].title, setupIdx: 0, priority: 3, note: 'sides struggle' }],
    },
    {
      id: 's2',
      name: 'Session 2',
      level: 'ms',
      planned: s2Calls,
      taught: s2Calls,
      attendance: { a: true, b: false, c: true },
      problems: [],
    },
    {
      id: 's3',
      name: 'Session 3',
      level: 'ms',
      planned: s3Calls,
      taught: [],
      attendance: {},
      problems: [],
    },
  ],
};

const avail1 = availableTitles(cls, 0);
check(avail1.has(cls.sessions[0].taught[0].title), 'session 1 available includes its taught calls');
check(!avail1.has(cls.sessions[1].taught[0].title), 'session 1 available excludes later session calls');

console.log('\n== Roll plan forward ==');
const rollCls = structuredClone(cls);
const s0planned = rollCls.sessions[0].planned.map((r) => r.title);
rollUntaughtForward(rollCls, 0);
const rolled = rollCls.sessions[1].planned.map((r) => r.title);
check(s0planned.every((t) => rolled.includes(t)), `all planned calls moved into session 2 plan`);
check(rollCls.sessions[0].planned.length === 0, 'current session plan cleared after moving');
check(rolled.length === s0planned.length + (rollCls.sessions[1].planned.length - s0planned.length), 'session 2 plan has the moved calls');

// Rolling the LAST session creates a new session to hold the plan.
const last = rollCls.sessions.length - 1;
const before = rollCls.sessions.length;
rollUntaughtForward(rollCls, last);
check(rollCls.sessions.length === before + 1, `rolling the last session creates a new one (${before} -> ${rollCls.sessions.length})`);
check(rollCls.sessions[last].planned.length === 0, 'last session plan cleared after moving');
check(rollCls.sessions[last + 1].planned.length > 0, 'new session holds the moved calls');

// A class whose sessions start with an empty taught list (the model the UI uses).
const emptyTaught = structuredClone(cls);
for (const s of emptyTaught.sessions) s.taught = [];

console.log('\n== Pull forward ==');
const pullCls = structuredClone(emptyTaught);
const s3StartLen = pullCls.sessions[2].planned.length;
const pullTarget = s3Calls[0];
const s2PlannedBefore = pullCls.sessions[1].planned.length;
pullForward(pullCls, 1, 1);
check(pullCls.sessions[1].planned.some((r) => r.title === pullTarget.title), 'pulled a call into THIS session\'s planned');
check(pullCls.sessions[1].planned.length === s2PlannedBefore + 1, 'session planned grew by the pulled call');
check(pullCls.sessions[2].planned.length === s3StartLen - 1, 'pulled call removed from next session plan');
check(pullCls.sessions[1].taught.length === 0, 'pulled call did NOT go into taught');

console.log('\n== Dancer management (add / rename / remove) ==');
const mc = structuredClone(emptyTaught);
const origCount = mc.students.length;
addStudent(mc, 'Eve');
check(mc.students.length === origCount + 1, 'addStudent adds a dancer');
const eve = mc.students.find((s) => s.name === 'Eve');
check(eve != null && mc.sessions.every((s) => s.attendance[eve.id] === false), 'new dancer appears in every session register (absent)');
addStudent(mc, '   ');
check(mc.students.length === origCount + 1, 'blank name is ignored');
renameStudent(mc, eve.id, 'Evelyn');
check(mc.students.find((s) => s.id === eve.id)?.name === 'Evelyn', 'renameStudent renames the dancer');
removeStudent(mc, eve.id);
check(mc.students.length === origCount, 'removeStudent removes the dancer');
check(mc.sessions.every((s) => s.attendance[eve.id] === undefined), 'removed dancer cleared from session registers');

console.log('\n== Teach / unteach (planned -> taught) ==');
const tc = structuredClone(emptyTaught);
const plan0 = tc.sessions[0].planned.length;
teachCall(tc, 0, 0);
check(tc.sessions[0].taught.length === 1 && tc.sessions[0].planned.length === plan0 - 1, 'teach moves a planned call into taught');
check(tc.sessions[0].taught[0].title === emptyTaught.sessions[0].planned[0].title, 'taught call is the first planned call');
unteachCall(tc, 0, 0);
check(tc.sessions[0].planned.length === plan0 && tc.sessions[0].taught.length === 0, 'unteach moves it back to planned');

console.log('\n== Student knowledge ==');
const carol = studentKnowledge(cls, 'c');
check(carol.missed.includes(cls.sessions[0].taught[0].title), `Carol missed session-1 taught call (${carol.missed.join(',')})`);
check(carol.known.includes(cls.sessions[1].taught[0].title), 'Carol knows session-2 taught call (attended)');
const alice = studentKnowledge(cls, 'a');
check(!alice.missed.includes(cls.sessions[1].taught[0].title), 'Alice knows calls she attended');

console.log('\n== Priorities (current taught + problems) ==');
const pri = priorityWeights(cls, 1);
check((pri.get(cls.sessions[1].taught[0].title) ?? 0) >= 2, 'current-session taught call prioritised');
check((pri.get(cls.sessions[0].problems[0].title) ?? 0) >= 3, 'problem call-setup prioritised');

console.log('\n== Tip generation (starts and finishes in the squared set, uses only taught calls) ==');
// Session 2 knows sessions 0..1 taught calls only.
const available = availableTitles(cls, 1);
const priority = priorityWeights(cls, 1);
// A Sequencer registered with ONLY the class's taught calls.
const availSeq = makeSequencer(movesXml, formationsXml, catalog.filter((x) => available.has(x.title)));
const tips = generateTips(availSeq, available, priority, { minLen: 3, maxLen: 6, count: 3 });
check(tips.length > 0, `generated ${tips.length} tips`);
for (const tip of tips) {
  const legalTitles = tip.every((t) => available.has(t));
  check(legalTitles, `tip uses only available calls: ${tip.join(' > ')}`);
  // Verify the tip is legal to play and BEGINS and ENDS in the squared set.
  availSeq.reset();
  const startsSquare = availSeq.isAt('Static Square');
  let legal = true;
  for (const t of tip) legal = legal && availSeq.apply(t).legal;
  const endsSquare = availSeq.isAt('Static Square');
  check(legal && startsSquare && endsSquare, `tip starts in square and finishes in square: ${tip.join(' > ')}`);
}

// The config probabilities (repeat/priority/current/prev) are accepted and still
// produce valid closing tips.
const currentSet = new Set(cls.sessions[1].taught.map((r) => r.title));
const cfgTips = generateTips(availSeq, available, priority, {
  minLen: 3,
  maxLen: 6,
  count: 1,
  config: { repeatProb: 1, priorityProb: 1, currentProb: 1, prevProb: 1 },
  current: currentSet,
  rand: () => 0,
});
const cfgValid = cfgTips.every((tip) => tip.every((t) => available.has(t)));
availSeq.reset();
let cfgEndsSquare = true;
for (const tip of cfgTips) {
  availSeq.reset();
  for (const t of tip) cfgEndsSquare = cfgEndsSquare && availSeq.apply(t).legal;
  cfgEndsSquare = cfgEndsSquare && availSeq.isAt('Static Square');
}
check(Array.isArray(cfgTips) && cfgValid && cfgEndsSquare, 'tip config (repeat/priority/current/prev probabilities) is accepted and tips still close home');

console.log('\n== Fits around a selected call (before / after) ==');
const sampleTip = tips[0] ?? ['Circle Left', 'Forward and Back', 'Allemande Left'];
const idx = Math.min(1, sampleTip.length - 1);
const fits = fitsAround(seq, available, sampleTip, idx);
check(Array.isArray(fits.before) && fits.before.length >= 0, `fits before/after returned (before=${fits.before.length}, after=${fits.after.length})`);
check(sampleTip[idx] != null, `selected call = ${sampleTip[idx]}`);
const replaced = replaceAt(sampleTip, idx, fits.before[0] ?? sampleTip[idx]);
const inserted = insertInto(sampleTip, idx, fits.before[0] ?? sampleTip[idx]);
const removed = removeAt(sampleTip, idx);
check(replaced.length === sampleTip.length, 'replaceAt keeps length');
check(inserted.length === sampleTip.length + 1, 'insertInto adds one');
check(removed.length === sampleTip.length - 1, 'removeAt removes one');

console.log('\n== Programme import / export ==');
const def = defaultProgramme();
check(def.sessions.length >= 3, `default programme has >= 3 sessions (${def.sessions.length})`);
check(def.sessions.every((s) => s.calls.length > 0), 'default programme sessions each have calls');
const round = parseProgramme(serializeProgramme(def));
check(round != null && round.name === def.name && round.sessions.length === def.sessions.length, 'programme round-trips through export/import');
check(round.sessions[0].calls.join() === def.sessions[0].calls.join(), 'imported session calls match');
check(parseProgramme('not json') === null, 'invalid programme JSON is rejected');
check(parseProgramme('{"name":""}') === null, 'programme with no name is rejected');

console.log('\n== Build a course from a programme ==');
const resolve = (title) => { const c = catalog.find((x) => x.title === title); return c ? { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label } : null; };
const course = buildClassFromProgramme('n1', 'Monday Beginners', def, ['Amy', 'Bea', 'Cy'], resolve);
check(course.students.length === 3, `course built with 3 students (${course.students.length})`);
check(course.sessions.length === def.sessions.length, 'course has one session per programme session');
check(course.sessions[0].planned.length === def.sessions[0].calls.length, 'course session 1 planned calls match the programme');
check(course.sessions.every((s) => s.taught.length === 0 && Object.keys(s.attendance).length === 0), 'new course sessions start untaught with empty registers');
// A programme referencing an unknown call drops it but keeps the rest.
const withUnknown = parseProgramme(JSON.stringify({ name: 'X', level: 'ms', sessions: [{ name: 'S', calls: ['Circle Left', 'Not A Real Call'] }] }));
const c2 = buildClassFromProgramme('n2', 'X', withUnknown, [], resolve);
check(c2.sessions[0].planned.length === 1 && c2.sessions[0].planned[0].title === 'Circle Left', 'unknown calls are dropped when building a course');

console.log('\n=================');
if (failures === 0) console.log('TEACHER POC VERIFY PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
