// Runs Ledgerly: its API, plus the built frontend (dist/) in production.

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createLedgerly } from "./app.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}

const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET ?? (production ? "" : "dev-only-session-secret-change-me");
if (sessionSecret.length < 16) {
  console.error("[ledgerly] SESSION_SECRET must be set (16+ random characters).");
  process.exit(1);
}

const morphUrl = process.env.MORPH_URL ?? "http://localhost:8787";
const app = createLedgerly({
  sessionSecret,
  morphUrl,
  morphPublicUrl: process.env.MORPH_PUBLIC_URL ?? morphUrl,
  morphSecretKey: process.env.MORPH_SECRET_KEY ?? "",
  secureCookies: process.env.SECURE_COOKIES === "true",
});

if (production) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8788);
serve({ fetch: app.fetch, port }, () => console.log(`[ledgerly] on :${port} (Morph at ${morphUrl})`));
