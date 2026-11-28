// Morph's public API.
//
// Three kinds of caller, three credentials:
// - Morph operators (admin key): create companies (tenants).
// - A company's servers (its secret key): open sessions for its users, register surfaces.
//   Requests from a browser (with an Origin header) are refused, so a leaked key can't be used from a page.
// - A company's users' browsers (session token): read, change, undo and reset their own page.
//   Only from the origins the company allowed.

import {
  surfaceConfig,
  validateManifest,
  type Manifest,
  type MorphRequestBody,
  type PageResponse,
  type SessionRequest,
} from "@morph/shared";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Strategy } from "./ai/types.ts";
import {
  cleanAttributes,
  hashKey,
  newSecretKey,
  newTenantId,
  sameSecret,
  signSession,
  validUserId,
  verifySession,
  DEFAULT_TTL,
  type Session,
} from "./auth.ts";
import { checkPage } from "./checker/check.ts";
import * as store from "./db/db.ts";
import { RateLimiter } from "./ratelimit.ts";

export interface StrategyEntry {
  run: Strategy;
  available: () => boolean;
}

export interface AppOptions {
  db: store.Database;
  /** Signs session tokens. Long and random; rotate by deploying a new one (old tokens stop working). */
  jwtSecret: string;
  /** For /v1/admin. Leave empty to turn the admin API off. */
  adminKey?: string;
  strategies: Record<string, StrategyEntry>;
  /** Strategy used when the request doesn't name one. */
  defaultStrategy?: () => string | undefined;
  /** AI requests per end user per minute (default 12) and per company per minute (default 300). */
  limits?: { perUser?: number; perTenant?: number };
  log?: (line: string) => void;
}

type Env = { Variables: { session: Session; tenant: store.Tenant } };

const SURFACE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const json = (c: Context, status: number, error: string, extra: Record<string, unknown> = {}) =>
  c.json({ error, ...extra }, status as 400);
const bearer = (c: Context) => c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const log = opts.log ?? (() => {});
  const perUser = new RateLimiter(opts.limits?.perUser ?? 12, 60_000);
  const perTenant = new RateLimiter(opts.limits?.perTenant ?? 300, 60_000);
  const pickStrategy = opts.defaultStrategy ?? (() => Object.keys(opts.strategies).find((k) => opts.strategies[k].available()));
  const aiAvailable = () => !!pickStrategy();

  // Tenants change rarely; cache them briefly so each browser request doesn't hit the database twice.
  const tenantCache = new Map<string, { tenant: store.Tenant; at: number }>();
  async function cachedTenant(id: string): Promise<store.Tenant | null> {
    const hit = tenantCache.get(id);
    if (hit && Date.now() - hit.at < 30_000) return hit.tenant;
    const t = await store.tenantById(db, id);
    if (t) tenantCache.set(id, { tenant: t, at: Date.now() });
    else tenantCache.delete(id);
    return t;
  }

  const app = new Hono<Env>();

  app.onError((e, c) => {
    log(`[morph] error on ${c.req.method} ${c.req.path}: ${(e as Error).stack ?? e}`);
    return json(c, 500, "Something went wrong in Morph.");
  });
  app.notFound((c) => json(c, 404, "Not found."));

  app.get("/v1/health", async (c) => {
    await db.query("SELECT 1");
    return c.json({ ok: true, ai: aiAvailable() });
  });

  // ---- Admin ----

  const admin: MiddlewareHandler<Env> = async (c, next) => {
    const key = bearer(c);
    if (!opts.adminKey || !key || !sameSecret(key, opts.adminKey)) return json(c, 401, "Admin key required.");
    await next();
  };

  app.post("/v1/admin/tenants", admin, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; allowedOrigins?: string[] };
    if (!body.name?.trim()) return json(c, 400, "name is required.");
    const origins = cleanOrigins(body.allowedOrigins);
    if (!origins) return json(c, 400, "allowedOrigins must be a list of origins like https://app.example.com.");
    const id = newTenantId();
    const secretKey = newSecretKey();
    await store.createTenant(db, { id, name: body.name.trim(), allowedOrigins: origins, secretKeyHash: hashKey(secretKey) });
    log(`[morph] created tenant ${id} (${body.name.trim()})`);
    // The only time the secret key is ever shown.
    return c.json({ tenantId: id, secretKey, allowedOrigins: origins }, 201);
  });

  app.patch("/v1/admin/tenants/:id", admin, async (c) => {
    const id = c.req.param("id");
    if (!(await store.tenantById(db, id))) return json(c, 404, "No such tenant.");
    const body = (await c.req.json().catch(() => ({}))) as { allowedOrigins?: string[]; rotateSecretKey?: boolean };
    const result: Record<string, unknown> = { tenantId: id };
    if (body.allowedOrigins !== undefined) {
      const origins = cleanOrigins(body.allowedOrigins);
      if (!origins) return json(c, 400, "allowedOrigins must be a list of origins like https://app.example.com.");
      await store.updateTenant(db, id, { allowedOrigins: origins });
      result.allowedOrigins = origins;
    }
    if (body.rotateSecretKey) {
      const secretKey = newSecretKey();
      await store.updateTenant(db, id, { secretKeyHash: hashKey(secretKey) });
      result.secretKey = secretKey;
    }
    tenantCache.delete(id);
    return c.json(result);
  });

  // ---- Company servers (secret key) ----

  const company: MiddlewareHandler<Env> = async (c, next) => {
    if (c.req.header("Origin")) return json(c, 403, "Secret keys can only be used from your servers, never from a browser.");
    const key = bearer(c);
    if (!key?.startsWith("sk_")) return json(c, 401, "Secret key required (Authorization: Bearer sk_...).");
    const tenant = await store.tenantBySecretHash(db, hashKey(key));
    if (!tenant) return json(c, 401, "Unknown secret key.");
    c.set("tenant", tenant);
    await next();
  };

  app.post("/v1/sessions", company, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<SessionRequest>;
    if (!validUserId(body.userId)) return json(c, 400, "userId is required (a string, up to 200 characters).");
    const tenant = c.get("tenant");
    const session = await signSession(
      opts.jwtSecret,
      { tenantId: tenant.id, user: { id: body.userId, attributes: cleanAttributes(body.attributes) } },
      body.ttlSeconds ?? DEFAULT_TTL,
    );
    return c.json(session);
  });

  app.put("/v1/surfaces/:surface", company, bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
    const surfaceId = c.req.param("surface");
    if (!SURFACE_ID.test(surfaceId)) return json(c, 400, "Surface ids are lowercase letters, digits, _ or -.");
    const body = (await c.req.json().catch(() => null)) as { manifest?: Manifest } | null;
    const problems = validateManifest(body?.manifest);
    if (problems.length) return json(c, 400, "The manifest isn't valid.", { problems });
    const manifest = body!.manifest!;
    const check = await checkPage(manifest.defaultPage.source, manifest.defaultPage.css, manifest);
    if (!check.ok) return json(c, 400, "The default page doesn't pass Morph's checks.", { problems: check.errors });
    const version = await store.putSurface(db, c.get("tenant").id, surfaceId, manifest);
    log(`[morph] ${c.get("tenant").id} registered surface ${surfaceId} v${version}`);
    return c.json({ surface: surfaceId, version });
  });

  app.get("/v1/surfaces/:surface", company, async (c) => {
    const s = await store.getSurface(db, c.get("tenant").id, c.req.param("surface"));
    if (!s) return json(c, 404, "Surface not registered.");
    return c.json({ surface: c.req.param("surface"), version: s.version, updatedAt: s.updatedAt, manifest: s.manifest });
  });

  // ---- Browsers (session token) ----

  // CORS: answer preflights for anyone, then allow the actual request only from the company's origins.
  app.options("/v1/surfaces/:surface/*", (c) => {
    const origin = c.req.header("Origin");
    if (!origin) return c.body(null, 204);
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
  });

  const user: MiddlewareHandler<Env> = async (c, next) => {
    const origin = c.req.header("Origin");
    const token = bearer(c);
    const session = token ? await verifySession(opts.jwtSecret, token) : null;
    if (!session) return json(c, 401, "Session expired or missing. Get a new token from your server.");
    const tenant = await cachedTenant(session.tenantId);
    if (!tenant) return json(c, 401, "This company is no longer registered with Morph.");
    if (origin) {
      if (!tenant.allowedOrigins.includes(origin)) return json(c, 403, `Origin ${origin} isn't allowed for this company.`);
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.set("session", session);
    c.set("tenant", tenant);
    await next();
  };

  async function surfaceFor(c: Context<Env>) {
    const surfaceId = c.req.param("surface") ?? "";
    const s = SURFACE_ID.test(surfaceId) ? await store.getSurface(db, c.get("tenant").id, surfaceId) : null;
    const key: store.PageKey = { tenantId: c.get("tenant").id, surfaceId, userId: c.get("session").user.id };
    return { surface: s, key };
  }
  const noSurface = (c: Context) => json(c, 404, `Surface "${c.req.param("surface")}" isn't registered. Run \`morph push\` first.`);

  // The current page, re-checked and compiled. A saved page that no longer passes falls back to the default.
  app.get("/v1/surfaces/:surface/page", user, async (c) => {
    const { surface, key } = await surfaceFor(c);
    if (!surface) return noSurface(c);
    const m = surface.manifest;
    const saved = await store.latestPage(db, key);
    let shown = saved ? { source: saved.source, css: saved.css, summary: saved.summary, version: saved.id as number | null } : null;
    let stale: string[] = [];
    let result = shown ? await checkPage(shown.source, shown.css, m) : null;
    if (!shown || !result?.ok) {
      if (result && !result.ok) stale = result.errors;
      shown = { ...m.defaultPage, summary: "", version: null };
      result = await checkPage(shown.source, shown.css, m);
    }
    if (!result.ok) return json(c, 500, "The company's default page doesn't pass the checks.", { problems: result.errors });
    const body: PageResponse = {
      source: shown.source,
      css: shown.css,
      compiled: result.compiled,
      scopedCss: result.css,
      summary: shown.summary,
      version: shown.version,
      versions: await store.countVersions(db, key),
      stale,
      config: surfaceConfig(m, aiAvailable()),
    };
    return c.json(body);
  });

  // Save a page the browser has rendered and checked on screen. The server checks the code again.
  app.put("/v1/surfaces/:surface/page", user, bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const { surface, key } = await surfaceFor(c);
    if (!surface) return noSurface(c);
    const body = (await c.req.json().catch(() => ({}))) as { source?: string; css?: string; summary?: string };
    const source = String(body.source ?? "");
    const css = String(body.css ?? "");
    const result = await checkPage(source, css, surface.manifest);
    if (!result.ok) return json(c, 400, "The page didn't pass the checks.", { problems: result.errors });
    const version = await store.savePage(db, key, { source, css, summary: String(body.summary ?? "").slice(0, 500) });
    return c.json({ ok: true, version });
  });

  app.post("/v1/surfaces/:surface/page/undo", user, async (c) => {
    const { surface, key } = await surfaceFor(c);
    if (!surface) return noSurface(c);
    await store.undoPage(db, key);
    return c.json({ ok: true });
  });

  app.delete("/v1/surfaces/:surface/page", user, async (c) => {
    const { surface, key } = await surfaceFor(c);
    if (!surface) return noSurface(c);
    await store.resetPage(db, key);
    return c.json({ ok: true });
  });

  // Ask the AI for a new version. Returns a checked candidate; nothing is saved until the browser
  // has rendered it and confirmed the company's rules hold on screen.
  app.post("/v1/surfaces/:surface/morph", user, bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const { surface, key } = await surfaceFor(c);
    if (!surface) return noSurface(c);
    const name = pickStrategy();
    if (!name) return json(c, 503, "Morph's AI isn't configured on the server.");
    const body = (await c.req.json().catch(() => ({}))) as Partial<MorphRequestBody>;
    const message = String(body.message ?? "").trim();
    if (!message) return json(c, 400, "Empty message.");
    if (message.length > 2000) return json(c, 400, "That message is too long (max 2,000 characters).");
    if (!perUser.take(`${key.tenantId}:${key.userId}`) || !perTenant.take(key.tenantId))
      return json(c, 429, "Too many requests. Wait a minute and try again.");

    let page = body.repair?.page;
    if (!page) {
      const saved = await store.latestPage(db, key);
      page = saved ? { source: saved.source, css: saved.css } : surface.manifest.defaultPage;
    }
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.text === "string")
      .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));

    const started = Date.now();
    try {
      const result = await opts.strategies[name].run({
        manifest: surface.manifest,
        user: c.get("session").user,
        message,
        page: { source: String(page.source), css: String(page.css ?? "") },
        history,
        repair: body.repair ? { problems: (body.repair.problems ?? []).map(String).slice(0, 20) } : undefined,
      });
      log(
        `[morph:${name}] ${key.tenantId}/${key.surfaceId}/${key.userId}: ${body.repair ? "repair, " : ""}${result.candidate ? "candidate" : "no change"}, ${result.rejected.length} check problems, ${Date.now() - started}ms`,
      );
      return c.json(result);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      log(`[morph:${name}] model call failed: ${err.status ?? ""} ${err.message ?? e}`);
      return json(c, 502, err.status === 429 ? "The AI is busy right now. Try again in a moment." : "Something went wrong talking to the AI.");
    }
  });

  return app;
}

/** Origins like https://app.example.com or http://localhost:5173. Null if any entry is invalid. */
function cleanOrigins(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const o of input) {
    try {
      const u = new URL(String(o));
      if (!["http:", "https:"].includes(u.protocol) || u.origin !== String(o).replace(/\/$/, "")) return null;
      out.push(u.origin);
    } catch {
      return null;
    }
  }
  return [...new Set(out)];
}

