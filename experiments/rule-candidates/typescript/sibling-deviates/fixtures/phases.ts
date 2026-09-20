import type { PhaseDeps, PhaseResult } from "../model.ts";
import type { IterateRequest } from "../protocol.ts";

export type PhaseParams = {
  request: IterateRequest;
  baseCommit: string;
  deps: PhaseDeps;
};

export async function executePlanPhase(params: PhaseParams): Promise<PhaseResult> {
  const plan = await params.deps.planner.plan(params.request, params.baseCommit);
  return { phase: "plan", ok: plan.steps.length > 0, notes: plan.summary };
}

export async function executeEditPhase(params: PhaseParams): Promise<PhaseResult> {
  const patch = await params.deps.editor.apply(params.request, params.baseCommit);
  return { phase: "edit", ok: patch.files.length > 0, notes: patch.summary };
}

export async function executeVerifyPhase(params: PhaseParams): Promise<PhaseResult> {
  const run = await params.deps.runner.test(params.baseCommit);
  return { phase: "verify", ok: run.failed === 0, notes: `${run.passed} passed` };
}

export async function executeSubmitPhase(
  request: IterateRequest,
  baseCommit: string,
  deps: PhaseDeps,
): Promise<PhaseResult> {
  const pr = await deps.publisher.open(request, baseCommit);
  return { phase: "submit", ok: pr.url !== null, notes: pr.url ?? "not opened" };
}

export async function executeReportPhase(params: PhaseParams): Promise<PhaseResult> {
  await params.deps.reporter.post(params.request.jobId, params.baseCommit);
  return { phase: "report", ok: true, notes: "" };
}
