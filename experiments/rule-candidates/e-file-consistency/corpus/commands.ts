import type { Context } from "../context.ts";
import type { BuildInput, TestInput, DeployInput, ExportInput, CleanInput } from "../model.ts";

export async function runBuild(ctx: Context, input: BuildInput): Promise<number> {
  ctx.log.info(`building ${input.target}`);
  return ctx.exec("tsc", ["-p", input.target]);
}

export async function runTest(ctx: Context, input: TestInput): Promise<number> {
  ctx.log.info(`testing ${input.pattern ?? "everything"}`);
  return ctx.exec("vitest", ["run", ...(input.pattern ? [input.pattern] : [])]);
}

export async function runDeploy(ctx: Context, input: DeployInput): Promise<number> {
  ctx.log.info(`deploying to ${input.env}`);
  return ctx.exec("wrangler", ["deploy", "--env", input.env]);
}

export async function runExport(input: ExportInput, ctx: Context): Promise<number> {
  ctx.log.info(`exporting to ${input.out}`);
  return ctx.exec("tar", ["-czf", input.out, "dist"]);
}

export async function runClean(ctx: Context, input: CleanInput): Promise<number> {
  ctx.log.info(`cleaning ${input.dirs.join(", ")}`);
  return ctx.exec("rm", ["-rf", ...input.dirs]);
}
