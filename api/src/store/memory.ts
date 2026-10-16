// The in-memory store: the twin the local dev server boots with and every probe drives.
//
// WHY A TWIN AND NOT A MOCK. It implements the SAME contract as the DynamoDB adapter — including the
// compare-and-set, the revision and the not-found case — so a handler that is correct here is exercising the
// same protocol it will use in production. What it does not reproduce is DynamoDB's failure modes (a
// throttled write, a 400 KB item limit, a conditional check on a GSI) and that gap is the reason a
// `DSQ_STORE=dynamodb` run against DynamoDB Local exists at all: this twin proves the RULES, that proves the
// ADAPTER, and neither claims to be the other.
//
// THE CLONE IS THE POINT. A real store serialises, so a handler that kept a reference to what it read could
// not corrupt it. `structuredClone` on the way in and out makes that true here too, and it is what would
// catch a handler that mutates the array it was given instead of writing a new one — a bug the twin would
// otherwise hide by sharing the object.
import type { ItemKey, ItemQuery, ItemStore, StoreWrite, StoredItem } from '../ports.ts';
import { INDEX_ATTRIBUTES } from '../keys.ts';

/** The character between the two halves of a flattened key. It cannot occur in a `pk` or an `sk` this API writes. */
const SEPARATOR = '\u0000';

/** The key as one string, so a `Map` can hold it: the store only ever needs equality, never ordering. */
const flat = (key: ItemKey): string => `${key.pk}${SEPARATOR}${key.sk}`;

interface Entry {
  rev: number;
  value: Record<string, unknown>;
}

export class MemoryStore implements ItemStore {
  private readonly items = new Map<string, Entry>();

  async get(key: ItemKey): Promise<StoredItem | null> {
    const entry = this.items.get(flat(key));
    if (!entry) return null;
    return { rev: entry.rev, value: structuredClone(entry.value) };
  }

  /**
   * Read one partition, in sort-key order — of the base table, or of a named INDEX.
   *
   * THE SORT IS THE CONTRACT AND NOT A CONVENIENCE: DynamoDB returns a partition in sort-key order, so a handler
   * that received these in `Map` insertion order would behave differently in production than under the twin — the
   * divergence this twin exists to make impossible. The comparison is on the raw sort key, which is what DynamoDB
   * compares (its own byte order), not on anything parsed out of it.
   *
   * AN INDEX IS A PROJECTION OF THE SAME ITEMS, AND THE TWIN MODELS IT THAT WAY: this map holds one entry per ITEM
   * keyed by its `PK`/`SK`, and an index read takes each item's partition and order from the ATTRIBUTES it carries
   * (`keys.ts`'s `INDEX_ATTRIBUTES`) — which is exactly what DynamoDB's GSI does. A row that lacks them is simply
   * not in the index, so it cannot appear in an index answer. An index THIS STORE DOES NOT KNOW throws rather than
   * answering empty: an empty answer is a legitimate board nobody is on, and the two must not look alike.
   */
  async query(request: ItemQuery): Promise<StoredItem[]> {
    const index = request.index === undefined ? null : INDEX_ATTRIBUTES[request.index];
    if (request.index !== undefined && index === undefined) {
      throw new Error(`no index named ${request.index} in this store`);
    }
    const found: { sk: string; entry: Entry }[] = [];
    for (const [id, entry] of this.items) {
      const cut = id.indexOf(SEPARATOR);
      const rowPk = index ? entry.value[index.pk] : id.slice(0, cut);
      const sk = index ? entry.value[index.sk] : id.slice(cut + 1);
      if (typeof rowPk !== 'string' || typeof sk !== 'string') continue;
      if (rowPk !== request.pk) continue;
      if (request.skPrefix !== undefined && !sk.startsWith(request.skPrefix)) continue;
      found.push({ sk, entry });
    }
    found.sort((left, right) => (left.sk < right.sk ? -1 : left.sk > right.sk ? 1 : 0));
    if (request.descending === true) found.reverse();
    return found.slice(0, request.limit).map(({ entry }) => ({ rev: entry.rev, value: structuredClone(entry.value) }));
  }

  async put(key: ItemKey, value: Readonly<Record<string, unknown>>, expectedRev: number | null): Promise<boolean> {
    const id = flat(key);
    const current = this.items.get(id);
    // THE CONDITION IS THE WHOLE METHOD. `null` means create-only, a number means still-at-that-revision, and
    // anything else is another writer having moved first — which is reported, never thrown, because the caller
    // is expected to re-read.
    if (expectedRev === null ? current !== undefined : current?.rev !== expectedRev) return false;
    this.items.set(id, { rev: (current?.rev ?? 0) + 1, value: structuredClone(value) });
    return true;
  }

  /**
   * Check every condition, then apply every write.
   *
   * THE TWO LOOPS WITH NO `await` BETWEEN THEM ARE THE ATOMICITY. JavaScript runs this function to completion
   * once it starts (there is no await inside either loop), so no other task can observe the map between the
   * check and the apply — which is the same guarantee DynamoDB gives across items, arrived at differently.
   */
  async transact(writes: readonly StoreWrite[]): Promise<boolean> {
    const seen = new Set<string>();
    for (const write of writes) {
      const id = flat(write.key);
      if (seen.has(id)) throw new Error(`a transaction cannot write ${id} twice`);
      seen.add(id);
    }
    for (const write of writes) {
      const current = this.items.get(flat(write.key));
      if (write.expectedRev === null ? current !== undefined : current?.rev !== write.expectedRev) return false;
    }
    for (const write of writes) {
      const current = this.items.get(flat(write.key));
      this.items.set(flat(write.key), { rev: (current?.rev ?? 0) + 1, value: structuredClone(write.value) });
    }
    return true;
  }

  /** How many keys are held. For a probe's own bookkeeping and the dev server's `/health`. */
  get size(): number {
    return this.items.size;
  }
}
