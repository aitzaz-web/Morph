// Ledgerly's default dashboard, written the same way the AI writes pages: only "react",
// "@company" and "@morph" imports. It's uploaded with the manifest (morph.manifest.ts) and checked
// by Morph. Every user starts here, and the AI edits a copy of it.
import { Activity, CreateInvoice, Customers, Invoices, Nav, News, PayrollPromo, RevenueChart, Stats, Visits } from "@company";
import { Panel } from "@morph";

export default function Page() {
  return (
    <div className="site">
      <header className="site-header">
        <Nav className="header-nav" />
        <CreateInvoice />
      </header>

      <div className="site-body">
        <main className="region-main">
          <Panel className="span-6 promo-panel">
            <PayrollPromo />
          </Panel>
          <Panel title="Key numbers" className="span-6" collapsible>
            <Stats />
          </Panel>
          <Panel title="Revenue trend" className="span-3" collapsible>
            <RevenueChart />
          </Panel>
          <Panel title="Industry news" className="span-3" collapsible>
            <News />
          </Panel>
          <Panel title="All invoices" className="span-6" collapsible>
            <Invoices />
          </Panel>
        </main>

        <aside className="region-sidebar">
          <Panel title="Customers" collapsible>
            <Customers />
          </Panel>
          <Panel title="Today's site visits" collapsible>
            <Visits />
          </Panel>
          <Panel title="Recent activity" collapsible>
            <Activity />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
