/**
 * The suite's harness and fixtures, shared by every test file.
 *
 * `test` / `testAsync` count passes and failures; `report()` prints the
 * total and sets the exit code, and `test/test.ts` calls it once every
 * file has run. An argument on the command line runs only the tests whose
 * name contains it. The fixture builders make one valid rule, subject or
 * symbol table with the fields a test names overridden.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCommits, commitDiff } from "../src/commits.ts";
import type { Configurable } from "../src/config.ts";
import { normalizeRule } from "../src/rules.ts";
import type { AstGrepMatch, FileSymbols, Rule, StateArm, Subject, Labels } from "../src/types.ts";

/** Typed label fixtures, so the `$`-prefixed metadata keys check out. */
export const labelsOf = (o: Record<string, unknown>): Labels => o as Labels;

/** A structural-probe match, as buildSymbols consumes them. */
export const probeMatch = (
  ruleId: string,
  file: string,
  language: string,
  text: string,
  start: number,
  end: number,
  line: number,
  endLine: number,
  name?: string,
): AstGrepMatch => ({
  ruleId,
  file,
  language,
  text,
  range: {
    byteOffset: { start, end },
    start: { line, column: 0 },
    end: { line: endLine, column: 0 },
  },
  ...(name ? { metaVariables: { single: { JEVNAME: { text: name } } } } : {}),
});

let passCount = 0;
let failCount = 0;
const only = process.argv[2] ?? null;

export function test(name: string, fn: () => void): void {
  if (only && !name.includes(only)) return;
  try {
    fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passCount += 1;
  } catch (err: unknown) {
    failCount += 1;
    process.stdout.write(
      `FAIL  ${name}\n      ${String((err as Error).message).split("\n").join("\n      ")}\n`,
    );
  }
}

export const scoreRule = (over: Record<string, unknown> = {}): Rule => {
  const { rule, error } = normalizeRule({
    id: "r",
    language: "TypeScript",
    rule: { pattern: "fetch($$$)" },
    ask: "fetch must be given a timeout",
    ...over,
  });
  assert.equal(error, undefined, `fixture rule invalid: ${error}`);
  return rule!;
};

export const noulRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "n",
    language: "Rust",
    kind: "noul",
    rule: { kind: "function_item" },
    ask: "this function hides a failure",
    criteria: { true: "it does", false: "it does not" },
    ...over,
  }).rule!;

export const subjectOf = (over: Partial<Subject> = {}): Subject => ({
  rule: scoreRule(),
  file: "a.ts",
  line: 3,
  endLine: 5,
  text: "fetch(url)",
  nodeKind: "call_expression",
  arm: "located" as StateArm,
  language: "TypeScript",
  captured: {},
  enclosing: null,
  promoted: false,
  ...over,
});

export const sampleEntry = (): FileSymbols => ({
  language: "TypeScript",
  imports: ['import { db } from "./db"'],
  exportRanges: [] as Array<[number, number]>,
  symbols: [
    {
      name: "outer",
      role: "function",
      start: 0,
      end: 200,
      line: 1,
      endLine: 20,
      text: "function outer() {}",
      exported: true,
      isTest: false,
      calls: ["inner"],
      calledBy: [],
    },
    {
      name: "inner",
      role: "function",
      start: 50,
      end: 100,
      line: 5,
      endLine: 9,
      text: "function inner() {}",
      exported: false,
      isTest: false,
      calls: [],
      calledBy: ["outer"],
    },
  ],
});

export const manySubjects = (n: number, over: Partial<Subject> = {}): Subject[] =>
  Array.from({ length: n }, (_, i) =>
    subjectOf({ line: i + 1, endLine: i + 1, text: `call${i}()`, ...over }),
  );

await testAsync("scan: Go types are named by their type_spec, and a parameter type is not an exported name", async () => {
  const { collectSubjects } = await import("../src/run.ts");
  const dir = mkdtempSync(join(tmpdir(), "jev-go-"));
  try {
    writeFileSync(join(dir, "a.go"), [
      "package x",
      "",
      "type User struct{ Name string }",
      "",
      "func (u User) Greet() string { return u.Name }",
      "",
      "func displayName(u User) string { return u.Name }",
      "",
    ].join("\n"));
    const rule = scoreRule({ language: "Go", rule: { kind: "function_declaration" }, state: "graph" });
    const { symbols } = await collectSubjects({ rules: [rule], paths: ["a.go"], cwd: dir });
    const entry = symbols.get("a.go")!;
    const byName = new Map(entry.symbols.map((s) => [s.name, s]));
    assert.ok(byName.has("User"), `the type is a named symbol: ${[...byName.keys()].join(", ")}`);
    assert.equal(byName.get("User")!.role, "type");
    assert.equal(byName.get("User")!.exported, true);
    assert.equal(byName.get("Greet")!.exported, true, "a capitalised method with a receiver");
    assert.equal(byName.get("displayName")!.exported, false, "a lower-case func with an exported parameter type is private");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

export function tempRepo(steps: Array<{ message: string; files: Record<string, string> }>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commits-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } }).toString();
  git("init", "-q", "-b", "main");
  for (const step of steps) {
    for (const [f, text] of Object.entries(step.files)) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", step.message);
  }
  return dir;
}

export const commitRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "commit-message-describes-diff",
    language: "Git",
    subject: "commit",
    kind: "noul",
    ask: "The message claims something the diff does not do.",
    criteria: { true: "y", false: "n" },
    at: 0.5,
    ...over,
  }).rule!;

test("commits: a range lists its commits oldest first, with subject, body and parents", () => {
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "export const cart = 1;\n" } },
    { message: "Fix the total\n\nIt was off by one.", files: { "cart.ts": "export const cart = 2;\n" } },
  ]);
  try {
    const commits = listCommits("HEAD", dir);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]!.subject, "Add cart", "oldest first, so a review reads in order");
    assert.equal(commits[1]!.subject, "Fix the total");
    assert.equal(commits[1]!.message, "Fix the total\n\nIt was off by one.");
    assert.equal(commits[0]!.parents.length, 0);
    assert.equal(commits[1]!.parents.length, 1);
    assert.match(commits[1]!.sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(listCommits(`${commits[0]!.sha}..HEAD`, dir).map((c) => c.subject), ["Fix the total"]);
    // The diff: files touched, a stat, the patch, and whether it was cut.
    const d = commitDiff(commits[1]!.sha, dir);
    assert.deepEqual(d.files, ["cart.ts"]);
    assert.match(d.stat, /cart\.ts/);
    assert.match(d.diff, /-export const cart = 1;\n\+export const cart = 2;/);
    assert.equal(d.truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

export const answer = (rule: string, line: number, value: number) => ({
  rule, file: "rules/a/evals/cases/x.ts", line, endLine: line, kind: "noul" as const, value, confidence: null,
});

export const configurable = (over: Partial<Configurable> = {}): Configurable => ({
  rules: [],
  rulesAreShipped: false,
  paths: [],
  exclude: [],
  cache: ".jev-lint-cache.json",
  model: null,
  baseUrl: null,
  group: "file",
  arm: null,
  concurrency: 4,
  batchSize: 256,
  ruleBatchCap: 32,
  retry: 1,
  unsureBelow: null,
  at: {},
  ...over,
});

/** The total, and the exit code: 1 when anything failed. */
export function report(): never {
  process.stdout.write(`\n${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}
