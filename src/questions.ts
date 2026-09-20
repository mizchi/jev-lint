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
import { SCORE_LEVELS } from "./rules.ts";
import { INLINE_LIMIT, SOURCE_BEARING_ARMS, truncate } from "./state.ts";
import type { Answer, Choice, ChoiceQuestion, Question, Rule, RuleKind, Subject } from "./types.ts";

/** Stable question name, so answers can be matched back positionally. */
export function questionId(i: number): string {
  return `q${String(i).padStart(4, "0")}`;
}

const TASK_SCORE =
  "A project has this rule. Judge only the code identified below, against only this rule -- other problems with it are not your concern here.";

const TASK_NOUL =
  "Judge only the code identified below, and only for the statement given -- other problems with it are not your concern here.";

const TASK_EXPLAIN =
  "The statement below was judged to hold for the code identified. Pick the option that best names WHY it holds for this code; do not re-judge whether it holds.";

/**
 * Build one question for one subject.
 *
 * The rule's sentence goes in verbatim. It is the user's text, and rewriting it
 * into a schema here would mean the sentence they tuned is not the sentence
 * that was asked.
 */
export function buildQuestion(rule: Rule, subject: Subject, id: string): Question {
  const shared = subjectFields(rule, subject, id);

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
      // is a smaller input-token count. `rules.ts` validates the shape so the
      // mistake cannot reach the wire.
      criteria: { true: rule.criteria!.true, false: rule.criteria!.false },
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

/**
 * The follow-up for one finding: which of the rule's `explain` labels best
 * names why the statement holds. Same subject fields as the verdict question
 * -- it is asked against the same state, in a request of its own -- so the
 * model is pointed at exactly the code the verdict was about.
 */
export function buildExplainQuestion(rule: Rule, subject: Subject, id: string): ChoiceQuestion {
  return {
    type: "choice",
    instructions: {
      task: TASK_EXPLAIN,
      statement: rule.ask,
      ...subjectFields(rule, subject, id),
    },
    criteria: { ...(rule.explain ?? {}) },
  };
}

/** What every question about a subject carries: where it is and what it is. */
function subjectFields(rule: Rule, subject: Subject, id: string): Record<string, unknown> {
  // A commit: the message is the thing judged, named as such. No lines, no
  // node kind, no loose-matcher caveat -- nothing matched it.
  if (subject.commit) {
    const shared: Record<string, unknown> = { subject: id, message: subject.text };
    if (subject.captured && Object.keys(subject.captured).length > 0) shared.matcher_captured = subject.captured;
    return shared;
  }
  // The lines of the code actually supplied, which is the subject's range and
  // not the match's when `subject: enclosing` promoted it.
  const from = subject.subjectLine ?? subject.line;
  const to = subject.subjectEndLine ?? subject.endLine;
  const shared: Record<string, unknown> = {
    subject: id,
    lines: from === to ? `${from}` : `${from}-${to}`,
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
    shared.note_on_subject = `The rule selected the code in \`matched\` at line ${subject.line}. Judge THAT; the \`code\` field is the container it sits in, supplied so you can see what it does in context.`;
    if (subject.matchText) shared.matched = subject.matchText;
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
  } else if (!subject.arm || !SOURCE_BEARING_ARMS.has(subject.arm)) {
    // Over the inline limit, and the state has no source to point a line range
    // at. Truncated code beats none: the alternative is a question whose
    // subject appears nowhere in the request, which is the failure mode this
    // whole design treats as the most expensive one -- every answer lands
    // mid-scale and it reads as a threshold problem.
    shared.code = truncate(subject.text);
  }
  return shared;
}

/** Read one answer back. Returns null when the answer is unusable. */
export function readAnswer(
  answers: Record<string, unknown> | undefined,
  id: string,
  kind: RuleKind,
): Answer | null {
  const a = answers?.[id] as
    | { type?: string; noul?: unknown; score?: unknown; confidence?: unknown; probabilities?: unknown }
    | undefined;
  if (!a) return null;
  if (kind === "noul") {
    if (a.type !== "noul" || typeof a.noul !== "number") return null;
    // A noul carries no confidence of its own; the probability IS the answer.
    return { value: a.noul as number, confidence: null, kind: "noul" };
  }
  if (a.type !== "score" || typeof a.score !== "number") return null;
  return {
    value: a.score as number,
    confidence: typeof a.confidence === "number" ? a.confidence : null,
    kind: "score",
    probabilities: (a.probabilities as Record<string, number> | undefined) ?? null,
  };
}

/** Read a choice back. Null when the answer is not a usable choice. */
export function readChoice(answers: Record<string, unknown> | undefined, id: string): Choice | null {
  const a = answers?.[id] as
    | { type?: string; choice?: unknown; confidence?: unknown; probabilities?: unknown }
    | undefined;
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  return {
    choice: a.choice,
    confidence: typeof a.confidence === "number" ? a.confidence : 0,
    probabilities: (a.probabilities as Record<string, number> | undefined) ?? null,
  };
}
