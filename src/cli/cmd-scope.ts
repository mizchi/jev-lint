import { changedRanges, changedFiles } from "../diff.ts";
import { explainScope } from "../scope.ts";
import type { Rule } from "../types.ts";
import type { Options, Log } from "./args.ts";

export async function cmdScope(command: string, rules: Rule[], opts: Options, out: Log, log: Log): Promise<number> {
  try {
    if (!["check", "review", "scan"].includes(command)) throw new Error("scope explanation supports check, review and scan");
    const changedPaths = command === "review" ? changedFiles(await changedRanges({ base: opts.base, staged: opts.staged })) : undefined;
    const report = explainScope({ paths: opts.paths, rules, exclude: opts.exclude, languages: opts.languages, changedPaths });
    if (opts.format === "sarif") throw new Error("scope explanations support JSON or text, not SARIF");
    if (opts.format === "json") out(JSON.stringify(report, null, 2));
    else {
      out(`File eligibility: ${report.counts.eligible} eligible; model matching not run; 0 requests`);
      for (const [reason, count] of Object.entries(report.counts)) if (reason !== "eligible" && count) out(`${reason}: ${count}`);
      for (const dir of report.prunedDirectories) out(`${dir.path}: ${dir.reason} (directory not traversed)`);
      for (const issue of report.issues) out(`${issue.path}: ${issue.code}`);
    }
    return report.status === "complete" ? 0 : 3;
  } catch (error) { log(`scope: ${(error as Error).message}`); return 2; }
}
