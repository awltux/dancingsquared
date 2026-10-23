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
const show = (label, b) => {
  console.log(`\n${label}  (ARRAY order, index: id c# gender @(x,y))`);
  b.dancers.forEach((d, i) => console.log(`   ${i}: #${d.id} c${d.couple} ${d.gender.padEnd(4)} (${d.x.toFixed(1)},${d.y.toFixed(1)}) h${Math.round(d.heading*180/Math.PI)}`));
  console.log(`   gender by index: ${b.dancers.map((d)=> d.gender === "boy" ? "B" : "g").join("")}`);
};
show("boardForFormation('Normal Lines') - the letter-L TEMPLATE", seq.boardForFormation("Normal Lines"));
show("boardForFasrCode('L1o') - what 7046 should stand up", boardForFasrCode("L1o", tpl).board);
const home = seq.boardForFormation("Static Square");
show("boardForFormation('Static Square') - the default board", home);
console.log("\nIF the views were built on the template and the poses come from L1o, line x=-2 gets indices", 
  boardForFasrCode("L1o", tpl).board.dancers.map((d,i)=>`${i}:${d.x<0?"L":"R"}`).join(" "));
