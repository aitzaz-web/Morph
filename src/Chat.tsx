import { useEffect, useRef, useState } from "react";
import type { Layout } from "../shared/layout.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
  applied?: string[];
  rejected?: string[];
  error?: boolean;
}

interface Props {
  layout: Layout;
  onLayout: (layout: Layout) => void;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
}

const SUGGESTIONS = ["Put my orders first", "Hide recommendations", "Make it simpler", "Move the cart to the left", "Dark mode please"];

export function Chat({ layout, onLayout, onUndo, onReset, canUndo }: Props) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I can rearrange this page for you. Tell me what you'd like to see first, hide, or simplify." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyMissing, setKeyMissing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setKeyMissing(!h.hasKey))
      .catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    const history = messages.slice(1).filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMessages((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/morph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, layout, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onLayout(data.layout);
      setMessages((m) => [...m, { role: "assistant", text: data.explanation, applied: data.applied, rejected: data.rejected }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="chat-fab" onClick={() => setOpen(true)}>
        ✦ Customize
      </button>
    );

  return (
    <div className="chat">
      <div className="chat-head">
        <strong>✦ Morph</strong>
        <span className="grow muted">customize this page</span>
        <button className="btn tiny ghost" onClick={onUndo} disabled={!canUndo} title="Undo last change">
          Undo
        </button>
        <button className="btn tiny ghost" onClick={onReset} title="Back to default layout">
          Reset
        </button>
        <button className="btn tiny ghost" onClick={() => setOpen(false)} title="Close">
          ✕
        </button>
      </div>
      <div className="chat-log" ref={logRef}>
        {keyMissing && (
          <div className="msg assistant error">No API key on the server. Add OPENAI_API_KEY to .env and restart `npm run dev`.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.text}
            {!!m.applied?.length && (
              <ul className="changes">
                {m.applied.map((a, j) => (
                  <li key={j}>✓ {a}</li>
                ))}
              </ul>
            )}
            {!!m.rejected?.length && (
              <details className="changes rejected">
                <summary>{m.rejected.length} blocked by site rules</summary>
                {m.rejected.map((r, j) => (
                  <div key={j}>✕ {r}</div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant typing">Rearranging…</div>}
      </div>
      {messages.length <= 1 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. put my orders at the top" disabled={busy} />
        <button className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
