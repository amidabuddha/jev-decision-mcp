import { readFileSync } from "node:fs";
import type { Config } from "../src/config.js";
import { decisionInput, type DecisionOutput } from "../src/schema.js";

export const input = decisionInput.parse(JSON.parse(readFileSync(new URL("../examples/decision.json", import.meta.url), "utf8")));

// Arbitrary SDK-compatible destinations: invented domains with path prefixes,
// localhost for self-hosting and plain HTTP. No provider allowlist exists.
export const config: Config = { apiKey: "synthetic-test-key", baseURL: "https://api.invented.example/decisions", model: "judge-model-7", timeoutMs: 30000 };
export const localhostConfig: Config = { apiKey: "synthetic-local-key", baseURL: "http://127.0.0.1:8787/jev", model: "local-eval-model", timeoutMs: 30000 };
export const remoteHttpConfig: Config = { apiKey: "synthetic-remote-key", baseURL: "http://decisions.remote.example/judge/v2", model: "model-a.b-c_3", timeoutMs: 30000 };
export const configs = [config, localhostConfig, remoteHttpConfig];

/** The SDK route composed under the configured destination. */
export const endpoint = (cfg: Config): string => `${cfg.baseURL}/v1/systemone`;

export const output: DecisionOutput = {
  model: "jev-1.13.0",
  answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.01, other: 0.01 }, confidence: 0.9 },
    refund_requested: { type: "noul", noul: 0.99 },
    urgency: { type: "score", score: 1.95, probabilities: { "0": 0.01, "1": 0.03, "2": 0.96 }, legend: { "0": "No response deadline or time pressure is stated", "1": "A response is requested within several days", "2": "A response is requested today or immediately" }, confidence: 0.9 },
  },
  usage: { input_tokens: 300, output_tokens: 50 },
};
