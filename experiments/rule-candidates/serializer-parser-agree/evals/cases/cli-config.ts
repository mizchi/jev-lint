import { readFileSync, writeFileSync } from "node:fs";

export class ConfigError extends Error {}

export interface CliConfig {
  registry: string;
  token: string;
  retries: number;
  proxy?: string;
}

export function writeConfigFile(path: string, cfg: CliConfig): void {
  const out: Record<string, unknown> = {
    registry: cfg.registry,
    token: cfg.token,
    retries: cfg.retries,
  };
  if (cfg.proxy) out.proxy = cfg.proxy;
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
}

export function readConfigFile(path: string): CliConfig {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (typeof data.registry !== "string") throw new ConfigError("registry missing");
  if (typeof data.token !== "string") throw new ConfigError("token missing");
  if (typeof data.proxy !== "string") throw new ConfigError("proxy missing");
  return {
    registry: data.registry,
    token: data.token,
    retries: typeof data.retries === "number" ? data.retries : 3,
    proxy: data.proxy,
  };
}

export interface Prefs {
  theme: "light" | "dark" | "system";
  locale: string;
  telemetry: boolean;
}

export function writePrefsFile(path: string, prefs: Prefs): void {
  const out = { theme: prefs.theme, locale: prefs.locale, telemetry: prefs.telemetry };
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
}

export function readPrefsFile(path: string): Prefs {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // a missing or corrupt prefs file means defaults
  }
  const theme = data.theme === "light" || data.theme === "dark" ? data.theme : "system";
  // `lang` is what versions before 1.4 wrote
  const locale = typeof data.locale === "string" ? data.locale : typeof data.lang === "string" ? data.lang : "en";
  return { theme, locale, telemetry: data.telemetry !== false };
}
