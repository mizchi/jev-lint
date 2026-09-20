import { strict as assert } from "node:assert";
import { blocks } from "../src/gate.ts";
import { splitBlocks } from "../src/text.ts";
import { test } from "./helpers.ts";

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
