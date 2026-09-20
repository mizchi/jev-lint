/**
 * `jev-lint init`: a starter config, or a git hook.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_NAMES, initialConfig, initialHook, initialPushHook } from "../config.ts";
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
  const ids = shippedDir ? [...new Set(loadRules([shippedDir]).rules.map((r) => r.id))].sort() : [];
  try {
    writeFileSync(target, initialConfig(ids));
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
  out("Everything in the file is commented out, so it changes nothing until you");
  out("uncomment a line. The shipped rules' cutoffs were fitted to this");
  out("package's own corpus -- see `jev-lint gaps` and `jev-lint calibrate`");
  out("before trusting them on your code.");
  return 0;
}

/**
 * `init --pre-commit`: write the hook into the repository's hooks directory.
 *
 * Asked of git rather than assumed to be `.git/hooks`, because a worktree's
 * hooks live in the main repository and `core.hooksPath` can move them
 * anywhere. An existing hook is never overwritten without `--force`: it is
 * probably husky's or a task runner's, and the right move there is one line
 * added to it, which is printed.
 */
export function cmdInitHook(opts: Options, out: Log, log: Log, which: "pre-commit" | "pre-push"): number {
  let hooksDir: string;
  try {
    // git's own "not a git repository" is caught and reworded below.
    hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    log(`not inside a git repository, so there is nowhere to put a ${which} hook`);
    return 2;
  }
  const target = join(hooksDir, which);
  const line =
    which === "pre-commit"
      ? "npx -y jev-lint review --staged --fail-on error"
      : "npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error";
  if (existsSync(target) && !opts.force) {
    log(`${target} already exists; pass --force to overwrite it, or add this line to it:`);
    log(`  ${line}`);
    return 2;
  }
  try {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(target, which === "pre-commit" ? initialHook() : initialPushHook(), { mode: 0o755 });
  } catch (err: unknown) {
    log(`could not write ${target}: ${String(err).slice(0, 160)}`);
    return 2;
  }
  if (opts.format === "json") {
    out(JSON.stringify({ wrote: target, hook: which }, null, 2));
    return 0;
  }
  out(`wrote ${target}`);
  out("");
  if (which === "pre-commit") {
    out("It reviews the staged diff on every commit, prints what it finds, and");
    out("blocks only on a rule with `severity: error` -- no shipped rule has it.");
    out("With no API key in the environment it steps aside. Skip it once with");
    out("`git commit --no-verify`; remove it by deleting the file.");
  } else {
    out("It judges the commits not yet on the upstream -- does each message");
    out("describe its diff -- prints what it finds, and blocks only on a rule");
    out("with `severity: error`. With no API key, or no upstream yet, it steps");
    out("aside. Skip it once with `git push --no-verify`; remove it by deleting the file.");
  }
  return 0;
}
