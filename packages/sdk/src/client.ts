// Talks to Morph's service from the browser with a session token. The token comes from the
// company's own server (getToken); it's cached until shortly before it expires and fetched again
// once if the service says it's no longer valid.

export class MorphError extends Error {
  status: number;
  problems: string[];
  constructor(message: string, status: number, problems: string[] = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

export interface ClientOptions {
  /** e.g. https://api.morph.example */
  serviceUrl: string;
  /** Asks your server for a Morph session token for the signed-in user. */
  getToken: () => Promise<string>;
}

const expiryOf = (token: string): number => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
};

export class MorphClient {
  private token: { value: string; expires: number } | null = null;
  private pending: Promise<string> | null = null;
  private readonly base: string;
  private readonly getToken: () => Promise<string>;

  constructor(opts: ClientOptions) {
    this.base = opts.serviceUrl.replace(/\/$/, "");
    this.getToken = opts.getToken;
  }

  private async currentToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expires - Date.now() > 60_000) return this.token.value;
    this.pending ??= this.getToken()
      .then((value) => {
        this.token = { value, expires: expiryOf(value) || Date.now() + 5 * 60_000 };
        return value;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const send = async (token: string) =>
      fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let res = await send(await this.currentToken());
    if (res.status === 401) res = await send(await this.currentToken(true));
    const json = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
    if (!res.ok) throw new MorphError(json.error ?? `Morph request failed (${res.status})`, res.status, json.problems);
    return json as T;
  }
}
