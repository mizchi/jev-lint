/**
 * The verdict cache, and why it is not only a speed optimisation.
 *
 * The model is not deterministic: the same subject can come back with a
 * different probability on a different day. The cache is what makes two runs of
 * this linter agree with each other -- without it, a reviewer and an author
 * looking at the same commit can see different findings, which would make the
 * tool useless for exactly the argument it is meant to settle.
 *
 * Keys are content-addressed over everything the model was shown:
 *
 *     sha256(schema, rule draft, arm, grouping, subject text)
 *
 * so editing a rule's sentence or its matcher invalidates that rule's verdicts
 * and nothing else, moving a function between files keeps its verdict on the
 * `bare` arm -- on the arms that show more, the context shown is in the key,
 * see `contextKey` -- and --
 * deliberately -- changing a THRESHOLD invalidates nothing at all.
 * Recalibration must be free, or it will not be done.
 *
 * What is NOT in the key is the rest of the file, even though the file is in
 * the state on the `located` and `full` arms -- nor the related tests the
 * `paired` arm carries, so a test added later does not retire a verdict that
 * said no test reached a path. That is a known and accepted imprecision:
 * keying on whole-file content would invalidate every verdict in a file on
 * every keystroke, which is not a cache. `jev-lint check --force` is the
 * escape hatch.
 *
 * Three properties the rest of the tool relies on:
 *
 *   - **It never throws.** Missing, unreadable, malformed, wrong schema: all of
 *     them mean "no verdict" and the run continues. A review tool that can
 *     break the build is worse than no review tool.
 *   - **An incomplete entry is a miss, not a zero.** An entry without the
 *     fields the current rule kind needs is treated as absent rather than
 *     scored as nothing found.
 *   - **It is trusted input.** Anything that can edit this file can silence a
 *     rule or invent a finding. It belongs next to the rule files in review,
 *     not in a build-artifact directory.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { Ledger } from "./ledger.ts";
import { ruleTextHash } from "./rules.ts";
import type { Answer, Batch, CacheEntry, Grouping, Rule, RuleKind, StateArm, Subject } from "./types.ts";

export interface StrictCacheScope { namespace: string; repository: string; endpoint: string; model: string; policyDigest?: string }

export function strictVerdictKey(batch: Batch, subject: Subject, scope: StrictCacheScope): string {
  return createHash("sha256").update(JSON.stringify({ schema: "jev-lint-strict-1", questions: "jev-lint-questions-1", scope,
    state: batch.state, payload: batch.questions, subject: subject.id })).digest("hex");
}

export const DEFAULT_CACHE_PATH = ".jev-lint/verdicts";
/** Where 0.4 kept it; found, it is named and not read. */
export const OLD_CACHE_PATH = ".jev-lint-cache.json";

/**
 * The cache's own schema: what a key is made of. Separate from the rule
 * draft's `SCHEMA` because the two change for different reasons. Bumped
 * when the key changes shape -- 0.3.1 added the context the arm shows --
 * so a cache from before loads as "written for an older schema, ignored"
 * and is rebuilt, instead of every entry silently missing and the file
 * carrying its dead weight forever.
 */
export const CACHE_SCHEMA = "jev-lint-cache-4";

/**
 * What a subject's question shows beyond its text, at this arm: the part of
 * the key that keeps two identical nodes in different surroundings apart.
 * On `bare` that is only what the question carries without the file -- a
 * promoted match's offset in its container, a test's suites -- and null
 * when there is none of that, where the text is all there is.
 */
export function contextKey(
  subject: Pick<Subject, "file" | "context" | "enclosing" | "promoted" | "line" | "subjectLine">,
  arm: StateArm,
  /** `paired` only: the related-test excerpts the state carries, which are the evidence. */
  evidence: string | null = null,
): string | null {
  // A promoted subject's question says "the code in `matched` at line N", so
  // where in the container the match sits is part of the question: two
  // identical throws in one function, one per branch, were one question.
  // The offset from the container's first line, not the line itself, so an
  // edit elsewhere in the file does not retire the verdict.
  const where = subject.promoted ? `@${subject.line - (subject.subjectLine ?? subject.line)}` : "";
  // The suites around a test are in the question on every arm, the file
  // included or not, so two tests of one title under different describes
  // are two questions.
  const path = subject.enclosing?.path ? `<${subject.enclosing.path.join(">")}` : "";
  if (arm === "bare") return where + path || null;
  const around = arm === "local" ? subject.context ?? `${subject.file}\u0000${subject.enclosing?.name ?? ""}` : `${subject.file}\u0000${subject.enclosing?.name ?? ""}`;
  // The tests shown on `paired` are what the answer is about; a different
  // excerpt of them is a different question, however the code stayed.
  const shown = arm === "paired" && evidence !== null ? `\u0000${evidence}` : "";
  return around + where + path + shown;
}

export function verdictKey(
  rule: Rule,
  arm: StateArm,
  subjectText: string,
  group: Grouping = "file",
  matchText: string | null = null,
  context: string | null = null,
  captured: Record<string, string> | null = null,
): string {
  // `group` is in the key because it changes what the model saw. The same
  // subject at the same arm sits next to its own file's other matches under
  // file grouping and next to unrelated matches from other files under rule
  // grouping, and those are not the same question.
  //
  // `matchText` is in it for a promoted subject (`subject: enclosing`), whose
  // text is the enclosing function and whose question also names the match
  // inside it. Two matches in one function share the text and are two
  // questions; keyed on the text alone, the second was never asked and took
  // the first one's verdict as a twin. Null for an unpromoted subject.
  //
  // `context` is what the arm shows beyond the text: nothing on `bare`, so
  // duplicated code across files costs one question there; on `local` the
  // enclosing function, on the file-bearing arms the file and the container.
  // Two textually identical nodes in different functions were one question
  // at every arm, and a `logger.info("cache hit")` pasted into the miss
  // branch answered exactly what its twin in the hit branch did. `contextKey`
  // decides it per arm; it only ever matters where the model can see it.
  //
  // `captured` is what the matcher picked out by name, which the question
  // carries beside the code: `$DOC` for a comment rule, `$TITLE` for a test
  // rule. A comment rewritten above an unchanged declaration is a new
  // question -- the comment is the claim -- and keyed on the declaration's
  // text alone it kept the old verdict through every run.
  const captures = captured ? Object.keys(captured).sort().map((k) => `${k}=${captured[k]}`).join("\u0000") : "";
  return createHash("sha256")
    .update([CACHE_SCHEMA, rule.id, ruleTextHash(rule), arm, group, subjectText, matchText ?? "", context ?? "", captures].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

export const readCacheEntry = (raw: unknown): CacheEntry | null => {
  const e = raw as Partial<CacheEntry> | null;
  return e && typeof e === "object" && typeof e.value === "number" && Number.isFinite(e.value) && typeof e.kind === "string" ? (e as CacheEntry) : null;
};

/**
 * The verdict cache over a {@link Ledger} directory. Since 0.10 the cache is a
 * directory of append-only files rather than one file rewritten whole: a run
 * that answers from it writes nothing, and a run that learns writes one new
 * file holding only what it learned, so branches merge without conflicts.
 */
export class Cache {
  /** null disables persistence entirely; the cache then only dedupes in memory. */
  path: string | null;
  entries: Map<string, CacheEntry>;
  hits: number;
  misses: number;
  writes: number;
  loadError: string | null;
  private ledger: Ledger<CacheEntry> | null;

  constructor(path: string | null = DEFAULT_CACHE_PATH) {
    this.path = path;
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.loadError = null;
    this.ledger = null;
  }

  static load(path: string = DEFAULT_CACHE_PATH): Cache {
    const cache = new Cache(path);
    try {
      if (statSync(path).isFile()) {
        cache.loadError = `cache at ${path} is a single file, the form before 0.10; it is not read. Run \`jev-lint ledger migrate ${path}\` to carry its verdicts into a ledger directory`;
        cache.path = null;
        return cache;
      }
    } catch { /* missing: an empty ledger */ }
    const ledger = Ledger.load(path, CACHE_SCHEMA, readCacheEntry);
    cache.ledger = ledger;
    for (const e of ledger.entries()) cache.entries.set(e.key, e.value);
    if (ledger.loadErrors.length) cache.loadError = ledger.loadErrors.slice(0, 3).join("; ");
    return cache;
  }

  get(key: string, kind: RuleKind): Answer | null {
    const e = this.entries.get(key);
    if (!e) {
      this.misses += 1;
      return null;
    }
    // Kind mismatch means the rule changed shape under the same text hash,
    // which should not happen -- but scoring a noul as a score would be a
    // silent wrong answer, so it is a miss.
    if (e.kind !== kind) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return { value: e.value, confidence: e.confidence ?? null, kind: e.kind };
  }

  set(key: string, answer: Answer | null, provenance: Partial<CacheEntry> = {}): void {
    if (!answer || typeof answer.value !== "number") return;
    const at = new Date().toISOString();
    const entry: CacheEntry = {
      value: answer.value,
      confidence: answer.confidence ?? null,
      kind: answer.kind,
      // Provenance is for humans reading the file and for `jev-lint gaps`;
      // nothing keys on it.
      ...provenance,
      at,
    };
    this.entries.set(key, entry);
    this.pending.set(key, entry);
    this.writes += 1;
  }

  private readonly pending = new Map<string, CacheEntry>();

  /** Append what this run learned as one ledger file. True when nothing failed, including when there was nothing to write. */
  save({ model = null }: { model?: string | null } = {}): boolean {
    if (!this.path) return false;
    try {
      const ledger = this.ledger ?? Ledger.load(this.path, CACHE_SCHEMA, readCacheEntry);
      this.ledger = ledger;
      // A key the ledger cannot hold is one lost verdict, not a lost save.
      for (const [key, entry] of this.pending) { try { ledger.put(key, entry, entry.at); } catch { /* skipped */ } }
      ledger.flush({ model });
      this.pending.clear();
      return true;
    } catch (err: unknown) {
      this.loadError = `could not write cache to ${this.path} (${String(err).slice(0, 120)})`;
      return false;
    }
  }

  /** Drop entries no live key refers to, in memory. Returns how many went. `jev-lint ledger compact` prunes on disk. */
  prune(liveKeys: Iterable<string>): number {
    const live = new Set(liveKeys);
    let dropped = 0;
    for (const k of [...this.entries.keys()]) {
      if (!live.has(k)) {
        this.entries.delete(k);
        this.pending.delete(k);
        dropped += 1;
      }
    }
    return dropped;
  }
}
