import { execFileSync } from "node:child_process";
import { parseRelationInput, relationDigest, relationPath, type RelationInput, type RelationSubject, type RelationEvidence, type RelationPlan, type SpecSource } from "./relation-contract.ts";

export interface RelationPlanOptions { changedPaths?: string[]; baseSha?: string; maxRelations?: number; maxContextChars?: number }
export type SpecSourceManifest = Omit<SpecSource, "content" | "contentHash">;

/** Reading git blobs never executes checkout filters or repository code. */
export function readSpecSources(cwd: string, manifest: readonly SpecSourceManifest[]): SpecSource[] {
  const pins = new Map<string, string>();
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });
  try {
    return manifest.map((source) => {
      if (!relationPath(source.path)) throw new Error();
      const ref = pins.get(source.ref) ?? git("rev-parse", "--verify", "--end-of-options", `${source.ref}^{commit}`).trim();
      pins.set(source.ref, ref);
      const entry = git("ls-tree", "-z", ref, "--", source.path).split("\0").filter(Boolean);
      if (entry.length !== 1 || !/^100(?:644|755) blob [a-f0-9]+\t/.test(entry[0]!) || entry[0]!.split("\t").slice(1).join("\t") !== source.path) throw new Error();
      const content = git("show", `${ref}:${source.path}`);
      if (content.length > 128000) throw new Error();
      return { id: source.id, path: source.path, ref, kind: source.kind, authority: source.authority, scope: [...source.scope], approval: source.approval ? { ...source.approval } : null,
        content, contentHash: relationDigest(content) };
    });
  } catch { throw new Error("cannot read pinned specification source"); }
}

export function relationState(input: RelationInput, relation: RelationSubject) {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const expand = (evidence: RelationEvidence) => {
    const source = sourceById.get(evidence.sourceId)!;
    return { path: source.path, ref: source.ref, kind: source.kind, authority: source.authority, scope: source.scope, approval: source.approval,
      startLine: evidence.startLine, endLine: evidence.endLine, quote: evidence.quote };
  };
  const claim = input.claims.find((item) => item.id === relation.claimId)!;
  return { specification: { statement: claim.statement, evidence: claim.evidence.map(expand) }, targets: relation.targets.map(expand), context: relation.context.map(expand) };
}

/** Explicit links form the reverse dependency index; missing links remain visible in the ledger. */
export function planRelations(raw: RelationInput, { changedPaths, baseSha, maxRelations, maxContextChars = 64000 }: RelationPlanOptions = {}): RelationPlan {
  const input = parseRelationInput(raw);
  if (maxRelations !== undefined && (!Number.isSafeInteger(maxRelations) || maxRelations < 0)
    || !Number.isSafeInteger(maxContextChars) || maxContextChars < 1
    || changedPaths !== undefined && (!Array.isArray(changedPaths) || !changedPaths.every(relationPath))
    || baseSha !== undefined && (!/^[a-f0-9]{40}$/.test(baseSha) || changedPaths === undefined)) throw new Error("invalid relation plan options");
  const plan: RelationPlan = { ...(baseSha === undefined ? {} : { baseSha }), changedPaths: changedPaths === undefined ? null : [...new Set(changedPaths)].sort(), selected: [], excluded: [] };
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  for (const relation of input.relations) {
    const claim = input.claims.find((item) => item.id === relation.claimId)!;
    const dependencies = [...claim.evidence, ...relation.targets, ...relation.context].map((e) => sources.get(e.sourceId)!);
    const approved = claim.evidence.map((e) => sources.get(e.sourceId)!).filter((source) => source.authority === "approved");
    let reason: RelationPlan["excluded"][number]["reason"] | null = null;
    if (changedPaths !== undefined && !dependencies.some((source) => changedPaths.includes(source.path))) reason = "outside-change";
    else if (approved.length && !relation.targets.every((target) => approved.some((source) => source.scope.some((root) => root === "." || sources.get(target.sourceId)!.path === root || sources.get(target.sourceId)!.path.startsWith(`${root}/`))))) reason = "outside-scope";
    else if (plan.selected.length >= (maxRelations ?? Infinity)) reason = "relation-budget";
    else if (JSON.stringify(relationState(input, relation)).length > maxContextChars) reason = "context-budget";
    if (reason) plan.excluded.push({ relationId: relation.id, reason });
    else plan.selected.push(relation.id);
  }
  return plan;
}

export function planRelationDiff(input: RelationInput, { cwd, baseSha, ...options }: Omit<RelationPlanOptions, "changedPaths" | "baseSha"> & { cwd: string; baseSha: string }): RelationPlan {
  parseRelationInput(input);
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("relation diff needs an immutable base SHA");
  try {
    const changedPaths = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", baseSha, input.sourceSha, "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
    return planRelations(input, { ...options, changedPaths, baseSha });
  } catch { throw new Error("cannot plan pinned relation diff"); }
}
