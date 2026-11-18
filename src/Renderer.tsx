// Turns layout JSON into the real components and Morph views. The only place layout is interpreted.

import { CONSTRAINTS, isComponent, slotName, type Layout, type Op, type Slot } from "../shared/layout.ts";
import type { ComponentId, Region } from "../shared/registry.ts";
import { COMPONENTS } from "./components/LedgerComponents.tsx";
import { ViewPanel } from "./ViewPanel.tsx";

interface Props {
  layout: Layout;
  onOp: (op: Op) => void; // manual tweaks by the user (collapse / show), same validated path as the AI
}

function Panel({ slot, region, layout, onOp }: { slot: Slot; region: Region; layout: Layout; onOp: Props["onOp"] }) {
  const view = layout.views[slot.id];
  const lockedOpen = isComponent(slot.id) && CONSTRAINTS.mustBeVisible.includes(slot.id as ComponentId);
  const span = region === "main" ? { sm: 2, md: 3, lg: 6 }[slot.size] : undefined;
  const Component = isComponent(slot.id) ? COMPONENTS[slot.id] : null;
  return (
    <section
      className={`panel ${slot.collapsed ? "collapsed" : ""} ${view ? "is-view" : ""}`}
      style={{ gridColumn: span ? `span ${span}` : undefined, viewTransitionName: `c-${slot.id}` }}
      data-component={slot.id}
    >
      <header className="panel-title">
        <h2>
          {view && <span className="badge">Your view</span>}
          {slotName(layout, slot.id)}
        </h2>
        <span className="panel-tools">
          {view && (
            <button className="btn tiny ghost" title="Remove this view" onClick={() => onOp({ type: "remove_view", id: slot.id })}>
              ✕
            </button>
          )}
          {!lockedOpen && (
            <button
              className="btn tiny ghost"
              title={slot.collapsed ? "Expand" : "Collapse"}
              onClick={() => onOp({ type: "set_collapsed", id: slot.id, collapsed: !slot.collapsed })}
            >
              {slot.collapsed ? "▸" : "▾"}
            </button>
          )}
        </span>
      </header>
      {!slot.collapsed && (
        <div className="panel-body">{view ? <ViewPanel view={view} /> : Component && <Component region={region} />}</div>
      )}
    </section>
  );
}

export function Renderer({ layout, onOp }: Props) {
  const visible = (r: Region) => layout.regions[r].filter((s) => s.visible);
  const hidden = Object.values(layout.regions).flat().filter((s) => !s.visible);
  const sidebar = visible("sidebar");

  return (
    <div className="site">
      <header className="site-header">
        {visible("header").map((s) => {
          const Component = COMPONENTS[s.id as ComponentId];
          return (
            <div key={s.id} className={`header-item header-${s.id}`} style={{ viewTransitionName: `c-${s.id}` }}>
              {Component && <Component region="header" />}
            </div>
          );
        })}
      </header>

      {hidden.length > 0 && (
        <div className="hidden-bar">
          Hidden for you:
          {hidden.map((s) => (
            <button key={s.id} className="chip" onClick={() => onOp({ type: "set_visibility", id: s.id, visible: true })}>
              {slotName(layout, s.id)} · show
            </button>
          ))}
        </div>
      )}

      <div className={`site-body sidebar-${layout.page.sidebarPosition} ${sidebar.length ? "" : "no-sidebar"}`}>
        <main className="region-main">
          {visible("main").map((s) => (
            <Panel key={s.id} slot={s} region="main" layout={layout} onOp={onOp} />
          ))}
        </main>
        {sidebar.length > 0 && (
          <aside className="region-sidebar">
            {sidebar.map((s) => (
              <Panel key={s.id} slot={s} region="sidebar" layout={layout} onOp={onOp} />
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
