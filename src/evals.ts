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
import { cutoffFor, languageDirGrammars, loadRules, ruleTextHash, scaleOf } from "./rules.ts";
import { patchRepo } from "./commits.ts";
import { run } from "./run.ts";
import { DEFAULT_CONCURRENCY, type AskClient } from "./jev.ts";
import { isGitSubject } from "./types.ts";
import type { CustomLanguages, Label, Labels, Rule } from "./types.ts";

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
  /**
   * How far the quietest labelled defect's mean sits above the cutoff,
   * normalised by `scaleOf` (0..1 for a noul, 0..1 of the rubric for a
   * score) so it is comparable across rules. Small means a defect sits near
   * the boundary: a rule that starts missing things fails the eval before it
   * fails silently in the wild. `null` when the suite has no EXPLICITLY
   * labelled defect for this rule -- see `MIN_MARGIN_SUBJECTS` below for why
   * "explicitly".
   */
  fnMargin: number | null;
  /**
   * How far the cutoff sits above the loudest labelled clean's mean,
   * normalised the same way. Small means a clean sits near the boundary: a
   * rule that starts over-flagging fails the eval. `null` when the suite has
   * no explicitly labelled clean for this rule.
   */
  fpMargin: number | null;
  /**
   * The pass-to-pass spread (max minus min, normalised by `scaleOf` like the
   * margin it sits beside) of the ONE case that sets `fnMargin` -- the
   * quietest labelled defect, not the widest spread anywhere near the
   * boundary. Reused because the margin is a claim about that specific
   * case's mean, so it is that case's own noise, not some other case's,
   * that decides whether the margin is signal or a coin flip. `null` when
   * `fnMargin` is `null`, or the run had fewer than two passes for that
   * case -- see the single-pass note on `unstable`.
   */
  fnSpread: number | null;
  /** As `fnSpread`, for the case that sets `fpMargin`. */
  fpSpread: number | null;
  /**
   * Both margins at or over `BLIND_THRESHOLD`, with the corpus past
   * `MIN_MARGIN_SUBJECTS`: this suite's own fixtures cannot see the rule
   * drift, so `RULES.md`'s precision and recall from it are not worth much.
   * `false` when either margin is `null`, either is narrow, or the corpus is
   * too small to say -- a suite that cannot speak yet is not the same claim
   * as a suite that spoke and came back wide.
   */
  blind: boolean;
  /**
   * The mirror failure: `Math.abs(margin)` narrower than the pass-to-pass
   * spread of the case that sets it, with the corpus past
   * `MIN_MARGIN_SUBJECTS`. Which side of the cutoff that case lands on is
   * then decided by which pass happened to run, not by the rule --
   * `calibration.md`'s wobble band, applied to the case an eval is
   * actually trusting. The absolute value, not the signed margin: a large
   * NEGATIVE margin is a case decided wrong on every pass (a plain miss,
   * already visible as `wrong`), not one whose side is in doubt -- a
   * signed comparison would call every confidently-wrong case unstable for
   * free. `false` when neither margin is both present and narrower (in
   * magnitude) than its own spread, when the corpus is too small to say,
   * or when the run had too few passes to measure a spread at all (see
   * `MIN_SPREAD_PASSES`).
   */
  unstable: boolean;
  /**
   * This rule's own `inconclusive:` declaration in its `rule.yml`,
   * verbatim, or null. Covers both `blind` and `unstable`: one field, since
   * a corpus that cannot speak reliably about drift is one idea with two
   * symmetrical shapes, not two fields to keep in sync.
   */
  inconclusiveReason: string | null;
}

/**
 * 0.25 of a rule's own scale (`scaleOf`): the value this repository's own
 * survey of its 65 suites used to separate "blind" from the rest, decided
 * by inspection of where a corpus stopped being able to say anything about
 * drift -- a convention picked once, not a measurement that could drift
 * itself. A suite whose FN-margin and FP-margin are both at or over this,
 * normalised, is reported `blind`.
 */
export const BLIND_THRESHOLD = 0.25;

/**
 * The floor `calibration.md` sets for a gap to mean anything: "six or more
 * matches per rule, both classes present" (the same number `gapReport`'s
 * `thin` verdict uses). A margin computed from one labelled defect and one
 * labelled clean is a real number and a weak claim; under this many matched
 * subjects for the rule, `blind` is reported `false` rather than asserted
 * either way -- a suite that has not spoken yet is not a suite that spoke
 * and came back wide.
 */
export const MIN_MARGIN_SUBJECTS = 6;

/**
 * A spread is a range across passes; a single number has no range. Under
 * this many passes for the case that sets a margin, its spread is `null`
 * rather than `0` -- `0` would claim the case is perfectly stable, which is
 * not known, only unmeasured. `--repeat 1` is a legal eval (the shipped
 * loop's `eval` mode defaults to 3, but a rule may be checked with one), and
 * every case in a single-pass run has exactly one value, so `unstable` is
 * never asserted from one: the run simply has not spoken on stability,
 * which is not the same claim as "stable".
 */
export const MIN_SPREAD_PASSES = 2;

/**
 * A label from an entry someone actually wrote, never from `$default`.
 *
 * `expect.yml`'s `default: clean` makes every subject a labelled corpus
 * scores against, and `labelFor` (calibrate.ts) rightly resolves through it
 * for precision/recall and for `cleanTop` -- unlabelled is clean, as in a
 * corpus. A margin is a different claim: it says a specific location is the
 * quietest defect or the loudest clean anyone found, evidence a rule's
 * cutoff is safe. A subject nobody looked at is not that evidence -- it is
 * the vast majority of any fixture file, at whatever value the model
 * happens to give it, and letting it set the FP-margin would let a suite
 * that never wrote a single hard-clean fixture read as un-blind by accident
 * of what the model returned for lines nobody chose. One shipped suite was
 * entirely `$default`-clean until its boundary fixtures were added; this is
 * why it read as blind rather than as clean-by-luck.
 *
 * So: only an entry that names this file and line, for this rule (or with
 * no `rule:`, for every rule), counts. `null` when nothing explicit covers
 * it, whether or not `$default` would resolve it to something.
 */
function explicitLabelFor(labels: Labels, file: string, line: number, rule: string): "bad" | "clean" | null {
  const forFile = labels[file];
  if (!Array.isArray(forFile)) return null;
  let result: "bad" | "clean" | null = null;
  for (const l of forFile as Label[]) {
    const within = Math.abs((l.line ?? -1) - line) <= (l.window ?? 3);
    if (!within) continue;
    if (l.rule && l.rule !== rule) continue;
    if (l.label === "bad") return "bad";
    if (l.label === "clean") result = "clean";
  }
  return result;
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
  // the report, never for the verdict. `min`/`max` carry each case's own
  // range across its passes, not just its mean -- see `fitCutoffs`'s
  // docstring for why a fit needs the range to say whether a gap is stable.
  const meanAnswers = cases.map((c) => ({
    rule: c.rule, file: c.file, line: c.line, endLine: c.line, value: c.mean,
    min: Math.min(...c.values), max: Math.max(...c.values), confidence: null,
    messageId: null, kind: "noul" as const, ask: "", severity: "warning" as const, message: null, cutoff: 0, margin: 0,
  }));
  const fits = new Map(fitCutoffs(meanAnswers as never, labels, rules).map((f) => [f.rule, f]));

  const ruleScores: RuleScore[] = rules.map((r) => {
    const mine = cases.filter((c) => c.rule === r.id);
    const tp = mine.filter((c) => c.label === "bad" && c.decision === "flag").length;
    const fp = mine.filter((c) => c.label !== "bad" && c.decision === "flag").length;
    const fn = mine.filter((c) => c.label === "bad" && c.decision === "pass").length;
    const fit = fits.get(r.id);
    const at = atFor.get(r.id)!;
    const scale = scaleOf(r);

    // Explicit-only, unlike `cleanTop` above: see `explicitLabelFor`. Kept as
    // the case objects, not just their means, so the margin-setting case's
    // own `values` (its answer on every pass) is still at hand below --
    // the spread is that specific case's noise, not the corpus's.
    const explicitBad = mine.filter((c) => explicitLabelFor(labels, c.file, c.line, c.rule) === "bad");
    const explicitClean = mine.filter((c) => explicitLabelFor(labels, c.file, c.line, c.rule) === "clean");
    // The quietest defect / loudest clean: the one case each margin is
    // actually a claim about. Ties keep the first in `cases`' sort order
    // (rule, file, line), which is deterministic, not meaningful.
    const quietestBad = explicitBad.length > 0 ? explicitBad.reduce((min, c) => (c.mean < min.mean ? c : min)) : null;
    const loudestClean = explicitClean.length > 0 ? explicitClean.reduce((max, c) => (c.mean > max.mean ? c : max)) : null;
    const fnMargin = quietestBad ? round((quietestBad.mean - at) / scale) : null;
    const fpMargin = loudestClean ? round((at - loudestClean.mean) / scale) : null;

    // The spread of THAT case, across whichever passes fed this score --
    // not the widest spread anywhere near the boundary. A margin is a claim
    // about one case's mean; whether that mean is signal or noise is decided
    // by that case's own range, not by how noisy some other case happens to
    // be. See `MIN_SPREAD_PASSES` for why fewer than two passes gives `null`.
    const spreadOf = (c: CaseScore | null): number | null =>
      c && c.values.length >= MIN_SPREAD_PASSES ? round((Math.max(...c.values) - Math.min(...c.values)) / scale) : null;
    const fnSpread = spreadOf(quietestBad);
    const fpSpread = spreadOf(loudestClean);

    const enoughSubjects = mine.length >= MIN_MARGIN_SUBJECTS;
    const blind =
      enoughSubjects &&
      fnMargin !== null &&
      fpMargin !== null &&
      fnMargin >= BLIND_THRESHOLD &&
      fpMargin >= BLIND_THRESHOLD;
    // Either side is enough: a margin narrower than its own case's spread is
    // a coin flip on THAT side regardless of how solid the other side is --
    // unlike `blind`, which needs both sides wide before the corpus is
    // uninformative in every direction.
    //
    // Compared on `Math.abs(margin)`, not the signed margin: a large
    // NEGATIVE margin is a case that is confidently decided wrong on every
    // pass (already counted in `tp`/`fp`/`fn`, already visible as `wrong`
    // in the report), not a case whose side is undecided. Signed comparison
    // would call every sufficiently-wrong case "unstable" for free, since
    // any negative number is smaller than any non-negative spread --
    // measured on this repository's own suites: `comment-describes-declaration`'s
    // one labelled clean sits at 0.79 against a cutoff of 0.53 with a
    // spread of 0.17 (values 0.69/0.81/0.86, all three over the cutoff on
    // every single pass) -- an FP-margin of -0.26, confidently wrong, and
    // wrongly `unstable` under a signed comparison. `Math.abs` correctly
    // leaves it alone: 0.26 is not smaller than 0.17.
    const unstable =
      enoughSubjects &&
      ((fnMargin !== null && fnSpread !== null && Math.abs(fnMargin) < fnSpread) ||
        (fpMargin !== null && fpSpread !== null && Math.abs(fpMargin) < fpSpread));

    return {
      rule: r.id,
      at,
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
      fnMargin,
      fpMargin,
      fnSpread,
      fpSpread,
      blind,
      unstable,
      inconclusiveReason: r.inconclusive,
    };
  });
  return { rules: ruleScores, cases };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * `inconclusive:` and the two verdicts disagreeing, named per rule: a suite
 * blind or unstable with no declaration, or a declaration on a suite that
 * is (any more) neither.
 *
 * Read by `compareEvals` below and folded into its `reasons`, so `eval
 * --replay` fails on this through the one exit-code path it already has for
 * a regression, rather than a second mechanism beside it: `cmdEval` reads
 * only `diff.ok`/`diff.reasons`, unchanged. Kept the name `blindTrouble`
 * even though it now also reports `unstable`: it is still the one function
 * `compareEvals` calls for "this corpus cannot speak reliably", and a
 * rename here would be a second thing to keep in sync with `inconclusive`
 * for no reader benefit.
 */
export function blindTrouble(score: EvalScore): string[] {
  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(2));
  const reasons: string[] = [];
  for (const r of score.rules) {
    const troubled = r.blind || r.unstable;
    if (troubled && !r.inconclusiveReason) {
      if (r.blind) {
        reasons.push(
          `${r.rule}: blind -- FN-margin ${fmt(r.fnMargin)} and FP-margin ${fmt(r.fpMargin)} are both >= ${BLIND_THRESHOLD} of scale, ` +
            "so this corpus cannot see the rule drift. Declare `inconclusive:` in its rule.yml with why, or aim a fixture at the boundary.",
        );
      }
      if (r.unstable && r.fnMargin !== null && r.fnSpread !== null && Math.abs(r.fnMargin) < r.fnSpread) {
        reasons.push(
          `${r.rule}: unstable on the FN side -- FN-margin ${fmt(r.fnMargin)} is smaller than the quietest labelled defect's own pass-to-pass spread ${fmt(r.fnSpread)}, ` +
            "so whether it clears the cutoff is decided by the run, not the rule. Declare `inconclusive:` in its rule.yml with why, or add a pass or fixtures with less pass-to-pass noise at the boundary.",
        );
      }
      if (r.unstable && r.fpMargin !== null && r.fpSpread !== null && Math.abs(r.fpMargin) < r.fpSpread) {
        reasons.push(
          `${r.rule}: unstable on the FP side -- FP-margin ${fmt(r.fpMargin)} is smaller than the loudest labelled clean's own pass-to-pass spread ${fmt(r.fpSpread)}, ` +
            "so whether it stays under the cutoff is decided by the run, not the rule. Declare `inconclusive:` in its rule.yml with why, or add a pass or fixtures with less pass-to-pass noise at the boundary.",
        );
      }
    } else if (!troubled && r.inconclusiveReason) {
      reasons.push(
        `${r.rule}: declares \`inconclusive: ${r.inconclusiveReason.slice(0, 80)}\` but it is neither blind nor unstable ` +
          `(FN-margin ${fmt(r.fnMargin)}/spread ${fmt(r.fnSpread)}, FP-margin ${fmt(r.fpMargin)}/spread ${fmt(r.fpSpread)}) -- stale exemption, drop it.`,
      );
    }
  }
  return reasons;
}

/**
 * What changed since the baseline, case by case.
 *
 * A regression is a case that was decided rightly and now is not; an
 * improvement the reverse. A case only one side has is reported, not judged.
 * With `draftChanged` the baseline answered a different question, and the
 * comparison is refused rather than made. A suite blind or unstable with no
 * `inconclusive:`, or declaring one it no longer earns, fails here too --
 * see `blindTrouble`.
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
  reasons.push(...blindTrouble(current));
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
  /** Grammars ast-grep does not have built in: a suite of such a language cannot be scanned without one. */
  languages?: CustomLanguages;
  log?: (line: string) => void;
}

/** Load a suite's rule file and labels. Errors are the caller's to print. */
export function loadSuite(suite: EvalSuite, languages: CustomLanguages = {}): { rules: Rule[]; labels: Labels; errors: string[] } {
  const { rules, errors } = loadRules([suite.ruleFile], languages);
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
export async function planEval(suite: EvalSuite, repeat = 1, languages: CustomLanguages = {}): Promise<{ subjects: number; requests: number; tokens: number }> {
  const { rules, errors } = loadSuite(suite, languages);
  if (errors.length) throw new Error(errors.join("\n"));
  const commitSuite = rules.some((rule) => isGitSubject(rule.subject)) ? patchRepo(suite.fixtures) : null;
  const r = await run({
    rules,
    paths: [suite.fixtures],
    ...(commitSuite ? { commits: { range: commitSuite.range, label: commitSuite.label }, cwd: commitSuite.cwd } : {}),
    cachePath: null,
    force: true,
    dryRun: true,
    languages,
  });
  const tokens = r.batches.reduce((a, b) => a + b.estimatedTokens, 0);
  // `r.subjects`, not the gate's count: a dry run decides nothing.
  return { subjects: r.subjects.length, requests: r.batches.length * Math.max(1, repeat), tokens: tokens * Math.max(1, repeat) };
}

/**
 * Subject-answers a run never got, counted across every pass.
 *
 * A batch whose request fails yields one null answer per subject -- fail
 * open, so the gate records `missing` rather than a clean bill of health --
 * and so does an answer the reader cannot use. `scoreEval` then works over
 * whatever came back, which is the right thing for it to do and says nothing
 * about the rest: precision, recall and flips off three answered subjects of
 * ten look exactly like precision, recall and flips off ten. In the whole-run
 * case a baseline of nothing replays as "all as shipped" with tp, fp and fn
 * all zero. Everything that reports or accepts a record asks this first.
 */
export function unanswered(passes: EvalAnswer[][]): number {
  return passes.reduce((n, pass) => n + pass.filter((a) => a.value === null).length, 0);
}

/** Ask the suite's rule about its cases, `repeat` times, and record it. */
export async function runEval(suite: EvalSuite, opts: RunEvalOptions = {}): Promise<EvalRecord> {
  const repeat = Math.max(1, opts.repeat ?? 1);
  const { rules, errors } = loadSuite(suite, opts.languages ?? {});
  if (errors.length) throw new Error(errors.join("\n"));
  // One run, `repeat` passes: the runner interleaves the passes' requests,
  // so three passes over a suite cost the wall time of one and a bit,
  // and the cases are scanned once rather than once per pass.
  // A commit suite's fixtures are cases: each made a commit of a throwaway
  // repository, judged as commits or as changes depending on the suite's
  // rule, and named by their case directories so the expectations key on
  // `fixtures/<case>` at line 1.
  const commitSuite = rules.some((rule) => isGitSubject(rule.subject)) ? patchRepo(suite.fixtures) : null;
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
    languages: opts.languages ?? {},
  });
  const passes: EvalAnswer[][] = (r.samples ?? []).map((pass) =>
    pass.map((s) => ({ rule: s.rule, file: s.file, line: s.line, endLine: s.endLine, kind: s.kind, value: s.value, confidence: s.confidence })),
  );
  const spent = { calls: r.spent.calls, inputTokens: r.spent.inputTokens, usd: r.spent.usd, ms: r.spent.wallMs ?? r.spent.ms };
  const model: string | null = r.servedModel ?? null;
  opts.log?.(`${suite.name}: ${repeat} pass(es), ${r.stats.subjects} subject(s), ${r.spent.calls} request(s), $${r.spent.usd.toFixed(5)}, ${spent.ms} ms`);
  const empty = unanswered(passes);
  if (empty > 0) {
    const asked = passes.reduce((n, pass) => n + pass.length, 0);
    const why = (r.errors ?? []).length > 0 ? `${(r.errors ?? []).length} request(s) failed: ${r.errors![0]!.error.slice(0, 120)}` : "no request reported an error, so the answers came back unreadable";
    opts.log?.(
      `${suite.name}: ${empty} of ${asked} subject-answer(s) came back empty -- ${why}. ` +
        "Everything below is measured over the rest; re-run before trusting it.",
    );
  }
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
export function evalCorpus(roots: string[]): { paths: string[]; labels: Labels; errors: string[] } {
  const labels: Labels = { $default: "clean" };
  const paths: string[] = [];
  const errors: string[] = [];
  for (const suite of discoverEvals(roots)) {
    if (!existsSync(suite.fixtures)) continue;
    paths.push(suite.fixtures);
    let own: Labels;
    try {
      own = readExpect(suite);
    } catch (err: unknown) {
      // The suite's cases are still scanned; its labels are missing, and a
      // missing label reads as clean, which is a corpus lying quietly. Said
      // here for the caller to print, since a suite with a broken expect
      // file used to vanish from the corpus without a word.
      errors.push(`${suite.expect}: ${String(err).slice(0, 160)}`);
      continue;
    }
    for (const [k, v] of Object.entries(own)) {
      if (k.startsWith("$")) continue;
      labels[k] = [...((labels[k] as Label[] | undefined) ?? []), ...(v as Label[])];
    }
  }
  return { paths, labels, errors };
}
