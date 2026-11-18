import { useEffect, useRef, useState } from "react";
import type { Layout, Op } from "../shared/layout.ts";

interface Message {
  role: "user" | "assistant";
  text: string;
  applied?: string[];
  rejected?: string[];
  error?: boolean;
}

interface Props {
  userId: string;
  layout: Layout;
  onChanges: (ops: Op[], reset: boolean) => void;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
}

const SUGGESTIONS = [
  "Show unpaid invoices over $500 at the top",
  "Hide the promo and the news",
  "Show my invoices as a board by status",
  "Bigger text, calmer colors",
  "Put today's visits first",
];

export function Chat({ userId, layout, onChanges, onUndo, onReset, canUndo }: Props) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I can reshape this page for you: move or hide things, or add a live view of your invoices and customers. What would help?" },
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
      const res = await fetch(`/api/morph?user=${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, layout, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onChanges(data.ops ?? [], !!data.reset);
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
        {busy && <div className="msg assistant typing">Working on it…</div>}
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
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. show overdue invoices first" disabled={busy} />
        <button className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
