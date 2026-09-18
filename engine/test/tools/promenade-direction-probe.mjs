import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from "../../dist/index.js";
import { callsByTitle } from "../lib/engine-calls.mjs";
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const assets = path.join(root, "poc", "src", "assets");
const seq = new Sequencer(readFileSync(path.join(assets, "moves.xml"), "utf8"), readFileSync(path.join(assets, "formations.xml"), "utf8"), callsByTitle(assets));
const tpl = (l) => { for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; } return null; };
const mod = JSON.parse(readFileSync(path.join(root, "modules/zero_line/static_set/7046.json"), "utf8"));
const start = boardForFasrCode("L1o", tpl).board;
const flat = seq.flatten([...mod.steps, "Promenade"]);
const total = seq.sequenceBeats(flat, start);
const cx = (b) => b.dancers.reduce((s,d)=>s+d.x,0)/b.dancers.length;
const cy = (b) => b.dancers.reduce((s,d)=>s+d.y,0)/b.dancers.length;
const prev = new Map();
const travel = new Map(); const dirSign = new Map();
for (let b = 0; b <= total + 1e-9; b += 0.25) {
  const board = seq.evaluateSequence(flat, Math.min(b, total), start).board;
  const X = cx(board), Y = cy(board);
  for (const d of board.dancers) {
    const a = Math.atan2(d.y - Y, d.x - X);
    const p = prev.get(d.id);
    if (p) { let da = a - p; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
      travel.set(d.id, (travel.get(d.id) ?? 0) + da);
      if (Math.abs(da) > 1e-4) dirSign.set(d.id, (dirSign.get(d.id) ?? new Set()).add(Math.sign(da))); }
    prev.set(d.id, a);
  }
}
console.log(`7046 + Promenade: ${total.toFixed(1)} beats`);
const ccw = [], cw = [], still = [], mixed = [];
for (const [id, t] of travel) {
  const signs = dirSign.get(id);
  if (!signs || signs.size === 0) still.push(id);
  else if (signs.size > 1) mixed.push(id);
  else if ([...signs][0] > 0) ccw.push(id);
  else cw.push(id);
}
console.log(`  net CCW: ${ccw.length} dancers, net CW: ${cw.length}, still: ${still.length}, REVERSING: ${mixed.length}`);
console.log(`  net travel per dancer (deg): ${[...travel.entries()].sort((a,c)=>a[0]-c[0]).map(([id,t])=>`#${id}:${(t*180/Math.PI).toFixed(0)}`).join(" ")}`);
