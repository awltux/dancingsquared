// FSM view renderer: turns a Sequencer's transition table into a self-contained
// HTML/SVG visual of the state machine, highlighting dead-end formations (no
// outgoing call) and formations with no route back home, and letting the user
// filter edges by call. Browser-safe (no node deps).

import type { Sequencer } from 'dancing-squared-engine';

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Render a Sequencer's FSM as a self-contained HTML string. */
export function fsmToHtml(seq: Sequencer): string {
  const fsm = seq.transitionTable();
  const states = fsm.states();
  const HOME = 'Static Square';
  const idx = new Map(states.map((s, i) => [s, i]));
  const label = (s: string) => (s.startsWith('@embed') ? `embedded #${s.slice(7)}` : s);
  const n = states.length;

  const hasOutgoing = states.map((s) => fsm.edgesFor(s).length > 0);
  const graph: number[][] = states.map(() => []);
  const edges: { from: number; to: number; call: string }[] = [];
  for (let i = 0; i < n; i++) {
    for (const e of fsm.edgesFor(states[i])) {
      if (e.endFormation == null) continue;
      const t = idx.get(e.endFormation);
      if (t !== undefined) { graph[i].push(t); edges.push({ from: i, to: t, call: e.call }); }
    }
  }
  // can-reach-home: reverse BFS over the state graph from HOME (approximate when
  // routes pass through embedded states — edges are only wired between states
  // whose endFormation is itself a state key).
  const canHome = new Set<number>([idx.get(HOME) as number]);
  {
    const q = [idx.get(HOME) as number];
    while (q.length) {
      const cur = q.pop()!;
      for (let i = 0; i < n; i++) if (!canHome.has(i) && graph[i].includes(cur)) { canHome.add(i); q.push(i); }
    }
  }
  const status = (i: number) => {
    if (states[i] === HOME) return 'home';
    if (!hasOutgoing[i]) return 'dead';
    return canHome.has(i) ? 'ok' : 'nohome';
  };

  // deterministic force layout
  const pos = Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * 2 * Math.PI) * n * 0.4, y: Math.sin((i / n) * 2 * Math.PI) * n * 0.4 }));
  const k = Math.sqrt(900 * 900 / n);
  const fr = (temp: number) => {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const rep = k * k / dist; const fx = rep * dx / dist, fy = rep * dy / dist;
      disp[i].x += fx; disp[i].y += fy; disp[j].x -= fx; disp[j].y -= fy;
    }
    for (const e of edges) {
      let dx = pos[e.to].x - pos[e.from].x, dy = pos[e.to].y - pos[e.from].y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const att = dist * dist / k; const fx = att * dx / dist, fy = att * dy / dist;
      disp[e.from].x += fx; disp[e.from].y += fy; disp[e.to].x -= fx; disp[e.to].y -= fy;
    }
    for (let i = 0; i < n; i++) { const d = Math.hypot(disp[i].x, disp[i].y) || 1; pos[i].x += disp[i].x / d * Math.min(d, temp); pos[i].y += disp[i].y / d * Math.min(d, temp); }
  };
  for (let it = 0; it < 400; it++) fr(300 * (1 - it / 400) + 1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pos) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const S = 1800 / Math.max(1e-6, maxX - minX);
  for (const p of pos) { p.x = 100 + (p.x - minX) * S; p.y = 100 + (p.y - minY) * S; }

  const FILL: Record<string, string> = { home: '#0a7d33', ok: '#3a9a5f', nohome: '#e8950c', dead: '#d63a3a' };
  const nodeSvg = states.map((s, i) => {
    const st = status(i); const p = pos[i]; const r = st === 'home' ? 20 : 13;
    return `<g class="node" data-status="${st}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><title>${esc(label(s))}${st === 'dead' ? ' — DEAD END (no call)' : st === 'nohome' ? ' — no route home' : ''}</title><circle r="${r}" fill="${FILL[st]}" stroke="#00000022"/><text y="${r + 17}" text-anchor="middle" font-size="10">${esc(s.startsWith('@embed') ? '#' + s.slice(7) : s)}</text></g>`;
  }).join('');
  // merge parallel edges into one line (calls joined)
  const eg = new Map<string, string[]>();
  for (const e of edges) { const k = `${e.from}|${e.to}`; (eg.get(k) ?? eg.set(k, []).get(k)!).push(e.call); }
  const edgeSvg = [...eg.entries()].map(([k, calls]) => {
    const [a, b] = k.split('|').map(Number);
    return `<line class="edge" x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}" stroke-width="1.2" data-calls="${esc(calls.join(' ; '))}"><title>${esc(calls.join(' ; '))}</title></line>`;
  }).join('');

  const deadList = states.filter((_, i) => status(i) === 'dead').map(label);
  const nohomeList = states.filter((_, i) => status(i) === 'nohome').map(label);

  return `<!doctype html><html><head><meta charset="utf-8"><title>FSM — ${n} states</title><style>
  body{font-family:system-ui,Segoe UI,sans-serif;margin:0;display:flex;height:100vh}
  #side{width:300px;padding:12px;overflow:auto;background:#f6f7f9;border-right:1px solid #ddd;font-size:13px}
  #stage{flex:1;overflow:hidden}
  svg{width:100%;height:100%}
  .edge{stroke:#cfd6dd;fill:none}
  #filter{width:96%;padding:4px}
  details{margin:3px 0}summary{cursor:pointer;font-weight:600}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
  </style></head><body><div id="side">
  <h2>FSM — ${n} states, ${edges.length} edges</h2>
  <p><span class="dot" style="background:#0a7d33"></span>home<br><span class="dot" style="background:#3a9a5f"></span>route home<br><span class="dot" style="background:#e8950c"></span>no route home (approx) (${nohomeList.length})<br><span class="dot" style="background:#d63a3a"></span>dead-end (${deadList.length})</p>
  <input id="filter" placeholder="highlight edges by call…">
  <details><summary>Dead-end formations (${deadList.length})</summary><div style="color:#a52828">${deadList.map(esc).join('<br>') || 'none'}</div></details>
  <details><summary>No route home (${nohomeList.length})</summary><div style="color:#b97608">${nohomeList.map(esc).join('<br>') || 'none'}</div></details>
  </div><div id="stage"><svg viewBox="0 0 2000 2000">${edgeSvg}${nodeSvg}</svg></div>
  <script>
  const edges=[...document.querySelectorAll('.edge')];
  const f=document.getElementById('filter');
  function paint(){const q=f.value.trim().toLowerCase();edges.forEach(e=>{e.style.opacity=e.dataset.calls.toLowerCase().includes(q)?'1':'0.04';});}
  f.addEventListener('input',paint);
  const svg=document.querySelector('svg'),stage=document.getElementById('stage');let dragging=false,sx=0,sy=0,vb=svg.viewBox.baseVal;
  stage.addEventListener('pointerdown',e=>{dragging=true;sx=e.clientX;sy=e.clientY;});
  window.addEventListener('pointerup',()=>dragging=false);
  stage.addEventListener('pointermove',e=>{if(!dragging)return;const k=vb.width/2000;vb.x-=e.clientX-sx;vb.y-=e.clientY-sy;sx=e.clientX;sy=e.clientY;});
  stage.addEventListener('wheel',e=>{e.preventDefault();const z=e.deltaY<0?0.9:1.1;vb.width*=z;vb.height*=z;},{passive:false});
  </script></body></html>`;
}
