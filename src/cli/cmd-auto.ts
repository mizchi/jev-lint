import { findConfig } from "../config.ts";
import { readFileSync } from "node:fs";
import { API_KEY_SETUP, API_KEY_VARS, fromEnv, type AskClient } from "../jev.ts";
import { FREE_DECIDER, OPENROUTER_JEV } from "../openrouter.ts";
import { createModelClient, modelSpec } from "../model.ts";
import { prepareIntrospection, introspect, introspectionConfig, INTROSPECTION_DEFAULT_EXCLUDES, type IntrospectionReport } from "../introspection.ts";
import { loadRules, ruleSources } from "../rules.ts";
import { isGitSubject, type Rule } from "../types.ts";
import type { Options, Log } from "./args.ts";
import type { Context } from "./context.ts";
import { cmdCheck } from "./cmd-check.ts";
import { cmdScope } from "./cmd-scope.ts";
import { loadOrDie } from "./select.ts";
import { resolveTargets } from "./targets.ts";
import { explainScope } from "../scope.ts";
import { lintSample, MAX_LINT_BYTES, MAX_LINT_FILES, starterSample } from "./starter-sample.ts";
import { confirmExecution, type Confirm } from "./confirm.ts";

const key = (rule: Rule) => rule.languageDir ? `${rule.languageDir}/${rule.id}` : rule.id;

function phaseClient(client: AskClient): AskClient {
  const before = { ...client.spent };
  return {
    get model() { return client.model; },
    get servedModel() { return client.servedModel; },
    get spent() {
      const now = client.spent;
      return { ...now, calls: now.calls - before.calls, inputTokens: now.inputTokens - before.inputTokens,
        outputTokens: (now.outputTokens ?? 0) - (before.outputTokens ?? 0), usd: now.usd - before.usd, ms: now.ms - before.ms,
        retried: (now.retried ?? 0) - (before.retried ?? 0), rateLimited: (now.rateLimited ?? 0) - (before.rateLimited ?? 0), splits: (now.splits ?? 0) - (before.splits ?? 0) };
    },
    askSplitting: (state, questions) => client.askSplitting(state, questions),
  };
}

export async function cmdAuto(opts: Options, context: Context, out: Log, log: Log, client: AskClient | null, confirm?: Confirm): Promise<number> {
  try {
    if (opts.introspectWrite || opts.output || opts.replay || opts.staged || opts.base || opts.file || opts.squash || opts.message !== null
      || opts.accept || opts.acceptLast || opts.compare || opts.preCommit || opts.prePush) {
      log("auto: use check options; use introspect or init --introspect to create configuration"); return 2;
    }
    const confirmation = (message: string) => opts.dryRun || opts.explainScope
      ? null : confirmExecution(opts, client, out, log, confirm, message);
    if (context.configPath) {
      const selected = loadOrDie(opts, log, context.baseDir, true);
      if (!selected) return 2;
      if (opts.explainScope) return cmdScope("check", selected.rules, opts, out, log);
      const targets = await resolveTargets("check", selected.rules, opts, undefined, out, log);
      if ("exit" in targets) return targets.exit;
      const policy = readFileSync(context.configPath, "utf8");
      const spec = modelSpec(opts.model);
      const stopped = await confirmation(`Run ${selected.rules.length} configured rule(s) for ${targets.paths.join(", ")}? This may send source to ${spec.provider} (${spec.model}).`);
      if (stopped !== null) return stopped;
      if (readFileSync(context.configPath, "utf8") !== policy) { log("auto: configuration changed during confirmation; check did not run"); return 3; }
      return cmdCheck(selected.rules, targets, opts, context.cachePath, out, log, client);
    }

    const spec = modelSpec(opts.model);
    const freeCommand = `npx -y jev-lint --model openrouter:${FREE_DECIDER}`;
    const guidance = [
      "Free trial: set OPENROUTER_API_KEY from https://openrouter.ai/keys, then run",
      freeCommand,
      "",
      "For regular use and CI, we strongly recommend Jev with TYPESAFE_API_KEY.",
      API_KEY_SETUP,
    ].join("\n");
    if (!opts.dryRun && !opts.explainScope && !client && (!spec.keyAvailable || (spec.implicitOpenRouter && !fromEnv(API_KEY_VARS)))) {
      log(guidance);
      if (spec.implicitOpenRouter) log("OPENROUTER_API_KEY is set. Choose the free command above, or unset it to use Jev directly.");
      if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-auto-1", status: "setup-required", freeCommand, introspection: null, check: null }));
      return 3;
    }

    if (!client && spec.implicitOpenRouter && !opts.dryRun && !opts.explainScope) log(guidance);
    const sources = opts.rules.length ? opts.rules : ruleSources(context.baseDir);
    const free = spec.provider === "openrouter" && spec.model === FREE_DECIDER;
    const core = new Set(["fn-name-promises", "test-name-verifies-claim", "agent-instruction-is-unclear", "agent-instructions-conflict"]);
    const load = () => {
      const loaded = loadRules(sources, opts.languages);
      if (loaded.errors.length || !loaded.rules.length) throw new Error(`automatic selection requires a valid rule catalog: ${loaded.errors.join("; ")}`);
      return loaded.rules.filter(rule => !isGitSubject(rule.subject) && (opts.rules.length > 0 || core.has(rule.id)));
    };
    const catalog = load(), roots = opts.paths.length ? opts.paths : ["."];
    const exclude = [...new Set([...INTROSPECTION_DEFAULT_EXCLUDES, ...opts.exclude])];
    const sample = starterSample(roots, exclude);
    if (!sample.files.length) {
      log("No eligible tracked files in the requested paths. Run in a Git project with tracked source files.");
      if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-auto-1", status: "incomplete", introspection: null, check: null }));
      return 3;
    }
    if (opts.explainScope) return cmdScope("check", catalog, { ...opts, paths: sample.files, exclude }, out, log);
    const prepare = (tracked: typeof sample, rules: Rule[]) => prepareIntrospection({ paths: tracked.files, rules, exclude, languages: opts.languages, omittedTrackedFiles: tracked.omitted });
    const input = prepare(sample, catalog);
    const sampleInfo = { selected: sample.files.length, omitted: sample.omitted, pathBytes: sample.pathBytes };
    if (opts.dryRun) {
      out(JSON.stringify({ schema: "jev-lint-auto-plan-1", input, sample: sampleInfo, modelRequests: 0, check: null, qualityVerdict: "UNREVIEWED" }, null, 2));
      return input.issues.length ? 3 : 0;
    }
    const incomplete = (message: string, report: IntrospectionReport | null = null) => {
      log(`auto: ${message}; check did not run`);
      if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-auto-1", status: "incomplete", input, introspection: report, check: null }, null, 2));
      return 3;
    };
    if (input.issues.length) return incomplete(`incomplete project inventory (${input.issues.map((issue) => `${issue.path}: ${issue.code}`).join(", ")})`);
    const selectionModel = spec.provider === "openrouter" && !free ? `openrouter:${OPENROUTER_JEV}` : opts.model;
    const selectionSpec = modelSpec(selectionModel);
    const unchanged = () => {
      if (opts.config !== "none" && findConfig() !== null) return false;
      const current = starterSample(roots, exclude);
      return current.files.length > 0 && prepare(current, load()).snapshotDigest === input.snapshotDigest;
    };
    if (sample.omitted) log(`Using ${sample.files.length} tracked files; omitted ${sample.omitted} from this sample.`);
    const action = `print the starter YAML and check up to ${MAX_LINT_FILES} files (${MAX_LINT_BYTES / 1024} KiB total) with ${spec.provider} (${spec.model}), sending source`;
    const stopped = await confirmation(`Select starter rules from ${sample.files.length} tracked filenames using ${selectionSpec.provider} (${selectionSpec.model}), then ${action}?`);
    if (stopped !== null) return stopped;
    if (!unchanged()) return incomplete("project inventory or rule catalog changed during confirmation");
    const budget = { maxRequests: 8, maxInputTokens: 32000, maxUsd: 0.05, maxMs: 120000 };
    const report = await introspect(input, { client: client ?? createModelClient({ model: selectionModel, baseUrl: spec.provider === "openrouter" ? null : opts.baseUrl,
      budget, beforeSend: async () => { if (!unchanged()) throw new Error("project inventory or rule catalog changed"); },
    }), snapshotCheck: unchanged });
    if (report.status !== "complete" || report.snapshotChanged) return incomplete("rule selection is incomplete or stale", report);
    const enabled = new Set(report.decisions.filter((d) => d.judgment?.choice === "enable").map((d) => d.key));
    const rules = catalog.filter((rule) => enabled.has(key(rule)));
    if (!rules.length) return incomplete("no starter rule was selected", report);
    const starterConfig = introspectionConfig(report, input, { paths: roots });
    if (opts.format === "pretty") out(starterConfig);
    else if (opts.format !== "json") log(starterConfig);
    if (!unchanged()) return incomplete("project inventory or rule catalog changed before checking", report);
    const eligible = explainScope({ paths: sample.files, rules, exclude, languages: opts.languages })
      .files.filter(file => file.reason === "eligible").map(file => file.path);
    const paths = lintSample(eligible);
    const stopAfterProposal = (message: string) => {
      log(message);
      if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-auto-1", status: "incomplete", sample: sampleInfo, starterConfig, introspection: report, check: null }));
      return 3;
    };
    if (!paths.length) return stopAfterProposal("No eligible tracked source fits the starter lint size limits.");
    if (rules.some(rule => (opts.arm ?? rule.state) === "paired")) return stopAfterProposal("Paired checks require additional files. Run check with the proposed config.");
    if (!opts.quiet) log(`auto: selected ${rules.map(key).join(", ")}; checking ${paths.join(", ")}`);
    let checked: unknown = null;
    const checkOut = opts.format === "json" ? (text: string) => { checked = JSON.parse(text); } : out;
    const code = await cmdCheck(rules, { paths, diffRanges: null, commitsRange: null }, { ...opts, paths, exclude: input.exclude },
      context.cachePath, checkOut, log, client ? phaseClient(client) : createModelClient({ model: opts.model, baseUrl: opts.baseUrl,
        budget: { ...budget, maxRequests: 4, maxInputTokens: 8192 },
        beforeSend: async () => {
          if (lintSample(paths).length !== paths.length || !unchanged()) throw new Error("starter lint sample changed");
        },
      }));
    if (opts.format === "json") out(JSON.stringify({ schema: "jev-lint-auto-1", status: code <= 1 ? "complete" : "incomplete", sample: { ...sampleInfo, lintFiles: paths }, starterConfig, introspection: report, check: checked }, null, 2));
    return code;
  } catch (error) { log(`auto: ${(error as Error).message}`); return 2; }
}
