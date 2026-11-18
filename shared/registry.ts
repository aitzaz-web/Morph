// What the company hands Morph: its page parts, its data sources (fields + actions), and its users.
// The AI reads this; it never sees or edits component code, and never touches data directly.

export const REGIONS = ["header", "main", "sidebar"] as const;
export type Region = (typeof REGIONS)[number];

export const SIZES = ["sm", "md", "lg"] as const;
export type Size = (typeof SIZES)[number];

// ---- Page parts (the company's existing components) ----

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
  name: string;
  description: string;
  importance: "critical" | "high" | "medium" | "low";
  allowedRegions: Region[];
}

export const REGISTRY: Record<ComponentId, ComponentMeta> = {
  nav: {
    id: "nav",
    name: "Top navigation",
    description: "Ledgerly logo and main navigation links.",
    importance: "critical",
    allowedRegions: ["header"],
  },
  create_invoice: {
    id: "create_invoice",
    name: "Create invoice button",
    description: "Button that opens a form to bill a customer.",
    importance: "critical",
    allowedRegions: ["header", "main", "sidebar"],
  },
  payroll_promo: {
    id: "payroll_promo",
    name: "Payroll promo",
    description: "Banner advertising Ledgerly Payroll.",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
  stats: {
    id: "stats",
    name: "Key numbers",
    description: "Revenue this month, open invoices, and average days to get paid.",
    importance: "high",
    allowedRegions: ["main", "sidebar"],
  },
  revenue_chart: {
    id: "revenue_chart",
    name: "Revenue trend",
    description: "Bar chart of revenue over the last six months.",
    importance: "medium",
    allowedRegions: ["main", "sidebar"],
  },
  news: {
    id: "news",
    name: "Industry news",
    description: "Articles and webinars from Ledgerly.",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
  invoices: {
    id: "invoices",
    name: "All invoices",
    description: "Table of every invoice with status tabs; can send reminders and mark invoices paid.",
    importance: "high",
    allowedRegions: ["main", "sidebar"],
  },
  customers: {
    id: "customers",
    name: "Customers",
    description: "Customers with their open balance.",
    importance: "medium",
    allowedRegions: ["main", "sidebar"],
  },
  visits: {
    id: "visits",
    name: "Today's site visits",
    description: "Customer visits scheduled for today, with times.",
    importance: "medium",
    allowedRegions: ["main", "sidebar"],
  },
  activity: {
    id: "activity",
    name: "Recent activity",
    description: "Feed of payments, reminders and new invoices.",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
};

// ---- Data sources Morph can build views from ----
// Views may only filter, sort, group and show these fields, and only offer these actions.
// The company's server decides which rows each user may see.

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
