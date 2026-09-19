/**
 * The gate: answers in, findings out.
 *
 * Everything here is pure and runs offline. That separation is the point --
 * verdicts are what cost money, and thresholds are what you will change twenty
 * times while calibrating. Re-gating a recorded run is free, so `jevlint
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
import { cutoffFor, DEFAULT_UNSURE_BELOW, SCORE_LEVEL_NAMES } from "./rules.ts";
import type { Answer, Finding, GateResult, Subject } from "./types.ts";
export { MESSAGE_IDS } from "./types.ts";

/**
 * Decide one subject. Returns a finding or null.
 *
 * `answer` is `{value, confidence, kind}` from `readAnswer`, or null.
 */
export interface GateOptions {
  cutoffs?: Record<string, number>;
  unsureBelow?: number | null;
}

export function decide(
  subject: Subject,
  answer: Answer | null,
  { cutoffs = {}, unsureBelow }: GateOptions = {},
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
  };

  if (answer.value < at) {
    return { ...base, messageId: null, reported: false };
  }

  if (answer.kind === "score") {
    base.level = SCORE_LEVEL_NAMES[
      Math.max(0, Math.min(SCORE_LEVEL_NAMES.length - 1, Math.round(answer.value)))
    ];
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
  const findings = all.filter((f) => f.reported);
  findings.sort(
    (a, b) =>
      (b.margin ?? 0) - (a.margin ?? 0) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  return {
    findings,
    all,
    stats: {
      subjects: all.length,
      reported: findings.length,
      missing: all.filter((f) => f.messageId === "missing").length,
      unsure: all.filter((f) => f.messageId === "unsure").length,
      byRule: countBy(findings, (f) => f.rule),
    },
  };
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

  const scale = finding.kind === "score" ? "/3" : "";
  const num = `${finding.value.toFixed(2)}${scale}`;
  const conf =
    typeof finding.confidence === "number" ? `, confidence ${finding.confidence.toFixed(2)}` : "";
  const cut = `cutoff ${finding.at.toFixed(2)}`;
  const what = finding.message ?? finding.ask;

  switch (finding.messageId) {
    case "violation":
      return `${where}  ${finding.rule}: ${what} (${finding.level}, ${num}${conf}; ${cut})`;
    case "unsure":
      return `${where}  ${finding.rule}: would push back on this but is not sure -- worth a human look rather than a fix: ${what} (${num}${conf}; ${cut})`;
    case "flag":
      return `${where}  ${finding.rule}: ${what} (${num}; ${cut})`;
    default:
      return `${where}  ${finding.rule}: ${num}`;
  }
}
