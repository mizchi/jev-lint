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
import { Jev, mapLimit } from "./jev.mjs";
import { runAstGrep, buildSymbols, baseRuleId, ruleLanguages } from "./scan.mjs";
import { resolveSubject } from "./state.mjs";
import { questionId, readAnswer } from "./questions.mjs";
import { planBatches, DEFAULT_BATCH_SIZE } from "./batch.mjs";
import { Cache, verdictKey } from "./cache.mjs";
import { gate } from "./gate.mjs";
import { touchesChange } from "./diff.mjs";
import { ruleTextHash } from "./rules.mjs";

/**
 * Collect the subjects a rule set produces over some paths.
 *
 * Split out from `run` so that `--dry-run`, the gap report and the tests can
 * see exactly what would be asked without spending anything.
 */
export async function collectSubjects({
  rules,
  paths,
  arm = null,
  diffRanges = null,
  cwd = process.cwd(),
}) {
  const { matches, probes, stderr } = await runAstGrep(rules, paths, { cwd });
  const languages = ruleLanguages(rules);
  const symbols = buildSymbols(probes, languages);
  const byId = new Map(rules.map((r) => [r.id, r]));

  const sources = new Map();
  const readSource = (file) => {
    if (sources.has(file)) return sources.get(file);
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = "";
    }
    sources.set(file, text);
    return text;
  };

  const subjects = [];
  let skippedByDiff = 0;
  for (const m of matches) {
    // Matches come back tagged with the per-grammar id the emitter used, which
    // maps back to the one jevlint rule that owns the sentence.
    const rule = byId.get(baseRuleId(m.ruleId));
    if (!rule) continue;
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

  return { subjects, symbols, sources, matches, stderr, skippedByDiff };
}

/**
 * Run a full pass. Returns everything a report or a replay needs.
 *
 * `dryRun` stops after planning: it prints what would be asked and what it
 * would cost, which is the cheap way to point this at an unfamiliar repository
 * before spending anything on it.
 */
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
  model = null,
  apiKey = null,
  cwd = process.cwd(),
  onProgress = null,
} = {}) {
  const started = Date.now();
  const { subjects, symbols, sources, stderr, skippedByDiff } = await collectSubjects({
    rules,
    paths,
    arm,
    diffRanges,
    cwd,
  });

  const cache = cachePath ? Cache.load(cachePath) : new Cache(null);
  const keyed = subjects.map((s) => ({ ...s, key: verdictKey(s.rule, s.arm, s.text) }));

  // Identical subject text under the same rule draft is one question however
  // many times it occurs, so a repository with duplicated code costs less than
  // its size suggests.
  const results = [];
  const toAsk = [];
  const wanted = new Map();
  for (const s of keyed) {
    const hit = force || !cachePath ? null : cache.get(s.key, s.rule.kind);
    if (hit) {
      results.push({ subject: s, answer: hit, cached: true });
      continue;
    }
    if (wanted.has(s.key)) {
      wanted.get(s.key).push(s);
      continue;
    }
    wanted.set(s.key, [s]);
    toAsk.push(s);
  }

  const batches = planBatches(toAsk, { batchSize, sources, symbols });

  if (dryRun) {
    return {
      dryRun: true,
      rules,
      subjects: keyed,
      batches,
      cache,
      stderr,
      skippedByDiff,
      cachedCount: results.length,
      spent: { calls: 0, inputTokens: 0, usd: 0, ms: 0 },
      ...gate(results, { cutoffs, unsureBelow }),
      elapsedMs: Date.now() - started,
    };
  }

  const jev = new Jev({ apiKey, model });
  const errors = [];

  await mapLimit(batches, concurrency, async (batch, i) => {
    try {
      const res = await jev.askSplitting(batch.state, batch.questions);
      batch.subjects.forEach((s, qi) => {
        const answer = readAnswer(res.answers, questionId(qi), s.rule.kind);
        // One verdict answers for every subject that shared its key.
        for (const twin of wanted.get(s.key) ?? [s]) {
          results.push({ subject: twin, answer, cached: false });
        }
        if (answer && cachePath) {
          cache.set(s.key, answer, {
            rule: s.rule.id,
            draft: ruleTextHash(s.rule),
            arm: s.arm,
            file: s.file,
            line: s.line,
          });
        }
      });
    } catch (err) {
      errors.push({ file: batch.file, subjects: batch.subjects.length, error: String(err.message ?? err) });
      // Fail open: a failed batch yields no verdicts, which the gate records as
      // `missing` rather than as a clean bill of health.
      for (const s of batch.subjects) {
        for (const twin of wanted.get(s.key) ?? [s]) {
          results.push({ subject: twin, answer: null, cached: false });
        }
      }
    }
    onProgress?.({ done: i + 1, total: batches.length, file: batch.file });
  });

  if (cachePath) cache.save({ model: jev.servedModel ?? jev.model });

  return {
    rules,
    subjects: keyed,
    batches,
    cache,
    errors,
    stderr,
    skippedByDiff,
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
export function toRecord(result, { arm, cutoffs, unsureBelow }) {
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
