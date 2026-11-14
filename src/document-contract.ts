import { relationDigest, relationPath, type RelationJudgment } from "./relation-contract.ts";

export interface DocumentSelector { source: string; heading?: string; contains?: string }
export interface DocumentManifest {
  schema: "jev-lint-documents-manifest-1";
  files: Record<string, { path: string; role: "document" | "reference" | "historical" }>;
  roots?: string[]; exclude?: string[];
  comparisons: Array<{ id: string; topic: string; mode: "semantic" | "translation" | "terminology"; reference: DocumentSelector; target: DocumentSelector; context?: DocumentSelector[] }>;
}
export interface DocumentExcerpt { source: string; path: string; startLine: number; endLine: number; quote: string; contentHash: string }
export interface DocumentInput {
  schema: "jev-lint-documents-input-1"; manifestDigest: string; snapshotDigest: string;
  sources: Array<{ id: string; path: string; role: "document" | "reference" | "historical"; contentHash: string | null }>;
  comparisons: Array<{ id: string; topic: string; mode: "semantic" | "translation" | "terminology"; reference: DocumentExcerpt; target: DocumentExcerpt; context: DocumentExcerpt[] }>;
  issues: Array<{ comparisonId?: string; path: string; code: "source-unavailable" | "source-budget" | "missing-selector" | "ambiguous-selector" | "excerpt-budget" | "unregistered-document" | "inventory-unavailable" }>;
  deferred: string[]; unboundDocuments: string[]; expectedComparisons: number;
}
export type DocumentCandidate = DocumentInput["comparisons"][number] & {
  candidateId: string; contextHash: string; judgment: RelationJudgment | null;
}
export interface DocumentReport {
  schema: "jev-lint-documents-1"; snapshotDigest: string; questionDigest: string; model: string | null; snapshotChanged: boolean;
  status: "complete" | "partial" | "failed"; qualityVerdict: "UNREVIEWED";
  candidates: DocumentCandidate[];
  coverage: { expected: number; selected: number; answered: number; missing: number; contradictions: number; unassessed: number; deferred: number; issues: number; unboundDocuments: number };
  usage: { requests: number; inputTokens: number; usd: number };
  errors: Array<{ comparisonId: string; code: "request-failed" | "unusable-answer" }>;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[\w.-]{1,80}$/.test(v);
const nonempty = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
export function parseDocumentManifest(raw: unknown): DocumentManifest {
  const fail = (): never => { throw new Error("invalid documents manifest"); };
  if (!record(raw) || raw.schema !== "jev-lint-documents-manifest-1" || Object.keys(raw).some((key) => !["schema", "files", "roots", "exclude", "comparisons"].includes(key))
    || !record(raw.files) || !Object.keys(raw.files).length || Object.keys(raw.files).length > 100 || !Array.isArray(raw.comparisons) || !raw.comparisons.length || raw.comparisons.length > 1000) return fail();
  const paths = new Set<string>();
  for (const [name, file] of Object.entries(raw.files)) {
    if (!id(name) || !record(file) || Object.keys(file).some((key) => !["path", "role"].includes(key)) || !relationPath(file.path)
      || typeof file.role !== "string" || !["document", "reference", "historical"].includes(file.role) || paths.has(file.path)) return fail();
    paths.add(file.path);
  }
  for (const key of ["roots", "exclude"] as const) if (raw[key] !== undefined && (!Array.isArray(raw[key]) || !raw[key].every((path) => path === "." || relationPath(path)))) return fail();
  const selector = (value: unknown): boolean => record(value) && id(value.source) && Object.hasOwn(raw.files as object, value.source)
    && Object.keys(value).every((key) => ["source", "heading", "contains"].includes(key))
    && (value.heading === undefined || nonempty(value.heading, 256)) && (value.contains === undefined || nonempty(value.contains, 2000));
  const ids = new Set<string>();
  for (const comparison of raw.comparisons) {
    if (!record(comparison) || Object.keys(comparison).some((key) => !["id", "topic", "mode", "reference", "target", "context"].includes(key))
      || !id(comparison.id) || ids.has(comparison.id) || !nonempty(comparison.topic, 1000) || typeof comparison.mode !== "string" || !["semantic", "translation", "terminology"].includes(comparison.mode)
      || !selector(comparison.reference) || !selector(comparison.target) || comparison.context !== undefined && (!Array.isArray(comparison.context) || comparison.context.length > 10 || !comparison.context.every(selector))) return fail();
    ids.add(comparison.id);
  }
  return structuredClone(raw) as unknown as DocumentManifest;
}

export function documentSnapshotDigest(input: Omit<DocumentInput, "snapshotDigest">): string { return relationDigest(input); }
export function validateDocumentInput(input: DocumentInput): void {
  const fail = (): never => { throw new Error("invalid document input"); };
  const keys = (v: unknown, allowed: string[]): boolean => record(v) && Object.keys(v).every((key) => allowed.includes(key));
  const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!keys(input, ["schema", "manifestDigest", "snapshotDigest", "sources", "comparisons", "issues", "deferred", "unboundDocuments", "expectedComparisons"])
    || input.schema !== "jev-lint-documents-input-1" || !digest(input.manifestDigest) || !digest(input.snapshotDigest)
    || !Number.isSafeInteger(input.expectedComparisons) || input.expectedComparisons < 1 || input.expectedComparisons > 1000
    || !Array.isArray(input.sources) || !input.sources.length || input.sources.length > 100 || !Array.isArray(input.comparisons)
    || !Array.isArray(input.issues) || !Array.isArray(input.deferred) || !Array.isArray(input.unboundDocuments)) return fail();
  const sourceIds = new Set<string>(), paths = new Set<string>();
  for (const source of input.sources) {
    if (!keys(source, ["id", "path", "role", "contentHash"]) || !id(source.id) || !relationPath(source.path)
      || !["document", "reference", "historical"].includes(source.role) || !(source.contentHash === null || digest(source.contentHash))
      || sourceIds.has(source.id) || paths.has(source.path)) return fail();
    sourceIds.add(source.id); paths.add(source.path);
  }
  const comparisonIds = new Set<string>();
  for (const comparison of input.comparisons) {
    if (!keys(comparison, ["id", "topic", "mode", "reference", "target", "context"]) || !id(comparison.id) || comparisonIds.has(comparison.id)
      || !nonempty(comparison.topic, 1000) || !["semantic", "translation", "terminology"].includes(comparison.mode)
      || !Array.isArray(comparison.context) || comparison.context.length > 10) return fail();
    comparisonIds.add(comparison.id);
    for (const e of [comparison.reference, comparison.target, ...comparison.context]) {
      if (!keys(e, ["source", "path", "startLine", "endLine", "quote", "contentHash"]) || !id(e.source) || !relationPath(e.path)
        || !Number.isSafeInteger(e.startLine) || !Number.isSafeInteger(e.endLine) || e.startLine < 1 || e.endLine < e.startLine
        || !nonempty(e.quote, 64000) || e.quote.split("\n").length !== e.endLine - e.startLine + 1
        || relationDigest(e.quote) !== e.contentHash || !input.sources.some((s) => s.id === e.source && s.path === e.path && s.contentHash !== null)) return fail();
    }
  }
  for (const deferred of input.deferred) { if (!id(deferred) || comparisonIds.has(deferred)) return fail(); comparisonIds.add(deferred); }
  const issueIds = new Set<string>();
  for (const issue of input.issues) {
    if (!keys(issue, ["comparisonId", "path", "code"]) || !(relationPath(issue.path) || issue.path === "." && issue.code === "inventory-unavailable")
      || !["source-unavailable", "source-budget", "missing-selector", "ambiguous-selector", "excerpt-budget", "unregistered-document", "inventory-unavailable"].includes(issue.code)
      || issue.comparisonId !== undefined && (!id(issue.comparisonId) || comparisonIds.has(issue.comparisonId) || issueIds.has(issue.comparisonId))) return fail();
    if (issue.comparisonId !== undefined) issueIds.add(issue.comparisonId);
  }
  if (comparisonIds.size + issueIds.size !== input.expectedComparisons || new Set(input.unboundDocuments).size !== input.unboundDocuments.length
    || input.unboundDocuments.some((path) => !input.sources.some((s) => s.path === path && s.role === "document"))) return fail();
  const { snapshotDigest, ...body } = input;
  if (snapshotDigest !== documentSnapshotDigest(body)) return fail();
}
