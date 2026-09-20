import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConfig, findConfig, initialConfig, initialHook, initialPushHook, loadConfig } from "../src/config.ts";
import { blocks } from "../src/gate.ts";
import { test, testAsync, configurable } from "./helpers.ts";

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
        "rules: my-rules",
        "paths: [src, lib]",
        "exclude: [src/fixtures]",
        "cache: none",
        "model: jev-1.13.0",
        "baseUrl: https://proxy.example/v1",
        "apiKeyEnv: MY_KEY",
        "group: rule",
        "arm: bare",
        "concurrency: 2",
        "retry: 3",
        "unsureBelow: 0.4",
        "at:",
        "  fn-name-promises: 0.8",
      ].join("\n"),
    );
    const { config, errors } = loadConfig(p);
    assert.deepEqual(errors, []);
    assert.deepEqual(config.rules, ["my-rules"], "a bare string becomes a one-item list");
    assert.deepEqual(config.paths, ["src", "lib"]);
    assert.deepEqual(config.exclude, ["src/fixtures"]);
    assert.equal(config.cache, null, "`none` disables the cache");
    // `applyConfig` publishes `baseUrl` to the environment for the client
    // to find; apply only the setting under test so nothing leaks past this test.
    const opts = configurable();
    applyConfig(opts, { exclude: config.exclude }, new Set());
    assert.deepEqual(opts.exclude, ["src/fixtures"]);
    const flagged = configurable({ exclude: ["other"] });
    applyConfig(flagged, { exclude: config.exclude }, new Set(["--exclude"]));
    assert.deepEqual(flagged.exclude, ["other"], "the flag wins over the file");
    assert.equal(config.baseUrl, "https://proxy.example/v1");
    assert.equal(config.group, "rule");
    assert.equal(config.arm, "bare");
    assert.equal(config.retry, 3);
    assert.equal(config.unsureBelow, 0.4);
    assert.deepEqual(config.at, { "fn-name-promises": 0.8 });
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
    assert.match(loadConfig(writeConfig(dir, "at: [1, 2]\n")).errors[0]!, /mapping of rule id/);
    assert.match(loadConfig(writeConfig(dir, "at:\n  r: yes\n")).errors[0]!, /must be a number/);
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

test("config: per-rule cutoffs merge, so a flag overrides one and keeps the rest", () => {
  const opts = configurable({ at: { "fn-name-promises": 0.5 } });
  applyConfig(opts, { at: { "fn-name-promises": 0.99, "var-name-describes-value": 0.42 } }, new Set(["--at"]));
  assert.deepEqual(opts.at, { "fn-name-promises": 0.5, "var-name-describes-value": 0.42 });
});

test("config: naming the rules in the file means they are not the packaged ones", () => {
  // Otherwise the run would announce that it fell back to the packaged packs
  // while actually using the project's, which is the confusing half of both.
  const opts = configurable({ rules: ["/pkg/rules"], rulesAreShipped: true });
  applyConfig(opts, { rules: ["my-rules"] }, new Set());
  assert.deepEqual(opts.rules, ["my-rules"]);
  assert.equal(opts.rulesAreShipped, false);
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

test("config: the file init writes is valid, and sets nothing until uncommented", () => {
  // A starter config that errors, or that silently changes behaviour, is worse
  // than none.
  const dir = mkdtempSync(join(tmpdir(), "jev-lint-cfg-"));
  try {
    const { config, errors } = loadConfig(writeConfig(dir, initialConfig()));
    assert.deepEqual(errors, [], "the shipped starter config must parse clean");
    assert.deepEqual(config, {}, "and change nothing until a line is uncommented");
    assert.match(initialConfig(), /apiKeyEnv/, "and it must say where the key goes");
    assert.ok(!/^\s*apiKey:/m.test(initialConfig()), "and never suggest putting the key in it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
