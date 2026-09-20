export interface ClientOpts {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}

export class HttpClient {
  private readonly opts: ClientOpts;

  constructor(opts: ClientOpts) {
    this.opts = { timeoutMs: 30_000, ...opts };
  }

  async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
    return (await res.json()) as T;
  }
}
