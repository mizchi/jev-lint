import { Jev, JevError, fromEnv, type JevOptions } from "./jev.ts";
import type { Question, SystemOneResponse } from "./types.ts";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const FREE_DECIDER = "perplexity/pplx-decider-v1.3:free";
export const OPENROUTER_JEV = "typesafe/jev-1.14";
export const OPENROUTER_KEY_SETUP = "Get an API key at https://openrouter.ai/keys, then set OPENROUTER_API_KEY";
/** Public catalog snapshot 2026-11-18; input USD/M tokens, output free. */
export const OPENROUTER_MODELS = {
  [OPENROUTER_JEV]: { inputUsdPerMillion: 0.042, context: 262144, questions: 256, intervalMs: 0 },
  "liquid/d1.2-ultra": { inputUsdPerMillion: 0.042, context: 65536, questions: 128, intervalMs: 0 },
  "liquid/d1.2": { inputUsdPerMillion: 0.02, context: 65536, questions: 128, intervalMs: 0 },
  "baseten/mammoth-1": { inputUsdPerMillion: 0.1, context: 16384, questions: 64, intervalMs: 0 },
  [FREE_DECIDER]: { inputUsdPerMillion: 0, context: 262144, questions: 64, intervalMs: 3200 },
} as const;
export type OpenRouterModel = keyof typeof OPENROUTER_MODELS;
export interface OpenRouterOptions extends Omit<JevOptions, "baseUrl" | "model"> { model?: OpenRouterModel; requestIntervalMs?: number }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export class OpenRouter extends Jev {
  readonly nativeModel: OpenRouterModel;
  private readonly billing: { usd: number };
  private readonly intervalMs: number;
  private nextAt = 0;
  constructor({ model = "liquid/d1.2-ultra", apiKey, fetch: transport = globalThis.fetch, requestIntervalMs, ...options }: OpenRouterOptions = {}) {
    if (!Object.hasOwn(OPENROUTER_MODELS, model)) throw new JevError("unknown OpenRouter decisions model");
    const spec = OPENROUTER_MODELS[model], billing = { usd: 0 };
    const interval = requestIntervalMs ?? spec.intervalMs;
    if (!Number.isFinite(interval) || interval < 0) throw new Error("invalid request interval");
    super({ ...options, model, apiKey: apiKey ?? fromEnv(["OPENROUTER_API_KEY"]) ?? "",
      fetch: async (_url, init) => {
        const response = await transport(OPENROUTER_ENDPOINT, init);
        if (!response.ok) return response;
        let value: unknown;
        try { value = await response.json(); } catch { throw new JevError("OpenRouter returned invalid JSON"); }
        if (!record(value) || typeof value.model !== "string" || !record(value.answers) || !record(value.usage)
          || ![value.usage.input_tokens, value.usage.output_tokens].every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
          || typeof value.usage.cost !== "number" || !Number.isFinite(value.usage.cost) || value.usage.cost < 0) throw new JevError("OpenRouter returned invalid answers or measured usage");
        billing.usd += value.usage.cost;
        return Response.json(value, { headers: response.headers });
      },
    });
    this.nativeModel = model; this.billing = billing; this.intervalMs = interval;
  }
  override get usd(): number { return this.billing?.usd ?? 0; }
  override get endpointIdentity(): string { return OPENROUTER_ENDPOINT; }
  protected override estimateUsd(tokens: number): number { return tokens / 1_000_000 * (OPENROUTER_MODELS[this.nativeModel]?.inputUsdPerMillion ?? 0.1); }
  protected override measuredUsd(_tokens: number, usage: unknown): number {
    if (!record(usage) || typeof usage.cost !== "number") throw new JevError("missing measured provider cost");
    return usage.cost;
  }
  override async ask(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    if (!Object.keys(questions).length) return { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    if (!this.apiKey) throw new JevError(OPENROUTER_KEY_SETUP, { kind: "auth" });
    const spec = OPENROUTER_MODELS[this.nativeModel];
    // Bytes deliberately overestimate tokens; refuse rather than depend on silent upstream truncation.
    if (Object.keys(questions).length > spec.questions || Buffer.byteLength(JSON.stringify({ state, questions }), "utf8") > spec.context - 1024) {
      throw new JevError("max_tokens_exceeded: conservative native decisions context guard", { kind: "too_big" });
    }
    return super.ask(state, questions);
  }
  protected override async beforeRequest(): Promise<void> {
    const now = Date.now(), wait = Math.max(0, this.nextAt - now);
    this.nextAt = Math.max(this.nextAt, now) + this.intervalMs;
    if (wait) await this.waitForRequest(wait);
  }
  override async askSplitting(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    if (!Object.keys(questions).length) return { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    return super.askSplitting(state, questions);
  }
}
