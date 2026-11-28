// What a company tells Morph about one surface (a page or area of its app that users can reshape).
// The company keeps this file in its own repo and uploads it with `morph push`. The AI reads it;
// it never sees component code or the company's data, only these descriptions.

export interface ComponentMeta {
  /** Stable id, used in rules and on screen (data-morph-component). */
  id: string;
  /** The name pages import it by from "@company", e.g. "Invoices". */
  importName: string;
  name: string;
  description: string;
  importance: "critical" | "high" | "medium" | "low";
  /** Props the AI may pass, name -> description. Anything else is dropped. */
  props: Record<string, string>;
  /** Class names inside the component the company promises to keep stable, so pages can restyle parts of it. */
  styling: string;
}

export type FieldType = "text" | "money" | "number" | "date" | "enum";

export interface FieldMeta {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
}

export interface ActionMeta {
  id: string;
  label: string;
  description: string;
}

/** A list of rows the page can read through useCompanyData(), and the actions it can run on a row. */
export interface SourceMeta {
  id: string;
  name: string;
  description: string;
  /** Field that identifies a row; actions are called with it. */
  key: string;
  titleField: string;
  fields: FieldMeta[];
  actions: ActionMeta[];
}

export interface ComponentRule {
  /** Component id. */
  component: string;
  /** Must be on the page, rendered at a real size and not hidden by CSS. */
  mustShow: boolean;
  /** Its top edge must be within the first screen (foldPx), without scrolling. */
  aboveFold?: boolean;
  /** Nothing may sit on top of it. */
  notCovered?: boolean;
  /** Must be the highest company component on the page. */
  topmost?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export interface Manifest {
  app: {
    name: string;
    /** One line for the AI, e.g. "an invoicing app for small service businesses". */
    description: string;
  };
  components: ComponentMeta[];
  data: {
    sources: SourceMeta[];
    /** Anything else useCompanyData() returns, described for the AI (one field per line). */
    other?: string;
    /** Notes such as units and date formats. */
    notes?: string;
  };
  rules: ComponentRule[];
  /** Height in px counted as the first screen for `aboveFold`. */
  foldPx: number;
  /** Global CSS classes and variables pages may use, described for the AI. */
  styleGuide: string;
  /** The page every user starts on, written the same way the AI writes pages. */
  defaultPage: { source: string; css: string };
  chat?: {
    greeting?: string;
    suggestions?: string[];
  };
}

/** What the SDK needs from the manifest in the browser (no prompt text). */
export interface SurfaceConfig {
  appName: string;
  components: { id: string; importName: string; name: string; props: string[] }[];
  actions: Record<string, string[]>;
  rules: ComponentRule[];
  foldPx: number;
  chat: { greeting: string; suggestions: string[] };
  aiAvailable: boolean;
}

export function surfaceConfig(m: Manifest, aiAvailable: boolean): SurfaceConfig {
  return {
    appName: m.app.name,
    components: m.components.map((c) => ({ id: c.id, importName: c.importName, name: c.name, props: Object.keys(c.props) })),
    actions: Object.fromEntries(m.data.sources.map((s) => [s.id, s.actions.map((a) => a.id)])),
    rules: m.rules,
    foldPx: m.foldPx,
    chat: {
      greeting: m.chat?.greeting ?? "Hi! Tell me how you'd like this page to work: rearrange it, restyle it, or add new ways to see your data.",
      suggestions: m.chat?.suggestions ?? [],
    },
    aiAvailable,
  };
}

type RuleSubject = { components: { id: string; importName: string; name: string }[]; foldPx: number };

export function componentLabel(m: RuleSubject, id: string): string {
  const c = m.components.find((x) => x.id === id);
  return c ? `${c.importName} (${c.name})` : id;
}

export function describeRule(m: RuleSubject, r: ComponentRule): string {
  const parts = ["must always be shown"];
  if (r.topmost) parts.push("must be the topmost part of the page");
  if (r.aboveFold) parts.push(`must be visible without scrolling (top edge within ${m.foldPx}px)`);
  if (r.notCovered) parts.push("must not be covered by anything");
  if (r.minWidth || r.minHeight) parts.push(`must be at least ${r.minWidth ?? 0}×${r.minHeight ?? 0}px`);
  return `${componentLabel(m, r.component)}: ${parts.join(", ")}.`;
}

/** Import names of the components every page must render. */
export function requiredImports(m: Manifest): string[] {
  return m.rules
    .filter((r) => r.mustShow)
    .map((r) => m.components.find((c) => c.id === r.component)?.importName)
    .filter((n): n is string => !!n);
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** Shape checks for an uploaded manifest. Returns readable problems; empty means fine. */
export function validateManifest(input: unknown): string[] {
  const p: string[] = [];
  const m = input as Partial<Manifest> | null;
  if (!m || typeof m !== "object") return ["The manifest must be an object."];
  if (!m.app?.name || typeof m.app.name !== "string") p.push("app.name is required.");
  if (typeof m.app?.description !== "string") p.push("app.description is required.");
  if (!Array.isArray(m.components) || !m.components.length) p.push("components must be a non-empty list.");
  else {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const c of m.components) {
      if (!c || typeof c !== "object") {
        p.push("Each component must be an object.");
        continue;
      }
      if (!ID.test(String(c.id))) p.push(`Component id "${c.id}" must be lowercase letters, digits, _ or -.`);
      if (!IDENT.test(String(c.importName)) || !/^[A-Z]/.test(String(c.importName)))
        p.push(`Component "${c.id}": importName "${c.importName}" must be a capitalized identifier.`);
      if (ids.has(c.id)) p.push(`Duplicate component id "${c.id}".`);
      if (names.has(c.importName)) p.push(`Duplicate importName "${c.importName}".`);
      ids.add(c.id);
      names.add(c.importName);
      if (!c.props || typeof c.props !== "object") p.push(`Component "${c.id}": props must be an object (may be empty).`);
      else if (Object.keys(c.props).some((k) => ["className", "style", "children", "key", "ref"].includes(k)))
        p.push(`Component "${c.id}": className, style, children, key and ref are handled by Morph and can't be listed as props.`);
    }
    for (const r of m.rules ?? []) if (!ids.has(r.component)) p.push(`Rule refers to unknown component "${r.component}".`);
  }
  if (!Array.isArray(m.rules)) p.push("rules must be a list (may be empty).");
  if (!m.data || !Array.isArray(m.data.sources)) p.push("data.sources must be a list (may be empty).");
  else
    for (const s of m.data.sources) {
      if (!ID.test(String(s?.id))) p.push(`Data source id "${s?.id}" must be lowercase letters, digits, _ or -.`);
      if (!Array.isArray(s?.fields) || !Array.isArray(s?.actions)) p.push(`Data source "${s?.id}": fields and actions must be lists.`);
    }
  if (typeof m.foldPx !== "number" || m.foldPx < 100) p.push("foldPx must be a number of pixels (at least 100).");
  if (typeof m.styleGuide !== "string") p.push("styleGuide must be a string (may be empty).");
  if (typeof m.defaultPage?.source !== "string" || typeof m.defaultPage?.css !== "string")
    p.push("defaultPage must have source and css strings.");
  if (JSON.stringify(m).length > 200_000) p.push("The manifest is too large (max 200 KB).");
  return p;
}
