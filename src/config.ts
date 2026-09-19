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
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { GROUP_MODES, STATE_ARMS } from "./types.ts";
import { API_KEY_VARS, BASE_URL_VARS, fromEnv } from "./jev.ts";
import type { GroupMode, StateArm } from "./types.ts";

/** The file names looked for, in order, walking up from the working directory. */
export const CONFIG_NAMES = [".jev-lint.yaml", ".jev-lint.yml"] as const;

/** Everything a config file may set. Every field is optional. */
export interface Config {
  rules?: string[];
  paths?: string[];
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
  at?: Record<string, number>;
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
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
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
    "rules", "paths", "cache", "model", "baseUrl", "apiKeyEnv", "group", "arm",
    "concurrency", "batchSize", "ruleBatchCap", "retry", "unsureBelow", "at",
  ]);
  for (const k of Object.keys(src)) {
    if (k === "apiKey" || k === "api_key") {
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

  const stringList = (k: "rules" | "paths"): void => {
    const v = src[k];
    if (v === undefined) return;
    const list = typeof v === "string" ? [v] : v;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
      errors.push(`${where(k)} must be a path or a list of paths`);
      return;
    }
    if (list.length > 0) config[k] = list as string[];
  };
  stringList("rules");
  stringList("paths");

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

  if (src.at !== undefined) {
    if (typeof src.at !== "object" || src.at === null || Array.isArray(src.at)) {
      errors.push(`${where("at")} must be a mapping of rule id to number`);
    } else {
      const at: Record<string, number> = {};
      for (const [id, v] of Object.entries(src.at as Record<string, unknown>)) {
        if (typeof v !== "number" || Number.isNaN(v)) {
          errors.push(`${path}: \`at.${id}\` must be a number`);
          continue;
        }
        at[id] = v;
      }
      if (Object.keys(at).length > 0) config.at = at;
    }
  }

  return { config, path, errors };
}

/** The file `jev-lint init` writes. Every setting commented with its default. */
export function initialConfig(): string {
  return `# jev-lint configuration. Every setting here is a DEFAULT: a command-line flag
# of the same name overrides it, so a project can commit this and still let
# someone change one thing for one run.
#
# Delete anything you do not need -- an absent setting takes the built-in
# default, which is what the comment after it shows.

# Where the rules come from. With no \`rules\` here and no ./rules directory,
# the packs inside the installed package are used -- and their cutoffs were
# fitted to that package's corpus, not to your code, so calibrate before
# trusting them: https://github.com/mizchi/jev-lint#calibrating
# rules: [rules]

# What \`jev-lint check\` looks at when given no paths.
# paths: [src]

# The verdict cache. \`none\` disables it. Treat it as trusted input: anything
# that can edit it can silence a rule or invent a finding.
# cache: .jev-lint-cache.json

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
# concurrency: 4
# batchSize: 256
# ruleBatchCap: 32

# Ask everything n times and decide on the mean. Above 1 the cache is bypassed,
# because a cached answer reproduces itself.
# retry: 1

# Confidence below which a finding is worded as a question for a human rather
# than as a verdict. Confidence routes; it never suppresses.
# unsureBelow: 0.55

# Per-rule cutoffs, overriding whatever the rule file says. Fit these against
# your own labelled corpus -- \`jev-lint calibrate --labels\` -- rather than
# guessing: a cutoff is a claim about a specific set of answers.
# at:
#   fn-name-promises: 0.76
#   var-name-describes-value: 0.61
`;
}

/**
 * The slice of the command line a config file is allowed to set.
 *
 * Structural rather than an import of the CLI's own `Options`, so this module
 * can be tested without loading `cli.ts` -- which runs `main()` on import.
 */
export interface Configurable {
  rules: string[];
  rulesAreShipped: boolean;
  paths: string[];
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
 * is what makes the precedence real: `opts.concurrency` is already 4 by the
 * time this runs whether or not anyone asked for 4, so comparing against the
 * default would let the file override a flag that happened to match it.
 */
export function applyConfig(
  opts: Configurable,
  config: Config,
  explicit: Set<string>,
): void {
  const unset = (...flags: string[]): boolean => !flags.some((f) => explicit.has(f));

  if (config.rules && unset("-R", "--rules")) {
    opts.rules = config.rules;
    opts.rulesAreShipped = false;
  }
  if (config.paths && opts.paths.length === 0) opts.paths = config.paths;
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
  // `--at` is repeatable and per rule, so it merges rather than replaces: a
  // flag overrides the file for THAT rule and leaves the others standing.
  if (config.at) opts.at = { ...config.at, ...opts.at };

  // Not a jev-lint variable, so it is set rather than read: the client reads
  // the environment itself, and `apiKeyEnv` names where the key lives.
  if (config.apiKeyEnv) {
    const key = fromEnv([config.apiKeyEnv]);
    if (key) process.env[API_KEY_VARS[0]] = key;
  }
  if (opts.baseUrl) process.env[BASE_URL_VARS[0]] = opts.baseUrl;
}
