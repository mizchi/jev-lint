/**
 * TEMPORARY: carries the 0.9 single-file stores into ledger directories.
 *
 * 0.10 replaced the verdict cache file (`.jev-lint/baseline.json`,
 * `jev-lint-cache-4`) and the document records (`jev-lint-documents-1`) with
 * append-only ledger directories (see `ledger.ts`). From 0.10.0 until
 * `LEGACY_MIGRATION.removeIn`, the CLI converts a legacy store it finds and
 * removes it, and `jev-lint ledger migrate` does the same on request. The
 * release named by `removeIn` deletes this module; `test/legacy-ledger.test.ts`
 * fails once the package version reaches it, so the removal is not forgotten.
 *
 * A migration is verified before the legacy file goes: the new ledger is read
 * back and must answer every converted key. A file of any other schema is left
 * alone -- an older cache schema answered questions keyed another way, and
 * converting it would invent answers.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { CACHE_SCHEMA, readCacheEntry } from "./cache.ts";
import { documentJudgmentKey, loadDocumentLedger } from "./documents.ts";
import { Ledger, MIGRATED_AT } from "./ledger.ts";
import { readRelationJudgment } from "./relation-contract.ts";

export const LEGACY_MIGRATION = Object.freeze({ since: "0.10.0", removeIn: "0.13.0" });
export const LEGACY_CACHE_PATH = ".jev-lint/baseline.json";

export interface MigrationResult {
  kind: "cache" | "documents" | "unsupported" | "missing";
  from: string; to: string | null; migrated: number; skipped: number; removed: boolean; reason?: string;
}

const CACHE_FILE = /(^|[/\\])baseline((?:\.openrouter-[0-9a-f]{12})?)\.json$/;
/** The ledger directory a 0.9 cache file moves to; null for a path that is not a `.json` file. */
export function legacyCacheDir(path: string): string | null {
  if (CACHE_FILE.test(path)) return path.replace(CACHE_FILE, "$1verdicts$2");
  return path.endsWith(".json") ? path.slice(0, -".json".length) : null;
}
/** The 0.9 cache file that would have held what a ledger directory holds now. */
export function legacyCacheFileFor(dir: string): string {
  const m = /(^|[/\\])verdicts((?:\.openrouter-[0-9a-f]{12})?)$/.exec(dir);
  return m ? dir.replace(/(^|[/\\])verdicts((?:\.openrouter-[0-9a-f]{12})?)$/, "$1baseline$2.json") : `${dir}.json`;
}
/** `x.record.json` and `x.json` move to the directory `x`. */
export function legacyRecordDir(path: string): string {
  return path.replace(/(\.record)?\.json$/, "");
}

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function migrateLegacyFile(file: string, { to, dryRun = false }: { to?: string; dryRun?: boolean } = {}): MigrationResult {
  const unsupported = (reason: string): MigrationResult => ({ kind: "unsupported", from: file, to: null, migrated: 0, skipped: 0, removed: false, reason });
  if (!existsSync(file)) return { kind: "missing", from: file, to: null, migrated: 0, skipped: 0, removed: false };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { return unsupported("not JSON"); }
  if (!record(raw)) return unsupported("not a JSON object");

  if (raw.schema === CACHE_SCHEMA && record(raw.entries)) {
    const dir = to ?? legacyCacheDir(file) ?? `${file}.d`;
    const ledger = Ledger.load(dir, CACHE_SCHEMA, readCacheEntry);
    let skipped = 0;
    for (const [key, value] of Object.entries(raw.entries)) {
      const entry = readCacheEntry(value);
      if (!entry) { skipped += 1; continue; }
      try { ledger.put(key, entry, isTime(entry.at) ? entry.at : MIGRATED_AT); } catch { skipped += 1; }
    }
    return finish("cache", file, dir, ledger, skipped, dryRun, typeof raw.model === "string" ? raw.model : null,
      () => Ledger.load(dir, CACHE_SCHEMA, readCacheEntry));
  }

  if (raw.schema === "jev-lint-documents-1" && Array.isArray(raw.candidates)) {
    if (typeof raw.model !== "string" || typeof raw.questionDigest !== "string") return unsupported("a record without its model or question cannot be keyed");
    const dir = to ?? legacyRecordDir(file);
    const ledger = loadDocumentLedger(dir);
    let skipped = 0;
    for (const c of raw.candidates as unknown[]) {
      const candidate = c as Record<string, any>;
      const judgment = record(candidate) && candidate.judgment ? readRelationJudgment({ ...candidate.judgment, type: "choice" }) : null;
      if (!judgment || typeof candidate.id !== "string" || !record(candidate.reference) || !record(candidate.target) || !Array.isArray(candidate.context)) { skipped += 1; continue; }
      const key = documentJudgmentKey(candidate as never, raw.questionDigest, raw.model);
      // Dated at the epoch: a record carried over never outranks an answer recorded since.
      ledger.put(key, { judgment, comparisonId: candidate.id, target: String(candidate.target.path) }, MIGRATED_AT);
    }
    return finish("documents", file, dir, ledger, skipped, dryRun, raw.model, () => loadDocumentLedger(dir));
  }
  return unsupported(`schema ${String(raw.schema ?? "none").slice(0, 40)} is not a 0.9 store this release converts`);
}

function finish<V>(kind: "cache" | "documents", file: string, dir: string, ledger: Ledger<V>, skipped: number, dryRun: boolean, model: string | null, reload: () => Ledger<V>): MigrationResult {
  const keys = ledger.keys();
  const migrated = ledger.pendingCount;
  if (dryRun) return { kind, from: file, to: dir, migrated, skipped, removed: false };
  try { ledger.flush({ model, migratedFrom: basename(file) }); }
  catch (err) { return { kind, from: file, to: dir, migrated, skipped, removed: false, reason: `could not write ${dir} (${String(err).slice(0, 120)}); the legacy file is kept` }; }
  const back = reload();
  const lost = keys.filter((k) => !back.has(k));
  if (lost.length) return { kind, from: file, to: dir, migrated, skipped, removed: false, reason: `${lost.length} converted entr${lost.length === 1 ? "y" : "ies"} did not read back; the legacy file is kept` };
  rmSync(file, { force: true });
  return { kind, from: file, to: dir, migrated, skipped, removed: true };
}

/** One line for a log, naming what moved, where, and until when this happens on its own. */
export function describeMigration(r: MigrationResult): string {
  if (r.kind === "unsupported") return `${r.from}: left as is (${r.reason})`;
  if (r.kind === "missing") return `${r.from}: not found`;
  const what = r.kind === "cache" ? "verdict(s)" : "document judgment(s)";
  const tail = r.removed ? `; removed ${basename(r.from)}` : r.reason ? `; ${r.reason}` : "";
  return `migrated ${r.migrated} ${what} from ${r.from} to ${r.to}/${r.skipped ? ` (${r.skipped} unusable skipped)` : ""}${tail}. `
    + `jev-lint ${LEGACY_MIGRATION.since} stores answers in append-only ledger directories; this automatic migration is removed in ${LEGACY_MIGRATION.removeIn}`;
}

/** The 0.9 cache files a directory might still hold, default and per-provider. */
export function legacyCacheFilesIn(dir: string): string[] {
  const base = join(dir, ".jev-lint");
  try {
    return readdirSync(base).filter((n) => CACHE_FILE.test(`/${n}`)).map((n) => join(base, n)).sort();
  } catch { return []; }
}
