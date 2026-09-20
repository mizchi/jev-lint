import { readFile } from "node:fs/promises";

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("missing required option: --base-url");
  }
  const url = new URL(trimmed);
  return url.toString().replace(/\/+$/, "");
}

export async function readPayload(params: {
  inline: string | undefined;
  filePath: string | undefined;
  required?: boolean;
}): Promise<Record<string, unknown>> {
  if (params.inline) {
    return JSON.parse(params.inline);
  }
  if (params.filePath) {
    return JSON.parse(await readFile(params.filePath, "utf8"));
  }
  if (params.required === true) {
    throw new Error("missing required option: --payload or --payload-file");
  }
  return {};
}

export function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error("missing required option: --port");
  }
  return Number(raw);
}
