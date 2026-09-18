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
const L1o = boardForFasrCode("L1o", tpl).board;
const flat = seq.flatten(mod.steps);
const ring = seq.evaluateSequence(flat, seq.sequenceBeats(flat, L1o), L1o).board;
const deg = (h) => Math.round(h * 180 / Math.PI);
// THE DANCER EACH DANCER IS LOOKING AT: the one nearest to the ray leaving them along their heading.
for (const d of [...ring.dancers].sort((a,c)=>a.id-c.id)) {
  const dx = Math.cos(d.heading), dy = Math.sin(d.heading);
  let best = null, bestT = Infinity;
  for (const o of ring.dancers) {
    if (o.id === d.id) continue;
    const vx = o.x - d.x, vy = o.y - d.y;
    const t = vx * dx + vy * dy;                 // distance along the facing
    const perp = Math.abs(-vx * dy + vy * dx);   // sideways offset from the facing line
    if (t > 0.5 && perp < 1.5 && t < bestT) { bestT = t; best = o; }
  }
  console.log(`  #${d.id} c${d.couple} ${d.gender.padEnd(4)} h${String(deg(d.heading)).padStart(4)}  faces ${best ? `#${best.id} c${best.couple} ${best.gender}` : "nobody"}  at ${best ? bestT.toFixed(1) : "-"} units, side-offset ${best ? (Math.abs(-( best.x-d.x)*dy + (best.y-d.y)*dx)).toFixed(2) : "-"}`);
}
console.log("\nring radii / headings:");
console.log("  " + [...ring.dancers].sort((a,c)=>a.id-c.id).map((d)=>`#${d.id} c${d.couple} r${Math.hypot(d.x,d.y).toFixed(2)} h${deg(d.heading)}`).join("  "));
