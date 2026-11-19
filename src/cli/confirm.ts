import { modelSpec } from "../model.ts";
import type { Log, Options } from "./args.ts";
import type { AskClient } from "../jev.ts";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type Confirmation = "approved" | "declined" | "unavailable";
export type Confirm = (message: string) => Promise<Confirmation>;
interface ConfirmationIO {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
}

export async function confirmRun(message: string, { input, output }: ConfirmationIO = {
  input: process.stdin, output: process.stderr,
}): Promise<Confirmation> {
  if (!input.isTTY || !output.isTTY || input.destroyed || output.destroyed) return "unavailable";
  const reader = createInterface({ input, output, terminal: true });
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: Confirmation) => {
      if (settled) return;
      settled = true;
      input.removeListener("error", failed);
      reader.close(); resolve(result);
    };
    const failed = () => done("unavailable");
    input.once("error", failed); reader.once("error", failed);
    reader.once("close", () => done("declined"));
    reader.once("SIGINT", () => done("declined"));
    reader.question(`${message} [y/N] `, (answer) => done(/^(?:y|yes)$/i.test(answer.trim()) ? "approved" : "declined"));
  });
}

export async function confirmExecution(
  opts: Options, client: AskClient | null, out: Log, log: Log,
  confirm: Confirm = confirmRun, startup?: string,
): Promise<number | null> {
  const spec = client ? null : modelSpec(opts.model);
  const implicit = spec?.implicitOpenRouter;
  if (!implicit && (!startup || opts.yes)) return null;
  const prompt = startup ?? `Send project data to OpenRouter (${spec!.model}) for this run?`;
  const answer = await confirm(implicit ? `Detected OPENROUTER_API_KEY. Usage may incur charges. ${prompt}` : prompt);
  if (answer === "approved") return null;
  const cancelled = answer === "declined";
  const status = cancelled ? "cancelled" : "confirmation-required";
  if (cancelled) log("Run cancelled before sending model requests.");
  else if (implicit) log(`OpenRouter confirmation requires an interactive terminal. To select this provider explicitly, pass --model openrouter:${spec.model}${startup ? " --yes" : ""}.`);
  else log("auto: an interactive terminal is required; pass --yes to run without confirmation");
  if (opts.format === "json") out(JSON.stringify(startup
    ? { schema: "jev-lint-auto-1", status, introspection: null, check: null }
    : { schema: "jev-lint-confirmation-1", status }, null, 2));
  return cancelled && startup ? 0 : 2;
}
