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
import { renamedRuleHint } from "./ignore.ts";
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
  { color = true, showMissing = false, summary = false }: { color?: boolean; showMissing?: boolean; summary?: boolean } = {},
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
    // A commit is named by its short sha and subject line, not by a path.
    const commit = list[0]?.commit;
    out.push(c.bold(commit ? `${shortRef(file)}  "${commit.subject}"` : file));
    for (const f of list.sort((a, b) => a.line - b.line)) {
      const loc = `${f.line}`.padStart(5);
      const tag = (f.messageId ? TAG[f.messageId]?.(c) : null) ?? String(f.messageId);
      const what = f.message ?? f.ask;
      const num =
        f.kind === "score"
          ? `${f.value!.toFixed(2)}/${f.scale ?? 3}${typeof f.confidence === "number" ? ` conf ${f.confidence.toFixed(2)}` : ""}`
          : f.value!.toFixed(2);
      out.push(`  ${loc}  ${tag}  ${what}`);
      const repro = f.passes ? `  ${f.passes.over}/${f.passes.of} passes` : "";
      out.push(
        `         ${c.dim(`${f.rule}  ${num}  cutoff ${f.at.toFixed(2)}  arm ${f.arm}${repro}`)}`,
      );
      if (f.explanation) {
        out.push(`         ${c.dim(`why: ${f.explanation.choice} (${f.explanation.confidence.toFixed(2)})`)}`);
      }
      // A verdict on a cut block is a verdict on the part that was sent, and
      // a claim about "the document" -- a question never returned to -- may
      // be answered past the cut.
      if (f.cut) {
        out.push(`         ${c.yellow(`judged on the first ${f.cut.judged.toLocaleString()} of ${f.cut.of.toLocaleString()} characters; what lies past the cut was not seen`)}`);
      }
      if (f.messageId === "unsure") {
        out.push(`         ${c.yellow("worth a human look rather than a fix")}`);
      }
      // A finding the mean reports but not every pass did is exactly the case
      // the calibration discipline says not to automate.
      if (f.passes && f.passes.over < f.passes.of) {
        out.push(
          `         ${c.yellow(`did not reproduce in every pass (spread ${f.passes.spread.toFixed(2)}) -- decide this one by hand`)}`,
        );
      }
    }
    out.push("");
  }

  // `--summary`: the findings grouped, by rule and by file. On a whole
  // tree the list is read by its clusters -- one idiom repeated across
  // modules, one file too big for its reviewer -- and this is where they
  // show. Files with nothing reported are left out.
  if (summary && findings.length > 0) {
    const rules = Object.entries(stats.byRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push(c.bold("by rule:  ") + rules.map(([r, n]) => `${r} ${n}`).join(" · "));
    const files = Object.entries(stats.byFile ?? {})
      .filter(([, n]) => n.findings > 0)
      .sort((a, b) => b[1].findings / b[1].subjects - a[1].findings / a[1].subjects || b[1].findings - a[1].findings || a[0].localeCompare(b[0]));
    out.push(c.bold("by file:  ") + files.map(([f, n]) => `${f} ${n.findings}/${n.subjects}`).join(" · "));
    out.push("");
  }

  // The `--loose` band, after the findings and apart from them: what a
  // reader might look at next, never what the run is reporting.
  const review = result.review ?? [];
  if (review.length > 0) {
    out.push(
      c.bold(`${review.length} subject(s) under a cutoff but over its loose floor -- for a reader, not findings:`),
    );
    for (const f of review) {
      const num = f.kind === "score" ? `${f.value!.toFixed(2)}/${f.scale ?? 3}` : f.value!.toFixed(2);
      const where = f.commit ? `${shortRef(f.file)}  "${f.commit.subject}"` : `${f.file}:${f.line}`;
      out.push(c.dim(`  ${where}  ${f.rule}  ${num}  cutoff ${f.at.toFixed(2)}  ${f.message ?? f.ask}`));
    }
    out.push("");
  }

  if (showMissing) {
    const missing = all.filter((f) => f.messageId === "missing");
    for (const f of missing) out.push(c.grey(`  ${describe(f)}`));
    if (missing.length) out.push("");
  }

  const idle = idleLanguages(result);
  if (idle.length > 0 && !result.commits) {
    out.push(
      c.dim(`no files for ${idle.map((l) => `${l.language} (${l.rules} rule${l.rules === 1 ? "" : "s"})`).join(", ")}`),
    );
  }
  if (result.undeclared?.length) {
    out.push(
      c.yellow(
        `${result.undeclared.join(", ")}: no parser declared, so those rules did not run. ` +
          "ast-grep has no grammar for them until `languages:` in the config names the compiled library. " +
          "How to build and declare one: docs/reference.md#a-language-ast-grep-does-not-have-built-in " +
          "(https://github.com/mizchi/jev-lint/blob/main/docs/reference.md#a-language-ast-grep-does-not-have-built-in).",
      ),
    );
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

  const ignored = result.ignored;
  if (ignored && (ignored.subjects > 0 || ignored.files.length > 0)) {
    // Loud for the same reason a silent matcher is: a suppression removes a
    // subject before it is ever asked about, so nothing else in the output
    // would show that a rule had been quieted.
    const where = ignored.files.length
      ? ` (${ignored.files.length} file(s) suppressed whole: ${ignored.files.slice(0, 3).join(", ")}${ignored.files.length > 3 ? ", …" : ""})`
      : "";
    out.push(c.dim(`${ignored.subjects} subject(s) skipped by jev-lint-ignore comments${where}`));
    out.push("");
  }
  if (ignored?.unknownRules.length) {
    out.push(
      c.yellow(
        `${ignored.unknownRules.length} jev-lint-ignore comment(s) name a rule that does not exist: ${ignored.unknownRules
          .map((id) => {
            const hint = renamedRuleHint(id, (result.rules ?? []).map((r) => r.id));
            return hint ? `${id} -> ${hint}` : id;
          })
          .join(", ")}`,
      ),
    );
    out.push(c.yellow("  Those suppress nothing, and the rule they meant keeps firing."));
    out.push("");
  }
  const unpaired = result.unpaired;
  if (unpaired && unpaired.subjects > 0) {
    // Same reason: a subject the paired arm could not pair was never asked
    // about, and this line is the only place that shows.
    out.push(
      c.dim(
        `${unpaired.subjects} subject(s) on the paired arm not asked: no related test file for ${unpaired.files.length} file(s)` +
          ` (${unpaired.files.slice(0, 3).join(", ")}${unpaired.files.length > 3 ? ", …" : ""})`,
      ),
    );
    out.push("");
  }

  const bits = [
    `${stats.reported} finding(s)`,
    `${stats.subjects} subject(s)`,
    `${result.cachedCount ?? 0} cached`,
  ];
  if (result.retry && result.retry > 1) bits.push(`${result.retry} passes, deciding on the mean`);
  if (stats.unsure) bits.push(`${stats.unsure} unsure`);
  if (stats.review) bits.push(c.dim(`${stats.review} for a reader (--loose)`));
  if (stats.missing) bits.push(c.yellow(`${stats.missing} without a verdict`));
  if (result.skippedByDiff) bits.push(c.dim(`${result.skippedByDiff} outside the diff`));
  if (result.excluded) bits.push(c.dim(`${result.excluded} under an excluded path`));
  if (result.commits) {
    bits.push(`${result.commits.total} commit(s) in ${result.commits.range}`);
    if (result.commits.skippedMerges) bits.push(c.dim(`${result.commits.skippedMerges} merge(s) skipped`));
  }
  out.push(bits.join(", "));

  if (spent?.calls) {
    out.push(
      c.dim(
        `${spent.calls} request(s), ${spent.inputTokens.toLocaleString()} input tokens, $${spent.usd.toFixed(5)}, ` +
          (spent.wallMs != null ? `${spent.wallMs} ms (${spent.ms} ms of requests)` : `${spent.ms} ms`) +
          (spent.splits ? `, ${spent.splits} split(s)` : "") +
          (spent.retried ? `, ${spent.retried} retry/retries` : "") +
          (spent.rateLimited ? `, rate-limited ${spent.rateLimited}x, paced to ${Math.round((spent.tokensPerSecond ?? 0) / 1000)}k tokens/s` : ""),
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
    // Grouped by the reason the planner recorded, not by a hardcoded one. The
    // hardcoded message named the state budget, which is only one of the two
    // causes -- rule grouping strips a file-bearing arm for a different reason
    // entirely, and that was the majority case whenever it was used.
    const byReason = new Map<string, { batches: number; subjects: number; from: string; to: string }>();
    for (const b of degraded) {
      const d = b.degraded!;
      const key = `${d.from}\u0000${d.to}\u0000${d.reason}`;
      const e = byReason.get(key) ?? { batches: 0, subjects: 0, from: d.from, to: d.to };
      e.batches += 1;
      e.subjects += b.subjects.length;
      byReason.set(key, e);
    }
    for (const [key, e] of byReason) {
      const reason = key.split("\u0000")[2];
      out.push(
        c.yellow(
          `${e.batches} batch(es) / ${e.subjects} subject(s) fell back from \`${e.from}\` to \`${e.to}\`: ${reason}`,
        ),
      );
    }
    out.push(
      c.yellow("  A step-down is a real loss of context; those verdicts answered a leaner question."),
    );
  }
  return out.join("\n");
}

/** Rules that produced no subject at all. */
export function silentRules(result: Partial<ReportInput>): string[] {
  // An empty range is a fact about the range, not about any rule.
  if (result.commits && result.commits.total === 0) return [];
  const fired = new Set((result.subjects ?? []).map((s) => ruleKey(s.rule)));
  const idle = new Set(idleLanguages(result).map((l) => l.language));
  // In commits mode only commit rules can fire, and in file mode only the
  // others can; a rule of the other kind is not silent, it is off duty. So
  // is every rule of a language the run saw no file of.
  const onDuty = (result.rules ?? []).filter(
    (r) => (r.subject === "commit") === Boolean(result.commits) && !(r.languageDir && idle.has(r.languageDir)),
  );
  return onDuty.map((r) => ruleKey(r)).filter((id) => !fired.has(id));
}

/**
 * Language directories none of whose rules matched anything: a repository
 * with no Python in it makes every Python rule silent, and that is one fact
 * about the repository, not eleven dead matchers. Reported as one line so
 * the list of silent rules keeps meaning "check this matcher".
 */
export function idleLanguages(result: Partial<ReportInput>): Array<{ language: string; rules: number }> {
  const fired = new Set((result.subjects ?? []).map((s) => s.rule.languageDir));
  const byDir = new Map<string, number>();
  for (const r of result.rules ?? []) {
    if (!r.languageDir || r.subject === "commit") continue;
    byDir.set(r.languageDir, (byDir.get(r.languageDir) ?? 0) + 1);
  }
  return [...byDir.entries()]
    .filter(([dir]) => !fired.has(dir))
    .map(([language, rules]) => ({ language, rules }));
}

/** A full sha shortened to eight; anything else -- a range like `main..HEAD`, a short ref -- as it is. */
function shortRef(file: string): string {
  return /^[0-9a-f]{40}$/.test(file) ? file.slice(0, 8) : file;
}

/** `lang/id` under the layout, else the id: what two languages' twins are told apart by. */
function ruleKey(r: { id: string; languageDir?: string | null }): string {
  return r.languageDir ? `${r.languageDir}/${r.id}` : r.id;
}

export function formatJson(result: ReportInput): string {
  const row = (f: Finding) => ({
    rule: f.rule,
    severity: f.severity,
    messageId: f.messageId,
    file: f.file,
    line: f.line,
    endLine: f.endLine,
    value: f.value,
    confidence: f.confidence,
    explanation: f.explanation ?? null,
    cutoff: f.at,
    margin: round(f.margin),
    kind: f.kind,
    level: f.level ?? null,
    arm: f.arm,
    passes: f.passes ?? null,
    message: f.message ?? f.ask,
    commit: f.commit ?? null,
    cut: f.cut ?? null,
  });
  return JSON.stringify(
    {
      findings: result.findings.map(row),
      // The `--loose` band, same shape, its own key: a consumer that reads
      // `findings` sees nothing new.
      review: (result.review ?? []).map(row),
      stats: result.stats,
      degraded: (result.batches ?? [])
        .filter((b) => b.degraded)
        .map((b) => ({
          file: b.file,
          rule: b.rule ?? null,
          subjects: b.subjects.length,
          from: b.degraded!.from,
          to: b.degraded!.to,
          reason: b.degraded!.reason,
        })),
      silentRules: silentRules(result),
      idleLanguages: idleLanguages(result),
      ignored: result.ignored ?? null,
      unpaired: result.unpaired ?? null,
      retry: result.retry ?? 1,
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
 * A finding is emitted as `notice` or `warning` unless its rule asked for
 * `severity: error`, and no rule shipped here does. That default is deliberate
 * rather than an oversight: a probabilistic reviewer that can fail a build is a
 * probabilistic reviewer that gets switched off. Raise it per rule once a rule
 * has earned it on your own code, and this will pass `error` through.
 */
export function formatGithub(result: ReportInput): string {
  const out: string[] = [];
  for (const f of result.findings) {
    const level = f.severity === "error" ? "error" : f.messageId === "unsure" ? "notice" : "warning";
    const title = `${f.rule}${f.messageId === "unsure" ? " (unsure)" : ""}`;
    const num = f.kind === "score" ? `${f.value!.toFixed(2)}/${f.scale ?? 3}` : f.value!.toFixed(2);
    const why = f.explanation ? `; why: ${f.explanation.choice}` : "";
    const where = f.commit ? `commit ${shortRef(f.file)} "${f.commit.subject}": ` : "";
    const cut = f.cut ? `; judged on the first ${f.cut.judged} of ${f.cut.of} characters` : "";
    const body = `${where}${f.message ?? f.ask} [${num}, cutoff ${f.at.toFixed(2)}${why}${cut}]`;
    out.push(
      `::${level} file=${f.file},line=${f.line},endLine=${f.endLine},title=${escape(title)}::${escape(body)}`,
    );
  }
  // The `--loose` band as notices: visible in the checks tab, never a
  // warning, never a failure.
  for (const f of result.review ?? []) {
    const num = f.kind === "score" ? `${f.value!.toFixed(2)}/${f.scale ?? 3}` : f.value!.toFixed(2);
    out.push(
      `::notice file=${f.file},line=${f.line},endLine=${f.endLine},title=${escape(`${f.rule} (loose)`)}::${escape(`${f.message ?? f.ask} [${num}, under cutoff ${f.at.toFixed(2)}; for a reader]`)}`,
    );
  }
  if (result.stats.missing > 0) {
    out.push(
      `::warning title=jev-lint::${result.stats.missing} subject(s) got no verdict; this run is incomplete`,
    );
  }
  // Degradation belongs in the CI format too: a verdict answered at a leaner
  // arm than the rule asked for is a weaker verdict, and this is the format the
  // documentation tells people to run.
  const degraded = (result.batches ?? []).filter((b) => b.degraded);
  if (degraded.length > 0) {
    const subjects = degraded.reduce((a, b) => a + b.subjects.length, 0);
    const reasons = [...new Set(degraded.map((b) => b.degraded!.reason))].join("; ");
    out.push(
      `::warning title=jev-lint::${subjects} subject(s) in ${degraded.length} batch(es) were judged at a leaner state arm than their rule asked for (${reasons})`,
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
  const headings = ["rule", "kind", "matched", "reported", "cutoff", "median", "top<at", "head", "gap", "suggest", "verdict"];
  const widths = [28, 5, 7, 8, 6, 6, 6, 6, 5, 7, 7];
  const lines: string[] = [headings.map((h, i) => h.padEnd(widths[i]!)).join(" ")];
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
      r.highestBelow === null ? "-" : r.highestBelow.toFixed(2),
      r.headroom === null ? "-" : `+${r.headroom.toFixed(2)}`,
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
  lines.push("");
  lines.push(
    c.bold("On unlabeled code, read `head` instead."),
  );
  lines.push(
    "  A gap needs two classes and real source is ~99.8% clean, so `verdict` says `rewrite` for",
  );
  lines.push(
    "  everything and means nothing there. `top<at` is the highest answer still under the cutoff and",
  );
  lines.push(
    "  `head` is the clearance above it -- which is what predicts the next false positive.",
  );
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
