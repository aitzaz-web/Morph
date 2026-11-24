import { useCallback, useEffect, useRef, useState } from "react";
import { USERS } from "../shared/registry.ts";
import { Chat, type Reply } from "./Chat.tsx";
import { DataProvider } from "./data.tsx";
import { PageHost } from "./morph/runtime.tsx";

interface Page {
  source: string;
  css: string;
  compiled: string;
  scopedCss: string;
  summary: string;
  version: number | null;
  versions: number;
  stale: string[];
}

type Candidate = Pick<Page, "source" | "css" | "compiled" | "scopedCss">;
type Status = "loading" | "saved" | "checking" | "saving" | "error";

/** How many times the AI may fix a page that broke a rule on screen before we give up. */
const MAX_REPAIRS = 2;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function App() {
  const [userId, setUserId] = useState(() => new URLSearchParams(location.search).get("user") ?? "maria");
  const [page, setPage] = useState<Page | null>(null);
  const [candidate, setCandidate] = useState<(Candidate & { n: number }) | null>(null);
  const attempts = useRef(0);
  const [status, setStatus] = useState<Status>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Resolves when the candidate on screen has been checked.
  const pendingCheck = useRef<((problems: string[]) => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await json<Page>(await fetch(`/api/page?user=${userId}`));
      setPage(p);
      setLoadError(null);
      setStatus("saved");
    } catch (e) {
      setLoadError((e as Error).message);
      setStatus("error");
    }
  }, [userId]);

  useEffect(() => {
    setPage(null);
    setCandidate(null);
    setStatus("loading");
    load();
    const url = new URL(location.href);
    url.searchParams.set("user", userId);
    history.replaceState(null, "", url);
  }, [userId, load]);

  /** Shows a candidate in place of the current page and waits for the on-screen rule check. */
  const tryOnScreen = (c: Candidate) =>
    new Promise<string[]>((resolve) => {
      pendingCheck.current = resolve;
      setCandidate({ ...c, n: ++attempts.current });
    });

  const onChecked = useCallback((problems: string[]) => {
    pendingCheck.current?.(problems);
    pendingCheck.current = null;
  }, []);

  /** One chat request: ask the AI, check its page on screen, let it repair, then save or revert. */
  async function ask(message: string, history: { role: "user" | "assistant"; text: string }[]): Promise<Reply> {
    type MorphResponse = { candidate: Candidate | null; summary: string; rejected: string[] };
    const post = (body: unknown) =>
      fetch(`/api/morph?user=${userId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(
        (r) => json<MorphResponse>(r),
      );

    let res = await post({ message, history });
    const fixedInCode = [...res.rejected];
    if (!res.candidate) return { text: res.summary, fixedInCode };

    let problems: string[] = [];
    for (let attempt = 0; ; attempt++) {
      setStatus("checking");
      problems = await tryOnScreen(res.candidate!);
      if (!problems.length) break;
      if (attempt >= MAX_REPAIRS) {
        setCandidate(null);
        setStatus("saved");
        return { text: "I couldn't make that work without breaking the site's rules, so I kept your page as it was.", blocked: problems, fixedInCode };
      }
      const failed = res.candidate!;
      res = await post({ message, history, repair: { page: { source: failed.source, css: failed.css }, problems } });
      fixedInCode.push(...res.rejected);
      if (!res.candidate) {
        setCandidate(null);
        setStatus("saved");
        return { text: res.summary, blocked: problems, fixedInCode };
      }
    }

    setStatus("saving");
    try {
      await json(
        await fetch(`/api/page?user=${userId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: res.candidate!.source, css: res.candidate!.css, summary: res.summary }),
        }),
      );
      await load();
    } catch (e) {
      setStatus("error");
      return { text: `Your new page works but couldn't be saved: ${(e as Error).message}`, fixedInCode };
    } finally {
      setCandidate(null);
    }
    return { text: res.summary, fixedInCode, changed: true };
  }

  const undo = async () => {
    await fetch(`/api/page/undo?user=${userId}`, { method: "POST" });
    await load();
  };
  const reset = async () => {
    await fetch(`/api/page?user=${userId}`, { method: "DELETE" });
    await load();
  };

  const user = USERS[userId];
  const shown = candidate ?? page;
  const statusText =
    status === "loading"
      ? "Loading your page…"
      : status === "checking"
        ? "Checking the new page against the site's rules…"
        : status === "saving"
          ? "Saving…"
          : status === "error"
            ? "Couldn't load or save"
            : page?.version
              ? `Your page · version ${page.versions} · saved to ${user?.name.split(" ")[0]}'s account`
              : "Default page";

  return (
    <DataProvider userId={userId}>
      <div className="app">
        <div className="demo-bar">
          <span>Demo · signed in as</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!!candidate}>
            {Object.values(USERS).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <span className="grow" />
          <span className={`save save-${status}`}>{statusText}</span>
          {!!page?.stale.length && <span className="muted">· your saved page no longer passes the checks, showing the default</span>}
        </div>

        {loadError && <div className="page-error">{loadError}</div>}
        {shown && (
          <PageHost
            key={candidate ? `candidate-${candidate.n}` : `page-${page?.version}`}
            compiled={shown.compiled}
            scopedCss={shown.scopedCss}
            onChecked={candidate ? onChecked : undefined}
          />
        )}

        {page && (
          <Chat
            key={userId}
            ask={ask}
            onUndo={undo}
            onReset={reset}
            canUndo={page.versions > 0}
            source={page.source}
            css={page.css}
          />
        )}
      </div>
    </DataProvider>
  );
}
