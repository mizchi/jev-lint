import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const target = args.find((arg) => arg !== "--check");
if (!target) throw new Error("usage: export-scan-contract <consumer-file> [--check]");
const source = readFileSync(fileURLToPath(new URL("../src/scan-contract.ts", import.meta.url)), "utf8");
if (args.includes("--check")) {
  if (readFileSync(resolve(target), "utf8") !== source) throw new Error("consumer scan contract differs from this producer");
} else {
  mkdirSync(dirname(resolve(target)), { recursive: true });
  writeFileSync(resolve(target), source);
}
