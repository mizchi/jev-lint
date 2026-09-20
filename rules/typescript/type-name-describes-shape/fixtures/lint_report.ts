import { readFileSync } from "node:fs";

export interface Config {
  errors: string[];
  warnings: string[];
  filesChecked: number;
  durationMs: number;
}

export interface LintOptions {
  rulesDir: string;
  failOn: "warning" | "error";
  maxWarnings?: number;
}

export type Severity = "info" | "warning" | "error";

export type ErrorHandler = {
  code: number;
  message: string;
  retryable: boolean;
};

export type Errors = Record<string, string[]>;

export type ParseResult = boolean;

export function parseFlags(argv: string[], out: Partial<LintOptions>): ParseResult {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rules") out.rulesDir = argv[++i];
    else if (arg === "--fail-on") out.failOn = argv[++i] as LintOptions["failOn"];
    else if (arg === "--max-warnings") out.maxWarnings = Number(argv[++i]);
    else return false;
  }
  return out.rulesDir !== undefined;
}

export function lint(opts: LintOptions, files: string[]): Config {
  const started = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (text.includes("debugger")) errors.push(`${file}: debugger statement`);
    if (/console\.log/.test(text)) warnings.push(`${file}: console.log`);
  }
  return { errors, warnings, filesChecked: files.length, durationMs: Date.now() - started };
}

export function groupByFile(report: Config): Errors {
  const byFile: Errors = {};
  for (const line of [...report.errors, ...report.warnings]) {
    const [file, ...rest] = line.split(": ");
    (byFile[file] ??= []).push(rest.join(": "));
  }
  return byFile;
}

export function classify(e: unknown): ErrorHandler {
  if (e instanceof Error && "code" in e && e.code === "ECONNRESET") {
    return { code: 503, message: "upstream reset the connection", retryable: true };
  }
  return { code: 500, message: e instanceof Error ? e.message : String(e), retryable: false };
}

export function exitCode(report: Config, opts: LintOptions): number {
  if (report.errors.length > 0) return 1;
  if (opts.failOn === "warning" && report.warnings.length > (opts.maxWarnings ?? 0)) return 1;
  return 0;
}
