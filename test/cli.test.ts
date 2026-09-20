import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules } from "../src/rules.ts";
import { parseArgs } from "../src/cli/args.ts";
import { resolveContext } from "../src/cli/context.ts";
import { selectForRun } from "../src/cli/select.ts";
import { resolveTargets } from "../src/cli/targets.ts";
import { test, testAsync } from "./harness.ts";

await testAsync("cli: `commits --base <ref>` with `paths:` in the config judges the range, not the paths", async () => {
  // Found by running the tool on itself: `.jev-lint.yaml` names `paths:
  // [src, ...]`, and `commits --base v0.4.1` judged 52 commits "in src" --
  // the config's first path had become the git range. The range is a
  // command-line positional or --base; a config path is never one.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commits-cfg-")));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString();
  try {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    mkdirSync(join(dir, "src"));
    for (const n of [1, 2, 3]) {
      writeFileSync(join(dir, "src/a.ts"), `export const a = ${n};\n`);
      git(["add", "src/a.ts"]);
      git(["commit", "-q", "-m", `commit ${n}`]);
    }
    const base = git(["rev-parse", "HEAD~1"]).trim();
    writeFileSync(join(dir, ".jev-lint.yaml"), "paths: [src]\n");
    const cli = join(realpathSync("."), "src/cli.ts");
    const shipped = join(realpathSync("."), "rules");
    const out = execFileSync("node", ["--experimental-strip-types", cli, "commits", "--base", base, "--dry-run", "--cache", "none", "-R", shipped, "--no-color"], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, TYPESAFE_API_KEY: "x" },
    }).toString();
    assert.match(out, new RegExp(`1 commit\\(s\\) in ${base}\\.\\.HEAD`), out);
    assert.doesNotMatch(out, /in src/, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: the parser reads its arguments and nothing else, and a flag that needs a value says so", () => {
  const opts = parseArgs(["src", "--loose", "5", "--exclude", "a", "--exclude", "b", "--at", "r=0.7", "--no-color"], { color: true });
  assert.deepEqual(opts.paths, ["src"]);
  assert.equal(opts.loose, 5);
  assert.deepEqual(opts.exclude, ["a", "b"]);
  assert.deepEqual(opts.at, { r: 0.7 });
  assert.equal(opts.color, false, "the flag beats the terminal's default");
  assert.equal(parseArgs([], { color: true }).color, true);
  assert.equal(parseArgs(["--message-file", "-"], { color: false }).messageFile, "-", "named, not read: the parser opens no file");
  assert.throws(() => parseArgs(["--exclude"], { color: false }), /--exclude/);
  assert.throws(() => parseArgs(["--bogus"], { color: false }), /bogus/);
});

test("cli: the config folds into the options under the flags, and two spellings of it stop the run", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-cli-ctx-")));
  const said: string[] = [];
  const log = (s: string) => void said.push(s);
  try {
    writeFileSync(join(dir, ".jev-lint.yaml"), "paths: [src]\nexclude: [src/fixtures]\nretry: 3\n");
    const opts = parseArgs(["--config", join(dir, ".jev-lint.yaml"), "--retry", "1"], { color: false });
    const ctx = resolveContext(opts, ["--config", join(dir, ".jev-lint.yaml"), "--retry", "1"], log);
    assert.ok(ctx);
    assert.deepEqual(ctx!.argPaths, [], "the positionals as typed, before the config's paths fill in");
    assert.deepEqual(opts.paths, ["src"]);
    assert.deepEqual(opts.exclude, ["src/fixtures"]);
    assert.equal(opts.retry, 1, "the flag beats the file");
    assert.equal(resolveContext(parseArgs(["--config", join(dir, "missing.yaml")], { color: false }), [], log), null);
    assert.match(said.at(-1)!, /config not found/);
    writeFileSync(join(dir, "jev-lint.yaml"), "paths: [lib]\n");
    const twice = parseArgs([], { color: false });
    const here = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(resolveContext(twice, [], log), null);
    } finally {
      process.chdir(here);
    }
    assert.match(said.at(-1)!, /2 config files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: `run <id>` selects one shipped rule and scans the config's paths; a commit rule makes it `commits`", () => {
  const said: string[] = [];
  const log = (s: string) => void said.push(s);
  const shipped = join(realpathSync("."), "rules");
  const opts = parseArgs(["fn-name-promises", "--quiet", "-R", shipped], { color: false });
  opts.rulesAreShipped = true;
  const picked = selectForRun("run", opts, { paths: ["src"] }, ["fn-name-promises"], log);
  assert.ok(picked);
  assert.equal(picked!.command, "check");
  assert.ok(picked!.rules.every((r) => r.id === "fn-name-promises"));
  assert.ok(picked!.rules.length >= 2, "every language that has the id");
  assert.deepEqual(opts.paths, ["src"], "the id took the positional, so the config's paths apply");
  assert.equal(picked!.rangeArg, undefined);
  const commits = parseArgs(["commit-message-describes-diff", "main..HEAD", "--quiet", "-R", shipped], { color: false });
  commits.rulesAreShipped = true;
  const asCommits = selectForRun("run", commits, { paths: ["src"] }, ["commit-message-describes-diff", "main..HEAD"], log);
  assert.equal(asCommits!.command, "commits");
  assert.equal(asCommits!.rangeArg, "main..HEAD", "the positional after the id is the range");
  const none = selectForRun("run", parseArgs(["no-such-rule", "-R", shipped], { color: false }), {}, ["no-such-rule"], log);
  assert.equal(none, null);
  assert.match(said.at(-1)!, /no-such-rule/);
});

await testAsync("cli: the targets of `commits` come from the positional, --base, or the upstream, and never a config path", async () => {
  const said: string[] = [];
  const log = (s: string) => void said.push(s);
  const out = (s: string) => void said.push(s);
  const commitRule = loadRules([join(realpathSync("."), "rules", "git")]).rules;
  assert.equal(commitRule.length, 1);
  const base = parseArgs(["--base", "main"], { color: false });
  base.paths = ["src"]; // as the config would fill it
  const t1 = await resolveTargets("commits", commitRule, base, undefined, out, log);
  assert.deepEqual(t1, { paths: [], diffRanges: null, commitsRange: "main..HEAD" });
  const t2 = await resolveTargets("commits", commitRule, base, "a..b", out, log);
  assert.equal((t2 as { commitsRange: string }).commitsRange, "a..b", "a positional range wins over --base");
  const noRule = await resolveTargets("commits", [], base, "a..b", out, log);
  assert.deepEqual(noRule, { exit: 2 });
  assert.match(said.at(-1)!, /subject: commit/);
  const squash = parseArgs(["--squash"], { color: false });
  assert.deepEqual(await resolveTargets("commits", commitRule, squash, "a..b", out, log), { exit: 2 });
  assert.match(said.at(-1)!, /--message/);
  // `check` with nothing named looks at the tree.
  const check = await resolveTargets("check", commitRule, parseArgs([], { color: false }), undefined, out, log);
  assert.deepEqual(check, { paths: ["."], diffRanges: null, commitsRange: null });
});
