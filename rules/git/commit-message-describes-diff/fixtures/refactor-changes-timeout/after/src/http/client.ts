export interface ClientOpts {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpClient {
  private readonly options: ClientOpts;

  constructor(options: ClientOpts) {
    this.options = { timeoutMs: DEFAULT_TIMEOUT_MS, ...options };
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (json) headers["content-type"] = "application/json";
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: this.headers(method === "POST"),
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
