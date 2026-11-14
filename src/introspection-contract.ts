import { relationDigest, relationPath } from "./relation-contract.ts";
import { isDeepStrictEqual } from "node:util";
import { SUBJECTS, STATE_ARMS, SEVERITIES, type SubjectMode, type StateArm, type Severity, type ChoiceQuestion } from "./types.ts";

export const INTROSPECTION_CHOICES = ["enable", "defer", "skip", "insufficient_context"] as const;
export type IntrospectionChoice = typeof INTROSPECTION_CHOICES[number];
export interface IntrospectionJudgment { choice: IntrospectionChoice; confidence: number; probabilities: Record<IntrospectionChoice, number> }
export interface IntrospectionCandidate {
  key: string; ask: string; policyDigest: string; subject: SubjectMode; state: StateArm; severity: Severity;
  eligibleFiles: number; examples: string[]; command: "check" | "commits";
}
export interface IntrospectionInput {
  schema: "jev-lint-introspection-input-1"; snapshotDigest: string; catalogDigest: string;
  files: Array<{ path: string; eligibility: "eligible" | "no-rule" | "unsupported" | "missing-parser" }>;
  manifests: Array<{ path: string; scripts: string[]; dependencies: string[] }>;
  git: boolean; exclude: string[]; candidates: IntrospectionCandidate[];
  issues: Array<{ path: string; code: string }>;
}
export interface IntrospectionReport {
  schema: "jev-lint-introspection-1"; snapshotDigest: string; questionDigest: string; model: string | null;
  input: IntrospectionInput;
  snapshotChanged: boolean; status: "complete" | "partial" | "failed"; qualityVerdict: "UNREVIEWED";
  decisions: Array<{ key: string; judgment: IntrospectionJudgment | null }>;
  coverage: { candidates: number; answered: number; missing: number; enabled: number; deferred: number; skipped: number; uncertain: number; issues: number };
  usage: { requests: number; inputTokens: number; usd: number };
  errors: Array<{ key: string; code: "request-failed" | "unusable-answer" }>;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, names: string[]): boolean => record(v) && Object.keys(v).every((key) => names.includes(key));
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
const key = (v: unknown): v is string => typeof v === "string" && /^[\w.-]+(?:\/[\w.-]+)?$/.test(v) && v.length <= 256;
export const introspectionDigest = (input: Omit<IntrospectionInput, "snapshotDigest">): string => relationDigest(input);

export function parseIntrospectionInput(raw: unknown): IntrospectionInput {
  const fail = (): never => { throw new Error("invalid introspection input"); };
  if (!fields(raw, ["schema", "snapshotDigest", "catalogDigest", "files", "manifests", "git", "exclude", "candidates", "issues"])) return fail();
  const input = raw as IntrospectionInput;
  if (input.schema !== "jev-lint-introspection-input-1" || !hash(input.snapshotDigest) || !hash(input.catalogDigest) || typeof input.git !== "boolean"
    || !Array.isArray(input.files) || input.files.length > 500 || !Array.isArray(input.manifests) || input.manifests.length > 10
    || !Array.isArray(input.candidates) || input.candidates.length > 128 || !Array.isArray(input.issues)
    || !Array.isArray(input.exclude) || !input.exclude.every((p) => p === "." || relationPath(p))) return fail();
  const paths = new Set<string>(), keys = new Set<string>();
  for (const file of input.files) {
    if (!fields(file, ["path", "eligibility"]) || !relationPath(file.path) || paths.has(file.path)
      || !["eligible", "no-rule", "unsupported", "missing-parser"].includes(file.eligibility)) return fail();
    paths.add(file.path);
  }
  for (const manifest of input.manifests) if (!fields(manifest, ["path", "scripts", "dependencies"]) || !paths.has(manifest.path)
    || ![manifest.scripts, manifest.dependencies].every((values) => Array.isArray(values) && values.length <= 200 && values.every((v) => text(v, 256)))) return fail();
  for (const candidate of input.candidates) {
    if (!fields(candidate, ["key", "ask", "policyDigest", "subject", "state", "severity", "eligibleFiles", "examples", "command"])
      || !key(candidate.key) || keys.has(candidate.key) || !text(candidate.ask, 4000) || !hash(candidate.policyDigest)
      || !SUBJECTS.includes(candidate.subject) || !STATE_ARMS.includes(candidate.state) || !SEVERITIES.includes(candidate.severity)
      || !["check", "commits"].includes(candidate.command) || !Number.isSafeInteger(candidate.eligibleFiles) || candidate.eligibleFiles < 0 || candidate.eligibleFiles > input.files.length
      || !Array.isArray(candidate.examples) || candidate.examples.length > 5 || !candidate.examples.every((p) => paths.has(p))
      || candidate.command === "check" && !candidate.eligibleFiles || candidate.command === "commits" && !input.git) return fail();
    keys.add(candidate.key);
  }
  for (const issue of input.issues) if (!fields(issue, ["path", "code"]) || !text(issue.path, 4096) || !text(issue.code, 128)) return fail();
  const { snapshotDigest, ...body } = input;
  if (snapshotDigest !== introspectionDigest(body) || input.files.reduce((n, f) => n + f.path.length, 0) > 24000
    || JSON.stringify({ files: input.files, manifests: input.manifests, git: input.git }).length > 60000) return fail();
  return structuredClone(input);
}
export function prepareIntrospectionQuestion(raw: unknown): ChoiceQuestion {
  if (!fields(raw, ["type", "instructions", "criteria"]) || !record(raw) || raw.type !== "choice" || !record(raw.instructions) || !record(raw.criteria)
    || Object.keys(raw.criteria).length !== INTROSPECTION_CHOICES.length
    || !INTROSPECTION_CHOICES.every((label) => text((raw.criteria as Record<string, unknown>)[label], 4000))
    || JSON.stringify(raw).length > 20000 || !isDeepStrictEqual(JSON.parse(JSON.stringify(raw)), raw)) throw new Error("invalid introspection question");
  return structuredClone(raw) as unknown as ChoiceQuestion;
}
export function readIntrospectionJudgment(raw: unknown): IntrospectionJudgment | null {
  if (!record(raw) || raw.type !== "choice" || !INTROSPECTION_CHOICES.includes(raw.choice as IntrospectionChoice)
    || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1
    || !record(raw.probabilities) || Object.keys(raw.probabilities).length !== INTROSPECTION_CHOICES.length) return null;
  const probabilities = raw.probabilities;
  if (!INTROSPECTION_CHOICES.every((label) => typeof probabilities[label] === "number" && Number.isFinite(probabilities[label]) && probabilities[label] >= 0 && probabilities[label] <= 1)) return null;
  const values = INTROSPECTION_CHOICES.map((label) => Number(probabilities[label]));
  if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.00001 || Number(probabilities[String(raw.choice)]) < Math.max(...values) - 0.00001) return null;
  return { choice: raw.choice as IntrospectionChoice, confidence: raw.confidence, probabilities: structuredClone(probabilities) as IntrospectionJudgment["probabilities"] };
}
