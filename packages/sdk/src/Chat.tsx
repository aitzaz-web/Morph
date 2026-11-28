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
  greeting: string;
  suggestions: string[];
  aiAvailable: boolean;
  ask: (message: string, history: { role: "user" | "assistant"; text: string }[]) => Promise<Reply>;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
  /** The current page's code, for the View code toggle. */
  source: string;
  css: string;
}

export function Chat({ greeting, suggestions, aiAvailable, ask, onUndo, onReset, canUndo, source, css }: Props) {
  const [open, setOpen] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: greeting }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

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
      <button className="morph-chat-fab" onClick={() => setOpen(true)}>
        ✦ Customize
      </button>
    );

  return (
    <div className="morph-chat">
      <div className="morph-chat-head">
        <strong>✦ Morph</strong>
        <span className="morph-grow morph-muted">customize this page</span>
        <button className="morph-btn" onClick={() => setShowCode((s) => !s)} title="Show the code for your page">
          {showCode ? "Hide code" : "Code"}
        </button>
        <button className="morph-btn" onClick={onUndo} disabled={!canUndo || busy} title="Go back one version">
          Undo
        </button>
        <button className="morph-btn" onClick={onReset} disabled={!canUndo || busy} title="Back to the default page">
          Reset
        </button>
        <button className="morph-btn" onClick={() => setOpen(false)} title="Close">
          ✕
        </button>
      </div>
      <div className="morph-chat-log" ref={logRef}>
        {!aiAvailable && <div className="morph-msg assistant error">Customizing isn't available right now (Morph's AI isn't configured).</div>}
        {showCode && (
          <div className="morph-msg assistant">
            <div className="morph-small morph-muted">Your page's code (imports only from react, @company and @morph)</div>
            <pre className="morph-code">{source}</pre>
            {css.trim() && <pre className="morph-code">{css}</pre>}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`morph-msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.text}
            {m.changed && <div className="morph-changes">✓ Checked on screen and saved</div>}
            {!!m.blocked?.length && (
              <details className="morph-changes rejected" open>
                <summary>Blocked by site rules</summary>
                {m.blocked.map((r, j) => (
                  <div key={j}>✕ {r}</div>
                ))}
              </details>
            )}
            {!!m.fixedInCode?.length && (
              <details className="morph-changes rejected">
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
        {busy && <div className="morph-msg assistant typing">Writing your page…</div>}
      </div>
      {messages.length <= 1 && suggestions.length > 0 && (
        <div className="morph-suggestions">
          {suggestions.map((s) => (
            <button key={s} className="morph-chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="morph-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. put overdue invoices first" disabled={busy || !aiAvailable} />
        <button className="morph-btn primary" disabled={busy || !aiAvailable || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
