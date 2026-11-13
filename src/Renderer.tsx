// Turns layout JSON into the real components. The only place layout is interpreted.

import { CONSTRAINTS, type Layout, type Op, type Slot } from "../shared/layout.ts";
import { REGISTRY, type Region } from "../shared/registry.ts";
import { COMPONENTS } from "./components/StoreComponents.tsx";

interface Props {
  layout: Layout;
  onOp: (op: Op) => void; // manual tweaks by the user (collapse / show), same validated path as the AI
}

function Panel({ slot, region, onOp }: { slot: Slot; region: Region; onOp: Props["onOp"] }) {
  const meta = REGISTRY[slot.id];
  const Component = COMPONENTS[slot.id];
  const lockedOpen = CONSTRAINTS.mustBeVisible.includes(slot.id);
  const span = region === "main" ? { sm: 2, md: 3, lg: 6 }[slot.size] : undefined;
  return (
    <section
      className={`panel ${slot.collapsed ? "collapsed" : ""}`}
      style={{ gridColumn: span ? `span ${span}` : undefined, viewTransitionName: `c-${slot.id}` }}
      data-component={slot.id}
    >
      <header className="panel-title">
        <h2>{meta.name}</h2>
        {!lockedOpen && (
          <button
            className="btn tiny ghost"
            title={slot.collapsed ? "Expand" : "Collapse"}
            onClick={() => onOp({ type: "set_collapsed", id: slot.id, collapsed: !slot.collapsed })}
          >
            {slot.collapsed ? "▸" : "▾"}
          </button>
        )}
      </header>
      {!slot.collapsed && (
        <div className="panel-body">
          <Component region={region} />
        </div>
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
          const Component = COMPONENTS[s.id];
          return (
            <div key={s.id} className={`header-item header-${s.id}`} style={{ viewTransitionName: `c-${s.id}` }}>
              <Component region="header" />
            </div>
          );
        })}
      </header>

      {hidden.length > 0 && (
        <div className="hidden-bar">
          Hidden:
          {hidden.map((s) => (
            <button key={s.id} className="chip" onClick={() => onOp({ type: "set_visibility", id: s.id, visible: true })}>
              {REGISTRY[s.id].name} · show
            </button>
          ))}
        </div>
      )}

      <div className={`site-body sidebar-${layout.page.sidebarPosition} ${sidebar.length ? "" : "no-sidebar"}`}>
        <main className="region-main">
          {visible("main").map((s) => (
            <Panel key={s.id} slot={s} region="main" onOp={onOp} />
          ))}
        </main>
        {sidebar.length > 0 && (
          <aside className="region-sidebar">
            {sidebar.map((s) => (
              <Panel key={s.id} slot={s} region="sidebar" onOp={onOp} />
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
