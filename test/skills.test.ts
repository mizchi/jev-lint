import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSkills } from "../tools/sync-skills.ts";
import { test } from "./harness.ts";

test("skills: the Claude entry points at the plugin skill and follows edits", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-skills-"));
  try {
    const source = join(root, "skills", "jev-lint");
    const link = join(root, ".claude", "skills", "jev-lint");
    mkdirSync(source, { recursive: true });
    assert.throws(() => syncSkills(root), /ENOENT/, "a missing source cannot produce a working link");
    writeFileSync(join(source, "SKILL.md"), "first\n");

    syncSkills(root);
    assert.equal(readlinkSync(link), "../../skills/jev-lint");
    assert.equal(readFileSync(join(link, "SKILL.md"), "utf8"), "first\n");
    writeFileSync(join(source, "SKILL.md"), "second\n");
    assert.equal(readFileSync(join(link, "SKILL.md"), "utf8"), "second\n");
    assert.doesNotThrow(() => syncSkills(root, true));

    rmSync(link);
    mkdirSync(link);
    writeFileSync(join(link, "SKILL.md"), "stale copy\n");
    assert.throws(() => syncSkills(root, true), /symlink/);
    assert.throws(() => syncSkills(root), /symlink/);
    assert.equal(readFileSync(join(link, "SKILL.md"), "utf8"), "stale copy\n");

    rmSync(link, { recursive: true });
    symlinkSync("../wrong", link);
    assert.throws(() => syncSkills(root, true), /symlink/);
    syncSkills(root);
    assert.equal(readlinkSync(link), "../../skills/jev-lint");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
