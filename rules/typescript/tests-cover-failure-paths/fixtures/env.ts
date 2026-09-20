export type Env = Record<string, string | undefined>;

export function requireEnv(name: string, env: Env = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`environment variable ${name} is required`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string, env: Env = process.env): string {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function envFlag(name: string, env: Env = process.env): boolean {
  const value = (env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
