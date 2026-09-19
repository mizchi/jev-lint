#!/usr/bin/env node
/**
 * Generate corpus/labels.json from the markers in the corpus files.
 *
 * Labels live as comments next to the code they label:
 *
 *     // DEFECT (fn-name-promises): reads as a predicate, returns a string.
 *     // CLEAN: does exactly what the name says.
 *
 * Deriving the JSON from those comments rather than maintaining line numbers by
 * hand is the difference between a corpus that stays true and one that silently
 * rots: inserting a line at the top of a file would otherwise shift every label
 * in it, and nothing would report that the corpus now labels the wrong code.
 *
 * "Code quality" has no referee, so a label here is an argument, not a fact.
 * Each one carries its reason in the comment so a reader can disagree with a
 * specific claim rather than with the aggregate. That matters when reading the
 * fitted thresholds: they are fitted to these opinions.
 *
 *   node corpus/build-labels.ts            write corpus/labels.json
 *   node corpus/build-labels.ts --check    fail if it is out of date
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const MARKER = /^\s*(?:\/\/|#)\s*(DEFECT|CLEAN)\b\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/;
const COMMENT_OR_BLANK = /^\s*(?:\/\/|#|\*|\/\*)|^\s*$/;

/** A module-level label attaches to the file, whose subject is reported at 1. */
const isModuleRule = (rule: string): boolean => rule.startsWith("module-");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|mjs|rs|py|go)$/.test(entry.name)) yield full;
  }
}

interface CorpusLabel {
  line: number;
  label: "bad" | "clean";
  rule?: string;
  window: number;
  reason: string;
}

function labelsFor(file: string): CorpusLabel[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const out: CorpusLabel[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = MARKER.exec(lines[i]!);
    if (!m) continue;
    const [, kind, rulesRaw, reason] = m;
    const rules = (rulesRaw ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // The subject is the first thing after the marker that is not more comment.
    // The comment lines skipped on the way are the rest of the reason -- a
    // reason wraps, and a truncated reason is the one thing in a corpus nobody
    // can check.
    let target = i + 1;
    const continuation: string[] = [];
    while (target < lines.length && COMMENT_OR_BLANK.test(lines[target]!)) {
      const cont = /^\s*(?:\/\/|#)\s?(.*)$/.exec(lines[target]!);
      if (cont && cont[1]!.trim() !== "" && !MARKER.test(lines[target]!)) {
        continuation.push(cont[1]!.trim());
      }
      target += 1;
    }
    const fullReason = [reason!.trim(), ...continuation].filter(Boolean).join(" ");

    const label = kind === "DEFECT" ? "bad" : "clean";
    if (rules.length === 0) {
      out.push({ line: target + 1, label, window: 2, reason: fullReason });
      continue;
    }
    for (const rule of rules) {
      if (isModuleRule(rule)) {
        // Both language variants of a module rule; `subject: file` reports at 1.
        for (const id of [rule, `${rule}-rust`, `${rule}-js`]) {
          out.push({ line: 1, label, rule: id, window: 1_000_000, reason: fullReason });
        }
        continue;
      }
      // Rules are written per language with a suffix on the non-default
      // variants, and a marker names the CONCEPT rather than the variant. The
      // suffixes that do not exist for a given rule simply never match
      // anything, which costs nothing.
      for (const id of [rule, `${rule}-rust`, `${rule}-js`]) {
        out.push({ line: target + 1, label, rule: id, window: 2, reason: fullReason });
      }
    }
  }
  return out;
}

/**
 * Hand-written labels, merged in from every `labels.hand.json` under the
 * corpus.
 *
 * Markers are the right tool for most of the corpus, and the wrong one for two
 * kinds of file. A rule that reads comments or the text around a match sees a
 * `// DEFECT` line as part of its subject; and JSON and YAML have no comment
 * the marker regex reads. Those files are labelled by hand, in the same shape
 * `calibrate` consumes, keyed by path from the repository root. Same rules as
 * the generated ones: `bad` or `clean`, a reason, and a `window` that says how
 * loosely the line is matched.
 */
function* handLabelFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* handLabelFiles(full);
    else if (entry.name === "labels.hand.json") yield full;
  }
}

function build(): Record<string, unknown> {
  const labels: Record<string, unknown> = {
    // Anything the corpus does not mark is clean. Enumerating the clean cases
    // by line would be busywork that goes stale on the next edit.
    $default: "clean",
    $note:
      "Generated by corpus/build-labels.ts from DEFECT/CLEAN comments in the corpus, plus every corpus/**/labels.hand.json. Do not edit by hand.",
  };
  for (const file of walk(join(ROOT, "corpus"))) {
    const rel = relative(ROOT, file);
    const found = labelsFor(file);
    if (found.length > 0) labels[rel] = found;
  }
  for (const file of handLabelFiles(join(ROOT, "corpus"))) {
    const hand = JSON.parse(readFileSync(file, "utf8")) as Record<string, CorpusLabel[] | string>;
    for (const [path, list] of Object.entries(hand)) {
      if (path.startsWith("$") || !Array.isArray(list)) continue;
      const existing = (labels[path] as CorpusLabel[] | undefined) ?? [];
      labels[path] = [...existing, ...list];
    }
  }
  return labels;
}

const target = join(ROOT, "corpus", "labels.json");
const built = `${JSON.stringify(build(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current !== built) {
    process.stderr.write("corpus/labels.json is out of date; run node corpus/build-labels.ts\n");
    process.exit(1);
  }
  process.stdout.write("corpus/labels.json is up to date\n");
} else {
  writeFileSync(target, built);
  const counts = Object.entries(JSON.parse(built) as Record<string, CorpusLabel[] | string>)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => {
      const list = v as CorpusLabel[];
      return `${k}: ${list.filter((l) => l.label === "bad").length} bad, ${list.filter((l) => l.label === "clean").length} clean`;
    });
  process.stdout.write(`${target}\n${counts.map((c) => `  ${c}`).join("\n")}\n`);
}
