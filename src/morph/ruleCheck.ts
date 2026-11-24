// Checks the company's rules by looking at what is actually on screen, so it catches anything the
// code found to hide a component: CSS, zero sizes, overlays, pointer-events, being pushed off screen.

import { REGISTRY } from "../../shared/registry.ts";
import { FOLD_PX, RULES } from "../../shared/rules.ts";

/** Morph's own UI floats over the page and isn't part of it. */
const MORPH_UI = ".chat, .chat-fab, .demo-bar";

function hiddenBy(el: Element, root: Element): string | null {
  let opacity = 1;
  for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === "none") return "display: none";
    if (s.visibility === "hidden" || s.visibility === "collapse") return "visibility: hidden";
    if (s.contentVisibility === "hidden") return "content-visibility: hidden";
    opacity *= Number(s.opacity);
    if (opacity < 0.2) return "it's nearly transparent";
  }
  return null;
}

/** The part a person would click: the first button/link/input inside, or the element itself. */
const target = (el: Element) => el.querySelector("button, a, input, select") ?? el;

function coveredBy(el: Element): string | null {
  const r = target(el).getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null; // off the current screen: can't test
  const hit = document.elementsFromPoint(x, y).find((h) => !h.closest(MORPH_UI));
  if (!hit || el.contains(hit)) return null;
  if (hit.contains(el)) return "it can't be clicked (pointer events are off)";
  const label = hit.getAttribute("data-morph-component") ?? (hit.className && typeof hit.className === "string" ? `.${hit.className.split(" ")[0]}` : hit.tagName.toLowerCase());
  return `something is on top of it (${label})`;
}

/** Readable problems with the page on screen; empty means every rule holds. */
export function checkRules(root: HTMLElement): string[] {
  const problems: string[] = [];
  const rootTop = root.getBoundingClientRect().top;
  const all = [...root.querySelectorAll<HTMLElement>("[data-morph-component]")];

  for (const rule of RULES) {
    const name = `${REGISTRY[rule.component].importName} (${REGISTRY[rule.component].name})`;
    const els = all.filter((e) => e.dataset.morphComponent === rule.component);
    if (!els.length) {
      if (rule.mustShow) problems.push(`${name} isn't on the page. It must always be shown.`);
      continue;
    }
    // If it's on the page more than once, one good copy is enough.
    const reports = els.map((el) => {
      const issues: string[] = [];
      const r = el.getBoundingClientRect();
      const why = hiddenBy(el, root);
      if (why) issues.push(`it's hidden (${why})`);
      else if (r.width < 1 || r.height < 1) issues.push("it has no size on screen");
      if (r.right <= 0 || r.left >= document.documentElement.clientWidth) issues.push("it's pushed off the side of the screen");
      if ((rule.minWidth && r.width < rule.minWidth) || (rule.minHeight && r.height < rule.minHeight))
        issues.push(`it's too small (${Math.round(r.width)}×${Math.round(r.height)}px, needs at least ${rule.minWidth ?? 0}×${rule.minHeight ?? 0}px)`);
      if (rule.aboveFold && r.top - rootTop > FOLD_PX) issues.push(`it's too far down (${Math.round(r.top - rootTop)}px; must start within the first ${FOLD_PX}px)`);
      if (rule.topmost) {
        const higher = all.find((o) => !els.includes(o) && o.getBoundingClientRect().height > 0 && o.getBoundingClientRect().top < r.top - 2);
        if (higher) issues.push(`it must be the topmost part of the page, but ${higher.dataset.morphComponent} is above it`);
      }
      if (rule.notCovered && !issues.length) {
        const cover = coveredBy(el);
        if (cover) issues.push(cover);
      }
      return issues;
    });
    const best = reports.reduce((a, b) => (b.length < a.length ? b : a));
    if (best.length) problems.push(`${name}: ${best.join("; ")}.`);
  }
  return problems;
}
