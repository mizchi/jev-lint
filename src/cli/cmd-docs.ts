import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Jev } from "../jev.ts";
import type { AskClient } from "../jev.ts";
import { prepareDocuments, scanDocuments, parseDocumentManifest, parseDocumentReport, documentExitCode, type DocumentReport } from "../documents.ts";
import type { Options, Log } from "./args.ts";

export async function cmdDocs(opts: Options, out: Log, log: Log, client: AskClient | null): Promise<number> {
  try {
    if (opts.format === "sarif" || opts.format === "github") throw new Error("documents support text or JSON output");
    if (opts.paths.length !== (opts.replay ? 1 : 0) || opts.replay && (opts.dryRun || opts.record)) throw new Error("use docs --replay <record.json>, or docs [--dry-run] [--record <path>]");
    const manifestPath = resolve(opts.documentManifest ?? ".jev-lint/documents.json");
    const loadManifest = () => parseDocumentManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const manifest = loadManifest();
    const input = prepareDocuments(manifest);
    if (opts.record && (input.sources.some((s) => resolve(s.path) === resolve(opts.record!)) || manifestPath === resolve(opts.record))) throw new Error("a document record must not overwrite its inputs");
    if (opts.dryRun) {
      out(JSON.stringify({ schema: "jev-lint-documents-plan-1", input, modelRequests: 0, qualityVerdict: "UNREVIEWED" }, null, 2));
      return input.issues.length || input.deferred.length || input.unboundDocuments.length ? 3 : 0;
    }
    let report: DocumentReport;
    if (opts.replay) {
      const raw = JSON.parse(readFileSync(resolve(opts.paths[0]), "utf8"));
      try { report = parseDocumentReport(raw, input); }
      catch { out(JSON.stringify({ schema: "jev-lint-documents-stale-1", status: "stale", snapshotDigest: input.snapshotDigest, qualityVerdict: "UNREVIEWED" })); log("documentation record is invalid or stale; run docs --record with the current sources"); return 3; }
    } else {
      const unchanged = () => prepareDocuments(loadManifest()).snapshotDigest === input.snapshotDigest;
      report = await scanDocuments(input, { client: client ?? new Jev({ model: opts.model, baseUrl: opts.baseUrl,
        beforeSend: async () => { if (!unchanged()) throw new Error("documentation snapshot changed"); },
        budget: { maxRequests: 200, maxInputTokens: 400000, maxUsd: 0.05, maxMs: 300000 },
      }), snapshotCheck: unchanged });
      if (opts.record) {
        const target = resolve(opts.record), temporary = `${target}.${randomUUID()}.tmp`;
        mkdirSync(dirname(target), { recursive: true });
        try { writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target); }
        finally { rmSync(temporary, { force: true }); }
      }
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
      out(`${report.coverage.answered}/${report.coverage.expected} comparisons answered; ${report.coverage.contradictions} contradictions; ${report.coverage.unassessed} unassessed; ${report.status}; UNREVIEWED`);
    }
    return documentExitCode(report);
  } catch (error) { log(`docs: ${(error as Error).message}`); return 2; }
}
