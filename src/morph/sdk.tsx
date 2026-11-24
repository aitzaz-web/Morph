// The "@morph" module AI-written pages import: read-only company data, the company's own row
// actions, and a few building blocks in the house style. Nothing here can reach the network or
// the page outside the user's dashboard except through the company's own API.

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { AppData } from "../../server/company.ts";
import { api, money, useData } from "../data.tsx";

/** The company's data for this user, already filtered by their permissions. Null while loading. */
export function useCompanyData(): AppData | null {
  return useData().data;
}

/**
 * Runs one of the company's own actions (see the data sources' actions), e.g.
 * `run("invoices", "send_reminder", "INV-1040")`. Resolves to a message to show the user.
 */
export function useAction() {
  const { userId, refresh } = useData();
  return useCallback(
    async (source: string, action: string, key: string): Promise<string> => {
      try {
        const r = await api<{ message: string }>("/api/action", userId, { source, action, key });
        refresh();
        return r.message;
      } catch (e) {
        return (e as Error).message;
      }
    },
    [userId, refresh],
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

/** A card in Ledgerly's house style, with an optional title bar and collapse button. */
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

export const shortDate = (iso: string | number) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export { money };

export const MORPH_MODULE = { useCompanyData, useAction, Panel, money, shortDate };
