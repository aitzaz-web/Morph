// Component metadata the company provides. The AI reads this; it never sees or edits component code.

export const REGIONS = ["header", "main", "sidebar"] as const;
export type Region = (typeof REGIONS)[number];

export const SIZES = ["sm", "md", "lg"] as const;
export type Size = (typeof SIZES)[number];

export const COMPONENT_IDS = [
  "nav",
  "search",
  "promos",
  "orders",
  "cart",
  "recommendations",
  "notifications",
  "profile",
  "support",
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

export interface ComponentMeta {
  id: ComponentId;
  name: string;
  description: string;
  category: "navigation" | "commerce" | "account" | "marketing" | "help";
  importance: "critical" | "high" | "medium" | "low";
  allowedRegions: Region[];
}

export const REGISTRY: Record<ComponentId, ComponentMeta> = {
  nav: {
    id: "nav",
    name: "Top navigation",
    description: "Store logo and main navigation links.",
    category: "navigation",
    importance: "critical",
    allowedRegions: ["header"],
  },
  search: {
    id: "search",
    name: "Product search",
    description: "Search box that finds products and lets the user add them to the cart.",
    category: "commerce",
    importance: "high",
    allowedRegions: ["header", "main", "sidebar"],
  },
  promos: {
    id: "promos",
    name: "Deals banner",
    description: "Current promotions and promo codes that can be applied to the cart.",
    category: "marketing",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
  orders: {
    id: "orders",
    name: "Your orders",
    description: "Recent orders with status and tracking; can reorder past items.",
    category: "commerce",
    importance: "high",
    allowedRegions: ["main", "sidebar"],
  },
  cart: {
    id: "cart",
    name: "Cart & checkout",
    description: "Items in the cart, quantities, total and the checkout button.",
    category: "commerce",
    importance: "critical",
    allowedRegions: ["main", "sidebar"],
  },
  recommendations: {
    id: "recommendations",
    name: "Recommended for you",
    description: "Personalized product suggestions the user can add to the cart.",
    category: "marketing",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
  notifications: {
    id: "notifications",
    name: "Notifications",
    description: "Shipping updates, account alerts and messages.",
    category: "account",
    importance: "medium",
    allowedRegions: ["main", "sidebar"],
  },
  profile: {
    id: "profile",
    name: "Account profile",
    description: "The user's name, email and default address, editable inline.",
    category: "account",
    importance: "medium",
    allowedRegions: ["main", "sidebar"],
  },
  support: {
    id: "support",
    name: "Help & support",
    description: "Contact form for opening a support ticket.",
    category: "help",
    importance: "low",
    allowedRegions: ["main", "sidebar"],
  },
};
