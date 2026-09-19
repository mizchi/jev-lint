/**
 * Zero-dependency Jev client.
 *
 * Jev (TypeSafe's System One model) takes one `state` plus many independent
 * `questions` and answers them all in parallel in a single round trip. That
 * shape is the whole reason this linter can afford to ask about every match in
 * a repository: the state -- the file -- is sent once, and each extra question
 * costs only its own text.
 *
 * Two server ceilings matter, and neither is a question count:
 *
 *   - the whole request must be under 64Ki input tokens
 *   - the `state` alone must be under 32Ki input tokens (an independent budget,
 *     and the one that fills up first)
 *
 * There is no documented cap on the NUMBER of questions; over a thousand in one
 * request is fine. `askSplitting` therefore does not try to predict the ceiling
 * precisely -- it reacts to the server's own `max_tokens_exceeded` by halving
 * the question set, which keeps the estimator in `batch.ts` free to be
 * approximate.
 */
import type { Question, Spend, SystemOneResponse } from "./types.ts";

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

/** Published input price, USD per million input tokens. Output is not billed. */
export const USD_PER_MTOK = 0.042;

/** What the caller can actually do about a failure. */
export type JevErrorKind = "too_big" | "auth" | "transient" | "other";

export class JevError extends Error {
  status: number;
  kind: JevErrorKind;

  constructor(message: string, { status = 0, kind = "other" }: { status?: number; kind?: JevErrorKind } = {}) {
    super(message);
    this.name = "JevError";
    this.status = status;
    // "too_big"   -> send fewer questions (the only recoverable 400)
    // "auth"      -> fix the key; retrying will not help
    // "transient" -> retry
    // "other"     -> give up on this batch
    this.kind = kind;
  }
}

export interface JevOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  retries?: number;
  timeoutMs?: number;
  /** Called with each request body before it is sent, for leak assertions. */
  onRequest?: ((body: string) => void) | null;
}

export class Jev {
  apiKey: string;
  baseUrl: string;
  model: string;
  retries: number;
  timeoutMs: number;
  onRequest: ((body: string) => void) | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalMs: number;
  retried: number;
  splits: number;
  servedModel: string | null;

  constructor({
    apiKey,
    baseUrl,
    model,
    retries = 4,
    timeoutMs = 60_000,
    onRequest = null,
  }: JevOptions = {}) {
    this.apiKey = apiKey ?? process.env.TYPESAFEAI_API_KEY ?? "";
    this.baseUrl = baseUrl ?? process.env.TYPESAFEAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = model ?? process.env.JEVLINT_MODEL ?? DEFAULT_MODEL;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
    /** Called with each request body before it is sent, for leak assertions. */
    this.onRequest = onRequest;

    this.calls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.totalMs = 0;
    this.retried = 0;
    this.splits = 0;
    this.servedModel = null;
  }

  get spent(): Spend {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      ms: this.totalMs,
      retried: this.retried,
      splits: this.splits,
      usd: this.usd,
    };
  }

  get usd(): number {
    return (this.inputTokens / 1_000_000) * USD_PER_MTOK;
  }

  /** One request: one state, N questions, N answers. */
  async ask(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    if (!this.apiKey) {
      throw new JevError("no API key; set TYPESAFEAI_API_KEY", { kind: "auth" });
    }
    const names = Object.keys(questions);
    if (names.length === 0) return { answers: {}, usage: { input_tokens: 0 } };

    const body = JSON.stringify({ model: this.model, state, questions });
    if (this.onRequest) this.onRequest(body);

    const started = Date.now();
    let last = new JevError("no attempt made");

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res;
      try {
        res = await fetch(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: ac.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        last = new JevError(`network: ${String(err).slice(0, 200)}`, { kind: "transient" });
        if (attempt === this.retries) break;
        this.retried += 1;
        await backoff(attempt);
        continue;
      }
      clearTimeout(timer);

      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text);
        this.calls += 1;
        this.totalMs += Date.now() - started;
        this.inputTokens += parsed.usage?.input_tokens ?? 0;
        this.outputTokens += parsed.usage?.output_tokens ?? 0;
        if (parsed.model) this.servedModel = parsed.model;
        return parsed;
      }

      // The one 400 a caller can fix by sending less. Naming it is what lets
      // askSplitting recover instead of dropping the whole batch.
      const tooBig = res.status === 400 && text.includes("max_tokens_exceeded");
      last = new JevError(`HTTP ${res.status}: ${text.slice(0, 240)}`, {
        status: res.status,
        kind: tooBig
          ? "too_big"
          : res.status === 401 || res.status === 403
            ? "auth"
            : "other",
      });
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt === this.retries) break;
      last.kind = "transient";
      this.retried += 1;
      await backoff(attempt, res.headers.get("retry-after"));
    }
    throw last;
  }

  /**
   * Ask about one state, halving the question set if the server says the
   * request is too big. The state is unchanged by a split, so a file whose
   * SOURCE alone exceeds the 32Ki state budget cannot be rescued here -- the
   * batch planner has to have shrunk the state itself.
   */
  async askSplitting(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse> {
    const names = Object.keys(questions);
    try {
      return await this.ask(state, questions);
    } catch (err: unknown) {
      if (!(err instanceof JevError) || err.kind !== "too_big" || names.length < 2) throw err;
      this.splits += 1;
      const half = Math.ceil(names.length / 2);
      const merged: SystemOneResponse = {
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 },
      };
      for (const part of [names.slice(0, half), names.slice(half)]) {
        const subset = Object.fromEntries(part.map((n) => [n, questions[n]]));
        const res = await this.askSplitting(state, subset);
        Object.assign(merged.answers!, res.answers);
        merged.usage!.input_tokens! += res.usage?.input_tokens ?? 0;
        merged.usage!.output_tokens! += res.usage?.output_tokens ?? 0;
      }
      return merged;
    }
  }
}

function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const hinted = retryAfter ? Number.parseFloat(retryAfter) * 1000 : Number.NaN;
  const wait = Number.isFinite(hinted)
    ? hinted
    : Math.min(20_000, 500 * 2 ** attempt) * (0.5 + Math.random());
  return new Promise<void>((r) => setTimeout(r, wait));
}

/** Bounded-concurrency map that preserves input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
