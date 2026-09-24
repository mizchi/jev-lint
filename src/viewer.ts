/** A self-contained, read-only explorer for recorded reviews and human labels. */
import type { Label, Labels } from "./types.ts";

export interface ViewerAnswer {
  rule: string;
  ruleKey: string;
  file: string;
  line: number;
  endLine: number;
  kind: string | null;
  value: number | null;
  confidence: number | null;
  arm: string | null;
}

export interface ViewerRule {
  id: string;
  languageDir: string;
  ask: string;
  at: number;
  severity: string;
}

export interface ViewerFinding {
  rule: string;
  file: string;
  line: number;
  endLine: number;
  kind: string | null;
  value: number;
  cutoff: number;
  severity: string;
  message: string;
}

export interface ViewerRunInput {
  repo: string;
  revision: string;
  record: { rules: ViewerRule[]; answers: ViewerAnswer[] };
  result: {
    findings: ViewerFinding[];
    stats: { subjects: number; missing: number; byFile?: Record<string, { findings: number; subjects: number }> };
    unpaired?: { subjects: number; files: string[] };
    degraded?: unknown[];
  };
  supplements?: Array<{ answers: ViewerAnswer[] }>;
}

export interface ViewerRow {
  key: string;
  ruleKey: string;
  rule: string;
  ask: string;
  file: string;
  line: number;
  endLine: number;
  kind: string | null;
  value: number | null;
  confidence: number | null;
  cutoff: number;
  severity: string;
  arm: string | null;
  reported: boolean;
  nearCutoff: boolean;
  message: string | null;
}

export interface ViewerFile {
  path: string;
  subjects: number;
  findings: number;
  nearCutoff: number;
  unpaired: boolean;
  topConcern: string | null;
}

export interface ViewerDataset {
  repo: string;
  revision: string;
  summary: { subjects: number; findings: number; missing: number; unpaired: number; degraded: number };
  files: ViewerFile[];
  rows: ViewerRow[];
}

function answerKey(a: Pick<ViewerAnswer, "ruleKey" | "file" | "line" | "endLine">): string {
  // A failed answer has kind=null, while its focused retry has the rule's kind.
  return JSON.stringify([a.ruleKey, a.file, a.line, a.endLine]);
}

function findingKey(f: Pick<ViewerFinding, "rule" | "file" | "line" | "endLine" | "kind">): string {
  return JSON.stringify([f.rule, f.file, f.line, f.endLine, f.kind]);
}

/** Keep clean and missing answers beside findings so reviewers can label false negatives. */
export function buildViewerModel(inputs: ViewerRunInput[]): ViewerDataset[] {
  return inputs.map((input) => {
    const rules = new Map(input.record.rules.map((rule) => [`${rule.languageDir}/${rule.id}`, rule]));
    const supplements = new Map<string, ViewerAnswer[]>();
    for (const supplement of input.supplements ?? []) {
      for (const answer of supplement.answers) {
        if (answer.value === null) continue;
        const key = answerKey(answer);
        if (!supplements.has(key)) supplements.set(key, []);
        supplements.get(key)!.push(answer);
      }
    }
    const findings = new Map<string, ViewerFinding[]>();
    for (const finding of input.result.findings) {
      const key = findingKey(finding);
      if (!findings.has(key)) findings.set(key, []);
      findings.get(key)!.push(finding);
    }

    const occurrences = new Map<string, number>();
    const rows: ViewerRow[] = input.record.answers.map((original) => {
      const identity = answerKey(original);
      const ordinal = occurrences.get(identity) ?? 0;
      occurrences.set(identity, ordinal + 1);
      const answer = original.value === null ? (supplements.get(identity)?.shift() ?? original) : original;
      const rule = rules.get(answer.ruleKey);
      const candidates = findings.get(findingKey(answer)) ?? [];
      const match = candidates.findIndex((f) => f.value === answer.value);
      const finding = match >= 0 ? candidates.splice(match, 1)[0]! : null;
      const cutoff = finding?.cutoff ?? rule?.at ?? Number.NaN;
      return {
        key: JSON.stringify([input.repo, input.revision, answer.ruleKey, answer.file, answer.line, answer.endLine, answer.kind, ordinal]),
        ruleKey: answer.ruleKey,
        rule: answer.rule,
        ask: rule?.ask ?? answer.rule,
        file: answer.file,
        line: answer.line,
        endLine: answer.endLine,
        kind: answer.kind,
        value: answer.value,
        confidence: answer.confidence,
        cutoff,
        severity: finding?.severity ?? rule?.severity ?? "warning",
        arm: answer.arm,
        reported: finding !== null,
        nearCutoff: answer.value !== null && Number.isFinite(cutoff) && Math.abs(answer.value - cutoff) < 0.05,
        message: finding?.message ?? null,
      };
    });

    const byFile = new Map<string, ViewerFile>();
    for (const row of rows) {
      if (!byFile.has(row.file)) byFile.set(row.file, { path: row.file, subjects: 0, findings: 0, nearCutoff: 0, unpaired: false, topConcern: null });
      const file = byFile.get(row.file)!;
      file.subjects += 1;
      if (row.reported) file.findings += 1;
      if (row.nearCutoff) file.nearCutoff += 1;
    }
    for (const path of input.result.unpaired?.files ?? []) {
      if (!byFile.has(path)) byFile.set(path, { path, subjects: 0, findings: 0, nearCutoff: 0, unpaired: true, topConcern: null });
      byFile.get(path)!.unpaired = true;
    }
    const fileRules = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!row.reported) continue;
      if (!fileRules.has(row.file)) fileRules.set(row.file, new Map());
      const counts = fileRules.get(row.file)!;
      counts.set(row.rule, (counts.get(row.rule) ?? 0) + 1);
    }
    for (const [path, counts] of fileRules) {
      byFile.get(path)!.topConcern = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    }
    const files = [...byFile.values()].sort((a, b) => b.findings - a.findings || b.nearCutoff - a.nearCutoff || a.path.localeCompare(b.path));
    return {
      repo: input.repo,
      revision: input.revision,
      summary: {
        subjects: rows.length,
        findings: rows.filter((r) => r.reported).length,
        missing: rows.filter((r) => r.value === null).length,
        unpaired: input.result.unpaired?.subjects ?? 0,
        degraded: input.result.degraded?.length ?? 0,
      },
      files,
      rows,
    };
  });
}

/** Export only explicit defect/clean decisions; an unsure case stays unlabeled. */
export function toCalibrationLabels(dataset: ViewerDataset, decisions: Record<string, string>): Labels {
  const labels: Labels = {
    $default: "unlabeled",
    $note: `${dataset.repo}@${dataset.revision}; exported from the review TUI`,
  };
  for (const row of dataset.rows) {
    const decision = decisions[row.key];
    if (decision !== "defect" && decision !== "clean") continue;
    const existing = labels[row.file];
    const list: Label[] = Array.isArray(existing) ? existing : [];
    if (!Array.isArray(existing)) labels[row.file] = list;
    list.push({
      line: row.line,
      rule: row.ruleKey,
      label: decision === "defect" ? "bad" : "clean",
      window: 0,
    });
  }
  return labels;
}
