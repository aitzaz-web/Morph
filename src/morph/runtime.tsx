// Loads and runs an AI-written page that the server has already checked and compiled.
// The page's `require` only knows three modules, and the browser globals it was checked for are
// shadowed with `undefined` as a second layer. Not a security boundary: see server/codegen/check.ts.

import * as React from "react";
import { Component, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { BANNED_GLOBALS } from "../../shared/sdk-api.ts";
import { COMPANY_MODULE } from "./company.tsx";
import { checkRules } from "./ruleCheck.ts";
import { MORPH_MODULE } from "./sdk.tsx";

const MODULES: Record<string, unknown> = { react: React, "@company": COMPANY_MODULE, "@morph": MORPH_MODULE };

// Names the loader itself passes in, plus ones strict mode forbids as parameter names.
const OWN_PARAMS = ["require", "module", "exports", "__h", "__Fragment"];
const SHADOWED = BANNED_GLOBALS.filter((g) => !OWN_PARAMS.includes(g) && g !== "eval");

/** Evaluates compiled page code and returns its default export. Throws a readable error. */
export function loadPage(compiled: string): ComponentType {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name in MODULES) return MODULES[name];
    throw new Error(`Module "${name}" isn't available to pages.`);
  };
  const run = new Function(...OWN_PARAMS, ...SHADOWED, `"use strict";\n${compiled}`);
  run(require, module, module.exports, React.createElement, React.Fragment, ...SHADOWED.map(() => undefined));
  const Page = module.exports.default;
  if (typeof Page !== "function") throw new Error("The page doesn't export a component.");
  return Page as ComponentType;
}

class Boundary extends Component<{ onError: (message: string) => void; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  componentDidCatch(e: Error) {
    this.props.onError(e.message || String(e));
  }
  render() {
    if (this.state.error)
      return (
        <div className="page-error">
          <strong>This version of your page hit an error.</strong>
          <div className="small">{this.state.error}</div>
          <div className="small">Use Undo or Reset in the Morph panel to go back.</div>
        </div>
      );
    return this.props.children;
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

interface HostProps {
  compiled: string;
  scopedCss: string;
  /** When set, the page is a candidate: render it, check the company rules on screen, report back. */
  onChecked?: (problems: string[]) => void;
}

/** Renders a compiled page inside the `.morph-page` root, with its scoped CSS. */
export function PageHost({ compiled, scopedCss, onChecked }: HostProps) {
  const root = useRef<HTMLDivElement>(null);
  const crash = useRef<string | null>(null);
  const loaded = useMemo(() => {
    try {
      return { Page: loadPage(compiled), error: null };
    } catch (e) {
      return { Page: null, error: (e as Error).message };
    }
  }, [compiled]);

  useEffect(() => {
    if (!onChecked) return;
    let cancelled = false;
    (async () => {
      // Let the page and the company components' data settle before looking at the screen.
      await nextFrame();
      await nextFrame();
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;
      if (loaded.error) return onChecked([`The page failed to load: ${loaded.error}`]);
      if (crash.current) return onChecked([`The page crashed while rendering: ${crash.current}`]);
      onChecked(root.current ? checkRules(root.current) : ["The page didn't render."]);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, onChecked]);

  return (
    <div className="morph-page" ref={root}>
      {scopedCss && <style>{scopedCss}</style>}
      {loaded.Page ? (
        <Boundary key={compiled} onError={(m) => (crash.current = m)}>
          <loaded.Page />
        </Boundary>
      ) : (
        <div className="page-error">
          <strong>This version of your page couldn't load.</strong>
          <div className="small">{loaded.error}</div>
        </div>
      )}
    </div>
  );
}
