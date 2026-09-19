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
import { buildQuestion, questionId } from "./questions.mjs";
import { buildState } from "./state.mjs";

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
export function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return Math.ceil(text.length / 3.4);
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
 *   - no batch's estimated total exceeds MAX_REQUEST_TOKENS, unless it holds a
 *     single subject that cannot be split further
 *
 * A file whose SOURCE alone exceeds the state budget is the one case that
 * cannot be fixed by splitting questions, because a split leaves the state
 * unchanged. Those batches are marked `degraded` and fall back to a leaner arm,
 * which is a real loss of context and is reported rather than hidden.
 */
export function planBatches(subjects, { batchSize = DEFAULT_BATCH_SIZE, sources, symbols } = {}) {
  const cap = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  const groups = new Map();
  for (const s of subjects) {
    const key = `${s.arm}\u0000${s.file}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const batches = [];
  for (const [key, group] of groups) {
    const [arm, file] = key.split("\u0000");
    const source = sources?.get(file) ?? "";
    const entry = symbols?.get(file) ?? null;
    const language = group[0].language;

    let effectiveArm = arm;
    let degraded = null;

    // Does the state fit at the requested arm? If not, step down rather than
    // fail: `graph` keeps the hierarchy without the file text, and `bare`
    // keeps nothing but the subjects.
    for (const candidate of stepDown(arm)) {
      const probe = buildState({ file, source, entry, subjects: group, arm: candidate, language });
      if (estimateTokens(probe) <= MAX_STATE_TOKENS) {
        effectiveArm = candidate;
        if (candidate !== arm) degraded = { from: arm, to: candidate, reason: "state budget" };
        break;
      }
      effectiveArm = candidate;
      degraded = { from: arm, to: candidate, reason: "state budget" };
    }

    const stateFor = (items) =>
      buildState({ file, source, entry, subjects: items, arm: effectiveArm, language });

    // The state's own size does not depend much on how many subjects share it,
    // so it is measured once on the whole group and treated as fixed overhead.
    const stateTokens = estimateTokens(stateFor(group));

    let current = [];
    let tokens = stateTokens;
    for (const s of group) {
      const cost = estimateTokens(buildQuestion(s.rule, s, questionId(0)));
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

function makeBatch(file, arm, language, subjects, stateFor, degraded) {
  // Question ids are assigned per batch, so a subject's id is only meaningful
  // together with its batch. The state is built with the same ids.
  const numbered = subjects.map((s, i) => ({ ...s, id: questionId(i) }));
  const state = stateFor(numbered);
  const questions = {};
  for (const s of numbered) questions[s.id] = buildQuestion(s.rule, s, s.id);
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
function stepDown(arm) {
  switch (arm) {
    case "full":
      return ["full", "graph", "bare"];
    case "located":
      return ["located", "graph", "bare"];
    case "graph":
      return ["graph", "bare"];
    default:
      return ["bare"];
  }
}
