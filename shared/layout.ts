// Layout-as-data: the only thing the AI is allowed to change.
// A user's saved layout is a list of change batches replayed on top of the company's default,
// so the company can update its default without breaking anyone's layout.

import { COMPONENT_IDS, REGIONS, REGISTRY, SIZES, type ComponentId, type Region, type Size } from "./registry.ts";
import { validateView, type ViewSpec } from "./views.ts";

export interface Slot {
  id: string; // a component id, or a view id ("view-1")
  visible: boolean;
  size: Size; // main region: sm = 1/3 width, md = 1/2, lg = full row. Ignored elsewhere.
  collapsed: boolean;
}

export interface PageOptions {
  sidebarPosition: "left" | "right";
  density: "comfortable" | "compact";
  theme: "light" | "dark" | "calm";
  textSize: "normal" | "large";
}

export interface Layout {
  regions: Record<Region, Slot[]>;
  page: PageOptions;
  views: Record<string, ViewSpec>;
}

export const PAGE_OPTION_VALUES: { [K in keyof PageOptions]: readonly PageOptions[K][] } = {
  sidebarPosition: ["left", "right"],
  density: ["comfortable", "compact"],
  theme: ["light", "dark", "calm"],
  textSize: ["normal", "large"],
};

export const MAX_VIEWS = 4;

const slot = (id: string, size: Size = "md"): Slot => ({ id, visible: true, size, collapsed: false });

export const DEFAULT_LAYOUT: Layout = {
  regions: {
    header: [slot("nav"), slot("create_invoice")],
    main: [slot("payroll_promo", "lg"), slot("stats", "lg"), slot("revenue_chart", "md"), slot("news", "md"), slot("invoices", "lg")],
    sidebar: [slot("customers"), slot("visits"), slot("activity")],
  },
  page: { sidebarPosition: "right", density: "comfortable", theme: "light", textSize: "normal" },
  views: {},
};

// Company rules. Enforced in code, not in the prompt.
export interface Constraints {
  mustBeVisible: ComponentId[]; // cannot be hidden or collapsed
  cannotHide: ComponentId[]; // cannot be hidden, but may be collapsed or moved
  pinned: Partial<Record<ComponentId, { region: Region; position: number }>>;
}

export const CONSTRAINTS: Constraints = {
  mustBeVisible: ["nav", "create_invoice"],
  cannotHide: [],
  pinned: { nav: { region: "header", position: 0 } },
};

export const clone = <T>(x: T): T => structuredClone(x);
export const isComponent = (id: string): id is ComponentId => (COMPONENT_IDS as readonly string[]).includes(id);

/** Display name for any slot. */
export const slotName = (layout: Layout, id: string) => (isComponent(id) ? REGISTRY[id].name : layout.views[id]?.title ?? id);

export function findSlot(layout: Layout, id: string): { region: Region; index: number; slot: Slot } | null {
  for (const region of REGIONS) {
    const index = layout.regions[region].findIndex((s) => s.id === id);
    if (index >= 0) return { region, index, slot: layout.regions[region][index] };
  }
  return null;
}

/** Returns a list of human-readable problems; empty means valid. */
export function validateLayout(layout: Layout, constraints: Constraints = CONSTRAINTS): string[] {
  const errors: string[] = [];
  if (!layout || typeof layout !== "object" || !layout.regions) return ["Layout is missing `regions`."];
  const views = layout.views ?? {};

  const seen = new Set<string>();
  for (const region of REGIONS) {
    const slots = layout.regions[region];
    if (!Array.isArray(slots)) {
      errors.push(`Region "${region}" is missing.`);
      continue;
    }
    for (const s of slots) {
      if (seen.has(s.id)) errors.push(`"${s.id}" appears more than once.`);
      seen.add(s.id);
      if (isComponent(s.id)) {
        if (!REGISTRY[s.id].allowedRegions.includes(region))
          errors.push(`"${s.id}" can't be placed in ${region} (allowed: ${REGISTRY[s.id].allowedRegions.join(", ")}).`);
      } else if (views[s.id]) {
        if (region === "header") errors.push(`Views can't go in the header.`);
      } else {
        errors.push(`Unknown component or view "${s.id}" in ${region}.`);
        continue;
      }
      if (!SIZES.includes(s.size)) errors.push(`"${s.id}" has invalid size "${s.size}".`);
      if (typeof s.visible !== "boolean" || typeof s.collapsed !== "boolean") errors.push(`"${s.id}" needs boolean visible/collapsed.`);
    }
  }
  for (const id of COMPONENT_IDS) if (!seen.has(id)) errors.push(`Component "${id}" is missing from the layout.`);

  const viewIds = Object.keys(views);
  if (viewIds.length > MAX_VIEWS) errors.push(`At most ${MAX_VIEWS} custom views; remove one first.`);
  for (const id of viewIds) {
    if (!seen.has(id)) errors.push(`View "${id}" isn't placed on the page.`);
    if (views[id].id !== id) errors.push(`View "${id}" has a mismatched id.`);
    errors.push(...validateView(views[id]).map((e) => `View "${views[id].title}": ${e}`));
  }

  for (const key of Object.keys(PAGE_OPTION_VALUES) as (keyof PageOptions)[]) {
    if (!(PAGE_OPTION_VALUES[key] as readonly string[]).includes(layout.page?.[key] as string))
      errors.push(`Page option ${key} has invalid value "${layout.page?.[key]}".`);
  }

  for (const id of constraints.mustBeVisible) {
    const f = findSlot(layout, id);
    if (f && (!f.slot.visible || f.slot.collapsed)) errors.push(`Rule: "${REGISTRY[id].name}" must always be visible and expanded.`);
  }
  for (const id of constraints.cannotHide) {
    const f = findSlot(layout, id);
    if (f && !f.slot.visible) errors.push(`Rule: "${REGISTRY[id].name}" cannot be hidden (it may be collapsed or moved).`);
  }
  for (const [id, pin] of Object.entries(constraints.pinned)) {
    const f = findSlot(layout, id);
    if (f && (f.region !== pin!.region || f.index !== pin!.position))
      errors.push(`Rule: "${REGISTRY[id as ComponentId].name}" is pinned to position ${pin!.position} of ${pin!.region}.`);
  }
  return errors;
}

// ---- Operations (what the AI, and the user's own clicks, can do) ----

export type Op =
  | { type: "move_component"; id: string; region: Region; position: number }
  | { type: "set_visibility"; id: string; visible: boolean }
  | { type: "set_size"; id: string; size: Size }
  | { type: "set_collapsed"; id: string; collapsed: boolean }
  | { type: "set_page_option"; option: keyof PageOptions; value: string }
  | { type: "create_view"; view: ViewSpec; region: Region; position: number; size: Size }
  | { type: "update_view"; view: ViewSpec }
  | { type: "remove_view"; id: string };

function insertAt(list: Slot[], position: number, s: Slot) {
  const pos = position < 0 || position > list.length ? list.length : Math.floor(position);
  list.splice(pos, 0, s);
}

/** Applies one op to a copy of the layout. Throws a readable Error if the op is malformed or breaks a rule. */
export function applyOp(layout: Layout, op: Op, constraints: Constraints = CONSTRAINTS): Layout {
  const next = clone(layout);
  next.views ??= {};

  switch (op.type) {
    case "set_page_option": {
      const allowed = PAGE_OPTION_VALUES[op.option] as readonly string[] | undefined;
      if (!allowed) throw new Error(`Unknown page option "${op.option}".`);
      if (!allowed.includes(op.value)) throw new Error(`"${op.value}" is not valid for ${op.option} (use ${allowed.join(" or ")}).`);
      (next.page as unknown as Record<string, string>)[op.option] = op.value;
      break;
    }
    case "create_view": {
      if (next.views[op.view.id] || findSlot(next, op.view.id)) throw new Error(`A view called "${op.view.id}" already exists.`);
      if (!REGIONS.includes(op.region)) throw new Error(`Unknown region "${op.region}".`);
      next.views[op.view.id] = op.view;
      insertAt(next.regions[op.region], op.position, slot(op.view.id, op.size));
      break;
    }
    case "update_view": {
      if (!next.views[op.view.id]) throw new Error(`No view "${op.view.id}". Existing views: ${Object.keys(next.views).join(", ") || "none"}.`);
      next.views[op.view.id] = op.view;
      break;
    }
    case "remove_view": {
      if (!next.views[op.id]) throw new Error(`No view "${op.id}". Only custom views can be removed; hide components instead.`);
      delete next.views[op.id];
      const f = findSlot(next, op.id)!;
      next.regions[f.region].splice(f.index, 1);
      break;
    }
    default: {
      const found = findSlot(next, op.id);
      if (!found) throw new Error(`Unknown component or view "${op.id}". Valid ids: ${[...COMPONENT_IDS, ...Object.keys(next.views)].join(", ")}.`);
      switch (op.type) {
        case "move_component":
          if (!REGIONS.includes(op.region)) throw new Error(`Unknown region "${op.region}".`);
          next.regions[found.region].splice(found.index, 1);
          insertAt(next.regions[op.region], op.position, found.slot);
          break;
        case "set_visibility":
          found.slot.visible = op.visible;
          break;
        case "set_size":
          if (!SIZES.includes(op.size)) throw new Error(`Size must be one of ${SIZES.join(", ")}.`);
          found.slot.size = op.size;
          break;
        case "set_collapsed":
          found.slot.collapsed = op.collapsed;
          break;
      }
    }
  }

  const errors = validateLayout(next, constraints);
  if (errors.length) throw new Error(errors.join(" "));
  return next;
}

/** One saved change batch per request (or per click). */
export type Batch = Op[];

/**
 * Rebuilds a user's layout: the company's current default plus their saved changes, in order.
 * Changes that no longer apply (a part was removed, a rule changed) are skipped, not fatal.
 */
export function replay(batches: Batch[], base: Layout = DEFAULT_LAYOUT): { layout: Layout; skipped: number } {
  let layout = clone(base);
  let skipped = 0;
  for (const batch of batches)
    for (const op of batch) {
      try {
        layout = applyOp(layout, op);
      } catch {
        skipped++;
      }
    }
  return { layout, skipped };
}

/** Next free view id, e.g. "view-3". */
export function nextViewId(layout: Layout): string {
  let n = 1;
  while (layout.views?.[`view-${n}`] || findSlot(layout, `view-${n}`)) n++;
  return `view-${n}`;
}

/** Short human-readable description of a change, for the chat log. */
export function describeOp(op: Op, layout?: Layout): string {
  const name = (id: string) => (layout ? slotName(layout, id) : isComponent(id) ? REGISTRY[id].name : id);
  switch (op.type) {
    case "move_component":
      return `Moved ${name(op.id)} to ${op.region} #${op.position < 0 ? "end" : op.position + 1}`;
    case "set_visibility":
      return `${op.visible ? "Showed" : "Hid"} ${name(op.id)}`;
    case "set_size":
      return `Resized ${name(op.id)} to ${op.size}`;
    case "set_collapsed":
      return `${op.collapsed ? "Collapsed" : "Expanded"} ${name(op.id)}`;
    case "set_page_option":
      return `Set ${op.option} to ${op.value}`;
    case "create_view":
      return `Added view "${op.view.title}" (${op.view.display})`;
    case "update_view":
      return `Updated view "${op.view.title}"`;
    case "remove_view":
      return `Removed view ${name(op.id)}`;
  }
}
