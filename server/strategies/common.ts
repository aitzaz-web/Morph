// Provider-neutral pieces shared by every LLM strategy: the system prompt, the one tool the model
// has (write_page), and the session that checks each page it writes.

import { COMPONENT_IDS, REGISTRY, SOURCES, type User } from "../../shared/registry.ts";
import { RULES, describeRule } from "../../shared/rules.ts";
import { ALLOWED_MODULES, MORPH_API } from "../../shared/sdk-api.ts";
import { checkPage } from "../codegen/check.ts";
import type { Candidate, ChatTurn, MorphResult, PageSource } from "./types.ts";

export const MAX_ROUNDS = 4;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema, strict-compatible (all required, no extra props)
}

export const TOOLS: ToolDef[] = [
  {
    name: "write_page",
    description:
      "Replace the user's whole page. Pass the complete TSX module (not a diff) and the complete CSS. The code is checked; if it's rejected you get the problems back and can fix them.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "The full TSX module. Must `export default` the page component." },
        css: { type: "string", description: "The full CSS for the page (may be empty). Only applies inside the page; :scope is the page root." },
        summary: { type: "string", description: "One short sentence for the user saying what changed." },
      },
      required: ["source", "css", "summary"],
      additionalProperties: false,
    },
  },
];

const DATA_SHAPE = `AppData (from useCompanyData()):
- user: { id, name, role }
${Object.values(SOURCES)
  .map(
    (s) =>
      `- ${s.id}: array of { ${s.fields.map((f) => `${f.id}: ${f.type}${f.options ? ` (${f.options.join(" | ")})` : ""}`).join(", ")} }. ${s.description}` +
      (s.actions.length ? `\n  actions (useAction, key = ${s.key}): ${s.actions.map((a) => `"${a.id}" ${a.description}`).join("; ")}` : ""),
  )
  .join("\n")}
- stats: { revenueThisMonth: number, openInvoices: number, avgDaysToPay: number }
- revenueTrend: number[] (revenue in $ thousands for the last 6 months, oldest first)
- news: string[] (headlines)
- activity: { at: number (ms timestamp), text: string }[]
Money fields are numbers in dollars; dates are "YYYY-MM-DD" strings.`;

const STYLE_GUIDE = `House style (global CSS you can use by class name):
- Variables: --bg --surface --text --muted --border --accent --accent-text --soft --bad --warn --good --pad --gap. Override them on :scope (or any element) to re-theme.
- Theme classes for any wrapper: theme-dark, theme-calm, density-compact, text-large.
- Layout: site (centered 1240px page), site-header (bar), site-body (main + 320px sidebar grid), region-main (6-column grid; children use span-2 / span-3 / span-4 / span-6), region-sidebar (column).
- Pieces: panel, btn (+ primary, small, tiny, ghost), chip, tabs + tab (+ on), table (+ num), status (+ overdue / open / paid), list + row, muted, small, grow, right.
You may also write any CSS of your own (grid, flex, colors, sizes, sticky, etc.).`;

export function systemPrompt(user: User): string {
  return `You are Morph, embedded in Ledgerly, an invoicing app. Each user can reshape their own dashboard by asking you. You do it by writing the dashboard as a React page with the write_page tool.

The user is ${user.name} (${user.role}).${user.repName ? " They only see their own customers; the company's server already filters the data, so you don't need to." : ""} Today is ${new Date().toISOString().slice(0, 10)}.

## What you write
A single TSX module that \`export default\`s a component taking no props, plus a CSS string. It may import only from ${ALLOWED_MODULES.map((m) => `"${m}"`).join(", ")}. Use JSX (not React.createElement). Write the complete file every time.

## "@company": the company's real components
Import by name, e.g. import { Nav, Invoices } from "@company". They render their own content and keep working wherever you put them; you can't change what they do. Every one accepts className and style (applied to a wrapper div) so you can place and size it, plus the props listed. Leaving one out hides it for this user.
Each one is rendered as <div class="morph-c {your className}" data-morph-component="id"> around the company's markup. To restyle parts inside a component, use only its styling hooks below, scoped under your className (e.g. .big-revenue .stat:nth-child(1) strong). Never guess other class names inside a component; they aren't there.
${COMPONENT_IDS.map((id) => {
  const c = REGISTRY[id];
  const props = Object.entries(c.props).map(([k, v]) => `${k} (${v})`);
  return `- <${c.importName} />: ${c.description} Importance: ${c.importance}.${props.length ? ` Props: ${props.join(", ")}.` : ""}\n  Styling hooks: ${c.styling}`;
}).join("\n")}

## "@morph": helpers
${Object.entries(MORPH_API)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

${DATA_SHAPE}

## Company rules (checked in code and on screen; pages that break them are rejected)
${RULES.map((r) => `- ${describeRule(r)}`).join("\n")}
- Never rebuild what a company component does (e.g. your own invoice form or navigation). Use the component.

## Not available
No window, document, fetch, storage, timers that poll, external images or fonts (no url() in CSS), dangerouslySetInnerHTML, or new data or backend features. Data comes only from useCompanyData, and changes only through useAction with the actions listed above. If the user asks for something that isn't about how the page looks or what it shows (emailing customers, new fields, changing prices), say briefly that you can only change their page, and offer the closest thing you can do.

${STYLE_GUIDE}

## How to work
- Start from the current page you're given. Change what the user asked for and keep everything else as it is.
- You may build new displays from the data (boards, summaries, charts made of divs, filtered lists, tabs) and put action buttons on them with useAction.
- Keep it working on narrow screens, and keep the code readable.
- If write_page is rejected, fix the problems and call it again.
- After it says OK, reply with one or two short sentences saying what you changed. No lists, no code.
- If the request needs no change, don't call the tool; just answer.`;
}

/** Prior chat turns as plain text (so "move it back" makes sense). Always starts with a user turn. */
export function cleanHistory(history: ChatTurn[]): ChatTurn[] {
  const h = history.slice(-10).filter((m) => m.text?.trim());
  while (h[0]?.role === "assistant") h.shift();
  return h;
}

export function userPrompt(page: PageSource, message: string, repair?: { problems: string[] }): string {
  const current = `Current page source:\n\`\`\`tsx\n${page.source}\n\`\`\`\n\nCurrent CSS:\n\`\`\`css\n${page.css || "/* none */"}\n\`\`\``;
  if (repair)
    return `${current}\n\nThis is the version you just wrote for the request "${message}". It passed the code checks, but when it was rendered it broke these company rules on screen:\n${repair.problems.map((p) => `- ${p}`).join("\n")}\n\nFix the page so it still does what the user asked while following the rules. If that's impossible, call write_page with a version that follows the rules and explain the trade-off.`;
  return `${current}\n\nRequest: ${message}`;
}

/** Tracks the model's attempts. Every page goes through checkPage before it counts. */
export class CodeSession {
  candidate: Candidate | null = null;
  rejected: string[] = [];
  summary = "";

  /** Runs one tool call. Returns the text to send back to the model, and whether it was an error. */
  async run(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
    if (name !== "write_page") return { content: `Rejected: unknown tool "${name}".`, isError: true };
    const { source, css, summary } = (input ?? {}) as { source?: string; css?: string; summary?: string };
    const result = await checkPage(String(source ?? ""), String(css ?? ""));
    if (!result.ok) {
      this.rejected.push(...result.errors);
      return { content: `Rejected. Fix these and call write_page again:\n${result.errors.map((e) => `- ${e}`).join("\n")}`, isError: true };
    }
    this.candidate = { source: String(source), css: String(css ?? ""), compiled: result.compiled, scopedCss: result.css };
    this.summary = String(summary ?? "").trim();
    return { content: "OK. The page passed the code checks and will now be rendered for the user.", isError: false };
  }

  result(reply: string): MorphResult {
    return { candidate: this.candidate, summary: reply.trim() || this.summary || "Done.", rejected: this.rejected };
  }
}
