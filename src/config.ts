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
 * **It never carries a cutoff it has not been told is a cutoff.** `at:` is a
 * map of rule id to number and is validated as one, because the alternative --
 * accepting anything and applying what parses -- turns a typo into a silently
 * different threshold, which is the one failure this whole tool is built to
 * avoid.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { GROUP_MODES, SEVERITIES, STATE_ARMS } from "./types.ts";
import { API_KEY_VARS, BASE_URL_VARS, fromEnv } from "./jev.ts";
import type { GroupMode, Severity, StateArm } from "./types.ts";

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
}

export interface LoadedConfig {
  config: Config;
  /** Where it came from, for the run to report. null when no file was found. */
  path: string | null;
  /** Everything wrong with it. A config that does not parse is not obeyed. */
  errors: string[];
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
  if (!path) return { config: {}, path: null, errors: [] };

  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(path, "utf8"));
  } catch (err: unknown) {
    return { config: {}, path, errors: [`${path}: ${String(err).slice(0, 200)}`] };
  }
  if (raw === null || raw === undefined) return { config: {}, path, errors: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config: {}, path, errors: [`${path}: not a mapping`] };
  }

  const errors: string[] = [];
  const config: Config = {};
  const where = (k: string) => `${path}: \`${k}\``;
  const src = raw as Record<string, unknown>;

  const KNOWN = new Set([
    "files", "exclude", "rules", "cache", "model", "baseUrl", "apiKeyEnv", "group", "arm",
    "concurrency", "batchSize", "ruleBatchCap", "retry", "unsureBelow",
  ]);
  // The 0.4 spellings, refused by name: a key read as nothing would run
  // every rule over the whole tree and say nothing about it.
  const MOVED: Record<string, string> = {
    paths: "`paths` is `files` since 0.5",
    at: "`at` moved under `rules` since 0.5: `rules: { <id>: { at: 0.7 } }`",
  };
  for (const k of Object.keys(src)) {
    if (k in MOVED) {
      errors.push(`${where(k)}: ${MOVED[k]}`);
    } else if (k === "rules" && (Array.isArray(src.rules) || typeof src.rules === "string")) {
      errors.push(`${where(k)}: \`rules\` names rules since 0.5 (\`rules: { fn-name-promises: on }\`); a rule directory is \`.jev-lint/rules/\`, or \`-R <dir>\` for one run`);
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

  if (src.rules !== undefined && !Array.isArray(src.rules) && typeof src.rules !== "string") {
    if (typeof src.rules !== "object" || src.rules === null) {
      errors.push(`${where("rules")} must be a mapping of rule id to on, off, a severity, or { severity, at, loose }`);
    } else {
      const rules: Record<string, RuleSetting> = {};
      for (const [id, v] of Object.entries(src.rules as Record<string, unknown>)) {
        const setting = ruleSetting(v);
        if (typeof setting === "string") {
          errors.push(`${path}: \`rules.${id}\` ${setting}`);
          continue;
        }
        rules[id] = setting;
      }
      config.rules = rules;
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

  return { config, path, errors };
}

/** One rule's setting as written, normalized; a string says what is wrong with it. */
function ruleSetting(v: unknown): RuleSetting | string {
  if (v === true || v === "on") return { enabled: true };
  if (v === false || v === "off") return { enabled: false };
  if (typeof v === "string" && (SEVERITIES as readonly string[]).includes(v)) return { enabled: true, severity: v as Severity };
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return `must be on, off, one of ${SEVERITIES.join(", ")}, or a mapping of severity / at / loose`;
  }
  const o = v as Record<string, unknown>;
  const out: RuleSetting = { enabled: true };
  for (const k of Object.keys(o)) {
    if (k === "severity") {
      if (typeof o.severity !== "string" || !(SEVERITIES as readonly string[]).includes(o.severity)) return `\`severity\` must be one of ${SEVERITIES.join(", ")}`;
      out.severity = o.severity as Severity;
    } else if (k === "at" || k === "loose") {
      if (typeof o[k] !== "number" || Number.isNaN(o[k])) return `\`${k}\` must be a number`;
      out[k] = o[k] as number;
    } else if (k === "enabled") {
      if (typeof o.enabled !== "boolean") return "`enabled` must be true or false";
      out.enabled = o.enabled;
    } else {
      return `has an unknown field \`${k}\`; the fields are severity, at, loose`;
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
export function initialConfig(ruleIds: string[]): string {
  return `# jev-lint configuration. A flag of the same name overrides a setting here,
# so a project can commit this and still let someone change one thing for one
# run. A commented setting takes the built-in default shown after it.

# What \`jev-lint check\` looks at with no path given, and what under those
# paths it never judges: fixtures with planted defects, vendored code.
files: [src]
# exclude: [src/fixtures]

# The rules that run: \`on\`, \`off\`, a severity (hint, info, warning, error),
# or a mapping -- \`{ severity: error, at: 0.7 }\`. An id names the rule in
# every language that has it; \`rust/<id>\` names one language's. Every rule
# the package ships is listed here, on; delete or turn off what you do not
# want. Their cutoffs were fitted to the package's own corpus, not to your
# code: https://github.com/mizchi/jev-lint#calibrating
#
# A rule of your own goes in .jev-lint/rules/ (a rule.yml, or the shipped
# layout <language>/<id>/rule.yml with fixtures beside it) and is named here
# like any other.
rules:
${ruleIds.map((id) => `  ${id}: on`).join("\n")}

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
 * The pre-commit hook `jev-lint init --pre-commit` installs.
 *
 * Three decisions in it. It reviews `--staged`, so it judges what the commit
 * will contain and not the working tree. It blocks only on `error`, because
 * a probabilistic reviewer that refuses commits over a `warning` is one that
 * gets uninstalled -- everything else is printed and the commit goes through.
 * And with no key in the environment it exits 0 with a note, because a hook
 * that fails every commit on a machine without the key is worse than none.
 */
export function initialHook(): string {
  return `#!/bin/sh
# jev-lint pre-commit hook, written by \`jev-lint init --pre-commit\`.
#
# Reviews only the staged diff, prints every finding, and blocks the commit
# only on a rule with \`severity: error\`. Skip it once with
# \`git commit --no-verify\`. A partially staged file is judged as it is on
# disk, since the matcher reads files, not the index.
if [ -z "$TYPESAFE_API_KEY" ] && [ -z "$TYPESAFEAI_API_KEY" ]; then
  echo "jev-lint: no API key in the environment, skipping the review" >&2
  exit 0
fi
exec npx -y jev-lint review --staged --fail-on error
`;
}

/**
 * The pre-push hook: the commits about to leave, judged by their messages.
 *
 * A branch with no upstream has nothing to diff against yet, so the hook
 * steps aside there rather than block the first push of every branch.
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
exec npx -y jev-lint commits '@{upstream}..HEAD' --fail-on error
`;
}
