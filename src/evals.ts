/**
 * Per-rule evals: the regression suite a rule ships with.
 *
 * A rule lives in its own directory, under its language, beside the
 * fixtures that prove it:
 *
 *     rules/<lang>/<id>/rule.yml          the rule, one language
 *     rules/<lang>/<id>/fixtures/         fixture code, marker-free
 *     rules/<lang>/<id>/expect.yml        what each fixture holds, and why
 *     rules/<lang>/<id>/baseline.json     the last accepted run, replayable
 *     rules/<lang>/<id>/last.json         the last run, accepted or not
 *
 * `jev-lint eval` runs each suite's rule over its cases, scores the answers at
 * the SHIPPED cutoff on the mean of N passes, and compares with the baseline.
 * The question an eval answers is "does the rule as shipped still get its
 * cases right" -- so the shipped cutoff, not a fitted one, which would move
 * the goalposts to wherever the answers landed. The fit is reported beside it.
 *
 * A baseline is a record of answers to a specific question. When the
 * question changes -- the sentence, the criteria, the note, the matcher, the
 * subject or the state, which is what `ruleTextHash` covers -- the baseline
 * cannot say anything about the rule as it is now, and the comparison says so
 * rather than comparing two different questions.
 *
 * Expectations are keyed relative to the rule directory, so it is portable;
 * they are resolved to the paths a run reports before scoring.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tryReadDir } from "./files.ts";
import { basename, dirname, join, sep } from "node:path";
import YAML from "yaml";
import { fitCutoffs, labelFor } from "./calibrate.ts";
import { cutoffFor, languageDirGrammars, loadRules, ruleTextHash } from "./rules.ts";
import { patchRepo } from "./commits.ts";
import { run } from "./run.ts";
import { DEFAULT_CONCURRENCY, type AskClient } from "./jev.ts";
import type { Label, Labels, Rule } from "./types.ts";

export interface EvalSuite {
  /** `lang/id` under the shipped layout, else the directory's name. */
  name: string;
  dir: string;
  ruleFile: string;
  /** The fixtures directory: the code the rule is run over. */
  fixtures: string;
  /** `expect.yml`: the expectations, keyed relative to `dir`. */
  expect: string;
  baseline: string;
  last: string;
}

/** One answered subject, as a run reports it. The subset an eval scores. */
export interface EvalAnswer {
  rule: string;
  file: string;
  line: number;
  endLine?: number;
  kind?: string | null;
  value: number | null;
  confidence?: number | null;
}

export interface CaseScore {
  rule: string;
  file: string;
  line: number;
  label: "bad" | "clean" | "unlabeled";
  values: number[];
  mean: number;
  decision: "flag" | "pass";
  right: boolean;
  /** Decided differently on different passes. */
  flip: boolean;
}

export interface RuleScore {
  rule: string;
  at: number;
  subjects: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  flips: number;
  fitted: number | null;
  fitReason: string;
  /** The highest mean a labelled-clean subject reached: the floor a `loose:` should clear. */
  cleanTop: number | null;
}

export interface EvalScore {
  rules: RuleScore[];
  cases: CaseScore[];
}

export interface EvalDiff {
  ok: boolean;
  reasons: string[];
  regressions: Array<CaseScore & { was: "flag" | "pass"; now: "flag" | "pass" }>;
  improvements: Array<CaseScore & { was: "flag" | "pass"; now: "flag" | "pass" }>;
  added: CaseScore[];
  removed: CaseScore[];
}

/** The rule directories under `roots` that carry an eval. */
export function discoverEvals(roots: string[]): EvalSuite[] {
  const out: EvalSuite[] = [];
  const visit = (dir: string) => {
    const entries = tryReadDir(dir).sort((a, b) => a.name.localeCompare(b.name));
    const expect = join(dir, "expect.yml");
    if (existsSync(expect)) {
      const ruleFile = ["rule.yml", "rule.yaml"].map((n) => join(dir, n)).find((p) => existsSync(p)) ?? join(dir, "rule.yml");
      // `lang/id` when the parent is a language directory, so two languages'
      // suites for one rule are told apart in every report.
      const parent = basename(dirname(dir));
      const name = languageDirGrammars(parent) ? `${parent}/${basename(dir)}` : basename(dir);
      out.push({
        name,
        dir,
        ruleFile,
        fixtures: join(dir, "fixtures"),
        expect,
        baseline: join(dir, "baseline.json"),
        last: join(dir, "last.json"),
      });
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "fixtures" && !e.name.startsWith(".")) visit(join(dir, e.name));
    }
  };
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) visit(r);
    } catch {
      /* a missing root is the loader's error to report, not this one's */
    }
  }
  return out;
}

/**
 * Expectations keyed relative to the rule directory, re-keyed to the paths
 * a run reports, with the suite's rule stamped on each entry so that
 * `labelFor` -- which matches a label to a rule -- needs no `rule:` key in
 * the file. `default`/`note` are the spellings; `$default`/`$note` still
 * read.
 */
export function relocateLabels(labels: Labels, dir: string, rule?: string): Labels {
  const out: Labels = {};
  for (const [k, v] of Object.entries(labels)) {
    if (k === "default" || k === "$default") out.$default = v as Labels["$default"];
    else if (k === "note" || k === "$note") out.$note = v as string;
    else if (k.startsWith("$")) out[k] = v;
    else out[join(dir, k)] = (v as Label[]).map((l) => (rule && !l.rule ? { ...l, rule } : l));
  }
  return out;
}

/** The expectations of a suite, as written. */
function readExpect(suite: EvalSuite): Labels {
  const raw = YAML.parse(readFileSync(suite.expect, "utf8")) as Labels | null;
  const rule = loadRules([suite.ruleFile]).rules[0]?.id;
  return relocateLabels(raw ?? {}, suite.dir, rule);
}

/**
 * Score answers at each rule's shipped cutoff, on the mean over passes.
 *
 * A subject the labels do not mention is clean, as in a corpus: the clean
 * cases are most of any file and enumerating them is busywork. `flips` counts
 * subjects whose decision differed between passes -- the band the model
 * itself moves in, where a cutoff should not be trusted either way.
 */
export function scoreEval(
  passes: EvalAnswer[][],
  labels: Labels,
  rules: Rule[],
  cutoffs: Record<string, number> = {},
  /** Score at these cutoffs instead of the rules' own: the ones a baseline was accepted at. */
  ats: Record<string, number> | null = null,
): EvalScore {
  const atFor = new Map(rules.map((r) => [r.id, ats?.[r.id] ?? cutoffFor(r, cutoffs)]));
  const bySubject = new Map<string, { rule: string; file: string; line: number; values: number[] }>();
  for (const pass of passes) {
    for (const a of pass) {
      if (typeof a.value !== "number") continue;
      const key = `${a.rule}\u0000${a.file}\u0000${a.line}`;
      const s = bySubject.get(key) ?? { rule: a.rule, file: a.file, line: a.line, values: [] };
      s.values.push(a.value);
      bySubject.set(key, s);
    }
  }
  const cases: CaseScore[] = [];
  for (const s of bySubject.values()) {
    const at = atFor.get(s.rule);
    if (at === undefined) continue;
    const mean = s.values.reduce((x, y) => x + y, 0) / s.values.length;
    const decision = mean >= at ? "flag" : "pass";
    const label = labelFor(labels, s.file, s.line, s.rule);
    const right = label === "bad" ? decision === "flag" : decision === "pass";
    const flip = s.values.some((v) => v >= at) && s.values.some((v) => v < at);
    cases.push({ rule: s.rule, file: s.file, line: s.line, label, values: s.values, mean, decision, right, flip });
  }
  cases.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);

  // The fit beside the score: what the cutoff WOULD be, for the human reading
  // the report, never for the verdict.
  const meanAnswers = cases.map((c) => ({
    rule: c.rule, file: c.file, line: c.line, endLine: c.line, value: c.mean, confidence: null,
    messageId: null, kind: "noul" as const, ask: "", severity: "warning" as const, message: null, cutoff: 0, margin: 0,
  }));
  const fits = new Map(fitCutoffs(meanAnswers as never, labels, rules).map((f) => [f.rule, f]));

  const ruleScores: RuleScore[] = rules.map((r) => {
    const mine = cases.filter((c) => c.rule === r.id);
    const tp = mine.filter((c) => c.label === "bad" && c.decision === "flag").length;
    const fp = mine.filter((c) => c.label !== "bad" && c.decision === "flag").length;
    const fn = mine.filter((c) => c.label === "bad" && c.decision === "pass").length;
    const fit = fits.get(r.id);
    return {
      rule: r.id,
      at: atFor.get(r.id)!,
      subjects: mine.length,
      tp, fp, fn,
      precision: tp + fp > 0 ? round(tp / (tp + fp)) : null,
      recall: tp + fn > 0 ? round(tp / (tp + fn)) : null,
      flips: mine.filter((c) => c.flip).length,
      fitted: fit?.fitted ?? null,
      fitReason: fit?.reason ?? "no labelled cases",
      cleanTop: mine.some((c) => c.label !== "bad")
        ? round(Math.max(...mine.filter((c) => c.label !== "bad").map((c) => c.mean)))
        : null,
    };
  });
  return { rules: ruleScores, cases };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * What changed since the baseline, case by case.
 *
 * A regression is a case that was decided rightly and now is not; an
 * improvement the reverse. A case only one side has is reported, not judged.
 * With `draftChanged` the baseline answered a different question, and the
 * comparison is refused rather than made.
 */
export function compareEvals(
  baseline: EvalScore,
  current: EvalScore,
  { draftChanged }: { draftChanged: boolean },
): EvalDiff {
  const key = (c: CaseScore) => `${c.rule}\u0000${c.file}\u0000${c.line}`;
  const before = new Map(baseline.cases.map((c) => [key(c), c]));
  const after = new Map(current.cases.map((c) => [key(c), c]));
  const regressions: EvalDiff["regressions"] = [];
  const improvements: EvalDiff["improvements"] = [];
  const added: CaseScore[] = [];
  const removed: CaseScore[] = [];
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) {
      added.push(now);
      continue;
    }
    if (was.right && !now.right) regressions.push({ ...now, was: was.decision, now: now.decision });
    else if (!was.right && now.right) improvements.push({ ...now, was: was.decision, now: now.decision });
  }
  for (const [k, was] of before) if (!after.has(k)) removed.push(was);
  const reasons: string[] = [];
  if (draftChanged) {
    reasons.push("the rule's question changed since the baseline (sentence, criteria, note, matcher, subject or state); its answers cannot be compared. Run the eval and accept a new baseline.");
  }
  if (regressions.length > 0) reasons.push(`${regressions.length} case(s) decided rightly in the baseline are decided wrongly now`);
  return { ok: reasons.length === 0, reasons, regressions, improvements, added, removed };
}

/** The cutoffs a record was scored at when it was taken. */
export function recordedAts(record: EvalRecord): Record<string, number> {
  return Object.fromEntries(record.rules.map((r) => [r.id, r.at]));
}

/** The record an eval writes: replayable, and carrying every rule's draft. */
export interface EvalRecord {
  schema: "jev-lint-eval-1";
  recorded: string;
  model: string | null;
  suite: string;
  rules: Array<{ id: string; draft: string; at: number }>;
  cutoffs: Record<string, number>;
  passes: EvalAnswer[][];
  spent: { calls: number; inputTokens: number; usd: number; ms: number };
}

export function readEvalRecord(path: string, suite?: EvalSuite): EvalRecord | null {
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as EvalRecord;
    if (r?.schema !== "jev-lint-eval-1" || !Array.isArray(r.passes)) return null;
    return suite ? relocateRecord(r, suite) : r;
  } catch {
    return null;
  }
}

/**
 * A record's answers, re-keyed to where the suite lives now.
 *
 * A baseline records fixture paths as the run reported them, relative to
 * the repository root, so a rule promoted from experiments/rule-candidates/
 * into rules/ carried paths its own expectations no longer matched -- and
 * `--replay` did not notice, since it compares decisions with the ones
 * accepted, not with the labels. Everything after `fixtures/` is what
 * identifies a case; the prefix is where the suite happened to be.
 */
export function relocateRecord(record: EvalRecord, suite: EvalSuite): EvalRecord {
  const here = suite.fixtures.split(sep).join("/");
  const move = (file: string): string => {
    const at = file.split(sep).join("/").lastIndexOf("/fixtures/");
    return at < 0 ? file : `${here}${file.slice(at + "/fixtures".length)}`;
  };
  return {
    ...record,
    passes: record.passes.map((pass) => pass.map((a) => ({ ...a, file: move(a.file) }))),
  };
}

/** Has any rule's question changed since this record was taken? */
export function draftsChanged(record: EvalRecord, rules: Rule[]): string[] {
  const now = new Map(rules.map((r) => [r.id, ruleTextHash(r)]));
  return record.rules.filter((r) => now.has(r.id) && now.get(r.id) !== r.draft).map((r) => r.id);
}

export interface RunEvalOptions {
  repeat?: number;
  cutoffs?: Record<string, number>;
  concurrency?: number;
  model?: string | null;
  client?: AskClient | null;
  log?: (line: string) => void;
}

/** Load a suite's rule file and labels. Errors are the caller's to print. */
export function loadSuite(suite: EvalSuite): { rules: Rule[]; labels: Labels; errors: string[] } {
  const { rules, errors } = loadRules([suite.ruleFile]);
  let labels: Labels = { $default: "clean" };
  try {
    labels = readExpect(suite);
  } catch (err: unknown) {
    errors.push(`${suite.expect}: ${String(err).slice(0, 160)}`);
  }
  return { rules, labels, errors };
}

/**
 * What an eval of this suite would ask, and what it would cost, without
 * asking. `--dry-run` used to be accepted by `eval` and silently ignored,
 * which sent real requests from the one command the calibration procedure
 * says to price first.
 */
export async function planEval(suite: EvalSuite, repeat = 1): Promise<{ subjects: number; requests: number; tokens: number }> {
  const { rules, errors } = loadSuite(suite);
  if (errors.length) throw new Error(errors.join("\n"));
  const commitSuite = rules.some((rule) => rule.subject === "commit") ? patchRepo(suite.fixtures) : null;
  const r = await run({
    rules,
    paths: [suite.fixtures],
    ...(commitSuite ? { commits: { range: commitSuite.range, label: commitSuite.label }, cwd: commitSuite.cwd } : {}),
    cachePath: null,
    force: true,
    dryRun: true,
  });
  const tokens = r.batches.reduce((a, b) => a + b.estimatedTokens, 0);
  // `r.subjects`, not the gate's count: a dry run decides nothing.
  return { subjects: r.subjects.length, requests: r.batches.length * Math.max(1, repeat), tokens: tokens * Math.max(1, repeat) };
}

/** Ask the suite's rule about its cases, `repeat` times, and record it. */
export async function runEval(suite: EvalSuite, opts: RunEvalOptions = {}): Promise<EvalRecord> {
  const repeat = Math.max(1, opts.repeat ?? 1);
  const { rules, errors } = loadSuite(suite);
  if (errors.length) throw new Error(errors.join("\n"));
  // One run, `repeat` passes: the runner interleaves the passes' requests,
  // so three passes over a suite cost the wall time of one and a bit,
  // and the cases are scanned once rather than once per pass.
  // A commit suite's fixtures are cases: each made a commit of a throwaway
  // repository, judged as commits, and named by their case directories so
  // the expectations key on `fixtures/<case>` at line 1.
  const commitSuite = rules.some((rule) => rule.subject === "commit") ? patchRepo(suite.fixtures) : null;
  const r = await run({
    rules,
    paths: [suite.fixtures],
    ...(commitSuite ? { commits: { range: commitSuite.range, label: commitSuite.label }, cwd: commitSuite.cwd } : {}),
    cutoffs: opts.cutoffs ?? {},
    cachePath: null,
    force: true,
    retry: repeat,
    concurrency: opts.concurrency ?? DEFAULT_CONCURRENCY,
    model: opts.model ?? null,
    client: opts.client ?? null,
  });
  const passes: EvalAnswer[][] = (r.samples ?? []).map((pass) =>
    pass.map((s) => ({ rule: s.rule, file: s.file, line: s.line, endLine: s.endLine, kind: s.kind, value: s.value, confidence: s.confidence })),
  );
  const spent = { calls: r.spent.calls, inputTokens: r.spent.inputTokens, usd: r.spent.usd, ms: r.spent.wallMs ?? r.spent.ms };
  const model: string | null = r.servedModel ?? null;
  opts.log?.(`${suite.name}: ${repeat} pass(es), ${r.stats.subjects} subject(s), ${r.spent.calls} request(s), $${r.spent.usd.toFixed(5)}, ${spent.ms} ms`);
  const record: EvalRecord = {
    schema: "jev-lint-eval-1",
    recorded: new Date().toISOString(),
    model,
    suite: suite.name,
    rules: rules.map((r) => ({ id: r.id, draft: ruleTextHash(r), at: cutoffFor(r, opts.cutoffs ?? {}) })),
    cutoffs: opts.cutoffs ?? {},
    passes,
    spent,
  };
  writeFileSync(suite.last, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Every suite's cases and labels under `roots`, as one corpus.
 *
 * For the experiments (`tools/arms.ts`, `tools/grouping.ts`) that run every
 * rule over every case: the cases directories to scan, and the labels keyed
 * by the paths a run will report. Each suite labels only its own rule, so
 * another rule's answer on a suite's file is scored as clean by default --
 * the same convention the single corpus had, and the same caveat: a defect
 * for rule A sitting in rule B's cases is B's false positive until labelled.
 */
export function evalCorpus(roots: string[]): { paths: string[]; labels: Labels } {
  const labels: Labels = { $default: "clean" };
  const paths: string[] = [];
  for (const suite of discoverEvals(roots)) {
    if (!existsSync(suite.fixtures)) continue;
    paths.push(suite.fixtures);
    let own: Labels;
    try {
      own = readExpect(suite);
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(own)) {
      if (k.startsWith("$")) continue;
      labels[k] = [...((labels[k] as Label[] | undefined) ?? []), ...(v as Label[])];
    }
  }
  return { paths, labels };
}
