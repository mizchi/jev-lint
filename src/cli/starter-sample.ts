import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { isExcludedBy } from "../files.ts";
import { relationPath } from "../relation-contract.ts";

const MAX_FILES = 64;
const MAX_PATH_BYTES = 8192;

/** Sample across extensions so one large directory cannot crowd out other languages. */
export function starterSample(roots: string[], exclude: string[]) {
  const cwd = realpathSync(".");
  const paths = roots.map(root => relative(cwd, resolve(root)) || ".");
  if (paths.some(p => p === ".." || p.startsWith(`..${sep}`))) return { files: [], omitted: 0, pathBytes: 0 };
  let index: string;
  try {
    index = execFileSync("git", ["--literal-pathspecs", "ls-files", "--cached", "--stage", "-z", "--", ...paths], {
      cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOBUFS") throw new Error("Git index listing too large; narrow the trial to a directory");
    throw new Error("the starter needs a Git working tree with tracked files");
  }
  const groups = new Map<string, string[]>();
  let eligible = 0;
  for (const entry of index.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0 || !/^100(?:644|755) [0-9a-f]+ 0$/.test(entry.slice(0, tab))) continue;
    const path = entry.slice(tab + 1);
    if (!relationPath(path) || path.split("/").some(part => part.startsWith(".")) || exclude.some(pattern => isExcludedBy(path, pattern))) continue;
    const full = resolve(cwd, path);
    try {
      if (!lstatSync(full).isFile() || realpathSync(full) !== full) continue;
    } catch { continue; } // An indexed file may have been deleted from the working tree.
    const group = extname(path).toLowerCase();
    const bucket = groups.get(group) ?? [];
    if (!groups.has(group)) groups.set(group, bucket);
    if (bucket.length < MAX_FILES) bucket.push(path);
    eligible++;
  }
  const files: string[] = [];
  let bytes = 0;
  for (let i = 0; i < MAX_FILES && files.length < MAX_FILES; i++) {
    for (const bucket of groups.values()) {
      const path = bucket[i];
      if (!path) continue;
      const size = Buffer.byteLength(path);
      if (bytes + size > MAX_PATH_BYTES) continue;
      files.push(path);
      bytes += size;
      if (files.length === MAX_FILES) break;
    }
  }
  return { files, omitted: eligible - files.length, pathBytes: bytes };
}

export const MAX_LINT_FILES = 3;
export const MAX_LINT_BYTES = 32768;
export function lintSample(eligible: string[]) {
  const files: string[] = [];
  const cwd = realpathSync(".");
  let bytes = 0;
  for (const path of eligible) {
    const full = resolve(cwd, path);
    try {
      const stat = lstatSync(full);
      if (!stat.isFile() || realpathSync(full) !== full || stat.size > 16384 || bytes + stat.size > MAX_LINT_BYTES) continue;
      bytes += stat.size;
      files.push(path);
      if (files.length === MAX_LINT_FILES) break;
    } catch { continue; }
  }
  return files;
}
