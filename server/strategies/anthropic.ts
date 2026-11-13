// Strategy "anthropic": Claude calls the layout tools; each call is applied and validated by
// LayoutSession, and rejected calls go back as errors so the model can adjust.

import Anthropic from "@anthropic-ai/sdk";
import { LayoutSession, MAX_ROUNDS, SYSTEM, TOOLS, cleanHistory, layoutNote, userPrompt } from "./common.ts";
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
  const session = new LayoutSession(req.layout);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...cleanHistory(req.history).map((m) => ({ role: m.role, content: m.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: userPrompt(session.layout, req.message) },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // Re-run on a fallback model if this one declines; routed by refusal category.
      fallbacks: "default",
      output_config: { effort: (process.env.MORPH_EFFORT as "low" | "medium" | "high") || "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") {
      return { layout: session.layout, explanation: "Sorry, I can't help with that request.", applied: session.applied, rejected: session.rejected };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { layout: session.layout, explanation: text || "Done.", applied: session.applied, rejected: session.rejected };
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu) => {
      const r = session.run(tu.name, tu.input);
      return { type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
    });
    messages.push({ role: "user", content: [...results, { type: "text", text: layoutNote(session.layout) }] });
  }

  return {
    layout: session.layout,
    explanation: "I made some changes but ran out of steps; tell me if anything else needs adjusting.",
    applied: session.applied,
    rejected: session.rejected,
  };
}
