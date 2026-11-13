import { useState } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_LAYOUT, applyOp, clone, validateLayout, type Layout, type Op } from "../shared/layout.ts";
import { Chat } from "./Chat.tsx";
import { Renderer } from "./Renderer.tsx";
import { StoreProvider } from "./store.tsx";

// Animate between layouts where the browser supports View Transitions.
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition) doc.startViewTransition(() => flushSync(update));
  else update();
}

export function App() {
  const [layout, setLayout] = useState<Layout>(() => clone(DEFAULT_LAYOUT));
  const [past, setPast] = useState<Layout[]>([]);

  const commit = (next: Layout) => {
    const errors = validateLayout(next);
    if (errors.length) {
      console.warn("[morph] rejected invalid layout", errors);
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(layout)) return;
    transition(() => {
      setPast((p) => [...p.slice(-49), layout]);
      setLayout(next);
    });
  };

  const onOp = (op: Op) => {
    try {
      commit(applyOp(layout, op));
    } catch (e) {
      console.warn("[morph]", (e as Error).message);
    }
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    transition(() => {
      setPast((p) => p.slice(0, -1));
      setLayout(prev);
    });
  };

  return (
    <StoreProvider>
      <div className={`app theme-${layout.page.theme} density-${layout.page.density}`}>
        <Renderer layout={layout} onOp={onOp} />
        <Chat layout={layout} onLayout={commit} onUndo={undo} onReset={() => commit(clone(DEFAULT_LAYOUT))} canUndo={past.length > 0} />
      </div>
    </StoreProvider>
  );
}
