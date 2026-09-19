import type { RunnerEnv, MaterializedFile, SandboxLike } from "./types";

type Adapter = "auto" | "service_binding" | "base_url";

export async function callRunner(env: RunnerEnv, route: string, bodyText: string): Promise<Response> {
  const adapter = readAdapter(env.MOONBIT_RUNNER_ADAPTER);
  const baseRaw = readEnvString(env.MOONBIT_RUNNER_HTTP_BASE_URL, readEnvString(env.MOONBIT_RUNNER_BASE_URL));
  const useServiceBinding = adapter === "service_binding" || (adapter === "auto" && env.MOONBIT_RUNNER_SERVICE !== undefined);

  if (useServiceBinding) {
    if (!env.MOONBIT_RUNNER_SERVICE) {
      throw new Error("missing env: MOONBIT_RUNNER_SERVICE (adapter=service_binding)");
    }
    return env.MOONBIT_RUNNER_SERVICE.fetch(
      new Request(`https://moonbit-runner.internal${route}`, { method: "POST", body: bodyText }),
    );
  }

  if (baseRaw.length === 0) {
    if (adapter === "base_url") {
      throw new Error("missing env: MOONBIT_RUNNER_HTTP_BASE_URL or MOONBIT_RUNNER_BASE_URL (adapter=base_url)");
    }
    throw new Error("missing env: MOONBIT_RUNNER_SERVICE or MOONBIT_RUNNER_BASE_URL");
  }
  const base = baseRaw.replace(/\/+$/, "");
  return fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyText });
}

export function readTimeoutMs(env: RunnerEnv): number {
  const raw = readEnvString(env.MOONBIT_RUNNER_TIMEOUT_MS, "30000");
  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("missing env: MOONBIT_RUNNER_TIMEOUT_MS");
  }
  return timeoutMs;
}

export async function materializeFiles(
  sandbox: SandboxLike,
  mountRoot: string,
  files: MaterializedFile[],
): Promise<{ file_count: number; total_bytes: number }> {
  const createdDirs = new Set<string>();
  const encoder = new TextEncoder();
  let totalBytes = 0;

  for (const file of files) {
    const normalized = normalizeAbsPath(file.path);
    if (normalized === null) {
      throw new Error(`invalid materialized path: ${String(file.path)}`);
    }
    const targetPath = `${mountRoot}${normalized}`;
    const targetDir = parentPath(targetPath);
    if (!createdDirs.has(targetDir)) {
      await sandbox.mkdir(targetDir, { recursive: true });
      createdDirs.add(targetDir);
    }
    const content = decodeBase64Utf8(file.content_base64);
    if (content === null) {
      throw new Error(`invalid utf-8 content: ${normalized}`);
    }
    totalBytes += encoder.encode(content).length;
    await sandbox.writeFile(targetPath, content);
  }

  return { file_count: files.length, total_bytes: totalBytes };
}

function readAdapter(raw: unknown): Adapter {
  const text = readEnvString(raw, "auto");
  if (text === "auto" || text === "service_binding" || text === "base_url") return text;
  throw new Error(`unsupported MOONBIT_RUNNER_ADAPTER: ${text}`);
}

function readEnvString(raw: unknown, fallback = ""): string {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
}

declare function normalizeAbsPath(path: unknown): string | null;
declare function parentPath(path: string): string;
declare function decodeBase64Utf8(input: string): string | null;
