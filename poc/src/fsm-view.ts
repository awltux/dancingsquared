// FSM view renderer: turns precomputed FSM table data (states + edges) into a
// self-contained HTML/SVG visual highlighting dead-end formations and call
// usage, with a call filter. Purely data-driven — no Sequencer or live FSM
// build needed, so the poc can render the precomputed asset instantly.

// THE EXTENSION IS PART OF THE SPECIFIER, and only here. This module is imported directly by
// `poc/tools/fsm-open-probe.mjs` under node's type stripping - node does not guess extensions, so `./dom`
// would resolve under Vite and fail under the probe. Everywhere else in `poc/src` the bare specifier is used.
import { esc } from './dom.ts';

/**
 * One edge of a precomputed table, as far as the renderer cares.
 *
 * `endFormation` is null for a TRANSIENT - an edge that leaves the modelled graph - and `endKind` says
 * which kind of leaving it is (schema 2, `FsmEndKind`): `out-of-scope` is a formation the corpus names but
 * this level does not model, so a LEVEL BUMP would make it a node, while `novel` is a board no level names.
 * `reading` says how much of the board the application moved. Both are optional so a v1-shaped object still
 * typechecks; the shipped asset is schema 2 and carries them.
 */
export interface FsmEdgeData {
  call: string;
  endFormation: string | null;
  reading?: 'whole' | 'full-tiling' | 'partial';
  endKind?: 'state' | 'out-of-scope' | 'novel';
}
export interface FsmGraphData { states: string[]; edges: Record<string, FsmEdgeData[]> }

/**
 * The union of several levels' precomputed tables, which is what "All levels" draws.
 *
 * THE LEVELS OVERLAP, so a union is not a concatenation. Each asset is the FSM of one level's catalogue,
 * and a state - "Static Square", "Wave RH" - is the same geometry whatever level it was reached from, so a
 * state that appears in two tables is ONE node whose calls are the calls either level can make from it. The
 * edges are deduped by `(call, endFormation)` for the same reason: the same call landing the same way,
 * authored again at a later level, is one edge and not two.
 *
 * A `null` endFormation is kept rather than dropped - the renderer already skips those edges when it builds
 * the graph, and dropping them here would make this table disagree with the ones it is made of.
 */
export function mergeFsmTables(tables: FsmGraphData[]): FsmGraphData {
  const states: string[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    for (const s of t.states ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      states.push(s);
    }
  }
  const edges: Record<string, FsmEdgeData[]> = {};
  for (const t of tables) {
    for (const [state, list] of Object.entries(t.edges ?? {})) {
      const out = (edges[state] ??= []);
      for (const e of list) {
        if (out.some((x) => x.call === e.call && x.endFormation === e.endFormation)) continue;
        out.push(e);
      }
    }
  }
  return { states, edges };
}

/**
 * The width a sidebar drag lands on: never narrower than `min`, never wider than 80% of the window.
 *
 * EXPORTED AND INJECTED, rather than written twice. The rule lives in the emitted document, which the app
 * cannot call into, so the alternative is a second copy of it as a string in the template - and a clamp that
 * exists twice is a clamp that disagrees the first time one of them is changed. The renderer inlines this
 * function's own compiled source into the document it emits, and the probe calls the same function, so there
 * is one rule and the document provably has it.
 *
 * A non-finite width returns the minimum rather than `NaN`: `style.width = "NaNpx"` is ignored by the browser,
 * which would leave the pane at its previous width while the drag looked like it was doing something.
 */
export function clampSideWidth(px: number, viewport: number, min = 180): number {
  if (!Number.isFinite(px)) return min;
  const max = Math.max(min, Math.round(viewport * 0.8));
  return Math.max(min, Math.min(max, Math.round(px)));
}

/** Render precomputed FSM data as a self-contained HTML string.
 *
 * `level` is carried into the document so a row's Load / Edit icon can say WHICH tree it was clicked in:
 * the same call title is authored at several levels, and the app has to open the authoring the tree on
 * screen was built from. */
export function renderFsmHtml(data: FsmGraphData, title = 'FSM', level = ''): string {
  const states = data.states ?? [];
  const edgesFor = (s: string): FsmEdgeData[] => data.edges?.[s] ?? [];
  const HOME = 'Static Square';
  const idx = new Map(states.map((s, i) => [s, i]));
  const label = (s: string) => (s.startsWith('@embed') ? `embedded #${s.slice(7)}` : s);
  const n = states.length;

  const hasOutgoing = states.map((s) => edgesFor(s).length > 0);
  const graph: number[][] = states.map(() => []);
  const edges: { from: number; to: number; call: string }[] = [];
  // THE TRANSIENTS, kept rather than dropped. The GRAPH still draws only edges with a target - drawing a
  // stub per transient is separate work, recorded in PLAN.md - but the sidebar lists them per node and the
  // header counts them, because an edge that LEAVES the modelled vocabulary is the thing Stage 3 has to
  // absorb and a renderer that silently hid 28% of its own table would be the instrument failing to say so.
  const leaves: { from: number; call: string; kind: string }[] = [];
  for (let i = 0; i < n; i++) {
    for (const e of edgesFor(states[i])) {
      if (e.endFormation == null) {
        leaves.push({ from: i, call: e.call, kind: e.endKind ?? 'unknown' });
        continue;
      }
      const t = idx.get(e.endFormation);
      if (t !== undefined) { graph[i].push(t); edges.push({ from: i, to: t, call: e.call }); }
    }
  }
  const leavesByKind = leaves.reduce((m, l) => m.set(l.kind, (m.get(l.kind) ?? 0) + 1), new Map<string, number>());
  const totalEdges = edges.length + leaves.length;
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
    return `<g class="node" data-status="${st}" data-i="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><title>${esc(label(s))}${st === 'dead' ? ' — DEAD END (no call)' : st === 'nohome' ? ' — no route home' : ''}</title><circle class="nhit" r="${r + 7}" fill="transparent" pointer-events="all"/><circle class="nd" data-r="${r}" r="${r}" fill="${FILL[st]}" stroke="#00000022" stroke-width="1.2" vector-effect="non-scaling-stroke"/><text class="ndt" pointer-events="none" data-r="${r}" y="${r + 20}" text-anchor="middle" font-size="16">${esc(s.startsWith('@embed') ? '#' + s.slice(7) : s)}</text></g>`;
  }).join('');
  const eg = new Map<string, string[]>();
  for (const e of edges) { const key = `${e.from}|${e.to}`; (eg.get(key) ?? eg.set(key, []).get(key)!).push(e.call); }
  const edgeSvg = [...eg.entries()].map(([key, calls]) => {
    const [a, b] = key.split('|').map(Number);
    const rev = a !== b ? eg.get(`${b}|${a}`) : undefined;
    const fwd = `${label(states[a])} → ${label(states[b])}: ${calls.join(' ; ')}`;
    const back = rev ? `${label(states[b])} → ${label(states[a])}: ${rev.join(' ; ')}` : null;
    const all = rev ? [...calls, ...rev] : calls;
    return `<line class="edge" data-a="${a}" data-b="${b}" x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}" stroke-width="1.4" vector-effect="non-scaling-stroke" data-calls="${esc(all.join(' ; '))}"><title>${esc(back ? fwd + '\n' + back : fwd)}</title></line>`;
  }).join('');

  const deadList = states.filter((_, i) => status(i) === 'dead').map(label);
  const nohomeList = states.filter((_, i) => status(i) === 'nohome').map(label);
  const nodeList = states.map((s, i) => ({
    name: label(s),
    status: status(i),
    // `fromFormation` is the RAW state key, not the display label: it is what the app resolves a setup
    // against, and the display label rewrites the `@embed` keys that no setup can be named by anyway.
    // `toIdx` / `fromIdx` are the OTHER END of each edge - the formation a row's name can be clicked to
    // select, which is the node the call leads to or comes from. `home` is whether that other end can
    // still reach the squared set, which is what makes the call one that LEADS HOME.
    calls: edges.filter((e) => e.from === i).map((e) => ({ call: e.call, to: label(states[e.to]), toIdx: e.to, home: canHome.has(e.to), fromFormation: s })),
    incoming: edges.filter((e) => e.to === i).map((e) => ({ call: e.call, from: label(states[e.from]), fromIdx: e.from, fromFormation: states[e.from] })),
    // Calls from here that land where this table has no node. Listed with the kind, because the two kinds
    // mean different things to a reader: `out-of-scope` is a formation a higher level DOES model, `novel` is
    // one nothing names.
    leaves: leaves.filter((l) => l.from === i).map((l) => ({ call: l.call, kind: l.kind })),
  }));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${n} states</title><style>  html,body{height:100%;overflow:hidden;overscroll-behavior:none;margin:0}
  body{font-family:system-ui,Segoe UI,sans-serif;display:flex}
  #side{width:300px;flex:0 0 auto;padding:12px;overflow:auto;background:#f6f7f9;border-right:1px solid #ddd;font-size:13px;box-sizing:border-box}
  #grip{width:6px;flex:0 0 auto;cursor:col-resize;background:#e9edf1;border-right:1px solid #ddd}
  #grip:hover,#grip.on{background:#c9d6e6}
  body.sizing{cursor:col-resize;user-select:none}
  #stage{flex:1;overflow:hidden}svg{width:100%;height:100%;display:block}.edge{stroke:#cfd6dd;fill:none}
  #filter{width:96%;padding:4px}details{margin:3px 0}summary{cursor:pointer;font-weight:600}
  #rst{width:100%;margin:8px 0;padding:6px;cursor:pointer;background:#fff;border:1px solid #bbb;border-radius:6px;font-size:13px}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
  #nodedisp{margin-top:6px;padding:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:12px}
  #nodedisp b{font-size:13px}
  #nodedisp ul{margin:4px 0;padding-left:16px}
  #nodedisp li{font-size:11px;color:#333}
  #nodedisp button.mini{font-size:11px;line-height:1;padding:0 3px;margin-left:3px;border:1px solid #ccd2d8;border-radius:4px;background:#fff;color:#333;cursor:pointer;vertical-align:middle}
  #nodedisp span.jump{cursor:pointer;color:#1558b0;border-bottom:1px dotted #7aa2d6}
  #nodedisp span.jump:hover{color:#0b3f8c;border-bottom-style:solid}
  #nodedisp li.route-home{background:rgba(58,154,95,0.18);border-left:3px solid #3a9a5f;border-radius:3px;padding-left:4px}
  #nodedisp button.mini:hover{background:#eef2f7;border-color:#8fa8c0;color:#123}
  </style></head><body><div id="side"><h2>${esc(title)} — ${n} states, ${edges.length} edges</h2>
  <p style="font-size:11px;color:#555;margin:2px 0 6px">${leaves.length} of ${totalEdges} edges leave the vocabulary
  (${[...leavesByKind].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}). They are listed per formation below;
  drawing them as stubs in the graph is separate work.</p>
  <p><span class="dot" style="background:#0a7d33"></span>home<br><span class="dot" style="background:#3a9a5f"></span>route home<br><span class="dot" style="background:#e8950c"></span>no route home (approx) (${nohomeList.length})<br><span class="dot" style="background:#d63a3a"></span>dead-end (${deadList.length})<br><span class="dot" style="background:rgba(58,154,95,0.25);box-shadow:inset 0 0 0 1px #3a9a5f"></span>call that leads home</p>

  <button id="rst" title="Reset pan/zoom to show the whole graph">⟲ Reset view</button>
  <input id="filter" placeholder="highlight edges by call…">
  <h3 style="font-size:13px;margin:10px 0 4px">Selected formation</h3>
  <div id="nodedisp"><i>Click a node to see its calls.</i></div>
  <details><summary>Dead-end formations (${deadList.length})</summary><div style="color:#a52828">${deadList.map(esc).join('<br>') || 'none'}</div></details>
  <details><summary>No route home (${nohomeList.length})</summary><div style="color:#b97608">${nohomeList.map(esc).join('<br>') || 'none'}</div></details>
  </div><div id="grip" title="Drag to size this pane — double-click to reset it"></div><div id="stage"><svg viewBox="0 0 2000 2000">${edgeSvg}${nodeSvg}</svg></div>
  <script type="application/json" id="nodedata">${JSON.stringify(nodeList)}</script>
  <script type="application/json" id="topo">${JSON.stringify(pos.map((p) => [Math.round(p.x), Math.round(p.y)]))}</script>
  <script>
  const edges=[...document.querySelectorAll('.edge')];const f=document.getElementById('filter');
  const LEVEL=${JSON.stringify(level)};
  const ECOL={out:'#2e9e4f',in:'#e68a00',both:'#9b5cf6'};
  let sel=-1;
  // Highlight a selected node's incident edges (incoming vs outgoing coloured);
  // otherwise respect the call filter.
  function paint(){const q=f.value.trim().toLowerCase();edges.forEach(e=>{const a=+e.dataset.a,b=+e.dataset.b;const on=sel>=0&&(a===sel||b===sel);if(on){e.style.opacity=1;e.setAttribute('stroke',ECOL[a===sel&&b===sel?'both':a===sel?'out':'in']);}else{e.setAttribute('stroke','#cfd6dd');e.style.opacity=q&&!e.dataset.calls.toLowerCase().includes(q)?'0.04':'1';}});}
  f.addEventListener('input',paint);
  // THE PANE BETWEEN THE LISTS AND THE GRAPH IS DRAGGABLE, and its width is REMEMBERED. Persistence is not a
  // flourish here: the frame is re-rendered whole on a level change and on every visit to the tab, so a width
  // that only lives in this document would snap back to 300px at exactly the moment the caller had the lists
  // the way they wanted them. localStorage is per-origin and a srcdoc frame inherits the parent's, so it
  // survives both. The clamp is the exported clampSideWidth, inlined below rather than copied.
  const clampW=${clampSideWidth.toString()};
  const side=document.getElementById('side'),grip=document.getElementById('grip');
  const SIDE_DEFAULT=300,SIDE_KEY='dsFsmSideWidth';
  const store=(w)=>{try{localStorage.setItem(SIDE_KEY,String(w));}catch{/* a blocked store is not a broken pane */}};
  const setSide=(w)=>{const px=clampW(w,innerWidth);side.style.width=px+'px';return px;};
  try{const w=parseFloat(localStorage.getItem(SIDE_KEY)||'');if(w>0)setSide(w);}catch{}
  let sizing=false;
  grip.addEventListener('pointerdown',e=>{sizing=true;grip.classList.add('on');document.body.classList.add('sizing');grip.setPointerCapture(e.pointerId);e.preventDefault();});
  grip.addEventListener('pointermove',e=>{if(sizing)setSide(e.clientX-side.getBoundingClientRect().left);});
  const endSize=()=>{if(!sizing)return;sizing=false;grip.classList.remove('on');document.body.classList.remove('sizing');store(parseInt(side.style.width,10));};
  grip.addEventListener('pointerup',endSize);grip.addEventListener('pointercancel',endSize);
  grip.addEventListener('dblclick',()=>store(setSide(SIDE_DEFAULT)));
  const svg=document.querySelector('svg'),st=document.getElementById('stage');let dragging=false,sx=0,sy=0,vb=svg.viewBox.baseVal;
  // Keep node icons/labels a constant SCREEN size as the viewBox zooms: the
  // viewBox scale factor is vb.width/2000, so counter-scale node geometry by it.
  const rescale=()=>{const k=vb.width/2000;document.querySelectorAll('.nd').forEach(c=>c.setAttribute('r',(parseFloat(c.dataset.r)*k).toFixed(2)));document.querySelectorAll('.ndt').forEach(t=>{const r=parseFloat(t.dataset.r);t.setAttribute('y',(r*k+17*k).toFixed(2));t.style.fontSize=(16*k)+'px';});};
  st.addEventListener('pointerdown',e=>{dragging=true;sx=e.clientX;sy=e.clientY;if(sel>=0){sel=-1;markSel();paint();disp.textContent='Click a node to see its calls.';}});window.addEventListener('pointerup',()=>dragging=false);
  st.addEventListener('pointermove',e=>{if(!dragging)return;const r=svg.getBoundingClientRect();vb.x-=(e.clientX-sx)*(vb.width/r.width);vb.y-=(e.clientY-sy)*(vb.height/r.height);sx=e.clientX;sy=e.clientY;});
  st.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const rect=svg.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;const px=e.clientX-rect.left,py=e.clientY-rect.top;const sx=vb.width/rect.width,sy=vb.height/rect.height;const vx=vb.x+px*sx,vy=vb.y+py*sy;const z=e.deltaY<0?0.9:1.1;vb.width*=z;vb.height*=z;vb.x=vx-px*(vb.width/rect.width);vb.y=vy-py*(vb.height/rect.height);rescale();},{passive:false});
  // Reset pan/zoom back to the full-graph framing (also bound to the R key).
  const resetView=()=>{vb.x=0;vb.y=0;vb.width=2000;vb.height=2000;rescale();};
  document.getElementById('rst').addEventListener('click',resetView);
  addEventListener('keydown',e=>{if((e.key==='r'||e.key==='R')&&document.activeElement!==f){e.preventDefault();resetView();}});
  rescale();
  // Click a node to inspect it in the sidebar.
  const NODEINFO=JSON.parse(document.getElementById('nodedata').textContent);
  const disp=document.getElementById('nodedisp');
  const STC={home:'#0a7d33',ok:'#3a9a5f',nohome:'#e8950c',dead:'#d63a3a'};
  const stText={home:'home (squared set)',ok:'route home',nohome:'no route home',dead:'DEAD END — no call from here'};
  // EACH CALL IN THE LISTS GETS A LOAD AND AN EDIT ICON, because a call named in this graph is the thing
  // a caller wants next: which calls lead here, and where the one that leaves goes. The two icons ASK THE
  // APP - this document holds precomputed table data and no catalogue, so it cannot open a call itself.
  // The message carries the call TITLE, the formation the edge LEAVES FROM and the level of this tree;
  // resolving those into a catalogue call is the app's job (see fsm-target.ts).
  const addOpen=(li,call,from)=>{for(const [act,glyph,tip] of [['load','⤓','Load '+call+' into the Browse calls tab'],['edit','✎','Open '+call+' in the Call editor']]){const x=document.createElement('button');x.type='button';x.className='mini';x.textContent=glyph;x.title=tip;x.dataset.act=act;x.dataset.call=call;x.dataset.from=from;li.appendChild(x);}};
  // AND THE FORMATION AT THE OTHER END OF A ROW IS THE WAY THERE: clicking it SELECTS that node, which is
  // the question a reader of "Swing Thru → Ocean Waves RH" is actually asking - not "what is that call" but
  // "what is that board, and what else can be done from it". It is a plain span rather than a button because
  // it is the sentence's subject, not a control beside it.
  const jumpSpan=(text,idx)=>{const j=document.createElement('span');j.className='jump';j.textContent=text;j.dataset.node=idx;j.title='Select '+text;return j;};
  // AND WHEN THERE IS A ROUTE HOME, THE CALLS THAT KEEP IT ARE MARKED. A call from here LEADS HOME when the
  // formation it reaches can still get back to the squared set - which is the whole question a caller stuck
  // in an odd shape is asking, and the one thing the graph answers only by tracing edges by eye. It is a
  // property of the call from THIS node, so only the outgoing list carries it; and a node with no route home
  // has no such call by construction, because an edge to a formation that can home would BE a route home.
  const row=(li,arrow,c)=>{if(!arrow&&c.home){li.className='route-home';li.title='this call leaves the set still able to reach home';}const j=jumpSpan(arrow?c.from:c.to,arrow?c.fromIdx:c.toIdx);if(arrow){li.appendChild(j);li.appendChild(document.createTextNode(' → '+c.call));}else{li.appendChild(document.createTextNode(c.call+' → '));li.appendChild(j);}addOpen(li,c.call,c.fromFormation);};
  disp.addEventListener('click',e=>{const j=e.target.closest('.jump');if(j){e.stopPropagation();selectOnly(+j.dataset.node);return;}const b=e.target.closest('button.mini');if(!b)return;e.stopPropagation();parent.postMessage({type:'fsm-open',action:b.dataset.act,call:b.dataset.call,formation:b.dataset.from||null,level:LEVEL},'*');});
  const showNode=i=>{disp.textContent='';if(!NODEINFO[i])return;const nd=NODEINFO[i];const t=document.createElement('div');t.innerHTML='<b>'+nd.name+'</b>';disp.appendChild(t);const b=document.createElement('div');b.style.color=STC[nd.status]||'#333';b.textContent=stText[nd.status]||nd.status;disp.appendChild(b);const sec=(h,items,arrow)=>{const hd=document.createElement('div');hd.textContent=h;hd.style.fontWeight='600';hd.style.marginTop='4px';disp.appendChild(hd);if(!items.length){const em=document.createElement('div');em.style.color='#888';em.textContent='(none)';disp.appendChild(em);return;}const ul=document.createElement('ul');items.forEach(c=>{const li=document.createElement('li');row(li,arrow,c);ul.appendChild(li);});disp.appendChild(ul);};sec('Calls from here ('+nd.calls.length+'):',nd.calls,false);sec('Calls that lead here ('+nd.incoming.length+'):',nd.incoming,true);
  // THE TRANSIENTS, and they are a third list rather than part of "calls from here" because they have no
  // destination to click: the call applies and the table has nowhere to record where it went. The KIND is
  // shown because the two mean different things - out-of-scope is a formation a HIGHER LEVEL models, so a
  // level bump would make it a node, while novel is a board no level names and only a module edge can
  // absorb. (No backticks in here: this whole function is one template literal.)
  {const hd=document.createElement('div');hd.textContent='Leaves the vocabulary ('+nd.leaves.length+'):';hd.style.fontWeight='600';hd.style.marginTop='4px';disp.appendChild(hd);
  if(!nd.leaves.length){const em=document.createElement('div');em.style.color='#888';em.textContent='(none — every call from here lands on a formation)';disp.appendChild(em);}
  else{const ul=document.createElement('ul');nd.leaves.forEach(c=>{const li=document.createElement('li');li.title=c.kind==='out-of-scope'?'a formation this level does not model, but a higher level does':'a board no level names';li.appendChild(document.createTextNode(c.call+' '));const s=document.createElement('span');s.style.color='#9a6b1f';s.textContent='→ '+c.kind;li.appendChild(s);addOpen(li,c.call,nd.fromFormation);ul.appendChild(li);});disp.appendChild(ul);}}};
  function markSel(){document.querySelectorAll('.node').forEach(nd=>{const c=nd.querySelector('.nd');const on=sel>=0&&(+nd.dataset.i===sel);c.setAttribute('stroke',on?'#111':'#00000022');c.setAttribute('stroke-width',on?'3':'1.2');});}
  function select(i){sel=sel===i?-1:i;markSel();paint();if(sel>=0)showNode(sel);else disp.textContent='Click a node to see its calls.';}
  // Selection SET, not toggled: used when a drag ends, so a node that was already selected stays
  // selected instead of being toggled off by the release.
  function selectOnly(i){sel=i;markSel();paint();showNode(i);}
  // Node selection is driven from POINTERUP (see the simulation below), not from the click event:
  // a drag ends with the node somewhere else under the cursor, so the browser often delivers no
  // click at all, and when it does deliver one it would toggle the drag's selection straight back
  // off. Pointerup already knows whether the gesture moved, so one handler covers both: a release
  // that did not move toggles, a release that did move leaves the node selected.
  // ---- live force simulation: drag a node and the layout reflows/spreads ----
  (function(){
    const P=JSON.parse(document.getElementById('topo').textContent);
    const n=P.length;
    const X=P.map(p=>p[0]),Y=P.map(p=>p[1]);
    const nodes=[...document.querySelectorAll('.node')], lines=document.querySelectorAll('.edge');
    const nb=Array.from({length:n},()=>[]);
    lines.forEach(L=>{const a=+L.dataset.a,b=+L.dataset.b;nb[a].push(b);nb[b].push(a);});
    const K=130,CX=1000,CY=1000;
    const force=Array.from({length:n},()=>[0,0]);
    const apply=()=>{for(let i=0;i<n;i++){const g=nodes[i];if(g)g.setAttribute('transform','translate('+X[i].toFixed(1)+','+Y[i].toFixed(1)+')');}lines.forEach(L=>{const a=+L.dataset.a,b=+L.dataset.b;L.setAttribute('x1',X[a]);L.setAttribute('y1',Y[a]);L.setAttribute('x2',X[b]);L.setAttribute('y2',Y[b]);});};
    let temp=0,pinned=-1,running=false,moved=false,fromX=0,fromY=0;
    function step(){
      for(let i=0;i<n;i++)force[i][0]=force[i][1]=0;
      for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){let dx=X[i]-X[j],dy=Y[i]-Y[j];const d=Math.hypot(dx,dy)||1e-3;const f=(K*K)/d;const ux=dx/d,uy=dy/d;force[i][0]+=f*ux;force[i][1]+=f*uy;force[j][0]-=f*ux;force[j][1]-=f*uy;}
      for(let a=0;a<n;a++)for(const b of nb[a]){if(b<=a)continue;let dx=X[b]-X[a],dy=Y[b]-Y[a];const d=Math.hypot(dx,dy)||1e-3;const f=d*d/K;const ux=dx/d,uy=dy/d;force[a][0]+=f*ux;force[a][1]+=f*uy;force[b][0]-=f*ux;force[b][1]-=f*uy;}
      for(let i=0;i<n;i++){force[i][0]+=(CX-X[i])*0.02;force[i][1]+=(CY-Y[i])*0.02;}
      for(let i=0;i<n;i++){if(i===pinned)continue;const d=Math.hypot(force[i][0],force[i][1])||1;const mag=Math.min(d,temp);X[i]+=force[i][0]/d*mag;Y[i]+=force[i][1]/d*mag;}
      apply();temp*=0.95;if(pinned>=0&&temp<6)temp=6;
      if(temp>0.3||pinned>=0){requestAnimationFrame(step);}else{running=false;}
    }
    const toWorld=e=>{const r=svg.getBoundingClientRect();return [vb.x+(e.clientX-r.left)*(vb.width/r.width),vb.y+(e.clientY-r.top)*(vb.height/r.height)];};
    nodes.forEach((g,i)=>{g.style.cursor='grab';g.addEventListener('pointerdown',e=>{e.stopPropagation();pinned=i;moved=false;fromX=e.clientX;fromY=e.clientY;const p=toWorld(e);X[i]=p[0];Y[i]=p[1];apply();temp=Math.max(temp,22);if(!running){running=true;requestAnimationFrame(step);}});});
    window.addEventListener('pointermove',e=>{if(pinned<0)return;if(Math.abs(e.clientX-fromX)>3||Math.abs(e.clientY-fromY)>3)moved=true;const p=toWorld(e);X[pinned]=p[0];Y[pinned]=p[1];apply();});
    // Release: a gesture that MOVED was a drag, so the node is left SELECTED (set, not toggled);
    // a gesture that did not move was a click, and toggles as before.
    window.addEventListener('pointerup',()=>{if(pinned>=0){if(moved)selectOnly(pinned);else select(pinned);}pinned=-1;});
    apply();
  })();
  </script></body></html>`;
}
