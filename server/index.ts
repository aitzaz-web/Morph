import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DEFAULT_LAYOUT, replay, validateLayout, type Batch } from "../shared/layout.ts";
import { USERS } from "../shared/registry.ts";
import type { ViewSpec } from "../shared/views.ts";
import { appData, createInvoice, getUser, queryRows, runAction } from "./company.ts";
import { loadBatches, saveBatches } from "./db.ts";
import { anthropicStrategy } from "./strategies/anthropic.ts";
import { openaiStrategy } from "./strategies/openai.ts";
import type { MorphRequest, Strategy } from "./strategies/types.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; rely on the environment
}

const isReal = (v?: string) => !!v && !v.endsWith("...");

// Each strategy plus whether its credentials are present.
const STRATEGIES: Record<string, { run: Strategy; available: () => boolean }> = {
  openai: { run: openaiStrategy, available: () => isReal(process.env.OPENAI_API_KEY) },
  anthropic: {
    run: anthropicStrategy,
    available: () => isReal(process.env.ANTHROPIC_API_KEY) || isReal(process.env.ANTHROPIC_AUTH_TOKEN),
  },
};

/** MORPH_PROVIDER if set, otherwise the first provider with a key (OpenAI first). */
function defaultStrategy(): string | undefined {
  const preferred = process.env.MORPH_PROVIDER;
  if (preferred && STRATEGIES[preferred]?.available()) return preferred;
  return Object.keys(STRATEGIES).find((k) => STRATEGIES[k].available());
}

export const app = new Hono();

// In a real install the user comes from the company's login session. The demo passes ?user=.
const userFrom = (c: { req: { query: (k: string) => string | undefined } }) => getUser(c.req.query("user"));

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    provider: defaultStrategy() ?? null,
    available: Object.keys(STRATEGIES).filter((k) => STRATEGIES[k].available()),
    hasKey: !!defaultStrategy(),
    users: Object.values(USERS),
  }),
);

// ---- The company's own API (stand-in for Ledgerly's backend) ----

app.get("/api/app", (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  return c.json(appData(user));
});

app.post("/api/invoices", async (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const { customer, amount } = (await c.req.json()) as { customer: string; amount: number };
  try {
    return c.json({ id: createInvoice(user, customer, Number(amount)) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---- Morph ----

// A view's rows, fetched through the company's permission-scoped query.
app.post("/api/rows", async (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const { view } = (await c.req.json()) as { view: ViewSpec };
  try {
    return c.json(queryRows(user, view));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// A row action from a view; runs the company's own action handler.
app.post("/api/action", async (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const { source, action, key } = (await c.req.json()) as { source: string; action: string; key: string };
  try {
    return c.json({ message: runAction(user, source, action, key) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// The user's saved changes. The layout itself is always rebuilt from the current default.
app.get("/api/layout", (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const batches = loadBatches(user.id);
  return c.json({ batches, skipped: replay(batches).skipped });
});

app.put("/api/layout", async (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const { batches } = (await c.req.json()) as { batches: Batch[] };
  if (!Array.isArray(batches) || !batches.every(Array.isArray)) return c.json({ error: "batches must be a list of lists" }, 400);
  saveBatches(user.id, batches);
  return c.json({ ok: true });
});

app.post("/api/morph", async (c) => {
  const user = userFrom(c);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const name = c.req.query("strategy") || defaultStrategy();
  if (!name)
    return c.json({ error: "No API key on the server. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to .env and restart `npm run dev`." }, 500);
  const strategy = STRATEGIES[name];
  if (!strategy) return c.json({ error: `Unknown strategy "${name}"` }, 400);
  if (!strategy.available()) return c.json({ error: `No API key configured for ${name}.` }, 500);

  const body = (await c.req.json()) as Partial<MorphRequest>;
  if (!body.message?.trim()) return c.json({ error: "Empty message" }, 400);
  const layout = body.layout && validateLayout(body.layout).length === 0 ? body.layout : DEFAULT_LAYOUT;

  const started = Date.now();
  try {
    const result = await strategy.run({ user, message: body.message, layout, history: body.history ?? [] });
    console.log(
      `[morph:${name}] ${user.id}: "${body.message}" -> ${result.ops.length} applied, ${result.rejected.length} rejected (${Date.now() - started}ms)`,
    );
    return c.json(result);
  } catch (e) {
    console.error(`[morph:${name}] error`, e);
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return c.json({ error: `The ${name} API key was rejected. Check it in .env and restart.` }, 500);
    if (err.status === 429) return c.json({ error: "Rate limited or out of quota on the API. Try again in a moment." }, 429);
    if (err.status) return c.json({ error: `API error (${err.status}): ${err.message}` }, 502);
    return c.json({ error: err.message ?? "Unknown error" }, 500);
  }
});

if (!process.env.VITEST)
  serve({ fetch: app.fetch, port: 8787 }, () => console.log(`[morph] api on http://localhost:8787 (provider: ${defaultStrategy() ?? "none"})`));
