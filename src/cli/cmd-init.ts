/**
 * `jev-lint init`: a starter config, or a git hook.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_NAMES, hookShim, initialConfig, initialHook, initialPushHook } from "../config.ts";
import { API_KEY_VARS, fromEnv } from "../jev.ts";
import { loadRules, shippedRulesPath } from "../rules.ts";
import type { Options, Log } from "./args.ts";

/**
 * `jev-lint init`: write a config to start from.
 *
 * Refuses to overwrite without `--force`, because the file it would replace is
 * the one holding someone's calibrated cutoffs.
 */
export function cmdInit(opts: Options, out: Log, log: Log): number {
  if (opts.preCommit) return cmdInitHook(opts, out, log, "pre-commit");
  if (opts.prePush) return cmdInitHook(opts, out, log, "pre-push");
  const target = opts.config && opts.config !== "none" ? opts.config : CONFIG_NAMES[0];
  if (existsSync(target) && !opts.force) {
    log(`${target} already exists; pass --force to overwrite it`);
    return 2;
  }
  // The starter lists every shipped rule, on: the catalogue, to prune.
  const shippedDir = shippedRulesPath();
  const keys = shippedDir ? loadRules([shippedDir]).rules.map((r) => r.languageDir ? `${r.languageDir}/${r.id}` : r.id).sort() : [];
  try {
    writeFileSync(target, initialConfig(keys));
  } catch (err: unknown) {
    log(`could not write ${target}: ${String(err).slice(0, 160)}`);
    return 2;
  }

  if (opts.format === "json") {
    out(JSON.stringify({ wrote: target, keySet: fromEnv(API_KEY_VARS) !== null }, null, 2));
    return 0;
  }
  out(`wrote ${target}`);
  out("");
  const key = fromEnv(API_KEY_VARS);
  if (key) {
    out(`${API_KEY_VARS[0]} is set. Next:`);
  } else {
    out(`Set your API key, then run:`);
    out(`  export ${API_KEY_VARS[0]}=...`);
  }
  out(`  npx jev-lint check src --dry-run   # what it would ask, and the price`);
  out(`  npx jev-lint check src             # ask it`);
  out("");
  out("Every shipped rule is enabled in the file; remove or turn off those you do not want.");
  out("The shipped rules' cutoffs were fitted to this");
  out("package's own corpus -- see `jev-lint gaps` and `jev-lint calibrate`");
  out("before trusting them on your code.");
  return 0;
}

/**
 * `init --pre-commit` / `init --pre-push`: write the hook's body into the
 * repository and a shim into git's own hooks directory.
 *
 * Both paths are asked of git rather than assumed (`.git/hooks` for the
 * shim, the working tree's root for the body), because a worktree's hooks
 * live in the main repository and `core.hooksPath` can move them anywhere.
 *
 * The body and the shim are overwritten independently, not as one
 * all-or-nothing write, because the most common case this command has to
 * handle is a fresh clone of a repository that already commits its body:
 * `.jev-lint/hooks/<name>` arrived with the clone, `<git hooks dir>/<name>`
 * did not, and refusing to act just because the body is "already there"
 * would leave the one thing `init` is for -- installing the shim -- undone.
 * So: the **body** is written when it is missing, or with `--force`; the
 * **shim** is written when it is missing, or with `--force`. When neither
 * can be written -- both already there, no `--force` -- that is the one
 * refusal. An existing shim that is not written is reported two different
 * ways depending on what it holds: one already exactly ours needs nothing
 * said beyond that; anything else is presumed to be husky's or a task
 * runner's, and the right move there is one line added to it, which is
 * printed rather than silently overwritten.
 */
export function cmdInitHook(opts: Options, out: Log, log: Log, which: "pre-commit" | "pre-push"): number {
  let hooksDir: string;
  let root: string;
  try {
    // git's own "not a git repository" is caught and reworded below.
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    log(`not inside a git repository, so there is nowhere to put a ${which} hook`);
    return 2;
  }
  const bodyDir = join(root, ".jev-lint", "hooks");
  const body = join(bodyDir, which);
  const shimPath = join(hooksDir, which);
  const relBody = `.jev-lint/hooks/${which}`;

  const bodyExists = existsSync(body);
  const shimExists = existsSync(shimPath);
  // Only for the message below: an existing shim that already matches ours
  // exactly is not "someone else's hook" to warn about, just nothing left
  // to do -- distinct from *whether* to write it, which stays plain
  // exists-or-not so re-running with nothing changed still refuses.
  const shimIsOurs = shimExists && (() => {
    try {
      return readFileSync(shimPath, "utf8") === hookShim();
    } catch {
      return false;
    }
  })();
  // `--force` is about the body, which is ours and which someone may have
  // hand-edited. It deliberately does NOT reach the shim: git's hooks
  // directory is shared, the file there is as likely to be husky's or a task
  // runner's as ours, and `--force` on a command whose subject is the body
  // is not consent to replace somebody else's hook. A shim that is ours is
  // rewritten anyway -- identical bytes, nothing to warn about -- and one
  // that is neither ours nor absent gets the line to add printed instead.
  // Taking it over is a deletion the person does themselves.
  const writeBody = !bodyExists || opts.force;
  // The shim is written when it is missing, and otherwise not at all. One
  // that is already ours needs nothing; one that is not is as likely to be
  // husky's or a task runner's as anything, and `--force` deliberately does
  // not reach it -- the flag's subject is the body, this tool's own file,
  // and someone refreshing that has not consented to losing another tool's
  // hook. Taking the shim over is a deletion they do themselves.
  const writeShim = !shimExists;

  if (!writeBody && !writeShim) {
    log(`${body} already exists; pass --force to overwrite it`);
    return 2;
  }

  try {
    if (writeBody) {
      mkdirSync(bodyDir, { recursive: true });
      writeFileSync(body, which === "pre-commit" ? initialHook() : initialPushHook(), { mode: 0o755 });
    }
    if (writeShim) {
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(shimPath, hookShim(), { mode: 0o755 });
    }
  } catch (err: unknown) {
    log(`could not write ${writeBody ? body : shimPath}: ${String(err).slice(0, 160)}`);
    return 2;
  }

  if (opts.format === "json") {
    out(JSON.stringify({ wrote: writeBody ? body : null, shim: writeShim ? shimPath : null, hook: which }, null, 2));
    return 0;
  }
  if (writeBody) {
    out(`wrote ${body}`);
  } else {
    out(`${body} already exists; left as is (pass --force to overwrite it)`);
  }
  if (writeShim) {
    out(writeBody ? `and ${shimPath}, which finds and runs it` : `wrote ${shimPath}, which finds and runs it`);
  } else if (shimIsOurs) {
    out(`${shimPath} already points at it`);
  } else {
    out(`${shimPath} already exists and was left alone; add this line to it:`);
    out(`  "$(git rev-parse --show-toplevel)"/${relBody}`);
  }
  out("");
  out("The hook itself is tracked in the repository, so it is reviewed like");
  out("any other file; git's own copy is a shim that finds it and exits 0");
  out("silently when it is not there -- a clone that has the shim before it");
  out("has the body can still commit.");
  out("");
  if (which === "pre-commit") {
    out("It reviews the staged diff and judges it against AGENTS.md (CLAUDE.md fallback)");
    out("on every commit, prints what it finds, and blocks only on a rule with");
    out("`severity: error` -- no shipped rule has it. With no API key in the");
    out("environment, or a request that fails outright, it steps aside. Skip it");
    out("once with `git commit --no-verify`; remove it by deleting the body.");
  } else {
    out("It judges the commits not yet on the upstream -- does each message");
    out("describe its diff -- prints what it finds, and blocks only on a rule");
    out("with `severity: error`. With no API key, no upstream yet, or a");
    out("request that fails outright, it steps aside. Skip it once with");
    out("`git push --no-verify`; remove it by deleting the body.");
  }
  return 0;
}
