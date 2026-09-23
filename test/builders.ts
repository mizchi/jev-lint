// jev-lint-ignore-file tests-cover-failure-paths
/**
 * Fixture builders, shared by the test files: one valid rule, subject,
 * symbol table, repository or config with the fields a test names
 * overridden. Nothing here asserts; `harness.ts` is the harness.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Configurable } from "../src/config.ts";
import type { AskClient } from "../src/jev.ts";
import { normalizeRule } from "../src/rules.ts";
import type { AstGrepMatch, CustomLanguages, FileSymbols, Question, Rule, StateArm, Subject, Labels } from "../src/types.ts";

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

export const noulRule = (over: Record<string, unknown> = {}, custom: CustomLanguages = {}): Rule => {
  const { rule, error } = normalizeRule(
    {
      id: "n",
      language: "Rust",
      kind: "noul",
      rule: { kind: "function_item" },
      ask: "this function hides a failure",
      criteria: { true: "it does", false: "it does not" },
      ...over,
    },
    "rule",
    custom,
  );
  assert.equal(error, undefined, `fixture rule invalid: ${error}`);
  return rule!;
};

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

export const changeRule = (over: Record<string, unknown> = {}): Rule =>
  normalizeRule({
    id: "diff-follows-instructions",
    language: "Git",
    subject: "change",
    kind: "noul",
    ask: "This change breaks one of the project's own written instructions.",
    criteria: { true: "y", false: "n" },
    at: 0.5,
    ...over,
  }).rule!;

export const answer = (rule: string, line: number, value: number) => ({
  rule, file: "rules/a/evals/cases/x.ts", line, endLine: line, kind: "noul" as const, value, confidence: null,
});

export const configurable = (over: Partial<Configurable> = {}): Configurable => ({
  rules: [],
  rulesAreShipped: false,
  paths: [],
  exclude: [],
  ruleSettings: null,
  languages: {},
  cache: ".jev-lint/baseline.json",
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

/**
 * A model that answers without a network: `judge` sees each question's
 * instructions and returns the probability (noul) or level (score) it
 * wants; `spent` counts as the real client's does. What was asked is kept
 * on `asked`, question by question, and each request's state on `states`,
 * for a test to look at.
 */
export function fakeClient(judge: (instructions: Record<string, unknown>, question: Record<string, unknown>) => number): AskClient & {
  asked: Array<Record<string, unknown>>;
  states: Array<Record<string, unknown>>;
} {
  const asked: Array<Record<string, unknown>> = [];
  const states: Array<Record<string, unknown>> = [];
  const spent = { calls: 0, inputTokens: 0, usd: 0, ms: 0 };
  return {
    model: "fake",
    servedModel: "fake-1",
    spent,
    asked,
    states,
    async askSplitting(state: unknown, questions: Record<string, Question>) {
      spent.calls += 1;
      states.push(state as Record<string, unknown>);
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(questions)) {
        const question = q as unknown as Record<string, unknown>;
        asked.push(question);
        const instructions = (question.instructions ?? {}) as Record<string, unknown>;
        const value = judge(instructions, question);
        answers[id] =
          question.type === "noul"
            ? { type: "noul", noul: value }
            : question.type === "choice"
              ? { type: "choice", choice: Object.keys((question.criteria ?? {}) as object)[0], confidence: 0.9 }
              : { type: "score", score: value, confidence: 0.9 };
      }
      spent.inputTokens += 100;
      return { model: "fake-1", answers, usage: { input_tokens: 100 } };
    },
  };
}
