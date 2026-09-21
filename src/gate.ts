/**
 * The gate: answers in, findings out.
 *
 * Everything here is pure and runs offline. That separation is the point --
 * verdicts are what cost money, and thresholds are what you will change twenty
 * times while calibrating. Re-gating a recorded run is free, so `jev-lint
 * replay` can re-score yesterday's answers under today's cutoffs without a
 * single request.
 *
 * Three rules this follows, each of them a measured result rather than taste:
 *
 * 1. **Cutoffs are per rule, never shared.** Eight same-shaped questions were
 *    measured returning between 0.20 and 0.94 for their own defect class. The
 *    cold ones were not broken -- their ranking was fine -- they simply never
 *    reached a common threshold. A single cutoff across rules throws away the
 *    rules that answer quietly.
 *
 * 2. **Confidence routes, it does not gate.** Requiring confidence before
 *    reporting was measured costing 7-11 points of recall for nothing, because
 *    clean and broken code occupy the same confidence band. A low-confidence
 *    verdict over the cutoff is still reported -- just worded as a question for
 *    a human rather than as a verdict.
 *
 * 3. **No answer is not a passing grade.** A missing or malformed answer
 *    produces no finding AND is counted, because a run where half the requests
 *    failed must not look like a clean repository.
 */
import { cutoffFor, DEFAULT_UNSURE_BELOW, SCORE_LEVEL_NAMES, scaleOf } from "./rules.ts";
import { SEVERITIES } from "./types.ts";
import type { Answer, Finding, GateResult, Rule, Severity, Subject } from "./types.ts";
export { MESSAGE_IDS } from "./types.ts";

/** Per-run threshold overrides, all optional. */
export interface GateOptions {
  cutoffs?: Record<string, number>;
  unsureBelow?: number | null;
  /**
   * List the band under each cutoff for a reader: at most this many
   * subjects, closest to their cutoff first. null or undefined is off.
   */
  loose?: number | null;
}

/**
 * The floor of a rule's `--loose` band: its own `loose:`, else half its
 * cutoff in force.
 *
 * Half is not a tuned number; it is where the shipped evals put it. Across
 * the 24 shipped rules no defect a rule can see sits under half its cutoff,
 * and about one clean subject in twenty sits over -- so the band catches
 * what the rule would ever catch and costs a reader one look per twenty
 * subjects. A rule that has measured its own clean band can say so.
 */
export function looseFloor(rule: Rule, cutoffs: Record<string, number> = {}): number {
  if (typeof rule.loose === "number") return rule.loose;
  return cutoffFor(rule, cutoffs) / 2;
}

/**
 * Decide one subject. Always returns a finding, whose `reported` says whether
 * it is one anyone should see.
 *
 * Never null, and that matters: a subject with no usable answer becomes a
 * finding with `messageId: "missing"` so a run where requests failed cannot
 * read as a clean repository.
 *
 * `answer` is `{value, confidence, kind}` from `readAnswer`, or null.
 */
export function decide(
  subject: Subject,
  answer: Answer | null,
  { cutoffs = {}, unsureBelow, loose = null }: GateOptions = {},
): Finding {
  const rule = subject.rule;
  const at = cutoffFor(rule, cutoffs);

  if (!answer) {
    return {
      messageId: "missing",
      reported: false,
      rule: rule.id,
      severity: rule.severity,
      file: subject.file,
      line: subject.line,
      endLine: subject.endLine,
      at,
      value: null,
      confidence: null,
    };
  }

  const base: Finding = {
    messageId: null,
    reported: false,
    rule: rule.id,
    severity: rule.severity,
    file: subject.file,
    line: subject.line,
    endLine: subject.endLine,
    at,
    value: answer.value,
    confidence: answer.confidence,
    kind: answer.kind,
    // How far past its own cutoff the answer is. The only sound way to rank
    // findings from different rules against each other, since their raw scales
    // are not comparable.
    margin: at > 0 ? answer.value / at : answer.value,
    ask: rule.ask,
    message: rule.message ?? null,
    docs: rule.docs ?? null,
    text: subject.text,
    captured: subject.captured ?? null,
    arm: subject.arm,
    // A commit subject's `text` is the message, so its first line is a
    // subject line worth quoting. A change subject's `text` is the STAT --
    // reporting that under `commit.subject` would title a change finding
    // with `"cart.ts | 1 +"` as though someone had written it as a commit
    // message. `change` reports the stat's own summary line instead
    // (`captured.SUBJECT`, the line `changeSubject` put there for exactly
    // this), under a field name that does not claim to be a message.
    ...(subject.commit
      ? rule.subject === "change"
        ? { change: { summary: subject.captured?.SUBJECT ?? subject.text.split("\n").pop() ?? "" } }
        : { commit: { subject: subject.text.split("\n")[0] ?? "" } }
      : {}),
    ...(subject.textCut ? { cut: { judged: subject.text.length, of: subject.textCut.of } } : {}),
  };

  if (answer.value < at) {
    // Under the cutoff. With `--loose`, the top of that range is listed for
    // a reader; it is still not reported, so nothing that counts findings
    // or turns the exit code can see it.
    const review = loose !== null && answer.value >= looseFloor(rule, cutoffs);
    return { ...base, messageId: review ? "review" : null, reported: false };
  }

  if (answer.kind === "score") {
    const top = scaleOf(rule);
    const nearest = Math.max(0, Math.min(top, Math.round(answer.value)));
    // The shared scale's levels have names; a rule's own are numbered.
    base.level = rule.levels ? `level-${nearest}` : SCORE_LEVEL_NAMES[nearest];
    base.scale = top;
    const threshold = typeof rule.unsureBelow === "number"
      ? rule.unsureBelow
      : (unsureBelow ?? DEFAULT_UNSURE_BELOW);
    const unsure = typeof answer.confidence === "number" && answer.confidence < threshold;
    return { ...base, messageId: unsure ? "unsure" : "violation", reported: true };
  }

  // A noul has no confidence to route on, so there is no `unsure` variant.
  return { ...base, messageId: "flag", reported: true };
}

/** Decide a whole run. Returns `{findings, all, stats}`. */
export function gate(
  results: Array<{ subject: Subject; answer: Answer | null }>,
  options: GateOptions = {},
): GateResult {
  const all = results.map(({ subject, answer }) => decide(subject, answer, options));
  const byMargin = (a: Finding, b: Finding) =>
    (b.margin ?? 0) - (a.margin ?? 0) || a.file.localeCompare(b.file) || a.line - b.line;
  const findings = all.filter((f) => f.reported).sort(byMargin);
  // The band, ranked the same way -- margin is value over cutoff, so under
  // the cutoff it ranks by how close -- and capped at what was asked for.
  // Over the cap, the ones dropped are the ones furthest from a cutoff.
  const cap = options.loose ?? 0;
  const review = all.filter((f) => f.messageId === "review").sort(byMargin).slice(0, Math.max(0, cap));
  return {
    findings,
    all,
    review,
    stats: {
      subjects: all.length,
      reported: findings.length,
      missing: all.filter((f) => f.messageId === "missing").length,
      unsure: all.filter((f) => f.messageId === "unsure").length,
      review: review.length,
      byRule: countBy(findings, (f) => f.rule),
      byFile: byFile(all, findings),
    },
  };
}

/** Every file a subject was in, with how many were judged there and how many reported. */
function byFile(all: Finding[], findings: Finding[]): Record<string, { findings: number; subjects: number }> {
  const out: Record<string, { findings: number; subjects: number }> = {};
  for (const f of all) (out[f.file] ??= { findings: 0, subjects: 0 }).subjects += 1;
  for (const f of findings) out[f.file]!.findings += 1;
  return out;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * The human-facing sentence for a finding.
 *
 * A rule's `note` is never shown. It is context written for the model --
 * usually an exception clause -- and surfacing it would read as if it were part
 * of the complaint.
 */
export function describe(finding: Finding): string {
  const where = `${finding.file}:${finding.line}`;

  // A missing verdict has no number to format, and formatting it anyway is how
  // a fail-open path turns into a crash. This branch comes first for that
  // reason, not for tidiness.
  if (finding.messageId === "missing" || typeof finding.value !== "number") {
    return `${where}  ${finding.rule}: no verdict (the request failed or returned an unusable answer)`;
  }

  const scale = finding.kind === "score" ? `/${finding.scale ?? 3}` : "";
  const num = `${finding.value.toFixed(2)}${scale}`;
  const confidenceNote =
    typeof finding.confidence === "number" ? `, confidence ${finding.confidence.toFixed(2)}` : "";
  const cutoffNote = `cutoff ${finding.at.toFixed(2)}`;
  const what = finding.message ?? finding.ask;

  switch (finding.messageId) {
    case "violation":
      return `${where}  ${finding.rule}: ${what} (${finding.level}, ${num}${confidenceNote}; ${cutoffNote})`;
    case "unsure":
      return `${where}  ${finding.rule}: would push back on this but is not sure -- worth a human look rather than a fix: ${what} (${num}${confidenceNote}; ${cutoffNote})`;
    case "flag":
      return `${where}  ${finding.rule}: ${what} (${num}; ${cutoffNote})`;
    case "review":
      return `${where}  ${finding.rule}: under its cutoff but over the loose floor -- worth a reader's look, not a finding: ${what} (${num}${confidenceNote}; ${cutoffNote})`;
    default:
      return `${where}  ${finding.rule}: ${num}`;
  }
}

/**
 * Does this set of findings turn the exit code?
 *
 * By default any finding does, which is what `check` in CI wants. A pre-commit
 * hook wants something narrower: a probabilistic reviewer that can refuse a
 * commit on a `warning` is one that gets uninstalled, so `--fail-on error`
 * lets the hook print everything and block only on what a rule has earned.
 */
export function blocks(findings: Finding[], failOn: Severity | null): boolean {
  // A `review` row from the loose band handed here by mistake must not turn
  // a build, whatever list it came in.
  const counted = findings.filter((f) => f.messageId !== "review");
  if (failOn === null) return counted.length > 0;
  const floor = SEVERITIES.indexOf(failOn);
  return counted.some((f) => SEVERITIES.indexOf(f.severity) >= floor);
}
