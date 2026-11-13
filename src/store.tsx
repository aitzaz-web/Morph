// App state (cart, orders, profile...). Lives above the layout, so components keep their
// data and behavior no matter where Morph places them.

import { createContext, useContext, useState, type ReactNode } from "react";

export interface Product {
  id: string;
  name: string;
  price: number;
  emoji: string;
  tags: string[];
}

export interface CartLine {
  productId: string;
  qty: number;
}

export interface Order {
  id: string;
  date: string;
  status: "Processing" | "Shipped" | "Delivered";
  lines: CartLine[];
  total: number;
}

export interface Notice {
  id: string;
  text: string;
  read: boolean;
}

export interface Profile {
  name: string;
  email: string;
  address: string;
}

export const PRODUCTS: Product[] = [
  { id: "p1", name: "Trail Running Shoes", price: 89, emoji: "👟", tags: ["shoes", "running", "outdoor"] },
  { id: "p2", name: "Insulated Water Bottle", price: 24, emoji: "🧴", tags: ["outdoor", "kitchen"] },
  { id: "p3", name: "Wireless Earbuds", price: 59, emoji: "🎧", tags: ["electronics", "audio"] },
  { id: "p4", name: "Merino Wool Socks (3-pack)", price: 18, emoji: "🧦", tags: ["clothing", "running"] },
  { id: "p5", name: "Daypack 20L", price: 65, emoji: "🎒", tags: ["outdoor", "bags"] },
  { id: "p6", name: "Pour-Over Coffee Kit", price: 42, emoji: "☕", tags: ["kitchen", "coffee"] },
  { id: "p7", name: "Smart Watch", price: 149, emoji: "⌚", tags: ["electronics", "running"] },
  { id: "p8", name: "Rain Jacket", price: 110, emoji: "🧥", tags: ["clothing", "outdoor"] },
  { id: "p9", name: "Yoga Mat", price: 35, emoji: "🧘", tags: ["fitness"] },
];

export const PROMO_CODES: Record<string, { label: string; percent: number }> = {
  FALL15: { label: "15% off everything", percent: 15 },
  RUNNER10: { label: "10% off your order", percent: 10 },
};

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id)!;
export const money = (n: number) => `$${n.toFixed(2)}`;

const INITIAL_ORDERS: Order[] = [
  { id: "A1042", date: "Nov 9", status: "Shipped", lines: [{ productId: "p3", qty: 1 }], total: 59 },
  { id: "A1031", date: "Oct 28", status: "Delivered", lines: [{ productId: "p4", qty: 2 }, { productId: "p2", qty: 1 }], total: 60 },
  { id: "A1017", date: "Oct 3", status: "Delivered", lines: [{ productId: "p6", qty: 1 }], total: 42 },
];

function useStoreState() {
  const [cart, setCart] = useState<CartLine[]>([{ productId: "p1", qty: 1 }]);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [notices, setNotices] = useState<Notice[]>([
    { id: "n1", text: "Order A1042 has shipped and arrives Thursday.", read: false },
    { id: "n2", text: "Your saved Rain Jacket is back in stock.", read: false },
    { id: "n3", text: "Password changed successfully.", read: true },
  ]);
  const [profile, setProfile] = useState<Profile>({ name: "Alex Rivera", email: "alex@example.com", address: "12 Elm St, Ithaca NY" });
  const [promo, setPromo] = useState<string | null>(null);

  const subtotal = cart.reduce((sum, l) => sum + productById(l.productId).price * l.qty, 0);
  const discount = promo ? (subtotal * PROMO_CODES[promo].percent) / 100 : 0;
  const total = subtotal - discount;

  const notify = (text: string) => setNotices((n) => [{ id: crypto.randomUUID(), text, read: false }, ...n]);

  const addToCart = (productId: string, qty = 1) =>
    setCart((c) => {
      const line = c.find((l) => l.productId === productId);
      return line ? c.map((l) => (l === line ? { ...l, qty: l.qty + qty } : l)) : [...c, { productId, qty }];
    });

  const setQty = (productId: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.productId !== productId) : c.map((l) => (l.productId === productId ? { ...l, qty } : l))));

  const applyPromo = (code: string) => {
    const key = code.trim().toUpperCase();
    if (!PROMO_CODES[key]) return false;
    setPromo(key);
    return true;
  };

  const checkout = () => {
    if (cart.length === 0) return;
    const id = `A${1043 + orders.length - INITIAL_ORDERS.length}`;
    setOrders((o) => [{ id, date: "Today", status: "Processing", lines: cart, total }, ...o]);
    setCart([]);
    setPromo(null);
    notify(`Order ${id} placed — ${money(total)}. Thanks!`);
  };

  const reorder = (order: Order) => {
    order.lines.forEach((l) => addToCart(l.productId, l.qty));
    notify(`Items from order ${order.id} added to your cart.`);
  };

  return {
    cart, orders, notices, profile, promo, subtotal, discount, total,
    addToCart, setQty, applyPromo, checkout, reorder, notify,
    setProfile,
    markRead: (id: string) => setNotices((n) => n.map((x) => (x.id === id ? { ...x, read: true } : x))),
    dismiss: (id: string) => setNotices((n) => n.filter((x) => x.id !== id)),
    markAllRead: () => setNotices((n) => n.map((x) => ({ ...x, read: true }))),
  };
}

type Store = ReturnType<typeof useStoreState>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  return <StoreContext.Provider value={useStoreState()}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
