import type { Candidate, ChatTurn, Manifest, MorphResponse, PageSource } from "@morph/shared";

/** The signed-in user, as the company described them when it opened the session. */
export interface EndUser {
  id: string;
  attributes: Record<string, string>;
}

export interface MorphRequest {
  manifest: Manifest;
  user: EndUser;
  message: string;
  /** The page the user is looking at now (or, for a repair, the version that failed on screen). */
  page: PageSource;
  history: ChatTurn[];
  /** Set when the browser rendered the last candidate and it broke a company rule on screen. */
  repair?: { problems: string[] };
}

export type { Candidate, ChatTurn, PageSource };
export type MorphResult = MorphResponse;

/** A strategy turns a user request plus the current page into a checked candidate page. */
export type Strategy = (req: MorphRequest) => Promise<MorphResult>;
