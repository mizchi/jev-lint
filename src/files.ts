/**
 * One walk of the tree, shared.
 *
 * Two things besides ast-grep need to know what files a run has: the
 * `paired` arm looks for test files, and a `subject: block` rule looks for
 * files by extension. Each walked the tree on its own, so a `check` with
 * both shipped rules loaded walked it twice. This is the one walk, done
 * lazily and once per run, that both filter.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * The one decision about a file or directory that cannot be read: it is
 * treated as absent. A run over a tree is not stopped by one unreadable
 * entry -- a permission, a race with a build, a dangling link -- and this
 * is where that is decided, once, with a name that says the failure is
 * swallowed. A caller that must tell "absent" from "empty" gets null and
 * decides for itself.
 */
export function tryReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** As `tryReadFile`, for a directory's entries: empty when it cannot be read. */
export function tryReadDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

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
    for (const e of tryReadDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(e.name)) walk(full);
      } else if (e.isFile()) {
        found.add(name(full));
      }
    }
  };
  const name = (full: string) => walkName(full, cwd);
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
 * How the walk names a path: relative to `cwd` with forward slashes when it
 * is under it, the way ast-grep reports its matches, and absolute when it
 * is not -- a file outside the tree keeps its absolute path rather than a
 * `../../` one. A caller comparing a root it was given against the walk's
 * names has to name the root the same way.
 */
export function walkName(full: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, full);
  return rel.startsWith("..") || isAbsolute(rel) ? full.split(sep).join("/") : rel.split(sep).join("/");
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

  /** Add these roots, walking only the ones not walked yet, and return the files under every root asked for so far. */
  extend(roots: Iterable<string>): string[] {
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
