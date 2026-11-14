import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { scan } from "../audit-run.ts";
import { Jev } from "../jev.ts";
import type { AskClient } from "../jev.ts";
import type { Rule } from "../types.ts";
import type { Options, Log } from "./args.ts";
import { DEFAULT_CACHE_PATH } from "../cache.ts";

export async function cmdScan(rules: Rule[], opts: Options, cachePath: string | null, out: Log, log: Log, client: AskClient | null): Promise<number> {
  try {
    if (!opts.repository || !opts.runId || !opts.namespace) throw new Error("scan needs --repository, --run-id and --namespace");
    const cwd = process.cwd();
    const cache = opts.cache === DEFAULT_CACHE_PATH ? null : cachePath;
    if (cache && (resolve(cache) === cwd || resolve(cache).startsWith(`${cwd}${sep}`))) throw new Error("scan cache must be outside the source snapshot");
    const sourceSha = opts.sourceSha ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const report = await scan({ cwd, rules, paths: opts.paths, policyRef: opts.policyRef,
      identity: { runId: opts.runId, repository: opts.repository, sourceSha }, namespace: opts.namespace, cachePath: cache,
      client: client ?? new Jev({ model: opts.model, baseUrl: opts.baseUrl }), endpointIdentity: client instanceof Jev ? client.endpointIdentity : client ? `injected:${client.model}` : undefined,
      ...(opts.modelRevision === null ? {} : { modelRevision: opts.modelRevision }),
      ...(opts.maxCandidates === null ? {} : { maxCandidates: opts.maxCandidates }),
      dryRun: opts.dryRun, concurrency: opts.concurrency, batchSize: opts.batchSize, group: opts.group, exclude: opts.exclude, languages: opts.languages });
    out(JSON.stringify(report, null, 2));
    return report.status === "complete" ? 0 : 3;
  } catch (error) { log(`scan: ${(error as Error).message}`); return 2; }
}
