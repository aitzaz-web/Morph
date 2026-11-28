import { describe, expect, it } from "vitest";
import { createLedgerly } from "./app.ts";

function setup() {
  const calls: { url: string; init: RequestInit }[] = [];
  const app = createLedgerly({
    sessionSecret: "test-session-secret",
    morphUrl: "http://morph.test",
    morphPublicUrl: "https://morph.example",
    morphSecretKey: "sk_test",
    secureCookies: false,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ token: "tok", expiresAt: "later" }), { status: 200 });
    }) as typeof fetch,
  });
  return { app, calls };
}

async function login(app: ReturnType<typeof createLedgerly>, userId: string) {
  const r = await app.request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
  expect(r.status).toBe(200);
  return r.headers.get("Set-Cookie")!.split(";")[0];
}

describe("ledgerly", () => {
  it("needs a signed-in user, and a rep only sees their own customers", async () => {
    const { app } = setup();
    expect((await app.request("/api/app")).status).toBe(401);
    const maria = await (await app.request("/api/app", { headers: { Cookie: await login(app, "maria") } })).json();
    const dev = await (await app.request("/api/app", { headers: { Cookie: await login(app, "dev") } })).json();
    expect(dev.customers.length).toBeLessThan(maria.customers.length);
    expect(dev.customers.every((c: { rep: string }) => c.rep === "Dev")).toBe(true);
  });

  it("rejects a forged session cookie", async () => {
    const { app } = setup();
    expect((await app.request("/api/me", { headers: { Cookie: "ledgerly_session=maria" } })).status).toBe(401);
  });

  it("gets a Morph token for the signed-in user with the secret key, server to server", async () => {
    const { app, calls } = setup();
    const r = await app.request("/api/morph-token", { method: "POST", headers: { Cookie: await login(app, "dev") } });
    expect(await r.json()).toEqual({ token: "tok", expiresAt: "later" });
    expect(calls[0].url).toBe("http://morph.test/v1/sessions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.userId).toBe("dev");
    expect(sent.attributes.role).toBe("Field sales rep");
  });
});
