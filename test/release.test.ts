import { strict as assert } from "node:assert";
import { createReleasePlan } from "../tools/release.ts";
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
