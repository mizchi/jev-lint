/**
 * Packing subjects into requests.
 *
 * The server has two independent input-token budgets and neither is a question
 * count:
 *
 *   MAX_REQUEST_TOKENS  the whole request
 *   MAX_STATE_TOKENS    the `state` alone -- and this is the one that fills
 *                       first, because the state carries the file
 *
 * Over a thousand questions go through in one request. So "how many questions
 * can I ask" is the wrong worry; "how big is the state" is the right one. A
 * self-imposed `batchSize` cap remains worth having anyway: it bounds the blast
 * radius of one rejected request and bounds how much work a split has to redo.
 *
 * The estimator below is approximate, but the state budget is the one place
 * where approximate is not enough: the client recovers from a request over
 * budget by halving the question set, and halving does nothing for a state over
 * budget. That case ends in lost verdicts. So the estimator is measured per
 * payload shape, and the planner packs to a margin under each budget rather
 * than up to it.
 */
import { buildQuestion, questionId } from "./questions.ts";
import { buildState, buildRuleState } from "./state.ts";
import type { RelatedTest } from "./paired.ts";
import type {
  ArmFallback,
  Batch,
  Grouping,
  Question,
  Rule,
  StateArm,
  StatePayload,
  Subject,
  SymbolIndex,
} from "./types.ts";

export const MAX_REQUEST_TOKENS = 65_536;
export const MAX_STATE_TOKENS = 32_768;

/**
 * A self-imposed per-request cap.
 *
 * 256 is a memorable number and it is NOT a server limit -- 255 is the cap on
 * the number of options in a single `choice` question, which this tool never
 * uses. It is kept as a default because it is a reasonable blast radius, not
 * because anything rejects 257.
 */
export const DEFAULT_BATCH_SIZE = 256;

/**
 * Characters per input token, by payload shape, measured against the server's
 * own `usage.input_tokens`.
 *
 * One ratio for everything was wrong, and wrong in the direction that loses
 * verdicts. A payload of this tool's shape is two different things:
 *
 *   prose and source    3.37 chars/token measured -- what one ratio was tuned
 *                       for, and it was accurate to 1% on a file's text
 *   structured records  2.18 chars/token measured -- the per-subject metadata
 *                       list, which is mostly short quoted keys and
 *                       punctuation. A single ratio of 3.4 undercounts it by
 *                       36%.
 *
 * So a state of mostly source was sized well and a state of many subjects was
 * not, and the run that found this lost 100 verdicts to a batch the planner
 * thought fit in 27,274 of the 32,768-token state budget. The server refused it
 * even with a single question attached, which is the signature of a state over
 * budget rather than a request over budget.
 *
 * These constants are the measured values, not padded ones. The safety a
 * planner needs lives in STATE_MARGIN and REQUEST_MARGIN instead, because this
 * same estimate is what `--dry-run` prices a run with: ratios chosen
 * pessimistically enough to plan safely overstated a real run's bill by 22%.
 * Even so, a dry run reads about 9% high in aggregate -- it is a bound to
 * budget against, not a quote.
 */
const CHARS_PER_TOKEN_TEXT = 3.4;
const CHARS_PER_TOKEN_STRUCT = 2.2;

/** Above this many characters a string is prose or source, not a label. */
const TEXT_LIKE_LENGTH = 64;

/**
 * How much headroom the planner leaves under each budget.
 *
 * Two margins, because the two budgets fail differently and the estimate is
 * biased differently on each.
 *
 * The STATE margin is the larger one. Overflowing the state loses the verdicts
 * outright -- halving the questions, the client's only recovery, leaves the
 * state untouched -- and the estimate's worst case is here: measured against
 * the server's own counts it is 3% under on a state carrying a file, but 12%
 * under on a state that is only metadata records, which is what the lean arms
 * and the rule axis send. Those records are small and syntax-dense, and a
 * tokenizer does much better on one big repetitive payload than on many small
 * ones, so no single chars-per-token pair fits both.
 *
 * The REQUEST margin is the smaller one. Overflowing the request costs one
 * round trip, the client recovers by halving, and the estimate runs 15-26%
 * OVER on the questions that dominate a request -- so the risk is small in both
 * likelihood and consequence.
 */
export const STATE_MARGIN = 1.25;
export const REQUEST_MARGIN = 1.1;

/**
 * What the planner may spend, as opposed to what a request may carry.
 *
 * Exported so the tests can assert against these and not the ceilings: a
 * planner packing to MAX_STATE_TOKENS exactly passes a ceiling assertion and
 * loses verdicts in production, which is the regression the margins exist to
 * prevent.
 */
export const STATE_BUDGET = Math.floor(MAX_STATE_TOKENS / STATE_MARGIN);
export const REQUEST_BUDGET = Math.floor(MAX_REQUEST_TOKENS / REQUEST_MARGIN);

/**
 * Input-token estimate for a JSON payload, by shape.
 *
 * Accurate rather than conservative: this is also what a dry run quotes.
 */
export function estimateTokens(value: unknown): number {
  return Math.ceil(cost(value));
}

function cost(value: unknown): number {
  if (typeof value === "string") {
    // The SERIALIZED length: a source blob full of quotes and newlines grows
    // several percent under escaping, and that growth is real request bytes.
    const len = JSON.stringify(value).length;
    return len / (value.length >= TEXT_LIKE_LENGTH ? CHARS_PER_TOKEN_TEXT : CHARS_PER_TOKEN_STRUCT);
  }
  if (value === null || typeof value !== "object") {
    return String(value).length / CHARS_PER_TOKEN_STRUCT;
  }
  if (Array.isArray(value)) {
    // Brackets, plus one comma between elements.
    return (
      (2 + Math.max(0, value.length - 1)) / CHARS_PER_TOKEN_STRUCT +
      value.reduce((sum: number, item) => sum + cost(item), 0)
    );
  }
  // `JSON.stringify` drops undefined members, so the estimate must too.
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  let total = (2 + Math.max(0, entries.length - 1)) / CHARS_PER_TOKEN_STRUCT;
  for (const [key, v] of entries) {
    total += (JSON.stringify(key).length + 1) / CHARS_PER_TOKEN_STRUCT + cost(v);
  }
  return total;
}

/**
 * What one question costs on top of its own text, as a member of the questions
 * record.
 *
 * The planner sizes questions one at a time while the request serializes them
 * as a record, so each entry also carries `,"q0000":` -- about ten characters.
 * Ignoring it made the planner undercount by roughly three tokens per
 * question, which is invisible on a small batch and put a 246-question batch
 * 464 tokens over the 64Ki ceiling.
 *
 * The server also charges its own per-request and per-question scaffolding,
 * measured at about 270 tokens per request plus 13 per question beyond the
 * payload. That is not added here: the budget margins cover it, and at the
 * default cap they cover it with room to spare.
 */
const QUESTION_ENTRY_OVERHEAD = 4;

export interface PlanOptions {
  batchSize?: number;
  sources?: Map<string, string> | null;
  symbols?: SymbolIndex | null;
  /** The `paired` arm's evidence, per file. */
  tests?: Map<string, RelatedTest[]> | null;
  group?: Grouping;
}

/**
 * Group subjects into requests.
 *
 * Batching is per (file, arm) because the state is per (file, arm): two
 * subjects can share a request only if they can share a state. Guarantees,
 * which is what the tests assert rather than any capacity number:
 *
 *   - every subject lands in exactly one batch
 *   - no batch is empty
 *   - no batch holds more than `batchSize` subjects
 *   - no batch's estimated total exceeds REQUEST_BUDGET, unless it holds a
 *     single subject that cannot be split further
 *   - no batch's STATE exceeds STATE_BUDGET, under the same exception
 *
 * The budgets, not the ceilings: the planner packs to a margin under
 * MAX_REQUEST_TOKENS and MAX_STATE_TOKENS, and the tests assert the margin,
 * so packing to the ceiling is a test failure and not a lost verdict. See
 * STATE_MARGIN and REQUEST_MARGIN.
 *
 * A file whose SOURCE alone exceeds the state budget is the one case that
 * cannot be fixed by splitting questions, because every split still carries
 * that source. Those batches are marked `degraded` and fall back to a leaner
 * arm, which is a real loss of context and is reported rather than hidden. A
 * file with many MATCHES is not that case: the subject list is the part of a
 * state that a split does shrink, so it is split instead of degraded.
 */
export function planBatches(
  subjects: Subject[],
  { batchSize = DEFAULT_BATCH_SIZE, sources, symbols, tests, group = "file" }: PlanOptions = {},
): Batch[] {
  if (group === "rule") return planRuleBatches(subjects, { batchSize, symbols });
  const cap = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  const groups = new Map<string, Subject[]>();
  for (const s of subjects) {
    const key = `${s.arm}\u0000${s.file}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const batches: Batch[] = [];
  // `items`, not `group` -- the option of that name is in scope here.
  for (const [key, items] of groups) {
    const [armRaw, fileRaw] = key.split("\u0000");
    const arm = armRaw as StateArm;
    const file = fileRaw!;
    const source = sources?.get(file) ?? "";
    const entry = symbols?.get(file) ?? null;
    const language = items[0]!.language;

    const stateAt = (candidate: StateArm, batchItems: Subject[]) =>
      buildState({ file, source, entry, subjects: batchItems, arm: candidate, language, tests: tests?.get(file) ?? null });

    // Which arm can this file afford? Only the part of a state that a SPLIT
    // cannot shrink decides that, and the floor is what one subject alone
    // costs: `located` carries the whole source however few questions share
    // it, so a huge file really does have to step down, while `bare` carries
    // nothing but the subjects and is always rescued by splitting. Probing the
    // whole group instead -- what this did before -- degraded a file for having
    // many MATCHES rather than much SOURCE, and at `bare`, where there is
    // nothing leaner to step to, it reported a fallback from `bare` to `bare`.
    let effectiveArm: StateArm = arm;
    for (const candidate of stepDown(arm)) {
      effectiveArm = candidate;
      if (estimateTokens(stateAt(candidate, items.slice(0, 1))) <= STATE_BUDGET) break;
    }
    // So a step-down is recorded only when the arm actually changed. Anything
    // else is a batch to be split, not context that was lost.
    const degraded: ArmFallback | null =
      effectiveArm === arm ? null : { from: arm, to: effectiveArm, reason: "state budget" };

    const stateFor = (batchItems: Subject[]) => stateAt(effectiveArm, batchItems);

    let current: Subject[] = [];
    let questionTokens = 0;
    for (const s of items) {
      // Sized at the EFFECTIVE arm, because a question's size depends on it:
      // a subject over the inline limit carries its code only when the state
      // has no source to point at. Sizing at the declared arm undercounts
      // exactly the batches that stepped down.
      const cost =
        estimateTokens(buildQuestion(s.rule, { ...s, arm: effectiveArm }, questionId(0))) +
        QUESTION_ENTRY_OVERHEAD;
      // Re-measured per addition, because the subject list is part of the
      // state and therefore not fixed overhead. Both budgets are independent
      // and the state's fills first, so both are checked.
      //
      // Numbered exactly as `makeBatch` will number it: a subject's `id` is
      // part of the state's text, and sizing un-numbered subjects undercounts
      // every one of them by the width of its id.
      const nextState = estimateTokens(
        stateFor([...current, s].map((x, i) => ({ ...x, id: questionId(i) }))),
      );
      const full =
        current.length >= cap ||
        (current.length > 0 &&
          (nextState > STATE_BUDGET ||
            nextState + questionTokens + cost > REQUEST_BUDGET));
      if (full) {
        batches.push(makeBatch(file, effectiveArm, language, current, stateFor, degraded));
        current = [];
        questionTokens = 0;
      }
      current.push(s);
      questionTokens += cost;
    }
    if (current.length > 0) {
      batches.push(makeBatch(file, effectiveArm, language, current, stateFor, degraded));
    }
  }
  return batches;
}

function makeBatch(
  file: string,
  arm: StateArm,
  language: string,
  subjects: Subject[],
  stateFor: (items: Subject[]) => StatePayload,
  degraded: ArmFallback | null,
): Batch {
  // Question ids are assigned per batch, so a subject's id is only meaningful
  // together with its batch. The state is built with the same ids.
  //
  // `arm` is overwritten with the batch's EFFECTIVE arm, which is the whole
  // point: a subject whose rule asked for `located` but whose batch stepped
  // down to `graph` was judged at `graph`, and every downstream consumer --
  // the finding, the cache provenance, the replay record -- must say so rather
  // than repeat what the rule wanted.
  const numbered: Subject[] = subjects.map((s, i) => ({ ...s, id: questionId(i), arm }));
  const state = stateFor(numbered);
  const questions: Record<string, Question> = {};
  for (const s of numbered) questions[s.id!] = buildQuestion(s.rule, s, s.id!);
  return {
    file,
    arm,
    language,
    subjects: numbered,
    state,
    questions,
    degraded,
    estimatedTokens: estimateTokens(state) + estimateTokens(questions),
  };
}

/** Arms to try, richest first, when the requested one does not fit. */
function stepDown(arm: StateArm): StateArm[] {
  switch (arm) {
    case "full":
      return ["full", "graph", "local", "bare"];
    case "located":
      return ["located", "local", "bare"];
    case "graph":
      return ["graph", "bare"];
    case "paired":
      return ["paired", "local", "bare"];
    case "local":
      return ["local", "bare"];
    default:
      return ["bare"];
  }
}

/**
 * Rule-grouped planning: one state per (rule, arm), holding matches from any
 * number of files.
 *
 * The difference from file-grouped planning is not cosmetic. There, the state
 * is a file and its size is FIXED however many questions share it, so the
 * planner measures it once and treats it as overhead. Here a subject can grow
 * the state, so the budget is re-checked on each addition.
 *
 * Which budget actually closes a batch depends on the arm, and it is worth
 * being precise because an earlier version of this comment was not: the matched
 * CODE travels in the questions, not the state, so on `bare` the state barely
 * grows per subject and the 64Ki request budget binds. Only `local` puts
 * anything per-subject in the state -- the enclosing function, deduplicated --
 * and there the 32Ki state budget binds first, being half the size.
 *
 * `located` is deliberately not offered under this grouping. It would mean
 * putting every touched file's full source into one state, which is both the
 * opposite of the point and a guaranteed way to exceed 32Ki. A rule asking for
 * `located` is served `local` here, and the substitution is recorded on the
 * batch so it appears in the report rather than silently changing the answers.
 */
export function planRuleBatches(
  subjects: Subject[],
  { batchSize = DEFAULT_BATCH_SIZE, symbols }: PlanOptions = {},
): Batch[] {
  const cap = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  interface RuleGroup {
    rule: Rule;
    arm: StateArm;
    requested: StateArm;
    items: Subject[];
  }
  const groups = new Map<string, RuleGroup>();
  for (const s of subjects) {
    const arm = ruleGroupArm(s.arm);
    const key = `${s.rule.id}\u0000${arm}`;
    if (!groups.has(key)) groups.set(key, { rule: s.rule, arm, requested: s.arm, items: [] });
    groups.get(key)!.items.push(s);
  }

  const batches: Batch[] = [];
  for (const { rule, arm, requested, items } of groups.values()) {
    let current: Subject[] = [];
    const flush = () => {
      if (current.length === 0) return;
      batches.push(
        makeRuleBatch(rule, arm, current, symbols, requested !== arm ? { from: requested, to: arm, reason: "rule grouping spans files" } : null),
      );
      current = [];
    };
    for (const s of items) {
      const next = [...current, s];
      // Numbering is only assigned at flush time, so sizing uses a throwaway
      // numbering. It is the same shape, which is all the estimate needs.
      const probeState = buildRuleState({
        rule,
        arm,
        symbols,
        subjects: next.map((x, i) => ({ ...x, id: questionId(i) })),
      });
      const stateTokens = estimateTokens(probeState);
      const questionTokens = next.reduce(
        (a, x) => a + estimateTokens(buildQuestion(x.rule, x, questionId(0))) + QUESTION_ENTRY_OVERHEAD,
        0,
      );
      const overState = stateTokens > STATE_BUDGET;
      const overRequest = stateTokens + questionTokens > REQUEST_BUDGET;
      if (current.length > 0 && (next.length > cap || overState || overRequest)) {
        flush();
      }
      current.push(s);
    }
    flush();
  }
  return batches;
}

/**
 * `located` cannot mean "every file" -- under rule grouping it becomes
 * `local`. `paired` is one file's tests, so the same applies.
 */
function ruleGroupArm(arm: StateArm): StateArm {
  if (arm === "located" || arm === "full" || arm === "paired") return "local";
  return arm;
}

function makeRuleBatch(
  rule: Rule,
  arm: StateArm,
  subjects: Subject[],
  symbols: SymbolIndex | null | undefined,
  degraded: ArmFallback | null,
): Batch {
  // Same as makeBatch: the effective arm replaces the declared one. This is
  // where it mattered most -- rule grouping substitutes `local` for `located`
  // for the majority of subjects, and every finding used to claim `located`.
  const numbered: Subject[] = subjects.map((s, i) => ({ ...s, id: questionId(i), arm }));
  const state = buildRuleState({ rule, arm, symbols, subjects: numbered });
  const questions: Record<string, Question> = {};
  for (const s of numbered) questions[s.id!] = buildQuestion(s.rule, s, s.id!);
  return {
    // A rule-grouped batch spans files, so there is no single file to name.
    file: `${rule.id} (${new Set(subjects.map((s) => s.file)).size} file(s))`,
    group: "rule",
    rule: rule.id,
    arm,
    language: numbered[0]!.language,
    subjects: numbered,
    state,
    questions,
    degraded,
    estimatedTokens: estimateTokens(state) + estimateTokens(questions),
  };
}
