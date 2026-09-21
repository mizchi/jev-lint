#!/usr/bin/env node --experimental-strip-types
/**
 * Build a tree-sitter parser for a language jev-lint ships rules for but
 * ast-grep does not have built in.
 *
 *   npm run parsers:moonbit
 *
 * The result is a platform-specific dynamic library of about a megabyte,
 * which is why it is built rather than carried: `.jev-lint/parsers/` is
 * gitignored, and `docs/moonbit.jev-lint.yaml` is the config that names it
 * for `jev-lint eval rules/moonbit`.
 *
 * Needs `git` and the tree-sitter CLI (`npm i -g tree-sitter-cli`, or
 * `cargo install tree-sitter-cli`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const GRAMMARS: Record<string, { repo: string; library: string }> = {
  moonbit: { repo: "https://github.com/moonbitlang/tree-sitter-moonbit.git", library: "moonbit" },
};

const name = process.argv[2] ?? "";
const grammar = GRAMMARS[name];
if (!grammar) {
  process.stderr.write(`usage: build-parser.ts <${Object.keys(GRAMMARS).join("|")}>\n`);
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const parsers = join(root, ".jev-lint", "parsers");
const checkout = join(parsers, `tree-sitter-${name}`);
const extension = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
const output = join(parsers, `${grammar.library}.${extension}`);

mkdirSync(parsers, { recursive: true });
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });

if (existsSync(checkout)) run("git", ["pull", "--ff-only", "--quiet"], checkout);
else run("git", ["clone", "--depth", "1", "--quiet", grammar.repo, checkout], parsers);
run("tree-sitter", ["build", "--output", output], checkout);
process.stdout.write(`wrote ${output}\n`);
process.stdout.write(`declare it with:\n  languages:\n    ${name}:\n      libraryPath: ${output}\n      extensions: [mbt]\n      expandoChar: _\n`);
