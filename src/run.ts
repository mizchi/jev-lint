/**
 * The runner: matcher -> subjects -> batches -> verdicts -> findings.
 *
 * The one structural decision worth stating here is that this is a lint runner
 * of its own rather than an ast-grep plugin or an ESLint rule. ast-grep does
 * the matching and nothing else. Everything after the match -- deciding what
 * code a question is about, packing many subjects into one request, caching
 * verdicts, applying per-rule cutoffs -- has no seam inside a conventional
 * linter to live in, because a linter's rule callback is synchronous and
 * per-file, and the whole economy of this tool comes from batching ACROSS a
 * rule set and reusing one state for many questions.
 *
 * The cost of that decision is honest: no editor integration and no autofix.
 * The benefit is that the expensive step happens once per file for every rule
 * at once, instead of once per rule per file.
 */
import { readFileSync } from "node:fs";
import { Jev, mapLimit } from "./jev.ts";
import { runAstGrep, buildSymbols, baseRuleId, ruleLanguages } from "./scan.ts";
import { resolveSubject } from "./state.ts";
import { questionId, readAnswer } from "./questions.ts";
import { planBatches, DEFAULT_BATCH_SIZE } from "./batch.ts";
import { schedule, planMixed, DEFAULT_RULE_BATCH_CAP, type Schedule } from "./schedule.ts";
import { Cache, verdictKey } from "./cache.ts";
import { gate } from "./gate.ts";
import { touchesChange } from "./diff.ts";
import { ruleTextHash } from "./rules.ts";
import type {
  Answer,
  Batch,
  Grouping,
  GroupMode,
  Rule,
  RunError,
  RunResult,
  StateArm,
  Subject,
  SymbolIndex,
} from "./types.ts";
import type { ChangedRanges } from "./diff.ts";

/**
 * Collect the subjects a rule set produces over some paths.
 *
 * Split out from `run` so that `--dry-run`, the gap report and the tests can
 * see exactly what would be asked without spending anything.
 */
export interface CollectOptions {
  rules: Rule[];
  paths: string[];
  arm?: StateArm | null;
  diffRanges?: ChangedRanges | null;
  cwd?: string;
}

export interface CollectResult {
  subjects: Subject[];
  symbols: SymbolIndex;
  sources: Map<string, string>;
  matches: unknown[];
  stderr: string;
  skippedByDiff: number;
  duplicateGrammars: number;
}

export async function collectSubjects({
  rules,
  paths,
  arm = null,
  diffRanges = null,
  cwd = process.cwd(),
}: CollectOptions): Promise<CollectResult> {
  const { matches, probes, stderr } = await runAstGrep(rules, paths, { cwd });
  const languages = ruleLanguages(rules);
  const symbols = buildSymbols(probes, languages);
  const byId = new Map(rules.map((r) => [r.id, r]));

  const sources = new Map<string, string>();
  const readSource = (file: string): string => {
    if (sources.has(file)) return sources.get(file)!;
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = "";
    }
    sources.set(file, text);
    return text;
  };

  const subjects: Subject[] = [];
  let skippedByDiff = 0;
  let duplicateGrammars = 0;
  // One node, one rule, one question -- however many grammars claimed the file.
  //
  // ast-grep's grammars have overlapping file extensions: `.js` and `.mjs` are
  // claimed by BOTH `JavaScript` and `Jsx`, so a rule listing both languages
  // matches every JavaScript file twice and reports every finding twice. The
  // per-grammar rule ids differ, but the jevlint rule and the node are the
  // same, so identity is (file, byte range, rule) and not the ast-grep id.
  const seenNodes = new Set<string>();
  for (const m of matches) {
    // Matches come back tagged with the per-grammar id the emitter used, which
    // maps back to the one jevlint rule that owns the sentence.
    const rule = byId.get(baseRuleId(m.ruleId));
    if (!rule) continue;
    const identity = `${m.file}\u0000${m.range.byteOffset.start}\u0000${m.range.byteOffset.end}\u0000${rule.id}`;
    if (seenNodes.has(identity)) {
      duplicateGrammars += 1;
      continue;
    }
    seenNodes.add(identity);
    const entry = symbols.get(m.file) ?? null;
    const resolved = resolveSubject(m, rule, entry);
    if (diffRanges && !touchesChange(diffRanges, m.file, resolved.line, resolved.endLine)) {
      skippedByDiff += 1;
      continue;
    }
    readSource(m.file);
    subjects.push({
      rule,
      file: m.file,
      language: m.language ?? rule.language,
      arm: arm ?? rule.state,
      ...resolved,
    });
  }

  // Stable order, so two runs batch identically and a recorded run replays.
  subjects.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.id.localeCompare(b.rule.id),
  );

  return { subjects, symbols, sources, matches, stderr, skippedByDiff, duplicateGrammars };
}

/**
 * Run a full pass. Returns everything a report or a replay needs.
 *
 * `dryRun` stops after planning: it prints what would be asked and what it
 * would cost, which is the cheap way to point this at an unfamiliar repository
 * before spending anything on it.
 */
export interface RunOptions {
  rules: Rule[];
  paths: string[];
  arm?: StateArm | null;
  cutoffs?: Record<string, number>;
  unsureBelow?: number | null;
  diffRanges?: ChangedRanges | null;
  cachePath?: string | null;
  force?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  batchSize?: number;
  /** "file", "rule", or "auto" to let the scheduler cost both per rule. */
  group?: GroupMode;
  /** Subjects per rule-axis request under `auto`. */
  ruleBatchCap?: number;
  model?: string | null;
  apiKey?: string | null;
  cwd?: string;
  onProgress?: ((p: { done: number; total: number; file: string }) => void) | null;
}

export async function run({
  rules,
  paths,
  arm = null,
  cutoffs = {},
  unsureBelow = null,
  diffRanges = null,
  cachePath = null,
  force = false,
  dryRun = false,
  concurrency = 4,
  batchSize = DEFAULT_BATCH_SIZE,
  group = "file",
  ruleBatchCap = DEFAULT_RULE_BATCH_CAP,
  model = null,
  apiKey = null,
  cwd = process.cwd(),
  onProgress = null,
}: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const { subjects, symbols, sources, stderr, skippedByDiff, duplicateGrammars } = await collectSubjects({
    rules,
    paths,
    arm,
    diffRanges,
    cwd,
  });

  const cache = cachePath ? Cache.load(cachePath) : new Cache(null);
  // Under `auto` the axis is decided per rule, and the axis is part of what
  // the model saw -- so the cache key needs the axis this subject actually
  // took, not the mode that was requested.
  let plan: Schedule | null = null;
  let axisOf: Map<string, Grouping> | null = null;
  if (group === "auto") {
    plan = schedule(subjects, rules, { sources, symbols, batchSize, ruleBatchCap });
    axisOf = new Map(plan.decisions.map((d) => [d.rule, d.axis]));
  }
  const effectiveAxis = (s: Subject): Grouping =>
    group === "auto" ? (axisOf!.get(s.rule.id) ?? "rule") : group;

  const keyed = subjects.map((s) => ({
    ...s,
    key: verdictKey(s.rule, s.arm, s.text, effectiveAxis(s)),
  }));

  // Identical subject text under the same rule draft is one question however
  // many times it occurs, so a repository with duplicated code costs less than
  // its size suggests.
  const results: Array<{ subject: Subject; answer: Answer | null; cached: boolean }> = [];
  const toAsk: Subject[] = [];
  const wanted = new Map<string, Subject[]>();
  for (const s of keyed) {
    const hit = force || !cachePath ? null : cache.get(s.key, s.rule.kind);
    if (hit) {
      results.push({ subject: s, answer: hit, cached: true });
      continue;
    }
    if (wanted.has(s.key!)) {
      wanted.get(s.key!)!.push(s);
      continue;
    }
    wanted.set(s.key!, [s]);
    toAsk.push(s);
  }

  // Under `auto`, plan the remainder against the axis assignment that was
  // ALREADY decided over all subjects. Re-scheduling here would decide again on
  // a smaller set and reach a different answer -- and since the axis is part of
  // the cache key, a verdict would then be stored under the key of an axis it
  // was not asked on.
  const batches =
    group === "auto"
      ? planMixed(toAsk, plan!.fileAxisRules, { sources, symbols, batchSize, ruleBatchCap })
      : planBatches(toAsk, { batchSize, sources, symbols, group });

  if (dryRun) {
    return {
      dryRun: true,
      rules,
      group,
      subjects: keyed,
      batches,
      cache,
      stderr,
      skippedByDiff,
      duplicateGrammars,
      schedule: plan,
      cachedCount: results.length,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      ...gate(results, { cutoffs, unsureBelow }),
      elapsedMs: Date.now() - started,
    };
  }

  const jev = new Jev({ apiKey, model });
  const errors: RunError[] = [];

  await mapLimit(batches, concurrency, async (batch, i) => {
    try {
      const res = await jev.askSplitting(batch.state, batch.questions);
      batch.subjects.forEach((s) => {
        // `s.id`, not the loop index: `makeBatch` assigned these ids and built
        // the state from the same numbering, so reading them back is what
        // couples an answer to its subject. Re-deriving from the index works
        // only while nothing ever reorders or filters `batch.subjects`, and
        // fails silently if anything does -- every id still well-formed, every
        // answer attributed to the wrong subject.
        const answer = readAnswer(res.answers, s.id ?? questionId(0), s.rule.kind);
        // One verdict answers for every subject that shared its key.
        //
        // `arm: batch.arm` is not redundant. The twins come from the
        // pre-planning subject list and still carry the arm their RULE asked
        // for; the batch carries the arm the question was actually asked at,
        // after any step-down. Recording the declared one made every rule-axis
        // finding, cache entry and replay record claim `located` for a question
        // asked at `local`.
        for (const twin of wanted.get(s.key!) ?? [s]) {
          results.push({ subject: { ...twin, arm: batch.arm }, answer, cached: false });
        }
        if (answer && cachePath) {
          // Stored under the arm the question was ACTUALLY asked at, which is
          // not always the arm it was looked up under: `s.key` carries the arm
          // the rule asked for, and a batch over the state budget steps down.
          // Keying the answer on the declared arm filed a `local` verdict as
          // the answer to a `located` question, and served it as one the next
          // time the file was small enough not to degrade. A miss is the right
          // outcome there -- that question has never been asked.
          const storeKey =
            batch.arm === s.arm ? s.key! : verdictKey(s.rule, batch.arm, s.text, effectiveAxis(s));
          cache.set(storeKey, answer, {
            rule: s.rule.id,
            draft: ruleTextHash(s.rule),
            arm: batch.arm,
            file: s.file,
            line: s.line,
          });
        }
      });
    } catch (err: unknown) {
      errors.push({
        file: batch.file,
        subjects: batch.subjects.length,
        error: String((err as Error)?.message ?? err),
      });
      // Fail open: a failed batch yields no verdicts, which the gate records as
      // `missing` rather than as a clean bill of health.
      for (const s of batch.subjects) {
        for (const twin of wanted.get(s.key!) ?? [s]) {
          results.push({ subject: { ...twin, arm: batch.arm }, answer: null, cached: false });
        }
      }
    }
    onProgress?.({ done: i + 1, total: batches.length, file: batch.file });
  });

  if (cachePath) cache.save({ model: jev.servedModel ?? jev.model });

  return {
    rules,
    group,
    subjects: keyed,
    batches,
    cache,
    errors,
    stderr,
    skippedByDiff,
    duplicateGrammars,
    schedule: plan,
    cachedCount: results.filter((r) => r.cached).length,
    spent: jev.spent,
    servedModel: jev.servedModel,
    ...gate(results, { cutoffs, unsureBelow }),
    elapsedMs: Date.now() - started,
  };
}

/**
 * A run record, for replay.
 *
 * The thresholds in force are recorded alongside the answers, and that is not
 * bookkeeping: without them, recalibrating silently rewrites the numbers in
 * every report published before the change, and there is no way to tell a model
 * difference from a threshold edit afterwards.
 */
export function toRecord(
  result: RunResult,
  { arm, cutoffs, unsureBelow }: { arm: StateArm | null; cutoffs: Record<string, number>; unsureBelow: number | null },
): Record<string, unknown> {
  return {
    schema: "jevlint-run-1",
    recorded: new Date().toISOString(),
    model: result.servedModel ?? null,
    arm,
    cutoffs,
    unsureBelow,
    spent: result.spent,
    rules: result.rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      ask: r.ask,
      note: r.note,
      draft: ruleTextHash(r),
      at: r.at,
      state: r.state,
      subject: r.subject,
      severity: r.severity,
      language: r.language,
    })),
    answers: result.all.map((f) => ({
      rule: f.rule,
      file: f.file,
      line: f.line,
      endLine: f.endLine,
      kind: f.kind ?? null,
      value: f.value,
      confidence: f.confidence,
      arm: f.arm ?? null,
    })),
  };
}
