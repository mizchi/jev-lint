import { setTimeout as delay } from "node:timers/promises";

export interface RequestBudget {
  maxRequests?: number;
  maxInputTokens?: number;
  maxUsd?: number;
  maxMs?: number;
}
export interface SendPermit { request: number; estimatedInputTokens: number; estimatedUsd: number }
export interface RequestControls {
  signal?: AbortSignal;
  budget?: RequestBudget;
  beforeSend?: (permit: Readonly<SendPermit>) => Promise<void>;
}

/** A client-wide budget. Reservations happen before awaiting consent, including retries. */
export class RequestControl {
  readonly signal: AbortSignal;
  private requests = 0;
  private tokens = 0;
  private usd = 0;
  private readonly deadline: number;
  private readonly options: RequestControls;

  constructor(options: RequestControls = {}) {
    this.options = options;
    this.deadline = options.budget?.maxMs === undefined ? Infinity : Date.now() + options.budget.maxMs;
    for (const [key, value] of Object.entries(options.budget ?? {})) {
      if (!Number.isFinite(value) || value < 0 || (key !== "maxUsd" && !Number.isSafeInteger(value))) throw new Error(`invalid request budget: ${key}`);
    }
    const signals = [options.signal, options.budget?.maxMs === undefined ? undefined : AbortSignal.timeout(options.budget.maxMs)].filter((s): s is AbortSignal => !!s);
    this.signal = signals.length ? AbortSignal.any(signals) : new AbortController().signal;
  }

  async authorize(tokens: number, usd: number): Promise<void> {
    this.signal.throwIfAborted();
    if (Date.now() >= this.deadline) throw new Error("request time budget exhausted");
    const budget = this.options.budget;
    if (this.requests + 1 > (budget?.maxRequests ?? Infinity) || this.tokens + tokens > (budget?.maxInputTokens ?? Infinity)
      || this.usd + usd > (budget?.maxUsd ?? Infinity)) throw new Error("request budget exhausted");
    this.requests++;
    this.tokens += tokens;
    this.usd += usd;
    const permit = Object.freeze({ request: this.requests, estimatedInputTokens: tokens, estimatedUsd: usd });
    if (this.options.beforeSend) {
      await new Promise<void>((resolve, reject) => {
        const aborted = () => reject(this.signal.reason);
        this.signal.addEventListener("abort", aborted, { once: true });
        Promise.resolve().then(() => this.options.beforeSend!(permit))
          .then(resolve, reject).finally(() => this.signal.removeEventListener("abort", aborted));
        if (this.signal.aborted) aborted();
      });
    }
    this.signal.throwIfAborted();
    if (Date.now() >= this.deadline) throw new Error("request time budget exhausted");
  }

  async wait(ms: number): Promise<void> {
    await delay(ms, undefined, { signal: this.signal });
  }

  settle(estimatedTokens: number, actualTokens: number, actualUsd: number, estimatedUsd: number): void {
    this.tokens += actualTokens - estimatedTokens;
    this.usd += actualUsd - estimatedUsd;
  }
}
