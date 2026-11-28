// Ledgerly's Morph manifest for the "dashboard" surface: what users may rearrange, what pages may
// read and do, and the rules. Ledgerly keeps this in its own repo and uploads it on every deploy:
//   npm run morph:push   (needs MORPH_URL and MORPH_SECRET_KEY)
// Morph's AI reads this file. It never sees the component code or the data itself.

import { readFileSync } from "node:fs";
import type { ComponentMeta, Manifest, SourceMeta } from "@morph/shared";

const COMPACT = { compact: "boolean: narrow version for sidebars and small spaces" };

const components: ComponentMeta[] = [
  {
    id: "nav",
    importName: "Nav",
    name: "Top navigation",
    description: "Ledgerly logo, main navigation links and the user's avatar. Full-width bar.",
    importance: "critical",
    props: {},
    styling: "nav.nav > .logo, a (links; a.active = current page), .avatar.",
  },
  {
    id: "create_invoice",
    importName: "CreateInvoice",
    name: "Create invoice button",
    description: "Button that opens a small form to bill a customer.",
    importance: "critical",
    props: {},
    styling: ".create-invoice > button.btn.dark (the button); form.popover appears below it while open.",
  },
  {
    id: "payroll_promo",
    importName: "PayrollPromo",
    name: "Payroll promo",
    description: "Banner advertising Ledgerly Payroll.",
    importance: "low",
    props: {},
    styling: ".promo > strong (headline), span.muted (text), button.btn (Learn more).",
  },
  {
    id: "stats",
    importName: "Stats",
    name: "Key numbers",
    description: "Revenue this month, open invoices, and average days to get paid.",
    importance: "high",
    props: COMPACT,
    styling: ".stats (3-column grid; .stats.stacked when compact) > .stat x3 in this order: 1 revenue this month, 2 open invoices, 3 avg. days to pay. Each .stat > span.muted.small (label) + strong (the number). E.g. .stat:nth-child(1) strong = the revenue number.",
  },
  {
    id: "revenue_chart",
    importName: "RevenueChart",
    name: "Revenue trend",
    description: "Bar chart of revenue over the last six months.",
    importance: "medium",
    props: {},
    styling: ".chart (flex, 120px tall) > .bar-col x6 (oldest first) > .bar (.bar.current = this month) + span.muted.small (month label).",
  },
  {
    id: "news",
    importName: "News",
    name: "Industry news",
    description: "Articles and webinars from Ledgerly.",
    importance: "low",
    props: {},
    styling: "ul.list > li.row > a (headline).",
  },
  {
    id: "invoices",
    importName: "Invoices",
    name: "All invoices",
    description: "Table of every invoice with status tabs; can mark invoices paid.",
    importance: "high",
    props: COMPACT,
    styling: ".tabs > button.tab (.tab.on = selected); table.table > tr > td (id + customer), td.num (amount), td > span.status.overdue|open|paid, td.muted (issued date), td.right > button.btn.tiny (Mark paid); button.btn.tiny.ghost (Show all).",
  },
  {
    id: "customers",
    importName: "Customers",
    name: "Customers",
    description: "Customers with their open balance.",
    importance: "medium",
    props: {},
    styling: "ul.list > li.row > span.grow (name) + span (open balance; .muted when zero).",
  },
  {
    id: "visits",
    importName: "Visits",
    name: "Today's site visits",
    description: "Customer visits scheduled for today, with times.",
    importance: "medium",
    props: {},
    styling: "ul.list > li.row > span.grow (customer) + span.muted (time).",
  },
  {
    id: "activity",
    importName: "Activity",
    name: "Recent activity",
    description: "Feed of payments, reminders and new invoices.",
    importance: "low",
    props: {},
    styling: "ul.list > li.row.small > span.dot + span.grow (text).",
  },
];

const sources: SourceMeta[] = [
  {
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
  {
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
  {
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
];

const manifest: Manifest = {
  app: { name: "Ledgerly", description: "an invoicing app for small service businesses" },
  components,
  data: {
    sources,
    other: `- user: { id, name, role }
- stats: { revenueThisMonth: number, openInvoices: number, avgDaysToPay: number }
- revenueTrend: number[] (revenue in $ thousands for the last 6 months, oldest first)
- news: string[] (headlines)
- activity: { at: number (ms timestamp), text: string }[]`,
    notes: 'Money fields are numbers in dollars; dates are "YYYY-MM-DD" strings.',
  },
  rules: [
    { component: "nav", mustShow: true, topmost: true, notCovered: true },
    { component: "create_invoice", mustShow: true, aboveFold: true, notCovered: true, minWidth: 60, minHeight: 24 },
  ],
  foldPx: 700,
  styleGuide: `House style (global CSS you can use by class name):
- Variables: --bg --surface --text --muted --border --accent --accent-text --soft --bad --warn --good --pad --gap. Override them on :scope (or any element) to re-theme.
- Theme classes for any wrapper: theme-dark, theme-calm, density-compact, text-large.
- Layout: site (centered 1240px page), site-header (bar), site-body (main + 320px sidebar grid), region-main (6-column grid; children use span-2 / span-3 / span-4 / span-6), region-sidebar (column).
- Pieces: panel, btn (+ primary, small, tiny, ghost), chip, tabs + tab (+ on), table (+ num), status (+ overdue / open / paid), list + row, muted, small, grow, right.
You may also write any CSS of your own (grid, flex, colors, sizes, sticky, etc.).`,
  defaultPage: { source: readFileSync(new URL("./src/default-page.tsx", import.meta.url), "utf8"), css: "" },
  chat: {
    greeting: "Hi! Tell me how you'd like this page to work: rearrange it, restyle it, or add new ways to see your invoices and customers.",
    suggestions: [
      "Put invoices and customers in tabs",
      "Show unpaid invoices as a board by status, with a reminder button on each",
      "Add a big banner at the top with my total overdue amount",
      "Dark mode, and hide the promo and news",
      "Make it a simple one-column page for my phone",
    ],
  },
};

export default manifest;
