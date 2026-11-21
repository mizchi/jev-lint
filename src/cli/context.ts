/**
 * The config file, found and folded into the options.
 *
 * Flags override the file, which overrides built-in defaults. For the cache,
 * JEV_LINT_CACHE sits between flags and the file so a backend can select its
 * own verdict cache without changing the project's committed configuration.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CACHE_PATH, OLD_CACHE_PATH } from "../cache.ts";
import { applyConfig, findConfig, loadConfig, modelWithKeyEnv, type Config } from "../config.ts";
import type { Log, Options } from "./args.ts";
import { modelCachePath, modelSpec } from "../model.ts";
import { describeMigration, legacyCacheDir, legacyCacheFileFor, migrateLegacyFile } from "../legacy-ledger.ts";

/**
 * TEMPORARY (until LEGACY_MIGRATION.removeIn): the 0.9 cache was one `.json`
 * file. A setting that still names one is read as the directory it became,
 * and a legacy file found where the ledger now lives is converted and removed.
 * A dry run reports what it would migrate and writes nothing.
 */
function migrateCacheSetting(path: string, dryRun: boolean, log: Log, announce = true): string {
  const asDir = legacyCacheDir(path);
  const dir = asDir ?? path;
  if (asDir) log(`cache: ${path} names a 0.9 single-file cache; since 0.10 the cache is a ledger directory, so ${dir} is used. Point \`cache:\` at the directory`);
  const legacy = asDir ? path : legacyCacheFileFor(dir);
  // `ledger migrate` owns its sources and destinations; it gets no automatic migration first.
  if (announce && existsSync(legacy)) {
    try {
      const result = migrateLegacyFile(legacy, { to: dir, dryRun });
      log(dryRun && result.kind === "cache" ? `would ${describeMigration(result).replace(/^migrated/, "migrate")}` : describeMigration(result));
    } catch (err) { log(`cache: could not migrate ${legacy} (${String(err).slice(0, 120)}); it is kept and not read`); }
  }
  return dir;
}

export interface Context {
  config: Config;
  configPath: string | null;
  /** The directory the config is in, or the cwd: where `.jev-lint/` lives. */
  baseDir: string;
  /** The positionals as typed, before the config's `paths:` fill `opts.paths`. */
  argPaths: string[];
  cachePath: string | null;
}

/** Null when the configuration is unusable, after saying why; `main` then exits 2. */
export function resolveContext(opts: Options, rest: string[], log: Log, { migrate = true }: { migrate?: boolean } = {}): Context | null {
  // Parsed defaults cannot reveal which flags were passed. Both the config
  // and the cache environment override must preserve explicit CLI choices.
  const explicit = new Set(rest.filter((a) => a.startsWith("-")));
  // `paths:` in the config is what `check` looks at with no argument. It is
  // not what `eval` looks at: its positional arguments are rule directories,
  // and with none it walks the rule sources.
  const argPaths = [...opts.paths];
  let configPath: string | null;
  try {
    configPath = opts.config === "none" ? null : (opts.config ?? findConfig());
  } catch (err: unknown) {
    // Two spellings in one directory. Stopping is the point: running with
    // one of them silently would be a configuration nobody chose.
    log(`config error: ${String((err as Error).message)}`);
    return null;
  }
  if (opts.config && opts.config !== "none" && !existsSync(opts.config)) {
    log(`config not found: ${opts.config}`);
    return null;
  }
  const { config, errors: configErrors, warnings: configWarnings } = loadConfig(configPath);
  // Loudly, and fatally. A config with a typo in it is a configuration that
  // does something other than what it says, which is worse than no config.
  for (const e of configErrors) log(`config error: ${e}`);
  if (configErrors.length > 0) return null;
  for (const w of configWarnings) log(`config warning: ${w}`);
  applyConfig(opts, config, explicit);
  const envCache = process.env.JEV_LINT_CACHE;
  if (envCache && !explicit.has("--cache") && !explicit.has("-c")) opts.cache = envCache;
  if (configPath && !opts.quiet) log(`using ${configPath}`);

  const baseDir = configPath ? dirname(resolve(configPath)) : process.cwd();
  // The cache moved in 0.5. The old file is not read -- its keys are of
  // another schema anyway -- and it is named so it does not sit there as a
  // second, stale cache.
  if (existsSync(join(baseDir, OLD_CACHE_PATH)) && !opts.quiet) {
    log(`${OLD_CACHE_PATH} is 0.4's cache; since 0.5 it is ${DEFAULT_CACHE_PATH}, so delete the old file`);
  }
  let cachePath: string | null;
  try { modelSpec(opts.model, opts.baseUrl); cachePath = modelCachePath(opts.cache === "none" ? null : resolve(baseDir, opts.cache), opts.model); }
  catch (error) { log(`model error: ${(error as Error).message}`); return null; }
  if (cachePath) cachePath = migrateCacheSetting(cachePath, opts.dryRun, log, migrate);
  return { config, configPath, baseDir, argPaths, cachePath };
}

/** Docs and introspection have their own inputs, but use the project's model selection. */
export function standaloneModel(opts: Options, directory: string): string | null {
  if (opts.config === "none") return opts.model;
  const { config, errors } = loadConfig(opts.config ?? findConfig(directory));
  if (errors.length) {
    if (opts.config) throw new Error(errors.join("\n"));
    // Introspection can propose a replacement for a malformed project config.
    // Only a valid project config can authorize its provider.
    return opts.model;
  }
  return modelWithKeyEnv(opts.model ?? config.model ?? null, config.apiKeyEnv);
}
