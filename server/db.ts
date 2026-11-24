// Morph's own storage: every version of each user's AI-written page. Separate from the company's data.
// Only the source is stored; it's re-checked and recompiled on load, so pages always pass the current checker.

import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  const path = process.env.MORPH_DB ?? "data/morph.db";
  if (path !== ":memory:") mkdirSync("data", { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS page_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    css TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS page_versions_user ON page_versions (user_id, id)`);
  return db;
}

export interface PageVersion {
  id: number;
  source: string;
  css: string;
  summary: string;
  created_at: string;
}

/** The user's current page, or null if they're still on the company's default. */
export function latestPage(userId: string): PageVersion | null {
  const row = open()
    .prepare("SELECT id, source, css, summary, created_at FROM page_versions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(userId) as PageVersion | undefined;
  return row ?? null;
}

export function countVersions(userId: string): number {
  return (open().prepare("SELECT COUNT(*) AS n FROM page_versions WHERE user_id = ?").get(userId) as { n: number }).n;
}

export function savePage(userId: string, page: { source: string; css: string; summary: string }): number {
  const r = open()
    .prepare("INSERT INTO page_versions (user_id, source, css, summary, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, page.source, page.css, page.summary, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

/** Drops the latest version, going back to the one before (or the default). */
export function undoPage(userId: string) {
  open().prepare("DELETE FROM page_versions WHERE id = (SELECT MAX(id) FROM page_versions WHERE user_id = ?)").run(userId);
}

/** Back to the company's default page. */
export function resetPage(userId: string) {
  open().prepare("DELETE FROM page_versions WHERE user_id = ?").run(userId);
}
