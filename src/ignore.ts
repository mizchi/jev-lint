/**
 * Suppression comments: `jev-lint-ignore-file` and `jev-lint-ignore-next-line`.
 *
 * Two decisions worth stating, because both cost something.
 *
 * **Matched in the raw text, not the parse tree.** One anchored regex covers
 * `//`, `#`, `/* *\/`, `--` and `<!-- -->`, so a new language needs nothing
 * here -- the same reason the structural probes are ast-grep queries rather
 * than a parser. The cost is that this cannot tell a comment from a string
 * containing one, which is why the pattern is ANCHORED to the start of the
 * line: a marker has to be the first thing on its line after whitespace and a
 * comment opener. A string literal holding the same text, as this repository's
 * own tests do, sits after an `=` or a `(` and is not matched. An unanchored
 * pattern would let a test fixture silence the file it is written in.
 *
 * **Applied before asking, not after.** An ignored subject is never sent, so a
 * suppression saves its tokens. That makes it the cheapest possible way to
 * quiet a rule, and it also means a suppression can hide a rule that would have
 * fired -- so the count is reported on every run, the same as the count of
 * rules that matched nothing. A silent suppression and a silent matcher are the
 * same failure.
 */
import type { IgnoreDirective } from "./types.ts";

/**
 * One anchored marker per line.
 *
 * `(?:\/\/|#|\/\*|\*|--|<!--)` covers every comment opener in the languages
 * ast-grep supports, plus the leading `*` of a continued block comment.
 *
 * The rule list runs to the end of the line and the CLOSER is stripped
 * afterwards, by `CLOSER` below. Excluding the closers inside the character
 * class instead is the obvious-looking version and it is wrong: `-` is the
 * first character of `-->`, and excluding it truncated every shipped rule id at
 * its first hyphen, so `fn-name-promises` suppressed a rule called `fn`.
 */
const MARKER =
  /^[ \t]*(?:\/\/|#|\/\*|\*|--|<!--)[ \t]*jev-lint-ignore-(file|next-line)\b[ \t:]*(.*)$/;

/** A trailing block- or HTML-comment closer, which is not part of a rule id. */
const CLOSER = /\s*(?:\*\/|-->)\s*$/;

/** What a file's suppression comments add up to. */
export interface FileIgnores {
  /** Non-null when the whole file is suppressed; the rules it names, or [] for all. */
  file: IgnoreDirective | null;
  /** Target line (1-based) -> the rules suppressed there, or [] for all. */
  lines: Map<number, IgnoreDirective>;
}

const EMPTY: FileIgnores = { file: null, lines: new Map() };

/** No suppressions. Shared, so a file without any costs nothing. */
export function noIgnores(): FileIgnores {
  return EMPTY;
}

/**
 * Read a file's suppression comments.
 *
 * `jev-lint-ignore-next-line` on line n suppresses line n+1, which is the line a
 * finding is REPORTED at -- not the first line of whatever range the question
 * judged. Those differ when `subject: enclosing` promotes a match to its
 * container, and the reported line is the one someone reads in the output, so
 * it is the one a suppression has to match.
 */
export function parseIgnores(source: string): FileIgnores {
  if (!source.includes("jev-lint-ignore-")) return EMPTY;

  let file: IgnoreDirective | null = null;
  const lines = new Map<number, IgnoreDirective>();
  const src = source.split("\n");
  for (let i = 0; i < src.length; i += 1) {
    const m = MARKER.exec(src[i]!);
    if (!m) continue;
    const rules = (m[2] ?? "")
      .replace(CLOSER, "")
      .split(/[\s,]+/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (m[1] === "file") {
      // Several file-level markers union their rule lists, and any one of them
      // naming no rules suppresses everything.
      if (!file) file = rules;
      else if (file.length === 0 || rules.length === 0) file = [];
      else file = [...new Set([...file, ...rules])];
    } else {
      const target = i + 2; // 1-based, and the NEXT line
      const existing = lines.get(target);
      if (!existing) lines.set(target, rules);
      else if (existing.length === 0 || rules.length === 0) lines.set(target, []);
      else lines.set(target, [...new Set([...existing, ...rules])]);
    }
  }
  return { file, lines };
}

/** Is this rule suppressed at this reported line? */
export function isIgnored(ignores: FileIgnores, line: number, ruleId: string): boolean {
  const covers = (d: IgnoreDirective | undefined | null): boolean =>
    d != null && (d.length === 0 || d.includes(ruleId));
  return covers(ignores.file) || covers(ignores.lines.get(line));
}

/**
 * Rule ids named in suppressions that no loaded rule answers to.
 *
 * A typo in a suppression is invisible in the worst way: the rule it meant to
 * quiet keeps firing and the author believes it is handled. Reported with the
 * other loud configuration errors.
 */
export function unknownIgnoredRules(
  perFile: Iterable<FileIgnores>,
  ruleIds: Iterable<string>,
): string[] {
  const known = new Set(ruleIds);
  const unknown = new Set<string>();
  for (const ig of perFile) {
    for (const id of ig.file ?? []) if (!known.has(id)) unknown.add(id);
    for (const rules of ig.lines.values()) for (const id of rules) if (!known.has(id)) unknown.add(id);
  }
  return [...unknown].sort();
}

/**
 * The new name of a suppressed id that no longer exists, when it is one of
 * the pre-0.3 language variants: `fn-name-promises-rust` is
 * `rust/fn-name-promises` now, and the plain id names every language.
 * Null when the id is unknown for some other reason.
 */
export function renamedRuleHint(id: string, ruleIds: Iterable<string>): string | null {
  const m = /^(.+)-(rust|js)$/.exec(id);
  if (!m) return null;
  const known = new Set(ruleIds);
  return known.has(m[1]!) ? `${m[1]} (the -${m[2]} suffix went in 0.3.0; the id names every language)` : null;
}
