/**
 * Blocks of text as subjects.
 *
 * The third source of subjects, after ast-grep and git, for files no
 * grammar parses but a header line structures: an sqlc query file split at
 * every `-- name: GetUser :one`, and anything else of that shape. A rule
 * says how with `split:`, a regex matched at the start of a line whose
 * named groups become the captures (`$NAME`, `$KIND`), and `extensions:`,
 * the files it applies to. A block runs from its header to the line before
 * the next, and travels as the subject's text; `state: located` adds the
 * file, `bare` does not. No matcher, so no loose-matcher caveat.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { Rule, Subject } from "./types.ts";

export interface TextBlock {
  /** 1-based line of the header. */
  line: number;
  /** 1-based last line of the block. */
  endLine: number;
  text: string;
  captured: Record<string, string>;
}

/** Split a file at every line matching `header`, oldest first; the text before the first header is not a block. */
export function splitBlocks(source: string, header: RegExp): TextBlock[] {
  const lines = source.split("\n");
  const flags = header.flags.replace("g", "").replace("y", "");
  const at = new RegExp(header.source, flags);
  const starts: Array<{ index: number; captured: Record<string, string> }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = at.exec(lines[i]!);
    if (m) starts.push({ index: i, captured: { ...(m.groups ?? {}) } });
  }
  return starts.map((s, k) => {
    // A block ends where the next begins, minus the blank lines between.
    let end = (starts[k + 1]?.index ?? lines.length) - 1;
    while (end > s.index && lines[end]!.trim() === "") end -= 1;
    return {
      line: s.index + 1,
      endLine: end + 1,
      text: lines.slice(s.index, end + 1).join("\n"),
      captured: s.captured,
    };
  });
}

/** Directories no source lives in. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "build", "target", "coverage", "vendor"]);

/** Every file under `paths` (files or directories) with one of the extensions, relative to `cwd`, sorted. */
export function findTextFiles(paths: string[], extensions: string[], cwd: string = process.cwd()): string[] {
  const wanted = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));
  const found = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIPPED.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && wanted.has(extname(e.name).toLowerCase())) found.add(relative(cwd, full).split(sep).join("/"));
    }
  };
  for (const p of paths) {
    const full = join(cwd, p);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full);
    else if (st.isFile() && wanted.has(extname(full).toLowerCase())) found.add(relative(cwd, full).split(sep).join("/"));
  }
  return [...found].sort();
}

/**
 * The subjects every block rule produces over `paths`. `read` is shared
 * with the runner so a file is read once and its text is on hand for the
 * `located` state.
 */
export function textSubjects(
  rules: Rule[],
  paths: string[],
  cwd: string = process.cwd(),
  read: (file: string) => string = (file) => readFileSync(join(cwd, file), "utf8"),
): Subject[] {
  const out: Subject[] = [];
  for (const rule of rules) {
    if (rule.subject !== "block" || !rule.split) continue;
    const header = new RegExp(rule.split);
    for (const file of findTextFiles(paths, rule.extensions ?? [], cwd)) {
      let source: string;
      try {
        source = read(file);
      } catch {
        continue;
      }
      for (const b of splitBlocks(source, header)) {
        out.push({
          rule,
          file,
          language: "Text",
          arm: rule.state,
          text: b.text,
          line: b.line,
          endLine: b.endLine,
          nodeKind: "block",
          enclosing: null,
          promoted: false,
          captured: b.captured,
        });
      }
    }
  }
  return out;
}
