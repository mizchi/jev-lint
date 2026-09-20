/**
 * What each rule will cost, before anything is asked.
 *
 * A dry run prices the plan as a whole; a reader deciding which rule to
 * drop needs it per rule. A batch's questions are each rule's own, and
 * its state -- the file, the outline, the tests -- travels once for every
 * subject in it, so a rule pays for the state in proportion to the
 * subjects it put there. The shares sum to the plan.
 */
import { estimateTokens } from "./batch.ts";
import { USD_PER_MTOK } from "./jev.ts";
import type { Batch, Rule } from "./types.ts";

export interface RuleCost {
  rule: string;
  subjects: number;
  /** Batches the rule has a subject in. */
  requests: number;
  tokens: number;
  usd: number;
  /** Of the plan's tokens, 0..1. */
  share: number;
}

/** Every rule's cost, dearest first; a rule with no subject is a row at zero. */
export function costByRule(batches: Batch[], rules: Rule[]): RuleCost[] {
  const rows = new Map<string, RuleCost>(
    rules.map((r) => [r.id, { rule: r.id, subjects: 0, requests: 0, tokens: 0, usd: 0, share: 0 }]),
  );
  const row = (id: string): RuleCost => {
    if (!rows.has(id)) rows.set(id, { rule: id, subjects: 0, requests: 0, tokens: 0, usd: 0, share: 0 });
    return rows.get(id)!;
  };
  let total = 0;
  for (const b of batches) {
    total += b.estimatedTokens;
    const questionTokens = new Map(Object.entries(b.questions).map(([id, q]) => [id, estimateTokens(q)]));
    const asked = [...questionTokens.values()].reduce((a, n) => a + n, 0);
    // The state is what the batch weighs beyond its questions.
    const state = Math.max(0, b.estimatedTokens - asked);
    const perSubject = b.subjects.length > 0 ? state / b.subjects.length : 0;
    const seen = new Set<string>();
    for (const s of b.subjects) {
      const r = row(s.rule.id);
      r.subjects += 1;
      r.tokens += perSubject + (s.id ? (questionTokens.get(s.id) ?? 0) : 0);
      if (!seen.has(s.rule.id)) {
        seen.add(s.rule.id);
        r.requests += 1;
      }
    }
  }
  for (const r of rows.values()) {
    r.tokens = Math.round(r.tokens);
    r.usd = (r.tokens / 1e6) * USD_PER_MTOK;
    r.share = total > 0 ? r.tokens / total : 0;
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || a.rule.localeCompare(b.rule));
}

/**
 * The table a dry run prints: one line per rule that will be asked,
 * dearest first. A rule with no subject is not a line -- the run already
 * names the idle languages and the rules that matched nothing.
 */
export function formatCostByRule(all: RuleCost[]): string {
  const rows = all.filter((r) => r.subjects > 0);
  const width = Math.max(4, ...rows.map((r) => r.rule.length));
  const head = `${"rule".padEnd(width)}  subjects  requests    ~tokens       ~$  share`;
  const lines = rows.map(
    (r) =>
      `${r.rule.padEnd(width)}  ${String(r.subjects).padStart(8)}  ${String(r.requests).padStart(8)}  ${r.tokens.toLocaleString().padStart(9)}  ${`$${r.usd.toFixed(5)}`.padStart(8)}  ${`${Math.round(r.share * 100)}%`.padStart(5)}`,
  );
  return [head, ...lines].join("\n");
}
