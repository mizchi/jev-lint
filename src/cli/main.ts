/**
 * The command line's entry: parse, find the config, pick the command.
 *
 * Each command is its own module; this is only the order they happen in.
 * `check`, `review` and `commits` share one path -- select the rules,
 * resolve the targets, run -- and the rest take the options as parsed.
 */
import { readFileSync } from "node:fs";
import { precommitRules } from "../config.ts";
import { parseArgs, USAGE, type Deps, type Log } from "./args.ts";
import { cmdCalibrate, cmdGaps } from "./cmd-calibrate.ts";
import { cmdCheck } from "./cmd-check.ts";
import { resolveContext } from "./context.ts";
import { cmdEval } from "./cmd-eval.ts";
import { cmdInit } from "./cmd-init.ts";
import { cmdReplay } from "./cmd-replay.ts";
import { cmdRules } from "./cmd-rules.ts";
import { selectForRun } from "./select.ts";
import { resolveTargets } from "./targets.ts";

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  let command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "check";
  const rest = argv[0] && !argv[0].startsWith("-") ? argv.slice(1) : argv;
  let opts;
  try {
    // The terminal decides the colour default, not the parser.
    opts = parseArgs(rest, { color: process.stdout.isTTY === true && !process.env.NO_COLOR });
  } catch (err: unknown) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.messageFile !== null) {
    // `-` is stdin, so `gh pr view --json title,body -q ... | jev-lint
    // commits --squash --message-file -` needs no temporary file.
    try {
      opts.message = readFileSync(opts.messageFile === "-" ? 0 : opts.messageFile, "utf8");
    } catch (err: unknown) {
      process.stderr.write(`--message-file ${opts.messageFile}: ${(err as Error).message}\n`);
      return 2;
    }
  }
  if (opts.help || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const log: Log = deps.log ?? ((s) => process.stderr.write(`${s}\n`));
  const out: Log = deps.out ?? ((s) => process.stdout.write(`${s}\n`));
  const client = deps.client ?? null;
  if (opts.deprecatedAt) log("warning: --at is deprecated; use --threshold");

  if (command === "init") return cmdInit(opts, out, log);

  const context = resolveContext(opts, rest, log);
  if (!context) return 2;
  const { config, configPath, baseDir, argPaths, cachePath } = context;

  if (command === "rules") return cmdRules(opts, out, log, baseDir);
  if (command === "replay") return cmdReplay(opts, out, log);
  if (command === "eval") return cmdEval({ ...opts, paths: argPaths }, out, log, client, baseDir);

  if (opts.staged && (command === "review" || command === "commits") && config.hooks?.precommit) {
    opts.ruleSettings = precommitRules(config);
    if (!opts.quiet) log(`using hooks.precommit rules (${config.hooks.precommit.extends ? "extends" : "independent"})`);
  }

  const selected = selectForRun(command, opts, config, argPaths, log, baseDir, configPath !== null);
  if (!selected) return 2;
  const { rules, rangeArg } = selected;
  command = selected.command;

  if (command === "commits" && opts.staged && config.hooks?.precommit && !rules.some((rule) => rule.subject === "change")) {
    if (!opts.quiet) log("hooks.precommit: no subject: change rule selected; skipping commits --staged");
    return 0;
  }

  const targets = await resolveTargets(command, rules, opts, rangeArg, out, log);
  if ("exit" in targets) return targets.exit;
  const { paths, diffRanges } = targets;

  if (command === "gaps") return cmdGaps({ rules, paths, diffRanges, opts, cachePath, client, out, log });
  if (command === "calibrate") return cmdCalibrate({ rules, paths, diffRanges, opts, cachePath, client, out, log });
  if (command !== "check" && command !== "review" && command !== "commits") {
    log(`unknown command \`${command}\``);
    process.stderr.write(USAGE);
    return 2;
  }
  return cmdCheck(rules, targets, opts, cachePath, out, log, client);
}
