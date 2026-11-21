import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { answeringModel, createModelClient } from "../model.ts";
import type { AskClient } from "../jev.ts";
import { prepareDocuments, scanDocuments, replayDocuments, loadDocumentLedger, parseDocumentManifest, documentExitCode, DEFAULT_DOCUMENT_LEDGER, type DocumentReport } from "../documents.ts";
import { describeMigration, legacyRecordDir, migrateLegacyFile } from "../legacy-ledger.ts";
import { standaloneModel } from "./context.ts";
import { confirmExecution, type Confirm } from "./confirm.ts";
import type { Options, Log } from "./args.ts";

/**
 * TEMPORARY (until LEGACY_MIGRATION.removeIn): 0.9 took `--record <file>` and
 * `--replay <file>`. A `.json` file named either way is converted into the
 * ledger directory it becomes and removed; the run then uses that directory.
 */
function legacyLedger(opts: Options, log: Log): { ledger: string | null; error?: string } {
  const file = opts.record ?? (opts.replay ? opts.paths[0] : undefined);
  if (file === undefined) return { ledger: opts.ledger };
  if (!file.endsWith(".json")) return { ledger: null, error: "docs takes --ledger <dir>; --record and --replay <file> are the 0.9 forms and only accept a .json record" };
  const dir = opts.ledger ?? legacyRecordDir(file);
  log(`docs: ${opts.record ? "--record" : "--replay"} <file> is deprecated; use --ledger ${dir}`);
  if (existsSync(file)) log(describeMigration(migrateLegacyFile(resolve(file), { to: resolve(dir), dryRun: opts.dryRun })));
  return { ledger: dir };
}

export async function cmdDocs(opts: Options, out: Log, log: Log, client: AskClient | null, confirm?: Confirm): Promise<number> {
  try {
    if (opts.format === "sarif" || opts.format === "github") throw new Error("documents support text or JSON output");
    if (opts.resample && opts.replay) throw new Error("--resample asks again and --replay asks nothing; choose one");
    if (opts.paths.length !== (opts.replay && opts.paths[0]?.endsWith(".json") ? 1 : 0)) throw new Error("use docs [--dry-run] [--ledger <dir>] [--resample], or docs --replay [--ledger <dir>]");
    const manifestPath = resolve(opts.documentManifest ?? ".jev-lint/documents.json");
    const loadManifest = () => parseDocumentManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const manifest = loadManifest();
    const input = prepareDocuments(manifest);
    const legacyFile = opts.record ?? (opts.replay ? opts.paths[0] : undefined);
    const ledgerDir = resolve(opts.ledger ?? (legacyFile?.endsWith(".json") ? legacyRecordDir(legacyFile) : null) ?? DEFAULT_DOCUMENT_LEDGER);
    const inside = (path: string) => { const p = resolve(path); return p === ledgerDir || p.startsWith(`${ledgerDir}${sep}`); };
    // Checked before any migration writes: the ledger must not hold its own inputs.
    if (input.sources.some((s) => inside(s.path)) || inside(manifestPath)) throw new Error("the judgment ledger must not hold its own inputs");
    // Migration removes the legacy file, so it must not be one of the inputs either.
    if (legacyFile && [manifestPath, ...input.sources.map((s) => s.path)].some((p) => resolve(p) === resolve(legacyFile))) throw new Error("a document record must not overwrite its inputs");
    const legacy = legacyLedger(opts, log);
    if (legacy.error) throw new Error(legacy.error);
    const dir = resolve(legacy.ledger ?? DEFAULT_DOCUMENT_LEDGER);
    if (opts.dryRun) {
      out(JSON.stringify({ schema: "jev-lint-documents-plan-1", input, modelRequests: 0, qualityVerdict: "UNREVIEWED" }, null, 2));
      return input.issues.length || input.deferred.length || input.unboundDocuments.length ? 3 : 0;
    }
    const ledger = loadDocumentLedger(dir);
    for (const error of ledger.loadErrors) log(`docs: ${error}`);
    let report: DocumentReport;
    if (opts.replay) {
      // Keyed on the id the scanning client reported, e.g. `typesafe/jev-1.14` for `openrouter:typesafe/jev-1.14`.
      report = replayDocuments(input, ledger, { model: client ? client.model : answeringModel(standaloneModel(opts, process.cwd()), opts.baseUrl) });
    } else {
      opts.model = standaloneModel(opts, process.cwd());
      const stopped = await confirmExecution(opts, client, out, log, confirm);
      if (stopped !== null) return stopped;
      const unchanged = () => prepareDocuments(loadManifest()).snapshotDigest === input.snapshotDigest;
      const asker = client ?? createModelClient({ model: opts.model, baseUrl: opts.baseUrl,
        beforeSend: async () => { if (!unchanged()) throw new Error("documentation snapshot changed"); },
        budget: { maxRequests: 200, maxInputTokens: 400000, maxUsd: 0.05, maxMs: 300000 },
      });
      report = await scanDocuments(input, { client: asker, snapshotCheck: unchanged, ledger, resample: opts.resample });
      // Answers are keyed on what was compared, so they stay valid even when the snapshot moved mid-run.
      ledger.flush({ model: report.model });
    }
    if (opts.format === "json") out(JSON.stringify(report, null, 2));
    else {
      for (const c of report.candidates.filter((c) => c.judgment?.choice !== "supports")) {
        out(`${c.judgment?.choice ?? "no-verdict"}: ${c.id} — ${c.topic}`);
        out(`  reference: ${c.reference.path}:${c.reference.startLine}-${c.reference.endLine}`);
        out(`  target: ${c.target.path}:${c.target.startLine}-${c.target.endLine}`);
      }
      for (const issue of input.issues) out(`${issue.path}: ${issue.code}`);
      for (const path of input.unboundDocuments) out(`${path}: no declared comparison`);
      out(`${report.coverage.answered}/${report.coverage.expected} comparisons answered (${report.coverage.reused} from the ledger); ${report.coverage.contradictions} contradictions; ${report.coverage.unassessed} unassessed; ${report.status}; UNREVIEWED`);
    }
    return documentExitCode(report);
  } catch (error) { log(`docs: ${(error as Error).message}`); return 2; }
}
