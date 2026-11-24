// What the company hands Morph: its page parts, its data sources (fields + actions), and its users.
// The AI reads this; it never sees or edits component code, and never touches data directly.

// ---- Page parts (the company's existing components) ----
// The AI imports these from "@company" by `importName`. It can place, size and wrap them,
// and pass the listed props, but it can't change what they do.

export const COMPONENT_IDS = [
  "nav",
  "create_invoice",
  "payroll_promo",
  "stats",
  "revenue_chart",
  "news",
  "invoices",
  "customers",
  "visits",
  "activity",
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

export interface ComponentMeta {
  id: ComponentId;
  importName: string;
  name: string;
  description: string;
  importance: "critical" | "high" | "medium" | "low";
  /** Props the AI may pass. Anything else is dropped by the wrapper. */
  props: Record<string, string>;
  /**
   * Styling hooks: the class names inside the component that the company promises to keep stable,
   * so pages can restyle parts of it without guessing at its markup.
   */
  styling: string;
}

const COMPACT = { compact: "boolean: narrow version for sidebars and small spaces" };

export const REGISTRY: Record<ComponentId, ComponentMeta> = {
  nav: {
    id: "nav",
    importName: "Nav",
    name: "Top navigation",
    description: "Ledgerly logo, main navigation links and the user's avatar. Full-width bar.",
    importance: "critical",
    props: {},
    styling: "nav.nav > .logo, a (links; a.active = current page), .avatar.",
  },
  create_invoice: {
    id: "create_invoice",
    importName: "CreateInvoice",
    name: "Create invoice button",
    description: "Button that opens a small form to bill a customer.",
    importance: "critical",
    props: {},
    styling: ".create-invoice > button.btn.dark (the button); form.popover appears below it while open.",
  },
  payroll_promo: {
    id: "payroll_promo",
    importName: "PayrollPromo",
    name: "Payroll promo",
    description: "Banner advertising Ledgerly Payroll.",
    importance: "low",
    props: {},
    styling: ".promo > strong (headline), span.muted (text), button.btn (Learn more).",
  },
  stats: {
    id: "stats",
    importName: "Stats",
    name: "Key numbers",
    description: "Revenue this month, open invoices, and average days to get paid.",
    importance: "high",
    props: COMPACT,
    styling: ".stats (3-column grid; .stats.stacked when compact) > .stat x3 in this order: 1 revenue this month, 2 open invoices, 3 avg. days to pay. Each .stat > span.muted.small (label) + strong (the number). E.g. .stat:nth-child(1) strong = the revenue number.",
  },
  revenue_chart: {
    id: "revenue_chart",
    importName: "RevenueChart",
    name: "Revenue trend",
    description: "Bar chart of revenue over the last six months.",
    importance: "medium",
    props: {},
    styling: ".chart (flex, 120px tall) > .bar-col x6 (oldest first) > .bar (.bar.current = this month) + span.muted.small (month label).",
  },
  news: {
    id: "news",
    importName: "News",
    name: "Industry news",
    description: "Articles and webinars from Ledgerly.",
    importance: "low",
    props: {},
    styling: "ul.list > li.row > a (headline).",
  },
  invoices: {
    id: "invoices",
    importName: "Invoices",
    name: "All invoices",
    description: "Table of every invoice with status tabs; can mark invoices paid.",
    importance: "high",
    props: COMPACT,
    styling: ".tabs > button.tab (.tab.on = selected); table.table > tr > td (id + customer), td.num (amount), td > span.status.overdue|open|paid, td.muted (issued date), td.right > button.btn.tiny (Mark paid); button.btn.tiny.ghost (Show all).",
  },
  customers: {
    id: "customers",
    importName: "Customers",
    name: "Customers",
    description: "Customers with their open balance.",
    importance: "medium",
    props: {},
    styling: "ul.list > li.row > span.grow (name) + span (open balance; .muted when zero).",
  },
  visits: {
    id: "visits",
    importName: "Visits",
    name: "Today's site visits",
    description: "Customer visits scheduled for today, with times.",
    importance: "medium",
    props: {},
    styling: "ul.list > li.row > span.grow (customer) + span.muted (time).",
  },
  activity: {
    id: "activity",
    importName: "Activity",
    name: "Recent activity",
    description: "Feed of payments, reminders and new invoices.",
    importance: "low",
    props: {},
    styling: "ul.list > li.row.small > span.dot + span.grow (text).",
  },
};

// ---- The company's data, as Morph code sees it ----
// The AI's code reads these (already scoped to the user) through useCompanyData(), and may only
// trigger the listed actions, which run through the company's own handler.

export type FieldType = "text" | "money" | "number" | "date" | "enum";

export interface FieldMeta {
  id: string;
  label: string;
  type: FieldType;
  options?: string[]; // enum values
}

export interface ActionMeta {
  id: string;
  label: string;
  description: string;
}

export interface SourceMeta {
  id: string;
  name: string;
  description: string;
  key: string; // field that identifies a row
  titleField: string; // field shown as a card's title
  fields: FieldMeta[];
  actions: ActionMeta[];
}

export const SOURCES: Record<string, SourceMeta> = {
  invoices: {
    id: "invoices",
    name: "Invoices",
    description: "Every invoice the user can see.",
    key: "id",
    titleField: "customer",
    fields: [
      { id: "id", label: "Invoice", type: "text" },
      { id: "customer", label: "Customer", type: "text" },
      { id: "amount", label: "Amount", type: "money" },
      { id: "status", label: "Status", type: "enum", options: ["overdue", "open", "paid"] },
      { id: "issued", label: "Issued", type: "date" },
      { id: "due", label: "Due", type: "date" },
      { id: "days_overdue", label: "Days overdue", type: "number" },
      { id: "rep", label: "Sales rep", type: "text" },
    ],
    actions: [
      { id: "send_reminder", label: "Send reminder", description: "Email the customer a payment reminder (unpaid invoices only)." },
      { id: "mark_paid", label: "Mark paid", description: "Record that the invoice was paid (unpaid invoices only)." },
    ],
  },
  customers: {
    id: "customers",
    name: "Customers",
    description: "Customers the user can see, with their open balance.",
    key: "name",
    titleField: "name",
    fields: [
      { id: "name", label: "Customer", type: "text" },
      { id: "city", label: "City", type: "text" },
      { id: "balance", label: "Open balance", type: "money" },
      { id: "open_invoices", label: "Open invoices", type: "number" },
      { id: "rep", label: "Sales rep", type: "text" },
    ],
    actions: [],
  },
  visits: {
    id: "visits",
    name: "Site visits",
    description: "Scheduled customer visits.",
    key: "id",
    titleField: "customer",
    fields: [
      { id: "id", label: "Visit", type: "text" },
      { id: "customer", label: "Customer", type: "text" },
      { id: "date", label: "Date", type: "date" },
      { id: "time", label: "Time", type: "text" },
      { id: "rep", label: "Sales rep", type: "text" },
    ],
    actions: [],
  },
};

export const fieldMeta = (source: string, field: string) => SOURCES[source]?.fields.find((f) => f.id === field);

// ---- Users (demo accounts) ----

export interface User {
  id: string;
  name: string;
  role: string;
  /** Reps only see their own customers; managers see everything. */
  repName: string | null;
}

export const USERS: Record<string, User> = {
  maria: { id: "maria", name: "Maria Rossi", role: "Office manager", repName: null },
  dev: { id: "dev", name: "Dev Patel", role: "Field sales rep", repName: "Dev" },
};
