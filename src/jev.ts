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
import { estimateTokens } from "./batch.ts";
import type { Question, Spend, SystemOneResponse } from "./types.ts";

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

/**
 * Where the key and the endpoint come from, in order.
 *
 * `TYPESAFE_*` first because that is the prevailing spelling; `TYPESAFEAI_*`
 * stays as a fallback so an existing environment keeps working without an edit.
 * Both are read rather than one aliased to the other, so a shell that has only
 * the older name set is not a configuration error.
 */
export const API_KEY_VARS = ["TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"] as const;
export const BASE_URL_VARS = ["TYPESAFE_BASE_URL", "TYPESAFEAI_BASE_URL"] as const;

/** First of these variables that is set and non-empty. */
export function fromEnv(names: readonly string[], env = process.env): string | null {
  for (const n of names) {
    const v = env[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

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
  /** The client's mirror of the server's token bucket; the default is the measured one. */
  pacer?: Pacer | null;
  /** How many times a rate-limited request goes again before it is given up on. */
  rateLimitRetries?: number;
  /** The base wait after a 429, before jitter and growth. */
  rateLimitWaitMs?: number;
  /** The transport, for tests. */
  fetch?: typeof fetch;
}

/**
 * The most requests in flight at once. Latency is 260 ms plus 5.7 ms per
 * thousand tokens, so 78 requests at 4 abreast take 9.6 s and the same 78
 * fired together take 1.6; what stops "all at once" is the token rate below,
 * not the connection count -- 40 small requests at once have never drawn a
 * 429. Measured on the full run over this repository (79 requests, 2.15M
 * tokens) with the pacer: 16 abreast 4.8 s, 32 3.6-3.7 s, 64 3.9 s. Past 32
 * the server's own latency grows with what it is holding and the wall time
 * stops falling.
 */
export const DEFAULT_CONCURRENCY = 32;
const DEFAULT_RATE_LIMIT_RETRIES = 8;
const DEFAULT_RATE_LIMIT_WAIT_MS = 300;

/**
 * The server's rate limit, as measured, and mirrored here so that the client
 * paces itself instead of being told.
 *
 * The server answers a bare 429 -- no retry-after, no ratelimit headers --
 * and what it limits is input tokens, not requests: 40 small requests at
 * once go through, 20 of the largest at once go through, and the same 20
 * again a second later lose 4, then 14, then 16. The fit is a token bucket
 * of about 1.6M tokens refilling at 200-250k per second. A full run over this
 * repository is 2.1M tokens, so it sits at the edge: fired together it loses
 * between 8 and 36 of 78 requests depending on how full the bucket was.
 *
 * The client keeps its own bucket, charged with each request's estimate as it
 * is sent and corrected to the server's count when the answer comes back. A
 * request waits until the bucket can pay for it. Started a little under the
 * measured size, it draws no 429 on a run that starts with a full bucket; a
 * 429 -- the mirror was wrong, or another process shares the key -- empties
 * the mirror and lowers its rate by a quarter, and a success while requests
 * have had to wait raises the rate by two percent, so a key with a higher
 * limit finds it. The rate is bounded on both sides; the burst is not
 * adapted, since a burst too small costs a run of this size two seconds and
 * one too large costs it lost verdicts.
 */
export const DEFAULT_TOKENS_PER_SECOND = 200_000;
export const DEFAULT_TOKEN_BURST = 1_200_000;
const MIN_TOKENS_PER_SECOND = 20_000;
const MAX_TOKENS_PER_SECOND = 2_000_000;

/** A positive number from the environment, or nothing. */
function envNumber(name: string): number | null {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class Pacer {
  rate: number;
  readonly burst: number;
  private level: number;
  private at: number;
  /** Whether a request has had to wait: only then is the rate probed upward. */
  private waited = false;
  /** When the rate last grew. */
  private grew = 0;

  constructor(
    rate = envNumber("JEV_LINT_TOKENS_PER_SECOND") ?? DEFAULT_TOKENS_PER_SECOND,
    burst = envNumber("JEV_LINT_TOKEN_BURST") ?? DEFAULT_TOKEN_BURST,
    now = Date.now(),
  ) {
    this.rate = rate;
    this.burst = burst;
    this.level = burst;
    this.at = now;
  }

  private refill(now: number): void {
    // A clock that goes backwards -- an NTP step, a laptop waking from suspend
    // -- must not DRAIN the mirror. Unclamped, a one-second backwards jump
    // takes a second's worth of refill out of the bucket (200,000 tokens at
    // the shipped rate), and the client then waits for a limit the server is
    // not imposing: no 429 is recorded, `rateLimited` stays zero, and the run
    // is slower for no reason a reader can see. Treat it as no time passed.
    //
    // `at` still moves unconditionally. Refusing to move it backwards would
    // leave it in the future after a permanent step, and the bucket would then
    // refuse to refill until the clock caught up -- a longer stall than this.
    const elapsed = Math.max(0, now - this.at);
    this.level = Math.min(this.burst, this.level + (elapsed / 1000) * this.rate);
    this.at = now;
  }

  /** How many tokens the bucket holds now. */
  available(now = Date.now()): number {
    this.refill(now);
    return this.level;
  }

  /** Milliseconds until `tokens` can be paid for; 0 if now. */
  delay(tokens: number, now = Date.now()): number {
    this.refill(now);
    const need = Math.min(tokens, this.burst) - this.level;
    return need <= 0 ? 0 : Math.ceil((need / this.rate) * 1000);
  }

  /** Charge the bucket, waiting until it can pay. */
  async take(tokens: number): Promise<void> {
    for (;;) {
      const wait = this.delay(tokens);
      if (wait === 0) {
        this.level -= tokens;
        return;
      }
      this.waited = true;
      await new Promise<void>((r) => setTimeout(r, wait));
    }
  }

  /** The server counted differently from the estimate: charge the difference. */
  settle(estimated: number, actual: number): void {
    this.level -= actual - estimated;
  }

  /** A 429: the mirror was optimistic. Empty it and slow down. */
  throttled(now = Date.now()): void {
    this.refill(now);
    this.level = 0;
    this.rate = Math.max(MIN_TOKENS_PER_SECOND, this.rate * 0.75);
  }

  /**
   * A 200 while requests have been waiting: the limit may be higher than
   * mirrored. Probed by time, not by request -- two percent per success
   * compounded over 79 requests to a rate half again the server's and drew
   * the 429s it was meant to avoid.
   */
  succeeded(now = Date.now()): void {
    if (!this.waited || now - this.grew < 500) return;
    this.grew = now;
    this.rate = Math.min(MAX_TOKENS_PER_SECOND, this.rate * 1.02);
  }
}

/**
 * What the runner needs from a client: the one call it makes, and the three
 * things it reads back for the report and the cache. `Jev` is the real one;
 * a test hands in an object with these four members and no network.
 */
export interface AskClient {
  model: string;
  servedModel: string | null;
  readonly spent: Spend;
  askSplitting(state: unknown, questions: Record<string, Question>): Promise<SystemOneResponse>;
}

export class Jev implements AskClient {
  apiKey: string;
  baseUrl: string;
  model: string;
  retries: number;
  timeoutMs: number;
  onRequest: ((body: string) => void) | null;
  pacer: Pacer;
  rateLimitRetries: number;
  rateLimitWaitMs: number;
  private transport: typeof fetch;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalMs: number;
  retried: number;
  rateLimited: number;
  splits: number;
  servedModel: string | null;

  constructor({
    apiKey,
    baseUrl,
    model,
    retries = 4,
    timeoutMs = 60_000,
    onRequest = null,
    pacer = null,
    rateLimitRetries = DEFAULT_RATE_LIMIT_RETRIES,
    rateLimitWaitMs = DEFAULT_RATE_LIMIT_WAIT_MS,
    fetch: transport = globalThis.fetch,
  }: JevOptions = {}) {
    this.apiKey = apiKey ?? fromEnv(API_KEY_VARS) ?? "";
    this.baseUrl = (baseUrl ?? fromEnv(BASE_URL_VARS) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = model ?? process.env.JEV_LINT_MODEL ?? DEFAULT_MODEL;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
    /** Called with each request body before it is sent, for leak assertions. */
    this.onRequest = onRequest;
    this.pacer = pacer ?? new Pacer();
    this.rateLimitRetries = rateLimitRetries;
    this.rateLimitWaitMs = rateLimitWaitMs;
    this.transport = transport;

    this.calls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.totalMs = 0;
    this.retried = 0;
    this.rateLimited = 0;
    this.splits = 0;
    this.servedModel = null;
  }

  /** The paced token rate as it stands, per second. */
  get tokensPerSecond(): number {
    return this.pacer.rate;
  }

  /**
   * What a failed status means for the caller.
   *
   * `too_big` is the one 400 a caller can fix by sending less; naming it is
   * what lets askSplitting recover instead of dropping the batch. `auth` is
   * anything the account has to fix -- a bad key (401, 403) or no credit
   * (402) -- and it is the same answer for every batch and every pass, so the
   * runner stops on the first one rather than collecting it 69 times.
   *
   * A 403 that is an HTML page is the exception: that is a proxy or web
   * application firewall in front of the API refusing this one request by
   * its content, and every other batch may still be answered. Taking it as
   * `auth` once stopped a run after one batch and left most of it unasked.
   */
  static classify(status: number, body: string): JevErrorKind {
    if (status === 400 && body.includes("max_tokens_exceeded")) return "too_big";
    if (status === 403 && isHtml(body)) return "other";
    if (status === 401 || status === 402 || status === 403) return "auth";
    return "other";
  }

  get spent(): Spend {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      ms: this.totalMs,
      retried: this.retried,
      rateLimited: this.rateLimited,
      tokensPerSecond: Math.round(this.pacer.rate),
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
      throw new JevError(`no API key; set ${API_KEY_VARS[0]}`, { kind: "auth" });
    }
    const names = Object.keys(questions);
    if (names.length === 0) return { answers: {}, usage: { input_tokens: 0 } };

    const body = JSON.stringify({ model: this.model, state, questions });
    if (this.onRequest) this.onRequest(body);

    let last = new JevError("no attempt made");
    const estimated = estimateTokens({ model: this.model, state, questions });

    // Two budgets: `retries` for failures of the request (network, 5xx),
    // `rateLimitRetries` for the server saying "not now". A 429 is answered
    // in 20 ms upstream and means nothing about the request, so it is
    // counted, waited out at a lower rate, and sent again.
    let attempt = 0;
    let limited = 0;
    for (;;) {
      await this.pacer.take(estimated);
      const started = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.transport(`${this.baseUrl}/v1/systemone`, {
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
        attempt += 1;
        this.retried += 1;
        await backoff(attempt - 1);
        continue;
      }
      clearTimeout(timer);

      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text);
        this.pacer.settle(estimated, parsed.usage?.input_tokens ?? estimated);
        this.pacer.succeeded();
        this.calls += 1;
        this.totalMs += Date.now() - started;
        this.inputTokens += parsed.usage?.input_tokens ?? 0;
        this.outputTokens += parsed.usage?.output_tokens ?? 0;
        if (parsed.model) this.servedModel = parsed.model;
        return parsed;
      }

      const proxied = res.status === 403 && isHtml(text) ? " (an HTML page, not from the API: a proxy or firewall refused this request by its content)" : "";
      last = new JevError(`HTTP ${res.status}${proxied}: ${text.slice(0, 240)}`, {
        status: res.status,
        kind: Jev.classify(res.status, text),
      });
      if (res.status === 429) {
        this.pacer.throttled();
        this.rateLimited += 1;
        if (limited === this.rateLimitRetries) break;
        limited += 1;
        await rateLimitWait(limited, this.rateLimitWaitMs, res.headers.get("retry-after"));
        continue;
      }
      const transient = res.status >= 500;
      if (!transient || attempt === this.retries) break;
      last.kind = "transient";
      attempt += 1;
      this.retried += 1;
      await backoff(attempt - 1, res.headers.get("retry-after"));
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

/**
 * The wait after a 429. The server sends no retry-after (honoured if it ever
 * does), and the pacer has already emptied its mirror, so this is short: the base,
 * growing by half per repeat, jittered so a burst of refused requests does
 * not come back as a burst, capped at 5 s.
 */
function rateLimitWait(nth: number, baseMs: number, retryAfter?: string | null): Promise<void> {
  const hinted = retryAfter ? Number.parseFloat(retryAfter) * 1000 : Number.NaN;
  const wait = Number.isFinite(hinted)
    ? hinted
    : Math.min(5_000, baseMs * 1.5 ** (nth - 1)) * (0.5 + Math.random());
  return new Promise<void>((r) => setTimeout(r, wait));
}

/** The API answers in JSON; a body that opens with markup came from something in front of it. */
function isHtml(body: string): boolean {
  return /^\s*</.test(body);
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
