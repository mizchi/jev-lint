import { readFile } from "node:fs/promises";

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  delayMs: number;
}

export async function fetchOrder(baseUrl: string, id: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}/orders/${id}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) {
    throw new Error("request timed out");
  }
  if (!res.ok) {
    throw new Error(`unexpected status ${res.status} fetching order ${id}`);
  }
  return res.json();
}

export function readClientConfig(env: NodeJS.ProcessEnv): ClientConfig {
  const apiKey = env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is not set");
  }
  const baseUrl = env.API_BASE_URL;
  if (!baseUrl) {
    throw new Error("API_KEY is not set");
  }
  return { apiKey, baseUrl };
}

export async function loadRetryPolicy(path: string): Promise<RetryPolicy> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    throw new Error(`failed to read retry policy at ${path}`, { cause: e });
  }
  const parsed = JSON.parse(text) as Partial<RetryPolicy>;
  if (typeof parsed.maxAttempts !== "number") {
    throw new Error("retry policy: maxAttempts must be a number");
  }
  return { maxAttempts: parsed.maxAttempts, delayMs: parsed.delayMs ?? 250 };
}

export function runCommand(name: string, commands: Map<string, () => Promise<void>>): Promise<void> {
  const cmd = commands.get(name);
  if (!cmd) {
    throw new Error(`unknown command: ${name}`);
  }
  return cmd();
}

export function applyMigration(step: { name: string; run: () => boolean }): void {
  const ok = step.run();
  if (!ok) {
    throw new Error("migration failed");
  }
}

export function parseVersion(header: string | null): 1 | 2 {
  switch (header) {
    case null:
    case "1":
      return 1;
    case "2":
      return 2;
    default:
      throw new Error(`unsupported api version: ${header}`);
  }
}
