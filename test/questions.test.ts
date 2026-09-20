import { strict as assert } from "node:assert";
import { decide, describe as describeFinding } from "../src/gate.ts";
import { buildQuestion, buildExplainQuestion, questionId, readAnswer, readChoice } from "../src/questions.ts";
import { SCORE_LEVELS } from "../src/rules.ts";
import { explain } from "../src/schedule.ts";
import { scoreRule, noulRule, subjectOf } from "./builders.ts";
import { test } from "./harness.ts";

test("questions: a noul question nests its criteria and carries no threshold", () => {
  const q = buildQuestion(noulRule(), subjectOf(), "q0000");
  assert.equal(q.type, "noul");
  assert.deepEqual(Object.keys(q.criteria).sort(), ["false", "true"]);
  // Deliberately inspecting a field the type says cannot be there: the point of
  // the check is that the wire shape has no top-level `true`.
  assert.equal((q as unknown as Record<string, unknown>).true, undefined, "criteria must not be hoisted to the top level");
  const wire = JSON.stringify(q);
  assert.ok(!/\bat\b.*0\.\d/.test(wire), "a cutoff must never appear in a question");
});

test("questions: a structured criterion reaches the wire as the mapping it was written as", () => {
  const rule = noulRule({
    criteria: { true: { what: "it does", examples: ["one"], not_for: "mentions" }, false: "it does not" },
  });
  const q = buildQuestion(rule, subjectOf({ rule }), "q0000");
  assert.equal(q.type, "noul");
  assert.deepEqual(q.criteria, {
    true: { what: "it does", examples: ["one"], not_for: "mentions" },
    false: "it does not",
  });
});

test("questions: a score question carries the shared four-level scale", () => {
  const q = buildQuestion(scoreRule(), subjectOf(), "q0000");
  assert.equal(q.type, "score");
  assert.deepEqual(q.criteria, SCORE_LEVELS);
  assert.equal(q.criteria.length, 4);
});

test("questions: the note reaches the model and never the finding text", () => {
  const rule = scoreRule({ note: "not a violation inside a retry wrapper" });
  const q = buildQuestion(rule, subjectOf(), "q0000");
  assert.equal(q.instructions.also, "not a violation inside a retry wrapper");
  const finding = decide(subjectOf({ rule }), { value: 3, confidence: 0.9, kind: "score" });
  assert.ok(!describeFinding(finding).includes("retry wrapper"));
});

test("questions: captured metavariables are handed to the question by name", () => {
  const q = buildQuestion(
    noulRule(),
    subjectOf({ captured: { NAME: "loadUser", TITLE: "rejects an empty name" } }),
    "q0000",
  );
  assert.deepEqual(q.instructions.matcher_captured, {
    NAME: "loadUser",
    TITLE: "rejects an empty name",
  });
});

test("questions: short subjects are inlined, long ones are referenced by line", () => {
  const short = buildQuestion(scoreRule(), subjectOf({ text: "fetch(u)" }), "q0000");
  assert.equal(short.instructions.code, "fetch(u)");
  const long = buildQuestion(scoreRule(), subjectOf({ text: "x".repeat(5000) }), "q0000");
  assert.equal(long.instructions.code, undefined);
  assert.equal(long.instructions.lines, "3-5");
});

test("questions: a file subject is labelled an outline, not code", () => {
  const q = buildQuestion(
    noulRule({ subject: "file" }),
    subjectOf({ isOutline: true, text: "path: a.ts" }),
    "q0000",
  );
  assert.equal(q.instructions.code, undefined);
  assert.equal(q.instructions.module_outline, "path: a.ts");
  assert.equal(q.instructions.matched_because, undefined);
});

test("questions: an explain question is a choice over the rule's labels, about the same subject", () => {
  const rule = scoreRule({ explain: { mutates: "It changes state", narrows: "It handles a narrower case" } });
  const q = buildExplainQuestion(rule, subjectOf({ rule, captured: { NAME: "load" } }), "q0003");
  assert.equal(q.type, "choice");
  assert.deepEqual(q.criteria, { mutates: "It changes state", narrows: "It handles a narrower case" });
  assert.equal(q.instructions.subject, "q0003");
  assert.equal(q.instructions.statement, rule.ask, "it names the statement that was judged to hold");
  assert.deepEqual(q.instructions.matcher_captured, { NAME: "load" });
  assert.match(String(q.instructions.task), /judged to hold/, "and says the verdict is already in");
  // A choice answer reads back as its label and confidence; anything else is null.
  assert.deepEqual(
    readChoice({ q0003: { type: "choice", choice: "mutates", confidence: 0.8, probabilities: { mutates: 0.8, narrows: 0.2 } } }, "q0003"),
    { choice: "mutates", confidence: 0.8, probabilities: { mutates: 0.8, narrows: 0.2 } },
  );
  assert.equal(readChoice({ q0003: { type: "noul", noul: 0.9 } }, "q0003"), null);
  assert.equal(readChoice({}, "q0003"), null);
});

test("questions: ids are stable and zero-padded", () => {
  assert.equal(questionId(0), "q0000");
  assert.equal(questionId(42), "q0042");
  assert.equal(questionId(1234), "q1234");
});

test("questions: unusable answers read back as null rather than as zero", () => {
  assert.equal(readAnswer({}, "q0000", "score"), null);
  assert.equal(readAnswer({ q0000: { type: "noul", noul: 0.9 } }, "q0000", "score"), null);
  assert.equal(readAnswer({ q0000: { type: "score", score: "2" } }, "q0000", "score"), null);
  assert.deepEqual(readAnswer({ q0000: { type: "noul", noul: 0.9 } }, "q0000", "noul"), {
    value: 0.9,
    confidence: null,
    kind: "noul",
  });
  // A noul has no confidence of its own; inventing one would let it be routed.
  assert.equal(
    readAnswer({ q0000: { type: "noul", noul: 0.9, confidence: 0.3 } }, "q0000", "noul")!.confidence,
    null,
  );
});
