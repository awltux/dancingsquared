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
  setProblem,
  rollMissedCallsForward,
  rollPrioritisedForward,
  archivedNote,
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

console.log('\n== No duplicate call-positions within a session ==');
const key = (r) => `${r.title}#${r.setupIdx}`;
// pullForward must not pull a call-position already present in this session.
const dupPull = structuredClone(emptyTaught);
dupPull.sessions[1].planned.push(dupPull.sessions[2].planned[0]); // already present in current
pullForward(dupPull, 1, 5);
const k1 = dupPull.sessions[1].planned.map(key);
check(new Set(k1).size === k1.length, 'pullForward does not duplicate a call-position within a session');
// move-plan-to-next must dedupe the next session's plan.
const dupRoll = structuredClone(emptyTaught);
dupRoll.sessions[1].planned.push(dupRoll.sessions[0].planned[0]); // next already has it
rollUntaughtForward(dupRoll, 0);
const k2 = dupRoll.sessions[1].planned.map(key);
check(new Set(k2).size === k2.length, 'move plan to next dedupes the next session plan');
// building a course from a programme with duplicate calls dedupes each plan.
const pDup = parseProgramme(JSON.stringify({ name: 'D', level: 'ms', sessions: [{ name: 'S', calls: ['Circle Left', 'Circle Left'] }] }));
const resolveLocal = (t) => { const c = catalog.find((x) => x.title === t); return c ? { title: c.title, level: c.level, setupIdx: 0, setup: c.setups[0].label } : null; };
const cd = buildClassFromProgramme('x', 'X', pDup, [], resolveLocal);
check(cd.sessions[0].planned.length === 1, 'programme with duplicate calls builds a deduped plan');

console.log('\n== Prioritised call-setups (setProblem) ==');
const pc = structuredClone(emptyTaught);
pc.sessions[0].problems = [];
const first = pc.sessions[0].planned[0];
const has = () => pc.sessions[0].problems.some((p) => p.title === first.title && p.setupIdx === first.setupIdx);
setProblem(pc, 0, first.title, first.setupIdx, 5, 'heads struggle', true);
const added = pc.sessions[0].problems.find((p) => p.title === first.title);
check(has() && added.priority === 5 && added.note === 'heads struggle', 'setProblem adds a prioritised call-setup with priority + note');
setProblem(pc, 0, first.title, first.setupIdx, 2, 'improving', true);
const upd = pc.sessions[0].problems.find((p) => p.title === first.title);
check(has() && upd.priority === 2 && upd.note === 'improving', 'setProblem updates priority + note');
setProblem(pc, 0, first.title, first.setupIdx, 3, '', false);
check(!has(), 'setProblem removes the prioritised call-setup');
// Removing keeps the note in the archive for future re-prioritisation.
check(archivedNote(pc, 0, first.title, first.setupIdx) === 'improving', 'removed priority note is kept in the archive');
setProblem(pc, 0, first.title, first.setupIdx, 4, '', true);
check(pc.sessions[0].problems.some((p) => p.title === first.title), 'call-setup can be re-prioritised after removal');

console.log('\n== Carry missed calls forward (re-teach for absent dancers) ==');
const missCls = structuredClone(emptyTaught);
// Session 0: Carol (id 3) is absent; teach 2 calls in session 0.
missCls.sessions[0].taught = [missCls.sessions[0].planned[0], missCls.sessions[0].planned[1]];
missCls.sessions[0].attendance = { a: true, b: true, c: false, d: true };
const moved = rollMissedCallsForward(missCls, 0);
check(moved === 2, `carried ${moved} taught calls to the next session (expected 2)`);
check(missCls.sessions[1].planned.some((r) => r.title === missCls.sessions[0].planned[0].title), 'a taught call was added to the next session plan');
const missNote = missCls.sessions[1].problems.find((p) => p.title === missCls.sessions[0].planned[0].title);
check(missNote != null && /Carol/.test(missNote.note ?? ''), `next session has a priority note naming the absentee (${missNote?.note})`);
// No absent dancers -> nothing carried.
const allHere = structuredClone(emptyTaught);
allHere.sessions[0].taught = [allHere.sessions[0].planned[0]];
allHere.sessions[0].attendance = { a: true, b: true, c: true, d: true };
check(rollMissedCallsForward(allHere, 0) === 0, 'no calls carried when everyone attended');
// Carry from the last session creates a new session.
const lastMiss = structuredClone(emptyTaught);
const li = lastMiss.sessions.length - 1;
lastMiss.sessions[li].taught = [lastMiss.sessions[li].planned[0]];
lastMiss.sessions[li].attendance = { a: false, b: true, c: true, d: true };
const beforeSess = lastMiss.sessions.length;
rollMissedCallsForward(lastMiss, li);
check(lastMiss.sessions.length === beforeSess + 1, 'carrying from the last session creates a new one');

console.log('\n== Auto-carry prioritised calls to next session ==');
const pr = structuredClone(emptyTaught);
pr.sessions[0].problems = [{ title: pr.sessions[0].planned[0].title, setupIdx: pr.sessions[0].planned[0].setupIdx, priority: 5, note: 'heads struggle' }];
const prioMoved = rollPrioritisedForward(pr, 0);
check(prioMoved === 1, `carried ${prioMoved} prioritised call(s) to the next session (expected 1)`);
check(pr.sessions[1].planned.some((r) => r.title === pr.sessions[0].planned[0].title), 'prioritised call added to the next session plan');
const prNote = pr.sessions[1].problems.find((p) => p.title === pr.sessions[0].planned[0].title);
check(prNote != null && prNote.priority === 5, `prioritised call carried with its priority (pri ${prNote?.priority})`);
// No prioritised calls -> nothing carried.
const prNone = structuredClone(emptyTaught);
prNone.sessions[0].problems = [];
check(rollPrioritisedForward(prNone, 0) === 0, 'nothing carried when no calls are prioritised');

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

// Per-call probability weighting is accepted and tips still only use available calls.
const probTips = generateTips(availSeq, available, priority, {
  minLen: 3,
  maxLen: 6,
  count: 1,
  config: { repeatProb: 1, priorityProb: 1, currentProb: 1, prevProb: 1 },
  current: currentSet,
  callProb: (t) => (available.has(t) ? 1 : 0),
  rand: () => 0,
});
check(Array.isArray(probTips) && probTips.every((tip) => tip.every((t) => available.has(t))), 'per-call callProb option is accepted and tips only use available calls');

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
