// Starts Morph's service: connects to Postgres, applies migrations, serves the API.

import { serve } from "@hono/node-server";
import { anthropicStrategy } from "./ai/anthropic.ts";
import { openaiStrategy } from "./ai/openai.ts";
import { createApp, type StrategyEntry } from "./app.ts";
import { connectPostgres } from "./db/connect.ts";
import { migrate } from "./db/db.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; rely on the environment
}

const isReal = (v?: string) => !!v && !v.endsWith("...");

const STRATEGIES: Record<string, StrategyEntry> = {
  openai: { run: openaiStrategy, available: () => isReal(process.env.OPENAI_API_KEY) },
  anthropic: { run: anthropicStrategy, available: () => isReal(process.env.ANTHROPIC_API_KEY) || isReal(process.env.ANTHROPIC_AUTH_TOKEN) },
};

/** MORPH_PROVIDER if set and configured, otherwise the first provider with a key. */
function defaultStrategy(): string | undefined {
  const preferred = process.env.MORPH_PROVIDER;
  if (preferred && STRATEGIES[preferred]?.available()) return preferred;
  return Object.keys(STRATEGIES).find((k) => STRATEGIES[k].available());
}

const jwtSecret = process.env.MORPH_JWT_SECRET ?? "";
if (jwtSecret.length < 32) {
  console.error("[morph] MORPH_JWT_SECRET must be set to at least 32 random characters.");
  process.exit(1);
}

const db = await connectPostgres();
await migrate(db);

const app = createApp({
  db,
  jwtSecret,
  adminKey: process.env.MORPH_ADMIN_KEY,
  strategies: STRATEGIES,
  defaultStrategy,
  limits: { perUser: Number(process.env.MORPH_LIMIT_PER_USER ?? 12), perTenant: Number(process.env.MORPH_LIMIT_PER_TENANT ?? 300) },
  log: (line) => console.log(line),
});

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => console.log(`[morph] service on :${port} (AI: ${defaultStrategy() ?? "none"})`));

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    db.close().finally(() => process.exit(0));
  });
