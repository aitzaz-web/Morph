import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, applyOp, clone, findSlot, replay, validateLayout, type Layout, type Op } from "./layout.ts";
import { boardGroups, runQuery, validateView, type ViewSpec } from "./views.ts";

const unpaidOver500: ViewSpec = {
  id: "view-1",
  title: "Unpaid over $500",
  source: "invoices",
  filters: [
    { field: "status", op: "neq", value: "paid" },
    { field: "amount", op: "gt", value: "500" },
  ],
  sort: { field: "days_overdue", dir: "desc" },
  groupBy: null,
  display: "table",
  columns: ["customer", "id", "amount", "days_overdue"],
  actions: ["send_reminder"],
  limit: null,
};

const addView: Op = { type: "create_view", view: unpaidOver500, region: "main", position: 0, size: "lg" };

describe("validateLayout", () => {
  it("accepts the default layout", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual([]);
  });

  it("flags missing and duplicate components", () => {
    const bad = clone(DEFAULT_LAYOUT);
    bad.regions.sidebar = bad.regions.sidebar.filter((s) => s.id !== "activity");
    bad.regions.main.push({ ...bad.regions.main[0] });
    const errors = validateLayout(bad).join(" ");
    expect(errors).toMatch(/activity.*missing/);
    expect(errors).toMatch(/more than once/);
  });

  it("flags a placed view with no spec", () => {
    const bad = clone(DEFAULT_LAYOUT);
    bad.regions.main.push({ id: "view-9", visible: true, size: "md", collapsed: false });
    expect(validateLayout(bad).join(" ")).toMatch(/Unknown component or view "view-9"/);
  });
});

describe("applyOp", () => {
  it("moves invoices to the top of main without touching the input", () => {
    const next = applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "invoices", region: "main", position: 0 });
    expect(next.regions.main[0].id).toBe("invoices");
    expect(DEFAULT_LAYOUT.regions.main[0].id).toBe("payroll_promo");
  });

  it("refuses to hide or collapse the create invoice button", () => {
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_visibility", id: "create_invoice", visible: false })).toThrow(/must always be visible/);
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_collapsed", id: "create_invoice", collapsed: true })).toThrow(/must always be visible/);
  });

  it("keeps nav pinned and enforces allowed regions", () => {
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "create_invoice", region: "header", position: 0 })).toThrow(/pinned/);
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "invoices", region: "header", position: 1 })).toThrow(/can't be placed/);
  });

  it("validates page options", () => {
    expect(applyOp(DEFAULT_LAYOUT, { type: "set_page_option", option: "theme", value: "calm" }).page.theme).toBe("calm");
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_page_option", option: "theme", value: "purple" })).toThrow(/not valid/);
  });

  it("adds, updates and removes a view", () => {
    let l = applyOp(DEFAULT_LAYOUT, addView);
    expect(l.regions.main[0].id).toBe("view-1");
    expect(l.views["view-1"].title).toBe("Unpaid over $500");
    l = applyOp(l, { type: "update_view", view: { ...unpaidOver500, display: "cards" } });
    expect(l.views["view-1"].display).toBe("cards");
    l = applyOp(l, { type: "remove_view", id: "view-1" });
    expect(findSlot(l, "view-1")).toBeNull();
    expect(l.views).toEqual({});
  });

  it("rejects views over unknown fields, actions or sources", () => {
    const bad = (patch: Partial<ViewSpec>) => applyOp(DEFAULT_LAYOUT, { ...addView, view: { ...unpaidOver500, ...patch } } as Op);
    expect(() => bad({ columns: ["customer", "ssn"] })).toThrow(/Unknown field "ssn"/);
    expect(() => bad({ actions: ["delete_invoice"] })).toThrow(/isn't an action/);
    expect(() => bad({ source: "payroll" })).toThrow(/Unknown data source/);
    expect(() => bad({ display: "board", groupBy: null })).toThrow(/board needs/);
    expect(() => bad({ filters: [{ field: "amount", op: "gt", value: "lots" }] })).toThrow(/needs a number/);
  });

  it("caps the number of views", () => {
    let l: Layout = DEFAULT_LAYOUT;
    for (let i = 1; i <= 4; i++) l = applyOp(l, { ...addView, view: { ...unpaidOver500, id: `view-${i}` } } as Op);
    expect(() => applyOp(l, { ...addView, view: { ...unpaidOver500, id: "view-5" } } as Op)).toThrow(/At most 4/);
  });
});

describe("replay", () => {
  it("rebuilds a layout from saved batches", () => {
    const { layout, skipped } = replay([[addView], [{ type: "set_visibility", id: "news", visible: false }]]);
    expect(skipped).toBe(0);
    expect(layout.regions.main[0].id).toBe("view-1");
    expect(findSlot(layout, "news")!.slot.visible).toBe(false);
  });

  it("skips changes that no longer apply instead of failing", () => {
    const { layout, skipped } = replay([[{ type: "set_visibility", id: "old_widget", visible: false }], [addView]]);
    expect(skipped).toBe(1);
    expect(layout.views["view-1"]).toBeDefined();
  });

  it("picks up a new default from the company", () => {
    const newDefault = clone(DEFAULT_LAYOUT);
    newDefault.page.density = "compact";
    expect(replay([[addView]], newDefault).layout.page.density).toBe("compact");
  });
});

describe("views", () => {
  const rows = [
    { id: "A", customer: "Acme", amount: 900, status: "overdue", days_overdue: 20 },
    { id: "B", customer: "Beta", amount: 300, status: "overdue", days_overdue: 30 },
    { id: "C", customer: "Cove", amount: 1200, status: "open", days_overdue: 0 },
    { id: "D", customer: "Dune", amount: 5000, status: "paid", days_overdue: 0 },
  ];

  it("filters and sorts", () => {
    const r = runQuery(rows, unpaidOver500);
    expect(r.rows.map((x) => x.id)).toEqual(["A", "C"]);
    expect(r.total).toBe(2);
  });

  it("limits but reports the full count", () => {
    const r = runQuery(rows, { ...unpaidOver500, filters: [], sort: { field: "amount", dir: "desc" }, limit: 2 });
    expect(r.rows.map((x) => x.id)).toEqual(["D", "C"]);
    expect(r.total).toBe(4);
  });

  it("groups a board in the field's natural order", () => {
    const groups = boardGroups(rows, { ...unpaidOver500, display: "board", groupBy: "status" });
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([["overdue", 2], ["open", 1], ["paid", 1]]);
  });

  it("accepts a valid spec", () => {
    expect(validateView(unpaidOver500)).toEqual([]);
  });
});
