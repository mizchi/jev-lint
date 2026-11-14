import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { run, type RunOptions } from "./run.ts";
import { Jev, DEFAULT_MODEL } from "./jev.ts";
import { buildScanResult, type ScanIdentity, type ScanResultV1 } from "./audit.ts";
export { buildScanResult, parseScanResult, SCAN_SCHEMA, QUESTION_SCHEMA } from "./audit.ts";
export { resolvePolicySource } from "./policy-source.ts";
export type { ScanResultV1, ScanCandidateV1, ScanCoverageV1, ScanIdentity } from "./audit.ts";

export interface ScanOptions extends Omit<RunOptions, "strictCache"> {
  identity: ScanIdentity;
  namespace: string;
  endpointIdentity?: string;
  maxCandidates?: number;
  modelRevision?: string;
}

function assertSnapshot(cwd: string, sha: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha) || git("rev-parse", "HEAD") !== sha || git("status", "--porcelain", "--untracked-files=normal")) throw new Error("scan needs a clean checkout of the requested source snapshot");
}

/** Run in a dispatcher-owned, read-only checkout; cache files belong outside it. */
export async function scan({ identity, namespace, endpointIdentity, maxCandidates, modelRevision, ...options }: ScanOptions): Promise<ScanResultV1> {
  const cwd = resolve(options.cwd ?? process.cwd());
  assertSnapshot(cwd, identity.sourceSha);
  if (options.rules.length === 0) throw new Error("scan needs an explicit nonempty rule set");
  if (options.cachePath && !modelRevision?.trim()) throw new Error("cached scans need an immutable modelRevision");
  const cachePath = options.cachePath ? resolve(options.cachePath) : null;
  if (cachePath && (cachePath === cwd || cachePath.startsWith(`${cwd}${sep}`))) throw new Error("scan cache must be outside the source snapshot");
  const client = options.client ?? new Jev({ apiKey: options.apiKey, model: options.model, ...options.requestControls });
  const endpoint = endpointIdentity ?? (client instanceof Jev ? client.endpointIdentity : null);
  if (!namespace.trim() || !endpoint) throw new Error("scan needs a tenant namespace and an explicit endpoint identity for custom clients");
  const before = { ...client.spent };
  const result = await run({ ...options, cwd, cachePath, client, honorSuppressions: options.honorSuppressions ?? false,
    strictCache: { namespace, repository: identity.repository, endpoint,
    model: JSON.stringify([modelRevision ?? null, client.model ?? options.model ?? DEFAULT_MODEL]) } });
  result.spent = { ...result.spent, calls: Math.max(0, result.spent.calls - before.calls), inputTokens: Math.max(0, result.spent.inputTokens - before.inputTokens), usd: Math.max(0, result.spent.usd - before.usd) };
  assertSnapshot(cwd, identity.sourceSha);
  return buildScanResult(result, identity, { maxCandidates });
}
