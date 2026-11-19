import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, Jev } from "../../src/jev.ts";
import { readAnswer } from "../../src/questions.ts";
import { Decisions } from "./sqlite.ts";
import { run, type Decide, type Item } from "./pipeline.ts";

const { values } = parseArgs({ options: {
  provider: { type: "string", default: "lexical" },
  input: { type: "string" }, db: { type: "string" },
  "group-size": { type: "string", default: "4" }, budget: { type: "string", default: "100" },
  "prune-below": { type: "string", default: "0.1" },
} });
const question = {
  type: "noul" as const,
  instructions: { claim: "At least one independent support ticket in this array reports an unresolved duplicate settled payment for the same purchase." },
  criteria: {
    true: "Two settled payments for one purchase, with repayment still outstanding in the same ticket.",
    false: "Every ticket is unrelated, only a pending hold, separate purchases, or the extra payment was already returned.",
  },
};
const cases: unknown = JSON.parse(readFileSync(values.input ?? new URL("./cases.json", import.meta.url), "utf8"));
if (!Array.isArray(cases)) throw Error("Expected an array of tickets");
const items: Item[] = [];
const expected = new Set<string>();
let labelled = 0;
for (const record of cases) {
  if (!record || typeof record.id !== "string" || typeof record.text !== "string") throw Error("Expected id and text");
  items.push({ id: record.id, text: record.text });
  if (record.expected === undefined) continue;
  if (typeof record.expected !== "boolean") throw Error("Expected a boolean label");
  labelled++;
  if (record.expected) expected.add(record.id);
}
if (labelled && labelled !== items.length) throw Error("Label all tickets or omit all labels");

let identity: string;
let decide: Decide;
let client: Jev | undefined;
if (values.provider === "jev") {
  const jev = new Jev({ model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL, retries: 0, rateLimitRetries: 0 });
  client = jev;
  identity = JSON.stringify([jev.baseUrl, jev.model, question]);
  decide = async tickets => {
    const response = await jev.ask(tickets, { match: question });
    const answer = readAnswer(response.answers, "match", "noul");
    if (!answer) throw Error("Jev returned no usable score; rerun to resume");
    return answer.value;
  };
} else if (values.provider === "lexical") {
  const pattern = /duplicate|paid twice|extra charge|both debits/i;
  identity = "lexical:" + pattern.toString();
  decide = async tickets => Number(tickets.some(ticket => pattern.test(ticket.text)));
} else throw Error("Choose provider lexical or jev");

const path = values.db ?? fileURLToPath(new URL("./.runs/decisions.sqlite", import.meta.url));
mkdirSync(dirname(path), { recursive: true });
const store = new Decisions(path);
try {
  const result = await run({ items, store, decide, identity, groupSize: Number(values["group-size"]),
    maxCalls: Number(values.budget), pruneBelow: Number(values["prune-below"]) });
  const matches = new Set(result.matches);
  const tp = result.matches.filter(id => expected.has(id)).length;
  const quality = result.complete && labelled ? {
    truePositives: tp, falsePositives: matches.size - tp, falseNegatives: expected.size - tp,
    precision: matches.size ? tp / matches.size : null, recall: expected.size ? tp / expected.size : null,
  } : null;
  console.log(JSON.stringify({ provider: values.provider, ...result, quality, usage: client?.spent }, null, 2));
} finally { store.close(); }
