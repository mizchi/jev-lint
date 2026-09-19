import type { Database } from "./db";
import type { S3Client } from "./s3";
import type { Server } from "node:http";

export async function ensureIndex(db: Database, table: string, column: string): Promise<void> {
  await db.exec(`CREATE INDEX idx_${table}_${column} ON ${table} (${column})`);
}

type Handler = (payload: unknown) => void;
const handlers: Array<{ event: string; fn: Handler }> = [];

export function registerHandler(event: string, fn: Handler): void {
  handlers.push({ event, fn });
}

export async function setupDatabase(db: Database): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL)`);
  await db.exec(`ALTER TABLE users ADD COLUMN created_at INTEGER`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`);
}

export function installShutdownHooks(server: Server, onClose: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, closing`);
    server.close();
    await onClose();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
}

export async function upsertUser(db: Database, user: UserRow): Promise<void> {
  await db.run("INSERT INTO users (id, email, name) VALUES (?, ?, ?)", user.id, user.email, user.name);
}

type Command = (args: string[]) => Promise<number>;
const commands = new Map<string, Command>();

export function registerCommand(name: string, command: Command): void {
  commands.set(name, command);
}

export async function ensureBucket(s3: S3Client, name: string): Promise<void> {
  try {
    await s3.headBucket(name);
    return;
  } catch (err) {
    if ((err as { code?: string }).code !== "NotFound") throw err;
  }
  await s3.createBucket(name);
}

interface Logger {
  level: string;
  log(msg: string): void;
}

let logger: Logger = { level: "info", log: (msg) => console.log(msg) };

export function setupLogger(level: string): Logger {
  logger = {
    level,
    log: (msg) => {
      if (level !== "silent") console.log(`[${level}] ${msg}`);
    },
  };
  return logger;
}

interface App {
  locals: Record<string, unknown>;
  use(fn: (req: unknown, res: unknown, next: () => void) => void): void;
}

export function installRequestId(app: App): void {
  if (app.locals.requestIdInstalled) return;
  app.use((req, _res, next) => {
    (req as { id?: string }).id = crypto.randomUUID();
    next();
  });
  app.locals.requestIdInstalled = true;
}

export async function upsertSetting(db: Database, key: string, value: string): Promise<void> {
  await db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const scheduled = new Map<string, NodeJS.Timeout>();

export function registerCron(name: string, everyMs: number, task: () => void): void {
  const existing = scheduled.get(name);
  if (existing) clearInterval(existing);
  scheduled.set(name, setInterval(task, everyMs));
}

import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_WORKSPACE_CONFIG = { version: 1, cacheDir: ".cache" };

export async function setupWorkspace(dir: string): Promise<void> {
  await writeFile(join(dir, "workspace.json"), JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2));
  await appendFile(join(dir, ".gitignore"), "\n.cache/\n");
}
