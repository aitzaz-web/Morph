// Ledgerly's client-side data: fetched for the signed-in user (cookie session), refreshed after
// changes and every few seconds. Ledgerly's components read it here; Morph pages get the same
// object through <MorphSurface data>.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppData } from "../server/company.ts";

interface DataContext {
  data: AppData | null;
  /** Bumps after every change so views know to refetch. */
  version: number;
  refresh: () => void;
}

const Ctx = createContext<DataContext | null>(null);
const POLL_MS = 8000;

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    api<AppData>("/api/app")
      .then((d) => alive && setData(d))
      .catch((e) => console.warn("[ledgerly]", e));
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ data, version, refresh }}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

export const money = (n: number | string) => `$${Number(n).toLocaleString("en-US")}`;
