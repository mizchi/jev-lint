import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { astGrepBin } from "./scan.ts";
import { API_KEY_VARS, fromEnv } from "./jev.ts";
import { LANGUAGES, type Rule, type CustomLanguages } from "./types.ts";

export function doctor({ apiKeyAvailable = !!fromEnv(API_KEY_VARS), binaryPath = astGrepBin(), nodeVersion = process.versions.node, rules = [], languages = {}, cwd = process.cwd() }: {
  apiKeyAvailable?: boolean; binaryPath?: string; nodeVersion?: string; rules?: Rule[]; languages?: CustomLanguages; cwd?: string;
} = {}) {
  const checks: Array<{ id: string; status: "available" | "missing"; remediation?: string }> = [];
  const add = (id: string, available: boolean, remediation: string) => checks.push({ id, status: available ? "available" : "missing", ...(available ? {} : { remediation }) });
  add("node", Number(nodeVersion.split(".")[0]) >= 24, "Use Node.js 24 or later.");
  let executable = false;
  try { accessSync(binaryPath, constants.X_OK); executable = true; } catch { /* A missing executable is a preflight result. */ }
  add("ast-grep", executable, "Install the pinned @ast-grep/cli dependency or configure JEV_LINT_AST_GREP.");
  add("api-key", apiKeyAvailable, "Set TYPESAFE_API_KEY or TYPESAFEAI_API_KEY for live model requests.");
  for (const language of new Set(rules.filter((r) => r.subject !== "block" && r.subject !== "commit" && r.subject !== "change").map((r) => r.language))) {
    if ((LANGUAGES as readonly string[]).includes(language)) continue;
    const parser = languages[language]?.libraryPath;
    add(`parser:${language}`, !!parser && existsSync(resolve(cwd, parser)), "Declare an installed parser library in trusted configuration.");
  }
  return { schema: "jev-lint-doctor-1", status: checks.some((c) => c.status === "missing") ? "partial" : "complete", modelRequests: 0, checks };
}
