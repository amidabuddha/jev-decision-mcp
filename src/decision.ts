import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, TypeSafeClient, type Fetch, type SystemOneRequest } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import { decisionInput, validateResponse, type DecisionInput, type DecisionOutput } from "./schema.js";

export class DecisionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

// Nonmutating request conversion applied just before the wire call. The MCP
// schema accepts a null noul criterion description as "undescribed", but the
// upstream validator rejects such a description with HTTP 422. Omit only
// top-level null optional noul criterion descriptions from the outgoing
// request (and the criteria property entirely when none remain). Non-null
// entries travel exactly as supplied, including structured descriptions with
// nested nulls, and choice/score values are never touched. The parsed caller
// input is never mutated; the conversion builds a copy.
function toWireRequest(input: DecisionInput): SystemOneRequest {
  const questions: DecisionInput["questions"] = {};
  for (const [id, question] of Object.entries(input.questions)) {
    if (question.type !== "noul" || !question.criteria) { questions[id] = question; continue; }
    const described = Object.entries(question.criteria)
      .filter(([, description]) => description !== null && description !== undefined);
    questions[id] = described.length === Object.keys(question.criteria).length ? question
      : described.length === 0 ? { type: "noul", instructions: question.instructions }
      : { ...question, criteria: Object.fromEntries(described) };
  }
  return { ...input, questions } as SystemOneRequest;
}

export function createDecider(config: Config, fetch?: Fetch) {
  // Every setting is passed explicitly so the SDK's own environment fallbacks
  // (vendor key, base URL, model, log level) can never take effect, and the
  // client is only constructed when the generic API_KEY is configured.
  const client = config.apiKey ? new TypeSafeClient({
    apiKey: config.apiKey,
    // Requests always go to the configured destination; tool input can change
    // only the model name, never the credential or endpoint.
    baseURL: config.baseURL,
    defaultModel: config.model,
    timeout: Math.min(config.timeoutMs, 10000),
    logLevel: "off",
    // Bodies are always sent as plain JSON, never zstd-compressed.
    compression: false,
    ...(fetch ? { fetch } : {}),
  }) : undefined;

  return async (raw: unknown, signal?: AbortSignal): Promise<DecisionOutput> => {
    const parsed = decisionInput.safeParse(raw);
    if (!parsed.success) throw new DecisionError("INVALID_INPUT", "Invalid decision request. Check state, instructions and criteria against the tool schema.");
    if (!client) throw new DecisionError("MISSING_API_KEY", "Set API_KEY in the project .env or process environment, then restart the MCP server.");
    const deadline = AbortSignal.timeout(config.timeoutMs);
    try {
      // Runtime validation guarantees Score's minimum two entries, expressed
      // as a tuple by the SDK but as a homogeneous array in our MCP schema.
      // A per-call model override changes only the model name in the request;
      // credential and destination stay fixed for the process.
      const result = await client.systemOne(toWireRequest(parsed.data), {
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      // Null usage counts are an INVALID_RESPONSE; never invent counts.
      try { return validateResponse(result, parsed.data); }
      catch { throw new DecisionError("INVALID_RESPONSE", "The Decision API returned a response that does not match the requested decision schema."); }
    } catch (error) {
      if (error instanceof DecisionError) throw error;
      if (error instanceof APIUserAbortError || error instanceof APITimeoutError) {
        throw new DecisionError(signal?.aborted ? "CANCELLED" : "TIMEOUT", signal?.aborted ? "Decision request cancelled." : "The Decision API request exceeded its timeout.");
      }
      if (error instanceof APIError) {
        // Upstream bodies can echo submitted data. Expose only a status-based message.
        const guidance = error.status === 401 ? "Check API_KEY."
          : error.status === 403 ? "Check account permissions."
          : error.status === 422 ? "Check the model, question instructions and criteria."
          : error.status === 429 ? "Rate limit reached; retry later."
          : "The service rejected the request; retry later if temporary.";
        throw new DecisionError("API_ERROR", `Decision API HTTP ${error.status}. ${guidance}`);
      }
      if (error instanceof APIConnectionError) throw new DecisionError("CONNECTION_ERROR", "Could not connect to the Decision API. Check network access.");
      throw new DecisionError("INTERNAL_ERROR", "The decision request failed unexpectedly.");
    }
  };
}
export type Decider = ReturnType<typeof createDecider>;
