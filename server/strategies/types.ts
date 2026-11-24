import type { User } from "../../shared/registry.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface PageSource {
  source: string;
  css: string;
}

export interface MorphRequest {
  user: User;
  message: string;
  /** The page the user is looking at now (or, for a repair, the version that failed on screen). */
  page: PageSource;
  history: ChatTurn[];
  /** Set when the browser rendered the last candidate and it broke a company rule on screen. */
  repair?: { problems: string[] };
}

export interface Candidate extends PageSource {
  compiled: string; // CommonJS for the browser loader
  scopedCss: string; // css wrapped in @scope (.morph-page)
}

export interface MorphResult {
  /** A page that passed the server checks, still to be checked on screen. Null if nothing changed. */
  candidate: Candidate | null;
  summary: string;
  /** Problems the checker found along the way (the model fixed them, or gave up). */
  rejected: string[];
}

/** A strategy turns a user request plus the current page into a checked candidate page. */
export type Strategy = (req: MorphRequest) => Promise<MorphResult>;
