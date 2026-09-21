import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_INSTRUCTION_CHARS, POINTER_LINE_MAX, readInstructions } from "../src/instructions.ts";
import { tempRepo } from "./builders.ts";
import { test } from "./harness.ts";

// These tests build throwaway repositories and pass `cwd` to point git at
// them, but git honours an inherited `GIT_DIR` over `cwd` entirely -- and
// this repository's own pre-commit/pre-push hooks run with `GIT_DIR` set.
// If a test in this file ever reads content from the WRONG repository, that
// is `GIT_DIR` winning over `cwd`, not a bug in `readInstructions` or in
// this file; it is a repo-wide pattern this file did not introduce, and
// unsetting `GIT_DIR` in the child environment here would just break the
// hook's own use of it elsewhere in the same process tree.

// A second commit on a repo `tempRepo` already built, with the author
// identity `tempRepo` itself uses -- needed to commit a symlink, which
// `tempRepo`'s file-only builder has no way to express.
function commitAll(dir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" },
  });
}

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

test("instructions: a CLAUDE.md symlinked to AGENTS.md is a pointer, not a second document", () => {
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Real rule one.\n- Real rule two.\n" } }]);
  try {
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
    commitAll(dir, "symlink CLAUDE.md to AGENTS.md");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs.map((d) => d.file), ["AGENTS.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: an AGENTS.md symlinked to CLAUDE.md is caught in the other direction too", () => {
  // The direction a check that only compares against already-read
  // documents misses: AGENTS.md is read FIRST, with nothing yet in `docs`
  // to compare it against, so a backwards-only check would let its
  // target-path blob ("CLAUDE.md") through as if it were a real document.
  const dir = tempRepo([{ message: "Rules", files: { "CLAUDE.md": "- Real rule one.\n- Real rule two.\n" } }]);
  try {
    symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
    commitAll(dir, "symlink AGENTS.md to CLAUDE.md");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs.map((d) => d.file), ["CLAUDE.md"]);
    assert.match(got.docs[0]!.text, /Real rule one/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a one-line CLAUDE.md that states a rule of its own survives", () => {
  // Long enough to be an instruction, not a pointer -- well past
  // POINTER_LINE_MAX even though it names AGENTS.md.
  const rule = "Everything in AGENTS.md applies, plus: never commit generated files.\n";
  assert.ok(rule.trim().length > POINTER_LINE_MAX, "fixture must actually exceed the pointer bound");
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Base rule.\n", "CLAUDE.md": rule } }]);
  try {
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs.map((d) => d.file), ["AGENTS.md", "CLAUDE.md"], "a real one-line rule is not a pointer");
    assert.match(got.docs[1]!.text, /never commit generated files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: over the budget the text is cut at a line boundary, whole, and says so", () => {
  const line = (i: number) => `- rule number ${i}, which is a sentence long enough to matter`;
  const big = `${Array.from({ length: 20 }, (_, i) => line(i)).join("\n")}\n`;
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": big } }]);
  try {
    // A small explicit budget exercises the same cut logic as the default
    // MAX_INSTRUCTION_CHARS without needing a document sized to it.
    const got = readInstructions("HEAD", dir, 200);
    assert.equal(got.truncated, true);
    const kept = got.docs[0]!.text;
    assert.ok(kept.length <= 200, `${kept.length} chars`);
    assert.ok(kept.endsWith("\n"), "cut at a line boundary, never mid-sentence");
    // Not just ending in a newline -- the line right before it has to be a
    // whole one. A cut that kept "- rule number 3, which is a sentence long
    // enough to mat\n" would pass an endsWith("\n") check and still be a
    // sentence sliced mid-word.
    const lastLine = kept.trimEnd().split("\n").pop()!;
    assert.match(lastLine, /^- rule number \d+, which is a sentence long enough to matter$/, "the last surviving line is whole, not cut mid-word");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a document with no line boundary in the budget is cut where it must be", () => {
  // No newline anywhere in the document, so there is no honest boundary
  // within the budget and the text is cut where the budget ends. The
  // alternative is dropping a document for being one long paragraph.
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "x".repeat(5_000) } }]);
  try {
    const got = readInstructions("HEAD", dir, 200);
    assert.equal(got.truncated, true);
    assert.equal(got.docs[0]!.text.length, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: MAX_INSTRUCTION_CHARS is the default budget", () => {
  const big = "x".repeat(MAX_INSTRUCTION_CHARS + 5_000);
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": big } }]);
  try {
    assert.equal(readInstructions("HEAD", dir).docs[0]!.text.length, MAX_INSTRUCTION_CHARS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a null ref reads the index, including a staged edit", () => {
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
