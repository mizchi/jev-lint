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

// Provider-selection tests install their own credentials; never inherit live service keys.
for (const key of ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"]) delete process.env[key];

const files = [
  "harness",
  "rules",
  "skill-to-decision",
  "questions",
  "state",
  "report",
  "audit",
  "scan-contract",
  "public-api",
  "public-api-layout",
  "public-api-rust",
  "guide-imports",
  "guide-blocks",
  "go-guide-imports",
  "provider-lookup",
  "rust-guide-imports",
  "review-artifact",
  "acceptance",
  "sarif",
  "scope",
  "introspection-contract",
  "introspection",
  "cmd-introspect",
  "starter-sample",
  "cmd-auto",
  "confirm",
  "doctor",
  "document-contract",
  "document-input",
  "docs-facts",
  "documents",
  "cmd-docs",
  "cmd-artifact",
  "cmd-scope",
  "audit-run",
  "adversarial",
  "relation-contract",
  "relation-plan",
  "relation-report",
  "relation-questions",
  "relation-discovery",
  "relation-context",
  "relation-workflow",
  "relations",
  "relation-eval",
  "relation-negative-controls",
  "viewer",
  "tui",
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
  "openrouter",
  "model",
  "cmd-model",
  "request-control",
  "clef",
  "model-eval",
  "compare-models",
  "run",
  "text",
  "skills",
  "release",
  "commits",
  "instructions",
  "policy-source",
  "directives",
  "evals",
  "retry",
  "config",
  "context",
  "cost",
  "testcalls",
  "commands",
  "cmd-scan",
  "cli",
];
for (const f of files) await import(`./${f}.test.ts`);

report();
