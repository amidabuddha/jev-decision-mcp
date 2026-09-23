import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DecisionError, type Decider } from "./decision.js";
import { decisionInput, decisionOutput } from "./schema.js";

export function createServer(decide: Decider): McpServer {
  const server = new McpServer({ name: "jev-decision-mcp", version: "0.1.1" });
  server.registerTool("jev_decide", {
    title: "Ask Jev for typed decisions",
    description: "Evaluate supplied context using TypeSafe Jev. Batch independent, narrow questions in one call: choice selects a provided label; score returns a position on 2–10 ordered levels (0-based); noul returns probability of yes, not intensity. Supply relevant evidence and full instructions; question IDs are not sent to the model. Include an other/none choice when appropriate. Questions cannot use each other's answers. Returns raw judgments, probabilities, confidence for choice/score, and token usage. Use caller-defined policies for uncertainty. This sends the supplied state and questions to TypeSafe and may incur API charges. It does not execute selected actions.",
    inputSchema: decisionInput,
    outputSchema: decisionOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input, extra) => {
    try {
      const result = await decide(input, extra.signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const safe = error instanceof DecisionError ? error : new DecisionError("INTERNAL_ERROR", "Decision request failed.");
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: safe.code, message: safe.message }) }] };
    }
  });
  return server;
}
