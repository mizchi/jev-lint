import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import type { Observation, Rule, Sample } from "./inspection.ts";

export class InspectionCache {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inspection_answers (key TEXT PRIMARY KEY, answer TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inspection_policies (scope TEXT PRIMARY KEY, rules TEXT NOT NULL);
    `);
  }
  get(key: string): Observation | undefined {
    const row = this.db.prepare("SELECT answer FROM inspection_answers WHERE key=?").get(key);
    if (row) return JSON.parse(String(row.answer));
  }
  save(key: string, answer: Observation) {
    this.db.prepare("INSERT OR IGNORE INTO inspection_answers VALUES (?, ?)").run(key, JSON.stringify(answer));
    return this.get(key)!;
  }
  rules(scope: string): Rule[] {
    const row = this.db.prepare("SELECT rules FROM inspection_policies WHERE scope=?").get(scope);
    return row ? JSON.parse(String(row.rules)) : [];
  }
  rewrite(scope: string, previous: readonly Rule[], next: readonly Rule[]) {
    const prev = JSON.stringify(previous);
    const update = this.db.prepare(`
      INSERT INTO inspection_policies(scope, rules) SELECT ?, ? WHERE ?='[]' OR EXISTS
        (SELECT 1 FROM inspection_policies WHERE scope=? AND rules=?)
      ON CONFLICT(scope) DO UPDATE SET rules=excluded.rules WHERE inspection_policies.rules=?
    `).run(scope, JSON.stringify(next), prev, scope, prev, prev);
    if (!update.changes) throw Error("Active policy changed concurrently; rerun to resume");
  }
  close() { this.db.close(); }
}

export interface Budget { remaining: number; attempts: number; hits: number; usd: number }
export async function observe(cache: InspectionCache, identity: string, item: Sample,
  ask: (item: Pick<Sample, "name" | "description">) => Promise<Observation>, budget: Budget, retries: number,
  transient: (err: unknown) => boolean) {
  const state = { name: item.name, description: item.description };
  const key = createHash("sha256").update(JSON.stringify([identity, state])).digest("hex");
  for (let attempt = 0; ; attempt++) {
    const saved = cache.get(key);
    if (saved) { budget.hits++; return saved; }
    if (budget.remaining <= 0) return undefined;
    budget.remaining--;
    budget.attempts++;
    let measured: Observation;
    try { measured = await ask(state); }
    catch (err) {
      if (!transient(err) || attempt >= retries) throw err;
      if (budget.remaining > 0) await delay(Math.min(250 * 2 ** attempt, 4000));
      continue;
    }
    if (typeof measured.defect !== "boolean" || !Number.isFinite(measured.usd) || measured.usd < 0 ||
      !Number.isFinite(measured.ms) || measured.ms < 0) throw Error("Invalid inspection observation");
    budget.usd += measured.usd;
    return cache.save(key, measured);
  }
}
