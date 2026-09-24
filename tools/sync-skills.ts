#!/usr/bin/env node --experimental-strip-types
/** Keep Claude's local entry point linked to the plugin's single source. */
import { lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "../../skills/jev-lint";

function statLink(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function syncSkills(root: string, check = false): void {
  const source = join(root, "skills", "jev-lint");
  const link = join(root, ".claude", "skills", "jev-lint");
  if (!statSync(join(source, "SKILL.md")).isFile()) {
    throw new Error(`${source}/SKILL.md is not a file`);
  }
  const existing = statLink(link);
  if (existing?.isSymbolicLink() && readlinkSync(link) === TARGET) return;
  if (check) throw new Error(`${link} must be a symlink to ${TARGET}; run skills:sync`);
  if (existing && !existing.isSymbolicLink()) {
    throw new Error(`${link} is a real directory or file; preserve its contents before replacing it with a symlink`);
  }
  if (existing) unlinkSync(link);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(TARGET, link, "dir");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--check")) {
      throw new Error("usage: sync-skills.ts [--check]");
    }
    syncSkills(join(dirname(fileURLToPath(import.meta.url)), ".."), process.argv[2] === "--check");
    process.stdout.write("Claude skill link is current\n");
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
