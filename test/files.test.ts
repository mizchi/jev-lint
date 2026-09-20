import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { FileIndex, listFiles, isUnder } from "../src/files.ts";
import { findTestFiles } from "../src/paired.ts";
import { findTextFiles } from "../src/text.ts";
import { test } from "./helpers.ts";

test("files: one index walks each root once, and a later caller adds only the roots it is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-files-"));
  try {
    for (const f of ["src/a.ts", "src/q.sql", "test/a.test.ts", "node_modules/x/y.sql", ".hidden/z.sql"]) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), "");
    }
    assert.deepEqual(listFiles(["src"], dir), ["src/a.ts", "src/q.sql"]);
    const index = new FileIndex(dir);
    assert.deepEqual(index.extend(["src"]), ["src/a.ts", "src/q.sql"]);
    assert.deepEqual(index.extend(["src", "test", "nope"]), ["src/a.ts", "src/q.sql", "test/a.test.ts"], "test/ added, src/ not walked again, a missing root ignored");
    assert.ok(isUnder("src/q.sql", "src") && isUnder("src/q.sql", ".") && !isUnder("test/a.test.ts", "src"));
    // Both consumers see one tree: a .sql under test/ is a text file only when test/ was asked for.
    writeFileSync(join(dir, "test/t.sql"), "");
    const shared = new FileIndex(dir);
    assert.deepEqual(findTextFiles(["src"], ["sql"], dir, shared), ["src/q.sql"]);
    assert.deepEqual(findTestFiles(["src"], dir, shared), ["test/a.test.ts"]);
    assert.deepEqual(findTextFiles(["src"], ["sql"], dir, shared), ["src/q.sql"], "the test/ root the paired arm added is not one of the text rule's paths");
    // A root outside the cwd is named absolutely by the walk, and is still
    // under itself: `jev-lint check ../queries` from a subdirectory found
    // nothing, because the relative root never matched the absolute name.
    const outside = mkdtempSync(join(tmpdir(), "jev-outside-"));
    try {
      writeFileSync(join(outside, "o.sql"), "");
      const found = findTextFiles([relative(dir, outside)], ["sql"], dir, new FileIndex(dir));
      assert.deepEqual(found, [join(outside, "o.sql").split(sep).join("/")]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
