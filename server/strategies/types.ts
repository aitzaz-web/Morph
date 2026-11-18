import type { Layout, Op } from "../../shared/layout.ts";
import type { User } from "../../shared/registry.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface MorphRequest {
  user: User;
  message: string;
  layout: Layout;
  history: ChatTurn[];
}

export interface MorphResult {
  layout: Layout;
  ops: Op[]; // the validated changes, saved as one batch
  reset: boolean; // true if the user's earlier changes should be dropped first
  explanation: string;
  applied: string[];
  rejected: string[];
}

/** A strategy turns a user request plus the current layout into validated changes. */
export type Strategy = (req: MorphRequest) => Promise<MorphResult>;
