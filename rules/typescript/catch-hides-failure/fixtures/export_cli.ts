import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cache, Db, Settings, Upstream } from "../types";
import { logger } from "../logger";

const DEFAULT_SETTINGS: Settings = { batchSize: 500, format: "csv" };

export async function exportReport(db: Db, outPath: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "report-"));
  try {
    const rows = await db.query("select * from orders where exported_at is null");
    await writeFile(join(tmp, "report.csv"), toCsv(rows));
    await rename(join(tmp, "report.csv"), outPath);
  } finally {
    try {
      await rm(tmp, { recursive: true });
    } catch (e) {
      logger.debug("could not remove temp dir", { tmp, error: e });
    }
  }
  return outPath;
}

export async function readSettings(path: string): Promise<Settings> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Settings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS;
    throw e;
  }
}

export async function resolveUpstream(sources: Upstream[]): Promise<string> {
  let lastError: unknown;
  for (const source of sources) {
    try {
      return await source.resolve();
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error("no upstream reachable", { cause: lastError });
}

export async function prewarm(cache: Cache, keys: string[]): Promise<{ primed: number; failed: string[] }> {
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await cache.prime(key);
    } catch (e) {
      logger.warn("could not prime key", { key, error: e });
      failed.push(key);
    }
  }
  return { primed: keys.length - failed.length, failed };
}

export async function countPending(db: Db): Promise<number> {
  try {
    const [row] = await db.query("select count(*) as n from orders where exported_at is null");
    return Number(row.n);
  } catch (e) {
    logger.warn("countPending failed", { error: e });
    return 0;
  }
}

export async function main(argv: string[], db: Db): Promise<void> {
  try {
    const settings = await readSettings(argv[2] ?? "export.json");
    const out = await exportReport(db, argv[3] ?? `orders.${settings.format}`);
    console.log(out);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const header = Object.keys(rows[0]);
  return [header.join(","), ...rows.map((r) => header.map((h) => String(r[h] ?? "")).join(","))].join("\n");
}

export async function isUpstreamHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return true;
  }
}

export async function removeArtifact(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function lastRunAt(path: string): Date | undefined {
  try {
    const text = JSON.parse(require("node:fs").readFileSync(path, "utf8")) as { lastRunAt: string };
    return new Date(text.lastRunAt);
  } catch {
    return undefined;
  }
}
