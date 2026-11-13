import type { Layout } from "../../shared/layout.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface MorphRequest {
  message: string;
  layout: Layout;
  history: ChatTurn[];
}

export interface MorphResult {
  layout: Layout;
  explanation: string;
  applied: string[];
  rejected: string[];
}

/** A strategy turns a user request plus the current layout into a new (validated) layout. */
export type Strategy = (req: MorphRequest) => Promise<MorphResult>;
