interface Counter {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly counts = new Map<string, Counter>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.counts.get(key);
    const reset = !current || now - current.windowStart >= this.windowMs;
    const next = reset ? { count: 1, windowStart: now } : { count: current.count + 1, windowStart: current.windowStart };
    this.counts.set(key, next);
    return next.count <= this.max;
  }

  get tracked(): number {
    return this.counts.size;
  }
}

const limiter = new RateLimiter(100, 60_000);

export const handler = async (req: Request): Promise<Response> => {
  const key = req.headers.get("x-forwarded-for") ?? "anonymous";
  if (!limiter.consume(key)) {
    return new Response("too many requests", { status: 429 });
  }
  const body = await req.text();
  return new Response(body.toUpperCase(), { status: 200 });
};

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const server = Bun.serve({ port, fetch: handler });
  console.log(`listening on ${server.port}`);
  process.on("SIGTERM", () => server.stop());
}
