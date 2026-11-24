import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkCss, checkPage } from "./check.ts";

const DEFAULT = readFileSync(new URL("../../src/morph/default-page.tsx", import.meta.url), "utf8");

/** A minimal page that follows the rules, with `body` inside the component and `extra` before it. */
const page = (body = "", extra = "", jsx = "<div><Nav /><CreateInvoice /></div>") => `
import { useState } from "react";
import { Nav, CreateInvoice } from "@company";
${extra}
export default function Page() {
  ${body}
  return ${jsx};
}`;

async function problems(source: string, css = "") {
  const r = await checkPage(source, css);
  return r.ok ? [] : r.errors;
}

describe("checkPage", () => {
  it("accepts the company's default page and compiles it for the browser", async () => {
    const r = await checkPage(DEFAULT, "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.compiled).toContain('require("@company")');
      expect(r.compiled).not.toContain("import ");
    }
  });

  it("accepts a minimal page using hooks, data and actions", async () => {
    const src = `
import { useState } from "react";
import { Nav, CreateInvoice, Invoices } from "@company";
import { Panel, useCompanyData, useAction, money } from "@morph";
export default function Page() {
  const [open, setOpen] = useState(false);
  const data = useCompanyData();
  const run = useAction();
  const overdue = (data?.invoices ?? []).filter((i) => i.status === "overdue");
  return (
    <div>
      <Nav />
      <CreateInvoice />
      <Panel title="Overdue">
        {overdue.map((i) => <button key={i.id} onClick={() => run("invoices", "send_reminder", String(i.id))}>{money(i.amount)}</button>)}
      </Panel>
      {open && <Invoices compact />}
      <button onClick={() => setOpen(!open)}>toggle</button>
    </div>
  );
}`;
    expect(await problems(src)).toEqual([]);
  });

  it("reports syntax errors with a line number", async () => {
    const errs = await problems("export default function Page() { return <div> }");
    expect(errs[0]).toMatch(/^Line \d+/);
  });

  it.each([
    ["fetch", 'fetch("/api/app");'],
    ["window", "window.alert('x');"],
    ["document", "document.title = 'x';"],
    ["eval", "eval('1');"],
    ["Function", "new Function('return 1')();"],
    ["localStorage", "localStorage.setItem('a', 'b');"],
    ["globalThis", "globalThis.x = 1;"],
    ["location (not declared)", "location.href;"],
  ])("rejects %s", async (_name, body) => {
    expect((await problems(page(body))).join(" ")).toMatch(/isn't available|can't be used/);
  });

  it("allows common names like `open` when the page declares them", async () => {
    expect(await problems(page("const [open, setOpen] = useState(false); const history = [open];"))).toEqual([]);
  });

  it("rejects naming your own variable after an always-banned global", async () => {
    expect((await problems(page("const fetch = 1; console.log(fetch);"))).join(" ")).toMatch(/can't be used as a name/);
  });

  it("rejects imports from other modules and dynamic import()", async () => {
    expect((await problems(page("ax.get('/');", 'import ax from "axios";'))).join(" ")).toMatch(/Import from "axios"/);
    expect((await problems(page('import("@company");'))).join(" ")).toMatch(/Dynamic import/);
  });

  it("rejects unknown exports from @company and @morph", async () => {
    expect((await problems(page("", 'import { Checkout } from "@company";', "<div><Nav /><CreateInvoice /><Checkout /></div>"))).join(" ")).toMatch(
      /no export "Checkout"/,
    );
  });

  it("rejects escape hatches into the DOM and JS internals", async () => {
    expect((await problems(page("", "", '<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }}><Nav /><CreateInvoice /></div>'))).join(" ")).toMatch(
      /dangerouslySetInnerHTML/,
    );
    expect((await problems(page("const C = ({}).constructor;"))).join(" ")).toMatch(/constructor/);
    expect((await problems(page('const C = ({})["constructor"];'))).join(" ")).toMatch(/constructor/);
  });

  it("enforces the company's required components", async () => {
    const errs = await problems(page("", "", "<div><Nav /></div>"));
    expect(errs.join(" ")).toMatch(/<CreateInvoice \/> must always be on the page/);
  });

  it("requires a default export", async () => {
    const src = 'import { Nav, CreateInvoice } from "@company";\nexport function Page() { return <div><Nav /><CreateInvoice /></div>; }';
    expect((await problems(src)).join(" ")).toMatch(/export default/);
  });
});

describe("checkCss", () => {
  it("scopes CSS to the page root", () => {
    expect(checkCss(".x { color: red }").css).toBe("@scope (.morph-page) {\n.x { color: red }\n}");
    expect(checkCss("  ").css).toBe("");
  });

  it.each(["@import 'x.css';", "a { background: url(https://x.test/a.png) }", "a { b: expression(1) }", "</style><script>"])("rejects %s", (css) => {
    expect(checkCss(css).errors.length).toBeGreaterThan(0);
  });
});
