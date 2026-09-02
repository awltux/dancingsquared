// FSM visual generator — renders the transition table as an interactive SVG/HTML
// that highlights dead-end formations and where calls are used.
//
// Run: `node poc-teacher/scripts/fsm-visual.mjs [out.html]` from repo root.
// Writes a self-contained HTML file (default poc-teacher/fsm-visual.html).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';
import { buildCatalog, makeSequencer } from '../../poc-teacher/src/catalog.ts';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const assets = path.join(root, 'poc', 'src', 'assets');

const msFiles = {};
for (const f of readdirSync(path.join(assets, 'ms')).filter((f) => f.endsWith('.xml'))) {
  msFiles[`ms/${f}`] = read(`poc/src/assets/ms/${f}`);
}
const catalog = buildCatalog(msFiles);
const familyMap = new Map(catalog.map((c) => [c.title, c.family ?? '']));
const seq = makeSequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'), catalog);
const fsm = seq.transitionTable();

const states = fsm.states();
const HOME = 'Static Square';
const idx = new Map(states.map((s, i) => [s, i]));
// node label: strip @embed prefix, keep readable
const label = (s) => (s.startsWith('@embed') ? `embedded #${s.slice(7)}` : s);

// outgoing edges per state + dead-end (no outgoing call)
const outgoing = states.map((s) => fsm.edgesFor(s));
const hasOutgoing = states.map((s) => fsm.edgesFor(s).length > 0);

// Build graph s->t by matching each edge's endFormation to a state key.
// Edges whose end lands on a state with a different key (embedded) or unknown
// are kept as '-> name' but only counted as outgoing (they still mark s live).
const graph = states.map(() => []);
const edges = []; // {from, to, call}
for (let i = 0; i < states.length; i++) {
  for (const e of fsm.edgesFor(states[i])) {
    const t = idx.get(e.endFormation);
    if (t !== undefined) { graph[i].push(t); edges.push({ from: i, to: t, call: e.call }); }
  }
}

// can-reach-home: reverse BFS over the state graph from HOME
const canHome = new Set([idx.get(HOME)]);
{
  const q = [idx.get(HOME)];
  while (q.length) {
    const cur = q.pop();
    for (let i = 0; i < graph.length; i++) {
      if (!canHome.has(i) && graph[i].includes(cur)) { canHome.add(i); q.push(i); }
    }
  }
}

// Node category for colouring:
//  red   = dead-end: no outgoing call at all (stuck)
//  orange= has outgoing call but no route home via named formations
//  green = has a route home
//  home  = the squared set (distinct)
const status = (i) => {
  if (states[i] === HOME) return 'home';
  if (!hasOutgoing[i]) return 'dead';
  return canHome.has(i) ? 'ok' : 'nohome';
};
const dead = states.map((_, i) => status(i) === 'dead');
const nohome = states.map((_, i) => status(i) === 'nohome');

// ---- deterministic force-directed layout ----
const n = states.length;
const pos = Array.from({ length: n }, (_, i) => ({
  x: Math.cos((i / n) * 2 * Math.PI) * (n * 0.4),
  y: Math.sin((i / n) * 2 * Math.PI) * (n * 0.4),
}));
const rand = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const area = 900 * 900;
const k = Math.sqrt(area / n);
function fr(temp) {
  const disp = pos.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      let dist = Math.hypot(dx, dy) || 0.001;
      const rep = (k * k) / dist;
      const fx = (rep * dx) / dist, fy = (rep * dy) / dist;
      disp[i].x += fx; disp[i].y += fy; disp[j].x -= fx; disp[j].y -= fy;
    }
  }
  for (const e of edges) {
    const a = e.from, b = e.to;
    let dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const att = (dist * dist) / k;
    const fx = (att * dx) / dist, fy = (att * dy) / dist;
    disp[a].x += fx; disp[a].y += fy; disp[b].x -= fx; disp[b].y -= fy;
  }
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(disp[i].x, disp[i].y) || 1;
    pos[i].x += (disp[i].x / d) * Math.min(d, temp);
    pos[i].y += (disp[i].y / d) * Math.min(d, temp);
  }
}
for (let it = 0; it < 400; it++) fr(300 * (1 - it / 400) + 1);
// normalize to viewBox 100..1900
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const p of pos) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
const S = 1800 / Math.max(1e-6, maxX - minX);
for (const p of pos) { p.x = 100 + (p.x - minX) * S; p.y = 100 + (p.y - minY) * S; }

// family of an edge (for colour/filter)
const famOf = (call) => familyMap.get(call) ?? '';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FILL = { home: '#0a7d33', ok: '#3a9a5f', nohome: '#e8950c', dead: '#d63a3a' };
const STROKE = { home: '#064d1e', ok: '#2f7a49', nohome: '#b97608', dead: '#a52828' };

const nodeSvg = states.map((s, i) => {
  const st = status(i);
  const p = pos[i];
  return `<g class="node" data-status="${st}" data-i="${i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
    <title>${esc(label(s))}${st === 'dead' ? ' — DEAD END (no call)' : st === 'nohome' ? ' — no route home' : ''}</title>
    <circle class="nd" data-r="${st === 'home' ? 20 : 13}" r="${st === 'home' ? 20 : 13}" fill="${FILL[st]}" stroke="${STROKE[st]}" stroke-width="1.5"/>
    <text class="ndt" data-r="${st === 'home' ? 20 : 13}" y="${(st === 'home' ? 20 : 13) + 17}" text-anchor="middle" font-size="10" fill="#222">${esc(s.startsWith('@embed') ? '#' + s.slice(7) : s)}</text>
  </g>`;
}).join('');

const edgeGroups = new Map(); // from->to family -> calls[]
for (const e of edges) {
  const f = famOf(e.call) || '(other)';
  const key = `${e.from}|${e.to}`;
  const g = edgeGroups.get(key) ?? new Map();
  const arr = g.get(f) ?? [];
  arr.push(e.call); g.set(f, arr); edgeGroups.set(key, g);
}
const edgeSvg = [];
for (const [key, famMap] of edgeGroups) {
  const [a, b] = key.split('|').map(Number);
  for (const [f, calls] of famMap) {
    const x1 = pos[a].x, y1 = pos[a].y, x2 = pos[b].x, y2 = pos[b].y;
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
    const r = f === '(other)' ? 1.5 : 1.2;
    edgeSvg.push(`<line class="edge" data-fam="${esc(f)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke-width="${r}" vector-effect="non-scaling-stroke" data-calls="${esc(calls.join(' ; '))}"><title>${esc(f)}: ${esc(calls.join(' ; '))}</title></line>`);
  }
}

const fams = [...new Set([...familyMap.values()].filter(Boolean))].sort();
const callList = [...new Set(edges.map((e) => e.call))].sort();
const deadList = states.filter((_, i) => dead[i]).map(label);
const nohomeList = states.filter((_, i) => nohome[i] && !dead[i]).map(label);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>FSM visual — ${n} states</title>
<style>
  html,body{height:100%;overflow:hidden;overscroll-behavior:none;margin:0}
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;display:flex}
  #side{width:320px;padding:12px;overflow:auto;background:#f6f7f9;border-right:1px solid #ddd;font-size:13px}
  #side h2{font-size:16px;margin:6px 0}
  #stage{flex:1;overflow:hidden;background:#fff;position:relative}
  svg{width:100%;height:100%;display:block}
  .edge{stroke:#cfd6dd;fill:none}
  .node{cursor:pointer}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:middle}
  details{margin:4px 0}
  summary{cursor:pointer;font-weight:600}
  .calltab{display:inline-block;margin:2px;padding:1px 6px;border:1px solid #ccc;border-radius:10px;cursor:pointer;font-size:12px}
  .calltab.on{background:#2b6cb0;color:#fff}
  input#filter{width:96%;padding:4px}
</style></head><body>
<div id="side">
  <h2>FSM — ${n} states, ${edges.length} call-edges</h2>
  <p><span class="dot" style="background:#0a7d33"></span>${esc(HOME)} (home)<br>
     <span class="dot" style="background:#3a9a5f"></span>has route home<br>
     <span class="dot" style="background:#e8950c"></span>outgoing call but no named route home (${nohomeList.length})<br>
     <span class="dot" style="background:#d63a3a"></span>DEAD END — no call from here (${deadList.length})</p>
  <h2>Highlight a call</h2>
  <input id="filter" placeholder="type a call to highlight its edges…">
  <h2>Families (click to isolate)</h2>
  <div id="fams">${fams.map((f) => `<span class="calltab" data-fam="${esc(f)}">${esc(f)}</span>`).join('')}</div>
  <h2>Calls used (${callList.length})</h2>
  <details open><summary>show</summary><div id="calls">${callList.map((c) => `<span class="calltab" data-call="${esc(c)}">${esc(c)}</span>`).join('')}</div></details>
  <details><summary>Dead-end formations (${deadList.length})</summary><div style="color:#a52828">${deadList.map(esc).join('<br>') || 'none'}</div></details>
  <details><summary>No route home (${nohomeList.length})</summary><div style="color:#b97608">${nohomeList.map(esc).join('<br>') || 'none'}</div></details>
</div>
<div id="stage"><svg viewBox="0 0 2000 2000" id="svg">${edgeSvg.join('')}${nodeSvg}</svg></div>
<script>
const svg=document.getElementById('svg');
const edges=[...document.querySelectorAll('.edge')], nodes=[...document.querySelectorAll('.node')];
const filter=document.getElementById('filter');
let activeFam=new Set(), activeCall=new Set();
function paint(){
  const q=filter.value.trim().toLowerCase();
  edges.forEach(e=>{
    const fam=e.dataset.fam, calls=e.dataset.calls.toLowerCase();
    const hitCall=activeCall.size===0 ? !q || calls.includes(q) : [...activeCall].some(c=>calls.includes(c));
    const hit=hitCall && (activeFam.size===0 || activeFam.has(fam));
    e.style.opacity=hit?'1':'0.05';
  });
  nodes.forEach(nd=>{const s=nd.dataset.status; nd.style.opacity=activeFam.size||activeCall.size||q?(s==='home'||s==='dead'||s==='nohome'?'0.5':'0.9'):1;});
}
filter.addEventListener('input',paint);
document.querySelectorAll('[data-fam]').forEach(t=>{if(t.closest('#fams'))t.addEventListener('click',()=>{const f=t.dataset.fam;if(activeFam.has(f))activeFam.delete(f);else activeFam=new Set([f]);document.querySelectorAll('#fams .calltab').forEach(x=>x.classList.toggle('on',activeFam.has(x.dataset.fam)));paint();});});
document.querySelectorAll('[data-call]').forEach(t=>t.addEventListener('click',()=>{const c=t.dataset.call;if(activeCall.has(c))activeCall.delete(c);else activeCall=new Set([c]);document.querySelectorAll('#calls .calltab').forEach(x=>x.classList.toggle('on',activeCall.has(x.dataset.call)));paint();}));
// simple pan/zoom; nodes keep a constant SCREEN size via counter-scaling
let dragging=false,sx=0,sy=0,vb=svg.viewBox.baseVal;
const rescale=()=>{const k=vb.width/2000;document.querySelectorAll('.nd').forEach(c=>c.setAttribute('r',(parseFloat(c.dataset.r)*k).toFixed(2)));document.querySelectorAll('.ndt').forEach(t=>{const r=parseFloat(t.dataset.r);t.setAttribute('y',(r*k+17*k).toFixed(2));t.style.fontSize=(10*k)+'px';});};
svg.parentElement.addEventListener('pointerdown',e=>{dragging=true;sx=e.clientX;sy=e.clientY;});
window.addEventListener('pointerup',()=>dragging=false);
svg.parentElement.addEventListener('pointermove',e=>{if(!dragging)return;vb.x-=(e.clientX-sx);vb.y-=(e.clientY-sy);sx=e.clientX;sy=e.clientY;});
svg.parentElement.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const rect=svg.getBoundingClientRect();if(rect.width<=0)return;const px=e.clientX-rect.left,py=e.clientY-rect.top;const s=vb.width/rect.width;const vx=vb.x+px*s,vy=vb.y+py*s;const z=e.deltaY<0?0.9:1.1;vb.width*=z;vb.height*=z;vb.x=vx-px*(vb.width/rect.width);vb.y=vy-py*(vb.height/rect.height);rescale();},{passive:false});
rescale();
</script></body></html>`;

const outFile = process.argv[2] || path.join(root, 'poc-teacher', 'fsm-visual.html');
writeFileSync(outFile, html, 'utf8');
console.log(`wrote ${outFile}`);
console.log(`states=${n} edges=${edges.length} dead-end=${deadList.length} no-home=${nohomeList.length}`);
