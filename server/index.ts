import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { USERS, type User } from "../shared/registry.ts";
import { checkPage } from "./codegen/check.ts";
import { appData, createInvoice, getUser, runAction } from "./company.ts";
import { countVersions, latestPage, resetPage, savePage, undoPage } from "./db.ts";
import { anthropicStrategy } from "./strategies/anthropic.ts";
import { openaiStrategy } from "./strategies/openai.ts";
import type { ChatTurn, PageSource, Strategy } from "./strategies/types.ts";

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

/** The company's default page, written with the same imports the AI uses. */
export const DEFAULT_PAGE: PageSource = {
  source: readFileSync(new URL("../src/morph/default-page.tsx", import.meta.url), "utf8"),
  css: "",
};

/** The user's current page source: their latest saved version, or the default. */
function currentSource(user: User): PageSource & { version: number | null; summary: string } {
  const saved = latestPage(user.id);
  return saved ? { source: saved.source, css: saved.css, version: saved.id, summary: saved.summary } : { ...DEFAULT_PAGE, version: null, summary: "" };
}

export const app = new Hono();

// In a real install the user comes from the company's login session. The demo passes ?user=.
const userFrom = (c: Context) => getUser(c.req.query("user"));
const noUser = (c: Context) => c.json({ error: "Unknown user" }, 401);

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
  if (!user) return noUser(c);
  return c.json(appData(user));
});

app.post("/api/invoices", async (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  const { customer, amount } = (await c.req.json()) as { customer: string; amount: number };
  try {
    return c.json({ id: createInvoice(user, customer, Number(amount)) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// A row action triggered from a page; runs the company's own action handler.
app.post("/api/action", async (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  const { source, action, key } = (await c.req.json()) as { source: string; action: string; key: string };
  try {
    return c.json({ message: runAction(user, source, action, key) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---- Morph: the user's page ----

// The current page, re-checked and compiled. A saved page that no longer passes falls back to the default.
app.get("/api/page", async (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  const page = currentSource(user);
  let result = await checkPage(page.source, page.css);
  let stale: string[] = [];
  let shown = page;
  if (!result.ok && page.version !== null) {
    stale = result.errors;
    shown = { ...DEFAULT_PAGE, version: null, summary: "" };
    result = await checkPage(shown.source, shown.css);
  }
  if (!result.ok) return c.json({ error: `The default page doesn't pass the checks: ${result.errors.join(" ")}` }, 500);
  return c.json({
    source: shown.source,
    css: shown.css,
    compiled: result.compiled,
    scopedCss: result.css,
    summary: shown.summary,
    version: shown.version,
    versions: countVersions(user.id),
    stale,
  });
});

// Save a page the browser has rendered and checked on screen. The server checks the code again.
app.put("/api/page", async (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  const { source, css, summary } = (await c.req.json()) as { source: string; css: string; summary?: string };
  const result = await checkPage(String(source ?? ""), String(css ?? ""));
  if (!result.ok) return c.json({ error: "The page didn't pass the checks.", problems: result.errors }, 400);
  const version = savePage(user.id, { source, css: css ?? "", summary: String(summary ?? "") });
  return c.json({ ok: true, version });
});

app.post("/api/page/undo", (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  undoPage(user.id);
  return c.json({ ok: true });
});

app.delete("/api/page", (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  resetPage(user.id);
  return c.json({ ok: true });
});

// Ask the AI for a new version. Returns a checked candidate; nothing is saved until the browser
// has rendered it and confirmed the company's rules hold on screen.
app.post("/api/morph", async (c) => {
  const user = userFrom(c);
  if (!user) return noUser(c);
  const name = c.req.query("strategy") || defaultStrategy();
  if (!name)
    return c.json({ error: "No API key on the server. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to .env and restart `npm run dev`." }, 500);
  const strategy = STRATEGIES[name];
  if (!strategy) return c.json({ error: `Unknown strategy "${name}". Options: ${Object.keys(STRATEGIES).join(", ")}` }, 400);

  const body = (await c.req.json()) as { message: string; history?: ChatTurn[]; repair?: { page: PageSource; problems: string[] } };
  if (!body.message?.trim()) return c.json({ error: "Empty message" }, 400);
  const page = body.repair?.page ?? currentSource(user);

  const started = Date.now();
  try {
    const result = await strategy.run({
      user,
      message: body.message,
      page: { source: page.source, css: page.css },
      history: body.history ?? [],
      repair: body.repair ? { problems: body.repair.problems } : undefined,
    });
    console.log(
      `[morph:${name}] ${user.id}: ${body.repair ? "(repair) " : ""}"${body.message}" -> ${result.candidate ? "candidate" : "no change"}, ${result.rejected.length} check problems (${Date.now() - started}ms)`,
    );
    return c.json(result);
  } catch (e) {
    console.error(`[morph:${name}] failed:`, e);
    const err = e as { status?: number; message?: string };
    const msg =
      err.status === 401 ? `The ${name} API key was rejected. Check it in .env and restart.` : err.message || "Something went wrong talking to the model.";
    return c.json({ error: msg }, 502);
  }
});

if (!process.env.VITEST)
  serve({ fetch: app.fetch, port: 8787 }, () => console.log(`[morph] api on http://localhost:8787 (provider: ${defaultStrategy() ?? "none"})`));
