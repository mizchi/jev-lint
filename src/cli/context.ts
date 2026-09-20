/**
 * The config file, found and folded into the options.
 *
 * A flag beats the file and the file beats the built-in default, which is
 * the only order that lets a project commit a configuration and still let
 * someone override one setting for one run.
 */
import { existsSync } from "node:fs";
import { applyConfig, findConfig, loadConfig, type Config } from "../config.ts";
import type { Log, Options } from "./args.ts";

export interface Context {
  config: Config;
  configPath: string | null;
  /** The positionals as typed, before the config's `paths:` fill `opts.paths`. */
  argPaths: string[];
  cachePath: string | null;
}

/** Null when the configuration is unusable, after saying why; the exit code is then 2. */
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

  const cachePath = opts.cache === "none" ? null : opts.cache;
  return { config, configPath, argPaths, cachePath };
}
