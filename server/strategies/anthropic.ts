// Strategy "anthropic": Claude writes the page through the write_page tool. Each page is checked
// by CodeSession, and rejected pages go back as errors so the model can fix them.

import Anthropic from "@anthropic-ai/sdk";
import { CodeSession, MAX_ROUNDS, TOOLS, cleanHistory, systemPrompt, userPrompt } from "./common.ts";
import type { MorphRequest, MorphResult } from "./types.ts";

let client: Anthropic | null = null; // created on first use so .env is loaded by then
const MODEL = "claude-opus-5-5";

const tools = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters,
  strict: true,
})) as Anthropic.Beta.BetaTool[];

export async function anthropicStrategy(req: MorphRequest): Promise<MorphResult> {
  client ??= new Anthropic();
  const session = new CodeSession();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...cleanHistory(req.history).map((m) => ({ role: m.role, content: m.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: userPrompt(req.page, req.message, req.repair) },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      // Re-run on a fallback model if this one declines; routed by refusal category.
      fallbacks: "default",
      output_config: { effort: (process.env.MORPH_EFFORT as "low" | "medium" | "high") || "medium" },
      system: [{ type: "text", text: systemPrompt(req.user), cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return session.result("Sorry, I can't help with that request.");

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return session.result(text);
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const r = await session.run(tu.name, tu.input);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  return session.result(session.candidate ? "" : "I couldn't write a page that passes the site's checks. Try asking in a different way.");
}
