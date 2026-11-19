import { createHash } from "node:crypto";
import { contract, type Group } from "./repeated-task.ts";

export const model = "gpt-5.5-2026-04-23";
const instructions = "Choose at most limit distinct suite IDs whose union covers every required tag. Any valid selection is correct. Return selected=null if you cannot find one.";
const format = { type: "json_schema", name: "suite_selection", strict: true, schema: {
  type: "object", properties: { selected: { type: ["array", "null"], items: { type: "string" } } },
  required: ["selected"], additionalProperties: false,
} };
export interface Receipt { selected: string[] | null; inputTokens: number; outputTokens: number; ms: number }
export function receiptKey(group: Group) {
  return createHash("sha256").update(JSON.stringify([contract, model, instructions, format, group])).digest("hex");
}
export async function askTeacher(group: Group): Promise<Receipt> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Error("OPENAI_API_KEY is required for live teacher calls");
  const start = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ model, instructions, input: JSON.stringify(group), store: false, text: { format } }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw Error("Teacher HTTP " + response.status);
  const data = await response.json() as {
    status?: string; output?: { content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.output?.flatMap(item => item.content ?? [])
    .find(part => part.type === "output_text")?.text;
  if (data.status !== "completed" || typeof text !== "string") throw Error("Incomplete teacher response");
  const { selected } = JSON.parse(text);
  const receipt = { selected, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens,
    ms: Math.round(performance.now() - start) };
  if (!validReceipt(receipt)) throw Error("Invalid teacher response or usage");
  return receipt;
}
export function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Receipt;
  return (r.selected === null || (Array.isArray(r.selected) && r.selected.every(s => typeof s === "string"))) &&
    [r.inputTokens, r.outputTokens, r.ms].every(n => Number.isSafeInteger(n) && n >= 0);
}
