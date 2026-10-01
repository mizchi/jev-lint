/** Paired model comparison at shipped cutoffs, with a descriptive refit beside it. */
import { ruleTextHash } from "./rules.ts";
import { loadSuite, scoreEval } from "./evals.ts";
import type { CaseScore, EvalAnswer, EvalRecord, EvalScore, RuleScore } from "./evals.ts";
import type { EvalSuite } from "./evals.ts";
import { estimateTokens } from "./batch.ts";
import { patchRepo } from "./commits.ts";
import { run } from "./run.ts";
import { isGitSubject } from "./types.ts";
import type { Batch, CustomLanguages, Labels, Rule } from "./types.ts";

export interface ModelMetrics {
  subjects: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
  flips: number;
}

export interface ModelScore {
  model: string | null;
  passes: number;
  missingAnswers: number;
  shipped: ModelMetrics;
  /** Fitted and scored on the same fixtures: diagnostic, not held-out accuracy. */
  refitted: ModelMetrics;
  thresholds: Record<string, { shipped: number; fitted: number | null }>;
  rules: RuleScore[];
  spent: EvalRecord["spent"];
}

export interface ModelComparison {
  suite: string;
  complete: boolean;
  expectedSubjects: number;
  pairedSubjects: number;
  baseline: ModelScore;
  candidate: ModelScore;
  regressions: CaseScore[];
  improvements: CaseScore[];
  disagreements: Array<{ rule: string; file: string; line: number; baseline: number; candidate: number }>;
}

const keyOf = (a: Pick<EvalAnswer, "rule" | "file" | "line">): string => `${a.rule}\u0000${a.file}\u0000${a.line}`;

/** Only subjects answered on every pass by both models enter either accuracy score. */
export function compareModels(baseline: EvalRecord, candidate: EvalRecord, labels: Labels, rules: Rule[]): ModelComparison {
  if (baseline.suite !== candidate.suite) throw new Error("incompatible eval suites");
  for (const record of [baseline, candidate]) {
    if (record.rules.length !== rules.length || rules.some(r => {
      const recorded = record.rules.filter(rr => rr.id === r.id);
      return recorded.length !== 1 || recorded[0].draft !== ruleTextHash(r);
    })) throw new Error("incompatible rule drafts; run a fresh evaluation");
  }
  const limits = new Map(rules.map(r => [r.id, r.kind === "noul" ? 1 : (r.levels?.length ?? 4) - 1]));
  const keys = new Set([...baseline.passes, ...candidate.passes].flat().map(keyOf));
  // Labels and scoreEval identify a case by rule/file/line. A matcher can
  // select two nodes on that line; keep their samples when both records
  // have the same multiplicity on every pass, rather than inventing an
  // ordering that the historical record never stored.
  const multiplicities = new Map<string, number>();
  for (const pass of [...baseline.passes, ...candidate.passes]) {
    const counts = new Map<string, number>();
    for (const a of pass) counts.set(keyOf(a), (counts.get(keyOf(a)) ?? 0) + 1);
    for (const [key, count] of counts) multiplicities.set(key, Math.max(count, multiplicities.get(key) ?? 0));
  }
  const coverage = (record: EvalRecord) => {
    const full = new Set(keys);
    let missing = 0;
    if (record.passes.length === 0) full.clear();
    for (const pass of record.passes) {
      const byKey = new Map<string, EvalAnswer[]>();
      for (const a of pass) byKey.set(keyOf(a), [...(byKey.get(keyOf(a)) ?? []), a]);
      for (const key of keys) {
        const answers = byKey.get(key) ?? [];
        const expected = multiplicities.get(key)!;
        const valid = answers.filter(a => {
          const limit = limits.get(a.rule);
          return limit !== undefined && typeof a.value === "number" && Number.isFinite(a.value) && a.value >= 0 && a.value <= limit;
        }).length;
        if (valid !== expected) {
          missing += expected - valid;
          full.delete(key);
        }
      }
    }
    return { full, missing };
  };
  const before = coverage(baseline);
  const after = coverage(candidate);
  const paired = new Set([...keys].filter(k => before.full.has(k) && after.full.has(k)));
  const score = (record: EvalRecord, missingAnswers: number) => {
    const passes = record.passes.map(pass => pass.filter(a => paired.has(keyOf(a))));
    const shipped = scoreEval(passes, labels, rules);
    const fittedRules = rules.filter(r => typeof shipped.rules.find(s => s.rule === r.id)?.fitted === "number");
    const ats = Object.fromEntries(shipped.rules.filter(r => r.fitted !== null).map(r => [r.rule, r.fitted!]));
    const refitted = scoreEval(passes, labels, fittedRules, {}, ats);
    const summary: ModelScore = {
      model: record.model, passes: record.passes.length, missingAnswers,
      shipped: modelMetrics(shipped), refitted: modelMetrics(refitted),
      thresholds: Object.fromEntries(shipped.rules.map(r => [r.rule, { shipped: r.at, fitted: r.fitted }])),
      rules: shipped.rules, spent: record.spent,
    };
    return { summary, cases: shipped.cases };
  };
  const b = score(baseline, before.missing);
  const c = score(candidate, after.missing);
  const old = new Map(b.cases.map(a => [keyOf(a), a]));
  return {
    suite: candidate.suite,
    complete: keys.size > 0 && paired.size === keys.size && baseline.passes.length > 0 && candidate.passes.length > 0,
    expectedSubjects: keys.size, pairedSubjects: paired.size,
    baseline: b.summary, candidate: c.summary,
    regressions: c.cases.filter(a => old.get(keyOf(a))!.right && !a.right),
    improvements: c.cases.filter(a => !old.get(keyOf(a))!.right && a.right),
    disagreements: c.cases.filter(a => old.get(keyOf(a))!.decision !== a.decision).map(a => ({
      rule: a.rule, file: a.file, line: a.line, baseline: old.get(keyOf(a))!.mean, candidate: a.mean,
    })),
  };
}

export function modelMetrics(score: EvalScore): ModelMetrics {
  const tp = score.rules.reduce((n, r) => n + r.tp, 0);
  const fp = score.rules.reduce((n, r) => n + r.fp, 0);
  const fn = score.rules.reduce((n, r) => n + r.fn, 0);
  const subjects = score.cases.length;
  const tn = subjects - tp - fp - fn;
  return {
    subjects, tp, fp, fn, tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
    accuracy: subjects ? (tp + tn) / subjects : null,
    flips: score.cases.filter(c => c.flip).length,
  };
}

/** Count repeated state in each provider's question-limited requests. */
export function planModelRequests(batches: Batch[], repeat: number, maxQuestions: number): { requests: number; tokens: number } {
  if (!Number.isSafeInteger(repeat) || repeat <= 0 || maxQuestions <= 0 ||
    (!Number.isSafeInteger(maxQuestions) && maxQuestions !== Infinity)) throw new Error("repeat and maxQuestions must be positive integers");
  let requests = 0;
  let tokens = 0;
  for (const batch of batches) {
    const entries = Object.entries(batch.questions);
    for (let i = 0; i < entries.length; i += maxQuestions) {
      requests += repeat;
      tokens += repeat * (estimateTokens(batch.state) + estimateTokens(Object.fromEntries(entries.slice(i, i + maxQuestions))));
    }
  }
  return { requests, tokens };
}

export async function planModelEval(suite: EvalSuite, repeat: number, languages: CustomLanguages = {}) {
  const { rules, errors } = loadSuite(suite, languages);
  if (errors.length) throw new Error(errors.join("\n"));
  const commits = rules.some(r => isGitSubject(r.subject)) ? patchRepo(suite.fixtures) : null;
  const result = await run({ rules, paths: [suite.fixtures], cachePath: null, force: true, dryRun: true, languages,
    ...(commits ? { commits: { range: commits.range, label: commits.label }, cwd: commits.cwd } : {}),
  });
  if (result.stderr || result.subjects.length === 0) throw new Error(`${suite.name}: no usable subjects or scanner error: ${result.stderr}`);
  return { subjects: result.subjects.length, batches: result.batches };
}
