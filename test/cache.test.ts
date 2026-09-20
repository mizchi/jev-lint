import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
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

test("cache: a missing, unreadable, malformed or stale file means no verdict, never a throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const fromMissingFile = Cache.load(join(dir, "nope.json"));
    assert.equal(fromMissingFile.get("k", "score"), null);

    writeFileSync(join(dir, "bad.json"), "{not json");
    const fromMalformedFile = Cache.load(join(dir, "bad.json"));
    assert.equal(fromMalformedFile.get("k", "score"), null);
    assert.ok(fromMalformedFile.loadError);

    writeFileSync(join(dir, "old.json"), JSON.stringify({ schema: "ancient", entries: { k: { value: 3 } } }));
    const fromStaleSchema = Cache.load(join(dir, "old.json"));
    assert.equal(fromStaleSchema.get("k", "score"), null);
    assert.ok(fromStaleSchema.loadError);
    // A cache from before the key changed shape (0.3.0 wrote `jev-lint-2`)
    // is dropped with a line that says how many verdicts went and why,
    // rather than missing on every entry and keeping them all.
    writeFileSync(join(dir, "v2.json"), JSON.stringify({ schema: "jev-lint-2", entries: { a: { value: 1, kind: "noul" }, b: { value: 2, kind: "noul" } } }));
    const fromV2 = Cache.load(join(dir, "v2.json"));
    assert.match(fromV2.loadError ?? "", /jev-lint-2.*2 verdict\(s\).*dropped/);

    // A directory is unreadable as a file.
    mkdirSync(join(dir, "adir"));
    assert.equal(Cache.load(join(dir, "adir")).get("k", "score"), null);
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

test("cache: a round trip through disk preserves verdicts, and prune drops orphans", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    const path = join(dir, "c.json");
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

test("cache: a non-numeric verdict is never stored", () => {
  const c = new Cache(null);
  // Deliberately the wrong type for `value`: the point is that a non-numeric
  // verdict is never stored, and the type says it cannot happen.
  c.set("k", { value: "2", kind: "score" } as unknown as Answer);
  c.set("k2", null);
  assert.equal(c.entries.size, 0);
});
