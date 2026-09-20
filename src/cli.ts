#!/usr/bin/env node
/**
 * jev-lint -- a natural-language linter.
 *
 * ast-grep decides WHICH code gets looked at. A sentence you write decides
 * WHETHER it is a problem. Jev answers the sentence, in one batched request per
 * file, in a few hundred milliseconds.
 *
 * Commands:
 *   check     judge whole files
 *   review    judge only what a diff touched
 *   gaps      per-rule separation report -- read this before any threshold
 *   calibrate repeat runs and/or fit cutoffs against a labeled corpus
 *   rules     list the loaded rules and every validation error
 *   replay    re-score a recorded run under different cutoffs, for free
 */
import { main } from "./cli/main.ts";

main(process.argv.slice(2)).then(
  // Not `process.exit(code)`: when stdout is a pipe, exit discards whatever
  // has not been flushed yet, and a `--format json` report over a few hundred
  // subjects is longer than the pipe buffer. Setting the exit code lets the
  // event loop drain stdout first, and nothing here keeps the loop alive.
  (code) => {
    process.exitCode = code;
  },
  (err: any) => {
    // A rule set ast-grep would not accept, or a missing key, is a
    // configuration mistake: the message is the useful part and a stack trace
    // only buries it. Anything else is a bug here, and then the stack is what
    // someone needs.
    const configError = err?.name === "AstGrepError" || err?.kind === "auth";
    process.stderr.write(`jev-lint: ${configError ? err.message : (err?.stack ?? err)}\n`);
    process.exit(2);
  },
);
