// Provider-neutral pieces shared by every LLM strategy: the system prompt, the layout tools
// (as plain JSON Schema), and the code that turns each tool call into a validated change.

import { REGISTRY, SIZES, SOURCES, type User } from "../../shared/registry.ts";
import {
  CONSTRAINTS,
  DEFAULT_LAYOUT,
  MAX_VIEWS,
  PAGE_OPTION_VALUES,
  applyOp,
  clone,
  describeOp,
  nextViewId,
  type Layout,
  type Op,
} from "../../shared/layout.ts";
import { DISPLAYS, FILTER_OPS, type ViewSpec } from "../../shared/views.ts";
import type { ChatTurn } from "./types.ts";

export const MAX_ROUNDS = 8;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema, strict-compatible (all required, no extra props)
}

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const slotId = { type: "string", description: "A component id or a custom view id (e.g. view-1)." };

const viewSpecProps = {
  title: { type: "string", description: "Short title shown on the view, e.g. 'Unpaid over $500'." },
  source: { type: "string", enum: Object.keys(SOURCES) },
  filters: {
    type: "array",
    description: "All must match. Values are strings: numbers as '500', dates as 'YYYY-MM-DD', enums as one of their options.",
    items: obj({
      field: { type: "string" },
      op: { type: "string", enum: [...FILTER_OPS] },
      value: { type: "string" },
    }),
  },
  sort_field: { type: "string", description: "Field to sort by, or '' for none." },
  sort_dir: { type: "string", enum: ["asc", "desc"] },
  group_by: { type: "string", description: "Field to group board columns by, or '' for none. Required for display 'board'." },
  display: { type: "string", enum: [...DISPLAYS] },
  columns: { type: "array", items: { type: "string" }, description: "Fields to show, in order." },
  actions: { type: "array", items: { type: "string" }, description: "Source actions to offer on each row (may be empty)." },
  limit: { type: "integer", description: "Max rows to show, or 0 for no limit." },
};

export const TOOLS: ToolDef[] = [
  {
    name: "move_component",
    description: "Move a component or view to a region at a 0-based position (-1 = end). Others shift to make room.",
    parameters: obj({ id: slotId, region: { type: "string", enum: ["header", "main", "sidebar"] }, position: { type: "integer" } }),
  },
  {
    name: "set_visibility",
    description: "Show or hide a component or view. Hidden items stay listed so the user can bring them back.",
    parameters: obj({ id: slotId, visible: { type: "boolean" } }),
  },
  {
    name: "set_size",
    description: "Width in the main region: sm = one third, md = half, lg = full row. No effect elsewhere.",
    parameters: obj({ id: slotId, size: { type: "string", enum: [...SIZES] } }),
  },
  {
    name: "set_collapsed",
    description: "Collapse a component or view to its title bar, or expand it.",
    parameters: obj({ id: slotId, collapsed: { type: "boolean" } }),
  },
  {
    name: "set_page_option",
    description: `Change a page-wide display option. Options: ${Object.entries(PAGE_OPTION_VALUES)
      .map(([k, v]) => `${k} (${v.join(" | ")})`)
      .join(", ")}. "calm" is a softer, low-contrast palette.`,
    parameters: obj({ option: { type: "string", enum: Object.keys(PAGE_OPTION_VALUES) }, value: { type: "string" } }),
  },
  {
    name: "create_view",
    description: `Add a live view: a filtered, sorted list of one data source, drawn as a table, board (columns grouped by a field), cards or list. It updates as data changes. Max ${MAX_VIEWS} views.`,
    parameters: obj({
      ...viewSpecProps,
      region: { type: "string", enum: ["main", "sidebar"] },
      position: { type: "integer", description: "0-based position in the region; -1 = end" },
      size: { type: "string", enum: [...SIZES] },
    }),
  },
  {
    name: "update_view",
    description: "Replace an existing custom view's settings (pass the full spec, not just the changes).",
    parameters: obj({ id: { type: "string" }, ...viewSpecProps }),
  },
  {
    name: "remove_view",
    description: "Delete a custom view. Company components can't be removed, only hidden.",
    parameters: obj({ id: { type: "string" } }),
  },
  {
    name: "reset_layout",
    description: "Throw away all of this user's changes and restore the company's default layout.",
    parameters: obj({}),
  },
];

export function systemPrompt(user: User): string {
  return `You are Morph, a layout assistant embedded in Ledgerly, an invoicing app. The user asks you to change how their dashboard looks, and you do it by calling the layout tools.

The user is ${user.name} (${user.role}).${user.repName ? " They only see their own customers; the server enforces that, so you don't need filters for it." : ""} Today is ${new Date().toISOString().slice(0, 10)}.

What you can change: where components sit (header / main / sidebar, and order), shown/hidden/collapsed, width in the main region, page options (sidebar side, density, theme, text size), and custom live views built from the data sources below.
What you cannot change: what components or buttons do, the underlying data, or anything on the server. Views can only show, filter, sort and group fields that exist, and offer the source's own actions. If the user asks for something else (new features, editing data, sending emails), say briefly that you can only change how the page looks and what it shows, and offer the closest thing you can do.

Components (id: name; importance; allowed regions; description):
${Object.values(REGISTRY)
  .map((c) => `- ${c.id}: ${c.name}; ${c.importance}; ${c.allowedRegions.join("/")}; ${c.description}`)
  .join("\n")}

Data sources for views:
${Object.values(SOURCES)
  .map(
    (s) =>
      `- ${s.id}: ${s.description}\n  fields: ${s.fields.map((f) => `${f.id} (${f.type}${f.options ? `: ${f.options.join("/")}` : ""})`).join(", ")}\n  actions: ${s.actions.map((a) => `${a.id} (${a.description})`).join(", ") || "none"}`,
  )
  .join("\n")}

Company rules (the tools reject changes that break them):
- Always visible and expanded: ${CONSTRAINTS.mustBeVisible.map((id) => REGISTRY[id].name).join(", ")}.
- Pinned: ${Object.entries(CONSTRAINTS.pinned)
  .map(([id, p]) => `${REGISTRY[id as keyof typeof REGISTRY].name} at ${p!.region} position ${p!.position}`)
  .join(", ")}.
- At most ${MAX_VIEWS} custom views.

How to work:
- The current layout (including existing views under "views") is given as JSON with each request. Positions are 0-based within a region; the main region flows left-to-right in rows, so order there is reading order.
- Make the smallest set of changes that does what the user asked. For vague requests ("simpler", "calmer") use importance to decide, and prefer collapsing over hiding when unsure.
- Use a view when the user wants to see a subset or a different arrangement of data ("unpaid invoices over $500", "my customers by balance", "invoices as a board by status"). Put new views where the user will see them first unless they say otherwise. "Unpaid" means status neq paid. Offer row actions when they fit (e.g. send_reminder on unpaid invoices).
- To change an existing view, use update_view with its id rather than adding a second one.
- If a tool returns an error, adjust and try again, or explain the rule to the user if what they asked for isn't allowed.
- When you're done, reply with one or two short sentences saying what you changed. No lists, no JSON.`;
}

/** Prior chat turns as plain text (so "move it back" makes sense). Always starts with a user turn. */
export function cleanHistory(history: ChatTurn[]): ChatTurn[] {
  const h = history.slice(-10).filter((m) => m.text?.trim());
  while (h[0]?.role === "assistant") h.shift();
  return h;
}

export const userPrompt = (layout: Layout, message: string) => `Current layout:\n${JSON.stringify(layout)}\n\nRequest: ${message}`;
export const layoutNote = (layout: Layout) => `Layout now:\n${JSON.stringify(layout)}`;

type ViewInput = {
  title: string;
  source: string;
  filters: ViewSpec["filters"];
  sort_field: string;
  sort_dir: "asc" | "desc";
  group_by: string;
  display: ViewSpec["display"];
  columns: string[];
  actions: string[];
  limit: number;
};

function toSpec(id: string, i: ViewInput): ViewSpec {
  return {
    id,
    title: String(i.title ?? "").trim(),
    source: i.source,
    filters: (i.filters ?? []).map((f) => ({ field: f.field, op: f.op, value: String(f.value) })),
    sort: i.sort_field ? { field: i.sort_field, dir: i.sort_dir === "desc" ? "desc" : "asc" } : null,
    groupBy: i.group_by || null,
    display: i.display,
    columns: i.columns ?? [],
    actions: i.actions ?? [],
    limit: i.limit && i.limit > 0 ? i.limit : null,
  };
}

/** Turns a tool call into a change. View ids are assigned here so saved changes replay identically. */
export function toOp(name: string, input: Record<string, unknown>, layout: Layout): Op {
  switch (name) {
    case "create_view": {
      const i = input as ViewInput & { region: "main" | "sidebar"; position: number; size: "sm" | "md" | "lg" };
      return { type: "create_view", view: toSpec(nextViewId(layout), i), region: i.region, position: i.position, size: i.size ?? "lg" };
    }
    case "update_view":
      return { type: "update_view", view: toSpec(String(input.id), input as unknown as ViewInput) };
    default:
      return { type: name, ...input } as Op;
  }
}

/** Tracks the working layout across tool calls. Every change goes through applyOp, which validates. */
export class LayoutSession {
  applied: string[] = [];
  rejected: string[] = [];
  ops: Op[] = [];
  reset = false;
  constructor(public layout: Layout) {}

  /** Runs one tool call. Returns the text to send back to the model, and whether it was an error. */
  run(name: string, input: unknown): { content: string; isError: boolean } {
    if (!TOOLS.some((t) => t.name === name)) return { content: `Rejected: unknown tool "${name}".`, isError: true };
    if (name === "reset_layout") {
      this.layout = clone(DEFAULT_LAYOUT);
      this.ops = [];
      this.reset = true;
      this.applied.push("Reset to the default layout");
      return { content: "OK", isError: false };
    }
    const op = toOp(name, (input ?? {}) as Record<string, unknown>, this.layout);
    try {
      const next = applyOp(this.layout, op);
      this.applied.push(describeOp(op, op.type === "remove_view" ? this.layout : next));
      this.layout = next;
      this.ops.push(op);
      return { content: op.type === "create_view" ? `OK, created ${op.view.id}` : "OK", isError: false };
    } catch (e) {
      const msg = (e as Error).message;
      this.rejected.push(`${describeOp(op, this.layout)}: ${msg}`);
      return { content: `Rejected: ${msg}`, isError: true };
    }
  }

  result(explanation: string) {
    return { layout: this.layout, ops: this.ops, reset: this.reset, explanation, applied: this.applied, rejected: this.rejected };
  }
}
