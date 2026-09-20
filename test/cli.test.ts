import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync, existsSync } from "node:fs";
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
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nrules: { commit-message-describes-diff: on }\n");
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
    writeFileSync(join(dir, ".jev-lint.yaml"), "files: [src]\nexclude: [src/fixtures]\nretry: 3\n");
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
  const picked = selectForRun("run", opts, { files: ["src"] }, ["fn-name-promises"], log);
  assert.ok(picked);
  assert.equal(picked!.command, "check");
  assert.ok(picked!.rules.every((r) => r.id === "fn-name-promises"));
  assert.ok(picked!.rules.length >= 2, "every language that has the id");
  assert.deepEqual(opts.paths, ["src"], "the id took the positional, so the config's paths apply");
  assert.equal(picked!.rangeArg, undefined);
  const commits = parseArgs(["commit-message-describes-diff", "main..HEAD", "--quiet", "-R", shipped], { color: false });
  commits.rulesAreShipped = true;
  const asCommits = selectForRun("run", commits, { files: ["src"] }, ["commit-message-describes-diff", "main..HEAD"], log);
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
  const commitRules = loadRules([join(realpathSync("."), "rules", "git")]).rules;
  assert.equal(commitRules.length, 1);
  const withBase = parseArgs(["--base", "main"], { color: false });
  withBase.paths = ["src"]; // as the config would fill it
  const t1 = await resolveTargets("commits", commitRules, withBase, undefined, out, log);
  assert.deepEqual(t1, { paths: [], diffRanges: null, commitsRange: "main..HEAD" });
  const t2 = await resolveTargets("commits", commitRules, withBase, "a..b", out, log);
  assert.equal((t2 as { commitsRange: string }).commitsRange, "a..b", "a positional range wins over --base");
  const noRule = await resolveTargets("commits", [], withBase, "a..b", out, log);
  assert.deepEqual(noRule, { exit: 2 });
  assert.match(said.at(-1)!, /subject: commit/);
  const squash = parseArgs(["--squash"], { color: false });
  assert.deepEqual(await resolveTargets("commits", commitRules, squash, "a..b", out, log), { exit: 2 });
  assert.match(said.at(-1)!, /--message/);
  // `check` with nothing named looks at the tree.
  const check = await resolveTargets("check", commitRules, parseArgs([], { color: false }), undefined, out, log);
  assert.deepEqual(check, { paths: ["."], diffRanges: null, commitsRange: null });
});

await testAsync("cli: main answers help, a bad flag and a bad --message-file without running anything", async () => {
  // The exits before any command: usage on stdout for help, the message and
  // the usage on stderr for a flag it does not know, and the file's error
  // for a --message-file it cannot read. Captured, so the suite's own
  // output stays the suite's.
  const { main } = await import("../src/cli/main.ts");
  const captured = { out: "", err: "" };
  const writeStdout = process.stdout.write.bind(process.stdout);
  const writeStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => { captured.out += String(s); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { captured.err += String(s); return true; }) as typeof process.stderr.write;
  try {
    assert.equal(await main(["help"]), 0);
    assert.match(captured.out, /^jev-lint -- lint rules/);
    assert.equal(await main(["check", "--bogus"]), 2);
    assert.match(captured.err, /bogus/);
    assert.match(captured.err, /usage:/);
    assert.equal(await main(["commits", "--squash", "--message-file", "/nonexistent/message"]), 2);
    assert.match(captured.err, /--message-file \/nonexistent\/message/);
    assert.equal(await main(["frobnicate", "--no-config", "-R", join(realpathSync("."), "rules", "git")]), 2);
    assert.match(captured.err, /unknown command `frobnicate`/);
  } finally {
    process.stdout.write = writeStdout;
    process.stderr.write = writeStderr;
  }
});

await testAsync("cli: init writes the starter config once, and replay refuses what is not a run record", async () => {
  const { cmdInit } = await import("../src/cli/cmd-init.ts");
  const { cmdReplay } = await import("../src/cli/cmd-replay.ts");
  const { cmdRules } = await import("../src/cli/cmd-rules.ts");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-cli-cmd-")));
  const said: string[] = [];
  const log = (s: string) => void said.push(s);
  const out = (s: string) => void said.push(s);
  try {
    const target = join(dir, ".jev-lint.yaml");
    const opts = parseArgs(["--config", target], { color: false });
    assert.equal(cmdInit(opts, out, log), 0);
    assert.ok(existsSync(target));
    assert.equal(cmdInit(opts, out, log), 2, "not twice");
    assert.match(said.at(-1)!, /already exists/);
    assert.equal(cmdInit(parseArgs(["--config", target, "--force"], { color: false }), out, log), 0, "unless forced");
    assert.equal(cmdInit(parseArgs(["--config", join(dir, "no/such/dir/.jev-lint.yaml")], { color: false }), out, log), 2);
    assert.match(said.at(-1)!, /could not write/);

    assert.equal(cmdReplay(parseArgs([], { color: false }), out, log), 2);
    assert.match(said.at(-1)!, /record path/);
    assert.equal(cmdReplay(parseArgs([join(dir, "missing.json")], { color: false }), out, log), 2);
    assert.match(said.at(-1)!, /could not read/);
    const wrongSchemaPath = join(dir, "wrong.json");
    writeFileSync(wrongSchemaPath, JSON.stringify({ schema: "something-else" }));
    assert.equal(cmdReplay(parseArgs([wrongSchemaPath], { color: false }), out, log), 2);
    assert.match(said.at(-1)!, /unexpected schema/);
    const record = join(realpathSync("."), "docs", "data", "self-lint-2026-09-20.json");
    assert.equal(cmdReplay(parseArgs([record, "--format", "json"], { color: false }), out, log), 1, "a recorded run with findings replays to exit 1");
    assert.ok(said.some((s) => s.startsWith("{")), "and prints the report");

    // `rules` lists what loaded and exits 0, or names what did not and exits 2.
    const before = said.length;
    assert.equal(cmdRules(parseArgs(["-R", join(realpathSync("."), "rules", "git")], { color: false }), out, log), 0);
    assert.ok(said.slice(before).some((s) => s.startsWith("git/commit-message-describes-diff")));
    const broken = join(dir, "rules.yml");
    writeFileSync(broken, "id: x\nlanguage: TypeScript\n");
    const beforeBroken = said.length;
    assert.equal(cmdRules(parseArgs(["-R", broken], { color: false }), out, log), 2);
    assert.ok(said.slice(beforeBroken).some((s) => /^rule error: /.test(s)), "the error is named, before the listing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("cli: init --pre-commit writes the hook where git keeps hooks, once, and only inside a repository", async () => {
  const { cmdInitHook } = await import("../src/cli/cmd-init.ts");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-cli-hook-")));
  const said: string[] = [];
  const log = (s: string) => void said.push(s);
  const out = (s: string) => void said.push(s);
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "repo"));
    mkdirSync(join(dir, "bare"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: join(dir, "repo") });
    process.chdir(join(dir, "repo"));
    const opts = parseArgs([], { color: false });
    assert.equal(cmdInitHook(opts, out, log, "pre-commit"), 0);
    const hook = join(dir, "repo", ".git", "hooks", "pre-commit");
    assert.ok(existsSync(hook));
    assert.equal(cmdInitHook(opts, out, log, "pre-commit"), 2, "an existing hook is not overwritten");
    assert.match(said.at(-1)!, /review --staged/, "the one line to add to it is printed");
    assert.equal(cmdInitHook(parseArgs(["--force"], { color: false }), out, log, "pre-push"), 0);
    assert.ok(existsSync(join(dir, "repo", ".git", "hooks", "pre-push")));
    // Outside a repository there is nowhere to put it. HOME and the tmpdir
    // are not repositories; GIT_CEILING_DIRECTORIES keeps the search from
    // finding one above the temp directory anyway.
    process.chdir(join(dir, "bare"));
    const ceiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = dir;
    try {
      assert.equal(cmdInitHook(opts, out, log, "pre-commit"), 2);
      assert.match(said.at(-1)!, /not inside a git repository/);
    } finally {
      if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    }
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});
