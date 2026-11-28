// Request and response shapes of Morph's public API, shared by the service and the SDK.

import type { SurfaceConfig } from "./manifest.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface PageSource {
  source: string;
  css: string;
}

export interface Candidate extends PageSource {
  /** CommonJS for the browser loader. */
  compiled: string;
  /** css wrapped in @scope (.morph-page). */
  scopedCss: string;
}

/** GET /v1/surfaces/:id/page */
export interface PageResponse extends Candidate {
  summary: string;
  /** Saved version id, or null on the company's default page. */
  version: number | null;
  versions: number;
  /** Set when the user's saved page no longer passes the checks and the default is shown instead. */
  stale: string[];
  config: SurfaceConfig;
}

/** POST /v1/surfaces/:id/morph */
export interface MorphRequestBody {
  message: string;
  history?: ChatTurn[];
  /** Set when the browser rendered the last candidate and it broke a company rule on screen. */
  repair?: { page: PageSource; problems: string[] };
}

export interface MorphResponse {
  /** A page that passed the server checks, still to be checked on screen. Null if nothing changed. */
  candidate: Candidate | null;
  summary: string;
  /** Problems the checker found along the way (the model fixed them, or gave up). */
  rejected: string[];
}

/** POST /v1/sessions (server to server, with the company's secret key) */
export interface SessionRequest {
  /** The company's own id for the signed-in user. */
  userId: string;
  /** Optional facts the AI may use, e.g. { name: "Maria Rossi", role: "Office manager" }. No secrets or customer data. */
  attributes?: Record<string, string>;
  /** Token lifetime in seconds (default 3600, max 86400). */
  ttlSeconds?: number;
}

export interface SessionResponse {
  token: string;
  expiresAt: string;
}
