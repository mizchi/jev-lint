/**
 * The scheduler: choosing the batching axis per rule, before spending anything.
 *
 * There are two axes and neither wins outright:
 *
 *   FILE axis   one state per file, carrying the source, shared by every match
 *               in that file. The source cost is amortised over the matches, so
 *               it wins when a rule matches many nodes per file. When a rule
 *               matches once in a 2000-line file it pays 2000 lines for one
 *               question -- and on a large repository with a narrow rule, that
 *               is the normal case rather than the exception.
 *   RULE axis   one state per rule, carrying only what the matcher caught from
 *               wherever it caught it. Cost tracks the matches, not the files.
 *               It carries an enclosing function only where the match is a
 *               fragment inside one; a rule matching whole functions gets no
 *               context at all, which makes the arm loss below sharper, not
 *               milder.
 *
 * Density is what that trade turns on, it differs per rule in the same run, and
 * it is knowable for free: `collectSubjects` has found every match before a
 * single request is made. This module plans both ways with the real planner and
 * picks per rule.
 *
 * Measured, the density story is weaker than it sounds: a 14-point sweep on
 * tokio and an 8-point one on vue found the token ratio rising monotonically
 * with density but only crossing 1.0 at about 135 distinct matches per file --
 * an order of magnitude past the densest rule anyone writes, and never reached
 * on tokio at all. The reason is in `buildRuleState`: deduplicating shared
 * enclosing functions bounds the rule axis's context cost near the file's own
 * source instead of letting it grow with density. So on tokens the rule axis
 * nearly always wins, and the scheduler's real job is the constraint below
 * rather than the arithmetic.
 *
 * ## It costs both ways rather than guessing
 *
 * No density heuristic, no threshold constant. `planBatches` is run over the
 * candidate assignment and the resulting batches are measured with the same
 * estimator the batch planner uses. A heuristic would be one more number to
 * calibrate and to drift; this way the scheduler is wrong only where the
 * estimator is wrong, and the estimator is already the thing the server's
 * `max_tokens_exceeded` corrects for.
 *
 * ## Why a greedy pass and not an optimum
 *
 * The axes interact. Two rules that both choose the file axis SHARE that file's
 * source in one state, so a rule's file-axis cost depends on which other rules
 * chose the file axis -- which makes the exact problem a set-cover, and
 * set-cover is not worth solving for a decision whose payoff is a token count.
 * The greedy pass below starts every rule on the rule axis and moves a rule to
 * the file axis only when doing so lowers the measured total, repeating until
 * nothing moves. It is deterministic, it terminates, and `explain()` reports
 * what it decided and why so the choice can be overruled.
 *
 * ## The safety constraint, which is the point
 *
 * Cost is not the only axis of comparison: the grouping moves verdicts. Forcing
 * the rule axis over the whole corpus took false positives from 4 to 10 with
 * true positives flat, and the two axes disagreed on 2.9% of 306 decisions.
 *
 * The mechanism is NOT crowding. An earlier reading of a corpus measurement
 * blamed anchoring between unrelated snippets; a proper sweep on two large
 * repositories retracted it -- the flips start at the smallest batch with any
 * neighbour and saturate immediately instead of growing with batch size, vue's
 * flips at batch 256 exactly equalled its own pass-to-pass noise at batch 1,
 * and 9 of 10 flips sat within 0.115 of their cutoff. That is a borderline
 * band, not an interaction. The corpus could never have answered the question:
 * its largest per-rule group is 42 subjects, so "batch 256" there was never
 * more than 42 neighbours.
 *
 * What does move verdicts is ARM DEGRADATION, and it is structural rather than
 * statistical: a rule-axis state spans files, so it cannot carry one, and
 * `located` becomes `local`. A rule whose evidence is the file loses its
 * evidence. See `FILE_BEARING_ARMS`.
 *
 * Three mechanisms follow, all on by default:
 *
 *   - a file-bearing arm holds its rule on the file axis, which is the
 *     constraint that actually protects accuracy;
 *   - a rule may PIN its axis (`axis: file`), and a calibrated rule should,
 *     because a cutoff fitted on one axis is not fitted for the other;
 *   - `ruleBatchCap` bounds a rule-axis state as a blast radius, not as a
 *     safety threshold -- there is no safe threshold to find.
 */
import { estimateTokens, planBatches, DEFAULT_BATCH_SIZE } from "./batch.ts";
import { USD_PER_MTOK } from "./jev.ts";
import type { Batch, Grouping, Rule, StateArm, Subject, SymbolIndex } from "./types.ts";

/**
 * How many subjects may share one rule-axis state.
 *
 * 32 rather than the 256 batch default, but NOT because a knee was found there.
 * A batch-size sweep on two large repositories found decision flips starting at
 * the smallest batch that has any neighbour at all (4) and saturating by 16
 * rather than growing with size -- so there is no safe sub-threshold to sit
 * under, and 32 is only a modest blast radius. Round trips fall off fast enough
 * that it costs little: 1 to 32 subjects per request already removes 97% of
 * them.
 *
 * The same sweep found those flips to be noise-dominated rather than a
 * demonstrated anchoring effect: on vue the 3 flips at batch 256 exactly
 * equalled its own pass-to-pass flips at batch 1, and 9 of 10 flips across both
 * repositories sat within 0.115 of their cutoff. The real accuracy cost of the
 * rule axis is the arm degradation below, not crowding.
 */
export const DEFAULT_RULE_BATCH_CAP = 32;

/**
 * Arms that cannot survive the rule axis.
 *
 * This is the scheduler's actual safety constraint, and it is a mechanism
 * rather than a heuristic. A rule-axis state holds matches from many files, so
 * it cannot carry "the file" -- `planRuleBatches` substitutes `local` for
 * `located` and `full`. For a rule that only needs its own match that costs
 * nothing, but for a rule whose evidence IS the file it silently removes the
 * evidence.
 *
 * Measured, and it lines up from three directions:
 *
 *   - `var-name-describes-value` is not separable at any cutoff without the
 *     file: `const timeoutSeconds = 5000` is only wrong if you can see 5000
 *     used as milliseconds.
 *   - On vue, 101 of 147 rule-axis batches fell back from `located`, covering
 *     58% of subjects, and that population is essentially that one rule.
 *   - Forcing the rule axis over the whole corpus took false positives from 4
 *     to 10 while true positives stayed flat.
 *
 * So a file-bearing arm pins the rule to the file axis. Cost optimisation
 * happens among the rules where it is free.
 */
const FILE_BEARING_ARMS = new Set<StateArm>(["located", "full"]);

/** Which axis each rule was assigned, and what it cost either way. */
export interface RuleDecision {
  rule: string;
  axis: Grouping;
  pinned: boolean;
  subjects: number;
  files: number;
  /** Matches per file: the quantity the choice actually turns on. */
  density: number;
  fileAxisTokens: number;
  ruleAxisTokens: number;
  fileAxisRequests: number;
  ruleAxisRequests: number;
  reason: string;
}

export interface Schedule {
  batches: Batch[];
  decisions: RuleDecision[];
  /**
   * The rules assigned to the file axis.
   *
   * Exposed so one decision can be reused. The runner has to decide the axis
   * over ALL subjects (the axis is part of the cache key, so it must not depend
   * on what happened to be cached) and then plan over only the uncached
   * remainder. Re-running the scheduler on the remainder gave a different
   * answer -- measured flipping both movable rules at 50%, 25% and 10%
   * remaining -- which stored a verdict under the other axis's key.
   */
  fileAxisRules: Set<string>;
  /** How many subjects the figures below were computed over. */
  plannedOver: number;
  /** What the two single-axis plans would have cost, for comparison. */
  allFile: { requests: number; tokens: number };
  allRule: { requests: number; tokens: number };
  chosen: { requests: number; tokens: number };
  ruleBatchCap: number;
}

interface PlanContext {
  sources?: Map<string, string> | null;
  symbols?: SymbolIndex | null;
  batchSize?: number;
  ruleBatchCap?: number;
}

const totals = (batches: Batch[]) => ({
  requests: batches.length,
  tokens: batches.reduce((a, b) => a + b.estimatedTokens, 0),
});

/**
 * Plan a mixed assignment: some rules on the file axis, the rest on the rule
 * axis, in one batch list.
 *
 * The two partitions are planned independently and concatenated, which is
 * sound because a state never spans both -- a file-axis state is one file's
 * matches and a rule-axis state is one rule's matches, and a subject belongs to
 * exactly one of them.
 */
export function planMixed(
  subjects: Subject[],
  fileAxisRules: Set<string>,
  { sources, symbols, batchSize = DEFAULT_BATCH_SIZE, ruleBatchCap = DEFAULT_RULE_BATCH_CAP }: PlanContext = {},
): Batch[] {
  const onFile = subjects.filter((s) => fileAxisRules.has(s.rule.id));
  const onRule = subjects.filter((s) => !fileAxisRules.has(s.rule.id));
  return [
    ...planBatches(onFile, { group: "file", sources, symbols, batchSize }),
    // The rule axis gets the tighter cap: its saving is in round trips, and a
    // crowded state is where anchoring was measured.
    ...planBatches(onRule, { group: "rule", sources, symbols, batchSize: ruleBatchCap }),
  ];
}

/**
 * Decide the axis for every rule, then plan.
 *
 * `pins` maps a rule id to an axis it must keep, which is how a calibrated rule
 * refuses to be moved.
 */
export function schedule(
  subjects: Subject[],
  rules: Rule[],
  {
    sources,
    symbols,
    batchSize = DEFAULT_BATCH_SIZE,
    ruleBatchCap = DEFAULT_RULE_BATCH_CAP,
  }: PlanContext = {},
): Schedule {
  const ctx = { sources, symbols, batchSize, ruleBatchCap };
  const present = [...new Set(subjects.map((s) => s.rule.id))];
  const byId = new Map(rules.map((r) => [r.id, r]));

  // Reference plans, for the report and for the pins.
  const allFileBatches = planBatches(subjects, { group: "file", sources, symbols, batchSize });
  const allRuleBatches = planBatches(subjects, { group: "rule", sources, symbols, batchSize: ruleBatchCap });

  // Two sources of a pin, and the rule's own always wins -- an author who
  // writes `axis: rule` has accepted the arm loss deliberately.
  const pinned = new Map<string, Grouping>();
  const armPinned = new Set<string>();
  for (const id of present) {
    const rule = byId.get(id);
    const axis = rule?.axis;
    if (axis === "file" || axis === "rule") {
      pinned.set(id, axis);
      continue;
    }
    // An arm the rule axis would have to strip pins the rule to the file axis.
    // Checked against the arms the SUBJECTS actually carry, since `--arm`
    // overrides the rule's declared one.
    const arms = new Set(subjects.filter((s) => s.rule.id === id).map((s) => s.arm));
    if ([...arms].some((a) => FILE_BEARING_ARMS.has(a))) {
      pinned.set(id, "file");
      armPinned.add(id);
    }
  }

  // Start every unpinned rule on the rule axis. That is the right starting
  // corner: the file axis only pays off where density is high, and a hill-climb
  // from the cheap-for-sparse corner moves exactly the dense rules.
  const onFileAxis = new Set<string>(
    [...pinned.entries()].filter(([, axis]) => axis === "file").map(([id]) => id),
  );

  const costOf = (assignment: Set<string>) => totals(planMixed(subjects, assignment, ctx));
  let current = costOf(onFileAxis);

  const movable = present.filter((id) => !pinned.has(id));
  // Terminates: every accepted move strictly lowers the token total, which is a
  // non-negative integer, and each pass either moves something or stops.
  for (let pass = 0; pass < movable.length + 1; pass += 1) {
    let moved = false;
    for (const id of movable) {
      const candidate = new Set(onFileAxis);
      if (candidate.has(id)) candidate.delete(id);
      else candidate.add(id);
      const cost = costOf(candidate);
      if (cost.tokens < current.tokens) {
        onFileAxis.clear();
        for (const x of candidate) onFileAxis.add(x);
        current = cost;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const batches = planMixed(subjects, onFileAxis, ctx);

  // Per-rule figures for the report: what THIS rule alone would cost each way.
  // Measured in isolation, so the numbers explain the density rather than the
  // interaction, and are comparable across rules.
  const decisions: RuleDecision[] = present.map((id) => {
    const mine = subjects.filter((s) => s.rule.id === id);
    const files = new Set(mine.map((s) => s.file)).size;
    const soloFile = totals(planBatches(mine, { group: "file", sources, symbols, batchSize }));
    const soloRule = totals(
      planBatches(mine, { group: "rule", sources, symbols, batchSize: ruleBatchCap }),
    );
    const axis: Grouping = onFileAxis.has(id) ? "file" : "rule";
    const pin = pinned.get(id);
    return {
      rule: id,
      axis,
      pinned: pin !== undefined,
      subjects: mine.length,
      files,
      density: files > 0 ? Math.round((mine.length / files) * 100) / 100 : 0,
      fileAxisTokens: soloFile.tokens,
      ruleAxisTokens: soloRule.tokens,
      fileAxisRequests: soloFile.requests,
      ruleAxisRequests: soloRule.requests,
      reason: armPinned.has(id)
        ? `held on the file axis: its \`${[...new Set(mine.map((s) => s.arm))].join("/")}\` arm needs the file, and the rule axis would substitute \`local\``
        : pin
        ? `pinned to the ${pin} axis by the rule`
        : axis === "file"
          ? `${mine.length} match(es) over ${files} file(s) -- dense enough that sharing each file's source costs less than repeating each match's context`
          : `${mine.length} match(es) over ${files} file(s) -- too sparse to amortise a whole file per question`,
    };
  });

  return {
    batches,
    decisions,
    fileAxisRules: onFileAxis,
    plannedOver: subjects.length,
    allFile: totals(allFileBatches),
    allRule: totals(allRuleBatches),
    chosen: totals(batches),
    ruleBatchCap,
  };
}

/** The scheduler's report. Free to produce; nothing here has been asked yet. */
export function explain(s: Schedule): string {
  const out: string[] = [];
  const w = [36, 6, 9, 8, 8, 11, 11];
  out.push(
    ["rule", "axis", "subjects", "files", "density", "file tokens", "rule tokens"]
      .map((h, i) => h.padEnd(w[i]!))
      .join(" "),
  );
  out.push(w.map((n) => "-".repeat(n)).join(" "));
  for (const d of [...s.decisions].sort((a, b) => b.density - a.density)) {
    out.push(
      [
        d.rule.slice(0, w[0]!),
        d.axis + (d.pinned ? "*" : ""),
        String(d.subjects),
        String(d.files),
        d.density.toFixed(2),
        d.fileAxisTokens.toLocaleString(),
        d.ruleAxisTokens.toLocaleString(),
      ]
        .map((v, i) => v.padEnd(w[i]!))
        .join(" "),
    );
  }
  out.push("");
  out.push("* held rather than chosen by cost: either pinned by the rule, or on a");
  out.push("  file-bearing arm (located/full) that the rule axis would have to strip.");
  out.push("");
  const row = (label: string, t: { requests: number; tokens: number }) =>
    `  ${label.padEnd(16)} ${String(t.requests).padStart(5)} request(s)  ${t.tokens.toLocaleString().padStart(11)} tokens  $${((t.tokens / 1e6) * USD_PER_MTOK).toFixed(5)}`;
  // All three rows are over the same subject set, and the count is stated.
  // They used to be printed beside a plan built over a different set -- the
  // uncached remainder -- which made them disagree with the run they described
  // by 16% on tokio.
  out.push(`  over ${s.plannedOver} subject(s):`);
  out.push(row("all file axis", s.allFile));
  out.push(row("all rule axis", s.allRule));
  out.push(row("scheduled", s.chosen));
  const best = Math.min(s.allFile.tokens, s.allRule.tokens);
  const delta = best > 0 ? ((s.chosen.tokens / best - 1) * 100).toFixed(1) : "0.0";
  out.push("");
  out.push(
    `  Scheduled is ${delta}% against the better single axis, with a rule-axis cap of ${s.ruleBatchCap} subjects per request.`,
  );
  out.push(
    "  Estimates come from the same token estimator the batch planner uses; nothing has been asked yet.",
  );
  return out.join("\n");
}
