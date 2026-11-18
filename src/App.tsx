import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { applyOp, replay, type Batch, type Op } from "../shared/layout.ts";
import { USERS } from "../shared/registry.ts";
import { Chat } from "./Chat.tsx";
import { DataProvider } from "./data.tsx";
import { Renderer } from "./Renderer.tsx";

// Animate between layouts where the browser supports View Transitions.
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition) doc.startViewTransition(() => flushSync(update));
  else update();
}

type SaveState = "loading" | "saved" | "saving" | "error";

export function App() {
  const [userId, setUserId] = useState(() => new URLSearchParams(location.search).get("user") ?? "maria");
  // The user's saved changes, one batch per request or click. The layout is rebuilt from these.
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [save, setSave] = useState<SaveState>("loading");

  useEffect(() => {
    setBatches(null);
    setSave("loading");
    fetch(`/api/layout?user=${userId}`)
      .then((r) => r.json())
      .then((d) => {
        setBatches(d.batches ?? []);
        setSkipped(d.skipped ?? 0);
        setSave("saved");
      })
      .catch(() => {
        setBatches([]);
        setSave("error");
      });
    const url = new URL(location.href);
    url.searchParams.set("user", userId);
    history.replaceState(null, "", url);
  }, [userId]);

  const layout = useMemo(() => replay(batches ?? []).layout, [batches]);

  const persist = (next: Batch[]) => {
    transition(() => setBatches(next));
    setSave("saving");
    fetch(`/api/layout?user=${userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batches: next }) })
      .then((r) => setSave(r.ok ? "saved" : "error"))
      .catch(() => setSave("error"));
  };

  // A click on the page (collapse, show, remove view): one-change batch, same validation as the AI.
  const onOp = (op: Op) => {
    try {
      applyOp(layout, op);
      persist([...(batches ?? []), [op]]);
    } catch (e) {
      console.warn("[morph]", (e as Error).message);
    }
  };

  const onAiChanges = (ops: Op[], reset: boolean) => {
    const base = reset ? [] : (batches ?? []);
    if (!ops.length && !reset) return;
    persist(ops.length ? [...base, ops] : base);
  };

  const user = USERS[userId];

  return (
    <DataProvider userId={userId}>
      <div className={`app theme-${layout.page.theme} density-${layout.page.density} text-${layout.page.textSize}`}>
        <div className="demo-bar">
          <span>Demo · signed in as</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {Object.values(USERS).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <span className="grow" />
          <span className={`save save-${save}`}>
            {save === "loading" ? "Loading layout…" : save === "saving" ? "Saving…" : save === "error" ? "Couldn't save" : (batches?.length ?? 0) > 0 ? `Your layout · saved to ${user?.name.split(" ")[0]}'s account` : "Default layout"}
          </span>
          {skipped > 0 && <span className="muted">· {skipped} old change{skipped > 1 ? "s" : ""} no longer apply</span>}
        </div>
        {batches && <Renderer layout={layout} onOp={onOp} />}
        {batches && (
          <Chat
            key={userId}
            userId={userId}
            layout={layout}
            onChanges={onAiChanges}
            onUndo={() => persist((batches ?? []).slice(0, -1))}
            onReset={() => persist([])}
            canUndo={(batches?.length ?? 0) > 0}
          />
        )}
      </div>
    </DataProvider>
  );
}
