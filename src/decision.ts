import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, TypeSafeClient, type Fetch, type SystemOneRequest } from "@typesafe-ai/sdk";
import type { Config } from "./config.js";
import { decisionInput, validateResponse, type DecisionOutput } from "./schema.js";

export class DecisionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function createDecider(config: Config, fetch?: Fetch) {
  const client = config.apiKey ? new TypeSafeClient({
    apiKey: config.apiKey,
    // Always use the official origin; tool input cannot redirect credentials.
    baseURL: "https://api.typesafe.ai",
    defaultModel: config.model,
    timeout: Math.min(config.timeoutMs, 10000),
    logLevel: "off",
    ...(fetch ? { fetch } : {}),
  }) : undefined;

  return async (raw: unknown, signal?: AbortSignal): Promise<DecisionOutput> => {
    const parsed = decisionInput.safeParse(raw);
    if (!parsed.success) throw new DecisionError("INVALID_INPUT", "Invalid decision request. Check state, instructions and criteria against the tool schema.");
    if (!client) throw new DecisionError("MISSING_API_KEY", "Set TYPESAFE_API_KEY in the project .env or process environment, then restart the MCP server.");
    const deadline = AbortSignal.timeout(config.timeoutMs);
    try {
      // Runtime validation guarantees Score's minimum two entries, expressed
      // as a tuple by the SDK but as a homogeneous array in our MCP schema.
      const result = await client.systemOne(parsed.data as SystemOneRequest, {
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      try { return validateResponse(result, parsed.data); }
      catch { throw new DecisionError("INVALID_RESPONSE", "TypeSafe returned a response that does not match the requested decision schema."); }
    } catch (error) {
      if (error instanceof DecisionError) throw error;
      if (error instanceof APIUserAbortError || error instanceof APITimeoutError) {
        throw new DecisionError(signal?.aborted ? "CANCELLED" : "TIMEOUT", signal?.aborted ? "Decision request cancelled." : "TypeSafe request exceeded its timeout.");
      }
      if (error instanceof APIError) {
        // Upstream bodies can echo submitted data. Expose only a status-based message.
        const guidance = error.status === 401 ? "Check TYPESAFE_API_KEY."
          : error.status === 403 ? "Check account permissions."
          : error.status === 422 ? "Check the model, question instructions and criteria."
          : error.status === 429 ? "Rate limit reached; retry later."
          : "The service rejected the request; retry later if temporary.";
        throw new DecisionError("API_ERROR", `TypeSafe HTTP ${error.status}. ${guidance}`);
      }
      if (error instanceof APIConnectionError) throw new DecisionError("CONNECTION_ERROR", "Could not connect to TypeSafe. Check network access.");
      throw new DecisionError("INTERNAL_ERROR", "The decision request failed unexpectedly.");
    }
  };
}
export type Decider = ReturnType<typeof createDecider>;
