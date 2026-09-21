import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConfig, findConfig, hookShim, initialConfig, initialHook, initialPushHook, loadConfig } from "../src/config.ts";
import { blocks } from "../src/gate.ts";
import { main } from "../src/cli/main.ts";
import { configurable } from "./builders.ts";
import { test, testAsync } from "./harness.ts";

const writeConfig = (dir: string, body: string): string => {
  const p = join(dir, ".jev-lint.yaml");
  writeFileSync(p, body);
  return p;
};

test("config: a valid file parses into every setting it names", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const p = writeConfig(
      dir,
      [
        "files: [src, lib]",
        "exclude: [src/fixtures]",
        "rules:",
        "  fn-name-promises: on",
        "  rust/fn-name-promises: off",
        "  comment-describes-block: { at: 0.7, severity: error }",
        "  my-rule: warning",
        "cache: none",
        "model: jev-1.13.0",
        "baseUrl: https://proxy.example/v1",
        "apiKeyEnv: MY_KEY",
        "group: rule",
        "arm: bare",
        "concurrency: 2",
        "retry: 3",
        "unsureBelow: 0.4",
      ].join("\n"),
    );
    const { config, errors } = loadConfig(p);
    assert.deepEqual(errors, []);
    assert.deepEqual(config.files, ["src", "lib"]);
    assert.deepEqual(config.exclude, ["src/fixtures"]);
    // ESLint's shape: a rule is on, off, a severity, or a mapping of what to
    // override. `on` keeps the rule's own severity and cutoff.
    assert.deepEqual(config.rules, {
      "fn-name-promises": { enabled: true },
      "rust/fn-name-promises": { enabled: false },
      "comment-describes-block": { enabled: true, at: 0.7, severity: "error" },
      "my-rule": { enabled: true, severity: "warning" },
    });
    assert.equal(config.cache, null, "`none` disables the cache");
    // `applyConfig` publishes `baseUrl` to the environment for the client
    // to find; apply only the setting under test so nothing leaks past this test.
    const opts = configurable();
    applyConfig(opts, { exclude: config.exclude }, new Set());
    assert.deepEqual(opts.exclude, ["src/fixtures"]);
    const withFlag = configurable({ exclude: ["other"] });
    applyConfig(withFlag, { exclude: config.exclude }, new Set(["--exclude"]));
    assert.deepEqual(withFlag.exclude, ["other"], "the flag wins over the file");
    assert.equal(config.baseUrl, "https://proxy.example/v1");
    assert.equal(config.group, "rule");
    assert.equal(config.arm, "bare");
    assert.equal(config.retry, 3);
    assert.equal(config.unsureBelow, 0.4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: an API key in the file is an error, not a silently ignored field", () => {
  // A config file belongs in version control and a secret does not. Ignoring
  // the field would leave someone believing the key was picked up.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const { config, errors } = loadConfig(writeConfig(dir, "apiKey: sk-secret\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /not supported/);
    assert.match(errors[0]!, /apiKeyEnv/, "and it says what to do instead");
    assert.equal(Object.keys(config).length, 0, "nothing is taken from it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: an unknown key, a bad value and bad YAML are all reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    assert.match(loadConfig(writeConfig(dir, "concurency: 4\n")).errors[0]!, /not a known setting/);
    assert.match(loadConfig(writeConfig(dir, "group: sideways\n")).errors[0]!, /must be one of/);
    assert.match(loadConfig(writeConfig(dir, "retry: 0\n")).errors[0]!, /positive integer/);
    assert.match(loadConfig(writeConfig(dir, "arm: wide\n")).errors[0]!, /must be null or one of/);
    assert.match(loadConfig(writeConfig(dir, "unsureBelow: 2\n")).errors[0]!, /0 to 1/);
    assert.match(loadConfig(writeConfig(dir, "rules: 3\n")).errors[0]!, /mapping of rule id/);
    assert.match(loadConfig(writeConfig(dir, "rules:\n  r: { at: yes }\n")).errors[0]!, /must be a number/);
    assert.match(loadConfig(writeConfig(dir, "- a\n- b\n")).errors[0]!, /not a mapping/);
    assert.match(loadConfig(writeConfig(dir, "a: [unclosed\n")).errors.length ? "ok" : "", /ok/);
    // An empty file is valid and sets nothing.
    assert.deepEqual(loadConfig(writeConfig(dir, "\n")).errors, []);
    assert.deepEqual(loadConfig(writeConfig(dir, "\n")).config, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: a flag beats the file, and the file beats the default", () => {
  // The precedence that lets a project commit a config and still be overridden
  // for one run. `explicit` is why it works: `concurrency` is already 4 before
  // any file is read, so comparing against the default would let the file win
  // over a flag that happened to match it.
  const config = { concurrency: 2, group: "rule" as const, retry: 5 };

  const fromFile = configurable();
  applyConfig(fromFile, config, new Set());
  assert.equal(fromFile.concurrency, 2, "the file beats the built-in default");
  assert.equal(fromFile.group, "rule");
  assert.equal(fromFile.retry, 5);

  const fromFlag = configurable({ concurrency: 8, retry: 1 });
  applyConfig(fromFlag, config, new Set(["--concurrency", "-r"]));
  assert.equal(fromFlag.concurrency, 8, "a flag beats the file");
  assert.equal(fromFlag.retry, 1, "including its short form");
  assert.equal(fromFlag.group, "rule", "and leaves the settings it did not name");
});

test("config: `languages:` declares a grammar ast-grep does not have built in", () => {
  // ast-grep reads a tree-sitter parser compiled to a dynamic library, named
  // in its own sgconfig.yml. A jev-lint config declares the same thing, and
  // the path is resolved from the config's directory, since that is what a
  // reader of the file means by a relative path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-cfg-")));
  try {
    const p = writeConfig(dir, ["languages:", "  moonbit:", "    libraryPath: parsers/moonbit.dylib", "    extensions: [mbt, mbti]", "    expandoChar: _"].join("\n"));
    const { config, errors } = loadConfig(p);
    assert.deepEqual(errors, []);
    assert.deepEqual(config.languages, {
      moonbit: { libraryPath: join(dir, "parsers/moonbit.dylib"), extensions: ["mbt", "mbti"], expandoChar: "_" },
    });
    // An absolute path is left alone, and `expandoChar` is optional.
    const abs = loadConfig(writeConfig(dir, `languages:\n  x:\n    libraryPath: /opt/x.so\n    extensions: [x]\n`));
    assert.deepEqual(abs.config.languages, { x: { libraryPath: "/opt/x.so", extensions: ["x"] } });
    // What a declaration cannot be.
    const bad = (body: string): string => loadConfig(writeConfig(dir, body)).errors[0] ?? "";
    assert.match(bad("languages: [moonbit]\n"), /mapping of language name/);
    assert.match(bad("languages:\n  moonbit: {}\n"), /`libraryPath`/);
    assert.match(bad("languages:\n  moonbit: { libraryPath: x.so }\n"), /`extensions`/);
    assert.match(bad("languages:\n  moonbit: { libraryPath: x.so, extensions: [mbt], expandoChar: ab }\n"), /one character/);
    assert.match(bad("languages:\n  Rust: { libraryPath: x.so, extensions: [rs] }\n"), /already a language ast-grep has built in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: the 0.4 keys are refused with the 0.5 spelling, not read as something else", () => {
  // `paths:` is `files:`; `rules:` no longer names directories but rules;
  // `at:` moved under each rule. Silently ignoring any of these would run
  // every rule over the whole tree at the shipped cutoffs and say nothing.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const { errors } = loadConfig(writeConfig(dir, "paths: [src]\nrules: [my-rules]\nat: { fn-name-promises: 0.8 }\n"));
    assert.equal(errors.length, 3, errors.join("\n"));
    assert.match(errors[0]!, /`paths` is `files` since 0\.5/);
    assert.match(errors[1]!, /`rules` names rules since 0\.5.*\.jev-lint\/rules/);
    assert.match(errors[2]!, /`at` moved under `rules` since 0\.5/);
    const bad = loadConfig(writeConfig(dir, "rules:\n  x: maybe\n  y: { at: high }\n  z: { severity: loud }\n  w: [1]\n"));
    assert.equal(bad.errors.length, 4, bad.errors.join("\n"));
    assert.match(bad.errors[0]!, /rules\.x/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: `files:` fills the paths only when none were typed, and `rules:` is carried whole", () => {
  const opts = configurable();
  applyConfig(opts, { files: ["src"], rules: { a: { enabled: true } } }, new Set());
  assert.deepEqual(opts.paths, ["src"]);
  assert.deepEqual(opts.ruleSettings, { a: { enabled: true } });
  const typed = configurable({ paths: ["lib"] });
  applyConfig(typed, { files: ["src"] }, new Set());
  assert.deepEqual(typed.paths, ["lib"], "a positional beats the file");
});

test("config: the file is found by walking up, and only names jev-lint's own", () => {
  // Resolved, because `process.cwd()` is: on macOS the temp dir is a symlink
  // under /var and cwd reports the /private/var target.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-cfg-")));
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    process.chdir(join(dir, "a", "b"));
    assert.equal(findConfig(), null, "nothing above a temp dir");
    writeConfig(dir, "concurrency: 2\n");
    assert.equal(findConfig(), join(dir, ".jev-lint.yaml"), "found two levels up");
    // Every spelling is recognised: with or without the dot, with or
    // without the hyphen, .yaml or .yml.
    for (const name of ["jev-lint.yaml", "jevlint.yaml", ".jevlint.yml", "jevlint.yml", ".jev-lint.yml", "jev-lint.yml", ".jevlint.yaml"]) {
      const d = join(dir, "spell", name.replace(/\W/g, "_"));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, name), "concurrency: 2\n");
      assert.equal(findConfig(d), join(d, name), name);
    }
    // Two spellings in one directory is a mistake, not a choice: the
    // finder throws naming both, and the CLI stops rather than pick one.
    writeFileSync(join(dir, "jevlint.yaml"), "concurrency: 3\n");
    assert.throws(() => findConfig(), /\.jev-lint\.yaml.*jevlint\.yaml|jevlint\.yaml.*\.jev-lint\.yaml/);
    assert.throws(() => findConfig(), /one config file/);
    rmSync(join(dir, "jevlint.yaml"));
    // But a config nearer than another is not a conflict: the nearest wins,
    // as it always did, and the search stops there.
    writeFileSync(join(dir, "a", "jevlint.yml"), "concurrency: 4\n");
    assert.equal(findConfig(), join(dir, "a", "jevlint.yml"));
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("config: the pre-commit hook init writes is a shell script that reviews the staged diff", async () => {
  const { execFileSync } = await import("node:child_process");
  const hook = initialHook();
  assert.ok(hook.startsWith("#!/bin/sh\n"));
  // `sh -n` parses without running: the hook must at least be valid shell.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hook-"));
  try {
    writeFileSync(join(dir, "pre-commit"), hook);
    execFileSync("sh", ["-n", join(dir, "pre-commit")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(hook, /review --staged/, "it judges what the commit contains, not the working tree");
  assert.match(hook, /commits --staged/, "and also judges the change against the project's own instructions");
  assert.match(hook, /--fail-on error/, "and blocks only on what a rule has earned");
  assert.match(hook, /TYPESAFE_API_KEY/, "and stands aside on a machine without a key");
});

await testAsync("config: the pre-push hook judges the commits about to be pushed, and steps aside without an upstream", async () => {
  const { execFileSync } = await import("node:child_process");
  const hook = initialPushHook();
  assert.ok(hook.startsWith("#!/bin/sh\n"));
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hook-"));
  try {
    writeFileSync(join(dir, "pre-push"), hook);
    execFileSync("sh", ["-n", join(dir, "pre-push")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(hook, /jev-lint commits/, "it judges commits, not files");
  assert.match(hook, /@\{upstream\}/, "what is not yet pushed");
  assert.match(hook, /--fail-on error/, "and blocks only on what a rule has earned");
  assert.match(hook, /TYPESAFE_API_KEY/, "and stands aside on a machine without a key");
});

/** A directory with a stub `npx` on PATH that exits `code`, ignoring every argument. */
function stubNpx(code: number): string {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-stub-npx-"));
  writeFileSync(join(dir, "npx"), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
  return dir;
}

/** Run a hook body with `sh`, a stub `npx` on PATH, and a key set; the exit code, without throwing. */
function runBody(scriptPath: string, cwd: string, npxDir: string): number {
  try {
    execFileSync("sh", [scriptPath], {
      cwd,
      env: { ...process.env, PATH: `${npxDir}:${process.env.PATH}`, TYPESAFE_API_KEY: "x" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (err: unknown) {
    return (err as { status: number }).status;
  }
}

/**
 * A directory with a stub `npx` that exits with `codes[call N]` on its Nth
 * invocation -- so the pre-commit body's two `jev-lint` calls (`review`,
 * then `commits --staged`) can be told apart, and each one's own exit-3
 * passthrough exercised independently of the other's.
 */
function stubNpxSequence(codes: number[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-stub-npx-seq-"));
  const counter = join(dir, "n");
  writeFileSync(counter, "0");
  const cases = codes.map((c, i) => `${i}) exit ${c} ;;`).join("\n");
  writeFileSync(
    join(dir, "npx"),
    `#!/bin/sh\nn=$(cat "${counter}")\necho $((n + 1)) > "${counter}"\ncase "$n" in\n${cases}\n*) exit 0 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return dir;
}

await testAsync("config: the shim is four lines that find the tracked body and exit 0 quietly when there is none", async () => {
  const shim = hookShim();
  assert.ok(shim.startsWith("#!/bin/sh\n"));
  assert.match(shim, /\.jev-lint\/hooks/);
  assert.match(shim, /exec "\$hook"/);
  assert.match(shim, /\[ -x "\$hook" \] \|\| exit 0/, "a body deleted after the shim was installed must not break committing");
  assert.ok(!/review --staged|jev-lint commits/.test(shim), "the shim holds no policy of its own");
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-shim-"));
  try {
    writeFileSync(join(dir, "pre-commit"), shim);
    execFileSync("sh", ["-n", join(dir, "pre-commit")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("config: the shim runs `basename \"$0\"`, which is what git actually invokes a hook with", async () => {
  // The whole shim turns on this line resolving correctly. Verified against
  // a real `git commit`, not assumed: git invokes a hook with cwd at the
  // work tree's root and $0 as the hook's own (relative) path, so
  // `basename "$0"` is the hook's name and `git rev-parse --show-toplevel`
  // agrees with cwd. The body writes a marker file rather than printing --
  // a hook is git's grandchild here, and this harness does not reliably
  // see a grandchild's stdout, only its side effects.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-shimrun-")));
  const marker = join(dir, "ran.txt");
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    mkdirSync(join(dir, ".jev-lint", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".jev-lint", "hooks", "pre-commit"), `#!/bin/sh\necho "ran: $(basename "$0")" > "${marker}"\n`, { mode: 0o755 });
    // A real hook script git will find on its own, not one we invoke by hand.
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), hookShim(), { mode: 0o755 });
    writeFileSync(join(dir, "a.txt"), "1\n");
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "a.txt"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "x"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(readFileSync(marker, "utf8"), "ran: pre-commit\n", "the body ran, found through basename \"$0\"");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: the pre-commit body lets a failed request (exit 3) through, and still blocks on a real finding", () => {
  // Exit 3 from jev-lint means the requests failed, not that the commit is
  // clean -- but git fails a hook on any non-zero exit, so without this the
  // hook blocks every commit while the service is down or a key has
  // expired. A stub `npx` on PATH stands in for the network call, so the
  // branch is actually exercised rather than only pattern-matched.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hookrun-"));
  const stub3 = stubNpx(3);
  const stub1 = stubNpx(1);
  try {
    const body = join(dir, "pre-commit");
    writeFileSync(body, initialHook(), { mode: 0o755 });
    assert.equal(runBody(body, dir, stub3), 0, "3 is not a verdict about the commit, so it must not block it");
    assert.equal(runBody(body, dir, stub1), 1, "a real finding at --fail-on still blocks -- the passthrough is not a blanket exit 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stub3, { recursive: true, force: true });
    rmSync(stub1, { recursive: true, force: true });
  }
});

test("config: the pre-commit body's second call (`commits --staged`) has its own exit-3 passthrough, not just the first", () => {
  // The body makes two jev-lint calls. A stub that always exits 3 cannot
  // tell them apart, so this pins the second call down on its own: `review`
  // succeeds clean, then `commits --staged` fails outright.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-hookrun2-"));
  const reviewOkCommitsFails = stubNpxSequence([0, 3]);
  const reviewOkCommitsBlocks = stubNpxSequence([0, 1]);
  try {
    const body = join(dir, "pre-commit");
    writeFileSync(body, initialHook(), { mode: 0o755 });
    assert.equal(runBody(body, dir, reviewOkCommitsFails), 0, "the instructions check failing outright must not block either, on its own exit-3 line");
    assert.equal(runBody(body, dir, reviewOkCommitsBlocks), 1, "and a real finding from the second call still blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(reviewOkCommitsFails, { recursive: true, force: true });
    rmSync(reviewOkCommitsBlocks, { recursive: true, force: true });
  }
});

test("config: the pre-push body lets exit 3 through the same way", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-pushrun-")));
  const remote = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-pushrun-remote-")));
  const stub3 = stubNpx(3);
  const stub1 = stubNpx(1);
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
  try {
    execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "pipe" });
    git(["init", "-q", "-b", "main"]);
    writeFileSync(join(dir, "a"), "1\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "first"]);
    git(["remote", "add", "origin", remote]);
    git(["push", "-q", "-u", "origin", "main"]);
    const body = join(dir, "pre-push-body");
    writeFileSync(body, initialPushHook(), { mode: 0o755 });
    assert.equal(runBody(body, dir, stub3), 0, "3 is not a verdict about the push either");
    assert.equal(runBody(body, dir, stub1), 1, "and a real finding still blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(stub3, { recursive: true, force: true });
    rmSync(stub1, { recursive: true, force: true });
  }
});

/** `init --pre-commit` / `--pre-push` as the terminal runs it, cwd inside a fresh repo. */
async function runInit(argv: string[]): Promise<{ code: number; out: string; log: string }> {
  let out = "";
  let log = "";
  const code = await main(argv, { out: (s) => void (out += `${s}\n`), log: (s) => void (log += `${s}\n`) });
  return { code, out, log };
}

await testAsync("config: init --pre-commit writes the body into the repository and a shim into git's hooks directory", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-init-")));
  const here = process.cwd();
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    process.chdir(dir);
    const bodyPath = join(dir, ".jev-lint", "hooks", "pre-commit");
    const shimPath = join(dir, ".git", "hooks", "pre-commit");

    const fresh = await runInit(["init", "--pre-commit"]);
    assert.equal(fresh.code, 0, fresh.log);
    assert.ok(existsSync(bodyPath), "the body is written into the repository, where it can be reviewed");
    assert.ok(statSync(bodyPath).mode & 0o111, "and it is executable");
    assert.equal(readFileSync(bodyPath, "utf8"), initialHook());
    assert.equal(readFileSync(shimPath, "utf8"), hookShim());
    assert.ok(!/review --staged/.test(readFileSync(shimPath, "utf8")), "the shim holds no policy of its own");
    assert.match(fresh.out, /wrote .*\.jev-lint\/hooks\/pre-commit/);

    // Construct: the body already exists. Without --force, refused and left
    // alone; with --force, overwritten.
    writeFileSync(bodyPath, "#!/bin/sh\necho mine\n");
    const refused = await runInit(["init", "--pre-commit"]);
    assert.equal(refused.code, 2);
    assert.match(refused.log, /already exists; pass --force/);
    assert.equal(readFileSync(bodyPath, "utf8"), "#!/bin/sh\necho mine\n", "left alone without --force");
    const forced = await runInit(["init", "--pre-commit", "--force"]);
    assert.equal(forced.code, 0, forced.log);
    assert.equal(readFileSync(bodyPath, "utf8"), initialHook(), "overwritten with --force");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("config: init --pre-commit fixes a fresh clone -- the body arrived with git, only the shim is missing", async () => {
  // The case the whole feature exists for: a clone has `.jev-lint/hooks/`
  // (tracked, so it came with the clone) but git does not clone its hooks
  // directory, so the shim is missing. Refusing to touch anything just
  // because the body is "already there" would leave the actual job undone.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-clone-")));
  const here = process.cwd();
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    process.chdir(dir);
    const bodyPath = join(dir, ".jev-lint", "hooks", "pre-commit");
    const shimPath = join(dir, ".git", "hooks", "pre-commit");
    mkdirSync(join(dir, ".jev-lint", "hooks"), { recursive: true });
    writeFileSync(bodyPath, initialHook(), { mode: 0o755 }); // as if this arrived via `git clone`
    assert.ok(!existsSync(shimPath), "the shim is never cloned");

    const run = await runInit(["init", "--pre-commit"]);
    assert.equal(run.code, 0, run.log);
    assert.equal(readFileSync(bodyPath, "utf8"), initialHook(), "the body -- someone's tracked file -- is untouched");
    assert.equal(readFileSync(shimPath, "utf8"), hookShim(), "and the missing shim is the thing that gets installed");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("config: a clone with the shim but not yet the body can still commit; init fixes that too", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-noshim-")));
  const here = process.cwd();
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    process.chdir(dir);
    const shimPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(shimPath, hookShim(), { mode: 0o755 });
    const out = execFileSync("sh", [shimPath], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(out.trim(), "", "a missing body exits 0 and says nothing");

    const run = await runInit(["init", "--pre-commit"]);
    assert.equal(run.code, 0, run.log);
    assert.equal(readFileSync(join(dir, ".jev-lint", "hooks", "pre-commit"), "utf8"), initialHook());
    assert.equal(readFileSync(shimPath, "utf8"), hookShim(), "the shim was already ours, so it is left as is, not reported as someone else's");
    assert.ok(!/add this line/.test(run.out), "an already-correct shim is not nagged about");
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

await testAsync("config: init --pre-commit leaves a foreign hook alone and prints the one line to add", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-lint-foreign-")));
  const here = process.cwd();
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "pipe" });
    process.chdir(dir);
    const shimPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(shimPath, "#!/bin/sh\nexec husky-run pre-commit\n", { mode: 0o755 });

    const run = await runInit(["init", "--pre-commit"]);
    assert.equal(run.code, 0, run.log);
    assert.equal(readFileSync(shimPath, "utf8"), "#!/bin/sh\nexec husky-run pre-commit\n", "not this tool's file to overwrite silently");
    assert.match(run.out, /already exists and was left alone; add this line to it/);
    assert.match(run.out, /\.jev-lint\/hooks\/pre-commit/);

    // --force replaces even a foreign shim: it is the one blanket override
    // this command has, and the body's own --force already means the same
    // "yes, replace it" for the file next to it.
    const forced = await runInit(["init", "--pre-commit", "--force"]);
    assert.equal(forced.code, 0, forced.log);
    assert.equal(readFileSync(shimPath, "utf8"), hookShim());
  } finally {
    process.chdir(here);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: the file init writes is valid, names the files and every shipped rule, and nothing else is set", () => {
  // A starter config that errors, or that silently changes behaviour, is worse
  // than none. Since 0.5 a config selects its rules, so the starter lists
  // every shipped id turned on -- a reader deletes what they do not want --
  // and every other setting commented with its default.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const text = initialConfig(["fn-name-promises", "comment-describes-block"]);
    const { config, errors } = loadConfig(writeConfig(dir, text));
    assert.deepEqual(errors, [], "the shipped starter config must parse clean");
    assert.deepEqual(config, { files: ["src"], rules: { "fn-name-promises": { enabled: true }, "comment-describes-block": { enabled: true } } });
    assert.match(text, /apiKeyEnv/, "and it must say where the key goes");
    assert.ok(!/^\s*apiKey:/m.test(text), "and never suggest putting the key in it");
    assert.match(text, /\.jev-lint\/rules/, "and says where a rule of one's own goes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
