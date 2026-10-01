/** Workers AI transport for the existing System One runner. */
import { Jev, JevError, Pacer, fromEnv } from "./jev.ts";
import type { JevOptions } from "./jev.ts";
import type { Question, SystemOneResponse } from "./types.ts";

export const CLEF_MODELS = ["clef", "clef-flash"] as const;
export type ClefModel = (typeof CLEF_MODELS)[number];
export const CLEF_MAX_QUESTIONS = 64;
/** Workers AI model pages, checked 2026-10-02; USD per million input tokens. */
export const CLEF_USD_PER_MTOK: Record<ClefModel, number> = { clef: 0.24, "clef-flash": 0.09 };

export interface ClefOptions extends Omit<JevOptions, "baseUrl" | "model"> {
  accountId?: string | null;
  model?: ClefModel;
}

export class Clef extends Jev {
  readonly accountId: string;
  readonly clefModel: ClefModel;

  constructor({ accountId, apiKey, model = "clef", fetch: transport = globalThis.fetch, pacer, ...options }: ClefOptions = {}) {
    const account = accountId ?? fromEnv(["CLOUDFLARE_ACCOUNT_ID"]) ?? "";
    super({ ...options, model,
      apiKey: apiKey ?? fromEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"]) ?? "",
      // A conservative starting budget for experiments, not Jev's measured
      // bucket. Callers can supply a pacer; 429s still adapt its rate.
      pacer: pacer ?? new Pacer(50_000, 65_536),
      fetch: async (_url, init) => {
        const response = await transport(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/@cf/cloudflare/${model}`, init,
        );
        if (!response.ok) return response;
        let payload: unknown;
        try { payload = await response.json(); }
        catch { throw new JevError("Clef returned invalid JSON"); }
        if (!isObject(payload)) throw new JevError("Clef returned an invalid response");
        if (payload.success === false) throw new JevError("Workers AI returned success: false");
        const result = "result" in payload ? payload.result : payload;
        if (!isObject(result) || typeof result.model !== "string" || !isObject(result.answers) || !isObject(result.usage) ||
          !tokenCount(result.usage.input_tokens) || !tokenCount(result.usage.output_tokens)) {
          throw new JevError("Clef returned invalid answers or token usage");
        }
        return Response.json(result, { headers: response.headers });
      },
    });
    this.accountId = account;
    this.clefModel = model;
  }

  override get usd(): number {
    return this.inputTokens / 1_000_000 * CLEF_USD_PER_MTOK[this.clefModel];
  }

  override async ask(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    if (Object.keys(questions).length === 0) return { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    if (!this.accountId || !this.apiKey) {
      throw new JevError("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN)", { kind: "auth" });
    }
    if (!CLEF_MODELS.includes(this.clefModel)) throw new JevError("unknown Clef model");
    if (Object.keys(questions).length > CLEF_MAX_QUESTIONS) {
      throw new JevError("max_tokens_exceeded: Clef accepts at most 64 questions; use askSplitting", { kind: "too_big" });
    }
    return super.ask(state, questions);
  }

  override async askSplitting(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    const names = Object.keys(questions);
    if (names.length <= CLEF_MAX_QUESTIONS) return super.askSplitting(state, questions);
    const result: SystemOneResponse = { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    this.splits += Math.ceil(names.length / CLEF_MAX_QUESTIONS) - 1;
    for (let i = 0; i < names.length; i += CLEF_MAX_QUESTIONS) {
      const part = Object.fromEntries(names.slice(i, i + CLEF_MAX_QUESTIONS).map(n => [n, questions[n]]));
      const response = await super.askSplitting(state, part);
      Object.assign(result.answers!, response.answers);
      result.usage!.input_tokens! += response.usage?.input_tokens ?? 0;
      result.usage!.output_tokens! += response.usage?.output_tokens ?? 0;
      result.model = response.model ?? result.model;
    }
    return result;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
