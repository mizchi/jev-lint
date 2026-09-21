import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_INSTRUCTION_CHARS, readInstructions } from "../src/instructions.ts";
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

test("instructions: a CLAUDE.md byte-identical to AGENTS.md is dropped, not doubled", () => {
  const same = "- Never use `any`.\n";
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": same, "CLAUDE.md": same } }]);
  try {
    assert.deepEqual(readInstructions("HEAD", dir).docs.map((d) => d.file), ["AGENTS.md"], "identical content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a written pointer, as opposed to a symlink, is kept as a document", () => {
  // Only a document that IS a bare path -- what a symlink's blob actually
  // is -- is treated as a pointer. A sentence a person wrote, even one
  // that does nothing but point at the other file, has whitespace in it
  // and is not caught: it costs a few tokens and tells a model nothing
  // false, so there is no case for the false positives a word-list
  // heuristic would risk to catch it too.
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Never use `any`.\n", "CLAUDE.md": "See AGENTS.md\n" } }]);
  try {
    assert.deepEqual(readInstructions("HEAD", dir).docs.map((d) => d.file), ["AGENTS.md", "CLAUDE.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

test("instructions: a symlink nested in a directory is followed, not dropped", () => {
  // The layout a name-only, no-depth check would miss: AGENTS.md ->
  // docs/AGENTS.md is a real, ordinary layout, and its blob is
  // "docs/AGENTS.md", not "AGENTS.md". Dropping it (the previous fix) beat
  // handing a model the literal string "docs/AGENTS.md", but it still left
  // the repository's real document unread; following it is what this test
  // pins.
  const real = "- Real rule one.\n- Real rule two.\n";
  const dir = tempRepo([{ message: "Rules", files: { "docs/AGENTS.md": real } }]);
  try {
    symlinkSync("docs/AGENTS.md", join(dir, "AGENTS.md"));
    commitAll(dir, "symlink AGENTS.md to docs/AGENTS.md");
    const got = readInstructions("HEAD", dir);
    // `file` is where the text actually came from, not the link's own name.
    assert.deepEqual(got.docs, [{ file: "docs/AGENTS.md", text: real }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a symlink loop resolves to no document, not infinite recursion", () => {
  // AGENTS.md -> CLAUDE.md -> AGENTS.md, both links, no real file anywhere.
  // Each direction's target is itself symlink-shaped, so `resolvePointer`
  // stops at one hop and both directions read as no document.
  const dir = tempRepo([{ message: "seed", files: { "seed.txt": "x\n" } }]);
  try {
    symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
    commitAll(dir, "symlink loop");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a symlink target that escapes the repository is not followed", () => {
  // A path starting `../` is dropped outright, without ever calling `git
  // show` on it -- not resolved, and not left to however git's own
  // pathspec error handling happens to react to it.
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": "- Real rule.\n" } }]);
  try {
    symlinkSync("../secret/AGENTS.md", join(dir, "CLAUDE.md"));
    commitAll(dir, "symlink CLAUDE.md outside the repository");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs.map((d) => d.file), ["AGENTS.md"], "the escaping link contributes nothing, but does not break the real document");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a dangling symlink is dropped, not turned into a document containing its own path", () => {
  const dir = tempRepo([{ message: "seed", files: { "seed.txt": "x\n" } }]);
  try {
    // AGENTS.md points at a docs/AGENTS.md that was never committed.
    symlinkSync("docs/AGENTS.md", join(dir, "AGENTS.md"));
    commitAll(dir, "dangling symlink");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: two symlinks resolving to the same target dedup across the hop", () => {
  const real = "- Real rule one.\n- Real rule two.\n";
  const dir = tempRepo([{ message: "Rules", files: { "docs/AGENTS.md": real } }]);
  try {
    symlinkSync("docs/AGENTS.md", join(dir, "AGENTS.md"));
    symlinkSync("docs/AGENTS.md", join(dir, "CLAUDE.md"));
    commitAll(dir, "both root files symlink at the same real document");
    const got = readInstructions("HEAD", dir);
    assert.deepEqual(got.docs, [{ file: "docs/AGENTS.md", text: real }], "resolved once, not twice");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a one-line CLAUDE.md that states a rule of its own survives", () => {
  // What saves this from being read as a pointer is that it has whitespace
  // in it, not that it is long -- isPointer no longer measures length at
  // all, only whether the whole document is a single bare path.
  const rule = "Everything in AGENTS.md applies, plus: never commit generated files.\n";
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
    const got = readInstructions("HEAD", dir);
    assert.equal(got.docs[0]!.text.length, MAX_INSTRUCTION_CHARS);
    assert.equal(got.truncated, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instructions: a remainder too small to carry an instruction is skipped, not sliced to a scrap", () => {
  const agents = "- Keep functions small and named for what they promise.\n";
  const claude = "- Commits are written in English, always.\n";
  const dir = tempRepo([{ message: "Rules", files: { "AGENTS.md": agents, "CLAUDE.md": claude } }]);
  try {
    // Enough budget for the whole of AGENTS.md plus ten characters -- too
    // little to be worth cutting a CLAUDE.md fragment out of, but not zero.
    const got = readInstructions("HEAD", dir, agents.length + 10);
    assert.deepEqual(got.docs.map((d) => d.file), ["AGENTS.md"]);
    assert.equal(got.docs[0]!.text, agents, "the document that fit is not itself cut");
    assert.equal(got.truncated, true, "the dropped CLAUDE.md still has to be reported as a loss");
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
