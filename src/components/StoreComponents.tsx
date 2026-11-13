// The company's existing components. Morph never edits these; it only decides where they go.

import { useState, type FormEvent } from "react";
import type { ComponentId, Region } from "../../shared/registry.ts";
import { PRODUCTS, PROMO_CODES, money, productById, useStore, type Product } from "../store.tsx";

export interface ComponentProps {
  region: Region;
}

function ProductRow({ p, compact }: { p: Product; compact?: boolean }) {
  const { addToCart } = useStore();
  const [added, setAdded] = useState(false);
  return (
    <div className="product-row">
      <span className="emoji">{p.emoji}</span>
      <span className="grow">
        {p.name}
        {!compact && <span className="muted"> · {money(p.price)}</span>}
      </span>
      <button
        className="btn small"
        onClick={() => {
          addToCart(p.id);
          setAdded(true);
          setTimeout(() => setAdded(false), 900);
        }}
      >
        {added ? "Added ✓" : compact ? money(p.price) : "Add"}
      </button>
    </div>
  );
}

function Nav() {
  const { cart, notices } = useStore();
  const items = cart.reduce((n, l) => n + l.qty, 0);
  const unread = notices.filter((n) => !n.read).length;
  return (
    <nav className="nav">
      <span className="logo">◆ Northwind Goods</span>
      <a href="#">Shop</a>
      <a href="#">Deals</a>
      <a href="#">Account</a>
      <span className="nav-badges">
        <span title="Unread notifications">🔔 {unread}</span>
        <span title="Items in cart">🛒 {items}</span>
      </span>
    </nav>
  );
}

function Search({ region }: ComponentProps) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const results = query
    ? PRODUCTS.filter((p) => p.name.toLowerCase().includes(query) || p.tags.some((t) => t.includes(query)))
    : [];
  const inHeader = region === "header";
  return (
    <div className={inHeader ? "search search-header" : "search"}>
      <input placeholder="Search products… (try “running”)" value={q} onChange={(e) => setQ(e.target.value)} />
      {query && (
        <div className={inHeader ? "search-results floating" : "search-results"}>
          {results.length === 0 && <div className="muted">No matches</div>}
          {results.map((p) => (
            <ProductRow key={p.id} p={p} compact={inHeader} />
          ))}
        </div>
      )}
    </div>
  );
}

function Promos() {
  const { promo, applyPromo } = useStore();
  return (
    <div className="promos">
      {Object.entries(PROMO_CODES).map(([code, info]) => (
        <div key={code} className="promo-card">
          <strong>{info.label}</strong>
          <span className="muted">Code {code}</span>
          <button className="btn small" disabled={promo === code} onClick={() => applyPromo(code)}>
            {promo === code ? "Applied ✓" : "Apply to cart"}
          </button>
        </div>
      ))}
    </div>
  );
}

function Orders() {
  const { orders, reorder } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="list">
      {orders.map((o) => (
        <li key={o.id}>
          <div className="row clickable" onClick={() => setOpen(open === o.id ? null : o.id)}>
            <span className="grow">
              <strong>#{o.id}</strong> <span className="muted">· {o.date}</span>
            </span>
            <span className={`status ${o.status.toLowerCase()}`}>{o.status}</span>
            <span>{money(o.total)}</span>
          </div>
          {open === o.id && (
            <div className="order-detail">
              {o.lines.map((l) => (
                <div key={l.productId}>
                  {productById(l.productId).emoji} {productById(l.productId).name} × {l.qty}
                </div>
              ))}
              <button className="btn small" onClick={() => reorder(o)}>
                Reorder
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Cart() {
  const { cart, setQty, subtotal, discount, total, promo, applyPromo, checkout } = useStore();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  return (
    <div className="cart">
      {cart.length === 0 && <div className="muted">Your cart is empty.</div>}
      {cart.map((l) => {
        const p = productById(l.productId);
        return (
          <div key={l.productId} className="row">
            <span className="emoji">{p.emoji}</span>
            <span className="grow">{p.name}</span>
            <span className="qty">
              <button className="btn tiny" onClick={() => setQty(p.id, l.qty - 1)}>−</button>
              {l.qty}
              <button className="btn tiny" onClick={() => setQty(p.id, l.qty + 1)}>+</button>
            </span>
            <span>{money(p.price * l.qty)}</span>
          </div>
        );
      })}
      {cart.length > 0 && (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setCodeError(!applyPromo(code));
            }}
          >
            <input className="grow" placeholder="Promo code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn small">Apply</button>
          </form>
          {codeError && <div className="error-text">That code isn't valid.</div>}
          <div className="totals">
            <div className="row"><span className="grow">Subtotal</span>{money(subtotal)}</div>
            {promo && <div className="row muted"><span className="grow">Promo {promo}</span>−{money(discount)}</div>}
            <div className="row"><strong className="grow">Total</strong><strong>{money(total)}</strong></div>
          </div>
          <button className="btn primary full" onClick={checkout}>
            Checkout
          </button>
        </>
      )}
    </div>
  );
}

function Recommendations({ region }: ComponentProps) {
  const picks = PRODUCTS.filter((p) => ["p5", "p7", "p8", "p9", "p2", "p6"].includes(p.id));
  return region === "main" ? (
    <div className="rec-grid">
      {picks.map((p) => (
        <RecCard key={p.id} p={p} />
      ))}
    </div>
  ) : (
    <div>
      {picks.slice(0, 4).map((p) => (
        <ProductRow key={p.id} p={p} />
      ))}
    </div>
  );
}

function RecCard({ p }: { p: Product }) {
  const { addToCart } = useStore();
  return (
    <div className="rec-card">
      <div className="rec-emoji">{p.emoji}</div>
      <div>{p.name}</div>
      <div className="muted">{money(p.price)}</div>
      <button className="btn small" onClick={() => addToCart(p.id)}>
        Add to cart
      </button>
    </div>
  );
}

function Notifications() {
  const { notices, markRead, dismiss, markAllRead } = useStore();
  return (
    <div>
      {notices.length === 0 && <div className="muted">You're all caught up.</div>}
      <ul className="list">
        {notices.map((n) => (
          <li key={n.id} className={`row ${n.read ? "muted" : ""}`}>
            {!n.read && <span className="dot" />}
            <span className="grow clickable" onClick={() => markRead(n.id)}>
              {n.text}
            </span>
            <button className="btn tiny ghost" onClick={() => dismiss(n.id)} title="Dismiss">✕</button>
          </li>
        ))}
      </ul>
      {notices.some((n) => !n.read) && (
        <button className="btn small ghost" onClick={markAllRead}>
          Mark all read
        </button>
      )}
    </div>
  );
}

function ProfileCard() {
  const { profile, setProfile, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  if (!editing)
    return (
      <div className="profile">
        <div><strong>{profile.name}</strong></div>
        <div className="muted">{profile.email}</div>
        <div className="muted">{profile.address}</div>
        <button className="btn small" onClick={() => { setDraft(profile); setEditing(true); }}>
          Edit
        </button>
      </div>
    );
  return (
    <form
      className="profile"
      onSubmit={(e) => {
        e.preventDefault();
        setProfile(draft);
        setEditing(false);
        notify("Profile updated.");
      }}
    >
      {(["name", "email", "address"] as const).map((k) => (
        <input key={k} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={k} />
      ))}
      <div className="row">
        <button className="btn small primary">Save</button>
        <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function Support() {
  const { notify } = useStore();
  const [topic, setTopic] = useState("Order issue");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!msg.trim()) return;
    const ticket = `T-${Math.floor(1000 + Math.random() * 9000)}`;
    setSent(ticket);
    setMsg("");
    notify(`Support ticket ${ticket} opened: ${topic}.`);
  };
  return (
    <form className="support" onSubmit={submit}>
      <select value={topic} onChange={(e) => setTopic(e.target.value)}>
        <option>Order issue</option>
        <option>Returns</option>
        <option>Account</option>
        <option>Other</option>
      </select>
      <textarea rows={3} placeholder="How can we help?" value={msg} onChange={(e) => setMsg(e.target.value)} />
      <button className="btn small">Send</button>
      {sent && <div className="muted">Ticket {sent} created. We'll email you soon.</div>}
    </form>
  );
}

export const COMPONENTS: Record<ComponentId, (p: ComponentProps) => React.JSX.Element> = {
  nav: Nav,
  search: Search,
  promos: Promos,
  orders: Orders,
  cart: Cart,
  recommendations: Recommendations,
  notifications: Notifications,
  profile: ProfileCard,
  support: Support,
};
