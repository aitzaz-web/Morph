import { useEffect, useRef, useState } from "react";

/** What one chat request produced, as shown in the panel. */
export interface Reply {
  text: string;
  /** The page changed and was saved. */
  changed?: boolean;
  /** Company rules the AI's page broke on screen and couldn't fix. */
  blocked?: string[];
  /** Problems the code checker found and the AI fixed before showing anything. */
  fixedInCode?: string[];
}

interface Message extends Reply {
  role: "user" | "assistant";
  error?: boolean;
}

interface Props {
  ask: (message: string, history: { role: "user" | "assistant"; text: string }[]) => Promise<Reply>;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
  /** The current page's code, for the View code toggle. */
  source: string;
  css: string;
}

const SUGGESTIONS = [
  "Put invoices and customers in tabs",
  "Show unpaid invoices as a board by status, with a reminder button on each",
  "Add a big banner at the top with my total overdue amount",
  "Dark mode, and hide the promo and news",
  "Make it a simple one-column page for my phone",
];

export function Chat({ ask, onUndo, onReset, canUndo, source, css }: Props) {
  const [open, setOpen] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! Tell me how you'd like this page to work: rearrange it, restyle it, or add new ways to see your invoices and customers." },
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
      const reply = await ask(message, history);
      setMessages((m) => [...m, { role: "assistant", ...reply }]);
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
        <button className="btn tiny ghost" onClick={() => setShowCode((s) => !s)} title="Show the code for your page">
          {showCode ? "Hide code" : "Code"}
        </button>
        <button className="btn tiny ghost" onClick={onUndo} disabled={!canUndo || busy} title="Go back one version">
          Undo
        </button>
        <button className="btn tiny ghost" onClick={onReset} disabled={!canUndo || busy} title="Back to the default page">
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
        {showCode && (
          <div className="msg assistant">
            <div className="small muted">Your page's code (imports only from react, @company and @morph)</div>
            <pre className="code-view">{source}</pre>
            {css.trim() && <pre className="code-view">{css}</pre>}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.text}
            {m.changed && <div className="changes">✓ Checked on screen and saved</div>}
            {!!m.blocked?.length && (
              <details className="changes rejected" open>
                <summary>Blocked by site rules</summary>
                {m.blocked.map((r, j) => (
                  <div key={j}>✕ {r}</div>
                ))}
              </details>
            )}
            {!!m.fixedInCode?.length && (
              <details className="changes rejected">
                <summary>
                  {m.fixedInCode.length} code problem{m.fixedInCode.length > 1 ? "s" : ""} caught by the checker
                </summary>
                {m.fixedInCode.map((r, j) => (
                  <div key={j}>· {r}</div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant typing">Writing your page…</div>}
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
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. put overdue invoices first" disabled={busy} />
        <button className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
