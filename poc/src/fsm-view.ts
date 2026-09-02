// FSM view renderer: turns precomputed FSM table data (states + edges) into a
// self-contained HTML/SVG visual highlighting dead-end formations and call
// usage, with a call filter. Purely data-driven — no Sequencer or live FSM
// build needed, so the poc can render the precomputed asset instantly.

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface FsmEdgeData { call: string; endFormation: string | null }
export interface FsmGraphData { states: string[]; edges: Record<string, FsmEdgeData[]> }

/** Render precomputed FSM data as a self-contained HTML string. */
export function renderFsmHtml(data: FsmGraphData, title = 'FSM'): string {
  const states = data.states ?? [];
  const edgesFor = (s: string): FsmEdgeData[] => data.edges?.[s] ?? [];
  const HOME = 'Static Square';
  const idx = new Map(states.map((s, i) => [s, i]));
  const label = (s: string) => (s.startsWith('@embed') ? `embedded #${s.slice(7)}` : s);
  const n = states.length;

  const hasOutgoing = states.map((s) => edgesFor(s).length > 0);
  const graph: number[][] = states.map(() => []);
  const edges: { from: number; to: number; call: string }[] = [];
  for (let i = 0; i < n; i++) {
    for (const e of edgesFor(states[i])) {
      if (e.endFormation == null) continue;
      const t = idx.get(e.endFormation);
      if (t !== undefined) { graph[i].push(t); edges.push({ from: i, to: t, call: e.call }); }
    }
  }
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
    return `<g class="node" data-status="${st}" data-i="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><title>${esc(label(s))}${st === 'dead' ? ' — DEAD END (no call)' : st === 'nohome' ? ' — no route home' : ''}</title><circle class="nd" data-r="${r}" r="${r}" fill="${FILL[st]}" stroke="#00000022"/><text class="ndt" data-r="${r}" y="${r + 20}" text-anchor="middle" font-size="16">${esc(s.startsWith('@embed') ? '#' + s.slice(7) : s)}</text></g>`;
  }).join('');
  const eg = new Map<string, string[]>();
  for (const e of edges) { const k = `${e.from}|${e.to}`; (eg.get(k) ?? eg.set(k, []).get(k)!).push(e.call); }
  const edgeSvg = [...eg.entries()].map(([k, calls]) => {
    const [a, b] = k.split('|').map(Number);
    return `<line class="edge" data-a="${a}" data-b="${b}" x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}" stroke-width="1.4" vector-effect="non-scaling-stroke" data-calls="${esc(calls.join(' ; '))}"><title>${esc(calls.join(' ; '))}</title></line>`;
  }).join('');

  const deadList = states.filter((_, i) => status(i) === 'dead').map(label);
  const nohomeList = states.filter((_, i) => status(i) === 'nohome').map(label);
  const nodeList = states.map((s, i) => ({
    name: label(s),
    status: status(i),
    calls: edges.filter((e) => e.from === i).map((e) => ({ call: e.call, to: label(states[e.to]) })),
  }));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${n} states</title><style>
  html,body{height:100%;overflow:hidden;overscroll-behavior:none;margin:0}
  body{font-family:system-ui,Segoe UI,sans-serif;display:flex}
  #side{width:300px;padding:12px;overflow:auto;background:#f6f7f9;border-right:1px solid #ddd;font-size:13px}
  #stage{flex:1;overflow:hidden}svg{width:100%;height:100%;display:block}.edge{stroke:#cfd6dd;fill:none}
  #filter{width:96%;padding:4px}details{margin:3px 0}summary{cursor:pointer;font-weight:600}
  #rst{width:100%;margin:8px 0;padding:6px;cursor:pointer;background:#fff;border:1px solid #bbb;border-radius:6px;font-size:13px}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
  #nodedisp{margin-top:6px;padding:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:12px}
  #nodedisp b{font-size:13px}
  #nodedisp ul{margin:4px 0;padding-left:16px}
  #nodedisp li{font-size:11px;color:#333}
  </style></head><body><div id="side"><h2>${esc(title)} — ${n} states, ${edges.length} edges</h2>
  <p><span class="dot" style="background:#0a7d33"></span>home<br><span class="dot" style="background:#3a9a5f"></span>route home<br><span class="dot" style="background:#e8950c"></span>no route home (approx) (${nohomeList.length})<br><span class="dot" style="background:#d63a3a"></span>dead-end (${deadList.length})</p>
  <button id="rst" title="Reset pan/zoom to show the whole graph">⟲ Reset view</button>
  <input id="filter" placeholder="highlight edges by call…">
  <h3 style="font-size:13px;margin:10px 0 4px">Selected formation</h3>
  <div id="nodedisp"><i>Click a node to see its calls.</i></div>
  <details><summary>Dead-end formations (${deadList.length})</summary><div style="color:#a52828">${deadList.map(esc).join('<br>') || 'none'}</div></details>
  <details><summary>No route home (${nohomeList.length})</summary><div style="color:#b97608">${nohomeList.map(esc).join('<br>') || 'none'}</div></details>
  </div><div id="stage"><svg viewBox="0 0 2000 2000">${edgeSvg}${nodeSvg}</svg></div>
  <script type="application/json" id="nodedata">${JSON.stringify(nodeList)}</script>
  <script type="application/json" id="topo">${JSON.stringify(pos.map((p) => [Math.round(p.x), Math.round(p.y)]))}</script>
  <script>
  const edges=[...document.querySelectorAll('.edge')];const f=document.getElementById('filter');
  function paint(){const q=f.value.trim().toLowerCase();edges.forEach(e=>{e.style.opacity=e.dataset.calls.toLowerCase().includes(q)?'1':'0.04';});}
  f.addEventListener('input',paint);
  const svg=document.querySelector('svg'),st=document.getElementById('stage');let dragging=false,sx=0,sy=0,vb=svg.viewBox.baseVal;
  // Keep node icons/labels a constant SCREEN size as the viewBox zooms: the
  // viewBox scale factor is vb.width/2000, so counter-scale node geometry by it.
  const rescale=()=>{const k=vb.width/2000;document.querySelectorAll('.nd').forEach(c=>c.setAttribute('r',(parseFloat(c.dataset.r)*k).toFixed(2)));document.querySelectorAll('.ndt').forEach(t=>{const r=parseFloat(t.dataset.r);t.setAttribute('y',(r*k+17*k).toFixed(2));t.style.fontSize=(16*k)+'px';});};
  st.addEventListener('pointerdown',e=>{dragging=true;sx=e.clientX;sy=e.clientY;});window.addEventListener('pointerup',()=>dragging=false);
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
  const showNode=i=>{disp.textContent='';if(!NODEINFO[i])return;const nd=NODEINFO[i];const t=document.createElement('div');t.innerHTML='<b>'+nd.name+'</b>';disp.appendChild(t);const b=document.createElement('div');b.style.color=STC[nd.status]||'#333';b.textContent=stText[nd.status]||nd.status;disp.appendChild(b);if(nd.calls.length){const h=document.createElement('div');h.textContent='Calls from here ('+nd.calls.length+'):';disp.appendChild(h);const ul=document.createElement('ul');nd.calls.forEach(c=>{const li=document.createElement('li');li.textContent=c.call+' → '+c.to;ul.appendChild(li);});disp.appendChild(ul);}else{const d=document.createElement('div');d.textContent='No calls leave this formation.';disp.appendChild(d);}};
  document.querySelectorAll('.node').forEach(nd=>nd.addEventListener('click',()=>showNode(parseInt(nd.dataset.i,10))));
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
    let temp=0,pinned=-1,running=false;
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
    nodes.forEach((g,i)=>{g.style.cursor='grab';g.addEventListener('pointerdown',e=>{e.stopPropagation();pinned=i;const p=toWorld(e);X[i]=p[0];Y[i]=p[1];apply();temp=Math.max(temp,22);if(!running){running=true;requestAnimationFrame(step);}});});
    window.addEventListener('pointermove',e=>{if(pinned<0)return;const p=toWorld(e);X[pinned]=p[0];Y[pinned]=p[1];apply();});
    window.addEventListener('pointerup',()=>{pinned=-1;});
    apply();
  })();
  </script></body></html>`;
}
