import { createHash } from "node:crypto";
import YAML from "yaml";
import { MAX_BLOCK_CHARS } from "../../src/text.ts";
import condition from "./condition.json" with { type: "json" };

export type CommitObservation = {
  format?: "structured";
  context?: { artifact?: string; locale?: string; messageComplete?: boolean };
  data?: { message?: string };
};

type Route =
  | { action: "retain"; verdict: "fail" | "not-applicable"; reason: string }
  | { action: "observe"; verdict: "unknown"; reason: string }
  | { action: "judge"; verdict: "unknown"; criterion: string };

const observe = (reason: string): Route => ({ action: "observe", verdict: "unknown", reason });
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function routeCommit(input: CommitObservation): Route {
  const { artifact, messageComplete, locale } = input.context ?? {};
  if (typeof artifact !== "string" || !artifact.length) return observe("Artifact scope is missing.");
  if (artifact !== "commit-message") return { action: "retain", verdict: "not-applicable", reason: "Outside commit-message scope." };
  const message = input.data?.message;
  if (messageComplete !== true || typeof message !== "string" || !message.trim()) return observe("Complete commit message is missing.");
  if (locale !== "en") return observe("The English language contract is missing.");

  const header = message.split(/\r?\n/, 1)[0];
  const subject = /^[A-Za-z][A-Za-z0-9-]*(?:\([^\r\n()]+\))?!?: (\S[^\r\n]*)$/.exec(header)?.[1];
  if (!subject || !/^[a-z]/.test(subject) || subject.endsWith(".")) {
    return { action: "retain", verdict: "fail", reason: "The header violates the subject shape." };
  }
  if (json(input).length > MAX_BLOCK_CHARS) return observe("The subject exceeds the Jev text block limit.");
  return { action: "judge", verdict: "unknown", criterion: condition.criterion };
}

function ruleYaml(): string {
  const { rule, criterion, source, id, extension, ask, criteria, note } = condition;
  const header = `# Proposed translation of ${rule} / ${criterion}\n# Source snapshot SHA256: ${source.sha256}\n# No accepted Jev baseline; do not enable as a CI gate before calibration.\n`;
  const fields = { id, language: "Text", subject: "block", extensions: [extension], kind: "noul",
    state: "bare", severity: "info", threshold: 0.7, ask, criteria, note };
  return header + YAML.stringify(fields, { lineWidth: 0 }).replace(/^threshold: 0\.7$/m, "threshold: 0.7  # uncalibrated");
}

type Split = "develop" | "evaluation";
type Case = { id: string; family: string; split: Split; input: CommitObservation;
  expected: { verdict: "pass" | "fail" | "unknown" | "not-applicable"; reason: string } };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function validObservation(v: unknown): v is CommitObservation {
  if (!record(v) || Object.keys(v).some(k => !["format", "data", "context"].includes(k))) return false;
  if (v.format !== undefined && v.format !== "structured") return false;
  if (v.data !== undefined) {
    if (!record(v.data) || Object.keys(v.data).some(key => key !== "message")) return false;
    if ("message" in v.data && typeof v.data.message !== "string") return false;
  }
  return v.context === undefined || (record(v.context) && Object.entries(v.context).every(([k, x]) =>
    k === "messageComplete" ? typeof x === "boolean" : ["artifact", "locale"].includes(k) && typeof x === "string"));
}

function validCase(v: unknown): v is Case {
  return record(v) && text(v.id) && text(v.family) && (v.split === "develop" || v.split === "evaluation")
    && validObservation(v.input) && record(v.expected) && text(v.expected.reason)
    && typeof v.expected.verdict === "string" && ["pass", "fail", "unknown", "not-applicable"].includes(v.expected.verdict);
}

function observationHash(input: CommitObservation): string {
  const canonical = JSON.stringify(input, (_, value) => record(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildSuites(cases: unknown) {
  if (!Array.isArray(cases) || !cases.length || !cases.every(validCase)) throw new Error("Expected labelled commit cases");
  const families = new Map<string, Split>();
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const files: Record<string, string> = {};
  const decisions: ({ id: string; split: Split; subject: string | null } & Route)[] = [];
  const expectations: Record<Split, Record<string, unknown>> = { develop: {}, evaluation: {} };
  const suite = (split: Split) => `${split}/text/${condition.id}`;
  for (const c of cases) {
    const hash = observationHash(c.input);
    if (ids.has(c.id) || hashes.has(hash)) throw new Error("Duplicate case or input: " + c.id);
    if (families.has(c.family) && families.get(c.family) !== c.split) throw new Error("Family crosses split: " + c.family);
    families.set(c.family, c.split);
    ids.add(c.id);
    hashes.add(hash);
    const route = routeCommit(c.input);
    let subject = null;
    if (route.action === "judge") {
      if (c.expected.verdict !== "pass" && c.expected.verdict !== "fail") throw new Error("A Jev fixture needs a binary expectation: " + c.id);
      const fixture = `fixtures/${hash}.${condition.extension}`;
      subject = `${suite(c.split)}/${fixture}`;
      files[subject] = json(c.input);
      expectations[c.split][fixture] = [{ line: 1, label: c.expected.verdict === "fail" ? "bad" : "clean", window: 0, reason: c.expected.reason }];
    }
    decisions.push({ id: c.id, split: c.split, ...route, subject });
  }
  for (const split of ["develop", "evaluation"] as const) {
    if (!Object.keys(expectations[split]).length) continue;
    files[suite(split) + "/rule.yml"] = ruleYaml();
    files[suite(split) + "/expect.yml"] = YAML.stringify(expectations[split], { lineWidth: 0 });
  }
  return { decisions, files };
}
