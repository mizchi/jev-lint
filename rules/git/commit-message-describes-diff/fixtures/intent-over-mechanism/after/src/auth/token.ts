import type { HttpClient } from "../http/client.ts";
import { Mutex } from "./mutex.ts";

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export class TokenSource {
  private token: string | null = null;
  private expiresAt = 0;
  private readonly lock = new Mutex();

  constructor(
    private readonly http: HttpClient,
    private readonly refreshToken: string,
  ) {}

  async get(): Promise<string> {
    if (this.fresh()) return this.token as string;
    return this.lock.run(async () => {
      if (this.fresh()) return this.token as string;
      return this.refresh();
    });
  }

  private fresh(): boolean {
    return this.token !== null && Date.now() < this.expiresAt - 5_000;
  }

  private async refresh(): Promise<string> {
    const res = await this.http.post<TokenResponse>("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });
    this.token = res.access_token;
    this.expiresAt = Date.now() + res.expires_in * 1000;
    return this.token;
  }
}
