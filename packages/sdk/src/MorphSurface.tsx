// <MorphProvider> connects the app to Morph; <MorphSurface> is one area users can reshape.
//
//   <MorphProvider serviceUrl="https://morph.example" getToken={() => fetchTokenFromYourServer()}>
//     <MorphSurface id="dashboard" components={{ Nav, Invoices }} data={data} actions={{ invoices: { mark_paid } }} />
//   </MorphProvider>
//
// The surface loads the user's page from Morph, renders it with only the company's components and
// Morph's helpers, and runs the chat: ask the AI, render its page, check the company's rules on
// screen, let it repair up to twice, then save it or keep the old page.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Candidate, ChatTurn, MorphResponse, PageResponse } from "@morph/shared";
import { Chat, type Reply } from "./Chat.tsx";
import { MorphClient, MorphError } from "./client.ts";
import { ClientContext, SurfaceContext, useClient, type Actions, type SurfaceValue } from "./context.ts";
import { MORPH_MODULE, companyModule } from "./modules.tsx";
import { MORPH_UI } from "./ruleCheck.ts";
import { PageHost } from "./runtime.tsx";
import { MORPH_CSS } from "./styles.ts";

export interface MorphProviderProps {
  /** Where Morph's service runs, e.g. https://morph.example.com */
  serviceUrl: string;
  /** Returns a Morph session token for the signed-in user, from your own server. */
  getToken: () => Promise<string>;
  children: ReactNode;
}

export function MorphProvider({ serviceUrl, getToken, children }: MorphProviderProps) {
  const tokenFn = useRef(getToken);
  tokenFn.current = getToken;
  const client = useMemo(() => new MorphClient({ serviceUrl, getToken: () => tokenFn.current() }), [serviceUrl]);
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export interface MorphSurfaceProps {
  /** The surface id you registered with `morph push`. */
  id: string;
  /** Your real components, by the import names in your manifest. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: Record<string, ComponentType<any>>;
  /** What pages read with useCompanyData(): this user's data, already filtered by your permissions. */
  data: unknown;
  /** Handlers for the actions in your manifest: { source: { action: (rowKey) => message } }. */
  actions?: Actions;
  /** Show the Customize panel (default true). */
  chat?: boolean;
  /** Extra floating UI of yours the on-screen rule check should look through (CSS selector). */
  ignoreSelector?: string;
  /** Shown while the page loads. */
  fallback?: ReactNode;
  /** Called when saving, loading or the AI fails, e.g. to log it. */
  onError?: (error: Error) => void;
}

type Status = "loading" | "ready" | "checking" | "saving" | "error";

/** How many times the AI may fix a page that broke a rule on screen before we give up. */
const MAX_REPAIRS = 2;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-morph", "");
  style.textContent = MORPH_CSS;
  document.head.appendChild(style);
}

export function MorphSurface({ id, components, data, actions = {}, chat = true, ignoreSelector, fallback = null, onError }: MorphSurfaceProps) {
  const client = useClient();
  const [page, setPage] = useState<PageResponse | null>(null);
  const [candidate, setCandidate] = useState<(Candidate & { n: number }) | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const attempts = useRef(0);
  const pendingCheck = useRef<((problems: string[]) => void) | null>(null);
  const report = useRef(onError);
  report.current = onError;

  useEffect(injectCss, []);

  const base = `/v1/surfaces/${encodeURIComponent(id)}`;

  const load = useCallback(async () => {
    try {
      setPage(await client.request<PageResponse>("GET", `${base}/page`));
      setLoadError(null);
      setStatus("ready");
    } catch (e) {
      setLoadError((e as Error).message);
      setStatus("error");
      report.current?.(e as Error);
    }
  }, [client, base]);

  useEffect(() => {
    setPage(null);
    setCandidate(null);
    setStatus("loading");
    load();
  }, [load]);

  const config = page?.config;
  // Rebuilt only when the manifest's component list changes, so pages don't remount on every render.
  const configKey = JSON.stringify(config?.components ?? []);
  const modules = useMemo(
    () => (config ? { "@company": companyModule(config), "@morph": MORPH_MODULE } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey],
  );
  const surface: SurfaceValue = useMemo(
    () => ({
      components: components as SurfaceValue["components"],
      data,
      actions,
      props: Object.fromEntries((config?.components ?? []).map((c) => [c.importName, new Set(c.props)])),
      allowedActions: config?.actions ?? {},
    }),
    [components, data, actions, config],
  );

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

  const keepOld = () => {
    setCandidate(null);
    setStatus("ready");
  };

  /** One chat request: ask the AI, check its page on screen, let it repair, then save or revert. */
  async function ask(message: string, history: ChatTurn[]): Promise<Reply> {
    const post = (body: unknown) => client.request<MorphResponse>("POST", `${base}/morph`, body);

    let res = await post({ message, history });
    const fixedInCode = [...res.rejected];
    if (!res.candidate) return { text: res.summary, fixedInCode };

    for (let attempt = 0; ; attempt++) {
      setStatus("checking");
      const problems = await tryOnScreen(res.candidate!);
      if (!problems.length) break;
      if (attempt >= MAX_REPAIRS) {
        keepOld();
        return { text: "I couldn't make that work without breaking the site's rules, so I kept your page as it was.", blocked: problems, fixedInCode };
      }
      const failed = res.candidate!;
      res = await post({ message, history, repair: { page: { source: failed.source, css: failed.css }, problems } });
      fixedInCode.push(...res.rejected);
      if (!res.candidate) {
        keepOld();
        return { text: res.summary, blocked: problems, fixedInCode };
      }
    }

    setStatus("saving");
    try {
      await client.request("PUT", `${base}/page`, { source: res.candidate!.source, css: res.candidate!.css, summary: res.summary });
      await load();
    } catch (e) {
      setStatus("error");
      report.current?.(e as Error);
      const why = e instanceof MorphError && e.problems.length ? ` (${e.problems.join(" ")})` : "";
      return { text: `Your new page works but couldn't be saved: ${(e as Error).message}${why}`, fixedInCode };
    } finally {
      setCandidate(null);
    }
    return { text: res.summary, fixedInCode, changed: true };
  }

  const askSafely = async (message: string, history: ChatTurn[]) => {
    try {
      return await ask(message, history);
    } catch (e) {
      keepOld();
      report.current?.(e as Error);
      throw e;
    }
  };

  const undo = async () => {
    await client.request("POST", `${base}/page/undo`);
    await load();
  };
  const reset = async () => {
    await client.request("DELETE", `${base}/page`);
    await load();
  };

  if (!page) return loadError ? <div className="morph-page-error">Couldn't load this page: {loadError}</div> : <>{fallback}</>;

  const shown = candidate ?? page;
  const ignore = ignoreSelector ? `${MORPH_UI}, ${ignoreSelector}` : MORPH_UI;

  return (
    <SurfaceContext.Provider value={surface}>
      <div className="morph-surface" data-morph-surface={id} data-morph-status={status}>
        <PageHost
          key={candidate ? `candidate-${candidate.n}` : `page-${page.version}`}
          compiled={shown.compiled}
          scopedCss={shown.scopedCss}
          modules={modules}
          config={page.config}
          ignoreSelector={ignore}
          onChecked={candidate ? onChecked : undefined}
        />
      </div>
      {chat && (
        <Chat
          greeting={page.config.chat.greeting}
          suggestions={page.config.chat.suggestions}
          aiAvailable={page.config.aiAvailable}
          ask={askSafely}
          onUndo={undo}
          onReset={reset}
          canUndo={page.versions > 0}
          source={page.source}
          css={page.css}
        />
      )}
    </SurfaceContext.Provider>
  );
}
