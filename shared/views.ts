// Live views: a saved query over one of the company's data sources, drawn by Morph's own
// fixed set of displays. The AI writes the spec; code checks it; the company's server runs it.

import { SOURCES, fieldMeta, type FieldMeta } from "./registry.ts";

export const DISPLAYS = ["table", "board", "cards", "list"] as const;
export type Display = (typeof DISPLAYS)[number];

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface Filter {
  field: string;
  op: FilterOp;
  value: string;
}

export interface ViewSpec {
  id: string;
  title: string;
  source: string;
  filters: Filter[];
  sort: { field: string; dir: "asc" | "desc" } | null;
  groupBy: string | null; // required for "board"
  display: Display;
  columns: string[]; // fields to show, in order
  actions: string[]; // source actions offered on each row
  limit: number | null;
}

export type Row = Record<string, string | number>;

const ORDERED_OPS: FilterOp[] = ["gt", "gte", "lt", "lte"];

/** Human-readable problems with a view spec; empty means valid. */
export function validateView(v: ViewSpec): string[] {
  const errors: string[] = [];
  const src = SOURCES[v.source];
  if (!src) return [`Unknown data source "${v.source}". Sources: ${Object.keys(SOURCES).join(", ")}.`];
  const fieldList = src.fields.map((f) => f.id).join(", ");
  const known = (f: string) => src.fields.some((x) => x.id === f);

  if (!v.title?.trim()) errors.push("The view needs a title.");
  if (v.title && v.title.length > 60) errors.push("Title is too long (60 characters max).");
  if (!DISPLAYS.includes(v.display)) errors.push(`Unknown display "${v.display}". Use ${DISPLAYS.join(", ")}.`);

  for (const f of v.filters ?? []) {
    const meta = fieldMeta(v.source, f.field);
    if (!meta) {
      errors.push(`Can't filter on "${f.field}"; ${src.name} fields are: ${fieldList}.`);
      continue;
    }
    if (!FILTER_OPS.includes(f.op)) errors.push(`Unknown filter op "${f.op}".`);
    if (ORDERED_OPS.includes(f.op) && (meta.type === "text" || meta.type === "enum"))
      errors.push(`"${f.op}" only works on numbers, money and dates, not "${f.field}".`);
    if ((meta.type === "number" || meta.type === "money") && Number.isNaN(Number(f.value)))
      errors.push(`"${f.field}" needs a number, got "${f.value}".`);
    if (meta.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(f.value))
      errors.push(`"${f.field}" needs a date like 2026-11-17, got "${f.value}".`);
    if (meta.type === "enum" && (f.op === "eq" || f.op === "neq") && !meta.options!.includes(f.value))
      errors.push(`"${f.field}" is one of ${meta.options!.join(", ")}, not "${f.value}".`);
  }

  if (v.sort && !known(v.sort.field)) errors.push(`Can't sort by "${v.sort.field}"; fields are: ${fieldList}.`);
  if (v.sort && v.sort.dir !== "asc" && v.sort.dir !== "desc") errors.push(`Sort direction must be asc or desc.`);

  if (v.groupBy && !known(v.groupBy)) errors.push(`Can't group by "${v.groupBy}"; fields are: ${fieldList}.`);
  if (v.display === "board" && !v.groupBy) errors.push(`A board needs a field to group columns by (e.g. status).`);

  if (!v.columns?.length) errors.push("Pick at least one field to show.");
  for (const c of v.columns ?? []) if (!known(c)) errors.push(`Unknown field "${c}"; ${src.name} fields are: ${fieldList}.`);
  if (new Set(v.columns).size !== v.columns?.length) errors.push("A field is listed twice in columns.");

  const actionIds = src.actions.map((a) => a.id);
  for (const a of v.actions ?? [])
    if (!actionIds.includes(a))
      errors.push(`"${a}" isn't an action on ${src.name}. ${actionIds.length ? `Allowed: ${actionIds.join(", ")}.` : "It has no actions."}`);

  if (v.limit !== null && (!Number.isInteger(v.limit) || v.limit < 1 || v.limit > 100)) errors.push("Limit must be 1–100, or none.");
  return errors;
}

function compare(meta: FieldMeta, a: string | number, b: string | number): number {
  if (meta.type === "number" || meta.type === "money") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function matches(row: Row, f: Filter, meta: FieldMeta): boolean {
  const cell = row[f.field];
  if (f.op === "contains") return String(cell).toLowerCase().includes(f.value.toLowerCase());
  const c = meta.type === "text" || meta.type === "enum" ? String(cell).toLowerCase().localeCompare(f.value.toLowerCase()) : compare(meta, cell, f.value);
  switch (f.op) {
    case "eq": return c === 0;
    case "neq": return c !== 0;
    case "gt": return c > 0;
    case "gte": return c >= 0;
    case "lt": return c < 0;
    case "lte": return c <= 0;
  }
}

/** Filters, sorts and limits rows the user is already allowed to see. Assumes a valid spec. */
export function runQuery(rows: Row[], v: ViewSpec): { rows: Row[]; total: number } {
  let out = rows.filter((r) => v.filters.every((f) => matches(r, f, fieldMeta(v.source, f.field)!)));
  if (v.sort) {
    const meta = fieldMeta(v.source, v.sort.field)!;
    const dir = v.sort.dir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => dir * compare(meta, a[v.sort!.field], b[v.sort!.field]));
  }
  const total = out.length;
  return { rows: v.limit ? out.slice(0, v.limit) : out, total };
}

/** Column order for a board: enum option order when known, otherwise first-seen order. */
export function boardGroups(rows: Row[], v: ViewSpec): { key: string; rows: Row[] }[] {
  const meta = fieldMeta(v.source, v.groupBy!)!;
  const keys = meta.options ? [...meta.options] : [];
  for (const r of rows) if (!keys.includes(String(r[v.groupBy!]))) keys.push(String(r[v.groupBy!]));
  return keys.map((key) => ({ key, rows: rows.filter((r) => String(r[v.groupBy!]) === key) }));
}

export function formatCell(meta: FieldMeta | undefined, value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  if (meta?.type === "money") return `$${Number(value).toLocaleString("en-US")}`;
  if (meta?.type === "date") {
    const d = new Date(`${value}T12:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (meta?.id === "days_overdue") return Number(value) > 0 ? `${value} days` : "—";
  return String(value);
}
