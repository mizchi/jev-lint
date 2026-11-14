import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Jev, API_KEY_VARS, fromEnv } from "../src/jev.ts";
import { scanRelations, RELATION_QUESTION, CLAIM_GROUNDING_QUESTION } from "../src/relations.ts";
import { relationDigest } from "../src/relation-contract.ts";
import { evaluateRelations, compareRelationEvaluations, replayRelationEvaluation, type RelationCase, type RelationExpectation, type RelationEvaluation } from "../src/relation-eval.ts";
import type { ChoiceQuestion } from "../src/types.ts";

const args = process.argv.slice(2), flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (!["--repeat", "--out", "--compare", "--corpus", "--question-from", "--replay"].includes(args[i]) || flags.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("invalid relation evaluation arguments");
  flags.set(args[i], args[++i]);
}
const repeat = Number(flags.get("--repeat") ?? 3);
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("repeat must be an integer from 1 to 10");
if (!flags.has("--replay") && !fromEnv(API_KEY_VARS)) throw new Error("live relation evaluation requires a model API key");
const corpus = resolve(flags.get("--corpus") ?? "experiments/relations");
const cases = JSON.parse(readFileSync(resolve(corpus, "inputs.json"), "utf8")).cases as RelationCase[];
const expected = JSON.parse(readFileSync(resolve(corpus, "expect.json"), "utf8")).cases as RelationExpectation[];
const saved = flags.has("--replay") ? JSON.parse(readFileSync(resolve(flags.get("--replay")!), "utf8")) : null;
if (saved && (flags.has("--question-from") || flags.has("--repeat"))) throw new Error("replay uses its recorded repeat and questions");
const question = saved?.question ?? (flags.has("--question-from") ? JSON.parse(readFileSync(resolve(flags.get("--question-from")!), "utf8")).question as ChoiceQuestion : RELATION_QUESTION);
if (!question || question.type !== "choice") throw new Error("recorded comparison question is missing");
const baseline = flags.has("--compare") ? await replayRelationEvaluation(cases, expected, JSON.parse(readFileSync(resolve(flags.get("--compare")!), "utf8")) as RelationEvaluation) : null;
if (baseline && baseline.repeat !== (saved?.repeat ?? repeat)) throw new Error("relation evaluations are not comparable");
const client = new Jev({ budget: { maxRequests: cases.length * repeat * 2, maxInputTokens: Math.min(600000, Math.max(300000, cases.length * repeat * 3000)), maxUsd: 0.03, maxMs: 300000 },
  onRequest: (body) => { if (body.includes('"expectedChoice"') || body.includes('"statuses"')) throw new Error("evaluation labels reached the model"); } });
let completed = 0;
const evaluation = saved ? await replayRelationEvaluation(cases, expected, saved as RelationEvaluation)
  : await evaluateRelations({ cases, expected, repeat, questions: { q0000: question, q0001: CLAIM_GROUNDING_QUESTION }, run: async (input) => {
    const report = await scanRelations(input, { client, question });
    if (++completed % 25 === 0) process.stdout.write("evaluated " + completed + "/" + cases.length * repeat + "\n");
    return report;
  } });
const comparison = baseline ? compareRelationEvaluations(baseline, evaluation) : null;
const output = resolve(flags.get("--out") ?? resolve(corpus, "last.json"));
mkdirSync(dirname(output), { recursive: true });
if (!flags.has("--replay") || flags.has("--out")) writeFileSync(output, `${JSON.stringify({ ...evaluation, question,
  groundingQuestion: saved ? saved.groundingQuestion ?? null : CLAIM_GROUNDING_QUESTION,
  promptRevision: saved ? saved.promptRevision : relationDigest({ q0000: question, q0001: CLAIM_GROUNDING_QUESTION }),
  requestedModel: saved ? saved.requestedModel : client.model, usage: saved ? saved.usage : client.spent, comparison }, null, 2)}\n`);
process.stdout.write(`${output}\n`);
for (const dimension of evaluation.dimensions) process.stdout.write(`${dimension.id}: ${dimension.score.toFixed(2)}/4 (${dimension.passed}/${dimension.expected})\n`);
process.stdout.write(`total ${evaluation.total.toFixed(2)}/100; gate ${evaluation.gate}; missing ${evaluation.missing}; precision ${evaluation.precision}; recall ${evaluation.recall}\n`);
const failures = evaluation.samples.filter((s) => Object.values(s.checks).some((passed) => !passed));
for (const sample of failures) process.stdout.write(`${sample.id}:${sample.pass} ${JSON.stringify({ checks: sample.checks, choice: sample.report?.candidates[0]?.judgment?.choice ?? null, resolution: sample.report?.candidates[0]?.resolution ?? null })}\n`);
if (comparison) process.stdout.write(`comparison ${JSON.stringify(comparison)}\n`);
process.exitCode = evaluation.gate === "pass" && (!comparison || comparison.accepted) ? 0 : 1;
