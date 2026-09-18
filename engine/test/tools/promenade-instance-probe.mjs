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
const home = seq.boardForFormation("Static Square");
const L1o = boardForFasrCode("L1o", tpl).board;
const mid = seq.evaluateSequence(seq.flatten(mod.steps), seq.sequenceBeats(seq.flatten(mod.steps), L1o), L1o).board;

const pair = (b) => { const m = new Map(); for (const d of b.dancers) { const k = d.couple > 0 ? d.couple : 0; m.set(k, [...(m.get(k) ?? []), d.id]); } return m; };
const report = (label, start, call) => {
  const flat = [call];
  const total = seq.sequenceBeats(flat, start);
  if (total <= 0) { console.log(`${label.padEnd(28)} ${call.padEnd(22)} does not apply`); return; }
  const prev = new Map(); const travel = new Map(); const signs = new Map();
  for (let b = 0; b <= total + 1e-9; b += 0.25) {
    const board = seq.evaluateSequence(flat, Math.min(b, total), start).board;
    const X = board.dancers.reduce((s,d)=>s+d.x,0)/board.dancers.length, Y = board.dancers.reduce((s,d)=>s+d.y,0)/board.dancers.length;
    for (const d of board.dancers) {
      const a = Math.atan2(d.y - Y, d.x - X); const p = prev.get(d.id);
      if (p !== undefined) { let da = a - p; while (da > Math.PI) da -= 2*Math.PI; while (da < -Math.PI) da += 2*Math.PI;
        travel.set(d.id, (travel.get(d.id) ?? 0) + da);
        if (Math.abs(da) > 1e-4) signs.set(d.id, new Set([...(signs.get(d.id) ?? []), Math.sign(da)])); }
      prev.set(d.id, a);
    }
  }
  const rev = [...signs.values()].filter((s) => s.size > 1).length;
  const net = [...travel.values()];
  const per = [...travel.entries()].sort((a,c)=>a[0]-c[0]).map(([id,t])=>`#${id}:${(t*180/Math.PI).toFixed(0)}`).join(" ");
  // couple midpoints at start and end
  const pm = pair(start).size <= 1 ? "" : "";
  console.log(`${label.padEnd(28)} ${call.padEnd(22)} ${total.toFixed(0)}b  reversing ${rev}/8   net ${per} ${pm}`);
};
report("home (known-good)", home, "Promenade");
report("home (known-good)", home, "Promenade 1/2");
report("7046 ring", mid, "Promenade");
report("7046 ring", mid, "Promenade 1/2");
console.log("\nstart ring couples/positions:");
const by = pair(mid);
for (const [c, ids] of [...by].sort((a,b)=>a[0]-b[0])) {
  console.log(`  couple ${c}: ` + ids.map((id) => { const d = mid.dancers.find((x)=>x.id===id); return `#${id} ${d.gender} (${d.x.toFixed(1)},${d.y.toFixed(1)}) h${Math.round(d.heading*180/Math.PI)}`; }).join("   "));
}
