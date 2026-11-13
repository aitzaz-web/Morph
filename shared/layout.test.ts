import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, applyOp, findSlot, validateLayout } from "./layout.ts";

describe("validateLayout", () => {
  it("accepts the default layout", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual([]);
  });

  it("flags missing and duplicate components", () => {
    const bad = structuredClone(DEFAULT_LAYOUT);
    bad.regions.sidebar = bad.regions.sidebar.filter((s) => s.id !== "support");
    bad.regions.main.push({ ...bad.regions.main[0] });
    const errors = validateLayout(bad).join(" ");
    expect(errors).toMatch(/support.*missing/);
    expect(errors).toMatch(/more than once/);
  });
});

describe("applyOp", () => {
  it("moves orders to the top of main", () => {
    const next = applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "orders", region: "main", position: 0 });
    expect(next.regions.main[0].id).toBe("orders");
    expect(DEFAULT_LAYOUT.regions.main[0].id).toBe("promos"); // input untouched
  });

  it("appends with position -1", () => {
    const next = applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "cart", region: "main", position: -1 });
    expect(next.regions.main.at(-1)!.id).toBe("cart");
    expect(findSlot(next, "cart")!.region).toBe("main");
  });

  it("hides recommendations", () => {
    const next = applyOp(DEFAULT_LAYOUT, { type: "set_visibility", id: "recommendations", visible: false });
    expect(findSlot(next, "recommendations")!.slot.visible).toBe(false);
  });

  it("refuses to hide or collapse checkout", () => {
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_visibility", id: "cart", visible: false })).toThrow(/must always be visible/);
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_collapsed", id: "cart", collapsed: true })).toThrow(/must always be visible/);
  });

  it("lets promos collapse but not hide", () => {
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_visibility", id: "promos", visible: false })).toThrow(/cannot be hidden/);
    expect(findSlot(applyOp(DEFAULT_LAYOUT, { type: "set_collapsed", id: "promos", collapsed: true }), "promos")!.slot.collapsed).toBe(true);
  });

  it("keeps nav pinned and enforces allowed regions", () => {
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "search", region: "header", position: 0 })).toThrow(/pinned/);
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "move_component", id: "orders", region: "header", position: 1 })).toThrow(/can't be placed/);
  });

  it("validates page options", () => {
    expect(applyOp(DEFAULT_LAYOUT, { type: "set_page_option", option: "theme", value: "dark" }).page.theme).toBe("dark");
    expect(() => applyOp(DEFAULT_LAYOUT, { type: "set_page_option", option: "theme", value: "purple" })).toThrow(/not valid/);
  });
});
