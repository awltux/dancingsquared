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
import type { ItemKey, ItemStore, StoredItem } from '../ports.ts';

/** The key as one string, so a `Map` can hold it: the store only ever needs equality, never ordering. */
const flat = (key: ItemKey): string => `${key.pk}\u0000${key.sk}`;

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

  /** How many keys are held. For a probe's own bookkeeping and the dev server's `/health`. */
  get size(): number {
    return this.items.size;
  }
}
