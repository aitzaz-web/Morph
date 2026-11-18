// Client side of the company's data: fetched per user, refreshed after actions and every few seconds.
// Components and views keep their data no matter where Morph places them.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppData } from "../server/company.ts";

interface DataContext {
  userId: string;
  data: AppData | null;
  /** Bumps after every change so views know to refetch. */
  version: number;
  refresh: () => void;
}

const Ctx = createContext<DataContext | null>(null);
const POLL_MS = 8000;

export async function api<T>(path: string, userId: string, body?: unknown): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}user=${userId}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    api<AppData>("/api/app", userId)
      .then((d) => alive && setData(d))
      .catch((e) => console.warn("[ledgerly]", e));
    return () => {
      alive = false;
    };
  }, [userId, version]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ userId, data, version, refresh }}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData outside DataProvider");
  return c;
}

export const money = (n: number | string) => `$${Number(n).toLocaleString("en-US")}`;
