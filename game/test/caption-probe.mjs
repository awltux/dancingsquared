// THE CAPTION OVER A BOARD, AND THE PROVENANCE ITS HOVER TEXT CARRIES.
//
// REPORTED: "Sometimes the couple colouring isnt what I'd expect for the setup name, so I wanted a way to identify the
// source XML element so I can verify where it's coming from." The hover is the SETUP ID (`S1-…`), and this probe pins
// the three properties that make it usable for that:
//
//   1. the WORDS are unchanged from the inline version they were extracted from (`main.ts` before this module), byte for
//      byte including the em dash — the player-visible caption must not move because a diagnostic was added;
//   2. the ID is the board's own `setupId`, so it is the same for the same setup wherever it is drawn (translated,
//      turned a quarter) and it is ABSENT for a board with no physical dancers rather than the word "null";
//   3. the ID tells apart what the NAME and the ARRANGEMENT cannot — the whole reason the diagnostic exists. The
//      negative control is the column's own construction: exchanging two dancers' places in the array leaves every
//      POSITION identical (`boardSig` equal, `sameArrangement` true, so `recognize` gives the same name and the
//      caption is identical) and changes the id, because the id keeps the array order that the colouring reads.
//
// Usage: node game/test/caption-probe.mjs   (engine must be built: the module imports `setupId`)
import { boardSig, makeSquaredSet } from 'dancing-squared-engine';
import { setupId } from 'dancing-squared-engine/ids';
import { boardCaption } from '../src/puzzle/caption.ts';
import { sameArrangement } from '../src/puzzle/arrangement.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const base = makeSquaredSet();
const caption = (spec) => boardCaption({ index: 0, label: '', ...spec });

console.log('\n== 1. the WORDS are what the screen said before the extraction ==');
{
  const named = caption({ index: 1, label: 'Ocean Wave', board: base });
  check(named.text === '2: Ocean Wave', `a named waypoint reads its position then its name (${named.text})`);
  const unnamed = caption({ index: 1, board: base });
  check(unnamed.text === '2', `an unnamed one is the position alone (${unnamed.text})`);
  const goal = caption({ index: 3, board: base });
  check(goal.text === '4', `the last waypoint is just its number (${goal.text})`);
  // NEGATIVE CONTROL: the label is the only thing that adds the separator. A caption that always appended "— " would
  // report a trailing dash here and pass the named case above, so this check is what rules that out.
  check(!unnamed.text.includes('—'), 'and NO separator is left behind when there is no name');
}

console.log('\n== 2. the HOVER is the board\u2019s setup id, and it is the same setup wherever it is drawn ==');
{
  const side = caption({ index: 0, board: base });
  check(side.hover === setupId(base), `the hover is the board's own setup id (${side.hover})`);
  check(/^S1-[0-9a-z]{8}$/.test(side.hover), 'and it is the scheme\u2019s shape, so it can be grepped in the corpus');
  check(!side.text.includes(side.hover), 'while the words the player reads carry none of it');
  // SAME SETUP, DRAWN ELSEWHERE: the id is taken over the arrangement, so a translation and a quarter turn are the same
  // source element. This is what makes the hover a provenance rather than a coordinate.
  const moved = { dancers: base.dancers.map((d) => ({ ...d, x: d.x + 3, y: d.y - 2 })) };
  const quarter = Math.PI / 2;
  const turned = {
    dancers: base.dancers.map((d) => ({
      ...d,
      x: Math.cos(quarter) * d.x - Math.sin(quarter) * d.y,
      y: Math.sin(quarter) * d.x + Math.cos(quarter) * d.y,
      heading: d.heading + quarter,
    })),
  };
  check(caption({ index: 0, board: moved }).hover === side.hover, 'a translated board reports the same id');
  check(caption({ index: 0, board: turned }).hover === side.hover, 'and so does the same board turned a quarter');
  // A BOARD WITH NOBODY ON IT has nothing to name. The refusal is an EMPTY tooltip, not "null" and not "undefined".
  check(caption({ index: 0, board: { dancers: [] } }).hover === '', 'an empty board gets no hover at all');
}

console.log('\n== 3. the ID separates what the NAME and the ARRANGEMENT cannot ==');
{
  // THE NEGATIVE CONTROL, and it is the reported question in miniature: two couples exchanged IN THE ARRAY with every
  // dancer left standing exactly where they were. `boardSig` (positions only) and `sameArrangement` (the eight
  // symmetries) are both blind to it — so the corpus names it the same, the caption reads the same, and only the setup
  // id — the pair the colouring reads off the array — changes. An implementation that hashed the positions would fail
  // exactly this check and pass every one above.
  const swapped = { dancers: base.dancers.map((d, i) => base.dancers[i === 0 ? 2 : i === 2 ? 0 : i]) };
  check(boardSig(swapped) === boardSig(base), 'the exchanged board stands on the SAME positions (boardSig equal)');
  check(sameArrangement(swapped, base), 'and is the SAME arrangement, so the name and the caption cannot differ');
  check(caption({ index: 0, board: swapped }).text === caption({ index: 0, board: base }).text, 'the words are identical, as a player sees them');
  const other = caption({ index: 0, board: swapped }).hover;
  check(other !== '' && other !== caption({ index: 0, board: base }).hover, `while the id differs, which is the whole point (${other})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
