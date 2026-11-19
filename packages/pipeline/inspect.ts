import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, Jev, JevError, USD_PER_MTOK } from "../../src/jev.ts";
import { readAnswer } from "../../src/questions.ts";
import { evaluate, evolve, facts, staticVerdict, type Observation, type Rule, type Sample } from "./inspection.ts";
import { InspectionCache, observe } from "./inspection-cache.ts";

const started = performance.now();
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  provider: { type: "string", default: "lexical" }, db: { type: "string" }, input: { type: "string" },
  mode: { type: "string", default: "active" }, evolve: { type: "boolean" },
  benchmark: { type: "boolean" }, repeat: { type: "string", default: "1" }, rounds: { type: "string", default: "4" }, retries: { type: "string", default: "2" },
  budget: { type: "string", default: "100" },
} });
function integer(text: string, name: string) {
  const value = Number(text);
  if (!text.trim() || !Number.isSafeInteger(value) || value < 0) throw Error("Invalid " + name);
  return value;
}
const budget = { remaining: integer(values.budget, "budget"), attempts: 0, hits: 0, usd: 0 };
const retries = integer(values.retries, "retries");
const repeat = integer(values.repeat, "repeat");
if (repeat < 1 || (repeat !== 1 && !values.benchmark)) throw Error("Use a positive repeat count with --benchmark");
const rounds = integer(values.rounds, "rounds");
if (!["active", "static", "model"].includes(values.mode)) throw Error("Choose mode active, static or model");
if (values.evolve && values.mode !== "active") throw Error("Evolution requires active mode");
if (positionals.length && (values.input || values.evolve)) throw Error("Use a corpus for evolution or manifest paths for inspection");
type Row = Sample & { split?: "train" | "validation" | "test" };
const read = (path: string | URL): unknown => JSON.parse(readFileSync(path, "utf8"));
function manifest(value: unknown) {
  if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string" || !value.name.trim()) throw Error("Expected package name");
  const description = "description" in value ? value.description : undefined;
  if (description !== undefined && typeof description !== "string") throw Error("Expected string description");
  if (Buffer.byteLength(value.name) + Buffer.byteLength(description ?? "") > 8192) throw Error("Manifest fields exceed 8192 bytes");
  return { name: value.name, description };
}
function readCorpus(): Row[] {
  if (positionals.length) return positionals.map(path => ({ id: path, ...manifest(read(path)) }));
  const raw = read(values.input ?? new URL("./manifests.json", import.meta.url));
  if (!Array.isArray(raw) || !raw.length) throw Error("Expected a nonempty corpus");
  return raw.map(row => {
    const fields = manifest(row);
    if (typeof row.id !== "string" || !row.id || (row.expected !== undefined && typeof row.expected !== "boolean")) throw Error("Invalid id or expected label");
    if (row.split !== undefined && !["train", "validation", "test"].includes(row.split)) throw Error("Invalid split");
    return { id: row.id, ...fields, expected: row.expected, split: row.split };
  });
}
if (values.benchmark && (values.evolve || values.mode !== "active")) throw Error("Run the cold benchmark separately from policy evolution and mode selection");
const rows = readCorpus();
if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("Duplicate manifest ID");
const split = rows.some(row => row.split !== undefined);
if (split && rows.some(row => !row.split)) throw Error("Assign every row a split");
const test = split ? rows.filter(row => row.split === "test") : rows;
if (!test.length) throw Error("No evaluation manifests");
const train = rows.filter(row => row.split === "train");
const validation = rows.filter(row => row.split === "validation");
if (values.evolve && (!train.length || !validation.length || rows.some(row => row.expected === undefined))) {
  throw Error("Evolution requires labelled train, validation and test splits");
}

if (values.evolve) {
  const manifests = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.name, row.description]);
    if (manifests.has(key)) throw Error("Duplicate training or evaluation manifest: " + row.id);
    manifests.add(key);
  }
}

const question = { type: "noul" as const,
  instructions: { claim: "The npm package description fails to identify what the software does or provides." },
  criteria: { true: "Missing, blank, repeats the package name or only gives boilerplate or project status.",
    false: "Names a concrete capability, purpose or artifact. Short descriptions can be informative." },
};
const jev = new Jev({ baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, retries: 0, rateLimitRetries: 0 });
const lexical = /^(todo|placeholder|tbd)\b/i;
if (!["jev", "lexical"].includes(values.provider)) throw Error("Choose provider lexical or jev");
const identity = values.provider === "jev" ? JSON.stringify([jev.baseUrl, jev.model, question, 0.5])
  : "manifest-lexical:" + lexical.toString() + ":empty-v1";
const scope = "manifest-description-v1:" + identity;

async function ask(state: Pick<Sample, "name" | "description">): Promise<Observation> {
  const start = performance.now();
  if (values.provider === "lexical") {
    const description = state.description?.trim();
    return { defect: !description || lexical.test(description), usd: 0, ms: performance.now() - start };
  }
  const response = await jev.ask(state, { defect: question });
  const answer = readAnswer(response.answers, "defect", "noul");
  const tokens = response.usage?.input_tokens;
  if (!answer || tokens === undefined) throw Error("Jev returned an incomplete verdict or usage");
  return { defect: answer.value >= 0.5, usd: tokens * USD_PER_MTOK / 1e6, ms: performance.now() - start };
}
const transient = (err: unknown) => err instanceof JevError && (err.kind === "transient" || err.status >= 500 || err.status === 429);
const path = values.db ?? fileURLToPath(new URL("./.runs/inspection.sqlite", import.meta.url));
mkdirSync(dirname(path), { recursive: true });
const cache = new InspectionCache(path);
const observations = new Map<string, Observation>();
async function collect(items: Row[], rules: readonly Rule[] | null, store = cache) {
  for (const item of items) {
    if (rules !== null && staticVerdict(facts(item), rules) !== undefined) continue;
    const answer = await observe(store, identity, item, ask, budget, retries, transient);
    if (!answer) return false;
    observations.set(item.id, answer);
  }
  return true;
}
async function benchmark() {
  const arms = [];
  const active = cache.rules(scope);
  const modes = [["model", null], ["static", []], ["active", active]] as const;
  for (let round = 0; round < repeat; round++) {
    for (let position = 0; position < modes.length; position++) {
      const [mode, rules] = modes[(position + round) % modes.length];
      const cold = new InspectionCache(":memory:");
      try {
        observations.clear();
        const begin = performance.now();
        const attempts = budget.attempts;
        const complete = await collect(test, rules, cold);
        const result = complete ? evaluate(test, observations, rules) : null;
        const wallMs = performance.now() - begin;
        arms.push({ round: round + 1, mode, complete, attempts: budget.attempts - attempts, wallMs, result });
        if (!complete) return { complete: false, arms };
      } finally { cold.close(); }
    }
  }
  return { complete: true, arms };
}
async function inspect() {
  let rules = values.mode === "model" ? null : values.mode === "static" ? [] : cache.rules(scope);
  let rewrites;
  if (values.evolve) {
    if (!await collect(validation, rules)) return { complete: false, stage: "validation" };
    const improved = evolve(train, validation, observations, rules!, rounds, (previous, next) => cache.rewrite(scope, previous, next));
    rules = improved.rules;
    rewrites = improved.history;
  }
  if (!await collect(test, values.evolve ? null : rules)) return { complete: false, stage: "inspection", rewrites };
  return { complete: true, rules, rewrites,
    modelBaseline: values.evolve ? evaluate(test, observations, null) : undefined,
    result: evaluate(test, observations, rules) };
}
try {
  const report = values.benchmark ? await benchmark() : await inspect();
  console.log(JSON.stringify({ provider: values.provider, ...report, execution: {
    attempts: budget.attempts, cacheHits: budget.hits, observedUsd: budget.usd, wallMs: performance.now() - started,
  } }, null, 2));
} finally { cache.close(); }
