import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildSuites } from "./index.ts";

function run(args: string[]): void {
  const [input, out] = args;
  if (args.length !== 2) throw new Error("Usage: skill-to-decision CASES.json NEW_DIRECTORY");
  const { decisions, files } = buildSuites(JSON.parse(readFileSync(input, "utf8")));
  mkdirSync(out);
  try {
    for (const [path, content] of Object.entries(files)) {
      const dest = join(out, path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    writeFileSync(join(out, "decisions.json"), JSON.stringify(decisions, null, 2) + "\n");
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    throw error;
  }
}

try {
  run(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
