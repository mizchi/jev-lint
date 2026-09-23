import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { planBatches } from "../src/batch.ts";
import { commitFixtureSubjects } from "../src/commits.ts";
import { evalCorpus } from "../src/evals.ts";
import { undeclared } from "../src/rules.ts";
import { SHIPPED_CUSTOM_LANGUAGES } from "../src/types.ts";
import { decide, blocks, gate } from "../src/gate.ts";
import { JevError } from "../src/jev.ts";
import { buildQuestion } from "../src/questions.ts";
import { formatGithub, formatJson, formatPretty } from "../src/report.ts";
import { normalizeRule, loadRules } from "../src/rules.ts";
import { emitRuleFile, ruleLanguages } from "../src/scan.ts";
import { explain } from "../src/schedule.ts";
import { splitBlocks, textSubjects, MAX_BLOCK_CHARS } from "../src/text.ts";
import { LANGUAGE_DIRS } from "../src/types.ts";
import type { Rule, RunResult } from "../src/types.ts";
import { scoreRule, noulRule, tempRepo, commitRule, changeRule, subjectOf } from "./builders.ts";
import { test, testAsync } from "./harness.ts";

const blockRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "query-name-describes-sql",
    language: "Text",
    subject: "block",
    split: "^-- name: (?<NAME>\\w+) :(?<KIND>\\w+)",
    extensions: ["sql"],
    kind: "noul",
    state: "bare",
    ask: "This query's name ($NAME) misdescribes what the SQL does.",
    criteria: { true: "y", false: "n" },
    at: 0.5,
    ...over,
  }).rule!;

test("rules: a block rule splits text files by a header regex, and is Text only", () => {
  const r = blockRule();
  assert.equal(r.subject, "block");
  assert.deepEqual(r.languages, ["Text"]);
  assert.equal(r.split, "^-- name: (?<NAME>\\w+) :(?<KIND>\\w+)");
  assert.deepEqual(r.extensions, ["sql"]);
  const bad = (over: Record<string, unknown>): string =>
    normalizeRule({ id: "b", language: "Text", subject: "block", split: "^x", extensions: ["sql"], kind: "noul", ask: "a", criteria: { true: "y", false: "n" }, ...over }).error ?? "";
  assert.match(bad({ split: "(" }), /regex/, "a header regex must compile");
  // Without `split`, the whole file is one block: a document judged as a
  // whole, the way a markdown rule reads an article.
  const whole = normalizeRule({ id: "w", language: "Text", subject: "block", extensions: ["md"], kind: "noul", ask: "a", criteria: { true: "y", false: "n" } });
  assert.equal(whole.error, undefined, whole.error ?? "");
  assert.equal(whole.rule!.split, null);
  const blocks = splitBlocks("# Title\n\nbody\n", null);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.line, 1);
  assert.equal(blocks[0]!.endLine, 3);
  assert.deepEqual(blocks[0]!.captured, {});
  assert.equal(splitBlocks("", null).length, 0, "an empty file is no block");
  assert.deepEqual(LANGUAGE_DIRS.markdown, ["Text"]);
  // A block over the cap is cut at a line boundary and the question says so.
  const long = Array.from({ length: 3000 }, (_, i) => `line ${i} of a long document that goes on`).join("\n");
  const tdir = mkdtempSync(join(tmpdir(), "jev-block-"));
  writeFileSync(join(tdir, "long.md"), long);
  const [big] = textSubjects([whole.rule!], ["."], tdir);
  rmSync(tdir, { recursive: true, force: true });
  assert.ok(big!.text.length <= MAX_BLOCK_CHARS && big!.text.endsWith("goes on"), "cut on a line");
  assert.equal(big!.textCut?.of, long.length);
  const q = buildQuestion(whole.rule!, big!, "q0000");
  assert.match(String(q.instructions.note_on_text), /cut at a line boundary/);
  assert.equal(q.instructions.text, big!.text);
  // And the finding says so, in every format: a verdict on the part sent.
  const cutFinding = decide(big!, { value: 0.9, confidence: null, kind: "noul" });
  assert.deepEqual(cutFinding.cut, { judged: big!.text.length, of: long.length });
  const cutReport = { findings: [cutFinding], all: [cutFinding], review: [], stats: { subjects: 1, reported: 1, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } };
  assert.match(formatPretty(cutReport, { color: false }), /judged on the first [\d,]+ of [\d,]+ characters/);
  assert.match(formatGithub(cutReport), /judged on the first/);
  assert.equal(JSON.parse(formatJson(cutReport)).findings[0].cut.of, long.length);
  assert.match(bad({ extensions: [] }), /extensions/, "so is at least one extension");
  assert.match(bad({ language: "TypeScript" }), /Text/, "a block rule is Text only");
  assert.match(bad({ subject: "node" }), /block/, "and Text is for block rules only");
  assert.match(bad({ rule: { kind: "x" } }), /matcher/, "no matcher on a block rule");
  assert.match(bad({ state: "graph" }), /bare|located/, "the state is bare or located: there is no graph of a text file");
  // Never reaches ast-grep.
  assert.ok(!emitRuleFile([r], ruleLanguages([r])).includes("Text"));
});

await testAsync("run: `exclude` keeps a path under the roots out of the subjects, and says how many", async () => {
  // This repository's suite was one file, named in the config so that
  // test/fixtures -- planted defects for the cookbook test -- stayed out.
  // Split into a directory, the config names the directory and carves the
  // fixtures out of it. An excluded file is never a subject, for the code
  // rules and the block rules both, and the count is on the result so the
  // carve-out is visible.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-exclude-"));
  try {
    mkdirSync(join(dir, "src/fixtures"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "export function a() {}\n");
    writeFileSync(join(dir, "src/fixtures/planted.ts"), "export function b() {}\n");
    writeFileSync(join(dir, "src/fixtures/q.sql"), "-- name: GetA :one\nselect 1;\n");
    const code = noulRule({ id: "c", language: "TypeScript", rule: { kind: "function_declaration" } });
    const block = noulRule({ id: "q", language: "Text", subject: "block", split: "^-- name: (?<NAME>\\w+)", extensions: ["sql"], rule: undefined });
    const all = await collectSubjects({ rules: [code, block], paths: ["src"], cwd: dir });
    assert.deepEqual(all.subjects.map((s) => s.file).sort(), ["src/a.ts", "src/fixtures/planted.ts", "src/fixtures/q.sql"]);
    const some = await collectSubjects({ rules: [code, block], paths: ["src"], cwd: dir, exclude: ["src/fixtures"] });
    assert.deepEqual(some.subjects.map((s) => s.file), ["src/a.ts"]);
    assert.equal(some.excluded, 2);
    const globbed = await collectSubjects({ rules: [code, block], paths: ["src"], cwd: dir, exclude: ["**/planted.ts", "**/*.sql"] });
    assert.deepEqual(globbed.subjects.map((s) => s.file), ["src/a.ts"], "a glob leaves out what it matches");
    assert.equal(globbed.excluded, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: a rule for a language nobody declared a parser for is dropped, and the run names the language", async () => {
  // The shipped `moonbit` rules load anywhere; they can only be SCANNED
  // where a config names the compiled parser. Handing them to ast-grep
  // without one fails the whole scan, and dropping them without a word
  // would report a language's worth of nothing.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-undeclared-"));
  try {
    writeFileSync(join(dir, "a.ts"), "export function a() {}\n");
    writeFileSync(join(dir, "a.mbt"), "///|\npub fn a() -> Int {\n  1\n}\n");
    const mbt = noulRule({ id: "m", language: "moonbit", rule: { kind: "function_definition" } });
    const ts = noulRule({ id: "t", language: "TypeScript", rule: { kind: "function_declaration" } });
    const { subjects, undeclared } = await collectSubjects({ rules: [mbt, ts], paths: ["."], cwd: dir });
    assert.deepEqual(subjects.map((s) => s.rule.id), ["t"]);
    assert.deepEqual(undeclared, ["moonbit"]);
    // With no file of that language under the paths there is nothing the
    // parser would have been used on, and nothing to tell anyone about:
    // a repository with no MoonBit in it would otherwise carry the notice
    // on every run for a rule its config selected by a bare id.
    rmSync(join(dir, "a.mbt"));
    const noMbt = await collectSubjects({ rules: [mbt, ts], paths: ["."], cwd: dir });
    assert.deepEqual(noMbt.undeclared, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: same rule id in two languages keeps each language's contract", async () => {
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-shared-id-"));
  try {
    writeFileSync(join(dir, "a.ts"), "export function a() {}\n");
    writeFileSync(join(dir, "b.py"), "def b():\n    pass\n");
    const ts = { ...noulRule({ id: "shared", language: "TypeScript", rule: { kind: "function_declaration" }, ask: "TypeScript contract" }), languageDir: "typescript" };
    const py = { ...noulRule({ id: "shared", language: "Python", rule: { kind: "function_definition" }, ask: "Python contract" }), languageDir: "python" };
    const { subjects } = await collectSubjects({ rules: [ts, py], paths: ["."], cwd: dir });
    assert.deepEqual(subjects.map((s) => [s.file, s.rule.languageDir, s.rule.ask]).sort(), [
      ["a.ts", "typescript", "TypeScript contract"],
      ["b.py", "python", "Python contract"],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: a replay record preserves each answer's qualified rule identity", async () => {
  const { buildRecord } = await import("../src/run.ts");
  const ts = { ...noulRule({ id: "shared", language: "TypeScript", at: 0.3 }), languageDir: "typescript" };
  const py = { ...noulRule({ id: "shared", language: "Python", at: 0.7 }), languageDir: "python" };
  const subjects = [
    subjectOf({ rule: ts, file: "a.ts", language: "TypeScript" }),
    subjectOf({ rule: py, file: "b.py", language: "Python" }),
  ];
  const result = {
    ...gate(subjects.map((subject) => ({ subject, answer: { kind: "noul" as const, value: 0.5, confidence: null } }))),
    rules: [ts, py], subjects, batches: [], cachedCount: 0, spent: {},
  } as unknown as RunResult;
  const record = buildRecord(result, { arm: null, cutoffs: {}, unsureBelow: null }) as {
    rules: Array<{ languageDir: string }>;
    answers: Array<{ ruleKey: string }>;
  };
  assert.deepEqual(record.rules.map((r) => r.languageDir), ["typescript", "python"]);
  assert.deepEqual(record.answers.map((a) => a.ruleKey), ["typescript/shared", "python/shared"]);
});

await testAsync("run: a paired subject with no related test is dropped and counted, never asked", async () => {
  // A question about tests with no tests in the state is one the state cannot
  // answer; asking it anyway returns whatever the model thinks of untested
  // code in general. Dropping it silently would be the matcher failing
  // silently by another route, so the count is on the result.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-unpaired-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/tested.ts"), "export function a() { throw new Error('x'); }\n");
    writeFileSync(join(dir, "src/tested.test.ts"), "import { a } from './tested';\nit('a throws', () => { a(); });\n");
    writeFileSync(join(dir, "src/lonely.ts"), "export function b() { throw new Error('y'); }\n");
    const rule = noulRule({ id: "p", language: "TypeScript", state: "paired", rule: { kind: "function_declaration" } });
    const { subjects, tests, unpaired } = await collectSubjects({ rules: [rule], paths: ["src"], cwd: dir });
    assert.deepEqual(subjects.map((s) => s.file), ["src/tested.ts"]);
    assert.equal(tests!.get("src/tested.ts")!.length, 1);
    assert.deepEqual(unpaired, { subjects: 1, files: ["src/lonely.ts"] });
    // Under another arm the same rule asks about both, and pairs nothing.
    const located = await collectSubjects({ rules: [rule], paths: ["src"], cwd: dir, arm: "located" });
    assert.equal(located.subjects.length, 2, "the test file itself matches too? no: it is not a function_declaration file");
    assert.deepEqual(located.unpaired, { subjects: 0, files: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: --explain asks a second question of the findings only, and attaches the label", async () => {
  // jev-review's shape: a cheap screen, then a follow-up classification of
  // what came over the threshold. Here the matcher is the screen and the
  // verdict is the threshold; the follow-up is one choice per finding, sent
  // per batch with the same state, so nothing under the cutoff costs a token.
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({
    id: "r",
    rule: { kind: "function_declaration" },
    explain: { mutates: "It changes state", narrows: "It handles a narrower case" },
  });
  const seen: Array<Record<string, { type: string }>> = [];
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async (_state: unknown, questions: Record<string, { type: string }>) => {
      seen.push(questions);
      const answers: Record<string, unknown> = {};
      let i = 0;
      for (const [id, q] of Object.entries(questions)) {
        answers[id] =
          q.type === "choice"
            ? { type: "choice", choice: "narrows", confidence: 0.7, probabilities: { mutates: 0.3, narrows: 0.7 } }
            : { type: "score", score: i++ % 2 === 0 ? 3 : 1, confidence: 0.9 };
      }
      return { answers, usage: { input_tokens: 1 } };
    },
  };
  const result = await run({ rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client, explain: true });
  const verdictRounds = seen.filter((qs) => Object.values(qs).every((q) => q.type === "score"));
  const explainRounds = seen.filter((qs) => Object.values(qs).every((q) => q.type === "choice"));
  assert.ok(verdictRounds.length > 0 && explainRounds.length > 0, "two kinds of request, never mixed");
  assert.equal(
    explainRounds.reduce((n, qs) => n + Object.keys(qs).length, 0),
    result.findings.length,
    "exactly one explain question per reported finding",
  );
  assert.ok(result.findings.length > 0 && result.findings.length < result.all.length, "the fake put only some over the cutoff");
  for (const f of result.findings) assert.deepEqual(f.explanation, { choice: "narrows", confidence: 0.7 });
  for (const f of result.all.filter((f) => !f.reported)) assert.equal(f.explanation, undefined, "nothing under the cutoff is explained");
  // And the explanation reaches every format.
  assert.match(formatPretty(result, { color: false }), /why: narrows \(0\.70\)/);
  assert.match(formatGithub(result), /why: narrows/);
  assert.equal(JSON.parse(formatJson(result)).findings[0].explanation.choice, "narrows");
  // Without the flag nothing is asked twice, whatever the rule declares.
  seen.length = 0;
  const plain = await run({ rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client });
  assert.equal(seen.filter((qs) => Object.values(qs).some((q) => q.type === "choice")).length, 0);
  assert.ok(plain.findings.every((f) => f.explanation === undefined));
});

await testAsync("run: --loose reaches every format as a section of its own, and costs no request", async () => {
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({ id: "r", rule: { kind: "function_declaration" }, at: 2.0 });
  let calls = 0;
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async (_state: unknown, questions: Record<string, unknown>) => {
      calls += 1;
      const answers: Record<string, unknown> = {};
      let i = 0;
      // A spread of answers: some over 2.0, some in [1.0, 2.0), some under.
      for (const id of Object.keys(questions)) answers[id] = { type: "score", score: [2.5, 1.5, 0.5][i++ % 3], confidence: 0.9 };
      return { answers, usage: { input_tokens: 1 } };
    },
  };
  const opts = { rules: [rule], paths: ["rules/typescript/fn-name-promises/fixtures"], cachePath: null, client };
  const loose = await run({ ...opts, loose: Infinity });
  const before = calls;
  const tight = await run(opts);
  assert.equal(calls, before * 2, "the band is a second line on the same answers, not a second request");
  assert.equal(loose.findings.length, tight.findings.length, "findings are identical");
  assert.ok(loose.review.length > 0 && tight.review.length === 0);
  assert.ok(loose.review.every((f) => f.value! >= 1.0 && f.value! < 2.0));
  const pretty = formatPretty(loose, { color: false });
  assert.match(pretty, new RegExp(`${loose.review.length} subject\\(s\\) under a cutoff but over its loose floor`));
  assert.match(formatGithub(loose), /::notice .*loose/);
  const json = JSON.parse(formatJson(loose));
  assert.equal(json.review.length, loose.review.length);
  assert.equal(json.review[0].messageId, "review");
  assert.equal(json.findings.length, loose.findings.length, "and never mixed into the findings");
});

await testAsync("run: block rules take their subjects from text files beside ast-grep's, and located carries the file", async () => {
  const { collectSubjects } = await import("../src/run.ts");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-text-")));
  try {
    mkdirSync(join(dir, "db"));
    writeFileSync(join(dir, "db/users.sql"), "-- name: GetUser :one\nSELECT 1;\n\n-- name: DeleteUser :exec\nDELETE FROM users WHERE id = $1;\n");
    writeFileSync(join(dir, "db/notes.txt"), "-- name: NotSql :one\nignored\n");
    writeFileSync(join(dir, "a.ts"), "export function f() {}\n");
    const block = blockRule({ state: "located" });
    const ordinary = scoreRule({ rule: { kind: "function_declaration" } });
    const { subjects, sources } = await collectSubjects({ rules: [block, ordinary], paths: ["."], cwd: dir });
    const texts = subjects.filter((s) => s.rule.subject === "block");
    assert.equal(texts.length, 2, "two headers in the .sql file; the .txt is not in extensions");
    assert.equal(subjects.filter((s) => s.rule.id === "r").length, 1, "and the ast-grep rule still ran");
    assert.deepEqual(texts.map((s) => s.captured.NAME), ["GetUser", "DeleteUser"]);
    assert.equal(texts[1]!.line, 4);
    assert.equal(texts[0]!.file, "db/users.sql");
    assert.equal(texts[0]!.nodeKind, "block");
    assert.equal(texts[0]!.arm, "located");
    assert.ok(sources.get("db/users.sql")?.includes("DELETE FROM"), "the file is read once for the located state");
    const [batch] = planBatches(texts, { sources });
    assert.ok(String(batch!.state.source).includes("-- name: GetUser"), "located carries the whole file");
    const q = batch!.questions[batch!.subjects[0]!.id!]!;
    assert.deepEqual(q.instructions.matcher_captured, { NAME: "GetUser", KIND: "one" });
    assert.equal(q.instructions.matched_because, undefined, "no loose matcher to caveat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: commits mode judges a range with the commit rules only, and every format names the commit", async () => {
  const { run } = await import("../src/run.ts");
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "a\n" } },
    { message: "Remove the cart entirely", files: { "cart.ts": "b\n" } },
  ]);
  try {
    const rule = commitRule();
    const ordinary = scoreRule({ rule: { kind: "function_declaration" } });
    const seen: unknown[] = [];
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (state: { message?: string }, questions: Record<string, unknown>) => {
        seen.push(state);
        const answers: Record<string, unknown> = {};
        for (const id of Object.keys(questions)) answers[id] = { type: "noul", noul: state.message?.startsWith("Remove") ? 0.9 : 0.1 };
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [rule, ordinary], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.equal(result.subjects.length, 2, "two commits, one commit rule; the ordinary rule made no subject");
    assert.equal(seen.length, 2, "one request per commit");
    assert.equal(result.findings.length, 1);
    const [commitFinding] = result.findings;
    assert.match(commitFinding!.file, /^[0-9a-f]{40}$/);
    assert.equal(commitFinding!.line, 1);
    const pretty = formatPretty(result, { color: false });
    assert.match(pretty, new RegExp(`${commitFinding!.file.slice(0, 8)}  "Remove the cart entirely"`), "the commit is named by short sha and subject line");
    assert.match(formatGithub(result), /title=commit-message-describes-diff/);
    assert.equal(JSON.parse(formatJson(result)).findings[0].commit.subject, "Remove the cart entirely");
    // Dry run lists the commits and asks nothing.
    const dry = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client, dryRun: true });
    assert.equal(dry.subjects.length, 2);
    assert.equal(seen.length, 2, "nothing more was asked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: an auth error stops the run instead of failing every batch and every pass", async () => {
  // A key that does not work on the first batch does not work on the other
  // twenty-two, or on the next two passes. Sending them anyway is 69 failed
  // requests for one cause, a wall of identical error rows, and -- with
  // retries and backoff -- minutes of waiting for nothing. The subjects still
  // come back without a verdict, and the one error is still reported.
  const { run } = await import("../src/run.ts");
  const rule = scoreRule({ id: "r", rule: { kind: "function_declaration" } });
  let calls = 0;
  const client = {
    model: "fake",
    servedModel: null,
    spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
    askSplitting: async () => {
      calls += 1;
      throw new JevError("HTTP 402: no credits", { status: 402, kind: "auth" });
    },
  };
  const result = await run({
    rules: [rule],
    paths: ["rules/typescript/fn-name-promises/fixtures"],
    cachePath: null,
    retry: 3,
    concurrency: 1,
    client,
  });
  assert.ok(result.subjects.length > 3, "the cases must produce several batches");
  assert.equal(calls, 1, "one refusal is enough; nothing after it should be sent");
  assert.equal(result.errors?.length, 1, "and reported once, not once per batch");
  assert.match(result.errors![0]!.error, /402/);
  assert.equal(result.stats.missing, result.subjects.length, "every subject is missing, none is clean");
});

await testAsync("end to end: every shipped rule finds subjects in its own evals, and every labelled case is one", async () => {
  // The one test that touches ast-grep over the shipped rules. It asserts
  // the MATCHING and the plumbing, never a verdict: no request is made, so
  // there is no answer to assert. That the rules separate their classes is
  // what `jev-lint eval` measures, against each rule's evals/baseline.json.
  const { collectSubjects } = await import("../src/run.ts");
  const { rules: everyRule } = loadRules(["rules"]);
  // A rule for a grammar ast-grep does not have built in cannot be scanned
  // here: its parser is a library the reader of this suite compiles, not
  // something the repository carries. Those rules and their fixtures are
  // left out, and the set is asserted so the exclusion cannot widen in
  // silence. What checks them is `jev-lint eval` against their baselines.
  const needParser = undeclared(everyRule, {});
  assert.deepEqual(needParser, Object.keys(SHIPPED_CUSTOM_LANGUAGES));
  const rules = everyRule.filter((r) => !r.languages.some((l) => needParser.includes(l)));
  const { paths: everyPath, labels: everyLabel } = evalCorpus(["rules"]);
  const paths = everyPath.filter((p) => !needParser.some((l) => p.includes(`${sep}${l}${sep}`)));
  const labels = Object.fromEntries(Object.entries(everyLabel).filter(([f]) => !needParser.some((l) => f.includes(`${sep}${l}${sep}`))));
  assert.ok(paths.length >= 15, `expected a cases directory per rule, got ${paths.length}`);
  const { subjects: fromFiles } = await collectSubjects({ rules, paths });
  // A commit suite's fixtures are patches, judged as commits of a throwaway
  // repository and named by their patch files.
  const fromPatches = paths.filter((p) => p.includes(`${sep}git${sep}`) || p.includes("/git/")).flatMap((p) => commitFixtureSubjects(rules, p));
  const subjects = [...fromFiles, ...fromPatches];
  assert.ok(subjects.length > 50, `expected the evals to produce subjects, got ${subjects.length}`);

  const byRule = new Map();
  for (const s of subjects) byRule.set(s.rule.id, (byRule.get(s.rule.id) ?? 0) + 1);
  for (const r of rules) {
    assert.ok(byRule.get(r.id) > 0, `${r.id} matched nothing in its evals`);
  }
  // A label that no subject sits on is a label about nothing -- a line that
  // moved, or a case the matcher does not reach -- and it would silently
  // count as a miss or as nothing at all.
  const at = new Set(subjects.map((s) => `${s.rule.id}\u0000${s.file}\u0000${s.line}`));
  const orphans: string[] = [];
  for (const [file, list] of Object.entries(labels)) {
    if (file.startsWith("$") || !Array.isArray(list)) continue;
    for (const l of list) {
      if (!l.rule) continue;
      const w = l.window ?? 3;
      const hit = [...at].some((k) => {
        const [rule, f, line] = k.split("\u0000");
        return rule === l.rule && f === file && Math.abs(Number(line) - l.line) <= w;
      });
      if (!hit) orphans.push(`${file}:${l.line} ${l.rule}`);
    }
  }
  assert.deepEqual(orphans, [], "every label must sit on a subject its rule produces");

  // The naming rules only work if the matcher hands over the captured name.
  const named = subjects.filter((s) => Object.keys(s.captured ?? {}).length > 0);
  assert.ok(named.length > 20, "captures should reach most naming subjects");

  // A file subject is one per file and carries an outline, not source.
  const fileSubjects = subjects.filter((s) => s.rule.subject === "file");
  assert.ok(fileSubjects.length >= 8);
  assert.ok(fileSubjects.every((s) => s.isOutline && s.text.startsWith("path: ")));
});

await testAsync("end to end: every cookbook recipe loads and matches its fixture", async () => {
  // The cookbook is the part of the plugin a reader copies from, so a recipe
  // that does not load, or names a node kind the grammar does not have, is a
  // shipped defect. Every ```yaml block in it is written to a temp dir, loaded
  // as a rule file, and run over test/fixtures/cookbook, which holds one
  // instance of each shape. A fragment that is not a whole rule is fenced
  // ```yml in the cookbook, precisely so this picks up the complete ones only.
  const { collectSubjects } = await import("../src/run.ts");
  const md = readFileSync("skills/jev-lint/references/cookbook.md", "utf8");
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.ok(blocks.length >= 8, `expected the cookbook to hold recipes, found ${blocks.length} yaml blocks`);
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cookbook-"));
  try {
    blocks.forEach((b, i) => writeFileSync(join(dir, `recipe-${i}.yml`), b));
    const { rules, errors } = loadRules([dir]);
    assert.deepEqual(errors, [], "every recipe must load");
    const { subjects } = await collectSubjects({ rules, paths: ["test/fixtures/cookbook"] });
    const byRule = new Map<string, number>();
    for (const s of subjects) byRule.set(s.rule.id, (byRule.get(s.rule.id) ?? 0) + 1);
    for (const r of rules) {
      assert.ok((byRule.get(r.id) ?? 0) > 0, `cookbook recipe ${r.id} matched nothing in the fixture`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("end to end: a statement inside a test callback promotes to the test, named by its title", async () => {
  // A `test("...", () => { ... })` body is an arrow function passed to a call:
  // no declarator names it, so it was not a container, and a `subject:
  // enclosing` rule matching a statement inside it could promote to nothing.
  // The model then judged one line and its comment -- which is why the
  // comment-describes-block rule read every test preamble in this repository
  // as a false claim about the first `const` under it. The test call is a
  // container now, named by its title, with role `test`.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    writeFileSync(
      join(dir, "a.test.ts"),
      [
        'import { test, expect } from "vitest";',
        "",
        'test("keeps the order", () => {',
        "  // Sorting must not touch the input: a later test",
        "  // relies on the original order.",
        "  const before = [3, 1, 2];",
        "  expect(sort(before)).toEqual([1, 2, 3]);",
        "});",
        "",
        'describe("group", () => {',
        '  it("nested", async () => {',
        "    // Nested too.",
        "    const x = await load();",
        "    expect(x).toBe(1);",
        "  });",
        "});",
      ].join("\n"),
    );
    const rule = scoreRule({
      id: "b",
      subject: "enclosing",
      rule: { kind: "lexical_declaration", follows: { kind: "comment", pattern: "$DOC" } },
    });
    const { subjects, symbols } = await collectSubjects({ rules: [rule], paths: [dir] });
    assert.equal(subjects.length, 2);
    const [outer, inner] = subjects.sort((a, b) => a.line - b.line);
    assert.equal(outer!.promoted, true);
    assert.equal(outer!.nodeKind, "test");
    assert.ok(outer!.text.startsWith('test("keeps the order"'), "promoted to the whole test call, title included");
    assert.ok(outer!.text.includes("expect(sort(before))"), "the whole body, not the one statement");
    assert.ok(inner!.text.startsWith('it("nested"'), "the narrowest container wins: the it, not the describe");
    assert.ok(!inner!.text.includes("keeps the order"));
    // And the captured comment is the whole comment, not its last line.
    assert.equal(outer!.captured.DOC, "// Sorting must not touch the input: a later test\n// relies on the original order.");
    const entry = [...symbols.values()][0]!;
    assert.ok(entry.symbols.some((s) => s.role === "test" && s.name === "keeps the order" && s.isTest));
    assert.ok(entry.symbols.some((s) => s.role === "suite" && s.name === "group"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("end to end: overlapping grammars produce one subject per node", async () => {
  // `.js` and `.mjs` are claimed by BOTH the JavaScript and Jsx grammars, so a
  // rule listing them matched every node twice and reported every finding
  // twice. Found by running this tool on its own source.
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-test-"));
  try {
    // `.mjs` deliberately: the whole point is that this extension is claimed by
    // BOTH the JavaScript and Jsx grammars. A `.ts` file is claimed by
    // TypeScript alone and would match once, testing nothing.
    writeFileSync(join(dir, "a.mjs"), 'test("one", () => {});\ntest("two", () => {});\n');
    const rule = normalizeRule({
      id: "dup",
      languages: ["JavaScript", "Jsx"],
      kind: "noul",
      rule: { pattern: "test($T, $B)" },
      ask: "a",
      criteria: { true: "y", false: "n" },
    }).rule!;
    const { subjects, duplicateGrammars } = await collectSubjects({
      rules: [rule],
      paths: [dir],
    });
    assert.equal(subjects.length, 2, "two calls, two subjects, not four");
    assert.equal(duplicateGrammars, 2, "the duplicates should be counted, not merely dropped");
    // Two distinct nodes must survive; dedupe must key on the range, not the file.
    assert.equal(new Set(subjects.map((s) => s.line)).size, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The attribution pass over a `subject: change` finding: the fixture repo
// below is shared across the next four tests. One commit, one AGENTS.md with
// two top-level bullets (two directives, `splitDirectives` puts the first at
// line 3), a `package.json` that adds the dependency the first bullet
// forbids. A directive question is told apart from the verdict question by
// `"instruction" in q.instructions`, which only the per-directive question
// (built in `attributeFindings`) carries.
const AGENTS_MD = "# Rules\n\n- Never add a dependency on left-pad.\n- Keep the changelog updated.\n";
const changeFixture = () =>
  tempRepo([
    {
      message: "Add left-pad dependency",
      files: { "AGENTS.md": AGENTS_MD, "package.json": '{"dependencies":{"left-pad":"^1.0.0"}}\n' },
    },
  ]);
const isDirectiveQuestion = (q: { instructions: Record<string, unknown> }) => "instruction" in q.instructions;

await testAsync("run: a change finding names the one instruction that clears the cutoff", async () => {
  const { run } = await import("../src/run.ts");
  const dir = changeFixture();
  try {
    const rule = changeRule();
    const seen: Array<Record<string, { instructions: Record<string, unknown> }>> = [];
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (_state: unknown, questions: Record<string, { instructions: Record<string, unknown> }>) => {
        seen.push(questions);
        const answers: Record<string, unknown> = {};
        for (const [id, q] of Object.entries(questions)) {
          answers[id] = {
            type: "noul",
            // The verdict question always answers high; of the two
            // directives only the one about the dependency does.
            noul: isDirectiveQuestion(q) ? (String(q.instructions.body).includes("left-pad") ? 0.9 : 0.1) : 0.9,
          };
        }
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.equal(result.findings.length, 1);
    const [finding] = result.findings;
    assert.equal(finding!.violates?.length, 1);
    assert.equal(finding!.violates![0]!.file, "AGENTS.md");
    assert.equal(finding!.violates![0]!.line, 3);
    assert.match(finding!.violates![0]!.body, /left-pad/);
    // One attribution round, one question per directive -- beside the
    // verdict round, not instead of it.
    const attributionRounds = seen.filter((qs) => Object.values(qs).some(isDirectiveQuestion));
    assert.equal(attributionRounds.length, 1);
    assert.equal(Object.keys(attributionRounds[0]!).length, 2, "one noul question per directive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: a change finding no directive accounts for is retracted, not printed", async () => {
  const { run } = await import("../src/run.ts");
  const dir = changeFixture();
  try {
    const rule = changeRule();
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (_state: unknown, questions: Record<string, { instructions: Record<string, unknown> }>) => {
        const answers: Record<string, unknown> = {};
        // Every directive answers low, however high the verdict itself was.
        for (const [id, q] of Object.entries(questions)) {
          answers[id] = { type: "noul", noul: isDirectiveQuestion(q) ? 0.1 : 0.9 };
        }
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.deepEqual(result.findings, []);
    assert.equal(result.stats.reported, 0);
    // The same run, `--loose`: the retracted finding is listed for a reader,
    // never counted -- see gate.ts's `review` band.
    const loose = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client, loose: Infinity });
    assert.equal(loose.review.length, 1);
    assert.equal(loose.review[0]!.messageId, "review");
    assert.equal(loose.review[0]!.violates, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: a failed attribution request leaves the finding exactly as the verdict pass left it", async () => {
  const { run } = await import("../src/run.ts");
  const dir = changeFixture();
  try {
    const rule = changeRule();
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (_state: unknown, questions: Record<string, { instructions: Record<string, unknown> }>) => {
        const first = Object.values(questions)[0]!;
        if (isDirectiveQuestion(first)) throw new Error("attribution boom");
        const answers: Record<string, unknown> = {};
        for (const id of Object.keys(questions)) answers[id] = { type: "noul", noul: 0.9 };
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [rule], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.equal(result.findings.length, 1, "the verdict finding survives a follow-up that could not be asked");
    assert.equal(result.findings[0]!.violates, undefined);
    assert.equal(result.findings[0]!.reported, true);
    assert.ok(result.errors?.some((e) => /^attribute:/.test(e.error)), "the failure is reported, naming the pass it came from");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("run: two change rules over one commit share a batch but never a question id", async () => {
  // `planBatches` groups by (arm, file, rule.subject), not by rule id, so
  // two `subject: change` rules over the same commit land in one batch and
  // one verdict request. Their directive questions must not collide either:
  // this is what a subject id's own uniqueness within its batch buys when a
  // directive's id is built by suffixing it.
  const { run } = await import("../src/run.ts");
  const dir = changeFixture();
  try {
    const ruleA = changeRule({ id: "diff-follows-instructions" });
    const ruleB = changeRule({ id: "diff-follows-instructions-2" });
    const seenIds = new Set<string>();
    let collided = false;
    const client = {
      model: "fake",
      servedModel: null,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      askSplitting: async (_state: unknown, questions: Record<string, { instructions: Record<string, unknown> }>) => {
        const answers: Record<string, unknown> = {};
        for (const [id, q] of Object.entries(questions)) {
          if (seenIds.has(id)) collided = true;
          seenIds.add(id);
          answers[id] = {
            type: "noul",
            noul: isDirectiveQuestion(q) ? (String(q.instructions.body).includes("left-pad") ? 0.9 : 0.1) : 0.9,
          };
        }
        return { answers, usage: { input_tokens: 1 } };
      },
    };
    const result = await run({ rules: [ruleA, ruleB], paths: [], commits: { range: "HEAD" }, cwd: dir, cachePath: null, client });
    assert.equal(collided, false, "a question id must never repeat, even across two change rules sharing a commit's batch");
    assert.equal(result.findings.length, 2);
    for (const f of result.findings) {
      assert.equal(f.violates?.length, 1);
      assert.match(f.violates![0]!.body, /left-pad/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
