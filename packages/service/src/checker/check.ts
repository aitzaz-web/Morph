// Checks an AI-written page before it ever reaches a browser, and compiles it.
// 1. Compile TSX (syntax errors go back to the model).
// 2. Walk the syntax tree: imports only from the allowlist, no browser or network APIs, no escape
//    hatches, and the components the company requires are actually used.
// 3. Check the CSS and scope it to the page.
// This is a denylist, not a security boundary: the plan is to run pages in a sandboxed iframe.

import { parse, type Node } from "acorn";
import { ancestor, simple } from "acorn-walk";
import { transform } from "esbuild";
import { ALLOWED_MODULES, ALWAYS_BANNED, BANNED_UNLESS_DECLARED, MORPH_EXPORTS, requiredImports, type Manifest } from "@morph/shared";

export const JSX_FACTORY = "__h";
export const JSX_FRAGMENT = "__Fragment";
export const MAX_SOURCE = 60_000;
export const MAX_CSS = 30_000;

/** Properties that lead out of React into the real DOM or the JS internals. */
export const BANNED_PROPS = [
  "constructor", "__proto__", "prototype", "innerHTML", "outerHTML", "insertAdjacentHTML",
  "ownerDocument", "defaultView", "dangerouslySetInnerHTML", "contentWindow", "contentDocument",
];

export type CheckResult = { ok: true; compiled: string; css: string } | { ok: false; errors: string[] };

type EsbuildError = { errors?: { text: string; location?: { line: number; column: number } | null }[] };

type N = Node & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Names bound by a declaration pattern: `a`, `{ a, b: c }`, `[a, ...rest]`, `a = 1`. */
function patternNames(p: N | null | undefined, out: Set<string>) {
  if (!p) return;
  if (p.type === "Identifier") out.add(p.name);
  else if (p.type === "ObjectPattern") for (const prop of p.properties) patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
  else if (p.type === "ArrayPattern") for (const el of p.elements) patternNames(el, out);
  else if (p.type === "RestElement") patternNames(p.argument, out);
  else if (p.type === "AssignmentPattern") patternNames(p.left, out);
}

/** Every name the page declares anywhere (variables, functions, params, classes, imports). */
function declaredNames(ast: N): Set<string> {
  const names = new Set<string>();
  const fn = (n: N) => {
    if (n.id) names.add(n.id.name);
    for (const p of n.params) patternNames(p, names);
  };
  simple(ast, {
    VariableDeclarator: (n: N) => patternNames(n.id, names),
    FunctionDeclaration: fn,
    FunctionExpression: fn,
    ArrowFunctionExpression: fn,
    ClassDeclaration: (n: N) => n.id && names.add(n.id.name),
    CatchClause: (n: N) => patternNames(n.param, names),
    ImportSpecifier: (n: N) => names.add(n.local.name),
    ImportDefaultSpecifier: (n: N) => names.add(n.local.name),
    ImportNamespaceSpecifier: (n: N) => names.add(n.local.name),
  });
  return names;
}

const keyName = (k: N | undefined): string | null =>
  !k ? null : k.type === "Identifier" ? k.name : k.type === "Literal" && typeof k.value === "string" ? k.value : null;

/** The syntax-tree rules. Returns readable problems; empty means fine. */
function checkTree(esm: string, companyExports: string[], required: string[]): string[] {
  const problems = new Set<string>();
  let ast: N;
  try {
    ast = parse(esm, { ecmaVersion: "latest", sourceType: "module", locations: true }) as N;
  } catch (e) {
    return [`Could not parse the compiled page: ${(e as Error).message}`];
  }

  const companyLocal = new Map<string, string>(); // local name -> import name
  let hasDefault = false;

  for (const node of ast.body as N[]) {
    if (node.type === "ImportDeclaration") {
      const from = String(node.source.value);
      if (!(ALLOWED_MODULES as readonly string[]).includes(from)) {
        problems.add(`Import from "${from}" isn't allowed. Pages may only import from ${ALLOWED_MODULES.map((m) => `"${m}"`).join(", ")}.`);
        continue;
      }
      for (const spec of node.specifiers as N[]) {
        if (from === "react") continue;
        if (spec.type !== "ImportSpecifier") {
          problems.add(`Use named imports from "${from}", e.g. import { ${from === "@company" ? "Nav" : "Panel"} } from "${from}".`);
          continue;
        }
        const name = keyName(spec.imported)!;
        const known = from === "@company" ? companyExports : MORPH_EXPORTS;
        if (!known.includes(name)) problems.add(`"${from}" has no export "${name}". Available: ${known.join(", ")}.`);
        else if (from === "@company") companyLocal.set(spec.local.name, name);
      }
    }
    if (node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && node.source))
      problems.add("Re-exporting from other modules isn't allowed.");
    if (node.type === "ExportDefaultDeclaration") hasDefault = true;
    // esbuild writes `export default function Page` as `function Page() {}; export { Page as default }`.
    if (node.type === "ExportNamedDeclaration" && (node.specifiers as N[]).some((sp) => keyName(sp.exported) === "default")) hasDefault = true;
  }
  if (!hasDefault) problems.add("The page must `export default` a React component.");

  const declared = declaredNames(ast);
  for (const name of ALWAYS_BANNED)
    if (declared.has(name)) problems.add(`"${name}" can't be used as a name in pages. Pick another name.`);

  const usedCompany = new Set<string>();
  ancestor(ast, {
    Identifier(node: N, _state: unknown, ancestors: N[]) {
      const parent = ancestors[ancestors.length - 2];
      if (parent?.type === "ImportSpecifier" || parent?.type === "ImportDefaultSpecifier") return;
      const banned = ALWAYS_BANNED.includes(node.name) || (BANNED_UNLESS_DECLARED.includes(node.name) && !declared.has(node.name));
      if (banned) problems.add(`"${node.name}" isn't available to pages (no direct access to the browser, network or new code).`);
    },
    MemberExpression(node: N) {
      const name = node.computed ? keyName(node.property) : node.property.name;
      if (name && BANNED_PROPS.includes(name)) problems.add(`Accessing ".${name}" isn't allowed.`);
    },
    Property(node: N) {
      const name = node.computed ? null : keyName(node.key);
      if (name && BANNED_PROPS.includes(name)) problems.add(`"${name}" isn't allowed.`);
    },
    ImportExpression() {
      problems.add("Dynamic import() isn't allowed.");
    },
    MetaProperty() {
      problems.add("import.meta isn't allowed.");
    },
    CallExpression(node: N) {
      if (node.callee.type === "Identifier" && node.callee.name === JSX_FACTORY && node.arguments[0]?.type === "Identifier") {
        const imported = companyLocal.get(node.arguments[0].name);
        if (imported) usedCompany.add(imported);
      }
    },
  });

  for (const name of required)
    if (!usedCompany.has(name))
      problems.add(`Company rule: <${name} /> must always be on the page. Import it from "@company" and render it.`);

  return [...problems];
}

/** Checks the CSS and scopes it to the page root. */
export function checkCss(css: string): { css: string; errors: string[] } {
  const errors: string[] = [];
  if (css.length > MAX_CSS) errors.push(`CSS is too long (${css.length} characters, max ${MAX_CSS}).`);
  if (/@import/i.test(css)) errors.push("CSS @import isn't allowed.");
  if (/url\s*\(/i.test(css)) errors.push("CSS url(...) isn't allowed (no outside images or fonts). Use gradients or emoji instead.");
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)) errors.push("That CSS feature isn't allowed.");
  if (/<\/?\s*style/i.test(css)) errors.push("CSS may not contain style tags.");
  return { css: css.trim() ? `@scope (.morph-page) {\n${css}\n}` : "", errors };
}

const formatEsbuild = (e: unknown) =>
  ((e as EsbuildError).errors ?? [{ text: (e as Error).message }])
    .slice(0, 5)
    .map((x) => (x.location ? `Line ${x.location.line}:${x.location.column}: ${x.text}` : x.text));

/** What the checker needs from a company's manifest. */
export type CheckTarget = Pick<Manifest, "components" | "rules">;

/** Checks and compiles a page against one surface's components and rules. The compiled code is CommonJS for the browser's loader. */
export async function checkPage(source: string, css: string, target: CheckTarget): Promise<CheckResult> {
  if (typeof source !== "string" || !source.trim()) return { ok: false, errors: ["The page source is empty."] };
  if (source.length > MAX_SOURCE) return { ok: false, errors: [`The page is too long (${source.length} characters, max ${MAX_SOURCE}).`] };

  let esm: string;
  try {
    esm = (
      await transform(source, {
        loader: "tsx",
        format: "esm",
        jsx: "transform",
        jsxFactory: JSX_FACTORY,
        jsxFragment: JSX_FRAGMENT,
        target: "es2022",
        sourcefile: "page.tsx",
      })
    ).code;
  } catch (e) {
    return { ok: false, errors: formatEsbuild(e) };
  }

  const styled = checkCss(css ?? "");
  const companyExports = target.components.map((c) => c.importName);
  const errors = [...checkTree(esm, companyExports, requiredImports(target as Manifest)), ...styled.errors];
  if (errors.length) return { ok: false, errors };

  try {
    const compiled = (await transform(esm, { loader: "js", format: "cjs", target: "es2022" })).code;
    return { ok: true, compiled, css: styled.css };
  } catch (e) {
    return { ok: false, errors: formatEsbuild(e) };
  }
}
