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
import { Jev, JevError, mapLimit, type AskClient } from "./jev.ts";
import { runAstGrep, buildSymbols, baseRuleId, ruleLanguages } from "./scan.ts";
import { resolveSubject } from "./state.ts";
import { questionId, readAnswer } from "./questions.ts";
import { planBatches, DEFAULT_BATCH_SIZE } from "./batch.ts";
import { schedule, planMixed, DEFAULT_RULE_BATCH_CAP, type Schedule } from "./schedule.ts";
import { Cache, verdictKey } from "./cache.ts";
import { gate } from "./gate.ts";
import { touchesChange } from "./diff.ts";
import { ruleTextHash, cutoffFor } from "./rules.ts";
import { parseIgnores, isIgnored, unknownIgnoredRules, type FileIgnores } from "./ignore.ts";
import type {
  Answer,
  Batch,
  Grouping,
  GroupMode,
  IgnoreStats,
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
  ignored: IgnoreStats;
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

  // Suppression comments are read once per file, from the source `readSource`
  // already has to load. Applied here rather than at the gate so an ignored
  // subject is never sent: a suppression is the cheapest way to quiet a rule.
  const ignoresFor = new Map<string, FileIgnores>();
  const readIgnores = (file: string): FileIgnores => {
    let ig = ignoresFor.get(file);
    if (!ig) {
      ig = parseIgnores(readSource(file));
      ignoresFor.set(file, ig);
    }
    return ig;
  };

  const subjects: Subject[] = [];
  let skippedByDiff = 0;
  let duplicateGrammars = 0;
  let ignoredSubjects = 0;
  // One node, one rule, one question -- however many grammars claimed the file.
  //
  // ast-grep's grammars have overlapping file extensions: `.js` and `.mjs` are
  // claimed by BOTH `JavaScript` and `Jsx`, so a rule listing both languages
  // matches every JavaScript file twice and reports every finding twice. The
  // per-grammar rule ids differ, but the jev-lint rule and the node are the
  // same, so identity is (file, byte range, rule) and not the ast-grep id.
  const seenNodes = new Set<string>();
  for (const m of matches) {
    // Matches come back tagged with the per-grammar id the emitter used, which
    // maps back to the one jev-lint rule that owns the sentence.
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
    if (isIgnored(readIgnores(m.file), resolved.line, rule.id)) {
      ignoredSubjects += 1;
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

  const ignored: IgnoreStats = {
    subjects: ignoredSubjects,
    files: [...ignoresFor.entries()].filter(([, ig]) => ig.file !== null).map(([f]) => f).sort(),
    unknownRules: unknownIgnoredRules(ignoresFor.values(), rules.map((r) => r.id)),
  };

  return {
    subjects,
    symbols,
    sources,
    matches,
    stderr,
    skippedByDiff,
    duplicateGrammars,
    ignored,
  };
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
  /**
   * Ask everything this many times and decide on the mean.
   *
   * 1 is one pass and the default. Above 1, the verdict CACHE IS BYPASSED --
   * reading it would make every pass after the first reproduce itself, which
   * measures nothing. The matcher runs once either way: what is being tested is
   * the model's reproducibility, not ast-grep's.
   */
  retry?: number;
  onProgress?: ((p: { done: number; total: number; file: string }) => void) | null;
  /** A client to ask through instead of a fresh `Jev`; for tests that fake the API. */
  client?: AskClient | null;
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
  retry = 1,
  onProgress = null,
  client = null,
}: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const passes = Number.isInteger(retry) && retry > 0 ? retry : 1;
  // A cached answer reproduces itself, so reproduction testing cannot use the
  // cache. Bypassed rather than merely ignored on read: writing one pass's
  // answer while deciding on the mean of several would leave the cache holding
  // a verdict the report never used.
  const useCache = passes === 1 ? cachePath : null;

  const { subjects, symbols, sources, stderr, skippedByDiff, duplicateGrammars, ignored } = await collectSubjects({
    rules,
    paths,
    arm,
    diffRanges,
    cwd,
  });

  const cache = useCache ? Cache.load(useCache) : new Cache(null);
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
  const results: Scored[] = [];
  const toAsk: Subject[] = [];
  const wanted = new Map<string, Subject[]>();
  for (const s of keyed) {
    const hit = force || !useCache ? null : cache.get(s.key, s.rule.kind);
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
      ignored,
      retry: passes,
      schedule: plan,
      cachedCount: results.length,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      ...gate(results, { cutoffs, unsureBelow }),
      elapsedMs: Date.now() - started,
    };
  }

  const jev: AskClient = client ?? new Jev({ apiKey, model });
  const errors: RunError[] = [];
  // Set by the first error that no retry, split or later batch can fix. Once
  // it is, the remaining batches and passes are not sent: they would fail
  // the same way, and 69 rows saying "no credits" report nothing that one
  // row does not.
  let refused: JevError | null = null;

  /**
   * One pass over every batch.
   *
   * Called once per `retry`. The matcher and the planner ran once above, so
   * what repeats is only the asking -- the batches, the states and the question
   * ids are identical across passes, which is what makes the answers
   * comparable.
   */
  const askOnce = async (): Promise<Scored[]> => {
    const out: Scored[] = [];
    await mapLimit(batches, concurrency, async (batch, i) => {
    try {
      if (refused) throw refused;
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
          out.push({ subject: { ...twin, arm: batch.arm }, answer, cached: false });
        }
        if (answer && useCache) {
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
      const isRefusal = err instanceof JevError && err.kind === "auth";
      // The refusal is reported once, on the batch that met it; the batches
      // skipped because of it are not errors of their own.
      if (!refused || !isRefusal) {
        errors.push({
          file: batch.file,
          subjects: batch.subjects.length,
          error: String((err as Error)?.message ?? err),
        });
      }
      if (isRefusal && !refused) refused = err;
      // Fail open: a failed batch yields no verdicts, which the gate records as
      // `missing` rather than as a clean bill of health.
      for (const s of batch.subjects) {
        for (const twin of wanted.get(s.key!) ?? [s]) {
          out.push({ subject: { ...twin, arm: batch.arm }, answer: null, cached: false });
        }
      }
    }
    onProgress?.({ done: i + 1, total: batches.length, file: batch.file });
    });
    return out;
  };

  const perPass: Scored[][] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    if (refused) break;
    perPass.push(await askOnce());
  }
  const asked = passes === 1 ? (perPass[0] ?? []) : mergePasses(perPass, cutoffs);
  results.push(...asked);

  if (useCache) cache.save({ model: jev.servedModel ?? jev.model });

  const gated = gate(results, { cutoffs, unsureBelow });
  // Attached by identity rather than by position: `gate` happens to map 1:1
  // over its input, and relying on that is the same coupling that once
  // attributed every answer to the wrong subject.
  if (passes > 1) {
    const stability = new Map(
      asked.filter((r) => r.stability).map((r) => [identify(r.subject), r.stability!]),
    );
    for (const f of gated.all) {
      const st = stability.get(`${f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`);
      if (st) f.passes = st;
    }
  }

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
    ignored,
    retry: passes,
    ...gated,
    elapsedMs: Date.now() - started,
  };
}

/** One subject's verdict, plus how it behaved across `--retry` passes. */
export interface Scored {
  subject: Subject;
  answer: Answer | null;
  cached: boolean;
  stability?: { over: number; of: number; spread: number };
}

/** Identity for matching one subject across passes, and to its finding. */
function identify(s: Subject): string {
  return `${s.rule.id}\u0000${s.file}\u0000${s.line}\u0000${s.text ?? ""}`;
}

/**
 * Collapse several passes into one verdict per subject: the MEAN answer, plus
 * how many passes put it over its cutoff.
 *
 * The mean is what decides, because a single pass both over- and under-reports
 * near a cutoff -- measured on this repository, per-subject spread has a median
 * of 0.010 and a p90 of 0.050 but a maximum of 0.300, which is enough to cross
 * one. The `over`/`of` pair is kept because "three of three" and "one of three"
 * are different claims and the second is the one not to automate.
 *
 * A pass that returned no answer at all is not counted as a disagreement: it is
 * a failed request, and `missing` already says so.
 */
export function mergePasses(perPass: Scored[][], cutoffs: Record<string, number>): Scored[] {
  const acc = new Map<string, { subject: Subject; values: number[]; confidences: number[]; kind?: Answer["kind"]; nulls: number }>();
  for (const pass of perPass) {
    for (const r of pass) {
      const key = identify(r.subject);
      let e = acc.get(key);
      if (!e) {
        e = { subject: r.subject, values: [], confidences: [], nulls: 0 };
        acc.set(key, e);
      }
      if (!r.answer) {
        e.nulls += 1;
        continue;
      }
      e.values.push(r.answer.value);
      if (typeof r.answer.confidence === "number") e.confidences.push(r.answer.confidence);
      e.kind = r.answer.kind;
    }
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const out: Scored[] = [];
  for (const e of acc.values()) {
    if (e.values.length === 0) {
      out.push({ subject: e.subject, answer: null, cached: false });
      continue;
    }
    const at = cutoffFor(e.subject.rule, cutoffs);
    out.push({
      subject: e.subject,
      answer: {
        value: mean(e.values),
        confidence: e.confidences.length > 0 ? mean(e.confidences) : null,
        kind: e.kind ?? e.subject.rule.kind,
      },
      cached: false,
      stability: {
        over: e.values.filter((v) => v >= at).length,
        of: e.values.length,
        // Rounded because it is a diagnostic that gets printed, and float
        // noise in it reads as false precision. The MEAN is deliberately left
        // raw: it decides, and rounding a decision input can flip it.
        spread: Math.round((Math.max(...e.values) - Math.min(...e.values)) * 1000) / 1000,
      },
    });
  }
  return out;
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
    schema: "jev-lint-run-1",
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
