// Morph's own storage, in Postgres: companies (tenants), the surfaces they registered, and every
// version of each end user's page. Separate from the company's data, which Morph never stores.
// Only page source is stored; it's re-checked and recompiled on load, so pages always pass the current checker.
//
// Every query takes the tenant id from the caller's verified credentials, never from the request body.

import type { Manifest } from "@morph/shared";
import { MIGRATIONS } from "./migrations.ts";

/** The slice of a Postgres client Morph uses. Works with node-postgres (production) and PGlite (tests). */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Sql {
  /** Runs `fn` on one connection inside a transaction. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Applies pending migrations, one process at a time (advisory lock). */
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(727274)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const done = new Set((await tx.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    for (const [i, sql] of MIGRATIONS.entries()) {
      const id = i + 1;
      if (done.has(id)) continue;
      for (const statement of sql.split(/;\s*$/m).filter((s) => s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    }
  });
}

// ---- Tenants ----

export interface Tenant {
  id: string;
  name: string;
  allowedOrigins: string[];
}

interface TenantRow {
  id: string;
  name: string;
  allowed_origins: string[];
}

const tenant = (r: TenantRow): Tenant => ({ id: r.id, name: r.name, allowedOrigins: r.allowed_origins });

export async function createTenant(db: Sql, t: Tenant & { secretKeyHash: string }) {
  await db.query("INSERT INTO tenants (id, name, secret_key_hash, allowed_origins) VALUES ($1, $2, $3, $4)", [
    t.id,
    t.name,
    t.secretKeyHash,
    t.allowedOrigins,
  ]);
}

export async function tenantBySecretHash(db: Sql, hash: string): Promise<Tenant | null> {
  const r = await db.query<TenantRow>("SELECT id, name, allowed_origins FROM tenants WHERE secret_key_hash = $1", [hash]);
  return r.rows[0] ? tenant(r.rows[0]) : null;
}

export async function tenantById(db: Sql, id: string): Promise<Tenant | null> {
  const r = await db.query<TenantRow>("SELECT id, name, allowed_origins FROM tenants WHERE id = $1", [id]);
  return r.rows[0] ? tenant(r.rows[0]) : null;
}

export async function updateTenant(db: Sql, id: string, patch: { allowedOrigins?: string[]; secretKeyHash?: string }) {
  if (patch.allowedOrigins) await db.query("UPDATE tenants SET allowed_origins = $2 WHERE id = $1", [id, patch.allowedOrigins]);
  if (patch.secretKeyHash) await db.query("UPDATE tenants SET secret_key_hash = $2 WHERE id = $1", [id, patch.secretKeyHash]);
}

// ---- Surfaces ----

export interface Surface {
  manifest: Manifest;
  version: number;
  updatedAt: string;
}

export async function putSurface(db: Sql, tenantId: string, surfaceId: string, manifest: Manifest): Promise<number> {
  const r = await db.query<{ version: number }>(
    `INSERT INTO surfaces (tenant_id, surface_id, manifest) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, surface_id) DO UPDATE SET manifest = EXCLUDED.manifest, version = surfaces.version + 1, updated_at = now()
     RETURNING version`,
    [tenantId, surfaceId, JSON.stringify(manifest)],
  );
  return r.rows[0].version;
}

export async function getSurface(db: Sql, tenantId: string, surfaceId: string): Promise<Surface | null> {
  const r = await db.query<{ manifest: Manifest | string; version: number; updated_at: Date }>(
    "SELECT manifest, version, updated_at FROM surfaces WHERE tenant_id = $1 AND surface_id = $2",
    [tenantId, surfaceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const manifest = typeof row.manifest === "string" ? (JSON.parse(row.manifest) as Manifest) : row.manifest;
  return { manifest, version: row.version, updatedAt: new Date(row.updated_at).toISOString() };
}

// ---- Page versions ----

export interface PageKey {
  tenantId: string;
  surfaceId: string;
  userId: string;
}

export interface PageVersion {
  id: number;
  source: string;
  css: string;
  summary: string;
  createdAt: string;
}

const WHERE_KEY = "tenant_id = $1 AND surface_id = $2 AND end_user_id = $3";
const keyParams = (k: PageKey) => [k.tenantId, k.surfaceId, k.userId];

/** The user's current page, or null if they're still on the company's default. */
export async function latestPage(db: Sql, k: PageKey): Promise<PageVersion | null> {
  const r = await db.query<{ id: string | number; source: string; css: string; summary: string; created_at: Date }>(
    `SELECT id, source, css, summary, created_at FROM page_versions WHERE ${WHERE_KEY} ORDER BY id DESC LIMIT 1`,
    keyParams(k),
  );
  const row = r.rows[0];
  return row ? { id: Number(row.id), source: row.source, css: row.css, summary: row.summary, createdAt: new Date(row.created_at).toISOString() } : null;
}

export async function countVersions(db: Sql, k: PageKey): Promise<number> {
  const r = await db.query<{ n: string | number }>(`SELECT COUNT(*) AS n FROM page_versions WHERE ${WHERE_KEY}`, keyParams(k));
  return Number(r.rows[0].n);
}

export async function savePage(db: Sql, k: PageKey, page: { source: string; css: string; summary: string }): Promise<number> {
  const r = await db.query<{ id: string | number }>(
    "INSERT INTO page_versions (tenant_id, surface_id, end_user_id, source, css, summary) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [...keyParams(k), page.source, page.css, page.summary],
  );
  return Number(r.rows[0].id);
}

/** Drops the latest version, going back to the one before (or the default). */
export async function undoPage(db: Sql, k: PageKey) {
  await db.query(`DELETE FROM page_versions WHERE id = (SELECT MAX(id) FROM page_versions WHERE ${WHERE_KEY})`, keyParams(k));
}

/** Back to the company's default page. */
export async function resetPage(db: Sql, k: PageKey) {
  await db.query(`DELETE FROM page_versions WHERE ${WHERE_KEY}`, keyParams(k));
}
