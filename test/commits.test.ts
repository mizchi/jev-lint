import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planBatches } from "../src/batch.ts";
import { listCommits, commitDiff, commitSubjects, squashSubjects, defaultRange, MAX_DIFF_CHARS } from "../src/commits.ts";
import { decide } from "../src/gate.ts";
import { formatPretty } from "../src/report.ts";
import { scoreRule, tempRepo, commitRule, changeRule } from "./builders.ts";
import { test } from "./harness.ts";

test("commits: a diff over the budget keeps the stat and the first hunks and says so", () => {
  const big = Array.from({ length: 4000 }, (_, i) => `line ${i} of a very long file that will not fit in one state`).join("\n");
  const dir = tempRepo([{ message: "Add a big file", files: { "big.txt": big, "small.txt": "x\n" } }]);
  try {
    const [c] = listCommits("HEAD", dir);
    const d = commitDiff(c!.sha, dir);
    assert.equal(d.truncated, true);
    assert.ok(d.diff.length <= MAX_DIFF_CHARS + 200, `${d.diff.length} chars`);
    assert.match(d.stat, /big\.txt/);
    assert.match(d.stat, /small\.txt/, "the stat still names every file");
    assert.ok(d.diff.startsWith("diff --git"), "and the diff still starts at the top");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: subjects are one per commit per commit rule; merges are skipped and counted", () => {
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "a\n" } },
    { message: "Fix cart", files: { "cart.ts": "b\n" } },
  ]);
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" }, stdio: ["ignore", "pipe", "pipe"] }).toString();
    git("checkout", "-q", "-b", "side", "HEAD~1");
    writeFileSync(join(dir, "side.ts"), "s\n");
    git("add", "-A");
    git("commit", "-q", "-m", "Add side");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "Merge side", "side");
    const rule = commitRule();
    const ordinary = scoreRule();
    const { subjects, skippedMerges, commits } = commitSubjects([rule, ordinary], "HEAD", dir);
    assert.equal(commits, 4, "four commits reachable");
    assert.equal(skippedMerges, 1, "the merge is not judged: its diff is its parents'");
    assert.equal(subjects.length, 3, "one per non-merge commit for the one commit rule; the ordinary rule makes none");
    const fix = subjects.find((s) => s.text.startsWith("Fix cart"))!;
    assert.equal(fix.rule.id, "commit-message-describes-diff");
    assert.match(fix.file, /^[0-9a-f]{40}$/, "the finding's file is the sha");
    assert.equal(fix.line, 1);
    assert.equal(fix.arm, "bare");
    assert.equal(fix.language, "Git");
    assert.equal(fix.nodeKind, "commit");
    assert.deepEqual(fix.captured, { SUBJECT: "Fix cart" });
    assert.ok(fix.commit && fix.commit.diff.includes("-a\n+b"), "the diff travels with the subject");
    // The state carries the message as the subject and the diff as the evidence.
    const [batch] = planBatches([fix]);
    assert.equal(batch!.state.message, "Fix cart");
    assert.equal(batch!.state.diff, fix.commit!.diff);
    assert.deepEqual(batch!.state.files, ["cart.ts"]);
    assert.match(String(batch!.state.reviewing), /commit/);
    const q = batch!.questions[batch!.subjects[0]!.id!]!;
    assert.equal(q.instructions.message, "Fix cart", "the question names the message, not `code`");
    assert.equal(q.instructions.code, undefined);
    assert.equal(q.instructions.matched_because, undefined, "no matcher, so no loose-matcher caveat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: --squash judges a whole range as one change against a message of its own", () => {
  // A pull request's description, or a changelog entry, is a claim about
  // the whole branch, not about any one commit. One subject: the message
  // given, the diff of the range from its merge base.
  const dir = tempRepo([
    { message: "Add cart", files: { "cart.ts": "export const cart = 1;\n" } },
    { message: "Add coupon", files: { "coupon.ts": "export const coupon = 1;\n" } },
    { message: "Fix total", files: { "cart.ts": "export const cart = 2;\n" } },
  ]);
  try {
    const [first] = listCommits("HEAD", dir);
    const rule = commitRule();
    const { subjects } = squashSubjects([rule], `${first!.sha}..HEAD`, "Add coupons to the cart\n\nAlso fixes the total.", dir);
    assert.equal(subjects.length, 1);
    const [s] = subjects;
    assert.equal(s!.text, "Add coupons to the cart\n\nAlso fixes the total.");
    assert.equal(s!.file, `${first!.sha}..HEAD`, "the finding is named by the range");
    assert.deepEqual(s!.captured, { SUBJECT: "Add coupons to the cart" });
    assert.deepEqual(s!.commit!.files.sort(), ["cart.ts", "coupon.ts"], "every file the range touched");
    assert.ok(s!.commit!.diff.includes("+export const coupon = 1;") && s!.commit!.diff.includes("-export const cart = 1;"));
    assert.match(s!.commit!.stat, /2 files changed/);
    // A bare ref means "that ref to HEAD".
    assert.equal(squashSubjects([rule], first!.sha, "m", dir).subjects[0]!.file, `${first!.sha}..HEAD`);
    // And the pretty report names a range by the range, not a cut sha.
    const f = decide(s!, { value: 0.9, confidence: null, kind: "noul" });
    assert.match(formatPretty({ findings: [f], all: [f], review: [], stats: { subjects: 1, reported: 1, missing: 0, unsure: 0, review: 0, byRule: {}, byFile: {} } }, { color: false }), new RegExp(`${first!.sha}\\.\\.HEAD  "Add coupons to the cart"`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: without an upstream there is no default range", () => {
  // The pre-push hook steps aside on a branch with no upstream; that path
  // was the hook's shell, and the function under it was never called
  // without one. `tests-cover-failure-paths` said so.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-no-upstream-")));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root"], { cwd: dir });
    assert.equal(defaultRange(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: a change rule gets the diff and the instructions; a commit rule gets neither instruction", () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`.\n" } },
    { message: "Add cart", files: { "cart.ts": "export const cart: any = {}\n" } },
  ]);
  try {
    const { subjects } = commitSubjects([commitRule(), changeRule()], "HEAD", dir);
    assert.equal(subjects.length, 4, "two commits x two rules");
    const change = subjects.find((s) => s.rule.subject === "change" && s.commit!.diff.includes("cart.ts"))!;
    assert.equal(change.nodeKind, "change");
    assert.equal(change.language, "Git");
    assert.equal(change.line, 1);
    assert.match(change.text, /1 file changed/, "the subject is the change: the stat");
    assert.ok(!/Add cart/.test(change.text), "not the message; a change rule is not about the message");
    assert.deepEqual(change.instructions!.docs.map((d) => d.file), ["AGENTS.md"]);
    assert.match(change.instructions!.docs[0]!.text, /Never use/);
    const message = subjects.find((s) => s.rule.subject === "commit" && s.text.startsWith("Add cart"))!;
    assert.equal(message.instructions, undefined, "a commit rule is judged on the message, not on the instructions");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commits: a commit with no instruction document produces no change subject", () => {
  const dir = tempRepo([{ message: "Add cart", files: { "cart.ts": "a\n" } }]);
  try {
    const { subjects } = commitSubjects([commitRule(), changeRule()], "HEAD", dir);
    assert.deepEqual(subjects.map((s) => s.rule.subject), ["commit"], "no standard, so no question: not a clean verdict");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
