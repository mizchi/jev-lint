import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2), target = args.find((arg) => arg !== "--check");
if (!target || args.some((arg) => arg.startsWith("--") && arg !== "--check")) throw new Error("usage: export-relation-contract <consumer-directory> [--check]");
const modules = ["relation-contract", "relation-plan", "relation-questions", "relation-report"];
for (const name of modules) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const exported = modules.reduce((text, dependency) => text.replaceAll(`"./${dependency}.ts"`, `"./jev-lint-${dependency}.ts"`), source);
  const path = resolve(target, `jev-lint-${name}.ts`);
  if (args.includes("--check")) {
    if (readFileSync(path, "utf8") !== exported) throw new Error(`consumer ${name} differs from this producer`);
  } else { mkdirSync(resolve(target), { recursive: true }); writeFileSync(path, exported); }
}
