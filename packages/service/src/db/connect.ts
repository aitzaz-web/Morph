// Opens the database: node-postgres for a real server, PGlite (Postgres in memory) for tests.

import type { Database, Sql } from "./db.ts";

/**
 * Connects with DATABASE_URL, or the standard PGHOST / PGUSER / PGPASSWORD / PGDATABASE variables
 * (how the AWS deployment passes the RDS credentials). DATABASE_SSL=true for RDS.
 */
export async function connectPostgres(): Promise<Database> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    // RDS requires TLS. TODO: pin the RDS CA bundle instead of skipping verification.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  return {
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Sql = { query: (text, params) => client.query(text, params as unknown[]) as never };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** A throwaway in-memory Postgres, for tests. */
export async function memoryDatabase(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  return {
    query: (text, params) => db.query(text, params) as never,
    transaction: (fn) => db.transaction((tx) => fn({ query: (text, params) => tx.query(text, params) as never })),
    close: () => db.close(),
  };
}
