import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReleasePlan { version: string; tag: string; filename: string; distTag: "latest" | "next"; prerelease: boolean; notes: string }
interface ReleaseInput { tag: string; package: unknown; lock: unknown; plugin: unknown; marketplace: unknown; changelog: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?$`);

/** Package and plugin identities must agree before a tag may publish either distribution. */
export function createReleasePlan(input: ReleaseInput): ReleasePlan {
  const fail = (): never => { throw new Error("release tag, package, lockfile, plugin identities and changelog must agree"); };
  const pkg = input.package, lock = input.lock, plugin = input.plugin, marketplace = input.marketplace;
  if (!object(pkg) || pkg.name !== "jev-lint" || typeof pkg.version !== "string" || !semver.test(pkg.version) || input.tag !== `v${pkg.version}`
    || !object(pkg.repository) || pkg.repository.url !== "git+https://github.com/mizchi/jev-lint.git"
    || !object(pkg.publishConfig) || pkg.publishConfig.access !== "public" || !object(lock) || lock.version !== pkg.version
    || !object(lock.packages) || !object(lock.packages[""]) || lock.packages[""].version !== pkg.version
    || !object(plugin) || plugin.version !== pkg.version || !object(marketplace) || !Array.isArray(marketplace.plugins)
    || marketplace.plugins.length !== 1 || !object(marketplace.plugins[0]) || marketplace.plugins[0].name !== pkg.name || marketplace.plugins[0].version !== pkg.version
    || typeof input.changelog !== "string") return fail();
  const lines = input.changelog.split("\n");
  const headings = lines.flatMap((line, i) => /^##\s+/.test(line) ? [{ i, version: line.trim().split(/\s+/)[1] }] : []);
  const found = headings.filter((h) => h.version === pkg.version);
  if (found.length !== 1) return fail();
  const start = found[0].i + 1, end = headings.find((h) => h.i >= start)?.i ?? lines.length;
  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) return fail();
  const prerelease = pkg.version.includes("-");
  return { version: pkg.version, tag: input.tag, filename: `jev-lint-${pkg.version}.tgz`, distTag: prerelease ? "next" : "latest", prerelease, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), cwd = process.cwd();
  const read = (path: string) => JSON.parse(readFileSync(join(cwd, path), "utf8"));
  const pkg = read("package.json");
  const tag = args[0] && !args[0].startsWith("--") ? args.shift()! : `v${pkg.version}`;
  let output: string | null = null;
  if (args.length) { if (args.length !== 2 || args[0] !== "--out-dir" || !args[1]) throw new Error("use release.ts [v<version>] [--out-dir <path>]"); output = resolve(args[1]); }
  const plan = createReleasePlan({ tag, package: pkg, lock: read("package-lock.json"), plugin: read(".claude-plugin/plugin.json"),
    marketplace: read(".claude-plugin/marketplace.json"), changelog: readFileSync(join(cwd, "CHANGELOG.md"), "utf8") });
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "release.json"), JSON.stringify(plan, null, 2) + "\n");
    writeFileSync(join(output, "release-notes.md"), plan.notes + "\n");
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\nfilename=${plan.filename}\ndist-tag=${plan.distTag}\nprerelease=${plan.prerelease}\n`);
  process.stdout.write(JSON.stringify({ ...plan, notes: undefined }, null, 2) + "\n");
}
