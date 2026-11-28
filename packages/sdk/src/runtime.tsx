// Loads and runs an AI-written page that the server has already checked and compiled.
// The page's `require` only knows three modules, and the browser globals it was checked for are
// shadowed with `undefined` as a second layer. Not a security boundary: that's the planned sandboxed iframe.

import * as React from "react";
import { Component, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { BANNED_GLOBALS, type SurfaceConfig } from "@morph/shared";
import { checkRules } from "./ruleCheck.ts";

export type PageModules = Record<string, unknown>;

// Names the loader itself passes in, plus ones strict mode forbids as parameter names.
const OWN_PARAMS = ["require", "module", "exports", "__h", "__Fragment"];
const SHADOWED = BANNED_GLOBALS.filter((g) => !OWN_PARAMS.includes(g) && g !== "eval");

/** Evaluates compiled page code and returns its default export. Throws a readable error. */
export function loadPage(compiled: string, modules: PageModules): ComponentType {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name === "react") return React;
    if (Object.hasOwn(modules, name)) return modules[name];
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
        <div className="morph-page-error">
          <strong>This version of your page hit an error.</strong>
          <div className="morph-small">{this.state.error}</div>
          <div className="morph-small">Use Undo or Reset in the Customize panel to go back.</div>
        </div>
      );
    return this.props.children;
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

interface HostProps {
  compiled: string;
  modules: PageModules;
  config: SurfaceConfig;
  /** Morph's own floating UI, plus anything else the rule check should look through. */
  ignoreSelector: string;
  scopedCss: string;
  /** When set, the page is a candidate: render it, check the company rules on screen, report back. */
  onChecked?: (problems: string[]) => void;
}

/** Renders a compiled page inside the `.morph-page` root, with its scoped CSS. */
export function PageHost({ compiled, modules, config, ignoreSelector, scopedCss, onChecked }: HostProps) {
  const root = useRef<HTMLDivElement>(null);
  const crash = useRef<string | null>(null);
  const loaded = useMemo(() => {
    try {
      return { Page: loadPage(compiled, modules), error: null };
    } catch (e) {
      return { Page: null, error: (e as Error).message };
    }
  }, [compiled, modules]);

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
      onChecked(root.current ? checkRules(root.current, config, ignoreSelector) : ["The page didn't render."]);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, onChecked, config, ignoreSelector]);

  return (
    <div className="morph-page" ref={root}>
      {scopedCss && <style>{scopedCss}</style>}
      {loaded.Page ? (
        <Boundary key={compiled} onError={(m) => (crash.current = m)}>
          <loaded.Page />
        </Boundary>
      ) : (
        <div className="morph-page-error">
          <strong>This version of your page couldn't load.</strong>
          <div className="morph-small">{loaded.error}</div>
        </div>
      )}
    </div>
  );
}
