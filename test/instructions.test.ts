import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_INSTRUCTION_CHARS, readInstructions } from "../src/instructions.ts";
import { tempRepo } from "./builders.ts";
import { test } from "./harness.ts";

test("instructions: both documents are read from the commit's own tree", () => {
  const dir = tempRepo([
    { message: "Set the rules", files: { "AGENTS.md": "- Never use `any`.\n", "CLAUDE.md": "- Write commits in English.\n" } },
    { message: "Loosen them", files: { "AGENTS.md": "- `any` is fine now.\n" } },
  ]);
  try {
    const first = readInstructions("HEAD~1", dir);
    assert.deepEqual(first.docs.map((d) => d.file), ["AGENTS.md", "CLAUDE.md"]);
    assert.match(first.docs[0]!.text, /Never use/, "the older commit is judged by the older document");
    const second = readInstructions("HEAD", dir);
    assert.match(second.docs[0]!.text, /fine now/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a repository with neither document yields nothing", () => {
  const dir = tempRepo([{ message: "Add cart", files: { "cart.ts": "a\n" } }]);
  try {
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs, [], "no document is not an empty document");
    assert.equal(got.truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a CLAUDE.md that only points at AGENTS.md is dropped, not doubled", () => {
  const same = "- Never use `any`.\n";
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": same, "CLAUDE.md": same } }]);
  const pointer = tempRepo([{ message: "Rules", files: { "AGENTS.md": same, "CLAUDE.md": "See AGENTS.md\n" } }]);
  try {
    assert.deepEqual(readInstructions("HEAD", dir).docs.map((d) => d.file), ["AGENTS.md"], "identical content");
    assert.deepEqual(readInstructions("HEAD", pointer).docs.map((d) => d.file), ["AGENTS.md"], "a one-line pointer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(pointer, { recursive: true, force: true });
  }
});

test("instructions: over the budget the text is cut at a line boundary and says so", () => {
  const big = `${Array.from({ length: 4000 }, (_, i) => `- rule number ${i}, which is a sentence long enough to matter`).join("\n")}\n`;
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": big } }]);
  try {
    const got = readInstructions("HEAD", dir);
    assert.equal(got.truncated, true);
    assert.ok(got.docs[0]!.text.length <= MAX_INSTRUCTION_CHARS, `${got.docs[0]!.text.length} chars`);
    assert.ok(got.docs[0]!.text.endsWith("\n"), "cut at a line boundary, never mid-sentence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: the index is where --staged reads them", () => {
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Old rule.\n" } }]);
  try {
    // Stage a change to the document itself: it is part of the change.
    writeFileSync(join(dir, "AGENTS.md"), "- New rule.\n");
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(readInstructions(null, dir).docs[0]!.text, /New rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a git failure is no documents, never an exception", () => {
  // Not a repository at all: the tool must degrade to "no subject", not crash.
  const got = readInstructions("HEAD", "/");
  assert.deepEqual(got.docs, []);
});
