import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { main } from "../src/cli/main.ts";
import { fakeClient } from "./builders.ts";
import { testAsync } from "./harness.ts";

// Every command that asks the model, run as the terminal would run it --
// `main(argv)` -- with a client that answers without a network and the two
// output streams collected. What the terminal gets is what is asserted:
// the exit code, the report, the files written.

/** A project: two rules over one file with one honest and one lying function. */
function project(): { dir: string; rules: string; src: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-")));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "a.ts"),
    ["export function honest(): number {", "  return 1;", "}", "", "export function liar(): number {", "  return 2;", "}", ""].join("\n"),
  );
  const rules = join(dir, "rules.yml");
  writeFileSync(
    rules,
    [
      "- id: name-lies",
      "  language: TypeScript",
      "  kind: noul",
      "  at: 0.5",
      "  rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }",
      "  ask: This function's name ($NAME) lies.",
      "  criteria: { 'true': it lies, 'false': it does not }",
      "- id: body-short",
      "  language: TypeScript",
      "  kind: score",
      "  at: 2",
      "  rule: { kind: function_declaration }",
      "  ask: This function's body is too short.",
      "",
    ].join("\n"),
  );
  return { dir, rules, src: join(dir, "src") };
}

/** The model of this file: `liar` lies (0.9), noChange else does (0.1); every body scores 1. */
const judge = (instructions: Record<string, unknown>): number => {
  const captured = (instructions.matcher_captured ?? {}) as Record<string, string>;
  if ("statement" in instructions) return captured.NAME === "liar" ? 0.9 : 0.1;
  return 1;
};

/** Run `main` with the outputs collected. */
async function cli(argv: string[], client = fakeClient(judge)): Promise<{ code: number; out: string; log: string; client: ReturnType<typeof fakeClient> }> {
  let out = "";
  let log = "";
  const code = await main(argv, { client, out: (s) => void (out += `${s}\n`), log: (s) => void (log += `${s}\n`) });
  return { code, out, log, client };
}

await testAsync("commands: check reports the finding, exits 1, and --fail-on / --dry-run / --record / replay behave as the terminal sees them", async () => {
  const { dir, rules, src } = project();
  try {
    const base = ["--no-config", "--cache", "none", "-R", rules, "--no-color"];
    const run = await cli(["check", src, ...base, "--format", "json"]);
    assert.equal(run.code, 1, run.log);
    const report = JSON.parse(run.out);
    assert.deepEqual(report.findings.map((f: { rule: string; line: number }) => [f.rule, f.line]), [["name-lies", 5]]);
    assert.equal(run.client.spent.calls, 1, "two rules, one file, one request");
    // Findings under the severity asked for do not fail the build.
    assert.equal((await cli(["check", src, ...base, "--fail-on", "error"])).code, 0);
    // A dry run asks noChange, prices the plan, and prices each rule.
    const dry = await cli(["check", src, ...base, "--dry-run"]);
    assert.equal(dry.code, 0);
    assert.equal(dry.client.spent.calls, 0);
    assert.match(dry.out, /1 request\(s\) planned/);
    assert.match(dry.out, /rule\s+subjects\s+requests\s+~tokens/, "the per-rule table");
    assert.match(dry.out, /name-lies\s+2\s+1/);
    // A record replays to the same decision with no client at all.
    const record = join(dir, "run.json");
    assert.equal((await cli(["check", src, ...base, "--record", record])).code, 1);
    assert.ok(existsSync(record));
    const replay = await cli(["replay", record, "--no-config", "--no-color", "--format", "json"]);
    assert.equal(replay.code, 1);
    assert.equal(JSON.parse(replay.out).findings.length, 1);
    assert.equal(replay.client.spent.calls, 0);
    // Raising the cutoff at replay time is free, and clears it.
    assert.equal((await cli(["replay", record, "--no-config", "--at", "name-lies=0.95"])).code, 0);
    // The pretty report, with the summary.
    const pretty = await cli(["check", src, ...base, "--summary"]);
    assert.match(pretty.out, /src\/a\.ts\n\s+5\s+flag/);
    assert.match(pretty.out, /by rule:\s+name-lies 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: a client that fails leaves no verdict, and the run exits 3, never clean", async () => {
  const { dir, rules, src } = project();
  try {
    const broken = fakeClient(judge);
    broken.askSplitting = async () => {
      throw new Error("no credits");
    };
    const run = await cli(["check", src, "--no-config", "--cache", "none", "-R", rules, "--no-color"], broken);
    assert.equal(run.code, 3, run.out + run.log);
    assert.match(run.out, /without a verdict/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: gaps and calibrate print their tables, and calibrate fits against labels", async () => {
  const { dir, rules, src } = project();
  try {
    const base = ["--no-config", "--cache", "none", "-R", rules, "--no-color"];
    const gaps = await cli(["gaps", src, ...base]);
    assert.ok(gaps.code === 0 || gaps.code === 1);
    assert.match(gaps.out, /rule\s+kind\s+matched\s+reported/, "the gap table");
    assert.match(gaps.out, /name-lies/);
    const labels = join(dir, "labels.json");
    // Keyed the way the run reports the file: outside the cwd, by its absolute path.
    writeFileSync(labels, JSON.stringify({ $default: "clean", [join(src, "a.ts")]: [{ line: 5, label: "bad", window: 0, rule: "name-lies" }] }));
    const cal = await cli(["calibrate", src, ...base, "--repeat", "2", "--labels", labels]);
    assert.equal(cal.code, 0, cal.log);
    assert.equal(cal.client.spent.calls, 2, "every pass asks; the cache is bypassed");
    assert.match(cal.log, /pass 2\/2/);
    assert.match(cal.out, /fitted cutoffs/);
    assert.match(cal.out, /name-lies\s+0\.5\s+precision 1 recall 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: eval asks, accepts a baseline, replays it for free, and compares two records", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-eval-")));
  try {
    const suite = join(dir, "typescript", "name-lies");
    mkdirSync(join(suite, "fixtures"), { recursive: true });
    writeFileSync(
      join(suite, "rule.yml"),
      [
        "id: name-lies",
        "language: TypeScript",
        "kind: noul",
        "at: 0.5",
        "rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }",
        "ask: This function's name ($NAME) lies.",
        "criteria: { 'true': it lies, 'false': it does not }",
        "",
      ].join("\n"),
    );
    writeFileSync(join(suite, "fixtures", "a.ts"), "export function honest() {}\nexport function liar() {}\n");
    writeFileSync(join(suite, "expect.yml"), "default: clean\nfixtures/a.ts:\n  - { line: 2, label: bad, window: 0, reason: it lies }\n");
    const here = process.cwd();
    process.chdir(dir);
    try {
      const dry = await cli(["eval", "typescript/name-lies", "--no-config", "--dry-run", "--repeat", "1"]);
      assert.equal(dry.code, 0, dry.log);
      assert.equal(dry.client.spent.calls, 0);
      assert.match(dry.out, /2 subject\(s\), 1 request\(s\)/);
      const first = await cli(["eval", "typescript/name-lies", "--no-config", "--repeat", "2", "--accept"]);
      assert.equal(first.code, 0, first.out + first.log);
      assert.ok(existsSync(join(suite, "baseline.json")), "accepted");
      assert.match(first.out, /name-lies\s+0\.5\s+1\s+0\s+0\s+1\.00\s+1\.00/, "P 1.00 R 1.00 at the shipped cutoff");
      const replay = await cli(["eval", "typescript/name-lies", "--no-config", "--replay"]);
      assert.equal(replay.code, 0, replay.out + replay.log);
      assert.equal(replay.client.spent.calls, 0, "a replay asks noChange");
      assert.match(replay.out, /all as shipped/);
      // The sentence changed: the baseline answered another question.
      writeFileSync(join(suite, "rule.yml"), readFileSync(join(suite, "rule.yml"), "utf8").replace("lies.", "misleads."));
      const stale = await cli(["eval", "typescript/name-lies", "--no-config", "--replay"]);
      assert.equal(stale.code, 1);
      assert.match(stale.out, /question changed/);
      const cmp = await cli(["eval", "--compare", join(suite, "baseline.json"), join(suite, "baseline.json"), "--no-config", "-R", dir]);
      assert.equal(cmp.code, 0, cmp.out + cmp.log);
    } finally {
      process.chdir(here);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: review judges only what the diff touched, and commits judges the range", async () => {
  const { dir, rules, src } = project();
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" }).toString();
  try {
    git(["init", "-q", "-b", "main"]);
    writeFileSync(join(src, "a.ts"), "export function honest(): number {\n  return 1;\n}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "Add honest"]);
    writeFileSync(join(src, "a.ts"), "export function honest(): number {\n  return 1;\n}\n\nexport function liar(): number {\n  return 2;\n}\n");
    git(["commit", "-q", "-am", "Add liar"]);
    const here = process.cwd();
    process.chdir(dir);
    try {
      const base = ["--no-config", "--cache", "none", "-R", rules, "--no-color"];
      const review = await cli(["review", "--base", "HEAD~1", ...base, "--format", "json"]);
      assert.equal(review.code, 1, review.log);
      const report = JSON.parse(review.out);
      assert.deepEqual(report.findings.map((f: { line: number }) => f.line), [5]);
      assert.ok(review.client.asked.every((q) => !String(JSON.stringify(q)).includes('"honest"')), "the unchanged function was not asked about");
      const noChange = await cli(["review", "--base", "HEAD", ...base]);
      assert.equal(noChange.code, 0);
      assert.match(noChange.out, /no changed files/);
      const noChangeJson = await cli(["review", "--base", "HEAD", ...base, "--json"]);
      assert.equal(noChangeJson.code, 0);
      assert.deepEqual(JSON.parse(noChangeJson.out).findings, [], "one document, empty, where JSON was asked for");
      // The commit rule, answered low: the range is judged and noChange reported.
      const commitRules = join(realpathSync(here), "rules", "git");
      const commits = await cli(["commits", "HEAD~1..HEAD", "--no-config", "--cache", "none", "-R", commitRules, "--no-color"], fakeClient(() => 0.2));
      assert.equal(commits.code, 0, commits.out + commits.log);
      assert.match(commits.out, /1 commit\(s\) in HEAD~1\.\.HEAD/);
      assert.equal(commits.client.spent.calls, 1);
    } finally {
      process.chdir(here);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: commits --dry-run names the rule and the documents a change subject is judged against", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-dryrun-commits-")));
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" }).toString();
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "export function honest(): number {\n  return 1;\n}\n");
    git(["init", "-q", "-b", "main"]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "Init"]);
    // The second commit is the one under judgment: a change subject needs
    // an instruction document in the tree it is built from.
    writeFileSync(join(dir, "AGENTS.md"), "# Agents\n\nAlways write tests first.\n");
    writeFileSync(
      join(dir, "src", "a.ts"),
      "export function honest(): number {\n  return 1;\n}\n\nexport function liar(): number {\n  return 2;\n}\n",
    );
    git(["add", "."]);
    git(["commit", "-q", "-m", "Add AGENTS.md and liar"]);
    process.chdir(dir);
    try {
      // Both a commit rule and a change rule, the shipped pair under
      // rules/git, loaded together -- the exact configuration a plan has
      // to stay readable under, since it puts two subjects on one ref.
      const commitRules = join(realpathSync(here), "rules", "git");
      const dry = await cli(
        ["commits", "HEAD~1..HEAD", "--no-config", "--cache", "none", "-R", commitRules, "--no-color", "--dry-run"],
        fakeClient(() => 0.2),
      );
      assert.equal(dry.code, 0, dry.out + dry.log);
      assert.equal(dry.client.spent.calls, 0, "a dry run asks nothing");
      assert.match(dry.out, /AGENTS\.md/, "the plan names the document a change subject is judged against");
      assert.match(dry.out, /commit-message-describes-diff/, "the commit rule's line names it");
      assert.match(dry.out, /diff-follows-instructions/, "the change rule's line names it");
    } finally {
      process.chdir(here);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: commits --dry-run claims no change subject for a commit with no instruction document", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-dryrun-nodoc-")));
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" }).toString();
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "export function honest(): number {\n  return 1;\n}\n");
    git(["init", "-q", "-b", "main"]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "Init"]);
    // No AGENTS.md or CLAUDE.md anywhere in this tree: a change rule has
    // no standard to judge the diff against, so this commit gets no
    // change subject.
    writeFileSync(
      join(dir, "src", "a.ts"),
      "export function honest(): number {\n  return 1;\n}\n\nexport function liar(): number {\n  return 2;\n}\n",
    );
    git(["add", "."]);
    git(["commit", "-q", "-m", "Add liar, no docs"]);
    process.chdir(dir);
    try {
      const commitRules = join(realpathSync(here), "rules", "git");
      const dry = await cli(
        ["commits", "HEAD~1..HEAD", "--no-config", "--cache", "none", "-R", commitRules, "--no-color", "--dry-run"],
        fakeClient(() => 0.2),
      );
      assert.equal(dry.code, 0, dry.out + dry.log);
      assert.equal(dry.client.spent.calls, 0);
      assert.doesNotMatch(dry.out, /diff-follows-instructions/, "no change subject was built, so its rule names no line");
      assert.match(dry.out, /1 commit\(s\) with no AGENTS\.md\/CLAUDE\.md skipped/, "the plan says why, with the real count -- not an invented one");
    } finally {
      process.chdir(here);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: eval and calibrate say what they cannot read, and exit 2 where noChange can run", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-refuse-")));
  try {
    const none = await cli(["eval", join(dir, "nowhere"), "--no-config"]);
    assert.equal(none.code, 2);
    assert.match(none.log, /no evals under/);
    const one = await cli(["eval", "--compare", join(dir, "a.json"), "--no-config"]);
    assert.equal(one.code, 2);
    assert.match(one.log, /two record paths/);
    writeFileSync(join(dir, "a.json"), "{}");
    const notRecord = await cli(["eval", "--compare", join(dir, "a.json"), join(dir, "a.json"), "--no-config"]);
    assert.equal(notRecord.code, 2);
    assert.match(notRecord.log, /not an eval record/);
    writeFileSync(join(dir, "b.json"), JSON.stringify({ schema: "jev-lint-eval-1", suite: "nope/nope", passes: [[]], recorded: "x", model: "m", rules: [], cutoffs: {}, spent: {} }));
    const noSuite = await cli(["eval", "--compare", join(dir, "b.json"), join(dir, "b.json"), "--no-config", "-R", dir]);
    assert.equal(noSuite.code, 2);
    assert.match(noSuite.log, /no suite named/);
    // Two records of different suites cannot be compared.
    writeFileSync(join(dir, "c.json"), JSON.stringify({ schema: "jev-lint-eval-1", suite: "other/other", passes: [[]], recorded: "x", model: "m", rules: [], cutoffs: {}, spent: {} }));
    const apart = await cli(["eval", "--compare", join(dir, "b.json"), join(dir, "c.json"), "--no-config", "-R", dir]);
    assert.equal(apart.code, 2);
    assert.match(apart.log, /different suites/);
    // A suite whose expect file does not parse fails the eval, and says so.
    const suite = join(dir, "typescript", "r");
    mkdirSync(join(suite, "fixtures"), { recursive: true });
    writeFileSync(join(suite, "rule.yml"), ["id: r", "language: TypeScript", "kind: noul", "at: 0.5", "rule: { kind: function_declaration }", "ask: x.", "criteria: { 'true': a, 'false': b }"].join("\n"));
    writeFileSync(join(suite, "fixtures", "a.ts"), "export function a() {}\n");
    writeFileSync(join(suite, "expect.yml"), "default: clean\nfixtures/a.ts: [ { line: 1, label: bad ]\n");
    const broken = await cli(["eval", suite, "--no-config", "-R", dir]);
    assert.equal(broken.code, 1);
    assert.match(broken.log, /expect\.yml/);
    assert.match(broken.out, /1 of 1 suite\(s\) failed/);
    // Labels that cannot be read are said, and the run still reports.
    const { dir: proj, rules, src } = project();
    try {
      const cal = await cli(["calibrate", src, "--no-config", "--cache", "none", "-R", rules, "--no-color", "--labels", join(proj, "missing.json")]);
      assert.equal(cal.code, 0);
      assert.match(cal.log, /could not read labels/);
      assert.match(cal.out, /name-lies/);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: --json gives every command one JSON document on stdout, and noChange else there", async () => {
  // A consumer parses stdout. Whatever a command says for a reader goes to
  // stderr under --json, and the document carries what the text carried.
  const { dir, rules, src } = project();
  const parseOne = (s: string): Record<string, any> => {
    const doc = JSON.parse(s);
    assert.equal(typeof doc, "object");
    return doc;
  };
  try {
    const base = ["--no-config", "--cache", "none", "-R", rules, "--no-color", "--json"];
    const check = parseOne((await cli(["check", src, ...base])).out);
    assert.equal(check.findings.length, 1);
    assert.equal(check.stats.byFile[join(src, "a.ts")].subjects, 4);

    const dry = parseOne((await cli(["check", src, ...base, "--dry-run"])).out);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.requests, 1);
    assert.equal(dry.subjects, 4);
    assert.ok(dry.tokens > 0 && dry.usd > 0);
    assert.deepEqual(dry.byRule.map((r: { rule: string }) => r.rule).sort(), ["body-short", "name-lies"]);
    assert.equal(dry.batches[0].arm, "located");

    const listed = parseOne((await cli(["rules", ...base])).out);
    assert.deepEqual(listed.rules.map((r: { id: string }) => r.id), ["name-lies", "body-short"]);
    assert.equal(listed.rules[0].cutoff, 0.5);
    assert.deepEqual(listed.errors, []);

    const gaps = parseOne((await cli(["gaps", src, ...base])).out);
    assert.ok(Array.isArray(gaps.gaps) && gaps.gaps.some((r: { rule: string }) => r.rule === "name-lies"));
    assert.equal(gaps.stats.subjects, 4);

    const labels = join(dir, "labels.json");
    writeFileSync(labels, JSON.stringify({ $default: "clean", [join(src, "a.ts")]: [{ line: 5, label: "bad", window: 0, rule: "name-lies" }] }));
    const cal = parseOne((await cli(["calibrate", src, ...base, "--repeat", "2", "--labels", labels])).out);
    assert.equal(cal.passes, 2);
    assert.ok(cal.gaps.length === 2 && cal.stability.rows.length === 2 && cal.stability.runs === 2);
    assert.equal(cal.fits.find((f: { rule: string }) => f.rule === "name-lies").fitted, 0.5);

    const record = join(dir, "run.json");
    await cli(["check", src, ...base.filter((a) => a !== "--json"), "--record", record]);
    const replay = parseOne((await cli(["replay", record, "--no-config", "--json"])).out);
    assert.equal(replay.findings.length, 1);
    assert.ok(Array.isArray(replay.gaps));

    const init = parseOne((await cli(["init", "--config", join(dir, "new.yaml"), "--json"])).out);
    assert.equal(init.wrote, join(dir, "new.yaml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: eval --json is one document too, for a run, a dry run, a replay and a compare", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commands-evaljson-")));
  try {
    const suite = join(dir, "typescript", "name-lies");
    mkdirSync(join(suite, "fixtures"), { recursive: true });
    writeFileSync(
      join(suite, "rule.yml"),
      ["id: name-lies", "language: TypeScript", "kind: noul", "at: 0.5", "rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }", "ask: This function's name ($NAME) lies.", "criteria: { 'true': it lies, 'false': it does not }", ""].join("\n"),
    );
    writeFileSync(join(suite, "fixtures", "a.ts"), "export function honest() {}\nexport function liar() {}\n");
    writeFileSync(join(suite, "expect.yml"), "default: clean\nfixtures/a.ts:\n  - { line: 2, label: bad, window: 0, reason: it lies }\n");
    const here = process.cwd();
    process.chdir(dir);
    try {
      const parseOne = (s: string) => JSON.parse(s);
      const dry = parseOne((await cli(["eval", "typescript/name-lies", "--no-config", "--json", "--dry-run", "--repeat", "1"])).out);
      assert.equal(dry.suites[0].plan.requests, 1);
      const run = parseOne((await cli(["eval", "typescript/name-lies", "--no-config", "--json", "--repeat", "1", "--accept"])).out);
      assert.equal(run.failed, 0);
      assert.equal(run.suites[0].score.rules[0].precision, 1);
      const replay = parseOne((await cli(["eval", "typescript/name-lies", "--no-config", "--json", "--replay"])).out);
      assert.equal(replay.suites[0].ok, true);
      const cmp = parseOne((await cli(["eval", "--compare", join(suite, "baseline.json"), join(suite, "baseline.json"), "--no-config", "-R", dir, "--json"])).out);
      assert.equal(cmp.diff.regressions.length, 0);
      assert.equal(cmp.a.passes, 1);
    } finally {
      process.chdir(here);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("commands: since 0.5 a config picks its rules by id, .jev-lint/rules/ adds to the shipped set, and the cache lives in .jev-lint/", async () => {
  const { dir, rules, src } = project();
  const here = process.cwd();
  try {
    // The project's own rule, beside the shipped ones, selected like them.
    mkdirSync(join(dir, ".jev-lint", "rules"), { recursive: true });
    writeFileSync(
      join(dir, ".jev-lint", "rules", "body-short.yml"),
      ["id: body-short", "language: TypeScript", "kind: score", "at: 2", "rule: { kind: function_declaration }", "ask: This function's body is too short.", ""].join("\n"),
    );
    process.chdir(dir);
    // No config: everything loaded runs, and the run says so.
    const all = await cli(["check", "src", "--cache", "none", "--json"]);
    assert.equal(all.code, 1, all.log);
    assert.match(all.log, /no config: running all \d+ packaged rule/);
    assert.ok(Object.keys(JSON.parse(all.out).stats.byRule).length >= 1);
    assert.ok(all.client.asked.some((q) => String(JSON.stringify(q)).includes("body is too short")), "the project's own rule ran");
    // A config that names no rules runs noChange, and says what to write.
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\n");
    const none = await cli(["check", "--cache", "none"]);
    assert.equal(none.code, 2);
    assert.match(none.log, /names no `rules:`/);
    // A config that names rules runs those, with what it overrides.
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nrules:\n  body-short: { severity: error, at: 0.5 }\n  fn-name-promises: off\n");
    const some = await cli(["check", "--cache", "none", "--json"]);
    assert.equal(some.code, 1, some.log);
    const report = JSON.parse(some.out);
    assert.deepEqual(Object.keys(report.stats.byRule), ["body-short"]);
    assert.equal(report.findings[0].severity, "error");
    assert.equal(report.findings[0].cutoff, 0.5);
    assert.ok(!some.client.asked.some((q) => String(JSON.stringify(q)).includes("name promises")), "a rule turned off is not asked");
    // Everything off is noChange to run, and said.
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nrules:\n  body-short: off\n");
    const off = await cli(["check", "--cache", "none"]);
    assert.equal(off.code, 2);
    assert.match(off.log, /turns every rule off/);
    // A misspelt id is an error, not a rule that quietly found noChange.
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nrules:\n  body-shrot: on\n");
    const typo = await cli(["check", "--cache", "none"]);
    assert.equal(typo.code, 2);
    assert.match(typo.log, /`body-shrot` names no loaded rule/);
    // The cache is written under .jev-lint/, and the old file is named.
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nrules: { body-short: { at: 0.5 } }\n");
    writeFileSync(join(dir, ".jev-lint-cache.json"), "{}");
    const cached = await cli(["check"]);
    assert.equal(cached.code, 1, cached.log);
    assert.ok(existsSync(join(dir, ".jev-lint", "baseline.json")), "the cache at its 0.5 path");
    assert.match(cached.log, /\.jev-lint-cache\.json is 0\.4's cache/);
    // `run <id>` still reaches the project's rule, config or not.
    const one = await cli(["run", "body-short", "src", "--cache", "none", "--json", "--at", "body-short=0.5"]);
    assert.equal(one.code, 1, one.log);
    assert.deepEqual(Object.keys(JSON.parse(one.out).stats.byRule), ["body-short"]);
    // `-R` is the whole set for that run, and a config rule it does not hold is an error.
    const only = await cli(["check", "src", "--cache", "none", "-R", rules, "--json"]);
    assert.equal(only.code, 1, only.log);
    // `init` lists every shipped rule and writes to .jev-lint.yaml's spelling.
    const started = await cli(["init", "--force", "--json"]);
    assert.equal(started.code, 0);
    const written = readFileSync(join(dir, ".jev-lint.yaml"), "utf8");
    assert.match(written, /^files: \[src\]$/m);
    assert.match(written, /^  fn-name-promises: on$/m);
    assert.match(written, /^  document-is-slop: on$/m);
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});
