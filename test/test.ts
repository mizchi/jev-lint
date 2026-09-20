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
 * One file per module under test, run in this order; `helpers.ts` holds the
 * harness and the fixture builders. `npm test <substring>` runs the tests
 * whose name contains it.
 */
import "./rules.test.ts";
import "./questions.test.ts";
import "./state.test.ts";
import "./report.test.ts";
import "./ignore.test.ts";
import "./files.test.ts";
import "./paired.test.ts";
import "./batch.test.ts";
import "./schedule.test.ts";
import "./gate.test.ts";
import "./cache.test.ts";
import "./diff.test.ts";
import "./calibrate.test.ts";
import "./scan.test.ts";
import "./jev.test.ts";
import "./run.test.ts";
import "./text.test.ts";
import "./commits.test.ts";
import "./evals.test.ts";
import "./retry.test.ts";
import "./config.test.ts";
import "./cli.test.ts";
import { report } from "./helpers.ts";

report();
