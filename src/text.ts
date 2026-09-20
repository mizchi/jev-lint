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
import { extname, isAbsolute, join } from "node:path";
import { FileIndex, isUnder, walkName } from "./files.ts";
import type { Rule, Subject } from "./types.ts";

/**
 * Characters of a block that travel in the question. About 14k tokens at
 * the measured ratio for prose, which leaves the request budget room for
 * the questions beside it. Over it, the block is cut at a line boundary
 * and the question says so; JevSlop refuses to truncate an article, and
 * this tool refuses to send one it cannot name as cut.
 */
export const MAX_BLOCK_CHARS = 48_000;

export interface TextBlock {
  /** 1-based line of the header. */
  line: number;
  /** 1-based last line of the block. */
  endLine: number;
  text: string;
  captured: Record<string, string>;
}

/**
 * Split a file at every line matching `header`, first to last; the text
 * before the first header is not a block. With no header the whole file is
 * one block, and an empty file is none.
 */
export function splitBlocks(source: string, header: RegExp | null): TextBlock[] {
  const lines = source.split("\n");
  if (header === null) {
    let end = lines.length - 1;
    while (end >= 0 && lines[end]!.trim() === "") end -= 1;
    if (end < 0) return [];
    return [{ line: 1, endLine: end + 1, text: lines.slice(0, end + 1).join("\n"), captured: {} }];
  }
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
 * extensions, sorted, named the way the walk names them: relative to `cwd`
 * when under it, absolute otherwise. The walk is the run's shared one when
 * an index is given; a file the index knows from another root (the paired
 * arm's conventional test directories) is not one of these unless it is
 * under `paths`.
 */
export function findTextFiles(
  paths: string[],
  extensions: string[],
  cwd: string = process.cwd(),
  index: FileIndex = new FileIndex(cwd),
): string[] {
  const wanted = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));
  // The roots named as the walk names files, so a root outside the cwd
  // (absolute in the walk, `../x` as given) still contains its own files.
  const roots = paths.map((p) => walkName(isAbsolute(p) ? p : join(cwd, p), cwd));
  return index
    .extend(paths)
    .filter((rel) => wanted.has(extname(rel).toLowerCase()) && roots.some((r) => isUnder(rel, r) || rel === r));
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
  read: (file: string) => string = (file) => readFileSync(isAbsolute(file) ? file : join(cwd, file), "utf8"),
  index: FileIndex = new FileIndex(cwd),
): Subject[] {
  const out: Subject[] = [];
  for (const rule of rules) {
    if (rule.subject !== "block") continue;
    const header = rule.split ? new RegExp(rule.split) : null;
    for (const file of findTextFiles(paths, rule.extensions ?? [], cwd, index)) {
      let source: string;
      try {
        source = read(file);
      } catch {
        continue;
      }
      for (const b of splitBlocks(source, header)) {
        const cut = b.text.length > MAX_BLOCK_CHARS;
        const text = cut ? b.text.slice(0, b.text.lastIndexOf("\n", MAX_BLOCK_CHARS)) : b.text;
        out.push({
          rule,
          file,
          language: "Text",
          arm: rule.state,
          text,
          ...(cut ? { textCut: { of: b.text.length } } : {}),
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
