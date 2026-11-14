import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertChannelAdvance, createReleasePlan } from "../tools/release.ts";
import { test } from "./harness.ts";

function fixture(version = "0.8.0") {
  return { tag: `v${version}`, package: { name: "jev-lint", version, repository: { url: "git+https://github.com/mizchi/jev-lint.git" }, publishConfig: { access: "public" } },
    lock: { version, packages: { "": { version } } }, plugin: { version }, marketplace: { plugins: [{ name: "jev-lint", version }] },
    changelog: `# Changelog\n\n## Unreleased\n\nLater work.\n\n## ${version} — 2026-11-15\n\n### Added\n\n- New initialization commands.\n\n## 0.7.0\n\nOld release.\n` };
}
test("release: a stable tag requires matching package, lockfile, plugin and nonempty release notes", () => {
  const plan = createReleasePlan(fixture());
  assert.equal(plan.version, "0.8.0"); assert.equal(plan.tag, "v0.8.0"); assert.equal(plan.distTag, "latest"); assert.equal(plan.prerelease, false);
  assert.equal(plan.filename, "jev-lint-0.8.0.tgz"); assert.ok(plan.notes.includes("New initialization commands."));
  assert.ok(!plan.notes.includes("Later work") && !plan.notes.includes("Old release"));
});
test("release: malformed or inconsistent identities and missing or duplicate notes prevent publication", () => {
  const changes: Array<(f: any) => void> = [
    (f) => { f.tag = "v0.2.0"; }, (f) => { f.package.version = "0.08.0"; f.tag = "v0.08.0"; },
    (f) => { f.package.name = "another-package"; }, (f) => { f.lock.version = "0.7.1"; },
    (f) => { f.lock.packages[""].version = "0.7.1"; }, (f) => { f.plugin.version = "0.7.1"; },
    (f) => { f.marketplace.plugins[0].version = "0.7.1"; }, (f) => { f.package.repository.url = "git+https://github.com/another/repo.git"; },
    (f) => { f.package.publishConfig.access = "restricted"; }, (f) => { f.changelog = "## Unreleased\n\nPending."; },
    (f) => { f.changelog = "## 0.8.0\n\n## 0.7.0\n\nOld."; }, (f) => { f.changelog += "\n## 0.8.0\n\nDuplicate."; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => createReleasePlan(f)); }
});
test("release: prerelease tags select next without changing the stable latest channel", () => {
  const plan = createReleasePlan(fixture("0.8.0-rc.1"));
  assert.equal(plan.distTag, "next"); assert.equal(plan.prerelease, true); assert.equal(plan.filename, "jev-lint-0.8.0-rc.1.tgz");
  assert.throws(() => createReleasePlan(fixture("0.8.0-rc.01")));
});
test("release: a channel advances by semantic version and never regresses or republishes", () => {
  const stable = createReleasePlan(fixture());
  assert.doesNotThrow(() => assertChannelAdvance(stable, { latest: "0.7.10", next: "0.9.0-rc.1" }));
  assert.doesNotThrow(() => assertChannelAdvance(stable, {}));
  for (const current of ["0.8.0", "0.8.1", "0.10.0", "1.0.0"]) {
    assert.throws(() => assertChannelAdvance(stable, { latest: current }), /must advance latest/);
  }
  for (const [before, after] of [["0.8.0-alpha", "0.8.0-alpha.1"], ["0.8.0-alpha.1", "0.8.0-alpha.beta"], ["0.8.0-alpha.2", "0.8.0-alpha.10"],
    ["0.8.0-alpha.10", "0.8.0-beta"], ["0.8.0-beta", "0.8.0-rc.1"], ["0.8.0-rc.1", "0.8.0"]]) {
    const channel = after.includes("-") ? "next" : "latest";
    assert.doesNotThrow(() => assertChannelAdvance(createReleasePlan(fixture(after)), { [channel]: before }));
    assert.throws(() => assertChannelAdvance(createReleasePlan(fixture(before)), { next: after }), /must advance next/);
  }
});
test("release: malformed registry responses cannot authorize a channel change", () => {
  const plan = createReleasePlan(fixture());
  for (const channels of [null, [], "0.7.0", { latest: null }, { latest: 7 }, { latest: "bad" }, { latest: "0.08.0" }]) {
    assert.throws(() => assertChannelAdvance(plan, channels));
  }
});
test("release: CLI refuses stale or unreadable channel data before writing release artifacts", () => {
  const scratch = mkdtempSync(join(tmpdir(), "jev-release-"));
  try {
    const channelFile = join(scratch, "channels.json"), output = join(scratch, "release");
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL("../tools/release.ts", import.meta.url)),
      "--check-channel", channelFile, "--out-dir", output], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } });
    assert.notEqual(run().status, 0);
    writeFileSync(channelFile, "{"); assert.notEqual(run().status, 0);
    writeFileSync(channelFile, JSON.stringify({ latest: version, next: version }));
    const stale = run(); assert.notEqual(stale.status, 0); assert.match(stale.stderr, /must advance/);
    assert.equal(existsSync(output), false);
    writeFileSync(channelFile, "{}");
    const accepted = run(); assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).version, version);
    assert.equal(JSON.parse(readFileSync(join(output, "release.json"), "utf8")).version, version);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
