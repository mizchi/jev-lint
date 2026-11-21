/**
 * `jev-lint ledger migrate` and `jev-lint ledger compact`.
 *
 * `migrate` converts the 0.9 single-file stores (it is the script behind the
 * automatic migration, and goes with it in LEGACY_MIGRATION.removeIn).
 * `compact` folds a ledger's files into one. Run it on the main branch: it
 * removes the files it read, and a branch that still adds files merges
 * cleanly because entries keep their original time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CACHE_SCHEMA, readCacheEntry } from "../cache.ts";
import { answeringModel } from "../model.ts";
import { DEFAULT_DOCUMENT_LEDGER, DOCUMENT_QUESTION, documentJudgmentKey, loadDocumentLedger, parseDocumentManifest, prepareDocuments } from "../documents.ts";
import { relationDigest } from "../relation-contract.ts";
import { prepareQuestion } from "../relation-questions.ts";
import { Ledger } from "../ledger.ts";
import { describeMigration, migrateLegacyFile, type MigrationResult } from "../legacy-ledger.ts";
import { standaloneModel } from "./context.ts";
import type { Log, Options } from "./args.ts";

const LEGACY_SCHEMAS = new Set([CACHE_SCHEMA, "jev-lint-documents-1"]);
/** Every 0.9 store under `.jev-lint/`, found by its schema rather than its name. */
function discover(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      const path = join(dir, name);
      let stat; try { stat = statSync(path); } catch { continue; }
      if (stat.isDirectory()) { walk(path); continue; }
      if (!name.endsWith(".json") || stat.size > 64_000_000) continue;
      try { if (LEGACY_SCHEMAS.has(JSON.parse(readFileSync(path, "utf8"))?.schema)) found.push(path); } catch { /* not a store */ }
    }
  };
  walk(join(root, ".jev-lint"));
  return found;
}

export function cmdLedger(opts: Options, out: Log, log: Log, { baseDir, cachePath }: { baseDir: string; cachePath: string | null }): number {
  const [action, ...files] = opts.paths;
  try {
    if (action === "migrate") {
      if (opts.ledger && files.length !== 1) throw new Error("--ledger names the destination of exactly one file");
      const targets = files.length ? files.map((f) => resolve(f)) : discover(baseDir);
      const results: MigrationResult[] = targets.map((file) => migrateLegacyFile(file, { dryRun: opts.dryRun, ...(opts.ledger ? { to: resolve(opts.ledger) } : {}) }));
      if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-ledger-migrate-1", dryRun: opts.dryRun, results }, null, 2));
      else if (!results.length) out("no 0.9 cache or document record found under .jev-lint/");
      else for (const r of results) out(opts.dryRun && r.kind !== "unsupported" && r.kind !== "missing" ? `would ${describeMigration(r).replace(/^migrated/, "migrate")}` : describeMigration(r));
      return results.some((r) => r.kind === "unsupported" || r.kind === "missing" || (!opts.dryRun && !r.removed)) ? 3 : 0;
    }
    if (action === "compact") {
      if (files.length) throw new Error("usage: jev-lint ledger compact [--ledger <dir>] [--document-manifest <path>] [--dry-run]");
      let summary: Record<string, unknown>;
      if (opts.documentManifest) {
        const input = prepareDocuments(parseDocumentManifest(JSON.parse(readFileSync(resolve(opts.documentManifest), "utf8"))));
        if (input.issues.length || input.deferred.length || input.unboundDocuments.length) {
          log(`ledger: ${input.issues.length} issue(s), ${input.deferred.length} deferred comparison(s) and ${input.unboundDocuments.length} document(s) without a comparison in the snapshot; their answers would be dropped as dead, so nothing was compacted`);
          return 3;
        }
        // The id the scanning client keyed its answers on, not the requested string.
        const model = answeringModel(standaloneModel(opts, process.cwd()), opts.baseUrl);
        const questionDigest = relationDigest({ q0000: prepareQuestion(DOCUMENT_QUESTION) });
        const live = new Set(input.comparisons.map((c) => documentJudgmentKey(c, questionDigest, model)));
        summary = run(loadDocumentLedger(resolve(opts.ledger ?? DEFAULT_DOCUMENT_LEDGER)), live, opts.dryRun);
      } else {
        const dir = opts.ledger ? resolve(opts.ledger) : cachePath;
        if (!dir) throw new Error("the verdict cache is disabled; name a ledger with --ledger");
        const verdicts = Ledger.load(dir, CACHE_SCHEMA, readCacheEntry);
        // A directory of document judgments compacts too; without a manifest it only loses duplicates.
        summary = run<unknown>(verdicts.sources.length ? verdicts : loadDocumentLedger(dir), null, opts.dryRun);
      }
      if (opts.format === "json") out(JSON.stringify(summary, null, 2));
      else out(`${opts.dryRun ? "would keep" : "kept"} ${summary.kept} entr${summary.kept === 1 ? "y" : "ies"} and drop ${summary.dropped}, folding ${summary.files} file(s) in ${summary.dir}`);
      return 0;
    }
    throw new Error("usage: jev-lint ledger migrate [files...] [--dry-run] | jev-lint ledger compact [--ledger <dir>] [--document-manifest <path>] [--dry-run]");
  } catch (err) { log(`ledger: ${(err as Error).message}`); return 2; }
}

function run<V>(ledger: Ledger<V>, live: Set<string> | null, dryRun: boolean): Record<string, unknown> {
  for (const e of ledger.loadErrors) process.stderr.write(`ledger: ${e}\n`);
  const all = ledger.keys(), kept = live ? all.filter((k) => live.has(k)).length : all.length;
  const base = { schema: "jev-lint-ledger-compact-1", dir: ledger.dir, namespace: ledger.namespace, files: ledger.sources.length, dryRun };
  if (dryRun) return { ...base, kept, dropped: all.length - kept, path: null };
  const result = ledger.compact(live ? { live } : {});
  return { ...base, kept: result.kept, dropped: result.dropped, path: result.path };
}
