// A DOMAIN VALUE AS A DYNAMODB ITEM: the one rule for what an `undefined` becomes.
//
// WHY THIS MODULE EXISTS. `@aws-sdk/util-dynamodb` refuses to marshal a map or list that CONTAINS `undefined`:
//
//   Error: Pass options.removeUndefinedValues=true to remove undefined values from map/array/set.
//
// and it is not a corner case here — it is the shape of the data. MEASURED, on the first attempt to run the API against
// DynamoDB Local (`npm run dev:api:ddb`): the boot died publishing the local fixture, because a board's dancers carry
// `lastTurnDir` PRESENT-AND-UNDEFINED on the waypoints a turn did not touch and ABSENT on the start board. Every memory-store
// probe was green at the time, and had been for months: an object in memory holds such a key happily, so the two stores
// disagreed about whether that value could be stored at all — and only the store nobody ran in development noticed.
//
// WHY NOT THE CLIENT'S `removeUndefinedValues`. It is the documented switch, and it applies to EVERY write in the process,
// including a caller's genuine mistake, with no place to say so. This is one decision, at the one conversion, in a module a
// probe can drive without a container (AGENTS.md §4.3, §4.5).
//
// WHAT `undefined` MEANS IS "ABSENT", and that is why dropping it is the right conversion rather than a lossy shortcut:
// JSON has no `undefined`, the reader cannot tell the difference (`value.lastTurnDir === undefined` is true for a missing
// key and for one set to undefined), and `null` — which DynamoDB *can* store — would be a THIRD value that the domain never
// meant. A list is the one case that cannot drop an element without renumbering it, so an undefined ELEMENT becomes `null`
// and the length is preserved.

/** What an undefined value inside a list becomes, because dropping it would move every later element's index. */
const ABSENT_ELEMENT = null;

/**
 * A plain deep copy of `value` with every `undefined` object entry omitted and every undefined list element nulled.
 *
 * IT COPIES RATHER THAN MUTATES: `value` is the domain's, and a store that edited it would change what the caller still
 * holds — including what the in-memory twin would have kept, which is the divergence this file exists to prevent.
 */
export function plainItem(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((element) => (element === undefined ? ABSENT_ELEMENT : plainItem(element)));
  // A DATE, A MAP OR A SET WOULD EACH NEED ITS OWN RULE, and none reaches a store here: `value` is the JSON-ish shape the
  // handlers build. A class instance would arrive as `{ ...value }` at the call site and lose its prototype, so this copy
  // is the same thing DynamoDB would store either way.
  const copy: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value as Record<string, unknown>)) {
    if (field === undefined) continue;
    copy[name] = plainItem(field);
  }
  return copy;
}
