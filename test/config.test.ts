import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConfig, findConfig, initialConfig, initialHook, initialPushHook, loadConfig } from "../src/config.ts";
import { blocks } from "../src/gate.ts";
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
