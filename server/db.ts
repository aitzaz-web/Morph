// Morph's own storage: each user's saved layout changes. Separate from the company's data.

import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Batch } from "../shared/layout.ts";

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  const path = process.env.MORPH_DB ?? "data/morph.db";
  if (path !== ":memory:") mkdirSync("data", { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS layouts (
    user_id TEXT PRIMARY KEY,
    batches TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

export function loadBatches(userId: string): Batch[] {
  const row = open().prepare("SELECT batches FROM layouts WHERE user_id = ?").get(userId) as { batches: string } | undefined;
  return row ? (JSON.parse(row.batches) as Batch[]) : [];
}

export function saveBatches(userId: string, batches: Batch[]) {
  open()
    .prepare(
      `INSERT INTO layouts (user_id, batches, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET batches = excluded.batches, updated_at = excluded.updated_at`,
    )
    .run(userId, JSON.stringify(batches), new Date().toISOString());
}
