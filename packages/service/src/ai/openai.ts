// Strategy "openai": GPT writes the page through the write_page tool (Responses API). Each page
// is checked by CodeSession, and rejected pages go back as errors so the model can fix them.

import OpenAI from "openai";
import { CodeSession, MAX_ROUNDS, TOOLS, cleanHistory, systemPrompt, userPrompt } from "./common.ts";
import type { MorphRequest, MorphResult } from "./types.ts";

export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";

let client: OpenAI | null = null; // created on first use so .env is loaded by then

const tools: OpenAI.Responses.FunctionTool[] = TOOLS.map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  parameters: t.parameters,
  strict: true,
}));

export async function openaiStrategy(req: MorphRequest): Promise<MorphResult> {
  client ??= new OpenAI();
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const effort = (process.env.MORPH_EFFORT as "low" | "medium" | "high") || "medium";
  const session = new CodeSession(req.manifest);

  const input: OpenAI.Responses.ResponseInput = [
    ...cleanHistory(req.history).map((m) => ({ role: m.role, content: m.text }) as OpenAI.Responses.EasyInputMessage),
    { role: "user", content: userPrompt(req.page, req.message, req.repair) },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.responses.create({
      model,
      instructions: systemPrompt(req.manifest, req.user),
      input,
      tools,
      reasoning: { effort },
    });

    const calls = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0) return session.result(response.output_text ?? "");

    // Send the model's own output (reasoning + calls) back, then a result for every call.
    input.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));
    for (const call of calls) {
      let output: string;
      try {
        output = (await session.run(call.name, JSON.parse(call.arguments || "{}"))).content;
      } catch {
        output = "Rejected: arguments were not valid JSON.";
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
  }

  return session.result(session.candidate ? "" : "I couldn't write a page that passes the site's checks. Try asking in a different way.");
}
