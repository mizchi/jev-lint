import type { HttpClient } from "../http/client.ts";

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export class TokenSource {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly refreshToken: string,
  ) {}

  async get(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 5_000) return this.token;
    return this.refresh();
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
