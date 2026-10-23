import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from "../../dist/index.js";
import { callsByTitle } from "../lib/engine-calls.mjs";
import { corpusRoot } from 'dancing-squared-corpus';
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(readFileSync(path.join(assets, "moves.xml"), "utf8"), readFileSync(path.join(assets, "formations.xml"), "utf8"), callsByTitle(assets));
const tpl = (l) => { for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; } return null; };
const b = boardForFasrCode("L1o", tpl).board;
console.log("L1o, sorted by x then y:  (x,y) heading  id couple gender");
for (const d of [...b.dancers].sort((a,c)=> a.x-c.x || a.y-c.y))
  console.log(`   (${d.x.toFixed(1)},${d.y.toFixed(1)})  h${Math.round(d.heading*180/Math.PI).toString().padStart(4)}   #${d.id} c${d.couple} ${d.gender}`);
