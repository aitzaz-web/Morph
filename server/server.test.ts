import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, replay } from "../shared/layout.ts";
import type { ViewSpec } from "../shared/views.ts";
import { resetCompanyData } from "./company.ts";
import { LayoutSession } from "./strategies/common.ts";

process.env.MORPH_DB = ":memory:";
const { app } = await import("./index.ts");

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const allInvoices: ViewSpec = {
  id: "view-1",
  title: "Everything",
  source: "invoices",
  filters: [],
  sort: null,
  groupBy: null,
  display: "table",
  columns: ["customer", "amount"],
  actions: [],
  limit: null,
};

beforeEach(() => resetCompanyData());

describe("permissions", () => {
  it("a rep only sees their own customers' invoices", async () => {
    const maria = await (await app.request("/api/rows?user=maria", json("POST", { view: allInvoices }))).json();
    const dev = await (await app.request("/api/rows?user=dev", json("POST", { view: allInvoices }))).json();
    expect(dev.total).toBeLessThan(maria.total);
    const devCustomers = new Set(dev.rows.map((r: { customer: string }) => r.customer));
    expect([...devCustomers].sort()).toEqual(["Lakeview Apartments", "Northgate Builders", "Oakridge Dental", "Riverside Schools"]);
  });

  it("only returns the fields the view asked for (plus the row key)", async () => {
    const r = await (await app.request("/api/rows?user=maria", json("POST", { view: allInvoices }))).json();
    expect(Object.keys(r.rows[0]).sort()).toEqual(["amount", "customer", "id", "status"]);
  });

  it("rejects a view that asks for a field the source doesn't have", async () => {
    const res = await app.request("/api/rows?user=maria", json("POST", { view: { ...allInvoices, columns: ["customer", "password"] } }));
    expect(res.status).toBe(400);
  });

  it("a rep can't act on another rep's invoice", async () => {
    // INV-1040 belongs to Brightline HVAC (Sam's customer).
    const res = await app.request("/api/action?user=dev", json("POST", { source: "invoices", action: "mark_paid", key: "INV-1040" }));
    expect(res.status).toBe(400);
    const ok = await app.request("/api/action?user=maria", json("POST", { source: "invoices", action: "mark_paid", key: "INV-1040" }));
    expect(ok.status).toBe(200);
  });

  it("unknown users get nothing", async () => {
    expect((await app.request("/api/app?user=mallory")).status).toBe(401);
  });
});

describe("saved layouts", () => {
  it("are saved per user", async () => {
    const batches = [[{ type: "set_visibility", id: "news", visible: false }]];
    await app.request("/api/layout?user=maria", json("PUT", { batches }));
    expect((await (await app.request("/api/layout?user=maria")).json()).batches).toEqual(batches);
    expect((await (await app.request("/api/layout?user=dev")).json()).batches).toEqual([]);
  });
});

describe("AI tool calls", () => {
  it("turn into validated changes with stable view ids", () => {
    const s = new LayoutSession(DEFAULT_LAYOUT);
    const r = s.run("create_view", {
      title: "Unpaid over $500",
      source: "invoices",
      filters: [
        { field: "status", op: "neq", value: "paid" },
        { field: "amount", op: "gt", value: "500" },
      ],
      sort_field: "days_overdue",
      sort_dir: "desc",
      group_by: "",
      display: "table",
      columns: ["customer", "id", "amount", "days_overdue"],
      actions: ["send_reminder"],
      limit: 0,
      region: "main",
      position: 0,
      size: "lg",
    });
    expect(r.isError).toBe(false);
    s.run("set_visibility", { id: "payroll_promo", visible: false });
    const bad = s.run("set_visibility", { id: "create_invoice", visible: false });
    expect(bad.isError).toBe(true);

    expect(s.ops.map((o) => o.type)).toEqual(["create_view", "set_visibility"]);
    // Saved changes replay to exactly what the AI built.
    expect(replay([s.ops]).layout).toEqual(s.layout);
    expect(s.layout.views["view-1"].limit).toBeNull();
    expect(s.layout.views["view-1"].sort).toEqual({ field: "days_overdue", dir: "desc" });
  });

  it("reset drops earlier changes", () => {
    const s = new LayoutSession(replay([[{ type: "set_visibility", id: "news", visible: false }]]).layout);
    s.run("reset_layout", {});
    s.run("set_page_option", { option: "textSize", value: "large" });
    const res = s.result("ok");
    expect(res.reset).toBe(true);
    expect(res.ops).toHaveLength(1);
  });
});
