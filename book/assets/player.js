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
  assignHomeIdentity,
} from '../lib/index.js';

const COUPLE_COLOUR = { 1: '#b2182b', 2: '#2166ac', 3: '#1b7837', 4: '#8c6d1f' };
const TRAIL_COLOUR = { 1: '#eac2c8', 2: '#b8d0e2', 3: '#bad9c0', 4: '#ded2ac' };
const BOY = '#1f6f8b';
const GIRL = '#8a3f6b';
const INK = '#22303a';
const FLOOR = '#f7f9fa';
const GRID_MINOR = '#e4e9ec';
const GRID_MAJOR = '#cdd6db';
const AXIS = '#9fadb5';

const BEATS_PER_SECOND = 128 / 60; // the program's standard tempo; speeds below slow it down

const colourOf = (d) => (d.couple && COUPLE_COLOUR[d.couple]) || (d.gender === 'girl' ? GIRL : BOY);
const trailOf = (d) => (d.couple && TRAIL_COLOUR[d.couple]) || AXIS;

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
 * The marker's half-width in BOARD UNITS -- one grid square of the floor, which is the unit the
 * background grid measures. Shared by the marker itself and by the handhold trim, so the two can
 * never disagree about where a dancer's edge is.
 *
 * A fixed pixel radius was the reason the dancers overlapped in the waves. The board puts dancers
 * two units apart in a squared set, an ocean wave or a column, but only ONE unit apart in a tidal
 * wave and a promenade -- and since the floor is fitted to the call, a fixed radius also grew
 * exactly when the view zoomed out. Sizing it in units makes the marker a square of floor at every
 * zoom. A hair under a full square, so a tidal wave's one-unit spacing still reads as two dancers.
 */
const MARKER_UNITS = 0.48;

/**
 * Trim a line back to the marker edges, so a handhold is not a pair of very long arms. `r` is in
 * board units, the same as the positions. Below two radii the markers touch and there is no gap
 * left to fill, so the line is left alone rather than drawn backwards through the bodies.
 */
function betweenEdges(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  if (len <= r * 2) return [a, b];
  return [
    { x: a.x + (dx / len) * r, y: a.y + (dy / len) * r },
    { x: b.x - (dx / len) * r, y: b.y - (dy / len) * r },
  ];
}

let shared = null;
async function engineInputs() {
  if (!shared) {
    const url = (p) => new URL(p, import.meta.url).href;
    shared = (async () => {
      const [moves, formations] = await Promise.all([
        fetch(url('../assets/moves.xml')).then((r) => r.text()),
        fetch(url('../assets/formations.xml')).then((r) => r.text()),
      ]);
      const engine = new Engine(moves, formations);
      return { engine, moves, formations };
    })();
  }
  return shared;
}

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
  // Line widths follow the markers: on a call fitted to a wide floor the dancers are small, and a
  // fixed 1.8px trail would draw over them.
  const marker = MARKER_UNITS * scale;
  ctx.lineWidth = Math.max(1.1, marker * 0.09);
  ctx.lineCap = 'round';
  state.trails.forEach((pts, i) => {
    const upTo = Math.max(1, Math.round(pts.length * fraction));
    ctx.strokeStyle = trailOf(state.dancers[i]);
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
    const [p, q] = betweenEdges(a, b, MARKER_UNITS);
    ctx.beginPath();
    ctx.moveTo(px(p.x), py(p.y));
    ctx.lineTo(px(q.x), py(q.y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const r = marker;
  const ink = Math.max(1, Math.min(1.4, r / 13));
  const inset = Math.max(1, r * 0.05);

  // ---- EVERY FACING NOSE FIRST, THEN EVERY BODY.
  //
  // The order matters. Drawn per dancer, one dancer's nose is painted after the previous dancer's
  // body, so wherever two dancers pass close the nose lands ON the neighbour and they appear to stab
  // one another. Drawn in two passes, an intruding nose is covered by the body it intrudes on, which
  // reads as one dancer behind another -- and no nose can ever cover a body or a number.
  //
  // The nose is INK, not the dancer's own colour: a same-coloured bump on a coloured body over a
  // pale floor is not readable at a glance, which is the whole job of this mark. White would be
  // worse, because the part that shows is the part over the floor. It is also as wide as the body
  // where it leaves it, so it reads as a beak rather than a sliver.
  //
  // Proportional to the marker, so it cannot span the gap to a neighbouring SQUARE: the tip is 0.77
  // of a unit from the centre, against a 2-unit wave spacing and 1.41 units at the tightest
  // formation in the program (a thar, and there the facings are oblique).
  ctx.fillStyle = INK;
  poses.forEach((pose) => {
    if (!pose) return;
    const cx = px(pose.x);
    const cy = py(pose.y);
    const hx = Math.cos(pose.heading);
    const hy = -Math.sin(pose.heading);
    const tip = r * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + hx * tip, cy + hy * tip);
    ctx.lineTo(cx + hx * (r * 0.85) - hy * (r * 0.5), cy + hy * (r * 0.85) + hx * (r * 0.5));
    ctx.lineTo(cx + hx * (r * 0.85) + hy * (r * 0.5), cy + hy * (r * 0.85) - hx * (r * 0.5));
    ctx.closePath();
    ctx.fill();
  });

  state.dancers.forEach((d, i) => {
    const pose = poses[i];
    if (!pose) return;
    const cx = px(pose.x);
    const cy = py(pose.y);
    const colour = colourOf(d);

    ctx.fillStyle = colour;
    if (d.gender === 'girl') {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ink;
      ctx.stroke();
    } else {
      // THE BOY'S MARKER TURNS WITH THE DANCER. A square is the only marker whose orientation can be
      // seen, and axis-aligned it stayed put while the dancer turned, so a Boy read as sliding round
      // the floor rather than travelling. Board +y is north and canvas +y is down, so the facing
      // direction (cos h, -sin h) is a canvas rotation of -h. The number is drawn outside this
      // transform, so it stays upright.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-pose.heading);
      ctx.fillRect(-r + inset, -r + inset, 2 * r - 2 * inset, 2 * r - 2 * inset);
      ctx.strokeStyle = INK;
      ctx.lineWidth = ink;
      ctx.strokeRect(-r + inset, -r + inset, 2 * r - 2 * inset, 2 * r - 2 * inset);
      ctx.restore();
    }
    const num = displayId(d);
    if (num) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), cx, cy + 0.5);
    }
  });
}

async function mount(host) {
  const size = Number(host.dataset.size ?? 340);
  const firstFile = host.dataset.file;
  const firstTam = Number(host.dataset.tam ?? 0);
  let view = { scale: Number(host.dataset.scale), units: Number(host.dataset.units) };

  /**
   * The alternative start formations, as `[label, file, tamIndex, scale, units, beats]`. Absent for
   * most calls: only where the manual lists more than one start formation AND the corpus can animate
   * it. Switching reloads the call from the chosen authoring -- each start formation is a different
   * authoring of the same call, not a different pose of the same animation -- and re-fits the floor,
   * because an authoring that travels further is drawn on a wider view.
   */
  let starts = null;
  try {
    const list = host.dataset.starts ? JSON.parse(host.dataset.starts) : null;
    if (Array.isArray(list) && list.length > 1) starts = list;
  } catch {
    starts = null;
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
    dancers = assignHomeIdentity(bundle.dancers);
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
        <option value="0.5" selected>1/2</option>
        <option value="1">full</option>
      </select>
    </label>`;

  // The start-formation selector, when there is a choice to make. It leads the speed control because
  // it changes WHAT is being watched, where speed changes only how fast.
  if (starts) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const pick = document.createElement('label');
    pick.className = 'dsq-speed dsq-start';
    pick.innerHTML =
      `start <select class="dsq-from" title="Which formation the call starts from">` +
      starts.map((s, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${esc(s[0])}</option>`).join('') +
      `</select>`;
    bar.insertBefore(pick, bar.querySelector('.dsq-speed'));
  }

  host.append(canvas, bar);
  const slider = bar.querySelector('input');
  const readout = bar.querySelector('.dsq-readout');
  const playBtn = bar.querySelector('[data-act="play"]');
  const speedSel = bar.querySelector('.dsq-rate');
  const fromSel = bar.querySelector('.dsq-from');

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
  fromSel?.addEventListener('change', async () => {
    const entry = starts[Number(fromSel.value)];
    if (!entry) return;
    const [, file, tam, scale, units] = entry;
    setPlaying(false);
    try {
      await use(file, Number(tam), { scale: Number(scale), units: Number(units) });
    } catch (err) {
      // Say so in the page rather than leaving the old animation under a new label.
      host.innerHTML = `<p class="dsq-error">Could not load the animation from ${entry[0]}: ${String(err.message ?? err)}</p>`;
      console.error(err);
      return;
    }
    slider.max = String(beats);
    show(0);
  });

  show(0);
}

for (const host of document.querySelectorAll('.dsq-player')) {
  mount(host).catch((err) => {
    // Report the failure in the page: a player that silently does nothing looks like a broken book.
    host.innerHTML = `<p class="dsq-error">Could not load this animation: ${String(err.message ?? err)}</p>`;
    console.error(err);
  });
}
