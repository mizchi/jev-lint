import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, Jev, USD_PER_MTOK } from "../../src/jev.ts";
import { readChoice } from "../../src/questions.ts";
import { scoreCatalog, type CatalogCase, type Reading } from "./catalog-eval.ts";
import { catalogRoute } from "./routes.ts";

const { values } = parseArgs({ options: {
  record: { type: "string" }, replay: { type: "string" }, details: { type: "boolean" },
} });
if (values.record && values.replay) throw Error("Choose record or replay");
const cases: CatalogCase[] = JSON.parse(readFileSync(new URL("./catalog-cases.json", import.meta.url), "utf8"));
const question = { type: "choice" as const,
  instructions: { task: "Classify the purchased product from its listing description alone." },
  criteria: { hardware: "A physical device or accessory is the primary item.",
    software: "A software product or digital license is the primary item.",
    abstain: "The category is unclear, or a mixed bundle has no primary category." },
};
const fingerprint = createHash("sha256").update(JSON.stringify([DEFAULT_BASE_URL, DEFAULT_MODEL, question,
  cases.map(({ id, description }) => [id, description])])).digest("hex");

async function record() {
  const client = new Jev({ model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL, retries: 0, rateLimitRetries: 0 });
  const answers: Record<string, Reading> = {};
  for (const { id, description } of cases) {
    if (!description.trim()) continue;
    const start = performance.now();
    const response = await client.ask({ description }, { category: question });
    const ms = Math.round(performance.now() - start);
    const choice = readChoice(response.answers, "category", catalogRoute.facts.text);
    const label = catalogRoute.facts.text.find(value => value === choice?.choice);
    const tokens = response.usage?.input_tokens;
    if (!label || tokens === undefined) throw Error("Unusable model response for " + id);
    answers[id] = { label, tokens, ms };
  }
  return { version: 1, fingerprint, model: DEFAULT_MODEL, recordedAt: new Date().toISOString(),
    usdPerMillionInputTokens: USD_PER_MTOK, answers };
}
if (values.record) mkdirSync(dirname(values.record), { recursive: true });
const snapshot: Awaited<ReturnType<typeof record>> = values.record ? await record()
  : JSON.parse(readFileSync(values.replay ?? new URL("./catalog-replay.json", import.meta.url), "utf8"));
if (snapshot.version !== 1 || snapshot.fingerprint !== fingerprint || snapshot.model !== DEFAULT_MODEL ||
  !Number.isFinite(snapshot.usdPerMillionInputTokens) || snapshot.usdPerMillionInputTokens < 0) {
  throw Error("Incompatible catalog recording; record fresh observations");
}
const policies = scoreCatalog(cases, snapshot.answers);
if (values.record) {
  const tmp = values.record + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n");
  renameSync(tmp, values.record);
}
console.log(JSON.stringify({ model: snapshot.model, recordedAt: snapshot.recordedAt,
  policies: Object.fromEntries(Object.entries(policies).map(([name, result]) => [name, {
    ...result.summary, estimatedUsd: result.summary.inputTokens * snapshot.usdPerMillionInputTokens / 1e6,
    ...(values.details ? { patterns: result.patterns, outcomes: result.outcomes } : {}),
  }])) }, null, 2));
