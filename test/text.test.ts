import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blocks } from "../src/gate.ts";
import { splitBlocks, textSubjects } from "../src/text.ts";
import { normalizeRule } from "../src/rules.ts";
import { test } from "./harness.ts";

test("text: a file splits into blocks at each header, each block named by the header's groups", () => {
  const src = [
    "-- queries for users",
    "",
    "-- name: GetUserByEmail :one",
    "SELECT * FROM users WHERE id = $1;",
    "",
    "-- name: ListUsers :many",
    "SELECT * FROM users",
    "ORDER BY created_at;",
  ].join("\n");
  const blocks = splitBlocks(src, /^-- name: (?<NAME>\w+) :(?<KIND>\w+)/);
  assert.equal(blocks.length, 2, "the preamble before the first header is not a block");
  assert.equal(blocks[0]!.line, 3);
  assert.equal(blocks[0]!.endLine, 4, "a block runs to the line before the next header, minus the blank lines between");
  assert.deepEqual(blocks[0]!.captured, { NAME: "GetUserByEmail", KIND: "one" });
  assert.equal(blocks[0]!.text, "-- name: GetUserByEmail :one\nSELECT * FROM users WHERE id = $1;");
  assert.equal(blocks[1]!.endLine, 8);
  assert.equal(blocks[1]!.text.split("\n").length, 3);
  assert.deepEqual(splitBlocks("no headers here", /^-- name: (?<NAME>\w+)/), []);
});

test("text: a block rule restricted by filename skips other Markdown files", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-text-"));
  try {
    writeFileSync(join(dir, "AGENTS.md"), "# Rules\n\n- Name the test.\n");
    writeFileSync(join(dir, "README.md"), "# Rules\n\n- Explain the package.\n");
    const { rule, error } = normalizeRule({ id: "agent-rule", language: "Text", subject: "block", extensions: ["md"], filenames: ["AGENTS.md"], split: "^#{1,6}\\s+", ask: "a." });
    assert.equal(error, undefined);
    const subjects = textSubjects([rule!], ["."], dir);
    assert.deepEqual(subjects.map((s) => s.file), ["AGENTS.md"]);
    assert.equal(subjects[0]!.line, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
