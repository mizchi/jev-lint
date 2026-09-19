/**
 * Turning a rule plus a match into a question.
 *
 * Two shapes, chosen by what the answer MEANS rather than by preference:
 *
 *   score  an ordered conclusion -- how badly this code breaks this rule.
 *          Comes back with a confidence, which is what lets an uncertain
 *          verdict be routed to a human instead of dropped.
 *   noul   an independent predicate -- whether some property holds. Comes back
 *          as a bare probability with no confidence, and gets its own cutoff.
 *
 * Asking an ordered conclusion as a `choice` is the mistake this avoids: the
 * ordering is discarded, adjacent levels split the probability mass, and the
 * result arrives as a low confidence indistinguishable from real uncertainty.
 *
 * Two things deliberately never appear in a question:
 *
 *   - **Thresholds.** The cutoff is a decision the runner makes from the
 *     answer. Writing it into the question means every recalibration rewrites
 *     the question, and no run can be compared with an earlier one.
 *   - **Conditions the subject cannot show.** An exception like "unless the
 *     caller needed to know about this failure" is invisible in a `catch`
 *     block, and a question that asks for it comes back mid-scale for every
 *     input -- which looks like a threshold problem and is not one. Write
 *     exceptions in terms of what the subject itself reveals.
 */
import { SCORE_LEVELS } from "./rules.mjs";
import { INLINE_LIMIT } from "./state.mjs";

/** Stable question name, so answers can be matched back positionally. */
export function questionId(i) {
  return `q${String(i).padStart(4, "0")}`;
}

const TASK_SCORE =
  "A project has this rule. Judge only the code identified below, against only this rule -- other problems with it are not your concern here.";

const TASK_NOUL =
  "Judge only the code identified below, and only for the statement given -- other problems with it are not your concern here.";

/**
 * Build one question for one subject.
 *
 * The rule's sentence goes in verbatim. It is the user's text, and rewriting it
 * into a schema here would mean the sentence they tuned is not the sentence
 * that was asked.
 */
export function buildQuestion(rule, subject, id) {
  const shared = {
    subject: id,
    lines: subject.line === subject.endLine ? `${subject.line}` : `${subject.line}-${subject.endLine}`,
    node: subject.nodeKind,
  };

  // What the matcher picked out by name. For the naming judgments this tool
  // targets, naming the two things being compared is the whole question: "does
  // this body do what `$NAME` promises" is answerable, "is this well named" is
  // not.
  if (subject.captured && Object.keys(subject.captured).length > 0) {
    shared.matcher_captured = subject.captured;
  }
  if (subject.enclosing?.name) {
    shared.inside = `${subject.enclosing.role} \`${subject.enclosing.name}\``;
  }
  if (subject.promoted) {
    shared.note_on_subject =
      "The rule matched a smaller node inside this one; the code below is the container it sits in.";
  }
  // Telling the model the matcher is loose is what makes level 0 usable: it is
  // the model's way of saying the matcher caught something irrelevant, which is
  // cheaper to read in a report than to prevent by hand-tightening a matcher.
  shared.matched_because = "this code was selected by a deliberately loose structural matcher, which may have caught something the rule was not written about";

  if (subject.isOutline) {
    // Not labelled `code`, because it is not code: calling it that invites the
    // model to judge it as if this were the file's text.
    shared.module_outline = subject.text;
    delete shared.matched_because;
  } else if (subject.text.length <= INLINE_LIMIT) {
    shared.code = subject.text;
  }

  if (rule.kind === "noul") {
    return {
      type: "noul",
      instructions: {
        task: TASK_NOUL,
        statement: rule.ask,
        ...(rule.note ? { also: rule.note } : {}),
        ...shared,
      },
      // Nested under `criteria`, never at the top level. A flat `{true, false}`
      // gets a 200 back with the criteria silently discarded; the only symptom
      // is a smaller input-token count. `rules.mjs` validates the shape so the
      // mistake cannot reach the wire.
      criteria: { true: rule.criteria.true, false: rule.criteria.false },
    };
  }

  return {
    type: "score",
    instructions: {
      task: TASK_SCORE,
      rule: rule.ask,
      ...(rule.note ? { also: rule.note } : {}),
      ...shared,
    },
    criteria: SCORE_LEVELS,
  };
}

/** Read one answer back. Returns null when the answer is unusable. */
export function readAnswer(answers, id, kind) {
  const a = answers?.[id];
  if (!a) return null;
  if (kind === "noul") {
    if (a.type !== "noul" || typeof a.noul !== "number") return null;
    // A noul carries no confidence of its own; the probability IS the answer.
    return { value: a.noul, confidence: null, kind: "noul" };
  }
  if (a.type !== "score" || typeof a.score !== "number") return null;
  return {
    value: a.score,
    confidence: typeof a.confidence === "number" ? a.confidence : null,
    kind: "score",
    probabilities: a.probabilities ?? null,
  };
}
