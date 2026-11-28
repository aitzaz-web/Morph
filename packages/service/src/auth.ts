// Credentials.
// - Secret key (sk_...): belongs to a company, used only from its servers. Stored as a SHA-256 hash.
// - Session token: a short-lived JWT Morph signs for one end user of one company. The company's
//   server gets it with its secret key and hands it to the browser. It's the only thing the browser holds.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sign, verify } from "hono/jwt";
import type { EndUser } from "./ai/types.ts";

export const DEFAULT_TTL = 3600;
export const MAX_TTL = 86_400;

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

export const newTenantId = () => `ten_${random(9)}`;
export const newSecretKey = () => `sk_${random(32)}`;
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Constant-time compare, for the admin key. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface Session {
  tenantId: string;
  user: EndUser;
}

interface Claims {
  iss: "morph";
  tid: string;
  sub: string;
  att: Record<string, string>;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

export async function signSession(secret: string, s: Session, ttlSeconds = DEFAULT_TTL): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(Math.floor(ttlSeconds), 60), MAX_TTL);
  const claims: Claims = { iss: "morph", tid: s.tenantId, sub: s.user.id, att: s.user.attributes, iat: now, exp: now + ttl };
  return { token: await sign(claims, secret, "HS256"), expiresAt: new Date((now + ttl) * 1000).toISOString() };
}

/** Returns the session, or null if the token is missing, forged or expired. */
export async function verifySession(secret: string, token: string): Promise<Session | null> {
  try {
    const c = (await verify(token, secret, "HS256")) as unknown as Claims;
    if (c.iss !== "morph" || typeof c.tid !== "string" || typeof c.sub !== "string") return null;
    return { tenantId: c.tid, user: { id: c.sub, attributes: c.att ?? {} } };
  } catch {
    return null;
  }
}

const MAX_ATTRS = 12;
const MAX_ATTR_LEN = 200;

/** Cleans what a company sends about a user: short strings only, no newlines (they go into the prompt). */
export function cleanAttributes(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input).slice(0, MAX_ATTRS)) {
    if (!/^[a-zA-Z][\w]{0,39}$/.test(k) || (typeof v !== "string" && typeof v !== "number")) continue;
    out[k] = String(v).replace(/\s+/g, " ").trim().slice(0, MAX_ATTR_LEN);
  }
  return out;
}

export const validUserId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
