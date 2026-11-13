// Runs canned requests through a strategy and prints results. Usage:
//   OPENAI_MODEL=gpt-5.5 npx tsx scripts/try-requests.ts [openai|anthropic]
import { DEFAULT_LAYOUT, findSlot } from "../shared/layout.ts";
import { openaiStrategy } from "../server/strategies/openai.ts";
import { anthropicStrategy } from "../server/strategies/anthropic.ts";
try { process.loadEnvFile(".env"); } catch {}

const run = process.argv[2] === "anthropic" ? anthropicStrategy : openaiStrategy;
const REQUESTS = process.env.REQS?.split("|") ?? [
  "Put my orders first",
  "Hide recommendations",
  "Hide the checkout, I never use it",
  "Make it simpler",
];

for (const message of REQUESTS) {
  const t = Date.now();
  try {
    const r = await run({ message, layout: DEFAULT_LAYOUT, history: [] });
    const cart = findSlot(r.layout, "cart")!.slot;
    console.log(`\n> ${message}  (${Date.now() - t}ms)`);
    console.log(`  applied: ${r.applied.join("; ") || "-"}`);
    if (r.rejected.length) console.log(`  rejected: ${r.rejected.length}`);
    console.log(`  main order: ${r.layout.regions.main.filter(s => s.visible).map(s => s.id).join(", ")} | cart visible: ${cart.visible && !cart.collapsed}`);
    console.log(`  says: ${r.explanation}`);
  } catch (e) {
    console.log(`\n> ${message}  ERROR ${(e as Error).message}`);
  }
}
