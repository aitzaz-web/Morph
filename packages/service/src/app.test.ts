import type { Manifest, MorphResponse, PageResponse } from "@morph/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MorphRequest } from "./ai/types.ts";
import { createApp } from "./app.ts";
import { signSession } from "./auth.ts";
import { memoryDatabase } from "./db/connect.ts";
import { migrate, type Database } from "./db/db.ts";
import { TEST_MANIFEST } from "./test-manifest.ts";

const JWT = "test-secret-test-secret-test-secret-0123";
const ADMIN = "admin-key";
const ORIGIN = "https://app.testco.example";

const GOOD = `import { Nav, CreateInvoice, Invoices } from "@company";
export default function Page() {
  return <div className="mine"><Nav /><CreateInvoice /><Invoices /></div>;
}`;

let db: Database;
let app: ReturnType<typeof createApp>;
let lastAiRequest: MorphRequest | null = null;

beforeAll(async () => {
  db = await memoryDatabase();
  await migrate(db);
  await migrate(db); // safe to run twice
  app = createApp({
    db,
    jwtSecret: JWT,
    adminKey: ADMIN,
    limits: { perUser: 3 },
    strategies: {
      fake: {
        available: () => true,
        run: async (req) => {
          lastAiRequest = req;
          return { candidate: { source: GOOD, css: "", compiled: "x", scopedCss: "" }, summary: "Done.", rejected: [] };
        },
      },
    },
  });
});
afterAll(() => db.close());

const send = (path: string, init: { method?: string; auth?: string; origin?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.auth ? { Authorization: `Bearer ${init.auth}` } : {}),
      ...(init.origin ? { Origin: init.origin } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

async function newTenant(name = "Testco", origins = [ORIGIN]) {
  const r = await send("/v1/admin/tenants", { method: "POST", auth: ADMIN, body: { name, allowedOrigins: origins } });
  expect(r.status).toBe(201);
  return (await r.json()) as { tenantId: string; secretKey: string };
}

async function session(secretKey: string, userId: string, attributes?: Record<string, string>) {
  const r = await send("/v1/sessions", { method: "POST", auth: secretKey, body: { userId, attributes } });
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
}

const push = (secretKey: string, manifest: Manifest = TEST_MANIFEST, surface = "dashboard") =>
  send(`/v1/surfaces/${surface}`, { method: "PUT", auth: secretKey, body: { manifest } });

const getPage = async (token: string, surface = "dashboard") =>
  (await (await send(`/v1/surfaces/${surface}/page`, { auth: token, origin: ORIGIN })).json()) as PageResponse;

const savePage = (token: string, source: string, css = "") =>
  send("/v1/surfaces/dashboard/page", { method: "PUT", auth: token, origin: ORIGIN, body: { source, css, summary: "Mine" } });

let co: { tenantId: string; secretKey: string };
beforeEach(async () => {
  co = await newTenant();
  expect((await push(co.secretKey)).status).toBe(200);
});

describe("admin", () => {
  it("needs the admin key", async () => {
    expect((await send("/v1/admin/tenants", { method: "POST", body: { name: "x" } })).status).toBe(401);
    expect((await send("/v1/admin/tenants", { method: "POST", auth: "wrong", body: { name: "x" } })).status).toBe(401);
  });

  it("rejects bad origins", async () => {
    const r = await send("/v1/admin/tenants", { method: "POST", auth: ADMIN, body: { name: "x", allowedOrigins: ["not a url"] } });
    expect(r.status).toBe(400);
  });

  it("rotating the secret key stops the old one working", async () => {
    const r = await send(`/v1/admin/tenants/${co.tenantId}`, { method: "PATCH", auth: ADMIN, body: { rotateSecretKey: true } });
    const { secretKey } = (await r.json()) as { secretKey: string };
    expect((await send("/v1/sessions", { method: "POST", auth: co.secretKey, body: { userId: "u" } })).status).toBe(401);
    expect((await send("/v1/sessions", { method: "POST", auth: secretKey, body: { userId: "u" } })).status).toBe(200);
  });
});

describe("company servers", () => {
  it("refuses secret keys sent from a browser", async () => {
    const r = await send("/v1/sessions", { method: "POST", auth: co.secretKey, origin: ORIGIN, body: { userId: "maria" } });
    expect(r.status).toBe(403);
  });

  it("refuses unknown secret keys and session tokens in place of one", async () => {
    expect((await send("/v1/sessions", { method: "POST", auth: "sk_nope", body: { userId: "maria" } })).status).toBe(401);
    const token = await session(co.secretKey, "maria");
    expect((await push(token)).status).toBe(401);
  });

  it("rejects an invalid manifest, or one whose default page breaks the rules", async () => {
    const r1 = await push(co.secretKey, { ...TEST_MANIFEST, components: [] });
    expect(r1.status).toBe(400);
    const r2 = await push(co.secretKey, { ...TEST_MANIFEST, defaultPage: { source: GOOD.replace("<CreateInvoice />", ""), css: "" } });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { problems: string[] }).problems.join(" ")).toMatch(/CreateInvoice/);
  });

  it("bumps the surface version on each push", async () => {
    const r = await push(co.secretKey);
    expect(((await r.json()) as { version: number }).version).toBe(2);
  });
});

describe("browsers", () => {
  it("needs a valid, unexpired token", async () => {
    expect((await send("/v1/surfaces/dashboard/page", { origin: ORIGIN })).status).toBe(401);
    expect((await send("/v1/surfaces/dashboard/page", { auth: "garbage", origin: ORIGIN })).status).toBe(401);
    const forged = (await signSession("some-other-secret-some-other-secret-0", { tenantId: co.tenantId, user: { id: "maria", attributes: {} } })).token;
    expect((await send("/v1/surfaces/dashboard/page", { auth: forged, origin: ORIGIN })).status).toBe(401);
    const expired = (await signSession(JWT, { tenantId: co.tenantId, user: { id: "maria", attributes: {} } }, 60)).token;
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    try {
      // hono/jwt checks exp against the clock
      expect((await send("/v1/surfaces/dashboard/page", { auth: expired, origin: ORIGIN })).status).toBe(401);
    } finally {
      Date.now = realNow;
    }
  });

  it("only allows the company's origins, and answers CORS for them", async () => {
    const token = await session(co.secretKey, "maria");
    expect((await send("/v1/surfaces/dashboard/page", { auth: token, origin: "https://evil.example" })).status).toBe(403);
    const ok = await send("/v1/surfaces/dashboard/page", { auth: token, origin: ORIGIN });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const pre = await app.request("/v1/surfaces/dashboard/page", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });

  it("starts on the company's default page, compiled, with the browser config", async () => {
    const p = await getPage(await session(co.secretKey, "maria"));
    expect(p.source).toBe(TEST_MANIFEST.defaultPage.source);
    expect(p.version).toBeNull();
    expect(p.versions).toBe(0);
    expect(p.compiled).toContain('require("@company")');
    expect(p.config.components.map((c) => c.importName)).toContain("Invoices");
    expect(p.config.actions.invoices).toEqual(["send_reminder"]);
  });

  it("404s for a surface that isn't registered", async () => {
    const r = await send("/v1/surfaces/settings/page", { auth: await session(co.secretKey, "maria"), origin: ORIGIN });
    expect(r.status).toBe(404);
  });

  it("saves a page that passes the checks, and refuses one that breaks the rules", async () => {
    const token = await session(co.secretKey, "maria");
    expect((await savePage(token, GOOD, ".mine { color: red }")).status).toBe(200);
    const p = await getPage(token);
    expect(p.source).toBe(GOOD);
    expect(p.versions).toBe(1);
    expect(p.scopedCss).toContain("@scope (.morph-page)");
    const bad = await savePage(token, GOOD.replace("<CreateInvoice />", ""));
    expect(bad.status).toBe(400);
    expect((await getPage(token)).versions).toBe(1);
  });

  it("undo goes back one version, reset goes back to the default", async () => {
    const token = await session(co.secretKey, "maria");
    const second = GOOD.replace("mine", "second");
    await savePage(token, GOOD);
    await savePage(token, second);
    expect((await getPage(token)).source).toBe(second);
    await send("/v1/surfaces/dashboard/page/undo", { method: "POST", auth: token, origin: ORIGIN });
    expect((await getPage(token)).source).toBe(GOOD);
    await send("/v1/surfaces/dashboard/page", { method: "DELETE", auth: token, origin: ORIGIN });
    const p = await getPage(token);
    expect(p.source).toBe(TEST_MANIFEST.defaultPage.source);
    expect(p.versions).toBe(0);
  });

  it("falls back to the default when a saved page no longer passes the company's new rules", async () => {
    const token = await session(co.secretKey, "maria");
    await savePage(token, GOOD);
    // The company now requires News on every page; the saved page doesn't have it.
    await push(co.secretKey, { ...TEST_MANIFEST, rules: [...TEST_MANIFEST.rules, { component: "news", mustShow: true }] });
    const p = await getPage(token);
    expect(p.version).toBeNull();
    expect(p.stale.join(" ")).toMatch(/News/);
  });
});

describe("isolation", () => {
  it("keeps each user's page separate within a company", async () => {
    const maria = await session(co.secretKey, "maria");
    const dev = await session(co.secretKey, "dev");
    await savePage(maria, GOOD);
    expect((await getPage(maria)).source).toBe(GOOD);
    expect((await getPage(dev)).source).toBe(TEST_MANIFEST.defaultPage.source);
  });

  it("a user with the same id at another company can't see or change this company's pages", async () => {
    const other = await newTenant("Otherco", [ORIGIN]);
    await push(other.secretKey);
    const mariaHere = await session(co.secretKey, "maria");
    const mariaThere = await session(other.secretKey, "maria");
    await savePage(mariaHere, GOOD);
    expect((await getPage(mariaThere)).versions).toBe(0);
    await send("/v1/surfaces/dashboard/page", { method: "DELETE", auth: mariaThere, origin: ORIGIN });
    expect((await getPage(mariaHere)).versions).toBe(1);
  });
});

describe("AI requests", () => {
  const ask = (token: string, body: unknown) => send("/v1/surfaces/dashboard/morph", { method: "POST", auth: token, origin: ORIGIN, body });

  it("passes the manifest, the user and the current page to the AI", async () => {
    const token = await session(co.secretKey, "maria", { name: "Maria Rossi", role: "Office manager" });
    const r = await ask(token, { message: "put invoices first" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as MorphResponse).candidate?.source).toBe(GOOD);
    expect(lastAiRequest?.user).toEqual({ id: "maria", attributes: { name: "Maria Rossi", role: "Office manager" } });
    expect(lastAiRequest?.manifest.app.name).toBe("Testco");
    expect(lastAiRequest?.page.source).toBe(TEST_MANIFEST.defaultPage.source);
  });

  it("rejects empty messages and rate-limits each user", async () => {
    const token = await session(co.secretKey, "spammer");
    expect((await ask(token, { message: " " })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await ask(token, { message: "hi" })).status).toBe(200);
    expect((await ask(token, { message: "hi" })).status).toBe(429);
    // Other users aren't affected.
    expect((await ask(await session(co.secretKey, "someone"), { message: "hi" })).status).toBe(200);
  });
});
