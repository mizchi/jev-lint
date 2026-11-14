import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { reviewScan, reviewRelations } from "../review-artifact.ts";
import { parseRelationInput } from "../relation-contract.ts";
import type { RelationPlanOptions } from "../relation-plan.ts";
import { acceptFindings, compareAcceptedFindings, pruneAcceptedFindings, parseAcceptedFindings } from "../acceptance.ts";
import { artifactSarif } from "../sarif.ts";
import type { Options, Log } from "./args.ts";

function write(path: string, value: unknown): void {
  const target = resolve(path), temporary = `${target}.${randomUUID()}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  try { writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
}
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
export function cmdArtifact(command: "baseline" | "report", opts: Options, out: Log, log: Log): number {
  try {
    if (!opts.artifact) throw new Error("--artifact is required");
    if (command === "baseline" && (!opts.scopeId || !opts.modelRevision)) throw new Error("baseline needs --scope-id and --model-revision");
    const raw = read(opts.artifact) as { schema?: string }, scope = { scopeId: opts.scopeId ?? "local", ...(opts.modelRevision ? { modelRevision: opts.modelRevision } : {}) };
    let options: RelationPlanOptions = {};
    if (opts.relationOptions) {
      const parsed = read(opts.relationOptions);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !["baseSha", "changedPaths", "maxRelations", "maxContextChars"].includes(key))) throw new Error("invalid relation planning options");
      options = parsed as RelationPlanOptions;
    }
    const review = raw?.schema === "jev-lint-scan-1" ? reviewScan(raw, scope)
      : opts.relationInput ? reviewRelations(raw, parseRelationInput(read(opts.relationInput)), scope, options) : (() => { throw new Error("relations require --relation-input"); })();
    if (command === "report") {
      if (opts.paths.length) throw new Error("report does not accept positional paths");
      const value = opts.format === "sarif" ? artifactSarif(review) : review;
      if (opts.output) write(opts.output, value); else out(JSON.stringify(value, null, 2));
      return review.status === "complete" ? 0 : 3;
    }
    const action = opts.paths[0];
    if (opts.paths.length !== 1 || !["write", "compare", "prune"].includes(action)) throw new Error("baseline needs write, compare or prune");
    if (!opts.acceptedBaseline) throw new Error("--baseline is required");
    const target = resolve(opts.acceptedBaseline);
    if (target === resolve(".jev-lint/baseline.json") || /\/rules\/[^/]+\/[^/]+\/baseline\.json$/.test(target)) throw new Error("accepted findings must not overwrite verdict caches or rule baselines");
    if (action !== "compare" && review.status !== "complete") { out(JSON.stringify({ status: review.status, qualityVerdict: "UNREVIEWED", error: "incomplete review cannot change an acceptance baseline" })); return 3; }
    if (action === "write") {
      if (existsSync(target)) parseAcceptedFindings(read(target));
      const accepted = acceptFindings(review); write(target, accepted); out(JSON.stringify(accepted, null, 2)); return 0;
    }
    const baseline = parseAcceptedFindings(read(target));
    if (action === "prune") { const pruned = pruneAcceptedFindings(baseline, review); write(target, pruned); out(JSON.stringify(pruned, null, 2)); return 0; }
    const comparison = compareAcceptedFindings(review, baseline); out(JSON.stringify(comparison, null, 2)); return comparison.exitCode;
  } catch (error) { log(`${command}: ${(error as Error).message}`); return 2; }
}
