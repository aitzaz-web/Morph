import { createContext, useContext, type ComponentType } from "react";
import type { MorphClient } from "./client.ts";

export const ClientContext = createContext<MorphClient | null>(null);

export function useClient(): MorphClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("Morph: wrap your app in <MorphProvider>.");
  return c;
}

/** Runs one of the company's actions on a row and resolves to a message for the user. */
export type ActionHandler = (key: string) => Promise<string | void> | string | void;
export type Actions = Record<string, Record<string, ActionHandler>>;

/** What the company passes to <MorphSurface>, available to the page's @company and @morph modules. */
export interface SurfaceValue {
  components: Record<string, ComponentType<Record<string, unknown>>>;
  data: unknown;
  actions: Actions;
  /** Allowed props per component import name, from the company's manifest. */
  props: Record<string, Set<string>>;
  /** Allowed actions per source, from the company's manifest. */
  allowedActions: Record<string, string[]>;
}

export const SurfaceContext = createContext<SurfaceValue | null>(null);

export function useSurface(): SurfaceValue {
  const s = useContext(SurfaceContext);
  if (!s) throw new Error("Morph: this can only be used inside a Morph page.");
  return s;
}
