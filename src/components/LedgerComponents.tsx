// The company's existing components (Ledgerly). Morph never edits these; it only decides where they go.

import { useState, type FormEvent } from "react";
import type { ComponentId, Region } from "../../shared/registry.ts";
import { api, money, useData } from "../data.tsx";

export interface ComponentProps {
  region: Region;
}

const shortDate = (iso: string | number) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Nav() {
  const { data } = useData();
  return (
    <nav className="nav">
      <span className="logo">Ledgerly</span>
      <a href="#" className="active">Dashboard</a>
      <a href="#">Invoices</a>
      <a href="#">Customers</a>
      <a href="#">Reports</a>
      <span className="avatar" title={data?.user.name}>
        {data?.user.name.split(" ").map((p) => p[0]).join("")}
      </span>
    </nav>
  );
}

function CreateInvoice() {
  const { data, userId, refresh } = useData();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ id: string }>("/api/invoices", userId, { customer, amount: Number(amount) });
      setMsg(`Created ${r.id}`);
      setAmount("");
      refresh();
      setTimeout(() => {
        setOpen(false);
        setMsg(null);
      }, 1200);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="create-invoice">
      <button className="btn dark" onClick={() => setOpen((o) => !o)}>
        + Create invoice
      </button>
      {open && (
        <form className="popover" onSubmit={submit}>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)} required>
            <option value="">Customer…</option>
            {data?.customers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="number" min="1" placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <button className="btn primary">Create</button>
          {msg && <div className="muted small">{msg}</div>}
        </form>
      )}
    </div>
  );
}

function PayrollPromo() {
  return (
    <div className="promo">
      <strong>New: Ledgerly Payroll</strong>
      <span className="grow muted">Run payroll where you invoice. Try it free for 30 days.</span>
      <button className="btn small">Learn more</button>
    </div>
  );
}

function Stats({ region }: ComponentProps) {
  const { data } = useData();
  if (!data) return null;
  const s = data.stats;
  return (
    <div className={`stats ${region === "sidebar" ? "stacked" : ""}`}>
      <div className="stat">
        <span className="muted small">Revenue this month</span>
        <strong>{money(s.revenueThisMonth)}</strong>
      </div>
      <div className="stat">
        <span className="muted small">Open invoices</span>
        <strong>{s.openInvoices}</strong>
      </div>
      <div className="stat">
        <span className="muted small">Avg. days to pay</span>
        <strong>{s.avgDaysToPay}</strong>
      </div>
    </div>
  );
}

function RevenueChart() {
  const { data } = useData();
  const trend = data?.revenueTrend ?? [];
  const max = Math.max(1, ...trend);
  const months = Array.from({ length: trend.length }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (trend.length - 1 - i));
    return d.toLocaleDateString("en-US", { month: "short" });
  });
  return (
    <div className="chart">
      {trend.map((v, i) => (
        <div key={i} className="bar-col" title={`${months[i]}: $${v}k`}>
          <div className={`bar ${i === trend.length - 1 ? "current" : ""}`} style={{ height: `${(v / max) * 100}%` }} />
          <span className="muted small">{months[i]}</span>
        </div>
      ))}
    </div>
  );
}

function News() {
  const { data } = useData();
  return (
    <ul className="list">
      {data?.news.map((n) => (
        <li key={n} className="row">
          <a href="#">{n}</a>
        </li>
      ))}
    </ul>
  );
}

const STATUS_TABS = ["all", "overdue", "open", "paid"] as const;

function Invoices({ region }: ComponentProps) {
  const { data, userId, refresh } = useData();
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("all");
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;
  const rows = data.invoices.filter((i) => tab === "all" || i.status === tab).sort((a, b) => String(b.issued).localeCompare(String(a.issued)));
  const shown = showAll ? rows : rows.slice(0, 5);
  const narrow = region === "sidebar";

  async function act(action: string, key: string | number) {
    try {
      const r = await api<{ message: string }>("/api/action", userId, { source: "invoices", action, key });
      setNote(r.message);
      refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <div>
      <div className="tabs">
        {STATUS_TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="grow" />
        <span className="muted small">
          Showing {shown.length} of {rows.length}
        </span>
      </div>
      <table className="table">
        <tbody>
          {shown.map((i) => (
            <tr key={i.id}>
              <td>
                {!narrow && <span className="muted">{i.id} · </span>}
                {i.customer}
              </td>
              <td className="num">{money(i.amount)}</td>
              {!narrow && (
                <td>
                  <span className={`status ${i.status}`}>{i.status === "overdue" ? `Overdue ${i.days_overdue}d` : String(i.status)}</span>
                </td>
              )}
              {!narrow && <td className="muted">{shortDate(i.issued)}</td>}
              {!narrow && (
                <td className="right">
                  {i.status !== "paid" && (
                    <button className="btn tiny" onClick={() => act("mark_paid", i.id)}>
                      Mark paid
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 5 && (
        <button className="btn tiny ghost" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

function Customers() {
  const { data } = useData();
  return (
    <ul className="list">
      {data?.customers.map((c) => (
        <li key={c.name} className="row">
          <span className="grow">{c.name}</span>
          <span className={Number(c.balance) > 0 ? "" : "muted"}>{money(c.balance)}</span>
        </li>
      ))}
    </ul>
  );
}

function Visits() {
  const { data } = useData();
  if (!data?.visits.length) return <div className="muted">No visits today.</div>;
  return (
    <ul className="list">
      {data.visits.map((v) => (
        <li key={v.id} className="row">
          <span className="grow">{v.customer}</span>
          <span className="muted">{v.time}</span>
        </li>
      ))}
    </ul>
  );
}

function Activity() {
  const { data } = useData();
  return (
    <ul className="list">
      {data?.activity.map((a, i) => (
        <li key={i} className="row small">
          <span className="dot" />
          <span className="grow">{a.text}</span>
        </li>
      ))}
    </ul>
  );
}

export const COMPONENTS: Record<ComponentId, (p: ComponentProps) => React.ReactNode> = {
  nav: Nav,
  create_invoice: CreateInvoice,
  payroll_promo: PayrollPromo,
  stats: Stats,
  revenue_chart: RevenueChart,
  news: News,
  invoices: Invoices,
  customers: Customers,
  visits: Visits,
  activity: Activity,
};
