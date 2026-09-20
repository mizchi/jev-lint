import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testAsync } from "./helpers.ts";

await testAsync("cli: `commits --base <ref>` with `paths:` in the config judges the range, not the paths", async () => {
  // Found by running the tool on itself: `.jev-lint.yaml` names `paths:
  // [src, ...]`, and `commits --base v0.4.1` judged 52 commits "in src" --
  // the config's first path had become the git range. The range is a
  // command-line positional or --base; a config path is never one.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "jev-commits-cfg-")));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString();
  try {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    mkdirSync(join(dir, "src"));
    for (const n of [1, 2, 3]) {
      writeFileSync(join(dir, "src/a.ts"), `export const a = ${n};\n`);
      git(["add", "src/a.ts"]);
      git(["commit", "-q", "-m", `commit ${n}`]);
    }
    const base = git(["rev-parse", "HEAD~1"]).trim();
    writeFileSync(join(dir, ".jev-lint.yaml"), "paths: [src]\n");
    const cli = join(realpathSync("."), "src/cli.ts");
    const shipped = join(realpathSync("."), "rules");
    const out = execFileSync("node", ["--experimental-strip-types", cli, "commits", "--base", base, "--dry-run", "--cache", "none", "-R", shipped, "--no-color"], {
      cwd: dir,
      stdio: "pipe",
      env: { ...process.env, TYPESAFE_API_KEY: "x" },
    }).toString();
    assert.match(out, new RegExp(`1 commit\\(s\\) in ${base}\\.\\.HEAD`), out);
    assert.doesNotMatch(out, /in src/, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
