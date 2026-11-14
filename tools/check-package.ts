import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parse } from "yaml";

const cwd = process.cwd(), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out-dir" || !args[1])) throw new Error("use check-package.ts [--out-dir <path>]");
const scratch = mkdtempSync(join(tmpdir(), "jev-package-")), output = args.length ? resolve(args[1]) : scratch;
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(?:TYPESAFE|TYPESAFEAI|JEV_LINT)_/.test(name) || ["NPM_TOKEN", "NODE_AUTH_TOKEN", "NODE_PATH", "NODE_OPTIONS"].includes(name)) delete env[name];
const run = (command: string, argv: string[], directory: string) => execFileSync(command, argv, { cwd: directory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
try {
  mkdirSync(output, { recursive: true });
  const pack = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", output], cwd))[0];
  assert.equal(pack.name, "jev-lint");
  assert.ok(pack.files.find((f: { path: string; mode: number }) => f.path === "dist/cli.js" && f.mode & 0o111), "the packaged CLI must be executable");
  assert.ok(!pack.files.some((f: { path: string }) => /^(?:src|test|experiments)\//.test(f.path)), "source tests and evaluation artifacts must not enter the runtime package");
  const publisher = join(scratch, "publisher"); mkdirSync(join(publisher, "release"), { recursive: true });
  copyFileSync(join(output, pack.filename), join(publisher, "release", pack.filename));
  const workflow = parse(readFileSync(join(cwd, ".github/workflows/release.yml"), "utf8"));
  const publish = workflow.jobs.publish.steps.find((step: { name?: string }) => step.name === "Publish the tested tarball through npm OIDC");
  assert.equal(typeof publish?.run, "string", "the release workflow must publish the tested tarball");
  execFileSync("bash", ["-e", "-c", `${publish.run} --dry-run`], { cwd: publisher, encoding: "utf8", timeout: 30000,
    env: { ...env, PACKAGE_FILE: pack.filename, DIST_TAG: "latest", NPM_CONFIG_DRY_RUN: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  const consumer = join(scratch, "consumer"); mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "jev-lint-consumer", private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(output, pack.filename)], consumer);
  const pkg = JSON.parse(readFileSync(join(consumer, "node_modules/jev-lint/package.json"), "utf8"));
  const modules = Object.keys(pkg.exports).filter((key) => key !== "./package.json").map((key) => key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`);
  writeFileSync(join(consumer, "types.ts"), modules.map((name, i) => `import * as exported${i} from ${JSON.stringify(name)}; void exported${i};`).join("\n"));
  run(process.execPath, [join(cwd, "node_modules/typescript/bin/tsc"), "--noEmit", "--noImplicitAny", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023",
    "--types", "node", "--typeRoots", join(cwd, "node_modules/@types"), "types.ts"], consumer);
  mkdirSync(join(consumer, "src")); writeFileSync(join(consumer, "src/pricing.ts"), "export function addTax(amount: number) { return amount * 1.1; }\n");
  const ruleCount = pack.files.filter((f: { path: string }) => /^rules\/[^/]+\/[^/]+\/rule.yml$/.test(f.path)).length;
  writeFileSync(join(consumer, "smoke.mjs"), `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
for (const name of ${JSON.stringify(modules)}) await import(name);
const cli = (args, status = 0) => {
  const result = spawnSync(process.execPath, ['node_modules/jev-lint/dist/cli.js', ...args], { encoding: 'utf8' });
  assert.equal(result.status, status, result.stderr.slice(0, 1600));
  return JSON.parse(result.stdout);
};
const rules = cli(['rules', '--no-config', '--json']);
assert.deepEqual(rules.errors, []); assert.equal(rules.rules.length, ${ruleCount});
const plan = cli(['check', 'src', '--no-config', '--cache', 'none', '-R', 'node_modules/jev-lint/rules/typescript/fn-name-promises', '--dry-run', '--json']);
assert.ok(plan.subjects > 0); assert.equal(plan.dryRun, true);
const startup = cli(['init', '--introspect', '--dry-run', '--json']);
assert.equal(startup.modelRequests, 0); assert.ok(startup.input.candidates.length > 0); assert.equal(existsSync('.jev-lint.yaml'), false);
const unavailable = cli(['init', '--introspect', '--json'], 3);
assert.equal(unavailable.status, 'failed'); assert.equal(existsSync('.jev-lint.yaml'), false);
const initialized = cli(['init', '--json']); assert.equal(initialized.wrote, '.jev-lint.yaml');
const configuration = readFileSync('.jev-lint.yaml', 'utf8');
writeFileSync('contract.md', '# Runtime\\n\\nNode 24 is required.');
writeFileSync('guide.md', '# Runtime\\n\\nUse Node.js 24+.');
writeFileSync('documents.json', JSON.stringify({schema:'jev-lint-documents-manifest-1',files:{a:{path:'contract.md',role:'reference'},b:{path:'guide.md',role:'document'}},comparisons:[{id:'runtime',topic:'Node floor',mode:'semantic',reference:{source:'a'},target:{source:'b'}}]}));
const docs = cli(['docs', '--document-manifest', 'documents.json', '--dry-run', '--json']);
assert.equal(docs.modelRequests, 0); assert.equal(docs.input.comparisons.length, 1);
console.log(JSON.stringify({exports:${modules.length},rules:${ruleCount},matchedSubjects:plan.subjects,startupRequests:startup.modelRequests,missingKey:unavailable.status,documentComparisons:docs.input.comparisons.length,configuration}));
`);
  const { configuration, ...result } = JSON.parse(run(process.execPath, ["smoke.mjs"], consumer));
  assert.equal(Object.keys(parse(configuration).rules).length, ruleCount);
  process.stdout.write(JSON.stringify({ ...result, publishDryRun: true, package: pack.filename, bytes: pack.size, unpackedBytes: pack.unpackedSize }, null, 2) + "\n");
} finally { rmSync(scratch, { recursive: true, force: true }); }
