/**
 * `jev-lint rules`: the loaded rules and every validation error.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRules, cutoffFor, ruleSources } from "../rules.ts";
import { ARMS, ARM_BLURB } from "../state.ts";
import { TIER_ONE, type Rule } from "../types.ts";
import type { Options, Log } from "./args.ts";

export function cmdRules(opts: Options, out: Log, log: Log, baseDir: string = process.cwd()): number {
  const { rules, errors, warnings } = loadRules(opts.rules.length > 0 ? opts.rules : ruleSources(baseDir), opts.languages);
  for (const e of errors) log(`rule error: ${e}`);
  for (const w of warnings) log(`rule warning: ${w}`);
  const uncalibrated = (r: Rule): boolean =>
    Boolean(r.languageDir && r.source && existsSync(join(dirname(r.source), "expect.yml")) && !existsSync(join(dirname(r.source), "baseline.json")));
  if (opts.format === "json") {
    out(
      JSON.stringify(
        {
          rules: rules.map((r) => ({
            id: r.id,
            languageDir: r.languageDir,
            languages: r.languages,
            kind: r.kind,
            subject: r.subject,
            state: r.state,
            cutoff: cutoffFor(r, opts.at),
            loose: r.loose,
            severity: r.severity,
            ask: r.ask,
            note: r.note,
            explain: r.explain ? Object.keys(r.explain) : null,
            uncalibrated: uncalibrated(r),
            source: r.source ?? null,
          })),
          errors,
          warnings,
        },
        null,
        2,
      ),
    );
    return errors.length > 0 ? 2 : 0;
  }
  for (const r of rules) {
    out(
      `${r.languageDir ? `${r.languageDir}/` : ""}${r.id}\n  ${r.languages.join(", ")}  kind=${r.kind}  subject=${r.subject}  arm=${r.state}  cutoff=${cutoffFor(r, opts.at).toFixed(2)}  severity=${r.severity}`,
    );
    out(`  ask: ${r.ask}`);
    if (r.note) out(`  note (model only): ${r.note}`);
    if (r.explain) out(`  explain (--explain): ${Object.keys(r.explain).join(" | ")}`);
    if (r.loose !== null) out(`  loose floor (--loose): ${r.loose}`);
    // A shipped rule outside the first tier may ship without a baseline;
    // say so where the cutoff is printed, since that cutoff was never fitted.
    // Only where the suite is present at all: the npm package carries the
    // rules and not their fixtures, and RULES.md is its record of the fit.
    if (uncalibrated(r)) {
      out(`  uncalibrated: no baseline.json beside it${(TIER_ONE as readonly string[]).includes(r.languageDir ?? "") ? " -- a tier-one rule must have one" : ""}`);
    }
    out(`  from: ${r.source}`);
  }
  out("");
  out(`${rules.length} rule(s) loaded, ${errors.length} error(s)`);
  out("");
  out("state arms:");
  for (const a of ARMS) out(`  ${a.padEnd(9)} ${ARM_BLURB[a]}`);
  return errors.length > 0 ? 2 : 0;
}
