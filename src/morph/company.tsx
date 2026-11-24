// The "@company" module AI-written pages import. Each export wraps one of the company's real
// components: it passes through only the props the company allows and tags the element so the
// rule check can find it on screen. The page can place and size it, never change it.

import type { CSSProperties } from "react";
import { COMPONENT_IDS, REGISTRY, type ComponentId } from "../../shared/registry.ts";
import { COMPONENTS } from "../components/LedgerComponents.tsx";

export interface CompanyProps {
  compact?: boolean;
  /** Applied to the wrapper, so the page can size and position the component. */
  className?: string;
  style?: CSSProperties;
}

function wrap(id: ComponentId) {
  const Real = COMPONENTS[id];
  const allowed = new Set(Object.keys(REGISTRY[id].props));
  function Wrapped(props: CompanyProps) {
    const pass: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) if (allowed.has(k)) pass[k] = v;
    return (
      <div data-morph-component={id} className={`morph-c ${props.className ?? ""}`} style={props.style}>
        <Real {...pass} />
      </div>
    );
  }
  Wrapped.displayName = REGISTRY[id].importName;
  return Wrapped;
}

export const COMPANY_MODULE: Record<string, (p: CompanyProps) => React.ReactNode> = Object.fromEntries(
  COMPONENT_IDS.map((id) => [REGISTRY[id].importName, wrap(id)]),
);

// Named exports so the hand-written default page type-checks against this module.
export const { Nav, CreateInvoice, PayrollPromo, Stats, RevenueChart, News, Invoices, Customers, Visits, Activity } = COMPANY_MODULE;
