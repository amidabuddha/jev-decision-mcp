import { readFileSync } from "node:fs";
import type { Config } from "../src/config.js";
import { decisionInput, type DecisionOutput } from "../src/schema.js";

export const input = decisionInput.parse(JSON.parse(readFileSync(new URL("../examples/decision.json", import.meta.url), "utf8")));
export const config: Config = { apiKey: "synthetic-test-key", model: "jev-latest", timeoutMs: 30000 };
export const output: DecisionOutput = {
  model: "jev-1.13.0",
  answers: {
    team: { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.01, other: 0.01 }, confidence: 0.9 },
    refund_requested: { type: "noul", noul: 0.99 },
    urgency: { type: "score", score: 1.95, probabilities: { "0": 0.01, "1": 0.03, "2": 0.96 }, legend: { "0": "No response deadline or time pressure is stated", "1": "A response is requested within several days", "2": "A response is requested today or immediately" }, confidence: 0.9 },
  },
  usage: { input_tokens: 300, output_tokens: 50 },
};
