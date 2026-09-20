import { readFileSync } from "node:fs";

export interface ServiceConfig {
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function readConfig(path: string): ServiceConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<ServiceConfig>;
  return {
    port: parsed.port ?? 8080,
    host: parsed.host ?? "127.0.0.1",
    logLevel: parsed.logLevel ?? "info",
  };
}

export type PortResult = { ok: true; port: number } | { ok: false; reason: string };

export function parsePort(raw: string): PortResult {
  const port = Number(raw);
  if (!Number.isInteger(port)) {
    return { ok: false, reason: `${raw} is not an integer` };
  }
  if (port < 1 || port > 65535) {
    return { ok: false, reason: `${port} is outside 1-65535` };
  }
  return { ok: true, port };
}

export const describeConfig = (config: ServiceConfig): string =>
  `${config.host}:${config.port} (log ${config.logLevel})`;
