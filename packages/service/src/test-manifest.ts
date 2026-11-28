// A small manifest for the service's tests, shaped like a real company's.

import type { Manifest } from "@morph/shared";

const comp = (id: string, importName: string, importance: "critical" | "high" = "high"): Manifest["components"][number] => ({
  id,
  importName,
  name: importName,
  description: `${importName} component.`,
  importance,
  props: (id === "invoices" ? { compact: "boolean: narrow version" } : {}) as Record<string, string>,
  styling: "",
});

export const TEST_MANIFEST: Manifest = {
  app: { name: "Testco", description: "an invoicing app" },
  components: [comp("nav", "Nav", "critical"), comp("create_invoice", "CreateInvoice", "critical"), comp("invoices", "Invoices"), comp("news", "News")],
  data: {
    sources: [
      {
        id: "invoices",
        name: "Invoices",
        description: "Every invoice the user can see.",
        key: "id",
        titleField: "customer",
        fields: [
          { id: "id", label: "Invoice", type: "text" },
          { id: "amount", label: "Amount", type: "money" },
        ],
        actions: [{ id: "send_reminder", label: "Send reminder", description: "Email the customer." }],
      },
    ],
  },
  rules: [
    { component: "nav", mustShow: true, topmost: true, notCovered: true },
    { component: "create_invoice", mustShow: true, aboveFold: true, notCovered: true, minWidth: 60, minHeight: 24 },
  ],
  foldPx: 700,
  styleGuide: "",
  defaultPage: {
    source: `import { Nav, CreateInvoice, Invoices, News } from "@company";
import { Panel } from "@morph";
export default function Page() {
  return (
    <div className="site">
      <Nav />
      <CreateInvoice />
      <Panel title="Invoices"><Invoices /></Panel>
      <News />
    </div>
  );
}`,
    css: "",
  },
};
