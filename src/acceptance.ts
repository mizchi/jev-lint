import { digest } from "./scan-contract.ts";
import { parseReviewArtifact, type ReviewArtifact } from "./review-artifact.ts";

export interface AcceptedFindings {
  schema: "jev-lint-accepted-findings-1"; repository: string; scopeId: string;
  acceptedFrom: { sourceSha: string; runId: string; artifactDigest: string; modelRevision: string };
  entries: Array<{ key: string; fingerprint: string; count: number }>;
}
export interface AcceptedComparison {
  schema: "jev-lint-accepted-comparison-1"; qualityVerdict: "UNREVIEWED";
  counts: { accepted: number; new: number; recheck: number; resolved: number; unassessed: number };
  observations: Array<{ id: string; disposition: "accepted" | "new" | "recheck" | "resolved" | "unassessed" | "clean" }>;
  resolved: AcceptedFindings["entries"]; exitCode: 0 | 1 | 3;
}

export function parseAcceptedFindings(raw: unknown): AcceptedFindings {
  const fail = (): never => { throw new Error("invalid accepted-findings baseline"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const r = raw as AcceptedFindings;
  if (r.schema !== "jev-lint-accepted-findings-1" || typeof r.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r.repository)
    || r.repository.split("/").some((part) => part === "." || part === "..") || typeof r.scopeId !== "string" || !r.scopeId.trim() || r.scopeId.length > 128
    || !r.acceptedFrom || !/^[a-f0-9]{40}$/.test(r.acceptedFrom.sourceSha) || typeof r.acceptedFrom.runId !== "string" || !r.acceptedFrom.runId.trim()
    || !/^[a-f0-9]{64}$/.test(r.acceptedFrom.artifactDigest) || typeof r.acceptedFrom.modelRevision !== "string" || !r.acceptedFrom.modelRevision.trim()
    || !Array.isArray(r.entries) || r.entries.length > 100000) return fail();
  const keys = new Set<string>();
  for (const e of r.entries) {
    if (!e || !/^[a-f0-9]{64}$/.test(e.key) || !/^[a-f0-9]{64}$/.test(e.fingerprint) || !Number.isSafeInteger(e.count) || e.count < 1 || e.count > 100000
      || keys.has(`${e.key}:${e.fingerprint}`)) return fail();
    keys.add(`${e.key}:${e.fingerprint}`);
  }
  return structuredClone(r);
}

function complete(review: ReviewArtifact): void {
  if (review.status !== "complete") throw new Error("cannot change a baseline from an incomplete review");
  if (!review.modelRevision) throw new Error("acceptance requires an immutable model revision");
}
export function acceptFindings(raw: ReviewArtifact): AcceptedFindings {
  const review = parseReviewArtifact(raw); complete(review);
  const entries = new Map<string, AcceptedFindings["entries"][number]>();
  for (const o of review.observations.filter((o) => o.state === "finding")) {
    const id = digest([o.key, o.fingerprint]), existing = entries.get(id);
    if (existing) existing.count++; else entries.set(id, { key: o.key, fingerprint: o.fingerprint!, count: 1 });
  }
  return { schema: "jev-lint-accepted-findings-1", repository: review.repository, scopeId: review.scopeId,
    acceptedFrom: { sourceSha: review.sourceSha, runId: review.runId, artifactDigest: review.artifactDigest, modelRevision: review.modelRevision! },
    entries: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key) || a.fingerprint.localeCompare(b.fingerprint)) };
}

export function compareAcceptedFindings(raw: ReviewArtifact, rawBaseline: AcceptedFindings): AcceptedComparison {
  const review = parseReviewArtifact(raw), baseline = parseAcceptedFindings(rawBaseline);
  if (baseline.repository !== review.repository || baseline.scopeId !== review.scopeId) throw new Error("accepted-findings repository/scope mismatch");
  const remaining = baseline.entries.map((e) => ({ ...e }));
  const counts = { accepted: 0, new: 0, recheck: 0, resolved: 0, unassessed: 0 };
  const observations: AcceptedComparison["observations"] = [], resolved: AcceptedComparison["resolved"] = [];
  // Reserve exact matches first: input order cannot let an altered copy consume an unchanged one's allowance.
  const ordered = [...review.observations].sort((a, b) => Number(!remaining.some((e) => e.key === a.key && e.fingerprint === a.fingerprint))
    - Number(!remaining.some((e) => e.key === b.key && e.fingerprint === b.fingerprint))
    || Number(a.state !== "finding") - Number(b.state !== "finding") || a.id.localeCompare(b.id));
  for (const o of ordered) {
    const exact = remaining.find((e) => e.count > 0 && e.key === o.key && e.fingerprint === o.fingerprint);
    const entry = exact ?? remaining.find((e) => e.count > 0 && e.key === o.key);
    let disposition: AcceptedComparison["observations"][number]["disposition"];
    if (o.state === "unassessed") { disposition = "unassessed"; if (entry) entry.count--; }
    else if (o.state === "clean") {
      // A different context or model is not proof that an accepted finding was fixed.
      disposition = exact && review.status === "complete" ? "resolved" : entry ? "unassessed" : "clean";
      if (entry) entry.count--;
      if (disposition === "resolved") resolved.push({ key: exact!.key, fingerprint: exact!.fingerprint, count: 1 });
    } else if (exact) { disposition = "accepted"; exact.count--; }
    else if (entry) { disposition = "recheck"; entry.count--; }
    else disposition = "new";
    observations.push({ id: o.id, disposition });
    if (disposition !== "clean") counts[disposition]++;
  }
  counts.unassessed += remaining.reduce((sum, e) => sum + e.count, 0);
  return { schema: "jev-lint-accepted-comparison-1", qualityVerdict: "UNREVIEWED", counts, observations, resolved,
    exitCode: review.status !== "complete" || !review.modelRevision ? 3 : counts.new || counts.recheck ? 1 : 0 };
}

export function pruneAcceptedFindings(rawBaseline: AcceptedFindings, raw: ReviewArtifact): AcceptedFindings {
  const review = parseReviewArtifact(raw); complete(review);
  const baseline = parseAcceptedFindings(rawBaseline), compared = compareAcceptedFindings(review, baseline);
  const removals = new Map<string, number>();
  for (const e of compared.resolved) { const key = digest([e.key, e.fingerprint]); removals.set(key, (removals.get(key) ?? 0) + e.count); }
  return { ...baseline, entries: baseline.entries.map((e) => ({ ...e, count: e.count - (removals.get(digest([e.key, e.fingerprint])) ?? 0) })).filter((e) => e.count > 0) };
}
