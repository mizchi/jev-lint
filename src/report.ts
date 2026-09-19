/**
 * Output formats.
 *
 * `pretty` for a terminal, `json` for anything programmatic, `github` for
 * pull-request annotations.
 *
 * Two things every format states, because leaving them out makes a bad run look
 * like a good one:
 *
 *   - **how many verdicts were missing.** A run where requests failed must not
 *     be indistinguishable from a clean repository.
 *   - **which rules matched nothing.** The matcher is the half that fails
 *     silently, so a rule that never fired is reported as its own line rather
 *     than left to be inferred from an absence.
 */
import { describe } from "./gate.ts";
import type { Finding, ReportInput } from "./types.ts";
import type { GapRow, StabilityReport } from "./calibrate.ts";

type Painter = (s: string) => string;
type Palette = Record<keyof typeof C, Painter>;

const C = {
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  grey: (s: string) => `\u001b[90m${s}\u001b[0m`,
};

function plain(s: string): string {
  return s;
}

function palette(color: boolean): Palette {
  if (color) return C;
  return Object.fromEntries(Object.keys(C).map((k) => [k, plain])) as Palette;
}

const TAG: Record<string, (c: Palette) => string> = {
  violation: (c) => c.red("violation"),
  unsure: (c) => c.yellow("unsure   "),
  flag: (c) => c.red("flag     "),
  missing: (c) => c.grey("no-verdict"),
};

export function formatPretty(
  result: ReportInput,
  { color = true, showMissing = false }: { color?: boolean; showMissing?: boolean } = {},
): string {
  const c = palette(color);
  const out: string[] = [];
  const { findings, all, stats, spent } = result;

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  for (const [file, list] of [...byFile.entries()].sort()) {
    out.push(c.bold(file));
    for (const f of list.sort((a, b) => a.line - b.line)) {
      const loc = `${f.line}`.padStart(5);
      const tag = (f.messageId ? TAG[f.messageId]?.(c) : null) ?? String(f.messageId);
      const what = f.message ?? f.ask;
      const num =
        f.kind === "score"
          ? `${f.value!.toFixed(2)}/3${typeof f.confidence === "number" ? ` conf ${f.confidence.toFixed(2)}` : ""}`
          : f.value!.toFixed(2);
      out.push(`  ${loc}  ${tag}  ${what}`);
      out.push(
        `         ${c.dim(`${f.rule}  ${num}  cutoff ${f.at.toFixed(2)}  arm ${f.arm}`)}`,
      );
      if (f.messageId === "unsure") {
        out.push(`         ${c.yellow("worth a human look rather than a fix")}`);
      }
    }
    out.push("");
  }

  if (showMissing) {
    const missing = all.filter((f) => f.messageId === "missing");
    for (const f of missing) out.push(c.grey(`  ${describe(f)}`));
    if (missing.length) out.push("");
  }

  const silent = silentRules(result);
  if (silent.length > 0) {
    out.push(
      c.dim(
        `${silent.length} rule(s) matched nothing: ${silent.join(", ")}`,
      ),
    );
    out.push(
      c.dim(
        "  A matcher that misses is invisible everywhere else -- check these before trusting a clean run.",
      ),
    );
    out.push("");
  }

  const bits = [
    `${stats.reported} finding(s)`,
    `${stats.subjects} subject(s)`,
    `${result.cachedCount ?? 0} cached`,
  ];
  if (stats.unsure) bits.push(`${stats.unsure} unsure`);
  if (stats.missing) bits.push(c.yellow(`${stats.missing} without a verdict`));
  if (result.skippedByDiff) bits.push(c.dim(`${result.skippedByDiff} outside the diff`));
  out.push(bits.join(", "));

  if (spent?.calls) {
    out.push(
      c.dim(
        `${spent.calls} request(s), ${spent.inputTokens.toLocaleString()} input tokens, $${spent.usd.toFixed(5)}, ${spent.ms} ms` +
          (spent.splits ? `, ${spent.splits} split(s)` : "") +
          (spent.retried ? `, ${spent.retried} retry/retries` : ""),
      ),
    );
  }
  if (result.errors?.length) {
    out.push(c.yellow(`${result.errors.length} request(s) failed:`));
    for (const e of result.errors.slice(0, 5)) {
      out.push(c.yellow(`  ${e.file} (${e.subjects} subject(s)): ${e.error.slice(0, 160)}`));
    }
  }
  const degraded = (result.batches ?? []).filter((b) => b.degraded);
  if (degraded.length > 0) {
    out.push(
      c.yellow(
        `${degraded.length} batch(es) fell back to a leaner state arm (file too large for the 32Ki state budget)`,
      ),
    );
  }
  return out.join("\n");
}

/** Rules that produced no subject at all. */
export function silentRules(result: Partial<ReportInput>): string[] {
  const fired = new Set((result.subjects ?? []).map((s) => s.rule.id));
  return (result.rules ?? []).map((r) => r.id).filter((id) => !fired.has(id));
}

export function formatJson(result: ReportInput): string {
  return JSON.stringify(
    {
      findings: result.findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        messageId: f.messageId,
        file: f.file,
        line: f.line,
        endLine: f.endLine,
        value: f.value,
        confidence: f.confidence,
        cutoff: f.at,
        margin: round(f.margin),
        kind: f.kind,
        level: f.level ?? null,
        arm: f.arm,
        message: f.message ?? f.ask,
      })),
      stats: result.stats,
      silentRules: silentRules(result),
      spent: result.spent,
      errors: result.errors ?? [],
      elapsedMs: result.elapsedMs,
    },
    null,
    2,
  );
}

/**
 * GitHub workflow commands.
 *
 * Everything is emitted as `notice` or `warning`, never `error`, and that is a
 * deliberate default rather than an oversight: a probabilistic reviewer that
 * can fail a build is a probabilistic reviewer that gets switched off. Raise it
 * per rule with `severity: error` once a rule has earned it on your own code.
 */
export function formatGithub(result: ReportInput): string {
  const out: string[] = [];
  for (const f of result.findings) {
    const level = f.severity === "error" ? "error" : f.messageId === "unsure" ? "notice" : "warning";
    const title = `${f.rule}${f.messageId === "unsure" ? " (unsure)" : ""}`;
    const num = f.kind === "score" ? `${f.value!.toFixed(2)}/3` : f.value!.toFixed(2);
    const body = `${f.message ?? f.ask} [${num}, cutoff ${f.at.toFixed(2)}]`;
    out.push(
      `::${level} file=${f.file},line=${f.line},endLine=${f.endLine},title=${escape(title)}::${escape(body)}`,
    );
  }
  if (result.stats.missing > 0) {
    out.push(
      `::warning title=jevlint::${result.stats.missing} subject(s) got no verdict; this run is incomplete`,
    );
  }
  return out.join("\n");
}

function escape(s: unknown): string {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

const round = (n: unknown) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);

/** The gap table -- the first thing to read when authoring rules. */
export function formatGaps(rows: GapRow[], { color = true }: { color?: boolean } = {}): string {
  const c = palette(color);
  const head = ["rule", "kind", "matched", "reported", "cutoff", "median", "gap", "suggest", "verdict"];
  const widths = [28, 5, 7, 8, 6, 6, 5, 7, 7];
  const lines: string[] = [head.map((h, i) => h.padEnd(widths[i]!)).join(" ")];
  lines.push(c.dim(widths.map((w) => "-".repeat(w)).join(" ")));

  const tag: Record<string, Painter> = {
    works: (s) => c.green(s),
    move: (s) => c.yellow(s),
    rewrite: (s) => c.red(s),
    silent: (s) => c.red(s),
    thin: (s) => c.dim(s),
  };

  for (const r of rows) {
    const cells = [
      r.rule.slice(0, widths[0]!),
      r.kind,
      String(r.matches),
      String(r.reported),
      r.at.toFixed(2),
      r.median === null ? "-" : r.median.toFixed(2),
      r.matches > 1 ? r.gap.toFixed(2) : "-",
      r.matches > 1 ? String(r.suggested) : "-",
      r.verdict,
    ];
    const row = cells.map((v, i) => String(v).padEnd(widths[i]!)).join(" ");
    lines.push(r.verdict === "works" ? row : (tag[r.verdict] ?? plain)(row));
  }

  lines.push("");
  lines.push(c.bold("Read the gap, not the cutoff."));
  lines.push(
    "  works    wide gap, cutoff inside it. Any cutoff in the gap gives the same answers -- leave it.",
  );
  lines.push("  move     wide gap, cutoff outside it. Set the cutoff to `suggest`.");
  lines.push(
    "  rewrite  narrow gap. The answers are not separated, so no cutoff helps. Rewrite the sentence --",
  );
  lines.push(
    "           first check it is not asking for something the matched code cannot show.",
  );
  lines.push("  silent   the matcher never fired. Loosen it; it cannot be seen failing anywhere else.");
  lines.push("  thin     too few matches to judge. Not a pass.");
  return lines.join("\n");
}

/** The stability table -- how much the model moves between runs. */
export function formatStability(
  report: StabilityReport,
  { color = true }: { color?: boolean } = {},
): string {
  const c = palette(color);
  const lines: string[] = [c.bold(`stability over ${report.runs} run(s)`), ""];
  const widths = [28, 9, 8, 11, 10];
  lines.push(
    ["rule", "subjects", "flipped", "max spread", "mean spread"]
      .map((h, i) => h.padEnd(widths[i]!))
      .join(" "),
  );
  lines.push(c.dim(widths.map((w) => "-".repeat(w)).join(" ")));
  for (const r of [...report.rows].sort((a, b) => b.flipped - a.flipped)) {
    const row = [r.rule.slice(0, 28), String(r.subjects), String(r.flipped), r.maxSpread.toFixed(2), r.meanSpread.toFixed(2)]
      .map((v, i) => v.padEnd(widths[i]!))
      .join(" ");
    lines.push(r.flipped > 0 ? c.yellow(row) : row);
  }
  if (report.flipped.length > 0) {
    lines.push("");
    lines.push(c.yellow(`${report.flipped.length} subject(s) changed decision between runs:`));
    for (const s of report.flipped.slice(0, 20)) {
      lines.push(
        `  ${s.file}:${s.line}  ${s.rule}  ${s.min.toFixed(2)}-${s.max.toFixed(2)} across cutoff ${s.at.toFixed(2)}`,
      );
    }
    lines.push("");
    lines.push(
      "  These sit inside the band the model itself moves in, so a trivial edit flips them.",
    );
    lines.push(
      "  Do not automate on them: either widen the gap by rewriting the rule, or route them to a person.",
    );
  } else if (report.rows.length > 0) {
    lines.push("");
    lines.push(c.green("No decision changed between runs at the current cutoffs."));
  }
  return lines.join("\n");
}
