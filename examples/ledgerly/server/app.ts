// Ledgerly's backend: its own login, its own data API, and one endpoint for Morph, which trades
// Ledgerly's secret key for a short-lived Morph token for the signed-in user. The secret key never
// leaves this server.

import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { appData, createInvoice, getUser, runAction } from "./company.ts";
import { USERS, type User } from "./users.ts";

export interface LedgerlyOptions {
  /** Signs Ledgerly's own session cookie. */
  sessionSecret: string;
  /** Morph's service, as this server reaches it. */
  morphUrl: string;
  /** Morph's service, as browsers reach it (often the same). */
  morphPublicUrl: string;
  morphSecretKey: string;
  secureCookies: boolean;
  fetch?: typeof fetch;
}

const COOKIE = "ledgerly_session";

export function createLedgerly(opts: LedgerlyOptions) {
  const app = new Hono();
  const doFetch = opts.fetch ?? fetch;

  async function currentUser(c: Context): Promise<User | null> {
    const id = await getSignedCookie(c, opts.sessionSecret, COOKIE);
    return typeof id === "string" ? getUser(id) : null;
  }
  const noUser = (c: Context) => c.json({ error: "Not signed in." }, 401);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/config", (c) => c.json({ morphUrl: opts.morphPublicUrl }));

  // ---- Login (demo: pick an account, no password) ----

  app.get("/api/demo-users", (c) => c.json(Object.values(USERS).map(({ id, name, role }) => ({ id, name, role }))));

  app.post("/api/login", async (c) => {
    const { userId } = (await c.req.json().catch(() => ({}))) as { userId?: string };
    const user = getUser(userId);
    if (!user) return c.json({ error: "Unknown user." }, 400);
    await setSignedCookie(c, COOKIE, user.id, opts.sessionSecret, {
      httpOnly: true,
      sameSite: "Lax",
      secure: opts.secureCookies,
      path: "/",
      maxAge: 7 * 86_400,
    });
    return c.json({ user });
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const user = await currentUser(c);
    return user ? c.json({ user }) : noUser(c);
  });

  // ---- Ledgerly's data ----

  app.get("/api/app", async (c) => {
    const user = await currentUser(c);
    return user ? c.json(appData(user)) : noUser(c);
  });

  app.post("/api/invoices", async (c) => {
    const user = await currentUser(c);
    if (!user) return noUser(c);
    const { customer, amount } = (await c.req.json()) as { customer: string; amount: number };
    try {
      return c.json({ id: createInvoice(user, customer, Number(amount)) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/api/action", async (c) => {
    const user = await currentUser(c);
    if (!user) return noUser(c);
    const { source, action, key } = (await c.req.json()) as { source: string; action: string; key: string };
    try {
      return c.json({ message: runAction(user, source, action, key) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // ---- Morph ----

  app.post("/api/morph-token", async (c) => {
    const user = await currentUser(c);
    if (!user) return noUser(c);
    if (!opts.morphSecretKey) return c.json({ error: "Ledgerly isn't connected to Morph (MORPH_SECRET_KEY is missing)." }, 503);
    const res = await doFetch(`${opts.morphUrl.replace(/\/$/, "")}/v1/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.morphSecretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        attributes: {
          name: user.name,
          role: user.role,
          ...(user.repName ? { access: "only sees their own customers" } : {}),
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: string; error?: string };
    if (!res.ok || !body.token) return c.json({ error: `Morph refused the session: ${body.error ?? res.status}` }, 502);
    return c.json({ token: body.token, expiresAt: body.expiresAt });
  });

  return app;
}
