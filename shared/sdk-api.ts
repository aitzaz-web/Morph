// What AI-written pages may import, described once for both the code checker and the prompt.
// The real implementations live in src/morph/company.tsx and src/morph/sdk.tsx.

export const ALLOWED_MODULES = ["react", "@company", "@morph"] as const;

export const MORPH_API: Record<string, string> = {
  useCompanyData:
    "() => AppData | null. The company's data for this user, already filtered by their permissions; null while loading. Re-renders when data changes.",
  useAction:
    '() => run(source, action, key) => Promise<string>. Runs one of the company\'s own actions, e.g. run("invoices", "send_reminder", "INV-1040"). Resolves to a message to show the user. The only way to change data.',
  Panel:
    "<Panel title? actions? collapsible? defaultCollapsed? className? style?>children</Panel>. A card in Ledgerly's house style with an optional title bar.",
  money: "(n) => string. Formats dollars, e.g. $4,200.",
  shortDate: '(isoDate) => string. Formats a date as "Nov 3".',
};

export const MORPH_EXPORTS = Object.keys(MORPH_API);

/** Globals the page may never reference, even under its own name: the DOM, the network, new code. */
export const ALWAYS_BANNED = [
  "window", "document", "globalThis", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "localStorage", "sessionStorage", "indexedDB", "cookieStore", "eval", "Function", "Worker",
  "SharedWorker", "importScripts", "postMessage", "Reflect", "Proxy",
];

/** Globals that are fine as the page's own variable names (e.g. `const [open, setOpen]`), but not as globals. */
export const BANNED_UNLESS_DECLARED = [
  "self", "top", "parent", "frames", "opener", "navigator", "location", "history", "caches",
  "open", "alert", "confirm", "prompt", "print", "process", "require", "module", "exports",
];

/** Every banned global; the browser loader also shadows these with `undefined`. */
export const BANNED_GLOBALS = [...ALWAYS_BANNED, ...BANNED_UNLESS_DECLARED];
