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
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { FileIndex, isUnder } from "./files.ts";
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

/**
 * Every file under `paths` (files or directories) with one of the
 * extensions, relative to `cwd`, sorted. The walk is the run's shared one
 * when an index is given; a file the index knows from another root (the
 * paired arm's conventional test directories) is not one of these unless
 * it is under `paths`.
 */
export function findTextFiles(
  paths: string[],
  extensions: string[],
  cwd: string = process.cwd(),
  index: FileIndex = new FileIndex(cwd),
): string[] {
  const wanted = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));
  return index
    .list(paths)
    .filter((rel) => wanted.has(extname(rel).toLowerCase()) && paths.some((p) => isUnder(rel, p)));
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
  index: FileIndex = new FileIndex(cwd),
): Subject[] {
  const out: Subject[] = [];
  for (const rule of rules) {
    if (rule.subject !== "block" || !rule.split) continue;
    const header = new RegExp(rule.split);
    for (const file of findTextFiles(paths, rule.extensions ?? [], cwd, index)) {
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
