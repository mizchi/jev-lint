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
import { isAbsolute, join } from "node:path";
import { Jev, JevError, mapLimit, DEFAULT_CONCURRENCY, type AskClient } from "./jev.ts";
import { runAstGrep, buildSymbols, astGrepRuleId, ruleLanguages } from "./scan.ts";
import { resolveSubject, widenCommentCapture } from "./state.ts";
import { buildExplainQuestion, questionId, readAnswer, readChoice } from "./questions.ts";
import { planBatches, DEFAULT_BATCH_SIZE } from "./batch.ts";
import { schedule, planMixed, DEFAULT_RULE_BATCH_CAP, type Schedule } from "./schedule.ts";
import { Cache, verdictKey, contextKey } from "./cache.ts";
import { gate, collect } from "./gate.ts";
import { touchesChange } from "./diff.ts";
import { splitDirectives, type Directive } from "./directives.ts";
import { ruleTextHash, cutoffFor, extensionsOf, undeclared as undeclaredLanguages } from "./rules.ts";
import { parseIgnores, isIgnored, unknownIgnoredRules, type FileIgnores } from "./ignore.ts";
import { excerptBudget, pairTests, type RelatedTest } from "./paired.ts";
import { commitSubjects, squashSubjects, stagedSubjects } from "./commits.ts";
import { findTextFiles, textSubjects } from "./text.ts";
import { FileIndex, isExcludedBy, tryReadFile } from "./files.ts";
import type {
  CustomLanguages,
  Answer,
  Batch,
  Finding,
  Grouping,
  GroupMode,
  IgnoreStats,
  UnpairedStats,
  Question,
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
  /** Paths under the roots whose files are never subjects: fixtures with planted defects, vendored code. */
  exclude?: string[];
  /** Grammars ast-grep does not have built in, declared by the config. */
  languages?: CustomLanguages;
  cwd?: string;
}

export interface CollectResult {
  subjects: Subject[];
  symbols: SymbolIndex;
  sources: Map<string, string>;
  /** Present when any subject sits on the `paired` arm. */
  tests: Map<string, RelatedTest[]> | null;
  matches: unknown[];
  stderr: string;
  skippedByDiff: number;
  excluded: number;
  /** Languages whose rules were dropped for want of a declared parser. */
  undeclared: string[];
  duplicateGrammars: number;
  ignored: IgnoreStats;
  unpaired: UnpairedStats;
}

export async function collectSubjects({
  rules,
  paths,
  arm = null,
  diffRanges = null,
  exclude = [],
  languages = {},
  cwd = process.cwd(),
}: CollectOptions): Promise<CollectResult> {
  const isExcluded = (file: string) => exclude.some((p) => isExcludedBy(file, p));
  let excluded = 0;
  // A rule for a language ast-grep has no grammar for until a config names
  // the parser cannot be handed to it: one rule it cannot read fails the
  // whole scan. Dropped here, and named on the result.
  // ...and named only where a file of theirs exists: a repository with no
  // MoonBit in it and a config that selected the rule by its bare id would
  // otherwise carry the notice on every run.
  const index = new FileIndex(cwd);
  const dropped = undeclaredLanguages(rules, languages);
  const missing = dropped.filter((l) => findTextFiles(paths, extensionsOf(l, languages), cwd, index).length > 0);
  const scannable = dropped.length === 0 ? rules : rules.filter((r) => !r.languages.some((l) => dropped.includes(l)));
  const { matches, probes, stderr } = await runAstGrep(scannable, paths, { cwd, languages });
  const grammars = ruleLanguages(scannable);
  const symbols = buildSymbols(probes, grammars);
  const byId = new Map(scannable.flatMap((r) => r.languages.map((language) => [astGrepRuleId(r.id, language), r] as const)));

  const sources = new Map<string, string>();
  const readSource = (file: string): string => {
    if (sources.has(file)) return sources.get(file)!;
    // ast-grep reports paths relative to the cwd it was run in, which is
    // not always the process's. A file that cannot be read is an empty one
    // here: nothing in it is judged, and nothing is reported about it.
    const text = tryReadFile(isAbsolute(file) ? file : join(cwd, file)) ?? "";
    sources.set(file, text);
    return text;
  };

  // Suppression comments are read once per file, from the source `readSource`
  // already has to load. Applied here rather than at the gate so an ignored
  // subject is never sent: a suppression is the cheapest way to quiet a rule.
  const ignoresFor = new Map<string, FileIgnores>();
  const ignoresIn = (file: string): FileIgnores => {
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
    const rule = byId.get(m.ruleId);
    if (!rule) continue;
    if (isExcluded(m.file)) {
      excluded += 1;
      continue;
    }
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
    if (isIgnored(ignoresIn(m.file), resolved.line, rule.id)) {
      ignoredSubjects += 1;
      continue;
    }
    const source = readSource(m.file);
    // A captured comment is one tree-sitter node, which for `//` comments is
    // one line: widen it to the run it ends, so `$DOC` is the whole comment.
    const captured = Object.fromEntries(
      Object.entries(resolved.captured ?? {}).map(([k, v]) => [k, widenCommentCapture(source, resolved.line, v).slice(0, 600)]),
    );
    subjects.push({
      rule,
      file: m.file,
      language: m.language ?? rule.language,
      arm: arm ?? rule.state,
      ...resolved,
      captured,
    });
  }

  // One walk of the tree for everything that is not ast-grep: block rules
  // and the paired arm both filter it.
  // Block rules: text files split at a header line, beside what ast-grep
  // found. Read through `readSource` so the `located` state has the file.
  for (const s of textSubjects(rules, paths, cwd, (file) => readSource(file), index)) {
    if (isExcluded(s.file)) {
      excluded += 1;
      continue;
    }
    if (diffRanges && !touchesChange(diffRanges, s.file, s.line, s.endLine)) {
      skippedByDiff += 1;
      continue;
    }
    subjects.push({ ...s, arm: arm ?? s.rule.state });
  }

  // The `paired` arm's evidence lives in other files, found once per run.
  //
  // A subject on that arm whose file has no related test is DROPPED, and the
  // drop is counted. Asking anyway would put "no test file was found" in the
  // state and get back the model's opinion of untested code in general,
  // which is not the question; and dropping quietly would be the matcher
  // failing silently by another route. The count is on the result and in
  // the report so a reader can see what was not asked.
  let tests: Map<string, RelatedTest[]> | null = null;
  const unpaired: UnpairedStats = { subjects: 0, files: [] };
  const pairedFiles = new Set(subjects.filter((s) => s.arm === "paired").map((s) => s.file));
  if (pairedFiles.size > 0) {
    tests = pairTests(pairedFiles, {
      roots: paths,
      cwd,
      index,
      // The subjects' own names first: the excerpt's budget goes to the
      // tests of the functions being asked about, then to the module's
      // other exports.
      keywords: (file) => {
        const asked = subjects
          .filter((s) => s.arm === "paired" && s.file === file)
          .map((s) => s.captured.NAME ?? s.contextName ?? s.enclosing?.name ?? null)
          .filter((n): n is string => n !== null);
        const exported = (symbols.get(file)?.symbols ?? []).filter((sym) => sym.exported && sym.name).map((sym) => sym.name!);
        return [...new Set([...asked, ...exported])];
      },
      budget: (file) => excerptBudget(subjects.filter((s) => s.arm === "paired" && s.file === file).length),
    });
    const dropped = new Set<string>();
    for (let i = subjects.length - 1; i >= 0; i -= 1) {
      const s = subjects[i]!;
      if (s.arm !== "paired" || tests.has(s.file)) continue;
      subjects.splice(i, 1);
      unpaired.subjects += 1;
      dropped.add(s.file);
    }
    unpaired.files = [...dropped].sort();
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
    tests,
    matches,
    stderr,
    skippedByDiff,
    excluded,
    undeclared: missing,
    duplicateGrammars,
    ignored,
    unpaired,
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
  /** Paths under the roots whose files are never judged. */
  exclude?: string[];
  /** Grammars ast-grep does not have built in, declared by the config. */
  languages?: CustomLanguages;
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
  /**
   * After the verdicts, ask each rule's `explain` follow-up of its findings.
   *
   * One request per batch that produced findings, with that batch's state,
   * so a subject under its cutoff costs nothing more. The answer is a label
   * on the finding, for the reader; it decides nothing.
   */
  explain?: boolean;
  /**
   * List the band under each cutoff for a reader: at most this many
   * subjects (Infinity for all), closest to their cutoff first. The same
   * answers cut at a second line, so it costs no request.
   */
  loose?: number | null;
  /**
   * Judge commits instead of files: the range's non-merge commits, one
   * subject each per `subject: commit` rule. `paths` is then ignored and
   * ast-grep never runs.
   */
  commits?: {
    range: string;
    label?: (sha: string) => string;
    /** Judge the whole range as one change against this message (a PR description, a changelog entry). */
    squash?: string;
    /** The index instead of a range: `subject: change` rules only, since there is no message yet. */
    staged?: boolean;
  } | null;
}

export async function run({
  rules,
  paths,
  arm = null,
  cutoffs = {},
  unsureBelow = null,
  diffRanges = null,
  exclude = [],
  languages = {},
  cachePath = null,
  force = false,
  dryRun = false,
  concurrency = DEFAULT_CONCURRENCY,
  batchSize = DEFAULT_BATCH_SIZE,
  group = "file",
  ruleBatchCap = DEFAULT_RULE_BATCH_CAP,
  model = null,
  apiKey = null,
  cwd = process.cwd(),
  retry = 1,
  onProgress = null,
  client = null,
  explain = false,
  loose = null,
  commits = null,
}: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const passes = Number.isInteger(retry) && retry > 0 ? retry : 1;
  // A cached answer reproduces itself, so reproduction testing cannot use the
  // cache. Bypassed rather than merely ignored on read: writing one pass's
  // answer while deciding on the mean of several would leave the cache holding
  // a verdict the report never used.
  const persistTo = passes === 1 ? cachePath : null;

  const collected = commits
    ? collectCommits(rules, commits.range, cwd, commits.label, commits.squash, commits.staged)
    : await collectSubjects({ rules, paths, arm, diffRanges, exclude, languages, cwd });
  const { subjects, symbols, sources, tests, stderr, skippedByDiff, excluded, undeclared, duplicateGrammars, ignored, unpaired } = collected;
  const commitStats = commits && "commits" in collected ? (collected as { commits: RunResult["commits"] }).commits : undefined;

  const cache = persistTo ? Cache.load(persistTo) : new Cache(null);
  // Under `auto` the axis is decided per rule, and the axis is part of what
  // the model saw -- so the cache key needs the axis this subject actually
  // took, not the mode that was requested.
  let plan: Schedule | null = null;
  let axisOf: Map<string, Grouping> | null = null;
  if (group === "auto") {
    plan = schedule(subjects, rules, { sources, symbols, tests, batchSize, ruleBatchCap });
    axisOf = new Map(plan.decisions.map((d) => [d.rule, d.axis]));
  }
  const effectiveAxis = (s: Subject): Grouping =>
    group === "auto" ? (axisOf!.get(s.rule.id) ?? "rule") : group;

  // A commit's verdict is about the message AND the diff: the same message
  // over a different change is a different question, so the diff is in the
  // key beside the message.
  // On `paired`, the related tests are in the key too: they are the
  // evidence, and a better excerpt of them is a new question.
  const evidence = (s: Subject): string | null =>
    s.arm === "paired" ? (tests?.get(s.file) ?? []).map((t) => `${t.path}\u0000${t.code}`).join("\u0001") : null;
  const keyed = subjects.map((s) => ({
    ...s,
    key: verdictKey(
      s.rule,
      s.arm,
      s.commit ? `${s.text}\u0000${s.commit.diff}` : s.text,
      effectiveAxis(s),
      s.promoted ? (s.matchText ?? null) : null,
      contextKey(s, s.arm, evidence(s)),
      s.captured,
    ),
  }));

  // Identical subject text under the same rule draft is one question however
  // many times it occurs, so a repository with duplicated code costs less than
  // its size suggests.
  const results: Scored[] = [];
  const toAsk: Subject[] = [];
  const wanted = new Map<string, Subject[]>();
  for (const s of keyed) {
    const hit = force || !persistTo ? null : cache.get(s.key, s.rule.kind);
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
      ? planMixed(toAsk, plan!.fileAxisRules, { sources, symbols, tests, batchSize, ruleBatchCap })
      : planBatches(toAsk, { batchSize, sources, symbols, tests, group });

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
      excluded,
      undeclared,
      duplicateGrammars,
      ignored,
      unpaired,
      commits: commitStats,
      retry: passes,
      schedule: plan,
      cachedCount: results.length,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      ...gate(results, { cutoffs, unsureBelow, loose }),
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
   * One batch, asked once, its verdicts appended to `out`.
   *
   * Called `retry` times per batch. The matcher and the planner ran once
   * above, so what repeats is only the asking -- the batches, the states and
   * the question ids are identical across passes, which is what makes the
   * answers comparable. The passes are not run one after another: every
   * (pass, batch) pair is one job in a single bounded-concurrency map, so
   * three passes over fifteen small requests are forty-five requests in
   * flight together rather than three waits of fifteen. A pass is a sample,
   * and samples do not care about the order they were drawn in.
   */
  const askBatch = async (batch: Batch, out: Scored[]): Promise<void> => {
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
        if (answer && persistTo) {
          // Stored under the arm the question was ACTUALLY asked at, which is
          // not always the arm it was looked up under: `s.key` carries the arm
          // the rule asked for, and a batch over the state budget steps down.
          // Keying the answer on the declared arm filed a `local` verdict as
          // the answer to a `located` question, and served it as one the next
          // time the file was small enough not to degrade. A miss is the right
          // outcome there -- that question has never been asked.
          const storeKey =
            batch.arm === s.arm
              ? s.key!
              : verdictKey(s.rule, batch.arm, s.text, effectiveAxis(s), s.promoted ? (s.matchText ?? null) : null, contextKey(s, batch.arm, evidence(s)), s.captured);
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
  };

  const perPass: Scored[][] = Array.from({ length: passes }, () => []);
  const jobs = perPass.flatMap((out) => batches.map((batch) => ({ batch, out })));
  const askingStarted = Date.now();
  let done = 0;
  await mapLimit(jobs, concurrency, async ({ batch, out }) => {
    await askBatch(batch, out);
    done += 1;
    onProgress?.({ done, total: jobs.length, file: batch.file });
  });
  const asked = passes === 1 ? (perPass[0] ?? []) : mergePasses(perPass, cutoffs);
  results.push(...asked);

  if (persistTo) cache.save({ model: jev.servedModel ?? jev.model });

  let gated = gate(results, { cutoffs, unsureBelow, loose });
  if (explain && !refused) await explainFindings(gated.findings, batches, jev, errors);
  if (!refused && gated.findings.length > 0) {
    await attributeFindings(gated.findings, batches, jev, errors, cutoffs);
    // Re-derived rather than patched by hand: the attribution pass can
    // retract a finding, and `collect` is what turns the findings array back
    // into the lists and the counts a report reads (see gate.ts).
    gated = collect(gated.all, { cutoffs, unsureBelow, loose });
  }
  // Attached by identity rather than by position: `gate` happens to map 1:1
  // over its input, and relying on that is the same coupling that once
  // attributed every answer to the wrong subject.
  if (passes > 1) {
    const stability = new Map(
      asked.filter((r) => r.stability).map((r) => [identify(r.subject), r.stability!]),
    );
    for (const f of gated.all) {
      const st = stability.get(findingIdentity(f));
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
    excluded,
    undeclared,
    duplicateGrammars,
    schedule: plan,
    cachedCount: results.filter((r) => r.cached).length,
    spent: { ...jev.spent, wallMs: Date.now() - askingStarted },
    samples: perPass.map((pass) =>
      pass.map((r) => ({
        rule: r.subject.rule.id,
        file: r.subject.file,
        line: r.subject.line,
        endLine: r.subject.endLine,
        kind: r.answer?.kind ?? null,
        value: r.answer?.value ?? null,
        confidence: r.answer?.confidence ?? null,
      })),
    ),
    servedModel: jev.servedModel,
    ignored,
    unpaired,
    commits: commitStats,
    retry: passes,
    ...gated,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Commits mode's collector: the same shape `collectSubjects` returns, from
 * git instead of ast-grep, so the rest of the run does not know the
 * difference. No sources, no symbols, no tests: a commit batch's state is
 * built from the subject itself.
 */
function collectCommits(
  rules: Rule[],
  range: string,
  cwd: string,
  label?: (sha: string) => string,
  squash?: string,
  staged?: boolean,
): CollectResult & { commits: { range: string; total: number; skippedMerges: number; noInstructionDoc: number } } {
  const { subjects, commits, skippedMerges, noInstructionDoc } = staged
    ? stagedSubjects(rules, cwd)
    : squash !== undefined
      ? squashSubjects(rules, range, squash, cwd)
      : commitSubjects(rules, range, cwd, label);
  return {
    subjects,
    symbols: new Map(),
    sources: new Map(),
    tests: null,
    matches: [],
    stderr: "",
    skippedByDiff: 0,
    excluded: 0,
    undeclared: [],
    duplicateGrammars: 0,
    ignored: { subjects: 0, files: [], unknownRules: [] },
    unpaired: { subjects: 0, files: [] },
    commits: { range, total: commits, skippedMerges, noInstructionDoc },
  };
}

/**
 * The `--explain` pass: for every reported finding whose rule declares
 * `explain` labels, one choice question, grouped by the batch its verdict
 * came from and sent against that batch's state.
 *
 * The findings are matched back to their subjects by identity, the same way
 * a retry pass is: a batch's subjects carry the ids the state was built
 * with, so a follow-up asked under the same id is a question about the same
 * numbered subject in the same state. Nothing here is cached -- the label is
 * a reading aid on a finding, and a finding is what the cache already keys.
 * A failed follow-up leaves the finding unlabelled and is reported; it never
 * removes a finding.
 */
async function explainFindings(
  findings: Finding[],
  batches: Batch[],
  jev: AskClient,
  errors: RunError[],
): Promise<void> {
  const byIdentity = new Map<string, Finding>();
  for (const f of findings) byIdentity.set(findingIdentity(f), f);
  const jobs: Array<{ batch: Batch; asked: Array<{ subject: Subject; finding: Finding }> }> = [];
  for (const batch of batches) {
    const asked: Array<{ subject: Subject; finding: Finding }> = [];
    for (const s of batch.subjects) {
      if (!s.rule.explain) continue;
      const f = byIdentity.get(identify(s));
      if (f) asked.push({ subject: s, finding: f });
    }
    if (asked.length > 0) jobs.push({ batch, asked });
  }
  await mapLimit(jobs, DEFAULT_CONCURRENCY, async ({ batch, asked }) => {
    const questions: Record<string, Question> = {};
    for (const { subject } of asked) questions[subject.id!] = buildExplainQuestion(subject.rule, subject, subject.id!);
    try {
      const res = await jev.askSplitting(batch.state, questions);
      for (const { subject, finding } of asked) {
        const c = readChoice(res.answers, subject.id!);
        if (c) finding.explanation = { choice: c.choice, confidence: c.confidence };
      }
    } catch (err: unknown) {
      errors.push({
        file: batch.file,
        subjects: asked.length,
        error: `explain: ${String((err as Error)?.message ?? err)}`,
      });
    }
  });
}

const TASK_ATTRIBUTE =
  "Decide whether the change in the state breaks the one instruction quoted below -- the instruction is the project's own, and whether it is a good one is not the question.";

const STATEMENT_ATTRIBUTE = "This change does what this instruction forbids, or leaves out what it requires.";

const ALSO_ATTRIBUTE =
  "An instruction about how the work was done rather than what the change contains -- develop test-first, ask when unclear, read the skill before starting -- is not something a diff can show: answer false. An instruction whose terms the change cannot be held against (\"keep it readable\", \"separate concerns\") is the same case, and so is one a formatter, linter or type checker already enforces. A change that does not touch what this instruction is about is false, not unknown.";

/**
 * One directive's question: the same true/false shape `diff-follows-instructions`
 * itself asks (see `rules/git/diff-follows-instructions/rule.yml`), narrowed
 * from "the instructions" to the one directive quoted here. Built by hand
 * rather than through `buildQuestion`, which shapes a rule's own sentence --
 * this sentence is fixed and about a `Directive`, not a `Rule`.
 */
function buildDirectiveQuestion(directive: Directive, id: string): Question {
  return {
    type: "noul",
    instructions: {
      task: TASK_ATTRIBUTE,
      statement: STATEMENT_ATTRIBUTE,
      also: ALSO_ATTRIBUTE,
      subject: id,
      instruction: `${directive.file}:${directive.line}`,
      breadcrumb: directive.breadcrumb,
      body: directive.body,
    },
    criteria: {
      true: "The change contains something this instruction names and rules out -- a dependency, an API, a construct, a path, a pattern; or it edits a file this instruction calls generated or owned elsewhere; or it is a change of a kind this instruction says requires something alongside it -- a test, a changelog entry, a type declaration, a migration -- and that thing is absent from the diff.",
      false: "The change keeps this instruction, or does not touch what it is about. A change that edits the instruction documents themselves is not in breach of this one for doing so.",
    },
  };
}

/**
 * The attribution pass: for every reported `subject: change` finding, which
 * of the instruction documents' own directives it is about.
 *
 * The verdict pass answers "this change breaks an instruction" over the
 * whole document, which is cheap and names nothing a reader can act on. This
 * pass splits the same documents the verdict was already asked against
 * (`splitDirectives`) into directives, asks one true/false question per
 * directive -- all in a single `askSplitting` against the batch's own state,
 * so the diff and the documents are not sent twice -- and attaches every
 * directive at or over the rule's own cutoff to the finding as `violates`,
 * strongest first.
 *
 * A finding left with no directive over the cutoff is retracted: `messageId`
 * becomes `"review"` and `reported` becomes `false`. A cheap whole-document
 * gate that cannot name which instruction it means is not one worth turning
 * an exit code over, so recall spent in the first pass buys precision here.
 *
 * A failed request leaves every finding of that batch exactly as the verdict
 * pass left it -- attributed to nothing and not retracted. A question that
 * could not be asked is not evidence the verdict was wrong.
 *
 * Question ids are `${subject.id}-a${i}`: a subject's own id is unique
 * within its batch (`makeBatch` numbers it), and no subject id is ever
 * anything but `q` followed by digits, so a suffix on it can never collide
 * with another subject's id -- including a second `subject: change` rule
 * sharing this batch over the same commit.
 */
async function attributeFindings(
  findings: Finding[],
  batches: Batch[],
  jev: AskClient,
  errors: RunError[],
  cutoffs: Record<string, number>,
): Promise<void> {
  const byIdentity = new Map<string, Finding>();
  for (const f of findings) byIdentity.set(findingIdentity(f), f);

  interface Asked {
    subject: Subject;
    finding: Finding;
    directives: Directive[];
  }
  const jobs: Array<{ batch: Batch; asked: Asked[] }> = [];
  for (const batch of batches) {
    const asked: Asked[] = [];
    for (const s of batch.subjects) {
      if (s.rule.subject !== "change" || !s.instructions) continue;
      const f = byIdentity.get(identify(s));
      if (!f) continue;
      asked.push({ subject: s, finding: f, directives: splitDirectives(s.instructions.docs) });
    }
    if (asked.length > 0) jobs.push({ batch, asked });
  }
  if (jobs.length === 0) return;

  await mapLimit(jobs, DEFAULT_CONCURRENCY, async ({ batch, asked }) => {
    const questions: Record<string, Question> = {};
    for (const { subject, directives } of asked) {
      directives.forEach((directive, i) => {
        questions[`${subject.id}-a${i}`] = buildDirectiveQuestion(directive, `${subject.id}-a${i}`);
      });
    }
    // No directives in the documents at all: nothing to attribute to and
    // nothing to ask. Retracted the same way as a directive that never
    // cleared the cutoff would leave it -- see the loop below -- without
    // spending a request that would come back with no answers either way.
    if (Object.keys(questions).length === 0) {
      for (const { finding } of asked) {
        finding.messageId = "review";
        finding.reported = false;
      }
      return;
    }
    try {
      const res = await jev.askSplitting(batch.state, questions);
      for (const { subject, finding, directives } of asked) {
        const at = cutoffFor(subject.rule, cutoffs);
        const violates: NonNullable<Finding["violates"]> = [];
        directives.forEach((directive, i) => {
          const answer = readAnswer(res.answers, `${subject.id}-a${i}`, "noul");
          if (answer && answer.value >= at) {
            violates.push({ file: directive.file, line: directive.line, breadcrumb: directive.breadcrumb, body: directive.body, value: answer.value });
          }
        });
        if (violates.length > 0) {
          violates.sort((a, b) => b.value - a.value);
          finding.violates = violates;
        } else {
          finding.messageId = "review";
          finding.reported = false;
        }
      }
    } catch (err: unknown) {
      errors.push({
        file: batch.file,
        subjects: asked.length,
        error: `attribute: ${String((err as Error)?.message ?? err)}`,
      });
      // Fail open: nothing about these findings changes. See the doc comment.
    }
  });
}

/** Same identity as `identify`, for a `Finding` rather than a `Subject`. */
function findingIdentity(f: Finding): string {
  return `${f.ruleKey ?? f.rule}\u0000${f.file}\u0000${f.line}\u0000${f.text ?? ""}`;
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
  const ruleKey = s.rule.languageDir ? `${s.rule.languageDir}/${s.rule.id}` : s.rule.id;
  return `${ruleKey}\u0000${s.file}\u0000${s.line}\u0000${s.text ?? ""}`;
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
export function buildRecord(
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
      languageDir: r.languageDir,
    })),
    answers: result.all.map((f) => ({
      rule: f.rule,
      ruleKey: f.ruleKey ?? f.rule,
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
