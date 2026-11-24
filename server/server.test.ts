import { beforeEach, describe, expect, it } from "vitest";
import { resetCompanyData } from "./company.ts";

process.env.MORPH_DB = ":memory:";
const { app, DEFAULT_PAGE } = await import("./index.ts");
const { resetPage } = await import("./db.ts");

const req = (method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const GOOD = `import { Nav, CreateInvoice, Invoices } from "@company";
export default function Page() {
  return <div className="mine"><Nav /><CreateInvoice /><Invoices /></div>;
}`;

const getPage = async (user: string) => (await app.request(`/api/page?user=${user}`)).json();

beforeEach(() => {
  resetCompanyData();
  resetPage("maria");
  resetPage("dev");
});

describe("company data", () => {
  it("a rep only sees their own customers", async () => {
    const maria = await (await app.request("/api/app?user=maria")).json();
    const dev = await (await app.request("/api/app?user=dev")).json();
    expect(dev.customers.length).toBeLessThan(maria.customers.length);
    expect(dev.customers.every((c: { rep: string }) => c.rep === "Dev")).toBe(true);
  });

  it("unknown users get nothing", async () => {
    expect((await app.request("/api/page?user=nobody")).status).toBe(401);
    expect((await app.request("/api/app")).status).toBe(401);
  });
});

describe("pages", () => {
  it("starts on the company's default page, compiled", async () => {
    const p = await getPage("maria");
    expect(p.source).toBe(DEFAULT_PAGE.source);
    expect(p.version).toBeNull();
    expect(p.versions).toBe(0);
    expect(p.compiled).toContain('require("@company")');
  });

  it("saves a page that passes the checks, with scoped CSS", async () => {
    const r = await app.request("/api/page?user=maria", req("PUT", { source: GOOD, css: ".mine { color: red }", summary: "Mine" }));
    expect(r.status).toBe(200);
    const p = await getPage("maria");
    expect(p.source).toBe(GOOD);
    expect(p.versions).toBe(1);
    expect(p.scopedCss).toContain("@scope (.morph-page)");
  });

  it("re-checks pages on save and refuses ones that break the rules", async () => {
    const bad = GOOD.replace("<CreateInvoice />", "");
    const r = await app.request("/api/page?user=maria", req("PUT", { source: bad, css: "" }));
    expect(r.status).toBe(400);
    expect((await r.json()).problems.join(" ")).toMatch(/CreateInvoice/);
    expect((await getPage("maria")).versions).toBe(0);
  });

  it("keeps each user's page separate", async () => {
    await app.request("/api/page?user=maria", req("PUT", { source: GOOD, css: "" }));
    expect((await getPage("maria")).source).toBe(GOOD);
    expect((await getPage("dev")).source).toBe(DEFAULT_PAGE.source);
  });

  it("undo goes back one version, reset goes back to the default", async () => {
    const second = GOOD.replace("mine", "second");
    await app.request("/api/page?user=maria", req("PUT", { source: GOOD, css: "" }));
    await app.request("/api/page?user=maria", req("PUT", { source: second, css: "" }));
    expect((await getPage("maria")).source).toBe(second);

    await app.request("/api/page/undo?user=maria", req("POST"));
    expect((await getPage("maria")).source).toBe(GOOD);

    await app.request("/api/page?user=maria", req("PUT", { source: second, css: "" }));
    await app.request("/api/page?user=maria", req("DELETE"));
    const p = await getPage("maria");
    expect(p.source).toBe(DEFAULT_PAGE.source);
    expect(p.versions).toBe(0);
  });
});
