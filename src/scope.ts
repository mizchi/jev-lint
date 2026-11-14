import { execFileSync } from "node:child_process";
import { readdirSync, lstatSync, existsSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { SKIPPED_DIRECTORIES, isExcludedBy } from "./files.ts";
import { extensionsOf } from "./rules.ts";
import type { Rule, CustomLanguages } from "./types.ts";

const builtin: Record<string, string[]> = {
  Bash: ["sh", "bash"], C: ["c", "h"], Cpp: ["cpp", "cc", "cxx", "hpp", "h"], CSharp: ["cs"], Css: ["css"], Dart: ["dart"],
  Elixir: ["ex", "exs"], Go: ["go"], Haskell: ["hs"], Html: ["html", "htm"], Java: ["java"], JavaScript: ["js", "mjs", "cjs"],
  Json: ["json"], Jsx: ["jsx", "js", "mjs"], Kotlin: ["kt", "kts"], Lua: ["lua"], Php: ["php"], Python: ["py", "pyi"], Ruby: ["rb"],
  Rust: ["rs"], Scala: ["scala", "sc"], Solidity: ["sol"], Swift: ["swift"], Tsx: ["tsx"], TypeScript: ["ts", "cts", "mts"], Yaml: ["yaml", "yml"],
};
export interface ScopeOptions { cwd?: string; paths: string[]; rules: Rule[]; exclude?: string[]; languages?: CustomLanguages; changedPaths?: string[]; maxEntries?: number }
export type ScopeReason = "eligible" | "user-exclude" | "gitignore" | "outside-change" | "no-rule" | "unsupported" | "missing-parser" | "symlink" | "hidden";
export interface ScopeExplanation {
  schema: "jev-lint-scope-1"; status: "complete" | "partial"; qualityVerdict: "UNREVIEWED"; modelRequests: 0;
  files: Array<{ path: string; reason: ScopeReason; rules: string[] }>;
  counts: Record<ScopeReason, number>;
  prunedDirectories: Array<{ path: string; reason: "hidden" | "builtin-directory" }>;
  issues: Array<{ path: string; code: "unreadable" | "outside-root" | "entry-budget" | "ignore-query-failed" }>;
  selection: "file-eligibility-only";
}

/** Inventory only: matching subjects and obtaining verdicts are separate stages. */
export function explainScope({ cwd = process.cwd(), paths, rules, exclude = [], languages = {}, changedPaths, maxEntries = 10000 }: ScopeOptions): ScopeExplanation {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Array.isArray(paths)) throw new Error("invalid scope options");
  cwd = resolve(cwd);
  const files: ScopeExplanation["files"] = [], prunedDirectories: ScopeExplanation["prunedDirectories"] = [], issues: ScopeExplanation["issues"] = [];
  const visited = new Set<string>(); let entries = 0, exhausted = false;
  const name = (path: string) => relative(cwd, path).split(sep).join("/") || ".";
  const walk = (path: string, explicit = false) => {
    if (visited.has(path) || exhausted) return; visited.add(path);
    const rel = name(path);
    if (rel === ".." || rel.startsWith("../")) { issues.push({ path: "<outside-root>", code: "outside-root" }); return; }
    if (++entries > maxEntries) { exhausted = true; issues.push({ path: rel, code: "entry-budget" }); return; }
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) { files.push({ path: rel, reason: "symlink", rules: [] }); return; }
      if (stat.isDirectory()) {
        if (!explicit && (basename(path).startsWith(".") || SKIPPED_DIRECTORIES.has(basename(path)))) {
          prunedDirectories.push({ path: rel, reason: basename(path).startsWith(".") ? "hidden" : "builtin-directory" }); return;
        }
        for (const entry of readdirSync(path).sort()) walk(resolve(path, entry));
      } else if (stat.isFile()) files.push({ path: rel, reason: !explicit && basename(path).startsWith(".") ? "hidden" : "eligible", rules: [] });
    } catch { issues.push({ path: rel, code: "unreadable" }); }
  };
  for (const path of paths.length ? paths : ["."]) walk(resolve(cwd, path), true);
  const ignored = new Set<string>();
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: "ignore" });
    try {
      const output = files.length ? execFileSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], { cwd, input: files.map((f) => f.path).join("\0") + "\0", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }) : "";
      for (const path of output.split("\0").filter(Boolean)) ignored.add(path);
    } catch (error) { if ((error as { status?: number }).status !== 1) issues.push({ path: ".", code: "ignore-query-failed" }); }
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT" || existsSync(resolve(cwd, ".git"))) issues.push({ path: ".", code: "ignore-query-failed" });
  }
  for (const file of files) {
    if (file.reason !== "eligible") continue;
    if (exclude.some((entry) => isExcludedBy(file.path, entry))) { file.reason = "user-exclude"; continue; }
    if (ignored.has(file.path)) { file.reason = "gitignore"; continue; }
    if (changedPaths && !changedPaths.includes(file.path)) { file.reason = "outside-change"; continue; }
    const extension = extname(file.path).slice(1).toLowerCase();
    const applicable = rules.filter((rule) => rule.subject === "block" ? rule.extensions.includes(extension) || !!rule.filenames?.includes(basename(file.path))
      : rule.subject !== "commit" && rule.subject !== "change" && (builtin[rule.language] ?? extensionsOf(rule.language, languages)).includes(extension));
    file.rules = applicable.map((rule) => rule.languageDir ? `${rule.languageDir}/${rule.id}` : rule.id).sort();
    if (!applicable.length) file.reason = Object.values(builtin).some((exts) => exts.includes(extension)) ? "no-rule" : "unsupported";
    else if (applicable.every((rule) => rule.subject !== "block" && !builtin[rule.language] && (!languages[rule.language]?.libraryPath || !existsSync(resolve(cwd, languages[rule.language]!.libraryPath))))) file.reason = "missing-parser";
  }
  const counts: ScopeExplanation["counts"] = { eligible: 0, "user-exclude": 0, gitignore: 0, "outside-change": 0, "no-rule": 0, unsupported: 0, "missing-parser": 0, symlink: 0, hidden: 0 };
  for (const file of files) counts[file.reason]++;
  return { schema: "jev-lint-scope-1", files: files.sort((a, b) => a.path.localeCompare(b.path)), prunedDirectories, issues, counts,
    status: issues.length || counts["missing-parser"] || files.length > 0 && !counts.eligible ? "partial" : "complete", qualityVerdict: "UNREVIEWED", modelRequests: 0, selection: "file-eligibility-only" };
}
