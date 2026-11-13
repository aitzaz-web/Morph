// Provider-neutral pieces shared by every LLM strategy: the system prompt, the layout tools
// (as plain JSON Schema), and the code that applies + validates each tool call.

import { COMPONENT_IDS, REGIONS, REGISTRY, SIZES } from "../../shared/registry.ts";
import { CONSTRAINTS, PAGE_OPTION_VALUES, applyOp, describeOp, type Layout, type Op } from "../../shared/layout.ts";
import type { ChatTurn } from "./types.ts";

export const MAX_ROUNDS = 8;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema, strict-compatible (all required, no extra props)
}

const idEnum = { type: "string", enum: [...COMPONENT_IDS] };

export const TOOLS: ToolDef[] = [
  {
    name: "move_component",
    description:
      "Move a component to a region at a 0-based position within that region (use -1 for the end). Other components shift to make room.",
    parameters: {
      type: "object",
      properties: {
        id: idEnum,
        region: { type: "string", enum: [...REGIONS] },
        position: { type: "integer", description: "0-based index in the target region; -1 = end" },
      },
      required: ["id", "region", "position"],
      additionalProperties: false,
    },
  },
  {
    name: "set_visibility",
    description: "Show or hide a component entirely.",
    parameters: {
      type: "object",
      properties: { id: idEnum, visible: { type: "boolean" } },
      required: ["id", "visible"],
      additionalProperties: false,
    },
  },
  {
    name: "set_size",
    description: "Set a component's width in the main region: sm = one third, md = half, lg = full row. No effect elsewhere.",
    parameters: {
      type: "object",
      properties: { id: idEnum, size: { type: "string", enum: [...SIZES] } },
      required: ["id", "size"],
      additionalProperties: false,
    },
  },
  {
    name: "set_collapsed",
    description: "Collapse a component to just its title bar (the user can still expand it), or expand it.",
    parameters: {
      type: "object",
      properties: { id: idEnum, collapsed: { type: "boolean" } },
      required: ["id", "collapsed"],
      additionalProperties: false,
    },
  },
  {
    name: "set_page_option",
    description: `Change a page-wide display option. Options: ${Object.entries(PAGE_OPTION_VALUES)
      .map(([k, v]) => `${k} (${v.join(" | ")})`)
      .join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        option: { type: "string", enum: Object.keys(PAGE_OPTION_VALUES) },
        value: { type: "string" },
      },
      required: ["option", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "reset_layout",
    description: "Restore the company's default layout.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

export const SYSTEM = `You are Morph, a layout assistant embedded in an online store. The user asks you to change how their page is arranged, and you do it by calling the layout tools.

What you can change: where components sit (header / main / sidebar regions and their order), whether they are shown, hidden or collapsed, their width in the main region, and page-wide options (sidebar side, density, light/dark theme).
What you cannot change: what components do, their content, data, or any backend behavior. If the user asks for something outside layout (new features, changing prices, editing text inside a component), say briefly that you can only rearrange the page, and offer the closest layout change if there is one.

Components (id: name; importance; allowed regions; description):
${Object.values(REGISTRY)
  .map((c) => `- ${c.id}: ${c.name}; ${c.importance}; ${c.allowedRegions.join("/")}; ${c.description}`)
  .join("\n")}

Company rules (the tools reject changes that break them):
- Always visible and expanded: ${CONSTRAINTS.mustBeVisible.map((id) => REGISTRY[id].name).join(", ")}.
- Can't be hidden (may be collapsed or moved): ${CONSTRAINTS.cannotHide.map((id) => REGISTRY[id].name).join(", ")}.
- Pinned: ${Object.entries(CONSTRAINTS.pinned)
  .map(([id, p]) => `${REGISTRY[id as keyof typeof REGISTRY].name} at ${p!.region} position ${p!.position}`)
  .join(", ")}.

How to work:
- The current layout is given as JSON with each request. Positions are 0-based within a region; the main region flows left-to-right in rows, so order there is reading order.
- Make the smallest set of changes that does what the user asked. For vague requests ("simpler", "cleaner", "focus on shopping") use component importance and category to decide, and prefer collapsing over hiding when unsure.
- If a tool returns an error, adjust and try again, or explain the rule to the user if what they asked for isn't allowed.
- When you're done, reply with one or two short sentences saying what you changed. No lists, no JSON.`;

/** Prior chat turns as plain text (so "move it back" makes sense). Always starts with a user turn. */
export function cleanHistory(history: ChatTurn[]): ChatTurn[] {
  const h = history.slice(-10).filter((m) => m.text?.trim());
  while (h[0]?.role === "assistant") h.shift();
  return h;
}

export const userPrompt = (layout: Layout, message: string) => `Current layout:\n${JSON.stringify(layout)}\n\nRequest: ${message}`;
export const layoutNote = (layout: Layout) => `Layout now:\n${JSON.stringify(layout)}`;

/** Tracks the working layout across tool calls. Every call goes through applyOp, which validates. */
export class LayoutSession {
  applied: string[] = [];
  rejected: string[] = [];
  constructor(public layout: Layout) {}

  /** Runs one tool call. Returns the text to send back to the model, and whether it was an error. */
  run(name: string, input: unknown): { content: string; isError: boolean } {
    if (!TOOLS.some((t) => t.name === name)) return { content: `Rejected: unknown tool "${name}".`, isError: true };
    const op = { type: name, ...(input as object) } as Op;
    try {
      this.layout = applyOp(this.layout, op);
      this.applied.push(describeOp(op));
      return { content: "OK", isError: false };
    } catch (e) {
      const msg = (e as Error).message;
      this.rejected.push(`${describeOp(op)}: ${msg}`);
      return { content: `Rejected: ${msg}`, isError: true };
    }
  }
}
