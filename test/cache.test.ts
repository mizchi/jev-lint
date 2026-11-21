import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache, verdictKey, contextKey } from "../src/cache.ts";
import type { Answer, StateArm } from "../src/types.ts";
import { scoreRule, subjectOf, answer } from "./builders.ts";
import { test } from "./harness.ts";

test("cache: on an arm that shows context, identical text in different contexts is two questions", () => {
  // Found by two candidate rules at once: a `logger.info("cache hit")` in
  // the miss branch answered exactly what its twin in the hit branch did,
  // 0.05, because keyed on the text alone the second was never asked. On
  // `bare` the text is all the model sees and one question is right; on
  // `local` the enclosing function is the evidence, and on the file-bearing
  // arms the file is, so those go into the key.
  const r = scoreRule();
  for (const arm of ["local", "located", "graph", "full", "paired"] as StateArm[]) {
    assert.notEqual(verdictKey(r, arm, "T", "file", null, "ctx-a"), verdictKey(r, arm, "T", "file", null, "ctx-b"), `${arm}: two contexts, two questions`);
    assert.equal(verdictKey(r, arm, "T", "file", null, "ctx-a"), verdictKey(r, arm, "T", "file", null, "ctx-a"), `${arm}: same context, one question`);
  }
  // What the runner uses as the context: the enclosing code on local, the
  // file and the container on the file-bearing arms, nothing on bare.
  const inA = subjectOf({ context: "function a() { x() }", contextName: "a", file: "src/a.ts", enclosing: { name: "a", role: "function" } });
  const inB = subjectOf({ context: "function b() { x() }", contextName: "b", file: "src/a.ts", enclosing: { name: "b", role: "function" } });
  assert.notEqual(contextKey(inA, "local"), contextKey(inB, "local"));
  assert.notEqual(contextKey(inA, "located"), contextKey(inB, "located"), "same file, different container");
  assert.notEqual(contextKey(inA, "located"), contextKey({ ...inA, file: "src/b.ts" }, "located"), "different file");
  assert.equal(contextKey(inA, "bare"), contextKey(inB, "bare"));
  assert.equal(contextKey(inA, "bare"), null);
  // A promoted subject's question names the match's line inside the
  // container, so two identical throws in one function -- one per `if` --
  // are two questions on every arm, keyed by where in the function the
  // match sits (an offset, so edits elsewhere in the file keep the verdict).
  const first = subjectOf({ promoted: true, matchText: 'throw new Error("x")', text: "function f() {...}", line: 12, subjectLine: 10 });
  const second = { ...first, line: 20 };
  assert.notEqual(contextKey(first, "bare"), contextKey(second, "bare"));
  assert.equal(contextKey(first, "bare"), contextKey({ ...first, line: 112, subjectLine: 110 }, "bare"), "the same offset after the file grew above it");
  // A test's suites are in its question on every arm, so they are in the key
  // on every arm: one title under two describes is two questions, and a
  // test with no describe above it keys as before.
  const under = subjectOf({ file: "src/a.test.ts", enclosing: { name: "cart", role: "suite", path: ["cart"] } });
  const deeper = subjectOf({ file: "src/a.test.ts", enclosing: { name: "removeItem", role: "suite", path: ["cart", "removeItem"] } });
  const top = subjectOf({ file: "src/a.test.ts", enclosing: null });
  for (const arm of ["bare", "local", "located"] as StateArm[]) {
    assert.notEqual(contextKey(under, arm), contextKey(deeper, arm), `${arm}: two paths, two questions`);
  }
  assert.equal(contextKey(top, "bare"), null);
  assert.equal(contextKey({ ...under, enclosing: { name: "cart", role: "suite" } }, "bare"), null, "no path, nothing on bare");
  // On `paired` the tests shown are the evidence: a better excerpt of the
  // same test file is a new question. Keyed without it, every verdict on
  // the arm survived the excerpt being fixed and reported the old reading.
  const fn = subjectOf({ file: "src/a.ts", enclosing: null });
  assert.notEqual(contextKey(fn, "paired", "it('a throws')"), contextKey(fn, "paired", "it('a throws', () => expect(a).toThrow())"));
  assert.equal(contextKey(fn, "located", "x"), contextKey(fn, "located", "y"), "the other arms do not show tests");
});

test("cache: a key covers the draft, the arm and the axis, but not the threshold", () => {
  const r = scoreRule();
  const k = verdictKey(r, "located", "TEXT");
  assert.equal(k, verdictKey(scoreRule({ at: 2.9 }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(scoreRule({ ask: "other" }), "located", "TEXT"));
  assert.notEqual(k, verdictKey(r, "bare", "TEXT"));
  assert.notEqual(k, verdictKey(r, "located", "OTHER"));
  // The axis was in the key and untested, because every call here used the
  // default. It has to be in it: the same subject at the same arm sits beside
  // its own file's matches under file grouping and beside unrelated ones under
  // rule grouping, and those are different questions.
  assert.notEqual(k, verdictKey(r, "located", "TEXT", "rule"));
  assert.equal(k, verdictKey(r, "located", "TEXT", "file"));

  // And the arm in the key has to be the arm the question was ASKED at, not
  // the one the rule asked for. A batch over the state budget steps down, so a
  // `located` rule can be answered at `local`; filing that answer under the
  // `located` key served it, later, as the answer to a question nobody asked.
  // Distinct keys are what make that a miss instead.
  assert.notEqual(verdictKey(r, "located", "TEXT"), verdictKey(r, "local", "TEXT"));
  // What the matcher captured is in the question by name -- for a comment
  // rule the comment IS the claim -- so it is in the key. Found by running
  // the tool on itself: a comment rewritten to be true kept its old verdict
  // at the same 0.73 through two runs, because the declaration under it
  // had not changed.
  assert.notEqual(
    verdictKey(r, "located", "TEXT", "file", null, null, { DOC: "// returns null" }),
    verdictKey(r, "located", "TEXT", "file", null, null, { DOC: "// throws" }),
  );
  assert.equal(
    verdictKey(r, "located", "TEXT", "file", null, null, { DOC: "// throws" }),
    verdictKey(r, "located", "TEXT", "file", null, null, { DOC: "// throws" }),
  );

  // A promoted subject (`subject: enclosing`) has the enclosing function as
  // its text and the match as `matchText`, and the question carries BOTH. Two
  // `catch` clauses in one function are two questions; keyed on the text
  // alone they were one, and the second was never asked -- it was handed the
  // first one's verdict as a twin. Found by the family-C candidate rules:
  // every same-function pair had byte-identical scores over three passes,
  // one of them a labelled defect nobody had been asked about.
  assert.notEqual(
    verdictKey(r, "located", "function f() { … }", "file", "catch (a) { return null }"),
    verdictKey(r, "located", "function f() { … }", "file", "catch (b) { throw b }"),
  );
  // And an unpromoted subject, with no match of its own, keys as before, so
  // duplicated code across files still costs one question.
  assert.equal(verdictKey(r, "located", "TEXT", "file", null), verdictKey(r, "located", "TEXT"));
});

test("cache: a missing, malformed or legacy store means no verdict, never a throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const fromMissing = Cache.load(join(dir, "nope"));
    assert.equal(fromMissing.get("k", "score"), null);
    assert.equal(fromMissing.loadError, null, "a ledger not yet written is empty, not an error");

    mkdirSync(join(dir, "broken"));
    writeFileSync(join(dir, "broken", "20260101T000000000Z-00000000.jsonl"), "{not json\n");
    const fromMalformed = Cache.load(join(dir, "broken"));
    assert.equal(fromMalformed.get("k", "score"), null);
    assert.ok(fromMalformed.loadError);

    // A 0.9 single-file cache handed to the ledger is named, not read: the
    // CLI migrates it before this point, so reaching here means it did not.
    writeFileSync(join(dir, "baseline.json"), JSON.stringify({ schema: "jev-lint-cache-4", entries: { k: { value: 3, kind: "score" } } }));
    const fromLegacy = Cache.load(join(dir, "baseline.json"));
    assert.equal(fromLegacy.get("k", "score"), null);
    assert.match(fromLegacy.loadError ?? "", /ledger migrate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache: an entry of the wrong kind is a miss, not a wrong answer", () => {
  const c = new Cache(null);
  c.set("k", { value: 0.8, confidence: null, kind: "noul" });
  assert.equal(c.get("k", "score"), null);
  assert.deepEqual(c.get("k", "noul"), { value: 0.8, confidence: null, kind: "noul" });
});

test("cache: a round trip through the ledger preserves verdicts, and prune drops orphans", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const path = join(dir, "verdicts");
    const c = new Cache(path);
    c.set("keep", { value: 2.5, confidence: 0.7, kind: "score" }, { rule: "r" });
    c.set("drop", { value: 1.0, confidence: 0.4, kind: "score" }, { rule: "r" });
    assert.equal(c.save({ model: "jev-test" }), true);

    const back = Cache.load(path);
    assert.equal(back.loadError, null);
    assert.deepEqual(back.get("keep", "score"), { value: 2.5, confidence: 0.7, kind: "score" });
    assert.equal(back.prune(["keep"]), 1);
    assert.equal(back.entries.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache: a warm run writes nothing, and a run that learns writes only what it learned", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const path = join(dir, "verdicts");
    const first = new Cache(path);
    first.set("a", { value: 1, confidence: null, kind: "score" });
    first.save();
    const warm = Cache.load(path);
    assert.ok(warm.get("a", "score"));
    assert.equal(warm.save(), true);
    assert.equal(readdirSync(path).length, 1, "answering from the ledger adds no file");
    const learning = Cache.load(path);
    learning.set("b", { value: 2, confidence: null, kind: "score" });
    learning.save();
    const added = readdirSync(path).sort().map((n) => readFileSync(join(path, n), "utf8"));
    assert.equal(added.length, 2);
    assert.ok(!added[1].includes('"a"') && added[1].includes('"b"'), "the new file holds only the new verdict");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache: a non-numeric verdict is never stored", () => {
  const c = new Cache(null);
  // Deliberately the wrong type for `value`: the point is that a non-numeric
  // verdict is never stored, and the type says it cannot happen.
  c.set("k", { value: "2", kind: "score" } as unknown as Answer);
  c.set("k2", null);
  assert.equal(c.entries.size, 0);
});
