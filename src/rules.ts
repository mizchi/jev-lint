/**
 * Rule loading and validation.
 *
 * A jev-lint rule is an ast-grep rule with one extra field: `ask`, the
 * natural-language predicate. The division of labour is the entire idea:
 *
 *   rule:   WHICH nodes get judged -- exact, free, no model involved.
 *           ast-grep's own matcher, so `pattern`, `kind`, `regex`, `all`/`any`/
 *           `not`, the relational `inside`/`has`/`follows`/`precedes`, `utils`
 *           and `constraints` all work unchanged.
 *   ask:    WHETHER a matched node is a violation -- the part you cannot write
 *           as a matcher without a week of AST work.
 *
 * Write the matcher to OVER-match on purpose. It is the half that fails
 * SILENTLY: a node the matcher missed is never asked about and never appears in
 * any report, so no threshold can recover it. The sentence is the half that
 * fails loudly -- every score is visible in `jev-lint gaps`. Level 0 of the
 * score scale ("the rule does not apply to this code at all") exists precisely
 * so the model can say "your matcher caught something irrelevant", which is
 * cheaper to read in a report than to prevent by hand-tightening a matcher.
 *
 * Validation never throws. A malformed rule is dropped with a reason and the
 * reason is reported loudly, because a rule that silently failed to load looks
 * exactly like a rule that found nothing.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import YAML from "yaml";
import {
  GROUPINGS,
  KINDS,
  LANGUAGES,
  LANGUAGE_DIRS,
  PROBE_PREFIX,
  STATE_ARMS,
  SUBJECTS,
  type Criterion,
  type CriterionDetail,
  type Grouping,
  type Language,
  type NoulCriteria,
  type Rule,
  type RuleKind,
  type RuleResult,
  type Severity,
  type StateArm,
  type SubjectMode,
} from "./types.ts";

// Re-exported rather than redefined. `types.ts` owns the vocabulary so a new
// arm or kind cannot be added to the validator and missed by the type, and
// these re-exports keep every existing import site pointing at one definition.
export { GROUPINGS, KINDS, LANGUAGES, STATE_ARMS, SUBJECTS };
export type {
  Criterion,
  CriterionDetail,
  Grouping,
  Language,
  NoulCriteria,
  Rule,
  RuleKind,
  RuleResult,
  Severity,
  StateArm,
  SubjectMode,
};

/** Bumped when question construction or the scales change. Part of cache keys. */
export const SCHEMA = "jev-lint-2";


const LANG_ALIASES: Record<string, Language> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "Tsx",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "Jsx",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
  rust: "Rust",
  py: "Python",
  python: "Python",
  go: "Go",
  golang: "Go",
  html: "Html",
  css: "Css",
  "c++": "Cpp",
  cpp: "Cpp",
  "c#": "CSharp",
  csharp: "CSharp",
  rb: "Ruby",
  ruby: "Ruby",
  java: "Java",
  kt: "Kotlin",
  kotlin: "Kotlin",
  php: "Php",
  swift: "Swift",
  scala: "Scala",
  sh: "Bash",
  bash: "Bash",
  lua: "Lua",
  dart: "Dart",
  elixir: "Elixir",
  haskell: "Haskell",
  json: "Json",
  yaml: "Yaml",
  solidity: "Solidity",
};


/**
 * The score scale, shared by every `kind: score` rule.
 *
 * Ordered by how much the node breaks the rule. The levels never mention what
 * any particular rule IS -- that arrives per question as the `ask` text -- so
 * one scale serves every rule anyone writes.
 *
 * Asking an ordered conclusion as a `score` rather than a `choice` is not a
 * style preference: a `choice` throws the ordering away, and adjacent levels
 * then split the probability mass and come back as a low confidence that no
 * threshold can separate from genuine uncertainty.
 */
export const SCORE_LEVELS = [
  "The rule does not apply to this code at all: the matcher caught something the rule was not written about.",
  "The rule applies and this code satisfies it: it already does what the rule asks for.",
  "The rule applies and this code arguably breaks it: a reviewer could raise it, and could reasonably let it go.",
  "The rule applies and this code clearly breaks it: a reviewer would ask for a change.",
];

export const SCORE_LEVEL_NAMES = ["not-applicable", "satisfied", "arguable", "violation"];

/**
 * Default cutoff for a `score` rule: 2.0.
 *
 * This is a level boundary, not a tuned number, and it is the one default worth
 * defending. Level 1 means the code SATISFIES the rule, so reporting a level-1
 * node is not a false positive you can calibrate away -- it is the rule firing
 * backwards.
 */
export const DEFAULT_SCORE_AT = 2.0;

/**
 * Default cutoff for a `noul` rule: 0.5.
 *
 * Unlike the score default this one is a placeholder and nothing more. Nouls
 * answer on per-question scales that are not comparable: in published
 * measurements the probability a criterion returns for its OWN defect class
 * ranged from 0.20 to 0.94 across eight same-shaped questions, and the two
 * coldest were not broken -- their ranking was fine, they simply never reached
 * a shared threshold. So a single cutoff across noul rules is a bug, and
 * `jev-lint calibrate` exists to replace this number per rule.
 */
export const DEFAULT_NOUL_AT = 0.5;

/** Below this confidence a finding is worded as a question, not a verdict. */
export const DEFAULT_UNSURE_BELOW = 0.5;



export function normalizeLanguage(raw: unknown): Language | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  // `includes` on a readonly tuple does not narrow, so the membership test and
  // the narrowing are done in one step.
  const known = LANGUAGES.find((l) => l === t);
  if (known) return known;
  const alias = LANG_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  const exact = LANGUAGES.find((l) => l.toLowerCase() === t.toLowerCase());
  return exact ?? null;
}

/**
 * Validate and normalize one rule object.
 * Returns `{rule}` or `{error}`; never throws.
 */
export function normalizeRule(raw: any, where = "rule"): RuleResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${where}: not a mapping` };
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (id === "") return { error: `${where}: missing \`id\`` };
  if (id.startsWith(PROBE_PREFIX)) {
    return {
      error: `${where}: id may not start with \`${PROBE_PREFIX}\`, which is reserved for structural probes`,
    };
  }

  // One rule, several grammars.
  //
  // `language: TypeScript` does not match .tsx, and Rust and TypeScript spell
  // the same structural idea with different node kinds but often want the same
  // sentence. Writing the sentence once and listing the languages keeps a
  // single cutoff, a single cache namespace and a single draft hash for what is
  // conceptually one rule -- copies of a sentence drift, and a drifted copy is
  // a cache that never hits.
  if (raw.language !== undefined && raw.languages !== undefined) {
    return { error: `${id}: set \`language\` or \`languages\`, not both` };
  }
  const rawLangs = raw.languages ?? raw.language;
  if (rawLangs === undefined) {
    return { error: `${id}: missing \`language\` (or \`languages\`)` };
  }
  const list = Array.isArray(rawLangs) ? rawLangs : [rawLangs];
  const languages: Language[] = [];
  for (const l of list) {
    const norm = normalizeLanguage(l);
    if (!norm) {
      return {
        error: `${id}: unknown language ${JSON.stringify(l)}; expected one of ${LANGUAGES.join(", ")}`,
      };
    }
    if (!languages.includes(norm)) languages.push(norm);
  }
  if (languages.length === 0) return { error: `${id}: \`languages\` is empty` };
  const language = languages[0];

  // A commit rule has no matcher and only the Git pseudo-grammar; every
  // other rule has a matcher and never that grammar. Decided before the
  // matcher is required, so a commit rule is not asked for one.
  const isCommit = raw.subject === "commit";
  const hasGit = languages.includes("Git");
  if (isCommit && (!hasGit || languages.length !== 1)) {
    return { error: `${id}: a \`subject: commit\` rule is \`language: Git\` and nothing else (got ${languages.join(", ")})` };
  }
  if (!isCommit && hasGit) {
    return { error: `${id}: \`Git\` is the grammar of \`subject: commit\` rules only; a ${JSON.stringify(raw.subject ?? "node")} subject needs a real grammar` };
  }
  if (isCommit) {
    if (raw.rule !== undefined) {
      return { error: `${id}: a \`subject: commit\` rule takes no matcher; its subjects are commits, not nodes` };
    }
    if (raw.state !== undefined && raw.state !== "bare") {
      return { error: `${id}: a \`subject: commit\` rule is \`state: bare\`; the diff is its state and there is no file to locate in` };
    }
  } else {
    if (raw.rule === undefined || raw.rule === null) {
      return { error: `${id}: missing \`rule\` (the ast-grep matcher)` };
    }
    if (typeof raw.rule !== "object" || Array.isArray(raw.rule)) {
      return { error: `${id}: \`rule\` must be a mapping, not ${typeof raw.rule}` };
    }
  }

  const ask = typeof raw.ask === "string" ? raw.ask.trim() : "";
  if (ask === "") return { error: `${id}: missing \`ask\` (the predicate, one sentence)` };

  const kind = raw.kind === undefined ? "score" : raw.kind;
  if (!KINDS.includes(kind)) {
    return { error: `${id}: \`kind\` must be ${KINDS.join(" or ")} (got ${JSON.stringify(kind)})` };
  }

  let criteria = null;
  if (kind === "noul") {
    // A noul's criteria MUST be nested under `criteria`. Sending `true`/`false`
    // at the top level of the question gets a 200 back with the criteria
    // silently discarded -- the only visible symptom is a smaller token count.
    // Validating the shape here is what keeps that mistake out of the wire.
    const c = raw.criteria;
    if (c === undefined || c === null) {
      return { error: `${id}: \`kind: noul\` needs \`criteria: {true: ..., false: ...}\`` };
    }
    if (typeof c !== "object" || Array.isArray(c)) {
      return { error: `${id}: \`criteria\` must be a mapping with \`true\` and \`false\`` };
    }
    const trueBranch = normalizeCriterion(c.true ?? c["true"], `${id}: \`criteria.true\``);
    if (trueBranch.error) return { error: trueBranch.error };
    const falseBranch = normalizeCriterion(c.false ?? c["false"], `${id}: \`criteria.false\``);
    if (falseBranch.error) return { error: falseBranch.error };
    criteria = { true: trueBranch.criterion!, false: falseBranch.criterion! };
  } else if (raw.criteria !== undefined) {
    return { error: `${id}: \`criteria\` only applies to \`kind: noul\`; a score rule uses the shared scale` };
  }

  const at = raw.at === undefined ? null : raw.at;
  if (at !== null && typeof at !== "number") {
    return { error: `${id}: \`at\` must be a number` };
  }
  const max = kind === "score" ? 3 : 1;
  if (at !== null && (at < 0 || at > max + 0.01)) {
    return { error: `${id}: \`at\` must be between 0 and ${max} for \`kind: ${kind}\`` };
  }

  // The `--loose` floor. Strictly under the cutoff, or the band is empty.
  const loose = raw.loose === undefined ? null : raw.loose;
  if (loose !== null) {
    if (typeof loose !== "number") return { error: `${id}: \`loose\` must be a number` };
    if (loose < 0 || loose > max) {
      return { error: `${id}: \`loose\` must be between 0 and ${max} for \`kind: ${kind}\`` };
    }
    const cutoff = at ?? (kind === "score" ? DEFAULT_SCORE_AT : DEFAULT_NOUL_AT);
    if (loose >= cutoff) {
      return { error: `${id}: \`loose\` (${loose}) must be below the cutoff (${cutoff}); it is the floor of the band under it` };
    }
  }

  const subject = raw.subject === undefined ? "node" : raw.subject;
  if (!SUBJECTS.includes(subject)) {
    return { error: `${id}: \`subject\` must be ${SUBJECTS.join(" or ")}` };
  }

  const state = raw.state === undefined ? (isCommit ? "bare" : "located") : raw.state;
  if (!STATE_ARMS.includes(state)) {
    return { error: `${id}: \`state\` must be one of ${STATE_ARMS.join(", ")}` };
  }

  // An axis pin is optional; absent means the scheduler may choose.
  let axis: Grouping | null = null;
  if (raw.axis !== undefined && raw.axis !== null) {
    if (!GROUPINGS.includes(raw.axis)) {
      return { error: `${id}: \`axis\` must be ${GROUPINGS.join(" or ")} (got ${JSON.stringify(raw.axis)})` };
    }
    axis = raw.axis as Grouping;
  }

  const severity = raw.severity === undefined ? "warning" : raw.severity;
  if (!["hint", "info", "warning", "error"].includes(severity)) {
    return { error: `${id}: \`severity\` must be hint, info, warning or error` };
  }

  const unsureBelow = raw.unsureBelow === undefined ? null : raw.unsureBelow;
  if (unsureBelow !== null && (typeof unsureBelow !== "number" || unsureBelow < 0 || unsureBelow > 1)) {
    return { error: `${id}: \`unsureBelow\` must be a number between 0 and 1` };
  }

  const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note.trim() : null;

  // Labels for the `--explain` follow-up: a closed mapping, two or more, each
  // described. One label is not a choice, and a label without a description
  // is one the model picks by its spelling.
  let explain: Record<string, string> | null = null;
  if (raw.explain !== undefined && raw.explain !== null) {
    const e = raw.explain;
    if (typeof e !== "object" || Array.isArray(e)) {
      return { error: `${id}: \`explain\` must be a mapping of label to description` };
    }
    const entries = Object.entries(e as Record<string, unknown>);
    if (entries.length < 2) {
      return { error: `${id}: \`explain\` needs at least two labels to choose between` };
    }
    explain = {};
    for (const [label, desc] of entries) {
      if (typeof desc !== "string" || desc.trim() === "") {
        return { error: `${id}: \`explain.${label}\` must be a non-empty string` };
      }
      explain[label] = desc.trim();
    }
  }

  const known = new Set([
    "id", "language", "languages", "rule", "constraints", "utils", "ask",
    "note", "kind", "criteria", "at", "subject", "state", "axis", "severity",
    "message", "unsureBelow", "docs", "tags", "explain", "loose",
  ]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return { error: `${id}: unknown field(s) ${unknown.join(", ")}` };
  }

  return {
    rule: {
      id,
      language,
      languages,
      matcher: raw.rule ?? {},
      constraints: raw.constraints ?? null,
      utils: raw.utils ?? null,
      ask,
      note,
      kind,
      criteria,
      at,
      loose,
      subject,
      state,
      axis,
      severity,
      unsureBelow,
      message: typeof raw.message === "string" ? raw.message : null,
      docs: typeof raw.docs === "string" ? raw.docs : null,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === "string") : [],
      explain,
      languageDir: null,
    },
  };
}

/**
 * The grammars a language directory admits: the listed family for the
 * three named directories, else the one grammar the directory is named for.
 * null when the name is not a language at all, so a directory called
 * `experimental` under a rules root is not mistaken for a language.
 */
export function languageDirGrammars(dir: string): readonly Language[] | null {
  const listed = LANGUAGE_DIRS[dir];
  if (listed) return listed;
  const one = normalizeLanguage(dir);
  return one ? [one] : null;
}

/**
 * The layout convention: `<lang>/<id>/rule.yml` under a rules root.
 *
 * Only that shape, so a project's flat `rules/mine.yml` or a rule file
 * passed by path is a rule file as it always was.
 */
function layoutOf(path: string): { languageDir: string; id: string } | null {
  const parts = path.split(/[\\/]/);
  if (parts.length < 3) return null;
  if (!/^rule\.ya?ml$/.test(parts[parts.length - 1]!)) return null;
  const id = parts[parts.length - 2]!;
  const dir = parts[parts.length - 3]!;
  return languageDirGrammars(dir) ? { languageDir: dir, id } : null;
}

/**
 * One criterion: a sentence, or a mapping of `what` / `examples` / `not_for`.
 *
 * The mapping is closed. The server reads any JSON here, so an unknown key
 * would reach the model as a label it has no instructions for -- the same
 * silent failure the flat `{true, false}` check above exists to prevent.
 */
function normalizeCriterion(
  raw: unknown,
  where: string,
): { criterion?: Criterion; error?: string } {
  if (typeof raw === "string") {
    if (raw.trim() === "") return { error: `${where} must be a non-empty string` };
    return { criterion: raw.trim() };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${where} must be a non-empty string or a mapping of what / examples / not_for` };
  }
  const c = raw as Record<string, unknown>;
  const unknown = Object.keys(c).filter((k) => !CRITERION_KEYS.has(k));
  if (unknown.length > 0) {
    return { error: `${where}: unknown key(s) ${unknown.join(", ")}; a mapping takes what, examples and not_for` };
  }
  if (typeof c.what !== "string" || c.what.trim() === "") {
    return { error: `${where}.what must be a non-empty string` };
  }
  const out: CriterionDetail = { what: c.what.trim() };
  if (c.examples !== undefined) {
    if (
      !Array.isArray(c.examples) ||
      c.examples.length === 0 ||
      c.examples.some((e) => typeof e !== "string" || e.trim() === "")
    ) {
      return { error: `${where}.examples must be a non-empty list of strings` };
    }
    out.examples = c.examples.map((e: string) => e.trim());
  }
  if (c.not_for !== undefined) {
    if (typeof c.not_for !== "string" || c.not_for.trim() === "") {
      return { error: `${where}.not_for must be a non-empty string` };
    }
    out.not_for = c.not_for.trim();
  }
  return { criterion: out };
}

const CRITERION_KEYS = new Set(["what", "examples", "not_for"]);

/**
 * A criterion as the draft hash sees it.
 *
 * A sentence is hashed as itself, so every cache written before the mapping
 * shape existed still answers for the same sentence. A mapping is hashed
 * canonically: the model reads it as JSON, so YAML key order is spelling.
 */
function criterionText(c: Criterion): string {
  return typeof c === "string" ? c : canonical(c);
}

/**
 * Where rules come from when `-r` was not given.
 *
 * `./rules` first, because a project's own rules are the point of the tool.
 * Failing that, the packs inside the installed package -- without this,
 * `npm install jev-lint && npx jev-lint check src` cannot work at all: the
 * default was the literal relative path `rules`, the shipped packs live in
 * `node_modules/jev-lint/rules`, and every fresh install exited with "no usable
 * rules found in rules". Found by an audit of the README's own install block.
 *
 * Never both. Merging them would silently judge someone's code against rules
 * they did not write, and a duplicate id would be dropped as a rule error.
 */
export function defaultRulePaths(): [string[], boolean] {
  if (existsSync(resolve("rules"))) return [["rules"], false];
  // dist/cli.js and src/cli.ts are both one directory below the package root.
  const shipped = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");
  return existsSync(shipped) ? [[shipped], true] : [["rules"], false];
}

export function cutoffFor(rule: Rule, overrides: Record<string, number> = {}): number {
  // `rust/id` names one language's rule; `id` names every language's.
  const qualified = rule.languageDir ? overrides[`${rule.languageDir}/${rule.id}`] : undefined;
  if (typeof qualified === "number") return qualified;
  const override = overrides[rule.id];
  if (typeof override === "number") return override;
  if (typeof rule.at === "number") return rule.at;
  return rule.kind === "score" ? DEFAULT_SCORE_AT : DEFAULT_NOUL_AT;
}

/**
 * Which DRAFT of a rule an answer came from.
 *
 * Editing the sentence is editing the question, so a verdict for the old
 * wording must never answer for the new one. The hash covers everything the
 * model is shown and nothing else: `at` is deliberately excluded, because
 * re-calibrating a threshold must not cost a single request.
 *
 * The matcher is in it because the matcher is shown, indirectly: the node kind
 * it selects and the names it captures go into the question, and neither is
 * in the subject text the verdict key hashes. `constraints` and `utils` shape
 * the same match, so they go in with it. The cost is that a matcher edit
 * re-asks that rule's questions, which is the right cost: the old verdicts
 * answered a question with different captures in it.
 */
export function ruleTextHash(rule: Rule): string {
  return createHash("sha256")
    .update(
      [
        SCHEMA,
        rule.kind,
        rule.ask,
        rule.note ?? "",
        rule.criteria ? `${criterionText(rule.criteria.true)}\n${criterionText(rule.criteria.false)}` : "",
        rule.subject,
        rule.state,
        canonical(rule.matcher),
        canonical(rule.constraints),
        canonical(rule.utils),
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 12);
}

/**
 * JSON with object keys sorted at every depth, so two spellings of the same
 * matcher -- YAML keys in a different order, a rule built in memory -- hash the
 * same. Arrays keep their order: in ast-grep, `all: [a, b]` and `all: [b, a]`
 * differ in which match wins.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  ) ?? "";
}

/**
 * Load every rule from a YAML file, a directory of them, or a list of paths.
 *
 * `warnings` are what loaded but deserve a look: today, one id under two
 * language directories whose sentences differ. The sentence is a copy per
 * language by design, and a copy drifts; the warning is where a deliberate
 * difference gets a comment and an accidental one gets fixed.
 */
export function loadRules(paths: string | string[]): { rules: Rule[]; errors: string[]; warnings: string[] } {
  const files: Array<{ path: string; missing?: boolean }> = [];
  for (const p of Array.isArray(paths) ? paths : [paths]) {
    let st;
    try {
      st = statSync(p);
    } catch {
      files.push({ path: p, missing: true });
      continue;
    }
    if (st.isDirectory()) {
      for (const entry of walkYaml(p)) files.push({ path: entry });
    } else {
      files.push({ path: p });
    }
  }

  const rules: Rule[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const { path, missing } of files) {
    if (missing) {
      errors.push(`${path}: no such file or directory`);
      continue;
    }
    let docs;
    try {
      // One YAML file may hold several rules as a multi-document stream, which
      // is how ast-grep's own rule files are written.
      docs = YAML.parseAllDocuments(readFileSync(path, "utf8"));
    } catch (err) {
      errors.push(`${path}: unreadable (${String(err).slice(0, 120)})`);
      continue;
    }
    docs.forEach((doc, i) => {
      const value = doc.toJS?.({ maxAliasCount: -1 });
      if (value === null || value === undefined) return; // empty document
      for (const err of doc.errors ?? []) {
        errors.push(`${path}: YAML error: ${err.message}`);
      }

      // A document may be one rule, or a sequence of them, or `{rules: [...]}`.
      //
      // The sequence form exists for a specific reason: ast-grep rejects a node
      // kind that is not in the language's grammar, so one sentence about
      // functions needs a Rust matcher AND a TypeScript matcher. YAML anchors
      // are scoped to a single document, so sharing the sentence between them
      // requires both to live in ONE document -- and sharing it is what keeps
      // their draft hashes identical instead of drifting apart.
      const items = Array.isArray(value)
        ? value
        : Array.isArray(value?.rules)
          ? value.rules
          : [value];

      const layout = layoutOf(path);
      items.forEach((item: unknown, j: number) => {
        const where =
          items.length > 1 || docs.length > 1 ? `${path}#${docs.length > 1 ? i : j}` : path;
        const { rule, error } = normalizeRule(item, where);
        if (error || !rule) {
          errors.push(error ?? `${where}: could not be normalized`);
          return;
        }
        if (layout) {
          // Under the layout the directory names the rule and bounds its
          // grammars; a document that disagrees with its path is an error,
          // not a rule that quietly lives somewhere else.
          if (rule.id !== layout.id) {
            errors.push(`${where}: id \`${rule.id}\` must be the directory's name \`${layout.id}\``);
            return;
          }
          const admitted = languageDirGrammars(layout.languageDir)!;
          const outside = rule.languages.filter((l) => !admitted.includes(l));
          if (outside.length > 0) {
            errors.push(
              `${where}: ${outside.join(", ")} is not a grammar of the \`${layout.languageDir}\` directory (it admits ${admitted.join(", ")})`,
            );
            return;
          }
          rule.languageDir = layout.languageDir;
        }
        const key = `${rule.languageDir ?? ""}/${rule.id}`;
        if (seen.has(key)) {
          errors.push(`${rule.id}: duplicate id (also in ${seen.get(key)})`);
          return;
        }
        seen.set(key, where);
        rules.push({ ...rule, source: path, pack: layout ? layout.languageDir : basename(path, extname(path)) });
      });
    });
  }
  return { rules, errors, warnings: driftWarnings(rules) };
}

/**
 * One id, several languages, different sentences.
 *
 * Compared on what the model reads -- ask, criteria, note, explain -- and
 * not on the matcher, cutoff or state, which are the parts a language is
 * expected to have its own of.
 */
function driftWarnings(rules: Rule[]): string[] {
  const byId = new Map<string, Rule[]>();
  for (const r of rules) {
    if (!r.languageDir) continue;
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id)!.push(r);
  }
  const out: string[] = [];
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const first = group[0]!;
    for (const other of group.slice(1)) {
      const differ = (["ask", "criteria", "note", "explain"] as const).filter(
        (k) => canonical(first[k]) !== canonical(other[k]),
      );
      if (differ.length > 0) {
        out.push(
          `${id}: drift between ${first.languageDir} and ${other.languageDir} in ${differ.join(", ")} -- the same rule in two languages should ask the same question, or say in a comment why not`,
        );
      }
    }
  }
  return out;
}

function* walkYaml(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    // `fixtures/` holds a rule's cases, not rules; a `.yml` in there is a
    // fixture. `expect.yml` is the expectations. Hidden directories are
    // nobody's rules either.
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures" && entry.name !== "evals" && !entry.name.startsWith(".")) yield* walkYaml(full);
    } else if (/\.ya?ml$/.test(entry.name) && entry.name !== "expect.yml") yield full;
  }
}
