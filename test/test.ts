#!/usr/bin/env node
/**
 * The test suite. No API key, no network, no ast-grep binary required except
 * where a test says so.
 *
 * What gets tested here is chosen deliberately. The model's accuracy is
 * measured by `jev-lint calibrate` against a labeled corpus, not asserted here --
 * a probabilistic answer has no expected value to assert. What IS asserted is
 * everything around it, and above all the FAILURE PATHS: a review tool that can
 * break a build is worse than no review tool, so every way this can fail has to
 * land on "no verdict" rather than on an exception.
 *
 * One file per module under test, run in this order and one at a time --
 * imported dynamically, because static imports of modules with top-level
 * `await` are evaluated in parallel, and a test that changes the working
 * directory then changes it under another file's test. `harness.ts` holds
 * the harness and `builders.ts` the fixture builders. `npm test <substring>`
 * runs the tests whose name contains it.
 */
import { report } from "./harness.ts";

const files = [
  "rules",
  "questions",
  "state",
  "report",
  "ignore",
  "files",
  "paired",
  "batch",
  "schedule",
  "gate",
  "cache",
  "diff",
  "calibrate",
  "scan",
  "jev",
  "run",
  "text",
  "commits",
  "instructions",
  "directives",
  "evals",
  "retry",
  "config",
  "cost",
  "testcalls",
  "commands",
  "cli",
];
for (const f of files) await import(`./${f}.test.ts`);

report();
