import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readInstructions } from "./instructions.ts";

export interface PolicySource { ref: string; digest: string }

/** Resolve once so a moving branch cannot change the standard halfway through a run. */
export function resolvePolicySource(cwd: string, ref: string): PolicySource {
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { throw new Error("policy ref does not resolve to a commit"); }
  const instructions = readInstructions(sha, cwd);
  if (instructions.docs.length === 0) throw new Error("policy ref contains no instruction document");
  return { ref: sha, digest: createHash("sha256").update(JSON.stringify(instructions)).digest("hex") };
}
