import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_NAMES } from "../config.ts";
import { loadRules, ruleSources } from "../rules.ts";
import { Jev, type AskClient } from "../jev.ts";
import { prepareIntrospection, introspect, parseIntrospectionReport, introspectionConfig, INTROSPECTION_DEFAULT_EXCLUDES, type IntrospectionReport } from "../introspection.ts";
import { isExcludedBy } from "../files.ts";
import type { Options, Log } from "./args.ts";

export async function cmdIntrospect(opts: Options, out: Log, log: Log, client: AskClient | null): Promise<number> {
  try {
    if (!["pretty", "json"].includes(opts.format) || opts.paths.length > 1 || opts.replay && opts.paths.length !== 1
      || opts.replay && (opts.dryRun || opts.record) || opts.dryRun && (opts.record || opts.introspectWrite)
      || opts.output && !opts.introspectWrite && !opts.dryRun || opts.force || opts.config) throw new Error("use introspect [directory] [--write --output <new.yaml>], --dry-run, or --replay <record.json> in the project directory");
    const cwd = resolve(opts.replay ? "." : opts.paths[0] ?? ".");
    if (!lstatSync(cwd).isDirectory() || lstatSync(cwd).isSymbolicLink()) throw new Error("introspect requires a regular project directory");
    const target = opts.output ? resolve(opts.output) : resolve(cwd, CONFIG_NAMES[0]);
    if (opts.introspectWrite && (existsSync(target) || !opts.output && CONFIG_NAMES.some((name) => existsSync(resolve(cwd, name))))) throw new Error("a config already exists; use --output with a new path to review a proposal");
    const record = opts.replay ? resolve(opts.paths[0]) : opts.record ? resolve(opts.record) : null;
    if (record === target) throw new Error("the record and configuration must have different paths");
    if (record && !opts.replay && existsSync(record)) {
      let isRecord = false;
      try { isRecord = !lstatSync(record).isSymbolicLink() && JSON.parse(readFileSync(record, "utf8")).schema === "jev-lint-introspection-1"; } catch { /* Source text must not become a parse-error excerpt. */ }
      if (!isRecord) throw new Error("a record must not overwrite a project source");
    }
    const excluded = [...opts.exclude];
    for (const output of [record, opts.output ? target : null]) if (output) {
      const path = relative(cwd, output).split(sep).join("/");
      if (path && path !== ".." && !path.startsWith("../") && ![...INTROSPECTION_DEFAULT_EXCLUDES, ...excluded].some((entry) => isExcludedBy(path, entry))) excluded.push(path);
    }
    const sources = opts.rules.length ? opts.rules : ruleSources(cwd);
    const prepare = () => {
      const loaded = loadRules(sources, opts.languages);
      if (loaded.errors.length || !loaded.rules.length) throw new Error("introspection requires a valid nonempty rule catalog");
      return prepareIntrospection({ cwd, rules: loaded.rules, exclude: excluded, languages: opts.languages });
    };
    const input = prepare();
    if (opts.dryRun) {
      out(JSON.stringify({ schema: "jev-lint-introspection-plan-1", input, modelRequests: 0, qualityVerdict: "UNREVIEWED" }, null, 2));
      return input.issues.length ? 3 : 0;
    }
    let report: IntrospectionReport;
    if (opts.replay) {
      try { report = parseIntrospectionReport(JSON.parse(readFileSync(record!, "utf8")), input); }
      catch { log("introspection record is invalid or stale; run introspect --record again"); return 3; }
    } else {
      const unchanged = () => prepare().snapshotDigest === input.snapshotDigest;
      report = await introspect(input, { client: client ?? new Jev({ model: opts.model, baseUrl: opts.baseUrl,
        budget: { maxRequests: 32, maxInputTokens: 400000, maxUsd: 0.05, maxMs: 300000 },
        beforeSend: async () => { if (!unchanged()) throw new Error("project inventory or rule catalog changed"); },
      }), snapshotCheck: unchanged });
      if (record) {
        mkdirSync(dirname(record), { recursive: true }); const temporary = `${record}.${randomUUID()}.tmp`;
        try { writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, record); }
        finally { rmSync(temporary, { force: true }); }
      }
    }
    if (opts.format === "json") out(JSON.stringify(report, null, 2));
    else {
      for (const decision of report.decisions) {
        const candidate = input.candidates.find((c) => c.key === decision.key)!;
        out(`${decision.judgment?.choice ?? "no-verdict"}: ${decision.key} (${candidate.command}; ${candidate.eligibleFiles} eligible files)`);
        out(`  ${candidate.ask}`);
        if (candidate.examples.length) out(`  examples: ${candidate.examples.join(", ")}`);
      }
      for (const issue of input.issues) out(`${issue.path}: ${issue.code}`);
      out(`${report.coverage.enabled} enabled; ${report.coverage.deferred} deferred; ${report.coverage.missing} missing; ${report.status}; UNREVIEWED`);
      if (report.status === "complete" && report.coverage.enabled) out(introspectionConfig(report, input));
    }
    if (report.status !== "complete" || report.snapshotChanged || opts.introspectWrite && !report.coverage.enabled) return 3;
    if (opts.introspectWrite) {
      if (prepare().snapshotDigest !== input.snapshotDigest) { log("project inventory changed before writing; no config created"); return 3; }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, introspectionConfig(report, input), { flag: "wx", mode: 0o644 });
      log(`wrote ${target}; verify from ${cwd} with check --dry-run --cache none using --config ${target}`);
    }
    return 0;
  } catch (error) { log(`introspect: ${(error as Error).message}`); return 2; }
}
