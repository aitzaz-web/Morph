// Styles for Morph's own UI (the Customize panel). Injected once by <MorphSurface>.
// Companies theme it with CSS variables: --morph-accent, --morph-accent-text, --morph-surface,
// --morph-text, --morph-muted, --morph-border, --morph-soft, --morph-bg.

export const MORPH_CSS = `
.morph-chat, .morph-chat-fab {
  --m-accent: var(--morph-accent, #4f46e5); --m-accent-text: var(--morph-accent-text, #fff);
  --m-surface: var(--morph-surface, #fff); --m-text: var(--morph-text, #1d2330); --m-muted: var(--morph-muted, #6b7280);
  --m-border: var(--morph-border, #e3e6eb); --m-soft: var(--morph-soft, #eef0ff); --m-bg: var(--morph-bg, #f5f6f8);
  font-family: inherit; font-size: 14px; box-sizing: border-box;
}
.morph-chat *, .morph-chat *::before, .morph-chat *::after { box-sizing: border-box; }
.morph-chat {
  position: fixed; right: 20px; bottom: 20px; width: 360px; max-height: min(620px, calc(100vh - 40px));
  display: flex; flex-direction: column; background: var(--m-surface); color: var(--m-text);
  border: 1px solid var(--m-border); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.18); z-index: 2147483000;
}
.morph-chat-head { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--m-border); }
.morph-chat-log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 160px; }
.morph-msg { padding: 8px 12px; border-radius: 12px; max-width: 88%; line-height: 1.4; }
.morph-msg.user { align-self: flex-end; background: var(--m-accent); color: var(--m-accent-text); }
.morph-msg.assistant { align-self: flex-start; background: var(--m-soft); }
.morph-msg.error { background: #fee2e2; color: #991b1b; }
.morph-msg.typing { color: var(--m-muted); font-style: italic; }
.morph-changes { margin: 6px 0 0; font-size: 12px; color: var(--m-muted); }
.morph-changes.rejected summary { cursor: pointer; }
.morph-code { margin: 6px 0 0; max-height: 260px; overflow: auto; font-size: 11px; line-height: 1.45; background: var(--m-bg); border: 1px solid var(--m-border); border-radius: 8px; padding: 8px; white-space: pre; }
.morph-suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; }
.morph-chip { font: inherit; font-size: 12px; cursor: pointer; border: 1px solid var(--m-border); background: var(--m-surface); color: var(--m-text); border-radius: 999px; padding: 4px 10px; }
.morph-chip:hover { border-color: var(--m-accent); }
.morph-chat-input { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--m-border); }
.morph-chat-input input { flex: 1; min-width: 0; font: inherit; color: var(--m-text); background: var(--m-surface); border: 1px solid var(--m-border); border-radius: 8px; padding: 7px 10px; }
.morph-btn { font: inherit; font-size: 12px; cursor: pointer; border: 1px solid transparent; background: transparent; color: var(--m-text); border-radius: 8px; padding: 2px 8px; white-space: nowrap; }
.morph-btn:hover:not(:disabled) { border-color: var(--m-border); }
.morph-btn:disabled { opacity: .5; cursor: default; }
.morph-btn.primary { font-size: 14px; padding: 7px 12px; background: var(--m-accent); color: var(--m-accent-text); border-color: var(--m-accent); }
.morph-grow { flex: 1; min-width: 0; }
.morph-muted { color: var(--m-muted); }
.morph-small { font-size: 12px; }
.morph-chat-fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; font-weight: 600; cursor: pointer;
  background: var(--m-accent); color: var(--m-accent-text); border: 0; border-radius: 999px; padding: 12px 18px;
  box-shadow: 0 8px 24px rgba(0,0,0,.2);
}
.morph-page-error { max-width: 720px; margin: 40px auto; padding: 16px; border-radius: 12px; background: #fee2e2; color: #991b1b; font-size: 14px; }
.morph-c { min-width: 0; }
@media (max-width: 900px) { .morph-chat { left: 12px; right: 12px; width: auto; } }
`;
