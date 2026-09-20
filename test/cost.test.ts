import { strict as assert } from "node:assert";
import { planBatches } from "../src/batch.ts";
import { costByRule, formatCostByRule } from "../src/cost.ts";
import { test, scoreRule, noulRule, subjectOf } from "./helpers.ts";

test("cost: a dry run prices each rule -- its share of every batch's state, and its own questions", () => {
  // Two rules over one file share a batch: the file travels once, and the
  // question is which rule a reader should drop to halve the bill. The
  // state is split by the subjects each rule put in the batch; the
  // questions are each rule's own. The shares sum to the batch.
  const cheap = scoreRule({ id: "cheap" });
  const dear = noulRule({ id: "dear", language: "TypeScript", note: "x".repeat(4000) });
  const subjects = [
    subjectOf({ rule: cheap, file: "a.ts", line: 1, text: "fetch(a)" }),
    subjectOf({ rule: cheap, file: "a.ts", line: 2, text: "fetch(b)" }),
    subjectOf({ rule: dear, file: "a.ts", line: 3, text: "function f() {}" }),
    subjectOf({ rule: dear, file: "b.ts", line: 1, text: "function g() {}" }),
  ];
  const sources = new Map([["a.ts", "fetch(a);\nfetch(b);\nfunction f() {}\n"], ["b.ts", "function g() {}\n"]]);
  const batches = planBatches(subjects, { sources, symbols: new Map() });
  const rows = costByRule(batches, [cheap, dear]);
  assert.deepEqual(rows.map((r) => r.rule), ["dear", "cheap"], "dearest first");
  const total = batches.reduce((a, b) => a + b.estimatedTokens, 0);
  const summed = rows.reduce((a, r) => a + r.tokens, 0);
  assert.ok(Math.abs(summed - total) <= rows.length, `shares sum to the plan: ${summed} vs ${total}`);
  const byId = new Map(rows.map((r) => [r.rule, r]));
  assert.equal(byId.get("cheap")!.subjects, 2);
  assert.equal(byId.get("cheap")!.requests, 1, "cheap is in a.ts's batch only");
  assert.equal(byId.get("dear")!.requests, 2, "dear is in both files' batches");
  assert.ok(byId.get("dear")!.tokens > byId.get("cheap")!.tokens * 2, "the long note is paid per question");
  assert.ok(byId.get("dear")!.usd > 0 && byId.get("dear")!.share > 0.5);
  // A loaded rule that matched nothing is a row too, at zero: the reader
  // sees every rule they could drop, not only the ones that cost.
  const idle = noulRule({ id: "idle", language: "Rust" });
  const withIdle = costByRule(batches, [cheap, dear, idle]);
  assert.deepEqual(withIdle.at(-1), { rule: "idle", subjects: 0, requests: 0, tokens: 0, usd: 0, share: 0 });
  const text = formatCostByRule(withIdle);
  assert.match(text, /rule\s+subjects\s+requests\s+~tokens\s+~\$\s+share/);
  assert.match(text, /dear\s+2\s+2\s+[\d,]+\s+\$0\.\d+\s+\d+%/);
  assert.doesNotMatch(text, /idle/, "a rule that will not be asked is not a line");
});
