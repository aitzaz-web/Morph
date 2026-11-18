// Runs canned requests through a strategy and prints what changed. Usage:
//   npx tsx scripts/try-requests.ts [openai|anthropic] [maria|dev]
//   REQS="first request|second request" npx tsx scripts/try-requests.ts
import { DEFAULT_LAYOUT } from "../shared/layout.ts";
import { USERS } from "../shared/registry.ts";
import { openaiStrategy } from "../server/strategies/openai.ts";
import { anthropicStrategy } from "../server/strategies/anthropic.ts";
try { process.loadEnvFile(".env"); } catch {}

const run = process.argv[2] === "anthropic" ? anthropicStrategy : openaiStrategy;
const user = USERS[process.argv[3] ?? "maria"];
const REQUESTS = process.env.REQS?.split("|") ?? [
  "Show unpaid invoices over $500 at the top, and hide the promo and news",
  "Redesign it as a board, invoices in columns by status. Bigger text, calmer colors.",
  "Remove the create invoice button",
  "Just show my customers, today's visits, and a big button to invoice",
];

for (const message of REQUESTS) {
  const t = Date.now();
  try {
    const r = await run({ user, message, layout: DEFAULT_LAYOUT, history: [] });
    console.log(`\n> ${message}  (${Date.now() - t}ms)`);
    console.log(`  applied: ${r.applied.join("; ") || "-"}`);
    if (r.rejected.length) console.log(`  rejected: ${r.rejected.join(" | ")}`);
    for (const v of Object.values(r.layout.views)) console.log(`  view ${v.id}: ${JSON.stringify(v)}`);
    console.log(`  main: ${r.layout.regions.main.filter((s) => s.visible).map((s) => s.id).join(", ")}`);
    console.log(`  says: ${r.explanation}`);
  } catch (e) {
    console.log(`\n> ${message}  ERROR ${(e as Error).message}`);
  }
}
