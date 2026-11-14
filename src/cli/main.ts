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
import { cmdScan } from "./cmd-scan.ts";
import { resolveContext } from "./context.ts";
import { cmdEval } from "./cmd-eval.ts";
import { cmdInit } from "./cmd-init.ts";
import { cmdReplay } from "./cmd-replay.ts";
import { cmdRules } from "./cmd-rules.ts";
import { selectForRun, loadOrDie } from "./select.ts";
import { cmdArtifact } from "./cmd-artifact.ts";
import { cmdScope } from "./cmd-scope.ts";
import { doctor } from "../doctor.ts";
import { resolveTargets } from "./targets.ts";
import { cmdDocs } from "./cmd-docs.ts";
import { cmdIntrospect } from "./cmd-introspect.ts";

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

  if (opts.initIntrospect) {
    if (command !== "init" || opts.preCommit || opts.prePush) { log("--introspect is an init mode and cannot be combined with hook installation"); return 2; }
    const target = opts.config && opts.config !== "none" ? opts.config : null;
    if (target && opts.output) { log("choose --config or --output for the new configuration path"); return 2; }
    return cmdIntrospect({ ...opts, config: null, output: opts.output ?? target, introspectWrite: opts.introspectWrite || !opts.dryRun }, out, log, client);
  }
  if (command === "init") return cmdInit(opts, out, log);
  if (command === "docs") return cmdDocs(opts, out, log, client);
  if (command === "introspect") return cmdIntrospect(opts, out, log, client);
  if (command === "baseline" || command === "report") return cmdArtifact(command, opts, out, log);
  if (opts.format === "sarif" && (opts.dryRun || !["check", "review", "run", "scan", "replay"].includes(command))) { log("SARIF supports check, review, scan and replay results; use JSON for plans"); return 2; }

  const context = resolveContext(opts, rest, log);
  if (!context) return 2;
  const { config, configPath, baseDir, argPaths, cachePath } = context;
  if (command === "doctor") {
    const selected = loadOrDie(opts, log, baseDir, configPath !== null); if (!selected) return 2;
    const report = doctor({ rules: selected.rules, languages: opts.languages });
    if (opts.format === "json") out(JSON.stringify(report, null, 2));
    else for (const check of report.checks) out(`${check.id}: ${check.status}${check.remediation ? `; ${check.remediation}` : ""}`);
    return report.status === "complete" ? 0 : 3;
  }

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
  if (opts.explainScope) return cmdScope(command, rules, opts, out, log);
  if (opts.format === "sarif" && command === "commits") { log("commit subjects have no file locations; use JSON"); return 2; }
  if (command === "scan") return cmdScan(rules, opts, cachePath, out, log, client);

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
