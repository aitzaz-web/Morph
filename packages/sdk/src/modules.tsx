// The two modules an AI-written page can import besides React.
//
// "@company": one wrapper per component the company listed. It passes through only the props the
//   manifest allows and tags the element so the on-screen rule check can find it. The real
//   component is looked up at render time from <MorphSurface components>, so the company can pass a
//   new object on every render without remounting the page.
// "@morph": read-only company data, the company's own actions (click-only), and a few building blocks.
//
// These are the only doors between a page and the rest of the app. When pages move into a
// sandboxed iframe, these become the message channel and pages don't change.

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { SurfaceConfig } from "@morph/shared";
import { useSurface } from "./context.ts";

export interface CompanyProps {
  /** Applied to the wrapper, so the page can size and position the component. */
  className?: string;
  style?: CSSProperties;
  [prop: string]: unknown;
}

function wrap(id: string, importName: string) {
  function Wrapped(props: CompanyProps) {
    const surface = useSurface();
    const Real = surface.components[importName];
    const allowed = surface.props[importName];
    const pass: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) if (allowed?.has(k)) pass[k] = v;
    return (
      <div data-morph-component={id} className={`morph-c ${props.className ?? ""}`} style={props.style}>
        {Real ? <Real {...pass} /> : <div className="morph-missing">Missing component {importName}</div>}
      </div>
    );
  }
  Wrapped.displayName = importName;
  return Wrapped;
}

export function companyModule(config: SurfaceConfig): Record<string, (p: CompanyProps) => ReactNode> {
  return Object.fromEntries(config.components.map((c) => [c.importName, wrap(c.id, c.importName)]));
}

/** The company's data for this user, exactly as the company passed it to <MorphSurface data>. */
export function useCompanyData(): unknown {
  return useSurface().data;
}

/** True while the browser considers the user to be actively interacting (just clicked, typed...). */
function userIsActing(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : true; // browsers without the API: allow
}

/**
 * Runs one of the company's own actions, e.g. `run("invoices", "send_reminder", "INV-1040")`.
 * Only actions listed in the manifest, and only right after the user clicked or typed, so a page
 * can't fire actions on its own. Resolves to a message to show the user.
 */
export function useAction() {
  const { actions, allowedActions } = useSurface();
  return useCallback(
    async (source: string, action: string, key: string): Promise<string> => {
      if (!allowedActions[source]?.includes(action)) return `"${action}" isn't an action on ${source}.`;
      const handler = actions[source]?.[action];
      if (!handler) return `"${action}" isn't available right now.`;
      if (!userIsActing()) return "Actions only run when you click.";
      try {
        return (await handler(String(key))) || "Done.";
      } catch (e) {
        return (e as Error).message || "That didn't work.";
      }
    },
    [actions, allowedActions],
  );
}

export interface PanelProps {
  title?: ReactNode;
  /** Extra controls shown on the right of the title bar. */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A card. The company styles it with .panel, .panel-title, .panel-body and .panel.collapsed. */
export function Panel({ title, actions, collapsible = false, defaultCollapsed = false, className, style, children }: PanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className={`panel ${collapsed ? "collapsed" : ""} ${className ?? ""}`} style={style}>
      {(title || actions || collapsible) && (
        <header className="panel-title">
          <h2>{title}</h2>
          <span className="panel-tools">
            {actions}
            {collapsible && (
              <button className="btn tiny ghost" title={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? "▸" : "▾"}
              </button>
            )}
          </span>
        </header>
      )}
      {!collapsed && <div className="panel-body">{children}</div>}
    </section>
  );
}

export const money = (n: number | string) => `$${Number(n).toLocaleString("en-US")}`;

export const shortDate = (iso: string | number) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const MORPH_MODULE = { useCompanyData, useAction, Panel, money, shortDate };
