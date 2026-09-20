/**
 * One walk of the tree, shared.
 *
 * Two things besides ast-grep need to know what files a run has: the
 * `paired` arm looks for test files, and a `subject: block` rule looks for
 * files by extension. Each walked the tree on its own, so a `check` with
 * both shipped rules loaded walked it twice. This is the one walk, done
 * lazily and once per run, that both filter.
 */
import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/** Directories no source lives in, whatever they are called. */
export const SKIPPED_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "out", "target", "coverage", "vendor", "tmp",
]);

/**
 * Every file under `roots` -- directories walked, files taken as they are
 * -- relative to `cwd` with forward slashes, sorted. Hidden entries and
 * `SKIPPED_DIRECTORIES` are left out. A root that does not exist is
 * skipped, since a missing path is the loader's error to report.
 */
export function listFiles(roots: Iterable<string>, cwd: string = process.cwd()): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (dir: string) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(e.name)) walk(full);
      } else if (e.isFile()) {
        found.add(name(full));
      }
    }
  };
  // A path is reported relative to `cwd` when it is under it, the way
  // ast-grep reports its matches, and as given when it is not: a file
  // outside the tree keeps its absolute path rather than a `../../` one.
  const name = (full: string): string => {
    const rel = relative(cwd, full);
    return rel.startsWith("..") || isAbsolute(rel) ? full.split(sep).join("/") : rel.split(sep).join("/");
  };
  for (const root of roots) {
    const full = isAbsolute(root) ? root : join(cwd, root);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full);
    else if (st.isFile()) found.add(name(full));
  }
  return [...found].sort();
}

/**
 * A run's file index: each root walked once, however many callers ask.
 * A caller that needs files under a root another caller walked already
 * gets them from here; a caller that walked more than it wants (the paired
 * arm adds the conventional test directories) narrows with `isUnder`.
 */
export class FileIndex {
  private readonly files = new Set<string>();
  private readonly roots = new Set<string>();
  private readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /** The files under every root asked for so far, walking only the roots not walked yet. */
  list(roots: Iterable<string>): string[] {
    const fresh = [...roots].filter((r) => !this.roots.has(r));
    if (fresh.length > 0) {
      for (const r of fresh) this.roots.add(r);
      for (const f of listFiles(fresh, this.cwd)) this.files.add(f);
    }
    return [...this.files].sort();
  }
}

/** Is `file` (relative, forward slashes) at or under `root` (as given to the walk)? */
export function isUnder(file: string, root: string): boolean {
  const r = root.split(sep).join("/").replace(/^\.\/?/, "").replace(/\/$/, "");
  if (r === "" || r === ".") return true;
  return file === r || file.startsWith(`${r}/`);
}
