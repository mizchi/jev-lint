export interface Item { id: string; text: string }
export type Decide = (items: readonly Item[], decisionKey: string) => Promise<number>;

export interface DecisionStore {
  get(key: string): number | undefined | Promise<number | undefined>;
  save(key: string, score: number): number | Promise<number>;
}

const utf8 = new TextEncoder();
async function decisionKey(identity: string, batch: readonly Item[]): Promise<string> {
  const bytes = utf8.encode(JSON.stringify([identity, batch]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface Options {
  items: readonly Item[];
  decide: Decide;
  /** Include the provider, model and question in the identity. */
  identity: string;
  store: DecisionStore;
  groupSize: number;
  maxCalls: number;
  pruneBelow: number;
  maxBytes?: number;
}

export async function run({ items, decide, identity, store, groupSize, maxCalls, pruneBelow, maxBytes = 8192 }: Options) {
  for (const [name, value, min] of [["groupSize", groupSize, 1], ["maxBytes", maxBytes, 1], ["maxCalls", maxCalls, 0]] as const) {
    if (!Number.isSafeInteger(value) || value < min) throw Error("Invalid " + name);
  }
  if (!(pruneBelow >= 0 && pruneBelow <= 0.5)) throw Error("pruneBelow must be between 0 and 0.5");
  const seen = new Set<string>();
  const records = items.map(({ id, text }) => {
    if (typeof id !== "string" || !id || typeof text !== "string" || !text.trim()) throw Error("Expected id and text");
    if (seen.has(id)) throw Error("Duplicate id: " + id);
    seen.add(id);
    const record = { id, text };
    if (utf8.encode(JSON.stringify([record])).byteLength > maxBytes) throw Error("Oversized input: " + id);
    return record;
  });
  const result = { complete: true, matches: [] as string[], decisions: 0, inputBytes: 0, newCalls: 0 };
  async function visit(batch: Item[]): Promise<boolean> {
    const payload = JSON.stringify(batch);
    const bytes = utf8.encode(payload).byteLength;
    if (bytes <= maxBytes) {
      const key = await decisionKey(identity, batch);
      let score = await store.get(key);
      if (score === undefined) {
        if (result.newCalls >= maxCalls) return false;
        score = await decide(batch, key);
        if (!Number.isFinite(score) || score < 0 || score > 1) throw Error("Invalid decision score");
        score = await store.save(key, score);
        result.newCalls++;
      }
      result.decisions++;
      result.inputBytes += bytes;
      if (batch.length === 1) {
        if (score >= 0.5) result.matches.push(batch[0].id);
        return true;
      }
      if (score < pruneBelow) return true;
    }
    const mid = Math.ceil(batch.length / 2);
    return await visit(batch.slice(0, mid)) && await visit(batch.slice(mid));
  }
  for (let i = 0; i < records.length; i += groupSize) {
    if (!(await visit(records.slice(i, i + groupSize)))) {
      result.complete = false;
      break;
    }
  }
  return result;
}
