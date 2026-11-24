// Stand-in for the company's own backend (Ledgerly). Morph never reads this data directly:
// pages get it through `appData` and `runAction`, which apply the company's permission rules.

import { USERS, type User } from "../shared/registry.ts";

export type Row = Record<string, string | number>;

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromToday = (n: number) => iso(new Date(Date.now() + n * DAY));
export const today = () => iso(new Date());

interface Invoice {
  id: string;
  customer: string;
  amount: number;
  issued: string;
  due: string;
  paid: string | null;
  rep: string;
}

const CUSTOMERS: { name: string; city: string; rep: string }[] = [
  { name: "Brightline HVAC", city: "Ithaca", rep: "Sam" },
  { name: "Northgate Builders", city: "Cortland", rep: "Dev" },
  { name: "Kessler Property Mgmt", city: "Ithaca", rep: "Sam" },
  { name: "Hale Mechanical", city: "Elmira", rep: "Sam" },
  { name: "Riverside Schools", city: "Owego", rep: "Dev" },
  { name: "Oakridge Dental", city: "Ithaca", rep: "Dev" },
  { name: "Summit Cold Storage", city: "Binghamton", rep: "Sam" },
  { name: "Lakeview Apartments", city: "Geneva", rep: "Dev" },
];

const repOf = (customer: string) => CUSTOMERS.find((c) => c.name === customer)?.rep ?? "Sam";

// [customer, amount, issued (days from today), due (days from today), paid (days from today) | null]
const SEED: [string, number, number, number, number | null][] = [
  ["Brightline HVAC", 4200, -62, -32, null],
  ["Northgate Builders", 3860, -54, -24, null],
  ["Kessler Property Mgmt", 2310, -45, -15, null],
  ["Hale Mechanical", 1940, -39, -9, null],
  ["Riverside Schools", 1270, -34, -4, null],
  ["Oakridge Dental", 1240, -32, -2, null],
  ["Summit Cold Storage", 480, -30, -1, null],
  ["Lakeview Apartments", 2650, -20, 10, null],
  ["Brightline HVAC", 890, -12, 18, null],
  ["Riverside Schools", 3120, -8, 22, null],
  ["Northgate Builders", 640, -5, 25, null],
  ["Kessler Property Mgmt", 1575, -3, 27, null],
  ["Hale Mechanical", 3200, -40, -10, -6],
  ["Oakridge Dental", 2940, -35, -5, 0],
  ["Summit Cold Storage", 1810, -50, -20, -22],
  ["Lakeview Apartments", 960, -44, -14, -16],
  ["Brightline HVAC", 2275, -70, -40, -41],
  ["Riverside Schools", 720, -60, -30, -33],
];

let invoices: Invoice[] = [];
let activity: { at: number; text: string }[] = [];

export function resetCompanyData() {
  invoices = SEED.map(([customer, amount, issued, due, paid], i) => ({
    id: `INV-${1040 + i}`,
    customer,
    amount,
    issued: daysFromToday(issued),
    due: daysFromToday(due),
    paid: paid === null ? null : daysFromToday(paid),
    rep: repOf(customer),
  }));
  activity = [
    { at: Date.now() - 2 * 3600_000, text: "Oakridge Dental paid INV-1053 ($2,940)" },
    { at: Date.now() - 26 * 3600_000, text: "Reminder sent to Brightline HVAC for INV-1040" },
    { at: Date.now() - 50 * 3600_000, text: "Hale Mechanical paid INV-1052 ($3,200)" },
    { at: Date.now() - 74 * 3600_000, text: "New invoice INV-1051 for Kessler Property Mgmt" },
  ];
}
resetCompanyData();

function status(inv: Invoice): "paid" | "open" | "overdue" {
  if (inv.paid) return "paid";
  return inv.due < today() ? "overdue" : "open";
}

const daysOverdue = (inv: Invoice) =>
  status(inv) === "overdue" ? Math.round((new Date(today()).getTime() - new Date(inv.due).getTime()) / DAY) : 0;

// ---- Permissions: reps only see their own customers ----

const canSee = (user: User, rep: string) => user.repName === null || user.repName === rep;

export function getUser(id: string | undefined): User | null {
  return (id && USERS[id]) || null;
}

function sourceRows(user: User, source: string): Row[] {
  if (source === "invoices")
    return invoices
      .filter((i) => canSee(user, i.rep))
      .map((i) => ({ id: i.id, customer: i.customer, amount: i.amount, status: status(i), issued: i.issued, due: i.due, days_overdue: daysOverdue(i), rep: i.rep }));
  if (source === "customers")
    return CUSTOMERS.filter((c) => canSee(user, c.rep)).map((c) => {
      const open = invoices.filter((i) => i.customer === c.name && !i.paid);
      return { name: c.name, city: c.city, balance: open.reduce((s, i) => s + i.amount, 0), open_invoices: open.length, rep: c.rep };
    });
  if (source === "visits")
    return VISITS.filter((v) => canSee(user, repOf(v.customer))).map((v, i) => ({ id: `V${i + 1}`, customer: v.customer, date: today(), time: v.time, rep: repOf(v.customer) }));
  return [];
}

const VISITS = [
  { customer: "Northgate Builders", time: "10:30" },
  { customer: "Hale Mechanical", time: "11:45" },
  { customer: "Oakridge Dental", time: "1:00" },
  { customer: "Riverside Schools", time: "3:15" },
];

/** Runs one of the company's own actions, with the same permission check as its own UI. */
export function runAction(user: User, source: string, action: string, rowKey: string): string {
  if (source !== "invoices") throw new Error(`No actions on ${source}.`);
  const inv = invoices.find((i) => i.id === rowKey && canSee(user, i.rep));
  if (!inv) throw new Error("Invoice not found.");
  if (inv.paid) throw new Error(`${inv.id} is already paid.`);
  const money = `$${inv.amount.toLocaleString("en-US")}`;
  if (action === "send_reminder") {
    activity.unshift({ at: Date.now(), text: `Reminder sent to ${inv.customer} for ${inv.id}` });
    return `Reminder sent to ${inv.customer}.`;
  }
  if (action === "mark_paid") {
    inv.paid = today();
    activity.unshift({ at: Date.now(), text: `${inv.customer} paid ${inv.id} (${money})` });
    return `${inv.id} marked paid.`;
  }
  throw new Error(`Unknown action "${action}".`);
}

export function createInvoice(user: User, customer: string, amount: number): string {
  const c = CUSTOMERS.find((x) => x.name === customer && canSee(user, x.rep));
  if (!c) throw new Error("Unknown customer.");
  if (!(amount > 0)) throw new Error("Amount must be positive.");
  const id = `INV-${1040 + invoices.length}`;
  invoices.unshift({ id, customer, amount, issued: today(), due: daysFromToday(30), paid: null, rep: c.rep });
  activity.unshift({ at: Date.now(), text: `New invoice ${id} for ${customer}` });
  return id;
}

/** Everything the company's own components need, already scoped to the user. */
export function appData(user: User) {
  const inv = sourceRows(user, "invoices");
  const month = today().slice(0, 7);
  const paidThisMonth = invoices.filter((i) => canSee(user, i.rep) && i.paid?.startsWith(month));
  const paidAll = invoices.filter((i) => canSee(user, i.rep) && i.paid);
  const avgDays = paidAll.length
    ? Math.round(paidAll.reduce((s, i) => s + (new Date(i.paid!).getTime() - new Date(i.issued).getTime()) / DAY, 0) / paidAll.length)
    : 0;
  const repCustomers = new Set(sourceRows(user, "customers").map((c) => String(c.name)));
  return {
    user,
    invoices: inv,
    customers: sourceRows(user, "customers"),
    visits: sourceRows(user, "visits"),
    stats: {
      revenueThisMonth: paidThisMonth.reduce((s, i) => s + i.amount, 0) + (user.repName ? 9_400 : 41_870),
      openInvoices: inv.filter((i) => i.status !== "paid").length,
      avgDaysToPay: avgDays,
    },
    revenueTrend: user.repName ? [8, 11, 9, 13, 12, 15] : [38, 44, 41, 52, 47, 58],
    news: ["Copper prices expected to rise this winter", "5 tips for a faster month-end close", "Webinar: growing your service business"],
    activity: activity.filter((a) => [...repCustomers].some((c) => a.text.includes(c))).slice(0, 6),
  };
}

export type AppData = ReturnType<typeof appData>;
