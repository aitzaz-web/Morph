// Company rules for AI-written pages. Checked twice: statically on the server (the component is
// imported and used), then in the browser by rendering the page and inspecting what's on screen.

import { REGISTRY, type ComponentId } from "./registry.ts";

export interface ComponentRule {
  component: ComponentId;
  /** Must be on the page, rendered at a real size and not hidden by CSS. */
  mustShow: boolean;
  /** Its top edge must be within the first screen, without scrolling. */
  aboveFold?: boolean;
  /** Nothing may sit on top of it. */
  notCovered?: boolean;
  /** Must be the highest company component on the page. */
  topmost?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export const RULES: ComponentRule[] = [
  { component: "nav", mustShow: true, topmost: true, notCovered: true },
  { component: "create_invoice", mustShow: true, aboveFold: true, notCovered: true, minWidth: 60, minHeight: 24 },
];

/** First screen height used for `aboveFold`, so the rule doesn't depend on the user's window size. */
export const FOLD_PX = 700;

export function describeRule(r: ComponentRule): string {
  const parts = ["must always be shown"];
  if (r.topmost) parts.push("must be the topmost part of the page");
  if (r.aboveFold) parts.push(`must be visible without scrolling (top edge within ${FOLD_PX}px)`);
  if (r.notCovered) parts.push("must not be covered by anything");
  if (r.minWidth || r.minHeight) parts.push(`must be at least ${r.minWidth ?? 0}×${r.minHeight ?? 0}px`);
  return `${REGISTRY[r.component].importName} (${REGISTRY[r.component].name}): ${parts.join(", ")}.`;
}

export const REQUIRED_IMPORTS = RULES.filter((r) => r.mustShow).map((r) => REGISTRY[r.component].importName);
