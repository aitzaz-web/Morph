// Layout-as-data: the only thing the AI is allowed to change.

import { COMPONENT_IDS, REGIONS, REGISTRY, SIZES, type ComponentId, type Region, type Size } from "./registry.ts";

export interface Slot {
  id: ComponentId;
  visible: boolean;
  size: Size; // main region: sm = 1/3 width, md = 1/2, lg = full row. Ignored elsewhere.
  collapsed: boolean;
}

export interface PageOptions {
  sidebarPosition: "left" | "right";
  density: "comfortable" | "compact";
  theme: "light" | "dark";
}

export interface Layout {
  regions: Record<Region, Slot[]>;
  page: PageOptions;
}

export const PAGE_OPTION_VALUES: { [K in keyof PageOptions]: readonly PageOptions[K][] } = {
  sidebarPosition: ["left", "right"],
  density: ["comfortable", "compact"],
  theme: ["light", "dark"],
};

const slot = (id: ComponentId, size: Size = "md"): Slot => ({ id, visible: true, size, collapsed: false });

export const DEFAULT_LAYOUT: Layout = {
  regions: {
    header: [slot("nav"), slot("search")],
    main: [slot("promos", "lg"), slot("recommendations", "lg"), slot("orders", "md"), slot("notifications", "md")],
    sidebar: [slot("cart"), slot("profile"), slot("support")],
  },
  page: { sidebarPosition: "right", density: "comfortable", theme: "light" },
};

// Company rules. Enforced in code, not in the prompt.
export interface Constraints {
  mustBeVisible: ComponentId[]; // cannot be hidden or collapsed
  cannotHide: ComponentId[]; // cannot be hidden, but may be collapsed or moved
  pinned: Partial<Record<ComponentId, { region: Region; position: number }>>;
}

export const CONSTRAINTS: Constraints = {
  mustBeVisible: ["cart", "nav"],
  cannotHide: ["promos"],
  pinned: { nav: { region: "header", position: 0 } },
};

export const clone = <T>(x: T): T => structuredClone(x);

export function findSlot(layout: Layout, id: ComponentId): { region: Region; index: number; slot: Slot } | null {
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

  const seen = new Set<string>();
  for (const region of REGIONS) {
    const slots = layout.regions[region];
    if (!Array.isArray(slots)) {
      errors.push(`Region "${region}" is missing.`);
      continue;
    }
    for (const s of slots) {
      if (!COMPONENT_IDS.includes(s.id)) {
        errors.push(`Unknown component "${s.id}" in ${region}.`);
        continue;
      }
      if (seen.has(s.id)) errors.push(`Component "${s.id}" appears more than once.`);
      seen.add(s.id);
      if (!REGISTRY[s.id].allowedRegions.includes(region))
        errors.push(`"${s.id}" can't be placed in ${region} (allowed: ${REGISTRY[s.id].allowedRegions.join(", ")}).`);
      if (!SIZES.includes(s.size)) errors.push(`"${s.id}" has invalid size "${s.size}".`);
      if (typeof s.visible !== "boolean" || typeof s.collapsed !== "boolean")
        errors.push(`"${s.id}" needs boolean visible/collapsed.`);
    }
  }
  for (const id of COMPONENT_IDS) if (!seen.has(id)) errors.push(`Component "${id}" is missing from the layout.`);

  for (const key of Object.keys(PAGE_OPTION_VALUES) as (keyof PageOptions)[]) {
    if (!(PAGE_OPTION_VALUES[key] as readonly string[]).includes(layout.page?.[key] as string))
      errors.push(`Page option ${key} has invalid value "${layout.page?.[key]}".`);
  }

  for (const id of constraints.mustBeVisible) {
    const f = findSlot(layout, id);
    if (f && (!f.slot.visible || f.slot.collapsed))
      errors.push(`Rule: "${REGISTRY[id].name}" must always be visible and expanded.`);
  }
  for (const id of constraints.cannotHide) {
    const f = findSlot(layout, id);
    if (f && !f.slot.visible) errors.push(`Rule: "${REGISTRY[id].name}" cannot be hidden (it may be collapsed or moved).`);
  }
  for (const [id, pin] of Object.entries(constraints.pinned)) {
    const f = findSlot(layout, id as ComponentId);
    if (f && (f.region !== pin!.region || f.index !== pin!.position))
      errors.push(`Rule: "${REGISTRY[id as ComponentId].name}" is pinned to position ${pin!.position} of ${pin!.region}.`);
  }
  return errors;
}

// ---- Operations the AI can perform ----

export type Op =
  | { type: "move_component"; id: ComponentId; region: Region; position: number }
  | { type: "set_visibility"; id: ComponentId; visible: boolean }
  | { type: "set_size"; id: ComponentId; size: Size }
  | { type: "set_collapsed"; id: ComponentId; collapsed: boolean }
  | { type: "set_page_option"; option: keyof PageOptions; value: string }
  | { type: "reset_layout" };

/** Applies one op to a copy of the layout. Throws a readable Error if the op is malformed or breaks a rule. */
export function applyOp(layout: Layout, op: Op, constraints: Constraints = CONSTRAINTS): Layout {
  const next = clone(layout);
  if (op.type === "reset_layout") return clone(DEFAULT_LAYOUT);

  if (op.type === "set_page_option") {
    const allowed = PAGE_OPTION_VALUES[op.option] as readonly string[] | undefined;
    if (!allowed) throw new Error(`Unknown page option "${op.option}".`);
    if (!allowed.includes(op.value)) throw new Error(`"${op.value}" is not valid for ${op.option} (use ${allowed.join(" or ")}).`);
    (next.page as unknown as Record<string, string>)[op.option] = op.value;
  } else {
    const found = findSlot(next, op.id);
    if (!found) throw new Error(`Unknown component "${op.id}". Valid ids: ${COMPONENT_IDS.join(", ")}.`);
    switch (op.type) {
      case "move_component": {
        if (!REGIONS.includes(op.region)) throw new Error(`Unknown region "${op.region}".`);
        next.regions[found.region].splice(found.index, 1);
        const target = next.regions[op.region];
        const pos = op.position < 0 || op.position > target.length ? target.length : Math.floor(op.position);
        target.splice(pos, 0, found.slot);
        break;
      }
      case "set_visibility":
        found.slot.visible = op.visible;
        break;
      case "set_size":
        found.slot.size = op.size;
        break;
      case "set_collapsed":
        found.slot.collapsed = op.collapsed;
        break;
    }
  }

  const errors = validateLayout(next, constraints);
  if (errors.length) throw new Error(errors.join(" "));
  return next;
}

/** Short human-readable description of a layout change, for the chat log. */
export function describeOp(op: Op): string {
  switch (op.type) {
    case "move_component":
      return `Moved ${REGISTRY[op.id]?.name ?? op.id} to ${op.region} #${op.position < 0 ? "end" : op.position + 1}`;
    case "set_visibility":
      return `${op.visible ? "Showed" : "Hid"} ${REGISTRY[op.id]?.name ?? op.id}`;
    case "set_size":
      return `Resized ${REGISTRY[op.id]?.name ?? op.id} to ${op.size}`;
    case "set_collapsed":
      return `${op.collapsed ? "Collapsed" : "Expanded"} ${REGISTRY[op.id]?.name ?? op.id}`;
    case "set_page_option":
      return `Set ${op.option} to ${op.value}`;
    case "reset_layout":
      return "Reset to the default layout";
  }
}
