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
 * and nothing else, moving a function between files keeps its verdict, and --
 * deliberately -- changing a THRESHOLD invalidates nothing at all.
 * Recalibration must be free, or it will not be done.
 *
 * What is NOT in the key is the rest of the file, even though the file is in
 * the state on the `located` and `full` arms. That is a known and accepted
 * imprecision: keying on whole-file content would invalidate every verdict in
 * a file on every keystroke, which is not a cache. `jev-lint check --force` is
 * the escape hatch.
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
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA, ruleTextHash } from "./rules.ts";
import type { Answer, CacheEntry, Grouping, Rule, RuleKind, StateArm } from "./types.ts";

export const DEFAULT_CACHE_PATH = ".jev-lint-cache.json";

export function verdictKey(
  rule: Rule,
  arm: StateArm,
  subjectText: string,
  group: Grouping = "file",
): string {
  // `group` is in the key because it changes what the model saw. The same
  // subject at the same arm sits next to its own file's other matches under
  // file grouping and next to unrelated matches from other files under rule
  // grouping, and those are not the same question.
  return createHash("sha256")
    .update([SCHEMA, rule.id, ruleTextHash(rule), arm, group, subjectText].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

export class Cache {
  /** null disables persistence entirely; the cache then only dedupes in memory. */
  path: string | null;
  entries: Map<string, CacheEntry>;
  meta: Record<string, unknown>;
  hits: number;
  misses: number;
  writes: number;
  loadError: string | null;

  constructor(path: string | null = DEFAULT_CACHE_PATH) {
    this.path = path;
    this.entries = new Map();
    this.meta = { schema: SCHEMA };
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.loadError = null;
  }

  static load(path: string = DEFAULT_CACHE_PATH): Cache {
    const cache = new Cache(path);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        schema?: string;
        entries?: Record<string, CacheEntry>;
      };
      // A cache written by a different question schema is not upgradeable: the
      // verdicts answered questions that no longer exist. Dropping it is the
      // only honest option.
      if (raw?.schema !== SCHEMA) {
        cache.loadError = raw?.schema
          ? `cache at ${path} was written for schema ${raw.schema}, this build is ${SCHEMA}; ignoring it`
          : null;
        return cache;
      }
      for (const [k, v] of Object.entries(raw.entries ?? {})) {
        if (v && typeof v.value === "number") cache.entries.set(k, v);
      }
      cache.meta = { ...raw, entries: undefined };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        cache.loadError = `cache at ${path} unreadable (${String(err).slice(0, 120)}); ignoring it`;
      }
    }
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
    this.entries.set(key, {
      value: answer.value,
      confidence: answer.confidence ?? null,
      kind: answer.kind,
      // Provenance is for humans reading the file and for `jev-lint gaps`;
      // nothing keys on it.
      ...provenance,
      at: new Date().toISOString(),
    });
    this.writes += 1;
  }

  save({ model = null, extra = {} }: { model?: string | null; extra?: Record<string, unknown> } = {}): boolean {
    const payload = {
      schema: SCHEMA,
      model,
      written: new Date().toISOString(),
      ...extra,
      entries: Object.fromEntries(this.entries),
    };
    if (!this.path) return false;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // Write-then-rename, so an interrupted save cannot leave a half-written
      // cache that the next run would report as a schema error.
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
      renameSync(tmp, this.path);
      return true;
    } catch (err: unknown) {
      this.loadError = `could not write cache to ${this.path} (${String(err).slice(0, 120)})`;
      return false;
    }
  }

  /** Drop entries no live key refers to. Returns how many went. */
  prune(liveKeys: Iterable<string>): number {
    const live = new Set(liveKeys);
    let dropped = 0;
    for (const k of [...this.entries.keys()]) {
      if (!live.has(k)) {
        this.entries.delete(k);
        dropped += 1;
      }
    }
    return dropped;
  }
}
