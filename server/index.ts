import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DEFAULT_LAYOUT, validateLayout } from "../shared/layout.ts";
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

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    provider: defaultStrategy() ?? null,
    available: Object.keys(STRATEGIES).filter((k) => STRATEGIES[k].available()),
    hasKey: !!defaultStrategy(),
  }),
);

app.post("/api/morph", async (c) => {
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
    const result = await strategy.run({ message: body.message, layout, history: body.history ?? [] });
    console.log(
      `[morph:${name}] "${body.message}" -> ${result.applied.length} applied, ${result.rejected.length} rejected (${Date.now() - started}ms)`,
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

serve({ fetch: app.fetch, port: 8787 }, () => console.log(`[morph] api on http://localhost:8787 (provider: ${defaultStrategy() ?? "none"})`));
