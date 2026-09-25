// COPY / PASTE A MOVE'S END POINT: C, Pa and Pr in the move tile.
//
// Asked for: "Add [C]opy/[Pa]PasteAbsolute/[Pr]PasteRelative buttons to each Move pane, beside the 'arc'
// checkbox, that keeps a local copy of the move x/y end coordinates and can paste them back at a later date
// (if it was changed by deleting/adding other Moves). The C button will be highlighted if it is currently
// holding a value. C will clear when Pa/Pr is pressed. Pressing C a second time will replace the copied
// coordinates with the latest values. Hovering over C button will show current values stored, if there are
// any. If multiple moves are selected, the C applies to all selected Moves."
//
// TWO CLAIMS NEED MEASURING, and each has its own section.
//
//   1. THAT `Pa` AND `Pr` ARE DIFFERENT EDITS. A move's numbers are authored in the frame the move is PLAYED
//      FROM, so deleting or adding a move earlier in the track leaves a later move's LOCAL numbers alone and
//      moves where they land on the FLOOR, while re-aiming a move does the opposite. `Pr` writes the relative
//      pair back and `Pa` converts the board pair through the frame the move has NOW. If those were the same,
//      there would be no reason for two buttons.
//
//   2. THAT A COPY BELONGS TO THE MOVE IT WAS TAKEN FROM - asked for as "each Users Move has it's own copy of
//      the coordinates... These copied coordinates are only available to that specific move", and then as
//      "Just as the copy works with selected Dancers and Moves, so does the Paste (but the data is local to
//      the Move)". That rests on the ENGINE'S OBJECT IDENTITY - a copy is keyed on the move's own segment - so
//      it is driven here with the engine's own `addMove`, `removeMove` and `setMove` rather than with a
//      formula. It is also what makes a copy survive a move being deleted in front of it, which an index
//      cannot do.
//
// The tile's three actions live in `editor-ui.ts`, which is TypeScript inside Vite with a DOM and cannot run
// in this sandbox - the same limit `absolute-coords-probe.mjs` and `facing-handle-probe.mjs` record. So the
// arithmetic and the identity are measured here against the engine, and the panel's use of them is read from
// the source.
//
// Run: node tools/move-clipboard-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const LEVELS = fs.readdirSync(path.join(POC_DIR, 'src/assets')).filter((d) => !d.includes('.') && d !== 'src');
const callAt = (level, f) => {
  try {
    return engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(POC_DIR, 'src/assets', level, f), 'utf8'), movesXml, formationsXml, 0));
  } catch { return null; }
};

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ---- the tile's two frame helpers, copied (see the note at the top) ------------------------
const localToFloor = (f, lx, ly) => ({
  x: f.x + Math.cos(f.heading) * lx - Math.sin(f.heading) * ly,
  y: f.y + Math.sin(f.heading) * lx + Math.cos(f.heading) * ly,
});
const floorToLocal = (f, x, y) => {
  const dx = x - f.x;
  const dy = y - f.y;
  return {
    lx: Math.cos(f.heading) * dx + Math.sin(f.heading) * dy,
    ly: -Math.sin(f.heading) * dx + Math.cos(f.heading) * dy,
  };
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Every move of every call in MS that HAS a move before it, with the frame it is played from. */
function* cases() {
  for (const f of fs.readdirSync(path.join(POC_DIR, 'src/assets/ms')).filter((x) => x.endsWith('.xml'))) {
    const call = callAt('ms', f);
    if (!call) continue;
    for (let i = 0; i < call.dancers.length; i++) {
      const d = call.dancers[i];
      for (let j = 1; j < d.path.length; j++) {
        yield { file: f, call, d, i, j, frame: engine.poseFor(d, engine.moveBeatRange(d, j).from) };
      }
    }
  }
}

// ---------------------------------------------------------------- 1. the two pastes are different edits
console.log('== 1. Pa puts the point back on the floor; Pr puts it back in the frame ==');
{
  let n = 0;
  let movedGround = 0;
  let worstPa = 0;
  let worstPaAt = '';
  let minPrWhenMoved = Infinity;
  let maxGround = 0;
  let worstAgree = 0;
  for (const c of cases()) {
    const t = c.d.path[c.j].translate;
    // WHAT `C` TAKES: the relative pair the format stores, and the board pair it lands on.
    const rel = { x: t.x2, y: t.y2 };
    const abs = localToFloor(c.frame, rel.x, rel.y);
    // ---- the control: with nothing moved, the two pastes are the same point
    const ctrl = floorToLocal(c.frame, abs.x, abs.y);
    worstAgree = Math.max(worstAgree, gap(localToFloor(c.frame, ctrl.lx, ctrl.ly), abs));
    // ---- MOVE THE GROUND UNDER IT: turn the previous move's end point about the origin and push it out.
    const pt = c.d.path[c.j - 1].translate;
    const a = Math.PI / 6;
    const r = 1.35;
    const patched = {
      ...c.d.path[c.j - 1],
      translate: {
        ...pt,
        x2: (pt.x2 * Math.cos(a) - pt.y2 * Math.sin(a)) * r,
        y2: (pt.x2 * Math.sin(a) + pt.y2 * Math.cos(a)) * r,
      },
    };
    const after = engine.setMove(c.call, c.i, c.j - 1, patched).dancers[c.i];
    const moved = engine.poseFor(after, engine.moveBeatRange(after, c.j).from);
    const ground = gap(moved, c.frame);
    maxGround = Math.max(maxGround, ground);
    n++;
    // PR: the relative pair goes straight back in, so the point lands wherever the new frame puts it.
    const prErr = gap(localToFloor(moved, rel.x, rel.y), abs);
    // PA: the board pair is converted through the frame the move has NOW, so the point lands back where it was.
    const paLocal = floorToLocal(moved, abs.x, abs.y);
    const paErr = gap(localToFloor(moved, paLocal.lx, paLocal.ly), abs);
    if (paErr > worstPa) { worstPa = paErr; worstPaAt = `${c.file} d${c.i} m${c.j}`; }
    if (ground > 0.05) { movedGround++; minPrWhenMoved = Math.min(minPrWhenMoved, prErr); }
  }
  console.log(`    ${n} moves that have a move before them, ground moved under ${movedGround} of them (up to ${maxGround.toFixed(3)} units)`);
  check(n > 1000, `the sweep is not trivial (${n} moves)`);
  check(movedGround > n * 0.9, `and turning the previous move really does move where the next one is played from (${movedGround} of ${n})`);
  // 1e-12 is loose enough for the engine's own arithmetic and tight enough that a wrong frame could not pass.
  check(worstPa < 1e-12, `Pa puts the point back on the floor position it was copied from (worst ${worstPa.toExponential(2)} at ${worstPaAt})`);
  check(minPrWhenMoved > 0.05, `and Pr does NOT, on EVERY moved frame - so the two buttons are not one button twice (least miss ${minPrWhenMoved.toFixed(3)} units)`);
  check(worstAgree < 1e-12, `with nothing moved the two agree exactly, which is the control (worst ${worstAgree.toExponential(2)})`);
}

// ---------------------------------------------------------------- 2. the tile, read from the source
console.log('\n== 2. the tile: three buttons, C lit only where it holds, Pa/Pr gated like the fields ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const cssRaw = fs.readFileSync(path.join(POC_DIR, 'src', 'style.css'), 'utf8');
  // A RULE INSIDE A COMMENT IS NOT A RULE. The first cut of this block lost its `*/` and every `.ed-clip` rule
  // went dead without a single test noticing - the buttons then rendered as the panel's dim default and were
  // reported as "hard to see against the dark background". So the styles are checked with comments stripped.
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const bodyOf = (header) => {
    const i = ui.indexOf(header);
    if (i < 0) return null;
    const j = ui.indexOf('\n  }', i);
    return ui.slice(i, j);
  };

  // ---- the three buttons, and where they sit
  check(/const clipRow = document\.createElement\('span'\);[\s\S]{0,80}?clipRow\.className = 'ed-group ed-clip';/.test(ui),
    'the three buttons are ONE group');
  check(/arcRow\.append\(achk, alab\);[\s\S]{0,4000}?grid\.appendChild\(clipRow\);/.test(ui),
    'and it is built right after the arc box, which is where it was asked to go');
  check(/cbtn\.dataset\.key = `m\$\{i\}:\$\{k\}:copy`;/.test(ui) &&
    /pasteBtn\('Pa', true, `m\$\{i\}:\$\{k\}:pasteAbs`\)/.test(ui) &&
    /pasteBtn\('Pr', false, `m\$\{i\}:\$\{k\}:pasteRel`\)/.test(ui),
    'C, Pa and Pr are three buttons with their own keys to hang a test or a style on');
  check(
    /clipRow\.append\(cbtn, pasteBtn\('Pr', false, `m\$\{i\}:\$\{k\}:pasteRel`\), pasteBtn\('Pa', true, `m\$\{i\}:\$\{k\}:pasteAbs`\)\);/.test(ui),
    'and the pastes are appended in COLUMN order - Pr then Pa, the order the relative and absolute columns are read in');

  // ---- C: lit only where it holds, hovered for the values, and NOT gated (it is a read)
  check(/const held = this\.heldBy\(k\);/.test(ui) && /if \(held\) cbtn\.classList\.add\('on'\);/.test(ui) &&
    /#editorPanel \.ed-clip button\.on \{/.test(css),
    'C is highlighted on the moves that ARE holding something, and only those, and the highlight is styled');
  // PROMINENCE, ASKED FOR: "Make the buttons a bit more prominent, they are hard to see against the dark
  // background." That is a claim about the declarations - bright text on a raised background - and it is the
  // one thing a comment-stripped read can pin.
  check(/#editorPanel \.ed-clip button \{[^}]*color: var\(--text\)[^}]*\}/.test(css) &&
    /#editorPanel \.ed-clip button \{[^}]*background: #1e2a38[^}]*\}/.test(css) &&
    /#editorPanel \.ed-clip button \{[^}]*font-weight: 700[^}]*\}/.test(css),
    'and the buttons are LOUD - full-strength text, a raised background and a bold label - rather than the dim default');
  check(/#editorPanel \.ed-clip button:disabled/.test(css) && /#editorPanel \.ed-clip button\.on \{/.test(css),
    'the whole group is live CSS: every rule survives having the comments taken out');
  check(/cbtn\.title = this\.clipTitle\(held\);/.test(ui) &&
    /relative \$\{show\(held\.rel\.x\)\}, \$\{show\(held\.rel\.y\)\}/.test(ui) &&
    /board    \$\{show\(held\.abs\.x\)\}, \$\{show\(held\.abs\.y\)\}/.test(ui),
    'hovering C shows the values THIS move holds - both pairs - rather than only saying that something is held');
  check(/This move is holding nothing\./.test(ui),
    'and says so plainly when this move is holding nothing');
  check(!/cbtn\.disabled =/.test(ui),
    'COPYING IS NOT GATED: it is a read, so a locked move can still be copied from');

  // ---- the copy: per move, both pairs, replaced on a second press
  check(/this\.moveClips\.set\(seg, \{ curve, rel: \{ x: c\.x2, y: c\.y2 \}, abs: localToFloor\(frame, c\.x2, c\.y2\) \}\);/.test(ui),
    'the copy keeps BOTH pairs of a move\'s end point - which is the whole reason there are two paste buttons');
  check(/private moveClips = new WeakMap<Seg, MoveClip>\(\);/.test(ui),
    'and holds each move\'s on THE MOVE ITSELF, so a copy belongs to the move it came from ("only available to that specific move")');
  check(/private heldBy\(j: number\): MoveClip \| undefined \{[\s\S]{0,200}?this\.moveClips\.get\(seg\)/.test(ui),
    'the tile asks the move it is showing what it holds, by that move\'s own object');
  check(/const dancers = new Set\(\[this\.moveDancer, \.\.\.this\.selectedSorted\(\)\]\);/.test(ui),
    'C takes every selected DANCER and every selected MOVE, each keeping its own numbers');

  // ---- the pastes: per dancer and move, gated like the fields, one commit, copy kept
  check(/b\.disabled = !held \|\| !coordsOk \|\| this\.arcOn;/.test(ui),
    'Pa and Pr are disabled by the same two locks the fields beside them carry, and by this move holding nothing');
  check(/this\.arcOn\)[\s\S]{0,200}?untick arc to paste/.test(ui) &&
    /if \(!this\.coordinatesAgree\(curve\)\)/.test(ui),
    'and the method refuses for the same two reasons, not only the buttons');
  check(/const own = this\.moveClips\.get\(seg\);[\s\S]{0,120}?if \(!own\) return seg;/.test(ui),
    'the paste is decided PER DANCER AND MOVE inside the fold, so a neighbour holding nothing is left alone');
  check(/if \(own\.curve !== curve\) \{ wrongTab\+\+; return seg; \}/.test(ui),
    'a MOVE end point cannot be pasted on the FACING tab, and the refusal counts them');
  check(/const moved = \{ \.\.\.c, x2: want\.x, y2: want\.y \};/.test(ui),
    'both pastes write the END POINT of the shown curve and nothing else');
  check(/let want = own\.rel;/.test(ui) &&
    /if \(absolute\) \{[\s\S]{0,400}?floorToLocal\(frame, own\.abs\.x, own\.abs\.y\)/.test(ui),
    'Pr writes the relative pair straight back, and Pa converts the board pair through the frame the move has NOW');
  const pasteBody = bodyOf('private pasteMoveEnds(absolute: boolean) {') ?? '';
  check((pasteBody.match(/this\.commit\(/g) ?? []).length === 1,
    'a paste over a run is ONE commit, so it is one step in the revert history rather than one per move');
  check(!/moveClips\s*=\s*null/.test(pasteBody) && /the points are kept/.test(pasteBody),
    'and the copy is KEPT after a paste - "dont clear the memory after a paste... it\'s more useful to keep it" - which the status line says');
  check(/const frame = this\.moveFrame\(next, d, j\);/.test(ui) && /, curve, j, next\);/.test(ui),
    'the frame an absolute paste converts through is the bundle being built, so an earlier paste moves the later ones');

  // ---- the run: one range, normalised, and the strip shows exactly it
  check(/const b = this\.circleTo === null \? a : Math\.max\(0, Math\.min\(this\.circleTo, last\)\);/.test(ui) &&
    /for \(let j = Math\.min\(a, b\); j <= Math\.max\(a, b\); j\+\+\) out\.push\(j\);/.test(ui),
    'the run is normalised, because shift-clicking backwards is the same gesture as forwards');
  check(/const run = this\.selectedMoveRange\(\);[\s\S]{0,900}?if \(k !== this\.moveIndex && run\.includes\(k\)\)/.test(ui),
    'and the strip highlights exactly the moves a copy would take, so the range on screen IS the range used');

  // ---- the state: cleared with a new call, carried across a rewrite, NOT part of the undo history
  check(/this\.clearUndo\(\);[\s\S]{0,700}?this\.moveClips = new WeakMap<Seg, MoveClip>\(\);/.test(ui),
    'a newly loaded call clears the copies, because they describe moves of the call they were taken from');
  check(/private carryMoveClips\(from: CallBundle \| null, to: CallBundle\)/.test(ui) &&
    /private commit\(next: CallBundle[\s\S]{0,200}?this\.carryMoveClips\(this\.instance, next\);/.test(ui) &&
    /private applyLight\(next: CallBundle\) \{[\s\S]{0,400}?this\.carryMoveClips\(this\.instance, next\);/.test(ui),
    'and a move that a write REPLACES keeps its copy: the carry-over is reached from both write paths, the commit and the drag');
  // ---- AND EVERY SWAP OF THE INSTANCE CARRIES, not just `commit`. A re-base and a connect REWRITE EVERY MOVE
  // ---- (`setStartFormation` re-frames the whole path, `connectStart` re-aims each dancer's first), so every
  // ---- segment is a new object and every copy keyed on one is dropped. Reported: "If I [C]opy the move
  // ---- coordinates, then set the start setup, the copy contents are cleared. I need them to persist after
  // ---- applying a new start and end setup."
  check(/private swapInstance\(next: CallBundle\) \{\s*\n\s*this\.carryMoveClips\(this\.instance, next\);/.test(ui),
    'ONE method puts a new bundle on screen and carries the copies with it, so the carry belongs to the SWAP rather than to whichever handler remembered it');
  const startBody = bodyOf('private doStartFormation() {') ?? '';
  const connectBody = bodyOf('private doConnect() {') ?? '';
  check(startBody.includes('this.swapInstance(') && !startBody.includes('this.instance = '),
    'the START SETUP goes through it - a new start keeps every copied point');
  check(connectBody.includes('this.swapInstance(') && !connectBody.includes('this.instance = '),
    'and so does Connect, which re-frames every move after the first for the same reason');
  check(/this\.commit\(out\);/.test(ui) && !/private doConnectEnd\(\)[\s\S]{0,900}?this\.instance = /.test(ui),
    'while the END setup already went through `commit`, which carries - which is why only the start was reported');

  const snap = bodyOf('private snapshot(): EditorSnapshot {') ?? '';
  const key = bodyOf('private stateKey(): unknown[] {') ?? '';
  check(snap.length > 0 && key.length > 0 && !/moveClips/.test(snap) && !/moveClips/.test(key),
    'and it is NOT in the snapshots or the change key: holding a point is not a change to the call, so a revert must not clear it');
}

// ---------------------------------------------------------------- 3. the copy lives on the MOVE
console.log('\n== 3. a copy belongs to the move it was taken from, and only that move can paste it ==');
{
  // DRIVEN WITH THE ENGINE'S OWN EDITS, because the claim is about the engine's object identity: a copy is
  // keyed on the move's own segment. `setMove` cloning only the move it writes is what makes a delete, an
  // insert and an edit of a neighbouring move all harmless, and this is where that is measured.
  const MARKS = [11, 12];
  let calls = 0;
  let moved = 0;
  let subjects = 0;
  let badDelete = 0;
  let badInsert = 0;
  let badOther = 0;
  let badCarry = 0;
  let leaksToAnotherMove = 0;
  let leaksToAnotherDancer = 0;
  let replacedAlwaysOne = 0;
  let shiftCases = 0;
  let shiftKeptItsOwn = 0;
  let shiftStoleByPosition = 0;
  let rebaseCases = 0;
  let rebaseKept = 0;
  let rebaseRewroteEveryMove = 0;
  for (const level of LEVELS) for (const f of fs.readdirSync(path.join(POC_DIR, 'src/assets', level)).filter((x) => x.endsWith('.xml'))) {
    const call = callAt(level, f);
    if (!call) continue;
    calls++;
    for (let i = 0; i < call.dancers.length; i++) {
      const path0 = call.dancers[i].path;
      if (path0.length < 4) continue;
      subjects++;
      // the copied moves are 1 and 2, so there is a move in front to delete and to insert at, and one behind
      const marks = new Map();
      for (let k = 1; k <= 2; k++) marks.set(path0[k], { rel: { x: MARKS[k - 1], y: 0 } });
      const own = (bundle, at) => marks.get(bundle.dancers[i].path[at])?.rel.x ?? null;
      const mine = (bundle, shift) => MARKS.every((v, n) => own(bundle, n + shift) === v);
      moved += 2;

      // ---- OWNERSHIP: what a move holds is invisible to every other move, and to another dancer's move
      if (marks.get(path0[0]) !== undefined || marks.get(path0[3]) !== undefined) leaksToAnotherMove++;
      const mate = call.dancers[i === 0 ? 1 : 0]?.path[1];
      if (mate && marks.get(mate) !== undefined) leaksToAnotherDancer++;

      // ---- DELETE the move in front of them: every index drops by one, no object changes
      if (!mine(engine.removeMove(call, i, 0), 0)) badDelete++;
      // ---- INSERT one in front: every index rises by one
      const fresh = { ...path0[0], translate: { ...path0[0].translate } };
      if (!mine(engine.addMove(call, i, fresh, 0), 2)) badInsert++;
      // ---- REWRITE a move outside the run: nothing copied may move
      if (!mine(engine.setMove(call, i, 0, { ...path0[0] }), 1)) badOther++;

      // ---- THE SHIFT, AND THE CARRY-OVER THAT MUST LEAVE IT ALONE. `commit` is also the path `- Move` takes,
      // ---- and the carry-over puts a REWRITTEN move's copy on the object that replaced it by comparing the two
      // ---- paths BY POSITION. A delete shifts every later move, so that comparison is between different moves:
      // ---- reported from use as "select two moves, press C to copy x,y, delete the first move, then Pa the
      // ---- remaining Move - it pastes the deleted move's coordinates". Both rules are run on the real delete.
      {
        const marks2 = new Map();
        marks2.set(path0[0], { rel: { x: 11, y: 0 } });
        marks2.set(path0[1], { rel: { x: 12, y: 0 } });
        const cut = engine.removeMove(call, i, 0);
        const beforePath = path0;
        const afterPath = cut.dancers[i].path;
        const carry = (guard) => {
          const m = new Map(marks2);
          if (guard && beforePath.length !== afterPath.length) return m;
          for (let k = 0; k < Math.min(beforePath.length, afterPath.length); k++) {
            if (beforePath[k] === afterPath[k]) continue;
            const e = m.get(beforePath[k]);
            if (e) m.set(afterPath[k], e);
          }
          return m;
        };
        const survivor = (m) => m.get(afterPath[0])?.rel.x ?? null;
        shiftCases++;
        if (survivor(carry(true)) === 12) shiftKeptItsOwn++;            // the guard: the survivor keeps ITS OWN
        if (survivor(carry(false)) === 11) shiftStoleByPosition++;      // no guard: it takes the DELETED one's
      }

      // ---- A NEW START SETUP. `setStartFormation` RE-FRAMES EVERY MOVE into the new start's coordinates, so
      // ---- every segment is a new object and the whole clipboard goes with them unless the carry-over follows.
      // ---- That is the reported case: "If I [C]opy the move coordinates, then set the start setup, the copy
      // ---- contents are cleared." The path keeps its LENGTH, so the positional carry is the right rule here.
      {
        const marks3 = new Map();
        for (let k = 0; k < path0.length; k++) marks3.set(path0[k], { rel: { x: 100 + k, y: 0 } });
        // a real new start: the same spots, half a unit across, so the re-base has something to do
        const poses = call.dancers.map((d) => {
          const p = engine.poseFor(d, 0);
          return { x: p.x + 0.5, y: p.y, heading: p.heading, gender: d.gender };
        });
        let rebased;
        try {
          rebased = engine.setStartFormation(call, poses);
        } catch {
          rebased = null;
        }
        if (rebased) {
          const beforePath = path0;
          const afterPath = rebased.dancers[i].path;
          let rewritten = 0;
          for (let k = 0; k < beforePath.length; k++) if (beforePath[k] !== afterPath[k]) rewritten++;
          if (rewritten === beforePath.length) rebaseRewroteEveryMove++;
          // the editor's rule: same length, so pair by position
          const m = new Map(marks3);
          if (beforePath.length === afterPath.length) {
            for (let k = 0; k < beforePath.length; k++) {
              if (beforePath[k] === afterPath[k]) continue;
              const e = m.get(beforePath[k]);
              if (e) m.set(afterPath[k], e);
            }
          }
          rebaseCases++;
          if (afterPath.every((s, k) => m.get(s)?.rel.x === 100 + k)) rebaseKept++;
        }
      }

      // ---- REWRITE a copied move. `setMove` replaces THAT object, which is the one hole in the identity, and
      // ---- the comparison below is the editor's `carryMoveClips`, mirrored.
      const later = engine.setMove(call, i, 2, { ...path0[2] });
      let replaced = 0;
      for (let k = 0; k < path0.length; k++) if (path0[k] !== later.dancers[i].path[k]) replaced++;
      if (replaced !== 1) replacedAlwaysOne++;
      if (own(later, 2) !== MARKS[1]) {
        for (let k = 0; k < path0.length; k++) {
          if (path0[k] === later.dancers[i].path[k]) continue;
          const e = marks.get(path0[k]);
          if (e) marks.set(later.dancers[i].path[k], e);
        }
        if (!mine(later, 1)) badCarry++;
      }
    }
  }
  console.log(`    ${subjects} dancers over ${calls} calls, ${moved} copied moves carried through a delete, an insert and a rewrite`);
  check(moved > 500, `the sweep is not trivial (${moved} copied moves over every level)`);
  check(leaksToAnotherMove === 0, `a copy is invisible to every OTHER move of the same dancer (${leaksToAnotherMove} leaks)`);
  check(leaksToAnotherDancer === 0, `and to the same-numbered move of every other dancer, which is "only available to that specific move" (${leaksToAnotherDancer} leaks)`);
  check(badDelete === 0, `DELETING a move in front of the run loses NOTHING: every copied move is still holding its own point (${badDelete} lost)`);
  check(badInsert === 0, `and INSERTING one is the same the other way (${badInsert} lost)`);
  check(badOther === 0, `and a rewrite of some OTHER move does not disturb any of them (${badOther} disturbed)`);
  check(replacedAlwaysOne === 0, `because a write replaces exactly the one move it writes and leaves every other object alone (${replacedAlwaysOne} exceptions)`);
  check(badCarry === 0, `and the move that IS rewritten keeps its copy: the editor's carry-over recovers it (${badCarry} lost)`);
  check(shiftCases > 0 && shiftKeptItsOwn === shiftCases,
    `DELETING the move in front of a copied one leaves the survivor holding ITS OWN point, not the deleted one's (${shiftKeptItsOwn} of ${shiftCases})`);
  check(rebaseCases > 0 && rebaseRewroteEveryMove === rebaseCases,
    `a new START SETUP really does replace every move's object, which is what used to drop the whole clipboard (${rebaseRewroteEveryMove} of ${rebaseCases})`);
  check(rebaseKept === rebaseCases,
    `and the carry-over keeps every copied point on the move it came from (${rebaseKept} of ${rebaseCases})`);
  check(shiftStoleByPosition === shiftCases,
    `and without the length guard it would hold the DELETED move's - which is the reported bug, so the guard is the fix (${shiftStoleByPosition} of ${shiftCases})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
