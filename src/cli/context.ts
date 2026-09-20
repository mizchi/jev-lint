/**
 * The config file, found and folded into the options.
 *
 * A flag beats the file and the file beats the built-in default, which is
 * the only order that lets a project commit a configuration and still let
 * someone override one setting for one run.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CACHE_PATH, OLD_CACHE_PATH } from "../cache.ts";
import { applyConfig, findConfig, loadConfig, type Config } from "../config.ts";
import type { Log, Options } from "./args.ts";

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
export function resolveContext(opts: Options, rest: string[], log: Log): Context | null {
  // A flag beats the file and the file beats the built-in default, which is the
  // only order that lets a project commit a configuration and still let someone
  // override one setting for one run. `explicit` is how that is enforced: it
  // records which flags were actually PASSED, since a parsed default is
  // indistinguishable from one the user typed.
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
  const { config, errors: configErrors } = loadConfig(configPath);
  // Loudly, and fatally. A config with a typo in it is a configuration that
  // does something other than what it says, which is worse than no config.
  for (const e of configErrors) log(`config error: ${e}`);
  if (configErrors.length > 0) return null;
  applyConfig(opts, config, explicit);
  if (configPath && !opts.quiet) log(`using ${configPath}`);

  const baseDir = configPath ? dirname(resolve(configPath)) : process.cwd();
  // The cache moved in 0.5. The old file is not read -- its keys are of
  // another schema anyway -- and it is named so it does not sit there as a
  // second, stale cache.
  if (existsSync(join(baseDir, OLD_CACHE_PATH)) && !opts.quiet) {
    log(`${OLD_CACHE_PATH} is 0.4's cache; since 0.5 it is ${DEFAULT_CACHE_PATH}, so delete the old file`);
  }
  const cachePath = opts.cache === "none" ? null : resolve(baseDir, opts.cache);
  return { config, configPath, baseDir, argPaths, cachePath };
}
