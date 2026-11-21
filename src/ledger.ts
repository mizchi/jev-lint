/**
 * The judgment ledger: where recorded model answers live in a repository.
 *
 * A model answer is a sample, not a fact, and a repository is edited on many
 * branches at once. Until 0.10 each store was one JSON file rewritten whole on
 * every run, so two branches that both learned something rewrote the same file
 * and Git could not merge them. The ledger is shaped so Git never has to:
 *
 *   - **Append-only files.** A run that learned something adds one new file,
 *     named `<UTC time>-<random>.jsonl`; it never edits an earlier one. Two
 *     branches add two differently named files, and their merge is the union.
 *   - **Content-addressed keys.** The caller's key covers what the model was
 *     shown and nothing else, so an unrelated edit retires no answer, and a key
 *     already in the ledger is never asked again. A re-run is not a re-roll.
 *   - **Self-contained entries, one per line, sorted by key.** No aggregate
 *     (counts, coverage, a digest of everything) is stored: those are derived
 *     on every read, and a stored one would be the line every branch edits.
 *   - **The latest answer of a key wins**, by its `at` time, so the union of
 *     two branches resolves without asking which branch was merged first.
 *
 * Files accumulate; `compact` folds the ones it read into one file, keeping
 * the latest entry of each key (and, given the live keys, only those). It
 * deletes only files it read, so a file another branch adds meanwhile
 * survives, and entries keep their original `at`, so a compacted file and a
 * branch's newer file still resolve correctly after a merge.
 *
 * Like the verdict cache before it, reading never throws: a malformed line, a
 * foreign schema or an unreadable file is a miss with a note in `loadErrors`.
 * It is trusted input all the same -- anything that can add a file here can
 * answer a question -- so it belongs in review, next to the rules.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LEDGER_SCHEMA = "jev-lint-ledger-1";
export interface LedgerHeader { schema: typeof LEDGER_SCHEMA; namespace: string; written: string; model?: string | null; compacted?: true; migratedFrom?: string }
export interface LedgerEntry<V> { key: string; at: string; value: V }
export interface CompactResult { kept: number; dropped: number; removed: string[]; path: string | null }
/** An entry dated here loses to any answer recorded after it: used for answers carried over from a legacy store. */
export const MIGRATED_AT = "1970-01-01T00:00:00.000Z";

const KEY = /^[\w.:-]{1,256}$/;
const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));

/** `20261122T010203004Z-1a2b3c4d.jsonl`: sorts chronologically, unique per writer. */
export function ledgerFileName(at: Date = new Date()): string {
  return `${at.toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}.jsonl`;
}

interface Resolved<V> { at: string; value: V; file: string }

export class Ledger<V> {
  readonly dir: string;
  readonly namespace: string;
  readonly loadErrors: string[] = [];
  /** The ledger files this instance read; compaction removes exactly these. */
  readonly sources: string[] = [];
  private readonly resolved = new Map<string, Resolved<V>>();
  private readonly pending = new Map<string, LedgerEntry<V>>();

  private constructor(dir: string, namespace: string) { this.dir = dir; this.namespace = namespace; }

  /** `read` validates one stored value; null makes the entry a miss. */
  static load<V>(dir: string, namespace: string, read: (raw: unknown) => V | null): Ledger<V> {
    const ledger = new Ledger<V>(dir, namespace);
    let names: string[];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort(); }
    catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") ledger.loadErrors.push(`ledger at ${dir} unreadable (${code ?? String(err).slice(0, 80)}); ignoring it`);
      return ledger;
    }
    for (const name of names) {
      const path = join(dir, name);
      let lines: string[];
      try { if (!statSync(path).isFile()) continue; lines = readFileSync(path, "utf8").split("\n"); }
      catch { ledger.loadErrors.push(`${path}: unreadable; ignoring it`); continue; }
      let header: Partial<LedgerHeader> | null = null;
      try { header = JSON.parse(lines[0]); } catch { /* reported below */ }
      if (!header || header.schema !== LEDGER_SCHEMA) {
        ledger.loadErrors.push(`${path}: not a ${LEDGER_SCHEMA} file${header?.schema ? ` (${String(header.schema).slice(0, 40)})` : ""}; ignoring it`);
        continue;
      }
      if (header.namespace !== namespace) continue;
      ledger.sources.push(path);
      let bad = 0;
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        let raw: Partial<LedgerEntry<unknown>> | null = null;
        try { raw = JSON.parse(line); } catch { /* counted */ }
        const value = raw && typeof raw.key === "string" && KEY.test(raw.key) && isTime(raw.at) ? read(raw.value) : null;
        if (!raw || value === null) { bad += 1; continue; }
        ledger.accept(raw.key!, { at: raw.at!, value, file: name });
      }
      if (bad) ledger.loadErrors.push(`${path}: ${bad} unusable entr${bad === 1 ? "y" : "ies"} ignored`);
    }
    return ledger;
  }

  private accept(key: string, next: Resolved<V>): void {
    const current = this.resolved.get(key);
    // The later instant wins -- parsed, so an offset time orders by when it
    // was, not by its text; on a tie the later file does, and files are read
    // in name order.
    const order = current ? Date.parse(next.at) - Date.parse(current.at) : 1;
    if (order > 0 || (order === 0 && next.file >= current!.file)) this.resolved.set(key, next);
  }

  /** The winning entry of a key: a pending answer wins only when it is not older than the stored one. */
  private winner(key: string): LedgerEntry<V> | null {
    const pending = this.pending.get(key), stored = this.resolved.get(key);
    if (pending && (!stored || Date.parse(pending.at) >= Date.parse(stored.at))) return pending;
    return stored ? { key, at: stored.at, value: stored.value } : null;
  }

  get(key: string): V | null { return this.winner(key)?.value ?? null; }
  has(key: string): boolean { return this.pending.has(key) || this.resolved.has(key); }
  get size(): number { return new Set([...this.resolved.keys(), ...this.pending.keys()]).size; }
  get pendingCount(): number { return this.pending.size; }
  keys(): string[] { return [...new Set([...this.resolved.keys(), ...this.pending.keys()])].sort(); }
  entries(): Array<LedgerEntry<V>> { return this.keys().map((key) => this.winner(key)!); }

  /** Record an answer; it reaches disk on `flush`. */
  put(key: string, value: V, at: string = new Date().toISOString()): void {
    if (!KEY.test(key) || !isTime(at)) throw new Error(`invalid ledger entry ${key.slice(0, 40)}`);
    // Two answers of one key before a flush: keep the newer; on equal times, the last written.
    const current = this.pending.get(key);
    if (!current || Date.parse(at) >= Date.parse(current.at)) this.pending.set(key, { key, at, value });
  }

  private write(entries: Array<LedgerEntry<V>>, extra: Partial<LedgerHeader>): string {
    mkdirSync(this.dir, { recursive: true });
    // A file written after another must sort after it, even within one
    // millisecond: on a tie of `at`, the later file is the later answer.
    let at = new Date();
    for (const source of this.sources) {
      const stamp = /^(\d{8})T(\d{6})(\d{3})Z-/.exec(source.slice(this.dir.length + 1));
      if (!stamp) continue;
      const [, d, t, ms] = stamp;
      const time = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}.${ms}Z`);
      if (Number.isFinite(time) && time >= at.getTime()) at = new Date(time + 1);
    }
    const path = join(this.dir, ledgerFileName(at));
    const header: LedgerHeader = { schema: LEDGER_SCHEMA, namespace: this.namespace, written: new Date().toISOString(), ...extra };
    const body = [header, ...[...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))].map((e) => JSON.stringify(e)).join("\n");
    // Write-then-rename under a name the reader skips, so a reader never sees half a file.
    const tmp = `${path}.tmp`;
    try { writeFileSync(tmp, `${body}\n`); renameSync(tmp, path); }
    finally { rmSync(tmp, { force: true }); }
    return path;
  }

  /** Write what this run learned as one new file. Nothing learned, nothing written: returns null. */
  flush({ model = null, migratedFrom }: { model?: string | null; migratedFrom?: string } = {}): string | null {
    if (!this.pending.size) return null;
    const entries = [...this.pending.values()];
    const path = this.write(entries, { model, ...(migratedFrom ? { migratedFrom } : {}) });
    const name = path.slice(this.dir.length + 1);
    this.sources.push(path);
    for (const e of entries) this.accept(e.key, { at: e.at, value: e.value, file: name });
    this.pending.clear();
    return path;
  }

  /**
   * Fold every file this instance read (and anything pending) into one file.
   * With `live`, keys outside it are dropped; without it, only duplicates go.
   */
  compact({ live, model = null }: { live?: Iterable<string>; model?: string | null } = {}): CompactResult {
    const keep = live ? new Set(live) : null;
    const all = this.entries();
    const kept = all.filter((e) => !keep || keep.has(e.key));
    const removed = [...this.sources];
    if (!removed.length && !this.pending.size) return { kept: 0, dropped: 0, removed: [], path: null };
    const path = kept.length ? this.write(kept, { model, compacted: true }) : null;
    for (const file of removed) rmSync(file, { force: true });
    this.sources.length = 0; this.resolved.clear(); this.pending.clear();
    const name = path ? path.slice(this.dir.length + 1) : "";
    if (path) { this.sources.push(path); for (const e of kept) this.accept(e.key, { at: e.at, value: e.value, file: name }); }
    return { kept: kept.length, dropped: all.length - kept.length, removed, path };
  }
}
