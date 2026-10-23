// The interactive call player for the online edition.
//
// IT USES THE ENGINE DIRECTLY, the way the POC's Browse mode does: it loads `moves.xml`,
// `formations.xml` and the call's own XML, builds the call bundle, and evaluates poses with
// `allPoses(bundle, beat)` at whatever beat the reader has chosen. That is why the controls are
// real -- a GIF has no timeline and no controls at all, but the engine can be asked for the pose at
// ANY beat, so scrubbing is exact rather than interpolated, and the player cannot disagree with the
// figures because it is the same code that drew them.
//
// The board is drawn on a canvas rather than shipped as images: no per-frame files, no sprite
// sheets, and every frame is sharp at any device pixel ratio.
import {
  Engine,
  loadCallFromXml,
  allPoses,
  computeHandholds,
  sampleTrail,
  DANCER_WIDTH,
  DANCER_DEPTH,
} from '../lib/index.js';
import { C, NOSE_HALF_OF_SIDE, bodyShapeOf, bodySlot, bodySupport, displayIdOf, trailSlot, hexOf } from '../lib/board-style.js';

// THE PALETTE AND THE MARKER SIZE ARE NOT THIS FILE'S. `board-style.mjs` owns them, because the Node figures
// draw the same board and the two must not drift - it also carries the body the marker is drawn to, and the
// stays here is the CANVAS: how a pose becomes pixels in a browser.
const INK = hexOf(C.ink);
const FLOOR = hexOf(C.floor);
const GRID_MINOR = hexOf(C.gridMinor);
const GRID_MAJOR = hexOf(C.gridMajor);
const AXIS = hexOf(C.axis);

const BEATS_PER_SECOND = 128 / 60; // the program's standard tempo; speeds below slow it down

const colourOf = (i) => hexOf(bodySlot(i));
const trailOf = (i) => hexOf(trailSlot(i));

/**
 * The number drawn on a dancer, from couple and gender.
 *
 * NOT `dancer.id`: the engine's home ids put 1,2 on the NORTH couple (its couple 3) and 5,6 on the
 * SOUTH couple (couple 1), which is a rotation of the scheme a dancer reads off the floor, where the
 * couple with their backs to the caller is Couple 1 and is numbered first. Couple and gender are the
 * engine's own data, so this is a re-labelling, not an invented identity.
 */
const displayId = (d) =>
  d.couple && (d.gender === 'boy' || d.gender === 'girl')
    ? (d.couple - 1) * 2 + (d.gender === 'boy' ? 1 : 2)
    : null;

/**
 * Trim a line back to the marker edges, so a handhold is not a pair of very long arms. `r` is in
 * board units, the same as the positions. Below two radii the markers touch and there is no gap
 * left to fill, so the line is left alone rather than drawn backwards through the bodies.
 */
function drawBoard(ctx, size, view, state, beat) {
  const { scale, units } = view;
  const ox = size / 2;
  const oy = size / 2;
  const px = (x) => ox + x * scale;
  const py = (y) => oy - y * scale;

  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, size, size);

  const n = Math.ceil(units) + 1;
  ctx.lineWidth = 1;
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    ctx.strokeStyle = i % 2 === 0 ? GRID_MAJOR : GRID_MINOR;
    ctx.beginPath();
    ctx.moveTo(px(i), 0);
    ctx.lineTo(px(i), size);
    ctx.moveTo(0, py(i));
    ctx.lineTo(size, py(i));
    ctx.stroke();
  }
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(0), 0);
  ctx.lineTo(px(0), size);
  ctx.moveTo(0, py(0));
  ctx.lineTo(size, py(0));
  ctx.stroke();

  const fraction = state.beats > 0 ? beat / state.beats : 1;
  // THE BODY IS THE ENGINE'S, and the line widths follow it: a dancer is DANCER_WIDTH across the facing and
  // DANCER_DEPTH along it (`bodies.ts`), so `halfW` is the widest a body gets and what a trail must not swallow.
  const halfW = (DANCER_WIDTH / 2) * scale;
  const halfD = (DANCER_DEPTH / 2) * scale;
  const marker = halfW;
  ctx.lineWidth = Math.max(1.1, marker * 0.09);
  ctx.lineCap = 'round';
  state.trails.forEach((pts, i) => {
    const upTo = Math.max(1, Math.round(pts.length * fraction));
    ctx.strokeStyle = trailOf(i);
    ctx.beginPath();
    for (let k = 0; k < upTo; k++) {
      const p = pts[k];
      if (k === 0) ctx.moveTo(px(p.x), py(p.y));
      else ctx.lineTo(px(p.x), py(p.y));
    }
    ctx.stroke();
  });

  const t = Math.max(0, Math.min(state.beats, beat));
  const poses = allPoses(state.bundle, t);
  const holds = computeHandholds(poses, 'static') ?? [];
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, marker * 0.12);
  ctx.globalAlpha = 0.55;
  for (const h of holds) {
    const a = poses[h.i];
    const b = poses[h.j];
    if (!a || !b) continue;
    // A GRIP RUNS FROM BODY EDGE TO BODY EDGE, so each end is trimmed by that dancer's own support in the
    // direction of the other. One radius would leave a gap at a deep body and reach inside a wide one.
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    const ra = bodySupport(state.dancers[h.i].gender, theta - a.heading, DANCER_DEPTH / 2, DANCER_WIDTH / 2);
    const rb = bodySupport(state.dancers[h.j].gender, theta + Math.PI - b.heading, DANCER_DEPTH / 2, DANCER_WIDTH / 2);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > ra + rb)) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    ctx.beginPath();
    ctx.moveTo(px(a.x + ux * ra), py(a.y + uy * ra));
    ctx.lineTo(px(b.x - ux * rb), py(b.y - uy * rb));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const ink = Math.max(1, Math.min(1.4, marker / 13));

  state.dancers.forEach((d, i) => {
    const pose = poses[i];
    if (!pose) return;
    const cx = px(pose.x);
    const cy = py(pose.y);
    const colour = colourOf(i);

    // THE BODY IS THE ENGINE'S, drawn as the POC and the game draw it: a rectangle for a boy, an ellipse for a
    // girl, DANCER_WIDTH across the facing and DANCER_DEPTH along it, with a white half-disc nose on the front.
    // Board +y is north and canvas +y is down, so the facing (cos h, -sin h) is a canvas rotation of -h.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-pose.heading);
    ctx.beginPath();
    if (bodyShapeOf(d.gender) === 'ellipse') ctx.ellipse(0, 0, halfD, halfW, 0, 0, Math.PI * 2);
    else ctx.rect(-halfD, -halfW, 2 * halfD, 2 * halfW);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ink;
    ctx.stroke();
    // The nose is INSIDE the body (scene.ts's marker), so it cannot cover a neighbour and needs no two-pass order.
    const nose = halfW * NOSE_HALF_OF_SIDE;
    ctx.beginPath();
    ctx.arc(0, 0, nose, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // THE NUMBER STANDS OUTSIDE THE BODY, because a body 0.45 deep has no room for a legible digit. It is drawn
    // upright (outside the rotation) below the dancer and in ink, so it is readable at every facing.
    const num = displayIdOf(i);
    if (num) {
      ctx.fillStyle = INK;
      ctx.font = `bold ${Math.round(halfW * 0.85)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(num), cx, cy + halfW * 0.95);
    }
  });
}

async function mount(host) {
  const size = Number(host.dataset.size ?? 340);
  const firstFile = host.dataset.file;
  const firstTam = Number(host.dataset.tam ?? 0);
  let view = { scale: Number(host.dataset.scale), units: Number(host.dataset.units) };

  /**
   * THE START TABLE, as the manual gives it for this card: which formations the call starts from, and
   * which of its calls the manual lists from each -- for a ring, `Static Square` with Circle Left,
   * Circle Left 1/8, 1/4, 1/2, 3/4, Circle Right, and so on.
   *
   * `[{ label, calls: [[title, file, tamIndex, scale, units, beats]] }]`, written by build-site.mjs
   * from `book/tools/start-formations.json`. Switching reloads the call from the chosen authoring --
   * each entry is a different call or a different fraction of it, not another pose of the same
   * animation -- and re-fits the floor, because one that travels further is drawn on a wider view.
   */
  let table = [];
  try {
    const list = host.dataset.formations ? JSON.parse(host.dataset.formations) : null;
    if (Array.isArray(list)) table = list.filter((f) => f?.label && (f.calls ?? []).length);
  } catch {
    table = [];
  }

  const { moves, formations } = await engineInputs();
  const xmlCache = new Map();
  const bundleFor = async (file, tamIndex) => {
    let xml = xmlCache.get(file);
    if (xml === undefined) {
      xml = await fetch(new URL(`../assets/calls/${file}`, import.meta.url).href).then((r) => r.text());
      xmlCache.set(file, xml);
    }
    return loadCallFromXml(xml, moves, formations, tamIndex, true);
  };

  let bundle;
  let dancers;
  let beats;
  let state;
  /** Make one authoring the thing on screen. */
  const use = async (file, tamIndex, fit) => {
    bundle = await bundleFor(file, tamIndex);
    if (fit) view = { scale: fit.scale, units: fit.units };
    // NO HOME IDENTITY ON A PAGE: the start formation's own dancer order is the identity (board-style.mjs).
    dancers = bundle.dancers;
    beats = bundle.beats > 0 ? bundle.beats : 1;
    state = { bundle, dancers, beats, trails: bundle.dancers.map((d) => sampleTrail(d, 80)) };
  };
  await use(firstFile, firstTam, null);

  const canvas = document.createElement('canvas');
  canvas.width = size * (window.devicePixelRatio || 1);
  canvas.height = size * (window.devicePixelRatio || 1);
  canvas.style.width = '100%';
  canvas.style.maxWidth = `${size}px`;
  canvas.className = 'dsq-canvas';
  // One width for the canvas AND the controls, so the scrub slider shares edges with the board and
  // the readout's changing numbers cannot reflow the line the speed control sits on.
  host.style.setProperty('--dsq-size', `${size}px`);
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const bar = document.createElement('div');
  bar.className = 'dsq-controls';
  bar.innerHTML = `
    <button type="button" data-act="start" title="Starting setup">&#9198;</button>
    <button type="button" data-act="back" title="Back a quarter beat">&#9194;</button>
    <button type="button" data-act="play" title="Play or pause">&#9654;</button>
    <button type="button" data-act="forward" title="Forward a quarter beat">&#9193;</button>
    <button type="button" data-act="end" title="Ending setup">&#9197;</button>
    <input type="range" min="0" max="${beats}" step="0.02" value="0" aria-label="Beat">
    <span class="dsq-readout">beat 0.00 / ${beats.toFixed(2)}</span>
    <label class="dsq-speed">speed
      <select class="dsq-rate">
        <option value="0.25">1/4</option>
        <option value="0.5">1/2</option>
        <option value="1" selected>full</option>
      </select>
    </label>`;

  // ---- the two choosers, and the state they read.
  //
  // THE FORMATION CHOOSER says which of the formations the manual lists the call is being drawn from.
  // THE CALL CHOOSER then lists the calls the manual lists from THAT formation -- for a ring, Circle
  // Left, Circle Left 1/8, 1/4, 1/2, 3/4, Circle Right -- and choosing one draws it. Both come from
  // the card's own start table, so the page's text and the controls are about the same call.
  //
  // Built as a pair and referenced directly, never looked up afterwards: the first cut gave a chooser's
  // label and its select the same class, so `querySelector` found the LABEL and the options were
  // written into it with `innerHTML`, replacing the select. See makeChooser below.
  // THE HTML ESCAPE RULE, and this is the ONE copy in the book that cannot be shared: this file is copied
  // verbatim into the published site (`book/tools/build-site.mjs`'s `cpSync`) and runs in a browser with no
  // bundler, so it cannot import `book/tools/lib/escape.mjs`. Its character class must therefore match that
  // module's `escapeHtml` — `& < > " '` — and `poc/tools/escape-probe.mjs` reads this source and fails if it
  // drifts, which is the only way a gate can see a copy that ships as text.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fitOf = (call) =>
    Number.isFinite(Number(call[3])) && Number.isFinite(Number(call[4]))
      ? { scale: Number(call[3]), units: Number(call[4]) }
      : null;

  // WHICH ENTRY THE PAGE IS SHOWING, found by the authoring rather than assumed to be the first: a
  // card whose own animation is the second call of the second formation must open on that one.
  let fIndex = table.findIndex((f) => (f.calls ?? []).some((c) => c[1] === firstFile && Number(c[2] ?? 0) === firstTam));
  if (fIndex < 0) fIndex = 0;
  const callsIn = (i) => table[i]?.calls ?? [];
  let cIndex = Math.max(0, callsIn(fIndex).findIndex((c) => c[1] === firstFile && Number(c[2] ?? 0) === firstTam));

  /**
   * Build one chooser and hand back BOTH parts, rather than looking the select up afterwards.
   *
   * THAT IS NOT FASTIDIOUSNESS. The first cut put the label and its select in the same class and found
   * the select with `querySelector('.dsq-call')` -- which returns the LABEL, because it comes first in
   * the document. The options were then written into the label with `innerHTML`, replacing the select
   * itself: the "chooser" was a heading with a list of call names under it, and nothing could be
   * selected. The class is distinct now AND the reference is direct, so neither half of that mistake
   * can come back quietly.
   */
  const makeChooser = (className, selectClass, label, title) => {
    const pick = document.createElement('label');
    pick.className = `dsq-speed ${className}`;
    pick.append(`${label} `);
    const select = document.createElement('select');
    select.className = selectClass;
    select.title = title;
    pick.append(select);
    bar.append(pick);
    return { label: pick, select };
  };
  // Both are built whenever the table has anything at all, and each is HIDDEN while it would hold one
  // option: a selector with a single entry is noise. A card with one formation and eight calls still
  // needs the second chooser, which is why neither is conditional on the number of formations.
  const fromPick = table.length ? makeChooser('dsq-start', 'dsq-from', 'start', 'Which formation the call starts from') : null;
  const callPick = table.length ? makeChooser('dsq-call', 'dsq-call-select', 'call', 'Which call to watch from that formation') : null;

  host.append(canvas, bar);
  const slider = bar.querySelector('input');
  const readout = bar.querySelector('.dsq-readout');
  const playBtn = bar.querySelector('[data-act="play"]');
  const speedSel = bar.querySelector('.dsq-rate');
  const fromLabel = fromPick?.label ?? null;
  const callLabel = callPick?.label ?? null;
  const fromSel = fromPick?.select ?? null;
  const callSel = callPick?.select ?? null;

  let beat = 0;
  let playing = false;
  let last = 0;
  const speed = () => Number(speedSel.value);

  const show = (value) => {
    beat = Math.max(0, Math.min(beats, value));
    slider.value = String(beat);
    readout.textContent = `beat ${beat.toFixed(2)} / ${beats.toFixed(2)}`;
    drawBoard(ctx, size, view, state, beat);
  };

  const setPlaying = (on) => {
    playing = on;
    playBtn.innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
    if (on) {
      // Restart from the beginning when play is pressed at the end, so the button always plays
      // something rather than appearing to do nothing.
      if (beat >= beats - 0.001) show(0);
      last = performance.now();
      requestAnimationFrame(tick);
    }
  };

  const tick = (now) => {
    if (!playing) return;
    const dt = (now - last) / 1000;
    last = now;
    const next = beat + dt * BEATS_PER_SECOND * speed();
    if (next >= beats) {
      show(beats);
      setPlaying(false);
      return;
    }
    show(next);
    requestAnimationFrame(tick);
  };

  bar.addEventListener('click', (ev) => {
    const act = ev.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'play') setPlaying(!playing);
    else if (act === 'start') { setPlaying(false); show(0); }
    else if (act === 'end') { setPlaying(false); show(beats); }
    else if (act === 'back') { setPlaying(false); show(beat - 0.25); }
    else if (act === 'forward') { setPlaying(false); show(beat + 0.25); }
  });
  slider.addEventListener('input', () => {
    setPlaying(false);
    show(Number(slider.value));
  });
  speedSel.addEventListener('change', () => {
    last = performance.now();
  });
  fromSel?.addEventListener('change', () => {
    fIndex = Number(fromSel.value);
    cIndex = 0; // the first call the manual lists from the newly chosen formation
    void switchTo();
  });
  callSel?.addEventListener('change', () => {
    cIndex = Number(callSel.value);
    void switchTo();
  });

  /** Rebuild both choosers from the current state. They are never edited in place. */
  const renderChoosers = () => {
    if (fromLabel) {
      fromLabel.hidden = table.length < 2;
      fromSel.innerHTML = table
        .map((f, i) => `<option value="${i}"${i === fIndex ? ' selected' : ''}>${esc(f.label)}</option>`)
        .join('');
    }
    if (callLabel) {
      const calls = callsIn(fIndex);
      callLabel.hidden = calls.length < 2;
      callSel.innerHTML = calls
        .map((c, i) => `<option value="${i}"${i === cIndex ? ' selected' : ''}>${esc(c[0])}</option>`)
        .join('');
    }
  };

  /** Make the call now selected the thing on screen. */
  const switchTo = async () => {
    const call = callsIn(fIndex)[cIndex];
    if (!call) return;
    setPlaying(false);
    try {
      await use(call[1], Number(call[2] ?? 0), fitOf(call));
    } catch (err) {
      // Say so in the page rather than leaving the old animation under a new label.
      host.innerHTML = `<p class="dsq-error">Could not load ${esc(call[0])}: ${String(err.message ?? err)}</p>`;
      console.error(err);
      return;
    }
    slider.max = String(beats);
    renderChoosers();
    show(0);
  };

  show(0);
  renderChoosers();
}

for (const host of document.querySelectorAll('.dsq-player')) {
  mount(host).catch((err) => {
    // Report the failure in the page: a player that silently does nothing looks like a broken book.
    host.innerHTML = `<p class="dsq-error">Could not load this animation: ${String(err.message ?? err)}</p>`;
    console.error(err);
  });
}
