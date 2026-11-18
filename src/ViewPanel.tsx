// Draws a Morph live view with Morph's own fixed displays. Rows come from the company's
// permission-scoped query; row buttons call the company's own actions.

import { useEffect, useState } from "react";
import { SOURCES, fieldMeta } from "../shared/registry.ts";
import { boardGroups, formatCell, type Row, type ViewSpec } from "../shared/views.ts";
import { api, useData } from "./data.tsx";

function Cell({ view, field, row }: { view: ViewSpec; field: string; row: Row }) {
  const meta = fieldMeta(view.source, field);
  const text = formatCell(meta, row[field]);
  if (field === "status") return <span className={`status ${row.status}`}>{text}</span>;
  if (field === "days_overdue" && Number(row[field]) > 0)
    return <span className={Number(row[field]) >= 14 ? "late bad" : "late"}>{text}</span>;
  return <>{text}</>;
}

function Actions({ view, row, onAct }: { view: ViewSpec; row: Row; onAct: (a: string, key: string) => void }) {
  const src = SOURCES[view.source];
  // Company rule mirrored in the UI: invoice actions only apply to unpaid invoices.
  if (!view.actions.length || (view.source === "invoices" && row.status === "paid")) return null;
  return (
    <span className="row-actions">
      {view.actions.map((a) => (
        <button key={a} className="link-btn" onClick={() => onAct(a, String(row[src.key]))}>
          {src.actions.find((x) => x.id === a)?.label ?? a}
        </button>
      ))}
    </span>
  );
}

export function ViewPanel({ view }: { view: ViewSpec }) {
  const { userId, version, refresh } = useData();
  const [result, setResult] = useState<{ rows: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const spec = JSON.stringify(view);

  useEffect(() => {
    let alive = true;
    api<{ rows: Row[]; total: number }>("/api/rows", userId, { view })
      .then((r) => {
        if (!alive) return;
        setResult(r);
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, version, spec]);

  async function onAct(action: string, key: string) {
    try {
      const r = await api<{ message: string }>("/api/action", userId, { source: view.source, action, key });
      setNote(r.message);
      refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  if (error) return <div className="error-text">{error}</div>;
  if (!result) return <div className="muted small">Loading…</div>;
  const { rows, total } = result;
  const src = SOURCES[view.source];
  const amountField = view.columns.find((c) => fieldMeta(view.source, c)?.type === "money");
  const sum = amountField ? rows.reduce((s, r) => s + Number(r[amountField]), 0) : null;

  const summary = (
    <div className="view-summary">
      <span className="live">● Live</span>
      <span className="grow" />
      <span className="muted">
        {total} {total === 1 ? "item" : "items"}
        {rows.length < total ? ` · showing ${rows.length}` : ""}
      </span>
      {sum !== null && <strong>${sum.toLocaleString("en-US")}</strong>}
    </div>
  );

  let body;
  if (!rows.length) body = <div className="muted">Nothing matches right now.</div>;
  else if (view.display === "table")
    body = (
      <table className="table">
        <thead>
          <tr>
            {view.columns.map((c) => (
              <th key={c} className={fieldMeta(view.source, c)?.type === "money" ? "num" : ""}>
                {fieldMeta(view.source, c)?.label}
              </th>
            ))}
            {view.actions.length > 0 && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[src.key])}>
              {view.columns.map((c, i) => (
                <td key={c} className={`${fieldMeta(view.source, c)?.type === "money" ? "num" : ""} ${i === 0 ? "strong" : ""}`}>
                  <Cell view={view} field={c} row={r} />
                </td>
              ))}
              {view.actions.length > 0 && (
                <td className="right">
                  <Actions view={view} row={r} onAct={onAct} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (view.display === "board")
    body = (
      <div className="board">
        {boardGroups(rows, view).map((g) => (
          <div key={g.key} className={`board-col col-${g.key}`}>
            <div className="board-head">
              <strong>{g.key[0]?.toUpperCase() + g.key.slice(1)}</strong>
              {amountField && <span className="muted">${g.rows.reduce((s, r) => s + Number(r[amountField]), 0).toLocaleString("en-US")}</span>}
            </div>
            {g.rows.map((r) => (
              <Card key={String(r[src.key])} view={view} row={r} onAct={onAct} skip={view.groupBy!} />
            ))}
          </div>
        ))}
      </div>
    );
  else if (view.display === "cards")
    body = (
      <div className="cards">
        {rows.map((r) => (
          <Card key={String(r[src.key])} view={view} row={r} onAct={onAct} />
        ))}
      </div>
    );
  else
    body = (
      <ul className="list">
        {rows.map((r) => (
          <li key={String(r[src.key])} className="row">
            {view.columns.map((c, i) => (
              <span key={c} className={i === 0 ? "grow" : "muted"}>
                <Cell view={view} field={c} row={r} />
              </span>
            ))}
            <Actions view={view} row={r} onAct={onAct} />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="view">
      {summary}
      {body}
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

function Card({ view, row, onAct, skip }: { view: ViewSpec; row: Row; onAct: (a: string, key: string) => void; skip?: string }) {
  const titleField = view.columns.includes(SOURCES[view.source].titleField) ? SOURCES[view.source].titleField : view.columns[0];
  const rest = view.columns.filter((c) => c !== titleField && c !== skip);
  return (
    <div className="card">
      <strong>
        <Cell view={view} field={titleField} row={row} />
      </strong>
      {rest.map((c) => (
        <div key={c} className={fieldMeta(view.source, c)?.type === "money" ? "card-big" : "muted small"}>
          <Cell view={view} field={c} row={row} />
        </div>
      ))}
      <Actions view={view} row={row} onAct={onAct} />
    </div>
  );
}
