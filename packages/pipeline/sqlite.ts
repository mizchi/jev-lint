import { DatabaseSync } from "node:sqlite";
import type { DecisionStore } from "./pipeline.ts";

export class Decisions implements DecisionStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("CREATE TABLE IF NOT EXISTS decisions (key TEXT PRIMARY KEY, score REAL NOT NULL CHECK(score BETWEEN 0 AND 1))");
  }
  get(key: string): number | undefined {
    const row = this.db.prepare("SELECT score FROM decisions WHERE key = ?").get(key);
    return row?.score as number | undefined;
  }
  save(key: string, score: number): number {
    this.db.prepare("INSERT OR IGNORE INTO decisions VALUES (?, ?)").run(key, score);
    return this.get(key)!;
  }
  close() { this.db.close(); }
}
