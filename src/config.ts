/**
 * `.jev-lint.yaml`: defaults for everything the command line can set.
 *
 * Precedence is the conventional one, and it is the only one that lets a
 * project commit a configuration and still let someone override it for one
 * run: **a command-line flag beats the file, and the file beats the built-in
 * default.**
 *
 * Two things this file deliberately will not do.
 *
 * **It never holds the API key.** A key in a file that belongs in version
 * control is a leak waiting for a `git add -A`, so a literal `apiKey` is a
 * validation ERROR rather than a silently ignored field -- someone who writes
 * one has to be told, not left believing it works. `apiKeyEnv` is the
 * supported form: it names the variable to read, which is a secret's location
 * rather than the secret.
 *
 * **It never carries a cutoff it has not been told is a cutoff.** `threshold`
 * lives under one `rules:` entry and is validated as a number; a top-level
 * `threshold:` is an error. Accepting anything that parses would turn a typo into a
 * silently different threshold.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { GROUP_MODES, LANGUAGES, SEVERITIES, STATE_ARMS } from "./types.ts";
import { API_KEY_VARS, BASE_URL_VARS, fromEnv } from "./jev.ts";
import type { CustomLanguage, CustomLanguages, GroupMode, Severity, StateArm } from "./types.ts";

/** The file names looked for, in order, walking up from the working directory. */
/**
 * The spellings a config file may have: with or without the leading dot,
 * with or without the hyphen, `.yaml` or `.yml`. The first is what `init`
 * writes and the documentation shows; the rest are recognised because
 * every one of them has been typed. Two of them in one directory is a
 * mistake -- which one is in force? -- and the finder refuses to guess.
 */
export const CONFIG_NAMES = [
  ".jev-lint.yaml", ".jev-lint.yml", "jev-lint.yaml", "jev-lint.yml",
  ".jevlint.yaml", ".jevlint.yml", "jevlint.yaml", "jevlint.yml",
] as const;

/**
 * What a config says about one rule: on or off, and what it overrides.
 * `on` is `{ enabled: true }` and takes the rule's own severity and cutoff.
 */
export interface RuleSetting {
  enabled: boolean;
  severity?: Severity;
  at?: number;
  loose?: number;
}

/** Rule selection for commands that inspect the staged pre-commit change. */
export interface HookRuleSelection {
  extends: boolean;
  rules: Record<string, RuleSetting>;
}

/** Everything a config file may set. Every field is optional. */
export interface Config {
  /** What `check` looks at with no positional. */
  files?: string[];
  exclude?: string[];
  /**
   * The rules that run, by id (`fn-name-promises`, every language that has
   * it) or `lang/id` (one), from the shipped set and `.jev-lint/rules/`.
   * Present, only these run; absent, a config that names nothing runs
   * nothing and says so.
   */
  rules?: Record<string, RuleSetting>;
  hooks?: { precommit?: HookRuleSelection };
  cache?: string | null;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  group?: GroupMode;
  arm?: StateArm | null;
  concurrency?: number;
  batchSize?: number;
  ruleBatchCap?: number;
  retry?: number;
  unsureBelow?: number | null;
  /**
   * Grammars ast-grep does not have built in, as its own `customLanguages`
   * takes them; `libraryPath` is resolved from the config's directory.
   */
  languages?: CustomLanguages;
}

export interface LoadedConfig {
  config: Config;
  /** Where it came from, for the run to report. null when no file was found. */
  path: string | null;
  /** Everything wrong with it. A config that does not parse is not obeyed. */
  errors: string[];
  warnings: string[];
}

/** Walk up from `from` until a config file turns up, or the root does. */
export function findConfig(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    const configsHere = CONFIG_NAMES.map((name) => join(dir, name)).filter((p) => existsSync(p));
    if (configsHere.length > 1) {
      throw new Error(
        `${configsHere.length} config files in ${dir}: ${configsHere.map((p) => basename(p)).join(", ")} -- keep one config file per directory; jev-lint will not guess which is in force`,
      );
    }
    if (configsHere.length === 1) return configsHere[0]!;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Read and validate a config file.
 *
 * Never throws, and never half-applies: if anything in the file is wrong, the
 * errors come back and the caller prints them. A config with one bad field
 * still yields the good ones, because refusing the whole file over a typo in an
 * unrelated key is worse -- but the bad field is reported, not dropped.
 */
export function loadConfig(path: string | null): LoadedConfig {
  if (!path) return { config: {}, path: null, errors: [], warnings: [] };

  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(path, "utf8"));
  } catch (err: unknown) {
    return { config: {}, path, errors: [`${path}: ${String(err).slice(0, 200)}`], warnings: [] };
  }
  if (raw === null || raw === undefined) return { config: {}, path, errors: [], warnings: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config: {}, path, errors: [`${path}: not a mapping`], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const config: Config = {};
  const where = (k: string) => `${path}: \`${k}\``;
  const src = raw as Record<string, unknown>;

  const KNOWN = new Set([
    "files", "exclude", "rules", "hooks", "languages", "cache", "model", "baseUrl", "apiKeyEnv", "group", "arm",
    "concurrency", "batchSize", "ruleBatchCap", "retry", "unsureBelow",
  ]);
  // The 0.4 spellings, refused by name: a key read as nothing would run
  // every rule over the whole tree and say nothing about it.
  const MOVED: Record<string, string> = {
    paths: "`paths` is `files` since 0.5",
    at: "top-level `at` is obsolete; use `rules: { <id>: { threshold: 0.7 } }`",
  };
  for (const k of Object.keys(src)) {
    if (k in MOVED) {
      errors.push(`${where(k)}: ${MOVED[k]}`);
    } else if (k === "rules" && (Array.isArray(src.rules) || typeof src.rules === "string")) {
      errors.push(`${where(k)}: \`rules\` names rules since 0.5 (\`rules: { typescript/fn-name-promises: on }\`); a rule directory is \`.jev-lint/rules/\`, or \`-R <dir>\` for one run`);
    } else if (k === "apiKey" || k === "api_key") {
      errors.push(
        `${where(k)} is not supported: a config file belongs in version control and an API key does not. ` +
          `Set the key in the environment, or name the variable with \`apiKeyEnv\`.`,
      );
    } else if (!KNOWN.has(k)) {
      // Loud for the same reason an unknown rule field is: a typo that is
      // ignored looks exactly like a setting that had no effect.
      errors.push(`${where(k)} is not a known setting`);
    }
  }

  const stringList = (k: "files" | "exclude"): void => {
    const v = src[k];
    if (v === undefined) return;
    const list = typeof v === "string" ? [v] : v;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
      errors.push(`${where(k)} must be a path or a list of paths`);
      return;
    }
    if (list.length > 0) config[k] = list as string[];
  };
  stringList("files");
  stringList("exclude");

  const parseRuleMap = (value: unknown, key: string): Record<string, RuleSetting> | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${where(key)} must be a mapping of rule id to on, off, a severity, or { severity, threshold, loose }`);
      return null;
    }
    const rules: Record<string, RuleSetting> = {};
    for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
      const setting = ruleSetting(v);
      if (typeof setting === "string") errors.push(`${where(`${key}.${id}`)} ${setting}`);
      else {
        rules[id] = setting;
        if (v && typeof v === "object" && !Array.isArray(v) && "at" in v) {
          warnings.push(`${where(`${key}.${id}`)}: \`at\` is deprecated; use \`threshold\``);
        }
      }
    }
    return rules;
  };
  if (src.rules !== undefined && !Array.isArray(src.rules) && typeof src.rules !== "string") {
    const rules = parseRuleMap(src.rules, "rules");
    if (rules) config.rules = rules;
  }

  if (src.hooks !== undefined) {
    if (typeof src.hooks !== "object" || src.hooks === null || Array.isArray(src.hooks)) {
      errors.push(`${where("hooks")} must be a mapping of hook names`);
    } else {
      const hooks = src.hooks as Record<string, unknown>;
      for (const key of Object.keys(hooks)) {
        if (key !== "precommit") errors.push(`${where(`hooks.${key}`)} is not a known hook`);
      }
      if (hooks.precommit !== undefined) {
        const key = "hooks.precommit";
        const value = hooks.precommit;
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${where(key)} must be a mapping of extends and rules`);
        } else {
          const precommit = value as Record<string, unknown>;
          for (const field of Object.keys(precommit)) {
            if (field !== "extends" && field !== "rules") errors.push(`${where(`${key}.${field}`)} is not a known setting`);
          }
          if (typeof precommit.extends !== "boolean") errors.push(`${where(`${key}.extends`)} must be true or false`);
          const rules = parseRuleMap(precommit.rules, `${key}.rules`);
          if (typeof precommit.extends === "boolean" && rules) {
            config.hooks = { precommit: { extends: precommit.extends, rules } };
          }
        }
      }
    }
  }

  const str = (k: "model" | "baseUrl" | "apiKeyEnv"): void => {
    const v = src[k];
    if (v === undefined) return;
    if (typeof v !== "string" || v.trim() === "") {
      errors.push(`${where(k)} must be a non-empty string`);
      return;
    }
    config[k] = v.trim();
  };
  str("model");
  str("baseUrl");
  str("apiKeyEnv");

  if (src.cache !== undefined) {
    if (src.cache === null || src.cache === false || src.cache === "none") config.cache = null;
    else if (typeof src.cache === "string") config.cache = src.cache;
    else errors.push(`${where("cache")} must be a path, or \`none\` to disable`);
  }

  if (src.group !== undefined) {
    if (typeof src.group === "string" && (GROUP_MODES as readonly string[]).includes(src.group)) {
      config.group = src.group as GroupMode;
    } else errors.push(`${where("group")} must be one of ${GROUP_MODES.join(", ")}`);
  }

  if (src.arm !== undefined) {
    if (src.arm === null) config.arm = null;
    else if (typeof src.arm === "string" && (STATE_ARMS as readonly string[]).includes(src.arm)) {
      config.arm = src.arm as StateArm;
    } else errors.push(`${where("arm")} must be null or one of ${STATE_ARMS.join(", ")}`);
  }

  const posInt = (k: "concurrency" | "batchSize" | "ruleBatchCap" | "retry"): void => {
    const v = src[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      errors.push(`${where(k)} must be a positive integer`);
      return;
    }
    config[k] = v;
  };
  posInt("concurrency");
  posInt("batchSize");
  posInt("ruleBatchCap");
  posInt("retry");

  if (src.unsureBelow !== undefined) {
    if (src.unsureBelow === null) config.unsureBelow = null;
    else if (typeof src.unsureBelow === "number" && src.unsureBelow >= 0 && src.unsureBelow <= 1) {
      config.unsureBelow = src.unsureBelow;
    } else errors.push(`${where("unsureBelow")} must be null or a number from 0 to 1`);
  }

  if (src.languages !== undefined) {
    if (typeof src.languages !== "object" || src.languages === null || Array.isArray(src.languages)) {
      errors.push(`${where("languages")} must be a mapping of language name to { libraryPath, extensions, expandoChar }`);
    } else {
      const languages: CustomLanguages = {};
      const base = dirname(resolve(path));
      for (const [name, v] of Object.entries(src.languages as Record<string, unknown>)) {
        const declared = customLanguage(v, base);
        if (typeof declared === "string") {
          errors.push(`${path}: \`languages.${name}\` ${declared}`);
          continue;
        }
        if (LANGUAGES.some((l) => l === name)) {
          errors.push(`${path}: \`languages.${name}\` is already a language ast-grep has built in; a declaration cannot replace one`);
          continue;
        }
        languages[name] = declared;
      }
      config.languages = languages;
    }
  }

  return { config, path, errors, warnings };
}

/** Resolve the staged rule set without changing the ordinary configuration. */
export function precommitRules(config: Config): Record<string, RuleSetting> | null {
  const selection = config.hooks?.precommit;
  if (!selection) return config.rules ?? null;
  return selection.extends
    ? { ...(config.rules ?? {}), ...selection.rules }
    : { ...selection.rules };
}

/**
 * One declared language as written, normalized; a string says what is
 * wrong with it. The library path is resolved from the config's directory,
 * which is what a reader of that file means by a relative path -- jev-lint
 * writes ast-grep's sgconfig elsewhere, so the path has to survive the move.
 */
function customLanguage(v: unknown, base: string): CustomLanguage | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "must be a mapping of libraryPath, extensions and expandoChar";
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!["libraryPath", "extensions", "expandoChar"].includes(k)) return `has an unknown field \`${k}\`; the fields are libraryPath, extensions, expandoChar`;
  }
  if (typeof o.libraryPath !== "string" || o.libraryPath.trim() === "") {
    return "needs `libraryPath`, the tree-sitter parser compiled to a dynamic library (`tree-sitter build --output x.so`)";
  }
  if (!Array.isArray(o.extensions) || o.extensions.length === 0 || o.extensions.some((e) => typeof e !== "string" || e.trim() === "")) {
    return "needs `extensions`, a non-empty list of the file extensions it claims";
  }
  if (o.expandoChar !== undefined && (typeof o.expandoChar !== "string" || [...o.expandoChar].length !== 1)) {
    return "`expandoChar` is one character: what `$` becomes inside a pattern, for a language where `$VAR` is not valid syntax";
  }
  return {
    libraryPath: resolve(base, o.libraryPath.trim()),
    extensions: (o.extensions as string[]).map((e) => e.trim().replace(/^\./, "")),
    ...(o.expandoChar === undefined ? {} : { expandoChar: o.expandoChar }),
  };
}

/** One rule's setting as written, normalized; a string says what is wrong with it. */
function ruleSetting(v: unknown): RuleSetting | string {
  if (v === true || v === "on") return { enabled: true };
  if (v === false || v === "off") return { enabled: false };
  if (typeof v === "string" && (SEVERITIES as readonly string[]).includes(v)) return { enabled: true, severity: v as Severity };
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return `must be on, off, one of ${SEVERITIES.join(", ")}, or a mapping of severity / threshold / loose`;
  }
  const o = v as Record<string, unknown>;
  if ("at" in o && "threshold" in o) return "cannot set both `at` and `threshold`; use `threshold`";
  const out: RuleSetting = { enabled: true };
  for (const k of Object.keys(o)) {
    if (k === "severity") {
      if (typeof o.severity !== "string" || !(SEVERITIES as readonly string[]).includes(o.severity)) return `\`severity\` must be one of ${SEVERITIES.join(", ")}`;
      out.severity = o.severity as Severity;
    } else if (k === "at" || k === "threshold" || k === "loose") {
      if (typeof o[k] !== "number" || !Number.isFinite(o[k])) return `\`${k}\` must be a number (finite)`;
      if (k === "loose") out.loose = o[k] as number;
      else out.at = o[k] as number;
    } else if (k === "enabled") {
      if (typeof o.enabled !== "boolean") return "`enabled` must be true or false";
      out.enabled = o.enabled;
    } else {
      return `has an unknown field \`${k}\`; the fields are severity, threshold, loose`;
    }
  }
  return out;
}

/**
 * The file `jev-lint init` writes: the files to look at, every rule the
 * package ships turned on -- a reader deletes what they do not want, and
 * the list is the catalogue -- and every other setting commented with its
 * default.
 */
export function initialConfig(ruleKeys: string[]): string {
  return `# jev-lint configuration. A flag of the same name overrides a setting here,
# so a project can commit this and still let someone change one thing for one
# run. A commented setting takes the built-in default shown after it.

# What \`jev-lint check\` looks at with no path given, and what under those
# paths it never judges: fixtures with planted defects, vendored code.
files: [src]
# exclude: [src/fixtures, '**/*.gen.ts']   # paths, or globs

# The rules that run: \`on\`, \`off\`, a severity (hint, info, warning, error),
# or a mapping -- \`{ severity: error, threshold: 0.7 }\`. Write \`lang/id\` to
# select one language's rule. A bare shipped id selects every language that
# has it and warns. Every shipped rule is listed here, on; remove or turn off the
# ones you do not want. Their cutoffs were fitted to this package's corpus,
# not to your
# code: https://github.com/mizchi/jev-lint#calibrating
#
# A rule of your own goes in .jev-lint/rules/ (a rule.yml, or the shipped
# layout <language>/<id>/rule.yml with fixtures beside it) and is named here
# like any other.
rules:
${ruleKeys.map((key) => `  ${key}: on`).join("\n")}

# The rule selection for both \`review --staged\` and \`commits --staged\`.
# Without this section they use \`rules:\` above. \`extends: true\` copies
# those entries, then overrides matching ids with the entries here;
# \`extends: false\` selects only the entries here. A commit-message rule
# has no subject before the commit exists, so it runs on pre-push instead.
# hooks:
#   precommit:
#     extends: true
#     rules:
#       git/diff-follows-instructions: on
#       git/my-snapshot-change-rule: on  # define under .jev-lint/rules/git/

# A grammar ast-grep does not have built in: a tree-sitter parser compiled to
# a dynamic library (\`tree-sitter build --output moonbit.dylib\`), named here
# as ast-grep's own \`customLanguages\` names it. The name is what a rule's
# \`language:\` must say, exactly. \`expandoChar\` is what \`$\` becomes inside a
# pattern, needed where \`$VAR\` is not valid syntax -- without it a pattern
# with a metavariable matches nothing.
# languages:
#   moonbit:
#     libraryPath: parsers/moonbit.dylib
#     extensions: [mbt]
#     expandoChar: _

# The verdict cache, keyed on each rule and each subject, meant to be
# committed: a run over the same commit answers from it, and CI can lint
# from it with no API key. \`none\` disables it. Treat it as trusted input:
# anything that can edit it can silence a rule or invent a finding.
# cache: .jev-lint/baseline.json

# The model, and the endpoint it is asked at. Point \`baseUrl\` at a proxy or a
# self-hosted deployment to move the whole tool off the default service.
# model: jev-latest
# baseUrl: https://api.typesafe.ai

# Which environment variable holds the API key. The key itself must NEVER go in
# this file -- it belongs in version control and a secret does not.
# apiKeyEnv: TYPESAFE_API_KEY

# One state per file (accurate, the default) or one per rule (fewer requests,
# and a cutoff that has to be refitted). \`auto\` costs both and picks.
# group: file

# Override every rule's state arm. Almost always wrong to set: the arm is
# measured per rule, and forcing \`bare\` silently removes the evidence from the
# rules whose evidence is the file.
# arm: null

# Parallel requests, subjects per request, subjects per rule-axis request.
# concurrency: 32
# batchSize: 256
# ruleBatchCap: 32

# Ask everything n times and decide on the mean. Above 1 the cache is bypassed,
# because a cached answer reproduces itself.
# retry: 1

# Confidence below which a finding is worded as a question for a human rather
# than as a verdict. Confidence routes; it never suppresses.
# unsureBelow: 0.55
`;
}

/**
 * The slice of the command line a config file is allowed to set.
 *
 * Structural rather than an import of the CLI's own `Options`, so this module
 * can be tested without loading `cli.ts` -- which runs `main()` on import.
 */
export interface Configurable {
  /** `-R` directories; empty means the shipped set and `.jev-lint/rules/`. */
  rules: string[];
  rulesAreShipped: boolean;
  paths: string[];
  exclude: string[];
  /** Languages declared in the config, by name. */
  languages: CustomLanguages;
  /** The config's `rules:`, applied after loading; null when the config has none. */
  ruleSettings: Record<string, RuleSetting> | null;
  cache: string;
  model: string | null;
  baseUrl: string | null;
  group: GroupMode;
  arm: StateArm | null;
  concurrency: number;
  batchSize: number;
  ruleBatchCap: number;
  retry: number;
  unsureBelow: number | null;
  at: Record<string, number>;
}

/**
 * Fold a config file into the options, without stepping on a flag.
 *
 * `explicit` holds the flags actually passed on the command line. Checking it
 * is what makes the precedence real: `opts.concurrency` is already the default by the
 * time this runs whether or not anyone asked for it, so comparing against the
 * default would let the file override a flag that happened to match it.
 */
export function applyConfig(
  opts: Configurable,
  config: Config,
  explicit: Set<string>,
): void {
  const unset = (...flags: string[]): boolean => !flags.some((f) => explicit.has(f));

  if (config.languages) opts.languages = config.languages;
  if (config.rules) opts.ruleSettings = config.rules;
  if (config.files && opts.paths.length === 0) opts.paths = config.files;
  if (config.exclude && unset("--exclude")) opts.exclude = config.exclude;
  if (config.cache !== undefined && unset("-c", "--cache")) {
    opts.cache = config.cache === null ? "none" : config.cache;
  }
  if (config.model && unset("--model")) opts.model = config.model;
  if (config.baseUrl && unset("--base-url")) opts.baseUrl = config.baseUrl;
  if (config.group && unset("--group")) opts.group = config.group;
  if (config.arm !== undefined && unset("--arm")) opts.arm = config.arm;
  if (config.concurrency && unset("--concurrency")) opts.concurrency = config.concurrency;
  if (config.batchSize && unset("--batch-size")) opts.batchSize = config.batchSize;
  if (config.ruleBatchCap && unset("--rule-batch-cap")) opts.ruleBatchCap = config.ruleBatchCap;
  if (config.retry && unset("-r", "--retry")) opts.retry = config.retry;
  if (config.unsureBelow !== undefined && unset("--unsure-below")) {
    opts.unsureBelow = config.unsureBelow;
  }
  // Not a jev-lint variable, so it is set rather than read: the client reads
  // the environment itself, and `apiKeyEnv` names where the key lives.
  if (config.apiKeyEnv) {
    const key = fromEnv([config.apiKeyEnv]);
    if (key) process.env[API_KEY_VARS[0]] = key;
  }
  if (opts.baseUrl) process.env[BASE_URL_VARS[0]] = opts.baseUrl;
}

/**
 * What goes in git's own hooks directory: nothing but a pointer.
 *
 * The hook itself lives in the repository, at `.jev-lint/hooks/<name>`,
 * where it is tracked and reads like any other file in a diff. This is the
 * only thing `init` ever writes outside the repository, and it stays four
 * lines on purpose: a fresh clone has this shim before it has the body (git
 * does not clone its own hooks directory), and a missing or
 * non-executable body must not fail a commit -- so it exits 0 silently
 * rather than erroring, which is also what protects a clone that deleted
 * `.jev-lint/hooks/` on purpose.
 */
export function hookShim(): string {
  return `#!/bin/sh
# jev-lint hook shim, written by \`jev-lint init\`. The hook itself is
# \`.jev-lint/hooks/<name>\` in the repository, where it can be reviewed.
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
hook="$root/.jev-lint/hooks/$(basename "$0")"
[ -x "$hook" ] || exit 0
exec "$hook" "$@"
`;
}

/**
 * The pre-commit hook body `jev-lint init --pre-commit` writes to
 * `.jev-lint/hooks/pre-commit`.
 *
 * Two questions about what is staged, both `--staged` so both judge what
 * the commit will contain and not the working tree: does the code
 * contradict what it says about itself (`review`), and does the change
 * break an instruction the repository wrote for itself in AGENTS.md or
 * CLAUDE.md (`commits --staged`, the one this hook could not ask before a
 * `change` subject existed). Both block only on `error`, because a
 * probabilistic reviewer that refuses commits over a `warning` is one that
 * gets uninstalled -- everything else is printed and the commit goes
 * through. With no key in the environment it exits 0 with a note, because a
 * hook that fails every commit on a machine without the key is worse than
 * none. And a request that fails outright is exit 3 from `jev-lint` -- not a
 * verdict about the commit, just a broken run -- so it is let through rather
 * than treated as a blocking exit code the way git treats every other
 * non-zero status; the alternative is a hook that fails every commit while
 * the service is down or a key has expired, which is how a hook gets
 * deleted rather than fixed. `[ "$status" -eq 3 ] || exit "$status"` reads
 * right for one trailing call, but is wrong for the first of two: on a
 * clean 0 it would `exit 0` immediately and the second call would never
 * run. `if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then exit "$status";
 * fi` says what is actually meant -- only a real 1 or 2 stops the
 * script -- and reads the same for the last call too, so both use it.
 */
export function initialHook(): string {
  return `#!/bin/sh
# jev-lint pre-commit hook, written by \`jev-lint init --pre-commit\`.
#
# Two questions about what is staged: does the code contradict what it says
# about itself, and does the change break an instruction the repository
# wrote for itself in AGENTS.md or CLAUDE.md. Prints every finding, blocks
# the commit only on a rule with \`severity: error\`. Skip it once with
# \`git commit --no-verify\`. A partially staged file is judged as it is on
# disk, since the matcher reads files, not the index.
if [ -z "$TYPESAFE_API_KEY" ] && [ -z "$TYPESAFEAI_API_KEY" ]; then
  echo "jev-lint: no API key in the environment, skipping the review" >&2
  exit 0
fi
npx -y jev-lint review --staged --fail-on error
status=$?
# 3 is "the requests failed", which is not a verdict about this commit --
# fall through to the next check exactly as a clean 0 does. Blocking on it
# means being unable to commit while offline, which is how a hook gets
# deleted; only a real 1 or 2 stops the commit here.
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  exit "$status"
fi

npx -y jev-lint commits --staged --fail-on error
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  exit "$status"
fi
`;
}

/**
 * The pre-push hook body: the commits about to leave, judged by their
 * messages.
 *
 * A branch with no upstream has nothing to diff against yet, so the hook
 * steps aside there rather than block the first push of every branch. The
 * exit-3 passthrough is the same call as in `initialHook`, and for the same
 * reason: a failed request is not a verdict, and blocking the push on one
 * is how a hook gets deleted rather than fixed.
 */
export function initialPushHook(): string {
  return `#!/bin/sh
# jev-lint pre-push hook, written by \`jev-lint init --pre-push\`.
#
# Judges the commits not yet on the upstream -- does each message describe
# its diff -- prints every finding, and blocks the push only on a rule with
# \`severity: error\`. Skip it once with \`git push --no-verify\`.
if [ -z "$TYPESAFE_API_KEY" ] && [ -z "$TYPESAFEAI_API_KEY" ]; then
  echo "jev-lint: no API key in the environment, skipping the commit review" >&2
  exit 0
fi
if ! git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
  echo "jev-lint: no upstream for this branch yet, skipping the commit review" >&2
  exit 0
fi
npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
status=$?
# 3 is "the requests failed", which is not a verdict about this push.
# Blocking on it means being unable to push while offline, which is how
# a hook gets deleted; only a real 1 or 2 stops the push here.
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then
  exit "$status"
fi
`;
}
