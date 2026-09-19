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
 *     sha256(schema, rule draft, arm, subject text)
 *
 * so editing a rule's sentence invalidates that rule's verdicts and nothing
 * else, moving a function between files keeps its verdict, and -- deliberately
 * -- changing a THRESHOLD invalidates nothing at all. Recalibration must be
 * free, or it will not be done.
 *
 * What is NOT in the key is the rest of the file, even though the file is in
 * the state on the `located` and `full` arms. That is a known and accepted
 * imprecision: keying on whole-file content would invalidate every verdict in
 * a file on every keystroke, which is not a cache. `jevlint check --force` is
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
import { SCHEMA, ruleTextHash } from "./rules.mjs";

export const DEFAULT_CACHE_PATH = ".jevlint-cache.json";

export function verdictKey(rule, arm, subjectText) {
  return createHash("sha256")
    .update([SCHEMA, rule.id, ruleTextHash(rule), arm, subjectText].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

export class Cache {
  constructor(path = DEFAULT_CACHE_PATH) {
    this.path = path;
    this.entries = new Map();
    this.meta = { schema: SCHEMA };
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.loadError = null;
  }

  static load(path = DEFAULT_CACHE_PATH) {
    const cache = new Cache(path);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
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
    } catch (err) {
      if (err?.code !== "ENOENT") {
        cache.loadError = `cache at ${path} unreadable (${String(err).slice(0, 120)}); ignoring it`;
      }
    }
    return cache;
  }

  get(key, kind) {
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

  set(key, answer, provenance = {}) {
    if (!answer || typeof answer.value !== "number") return;
    this.entries.set(key, {
      value: answer.value,
      confidence: answer.confidence ?? null,
      kind: answer.kind,
      // Provenance is for humans reading the file and for `jevlint gaps`;
      // nothing keys on it.
      ...provenance,
      at: new Date().toISOString(),
    });
    this.writes += 1;
  }

  save({ model = null, extra = {} } = {}) {
    const payload = {
      schema: SCHEMA,
      model,
      written: new Date().toISOString(),
      ...extra,
      entries: Object.fromEntries(this.entries),
    };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // Write-then-rename, so an interrupted save cannot leave a half-written
      // cache that the next run would report as a schema error.
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
      renameSync(tmp, this.path);
      return true;
    } catch (err) {
      this.loadError = `could not write cache to ${this.path} (${String(err).slice(0, 120)})`;
      return false;
    }
  }

  /** Drop entries no live key refers to. Returns how many went. */
  prune(liveKeys) {
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
