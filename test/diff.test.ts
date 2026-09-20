import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff, touchesChange, changedRanges, changedFilesUnder } from "../src/diff.ts";
import type { ChangedRanges } from "../src/diff.ts";
import { test, testAsync } from "./harness.ts";

test("diff: hunk headers become post-image line ranges", () => {
  const ranges = parseUnifiedDiff(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +1,3 @@",
      "@@ -20,2 +23 @@",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,3 +5,2 @@",
    ].join("\n"),
  );
  assert.deepEqual(ranges.get("src/a.ts"), [
    [1, 3],
    [23, 23],
  ]);
  assert.deepEqual(ranges.get("src/b.ts"), [[5, 6]]);
});

test("diff: a pure deletion contributes no reviewable range", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/x.ts", "+++ b/x.ts", "@@ -4,3 +3,0 @@"].join("\n"),
  );
  assert.equal(ranges.get("x.ts"), undefined);
});

test("diff: a deleted file is skipped entirely", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/gone.ts", "+++ /dev/null", "@@ -1,5 +0,0 @@"].join("\n"),
  );
  assert.equal(ranges.size, 0);
});

test("diff: adjacent hunks merge so a subject is not tested twice", () => {
  const ranges = parseUnifiedDiff(
    ["--- a/x.ts", "+++ b/x.ts", "@@ -1 +1,2 @@", "@@ -5 +3,2 @@"].join("\n"),
  );
  assert.deepEqual(ranges.get("x.ts"), [[1, 4]]);
});

test("diff: overlap is inclusive at both ends and false for unknown files", () => {
  const ranges: ChangedRanges = new Map([["a.ts", [[10, 20]]]]);
  assert.equal(touchesChange(ranges, "a.ts", 1, 10), true, "ends touching counts");
  assert.equal(touchesChange(ranges, "a.ts", 20, 30), true);
  assert.equal(touchesChange(ranges, "a.ts", 5, 9), false);
  assert.equal(touchesChange(ranges, "a.ts", 21, 30), false);
  assert.equal(touchesChange(ranges, "a.ts", 12, 15), true, "fully inside counts");
  assert.equal(touchesChange(ranges, "other.ts", 12, 15), false);
});

await testAsync("diff: --staged reviews what the commit will contain, and nothing else", async () => {
  // A pre-commit hook runs `review --staged`. Before this, that also swept in
  // every untracked file -- not part of the commit -- and, with a configured
  // `paths:`, scanned the whole tree to discard most of it.
  const { execFileSync } = await import("node:child_process");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-git-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  try {
    git("init", "-q");
    writeFileSync(join(dir, "a.ts"), "export function a() {}\n");
    git("add", "a.ts");
    git("commit", "-q", "-m", "base");
    writeFileSync(join(dir, "a.ts"), "export function a() {}\nexport function b() {}\n");
    git("add", "a.ts");                                             // staged edit
    writeFileSync(join(dir, "a.ts"), "export function a() {}\nexport function b() {}\nexport function c() {}\n"); // unstaged on top
    writeFileSync(join(dir, "new.ts"), "export function n() {}\n");
    git("add", "new.ts");                                           // staged new file
    writeFileSync(join(dir, "loose.ts"), "export function l() {}\n"); // untracked
    const staged = await changedRanges({ staged: true, cwd: dir });
    assert.deepEqual([...staged.keys()].sort(), ["a.ts", "new.ts"], "the untracked file is not in the commit");
    assert.deepEqual(staged.get("a.ts"), [[2, 2]], "the unstaged third line is not in the commit either");
    const working = await changedRanges({ cwd: dir });
    assert.ok(working.has("loose.ts"), "without --staged, an untracked file is reviewable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diff: git's mnemonic prefixes are stripped like the default ones", () => {
  // With `diff.mnemonicPrefix = true` in the user's git config, a working-tree
  // diff says `+++ w/src/a.ts` and an index diff `+++ i/src/a.ts`. The parser
  // stripped only `b/`, so on such a machine `jev-lint review` scanned a file
  // called `w/src/a.ts`, found nothing, and printed a clean run with every
  // rule "matched nothing". Found on the author's own machine, after a
  // session of "review shows nothing, must be a docs-only change".
  for (const prefix of ["b", "w", "i", "c"]) {
    const r = parseUnifiedDiff(`--- a/src/a.ts\n+++ ${prefix}/src/a.ts\n@@ -1,0 +2,1 @@\n+x\n`);
    assert.deepEqual([...r.keys()], ["src/a.ts"], `prefix ${prefix}/`);
  }
  // And `--no-prefix` output, which has none.
  assert.deepEqual([...parseUnifiedDiff("--- src/a.ts\n+++ src/a.ts\n@@ -1,0 +2,1 @@\n+x\n").keys()], ["src/a.ts"]);
});

test("diff: a configured `paths:` narrows a review to the changed files under it, not the whole tree", () => {
  const changed = ["src/a.ts", "src/deep/b.ts", "test/t.ts", "docs/x.md", "srcx/c.ts"];
  assert.deepEqual(changedFilesUnder(changed, []), changed, "no paths: every changed file");
  assert.deepEqual(changedFilesUnder(changed, ["src"]), ["src/a.ts", "src/deep/b.ts"], "a directory, and not its prefix-twin");
  assert.deepEqual(changedFilesUnder(changed, ["test/t.ts"]), ["test/t.ts"], "a file names itself");
  assert.deepEqual(changedFilesUnder(changed, ["./src/", "test"]), ["src/a.ts", "src/deep/b.ts", "test/t.ts"], "spelling does not matter");
  assert.deepEqual(changedFilesUnder(changed, ["lib"]), [], "nothing under it: nothing to review, not everything");
});
