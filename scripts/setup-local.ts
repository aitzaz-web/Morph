// One-time local setup, run after `npm run db:up`:
// 1. writes packages/service/.env with fresh secrets (if it doesn't exist yet)
// 2. creates the Ledgerly company in Morph's database and writes its secret key to examples/ledgerly/.env
// 3. uploads Ledgerly's manifest
// Runs Morph's API in-process, so the dev servers don't need to be running.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createApp } from "../packages/service/src/app.ts";
import { connectPostgres } from "../packages/service/src/db/connect.ts";
import { migrate } from "../packages/service/src/db/db.ts";
import manifest from "../examples/ledgerly/morph.manifest.ts";

const SERVICE_ENV = "packages/service/.env";
const LEDGERLY_ENV = "examples/ledgerly/.env";
const LEDGERLY_ORIGIN = "http://localhost:5173";
const secret = (n: number) => randomBytes(n).toString("base64url");

const parseEnv = (path: string): Record<string, string> =>
  existsSync(path)
    ? Object.fromEntries(
        readFileSync(path, "utf8")
          .split("\n")
          .filter((l) => /^\s*[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
      )
    : {};

if (!existsSync(SERVICE_ENV)) {
  const example = readFileSync("packages/service/.env.example", "utf8");
  writeFileSync(
    SERVICE_ENV,
    example.replace("MORPH_JWT_SECRET=...", `MORPH_JWT_SECRET=${secret(48)}`).replace("MORPH_ADMIN_KEY=...", `MORPH_ADMIN_KEY=${secret(32)}`),
  );
  console.log(`Wrote ${SERVICE_ENV} with new secrets. Add your OPENAI_API_KEY or ANTHROPIC_API_KEY there.`);
}
const env = parseEnv(SERVICE_ENV);
Object.assign(process.env, { DATABASE_URL: env.DATABASE_URL });

const db = await connectPostgres();
await migrate(db);
const app = createApp({ db, jwtSecret: env.MORPH_JWT_SECRET, adminKey: env.MORPH_ADMIN_KEY, strategies: {} });
const call = async (method: string, path: string, key: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

// Reuse Ledgerly's key if it still works, otherwise register Ledgerly again.
const ledgerly = parseEnv(LEDGERLY_ENV);
let key = ledgerly.MORPH_SECRET_KEY ?? "";
if (!key.startsWith("sk_") || (await call("POST", "/v1/sessions", key, { userId: "setup-check" })).status !== 200) {
  const r = await call("POST", "/v1/admin/tenants", env.MORPH_ADMIN_KEY, { name: "Ledgerly", allowedOrigins: [LEDGERLY_ORIGIN] });
  if (r.status !== 201) throw new Error(`Couldn't create the Ledgerly tenant: ${JSON.stringify(r.body)}`);
  key = String(r.body.secretKey);
  const lines = [
    "MORPH_URL=http://localhost:8787",
    `MORPH_SECRET_KEY=${key}`,
    `SESSION_SECRET=${ledgerly.SESSION_SECRET ?? secret(24)}`,
  ];
  writeFileSync(LEDGERLY_ENV, `${lines.join("\n")}\n`);
  console.log(`Registered Ledgerly as ${r.body.tenantId} and wrote its secret key to ${LEDGERLY_ENV}.`);
} else console.log("Ledgerly is already registered.");

const pushed = await call("PUT", "/v1/surfaces/dashboard", key, { manifest });
if (pushed.status !== 200) throw new Error(`Couldn't push the manifest: ${JSON.stringify(pushed.body)}`);
console.log(`Pushed Ledgerly's dashboard manifest (version ${pushed.body.version}).`);
await db.close();
console.log("\nDone. Run `npm run dev` and open http://localhost:5173");
