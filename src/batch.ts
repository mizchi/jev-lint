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
 * The estimator below is approximate on purpose. Being exactly right is not
 * needed when the client reacts to the server's own `max_tokens_exceeded` by
 * halving the question set, and an estimator tuned to be exact would be one
 * more thing that silently drifts as question shapes change.
 */
import { buildQuestion, questionId } from "./questions.ts";
import { buildState, buildRuleState } from "./state.ts";
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
 * Rough input-token estimate for a JSON payload.
 *
 * Deliberately pessimistic (dividing by less than the usual four characters per
 * token) so the estimate errs towards smaller batches: an over-large batch
 * costs a round trip to discover, an under-large one costs almost nothing
 * because the state is the expensive part and it is sent either way.
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return Math.ceil(text.length / 3.4);
}

/**
 * What one question costs on top of its own text, as a member of the questions
 * record.
 *
 * The planner sizes questions one at a time while the request serializes them
 * as a record, so each entry also carries `,"q0000":` -- about ten characters.
 * Ignoring it made the planner undercount by roughly three tokens per
 * question, which is invisible on a small batch and put a 246-question batch
 * 464 tokens over the 64Ki ceiling. Rounded up, because the whole estimator is
 * deliberately pessimistic: overshooting costs a slightly smaller batch, and
 * undershooting costs a round trip to discover.
 */
const QUESTION_ENTRY_OVERHEAD = 4;

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
 *   - no batch's estimated total exceeds MAX_REQUEST_TOKENS, unless it holds a
 *     single subject that cannot be split further
 *
 * A file whose SOURCE alone exceeds the state budget is the one case that
 * cannot be fixed by splitting questions, because a split leaves the state
 * unchanged. Those batches are marked `degraded` and fall back to a leaner arm,
 * which is a real loss of context and is reported rather than hidden.
 */
export interface PlanOptions {
  batchSize?: number;
  sources?: Map<string, string> | null;
  symbols?: SymbolIndex | null;
  group?: Grouping;
}

export function planBatches(
  subjects: Subject[],
  { batchSize = DEFAULT_BATCH_SIZE, sources, symbols, group = "file" }: PlanOptions = {},
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

    let effectiveArm: StateArm = arm;
    let degraded: ArmFallback | null = null;

    // Does the state fit at the requested arm? If not, step down rather than
    // fail: `graph` keeps the hierarchy without the file text, and `bare`
    // keeps nothing but the subjects.
    for (const candidate of stepDown(arm)) {
      const probe = buildState({ file, source, entry, subjects: items, arm: candidate, language });
      if (estimateTokens(probe) <= MAX_STATE_TOKENS) {
        effectiveArm = candidate;
        if (candidate !== arm) degraded = { from: arm, to: candidate, reason: "state budget" };
        break;
      }
      effectiveArm = candidate;
      degraded = { from: arm, to: candidate, reason: "state budget" };
    }

    const stateFor = (batchItems: Subject[]) =>
      buildState({ file, source, entry, subjects: batchItems, arm: effectiveArm, language });

    // The state's own size does not depend much on how many subjects share it,
    // so it is measured once on the whole group and treated as fixed overhead.
    const stateTokens = estimateTokens(stateFor(items));

    let current: Subject[] = [];
    let tokens = stateTokens;
    for (const s of items) {
      const cost = estimateTokens(buildQuestion(s.rule, s, questionId(0))) + QUESTION_ENTRY_OVERHEAD;
      const full =
        current.length >= cap || (current.length > 0 && tokens + cost > MAX_REQUEST_TOKENS);
      if (full) {
        batches.push(makeBatch(file, effectiveArm, language, current, stateFor, degraded));
        current = [];
        tokens = stateTokens;
      }
      current.push(s);
      tokens += cost;
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
      const overState = stateTokens > MAX_STATE_TOKENS;
      const overRequest = stateTokens + questionTokens > MAX_REQUEST_TOKENS;
      if (current.length > 0 && (next.length > cap || overState || overRequest)) {
        flush();
      }
      current.push(s);
    }
    flush();
  }
  return batches;
}

/** `located` cannot mean "every file" -- under rule grouping it becomes `local`. */
function ruleGroupArm(arm: StateArm): StateArm {
  if (arm === "located" || arm === "full") return "local";
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
